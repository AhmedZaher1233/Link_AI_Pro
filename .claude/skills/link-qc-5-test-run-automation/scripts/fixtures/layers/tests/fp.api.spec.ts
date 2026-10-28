// False-positive guards — no layer / API / DB rule may fire here. Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';

test.describe('REQ-014: data-shaped code', () => {
  test('[TC-01] chains on data, SQL-looking words, a token from the environment', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.search('Select a country from the list');
    const body = { items: { count: () => 1, first: () => 1 } };
    body.items.count();
    body.items.first();
    const header = { authorization: process.env.API_TOKEN };
    void [r, header];
    await ordersApi.expectStatus(r, 200);
    await captureRecord(testInfo);
  });
});
