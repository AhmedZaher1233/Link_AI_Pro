// @link-qc-5-template evidence 3.1.0
// helpers/evidence.ts — the assertion-point image of every browser test (skill 5, references/results-and-evidence.md
// <result_organization>). Installed by config-inventory.mjs reconcile --apply into {automation_root}/helpers/evidence.ts
// when absent; never written by hand per run.
//
//   await captureEvidence(page, testInfo);            // inside the test body, right before the (last) expect of the Assert step
//   test.afterEach(async ({ page }, testInfo) => { await evidenceAfterEach(page, testInfo); });   // failure handling only
//
// Contract (run-data.mjs merge / verify read it; the validator rule evidence-helper-contract checks the helper):
// - One image per executed attempt, under EACH [TC-ID] of the title:
//     {PW_SCREENSHOTS_ROOT}/phase-{PW_PHASE}/{TC-ID}/{project}--{variation}--r{repeat}/attempt-{a}.png
//   `a` is the next free number in that folder — an existing image is NEVER overwritten (evidence is immutable history).
// - Exactly ONE `evidence` heartbeat per attempt ({ at, worker, tc, event: 'evidence', path }, through helpers/steps.ts):
//   written by captureEvidence, or by the afterEach fallback when the test failed before reaching captureEvidence.
//   The failure image attempt-{a}-failed.png is written WITHOUT a heartbeat — it is never a second assertion image.
// - The run's screenshot choice reaches every command as PW_SCREENSHOTS (run-stage.mjs; absent → all):
//     all    → captureEvidence writes the image + heartbeat; afterEach adds attempt-{a}-failed.png on failure
//     failed → captureEvidence writes nothing (no image, no heartbeat); on failure afterEach writes attempt-{a}.png
//              (the current screen, one heartbeat) and attempt-{a}-failed.png
//     none   → no image at all (records of API / DB tests are written by helpers/record.ts whatever the choice)
// - variants.json beside the TC folder lists every variant slug seen ({ slug, project, variation, repeat, title }).
// - The helper never fails a test: every file error is swallowed (the missing image is then a Checkpoint B finding).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { heartbeat, tcIdsOf } from './steps';

type Policy = 'all' | 'failed' | 'none';
type AttemptState = { attempt: number; image: string | null };

const policy = (): Policy => {
  const v = String(process.env.PW_SCREENSHOTS || 'all').toLowerCase();
  return v === 'failed' || v === 'none' ? v : 'all';
};
const screenshotsRoot = (): string => process.env.PW_SCREENSHOTS_ROOT || resolve(process.cwd(), 'screenshots');
const phase = (): string => process.env.PW_PHASE || '0';

const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** The variation slug of a title: its `— variation …` suffix (tags removed), else `none` — the same rule as run-data.mjs. */
export function variationSlug(title: string): string {
  const t = String(title || '').replace(/\s@[\w:-]+/g, '');
  const m = t.match(/\s[—–]\s*(variation\b[^[\]]*)$/i);
  return m ? kebab(m[1]) : 'none';
}

function variantDir(testInfo: TestInfo, tc: string): string {
  const slug = `${testInfo.project.name}--${variationSlug(testInfo.title)}--r${testInfo.repeatEachIndex}`;
  return join(screenshotsRoot(), `phase-${phase()}`, tc, slug);
}

/** The next free attempt number of a variant folder — an existing attempt-{n}.png is never reused. */
function nextAttempt(dir: string): number {
  let max = 0;
  try { for (const f of readdirSync(dir)) { const m = f.match(/^attempt-(\d+)(?:-failed)?\.png$/); if (m) max = Math.max(max, Number(m[1])); } } catch { /* no folder yet */ }
  return max + 1;
}

