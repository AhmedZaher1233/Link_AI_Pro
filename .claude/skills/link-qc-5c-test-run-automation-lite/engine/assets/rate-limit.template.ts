// @link-qc-5-template rate-limit 3.1.0
// helpers/rate-limit.ts — pace the calls the application rate-limits, never the tests; scoped, shared across runs,
// server deadlines never shortened (skill 5, references/run-plan-and-config.md <run_plan> "Rate limits",
// references/code-craft.md §9, §11).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/rate-limit.ts — ALWAYS installed; without
// PW_RATE_LIMIT_STATE it does nothing. The configured pace per service comes from the run plan's rate_limits[]
// (run-stage.mjs passes it as PW_RATE_LIMITS), so learning a limit changes the run plan, never this code:
//
//   PW_RATE_LIMITS = {"login":{"match":"POST /api/session","limit":5,"window_s":60,"pace":4,"scope":"account","at":"start",
//                     "calls_per_tc":{"default":1,"TC-07":2},"throttle_statuses":[403]}}
//
// SCOPES — one slot book per environment, shared by EVERY run on it (other stories, skill 9): PW_RATE_LIMIT_STATE is the
// coordination directory's rate-limits/{environment id}.json (or a phase-local file with an older runner). A request
// falls under several buckets; one booking reserves its slot in ALL of them in ONE locked transaction:
//   service:{name}                  a service's configured pace (scope "machine" / "global") and its service-wide cool-down
//   service:{name}@account:{A-ID}   the pace of an account-scoped limit, per account — `@account:?` while the running test
//                                   has not resolved its account yet (all such bookings share it: stricter, still safe)
//   endpoint:{METHOD /path/{id}}    a limit the application advertised for one endpoint, or a refusal on it
//   account:{A-ID} · environment    broader restrictions (a lockout, an environment-wide cool-down): every booking honours
//                                   their notBefore, so an endpoint with no limit of its own never bypasses them
// The pace of a bucket is the STRICTER of the configured one and the one the application advertises (RateLimit-* /
// X-RateLimit-* headers on ANY response, seen by helpers/network-guard.ts) — known limits are paced from the first
// request, not after the first refusal.
//
// SERVER DEADLINES ARE NEVER SHORTENED. A refusal (seen by the network guard) sets the refused scopes' notBefore from
// Retry-After (delta-seconds or HTTP-date) or RateLimit-Reset; without either header the helper chooses its own back-off
// with FULL JITTER — random 0 … min(TIMEOUTS.rate_limit.cooldown_max, TIMEOUTS.rate_limit.cooldown × 2^(n−1)) for the
// n-th refusal in a row. notBefore only ever moves later; no request of the scope is sent before it.
// - A start-of-test slot (`at: "start"`, e.g. login — every test signs in through the UI) is reserved before the test's
//   side effects: by the admission fixture (helpers/admission.ts) when the project uses it, otherwise by the network
//   guard's beforeEach. A slot that cannot be had within TIMEOUTS.rate_limit.max_start_wait DEFERS the test: it is skipped
//   with the annotation `rate-limit-deferred` (description = the ISO time it may start) and reported
//   `not started: deferred until {ISO}` — never a failure, never `rate_limited` by itself.
// - A mid-test slot: `await rateLimitSlot('search')` in the page-object method right before the triggering action. A slot
//   further away than TIMEOUTS.rate_limit.in_step_wait (it must fit the step deadline) throws RateLimitWaitError
//   "wait budget exhausted (server deadline {ISO})" — reported INCOMPLETE `interrupted: wait budget exhausted (…)`,
//   never `rate_limited` by itself (that needs the failing step's own request refused, and refused again alone).
// - After a refusal the scope resumes at 50 % of its pace and steps up by 10 % per window without a refusal (additive
//   increase back to the full pace); a new refusal starts again at 50 %.
// - Every wait is bounded and CANCELLABLE: the runner creates PW_CANCEL_FILE when the stage stops; the wait checks it every
//   second and throws RateLimitCancelledError (the test is interrupted, never failed by the application).
// - The slot book is changed only under its lock: `{state}.lock/` created atomically with owner.json {pid, start, at,
//   nonce}; a lock whose owner process is dead is broken at once, an ownerless one after 30 s, one held 5 min (a reused
//   PID — a critical section takes milliseconds) is broken too. The file is written temp + rename; entries expire by
//   window; this helper never deletes the book, another run's entries or another run's lock.
// - Records go to PW_RATE_LIMIT_FILE (one JSON per line): { at, worker, tc[], step, kind: 'paced', service, scope,
//   wait_ms, outcome: 'waited' | 'exceeded' | 'deferred', until? }. A deferral also writes the heartbeat
//   { at, worker, tc, event: 'deferred', until, scope }. Every wait writes rate-wait start / end heartbeats with its budget_ms.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { test, type TestInfo } from '@playwright/test';
import { TIMEOUTS } from '../timeouts';
import { heartbeat, tcIdsOf } from './steps';

