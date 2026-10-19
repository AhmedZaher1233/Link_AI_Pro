// helpers/rate-limit.ts — pace the calls the application rate-limits, not the tests (skill 5,
// references/run-plan-and-config.md <run_plan> "Rate limits", references/code-craft.md §9).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/rate-limit.ts when absent —
// ALWAYS installed; without PW_RATE_LIMITS it does nothing. The pace per service comes from the run
// plan's rate_limits[] (run-stage.mjs passes it as PW_RATE_LIMITS), so learning a limit changes the run
// plan, never this code:
//
//   PW_RATE_LIMITS = {"login":{"match":"POST /api/session","limit":5,"window_s":60,"pace":4,"scope":"machine","at":"start","calls_per_tc":{"default":1,"TC-07":2}}}
//
// - Start-of-test services (`at: "start"`, e.g. login — every test signs in through the UI): the
//   network guard's beforeEach calls reserveStartSlots(testInfo) BEFORE any step opens. Tests stay
//   parallel; only a test whose slot is not free yet waits, and its budget is extended by the wait.
//   No open step → the watchdog never reads the wait as a freeze.
// - Mid-test services (`at: "step"`): `await rateLimitSlot('search')` in the page-object method right
//   before the triggering action. It waits at most TIMEOUTS.rate_limit.in_step_wait (it must fit the
//   step deadline) and otherwise throws RateLimitWaitError — the runner reports the TC `rate_limited`
//   (no verdict), never a failure of the application.
// - All workers share one sliding window per service in PW_RATE_LIMIT_STATE: a future slot is booked
//   under a short mkdir lock, the wait happens OUTSIDE the lock, a stale lock is broken. scope
//   "account" with a key paces per account; without a key it paces machine-wide (stricter, still safe).
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, type TestInfo } from '@playwright/test';
import { TIMEOUTS } from '../timeouts';
import { tcIdsOf } from './steps';

type Limit = { match?: string | null; limit?: number | null; window_s?: number | null; pace?: number | null; scope?: string | null; at?: string | null; calls_per_tc?: number | Record<string, number> | null };

const LOCK_STALE_MS = 10_000;
const LOCK_GIVE_UP_MS = 5_000;

export class RateLimitWaitError extends Error {
  constructor(readonly service: string, readonly waitMs: number, readonly maxMs: number) {
    super(`RateLimitWaitError: the next ${service} slot is ${Math.round(waitMs / 1000)} s away (limit ${Math.round(maxMs / 1000)} s) — the application's rate limit, not a defect`);
    this.name = 'RateLimitWaitError';
  }
}

function limits(): Record<string, Limit> {
  try { return JSON.parse(process.env.PW_RATE_LIMITS || '{}') || {}; } catch { return {}; }
}
const paceOf = (l: Limit): number => (Number(l.pace) > 0 ? Number(l.pace) : Number(l.limit) > 1 ? Number(l.limit) - 1 : Number(l.limit) || 0);
const windowOf = (l: Limit): number => (Number(l.window_s) > 0 ? Number(l.window_s) * 1000 : 0);
const pause = (ms: number) => new Promise<void>((resolve) => {
  // deliberate timer: rate-limit pacing — the wait IS the throttle the application's limit requires (TIMEOUTS.rate_limit)
  setTimeout(resolve, ms);
});

function record(rec: Record<string, unknown>): void {
  const file = process.env.PW_RATE_LIMIT_FILE;
  if (!file) return;
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...rec }) + '\n'); } catch { /* evidence only — never fails a test */ }
}

async function withLock<T>(fn: () => T): Promise<T> {
  const state = process.env.PW_RATE_LIMIT_STATE as string;
  const lock = state + '.lock';
  mkdirSync(dirname(state), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true }); } catch { /* raced with its owner */ }
      if (Date.now() - t0 > LOCK_GIVE_UP_MS) throw new Error('rate-limit state lock stayed busy for ' + LOCK_GIVE_UP_MS / 1000 + ' s');
      // deliberate timer: a lock back-off of a few milliseconds, never a wait for the application
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try { return fn(); } finally { try { rmSync(lock, { recursive: true, force: true }); } catch { /* the next taker breaks it as stale */ } }
}

