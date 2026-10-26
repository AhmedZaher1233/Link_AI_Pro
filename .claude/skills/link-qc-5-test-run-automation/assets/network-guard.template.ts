// helpers/network-guard.ts — notice when the application refuses, fails or advertises a limit (skill 5,
// references/code-craft.md §11).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/network-guard.ts when absent —
// ALWAYS installed, attached beside the console guard:
//
//   let net: NetworkGuard;
//   test.beforeEach(async ({ page }, testInfo) => { guard = attachConsoleGuard(page); net = await attachNetworkGuard(page, testInfo); });
//   test.afterEach(async ({}, testInfo) => { await guard.report(testInfo); await net.report(testInfo); });
//
// For the application's OWN origins only (BASE_URL and every E{n}_URL of the env layer — a third-party response never
// counts) it writes one JSON line per notable response to PW_RATE_LIMIT_FILE (set per command by run-stage.mjs):
//
//   { at, worker, tc[], step, request_id, kind, method, path, url, host, account, status, retry_after_s, retry_after_at,
//     limit, remaining, reset_s, policy, window_s, latency_ms, error }
//
//   kind  refused        429; a 403 / 503 carrying RateLimit-* / X-RateLimit-* headers that show no quota left (remaining
//                        ≤ 0 or absent, or a Retry-After); a status the run plan lists as the service's throttle signature
//                        (`throttle_statuses`) — throttling
//         unavailable    503 + Retry-After WITHOUT rate-limit headers — temporary unavailability, not throttling: a
//                        failure beside it keeps its failed outcome and is classified normally
//         server-error   any other 5xx
//         policy         a response carrying rate-limit headers: the first per method + path, then each with remaining ≤ 1
//         network-error  the request failed with no response (navigation aborts are not recorded)
//
// `step` is the step that was open when the REQUEST was sent (helpers/steps.ts) — the runner matches a refusal to the
// failing step's OWN request with it; `request_id` = `w{worker}-t{test}-r{n}`; `path` is the template (numeric / UUID /
// long-hex segments → {id}); `url` = origin + template; `account` = the A-ID the test resolved (helpers/test-data.ts),
// never a username; `policy` = `{limit};w={window s}` (numbers only); `retry_after_at` / `retry_after_s` = the server's
// deadline (Retry-After delta-seconds or HTTP-date; RateLimit-Reset when no Retry-After). Never written: a query string,
// a body, a cookie, a header value other than the limit numbers.
//
// It also feeds helpers/rate-limit.ts — a refusal sets the refused scopes' notBefore (the server deadline, never
// shortened; a self-chosen full-jitter back-off when there is none) and an advertised limit is paced from the next
// booking on, so a known limit is honoured before the first refusal. It tracks the application requests in flight
// (`inFlight()`, read by the stall diagnostics of helpers/steps.ts through the shared registry), and attachNetworkGuard
// reserves the test's start-of-test rate-limit slots before any step opens (a no-op when the admission fixture already
// did). A refusal never fails a test by itself: the runner decides what it means (`rate_limited` needs the failing step's
// own request refused AND refused again alone; a test annotated `expects-refusal` is never `rate_limited`).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Page, Request, Response, TestInfo } from '@playwright/test';
import { currentAccountId, currentStepTitle, learnedThrottle, matchService, noteAdvertisedLimit, noteRefusal, pathTemplate, qaRuntime, reserveStartSlots } from './rate-limit';
import { tcIdsOf } from './steps';

const ORIGINS: Set<string> = (() => {
  const set = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) {
    if ((k === 'BASE_URL' || /^E\d+_URL$/.test(k)) && v) { try { set.add(new URL(v).origin); } catch { /* not a URL */ } }
  }
  return set;
})();
const own = (u: URL): boolean => !ORIGINS.size || ORIGINS.has(u.origin);

type RateHeaders = { limit: number | null; remaining: number | null; resetAtMs: number | null; resetS: number | null; windowS: number | null; present: boolean };

function firstNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(v);
  return m ? Number(m[0]) : null;
}

