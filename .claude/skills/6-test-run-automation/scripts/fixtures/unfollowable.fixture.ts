// Case 6 — the evidence may well be inside BaseFlow.finish(), but that module is a bare
// package specifier this scanner never follows. It must say "unresolved", not "missing".
import { test, expect } from '@playwright/test';
import { BaseFlow } from '@app/flows/base';

test.describe('REQ-014: unfollowable call hop', () => {
  test('[TC-01] Validate that the flow completes', async ({ page }) => {
    const flow = new BaseFlow(page);
    await flow.finish('Alpha');
    await expect(page).toHaveTitle('Things');
  });
});
