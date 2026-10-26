import { test, expect } from '../../fixtures/test';
import { OrdersPage } from '../../pages/OrdersPage';

// REQ-ORD-02 — one order's lifecycle: each case works on the order the previous one created (a true chain).
const LIFECYCLE = 'Lifecycle order';

test.describe.serial('Order lifecycle', () => {
  test('[TC-10] Validate that the lifecycle order is created', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.createOrder(LIFECYCLE, 1);
    await expect(orders.banner).toHaveText('Saved');
  });

  test('[TC-11] Validate that the lifecycle order quantity can be changed', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.openOrder(LIFECYCLE);
    await orders.changeQuantity(3);
    await expect(orders.banner).toHaveText('Saved');
  });

  test('[TC-12] Validate that the lifecycle order can be deleted', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.openOrder(LIFECYCLE);
    await orders.deleteOrder();
    await expect(orders.banner).toHaveText('Deleted');
  });
});
