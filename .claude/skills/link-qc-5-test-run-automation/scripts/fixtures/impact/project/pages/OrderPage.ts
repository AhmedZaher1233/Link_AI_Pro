import type { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { DataTable } from './components/DataTable';
import { TIMEOUTS } from '../timeouts';

export class OrderPage extends BasePage {
  readonly customerInput: Locator;
  readonly quantityInput: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly statusBanner: Locator;
  readonly table = new DataTable(this.page.locator('#orders-table'));
  private readonly route = '/orders';

  constructor(page: Page) {
    super(page);
    this.customerInput = page.getByLabel('Customer');
    this.quantityInput = page.getByLabel('Quantity');
    this.saveButton = page.getByRole('button', { name: 'Save' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
    this.statusBanner = page.getByRole('status');
  }

  async goto(): Promise<this> {
    await this.open(this.route);
    return this;
  }

  async fillForm(customer: string, quantity: number): Promise<void> {
    await this.customerInput.fill(customer);
    await this.quantityInput.fill(String(quantity));
  }

  async save(): Promise<void> {
    await this.saveButton.click();
    await this.statusBanner.waitFor({ timeout: TIMEOUTS.operations.save });
  }

  async createOrder(customer: string, quantity: number): Promise<void> {
    await this.fillForm(customer, quantity);
    await this.save();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async prefill(order: { customer: string; quantity: number }): Promise<void> {
    await this.customerInput.fill(order.customer);
    await this.quantityInput.fill(String(order.quantity));
  }

  async rowCount(): Promise<number> {
    return this.table.count();
  }

  async exportCsv(): Promise<void> {
    await this.page.getByRole('button', { name: 'Export' }).click();
  }
}