export type Limit = {
  match?: string | null; limit?: number | null; window_s?: number | null; pace?: number | null; scope?: string | null; at?: string | null;
  calls_per_tc?: number | Record<string, number> | null;
  /** Statuses this service uses for throttling besides 429 (a learned throttle signature, e.g. [403]). */
  throttle_statuses?: number[] | null;
};

type Bucket = {
  slots: number[];
  notBefore: number;
  advertised: { pace: number; windowMs: number | null; at: number } | null;
  refusals: number;
  lastRefusalAt: number;
  recovery: { since: number } | null;
  lastWindowMs: number;
  updatedAt: number;
};
type SlotBook = { schema: string; updatedAt: string; buckets: Record<string, Bucket> };
type Pace = { pace: number; windowMs: number };

const STATE_SCHEMA = 'skill5-ratelimit-state/1';
const LOCK_OWNERLESS_MS = 30_000;
const LOCK_GIVE_UP_MS = 10_000;
const LOCK_MAX_HELD_MS = 300_000;
const TEMP_STALE_MS = 600_000;
const ENTRY_MEMORY_MS = 3_600_000;
const REFUSAL_MEMORY_MS = 600_000;
const RECOVERY_START = 0.5;
const RECOVERY_STEP = 0.1;
const PROCESS_START = Date.now() - Math.round(process.uptime() * 1000);

export class RateLimitWaitError extends Error {
  constructor(readonly service: string, readonly waitMs: number, readonly maxMs: number, readonly deadline: string = new Date(Date.now() + waitMs).toISOString()) {
    super(`RateLimitWaitError: wait budget exhausted (server deadline ${deadline}) — the next ${service} slot is ${Math.round(waitMs / 1000)} s away, longer than this wait budget of ${Math.round(maxMs / 1000)} s; the application's rate limit, not a defect`);
    this.name = 'RateLimitWaitError';
  }
}

export class RateLimitCancelledError extends Error {
  constructor(readonly service: string) {
    super(`RateLimitCancelledError: the stage stopped while ${service} waited for a rate-limit slot — interrupted, never a failure of the application`);
    this.name = 'RateLimitCancelledError';
  }
}

/* ---------------- the per-worker runtime registry shared with the other helpers (globalThis) ---------------- */

type QaRuntime = {
  steps?: { title: string; testId: string | null }[];
  account?: { id: string; testId: string | null } | null;
  reserved?: Record<string, true>;
};
/** The registry helpers/steps.ts, helpers/test-data.ts and the guards share — through globalThis, never an import. */
export function qaRuntime(): QaRuntime {
  const g = globalThis as unknown as Record<string, QaRuntime | undefined>;
  const key = '__linkQcRuntime';
  if (!g[key]) g[key] = {};
  return g[key] as QaRuntime;
}
/** The running test's id, or null outside a test. */
export function runningTestId(): string | null {
  try { return (test.info() as unknown as { testId?: string }).testId ?? null; } catch { return null; }
}
/** The step open right now in the running test (helpers/steps.ts registers it), or null. */
export function currentStepTitle(): string | null {
  const stack = qaRuntime().steps || [];
  const id = runningTestId();
  for (let i = stack.length - 1; i >= 0; i--) if (id === null || stack[i].testId === null || stack[i].testId === id) return stack[i].title;
  return null;
}
/** The A-ID the running test resolved through helpers/test-data.ts account(), or null. */
export function currentAccountId(): string | null {
  const a = qaRuntime().account;
  if (!a) return null;
  const id = runningTestId();
  return id === null || a.testId === null || a.testId === id ? a.id : null;
}

