#!/usr/bin/env node
// selftest-api-db.mjs — the REAL-Playwright integration test of the API / DB helpers (skill 5 3.0):
// assets/record · redact · api-record · db-record · data-ledger · network-guard, run by a LOCAL Playwright test runner
// (QA_PLAYWRIGHT_DIR, else one Node resolves, else the npm npx cache — the same lookup as selftest-admission.mjs). It
// never installs anything; without a runner it reports NOT_RUN and exits 3 — never a pass.
//
// A throw-away project is built in the temp folder from the REAL templates and fixtures/api-db/ (an endpoint client, a
// query object, a fake file-backed database that misbehaves per TC). The harness itself serves the API (node:http) and
// a FOREIGN server that only counts the requests reaching it — a refused redirect must leave it at zero. Cases:
//   1 API: a consented create PASSes with a valid sealed record and its ledger lines; a negative response is a normal
//     assertion; a POST search mapped `read` needs no consent; an `unknown` POST and a GET mapped `mutation` are gated;
//     a PUT on an id the run did not create is refused unsent; a mutation 307 to a foreign host / a 303 are never
//     re-sent (the foreign server counts 0); a read redirect on the permitted host is followed, to a foreign host
//     refused; a target outside the permitted hosts is refused before sending; an unexpected 401 is an auth failure;
//     a returned token never reaches a record (the record is BLOCKED); a PASS without captureRecord is flagged
//   2 DB: read, insert (verified), update + delete of the own row; a pre-existing row, a lying row count, a cascade into a
//     row the run did not create (one level, two levels, SET NULL), a cascade cycle, an UPDATE / unreadable trigger
//     (even consented), an unpredicted side effect, no consent, another database, a production marker, an insert
//     without a pre-fixable key, a read-back that disagrees, non-transactional storage — each refused with nothing
//     changed; an INSERT-only audit trigger is allowed; API+DB without a browser
//   3 crash after commit: the intent stays, the row exists; the next attach resolves it by a read-only lookup
//     (`recovered`); an intent whose state matches nothing stays in doubt (annotated, never owned)
//   4 the record cannot be written (the evidence root is a file) → the test FAILs, never PASS
//   5 hybrid: a UI step, then a DB check — the image AND the record (headless Chromium; NOT_RUN without a browser)
// Every record written passes validateRecord(); no record carries a known secret. Exits 1 on mismatch, 3 when it could not run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checkRecordFile, secretForms } from './redact.mjs';
import { collectTests, markFollowers, classifyTest } from './run-stage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', 'assets');
const FIX = path.join(here, 'fixtures', 'api-db');
const cases = []; const fail = []; const sandboxes = [];
const check = (name, problems, detail) => { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); };
const PASSWORD = 'Qa-Secr3t-Pass!';
const TOKEN = 'tok-' + 'abcdef0123456789';

