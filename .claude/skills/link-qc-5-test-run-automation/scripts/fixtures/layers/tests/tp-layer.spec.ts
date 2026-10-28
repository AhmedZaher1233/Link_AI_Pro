// Layer true positives in a BROWSER spec file — every finding line carries an `expect:` marker. Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';

test.describe('REQ-014: layer violations', () => {
  test('[TC-01] an API test in a browser spec', async ({ ordersApi }, testInfo) => { // expect: layer-mismatch
    await ordersApi.expectStatus(await ordersApi.create('x'), 201);
    await captureRecord(testInfo);
  });

  test('[TC-06] a UI test case implemented through the API', async ({ ordersApi }, testInfo) => { // expect: layer-mismatch
    await ordersApi.expectStatus(await ordersApi.get('A-1'), 200);
    await captureRecord(testInfo);
  });
});
