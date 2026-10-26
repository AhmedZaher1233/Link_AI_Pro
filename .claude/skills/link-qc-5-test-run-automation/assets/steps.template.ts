// helpers/steps.ts — named steps with a deadline the helper OWNS, the stall detector, and the runtime registry the
// other helpers share (skill 5, references/code-craft.md §5, §9).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/steps.ts when absent.
//
//   await step('save the order', async (report) => { … }, { deadline: TIMEOUTS.step.default, expects: 'the success toast is visible' });
//
// - One step() per manual TC step. The title is the manual step's wording.
// - The deadline is enforced HERE on every supported Playwright version (a race against a timer);
//   on Playwright ≥ 1.50 it is also passed to test.step({ timeout }) so the native report shows it.
// - On timeout: a StepTimeoutError naming the TC, the step, the elapsed time and the expected
//   condition; the heartbeat records `end: timeout`; the still-pending body promise is swallowed so
//   its late rejection (when Playwright closes the page) never surfaces as an unhandled rejection.
//   Playwright then closes the page (aborting the pending action) and runs afterEach / fixture
//   teardown inside their separate budget before this worker takes its next test.
// - The deadline is FIXED from the step's start: nothing extends it. A known long operation is a named exception:
//   step(title, body, { operation: 'report_export' }) takes its deadline (and, for an object entry, its silence)
//   from TIMEOUTS.operations — the start heartbeat then carries `silence_ms` for the watchdog.
// - report(note, { done, total } | { milestone }) inside a long operation writes a `progress` heartbeat marked
//   `meaningful` when the counter rose (same total) or the milestone is new in this step — only that resets the
//   silence clock. A changed message, a timestamp, repeated polling or the same counter again is recorded with
//   `meaningful: false`; a legacy report('rows 40/100') counts only while its n/m counter rises.
// - STALL DETECTOR: a step whose deadline is longer than its silence limit (TIMEOUTS.stall.silence, or the operation's)
//   and that shows no meaningful progress that long (still open; a nested step starting / ending counts as activity,
//   informational heartbeats never do) gets ONE diagnostics snapshot, bounded by TIMEOUTS.diagnostics — a screenshot, the ARIA snapshot (Playwright ≥ 1.49), the
//   application requests still in flight (from helpers/network-guard.ts) and the worker's last heartbeat records —
//   written to PW_DIAGNOSTICS_DIR, and ONE `stall` heartbeat:
//     { at, worker, tc, step, event: 'stall', silence_ms, classification: 'app_slow' | 'ui_blocked' | 'no_activity', diagnostics: <json path> | null }
//   app_slow = application requests still in flight · ui_blocked = a busy indicator / modal backdrop visible and nothing
//   in flight · no_activity = neither (typically an action waiting for an element that never appears). The detector only
//   observes: it never stops the step (the deadline and the watchdog do) and never fails a test. Credential-looking
//   lines are withheld from the snapshot and the records.
// - currentStep() / registerPage(page): a per-worker registry shared through globalThis (so an older copy of a sibling
//   helper can never break the import graph): the open step for the network guard's request records, the page and the
//   in-flight request list for the stall diagnostics. The guards register the page in beforeEach; a fixture that drives
//   a page the guards never see may call registerPage itself.
// - Every record goes to process.env.PW_PROGRESS_FILE (set per stage command by the skill). With
//   no file set the helper is silent; it never fails a test over the heartbeat.
import { test, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TIMEOUTS } from '../timeouts';

export type StepOptions = {
  /** Milliseconds this step may take. Default TIMEOUTS.step.default; use a TIMEOUTS.operations.* key for a known long operation. */
  deadline?: number;
  /** A named TIMEOUTS.operations entry: its deadline (unless `deadline` is given) and, for an object entry, its silence. */
  operation?: string;
  /** The manual step's expected condition, carried into the timeout record and the freeze report. */
  expects?: string;
};
/** Structured progress: a counter that rose (same total) or a new milestone is MEANINGFUL; text alone is not. */
export type Progress = { done?: number; total?: number; milestone?: string };
export type Report = (note: string, progress?: Progress) => void;
/** The step currently open in this worker (the innermost one when steps nest). */
export type CurrentStep = { title: string; tc: string; worker: number; startedAt: number; deadline: number };

export class StepTimeoutError extends Error {
  constructor(readonly tc: string, readonly step: string, readonly elapsedMs: number, readonly deadlineMs: number, readonly expects?: string) {
    super(`[${tc}] step "${step}" did not complete within ${Math.round(deadlineMs / 1000)} s (elapsed ${Math.round(elapsedMs / 1000)} s)` + (expects ? `; expected: ${expects}` : ''));
    this.name = 'StepTimeoutError';
  }
}

