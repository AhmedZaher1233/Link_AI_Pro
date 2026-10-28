// Fixture query / command object (clean): reads and structured writes through the recorded client only.
import { expect } from '@playwright/test';
type Db = { read(n: string, sql: string, p: unknown[]): Promise<{ rows: { status: string }[] }>; insert(s: object): Promise<unknown>; update(s: object): Promise<unknown>; delete(s: object): Promise<unknown> };
export class OrdersDb {
  constructor(private readonly db: Db) {}
  async statusOf(id: string) { return this.db.read('order status', 'SELECT status FROM orders WHERE id = $1', [id]); }
  async create(name: string) { return this.db.insert({ table: 'orders', values: { name } }); }
  async rename(key: object, name: string) { return this.db.update({ table: 'orders', key, set: { name } }); }
  async expectStatus(id: string, status: string) { const r = await this.statusOf(id); expect(r.rows[0].status).toBe(status); }
}
