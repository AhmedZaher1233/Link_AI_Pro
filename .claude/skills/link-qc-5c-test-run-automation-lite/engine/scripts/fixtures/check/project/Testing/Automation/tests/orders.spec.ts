import { test, expect } from '@playwright/test';
import { OrdersPage } from '../pages/OrdersPage';
import { captureEvidence } from '../helpers/evidence';

const LABELS = { saved: 'Saved' };

test.describe('REQ-001: an order can be created and listed', () => {
  test('[TC-01] Validate that a new order appears in the list', async ({ page }, testInfo) => {
    const orders = new OrdersPage(page);
    await orders.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(orders.nameCell('Alpha')).toHaveText('Alpha');
  });

  test('[TC-02] Validate that the save confirmation is shown', async ({ page }, testInfo) => {
    const orders = new OrdersPage(page);
    await orders.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(orders.nameCell('Beta')).toHaveText(LABELS.saved);
  });
});
