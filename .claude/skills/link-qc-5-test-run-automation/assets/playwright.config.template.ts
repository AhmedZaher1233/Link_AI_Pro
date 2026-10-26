// playwright.config.ts — the ONE shared configuration (skill 5, references/code-craft.md §8).
//
// Used by link-qc-5-test-run-automation ONLY when the project has no Playwright config at all. An existing
// config is updated in place instead (never a second file); several configs are consolidated into
// the existing shared one. Per-run values come from environment variables the skill sets on each
// stage command — nothing here is rewritten per story:
//
//   PW_STAGE_JSON       this command's raw Playwright JSON (one file per stage / run-group command)
//   PW_PROGRESS_FILE    this command's heartbeat file (helpers/steps.ts + helpers/progress-reporter.ts)
//   PW_OUTPUT_DIR       Playwright outputDir of this command ({results_root}/artifacts/test-output/phase-{N}/{command}/)
//   PW_GLOBAL_TIMEOUT   outer wall-clock ceiling for this command (ms; 0 = none)
//   PW_HEADLESS=1       run hidden — set by the runner only for --headless, CI or no graphical desktop (default: VISIBLE Chrome;
//                       every worker is its own Playwright-launched browser with a temporary profile — never the user's)
//   PW_WORKERS          workers for this command, decided by the runner (Auto ceiling, ramp, admission; 1 when serial)
//   PW_VIDEO=1          keep video on failure while investigating a freeze (off by default)
//   PW_PHASE / PW_STAGE_ATTEMPT   used by helpers/evidence.ts and helpers/test-data.ts
//   PW_RATE_LIMIT_FILE  this command's request records (helpers/network-guard.ts: refused / unavailable / server-error /
//                       policy / network-error, origin + path template only) and the pacing records of helpers/rate-limit.ts
//   PW_RATE_LIMIT_STATE the slot book helpers/rate-limit.ts shares — per environment across runs (the coordination
//                       directory's rate-limits/{environment id}.json), or phase-local with an older runner
//   PW_RATE_LIMITS      JSON of the run plan's rate_limits[] — the configured pace per service (empty: advertised limits and
//                       refusals still pace)
//   PW_ADMISSION_FILE   the stage's admission state (open / paused, scoped cool-downs) read by helpers/admission.ts
//   PW_UNIT_SCOPES      JSON { TC: [scope, …] } — the rate-limit / account scopes each TC touches (admission cool-downs)
//   PW_UNIT_MAP         JSON { TC: unit id } — the execution unit of each TC (a chain / shared-hook describe is admitted once)
//   PW_LANE             this command's index in the stage — part of uniqueName() / uniqueCode() (helpers/test-data.ts)
//   PW_CANCEL_FILE      appears when the stage stops — every helper wait (admission, rate limit) ends at once
//   PW_DIAGNOSTICS_DIR  where the stall detector of helpers/steps.ts writes its snapshot (screenshot, ARIA, in-flight)
//   PW_ENV_ID           the environment identity the runner's lease and the shared slot book are keyed by
//   BASE_URL / PW_LOCALE / PW_TZ  from the project's env layer (utils/env.ts) — never hardcoded here
// Every one of them is optional: without it the helper that reads it is inert.
import { defineConfig, devices } from '@playwright/test';
import { TIMEOUTS } from './timeouts';

const headless = process.env.PW_HEADLESS === '1' || process.env.PW_HEADLESS === 'true';

export default defineConfig({
  testDir: './tests',
  // Parallelism: every test may run on any worker. The skill runs each serial run-plan group as its own
  // command with --workers 1 (the documented override — see the run plan's reason column); only a true
  // chain (a later test needs data an earlier one created) sits in a test.describe.configure({ mode: 'serial' })
  // block. A FAIL beside other tests is re-run alone by the runner before it counts (the isolation check).
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS ?? 2),
  // A committed test.only would silence the rest of the suite; the validator catches it statically,
  // CI refuses it at runtime.
  forbidOnly: !!process.env.CI,
  // Retries hide flakiness. A failure is classified and healed (skill 5 <first_run>), not retried away.
  retries: 0,
  // Budgets — all from timeouts.ts, calibrated after the first run with evidence, never inline.
  timeout: TIMEOUTS.test.default,
  expect: { timeout: TIMEOUTS.expect },
  globalTimeout: Number(process.env.PW_GLOBAL_TIMEOUT ?? 0),
  outputDir: process.env.PW_OUTPUT_DIR ?? 'test-results',
  // Reporters are ADDITIVE: keep every reporter the project already had in this list.
  reporter: [
    ['line'],
    ['json', { outputFile: process.env.PW_STAGE_JSON ?? 'artifacts/stages/unnamed.json' }],
    ['./helpers/progress-reporter.ts'],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    channel: 'chrome',
    headless,
    // FINITE, always: 0 means "no limit" to Playwright — an action that can wait forever hangs a worker for its whole
    // test budget (the hang the watchdog then has to kill). Every preset and project override keeps these finite.
    actionTimeout: TIMEOUTS.action,
    navigationTimeout: TIMEOUTS.navigation,
    screenshot: 'only-on-failure',
    // retain-on-failure works with retries: 0 (on-first-retry would never fire).
    trace: 'retain-on-failure',
    video: process.env.PW_VIDEO ? 'retain-on-failure' : 'off',
    // Deterministic rendering for evidence images and date-dependent TCs.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: process.env.PW_LOCALE ?? 'en-US',
    timezoneId: process.env.PW_TZ ?? 'UTC',
  },
  projects: [
    // The browser project the skill runs ({browser_project}). Keep the name stable: it is part of every
    // evidence path ({project}--{variation}--r{n}). Add an 'ar' project with locale 'ar-SA' ONLY when the
    // application reads the browser locale; otherwise locale variants switch language through the page object.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
});
