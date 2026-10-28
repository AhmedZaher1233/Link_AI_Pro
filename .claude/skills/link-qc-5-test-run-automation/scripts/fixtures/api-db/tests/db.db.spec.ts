// selftest-api-db.mjs — DB test cases (backend project) over the fake database. FAKE_DB_SCENARIOS makes the database
// misbehave per TC; the harness reads the report, the records and the ledger. Never run outside the harness.
import { test } from '../fixtures';
import { captureRecord } from '../helpers/record';

test.describe('REQ-DB: orders DB', () => {
  test('[TC-20] a read-only check', async ({ ordersDb }, testInfo) => {
    await ordersDb.expectStatus('pre-1', 'Paid', 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-21] insert, read back verified', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-21');
    await ordersDb.expectStatus(String(key.id), 'Pending', 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-22] update and delete of the own record', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-22');
    await ordersDb.rename(String(key.id), 'A-22b');
    await ordersDb.remove(String(key.id));
    await captureRecord(testInfo);
  });
  test('[TC-23] an update of a pre-existing row is refused', async ({ ordersDb }, testInfo) => {
    await ordersDb.rename('pre-1', 'X');
    await captureRecord(testInfo);
  });
  test('[TC-24] a lying row count rolls back', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-24');
    await captureRecord(testInfo);
  });
  test('[TC-25] a cascade into a pre-existing child is refused', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-25');
    await ordersDb.remove(String(key.id));
    await captureRecord(testInfo);
  });
  test('[TC-26] a two-level cascade reaching a pre-existing grandchild is refused', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-26');
    await ordersDb.createIn('order_lines', { order_id: key.id });
    await ordersDb.remove(String(key.id));
    await captureRecord(testInfo);
  });
  test('[TC-27] a cascade cycle is refused', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.createIn('cyc_a', { name: 'a' });
    await ordersDb.removeIn('cyc_a', String(key.id));
    await captureRecord(testInfo);
  });
  test('[TC-28] a SET NULL onto a pre-existing row is refused', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-28');
    await ordersDb.remove(String(key.id));
    await captureRecord(testInfo);
  });
  test('[TC-29] an INSERT-only audit trigger is allowed', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-29');
    await ordersDb.expectStatus(String(key.id), 'Pending', 'ER1');
    await captureRecord(testInfo);
  });
  test('[TC-30] an UPDATE trigger is refused even with consent', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-30');
    await captureRecord(testInfo);
  });
  test('[TC-31] an unreadable trigger is refused', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-31');
    await captureRecord(testInfo);
  });
  test('[TC-32] a side effect the prediction missed is rolled back', async ({ ordersDb }, testInfo) => {
    const key = await ordersDb.create('A-32');
    await ordersDb.remove(String(key.id));
    await captureRecord(testInfo);
  });
  test('[TC-33] no consent, no write', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-33');
    await captureRecord(testInfo);
  });
  test('[TC-34] another database than TEST-DATA names gets no write', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-34');
    await captureRecord(testInfo);
  });
  test('[TC-35] a production marker gets no write', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-35');
    await captureRecord(testInfo);
  });
  test('[TC-36] a crash after the commit leaves an intent', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-36');
    await captureRecord(testInfo);
  });
  test('[TC-37] an insert whose key cannot be fixed before commit is refused', async ({ ordersDb }, testInfo) => {
    await ordersDb.createIn('nokey', { name: 'n' });
    await captureRecord(testInfo);
  });
  test('[TC-38] a read-back that disagrees', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-38');
    await captureRecord(testInfo);
  });
  test('[TC-39] non-transactional storage gets no write', async ({ ordersDb }, testInfo) => {
    await ordersDb.create('A-39');
    await captureRecord(testInfo);
  });
  test('[TC-40] create through the API, check the row (api+db)', async ({ ordersApi, ordersDb }, testInfo) => {
    const r = await ordersApi.create('A-40');
    await ordersApi.expectStatus(r, 201, 'ER1');
    await ordersDb.expectStatus('pre-1', 'Paid', 'ER2');
    await captureRecord(testInfo);
  });
});
