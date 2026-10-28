// selftest-api-db.mjs query / command object over the recorded client — reads and structured writes only.
import { expect } from '@playwright/test';
import type { RecordedDb } from '../helpers/db-record';
import { assertRecorded } from '../helpers/record';

export class OrdersDb {
  constructor(private readonly db: RecordedDb) {}
  status(id: string) { return this.db.read('order status', 'SELECT status FROM orders WHERE id = $1', [id], { keepColumns: ['status'], keepParams: [0] }); }
  create(name: string, extra: Record<string, unknown> = {}) { return this.db.insert({ table: 'orders', values: { name, status: 'Pending', ...extra } }); }
  createIn(table: string, values: Record<string, unknown>) { return this.db.insert({ table, values }); }
  rename(id: string, name: string) { return this.db.update({ table: 'orders', key: { id }, set: { name } }); }
  remove(id: string) { return this.db.delete({ table: 'orders', key: { id } }); }
  removeIn(table: string, id: string) { return this.db.delete({ table, key: { id } }); }
  async expectStatus(id: string, status: string, line: string) {
    const rows = await this.status(id);
    await assertRecorded('orders.status', { line, entry: this.db.lastEntry() }, () => expect(rows[0] && rows[0].status).toBe(status));
  }
}
