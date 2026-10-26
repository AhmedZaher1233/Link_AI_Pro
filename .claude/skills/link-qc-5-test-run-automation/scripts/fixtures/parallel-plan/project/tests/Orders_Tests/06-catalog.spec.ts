import { test, expect } from '../../fixtures/test';
import { InfoPage } from '../../pages/InfoPage';

// REQ-CAT-01 — a catalog created once per worker by the catalog fixture.
test.describe('Catalog', () => {
  test('[TC-40] Validate that the catalog shows its name', { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn, catalog }) => {
    const info = new InfoPage(page);
    await info.openCatalog(catalog);
    await expect(info.catalogName).toBeVisible();
  });

  test('[TC-41] Validate that the catalog shows its currency', { tag: ['@positive', '@run:parallel'] }, async ({ page, signedIn, catalog }) => {
    const info = new InfoPage(page);
    await info.openCatalog(catalog);
    await expect(info.catalogCurrency).toBeVisible();
  });
});
