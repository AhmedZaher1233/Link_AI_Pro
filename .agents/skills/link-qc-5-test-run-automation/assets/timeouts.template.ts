// timeouts.ts — the ONE timeout policy of this automation project (skill 5, references/code-craft.md §9).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/timeouts.ts when absent. Every timeout the
// shared playwright.config.ts, the step() helper, the hooks and the watchdog use comes from here —
// never an inline number in a spec or a page object.
//
// INITIAL VALUES — calibrate after the first run from evidence (trace / screenshot / heartbeat),
// and record every change with its reason in the run report's Timeout policy section and in the
// Heal Log. A value may rise only when evidence shows the operation legitimately completing after
// the deadline. A broken locator, a failed operation or a frozen step is healed, never re-timed.
export const TIMEOUTS = {
  /** Whole test-case budget (Playwright `timeout`): fixtures + beforeEach + body. Teardown gets a separate budget of the same size. */
  test: {
    default: 90_000,
    /** For TCs whose steps legitimately need more: `test.setTimeout(TIMEOUTS.test.long)` with a comment naming the operation. */
    long: 180_000,
  },
  /** Web-first assertion retry window (`expect.timeout`). */
  expect: 10_000,
  /** One action: click / fill / select (`use.actionTimeout`). */
  action: 15_000,
  /** One navigation: goto / waitForURL (`use.navigationTimeout`). */
  navigation: 30_000,
  /** beforeAll / afterAll and fixture setup that provisions data. */
  hook: 60_000,
  /** Per-step deadline enforced by helpers/steps.ts — a stuck step never consumes the whole TC budget. */
  step: {
    default: 30_000,
    long: 120_000,
  },
  /**
   * Named overrides for KNOWN long-running operations. Reference by key from the spec:
   * `await step('export the yearly report', body, { deadline: TIMEOUTS.operations.report_export })`.
   * Add a key only with the reason in the comment beside it.
   */
  operations: {
    // report_export: 120_000, // the yearly export renders server-side and takes 60-90 s in UAT (calibrated phase 1)
  } as Record<string, number>,
  /** Time the watchdog allows AFTER a step deadline for Playwright's own timeout and teardown to act before a worker is declared hung. */
  watchdog_grace: 60_000,
} as const;

/** Sanity: a stuck step must never be able to consume the whole TC budget. */
if (TIMEOUTS.step.default * 2 > TIMEOUTS.test.default) {
  throw new Error('timeouts.ts: test.default must be at least twice step.default so one stuck step cannot exhaust the TC budget');
}
