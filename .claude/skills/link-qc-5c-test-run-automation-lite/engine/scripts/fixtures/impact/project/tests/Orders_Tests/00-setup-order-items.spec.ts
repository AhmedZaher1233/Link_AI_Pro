import { test } from '../../fixtures/test';

// Setup journey: creates the order the serial:orders group works on (find-or-create).
test.describe('Setup — order items', () => {
  test('Prepare the order used by the serial group @setup', { tag: ['@setup'] }, async ({ orderPage }) => {
    await orderPage.createOrder('Setup Customer', 3);
  });
});
