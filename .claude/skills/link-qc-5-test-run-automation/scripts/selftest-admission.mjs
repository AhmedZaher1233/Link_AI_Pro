#!/usr/bin/env node
// selftest-admission.mjs — the REAL-Playwright integration test of assets/admission.template.ts (no browser is launched).
// Node >= 18, zero dependencies; it needs a local Playwright test runner (the `playwright` package with its `./test`
// export): QA_PLAYWRIGHT_DIR={that package folder}, else one Node can resolve from here, else one in the npm npx cache. It
// never installs anything; without a runner it reports NOT_RUN and exits 3 — never a pass.
//
// Each case builds a throw-away project in the temp folder from the real templates (helpers/admission.ts, steps.ts,
// rate-limit.ts, timeouts.ts) and fixtures/admission/ (fixtures written to the admission contract that log every side
// effect — worker seeding, a worker shared login, the per-test login, beforeAll hooks, test bodies — to PROBE_LOG), runs
// `playwright test` against a published admission state and classifies the JSON report with run-stage.mjs's own parser
// (collectTests → markFollowers → classifyTest):
//   1 control: state open → every side effect runs, every test passes (the probes work — no false pass below)
//   2 worker refused by TIMEOUT (paused, maxWaitMs 1.5 s): no seeding, no shared login, no per-test login, no beforeAll,
//     no body; every test NOT_RUN "not started: admission timeout (host pressure (memory))"; only the first worker waits —
//     the next ones are refused at once ({PW_ADMISSION_FILE}.refused)
//   3 worker refused by CANCELLATION (PW_CANCEL_FILE present): the same, reason "the stage stopped", nobody waits
//   4 a UNIT refused (a scoped cool-down on TC-02's service): the worker is admitted (worker setup may run), TC-02's own
//     login and body never run, TC-02 NOT_RUN admission timeout; the other tests pass
//   5 a reopened state (a new seq) after a refusal: the next call is admitted — the refusal note never outlives its state
// Exits non-zero on mismatch (1) or when it could not run (3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { collectTests, markFollowers, classifyTest, REASON } from './run-stage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, '..', 'assets');
const FIX = path.join(here, 'fixtures', 'admission');
const cases = [];
const fail = [];
const sandboxes = [];
const check = (name, problems, detail) => { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); };

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
  // a released version first, then the highest
  found.sort((a, b) => { const x = semverKey(a.version); const y = semverKey(b.version); for (let i of [3, 0, 1, 2]) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  return found[0] || null;
}

/* ---------------- one throw-away project ---------------- */
function project(pw) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-admission-'));
  sandboxes.push(root);
  const cp = (from, to) => { fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true }); fs.copyFileSync(from, path.join(root, to)); };
  cp(path.join(ASSETS, 'timeouts.template.ts'), 'timeouts.ts');
  cp(path.join(ASSETS, 'admission.template.ts'), 'helpers/admission.ts');
  cp(path.join(ASSETS, 'steps.template.ts'), 'helpers/steps.ts');
  cp(path.join(ASSETS, 'rate-limit.template.ts'), 'helpers/rate-limit.ts');
  cp(path.join(FIX, 'playwright.config.ts'), 'playwright.config.ts');
  cp(path.join(FIX, 'fixtures.ts'), 'fixtures.ts');
  cp(path.join(FIX, 'tests', 'admission.spec.ts'), 'tests/admission.spec.ts');
  // `@playwright/test` resolves to the SAME runner instance the CLI below loads (a second copy would be refused)
  const shim = path.join(root, 'node_modules', '@playwright', 'test');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, 'package.json'), JSON.stringify({ name: '@playwright/test', version: pw.version, main: 'index.js', exports: { '.': './index.js', './reporter': './reporter.js', './package.json': './package.json' } }));
  fs.writeFileSync(path.join(shim, 'index.js'), 'module.exports = require(' + JSON.stringify(path.join(pw.dir, 'test.js')) + ');\n');
  fs.writeFileSync(path.join(shim, 'reporter.js'), 'module.exports = {};\n');
  const art = path.join(root, 'artifacts');
  fs.mkdirSync(art, { recursive: true });
  return { root, art, admission: path.join(art, 'admission.json'), cancel: path.join(art, 'cancel.flag'), probe: path.join(art, 'probe.jsonl'), progress: path.join(art, 'progress.jsonl'), json: path.join(art, 'results.json') };
}
function publish(pr, state) { fs.writeFileSync(pr.admission, JSON.stringify({ schema: 'skill5-admission/1', runId: 'selftest', updatedAt: new Date().toISOString(), cooldowns: [], ...state })); }
function run(pw, pr, extraEnv = {}) {
  for (const f of [pr.probe, pr.progress, pr.json]) fs.rmSync(f, { force: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PW_')));
  Object.assign(env, { PW_ADMISSION_FILE: pr.admission, PW_CANCEL_FILE: pr.cancel, PW_PROGRESS_FILE: pr.progress, PW_JSON_OUT: pr.json, PW_OUTPUT_DIR: path.join(pr.root, 'test-results'), PROBE_LOG: pr.probe, PW_UNIT_SCOPES: '{}', PW_UNIT_MAP: '{}', CI: '1', FORCE_COLOR: '0' }, extraEnv);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(pw.dir, 'cli.js'), 'test', '-c', 'playwright.config.ts'], { cwd: pr.root, env, encoding: 'utf8', timeout: 180000, windowsHide: true });
  const ms = Date.now() - t0;
  let report = null;
  try { report = JSON.parse(fs.readFileSync(pr.json, 'utf8')); } catch { /* reported by the case */ }
  const probes = fs.existsSync(pr.probe) ? fs.readFileSync(pr.probe, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).what) : [];
  const beats = fs.existsSync(pr.progress) ? fs.readFileSync(pr.progress, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const tests = report ? markFollowers(collectTests(report, pr.root)) : [];
  const verdicts = Object.fromEntries(tests.map((t) => { const c = classifyTest(t); return [t.tcs.join(',') || t.title, { raw: t.status, status: c.status, reason: c.reason, error: t.error }]; }));
  return { exit: r.status, signal: r.signal, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), ms, report: !!report, probes, beats, verdicts, stderr: (r.stderr || '').slice(-2000), stdout: (r.stdout || '').slice(-1000) };
}
const ALL = ['TC-01', 'TC-02', 'TC-10', 'TC-11'];
const SIDE_EFFECTS = (probes) => probes.filter((w) => /^(seed|shared-login|login |beforeAll |body )/.test(w));
const brief = (x) => ({ exit: x.exit, timedOut: x.timedOut, ms: x.ms, report: x.report, probes: x.probes, verdicts: x.verdicts, stderr: x.report ? undefined : x.stderr });

