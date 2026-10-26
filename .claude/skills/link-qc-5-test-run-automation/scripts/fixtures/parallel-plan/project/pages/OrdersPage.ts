import type { Locator, Page } from '@playwright/test';

export class OrdersPage {
  readonly banner: Locator;

  constructor(private readonly page: Page) {
    this.banner = page.getByRole('status');
  }

  async open(): Promise<void> {
    await this.page.goto('/orders');
  }

  async createOrder(name: string, quantity: number): Promise<void> {
    await this.page.getByRole('button', { name: 'New order' }).click();
    await this.page.getByLabel('Name').fill(name);
    await this.page.getByLabel('Quantity').fill(String(quantity));
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  async openOrder(name: string): Promise<void> {
    await this.page.getByRole('link', { name }).click();
  }

  async changeQuantity(quantity: number): Promise<void> {
    await this.page.getByLabel('Quantity').fill(String(quantity));
    await this.page.getByRole('button', { name: 'Save' }).click();
  }

  async approveOrder(): Promise<void> {
    await this.page.getByRole('button', { name: 'Approve' }).click();
  }

  async deleteOrder(): Promise<void> {
    await this.page.getByRole('button', { name: 'Delete' }).click();
    await this.page.getByRole('button', { name: 'Confirm' }).click();
  }

  async orderCount(): Promise<number> {
    return Number(await this.page.getByTestId('order-count').textContent());
  }

  async switchLayout(variant: string): Promise<void> {
    await this.page.getByRole('radio', { name: variant }).check();
  }
}
