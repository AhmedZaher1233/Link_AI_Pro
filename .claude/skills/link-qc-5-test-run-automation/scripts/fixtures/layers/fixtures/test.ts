// Fixture test layer: the recorded request and client, the layer objects built over them. Never executed.
import { test as base, expect } from '@playwright/test';
import { attachApiRecord } from '../helpers/api-record';
import { attachDbRecord } from '../helpers/db-record';
import { dbClientFromEnv } from '../helpers/db';
import { OrdersApi } from '../api/OrdersApi';
import { OrdersDb } from '../db/OrdersDb';
import { OrdersPage } from '../pages/OrdersPage';

type F = { api: never; db: never; ordersApi: OrdersApi; ordersDb: OrdersDb; ordersPage: OrdersPage; seeded: string };
export const test = base.extend<F>({
  api: async ({ request }, use, testInfo) => { const r = attachApiRecord(request, testInfo); await use(r.request as never); await r.report(testInfo); },
  db: async ({}, use, testInfo) => { const d = attachDbRecord(dbClientFromEnv() as never, testInfo); await use(d.db as never); await d.report(testInfo); },
  ordersApi: async ({ api }, use) => { await use(new OrdersApi(api)); },
  ordersDb: async ({ db }, use) => { const o = new OrdersDb(db); await use(o); },
  ordersPage: async ({ page }, use) => { await use(new OrdersPage(page)); },
  seeded: async ({ request }, use) => { await request.post('/api/orders', { data: { name: 'seed' }, purpose: 'setup' }); await use('seed'); },
});
export { expect };
