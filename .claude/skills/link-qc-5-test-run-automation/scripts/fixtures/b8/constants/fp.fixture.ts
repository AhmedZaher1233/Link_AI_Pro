// B8 constant-redeclared — FALSE-POSITIVE GUARDS: none of these redeclares a timeout / tolerance / threshold.
import { test, expect } from '@playwright/test';
import { ThingPage } from '../../pages/thing.page.fixture';
import { captureEvidence } from '../../helpers/evidence.fixture';
import { TIMEOUTS } from '../timeout/timeouts';

const EXPECTED_ROWS = 3;
const LABELS = { saved: 'Saved' };
const STEP_DEADLINE = TIMEOUTS.step.long;
const items = 4;
// const SAVE_TIMEOUT = 15000; — a comment never fires a rule
const WAIT_NOTE = '5000';

test.describe('REQ-014: constants that are not redeclared policy', () => {
  test('[TC-01] Validate that the list shows the expected rows', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText(LABELS.saved);
  });
});
