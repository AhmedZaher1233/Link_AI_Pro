// B8 staged severity — a qa-allow on an exemptible B8 rule is honoured (and stays open for review);
// on a non-exemptible one the qa-allow is itself a violation and the finding keeps its severity.
import { test, expect } from '@playwright/test';
import { ThingPage } from '../pages/thing.page.fixture';
import { captureEvidence } from '../helpers/evidence.fixture';

// qa-allow: constant-redeclared — the requirement fixes the retry budget at three attempts (REQ-014)
const MAX_RETRIES = 3;

test.describe('REQ-014: pragmas on B8 rules', () => {
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    // qa-allow: empty-catch — the toast sometimes never appears in this environment (REQ-014)
    try { await thing.create('Alpha'); } catch {}
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
