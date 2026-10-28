#!/usr/bin/env node
// selftest-redact.mjs — leak tests for the redaction core of the API / DB evidence records (redact.mjs) and the record
// validation run-stage, run-data and the run-report renderer use.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing case means a secret could reach an evidence file, a log
// or a report: no API / DB record may be trusted until it passes again.
//
// Every case builds records the way helpers/record.ts does (entries through the core, then sealRecord) on the success,
// failure, retry and teardown paths, and asserts that no known secret byte sequence — raw, URL-encoded, base64, JSON-
// escaped — survives, and that a surviving one BLOCKS the record instead of being written. Case 0 checks that
// assets/redact.template.ts carries the core byte for byte.
// Run: node selftest-redact.mjs [--pretty]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORD_SCHEMA, REDACTED, maskText, redactHeaders, redactUrl, redactJson, redactBody, redactSql, redactParams, redactRows,
  secretForms, scanForSecrets, sealRecord, validateRecord, checkRecordFile,
} from './redact.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
const lf = (s) => s.replace(/\r\n?/g, '\n');
const coreOf = (text) => { const t = lf(text); const a = t.indexOf('// ==== BEGIN redact-core'); const b = t.indexOf('// ==== END redact-core'); return a >= 0 && b > a ? t.slice(a, b) : null; };

// The run's known secrets: an account password, a connection string, a token a login returned.
const PASSWORD = 'S3cr3t-P@ssw0rd!';
const CONN = 'postgres://qa_user:Db-P4ss-77@db-test.internal:5432/orders';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxYS51c2VyIn0.c2lnbmF0dXJlLXZhbHVlLTEyMzQ';
const KNOWN = [PASSWORD, CONN, TOKEN];
const leaks = (text) => KNOWN.flatMap((s) => secretForms(s).filter((f) => String(text).includes(f)).map((f) => (s === PASSWORD ? 'password' : s === CONN ? 'connection' : 'token') + ' as ' + (f === s ? 'raw' : f === encodeURIComponent(s) ? 'url' : f === Buffer.from(s).toString('base64') ? 'base64' : 'json')));

