// selftest-api-db.mjs — a hybrid test case (browser project): a UI step, then a DB check — the image AND the record.
import { test } from '../fixtures';
import { expect } from '@playwright/test';
import { captureRecord } from '../helpers/record';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

test('[TC-50] the page shows the order and the row is stored', async ({ page, ordersDb }, testInfo) => {
  await page.goto('/page');
  await expect(page.getByText('Order pre-1')).toBeVisible();
  const dir = join(process.env.PW_SCREENSHOTS_ROOT as string, 'phase-' + (process.env.PW_PHASE ?? '0'), 'TC-50', testInfo.project.name + '--none--r0');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'attempt-1.png') });
  await ordersDb.expectStatus('pre-1', 'Paid', 'ER2');
  await captureRecord(testInfo);
});
