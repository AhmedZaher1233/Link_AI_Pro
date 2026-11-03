// @link-qc-5-template record 3.1.0
// helpers/record.ts — the evidence record of an API / DB test (skill 5 3.0, references/code-craft.md §18).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/record.ts — ALWAYS installed (it does nothing
// until an [API] / [DB] test writes a record). The recorded request (helpers/api-record.ts) and the recorded client
// (helpers/db-record.ts) push one ENTRY per call / statement; an api/ client's expect method links an ASSERTION to the TC's
// Expected line; the spec calls captureRecord(testInfo) ONCE, at the assertion point (the image's twin):
//
//   const r = await ordersApi.create('A-1');
//   await ordersApi.expectStatus(r, 201, { line: 'ER1' });
//   await captureRecord(testInfo);                     // ← the record, before teardown
//
// The record (`skill5-record/1`) lands beside the image path — {screenshots root}/phase-{N}/{TC}/{variant}/attempt-{a}.record.json
// (PW_SCREENSHOTS_ROOT, set per command by run-stage.mjs) — never overwritten; reportRecord(testInfo) in the fixture's
// teardown writes attempt-{a}-failed.record.json for a failed attempt that has none, and the `teardown` heartbeat.
// EVERY part passed through helpers/redact.ts first; sealRecord() then refuses a record that still carries a known secret
// (the run's passwords, connection strings, tokens a login returned): nothing is written and the attempt is annotated
// `record-blocked` — run-stage.mjs makes it `evidence_invalid (redaction)`, never PASS.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestInfo } from '@playwright/test';
import { RECORD_SCHEMA, sealRecord } from './redact';
import { currentStep, heartbeat, tcIdsOf } from './steps';

export type Purpose = 'test' | 'setup' | 'teardown';
export type Entry = Record<string, unknown> & { channel: 'api' | 'db'; purpose?: Purpose };
export type Assertion = { id: string; tc_line: string | null; entry_ref: string | null; target: string; outcome: 'pass' | 'fail' };
type TestRecord = { testId: string; entries: (Entry & { id: string; seq: number })[]; assertions: Assertion[]; written: boolean; blocked: boolean; attempts: Record<string, number> };
type Runtime = { record?: TestRecord | null; secrets?: Set<string> };

const rt = (): Runtime => {
  const g = globalThis as unknown as Record<string, Runtime | undefined>;
  if (!g.__linkQcRuntime) g.__linkQcRuntime = {};
  return g.__linkQcRuntime as Runtime;
};
const testIdOf = (info: TestInfo): string => (info as unknown as { testId?: string }).testId ?? info.title;

/** Values a record may NEVER carry: every environment value named like a secret, plus what registerSecret() adds. */
function knownSecrets(): string[] {
  const r = rt();
  if (!r.secrets) {
    r.secrets = new Set<string>();
    // a variable NAMED as a secret (…_PASSWORD, …_TOKEN, …_API_KEY, the QC's QA_DB…_URL, a connection string) — never a
    // flag or a path (MCP_CONNECTION_NONBLOCKING=true, …_SECRETS_FILE) and never a value a record holds anyway (true, 42)
    const NAMED = /(?:^|_)(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|APIKEY|PRIVATE_?KEY|CLIENT_?SECRET)$|^QA_DB(?:_[A-Z0-9]+)*_URL$|CONNECTION_?STRING$/i;
    for (const [k, v] of Object.entries(process.env)) if (v && v.length >= 6 && NAMED.test(k) && !/^(?:true|false|null|undefined|on|off|yes|no|\d+)$/i.test(v)) r.secrets.add(v);
  }
  return [...r.secrets];
}
/** A secret the run learned (a token a login call returned) — registered the moment it is captured. */
export function registerSecret(value: string | null | undefined): void {
  if (!value || String(value).length < 4) return;
  knownSecrets();
  rt().secrets!.add(String(value));
}

/** The running test's record (created on first use, dropped when another test starts in this worker). */
function current(info?: TestInfo): TestRecord {
  const r = rt();
  let running: TestInfo | null = info ?? null;
  if (!running) { try { running = test.info(); } catch { running = null; } }   // the test that is running NOW — never the previous one
  const id = running ? testIdOf(running) : r.record?.testId ?? 'unknown';
  if (!r.record || r.record.testId !== id) r.record = { testId: id, entries: [], assertions: [], written: false, blocked: false, attempts: {} };
  return r.record;
}
export function beginRecord(info: TestInfo): void { current(info); }

/** One request / statement of the test. Returns its entry id (assertions refer to it). */
export function pushEntry(entry: Entry): string {
  const rec = current();
  const seq = rec.entries.length + 1;
  const step = currentStep();
  const id = 'e' + seq;
  rec.entries.push({ ...entry, id, seq, step: step ? 'S' + seq : null, step_title: step ? step.title : null, purpose: entry.purpose ?? 'test' });
  return id;
}

