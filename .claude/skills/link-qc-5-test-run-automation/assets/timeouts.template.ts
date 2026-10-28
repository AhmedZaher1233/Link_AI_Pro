// timeouts.ts — the ONE timeout policy of this automation project (skill 5, references/code-craft.md §9).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/timeouts.ts when absent. Every timeout the
// shared playwright.config.ts, the step() helper, the hooks and the watchdog use comes from here —
// never an inline number in a spec or a page object.
//
// INITIAL VALUES — calibrate after the first run from evidence (trace / screenshot / heartbeat),
// and record every change with its reason in the run file's timeouts record (adjusted[]) and in the
// Heal Log. A value may rise only when evidence shows the operation legitimately completing after
// the deadline. A broken locator, a failed operation or a frozen step is healed, never re-timed.
// An EXISTING timeouts.ts is reconciled, never replaced (config-inventory.mjs reconcile): missing keys are added from
// here, the project's values and comments are kept; the helpers fall back to these defaults while a key is missing.
//
// THE BOUNDS (sanity checks below): a missing or unclickable locator fails within max(action, expect) ≤ 60 s; a step
// without meaningful progress is stopped within stall.silence + watchdog_grace (+ ≤ 5 s polling) ≤ 120 s of its last
// meaningful progress; every step has a FIXED deadline from its start. The ONLY way past a bound is a named entry in
// `operations` with its reason — never a raised default.
/** A named long-operation exception: its deadline, or its deadline + the silence it may legitimately keep + the reason. */
export type Operation = number | { deadline: number; silence?: number; reason: string };
export const TIMEOUTS = {
  /** Whole test-case budget (Playwright `timeout`): fixtures + beforeEach + body. Teardown gets a separate budget of the same size. */
  test: {
    default: 90_000,
    /** For TCs whose steps legitimately need more: `test.setTimeout(TIMEOUTS.test.long)` with a comment naming the operation. */
    long: 180_000,
  },
  /** Web-first assertion retry window (`expect.timeout`). */
  expect: 10_000,
  /** One action: click / fill / select (`use.actionTimeout`). FINITE — 0 means "no limit" to Playwright and is never allowed. */
  action: 15_000,
  /** One navigation: goto / waitForURL (`use.navigationTimeout`). FINITE — 0 means "no limit" to Playwright and is never allowed. */
  navigation: 30_000,
  /** beforeAll / afterAll and fixture setup that provisions data. */
  hook: 60_000,
  /** Per-step deadline enforced by helpers/steps.ts — fixed from the step's start; progress never extends it. */
  step: {
    default: 30_000,
    long: 120_000,
  },
  /**
   * The explicit, justified EXCEPTIONS for known long operations. Reference by key from the spec:
   * `await step('export the yearly report', body, { deadline: TIMEOUTS.operations.report_export })`.
   * A number is the step's deadline; an object also sets the silence the operation may legitimately keep
   * (a server-side job with no UI progress) — `step(title, body, { operation: 'report_export' })` reads both.
   * Every key carries its reason beside it. A step above `step.long` reports MEANINGFUL progress
   * (`report('rows', { done, total })` / `report('uploaded', { milestone: 'upload' })`); changed text alone is not progress.
   */
  operations: {
    // report_export: { deadline: 300_000, silence: 240_000, reason: 'the yearly export renders server-side for 3-4 min with no UI progress (calibrated phase 1)' },
  } as Record<string, Operation>,
  /** Time the watchdog allows AFTER a step deadline (or a silence limit) for Playwright's own timeout and teardown to act before a worker is declared hung. */
  watchdog_grace: 60_000,
  /**
   * Stall detection (helpers/steps.ts) and the watchdog's silence rule — ACTIVE by default (run-stage.mjs stops the
   * command). A step whose deadline is LONGER than `silence` and that shows no meaningful progress this long gets one
   * diagnostics snapshot and a `stall` heartbeat (ui_blocked / app_slow / no_activity); past silence + watchdog_grace
   * the watchdog stops it. A shorter step is covered by its own deadline. 55 s + 60 s grace + ≤ 5 s polling = 120 s.
   */
  stall: {
    silence: 55_000,
  },
  /** One API call of helpers/api-record.ts (each redirect hop gets its own) and one statement of helpers/db-record.ts — FINITE. */
  api: {
    request: 30_000,
  },
  db: {
    query: 30_000,
  },
  /** The whole stall-diagnostics capture (screenshot, ARIA snapshot, in-flight requests, last records) — bounded on its own, never charged to the step. */
  diagnostics: 30_000,
  /**
   * Admission (helpers/admission.ts): the longest a NEW test — or a worker's first unit — waits for host pressure to
   * clear, a scoped cool-down to end or the environment lease to come back, before it is reported
   * `not started: admission timeout (…)`. The wait never eats the test budget (the fixture has its own timeout).
   */
  admission: {
    max_wait: 600_000,
  },
  /**
   * Rate-limit pacing (helpers/rate-limit.ts) and the runner's cool-downs (run-stage.mjs --cooldown / --cooldown-max).
   * The pace itself is NOT here — it comes from the run plan's rate_limits[] (PW_RATE_LIMITS) and from the limits the
   * application advertises, so learning a limit never changes code. A server deadline (Retry-After, RateLimit-Reset)
   * is NEVER shortened by any value here: a wait that does not fit its budget is deferred, never cut short.
   */
  rate_limit: {
    /** Longest wait for a start-of-test slot (login), taken before any step opens; a longer server deadline defers the test (not started). */
    max_start_wait: 120_000,
    /** Longest wait for a mid-test slot (rateLimitSlot inside a step) — must fit a step deadline; longer → `wait budget exhausted`. */
    in_step_wait: 5_000,
    /** Base of the self-chosen back-off (full jitter) when the application refused WITHOUT a Retry-After / reset header. */
    cooldown: 60_000,
    /** Cap on the SELF-CHOSEN back-off only — a server-advertised deadline is never capped. */
    cooldown_max: 120_000,
  },
} as const;

