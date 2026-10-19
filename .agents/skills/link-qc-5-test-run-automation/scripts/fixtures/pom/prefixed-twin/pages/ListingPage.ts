// Fixture: the listing page object.
import { expect, type Page, type Locator } from '@playwright/test';

export class ListingPage {
  readonly grid: Locator;

  constructor(private readonly page: Page) {
    this.grid = page.getByTestId('listing-grid');
  }

  async open() {
    await this.page.goto('/listings');
  }

  async expectGridVisible() {
    await expect(this.grid).toBeVisible();
  }
}
