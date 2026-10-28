// API true positives — every finding line carries an `expect:` marker the harness reads. Never executed.
import { test } from '../fixtures/test';
import { Client } from 'pg'; // expect: db-driver-import
import { OrdersApi } from '../api/OrdersApi';
import { captureRecord } from '../helpers/record';

test.describe('REQ-014: API violations', () => {
  test('[TC-01] raw requests in the body', async ({ request }) => { // expect: api-raw-request, record-unresolved
    const r = await request.post('/api/orders', { data: { name: 'x' } }); // expect: api-raw-request
    const client = new OrdersApi(request as never);
    await fetch('https://example.test/api/orders'); // expect: api-raw-request
    const auth = { headers: { authorization: 'Bearer abcdefghijklmnop' } }; // expect: api-secret-header
    void [r, client, auth, Client];
  });

  test('[TC-01] redirects followed', async ({ ordersApi }, testInfo) => {
    const opts = { maxRedirects: 3 }; // expect: api-redirect-enabled
    void opts;
    await ordersApi.expectStatus(await ordersApi.search('x'), 200);
    await captureRecord(testInfo);
  });

  test('[TC-01] no record captured', async ({ ordersApi }) => { // expect: record-missing
    const r = await ordersApi.create('x');
    await ordersApi.expectStatus(r, 201);
  });

  test('[TC-01] two records', async ({ ordersApi }, testInfo) => {
    await ordersApi.expectStatus(await ordersApi.create('x'), 201);
    await captureRecord(testInfo);
    await captureRecord(testInfo); // expect: record-duplicate
  });

  test.afterEach(async ({}, testInfo) => { await captureRecord(testInfo); }); // expect: record-in-hook
});