/** RateLimit-* (IETF drafts, incl. `RateLimit-Policy: 5;w=60`, `RateLimit: "default";r=0;t=30`) and X-RateLimit-* headers. */
function rateHeaders(h: Record<string, string>, now: number): RateHeaders {
  const policy = h['ratelimit-policy'] ?? h['x-ratelimit-policy'];
  const combined = h['ratelimit'];
  let limit = firstNumber(h['ratelimit-limit'] ?? h['x-ratelimit-limit'] ?? h['x-rate-limit-limit']);
  let remaining = firstNumber(h['ratelimit-remaining'] ?? h['x-ratelimit-remaining'] ?? h['x-rate-limit-remaining']);
  let reset = firstNumber(h['ratelimit-reset'] ?? h['x-ratelimit-reset'] ?? h['x-rate-limit-reset']);
  let windowS: number | null = null;
  if (policy !== undefined) {
    const q = /\bq=(\d+)/.exec(policy);
    const w = /\bw=(\d+)/.exec(policy);
    if (limit === null) limit = q ? Number(q[1]) : firstNumber(policy.split(';')[0]);
    if (w) windowS = Number(w[1]);
  }
  if (combined !== undefined) {
    const r = /\br=(\d+)/.exec(combined);
    const t = /\bt=(\d+)/.exec(combined);
    if (remaining === null && r) remaining = Number(r[1]);
    if (reset === null && t) reset = Number(t[1]);
  }
  // reset: delta-seconds — or an epoch in seconds / milliseconds, as some servers send
  let resetAtMs: number | null = null;
  let resetS: number | null = null;
  if (reset !== null && reset >= 0) {
    if (reset > 1e12) resetAtMs = reset;
    else if (reset > 1e9) resetAtMs = reset * 1000;
    else resetAtMs = now + reset * 1000;
    resetS = Math.max(0, Math.round((resetAtMs - now) / 1000));
  }
  const present = limit !== null || remaining !== null || reset !== null || policy !== undefined || combined !== undefined;
  return { limit, remaining, resetAtMs, resetS, windowS, present };
}

/** Retry-After: delta-seconds or an HTTP-date → the absolute deadline; an invalid value → null (self-chosen back-off). */
function retryAfterAt(v: string | undefined, now: number): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) return now + Number(s) * 1000;
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(now, at);
}

type Flight = { id: string; method: string; path: string; host: string; startedAt: number; step: string | null };

/** The flights of the most recently attached guard of this worker — what inFlight() reports. */
let currentFlights: Map<Request, Flight> | null = null;
let testSeq = 0;

/** Application requests still waiting for their response / body in this worker ("GET /api/orders/{id} (12 s)"). */
export function inFlight(): string[] {
  if (!currentFlights) return [];
  const now = Date.now();
  return [...currentFlights.values()].map((f) => f.method + ' ' + f.path + ' (' + Math.round((now - f.startedAt) / 1000) + ' s)');
}

export type NetworkGuard = {
  /** Refused requests seen by this test ("POST /api/session 429"). */
  readonly refused: string[];
  /** Rate-limit policies seen by this test ("POST /api/session limit 5"). */
  readonly policies: string[];
  /** 503 + Retry-After without rate-limit headers ("GET /api/report 503"). */
  readonly unavailable: string[];
  /** Other 5xx responses ("POST /api/orders 500"). */
  readonly serverErrors: string[];
  /** Annotate; never throws, never fails the test by itself. */
  report(testInfo: TestInfo): Promise<void>;
};

