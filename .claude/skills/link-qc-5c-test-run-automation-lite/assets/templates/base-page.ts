// pages/BasePage.ts — Lite template (L17): what EVERY page shares lives here once — the readiness wait, the shell (header,
// side menu, toast, dialog) — and each page class extends it. A page class then holds only what identifies its own screen:
// its route, its root locator and its page-specific members. Checkpoint A's duplicate-page check compares exactly that; locators
// declared in a common base class or a shared component class are shared UI, not page identity. Copying a shared wait into
// every page makes unrelated pages look alike — put it here instead.
import { expect, type Locator, type Page } from '@playwright/test';
import { TIMEOUTS } from '../timeouts';

export abstract class BasePage {
  /** The route this page lives at (relative to baseURL) — page identity. */
  protected abstract readonly path: string;
  /** The element only this screen has — page identity. */
  abstract root(): Locator;

  constructor(protected readonly page: Page) {}

  /** The app's own "ready for input" signal, confirmed in the app source (a ready flag, a loader that disappears …). */
  protected readyMarker(): Locator {
    return this.page.locator('body'); // replace with the app's ready signal, e.g. an attribute the app sets when interactive
  }

  async open(): Promise<void> {
    await this.page.goto(this.path);
    await this.waitReady();
  }

  async waitReady(): Promise<void> {
    await expect(this.readyMarker()).toBeVisible({ timeout: TIMEOUTS.navigation });
    await expect(this.root()).toBeVisible({ timeout: TIMEOUTS.navigation });
  }
}