/** Playwright ≥ 1.50 accepts test.step(title, body, { timeout }). Detected once; never guessed. */
const NATIVE_STEP_TIMEOUT: boolean = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const v = String(require('@playwright/test/package.json').version).split('.').map(Number);
    return v[0] > 1 || (v[0] === 1 && v[1] >= 50);
  } catch { return false; }
})();

/* ---------------- the runtime registry shared by the helpers (one per worker process) ---------------- */

type OpenStep = CurrentStep & { testId: string | null };
type QaRuntime = {
  steps?: OpenStep[];
  page?: Page | null;
  inFlight?: (() => string[]) | null;
};
const RUNTIME_KEY = '__linkQcRuntime';
function runtime(): QaRuntime {
  const g = globalThis as unknown as Record<string, QaRuntime | undefined>;
  if (!g[RUNTIME_KEY]) g[RUNTIME_KEY] = {};
  return g[RUNTIME_KEY] as QaRuntime;
}
function currentTestId(): string | null {
  try { return (test.info() as unknown as { testId?: string }).testId ?? null; } catch { return null; }
}

/** The step open right now in this worker's current test, or null (outside a step, or a step a finished test left behind). */
export function currentStep(): CurrentStep | null {
  const stack = runtime().steps || [];
  const id = currentTestId();
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (id === null || s.testId === null || s.testId === id) return { title: s.title, tc: s.tc, worker: s.worker, startedAt: s.startedAt, deadline: s.deadline };
  }
  return null;
}

/** The page the stall diagnostics look at — registered by the guards in beforeEach. */
export function registerPage(page: Page): void {
  runtime().page = page;
}

function pushStep(entry: OpenStep): void {
  const rt = runtime();
  // a step another test left open (its body never settled after a timeout) is dropped here
  rt.steps = (rt.steps || []).filter((s) => entry.testId === null || s.testId === entry.testId);
  rt.steps.push(entry);
}
function popStep(entry: OpenStep): void {
  const rt = runtime();
  rt.steps = (rt.steps || []).filter((s) => s !== entry);
}

/* ---------------- heartbeat ---------------- */

export function tcIdsOf(title: string): string[] {
  return [...title.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter((x) => /^TC-/.test(x));
}

/** Time of the newest step start / end in this worker — a nested step is activity of its parent for the stall detector.
 *  Informational heartbeats (admission, guards, stall, teardown) never move it. */
let lastStepEventAt = 0;

export function heartbeat(record: Record<string, unknown>): void {
  const file = process.env.PW_PROGRESS_FILE;
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  } catch { /* the heartbeat never fails a test */ }
}

/* ---------------- stall detector (observe only) ---------------- */

type Operation = number | { deadline: number; silence?: number; reason?: string };
const OPTIONAL = TIMEOUTS as unknown as { stall?: { silence?: number }; diagnostics?: number; operations?: Record<string, Operation> };
/** TIMEOUTS.stall.silence, or min(3 × max(action, navigation, expect), 55 s) while an older timeouts.ts has no `stall` key. */
const SLOWEST_SINGLE = Math.max(TIMEOUTS.action, TIMEOUTS.navigation, TIMEOUTS.expect);
const STALL_SILENCE_MS: number = Number(OPTIONAL.stall?.silence) > 0
  ? Number(OPTIONAL.stall?.silence)
  : Math.max(SLOWEST_SINGLE, Math.min(3 * SLOWEST_SINGLE, 55_000));
/** The whole diagnostics capture is bounded (TIMEOUTS.diagnostics, default 30 s); each probe gets at most a third of it. */
const DIAGNOSTICS_MS: number = Number(OPTIONAL.diagnostics) > 0 ? Number(OPTIONAL.diagnostics) : 30_000;
const PROBE_MS: number = Math.min(TIMEOUTS.expect, Math.floor(DIAGNOSTICS_MS / 3));
/** Generic busy indicators and modal backdrops — a heuristic for the classification, never a verdict. */
const BUSY_SELECTOR = [
  '[aria-busy="true"]', '[role="progressbar"]', '[role="dialog"][aria-modal="true"]', '.cdk-overlay-backdrop-showing',
  '.modal-backdrop.show', '.loader', '.loading', '.spinner', 'mat-spinner', 'mat-progress-spinner', 'mat-progress-bar',
].join(', ');
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;
const SECRET_NAME = /(password|passwd|passcode|secret|token|api[-_]?key|\bpin\b)/i;

