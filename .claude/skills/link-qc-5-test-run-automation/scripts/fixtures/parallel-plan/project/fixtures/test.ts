import { test as base, expect } from '../helpers/admission';
import { LoginPage } from '../pages/LoginPage';
import { createOrder, deleteOrder } from '../prerequest/orderPreRequest';
import { createCatalog, deleteCatalog } from '../prerequest/catalogPreRequest';
import { uniqueName } from '../helpers/test-data';

/** Project fixtures over the admission fixtures of helpers/admission.ts. */
export const test = base.extend<{ signedIn: LoginPage; seededOrder: string }, { catalog: string }>({
  // a session per test: waits for its unit's admission first
  signedIn: async ({ page, unitAdmission }, use) => {
    const login = new LoginPage(page);
    await login.login('A1');
    await use(login);
  },
  // breaks the admission contract on purpose: it creates data without depending on unitAdmission
  seededOrder: async ({ request }, use) => {
    const id = await createOrder(request, uniqueName('order'));
    await use(id);
    await deleteOrder(request, id);
  },
  // one catalog per worker, created after the worker's admission
  catalog: [async ({ workerAdmission, playwright }, use) => {
    const api = await playwright.request.newContext();
    const id = await createCatalog(api, uniqueName('catalog'));
    await use(id);
    await deleteCatalog(api, id);
  }, { scope: 'worker' }],
});

export { expect };
