// B8 constant-redeclared — TRUE POSITIVES (check 6): policy values redeclared in a spec.
import { test, expect } from '@playwright/test';
import { ThingPage } from '../../pages/thing.page.fixture';
import { captureEvidence } from '../../helpers/evidence.fixture';

const SAVE_TIMEOUT = 15000;
const tolerance = 0.01;

test.describe('REQ-014: constants redeclared in a spec', () => {
  test('[TC-01] Validate that the saved total is within tolerance', async ({ page }, testInfo) => {
    const pollInterval = 250;
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
