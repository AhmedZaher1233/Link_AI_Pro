// Fixture: the orders listing page object.
import { expect, type Page, type Locator } from '@playwright/test';

export class OrderListPage {
  readonly rows: Locator;
  readonly searchBox: Locator;

  constructor(private readonly page: Page) {
    this.rows = page.getByTestId('order-row');
    this.searchBox = page.getByLabel('Search orders');
  }

  async open() {
    await this.page.goto('/orders');
  }

  async expectRowCount(n: number) {
    await expect(this.rows).toHaveCount(n);
  }
}