/** Sanity: a stuck step must never be able to consume the whole TC budget. */
if (TIMEOUTS.step.default * 2 > TIMEOUTS.test.default) {
  throw new Error('timeouts.ts: test.default must be at least twice step.default so one stuck step cannot exhaust the TC budget');
}
/** Sanity: action and navigation timeouts are finite — an unlimited action can hang a worker for its whole budget. */
if (!(TIMEOUTS.action > 0 && Number.isFinite(TIMEOUTS.action)) || !(TIMEOUTS.navigation > 0 && Number.isFinite(TIMEOUTS.navigation))) {
  throw new Error('timeouts.ts: action and navigation must be finite, positive milliseconds — 0 means unlimited to Playwright');
}
/** Sanity: a missing or unclickable locator fails within 60 s — a longer single operation belongs in `operations`. */
if (Math.max(TIMEOUTS.action, TIMEOUTS.navigation, TIMEOUTS.expect) > 60_000 || TIMEOUTS.step.default > 60_000) {
  throw new Error('timeouts.ts: action, navigation, expect and step.default must be at most 60 s — name a longer operation in `operations` with its reason');
}
/** Sanity: the silence threshold must outlast the longest single action, navigation or assertion. */
if (TIMEOUTS.stall.silence < Math.max(TIMEOUTS.action, TIMEOUTS.navigation, TIMEOUTS.expect)) {
  throw new Error('timeouts.ts: stall.silence must be at least max(action, navigation, expect) — a shorter value reports healthy actions as stalls');
}
/** Sanity: a step without meaningful progress is stopped within 120 s (stall.silence + watchdog_grace + ≤ 5 s polling). */
if (TIMEOUTS.stall.silence + TIMEOUTS.watchdog_grace > 115_000) {
  throw new Error('timeouts.ts: stall.silence + watchdog_grace must be at most 115 s — a legitimately silent operation gets its own `operations` entry');
}
/** Sanity: every operation exception names its reason and stays finite. */
for (const [name, op] of Object.entries(TIMEOUTS.operations)) {
  const deadline = typeof op === 'number' ? op : op.deadline;
  if (!(deadline > 0 && Number.isFinite(deadline))) throw new Error('timeouts.ts: operations.' + name + ' needs a finite, positive deadline');
  if (typeof op === 'object' && !(typeof op.reason === 'string' && op.reason.trim())) throw new Error('timeouts.ts: operations.' + name + ' needs its reason');
}
