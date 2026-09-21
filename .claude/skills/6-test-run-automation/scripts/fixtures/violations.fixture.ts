// Case 2 — every definite violation the scanner claims to catch, one per test where possible.
// The alias `t` proves focus detection survives `import { test as t }`.
import { test as t, expect } from '@playwright/test';
import { captureEvidence } from './helpers/evidence.fixture';

t.describe('REQ-014: violations', () => {
  t.only('[TC-01] Validate that a focused test is rejected', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
    await expect(page).toHaveTitle('x');
  });

  t.skip('[TC-02] Validate that an unexplained skip is rejected', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
    await expect(page).toHaveTitle('x');
  });

  t('[TC-03] Validate that a placeholder assertion is rejected', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
    expect(true).toBe(true);
  });

  t('[TC-01] Validate that raw page driving is rejected', async ({ page }, testInfo) => {
    await page.goto('/things');
    await page.locator('#thing-name').fill('Alpha');
    await page.waitForTimeout(500);
    await captureEvidence(page, testInfo);
    await expect(page).toHaveTitle('x');
  });

  t('[TC-02] Validate that a missing evidence call is rejected', async ({ page }) => {
    await expect(page).toHaveTitle('x');
  });

  t('Validate that a title without a case id is rejected', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
    await expect(page).toHaveTitle('x');
  });

  t('[TC-03] Validate that a test asserting nothing is rejected', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
  });
});
