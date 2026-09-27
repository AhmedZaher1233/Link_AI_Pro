// Fixture: a CI config with settings the shared file cannot reproduce silently — BLOCKED.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  globalSetup: './ci/global-setup.ts',
  webServer: { command: 'npm run start', url: 'http://localhost:4000' },
  reporter: [['./reporters/teamcity.ts', { flowId: true }]],
});