/** Run one assertion and record it against the TC's Expected line ('ER2'); a failure is recorded, then rethrown. */
export async function assertRecorded<T>(target: string, opts: { line?: string; entry?: string | null }, check: () => T | Promise<T>): Promise<T> {
  const rec = current();
  const a: Assertion = { id: 'a' + (rec.assertions.length + 1), tc_line: opts.line ?? null, entry_ref: opts.entry ?? (rec.entries.length ? rec.entries[rec.entries.length - 1].id : null), target, outcome: 'pass' };
  try { const v = await check(); rec.assertions.push(a); return v; } catch (e) { rec.assertions.push({ ...a, outcome: 'fail' }); throw e; }
}

function slugOf(info: TestInfo): string {
  const v = info.annotations.find((x) => x.type === 'variation');
  const variation = v && v.description ? v.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'none' : 'none';
  return info.project.name + '--' + variation + '--r' + info.repeatEachIndex;
}
function nextAttempt(dir: string): number {
  if (!existsSync(dir)) return 1;
  const n = readdirSync(dir).filter((f) => /^attempt-\d+\.record\.json$/.test(f)).length;
  return n + 1;
}

/** Write the record of this attempt. `failed`: the failure record (from teardown). Returns the paths written. */
function write(info: TestInfo, failed: boolean): string[] {
  const rec = current(info);
  const tcs = tcIdsOf(info.title);
  const root = process.env.PW_SCREENSHOTS_ROOT || join(info.project.outputDir || 'test-results', 'records');
  const phase = process.env.PW_PHASE ?? '0';
  const layer = rec.entries.some((e) => e.channel === 'api') && rec.entries.some((e) => e.channel === 'db') ? 'api+db' : rec.entries.some((e) => e.channel === 'db') ? 'db' : 'api';
  const written: string[] = [];
  for (const tc of tcs.length ? tcs : ['untraced']) {
    const dir = join(root, 'phase-' + phase, tc, slugOf(info));
    // one attempt number per test execution, fixed by its first write (the assertion-point record, or — when the test
    // failed before it — the failure path, which then writes BOTH files so every executed attempt has its record)
    const fresh = rec.attempts[tc] === undefined;
    const attempt = rec.attempts[tc] ?? (rec.attempts[tc] = nextAttempt(dir));
    const record = {
      schema: RECORD_SCHEMA, tc, tcs, test_id: rec.testId, title: info.title, project: info.project.name, attempt, retry: info.retry,
      layer, identity: (rt() as unknown as { dbIdentity?: unknown }).dbIdentity ?? null,
      entries: rec.entries, assertions: rec.assertions, result: failed ? 'failed' : null,
      redaction: { note: 'every part passed helpers/redact.ts; sealRecord refused any known secret' },
    };
    const sealed = sealRecord(record, knownSecrets());
    if (!sealed.ok) {
      rec.blocked = true;
      info.annotations.push({ type: 'record-blocked', description: 'the ' + (failed ? 'failure ' : '') + 'record of ' + tc + ' still carried ' + sealed.hits.join(', ') + ' after redaction — not written' });
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const names = failed ? (fresh ? ['attempt-' + attempt + '.record.json', 'attempt-' + attempt + '-failed.record.json'] : ['attempt-' + attempt + '-failed.record.json']) : ['attempt-' + attempt + '.record.json'];
    for (const name of names) {
      const file = join(dir, name);
      if (existsSync(file)) continue;   // never overwritten — the assertion-point record always wins
      writeFileSync(file, sealed.text as string);
      written.push(file);
      if (!/-failed\./.test(name)) heartbeat({ worker: info.parallelIndex, tc: tcs.join(',') || info.title, event: 'evidence', kind: 'record', path: file });
    }
  }
  rec.written = !failed || rec.written;
  return written;
}

/** The assertion-point record — ONE call per test, in the body, before teardown. */
export async function captureRecord(info: TestInfo): Promise<string[]> { return write(info, false); }

/** Teardown: the failure record of a failed attempt and the `teardown` heartbeat. Never throws. */
export async function reportRecord(info: TestInfo): Promise<void> {
  try {
    const tc = tcIdsOf(info.title).join(',') || info.title;
    heartbeat({ worker: info.parallelIndex, tc, event: 'teardown' });
    const rec = current(info);
    if (info.status !== info.expectedStatus && rec.entries.length) write(info, true);
    if (!rec.written && rec.entries.length && info.status === info.expectedStatus) info.annotations.push({ type: 'record-missing', description: 'no captureRecord() at the assertion point — the attempt has no record' });
  } catch { /* teardown reporting must never fail a test */ }
}
