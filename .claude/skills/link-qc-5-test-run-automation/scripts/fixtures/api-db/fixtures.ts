// selftest-api-db.mjs fixtures — the recorded request and the recorded client over the fake database, the layer
// objects over them, and the record's teardown. Written the way skill 5 writes a project's fixtures/test.ts.
import { test as base, expect } from '@playwright/test';
import { attachApiRecord, type RecordedRequest } from './helpers/api-record';
import { attachDbRecord, type RecordedDb } from './helpers/db-record';
import { reportRecord } from './helpers/record';
import { fakeDb } from './fake-db';
import { OrdersApi } from './api/OrdersApi';
import { OrdersDb } from './db/OrdersDb';

type F = { api: RecordedRequest; db: RecordedDb; ordersApi: OrdersApi; ordersDb: OrdersDb; record: void };
export const test = base.extend<F>({
  record: [async ({}, use, testInfo) => { await use(); await reportRecord(testInfo); }, { auto: true }],
  api: async ({ request }, use, testInfo) => { const r = attachApiRecord(request, testInfo); await use(r.request); await r.report(testInfo); },
  db: async ({}, use, testInfo) => { const d = await attachDbRecord(fakeDb(), testInfo); await use(d.db); await d.report(testInfo); },
  ordersApi: async ({ api }, use) => { await use(new OrdersApi(api)); },
  ordersDb: async ({ db }, use) => { await use(new OrdersDb(db)); },
});
export { expect };
