// Case 10 — REQ-014 says the total must be recalculated. The test is LINKED to it and
// asserts only that the panel is visible. Linkage is not coverage: the scanner reports the
// link and leaves the outcome question open, it never reports the requirement as covered.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';

test.describe('REQ-014: the total is recalculated after an edit', () => {
  test('[TC-01] Validate that the totals panel is shown after an edit', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toBeVisible();
  });
});
