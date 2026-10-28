// selftest-api-db.mjs — API test cases (backend project). The harness decides consent / targets per run and reads the
// JSON report, the records, the ledger and the foreign server's request count. Never run outside the harness.
import { test } from '../fixtures';
import { captureRecord } from '../helpers/record';

test.describe('REQ-API: orders API', () => {
  test('[TC-01] create an order (mutation, consented)', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.create('A-1');
    await ordersApi.expectStatus(r, 201, 'ER1');
    await ordersApi.expectBody(r, 'name', 'A-1', 'ER2');
    await captureRecord(testInfo);
  });
  test('[TC-02] a negative response is a normal assertion', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.bad();
    await ordersApi.expectStatus(r, 400, 'ER1');
    await ordersApi.expectBody(r, 'error.code', 'VALIDATION', 'ER2');
    await captureRecord(testInfo);
  });
  test('[TC-03] a POST search mapped read needs no consent', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.search('A');
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-04] a POST with an unknown effect is gated like a mutation', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.createUnknown('A-4');
    await ordersApi.expectStatus(r, 201, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-05] a GET mapped mutation is gated', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.touch('1');
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-06] a PUT on an id this run did not create is refused', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.rename('pre-1', 'X');
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-07] a mutation 307 to a foreign host is never sent there', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.redirectForeign();
    await ordersApi.expectStatus(r, 201, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-08] a mutation answered 303 is not re-sent', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.redirect303();
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-09] a read redirect on the permitted host is followed', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.redirectOk();
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-10] a read redirect to a foreign host is refused', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.redirectForeignRead();
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-11] a target outside the permitted hosts is refused before sending', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.foreignHost();
    await ordersApi.expectStatus(r, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-12] an unexpected 401 is an auth failure, not a verdict', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.create('A-12', 'not-a-valid-token');
    await ordersApi.expectStatus(r, 201, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-13] a create then an update of the own record', async ({ ordersApi }, testInfo) => {
    const r = await ordersApi.create('A-13');
    const id = String((await r.json()).id);
    const u = await ordersApi.rename(id, 'A-13b');
    await ordersApi.expectStatus(u, 200, 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-14] a token returned by the API never reaches the record', async ({ ordersApi }, testInfo) => {
    const l = await ordersApi.login('qa.user');
    await ordersApi.expectStatus(l, 200, 'ER1');
    const r = await ordersApi.leak();
    await ordersApi.expectStatus(r, 200, 'ER2');
    await captureRecord(testInfo);
  });
  test('[TC-15] a PASS without its record', async ({ ordersApi }) => {
    const r = await ordersApi.search('A');
    await ordersApi.expectStatus(r, 200, 'ER1');
  });
});
