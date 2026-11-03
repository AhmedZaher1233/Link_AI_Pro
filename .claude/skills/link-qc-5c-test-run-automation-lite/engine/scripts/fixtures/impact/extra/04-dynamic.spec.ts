import { test } from '@playwright/test';
import { OrderPage } from '../../pages/OrderPage';

// Copied into tests/Dynamic_Tests/ by selftest-impact.mjs case 12 only — never part of the clean project.
test('[TC-80] Validate that an action chosen at run time runs', async ({ page }) => {
  const orders = new OrderPage(page);
  const action = 'cancel';
  await (orders as any)[action]();
});

test('[TC-81] Validate that a statically named action runs', async ({ page }) => {
  const orders = new OrderPage(page);
  await orders.cancel();
});
