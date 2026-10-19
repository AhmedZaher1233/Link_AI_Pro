import type { Page } from '@playwright/test';
import { step } from '../helpers/steps';

export class BasePage {
  constructor(protected readonly page: Page) {}

  async open(route: string): Promise<void> {
    await step('Open ' + route, async () => {
      await this.page.goto(route);
    });
  }

  async heading(): Promise<string> {
    return (await this.page.getByRole('heading', { level: 1 }).textContent()) ?? '';
  }
}