/* ---------------- the local Playwright test runner (never installed here) ---------------- */
function semverKey(v) { const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(-.*)?$/); return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? 0 : 1] : [0, 0, 0, 0]; }
function usable(dir) {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pj.name !== 'playwright' || !pj.exports || !pj.exports['./test'] || !fs.existsSync(path.join(dir, 'cli.js'))) return null;
    return { dir, version: pj.version };
  } catch { return null; }
}
function findPlaywright() {
  if (process.env.QA_PLAYWRIGHT_DIR) return usable(path.resolve(process.env.QA_PLAYWRIGHT_DIR)) || { error: 'QA_PLAYWRIGHT_DIR is not a playwright package with ./test' };
  try { const d = path.dirname(createRequire(import.meta.url).resolve('playwright/package.json')); const u = usable(d); if (u) return u; } catch { /* not resolvable from here */ }
  const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'), path.join(os.homedir(), '.npm', '_npx')].filter(Boolean);
  const found = [];
  for (const r of roots) { let names = []; try { names = fs.readdirSync(r); } catch { continue; } for (const n of names) { const u = usable(path.join(r, n, 'node_modules', 'playwright')); if (u) found.push(u); } }
  found.sort((a, b) => { const x = semverKey(a.version); const y = semverKey(b.version); for (const i of [3, 0, 1, 2]) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  return found[0] || null;
}

/* ---------------- the API and the foreign server ---------------- */
const seen = { foreign: 0, touch: 0, putPre: 0, post303Resent: 0 };
let orderSeq = 100;
function api(port, foreignPort) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
      const u = new URL(req.url, 'http://x');
      const p = u.pathname;
      if (p === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body><h1>Order pre-1</h1></body></html>'); }
      if (p === '/api/login' && req.method === 'POST') return json(200, { token: TOKEN, user: 'qa.user' });
      if (p === '/api/leak') return json(200, { note: 'your session token is ' + TOKEN });
      if (p === '/api/orders' && req.method === 'POST') {
        if (req.headers.authorization && req.headers.authorization !== 'Bearer ' + TOKEN) return json(401, { error: { code: 'UNAUTHENTICATED' } });
        const b = body ? JSON.parse(body) : {};
        const id = String(++orderSeq);
        return json(201, { id, name: b.name }, { location: '/api/orders/' + id });
      }
      if (p === '/api/orders/search') return json(200, { items: [{ id: 'pre-1' }] });
      if (/^\/api\/orders\/[^/]+\/touch$/.test(p)) { seen.touch++; return json(200, { touched: true }); }
      if (p === '/api/bad') return json(400, { error: { code: 'VALIDATION', message: 'name required' } });
      if (p === '/api/redirect-foreign') { res.writeHead(307, { location: 'http://127.0.0.1:' + foreignPort + '/api/orders' }); return res.end(); }
      if (p === '/api/redirect-303') { res.writeHead(303, { location: '/api/orders/1' }); return res.end(); }
      if (p === '/api/redirect-ok') { res.writeHead(302, { location: '/api/orders/1' }); return res.end(); }
      if (p === '/api/redirect-foreign-read') { res.writeHead(302, { location: 'http://127.0.0.1:' + foreignPort + '/api/orders/1' }); return res.end(); }
      const m = /^\/api\/orders\/([^/]+)$/.exec(p);
      if (m && req.method === 'PUT') { if (m[1] === 'pre-1') seen.putPre++; return json(200, { id: m[1] }); }
      if (m && req.method === 'GET') return json(200, { id: m[1], status: 'Paid' });
      if (m && req.method === 'DELETE') return json(204, {});
      json(404, { error: 'no route ' + req.method + ' ' + p });
    });
  }).listen(port, '127.0.0.1');
}
const foreign = () => http.createServer((req, res) => { seen.foreign++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"foreign":true}'); });
const listen = (srv) => new Promise((resolve) => { srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)); });

