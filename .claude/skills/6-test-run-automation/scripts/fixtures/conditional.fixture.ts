// Case 7 — a call site is not execution. Evidence behind a guard, and an assertion that
// sits behind a guard inside the page object. Both are review items, never violations and
// never a clean "call found".
import { test } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';

test.describe('REQ-014: conditional call paths', () => {
  test('[TC-01] Validate that a new thing appears in the list', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    if (process.env.CAPTURE) {
      await captureEvidence(page, testInfo);
    }
    await thing.verifyWhenPresent('Alpha', true);
  });

  test('[TC-02] Validate that the guarded assertion is reported', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await captureEvidence(page, testInfo);
    await thing.verifyWhenPresent('Beta', true);
  });
});
