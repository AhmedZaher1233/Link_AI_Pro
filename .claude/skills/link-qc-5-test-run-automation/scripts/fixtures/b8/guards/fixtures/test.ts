// Fixture test layer for the validator self-test: one automatic fixture attaches and reports both guards. Never executed.
import { test as base, expect } from '@playwright/test';
import { attachConsoleGuard } from '../helpers/console-guard';
import { attachNetworkGuard } from '../helpers/network-guard';

export const test = base.extend<{ guards: void }>({
  guards: [async ({ page }, use, testInfo) => {
    const guard = attachConsoleGuard(page);
    const net = await attachNetworkGuard(page, testInfo);
    await use();
    await guard.report(testInfo);
    await net.report(testInfo);
  }, { auto: true }],
});
export { expect };
