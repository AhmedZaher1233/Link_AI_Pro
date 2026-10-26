// helpers/admission.ts — admission fixtures: no new unit of work starts its side effects while the runner says "wait"
// (skill 5, references/run-plan-and-config.md <shared_config>, references/code-craft.md §6, §9).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/admission.ts — ALWAYS installed; without
// PW_ADMISSION_FILE every fixture here is inert (it admits at once and records nothing).
//
// The runner (scripts/run-stage.mjs) publishes the stage's admission state — host pressure, a scoped rate-limit
// cool-down, an environment-lease problem — to PW_ADMISSION_FILE within a second of detecting it (temp + rename):
//   { schema: 'skill5-admission/1', runId, seq, updatedAt, state: 'open' | 'paused', reason, cooldowns: [{ scope, until }], maxWaitMs }
// and tells every command which scopes and which execution unit each TC belongs to:
//   PW_UNIT_SCOPES = {"TC-01": ["service:login", "account:A1"]}      PW_UNIT_MAP = {"TC-01": "u3", "TC-02": "u3"}
// Scopes are `service:{name}` · `account:{A-ID}` · `endpoint:{METHOD path}` · `environment` (a cool-down on
// `environment` holds every test).
//
// Two AUTOMATIC fixtures. Playwright runs worker fixtures → beforeAll (and the worker fixtures it requests) → test
// fixtures → beforeEach → the test, and guarantees "B before A" only when A DEPENDS on B — hence the contract below.
//   workerAdmission  worker-scoped, NO dependencies: set up when a worker starts, before any beforeAll. It waits while the
//                    state is paused (or an `environment` cool-down runs). If that wait times out (or the stage stops) it
//                    THROWS `AdmissionRefusedError` and never hands itself over: Playwright then runs none of the worker
//                    fixtures and beforeAll hooks that depend on it (no seeding, no shared login) and reports the test
//                    with that error, which run-stage.mjs maps to NOT_RUN `not started: admission timeout (…)` — never a
//                    FAIL. The refusal is noted beside the state file (`{PW_ADMISSION_FILE}.refused`, the state's seq), so
//                    the worker Playwright starts next for the remaining tests is refused at once while the same state
//                    still holds, instead of waiting the whole bound again.
//   unitAdmission    test-scoped: admits the test's EXECUTION UNIT before any of its side-effecting fixtures. A single test
//                    (U1 — a unit id with one TC, or no PW_UNIT_MAP entry) is admitted on its own, every execution. The
//                    tests of a serial chain or a shared-hook describe (U2 / U3 — several TCs under one unit id) are
//                    admitted ONCE per worker and repeat, at the unit's first test; the rest of the unit then runs to
//                    completion under that permit — pressure arriving mid-unit never splits it. After admission it
//                    reserves the test's start-of-test rate-limit slots (helpers/rate-limit.ts — a slot that cannot be had
//                    in time DEFERS the test), so the network guard's own reservation in beforeEach becomes a no-op.
//   Without PW_UNIT_MAP every test is admitted on its own (the safe reading of an unknown unit).
//
// THE CONTRACT — checked by the validator rule `admission-contract`; a unit that breaks it is run as one indivisible
// unit per command, admitted when the command is spawned (U4):
//   - the project's fixtures file extends THIS `test`:  `import { test as base } from '../helpers/admission';
//     export const test = base.extend<…>({ … });` — and every spec imports `test` / `expect` from that fixtures file (or
//     from helpers/admission.ts when the project has no fixture layer);
//   - every side-effecting WORKER fixture (seeding, shared records, accounts) lists `workerAdmission` among its
//     dependencies:  `seed: [async ({ workerAdmission, request }, use) => { … }, { scope: 'worker' }]`;
//   - every side-effecting TEST fixture (login, data creation, a prerequest/ wrapper) lists `unitAdmission`:
//     `order: async ({ unitAdmission, request }, use) => { … }`;
//   - every side-effecting beforeAll takes `workerAdmission` as a parameter:
//     `test.beforeAll(async ({ workerAdmission, browser }) => { … })`.
//
// Waiting: while the state is `paused`, or a cool-down whose scope the test touches is still running, the fixture polls
// the file every second, bounded by min(TIMEOUTS.admission.max_wait, maxWaitMs). The wait never eats the test budget (each
// fixture has its own timeout). Heartbeats (PW_PROGRESS_FILE, through helpers/steps.ts):
//   { at, worker, tc, event: 'admission-wait', phase: 'start', reason, unit, budget_ms }
//   { at, worker, tc, event: 'admission-wait', phase: 'end', reason, unit, waited_ms, outcome: 'admitted' | 'timeout' | 'cancelled' }
// (`tc` is '' for a worker's own wait.) A unit's timeout SKIPS the test with the annotation `admission-timeout`
// (description = the reason); a worker's timeout throws `AdmissionRefusedError` (above). Both are reported `not started:
// admission timeout ({reason})` — never a failure. An unreadable state file
// keeps the last state read; a missing one reads as open. The runner's cancel flag (PW_CANCEL_FILE) ends a wait at once.
import { test as base, expect, type TestInfo } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { TIMEOUTS } from '../timeouts';
import { heartbeat, tcIdsOf } from './steps';
import { reserveStartSlots } from './rate-limit';

