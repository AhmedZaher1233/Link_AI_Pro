// Fixture page object for the validator self-test. Never executed by Playwright.
import { expect, test, type Page, type Locator } from '@playwright/test';
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

  // Used by the timing fixtures (cases 14-16).
  rows(): Locator {
    return this.page.getByTestId('thing-rows');
  }

  async open(options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }) {
    await this.page.goto('/things', options);
  }

  async waitForLoaded() {
    await expect(this.page.getByTestId('thing-loader')).toBeHidden();
  }

  // A step INSIDE the page object: must NOT satisfy step-missing for the spec that calls it.
  async createStepped(name: string) {
    await test.step('create ' + name, async () => {
      await this.create(name);
    });
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
