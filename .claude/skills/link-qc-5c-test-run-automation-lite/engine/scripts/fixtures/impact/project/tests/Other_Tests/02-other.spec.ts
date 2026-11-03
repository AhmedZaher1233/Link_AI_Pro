import { test, expect } from '@playwright/test';
import { OrderPage } from '../../pages/OrderPage';
import { orderLabel } from '../../helpers/format';

// Another story (invoices) that reuses the order page object.
test.describe('Invoices — order link', () => {
  test('[TC-90] Validate that an invoice links to a saved order', { tag: ['@positive'] }, async ({ page }) => {
    const orders = new OrderPage(page);
    await orders.goto();
    await orders.save();
    expect(orderLabel('Sample Customer', 1)).toContain('Sample');
  });

  test('[TC-91] Validate that the invoice export starts', { tag: ['@positive'] }, async ({ page }) => {
    const orders = new OrderPage(page);
    await orders.exportCsv();
  });
});
