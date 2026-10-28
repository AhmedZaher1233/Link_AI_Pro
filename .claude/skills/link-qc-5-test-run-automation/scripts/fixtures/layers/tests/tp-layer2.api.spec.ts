// A UI test in a BACKEND spec file (the backend project has no browser). Never executed.
import { test } from '../fixtures/test';
import { captureEvidence } from '../helpers/evidence';
import { OrdersPage } from '../pages/OrdersPage';

test.describe('REQ-014: UI in a backend spec', () => {
  test('[TC-05] a UI test in a backend spec', async ({ page }, testInfo) => { // expect: layer-mismatch
    const o = new OrdersPage(page);
    await o.open();
    await o.expectListed('x');
    await captureEvidence(page, testInfo);
  });
});