/* ---------------- configuration ---------------- */

function limits(): Record<string, Limit> {
  try {
    const v = JSON.parse(process.env.PW_RATE_LIMITS || '{}');
    return v && typeof v === 'object' ? (v as Record<string, Limit>) : {};
  } catch { return {}; }
}
const paceOf = (l: Limit): number => (Number(l.pace) > 0 ? Number(l.pace) : Number(l.limit) > 1 ? Number(l.limit) - 1 : Number(l.limit) || 0);
const windowOf = (l: Limit): number => (Number(l.window_s) > 0 ? Number(l.window_s) * 1000 : 0);
const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** "/api/orders/123/lines/9f8e…" → "/api/orders/{id}/lines/{id}" — numeric, UUID and long-hex segments are ids. */
export function pathTemplate(pathname: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out = pathname.split('/').map((seg) => (/^\d+$/.test(seg) || uuid.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) ? '{id}' : seg)).join('/');
  return trimSlash(out || '/');
}

/** "POST /api/search?q=x" → "POST /api/search" — the method + path template of an endpoint scope. */
export function endpointKey(methodAndPath: string): string {
  const m = /^\s*([A-Za-z]+)\s+(\S+)\s*$/.exec(methodAndPath);
  const method = m ? m[1].toUpperCase() : 'ANY';
  let path = m ? m[2] : methodAndPath.trim();
  try { if (/^https?:\/\//i.test(path)) path = new URL(path).pathname; } catch { /* already a path */ }
  return 'endpoint:' + method + ' ' + pathTemplate(path.split('?')[0]);
}

/** The configured service whose `match` ("POST /api/session", "/api/search*", "GET /api/items/{id}") covers a request. */
export function matchService(method: string, pathname: string): string | null {
  const tpl = pathTemplate(pathname);
  for (const [name, l] of Object.entries(limits())) {
    if (!l || !l.match) continue;
    const m = /^\s*(?:([A-Za-z]+)\s+)?(\S+)\s*$/.exec(String(l.match));
    if (!m) continue;
    if (m[1] && m[1].toUpperCase() !== method.toUpperCase()) continue;
    let want = m[2];
    try { if (/^https?:\/\//i.test(want)) want = new URL(want).pathname; } catch { /* a path already */ }
    const prefix = want.endsWith('*');
    const pattern = pathTemplate(prefix ? want.slice(0, -1) : want);
    if (prefix ? tpl.startsWith(pattern) : tpl === pattern) return name;
  }
  return null;
}

/** True when this status is a throttling refusal for the service by its learned signature (`throttle_statuses`). */
export function learnedThrottle(service: string | null, status: number): boolean {
  if (!service) return false;
  const l = limits()[service];
  return !!(l && Array.isArray(l.throttle_statuses) && l.throttle_statuses.includes(status));
}

/** The pacing bucket of a service: per account for an account-scoped limit (`@account:?` until the account is known). */
export function serviceBucket(service: string, account: string | null): string {
  const l = limits()[service];
  return l && l.scope === 'account' ? 'service:' + service + '@account:' + (account || '?') : 'service:' + service;
}

function scopesFor(service: string, account: string | null, endpoint: string | null): string[] {
  const all = [serviceBucket(service, account), 'service:' + service, account ? 'account:' + account : '', endpoint ? endpointKey(endpoint) : '', 'environment'];
  return [...new Set(all.filter((s) => s.length > 0))];
}

/* ---------------- timers (the ONLY waits of this helper) ---------------- */

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    // deliberate timer: rate-limit pacing and lock back-off — the wait IS the throttle the application's limit requires (TIMEOUTS.rate_limit)
    setTimeout(resolve, Math.max(0, ms));
  });
}
function cancelled(): boolean {
  const flag = process.env.PW_CANCEL_FILE;
  if (!flag) return false;
  try { return existsSync(flag); } catch { return false; }
}
/** Wait `ms`, checking the runner's cancel flag every second. */
// a server-directed wait is BOUNDED and visible: `rate-wait` start / end heartbeats carry its budget, so the watchdog
// never reads it as a UI stall — and declares it hung only past that budget + grace
async function pause(ms: number, service: string): Promise<void> {
  const end = Date.now() + ms;
  let who: { worker: number; tc: string } | null = null;
  try { const info = test.info(); who = { worker: info.parallelIndex, tc: tcIdsOf(info.title).join(',') || info.title }; } catch { who = null; }
  if (who) heartbeat({ ...who, event: 'rate-wait', phase: 'start', reason: 'rate limit: ' + service, budget_ms: ms });
  try {
    for (;;) {
      if (cancelled()) throw new RateLimitCancelledError(service);
      const left = end - Date.now();
      if (left <= 0) return;
      await delay(Math.min(1000, left));
    }
  } finally {
    if (who) heartbeat({ ...who, event: 'rate-wait', phase: 'end', reason: 'rate limit: ' + service });
  }
}

/* ---------------- the shared slot book ---------------- */

type LockOwner = { pid: number; start: number; at: string; nonce: string };
function ownerAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
function readOwner(lock: string): LockOwner | null {
  try {
    const o = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as Partial<LockOwner>;
    return o && typeof o.pid === 'number' && typeof o.nonce === 'string' ? (o as LockOwner) : null;
  } catch { return null; }
}
// RELEASE (Windows-safe, the same convention as skill 5's capacity.mjs): deleting a lock folder while another process reads
// its owner.json fails with EPERM and leaves an ownerless folder everyone would wait 30 s out. So the owner renames the
// folder away (retried briefly) and, if that keeps failing, renames owner.json to released-{pid}-{nonce}.json and never
// touches the folder again; a folder holding such a marker and no owner.json is broken at once.
function waitSync(ms: number): void { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ } }
function removeLock(lock: string, tag: string): void {
  for (let i = 0; i < 25; i++) {
    const tomb = lock + '.released-' + process.pid + '-' + tag + '-' + i;
    try { renameSync(lock, tomb); try { rmSync(tomb, { recursive: true, force: true }); } catch { /* a leftover tombstone is harmless */ } return; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'ENOTEMPTY') break;
      waitSync(2 + i * 2);
    }
  }
  try { renameSync(join(lock, 'owner.json'), join(lock, 'released-' + process.pid + '-' + tag + '.json')); } catch { try { writeFileSync(join(lock, 'released-' + process.pid + '-' + tag + '.json'), '{}'); } catch { /* the 30 s ownerless rule still frees it */ } }
}
function releasedMarked(lock: string): boolean {
  try { return !existsSync(join(lock, 'owner.json')) && readdirSync(lock).some((n) => n.startsWith('released-')); } catch { return false; }
}
function breakIfStale(lock: string): void {
  const owner = readOwner(lock);
  if (owner) {
    const heldMs = Date.now() - Date.parse(owner.at);
    if (ownerAlive(owner.pid) && !(heldMs > LOCK_MAX_HELD_MS)) return;
    const again = readOwner(lock);
    if (!again || again.nonce !== owner.nonce) return; // the lock changed hands meanwhile — never break a live one
    removeLock(lock, 'broken');
    return;
  }
  if (releasedMarked(lock)) { removeLock(lock, 'released'); return; }
  try { if (Date.now() - statSync(lock).mtimeMs > LOCK_OWNERLESS_MS) removeLock(lock, 'ownerless'); } catch { /* already gone */ }
}
async function withLock<T>(file: string, fn: () => Promise<T> | T): Promise<T> {
  const lock = file + '.lock';
  mkdirSync(dirname(file), { recursive: true });
  const nonce = Math.random().toString(36).slice(2) + '-' + process.pid;
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      try { writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, start: PROCESS_START, at: new Date().toISOString(), nonce })); } catch { /* an ownerless lock is broken after 30 s */ }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      breakIfStale(lock);
      if (Date.now() - t0 > LOCK_GIVE_UP_MS) throw new Error('rate-limit slot book lock stayed busy for ' + LOCK_GIVE_UP_MS / 1000 + ' s — another run holds it');
      await delay(20);
    }
  }
  try { return await fn(); } finally {
    const owner = readOwner(lock);
    if (!owner || owner.nonce === nonce) removeLock(lock, nonce);
  }
}

