// helpers/steps.ts — named steps with a deadline the helper OWNS (skill 5, references/code-craft.md §5, §9).
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
// - report(note) inside a long operation writes a `progress` heartbeat: the watchdog resets its
//   clock on it, so a legitimately slow step that keeps reporting is never declared frozen.
// - Every record goes to process.env.PW_PROGRESS_FILE (set per stage command by the skill). With
//   no file set the helper is silent; it never fails a test over the heartbeat.
import { test } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { TIMEOUTS } from '../timeouts';

export type StepOptions = {
  /** Milliseconds this step may take. Default TIMEOUTS.step.default; use a TIMEOUTS.operations.* key for a known long operation. */
  deadline?: number;
  /** The manual step's expected condition, carried into the timeout record and the freeze report. */
  expects?: string;
};
export type Report = (note: string) => void;

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

export function tcIdsOf(title: string): string[] {
  return [...title.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter((x) => /^TC-/.test(x));
}

export function heartbeat(record: Record<string, unknown>): void {
  const file = process.env.PW_PROGRESS_FILE;
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  } catch { /* the heartbeat never fails a test */ }
}

export async function step<T>(title: string, body: (report: Report) => Promise<T>, options: StepOptions = {}): Promise<T> {
  const info = test.info();
  const deadline = options.deadline ?? TIMEOUTS.step.default;
  const tc = tcIdsOf(info.title).join(',') || info.title;
  const worker = info.parallelIndex;
  const startedAt = Date.now();
  heartbeat({ worker, tc, step: title, event: 'start', deadline_ms: deadline, note: options.expects ?? null });
  const report: Report = (note) => heartbeat({ worker, tc, step: title, event: 'progress', note });

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
    if (timer) clearTimeout(timer);
  }
}
