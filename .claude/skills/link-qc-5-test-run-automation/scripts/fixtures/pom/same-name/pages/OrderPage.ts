// Fixture: the ORDER screen page object. A second class with the same name lives in checkout/.
import { expect, type Page, type Locator } from '@playwright/test';

export class OrderPage {
  readonly saveButton: Locator;
  readonly statusBadge: Locator;

  constructor(private readonly page: Page) {
    this.saveButton = page.getByRole('button', { name: 'Save order' });
    this.statusBadge = page.getByTestId('order-status');
  }

  async open() {
    await this.page.goto('/orders/new');
  }

  async expectStatus(status: string) {
    await expect(this.statusBadge).toHaveText(status);
  }
}
