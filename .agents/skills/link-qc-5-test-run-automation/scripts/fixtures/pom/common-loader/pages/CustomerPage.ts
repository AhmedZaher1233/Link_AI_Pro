// Fixture: shares only the loader locator with OrderPage.
import { expect, type Page, type Locator } from '@playwright/test';

export class CustomerPage {
  readonly loader: Locator;
  readonly nameField: Locator;
  readonly createButton: Locator;

  constructor(private readonly page: Page) {
    this.loader = page.getByTestId('app-loader');
    this.nameField = page.getByLabel('Customer name');
    this.createButton = page.getByRole('button', { name: 'Create customer' });
  }

  async open() {
    await this.page.goto('/customers/new');
    await expect(this.loader).toBeHidden();
  }
}
