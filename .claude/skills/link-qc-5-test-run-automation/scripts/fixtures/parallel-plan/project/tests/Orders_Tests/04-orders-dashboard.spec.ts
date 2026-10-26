import { test, expect } from '../../fixtures/test';
import { OrdersPage } from '../../pages/OrdersPage';

// REQ-ORD-04 — the dashboard's order count (an aggregate over every order).
test('[TC-04] Validate that the dashboard shows the order count', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn }) => {
  const orders = new OrdersPage(page);
  await orders.open();
  expect(await orders.orderCount()).toBeGreaterThan(0);
});
