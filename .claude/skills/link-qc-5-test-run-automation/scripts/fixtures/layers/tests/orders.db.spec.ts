// Clean DB test (TC-03 db) — no layer rule may fire. Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';

test.describe('REQ-014: orders DB', () => {
  test('[TC-03] the order status is stored', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-3');
    await ordersDb.expectStatus('A-3', 'Pending');
    await captureRecord(testInfo);
  });
});
