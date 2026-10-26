import { test, expect } from '../../fixtures/test';
import { OrdersPage } from '../../pages/OrdersPage';
import { InfoPage } from '../../pages/InfoPage';
import { uniqueName } from '../../helpers/test-data';

// REQ-ORD-01 — orders and information screens; every test signs in through the signedIn fixture.
test.describe('Orders — own data', () => {
  test('[TC-01] Validate that an order is created with valid data', { tag: ['@smoke', '@positive', '@run:parallel'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.createOrder(uniqueName('order'), 2);
    await expect(orders.banner).toHaveText('Saved');
  });

  test('[TC-02] Validate that the Sample price list shows its products', { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn }) => {
    const info = new InfoPage(page);
    await info.openPriceList('Sample');
    expect(await info.productCount()).toBe(12);
  });

  test('[TC-03] Validate that the help page shows the version label', { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn }) => {
    const info = new InfoPage(page);
    await info.openHelp();
    await expect(info.versionLabel).toBeVisible();
  });

  test('[TC-05] Validate that the About dialog shows the product name', { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn }) => {
    const info = new InfoPage(page);
    await info.openAbout();
    await expect(info.productName).toBeVisible();
  });

  test('[TC-06] Validate that the audit log lists the latest order entry', { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn }) => {
    const info = new InfoPage(page);
    await info.openAuditLog();
    await info.searchLatest('order');
    await expect(info.latestEntry).toBeVisible();
  });
});
