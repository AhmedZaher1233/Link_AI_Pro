// Fixture page object for the layer cases.
import { expect, type Page } from '@playwright/test';
export class OrdersPage {
  constructor(private readonly page: Page) {}
  async open() { await this.page.goto('/orders'); }
  async create(name: string) { await this.page.getByTestId('order-name').fill(name); await this.page.getByRole('button', { name: 'Save' }).click(); }
  async expectListed(name: string) { await expect(this.page.getByText(name)).toBeVisible(); }
}
