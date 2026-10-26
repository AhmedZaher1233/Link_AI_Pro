// fixtures/admission/playwright.config.ts — the integration project of selftest-admission.mjs (a REAL Playwright run of
// assets/admission.template.ts; no browser is launched). One worker, no retries, the JSON reporter into PW_JSON_OUT.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['json', { outputFile: process.env.PW_JSON_OUT || 'results.json' }]],
  outputDir: process.env.PW_OUTPUT_DIR || 'test-results',
});
