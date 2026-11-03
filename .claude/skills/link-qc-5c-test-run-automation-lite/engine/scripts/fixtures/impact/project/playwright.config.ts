import { defineConfig, devices } from '@playwright/test';
import { TIMEOUTS } from './timeouts';

/** The ONE shared configuration (Chrome, headed, 2 workers, fullyParallel). */
export default defineConfig({
  testDir: './tests',
  timeout: TIMEOUTS.test.default,
  expect: { timeout: TIMEOUTS.expect.default },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL,
    headless: false,
    actionTimeout: TIMEOUTS.action.default,
    navigationTimeout: TIMEOUTS.navigation.default,
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
