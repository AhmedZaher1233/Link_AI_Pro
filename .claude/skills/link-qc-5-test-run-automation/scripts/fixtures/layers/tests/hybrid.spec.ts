// Clean hybrid test (TC-04: UI action, then a DB check) and a clean UI test (TC-05) — no layer rule may fire. Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';
import { captureEvidence } from '../helpers/evidence';
import { OrdersPage } from '../pages/OrdersPage';

test.describe('REQ-014: orders hybrid', () => {
  test('[TC-04] an order saved in the UI is stored', async ({ ordersPage, ordersDb }, testInfo) => {
    await ordersPage.open();
    await ordersPage.create('A-4');
    await ordersPage.expectListed('A-4');
    await captureEvidence(ordersPage, testInfo);
    await ordersDb.expectStatus('A-4', 'Pending');
    await captureRecord(testInfo);
  });

  test('[TC-05] the orders list opens', async ({ page }, testInfo) => {
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.expectListed('A-1');
    await captureEvidence(page, testInfo);
  });
});
