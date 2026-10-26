// B8 admission-contract — beforeAll: a side-effecting hook without workerAdmission fires; one that takes it does not.
import { test, expect } from '../helpers/admission';
import * as pre from '../prerequest/orderPreRequest';
import { captureEvidence } from '../../../helpers/evidence.fixture';
import { ThingPage } from '../../../pages/thing.page.fixture';

test.describe('REQ-014: hooks before admission', () => {
  test.beforeAll(async ({ browser }) => {
    await pre.createOrder(browser);
  });
  test('[TC-01] Validate that the order is listed', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});

test.describe('REQ-014: hooks after admission', () => {
  test.beforeAll(async ({ browser, workerAdmission }) => {
    await pre.createOrder(browser);
  });
  test('[TC-02] Validate that the second order is listed', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Beta')).toHaveText('Beta');
  });
});