/* ---------------- one throw-away project ---------------- */
function project(pw) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-api-db-'));
  sandboxes.push(root);
  const cp = (from, to) => { fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true }); fs.copyFileSync(from, path.join(root, to)); };
  cp(path.join(ASSETS, 'timeouts.template.ts'), 'timeouts.ts');
  for (const h of ['steps', 'rate-limit', 'network-guard', 'record', 'redact', 'api-record', 'db-record', 'data-ledger']) cp(path.join(ASSETS, h + '.template.ts'), 'helpers/' + h + '.ts');
  for (const f of ['playwright.config.ts', 'fixtures.ts', 'fake-db.ts', 'api/OrdersApi.ts', 'db/OrdersDb.ts', 'tests/api.api.spec.ts', 'tests/db.db.spec.ts', 'tests/hybrid.spec.ts']) cp(path.join(FIX, f), f);
  const shim = path.join(root, 'node_modules', '@playwright', 'test');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, 'package.json'), JSON.stringify({ name: '@playwright/test', version: pw.version, main: 'index.js', exports: { '.': './index.js', './reporter': './reporter.js', './package.json': './package.json' } }));
  fs.writeFileSync(path.join(shim, 'index.js'), 'module.exports = require(' + JSON.stringify(path.join(pw.dir, 'test.js')) + ');\n');
  fs.writeFileSync(path.join(shim, 'reporter.js'), 'module.exports = {};\n');
  const art = path.join(root, 'artifacts', 'progress');
  fs.mkdirSync(art, { recursive: true });
  const shots = path.join(root, 'screenshots');
  const dbFile = path.join(root, 'fake-db.json');
  fs.writeFileSync(dbFile, JSON.stringify({ orders: [{ id: 'pre-1', name: 'Old', status: 'Paid' }, { id: 'pre-2', name: 'Other', status: 'Paid' }], order_lines: [], line_notes: [], assignments: [], audit: [], cyc_a: [], cyc_b: [], nokey: [] }));
  return { root, art, shots, dbFile, ledger: path.join(art, 'run-1-cmd.data-ledger.jsonl'), json: path.join(root, 'results.json') };
}
function runPw(pw, pr, grep, env) {
  return new Promise((resolve) => {
    fs.rmSync(pr.json, { force: true });
    const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PW_') && !k.startsWith('QA_DB') && !k.startsWith('FAKE_')));
    Object.assign(e, { PW_JSON_OUT: pr.json, PW_OUTPUT_DIR: path.join(pr.root, 'test-results'), PW_PROGRESS_FILE: path.join(pr.art, 'progress.jsonl'), PW_DATA_LEDGER_FILE: pr.ledger, PW_DATA_LEDGER_DIR: pr.art, PW_RUN_ID: 'selftest-run', PW_SCREENSHOTS_ROOT: pr.shots, PW_PHASE: '1', FAKE_DB_FILE: pr.dbFile, A1_PASSWORD: PASSWORD, CI: '1', FORCE_COLOR: '0' }, env);
    const child = spawn(process.execPath, [path.join(pw.dir, 'cli.js'), 'test', '-c', 'playwright.config.ts', ...(grep ? ['--grep', grep] : [])], { cwd: pr.root, env: e, windowsHide: true });
    let stderr = ''; let stdout = '';
    child.stderr.on('data', (d) => { stderr += d; }); child.stdout.on('data', (d) => { stdout += d; });
    const kill = setTimeout(() => child.kill(), 240000);   // deliberate timer: the harness's own ceiling for one Playwright run
    child.on('close', (code) => {
      clearTimeout(kill);
      let report = null;
      try { report = JSON.parse(fs.readFileSync(pr.json, 'utf8')); } catch { /* reported by the case */ }
      const tests = {};
      const walk = (s) => { for (const sp of s.specs || []) for (const t of sp.tests || []) { const tc = (/\[(TC-[^\]]+)\]/.exec(sp.title) || [])[1] || sp.title; const r = (t.results || [])[t.results.length - 1] || {}; tests[tc] = { status: r.status, ok: sp.ok, error: r.error ? String(r.error.message || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300) : null, annotations: (t.annotations || []).map((a) => a.type) }; } for (const c of s.suites || []) walk(c); };
      if (report) for (const s of report.suites || []) walk(s);
      // the status of record as run-stage.mjs computes it (its own parser and classifier)
      const verdicts = {};
      if (report) for (const t of markFollowers(collectTests(report, pr.root))) { const c = classifyTest(t); for (const tc of t.tcs) verdicts[tc] = c; }
      resolve({ code, report: !!report, tests, verdicts, stderr: stderr.slice(-1500), stdout: stdout.slice(-800) });
    });
  });
}
const ledgerLines = (pr) => (fs.existsSync(pr.ledger) ? fs.readFileSync(pr.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const dbState = (pr) => JSON.parse(fs.readFileSync(pr.dbFile, 'utf8'));
function recordsOf(pr) { const out = []; const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.record\.json$/.test(e.name)) out.push(p); } }; walk(pr.shots); return out; }
function leaksIn(files) { const bad = []; for (const f of files) { const t = fs.readFileSync(f, 'utf8'); for (const s of [PASSWORD, TOKEN]) for (const form of secretForms(s)) if (t.includes(form)) bad.push(path.basename(path.dirname(path.dirname(f))) + '/' + path.basename(f)); } return [...new Set(bad)]; }
/** run-stage's verdict of a TC: status + reason (regex), e.g. INCOMPLETE /^redirect_refused$/ */
const expectVerdict = (p, r, tc, status, reasonRe) => {
  const v = r.verdicts[tc];
  if (!v) { p.push(tc + ': no run-stage verdict'); return; }
  if (v.status !== status || (reasonRe && !reasonRe.test(v.reason || ''))) p.push(tc + ': run-stage verdict ' + JSON.stringify(v) + ' != ' + status + ' ' + (reasonRe || ''));
};
const expectStatus = (p, r, tc, status, errRe) => {
  const t = r.tests[tc];
  if (!t) { p.push(tc + ': not in the report'); return; }
  if (t.status !== status) p.push(tc + ': status ' + t.status + ' != ' + status + (t.error ? ' (' + t.error.slice(0, 160) + ')' : ''));
  if (errRe && !errRe.test(t.error || '')) p.push(tc + ': error does not match ' + errRe + ': ' + (t.error || 'none'));
};

