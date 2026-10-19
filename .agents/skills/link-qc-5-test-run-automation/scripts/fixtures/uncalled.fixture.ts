// Case 5 — false PASS guard. The page object DOES contain captureEvidence(), but only in
// unusedVerify(), which this test never calls. Presence in the file must not rescue it.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';

test.describe('REQ-014: evidence in an uncalled method', () => {
  test('[TC-01] Validate that a new thing appears in the list', async ({ page }) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