type Cooldown = { scope?: string; until?: string };
type AdmissionState = { schema?: string; runId?: string; seq?: number; updatedAt?: string; state?: string; reason?: string | null; cooldowns?: Cooldown[]; maxWaitMs?: number };

/** What workerAdmission hands to unitAdmission (and to a beforeAll that lists it). */
export type WorkerAdmission = {
  /** False without PW_ADMISSION_FILE: nothing here waits. */
  readonly enabled: boolean;
  /** Always null now (a refused worker throws AdmissionRefusedError); kept for fixtures written against older helpers. */
  timedOut: string | null;
  /** Units already admitted in this worker (U2 / U3 run to completion under their permit). */
  readonly admittedUnits: Set<string>;
  /** How long the worker waited before its first unit. */
  waitedMs: number;
};

const OPTIONAL = TIMEOUTS as unknown as { admission?: { max_wait?: number }; rate_limit?: { max_start_wait?: number } };
/** TIMEOUTS.admission.max_wait, or 10 minutes while an older timeouts.ts has no `admission` key. */
export const ADMISSION_MAX_WAIT_MS: number = Number(OPTIONAL.admission?.max_wait) > 0 ? Number(OPTIONAL.admission?.max_wait) : 600_000;
const START_SLOT_WAIT_MS: number = Number(OPTIONAL.rate_limit?.max_start_wait) > 0 ? Number(OPTIONAL.rate_limit?.max_start_wait) : 120_000;
/** Each fixture's own timeout: its longest wait plus room for Playwright to set it up. */
const SETUP_ROOM_MS: number = TIMEOUTS.hook;
const POLL_MS = 1_000;

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    // deliberate timer: admission polling — the fixture waits for the runner's open signal, bounded by TIMEOUTS.admission.max_wait
    setTimeout(resolve, Math.max(0, ms));
  });
}

function cancelled(): boolean {
  const flag = process.env.PW_CANCEL_FILE;
  if (!flag) return false;
  try { return existsSync(flag); } catch { return false; }
}

/** The published state: `missing` = no file (reads as open); `state` null = unreadable right now (keep the last one). */
function readState(file: string): { missing: boolean; state: AdmissionState | null } {
  if (!existsSync(file)) return { missing: true, state: null };
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return { missing: false, state: v && typeof v === 'object' ? (v as AdmissionState) : null };
  } catch { return { missing: false, state: null }; }
}

function blockReason(st: AdmissionState | null, scopes: string[], now: number): string | null {
  if (!st) return null;
  if (st.state === 'paused') return st.reason || 'paused by the runner';
  for (const c of st.cooldowns || []) {
    if (!c || !c.scope || !c.until) continue;
    const until = Date.parse(c.until);
    if (!(until > now)) continue;
    if (c.scope === 'environment' || scopes.includes(c.scope)) return 'cool-down ' + c.scope + ' until ' + c.until;
  }
  return null;
}

let scopeMap: Record<string, string[]> | null = null;
let unitMap: Record<string, string> | null = null;
function parsed<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? (v as T) : fallback; } catch { return fallback; }
}
function scopesOf(tcs: string[]): string[] {
  if (!scopeMap) scopeMap = parsed<Record<string, string[]>>(process.env.PW_UNIT_SCOPES, {});
  const map = scopeMap;
  return [...new Set(tcs.flatMap((tc) => (Array.isArray(map[tc]) ? map[tc].filter((s) => typeof s === 'string') : [])))];
}
function unitOf(tcs: string[]): { id: string; size: number } | null {
  if (!unitMap) unitMap = parsed<Record<string, string>>(process.env.PW_UNIT_MAP, {});
  const map = unitMap;
  const id = tcs.map((tc) => map[tc]).find((u): u is string => typeof u === 'string' && u.length > 0);
  if (!id) return null;
  return { id, size: Object.values(map).filter((u) => u === id).length };
}

type Admitted = { admitted: boolean; reason: string | null; waitedMs: number };