function emptyBucket(): Bucket {
  return { slots: [], notBefore: 0, advertised: null, refusals: 0, lastRefusalAt: 0, recovery: null, lastWindowMs: 0, updatedAt: 0 };
}
function readBook(file: string): SlotBook {
  const book: SlotBook = { schema: STATE_SCHEMA, updatedAt: new Date().toISOString(), buckets: {} };
  let raw: unknown = null;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { raw = null; }
  if (!raw || typeof raw !== 'object') return book;
  const r = raw as { schema?: unknown; buckets?: unknown };
  if (r.schema === STATE_SCHEMA && r.buckets && typeof r.buckets === 'object') {
    for (const [k, v] of Object.entries(r.buckets as Record<string, Partial<Bucket>>)) {
      if (!v || typeof v !== 'object') continue;
      book.buckets[k] = { ...emptyBucket(), ...v, slots: Array.isArray(v.slots) ? v.slots.filter((x): x is number => typeof x === 'number') : [] };
    }
  } else {
    // the phase-local slot book of an older helper ({ "<service>[:<key>]": [slot, …] }) — read as service buckets
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (Array.isArray(v)) book.buckets[k.startsWith('service:') ? k : 'service:' + k] = { ...emptyBucket(), slots: v.filter((x): x is number => typeof x === 'number') };
    }
  }
  return book;
}
function sweepTemps(file: string): void {
  try {
    const dir = dirname(file);
    const stem = basename(file) + '.';
    for (const f of readdirSync(dir)) {
      if (!f.startsWith(stem) || !f.endsWith('.tmp')) continue;
      try { if (Date.now() - statSync(join(dir, f)).mtimeMs > TEMP_STALE_MS) unlinkSync(join(dir, f)); } catch { /* another writer's temp file */ }
    }
  } catch { /* housekeeping only */ }
}
/** Temp + rename (retried briefly: on Windows a reader holding the file open makes the rename fail for a moment). */
async function writeBook(file: string, book: SlotBook): Promise<void> {
  book.updatedAt = new Date().toISOString();
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
  writeFileSync(tmp, JSON.stringify(book));
  for (let i = 0; ; i++) {
    try { renameSync(tmp, file); break; } catch (e) {
      if (i >= 5) { try { unlinkSync(tmp); } catch { /* left for the stale-temp sweep */ } throw e; }
      await delay(20);
    }
  }
  sweepTemps(file);
}
/** Entries expire by window: old slots, a passed notBefore, a forgotten advertisement — never anything still in force. */
function prune(book: SlotBook, now: number): void {
  for (const [k, b] of Object.entries(book.buckets)) {
    const windowMs = b.lastWindowMs > 0 ? b.lastWindowMs : ENTRY_MEMORY_MS;
    b.slots = b.slots.filter((s) => s > now - windowMs - 1000).sort((x, y) => x - y);
    if (b.lastRefusalAt < now - REFUSAL_MEMORY_MS) b.refusals = 0;
    if (b.advertised && b.advertised.at < now - ENTRY_MEMORY_MS) b.advertised = null;
    if (b.recovery && b.lastWindowMs > 0 && now - b.recovery.since > b.lastWindowMs * ((1 - RECOVERY_START) / RECOVERY_STEP + 1)) b.recovery = null;
    const idle = !b.slots.length && b.notBefore < now - ENTRY_MEMORY_MS && !b.advertised && !b.recovery && b.lastRefusalAt < now - REFUSAL_MEMORY_MS;
    if (idle) delete book.buckets[k];
  }
}