const pw = findPlaywright();
if (!pw || pw.error) {
  const out = { tool: 'selftest-admission', ran: 0, ok: false, outcome: 'NOT_RUN', reason: pw && pw.error ? pw.error : 'no local Playwright test runner (set QA_PLAYWRIGHT_DIR to a `playwright` package folder) — nothing is installed by this harness', cases: [] };
  process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
  process.exit(3);
}

/* 1 — control: open → every side effect runs, every test passes. */
{
  const p = [];
  const pr = project(pw);
  publish(pr, { seq: 1, state: 'open', reason: null, maxWaitMs: 1500 });
  const r = run(pw, pr);
  if (!r.report) p.push('no JSON report: ' + r.stderr);
  for (const tc of ALL) if (!r.verdicts[tc] || r.verdicts[tc].status !== 'PASS') p.push(tc + ' ' + JSON.stringify(r.verdicts[tc]));
  for (const w of ['seed', 'shared-login', 'beforeAll REQ-01', 'beforeAll serial', 'body TC-01', 'body TC-02', 'body TC-10', 'body TC-11']) if (!r.probes.includes(w)) p.push('the probe "' + w + '" never ran — the control proves nothing');
  if (!r.probes.some((w) => w.startsWith('login [TC-02]'))) p.push('the per-test login probe never ran');
  check('1 control: an open state admits everything — every side-effect probe fires, every test passes', p, { playwright: pw.version, ...brief(r) });
}

