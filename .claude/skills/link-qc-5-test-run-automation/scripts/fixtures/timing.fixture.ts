// Case 14 — timing / positional / step rules: every TRUE POSITIVE, at a known line.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';

test.describe('REQ-014: timing rules — true positives', () => {
  test('[TC-01] Validate that unscoped positionals and networkidle waits are flagged', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    const rows = thing.rows();
    await rows.first().click();
    await page.waitForLoadState('networkidle');
    await thing.open({ waitUntil: 'networkidle' });
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
