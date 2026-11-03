import type { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { DashboardPage } from './DashboardPage';

export class LoginPage extends BasePage {
  readonly username: Locator;
  readonly passphrase: Locator;
  readonly submit: Locator;

  constructor(page: Page) {
    super(page);
    this.username = page.getByLabel('Username');
    this.passphrase = page.getByLabel('Passphrase');
    this.submit = page.getByRole('button', { name: 'Sign in' });
  }

  async login(user: string, phrase: string): Promise<DashboardPage> {
    await this.open('/login');
    await this.username.fill(user);
    await this.passphrase.fill(phrase);
    await this.submit.click();
    return new DashboardPage(this.page);
  }
}
