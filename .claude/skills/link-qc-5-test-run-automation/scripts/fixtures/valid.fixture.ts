// Case 1 — compliant code. Must produce no violation, no warning and no review item.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';

const LABELS = { saved: 'Saved' };

test.describe('REQ-014: a thing can be created and listed', () => {
  test('[TC-01] Validate that a new thing appears in the list', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });

  test('[TC-02] Validate that the save confirmation is shown', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Beta')).toHaveText(LABELS.saved);
  });
});
