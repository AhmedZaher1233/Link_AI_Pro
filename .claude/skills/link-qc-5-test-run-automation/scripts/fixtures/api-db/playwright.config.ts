// selftest-api-db.mjs fixture config — the shared config's two projects, one worker, the JSON report the harness reads.
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [['json', { outputFile: process.env.PW_JSON_OUT ?? 'results.json' }]],
  outputDir: process.env.PW_OUTPUT_DIR ?? 'test-results',
  use: { baseURL: process.env.API_BASE_URL, headless: true },
  projects: [
    { name: 'chromium', testIgnore: /\.(api|db)\.spec\.ts$/ },
    { name: 'backend', testMatch: /\.(api|db)\.spec\.ts$/ },
  ],
});
