// helpers/network-guard.ts — notice when the application refuses requests (skill 5, references/code-craft.md §11).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/network-guard.ts when absent —
// ALWAYS installed, attached beside the console guard:
//
//   let net: NetworkGuard;
//   test.beforeEach(async ({ page }, testInfo) => { guard = attachConsoleGuard(page); net = await attachNetworkGuard(page, testInfo); });
//   test.afterEach(async ({}, testInfo) => { await guard.report(testInfo); await net.report(testInfo); });
//
// It records, for the application's OWN origins only (BASE_URL and every E{n}_URL of the env layer —
// a third-party 429 never counts), every 429 and every 503 carrying Retry-After, plus the first
// RateLimit-* / X-RateLimit-* policy header seen per path, to PW_RATE_LIMIT_FILE (set per command by
// run-stage.mjs). Only origin + pathname are written — never a query string, a header value other than
// the limit numbers, or a body. A refusal never fails a test by itself: the runner decides from these
// records whether a failure is `rate_limited` (no verdict) and how long to cool down.
// attachNetworkGuard also reserves the test's start-of-test rate-limit slots (helpers/rate-limit.ts)
// before any step opens, so paced logins never eat a step deadline.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page, Response, TestInfo } from '@playwright/test';
import { reserveStartSlots } from './rate-limit';
import { tcIdsOf } from './steps';

const ORIGINS: Set<string> = (() => {
  const set = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) {
    if ((k === 'BASE_URL' || /^E\d+_URL$/.test(k)) && v) { try { set.add(new URL(v).origin); } catch { /* not a URL */ } }
  }
  return set;
})();

const num = (v: string | undefined): number | null => (v !== undefined && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
// Retry-After is seconds or an HTTP date
function retryAfterS(v: string | undefined): number | null {
  if (v === undefined) return null;
  if (/^\s*\d+\s*$/.test(v)) return Number(v);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
}
// "RateLimit-Policy: 5;w=60" → 60
const windowS = (policy: string | undefined): number | null => { const m = /\bw=(\d+)/.exec(policy || ''); return m ? Number(m[1]) : null; };

export type NetworkGuard = {
  /** Refused requests seen by this test ("POST /api/session 429"). */
  readonly refused: string[];
  /** Rate-limit policies seen by this test ("POST /api/session limit 5"). */
  readonly policies: string[];
  /** Annotate; never throws, never fails the test by itself. */
  report(testInfo: TestInfo): Promise<void>;
};

export async function attachNetworkGuard(page: Page, testInfo: TestInfo): Promise<NetworkGuard> {
  const tcs = tcIdsOf(testInfo.title);
  const refused: string[] = [];
  const policies: string[] = [];
  const seen = new Set<string>();
  const write = (rec: Record<string, unknown>) => {
    const file = process.env.PW_RATE_LIMIT_FILE;
    if (!file) return;
    try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), worker: testInfo.parallelIndex, tc: tcs, ...rec }) + '\n'); } catch { /* evidence only */ }
  };
  page.on('response', (res: Response) => {
    try {
      const url = new URL(res.url());
      if (ORIGINS.size && !ORIGINS.has(url.origin)) return;
      const h = res.headers();
      const status = res.status();
      const method = res.request().method();
      const where = url.origin + url.pathname;
      const limit = num(h['ratelimit-limit'] ?? h['x-ratelimit-limit'] ?? h['x-rate-limit-limit']);
      const remaining = num(h['ratelimit-remaining'] ?? h['x-ratelimit-remaining'] ?? h['x-rate-limit-remaining']);
      const reset = num(h['ratelimit-reset'] ?? h['x-ratelimit-reset'] ?? h['x-rate-limit-reset']);
      if (status === 429 || (status === 503 && h['retry-after'] !== undefined)) {
        refused.push(method + ' ' + url.pathname + ' ' + status);
        write({ kind: 'refused', method, url: where, status, retry_after_s: retryAfterS(h['retry-after']), limit, remaining, reset });
        return;
      }
      if (limit !== null && !seen.has(method + ' ' + url.pathname)) {
        seen.add(method + ' ' + url.pathname);
        policies.push(method + ' ' + url.pathname + ' limit ' + limit);
        write({ kind: 'policy', method, url: where, status, limit, remaining, reset, window_s: windowS(h['ratelimit-policy']) });
      }
    } catch { /* the guard never fails a test */ }
  });
  // may throw RateLimitWaitError: the test then stops before any step — reported rate_limited, never an application failure
  await reserveStartSlots(testInfo);
  return {
    refused, policies,
    async report(info: TestInfo) {
      try {
        if (refused.length) info.annotations.push({ type: 'rate-limit', description: refused.length + ' refused request(s): ' + [...new Set(refused)].join('; ') });
      } catch { /* reporting must never fail a test */ }
    },
  };
}
