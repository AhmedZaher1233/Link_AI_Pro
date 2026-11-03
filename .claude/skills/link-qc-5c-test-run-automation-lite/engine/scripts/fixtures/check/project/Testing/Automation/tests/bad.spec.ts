import { test, expect } from '@playwright/test';
import { captureEvidence } from '../helpers/evidence';

test.describe('REQ-001: the order list opens', () => {
  test.only('[TC-01] Validate that the order list opens', async ({ page }, testInfo) => {
    await page.locator('#orders').click();
    await captureEvidence(page, testInfo);
    await expect(page.locator('#orders')).toBeVisible();
  });
});
