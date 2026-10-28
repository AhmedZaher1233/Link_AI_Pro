// @link-qc-5-template api-record 3.1.0
// helpers/api-record.ts — the RECORDED request every api/ endpoint client calls (skill 5 3.0, references/code-craft.md §16).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/api-record.ts — ALWAYS installed. A fixture
// wraps Playwright's `request` once per test and hands the client the recorded request, never the raw one:
//
//   api: async ({ request }, use, testInfo) => { const r = attachApiRecord(request, testInfo); await use(r.request); await r.report(testInfo); },
//   ordersApi: async ({ api }, use) => { await use(new OrdersApi(api)); },
//
// Every call declares its EFFECT from the automation-inventory mapping row — `read` · `mutation` · `auth` · `unknown`,
// decided by the verified contract (a POST search is `read`, a GET that changes state is `mutation`), never by the
// HTTP method — and the call then, in this order, BEFORE anything is sent:
//   1. refuses an undeclared effect (UndeclaredEffectError);
//   2. resolves the URL against baseURL and refuses a host / scheme outside PW_API_HOSTS (the TEST-DATA `API base` rows)
//      (RedirectRefusedError: target);
//   3. for `mutation` / `unknown` under test: refuses unless the running TC is in PW_DATA_CHANGES_TCS (the per-TC
//      data-changes gate, never set for a production / unknown target) — `purpose: 'setup'` needs PW_DATA_CHANGES_SETUP
//      (the test-data preparation consent) instead (DataChangesRefusedError);
//   4. for a PUT / PATCH / DELETE `mutation` / `unknown`: refuses unless the target id (`owns`, else the last id-like path
//      segment) was created by THIS run — the ledger (PreexistingResourceWriteError);
//   5. writes the ledger `intent` line (fsynced);
//   6. waits for its rate-limit slot (the SAME shared book as the browser's traffic — helpers/rate-limit.ts);
// then sends with `maxRedirects: 0` and a finite timeout (TIMEOUTS.api.request), handles each redirect itself — the
// Location is validated against PW_API_HOSTS BEFORE the next request; a mutation is re-sent only after 307 / 308 to a
// permitted host and never after 301 / 302 / 303 (RedirectRefusedError), unless the TC asserts the 3xx itself
// (`expectRedirect: true`) — classifies the response for the rate-limit book (network-guard recordApiResponse), registers
// a created resource (201 / Location / `idPath`) in the ledger, registers returned tokens as secrets, and pushes one
// REDACTED entry into the test's record (helpers/record.ts). `keep` lists the JSON paths the TC asserts or captures —
// every other value of a body is reduced to its shape.
import type { APIRequestContext, APIResponse, TestInfo } from '@playwright/test';
import { TIMEOUTS } from '../timeouts';
import { recordApiResponse } from './network-guard';
import { matchService, rateLimitSlot } from './rate-limit';
import { assertRecorded, pushEntry, registerSecret, type Purpose } from './record';
import { redactBody, redactHeaders, redactUrl } from './redact';
import { currentStep, tcIdsOf } from './steps';
import { appendLedger, newWriteId, owns } from './data-ledger';

export type Effect = 'read' | 'mutation' | 'auth' | 'unknown';
export type CallOptions = {
  effect: Effect; purpose?: Purpose;
  data?: unknown; params?: Record<string, string | number | boolean>; headers?: Record<string, string>;
  /** JSON paths of the request / response the TC asserts or captures — kept; every other leaf becomes its shape. */
  keep?: string[]; safeParams?: string[];
  /** A created resource: its ledger name and where its id is in the response body (default `id`, else Location). */
  resource?: string; idPath?: string;
  /** The id a PUT / PATCH / DELETE changes — must be a resource THIS run created. */
  owns?: string;
  /** JSON paths in the response body holding a token / secret — registered so no record ever carries it. */
  secretPaths?: string[];
  /** The TC asserts the 3xx itself: return it, never follow. */
  expectRedirect?: boolean;
  maxRedirects?: 0; timeout?: number;
};
export class UndeclaredEffectError extends Error { constructor(m: string) { super('undeclared effect: ' + m); this.name = 'UndeclaredEffectError'; } }
export class DataChangesRefusedError extends Error { constructor(m: string) { super('data changes not permitted: ' + m); this.name = 'DataChangesRefusedError'; } }
export class PreexistingResourceWriteError extends Error { constructor(m: string) { super('data write refused (ownership): ' + m); this.name = 'PreexistingResourceWriteError'; } }
export class RedirectRefusedError extends Error { constructor(m: string) { super('redirect refused: ' + m); this.name = 'RedirectRefusedError'; } }

