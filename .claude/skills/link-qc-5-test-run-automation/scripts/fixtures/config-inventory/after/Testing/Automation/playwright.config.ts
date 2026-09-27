// Fixture: the ONE shared configuration. Never executed.
import { defineConfig, devices } from '@playwright/test';
import { TIMEOUTS } from './timeouts';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: TIMEOUTS.test,
  reporter: [['line'], ['json', { outputFile: process.env.PW_STAGE_JSON ?? 'artifacts/stages/unnamed.json' }]],
  use: { channel: 'chrome', headless: !!process.env.PW_HEADLESS, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
