// Setup fixtures — a data-changing setup request needs purpose: 'setup'. Never executed.
import { test as base } from '@playwright/test';
export const test = base.extend<{ seeded: string; seededRaw: string }>({
  seeded: async ({ request }, use) => { await request.post('/api/orders', { data: { name: 'seed' }, purpose: 'setup' }); await use('seed'); },
  seededRaw: async ({ request }, use) => { await request.post('/api/orders', { data: { name: 'seed' } }); await use('seed'); }, // expect: api-mutation-in-setup-unlabelled
});