function recordVariant(testInfo: TestInfo, tc: string): void {
  try {
    const file = join(screenshotsRoot(), `phase-${phase()}`, tc, 'variants.json');
    let list: Array<Record<string, unknown>> = [];
    try { list = JSON.parse(readFileSync(file, 'utf8')); if (!Array.isArray(list)) list = []; } catch { list = []; }
    const slug = `${testInfo.project.name}--${variationSlug(testInfo.title)}--r${testInfo.repeatEachIndex}`;
    if (!list.some((v) => v.slug === slug)) {
      list.push({ slug, project: testInfo.project.name, variation: variationSlug(testInfo.title), repeat: testInfo.repeatEachIndex, title: testInfo.title });
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
    }
  } catch { /* never fails a test */ }
}

// the attempt each TC of this test owns (per test, per worker): the afterEach reads it so a failed test keeps its number
const STATE = new WeakMap<TestInfo, Map<string, AttemptState>>();
const stateOf = (testInfo: TestInfo): Map<string, AttemptState> => {
  let m = STATE.get(testInfo);
  if (!m) { m = new Map(); STATE.set(testInfo, m); }
  return m;
};

/** The ONE place an assertion-point image and its `evidence` heartbeat are written. */
async function writeAttemptImage(page: Page, testInfo: TestInfo, tc: string, dir: string, attempt: number): Promise<string | null> {
  const file = join(dir, `attempt-${attempt}.png`);
  if (existsSync(file)) return file;   // immutable: never overwritten
  try {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
  } catch { return null; }
  recordVariant(testInfo, tc);
  heartbeat({ worker: testInfo.parallelIndex, tc, event: 'evidence', path: file });
  return file;
}

/** Call at the assertion point — immediately before the (last) expect of the Assert step, while the verified state is on screen. */
export async function captureEvidence(page: Page, testInfo: TestInfo): Promise<string[]> {
  const written: string[] = [];
  const st = stateOf(testInfo);
  for (const tc of tcIdsOf(testInfo.title)) {
    const dir = variantDir(testInfo, tc);
    const attempt = st.get(tc)?.attempt ?? nextAttempt(dir);
    if (policy() !== 'all') { st.set(tc, { attempt, image: null }); continue; }   // `failed` / `none`: nothing at the assertion point
    const file = await writeAttemptImage(page, testInfo, tc, dir, attempt);
    st.set(tc, { attempt, image: file });
    if (file) written.push(file);
  }
  return written;
}

/** The failure image attempt-{a}-failed.png — no heartbeat: it is never a second assertion image. */
async function writeFailureImage(page: Page, testInfo: TestInfo, dir: string, attempt: number): Promise<void> {
  const file = join(dir, `attempt-${attempt}-failed.png`);
  if (existsSync(file)) return;
  try {
    mkdirSync(dir, { recursive: true });
    if (!page.isClosed()) { await page.screenshot({ path: file, fullPage: true }); return; }
  } catch { /* the page may be gone — the attachment below */ }
  try {
    const att = testInfo.attachments.find((a) => a.name === 'screenshot' && a.path);
    if (att && att.path) copyFileSync(att.path, file);
  } catch { /* never fails a test */ }
}

/** afterEach failure handling only: a failing attempt gets its failure image, and an assertion-point image when none exists yet. */
export async function evidenceAfterEach(page: Page, testInfo: TestInfo): Promise<void> {
  if (policy() === 'none') return;
  const failed = testInfo.status !== undefined && testInfo.status !== testInfo.expectedStatus;
  if (!failed) return;
  const st = stateOf(testInfo);
  for (const tc of tcIdsOf(testInfo.title)) {
    const dir = variantDir(testInfo, tc);
    const cur = st.get(tc) || { attempt: nextAttempt(dir), image: null };
    if (!cur.image && !existsSync(join(dir, `attempt-${cur.attempt}.png`))) {
      cur.image = await writeAttemptImage(page, testInfo, tc, dir, cur.attempt);   // the test failed before reaching captureEvidence
    }
    await writeFailureImage(page, testInfo, dir, cur.attempt);
    st.set(tc, cur);
  }
}