const EFFECTS = new Set<Effect>(['read', 'mutation', 'auth', 'unknown']);
const OPTIONAL = TIMEOUTS as unknown as { api?: { request?: number } };
const REQUEST_MS: number = Number(OPTIONAL.api?.request) > 0 ? Number(OPTIONAL.api?.request) : 30_000;
const MAX_HOPS = 5;
const csv = (v: string | undefined): string[] => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
const TOKEN_KEY = /^(?:access_?token|id_?token|refresh_?token|token|jwt|session(?:_?id)?|api_?key)$/i;

function permittedHosts(base: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const h of csv(process.env.PW_API_HOSTS)) { try { out.add(new URL(h).origin); } catch { out.add(h.replace(/\/+$/, '')); } }
  if (!out.size && base) { try { out.add(new URL(base).origin); } catch { /* no base */ } }
  return out;
}
const schemeRank = (u: URL): number => (u.protocol === 'https:' ? 2 : u.protocol === 'http:' ? 1 : 0);
function getPath(obj: unknown, p: string): unknown {
  let cur: unknown = obj;
  for (const part of p.split(/[.[\]]+/).filter(Boolean)) { if (cur === null || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[part]; }
  return cur;
}
function tokensIn(v: unknown, out: string[] = [], key = ''): string[] {
  if (typeof v === 'string' && TOKEN_KEY.test(key)) out.push(v);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) tokensIn(x, out, k);
  return out;
}

export class ApiAuthFailureError extends Error { constructor(m: string) { super('auth failure: ' + m); this.name = 'ApiAuthFailureError'; } }

/**
 * The status assertion every api/ client's expect method uses — recorded against the TC's Expected line. A 401 / 403
 * the TC did not expect is NO product verdict (ApiAuthFailureError → INCOMPLETE `auth_failure`): the role's credentials
 * or token did not work, which says nothing about the behaviour under test.
 */
export async function assertStatus(res: APIResponse, expected: number, opts: { line?: string; entry?: string | null } = {}): Promise<void> {
  await assertRecorded('status', opts, () => {
    const got = res.status();
    if (got !== expected && (got === 401 || got === 403) && expected !== 401 && expected !== 403) throw new ApiAuthFailureError(res.url().replace(/\?.*$/, '') + ' answered ' + got + ' (expected ' + expected + ')');
    if (got !== expected) throw new Error('expected status ' + expected + ', got ' + got + ' — ' + res.url().replace(/\?.*$/, ''));
  });
}

export type RecordedRequest = {
  get(url: string, o: CallOptions): Promise<APIResponse>; head(url: string, o: CallOptions): Promise<APIResponse>;
  post(url: string, o: CallOptions): Promise<APIResponse>; put(url: string, o: CallOptions): Promise<APIResponse>;
  patch(url: string, o: CallOptions): Promise<APIResponse>; delete(url: string, o: CallOptions): Promise<APIResponse>;
  fetch(url: string, o: CallOptions & { method: string }): Promise<APIResponse>;
  /** The ids this test created for a resource (the ledger keeps them for the run). */
  created(resource: string): string[];
  /** The id of the last entry pushed — for an api/ client's expect method (assertRecorded's entry). */
  lastEntry(): string | null;
  /** A clean-up for a resource this client creates: run by the post-run cleanup stage (or at teardown with PW_DATA_TEARDOWN=now). */
  cleanup(resource: string, fn: (id: string) => Promise<void>): void;
};

