// Fixture: a twin written by a later run — numeric file prefix, plural / lower-case class name.
import { expect, type Page, type Locator } from '@playwright/test';

export class ListingPages {
  readonly cards: Locator;

  constructor(private readonly page: Page) {
    this.cards = page.getByTestId('listing-card');
  }

  async open() {
    await this.page.goto('/listings/cards');
  }

  async expectCardsVisible() {
    await expect(this.cards.first()).toBeVisible();
  }
}
