import { defineConfig, devices } from '@playwright/test';
import { TIMEOUTS } from './timeouts';

/** The ONE shared configuration — no global setup (selftest case 7 adds one in a temporary copy). */
export default defineConfig({
  testDir: './tests',
  timeout: TIMEOUTS.test,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL,
    actionTimeout: TIMEOUTS.action,
    navigationTimeout: TIMEOUTS.navigation,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
