import type { Locator, Page } from '@playwright/test';

/** Help, About, price lists, the audit log, maintenance, system settings, dashboards and catalogs. */
export class InfoPage {
  readonly versionLabel: Locator;
  readonly productName: Locator;
  readonly latestEntry: Locator;
  readonly confirmation: Locator;
  readonly welcome: Locator;
  readonly catalogName: Locator;
  readonly catalogCurrency: Locator;

  constructor(private readonly page: Page) {
    this.versionLabel = page.getByTestId('version-label');
    this.productName = page.getByTestId('product-name');
    this.latestEntry = page.getByTestId('audit-latest');
    this.confirmation = page.getByRole('status');
    this.welcome = page.getByTestId('welcome');
    this.catalogName = page.getByTestId('catalog-name');
    this.catalogCurrency = page.getByTestId('catalog-currency');
  }

  async openHelp(): Promise<void> { await this.page.goto('/help'); }

  async openAbout(): Promise<void> { await this.page.getByRole('button', { name: 'About' }).click(); }

  async openPriceList(name: string): Promise<void> { await this.page.goto('/price-lists?name=' + encodeURIComponent(name)); }

  async productCount(): Promise<number> { return this.page.getByRole('row').count(); }

  async openAuditLog(): Promise<void> { await this.page.goto('/audit'); }

  async searchLatest(term: string): Promise<void> {
    await this.page.getByRole('searchbox').fill(term);
    await this.page.getByRole('button', { name: 'Search' }).click();
  }

  async openMaintenance(): Promise<void> { await this.page.goto('/maintenance'); }

  async runCleanUp(): Promise<void> { await this.page.getByRole('button', { name: 'Run clean-up' }).click(); }

  async openSystemSettings(): Promise<void> { await this.page.goto('/settings'); }

  async changeDateFormat(format: string): Promise<void> { await this.page.getByLabel('Date format').fill(format); }

  async save(): Promise<void> { await this.page.getByRole('button', { name: 'Save' }).click(); }

  async openDashboard(): Promise<void> { await this.page.goto('/dashboard'); }

  async openCatalog(id: string): Promise<void> { await this.page.goto('/catalogs/' + id); }
}
