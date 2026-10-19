// playwright.config.ts — the ONE shared configuration (skill 5, references/code-craft.md §8).
//
// Used by link-qc-5-test-run-automation ONLY when the project has no Playwright config at all. An existing
// config is updated in place instead (never a second file); several configs are consolidated into
// the existing shared one. Per-run values come from environment variables the skill sets on each
// stage command — nothing here is rewritten per story:
//
//   PW_STAGE_JSON       this command's raw Playwright JSON (one file per stage / run-group command)
//   PW_PROGRESS_FILE    this command's heartbeat file (helpers/steps.ts + helpers/progress-reporter.ts)
//   PW_OUTPUT_DIR       Playwright outputDir for this story ({results_root}/artifacts/test-output)
//   PW_GLOBAL_TIMEOUT   outer wall-clock ceiling for this command (ms; 0 = none)
//   PW_HEADLESS=1       run hidden (default: VISIBLE Chrome window)
//   PW_WORKERS          parallel workers for this command (default 2; serial groups pass --workers 1)
//   PW_VIDEO=1          keep video on failure while investigating a freeze (off by default)
//   PW_PHASE / PW_STAGE_ATTEMPT   used by helpers/evidence.ts and helpers/test-data.ts
//   BASE_URL / PW_LOCALE / PW_TZ  from the project's env layer (utils/env.ts) — never hardcoded here
import { defineConfig, devices } from '@playwright/test';
import { TIMEOUTS } from './timeouts';

const headless = process.env.PW_HEADLESS === '1' || process.env.PW_HEADLESS === 'true';

export default defineConfig({
  testDir: './tests',
  // Parallelism: every test may run on any worker; genuinely dependent tests sit in a
  // test.describe.configure({ mode: 'serial' }) block, and the skill runs each serial run-plan group
  // as its own command with --workers 1 (the documented override — see the run plan's reason column).
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
