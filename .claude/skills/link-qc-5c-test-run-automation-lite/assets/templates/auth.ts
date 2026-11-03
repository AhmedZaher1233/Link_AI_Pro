// fixtures/auth.ts — Lite template (P1): one place that knows the roles, where signed-in states live and how to sign in
// without the UI. Fill ROLES / LANGUAGES from the TEST-DATA file of the story; never hard-code a user, a password or a URL here.
//
//   strategy setup-project → specs: test.use({ storageState: storageStateFor(role[, lang]) }) (auth.setup.ts saves them)
//   strategy api-helper    → after each environment reset: await signInAs(context, role)  — the reset ended the session
//   strategy ui-fallback   → the project's sign-in page object, once per role switch; the reason is in the run file
// UI sign-in stays in the TCs whose SUBJECT is sign-in (login, logout, lockout, post-login redirect / language).
//
// Secrets: credentials are read by SECRET NAME from the environment (the project's .env maps each role to its secret names);
// a state file holds a live session: it lives under .auth/ (git-ignored), is never logged, attached or copied into results,
// and `lite finalize` removes the folder at close-out.
import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

export const AUTH_DIR = path.join(__dirname, '..', '.auth');
export const ROLES: string[] = [];               // from TEST-DATA, e.g. the role IDs the TCs sign in as
export const LANGUAGES: (string | null)[] = [null]; // [null] unless the language lives in the session / a cookie (lite auth: per includes "language")

/** Where the signed-in state of a role (and language) is stored. */
export function storageStateFor(role: string, lang: string | null = null): string {
  return path.join(AUTH_DIR, role + (lang ? '-' + lang : '') + '.json');
}

/** Save the signed-in state of the current page's context for a role (and language). */
export async function saveState(page: Page, role: string, lang: string | null = null): Promise<void> {
  await page.context().storageState({ path: storageStateFor(role, lang) });
}

/** Probe mode of auth.setup.ts: HOW the app keeps the session and whether the environment reset ends it → .auth/probe.json.
 *  Names and booleans only — a cookie or token VALUE is never read into the file. */
export async function writeProbe(page: Page, stillSignedIn: () => Promise<boolean>, reset: ((r: APIRequestContext) => Promise<unknown>) | null) {
  const cookies = (await page.context().storageState()).cookies.map((c) => c.name);
  const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
  const tokenish = keys.filter((k) => /token|auth|jwt|session/i.test(k));
  let survives: boolean | 'no-reset' = 'no-reset';
  if (typeof reset === 'function') { await reset(page.request); await page.reload(); survives = await stillSignedIn(); }
  const probe = { mechanism: tokenish.length ? 'token' : cookies.length ? 'cookie' : 'other', survives_reset: survives, language_scope: languageScope(), cookie_names: cookies, storage_keys: tokenish, checked_at: new Date().toISOString() };
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(path.join(AUTH_DIR, 'probe.json'), JSON.stringify(probe, null, 2));
  return probe;
}

/** profile | session | cookie | none — what the learning file / the probe found; the setup loops languages only for session / cookie. */
export function languageScope(): 'profile' | 'session' | 'cookie' | 'none' {
  return (process.env.QA_LANGUAGE_SCOPE as 'profile' | 'session' | 'cookie' | 'none') || 'none';
}

/** The credentials of a role, by secret NAME (e.g. QA_USER_<ROLE> / QA_PASS_<ROLE> in the project's .env) — never a literal. */
function credentialsOf(role: string): { user: string; secret: string } {
  const key = role.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const user = process.env['QA_USER_' + key]; const secret = process.env['QA_PASS_' + key];
  if (!user || !secret) throw new Error('no credentials for role ' + role + ' (secret names QA_USER_' + key + ' / QA_PASS_' + key + ')');
  return { user, secret };
}

/** API sign-in (strategy api-helper): authenticate through the app's own sign-in endpoint and put the session into the
 *  browser context — no sign-in page. Fill SIGN_IN_PATH and the session hand-over from the app source (cookie set by the
 *  response, or a token the app keeps in storage); respect the endpoint's rate limit (learning file). */
const SIGN_IN_PATH = '';  // e.g. the app's sign-in endpoint, confirmed in its source
export async function signInAs(context: BrowserContext, request: APIRequestContext, role: string): Promise<void> {
  if (!SIGN_IN_PATH) throw new Error('fixtures/auth.ts: SIGN_IN_PATH is not set — confirm the API sign-in endpoint in the app source');
  const { user, secret } = credentialsOf(role);
  const res = await request.post(SIGN_IN_PATH, { data: { username: user, password: secret } });
  if (!res.ok()) throw new Error('API sign-in for role ' + role + ' failed: HTTP ' + res.status());
  // cookie session: the request context's cookies carry over
  await context.addCookies((await request.storageState()).cookies);
  // token session: the app reads it from storage — inject it before the first page script runs (uncomment and fill the key)
  // const { token } = await res.json(); await context.addInitScript(([k, v]) => localStorage.setItem(k, v), ['<storage key>', token]);
}
