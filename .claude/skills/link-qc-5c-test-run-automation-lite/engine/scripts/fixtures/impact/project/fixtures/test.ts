import { test as base, expect } from '@playwright/test';
import { OrderPage } from '../pages/OrderPage';
import { LoginPage } from '../pages/LoginPage';

/** Project fixtures: a signed-in session and an open order page. */
export const test = base.extend<{ orderPage: OrderPage; signedIn: LoginPage }>({
  signedIn: async ({ page }, use) => {
    const login = new LoginPage(page);
    await login.login('admin.user', process.env.ADMIN_PHRASE ?? '');
    await use(login);
  },
  orderPage: async ({ page, signedIn }, use) => {
    const orders = new OrderPage(page);
    await orders.goto();
    await use(orders);
  },
});

export { expect };
