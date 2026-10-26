// B8 admission-contract — FALSE-POSITIVE GUARDS: admitted directly, admitted through another fixture, read-only and option fixtures.
import { test as base } from '../helpers/admission';
import { createOrder } from '../prerequest/orderPreRequest';

export const test = base.extend<{ order: string; audited: string; label: string; locale: string }, { seed: string }>({
  seed: [async ({ browser, workerAdmission }, use) => {
    await use(await createOrder(browser));
  }, { scope: 'worker' }],
  order: async ({ request, unitAdmission }, use) => {
    const res = await request.post('/api/orders', { data: { name: 'x' } });
    await use(String(res.status()));
  },
  audited: async ({ order, request }, use) => {
    await request.delete('/api/audit/' + order);
    await use(order);
  },
  label: async ({ page }, use) => {
    await use(await page.title());
  },
  locale: ['en-US', { option: true }],
});
