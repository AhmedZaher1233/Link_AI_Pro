// fixtures/admission/tests/admission.spec.ts — a parallel-style describe with a side-effecting beforeAll and a serial chain;
// every hook and body records itself through probe().
import { test, expect, probe } from '../fixtures';

test.describe('REQ-01: orders', () => {
  test.beforeAll(async ({ workerAdmission }) => { void workerAdmission; probe('beforeAll REQ-01'); });

  test('[TC-01] Validate that an order is created', async ({ seed, login }) => {
    probe('body TC-01');
    expect(seed).toBe('seeded');
    expect(login).toBe('session');
  });

  test('[TC-02] Validate that the order list opens', async ({ login }) => {
    probe('body TC-02');
    expect(login).toBe('session');
  });
});

test.describe.serial('serial:orders', () => {
  test.beforeAll(async ({ workerAdmission }) => { void workerAdmission; probe('beforeAll serial'); });

  test('[TC-10] Validate that a line item is added', async ({ seed, login }) => {
    probe('body TC-10');
    expect(seed).toBe('seeded');
    expect(login).toBe('session');
  });

  test('[TC-11] Validate that a locked order cannot be edited', async ({ login }) => {
    probe('body TC-11');
    expect(login).toBe('session');
  });
});
