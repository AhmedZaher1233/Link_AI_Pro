// False-negative guards: obfuscated raw requests are still caught (TC-04 is hybrid, in a browser spec). Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';
import { captureEvidence } from '../helpers/evidence';

test.describe('REQ-014: obfuscated requests', () => {
  test('[TC-04] optional chaining, page.request, globalThis.fetch', async ({ request, page }, testInfo) => {
    await request // expect: api-raw-request
      ?.get('/api/orders');
    await page.request.post('/api/orders', {}); // expect: api-raw-request
    await globalThis.fetch('/api/orders'); // expect: api-raw-request
    await captureEvidence(page, testInfo);
    await captureRecord(testInfo);
  });
});