const pw = findPlaywright();
if (!pw || pw.error) {
  process.stdout.write(JSON.stringify({ tool: 'selftest-api-db', ran: 0, ok: false, outcome: 'NOT_RUN', reason: pw && pw.error ? pw.error : 'no local Playwright test runner (set QA_PLAYWRIGHT_DIR to a `playwright` package folder) — nothing is installed by this harness', cases: [] }) + '\n');
  process.exit(3);
}
const fsrv = foreign();
const foreignPort = await listen(fsrv);
const asrv = api(0, foreignPort); await new Promise((r) => asrv.on('listening', r));
const apiPort = asrv.address().port;
const BASE = 'http://127.0.0.1:' + apiPort;
const COMMON = { API_BASE_URL: BASE, PW_API_HOSTS: BASE, FOREIGN_PORT: String(foreignPort), PW_DB_EXPECTED_IDENTITY: 'orders_test @ db-test (PostgreSQL)' };

try {
  /* 1 — API */
  {
    const p = [];
    const pr = project(pw);
    const r = await runPw(pw, pr, 'REQ-API', { ...COMMON, PW_DATA_CHANGES_TCS: 'TC-01,TC-06,TC-07,TC-08,TC-12,TC-13' });
    if (!r.report) p.push('no JSON report: ' + r.stderr);
    expectStatus(p, r, 'TC-01', 'passed'); expectStatus(p, r, 'TC-02', 'passed'); expectStatus(p, r, 'TC-03', 'passed');
    expectStatus(p, r, 'TC-04', 'failed', /DataChangesRefusedError|data changes not permitted/); expectStatus(p, r, 'TC-05', 'failed', /data changes not permitted/);
    expectStatus(p, r, 'TC-06', 'failed', /ownership/); expectStatus(p, r, 'TC-07', 'failed', /redirect refused/); expectStatus(p, r, 'TC-08', 'failed', /never re-sent after 301 \/ 302 \/ 303/);
    expectStatus(p, r, 'TC-09', 'passed'); expectStatus(p, r, 'TC-10', 'failed', /redirect refused/); expectStatus(p, r, 'TC-11', 'failed', /not a permitted API host/);
    expectStatus(p, r, 'TC-12', 'failed', /auth failure/); expectStatus(p, r, 'TC-13', 'passed'); expectStatus(p, r, 'TC-15', 'passed');
    for (const [tc, st, re] of [['TC-01', 'PASS'], ['TC-02', 'PASS'], ['TC-03', 'PASS'], ['TC-04', 'NOT_RUN', /^not started: data changes not permitted/], ['TC-05', 'NOT_RUN', /^not started: data changes not permitted/],
      ['TC-06', 'INCOMPLETE', /^data_write_refused \(ownership\)$/], ['TC-07', 'INCOMPLETE', /^redirect_refused$/], ['TC-08', 'INCOMPLETE', /^redirect_refused$/], ['TC-09', 'PASS'], ['TC-10', 'INCOMPLETE', /^redirect_refused$/],
      ['TC-11', 'INCOMPLETE', /^redirect_refused$/], ['TC-12', 'INCOMPLETE', /^auth_failure$/], ['TC-13', 'PASS'], ['TC-14', 'INCOMPLETE', /^evidence_invalid \(redaction/], ['TC-15', 'INCOMPLETE', /^evidence_invalid \(no record/]]) expectVerdict(p, r, tc, st, re);
    if (seen.foreign !== 0) p.push('the foreign server received ' + seen.foreign + ' request(s) — a refused target / redirect was sent');
    if (seen.touch !== 0) p.push('the gated GET mutation reached the server');
    if (seen.putPre !== 0) p.push('the refused PUT on pre-1 reached the server');
    const t14 = r.tests['TC-14'];
    if (!t14 || !t14.annotations.includes('record-blocked')) p.push('TC-14: a record carrying the returned token was not blocked: ' + JSON.stringify(t14));
    if (!r.tests['TC-15'] || !r.tests['TC-15'].annotations.includes('record-missing')) p.push('TC-15: a PASS without its record was not annotated record-missing');
    const recs = recordsOf(pr);
    const leak = leaksIn(recs);
    if (leak.length) p.push('known secrets in records: ' + leak.join(', '));
    if (recs.some((f) => /TC-14/.test(f))) p.push('a record of TC-14 was written although it carried the token');
    const r01 = recs.find((f) => /[\\/]TC-01[\\/]/.test(f) && /attempt-1\.record\.json$/.test(f));
    if (!r01) p.push('TC-01 has no attempt-1.record.json');
    else { const c = checkRecordFile(r01, { tc: 'TC-01', attempt: 1, status: 'PASS', backendLines: ['ER1', 'ER2'] }, [PASSWORD, TOKEN]); if (!c.ok) p.push('TC-01 record invalid: ' + c.problems.join('; ')); }
    for (const f of recs) { const c = checkRecordFile(f, {}, [PASSWORD, TOKEN]); if (!c.ok) p.push(path.basename(path.dirname(path.dirname(f))) + ' record invalid: ' + c.problems.join('; ')); }
    const led = ledgerLines(pr);
    const of = (tc) => led.filter((l) => l.tc === tc).map((l) => l.state);
    if (JSON.stringify(of('TC-01')) !== JSON.stringify(['intent', 'committed', 'retained'])) p.push('TC-01 ledger ' + JSON.stringify(of('TC-01')));
    if (of('TC-04').length || of('TC-06').length) p.push('a refused change left a ledger line (refused before its intent): ' + JSON.stringify({ tc04: of('TC-04'), tc06: of('TC-06') }));
    if (!of('TC-13').includes('committed') || of('TC-13').filter((s) => s === 'committed').length !== 2) p.push('TC-13 (create + update of the own record) ledger ' + JSON.stringify(of('TC-13')));
    const r09 = recs.find((f) => /[\\/]TC-09[\\/]/.test(f));
    if (!r09 || JSON.parse(fs.readFileSync(r09, 'utf8')).entries[0].redirects !== 1) p.push('TC-09 record does not show the followed redirect');
    check('1 API: effect from the mapping, the gate, ownership, targets and redirects checked before sending, auth failures, secrets blocked, records valid', p, { playwright: pw.version, tests: Object.fromEntries(Object.entries(r.tests).map(([k, v]) => [k, v.status])), seen });
  }

  /* 2 — DB */
  {
    const p = [];
    const pr = project(pw);
    const UPD = { orders: [{ name: 'tr_touch', events: ['INSERT'], body: 'BEGIN UPDATE customers SET orders = orders + 1; RETURN NEW; END' }] };
    const scen = {
      'TC-24': { rowCountLie: true }, 'TC-25': { spawn: [{ onInsertInto: 'orders', table: 'order_lines', column: 'order_id' }] },
      'TC-26': { spawn: [{ onInsertInto: 'order_lines', table: 'line_notes', column: 'line_id' }] },
      'TC-27': { fks: { cyc_a: [{ child: 'cyc_b', childColumns: ['a_id'], parentColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' }], cyc_b: [{ child: 'cyc_a', childColumns: ['b_id'], parentColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' }] } },
      'TC-28': { spawn: [{ onInsertInto: 'orders', table: 'assignments', column: 'order_id' }] },
      'TC-29': { triggers: { orders: [{ name: 'tr_audit', events: ['INSERT'], body: 'BEGIN INSERT INTO audit (ref) VALUES (NEW.id); RETURN NEW; END' }] } },
      'TC-30': { triggers: UPD }, 'TC-31': { triggers: { orders: [{ name: 'tr_hidden', events: ['INSERT'], body: null }] } },
      'TC-32': { extraSideEffect: true }, 'TC-34': { identity: { database: 'orders_other', server: 'db-test' } }, 'TC-35': { identity: { database: 'orders_prod', server: 'db-test' } },
      'TC-38': { readBackLie: true }, 'TC-39': { transactional: false },
    };
    const all = Array.from({ length: 21 }, (_, i) => 'TC-' + (20 + i)).filter((x) => x !== 'TC-33' && x !== 'TC-36').join(',');
    const r = await runPw(pw, pr, 'REQ-DB', { ...COMMON, FAKE_DB_SCENARIOS: JSON.stringify(scen), PW_DATA_CHANGES_TCS: all + ',TC-40' });
    if (!r.report) p.push('no JSON report: ' + r.stderr);
    for (const tc of ['TC-20', 'TC-21', 'TC-22', 'TC-29', 'TC-40']) expectStatus(p, r, tc, 'passed');
    const refusals = { 'TC-23': /ownership/, 'TC-24': /row-count/, 'TC-25': /cascade/, 'TC-26': /cascade/, 'TC-27': /cascade cycle/, 'TC-28': /cascade/, 'TC-30': /trigger/, 'TC-31': /trigger/, 'TC-32': /row-count/, 'TC-33': /data changes not permitted/, 'TC-34': /target unverified/, 'TC-35': /production marker/, 'TC-37': /identity/, 'TC-38': /read-back mismatch/, 'TC-39': /not transactional/ };
    for (const [tc, re] of Object.entries(refusals)) expectStatus(p, r, tc, 'failed', re);
    const VERDICT = { 'TC-20': ['PASS'], 'TC-21': ['PASS'], 'TC-22': ['PASS'], 'TC-29': ['PASS'], 'TC-40': ['PASS'], 'TC-23': ['INCOMPLETE', /^data_write_refused \(ownership\)$/], 'TC-24': ['INCOMPLETE', /^data_write_refused \(row-count\)$/],
      'TC-25': ['INCOMPLETE', /^data_write_refused \(cascade\)$/], 'TC-26': ['INCOMPLETE', /^data_write_refused \(cascade\)$/], 'TC-27': ['INCOMPLETE', /^data_write_refused \(cascade\)$/], 'TC-28': ['INCOMPLETE', /^data_write_refused \(cascade\)$/],
      'TC-30': ['INCOMPLETE', /^data_write_refused \(trigger\)$/], 'TC-31': ['INCOMPLETE', /^data_write_refused \(trigger\)$/], 'TC-32': ['INCOMPLETE', /^data_write_refused \(row-count\)$/],
      'TC-33': ['NOT_RUN', /^not started: data changes not permitted/], 'TC-34': ['NOT_RUN', /target unverified/], 'TC-35': ['NOT_RUN', /production marker/], 'TC-37': ['INCOMPLETE', /^data_write_refused \(identity\)$/],
      'TC-38': ['INCOMPLETE', /^read_back_mismatch$/], 'TC-39': ['NOT_RUN', /not transactional/] };
    for (const [tc, [st, re]] of Object.entries(VERDICT)) expectVerdict(p, r, tc, st, re);
    const db = dbState(pr);
    const pre1 = db.orders.find((o) => o.id === 'pre-1');
    if (!pre1 || pre1.name !== 'Old') p.push('pre-1 was changed: ' + JSON.stringify(pre1));
    if (!db.orders.find((o) => o.id === 'pre-2')) p.push('the unpredicted side effect (TC-32) was committed: pre-2 is gone');
    for (const name of ['A-24', 'A-30', 'A-31', 'A-33', 'A-34', 'A-35', 'A-39']) if (db.orders.some((o) => o.name === name)) p.push(name + ' was inserted although its write was refused');
    for (const name of ['A-25', 'A-28', 'A-32']) if (!db.orders.some((o) => o.name === name)) p.push(name + ': the refused delete removed the order anyway');
    if (!db.order_lines.some((l) => String(l.id).startsWith('foreign-'))) p.push('TC-25: the pre-existing child was removed');
    if (!db.line_notes.some((l) => String(l.id).startsWith('foreign-'))) p.push('TC-26: the pre-existing grandchild was removed');
    if (!db.assignments.some((a) => String(a.id).startsWith('foreign-') && a.order_id !== null)) p.push('TC-28: the pre-existing assignment was nulled');
    if (!db.audit.length) p.push('TC-29: the INSERT-only audit trigger did not run (or was refused)');
    if (db.orders.some((o) => o.name === 'A-22b' || o.name === 'A-22')) p.push('TC-22: the own record was not deleted');
    const led = ledgerLines(pr);
    const of = (tc) => led.filter((l) => l.tc === tc && l.channel === 'db').map((l) => l.state);
    if (JSON.stringify(of('TC-21')) !== JSON.stringify(['intent', 'committed', 'verified', 'retained'])) p.push('TC-21 ledger ' + JSON.stringify(of('TC-21')));
    if (!of('TC-22').includes('teardown-done')) p.push('TC-22 ledger has no teardown-done for the delete: ' + JSON.stringify(of('TC-22')));
    if (!of('TC-24').includes('rolled_back') || of('TC-24').includes('committed')) p.push('TC-24 ledger ' + JSON.stringify(of('TC-24')));
    if (!of('TC-32').includes('rolled_back')) p.push('TC-32 ledger ' + JSON.stringify(of('TC-32')));
    if (of('TC-23').length || of('TC-30').length || of('TC-33').length) p.push('a write refused before its intent left ledger lines: ' + JSON.stringify({ tc23: of('TC-23'), tc30: of('TC-30'), tc33: of('TC-33') }));
    const recs = recordsOf(pr);
    if (leaksIn(recs).length) p.push('known secrets in DB records: ' + leaksIn(recs).join(', '));
    const r21 = recs.find((f) => /[\\/]TC-21[\\/]/.test(f) && /attempt-1\.record\.json$/.test(f));
    if (!r21) p.push('TC-21 has no record: ' + JSON.stringify(r.tests['TC-21']));
    else { const c = checkRecordFile(r21, { tc: 'TC-21', attempt: 1, status: 'PASS', backendLines: ['ER1'] }, [PASSWORD]); if (!c.ok) p.push('TC-21 record invalid: ' + c.problems.join('; ')); }
    check('2 DB: reads and own writes verified; ownership, row count, cascades (1 and 2 levels, SET NULL, cycle), triggers, side effects, consent, identity, production, keys, read-back, transactions — refused with nothing changed', p, { tests: Object.fromEntries(Object.entries(r.tests).map(([k, v]) => [k, v.status])) });
  }

  /* 3 — crash after commit: the intent survives, the next attach resolves it read-only; an unmatched intent stays in doubt */
  {
    const p = [];
    const pr = project(pw);
    const r1 = await runPw(pw, pr, 'TC-36', { ...COMMON, FAKE_DB_SCENARIOS: JSON.stringify({ 'TC-36': { crashAfterCommit: true } }), PW_DATA_CHANGES_TCS: 'TC-36' });
    if (r1.tests['TC-36'] && r1.tests['TC-36'].status === 'passed') p.push('a crash after commit was reported passed');
    const l1 = ledgerLines(pr).filter((l) => l.tc === 'TC-36');
    if (JSON.stringify(l1.map((l) => l.state)) !== JSON.stringify(['intent'])) p.push('after the crash the ledger should hold only the intent: ' + JSON.stringify(l1.map((l) => l.state)));
    if (!dbState(pr).orders.some((o) => o.name === 'A-36')) p.push('the committed row is not in the database (the crash case proves nothing)');
    // an intent nobody can match: an update of pre-1 to a value it never had
    fs.appendFileSync(pr.ledger, JSON.stringify({ at: new Date().toISOString(), run_id: 'selftest-run', channel: 'db', state: 'intent', write_id: 'selftest-run:TC-99:x', tc: 'TC-99', op: 'update', table: 'orders', key: { id: 'pre-1' }, intended: { name: 'Never' } }) + '\n');
    const r2 = await runPw(pw, pr, 'TC-20', { ...COMMON });
    expectStatus(p, r2, 'TC-20', 'passed');
    const states = ledgerLines(pr).filter((l) => l.write_id === (l1[0] || {}).write_id).map((l) => l.state);
    if (!states.includes('recovered')) p.push('the in-doubt insert was not resolved to recovered: ' + JSON.stringify(states));
    if (ledgerLines(pr).some((l) => l.tc === 'TC-99' && l.state !== 'intent')) p.push('an unmatched intent was resolved');
    if (!r2.tests['TC-20'] || !r2.tests['TC-20'].annotations.includes('data-in-doubt')) p.push('the remaining in-doubt intent was not annotated data-in-doubt');
    check('3 crash after commit: intent only, the row exists; the next attach recovers it read-only; an unmatched intent stays in doubt', p, { first: r1.tests['TC-36'], second: r2.tests['TC-20'] });
  }

  /* 4 — the record cannot be written → never PASS */
  {
    const p = [];
    const pr = project(pw);
    fs.writeFileSync(pr.shots, 'a file where the evidence folder should be');
    const r = await runPw(pw, pr, 'TC-03', { ...COMMON });
    if (!r.tests['TC-03'] || r.tests['TC-03'].status === 'passed') p.push('a test whose record could not be written passed: ' + JSON.stringify(r.tests['TC-03']));
    check('4 an unwritable record fails the test', p, { tc03: r.tests['TC-03'] });
  }

  /* 5 — hybrid: the image and the record (needs a Chromium for the runner) */
  {
    const p = [];
    const pr = project(pw);
    const r = await runPw(pw, pr, 'TC-50', { ...COMMON });
    const t = r.tests['TC-50'];
    if (t && t.status !== 'passed' && /Executable doesn't exist|browserType\.launch|playwright install/i.test(t.error || '')) cases.push({ case: '5 hybrid: image + record', ok: true, skipped: true, outcome: 'NOT_RUN', problems: [], detail: 'no browser for this Playwright runner — the hybrid case did not run (it is not counted as a pass)' });
    else {
      expectStatus(p, r, 'TC-50', 'passed');
      const recs = recordsOf(pr).filter((f) => /[\\/]TC-50[\\/]/.test(f));
      const img = path.join(pr.shots, 'phase-1', 'TC-50', 'chromium--none--r0', 'attempt-1.png');
      if (!fs.existsSync(img)) p.push('no image for the hybrid TC');
      if (recs.length !== 1 || !/chromium--none--r0[\\/]attempt-1\.record\.json$/.test(recs[0] || '')) p.push('the hybrid record is not beside the image: ' + JSON.stringify(recs) + ' ' + JSON.stringify(t));
      check('5 hybrid: a UI step and a DB check — the image AND the record, side by side', p, { tc50: t });
    }
  }
} finally {
  fsrv.close(); asrv.close();
  for (const d of sandboxes) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* temp clean-up is best effort */ } }
}

const notRun = cases.filter((c) => c.skipped).length;
const out = { tool: 'selftest-api-db', playwright: pw.version, ran: cases.length, ok: fail.length === 0, notRun, cases, mismatches: fail, note: fail.length ? 'The API / DB helpers disagree with their own cases — no backend test result may be trusted until this passes.' : 'The helpers refuse what they must, record what they may, and never leak a secret.' + (notRun ? ' ' + notRun + ' case(s) NOT_RUN (see the case) — not a pass.' : '') };
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
