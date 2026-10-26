// Minimal stand-in for assets/admission.template.ts: the two admission fixtures every side-effecting fixture and every
// side-effecting beforeAll must depend on. Never executed — selftest-parallel-plan.mjs only reads it.
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ unitAdmission: void }, { workerAdmission: void }>({
  workerAdmission: [async ({}, use) => { await use(); }, { scope: 'worker', auto: true }],
  unitAdmission: [async ({}, use) => { await use(); }, { auto: true }],
});

export { expect };
