// Fixture page object for the validator self-test. Never executed by Playwright.
import { expect, type Page, type Locator } from '@playwright/test';
import { captureEvidence } from '../helpers/evidence.fixture';

export class ThingPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async create(name: string) {
    await this.page.getByTestId('thing-name').fill(name);
    await this.page.getByTestId('thing-save').click();
  }

  nameCell(name: string): Locator {
    return this.page.getByTestId('thing-row-' + name);
  }

  // Invoked by indirect.fixture.ts — holds both the assertion and the evidence call.
  async verifyCreated(testInfo: unknown, name: string) {
    await captureEvidence(this.page, testInfo);
    await expect(this.nameCell(name)).toHaveText(name);
  }

  // Never invoked by any fixture spec. Presence here must NOT rescue a spec.
  async unusedVerify(testInfo: unknown, name: string) {
    await captureEvidence(this.page, testInfo);
    await expect(this.nameCell(name)).toBeVisible();
  }

  // Invoked by conditional.fixture.ts — the assertion sits behind a guard.
  async verifyWhenPresent(name: string, present: boolean) {
    if (present) {
      await expect(this.nameCell(name)).toHaveText(name);
    }
  }
}
