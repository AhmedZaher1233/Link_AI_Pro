// B8 admission-contract — TRUE POSITIVES: side-effecting fixtures that can start before admission.
import { test as base } from '../helpers/admission';
import { createOrder, deleteOrder } from '../prerequest/orderPreRequest';

export const test = base.extend<{ order: string; signedIn: void }, { seed: string }>({
  seed: [async ({ browser }, use) => {
    const id = await createOrder(browser);
    await use(id);
    await deleteOrder(id);
  }, { scope: 'worker' }],
  order: async ({ request }, use) => {
    const res = await request.post('/api/orders', { data: { name: 'x' } });
    await use(String(res.status()));
  },
  signedIn: async ({ page }, use) => {
    await new SignInPage(page).login('A1');
    await use();
  },
});
