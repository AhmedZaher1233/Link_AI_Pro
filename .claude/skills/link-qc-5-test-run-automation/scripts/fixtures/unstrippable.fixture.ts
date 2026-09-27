// Case 11 — perfectly valid code that THIS scanner cannot analyse: the regex literal below
// contains a quote, and the scanner does not detect regex literals. The result must be
// BLOCKED (scan incomplete), never PASS, and never a violation against this file.
import { test, expect } from '@playwright/test';
import { captureEvidence } from './helpers/evidence.fixture';

const QUOTED = /['"]/g;

test.describe('REQ-014: unstrippable source', () => {
  test('[TC-01] Validate that quotes are stripped from the label', async ({ page }, testInfo) => {
    await captureEvidence(page, testInfo);
    await expect(page).toHaveTitle('Things'.replace(QUOTED, ''));
  });
});