function configuredPace(key: string): Pace | null {
  const m = /^service:([^@]+)(@account:.+)?$/.exec(key);
  if (!m) return null;
  const l = limits()[m[1]];
  if (!l) return null;
  if ((l.scope === 'account') !== !!m[2]) return null; // an account-scoped limit paces only its per-account buckets
  const pace = paceOf(l), windowMs = windowOf(l);
  return pace > 0 && windowMs > 0 ? { pace, windowMs } : null;
}
function recoveryFactor(b: Bucket, windowMs: number, now: number): number {
  if (!b.recovery) return 1;
  if (now < b.recovery.since) return RECOVERY_START;
  return Math.min(1, RECOVERY_START + RECOVERY_STEP * Math.floor((now - b.recovery.since) / windowMs));
}
/** The stricter of the configured and the advertised pace, at the recovery factor (50 % after a refusal, +10 % per window). */
function effectivePace(key: string, b: Bucket, now: number): Pace | null {
  const c = configuredPace(key);
  const a = b.advertised && b.advertised.pace > 0 && b.advertised.windowMs ? { pace: b.advertised.pace, windowMs: b.advertised.windowMs } : null;
  const p = c && a ? (c.pace / c.windowMs <= a.pace / a.windowMs ? c : a) : c || a;
  if (!p) return null;
  return { pace: Math.max(1, Math.floor(p.pace * recoveryFactor(b, p.windowMs, now))), windowMs: p.windowMs };
}

