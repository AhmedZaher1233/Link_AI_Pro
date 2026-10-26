// B8 guards — TRUE POSITIVE (checks 46a, 49): a spec that attaches neither guard.
import { test, expect } from '@playwright/test';
import { captureEvidence } from '../../../helpers/evidence.fixture';
import { ThingPage } from '../../../pages/thing.page.fixture';

test.describe('REQ-014: no guards', () => {
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
