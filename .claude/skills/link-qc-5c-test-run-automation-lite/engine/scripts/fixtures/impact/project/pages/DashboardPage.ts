import { BasePage } from './BasePage';
import { OrderPage } from './OrderPage';

export class DashboardPage extends BasePage {
  readonly ordersLink = this.page.getByRole('link', { name: 'Orders' });
  readonly greeting = this.page.getByTestId('greeting');

  async openOrders(): Promise<OrderPage> {
    await this.ordersLink.click();
    return new OrderPage(this.page);
  }

  async greetingText(): Promise<string> {
    return (await this.greeting.textContent()) ?? '';
  }
}
