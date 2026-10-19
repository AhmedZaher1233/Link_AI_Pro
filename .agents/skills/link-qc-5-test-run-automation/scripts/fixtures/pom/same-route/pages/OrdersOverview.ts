// Fixture: a second page object for the SAME route under another name — a reuse candidate.
import { expect, type Page, type Locator } from '@playwright/test';

export class OrdersOverview {
  readonly heading: Locator;
  readonly exportButton: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Orders' });
    this.exportButton = page.getByRole('button', { name: 'Export' });
  }

  async open() {
    await this.page.goto('/orders');
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }
}
