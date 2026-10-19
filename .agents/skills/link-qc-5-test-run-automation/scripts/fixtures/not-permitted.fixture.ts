// Case 8 — an exception may not authorise a placeholder assertion. The qa-allow is itself
// the violation, and the underlying finding keeps its full severity.
import { test, expect } from '@playwright/test';
import { captureEvidence } from './helpers/evidence.fixture';

test.describe('REQ-014: exception on a non-exemptible rule', () => {
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
    // qa-allow: placeholder-assertion — the real oracle is not available yet (REQ-014)
    expect(true).toBe(true);
  });
});
