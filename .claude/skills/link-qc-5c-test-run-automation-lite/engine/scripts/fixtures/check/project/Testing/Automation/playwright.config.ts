// Fixture shared configuration for selftest-check.mjs. Never executed. The action budget is 0 (no limit) and the
// navigation budget is left unset on purpose: the A15 timeout report must list both.
import { defineConfig } from '@playwright/test';
import { TIMEOUTS } from './timeouts';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  timeout: TIMEOUTS.test.default,
  expect: { timeout: TIMEOUTS.expect },
  use: {
    actionTimeout: 0,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
