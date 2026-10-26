// Fixture admission layer for the validator self-test (stands in for helpers/admission.ts). Never executed.
// Its presence under the automation root is what makes the admission-contract rule apply.
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ unitAdmission: void }, { workerAdmission: void }>({
  workerAdmission: [async ({}, use) => { await use(); }, { scope: 'worker', auto: true }],
  unitAdmission: [async ({}, use) => { await use(); }, { auto: true }],
});
export { expect };