/* 2 — a worker refused by TIMEOUT: nothing with a side effect runs; every test NOT_RUN admission timeout; one wait only. */
{
  const p = [];
  const pr = project(pw);
  publish(pr, { seq: 7, state: 'paused', reason: 'host pressure (memory)', maxWaitMs: 1500 });
  const r = run(pw, pr);
  if (!r.report) p.push('no JSON report: ' + r.stderr);
  const fx = SIDE_EFFECTS(r.probes);
  if (fx.length) p.push('side effects ran after the refusal: ' + JSON.stringify(fx));
  const want = REASON.admissionTimeout('host pressure (memory)');
  for (const tc of ALL) if (!r.verdicts[tc] || r.verdicts[tc].status !== 'NOT_RUN' || r.verdicts[tc].reason !== want) p.push(tc + ' ' + JSON.stringify(r.verdicts[tc]));
  const waits = r.beats.filter((b) => b.event === 'admission-wait' && b.phase === 'end');
  if (waits.filter((b) => b.outcome === 'timeout').length !== 1) p.push('expected exactly ONE timed-out worker wait (the next workers refused at once): ' + JSON.stringify(waits));
  if (!fs.existsSync(pr.admission + '.refused')) p.push('no refusal note beside the state file');
  check('2 a worker refused by timeout: no seeding, shared login, per-test login, beforeAll or body; every test NOT_RUN admission timeout; the next workers refused at once', p, brief(r));
}

/* 3 — a worker refused by CANCELLATION: the same, at once, reason "the stage stopped". */
{
  const p = [];
  const pr = project(pw);
  publish(pr, { seq: 3, state: 'paused', reason: 'host pressure (cpu)', maxWaitMs: 60000 });
  fs.writeFileSync(pr.cancel, new Date().toISOString());
  const r = run(pw, pr);
  if (!r.report) p.push('no JSON report: ' + r.stderr);
  const fx = SIDE_EFFECTS(r.probes);
  if (fx.length) p.push('side effects ran after the cancellation: ' + JSON.stringify(fx));
  const want = REASON.admissionTimeout('the stage stopped');
  for (const tc of ALL) if (!r.verdicts[tc] || r.verdicts[tc].status !== 'NOT_RUN' || r.verdicts[tc].reason !== want) p.push(tc + ' ' + JSON.stringify(r.verdicts[tc]));
  if (r.ms > 45000) p.push('a cancelled stage still waited (' + r.ms + ' ms)');
  check('3 a worker refused by cancellation: nothing with a side effect runs; every test NOT_RUN "admission timeout (the stage stopped)"; no wait', p, brief(r));
}

/* 4 — a UNIT refused (TC-02's service cooling down): its login and body never run; the rest passes. */
{
  const p = [];
  const pr = project(pw);
  publish(pr, { seq: 2, state: 'open', reason: null, maxWaitMs: 1500, cooldowns: [{ scope: 'service:login', until: new Date(Date.now() + 120000).toISOString() }] });
  const r = run(pw, pr, { PW_UNIT_SCOPES: JSON.stringify({ 'TC-02': ['service:login'] }) });
  if (!r.report) p.push('no JSON report: ' + r.stderr);
  if (r.probes.some((w) => w.startsWith('login [TC-02]') || w === 'body TC-02')) p.push('TC-02\'s own side effects ran: ' + JSON.stringify(r.probes));
  const v = r.verdicts['TC-02'];
  if (!v || v.status !== 'NOT_RUN' || !/^not started: admission timeout \(cool-down service:login until /.test(v.reason || '')) p.push('TC-02 ' + JSON.stringify(v));
  for (const tc of ['TC-01', 'TC-10', 'TC-11']) if (!r.verdicts[tc] || r.verdicts[tc].status !== 'PASS') p.push(tc + ' ' + JSON.stringify(r.verdicts[tc]));
  check('4 a unit refused by a scoped cool-down: its per-test login and body never run, NOT_RUN admission timeout; the other tests pass', p, brief(r));
}

/* 5 — the refusal note dies with its state: after a refusal, a NEW published state (another seq, open) admits again. */
{
  const p = [];
  const pr = project(pw);
  publish(pr, { seq: 4, state: 'paused', reason: 'host pressure (memory)', maxWaitMs: 1000 });
  run(pw, pr);
  publish(pr, { seq: 5, state: 'open', reason: null, maxWaitMs: 1000 });
  const r = run(pw, pr);
  for (const tc of ALL) if (!r.verdicts[tc] || r.verdicts[tc].status !== 'PASS') p.push(tc + ' ' + JSON.stringify(r.verdicts[tc]));
  check('5 a refusal never outlives its state: a reopened state (new seq) admits the next run', p, brief(r));
}

for (const s of sandboxes) { try { fs.rmSync(s, { recursive: true, force: true }); } catch { /* a temp folder left behind is harmless */ } }
const out = { tool: 'selftest-admission', playwright: { version: pw.version, dir: pw.dir }, ran: cases.length, ok: fail.length === 0, cases, mismatches: fail };
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
