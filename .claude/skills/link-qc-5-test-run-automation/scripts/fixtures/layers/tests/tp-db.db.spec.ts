// DB true positives — every finding line carries an `expect:` marker the harness reads. Never executed.
import { test } from '../fixtures/test';
import { captureRecord } from '../helpers/record';

test.describe('REQ-014: DB violations', () => {
  test('[TC-03] SQL in the spec', async ({ ordersDb }, testInfo) => {
    const sql = 'SELECT status FROM orders WHERE id = $1'; // expect: db-raw-sql
    const conn = 'postgres://qa:Secr3t@db-test/orders'; // expect: db-connection-literal
    const wipe = `DELETE FROM orders WHERE name = 'x'`; // expect: db-raw-sql
    void [sql, conn, wipe];
    await ordersDb.expectStatus('A-1', 'Pending');
    await captureRecord(testInfo);
  });

  test('[TC-03] no record captured', async ({ ordersDb }) => { // expect: record-missing
    await ordersDb.expectStatus('A-1', 'Pending');
  });
});
