import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../pages/DashboardPage';

test('[TC-09] Validate that the dashboard greets the user', { tag: ['@smoke'] }, async ({ page }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.open('/');
  expect(await dashboard.greetingText()).not.toBe('');
});

test('[TC-10] Validate that the dashboard opens the orders table', { tag: ['@positive'] }, async ({ page }) => {
  const dashboard = new DashboardPage(page);
  const orders = await dashboard.openOrders();
  await orders.table.sortBy('Date');
});