export async function attachNetworkGuard(page: Page, testInfo: TestInfo): Promise<NetworkGuard> {
  const tcs = tcIdsOf(testInfo.title);
  const worker = testInfo.parallelIndex;
  const seq = ++testSeq;
  let n = 0;
  const refused: string[] = [];
  const policies: string[] = [];
  const unavailable: string[] = [];
  const serverErrors: string[] = [];
  const seen = new Set<string>();
  const flights = new Map<Request, Flight>();
  currentFlights = flights;
  // the stall diagnostics of helpers/steps.ts read the page and the flights through the shared registry
  const rt = qaRuntime() as unknown as { page?: Page | null; inFlight?: (() => string[]) | null };
  rt.page = page;
  rt.inFlight = inFlight;

  const write = (rec: Record<string, unknown>) => {
    const file = process.env.PW_RATE_LIMIT_FILE;
    if (!file) return;
    try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), worker, tc: tcs, ...rec }) + '\n'); } catch { /* evidence only */ }
  };
  const flightOf = (req: Request, u: URL): Flight => {
    const known = flights.get(req);
    if (known) return known;
    return { id: 'w' + worker + '-t' + seq + '-r' + (++n), method: req.method(), path: pathTemplate(u.pathname), host: u.origin, startedAt: Date.now(), step: currentStepTitle() };
  };

  page.on('request', (req: Request) => {
    try {
      const u = new URL(req.url());
      if (own(u)) flights.set(req, flightOf(req, u));
    } catch { /* the guard never fails a test */ }
  });
  page.on('requestfinished', (req: Request) => { flights.delete(req); });
  page.on('requestfailed', (req: Request) => {
    try {
      const f = flights.get(req);
      flights.delete(req);
      if (!f) return;
      const error = (req.failure()?.errorText || 'request failed').slice(0, 120);
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled|canceled/i.test(error)) return; // a navigation abort, not a network failure
      write({ kind: 'network-error', step: f.step, request_id: f.id, method: f.method, path: f.path, url: f.host + f.path, host: f.host, account: currentAccountId(),
        status: null, retry_after_s: null, retry_after_at: null, limit: null, remaining: null, reset_s: null, policy: null, window_s: null, latency_ms: Date.now() - f.startedAt, error });
    } catch { /* the guard never fails a test */ }
  });
  page.on('response', (res: Response) => {
    try {
      const req = res.request();
      const u = new URL(res.url());
      if (!own(u)) return;
      const now = Date.now();
      const f = flightOf(req, u);
      const h = res.headers();
      const status = res.status();
      const rl = rateHeaders(h, now);
      const service = matchService(f.method, u.pathname);
      const account = currentAccountId();
      const what = f.method + ' ' + f.path;
      let kind: 'refused' | 'unavailable' | 'server-error' | 'policy' | null = null;
      // a 403 / 503 is throttling only when its rate-limit headers show no quota left (or name a Retry-After): a 403 from an
      // API that sends X-RateLimit-* on every response but still has quota is a permission answer, classified normally
      const exhausted = rl.present && (rl.remaining === null || rl.remaining <= 0 || h['retry-after'] !== undefined);
      if (status === 429 || ((status === 403 || status === 503) && exhausted) || learnedThrottle(service, status)) kind = 'refused';
      else if (status === 503 && h['retry-after'] !== undefined) kind = 'unavailable';
      else if (status >= 500) kind = 'server-error';
      else if (rl.present && (!seen.has(what) || (rl.remaining !== null && rl.remaining <= 1))) kind = 'policy';
      if (!kind) return;
      if (kind === 'policy') seen.add(what);
      const deadline = kind === 'refused' || kind === 'unavailable' ? retryAfterAt(h['retry-after'], now) ?? (kind === 'refused' ? rl.resetAtMs : null) : null;
      write({
        kind, step: f.step, request_id: f.id, method: f.method, path: f.path, url: f.host + f.path, host: f.host, account, status,
        retry_after_s: deadline !== null ? Math.max(0, Math.round((deadline - now) / 1000)) : null,
        retry_after_at: deadline !== null ? new Date(deadline).toISOString() : null,
        limit: rl.limit, remaining: rl.remaining, reset_s: rl.resetS,
        policy: rl.limit !== null || rl.windowS !== null ? (rl.limit ?? '?') + ';w=' + (rl.windowS ?? '?') : null,
        window_s: rl.windowS, latency_ms: now - f.startedAt, error: null,
      });
      if (kind === 'refused') {
        refused.push(what + ' ' + status);
        void noteRefusal({ method: f.method, path: f.path, service, account, status, deadlineMs: deadline }).catch(() => undefined);
      } else if (kind === 'unavailable') unavailable.push(what + ' ' + status);
      else if (kind === 'server-error') serverErrors.push(what + ' ' + status);
      else policies.push(what + ' limit ' + (rl.limit ?? '?'));
      if ((kind === 'refused' || kind === 'policy') && (rl.limit !== null || (rl.remaining !== null && rl.remaining <= 0))) {
        void noteAdvertisedLimit({ method: f.method, path: f.path, service, account, limit: rl.limit, remaining: rl.remaining, resetAtMs: rl.resetAtMs,
          windowMs: rl.windowS !== null ? rl.windowS * 1000 : null }).catch(() => undefined);
      }
    } catch { /* the guard never fails a test */ }
  });
  // may DEFER the test (skipped, `rate-limit-deferred`) before any step opens — never an application failure
  await reserveStartSlots(testInfo);
  return {
    refused, policies, unavailable, serverErrors,
    async report(info: TestInfo) {
      try {
        if (refused.length) info.annotations.push({ type: 'rate-limit', description: refused.length + ' refused request(s): ' + [...new Set(refused)].join('; ') });
        if (currentFlights === flights) currentFlights = null;
      } catch { /* reporting must never fail a test */ }
    },
  };
}
