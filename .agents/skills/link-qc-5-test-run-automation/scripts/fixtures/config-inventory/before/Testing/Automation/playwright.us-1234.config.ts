// Fixture: a per-story config from the old layout — a merge CANDIDATE (only use/workers overrides).
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  workers: 3,
  fullyParallel: false,
  use: { ...base.use, headless: false },
});
