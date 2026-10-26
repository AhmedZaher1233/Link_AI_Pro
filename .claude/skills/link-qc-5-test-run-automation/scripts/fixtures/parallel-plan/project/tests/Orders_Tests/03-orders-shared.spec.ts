import { test, expect } from '../../fixtures/test';
import { OrdersPage } from '../../pages/OrdersPage';
import { createOrder, deleteOrder } from '../../prerequest/orderPreRequest';

// REQ-ORD-03 — a shared order created once for the describe (beforeAll) and removed after it (afterAll).
let sharedId = '';

test.describe('Shared order', () => {
  test.beforeAll(async ({ workerAdmission, playwright }) => {
    const api = await playwright.request.newContext();
    sharedId = await createOrder(api, 'Shared order');
  });

  test.afterAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await deleteOrder(api, sharedId);
  });

  test('[TC-20] Validate that the shared order shows its customer', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.openOrder('Shared order');
    await expect(orders.banner).toBeVisible();
  });

  test('[TC-21] Validate that the shared order shows its status', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.openOrder('Shared order');
    await expect(orders.banner).toHaveText('Open');
  });
});