/** Wait (bounded) until nothing holds this work back. */
async function admit(file: string, scopes: string[], who: { worker: number; tc: string; unit: string | null }): Promise<Admitted> {
  const t0 = Date.now();
  const first = readState(file);
  let last: AdmissionState | null = first.missing ? null : first.state;
  let reason = blockReason(last, scopes, t0);
  if (!reason) return { admitted: true, reason: null, waitedMs: 0 };
  // budget_ms: the watchdog never reads an admission wait as a UI stall, and stops it only past this budget + grace
  const budget = Math.min(ADMISSION_MAX_WAIT_MS, last && Number(last.maxWaitMs) > 0 ? Number(last.maxWaitMs) : ADMISSION_MAX_WAIT_MS);
  heartbeat({ worker: who.worker, tc: who.tc, event: 'admission-wait', phase: 'start', reason, unit: who.unit, budget_ms: budget });
  const end = (outcome: 'admitted' | 'timeout' | 'cancelled'): Admitted => {
    const waited = Date.now() - t0;
    heartbeat({ worker: who.worker, tc: who.tc, event: 'admission-wait', phase: 'end', reason, unit: who.unit, waited_ms: waited, outcome });
    return { admitted: outcome === 'admitted', reason: outcome === 'cancelled' ? 'the stage stopped' : reason, waitedMs: waited };
  };
  for (;;) {
    const limit = Math.min(ADMISSION_MAX_WAIT_MS, last && Number(last.maxWaitMs) > 0 ? Number(last.maxWaitMs) : ADMISSION_MAX_WAIT_MS);
    if (cancelled()) return end('cancelled');
    if (Date.now() - t0 >= limit) return end('timeout');
    await delay(Math.min(POLL_MS, Math.max(0, limit - (Date.now() - t0))));
    const next = readState(file);
    if (next.missing) last = null;
    else if (next.state) last = next.state;
    const still = blockReason(last, scopes, Date.now());
    if (!still) return end('admitted');
    reason = still;
  }
}

function notStarted(testInfo: TestInfo, reason: string): void {
  testInfo.annotations.push({ type: 'admission-timeout', description: reason });
  testInfo.skip(true, 'admission timeout (' + reason + ') — not started, never a failure');
}

/** A worker that was not admitted: thrown INSTEAD of handing workerAdmission over, so no fixture or beforeAll that depends on
 *  it runs. run-stage.mjs reads the message (`AdmissionRefusedError: admission timeout ({reason})`) as NOT_RUN. */
export class AdmissionRefusedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super('AdmissionRefusedError: admission timeout (' + reason + ') — not started, no worker setup ran');
    this.name = 'AdmissionRefusedError';
    this.reason = reason;
  }
}

/** The previous worker's refusal under the SAME published state (seq), or null. */
function priorRefusal(file: string): string | null {
  try {
    const r = JSON.parse(readFileSync(file + '.refused', 'utf8')) as { seq?: number; reason?: string };
    const now = readState(file);
    if (!now.state || now.state.seq !== r.seq || !blockReason(now.state, [], Date.now())) return null;
    return r.reason || 'admission timeout';
  } catch { return null; }
}

export const test = base.extend<{ unitAdmission: void }, { workerAdmission: WorkerAdmission }>({
  workerAdmission: [async ({}, use, workerInfo) => {
    const file = process.env.PW_ADMISSION_FILE;
    const wa: WorkerAdmission = { enabled: !!file, timedOut: null, admittedUnits: new Set<string>(), waitedMs: 0 };
    if (file) {
      const prior = priorRefusal(file);
      if (prior) throw new AdmissionRefusedError(prior);
      const r = await admit(file, [], { worker: workerInfo.parallelIndex, tc: '', unit: null });
      wa.waitedMs = r.waitedMs;
      if (!r.admitted) {
        const reason = r.reason || 'admission timeout';
        const st = readState(file).state;
        try { writeFileSync(file + '.refused', JSON.stringify({ seq: st ? st.seq ?? null : null, reason, at: new Date().toISOString() })); } catch { /* the next worker waits again — slower, still safe */ }
        // never `use(wa)`: the worker fixtures and beforeAll hooks that list workerAdmission do not run
        throw new AdmissionRefusedError(reason);
      }
    }
    await use(wa);
  }, { scope: 'worker', auto: true, timeout: ADMISSION_MAX_WAIT_MS + SETUP_ROOM_MS }],

  unitAdmission: [async ({ workerAdmission }, use, testInfo) => {
    const file = process.env.PW_ADMISSION_FILE;
    if (file && workerAdmission.enabled) {
      if (workerAdmission.timedOut) notStarted(testInfo, workerAdmission.timedOut);
      const tcs = tcIdsOf(testInfo.title);
      const unit = unitOf(tcs);
      // a unit of several tests (U2 / U3) is admitted once per worker and repeat; a single test every execution
      const key = unit && unit.size > 1 ? unit.id + ':e' + testInfo.repeatEachIndex + ':r' + testInfo.retry : null;
      if (!key || !workerAdmission.admittedUnits.has(key)) {
        const r = await admit(file, scopesOf(tcs), { worker: testInfo.parallelIndex, tc: tcs.join(',') || testInfo.title, unit: unit ? unit.id : null });
        if (!r.admitted) notStarted(testInfo, r.reason || 'admission timeout');
        if (key) workerAdmission.admittedUnits.add(key);
      }
    }
    // the start-of-test rate-limit slots (login) are reserved here, before this test's side effects
    await reserveStartSlots(testInfo, { extendBudget: false });
    await use();
  }, { auto: true, timeout: ADMISSION_MAX_WAIT_MS + START_SLOT_WAIT_MS + SETUP_ROOM_MS }],
});

export { expect };
