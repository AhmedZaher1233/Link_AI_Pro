// Fixture: the dashboard page object (the whole screen).
import { expect, type Page, type Locator } from '@playwright/test';

export class DashboardPage {
  readonly heading: Locator;
  readonly filterPanel: Locator;

  constructor(private readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Dashboard' });
    this.filterPanel = page.getByTestId('dashboard-filters');
  }

  async open() {
    await this.page.goto('/dashboard');
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible();
  }
}
