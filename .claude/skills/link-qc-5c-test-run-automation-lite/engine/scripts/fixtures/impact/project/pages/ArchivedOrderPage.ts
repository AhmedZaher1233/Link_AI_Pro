import { OrderPage } from './OrderPage';

const ARCHIVE_ROUTE = '/orders/archived';

export class ArchivedOrderPage extends OrderPage {
  readonly restoreButton = this.page.getByRole('button', { name: 'Restore' });

  async goto(): Promise<this> {
    await this.open(ARCHIVE_ROUTE);
    return this;
  }

  async restore(): Promise<void> {
    await this.restoreButton.click();
    await this.save();
  }
}
