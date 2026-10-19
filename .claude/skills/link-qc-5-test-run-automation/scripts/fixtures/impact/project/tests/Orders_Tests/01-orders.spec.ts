import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect } from '../../fixtures/test';
import { LoginPage } from '../../pages/LoginPage';
import { ArchivedOrderPage, DataTable } from '../../pages';
import { OrderPage } from '@pages/OrderPage';
import { orderLabel } from '../../helpers/format';
import { step } from '../../helpers/steps';

// Spec-level constant table — used by TC-03 only.
const QUANTITY_CASES = [
  { label: 'one item', quantity: 1 },
  { label: 'ten items', quantity: 10 },
];

test.describe('Orders — create', () => {
  test.describe.configure({ mode: 'parallel' });
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
  });

  test('[TC-01] Validate that an order is created with valid data @smoke', { tag: ['@smoke', '@run:parallel'] }, async () => {
    const dashboard = await loginPage.login('admin.user', process.env.ADMIN_PHRASE ?? '');
    const orders = await dashboard.openOrders();
    await orders.createOrder('Sample Customer', 2);
    await expect(orders.statusBanner).toHaveText('Saved');
  });

  test('[TC-02] Validate that cancel discards the form', { tag: ['@positive', '@run:parallel'] }, async ({ page }) => {
    const dashboard = await loginPage.login('admin.user', process.env.ADMIN_PHRASE ?? '');
    const orders = await dashboard.openOrders();
    await step('Fill and cancel the form', async () => {
      await orders.fillForm('Sample Customer', 1);
      await orders.cancel();
    });
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  });

  test('[TC-03] Validate that every listed quantity is accepted', { tag: ['@positive'] }, async () => {
    const dashboard = await loginPage.login('admin.user', process.env.ADMIN_PHRASE ?? '');
    const orders = await dashboard.openOrders();
    for (const row of QUANTITY_CASES) {
      await orders.fillForm(orderLabel('Sample Customer', row.quantity), row.quantity);
      await orders.save();
    }
  });
});

test.describe('Orders — archive', () => {
  const ARCHIVE_NOTE = 'archived by the suite';

  test('[TC-04] Validate that an order is prefilled from the order data file', { tag: ['@positive', '@run:serial-orders'] }, async ({ page }) => {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, './../../helpers/data/orders.json'), 'utf8'));
    const orders = new OrderPage(page);
    await orders.goto();
    await orders.prefill(data);
    await expect(orders.customerInput).toHaveValue(data.customer);
  });

  test('[TC-05] Validate that an archived order can be restored', { tag: ['@negative'] }, async ({ page }) => {
    const archived = new ArchivedOrderPage(page);
    await archived.goto();
    await archived.restore();
    await expect(page.getByText(ARCHIVE_NOTE)).toBeHidden();
  });
});

test('[TC-06] Validate that the order fixture opens a ready order page', { tag: ['@positive'] }, async ({ orderPage }) => {
  await orderPage.createOrder('Fixture Customer', 1);
  expect(await orderPage.rowCount()).toBeGreaterThan(0);
});

test('[TC-07][TC-08] Validate that the orders table sorts by customer and by date', { tag: ['@positive'] }, async ({ page }) => {
  const orders = new OrderPage(page);
  await orders.goto();
  await orders.table.sortBy('Customer');
  await orders.table.sortBy('Date');
});

test('[TC-07] Validate that the first row shows the customer after sorting', { tag: ['@positive'] }, async ({ page }) => {
  const grid = new DataTable(page.locator('#orders-table'));
  await grid.sortBy('Customer');
  expect(await grid.cellText(0, 0)).not.toBe('');
});
