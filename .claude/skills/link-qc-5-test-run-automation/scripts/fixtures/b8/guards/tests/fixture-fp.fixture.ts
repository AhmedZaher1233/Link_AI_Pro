// B8 guards — FALSE-POSITIVE GUARD: both guards attached by the automatic fixture of the test layer the spec imports.
import { test, expect } from '../fixtures/test';
import { captureEvidence } from '../../../helpers/evidence.fixture';
import { ThingPage } from '../../../pages/thing.page.fixture';

test.describe('REQ-014: guards through a fixture', () => {
  test('[TC-01] Validate that the thing is saved', async ({ page }, testInfo) => {
    const thing = new ThingPage(page);
    await thing.create('Alpha');
    await captureEvidence(page, testInfo);
    await expect(thing.nameCell('Alpha')).toHaveText('Alpha');
  });
});
