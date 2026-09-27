// Case 16 — FALSE-NEGATIVE GUARDS: code that LOOKS scoped or stepped but is not.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';

// A LOCAL function named step: a spec-helper violation, and it never satisfies step-missing.
async function step(title: string, body: () => Promise<void>) {
  return body();
}

test.describe('REQ-014: timing rules — false-negative guards', () => {
  test('[TC-01] Validate that an unrelated filter does not scope a positional', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    const rows = thing.rows();
    const names = ['a', 'b'];
    names.filter(Boolean); await rows.first().click();
    const picked = names.filter((x) => x).length && rows.nth(0);
    await step('local wrapper does not count', async () => {
      await thing.create('Alpha');
    });
    await captureEvidence(page, testInfo);
    await expect(picked).toBeTruthy();
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });

  test('[TC-02] Validate that a step inside the page object does not count for the spec', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.createStepped('Beta');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Beta')).toHaveText('Beta');
  });
});
