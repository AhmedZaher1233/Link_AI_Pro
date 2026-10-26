// B8 constant-redeclared — FALSE-NEGATIVE GUARDS: typed, exported, parenthesised and shadowing forms still fire.
import { test, expect } from '@playwright/test';
import { ThingPage } from '../../pages/thing.page.fixture';
import { captureEvidence } from '../../helpers/evidence.fixture';

export const maxWaitMs: number = 5 * 1_000;
let RETRIES = (3);
const TIMEOUTS = { action: 15_000 };

test.describe('REQ-014: disguised constants', () => {
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
