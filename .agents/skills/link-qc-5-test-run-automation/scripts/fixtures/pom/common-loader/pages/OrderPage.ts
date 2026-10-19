// Fixture: two unrelated pages that share exactly ONE locator (the application loader) — not a duplicate.
import { expect, type Page, type Locator } from '@playwright/test';

export class OrderPage {
  readonly loader: Locator;
  readonly saveButton: Locator;
  readonly statusBadge: Locator;

  constructor(private readonly page: Page) {
    this.loader = page.getByTestId('app-loader');
    this.saveButton = page.getByRole('button', { name: 'Save order' });
    this.statusBadge = page.getByTestId('order-status');
  }

  async open() {
    await this.page.goto('/orders/new');
    await expect(this.loader).toBeHidden();
  }
}