type Booking = { booked: boolean; at: number; wait: number; scope: string | null };

/**
 * Reserve `count` consecutive slots in every paced bucket of `scopes` (FIFO per bucket: never before its last slot, never
 * more than `pace` in any window), honouring every scope's notBefore. Nothing is booked when the last slot is further away
 * than `maxWaitMs`.
 */
async function book(scopes: string[], count: number, maxWaitMs: number): Promise<Booking> {
  const file = process.env.PW_RATE_LIMIT_STATE as string;
  return withLock(file, async () => {
    const now = Date.now();
    const state = readBook(file);
    prune(state, now);
    let at = now;
    let by: string | null = null;
    const paced: { key: string; b: Bucket; p: Pace; slots: number[] }[] = [];
    for (const key of scopes) {
      const b = state.buckets[key] || emptyBucket();
      if (b.notBefore > at) { at = b.notBefore; by = key; }
      const p = effectivePace(key, b, now);
      if (p) paced.push({ key, b, p, slots: b.slots.slice() });
    }
    const times: number[] = [];
    for (let i = 0; i < count; i++) {
      let t = Math.max(at, times.length ? times[times.length - 1] : now);
      for (const x of paced) {
        let need = x.slots.length ? Math.max(t, x.slots[x.slots.length - 1]) : t;
        if (x.slots.length >= x.p.pace) need = Math.max(need, x.slots[x.slots.length - x.p.pace] + x.p.windowMs);
        if (need > t) { t = need; by = x.key; }
      }
      times.push(t);
      for (const x of paced) x.slots.push(t);
    }
    const last = times[times.length - 1];
    const wait = Math.max(0, last - now);
    if (wait > maxWaitMs) return { booked: false, at: last, wait, scope: by };
    if (paced.length) {
      for (const x of paced) state.buckets[x.key] = { ...x.b, slots: x.slots, lastWindowMs: x.p.windowMs, updatedAt: now };
      await writeBook(file, state);
    }
    return { booked: true, at: last, wait, scope: by };
  });
}

/* ---------------- what the network guard tells this helper ---------------- */

