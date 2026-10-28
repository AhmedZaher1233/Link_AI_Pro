// Fixture recorded client for the validator self-test (stands in for helpers/db-record.ts). Never executed.
// It builds the bounded statements itself, so its write SQL is exempt from db-write-freeform.
export function attachDbRecord(client: { query(sql: string, p: unknown[]): unknown }, info: unknown) {
  const db = {
    read: (name: string, sql: string, params: unknown[]) => client.query(sql, params),
    insert: (spec: unknown) => client.query('INSERT INTO t (a) VALUES ($1)', [spec]),
    update: (spec: unknown) => client.query('UPDATE t SET a = $1 WHERE id = $2', [spec, 1]),
    delete: (spec: unknown) => client.query('DELETE FROM t WHERE id = $1', [spec]),
  };
  return { db, async report(i: unknown) { return [i, info]; } };
}
