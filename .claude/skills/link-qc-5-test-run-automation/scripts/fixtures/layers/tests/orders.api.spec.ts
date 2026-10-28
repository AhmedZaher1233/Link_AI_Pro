// Clean API and API+DB tests (TC-01 api, TC-02 api+db) — no layer rule may fire. Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';

test.describe('REQ-014: orders API', () => {
  test('[TC-01] create an order', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.create('A-1');
    await ordersApi.expectStatus(r, 201);
    await captureRecord(testInfo);
  });

  test('[TC-02] the created order is stored', async ({ ordersApi, ordersDb }, testInfo) => {
    const r = await ordersApi.create('A-2');
    await ordersApi.expectStatus(r, 201);
    await ordersDb.expectStatus('A-2', 'Pending');
    await captureRecord(testInfo);
  });
});
