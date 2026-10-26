import { test, expect } from '../../fixtures/test';
import { OrdersPage } from '../../pages/OrdersPage';
import { InfoPage } from '../../pages/InfoPage';
import { LoginPage } from '../../pages/LoginPage';

// REQ-ORD-05 — a seeded order, maintenance, layouts, a system setting and the Approver account.
test('[TC-30] Validate that a seeded order can be approved', { tag: ['@positive', '@run:serial-orders'] }, async ({ page, signedIn, seededOrder }) => {
  const orders = new OrdersPage(page);
  await orders.openOrder(seededOrder);
  await orders.approveOrder();
  await expect(orders.banner).toHaveText('Approved');
});

test('[TC-31] Validate that the clean-up job can be run', { tag: ['@positive', '@run:serial-maintenance'] }, async ({ page, signedIn }) => {
  const info = new InfoPage(page);
  await info.openMaintenance();
  await info.runCleanUp();
  await expect(info.confirmation).toBeVisible();
});

for (const variant of ['compact', 'wide']) {
  test(`[TC-32] Validate that the ${variant} layout is shown`, { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn }) => {
    const orders = new OrdersPage(page);
    await orders.open();
    await orders.switchLayout(variant);
    await expect(orders.banner).toBeVisible();
  });
}

test('[TC-33] Validate that the date format setting can be changed', { tag: ['@positive', '@run:serial-maintenance'] }, async ({ page, signedIn }) => {
  const info = new InfoPage(page);
  await info.openSystemSettings();
  await info.changeDateFormat('YYYY-MM-DD');
  await info.save();
  await expect(info.confirmation).toBeVisible();
});

test('[TC-34] Validate that a wrong password is rejected for the Approver', { tag: ['@negative', '@run:serial-account-a2'] }, async ({ page }) => {
  const login = new LoginPage(page);
  await login.loginWithWrongPassword('A2');
  await expect(login.error()).toBeVisible();
});

test('[TC-35] Validate that the Approver dashboard shows the welcome message', { tag: ['@positive', '@run:serial-account-a2'] }, async ({ page }) => {
  const login = new LoginPage(page);
  await login.login('A2');
  const info = new InfoPage(page);
  await info.openDashboard();
  await expect(info.welcome).toBeVisible();
});
