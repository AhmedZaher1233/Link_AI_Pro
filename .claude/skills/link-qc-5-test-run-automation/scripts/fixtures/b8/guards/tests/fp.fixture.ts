// B8 guards — FALSE-POSITIVE GUARD: both guards attached in a file-level beforeEach and reported in afterEach.
import { test, expect } from '@playwright/test';
import { attachConsoleGuard } from '../helpers/console-guard';
import { attachNetworkGuard } from '../helpers/network-guard';
import { captureEvidence } from '../../../helpers/evidence.fixture';
import { ThingPage } from '../../../pages/thing.page.fixture';

let guard: { report(i: unknown): Promise<unknown> };
let net: { report(i: unknown): Promise<unknown> };
test.beforeEach(async ({ page }, testInfo) => { guard = attachConsoleGuard(page); net = await attachNetworkGuard(page, testInfo); });
test.afterEach(async ({}, testInfo) => { await guard.report(testInfo); await net.report(testInfo); });

test.describe('REQ-014: guards attached', () => {
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });

  test('[TC-02] Validate that the thing is listed', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Beta')).toHaveText('Beta');
  });
});
