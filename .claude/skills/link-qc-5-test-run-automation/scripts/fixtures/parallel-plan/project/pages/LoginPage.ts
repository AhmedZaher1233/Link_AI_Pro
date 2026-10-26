import type { Page } from '@playwright/test';

export class LoginPage {
  constructor(private readonly page: Page) {}

  /** Signs in with the account of a TEST-DATA id; the credentials come from the env layer. */
  async login(account: string): Promise<void> {
    await this.page.goto('/login');
    await this.page.getByLabel('Account').fill(account);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  /** Submits a value that is not the account's secret. */
  async loginWithWrongPassword(account: string): Promise<void> {
    await this.page.goto('/login');
    await this.page.getByLabel('Account').fill(account);
    await this.page.getByLabel('Secret').fill('not-the-right-value');
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  error() {
    return this.page.getByRole('alert');
  }
}
