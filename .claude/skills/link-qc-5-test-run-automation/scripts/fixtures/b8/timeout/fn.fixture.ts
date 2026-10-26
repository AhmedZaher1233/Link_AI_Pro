// B8 timeout-literal — FALSE-NEGATIVE GUARDS: arithmetic, a step deadline and a same-file numeric constant still fire.
import { expect, type Page } from '@playwright/test';
import { step } from '../../helpers/steps.fixture';

const WAIT = 7_000;

export async function saveAndWait(page: Page) {
  await step('save', async () => {
    await page.getByTestId('save').click();
  }, { deadline: 2 * 60 * 1000 });
  await expect(page.getByTestId('toast')).toBeVisible({
    timeout: WAIT,
  });
}
