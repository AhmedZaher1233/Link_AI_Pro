// B8 timeout-literal — TRUE POSITIVES (check 43): inline timeout values outside timeouts.ts.
import { expect, test, type Page } from '@playwright/test';

export class SlowPage {
  constructor(private readonly page: Page) {}

  async waitSaved() {
    await expect(this.page.getByTestId('saved')).toBeVisible({ timeout: 20_000 });
    await this.page.waitForURL('/saved', { waitUntil: 'load', timeout: 45000 });
  }

  async longOne() {
    test.setTimeout(300000);
    await expect(this.page.getByTestId('report')).toBeVisible({ timeout: 0 });
  }
}
