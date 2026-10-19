// helpers/console-guard.ts — capture console errors and page errors per test (skill 5, references/code-craft.md §11).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/console-guard.ts when absent.
//
//   let guard: ConsoleGuard;
//   test.beforeEach(async ({ page }) => { guard = attachConsoleGuard(page); });
//   test.afterEach(async ({}, testInfo) => { await guard.report(testInfo); });
//
// Capture is MANDATORY; failing the TC on a console error is NOT — an unexpected entry is attached
// to the test (`console-errors.txt`) and annotated, and the skill lists it under Deviations as a
// potential defect for the human to classify. The allow-list comes from Testing/qa-manifest.json
// (`automation.consoleAllowList`, strings compiled as regular expressions) with these defaults.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

const DEFAULT_ALLOW: RegExp[] = [
  /favicon\.ico/i,
  /ResizeObserver loop/i,
  /third-party cookie/i,
];

function loadAllowList(): RegExp[] {
  const candidates = [process.env.QA_MANIFEST, resolve(__dirname, '../../qa-manifest.json'), resolve(process.cwd(), 'Testing/qa-manifest.json')].filter(Boolean) as string[];
  for (const file of candidates) {
    try {
      const m = JSON.parse(readFileSync(file, 'utf8'));
      const list = m?.automation?.consoleAllowList;
      if (Array.isArray(list)) return [...DEFAULT_ALLOW, ...list.map((s: string) => new RegExp(s, 'i'))];
    } catch { /* next candidate */ }
  }
  return DEFAULT_ALLOW;
}

const ALLOW = loadAllowList();

export type ConsoleGuard = {
  /** Unexpected entries collected so far (message + source location when known). */
  readonly unexpected: string[];
  /** Everything captured, allowed or not, for the attachment. */
  readonly all: string[];
  /** Attach and annotate; never throws, never fails the test by itself. */
  report(testInfo: TestInfo): Promise<void>;
};

export function attachConsoleGuard(page: Page, allow: RegExp[] = ALLOW): ConsoleGuard {
  const all: string[] = [];
  const unexpected: string[] = [];
  const record = (kind: string, text: string, where?: string) => {
    const line = `${kind}: ${text}${where ? `  @ ${where}` : ''}`;
    all.push(line);
    if (!allow.some((re) => re.test(text))) unexpected.push(line);
  };
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location();
    record('console.error', msg.text(), loc?.url ? `${loc.url}:${loc.lineNumber}` : undefined);
  });
  page.on('pageerror', (err) => record('pageerror', err.message));
  return {
    unexpected, all,
    async report(testInfo: TestInfo) {
      try {
        if (all.length) await testInfo.attach('console-errors.txt', { body: all.join('\n'), contentType: 'text/plain' });
        if (unexpected.length) testInfo.annotations.push({ type: 'console-errors', description: `${unexpected.length} unexpected browser error(s) — see console-errors.txt` });
      } catch { /* reporting must never fail a test */ }
    },
  };
}