function redact(line: string): string {
  if (SECRET_LINE.test(line)) return '[line withheld: it looks like a credential]';
  const at = line.search(SECRET_NAME);
  if (at >= 0) {
    const colon = line.indexOf(':', at);
    if (colon >= 0) return line.slice(0, colon + 1) + ' [withheld]';
  }
  return line;
}

/** Run `fn` once after `ms` without keeping the worker alive; returns the handle for clearTimeout. */
function later(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
  // deliberate timer: the stall detector's silence threshold (TIMEOUTS.stall.silence) — observation only, never a wait for the application
  const handle = setTimeout(fn, Math.max(0, ms));
  (handle as unknown as { unref?: () => void }).unref?.();
  return handle;
}

/** `p`, or `fallback` when it rejects or takes longer than `ms` (one probe: PROBE_MS). */
function bounded<T>(p: Promise<T>, fallback: T, ms: number = PROBE_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    const guard = later(ms, () => resolve(fallback));
    p.then((v) => { clearTimeout(guard); resolve(v); }, () => { clearTimeout(guard); resolve(fallback); });
  });
}

async function ariaOf(page: Page): Promise<string | null> {
  try {
    const body = page.locator('body') as unknown as { ariaSnapshot?: (o?: { timeout?: number }) => Promise<string> };
    let text: string | null = null;
    if (typeof body.ariaSnapshot === 'function') text = await bounded(body.ariaSnapshot({ timeout: PROBE_MS }), null as string | null);
    else {
      const acc = (page as unknown as { accessibility?: { snapshot?: () => Promise<unknown> } }).accessibility;
      if (acc && typeof acc.snapshot === 'function') {
        const tree = await bounded(acc.snapshot(), null as unknown);
        text = tree ? JSON.stringify(tree, null, 1) : null;
      }
    }
    return text === null ? null : text.split(/\r?\n/).map(redact).join('\n').slice(0, 20_000);
  } catch { return null; }
}

function lastRecords(worker: number): string[] {
  const file = process.env.PW_PROGRESS_FILE;
  if (!file) return [];
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).slice(-400);
    const mine = lines.filter((l) => { try { return (JSON.parse(l) as { worker?: unknown }).worker === worker; } catch { return false; } });
    return mine.slice(-20).map(redact);
  } catch { return []; }
}

// the capture as a whole never outlives TIMEOUTS.diagnostics: past it the `stall` heartbeat is written without a file
async function stallDiagnostics(s: { worker: number; tc: string; step: string; silenceMs: number }): Promise<void> {
  const r = await bounded<{ classification: string; file: string | null } | null>(captureDiagnostics(s), null, DIAGNOSTICS_MS);
  heartbeat({ worker: s.worker, tc: s.tc, step: s.step, event: 'stall', silence_ms: s.silenceMs, classification: r ? r.classification : 'no_activity', diagnostics: r ? r.file : null,
    ...(r ? {} : { note: 'diagnostics exceeded ' + Math.round(DIAGNOSTICS_MS / 1000) + ' s' }) });
}

async function captureDiagnostics(s: { worker: number; tc: string; step: string; silenceMs: number }): Promise<{ classification: string; file: string | null }> {
  const rt = runtime();
  const page = rt.page && !rt.page.isClosed() ? rt.page : null;
  let inFlight: string[] = [];
  try { inFlight = rt.inFlight ? rt.inFlight() : []; } catch { inFlight = []; }
  const busy = page ? await bounded(page.locator(BUSY_SELECTOR).first().isVisible(), false) : false;
  const classification = inFlight.length ? 'app_slow' : busy ? 'ui_blocked' : 'no_activity';
  let file: string | null = null;
  const dir = process.env.PW_DIAGNOSTICS_DIR;
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true });
      const stem = 'stall-w' + s.worker + '-' + (s.tc.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'test') + '-' + Date.now();
      let screenshot: string | null = null;
      if (page) {
        const shot = join(dir, stem + '.png');
        if (await bounded(page.screenshot({ path: shot, timeout: PROBE_MS }).then(() => true), false)) screenshot = stem + '.png';
      }
      const aria = page ? await ariaOf(page) : null;
      file = join(dir, stem + '.json');
      writeFileSync(file, JSON.stringify({
        at: new Date().toISOString(), worker: s.worker, tc: s.tc, step: redact(s.step), silence_ms: s.silenceMs, classification,
        busy_indicator_visible: busy, in_flight: inFlight, screenshot, aria_snapshot: aria, last_records: lastRecords(s.worker),
      }, null, 2) + '\n');
    } catch { file = null; /* diagnostics are evidence only — they never fail a test */ }
  }
  return { classification, file };
}

