// Fixture page object for selftest-check.mjs. Never executed by Playwright.
import { type Page, type Locator } from '@playwright/test';

export class OrdersPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async create(name: string) {
    await this.page.getByTestId('order-name').fill(name);
    await this.page.getByTestId('order-save').click();
  }

  nameCell(name: string): Locator {
    return this.page.getByTestId('order-row-' + name);
  }
}
