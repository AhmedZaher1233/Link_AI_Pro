// B8 admission-contract — FALSE-NEGATIVE GUARDS: admission "through" a fixture that is itself not admitted,
// and a worker fixture that depends only on the TEST-level admission, behind a renamed prerequest import.
import { test as base } from '../helpers/admission';
import { seedAccounts as seedAll } from '../prerequest/accountPreRequest';

export const test = base.extend<{ helper: string; derived: string }, { accounts: void }>({
  helper: async ({ page }, use) => {
    await use(await page.title());
  },
  derived: async ({ helper, request }, use) => {
    await request.patch('/api/orders/' + helper, { data: {} });
    await use(helper);
  },
  accounts: [async ({ unitAdmission }, use) => {
    await seedAll();
    await use();
  }, { scope: 'worker' }],
});
