// Case 4 — assertion and evidence live in an invoked page-object method.
// Valid, well-factored code: it must NOT be rejected, and the positive result must say
// "call site found", never "verified".
import { test } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';

test.describe('REQ-014: indirect assertion and evidence', () => {
  test('[TC-01] Validate that a new thing appears in the list', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await thing.verifyCreated(testInfo, 'Alpha');
  });
});