/** A record built the way helpers/record.ts builds one: every part through the core, then sealed. */
function buildRecord({ tc = 'TC-01', attempt = 1, path: urlPath = '/api/orders?token=' + encodeURIComponent(TOKEN) + '&page=2', reqHeaders, reqBody, resHeaders, resBody, keep = [], sql, params = [], rows = [], keepCols = [], assertions, purpose = 'test' }) {
  const stats = { headers: 0, values: 0, patterns: 0 };
  const entries = [{
    id: 'e1', seq: 1, step: 'S1', step_title: 'POST orders', purpose, channel: 'api', method: 'POST', path: redactUrl(urlPath, ['page'], stats), status: 201, latency_ms: 12, effect: 'mutation',
    request: { headers: redactHeaders(reqHeaders || { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, stats), body: redactBody(reqBody ?? { name: 'A-1', password: PASSWORD }, 'application/json', keep, stats) },
    response: { headers: redactHeaders(resHeaders || { 'Set-Cookie': 'sid=' + TOKEN, 'Content-Type': 'application/json', Location: 'https://api.test/api/orders/7?sig=' + PASSWORD }, stats), body: redactBody(resBody ?? { id: 7, owner: { email: 'qa.user@example.test', token: TOKEN } }, 'application/json', keep, stats) },
  }];
  if (sql) entries.push({ id: 'e2', seq: 2, step: 'S2', step_title: 'read order', purpose, channel: 'db', op: 'read', sql: redactSql(sql, stats), params: redactParams(params, [0], stats), row_count: rows.length, sample: redactRows(rows, keepCols, stats), read_back: null });
  const record = { schema: RECORD_SCHEMA, tc, test_id: 't1', title: '[' + tc + '] create', project: 'backend', attempt, retry: attempt - 1, layer: sql ? 'api+db' : 'api', identity: null, entries, assertions: assertions || [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e1', target: 'status', outcome: 'pass' }], redaction: stats };
  return { record, sealed: sealRecord(record, KNOWN), stats };
}

/* 0 — the core is byte-identical in assets/redact.template.ts (the helper the project runs). */
{
  const p = [];
  const a = coreOf(fs.readFileSync(path.join(here, 'redact.mjs'), 'utf8'));
  const tplFile = path.join(here, '..', 'assets', 'redact.template.ts');
  const b = fs.existsSync(tplFile) ? coreOf(fs.readFileSync(tplFile, 'utf8')) : null;
  if (!a) p.push('redact.mjs has no BEGIN / END redact-core block');
  if (!b) p.push('assets/redact.template.ts is missing or has no redact-core block');
  else if (a !== b) p.push('assets/redact.template.ts redact-core differs from scripts/redact.mjs — copy the block byte for byte');
  check('0 redact-core mirrored byte for byte in assets/redact.template.ts', p, {});
}

/* 1 — headers: deny by default — Authorization, Cookie, x-api-key and a NON-STANDARD auth header are [redacted]; the
   allowlist keeps content-type / retry-after / rate-limit headers; location keeps its path only. */
{
  const p = [];
  const h = redactHeaders({ Authorization: 'Bearer ' + TOKEN, Cookie: 'sid=1', 'x-api-key': 'k-123456789', 'X-Company-Auth': PASSWORD, 'X-Tenant': 'acme', 'Content-Type': 'application/json', 'Retry-After': '30', 'X-RateLimit-Remaining': '0', Location: 'https://api.test/orders/7?sig=' + PASSWORD });
  for (const k of ['Authorization', 'Cookie', 'x-api-key', 'X-Company-Auth', 'X-Tenant']) if (h[k] !== REDACTED) p.push(k + ' kept: ' + h[k]);
  for (const [k, v] of [['Content-Type', 'application/json'], ['Retry-After', '30'], ['X-RateLimit-Remaining', '0'], ['Location', '/orders/7']]) if (h[k] !== v) p.push(k + ' = ' + h[k] + ' (expected ' + v + ')');
  if (leaks(JSON.stringify(h)).length) p.push('a secret survived: ' + leaks(JSON.stringify(h)));
  check('1 headers: allowlist only, non-standard auth headers redacted, location path only', p, {});
}

/* 2 — URL query: every value [redacted] unless declared safe; a token-named key is never safe. */
{
  const p = [];
  const u = redactUrl('/api/orders?token=' + encodeURIComponent(TOKEN) + '&page=2&access_token=x&q=' + encodeURIComponent(PASSWORD), ['page', 'access_token']);
  if (!/^\/api\/orders\?/.test(u)) p.push('path lost: ' + u);
  if (!/page=2/.test(u)) p.push('a safe parameter was redacted: ' + u);
  if (!/token=\[redacted\]/.test(u) || !/access_token=\[redacted\]/.test(u) || !/q=\[redacted\]/.test(u)) p.push('a value was kept: ' + u);
  if (leaks(u).length) p.push('leak: ' + leaks(u));
  check('2 url: path kept, query values redacted unless declared safe (never a token-named key)', p, { u });
}

/* 3 — nested JSON and arrays: only asserted paths keep their value (generic [] paths too); sensitive keys and
   sensitive-looking values are hashed even when asserted; personal data never appears in the clear. */
{
  const p = [];
  const body = { user: { name: 'QA', password: PASSWORD, email: 'qa.user@example.test' }, items: [{ id: 1, status: 'Pending', card: '4111 1111 1111 1111' }, { id: 2, status: 'Paid', note: 'call +44 20 7946 0958' }], session: { token: TOKEN } };
  const r = redactJson(body, ['items[].status', 'items[0].id', 'user.email', 'session.token', 'user.password']);
  const s = JSON.stringify(r);
  if (r.items[0].status !== 'Pending' || r.items[1].status !== 'Paid' || r.items[0].id !== 1) p.push('an asserted value was not kept: ' + s);
  if (r.items[1].id !== '<number>' || r.user.name !== '<string:2>') p.push('an un-asserted leaf kept its value: ' + s);
  for (const k of [r.user.email, r.session.token, r.user.password]) if (!/^sha256:[0-9a-f]{16} </.test(String(k))) p.push('a sensitive asserted value was not hashed: ' + k);
  if (/qa\.user@|4111|7946/.test(s) || leaks(s).length) p.push('personal data or a secret survived: ' + s);
  check('3 nested JSON / arrays: asserted paths only, sensitive values hashed, shapes kept', p, { r });
}

/* 4 — error bodies and non-JSON bodies: an error message carrying a token is hashed; HTML / text keeps size + hash only. */
{
  const p = [];
  const e = redactBody(JSON.stringify({ error: { code: 'INVALID_TOKEN', message: 'token ' + TOKEN + ' expired for qa.user@example.test' } }), 'application/json', ['error.code', 'error.message']);
  if (e.error.code !== 'INVALID_TOKEN') p.push('the asserted error code was lost');
  if (!/^sha256:/.test(e.error.message)) p.push('an error message carrying a token was kept: ' + e.error.message);
  const html = redactBody('<html>password=' + PASSWORD + '</html>', 'text/html', []);
  if (!html || html.bytes === undefined || !/^[0-9a-f]{64}$/.test(html.sha256) || JSON.stringify(html).includes(PASSWORD)) p.push('a text body was not reduced to size + hash: ' + JSON.stringify(html));
  check('4 error and non-JSON bodies: never a secret in clear', p, {});
}

/* 5 — SQL: literals in the statement masked, parameters masked unless asserted, samples keep asserted columns only (≤ 5 rows). */
{
  const p = [];
  const sql = redactSql("SELECT status FROM orders WHERE owner = 'qa.user@example.test' AND pin = '" + PASSWORD + "'");
  if (sql.includes(PASSWORD) || /qa\.user/.test(sql) || !/owner = '\?'/.test(sql)) p.push('SQL literal kept: ' + sql);
  const params = redactParams(['A-1', PASSWORD, 42], [0]);
  if (params[0] !== 'A-1' || params[1] !== '<string:' + PASSWORD.length + '>' || params[2] !== '<number>') p.push('params ' + JSON.stringify(params));
  const rows = redactRows(Array.from({ length: 8 }, (_, i) => ({ id: i, status: 'Pending', password_hash: 'x' + i, email: 'u' + i + '@example.test' })), ['status', 'id', 'password_hash']);
  if (rows.length !== 5) p.push('sample rows ' + rows.length + ' != 5');
  if (rows[0].status !== 'Pending' || rows[0].email !== '<string:' + 'u0@example.test'.length + '>' || rows[0].password_hash !== '<string:2>') p.push('row columns ' + JSON.stringify(rows[0]));
  check('5 SQL text, parameters and result samples', p, { sql, params, row: rows[0] });
}

/* 6 — the four record paths (success, failure, retry, teardown): after the core and the seal no known secret survives in
   ANY form; and a secret that does survive (a value the core cannot recognise) BLOCKS the record — never written. */
{
  const p = [];
  const paths = {
    success: buildRecord({ sql: "SELECT status FROM orders WHERE id = '7'", params: ['7'], rows: [{ status: 'Pending', token: TOKEN }], keepCols: ['status'] }),
    failure: buildRecord({ resBody: { error: { message: 'login failed for ' + PASSWORD } }, keep: ['error.message'], assertions: [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e1', target: 'status', outcome: 'fail' }] }),
    retry: buildRecord({ attempt: 2, reqBody: { name: 'A-1', connection: CONN }, keep: ['name'] }),
    teardown: buildRecord({ purpose: 'teardown', reqHeaders: { 'X-Db-Url': CONN, 'Content-Type': 'application/json' }, reqBody: { id: 7 }, keep: ['id'] }),
  };
  // the failure path KEPT an error message that echoes the password: the core cannot recognise a bare password, so the
  // seal must block that record (fail closed) — the attempt then ends evidence_invalid (redaction), never PASS
  if (paths.failure.sealed.ok || !paths.failure.sealed.hits.includes('known-secret')) p.push('failure: a kept message echoing the password was not blocked: ' + JSON.stringify(paths.failure.sealed.hits));
  delete paths.failure;
  paths.failureMasked = buildRecord({ resBody: { error: { code: 'LOGIN_FAILED', message: 'login failed for ' + PASSWORD } }, keep: ['error.code'], assertions: [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e1', target: 'status', outcome: 'fail' }] });
  for (const [name, b] of Object.entries(paths)) {
    if (!b.sealed.ok) p.push(name + ': a redacted record was blocked (' + b.sealed.hits + ')');
    else if (leaks(b.sealed.text).length) p.push(name + ': leaked ' + leaks(b.sealed.text).join(', '));
    else if (scanForSecrets(b.sealed.text, KNOWN).length) p.push(name + ': secret-shaped text survived');
  }
  // an unrecognisable secret (a plain word the run registered as a token) slips past the patterns → the seal blocks it
  const odd = 'plainwordsecret';
  const rec = buildRecord({ reqBody: { name: odd }, keep: ['name'] }).record;
  const blocked = sealRecord(rec, [...KNOWN, odd]);
  if (blocked.ok || blocked.text !== null || !blocked.hits.includes('known-secret')) p.push('a surviving known secret did not block the record: ' + JSON.stringify(blocked));
  for (const form of ['url', 'base64']) {
    const v = form === 'url' ? encodeURIComponent(PASSWORD) : Buffer.from(PASSWORD).toString('base64');
    const r2 = sealRecord({ ...rec, note: v }, KNOWN);
    if (r2.ok) p.push('a ' + form + '-encoded password did not block the record');
  }
  check('6 success / failure / retry / teardown records: no secret in any form; a surviving one blocks the record', p, { stats: paths.success.stats });
}

/* 7 — validateRecord: schema, TC and attempt identity, a PASS with a failed assertion, a PASS missing an Expected line,
   a record edited after its seal, an unsealed record, an unknown entry reference; a valid record has no problem. */
{
  const p = [];
  const ok = JSON.parse(buildRecord({}).sealed.text);
  const v = (rec, expect) => validateRecord(rec, expect, KNOWN);
  if (v(ok, { tc: 'TC-01', attempt: 1, status: 'PASS', backendLines: ['ER1'] }).length) p.push('a valid record has problems: ' + v(ok, { tc: 'TC-01', attempt: 1, status: 'PASS', backendLines: ['ER1'] }));
  const expectProblem = (label, rec, expect, re) => { const got = v(rec, expect); if (!got.some((x) => re.test(x))) p.push(label + ': ' + JSON.stringify(got)); };
  expectProblem('wrong tc', ok, { tc: 'TC-09' }, /^tc /);
  expectProblem('wrong attempt', ok, { attempt: 2 }, /^attempt /);
  expectProblem('missing ER line', ok, { status: 'PASS', backendLines: ['ER1', 'ER2'] }, /ER2/);
  const failed = JSON.parse(sealRecord({ ...ok, sha256: undefined, assertions: [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e1', target: 'status', outcome: 'fail' }] }, KNOWN).text);
  expectProblem('PASS with a failed assertion', failed, { status: 'PASS' }, /failed assertion/);
  expectProblem('edited after the seal', { ...ok, layer: 'db' }, {}, /edited after it was sealed/);
  expectProblem('unsealed', { ...ok, sha256: undefined }, {}, /not sealed/);
  expectProblem('schema', { ...ok, schema: 'x' }, {}, /schema/);
  expectProblem('unknown entry ref', JSON.parse(sealRecord({ ...ok, sha256: undefined, assertions: [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e9', outcome: 'pass' }] }, KNOWN).text), {}, /unknown entry/);
  const tmp = path.join(here, 'fixtures', 'redact-tmp-' + process.pid + '.record.json');
  try {
    fs.writeFileSync(tmp, '{not json');
    if (checkRecordFile(tmp).ok || !/not valid JSON/.test(checkRecordFile(tmp).problems[0])) p.push('a malformed record file was accepted');
  } finally { fs.rmSync(tmp, { force: true }); }
  if (checkRecordFile(tmp).ok) p.push('a missing record file was accepted');
  check('7 validateRecord: identity, assertions, seal, schema, malformed and missing files', p, {});
}

/* 8 — maskText keeps ordinary text and placeholders: a Luhn-invalid 16-digit order number and a short code stay. */
{
  const p = [];
  const plain = maskText('Order 1234567812345678 (code 42) for Select a country');
  if (plain.hits.length || plain.text !== 'Order 1234567812345678 (code 42) for Select a country') p.push('ordinary text masked: ' + JSON.stringify(plain));
  const s = maskText('Authorization: Bearer ' + TOKEN + ' / ' + CONN + ' / AKIAABCDEFGHIJKLMNOP');
  if (s.text.includes(TOKEN) || s.text.includes('Db-P4ss-77') || s.text.includes('AKIAABCDEFGHIJKLMNOP')) p.push('a secret pattern was kept: ' + s.text);
  check('8 maskText: secrets masked, ordinary text and Luhn-invalid numbers kept', p, { hits: s.hits });
}

const out = { tool: 'selftest-redact', ran: cases.length, ok: fail.length === 0, cases, mismatches: fail, note: fail.length ? 'The redaction core disagrees with its own cases — no API / DB record may be trusted until it passes.' : 'No secret reaches a record; a surviving one blocks it.' };
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
