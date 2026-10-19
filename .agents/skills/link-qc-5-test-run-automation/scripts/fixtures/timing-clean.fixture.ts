// Case 15 — FALSE-POSITIVE GUARDS for the timing / positional / step rules.
// Must reach PASS with zero warnings even under --require-steps.
import { test, expect } from '@playwright/test';
import { ThingPage } from './pages/thing.page.fixture';
import { captureEvidence } from './helpers/evidence.fixture';
import { step } from './helpers/steps.fixture';

const MODE = 'networkidle';
// rows.first() is mentioned in this comment only — a comment never fires a rule.

test.describe('REQ-014: timing rules — guards', () => {
  test('[TC-01] Validate that scoped, justified and excepted positionals are not flagged', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    const rows = thing.rows();
    await rows.filter({ hasText: 'Alpha' }).first().click();
    await rows.filter({ has: thing.nameCell('Beta') }).getByRole('cell').nth(1).click();
    // deliberate: the grid lists duplicates newest first, so the first row is the target (REQ-014)
    await rows.first().click();
    // qa-allow: positional-unscoped — the legacy grid exposes no row identity (TC-01)
    await rows.last().click();
    await page.waitForLoadState('load'); // not networkidle
    await step('open the details', async () => {
      await thing.create(MODE);
    });
    await captureEvidence(page, testInfo);
    await test.step('verify', async () => {
      await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
    });
  });
});
