// Fixture: a page object for ONE widget on the same route — legitimately shares the route.
import { expect, type Page, type Locator } from '@playwright/test';

export class DashboardWidgetPage {
  readonly kpiTile: Locator;
  readonly refreshButton: Locator;

  constructor(private readonly page: Page) {
    this.kpiTile = page.getByTestId('kpi-tile');
    this.refreshButton = page.getByRole('button', { name: 'Refresh KPI' });
  }

  async open() {
    await this.page.goto('/dashboard');
  }

  async expectKpi(value: string) {
    await expect(this.kpiTile).toHaveText(value);
  }
}
