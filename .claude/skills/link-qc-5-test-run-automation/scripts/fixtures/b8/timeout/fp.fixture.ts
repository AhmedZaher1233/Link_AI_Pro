// B8 timeout-literal — FALSE-POSITIVE GUARDS: policy values, computed budgets, types and ternaries never fire.
import { expect, test, type Page } from '@playwright/test';
import { TIMEOUTS } from './timeouts';

type WaitOptions = { timeout: number; deadline?: number };

export async function waitSaved(page: Page, opts: WaitOptions, slow: boolean) {
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: TIMEOUTS.action });
  test.setTimeout(TIMEOUTS.test.long);
  test.info().setTimeout(test.info().timeout + opts.timeout);
  const pick = slow ? opts.timeout : 0;
  return pick;
}
