// helpers/test-data.ts — unique test data per phase, worker, retry and run, and the per-ID
// resolution of the TEST-DATA references a TC carries (skill 5, references/code-craft.md §7).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/test-data.ts when absent.
//
// PART 1 — unique names. Every record a test CREATES carries a name / code built here, so two
// workers, a retry, a repeat-each variant or a re-run of the same phase never collide on
// "Order Alpha", and cleanup can select everything a run created by prefix.
//
//   const name = uniqueName('order');            // order-p3-w1-r0-k7q2
//   await orders.create(name);
//   … afterAll: await deleteByPrefix(runPrefix('order'))   // order-p3-
//
// PART 2 — per-ID resolution. A TC references its configuration by ID — `Open the portal [E1]`,
// `Login as Administrator [A1]`, `price list "Sample" [D1]` — and EVERY ID resolves to ITS OWN
// row of TEST-DATA-{feature}.md, never through a shortcut: `[E{n}]` is that environment entry
// (E1 is not "the" URL — E2 may be the mail sandbox), `[A{n}]` is that account (credentials are
// looked up by account ID, never by role — a role may own several accounts), `[D{n}]` is that
// data item. The maps below are keyed by those IDs and read environment variables NAMED AFTER
// THE ID: `E1_URL`, `A1_USER` / `A1_PASSWORD`. No default values, no secrets in this file — a
// missing variable throws with the ID it needs, so a test never runs against a guessed value.
import { test, type TestInfo } from '@playwright/test';

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function shortRandom(length = 4): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/** The phase this run belongs to — set per stage command by the skill (PW_PHASE); `0` outside a skill run. */
export function phase(): string {
  return process.env.PW_PHASE ?? '0';
}

/** Prefix shared by everything THIS phase creates under `prefix` — the key for cleanup sweeps. */
export function runPrefix(prefix: string): string {
  return `${prefix}-p${phase()}-`;
}

/** `{prefix}-p{phase}-w{worker}-r{retry}-{4 random}` — unique across workers, retries, repeats and re-runs. */
export function uniqueName(prefix: string, info: TestInfo = test.info()): string {
  const repeat = info.repeatEachIndex ? `-e${info.repeatEachIndex}` : '';
  return `${runPrefix(prefix)}w${info.parallelIndex}-r${info.retry}${repeat}-${shortRandom()}`;
}

/** Same shape for numeric-only fields (codes, references): digits only, still unique per worker / retry. */
export function uniqueCode(info: TestInfo = test.info(), digits = 6): string {
  const stamp = Date.now().toString().slice(-digits);
  return `${phase()}${info.parallelIndex}${info.retry}${stamp}`.slice(-digits - 3);
}

/* ---------------- per-ID resolution of TEST-DATA references ---------------- */

/** An environment row `[E{n}]` of TEST-DATA-{feature}.md — the `What` column says which service it is. */
export type EnvironmentEntry = { id: string; what: string; url: string };
/** An account row `[A{n}]` — identified by its ID, never by its role. */
export type AccountEntry = { id: string; role: string; username: string; password: string };

function required(name: string, id: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`test-data: environment variable ${name} is not set — it holds the value of [${id}] from TEST-DATA-{feature}.md`);
  return value;
}

/**
 * Environment entries keyed by E-ID. Add one line per `## 0. Environment` row the TCs reference;
 * the URL comes from `{ID}_URL` at run time (E1_URL, E2_URL, …) — never a literal here.
 *   environment('E1').url   // the application base URL
 *   environment('E2').url   // the mail sandbox — a different service, never "the base URL"
 */
export const environments: Record<string, () => EnvironmentEntry> = {
  E1: () => ({ id: 'E1', what: 'application base URL', url: required('E1_URL', 'E1') }),
  // E2: () => ({ id: 'E2', what: 'mail sandbox (reads notification mail)', url: required('E2_URL', 'E2') }),
};

/**
 * Accounts keyed by A-ID. Add one line per `## 1. Accounts` row the TCs reference; the username
 * and password come from `{ID}_USER` / `{ID}_PASSWORD` (A1_USER, A1_PASSWORD, …). Two accounts
 * of the same role are two entries — a TC that says `[A2]` gets A2, never "any Administrator".
 */
export const accounts: Record<string, () => AccountEntry> = {
  A1: () => ({ id: 'A1', role: 'Administrator', username: required('A1_USER', 'A1'), password: required('A1_PASSWORD', 'A1') }),
  // A2: () => ({ id: 'A2', role: 'Administrator', username: required('A2_USER', 'A2'), password: required('A2_PASSWORD', 'A2') }),
};

/** `[E{n}]` → its own environment entry. Unknown ID → throws (the TC references a row TEST-DATA does not have). */
export function environment(id: string): EnvironmentEntry {
  const entry = environments[id.toUpperCase()];
  if (!entry) throw new Error(`test-data: no environment entry for [${id}] — add the ## 0. Environment row to helpers/test-data.ts`);
  return entry();
}

/** `[A{n}]` → that account, by ID. Never resolve an account from a role name. */
export function account(id: string): AccountEntry {
  const entry = accounts[id.toUpperCase()];
  if (!entry) throw new Error(`test-data: no account entry for [${id}] — add the ## 1. Accounts row to helpers/test-data.ts`);
  return entry();
}

/**
 * `[D{n}]` → that data item. Data items are provisioned by PHASE 2.6 (prerequest/ fixtures,
 * setup journeys, kept fixtures) and identified here by ID so a spec never re-describes them.
 */
export const dataItems: Record<string, () => Record<string, string>> = {
  // D1: () => ({ id: 'D1', name: 'Price list "Sample" with 12 products', identifier: required('D1_ID', 'D1') }),
};
export function dataItem(id: string): Record<string, string> {
  const entry = dataItems[id.toUpperCase()];
  if (!entry) throw new Error(`test-data: no data item entry for [${id}] — add the ## 2. Test data row to helpers/test-data.ts`);
  return entry();
}