export function attachApiRecord(request: APIRequestContext, testInfo: TestInfo): { request: RecordedRequest; report(info: TestInfo): Promise<void> } {
  const tcs = tcIdsOf(testInfo.title);
  const tc = tcs[0] || 'untraced';
  const base = (testInfo.project.use as { baseURL?: string }).baseURL || process.env.API_BASE_URL || process.env.BASE_URL;
  const hosts = permittedHosts(base);
  const createdIds = new Map<string, string[]>();
  const cleanups = new Map<string, (id: string) => Promise<void>>();
  let last: string | null = null;
  let n = 0;

  const call = async (method: string, url: string, o: CallOptions): Promise<APIResponse> => {
    const m = method.toUpperCase();
    // 1 — the effect is declared, from the mapping row
    if (!o || !EFFECTS.has(o.effect)) throw new UndeclaredEffectError(m + ' ' + url + ' — pass effect: "read" | "mutation" | "auth" | "unknown"');
    const purpose: Purpose = o.purpose ?? 'test';
    const changes = o.effect === 'mutation' || o.effect === 'unknown';
    // 2 — the target, before anything is sent
    let target: URL;
    try { target = new URL(url, base); } catch { throw new RedirectRefusedError('target ' + url + ' does not resolve against the base URL'); }
    if (!hosts.has(target.origin)) throw new RedirectRefusedError('target ' + target.origin + ' is not a permitted API host (TEST-DATA API base: ' + ([...hosts].join(', ') || 'none') + ')');
    // 3 — the data-changes gate
    if (changes) {
      if (purpose === 'teardown') { if (process.env.PW_DATA_CLEANUP !== 'allowed') throw new DataChangesRefusedError('clean-up ' + m + ' ' + target.pathname + ' without the tester\'s clean-up answer'); }
      else if (purpose === 'setup') { if (process.env.PW_DATA_CHANGES_SETUP !== 'allowed') throw new DataChangesRefusedError('setup ' + m + ' ' + target.pathname + ' without the test-data preparation consent'); }
      else if (!csv(process.env.PW_DATA_CHANGES_TCS).some((x) => tcs.includes(x))) throw new DataChangesRefusedError(tc + ' is not in the data-changes consent of this run (or its target is production / unverified)');
    }
    // 4 — ownership of the record a PUT / PATCH / DELETE changes
    const isWriteOnExisting = changes && /^(PUT|PATCH|DELETE)$/.test(m);
    const resource = o.resource || target.pathname.split('/').filter(Boolean).filter((s) => !/^\d+$|^[0-9a-f-]{16,}$/i.test(s)).pop() || 'resource';
    const targetId = o.owns ?? (target.pathname.split('/').filter(Boolean).pop() || '');
    if (isWriteOnExisting && !owns({ resource }, targetId) && !(createdIds.get(resource) || []).includes(targetId)) {
      throw new PreexistingResourceWriteError(m + ' ' + target.pathname + ' — id "' + targetId + '" was not created by this run (' + resource + ')');
    }
    // 5 — the intent, on disk before the request
    const writeId = changes ? newWriteId(tc) : null;
    if (writeId) appendLedger({ channel: 'api', state: 'intent', write_id: writeId, tc, attempt: testInfo.retry + 1, purpose, op: m === 'POST' ? 'create' : m === 'DELETE' ? 'remove' : 'modify', resource, key: isWriteOnExisting ? targetId : null, host: target.origin, step: currentStep()?.title ?? null });
    // 6 — the shared rate-limit book
    const service = matchService(m, target.pathname);
    if (service) await rateLimitSlot(service, { endpoint: m + ' ' + target.pathname });

    const started = Date.now();
    let res = await request.fetch(target.toString(), { method: m, data: o.data as never, params: o.params, headers: o.headers, timeout: o.timeout ?? REQUEST_MS, maxRedirects: 0, failOnStatusCode: false });
    let hops = 0;
    let curMethod = m;
    while (!o.expectRedirect && res.status() >= 300 && res.status() < 400 && res.headers()['location']) {
      if (++hops > MAX_HOPS) throw new RedirectRefusedError('more than ' + MAX_HOPS + ' redirects from ' + target.pathname);
      const next = new URL(res.headers()['location'], target);
      if (!hosts.has(next.origin) || schemeRank(next) < schemeRank(target)) throw new RedirectRefusedError(res.status() + ' to ' + next.origin + ' — not a permitted API host / a weaker scheme; nothing was sent there');
      const st = res.status();
      if (changes && st !== 307 && st !== 308) throw new RedirectRefusedError(curMethod + ' answered ' + st + ' — a mutation is never re-sent after 301 / 302 / 303');
      if (!changes && (st === 301 || st === 302 || st === 303)) curMethod = curMethod === 'HEAD' ? 'HEAD' : 'GET';
      target = next;
      res = await request.fetch(next.toString(), { method: curMethod, data: curMethod === m ? (o.data as never) : undefined, headers: o.headers, timeout: o.timeout ?? REQUEST_MS, maxRedirects: 0, failOnStatusCode: false });
    }
    const latency = Date.now() - started;
    const headers = res.headers();
    recordApiResponse({ method: curMethod, url: target.toString(), status: res.status(), headers, startedAt: started, tcs, worker: testInfo.parallelIndex, requestId: 'api-w' + testInfo.parallelIndex + '-' + (++n), step: currentStep()?.title ?? null });

    let body: unknown = null;
    const ct = headers['content-type'] || '';
    try { body = /json/i.test(ct) ? await res.json() : await res.text(); } catch { body = null; }
    for (const t of [...tokensIn(body), ...(o.secretPaths || []).map((p) => getPath(body, p)).filter((x): x is string => typeof x === 'string')]) registerSecret(t);
    if (o.effect === 'auth') for (const v of Object.values(headers)) if (/^(?:Bearer|Basic)\s/i.test(String(v))) registerSecret(String(v).split(/\s+/)[1]);

    // the ledger: a create registers its id; a failed change is rolled back (nothing happened server-side we own)
    if (writeId) {
      const ok = res.status() >= 200 && res.status() < 300;
      let id: string | null = null;
      if (ok && m === 'POST') {
        const v = getPath(body, o.idPath || 'id');
        id = v !== undefined && v !== null ? String(v) : headers['location'] ? new URL(headers['location'], target).pathname.split('/').filter(Boolean).pop() || null : null;
        if (id) createdIds.set(resource, [...(createdIds.get(resource) || []), id]);
      }
      appendLedger({ channel: 'api', state: ok ? 'committed' : 'rolled_back', write_id: writeId, tc, purpose, op: m === 'POST' ? 'create' : m === 'DELETE' ? 'remove' : 'modify', resource, key: id ?? (isWriteOnExisting ? targetId : null), host: target.origin, note: ok ? undefined : 'status ' + res.status() });
      if (ok && m === 'DELETE' && isWriteOnExisting) appendLedger({ channel: 'api', state: 'teardown-done', write_id: writeId, tc, resource, key: targetId, note: 'removed by the test itself' });
    }
    last = pushEntry({
      channel: 'api', purpose, effect: o.effect, method: curMethod, path: redactUrl(target.pathname + target.search, o.safeParams), status: res.status(), latency_ms: latency, redirects: hops,
      request: { headers: redactHeaders(o.headers || {}), body: redactBody(o.data ?? null, 'application/json', (o.keep || []).filter((k) => k.startsWith('request.')).map((k) => k.slice(8))) },
      response: { headers: redactHeaders(headers), body: redactBody(body, ct, (o.keep || []).filter((k) => !k.startsWith('request.')).map((k) => k.replace(/^body\./, ''))) },
    });
    return res;
  };

  const recorded: RecordedRequest = {
    get: (u, o) => call('GET', u, o), head: (u, o) => call('HEAD', u, o), post: (u, o) => call('POST', u, o), put: (u, o) => call('PUT', u, o),
    patch: (u, o) => call('PATCH', u, o), delete: (u, o) => call('DELETE', u, o), fetch: (u, o) => call(o.method, u, o),
    created: (resource) => [...(createdIds.get(resource) || [])],
    lastEntry: () => last,
    cleanup: (resource, fn) => { cleanups.set(resource, fn); },
  };
  return {
    request: recorded,
    async report(info: TestInfo) {
      // created resources: kept (`retained`, listed in the report) unless the run cleans up at teardown — the cleanup
      // question is asked ONCE after the run; the cleanup stage deletes them through the same guarded path later
      for (const [resource, ids] of createdIds) for (const id of ids) {
        const fn = cleanups.get(resource);
        if (process.env.PW_DATA_TEARDOWN === 'now' && fn) {
          const w = newWriteId(tc);
          try {
            appendLedger({ channel: 'api', state: 'teardown-intent', write_id: w, tc, resource, key: id });
            await fn(id);
            appendLedger({ channel: 'api', state: 'teardown-done', write_id: w, tc, resource, key: id });
          } catch (e) {
            try { appendLedger({ channel: 'api', state: 'teardown-failed', write_id: w, tc, resource, key: id, note: String((e as Error).message || e).slice(0, 160) }); } catch { /* the annotation still reports it */ }
            info.annotations.push({ type: 'cleanup-incomplete', description: resource + ' ' + id + ' could not be removed' });
          }
        } else { try { appendLedger({ channel: 'api', state: 'retained', write_id: newWriteId(tc), tc, op: 'create', resource, key: id, note: fn ? 'kept until the cleanup question' : 'no cleanup declared for ' + resource }); } catch { /* reported below */ } }
      }
    },
  };
}
