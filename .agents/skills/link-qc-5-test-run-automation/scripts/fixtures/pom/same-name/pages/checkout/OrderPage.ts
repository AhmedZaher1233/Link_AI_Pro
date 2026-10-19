// Fixture: a SECOND class named OrderPage, written for the checkout flow — a duplicate by name.
import { expect, type Page, type Locator } from '@playwright/test';

export class OrderPage {
  readonly confirmButton: Locator;
  readonly totalCell: Locator;

  constructor(private readonly page: Page) {
    this.confirmButton = page.getByRole('button', { name: 'Confirm' });
    this.totalCell = page.getByTestId('checkout-total');
  }

  async open() {
    await this.page.goto('/checkout');
  }

  async expectTotal(total: string) {
    await expect(this.totalCell).toHaveText(total);
  }
}
