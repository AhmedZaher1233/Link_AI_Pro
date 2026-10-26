// helpers/progress-reporter.ts — ADDITIVE incremental reporter (skill 5, references/code-craft.md §9).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/progress-reporter.ts when absent and
// added to the shared config's reporter list BESIDE the project's own reporters (never replacing one).
//
// Playwright's `json` reporter writes only when the whole command ends, so a run the watchdog has to
// kill would lose every result. This reporter appends ONE line per finished test as it happens:
//   {PW_PROGRESS_FILE minus .jsonl}.results.jsonl   { at, worker, tc[], title, status, duration_ms, retry, project, error, annotations[], annotation_notes? }
// and the test-level heartbeat records (`test-start` / `test-end`) to PW_PROGRESS_FILE itself, so
// scripts/watchdog.mjs can tell completed, interrupted and never-started tests apart.
// `annotations` lists the annotation TYPES of the test (never their descriptions), e.g. `skip`, `admission-timeout`,
// `rate-limit-deferred`, `rate-limit`, `console-errors`, `expects-refusal` — so a run stopped before Playwright's JSON
// report exists still tells a deferred or admission-timed-out test from an ordinary skip. `annotation_notes` (present
// only when needed) carries the description of the skill's own `admission-timeout` (the reason) and
// `rate-limit-deferred` (the ISO time the test was deferred until) annotations — no other description is copied.
// With no PW_PROGRESS_FILE set it does nothing.
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function tcIdsOf(title: string): string[] {
  return [...title.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter((x) => /^TC-/.test(x));
}

type Annotation = { type: string; description?: string };
/** The skill's own annotations whose description the runner needs (an ISO time, a reason) — no other description is copied. */
const NOTED = new Set(['admission-timeout', 'rate-limit-deferred']);

/** Annotations of a finished test: the test's own plus the result's (Playwright ≥ 1.52 keeps runtime ones there). */
function annotationsOf(test: TestCase, result: TestResult): Annotation[] {
  const own = (test.annotations || []) as Annotation[];
  const runtime = ((result as unknown as { annotations?: Annotation[] }).annotations || []) as Annotation[];
  return [...own, ...runtime].filter((a) => a && typeof a.type === 'string' && a.type.length > 0);
}
function annotationTypes(test: TestCase, result: TestResult): string[] {
  return [...new Set(annotationsOf(test, result).map((a) => a.type))];
}
function annotationNotes(test: TestCase, result: TestResult): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const a of annotationsOf(test, result)) if (NOTED.has(a.type) && a.description) out[a.type] = String(a.description).slice(0, 200);
  return Object.keys(out).length ? out : undefined;
}

export default class ProgressReporter implements Reporter {
  private heartbeatFile = process.env.PW_PROGRESS_FILE || '';
  private resultsFile = this.heartbeatFile ? this.heartbeatFile.replace(/\.jsonl$/, '') + '.results.jsonl' : '';

  private append(file: string, record: Record<string, unknown>) {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
    } catch { /* a reporter never fails the run */ }
  }

  onBegin(_config: FullConfig, _suite: Suite) { /* nothing: the files are created lazily by the first record */ }

  onTestBegin(test: TestCase, result: TestResult) {
    const tc = tcIdsOf(test.title);
    this.append(this.heartbeatFile, { worker: result.parallelIndex, tc: tc.join(',') || test.title, event: 'test-start', retry: result.retry, project: test.parent.project()?.name ?? null });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const tc = tcIdsOf(test.title);
    this.append(this.resultsFile, {
      worker: result.parallelIndex,
      tc: tc.length ? tc : [test.title],
      title: test.title,
      status: result.status,               // passed | failed | timedOut | skipped | interrupted
      duration_ms: result.duration,
      retry: result.retry,
      project: test.parent.project()?.name ?? null,
      error: result.error?.message?.slice(0, 200) ?? null,
      annotations: annotationTypes(test, result),
      annotation_notes: annotationNotes(test, result),
    });
    this.append(this.heartbeatFile, { worker: result.parallelIndex, tc: tc.join(',') || test.title, event: 'test-end', status: result.status });
  }

  onEnd(_result: FullResult) { /* nothing to flush: every line was appended synchronously */ }

  printsToStdio() { return false; }
}
