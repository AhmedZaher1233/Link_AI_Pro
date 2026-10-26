// fixtures/admission/fixtures.ts — the project's fixture layer, written to the admission CONTRACT (code-craft §6): every
// side-effecting worker fixture lists workerAdmission, every side-effecting test fixture lists unitAdmission. Each one
// appends what ran to PROBE_LOG, so the harness can prove which side effects happened after a refusal.
import { appendFileSync } from 'node:fs';
import { test as base } from './helpers/admission';

export { expect } from './helpers/admission';

export function probe(what: string): void {
  appendFileSync(process.env.PROBE_LOG as string, JSON.stringify({ what, pid: process.pid, at: Date.now() }) + '\n');
}

export const test = base.extend<{ login: string }, { seed: string; sharedLogin: string }>({
  // worker-scoped side effects: seeding shared records and a shared login session
  seed: [async ({ workerAdmission }, use) => { void workerAdmission; probe('seed'); await use('seeded'); }, { scope: 'worker' }],
  sharedLogin: [async ({ workerAdmission }, use) => { void workerAdmission; probe('shared-login'); await use('session'); }, { scope: 'worker' }],
  // a test-scoped side effect: the per-test login
  login: async ({ unitAdmission, sharedLogin }, use, testInfo) => { void unitAdmission; probe('login ' + testInfo.title); await use(sharedLogin); },
});