/* ---------------- step() ---------------- */

export async function step<T>(title: string, body: (report: Report) => Promise<T>, options: StepOptions = {}): Promise<T> {
  const info = test.info();
  // a named operation is the ONLY way past the ordinary bounds: its deadline and (object entry) its silence
  const op: Operation | undefined = options.operation ? OPTIONAL.operations?.[options.operation] : undefined;
  if (options.operation && op === undefined) throw new Error(`step "${title}": TIMEOUTS.operations.${options.operation} is not defined — add it with its reason`);
  const deadline = options.deadline ?? (op === undefined ? TIMEOUTS.step.default : typeof op === 'number' ? op : op.deadline);
  const silence = op !== undefined && typeof op === 'object' && Number(op.silence) > 0 ? Number(op.silence) : STALL_SILENCE_MS;
  const tc = tcIdsOf(info.title).join(',') || info.title;
  const worker = info.parallelIndex;
  const startedAt = Date.now();
  const entry: OpenStep = { title, tc, worker, startedAt, deadline, testId: (info as unknown as { testId?: string }).testId ?? null };
  pushStep(entry);
  lastStepEventAt = startedAt;
  heartbeat({ worker, tc, step: title, event: 'start', deadline_ms: deadline, note: options.expects ?? null, ...(silence !== STALL_SILENCE_MS ? { silence_ms: silence } : {}) });
  let lastActivity = startedAt;
  let settled = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  // meaningful progress only: a counter that rose (same total), a milestone new in this step, or — a legacy string
  // note — an n/m counter that rose; anything else is recorded but never resets the silence clock
  let counter: { done: number; total: number | null } | null = null;
  const milestones = new Set<string>();
  const report: Report = (note, progress) => {
    let meaningful = false;
    let done = progress?.done;
    let total = progress?.total ?? null;
    if (done === undefined && !progress?.milestone) { const m = /(\d+)\s*\/\s*(\d+)/.exec(String(note)); if (m) { done = Number(m[1]); total = Number(m[2]); } }
    if (typeof done === 'number' && Number.isFinite(done)) {
      meaningful = counter && counter.total === total ? done > counter.done : done > 0;
      counter = { done, total };
    }
    if (progress?.milestone && !milestones.has(progress.milestone)) { milestones.add(progress.milestone); meaningful = true; }
    if (meaningful) lastActivity = Date.now();
    heartbeat({ worker, tc, step: title, event: 'progress', note, meaningful, ...(progress ? { progress } : {}) });
  };
  // the stall detector watches only steps longer than their silence limit; shorter ones are covered by their deadline
  const armStall = (inMs: number): void => {
    stallTimer = later(inMs, () => {
      if (settled) return;
      const quiet = Date.now() - Math.max(lastActivity, lastStepEventAt);
      if (quiet < silence) { armStall(silence - quiet); return; }
      void stallDiagnostics({ worker, tc, step: title, silenceMs: quiet }).catch(() => undefined);
    });
  };
  if (deadline > silence && process.env.PW_PROGRESS_FILE) armStall(silence);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bodyPromise = body(report);
  bodyPromise.catch(() => { /* late rejection after the deadline: already reported, never unhandled */ });
  const deadlineRace = new Promise<never>((_, reject) => {
    // deliberate timer: this IS the step deadline (TIMEOUTS.step.*), not a wait for the application
    timer = setTimeout(() => reject(new StepTimeoutError(tc, title, Date.now() - startedAt, deadline, options.expects)), deadline);
  });
  const run = () => Promise.race([bodyPromise, deadlineRace]);
  try {
    const result = NATIVE_STEP_TIMEOUT
      ? await (test.step as unknown as (t: string, b: () => Promise<T>, o: { timeout: number }) => Promise<T>)(title, run, { timeout: deadline })
      : await test.step(title, run);
    heartbeat({ worker, tc, step: title, event: 'end', outcome: 'ok', elapsed_ms: Date.now() - startedAt });
    return result;
  } catch (e) {
    const err = e as Error;
    const timedOut = err instanceof StepTimeoutError || /timeout/i.test(String(err?.name)) || /Timeout \d+ms exceeded/.test(String(err?.message));
    heartbeat({ worker, tc, step: title, event: 'end', outcome: timedOut ? 'timeout' : 'error', elapsed_ms: Date.now() - startedAt, note: String(err?.message ?? err).slice(0, 200) });
    throw e;
  } finally {
    settled = true;
    lastStepEventAt = Date.now();
    if (timer) clearTimeout(timer);
    if (stallTimer) clearTimeout(stallTimer);
    popStep(entry);
  }
}