export type Refusal = { method: string; path: string; service: string | null; account: string | null; status: number; deadlineMs: number | null };
export type Advertised = { method: string; path: string; service: string | null; account: string | null; limit: number | null; remaining: number | null; resetAtMs: number | null; windowMs: number | null };

/** Full jitter: random 0 … min(cooldown_max, cooldown × 2^(n−1)) — used ONLY when the server named no deadline. */
function fullJitter(n: number): number {
  const ceiling = Math.min(TIMEOUTS.rate_limit.cooldown_max, TIMEOUTS.rate_limit.cooldown * Math.pow(2, Math.max(0, n - 1)));
  return Math.floor(Math.random() * Math.max(0, ceiling));
}

/** A throttling refusal: the refused scopes (endpoint + its service bucket) get a notBefore that only ever moves later. */
export async function noteRefusal(sig: Refusal): Promise<{ notBefore: number; scopes: string[]; serverDeadline: boolean }> {
  const file = process.env.PW_RATE_LIMIT_STATE;
  const scopes = [endpointKey(sig.method + ' ' + sig.path), ...(sig.service ? [serviceBucket(sig.service, sig.account)] : [])];
  if (!file) return { notBefore: 0, scopes, serverDeadline: sig.deadlineMs !== null };
  return withLock(file, async () => {
    const now = Date.now();
    const state = readBook(file);
    const buckets = scopes.map((key) => {
      const b = state.buckets[key] || emptyBucket();
      if (b.lastRefusalAt < now - REFUSAL_MEMORY_MS) b.refusals = 0;
      b.refusals += 1;
      b.lastRefusalAt = now;
      return { key, b };
    });
    const until = sig.deadlineMs !== null ? sig.deadlineMs : now + fullJitter(Math.max(...buckets.map((x) => x.b.refusals)));
    let notBefore = 0;
    for (const { key, b } of buckets) {
      b.notBefore = Math.max(b.notBefore, until);
      b.recovery = { since: b.notBefore };
      b.updatedAt = now;
      state.buckets[key] = b;
      notBefore = Math.max(notBefore, b.notBefore);
    }
    await writeBook(file, state);
    return { notBefore, scopes, serverDeadline: sig.deadlineMs !== null };
  });
}

/** An advertised limit: paced from now on (the stricter pace wins); an exhausted quota sets notBefore to its reset. */
export async function noteAdvertisedLimit(sig: Advertised): Promise<void> {
  const file = process.env.PW_RATE_LIMIT_STATE;
  if (!file) return;
  const key = sig.service ? serviceBucket(sig.service, sig.account) : endpointKey(sig.method + ' ' + sig.path);
  await withLock(file, async () => {
    const now = Date.now();
    const state = readBook(file);
    const b = state.buckets[key] || emptyBucket();
    let changed = false;
    if (sig.limit !== null && sig.limit > 0) {
      const pace = sig.limit > 1 ? sig.limit - 1 : 1;
      const windowMs = sig.windowMs ?? (b.advertised ? b.advertised.windowMs : null);
      if (!b.advertised || b.advertised.pace !== pace || b.advertised.windowMs !== windowMs) { b.advertised = { pace, windowMs, at: now }; changed = true; }
      else b.advertised.at = now;
    }
    if (sig.remaining !== null && sig.remaining <= 0 && sig.resetAtMs !== null && sig.resetAtMs > b.notBefore) { b.notBefore = sig.resetAtMs; changed = true; }
    if (changed) { b.updatedAt = now; state.buckets[key] = b; await writeBook(file, state); }
  });
}

/* ---------------- records ---------------- */

function record(rec: Record<string, unknown>, info?: TestInfo): void {
  const file = process.env.PW_RATE_LIMIT_FILE;
  if (!file) return;
  let ti = info;
  if (!ti) { try { ti = test.info(); } catch { ti = undefined; } }
  const base = { at: new Date().toISOString(), worker: ti ? ti.parallelIndex : null, tc: ti ? tcIdsOf(ti.title) : [], step: currentStepTitle() };
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ ...base, ...rec }) + '\n'); } catch { /* evidence only — never fails a test */ }
}
const iso = (ms: number): string => new Date(ms).toISOString();
const attemptKey = (info: TestInfo): string => ((info as unknown as { testId?: string }).testId ?? info.title) + ':' + info.retry + ':' + info.repeatEachIndex;