// book `count` slots in FIFO order: each slot at the earliest time when fewer than `pace` slots fall in the window before it
async function book(bucket: string, pace: number, windowMs: number, count: number, maxWaitMs: number): Promise<number> {
  return withLock(() => {
    const file = process.env.PW_RATE_LIMIT_STATE as string;
    let state: Record<string, number[]> = {};
    try { state = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* first booking of the phase */ }
    const now = Date.now();
    const slots = (state[bucket] || []).filter((t) => t > now - windowMs - 1000).sort((x, y) => x - y);
    const booked: number[] = [];
    let t = now;
    for (let i = 0; i < count; i++) {
      t = Math.max(t, slots.length ? slots[slots.length - 1] : now);
      const inWindow = slots.filter((s) => s > t - windowMs && s <= t);
      if (inWindow.length >= pace) t = inWindow[inWindow.length - pace] + windowMs;
      slots.push(t);
      booked.push(t);
    }
    const wait = Math.max(0, booked[booked.length - 1] - now);
    if (wait > maxWaitMs) return -wait;          // not booked: the caller reports rate_limited
    state[bucket] = slots;
    writeFileSync(file, JSON.stringify(state));
    return wait;
  });
}

/** beforeEach (through the network guard): reserve this test's start-of-test slots (login) before any step opens. */
export async function reserveStartSlots(testInfo: TestInfo): Promise<void> {
  if (!process.env.PW_RATE_LIMIT_STATE) return;
  const tcs = tcIdsOf(testInfo.title);
  for (const [service, l] of Object.entries(limits())) {
    if (l.at !== 'start') continue;
    const pace = paceOf(l), windowMs = windowOf(l);
    if (!(pace > 0) || !(windowMs > 0)) continue;
    const per = l.calls_per_tc;
    const calls = typeof per === 'number' ? per : per && typeof per === 'object' ? Math.max(...tcs.map((tc) => Number(per[tc]) || 0), Number(per.default) || 1) : 1;
    const wait = await book(service, pace, windowMs, Math.max(1, calls), TIMEOUTS.rate_limit.max_start_wait);
    if (wait < 0) { record({ kind: 'paced', service, tc: tcs, wait_ms: -wait, outcome: 'exceeded' }); throw new RateLimitWaitError(service, -wait, TIMEOUTS.rate_limit.max_start_wait); }
    if (wait > 0) {
      if (testInfo.timeout > 0) testInfo.setTimeout(testInfo.timeout + wait);
      record({ kind: 'paced', service, tc: tcs, wait_ms: wait, outcome: 'waited' });
      await pause(wait);
    }
  }
}

/** Inside a step: wait for a slot of a mid-test limited service, at most TIMEOUTS.rate_limit.in_step_wait. */
export async function rateLimitSlot(service: string, opts: { key?: string; maxWaitMs?: number } = {}): Promise<void> {
  if (!process.env.PW_RATE_LIMIT_STATE) return;
  const l = limits()[service];
  if (!l) return;
  const pace = paceOf(l), windowMs = windowOf(l);
  if (!(pace > 0) || !(windowMs > 0)) return;
  const bucket = service + (l.scope === 'account' && opts.key ? ':' + opts.key : '');
  const maxWait = opts.maxWaitMs ?? TIMEOUTS.rate_limit.in_step_wait;
  const wait = await book(bucket, pace, windowMs, 1, maxWait);
  const tcs = tcIdsOf(test.info().title);
  if (wait < 0) { record({ kind: 'paced', service, tc: tcs, wait_ms: -wait, outcome: 'exceeded' }); throw new RateLimitWaitError(service, -wait, maxWait); }
  if (wait > 0) { record({ kind: 'paced', service, tc: tcs, wait_ms: wait, outcome: 'waited' }); await pause(wait); }
}
