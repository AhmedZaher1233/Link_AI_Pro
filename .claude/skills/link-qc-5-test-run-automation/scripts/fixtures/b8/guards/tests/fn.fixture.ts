// B8 guards — FALSE-NEGATIVE GUARDS: a handle that is not kept, a guard never reported, a guard only in the test body.
import { test, expect } from '@playwright/test';
import { attachConsoleGuard } from '../helpers/console-guard';
import { attachNetworkGuard } from '../helpers/network-guard';
import { captureEvidence } from '../../../helpers/evidence.fixture';
import { ThingPage } from '../../../pages/thing.page.fixture';

test.describe('REQ-014: half-attached guards', () => {
  let net: { report(i: unknown): Promise<unknown> };
  test.beforeEach(async ({ page }, testInfo) => { attachConsoleGuard(page); net = await attachNetworkGuard(page, testInfo); });
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});

test.describe('REQ-014: guard only in the test body', () => {
  test('[TC-02] Validate that the thing is listed', async ({ page }, testInfo) => {
    const guard = attachConsoleGuard(page);
    const thing = new ThingPage(page);
    await thing.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Beta')).toHaveText('Beta');
    await guard.report(testInfo);
  });
});