/* ---------------- the two entry points of the tests ---------------- */

/**
 * Reserve this test's start-of-test slots (login) before its side effects — from the admission fixture
 * (`{ extendBudget: false }`: the fixture has its own timeout) or the network guard's beforeEach (the test budget is
 * extended by the wait). Once per test attempt; the second caller returns at once. A slot further away than
 * TIMEOUTS.rate_limit.max_start_wait DEFERS the test (skipped + `rate-limit-deferred` annotation).
 */
export async function reserveStartSlots(testInfo: TestInfo, opts: { extendBudget?: boolean } = {}): Promise<void> {
  if (!process.env.PW_RATE_LIMIT_STATE) return;
  const rt = qaRuntime();
  if (!rt.reserved) rt.reserved = {};
  const key = attemptKey(testInfo);
  if (rt.reserved[key]) return;
  rt.reserved[key] = true;
  const tcs = tcIdsOf(testInfo.title);
  for (const [service, l] of Object.entries(limits())) {
    if (!l || l.at !== 'start') continue;
    const per = l.calls_per_tc;
    const calls = typeof per === 'number' ? per : per && typeof per === 'object' ? Math.max(...tcs.map((tc) => Number(per[tc]) || 0), Number(per['default']) || 1) : 1;
    const b = await book(scopesFor(service, currentAccountId(), null), Math.max(1, calls), TIMEOUTS.rate_limit.max_start_wait);
    if (!b.booked) {
      const until = iso(b.at);
      const scope = b.scope ?? 'service:' + service;
      record({ kind: 'paced', service, scope, wait_ms: b.wait, outcome: 'deferred', until }, testInfo);
      heartbeat({ worker: testInfo.parallelIndex, tc: tcs.join(',') || testInfo.title, event: 'deferred', until, scope });
      testInfo.annotations.push({ type: 'rate-limit-deferred', description: until });
      testInfo.skip(true, `rate limit: deferred until ${until} (${scope}) — not started, never a failure`);
      return;
    }
    if (b.wait > 0) {
      if (opts.extendBudget !== false && testInfo.timeout > 0) testInfo.setTimeout(testInfo.timeout + b.wait);
      record({ kind: 'paced', service, scope: b.scope, wait_ms: b.wait, outcome: 'waited' }, testInfo);
      await pause(b.wait, service);
    }
  }
}

/**
 * Inside a step, right before the action that triggers a limited call: wait for its slot, at most
 * TIMEOUTS.rate_limit.in_step_wait. `key` names the account for an account-scoped limit (default: the account the test
 * resolved); `endpoint` ("POST /api/search") adds the endpoint's own bucket. A service with no configured limit still
 * waits for every broader restriction in force (its service, account and environment cool-downs).
 */
export async function rateLimitSlot(service: string, opts: { key?: string; maxWaitMs?: number; endpoint?: string } = {}): Promise<void> {
  if (!process.env.PW_RATE_LIMIT_STATE) return;
  const maxWait = opts.maxWaitMs ?? TIMEOUTS.rate_limit.in_step_wait;
  const b = await book(scopesFor(service, opts.key ?? currentAccountId(), opts.endpoint ?? null), 1, maxWait);
  if (!b.booked) {
    record({ kind: 'paced', service, scope: b.scope, wait_ms: b.wait, outcome: 'exceeded', until: iso(b.at) });
    throw new RateLimitWaitError(service, b.wait, maxWait, iso(b.at));
  }
  if (b.wait > 0) {
    record({ kind: 'paced', service, scope: b.scope, wait_ms: b.wait, outcome: 'waited' });
    await pause(b.wait, service);
  }
}
