#!/usr/bin/env node
// selftest-lite.mjs — regression harness for lite.mjs (skill 5c). Node >= 18, zero dependencies.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE: a failing case means a Lite verdict cannot be trusted.
// It never runs Playwright, never touches the network and never writes to the Full skill: every case works on a
// temporary copy of the Full skill's own fixtures (scripts/fixtures/check, run-data, run-stage, impact), reached BY PATH,
// and the harness hashes the Full scripts before and after to prove they were not changed. The real capacity ledger in
// the user's home is never used (a throw-away QA_CAPACITY_DIR and fixed host readings).
//
// Run: node selftest-lite.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateA, evaluateB, scanMapping, leafOf, pickWorkers, FULL, FULL_DIR, LITE_VERSION } from './lite.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(here, '..');
const LITE = path.join(here, 'lite.mjs');
const FX = path.join(FULL, 'fixtures');
const FAKE_TSC = path.join(FX, 'check', 'bin', 'fake-tsc.mjs');
const FAKE_PW = path.join(FX, 'run-stage', 'fake-playwright.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lite-selftest-'));
const CAP = fs.mkdtempSync(path.join(TMP, 'cap-'));
const PS = path.join(TMP, 'ps.json');
fs.writeFileSync(PS, JSON.stringify([{ pid: 'SELF', ppid: 'PARENT', start: null, cmd: 'node lite.mjs (fixture table)' }]));
const ENV = { QA_CAPACITY_DIR: CAP, QA_CAPACITY_PS_FIXTURE: PS, QA_CAPACITY_HOST_FIXTURE: JSON.stringify({ availableMb: 65536, totalMemMb: 131072, cpus: 16, cpuPct: 5 }) };

const cases = []; const failed = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) failed.push({ case: name, problems }); }
const eq = (p, what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(what + ': got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want)); };
const truthy = (p, what, v) => { if (!v) p.push(what); };
const jread = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const posixRel = (from, to) => path.relative(from, to).replace(/\\/g, '/');

const hashTree = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile() && /\.mjs$/.test(e.name)) h.update(e.name + fs.readFileSync(f)); } };
  walk(dir);
  return h.digest('hex');
};
const FULL_BEFORE = hashTree(FULL);

/* The engine manifest (1.5.1): sha256 of every vendored engine file (line endings normalised), so a local edit or a partial
   refresh of engine/ is detected. `--write-engine-manifest` regenerates it after a deliberate change (ENGINE.md). */
const ENGINE = path.join(SKILL, 'engine');
const MANIFEST = path.join(SKILL, 'references', 'maintainers', 'engine-manifest.json');
const engineFiles = () => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'fixtures') walk(f); } else if (e.isFile()) out.push(posixRel(ENGINE, f)); } };
  walk(ENGINE);
  return out.sort();
};
const engineHash = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ENGINE, rel), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const engineVersion = () => (fs.readFileSync(path.join(ENGINE, 'SKILL.md'), 'utf8').match(/version:\s*"([^"]+)"/) || [])[1] || null;
if (process.argv.includes('--write-engine-manifest')) {
  const files = Object.fromEntries(engineFiles().map((r) => [r, engineHash(r)]));
  fs.writeFileSync(MANIFEST, JSON.stringify({ schema: 'lite-engine-manifest/1', engineVersion: engineVersion(), files }, null, 2) + '\n');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ tool: 'selftest-lite', wrote: posixRel(SKILL, MANIFEST), files: Object.keys(files).length }) + '\n');
  process.exit(0);
}

function lite(argv, { cwd = process.cwd(), env = {} } = {}) {
  const e = { ...process.env, ...ENV, ...env };
  if (!('QA_LEDGER' in env)) delete e.QA_LEDGER; // the run protections refuse QA_LEDGER=off: only the stage cases set it
  const r = spawnSync(process.execPath, [LITE, ...argv], { cwd, encoding: 'utf8', timeout: 180000, env: e });
  let json = null;
  try { json = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop()); } catch { json = null; }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}
const node = (script, argv, cwd) => { const e = { ...process.env, ...ENV }; delete e.QA_LEDGER; return spawnSync(process.execPath, [path.join(FULL, script), ...argv], { cwd, encoding: 'utf8', env: e }); };

/* ---------- a Checkpoint A project: Full's check fixture with the run protections reconciled (what stage 1 does) ---------- */
const SCOPE = ['Testing/Automation/tests/orders.spec.ts', 'Testing/Automation/pages/OrdersPage.ts', 'Testing/Automation/helpers/evidence.ts'];
const RR = 'Testing/Automation/reports/US-1-orders';
const DOCS = ['--tc', 'Testing/Manual_Test/TEST-CASES-orders.md', '--data', 'Testing/Manual_Test/TEST-DATA-orders.md', '--req', 'Testing/Requirements/REQ-orders.md'];
const COV_FULL = { tcs: [{ tc: 'TC-01', status: 'Fully Covered', mappedTests: ['orders.spec.ts'] }, { tc: 'TC-02', status: 'Fully Covered', mappedTests: ['orders.spec.ts'] }], requirements: [{ id: 'REQ-001', outcome: 'Full' }] };
function projectA(name, { reconcile = true } = {}) {
  const proj = path.join(TMP, name);
  fs.cpSync(path.join(FX, 'check', 'project'), proj, { recursive: true });
  fs.mkdirSync(path.join(proj, RR, '.runs'), { recursive: true });
  fs.copyFileSync(path.join(FX, 'check', 'run-file.json'), path.join(proj, RR, '.runs', 'phase-1.json'));
  fs.writeFileSync(path.join(proj, 'cov.json'), JSON.stringify(COV_FULL));
  if (reconcile) node('config-inventory.mjs', ['reconcile', '--root', '.', '--results-root', RR, '--run-file', RR + '/.runs/phase-1.json', '--apply'], proj);
  return proj;
}
const A = (proj, extra = [], { files = SCOPE, env = {}, cov = 'cov.json' } = {}) => lite(['checkpoint-a', '--root', '.', '--results-root', RR, '--phase', '1', ...(files.length ? ['--files', files.join(',')] : []), ...DOCS, ...(cov ? ['--coverage', cov] : []), '--tsc', FAKE_TSC, ...extra], { cwd: proj, env });
const specText = (assertLine, helperLine = '') => `import { test, expect } from '@playwright/test';
import { OrdersPage } from '../pages/OrdersPage';
import { captureEvidence } from '../helpers/evidence';

test.describe('REQ-001: an order can be created and listed', () => {
  test('[TC-01] Validate that a new order appears in the list', async ({ page }, testInfo) => {
    const orders = new OrdersPage(page);
    await orders.create('Alpha');
    await captureEvidence(page, testInfo);
    ${assertLine}
  });

  test('[TC-02] Validate that the save confirmation is shown', async ({ page }, testInfo) => {
    const orders = new OrdersPage(page);
    await orders.create('Beta');
    await captureEvidence(page, testInfo);
    await expect(orders.nameCell('Beta')).toHaveText('Beta');
  });
});
${helperLine}`;

/* 1 — static: the script loads, --help names every command, the Full dependency is guarded. */
{
  const p = [];
  const h = lite(['--help']);
  eq(p, 'help exit', h.status, 0);
  eq(p, 'commands', h.json && Object.keys(h.json.commands).sort(), ['auth', 'cache', 'checkpoint-a', 'consent', 'finalize', 'init-run', 'journey', 'preflight', 'rerun-select', 'stage', 'teardown']);
  truthy(p, 'Full skill found by path', fs.existsSync(path.join(FULL, 'check.mjs')));
  for (const f of ['check.mjs', 'run-data.mjs', 'run-stage.mjs', 'impact.mjs', 'coverage.mjs', 'render-run-report.mjs', 'validate-automation.mjs', 'parallel-plan.mjs', 'tc-hash.mjs', 'config-inventory.mjs', 'capacity.mjs']) truthy(p, 'Full script missing: ' + f, fs.existsSync(path.join(FULL, f)));
  const g = lite(['checkpoint-a', '--results-root', 'x', '--phase', '1', '--files', 'a.ts'], { env: { QA_LITE_FULL_DIR: path.join(TMP, 'no-such-skill') } });
  eq(p, 'missing Full → BLOCKED exit 2', [g.status, g.json && g.json.outcome], [2, 'BLOCKED']);
  truthy(p, 'missing engine names the folder', g.json && /engine is missing/.test(g.json.reason));
  truthy(p, 'standalone: the engine lives inside the skill', process.env.QA_LITE_FULL_DIR || path.relative(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), FULL_DIR) === 'engine');
  const u = lite(['nope']);
  eq(p, 'unknown command', [u.status, u.json && u.json.outcome], [2, 'BLOCKED']);
  check('1 static: loads, every command listed, Full dependency guarded', p, { full: FULL_DIR });
}

/* 2 — init-run: folder conventions (SPEC / US parent), stages from Smoke / Type, layers, defaults md + failed, phase counter. */
{
  const p = [];
  const proj = path.join(TMP, 'init');
  const dir = path.join(proj, 'Testing', 'Manual_Test', 'TestCases', 'SPEC-demo', 'US-1-orders');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(FX, 'check', 'project', 'Testing', 'Manual_Test', 'TEST-CASES-orders.md'), path.join(dir, 'TEST-CASES-orders.md'));
  fs.mkdirSync(path.join(proj, 'Testing', 'Automation'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Testing', 'qa-manifest.json'), JSON.stringify({ paths: { automationRoot: 'Testing/Automation' } }));
  const tc = 'Testing/Manual_Test/TestCases/SPEC-demo/US-1-orders/TEST-CASES-orders.md';
  eq(p, 'leafOf', leafOf(tc), { leaf: 'SPEC-demo/US-1-orders', feature: 'orders' });
  const r = lite(['init-run', '--root', '.', '--tc', tc, '--environment', 'local', '--env-url', 'http://localhost:3000', '--env-class', 'test'], { cwd: proj });
  eq(p, 'exit / outcome', [r.status, r.json && r.json.outcome], [0, 'OK']);
  const file = path.join(proj, 'Testing', 'Automation', 'reports', 'SPEC-demo', 'US-1-orders', '.runs', 'phase-1.json');
  truthy(p, 'run file at reports/SPEC-demo/US-1-orders/.runs/phase-1.json', fs.existsSync(file));
  if (fs.existsSync(file)) {
    const run = jread(file);
    eq(p, 'schema / phase / status', [run.schema, run.phase, run.status], ['skill6-run/1', 1, 'planning']);
    eq(p, 'roots', [run.results_root, run.screenshots_root, run.logs_root, run.spec_level], ['reports/SPEC-demo/US-1-orders', 'screenshots/SPEC-demo/US-1-orders', 'automation-logs/SPEC-demo/US-1-orders', 'SPEC-demo/']);
    eq(p, 'stages from Smoke / Type', run.lite.stages, { smoke: ['TC-01'], positive: ['TC-02'], negative: [] });
    eq(p, 'defaults: markdown, screenshots of failures', [run.delivery.report, run.delivery.screenshots], ['md', 'failed']);
    eq(p, 'one group named like Full\'s @run:parallel tag, every in-scope TC, one worker until readiness proves more', run.run_plan.groups, [{ name: 'parallel', mode: 'parallel', workers: 1, tcs: ['TC-01', 'TC-02'] }]);
    eq(p, 'environment class kept (data safety reads it)', run.environment.class, 'test');
    eq(p, 'user story id / name', [run.user_story_id, run.user_story], ['US-1', 'US-1-orders']);
  }
  const again = lite(['init-run', '--root', '.', '--tc', tc], { cwd: proj });
  eq(p, 'a second call opens phase 2 (never rewrites phase 1)', again.json && again.json.phase, 2);
  const clash = lite(['init-run', '--root', '.', '--tc', tc, '--phase', '1'], { cwd: proj });
  eq(p, 'an existing phase is refused', [clash.status, clash.json && clash.json.outcome], [2, 'BLOCKED']);
  const unapproved = path.join(dir, 'TEST-CASES-draft.md');
  fs.writeFileSync(unapproved, fs.readFileSync(path.join(dir, 'TEST-CASES-orders.md'), 'utf8').replace('**Status:** APPROVED', '**Status:** PENDING HUMAN REVIEW'));
  const un = lite(['init-run', '--root', '.', '--tc', 'Testing/Manual_Test/TestCases/SPEC-demo/US-1-orders/TEST-CASES-draft.md'], { cwd: proj });
  truthy(p, 'an unapproved document is named in next (the one approval question)', un.json && /not APPROVED/.test(un.json.next));
  check('2 init-run: SPEC/US folders, stages, layers, delivery defaults, phase counter, approval hint', p, r.json);
}

/* 2b — RC-L1 / L3 / L9: init-run writes the run plan merge needs (projects + one required variant per TC), takes the browser
   project from the shared config, writes the data_changes record itself (init-run and consent), and --force redoes a phase
   only while no stage has run. */
{
  const p = [];
  const proj = path.join(TMP, 'init-plan');
  const dir = path.join(proj, 'Testing', 'Manual_Test', 'TestCases', 'US-2-orders');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(FX, 'check', 'project', 'Testing', 'Manual_Test', 'TEST-CASES-orders.md'), path.join(dir, 'TEST-CASES-orders.md'));
  fs.mkdirSync(path.join(proj, 'Testing', 'Automation'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'Testing', 'Automation', 'playwright.config.ts'), "import { defineConfig, devices } from '@playwright/test';\nexport default defineConfig({\n  use: { baseURL: 'http://localhost:3000' }, // name: 'not-a-project'\n  projects: [\n    // { name: 'commented-out' },\n    { name: 'chrome', use: { ...devices['Desktop Chrome'] } },\n  ],\n});\n");
  const tc = 'Testing/Manual_Test/TestCases/US-2-orders/TEST-CASES-orders.md';
  const rf = path.join(proj, 'Testing', 'Automation', 'reports', 'US-2-orders', '.runs', 'phase-1.json');
  const r = lite(['init-run', '--root', '.', '--tc', tc, '--env-class', 'test', '--allow-data-changes', 'TC-02'], { cwd: proj });
  eq(p, 'init-run OK', [r.status, r.json && r.json.outcome, r.json && r.json.project], [0, 'OK', 'chrome']);
  const run = fs.existsSync(rf) ? jread(rf) : {};
  eq(p, 'L9: the browser project comes from the shared config, never a guessed chromium', [run.lite && run.lite.project, run.run_plan && run.run_plan.projects], ['chrome', ['chrome']]);
  eq(p, 'L1: one required variant per in-scope TC (Full\'s run-plan shape)', run.run_plan && run.run_plan.required_variants, { 'TC-01': ['chrome--none--r0'], 'TC-02': ['chrome--none--r0'] });
  const dc = run.data_changes || {};
  eq(p, 'L3: the data_changes record run-stage and check 53 read', [dc.consent, dc.tcs, dc.setup, dc.cleanup, typeof dc.asked_at, dc.environment_class], ['yes', ['TC-02'], true, true, 'string', 'test']);
  const rd = await import(pathToFileURL(path.join(FULL, 'run-data.mjs')).href);
  eq(p, 'L1: merge keeps an executed variant under the required slug (no roll to NOT_RUN)', rd.defaultProjectFor(run, 'TC-01') + '--none--r0', run.run_plan.required_variants['TC-01'][0]);
  const wrong = lite(['init-run', '--root', '.', '--tc', tc, '--project', 'chromium', '--force'], { cwd: proj });
  eq(p, 'L9: a --project the config does not define is refused', [wrong.status, wrong.json && /not a project of the shared config/.test(wrong.json.reason)], [2, true]);
  const forced = lite(['init-run', '--root', '.', '--tc', tc, '--env-class', 'staging', '--force'], { cwd: proj });
  eq(p, 'L9: --force rewrites the latest phase while nothing ran (phase stays 1, consent kept)', [forced.json && forced.json.outcome, forced.json && forced.json.phase, jread(rf).data_changes.tcs], ['OK', 1, ['TC-02']]);
  const prog = path.join(proj, 'Testing', 'Automation', 'reports', 'US-2-orders', 'artifacts', 'progress');
  fs.mkdirSync(prog, { recursive: true });
  fs.writeFileSync(path.join(prog, 'first-smoke-1.summary.json'), JSON.stringify({ phase: 1, stage: 'smoke' }));
  const refused = lite(['init-run', '--root', '.', '--tc', tc, '--force'], { cwd: proj });
  eq(p, 'L9: --force is refused once a stage ran in the phase', [refused.status, refused.json && /already executed/.test(refused.json.reason)], [2, true]);
  const bad = lite(['init-run', '--root', '.', '--tc', tc, '--phase', '5', '--allow-data-changes', 'all'], { cwd: proj });
  eq(p, 'L3: data changes without a test / staging class are refused (nothing written)', [bad.status, fs.existsSync(rf.replace('phase-1', 'phase-5'))], [2, false]);
  const unk = lite(['consent', '--run-file', rf, '--allow-data-changes', 'TC-99'], { cwd: proj });
  eq(p, 'L3: consent refuses a TC outside the run scope', [unk.status, unk.json && /outside the run scope/.test(unk.json.reason)], [2, true]);
  const all = lite(['consent', '--run-file', rf, '--allow-data-changes', 'all'], { cwd: proj });
  eq(p, 'L3: consent all → every in-scope TC', [all.json && all.json.outcome, jread(rf).data_changes.tcs, jread(rf).data_changes.consent], ['OK', ['TC-01', 'TC-02'], 'yes']);
  lite(['consent', '--run-file', rf, '--allow-data-changes', 'none'], { cwd: proj });
  eq(p, 'L3: consent none → consent no, no TC', [jread(rf).data_changes.consent, jread(rf).data_changes.tcs], ['no', []]);
  check('2b init-run / consent: run plan + required variants, config project, data_changes record, --force before execution only', p, r.json);
}

/* 3 — cache: new / changed / unchanged by sha256; only --mark records. */
{
  const p = [];
  const proj = path.join(TMP, 'cache'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.ts'), 'one');
  const rr = path.join(proj, 'rr');
  const c1 = lite(['cache', '--root', '.', '--results-root', rr, '--files', 'a.ts,missing.ts'], { cwd: proj });
  eq(p, 'first look: new + missing', [c1.json.new, c1.json.missing], [['a.ts'], ['missing.ts']]);
  eq(p, 'no --mark → nothing recorded', fs.existsSync(path.join(rr, 'artifacts', 'lite', 'read-cache.json')), false);
  lite(['cache', '--root', '.', '--results-root', rr, '--files', 'a.ts', '--mark'], { cwd: proj });
  eq(p, 'unchanged after mark', lite(['cache', '--root', '.', '--results-root', rr, '--files', 'a.ts'], { cwd: proj }).json.unchanged, ['a.ts']);
  fs.writeFileSync(path.join(proj, 'a.ts'), 'two');
  const c3 = lite(['cache', '--root', '.', '--results-root', rr, '--files', 'a.ts'], { cwd: proj });
  eq(p, 'changed → read again', [c3.json.changed, c3.json.read], [['a.ts'], ['a.ts']]);
  check('3 cache: new / changed / unchanged, recorded only with --mark', p, {});
}

/* 4 — Checkpoint A, safety: the four checks pass but the run protections are not active → FAIL, named as safety. */
{
  const p = [];
  const proj = projectA('a-safety', { reconcile: false });
  const r = A(proj);
  eq(p, 'exit / outcome', [r.status, r.json && r.json.outcome], [1, 'FAIL']);
  eq(p, 'the four checks', r.json && r.json.checks, { tsc: 'PASS', pom: 'PASS', traceability: 'PASS', assertions: 'PASS' });
  truthy(p, 'safety named', r.json && /^FAIL/.test(r.json.safety) && r.json.problems.some((x) => /^safety:/.test(x)));
  check('4 A safety: protections inactive → FAIL while the four checks pass', p, r.json && { safety: r.json.safety });
}

/* 5 — Checkpoint A PASS: gate record shape, reuse of the mechanical run, side files, coverage snapshot. */
const PA = projectA('a-pass');
{
  const p = [];
  const r = A(PA);
  eq(p, 'exit / outcome', [r.status, r.json && r.json.outcome], [0, 'PASS']);
  eq(p, 'four checks', r.json && r.json.checks, { tsc: 'PASS', pom: 'PASS', traceability: 'PASS', assertions: 'PASS' });
  const gate = path.join(PA, RR, '.runs', 'phase-1.checkpoint-A.json');
  truthy(p, 'gate record written', fs.existsSync(gate));
  if (fs.existsSync(gate)) {
    const g = jread(gate);
    eq(p, 'schema / checkpoint / phase / verdict / profile', [g.schema, g.checkpoint, g.phase, g.verdict, g.profile], ['skill5-gate/1', 'A', 1, 'PASS', 'lite']);
    eq(p, 'exactly the four Lite checks', g.results.map((x) => x.checkId), ['lite:tsc', 'lite:pom', 'lite:traceability', 'lite:assertions']);
    eq(p, 'rehash matched, counts', [g.rehash.matched, g.counts.required, g.counts.fail], [true, 4, 0]);
    truthy(p, 'copy under artifacts/checks/{sid}/gate-A.json', fs.existsSync(path.join(PA, RR, 'artifacts', 'checks', g.snapshotId, 'gate-A.json')));
  }
  const run = jread(path.join(PA, RR, '.runs', 'phase-1.json'));
  eq(p, 'run file records the story specs for stage / rerun-select', run.lite && run.lite.specs, ['tests/orders.spec.ts']);
  truthy(p, 'coverage snapshot written for Checkpoint B (report-only mechanism)', run.coverage_snapshot && run.coverage_snapshot.tcs);
  const again = A(PA);
  eq(p, 'second call: same snapshot → mechanical results reused', [again.json.outcome, again.json.reusedMechanical, again.json.snapshotId], ['PASS', true, r.json.snapshotId]);
  check('5 A PASS: gate record (4 checks, profile lite), mechanical reuse, run file facts', p, r.json);
}

/* 5b — RC-L2: a consented data-changing TC whose spec reaches no data-ledger call is a WARN at Checkpoint A (never a FAIL);
   routing the change through prerequest/ledger.ts clears it. H2: `playwright test --list` — a spec that does not load FAILs tsc. */
const FAKE_LIST = path.join(TMP, 'fake-list.mjs');
fs.writeFileSync(FAKE_LIST, "import fs from 'node:fs';\nconst specs = process.argv.slice(2).filter((a) => /\\.spec\\./.test(a));\nconst bad = specs.find((s) => /LOAD_ERROR/.test(fs.readFileSync(s, 'utf8')));\nif (bad) { console.error('Error: ' + bad + ': tag must start with \"@\"'); process.exit(1); }\nconsole.log('Total: 2 tests in ' + specs.length + ' file');\n");
{
  const p = [];
  const proj = projectA('a-ledger');
  fs.writeFileSync(path.join(proj, 'Testing/Automation/tests/orders.spec.ts'), specText("await expect(orders.nameCell('Alpha')).toHaveText('Alpha');"));
  const rf = path.join(proj, RR, '.runs', 'phase-1.json');
  fs.writeFileSync(rf, JSON.stringify({ ...jread(rf), data_changes: { consent: 'yes', tcs: ['TC-02'], setup: true, cleanup: true } }));
  const r = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'still PASS — the ledger warning never fails the gate', [r.json && r.json.outcome, r.json && r.json.ledger && r.json.ledger.tcs], ['PASS', ['TC-02']]);
  truthy(p, 'the warning says what to do', r.json && r.json.ledger && /data-ledger/.test(r.json.ledger.fix) && /ledger/.test(r.json.next));
  truthy(p, 'the gate record keeps the warning', (jread(path.join(proj, RR, '.runs', 'phase-1.checkpoint-A.json')).ledgerWarnings || []).some((w) => w.tc === 'TC-02'));
  truthy(p, 'H2: the specs load → tsc reason says so', /specs load/.test(JSON.stringify(jread(path.join(proj, RR, '.runs', 'phase-1.checkpoint-A.json')).results[0].reason)));
  const spec = path.join(proj, 'Testing/Automation/tests/orders.spec.ts');
  fs.mkdirSync(path.join(proj, 'Testing/Automation/prerequest'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'assets', 'templates', 'prerequest-ledger.ts'), path.join(proj, 'Testing/Automation/prerequest/ledger.ts'));
  fs.writeFileSync(spec, "import { recordChange } from '../prerequest/ledger';\n" + fs.readFileSync(spec, 'utf8'));
  const r2 = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'a spec that reaches the ledger through its imports → no warning', [r2.json && r2.json.outcome, r2.json && r2.json.ledger], ['PASS', undefined]);
  fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8').replace("'[TC-02] Validate", "'[TC-02] Validate /* LOAD_ERROR */"));
  const r3 = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'H2: a spec that does not load → tsc FAIL before any stage', [r3.json && r3.json.outcome, r3.json && r3.json.checks && r3.json.checks.tsc], ['FAIL', 'FAIL']);
  truthy(p, 'H2: the load error is named', r3.json && r3.json.problems.some((x) => /^tsc: list: .*tag must start/.test(x)));
  check('5b A: ledger warning per consented TC without a ledger path (WARN only); playwright --list load errors FAIL tsc', p, r.json && { ledger: r.json.ledger });
}

/* 5c — L12: ledger OWNERSHIP read statically at Checkpoint A (check 53 accepts writes on run-owned records only). The template's
   labelling (createOrModify for the clock / reset, inRunData for a change inside the run-created data set, create for a record
   the run submits) passes; a `modify` of a resource no ledger call creates, a `remove` of one and any `modify-external` FAIL
   with the file:line — before a single test runs; a computed key on a run-created resource is a warning only. */
{
  const p = [];
  const proj = projectA('a-ownership');
  const auto = path.join(proj, 'Testing/Automation');
  const rf = path.join(proj, RR, '.runs', 'phase-1.json');
  fs.writeFileSync(rf, JSON.stringify({ ...jread(rf), data_changes: { consent: 'yes', tcs: ['TC-01', 'TC-02'], setup: true, cleanup: true } }));
  fs.mkdirSync(path.join(auto, 'prerequest'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'assets', 'templates', 'prerequest-ledger.ts'), path.join(auto, 'prerequest/ledger.ts'));
  const support = (body) => fs.writeFileSync(path.join(auto, 'prerequest/support.ts'), "import { recordChange, createOrModify, inRunData, CLOCK, SEED } from './ledger';\n" + body);
  const GOOD = [
    "export async function prepare(): Promise<void> {",
    "  await recordChange({ purpose: 'setup', op: createOrModify(CLOCK), ...CLOCK, note: 'server clock → the TC start time' }, async () => 1);",
    "  await recordChange({ purpose: 'setup', op: createOrModify(SEED), ...SEED, note: 'reset to the seed data' }, async () => 1);",
    "}",
    "export async function approve(no: string): Promise<void> {",
    "  await recordChange(inRunData(SEED, 'test', 'approve ' + no), async () => 1);",
    "}",
    "export async function submit(): Promise<void> {",
    "  await recordChange({ purpose: 'test', op: 'create', resource: 'order', key: null, note: 'submit' }, async () => ({ no: 'ORD-1' }), { keyAfter: (r) => r.no });",
    "}",
    "export async function teardown(): Promise<void> {",
    "  await recordChange({ purpose: 'teardown', op: 'remove', ...CLOCK, note: 'restore the real time' }, async () => 1);",
    "  await recordChange({ purpose: 'teardown', op: 'modify', ...SEED, note: 'reset once' }, async () => 1);",
    "}",
  ].join('\n') + '\n';
  support(GOOD);
  const spec = path.join(auto, 'tests/orders.spec.ts');
  fs.writeFileSync(spec, "import { prepare } from '../prerequest/support';\n" + specText("await expect(orders.nameCell('Alpha')).toHaveText('Alpha');"));
  const r = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'template labelling → PASS, no ownership finding', [r.json && r.json.outcome, r.json && r.json.ownership], ['PASS', undefined]);
  const gate = jread(path.join(proj, RR, '.runs', 'phase-1.checkpoint-A.json'));
  truthy(p, 'the gate record keeps the scan (labels read, nothing failed)', gate.ledgerOwnership && gate.ledgerOwnership.labels >= 6 && gate.ledgerOwnership.fail.length === 0);
  // run-1 labelling: the clock override and the seed reset as `modify`, the outbox as `remove` — nothing creates them
  support(GOOD.replace('op: createOrModify(CLOCK)', "op: 'modify'").replace('op: createOrModify(SEED)', "op: 'modify'")
    + "export const OUTBOX = { resource: 'development outbox', key: 'outbox' } as const;\nexport async function clear(): Promise<void> {\n  await recordChange({ purpose: 'setup', op: 'remove', ...OUTBOX, note: 'clear the outbox' }, async () => 1);\n}\n");
  const r2 = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'modify / remove of a resource nobody creates → FAIL (safety)', [r2.json && r2.json.outcome, r2.json && r2.json.safety, r2.json && r2.json.ownership && r2.json.ownership.fail], ['FAIL', 'FAIL (6)', 6]);
  const own = (r2.json && r2.json.problems || []).filter((x) => /^safety: ledger ownership:/.test(x));
  truthy(p, 'the clock modify is named with its file:line', own.some((x) => /prerequest\/support\.ts:3 modify of "server clock override" — no ledger call in scope creates it/.test(x)));
  truthy(p, 'the outbox remove is named', own.some((x) => /remove of "development outbox"/.test(x)));
  truthy(p, 'the fix says what to do', r2.json && r2.json.ownership && /createOrModify/.test(r2.json.ownership.fix) && /modify-external/.test(r2.json.ownership.fix));
  // a change declared external is refused at A as it is at B
  support(GOOD + "export async function touch(): Promise<void> {\n  await recordChange({ purpose: 'test', op: 'modify-external', resource: 'shared price list', key: 'PL-1', note: 'edit a shared fixture' }, async () => 1);\n}\n");
  const r3 = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'modify-external → FAIL', [r3.json && r3.json.outcome, r3.json && r3.json.ownership && r3.json.ownership.fail], ['FAIL', 1]);
  truthy(p, 'modify-external says check 53 refuses it whatever the consent', (r3.json && r3.json.problems || []).some((x) => /modify-external of "shared price list" — .*whatever the consent/.test(x)));
  // a computed key on a resource the run creates: a warning, never a FAIL (proven only at B)
  support(GOOD + "export async function decide(no: string): Promise<void> {\n  await recordChange({ purpose: 'test', op: 'modify', resource: 'order', key: no, note: 'decide' }, async () => 1);\n}\n");
  const r4 = A(proj, ['--cli', FAKE_LIST]);
  eq(p, 'computed key on a run-created resource → PASS with a warning', [r4.json && r4.json.outcome, r4.json && r4.json.ownership && r4.json.ownership.warn], ['PASS', 1]);
  // evaluateA keeps the lane: an ownership FAIL fails an otherwise clean gate
  const okV = { gate: 'PASS', findings: [], counts: { files: 1 }, scope: { unreadable: [], parseFailures: [] } };
  const cov = { judgements: COV_FULL, errors: [], summary: null };
  const ev = evaluateA({ components: { tsc: { status: 'PASS' }, validator: okV, ownership: { fail: ['x.ts:1 modify of "seed" — no ledger call in scope creates it'], warn: [] } }, ruleToCheck: {}, mapping: { 'TC-01': ['orders.spec.ts'], 'TC-02': ['orders.spec.ts'] }, coverage: cov, docIds: null, review: null, snapshotId: 's' });
  eq(p, 'evaluateA: ownership FAIL → FAIL', [ev.verdict, ev.safety.fail[0]], ['FAIL', 'ledger ownership: x.ts:1 modify of "seed" — no ledger call in scope creates it']);
  check('5c A: ledger ownership read statically — template labelling PASS, modify / remove of an unowned resource and modify-external FAIL', p, r2.json && { ownership: r2.json.ownership });
}

/* 5c — RC-L4: finalize refreshes Checkpoint A on the final scope with the inputs of the last PASS when a file changed after it —
   and a refresh that FAILs stops finalize (the gate is never bypassed). */
{
  const p = [];
  const proj = projectA('a-refresh');
  eq(p, 'A PASS records its inputs', A(proj).json.outcome, 'PASS');
  const inputs = jread(path.join(proj, RR, '.runs', 'phase-1.json')).lite.checkpoint_a;
  eq(p, 'inputs: documents, coverage, files', [inputs.tc, inputs.coverage, inputs.files.length], ['Testing/Manual_Test/TEST-CASES-orders.md', 'cov.json', 3]);
  const pom = path.join(proj, 'Testing/Automation/pages/OrdersPage.ts');
  fs.appendFileSync(pom, '\n// healed after Checkpoint A\n');
  const fin = (files = SCOPE) => lite(['finalize', '--root', '.', '--results-root', RR, '--phase', '1', '--files', files.join(','), '--tsc', FAKE_TSC, '--feature', 'orders'], { cwd: proj });
  const f1 = fin();
  truthy(p, 'the refresh ran and passed, then A applies (finalize goes on past checkpoint-A)', f1.json && /checkpoint-A refresh ✓ · checkpoint-A ✓/.test(f1.json.steps || ''));
  fs.appendFileSync(pom, '\n// second heal\n');
  fs.writeFileSync(path.join(proj, 'Testing/Automation/tests/orders.spec.ts'), specText('expect(1).toBe(1);'));
  const f2 = fin();
  eq(p, 'a refresh that FAILs → BLOCKED at checkpoint-A, nothing drafted further', [f2.json && f2.json.outcome, f2.json && f2.json.step, f2.json && f2.json.checkpointA && f2.json.checkpointA.checks.assertions], ['BLOCKED', 'checkpoint-A', 'FAIL']);
  check('5c finalize: Checkpoint A refreshed on the final scope by itself; a failing refresh blocks', p, { f1: f1.json && f1.json.steps, f2: f2.json && f2.json.reason });
}

/* 6 — A FAIL pom: a raw locator + focused test (and its duplicate TC id) in scope. */
{
  const p = [];
  const proj = projectA('a-pom');
  const r = A(proj, [], { files: [...SCOPE, 'Testing/Automation/tests/bad.spec.ts'] });
  eq(p, 'outcome', [r.status, r.json.outcome], [1, 'FAIL']);
  eq(p, 'pom FAIL (the other checks are reported on their own)', r.json.checks.pom, 'FAIL');
  truthy(p, 'actionable rule file:line listed', r.json.problems.some((x) => /^pom: .*bad\.spec\.ts:\d+ pom-raw-locator/.test(x)));
  check('6 A FAIL pom', p, r.json);
}

/* 7 — A FAIL tsc. */
{
  const p = [];
  const proj = projectA('a-tsc');
  const r = A(proj, [], { env: { FAKE_TSC: 'fail' } });
  eq(p, 'outcome / tsc', [r.json.outcome, r.json.checks.tsc], ['FAIL', 'FAIL']);
  truthy(p, 'the error is listed', r.json.problems.some((x) => /^tsc: /.test(x)));
  check('7 A FAIL tsc', p, r.json);
}

/* 8 — A FAIL traceability: a TC without a judgement, a covered TC no title carries, a Not Covered TC without a reason. */
{
  const p = [];
  const proj = projectA('a-trace');
  fs.writeFileSync(path.join(proj, 'cov2.json'), JSON.stringify({ tcs: [{ tc: 'TC-01', status: 'Fully Covered' }] }));
  const r = A(proj, [], { cov: 'cov2.json' });
  eq(p, 'outcome / traceability', [r.json.outcome, r.json.checks.traceability], ['FAIL', 'FAIL']);
  truthy(p, 'the missing judgement is named', r.json.problems.some((x) => /TC-02/.test(x)));
  fs.writeFileSync(path.join(proj, 'cov3.json'), JSON.stringify({ tcs: [{ tc: 'TC-01', status: 'Fully Covered' }, { tc: 'TC-02', status: 'Not Covered' }] }));
  const r3 = A(proj, [], { cov: 'cov3.json' });
  truthy(p, 'Not Covered without a documented exclusion fails', r3.json.checks.traceability === 'FAIL' && r3.json.problems.some((x) => /TC-02: Not Covered without a documented exclusion/.test(x)));
  fs.writeFileSync(path.join(proj, 'cov4.json'), JSON.stringify({ tcs: [{ tc: 'TC-01', status: 'Fully Covered' }, { tc: 'TC-02', status: 'Not Covered', category: 'Not an automation candidate', note: 'manual: needs a human reviewer' }] }));
  const r4 = A(proj, [], { cov: 'cov4.json' });
  eq(p, 'a documented exclusion passes traceability', r4.json.checks.traceability, 'PASS');
  const noCov = A(proj, [], { cov: null });
  eq(p, 'no coverage judgements → FAIL', [noCov.json.checks.traceability, noCov.json.outcome], ['FAIL', 'FAIL']);
  check('8 A FAIL traceability: missing, unmapped, undocumented exclusion; documented exclusion passes', p, r.json);
}

/* 9 — A FAIL traceability: duplicate mapping across spec files, an ID not in the approved document. */
{
  const p = [];
  const proj = projectA('a-dup');
  fs.writeFileSync(path.join(proj, 'Testing/Automation/tests/dup.spec.ts'), specText("await expect(orders.nameCell('Alpha')).toHaveText('Alpha');"));
  const r = A(proj, [], { files: [...SCOPE, 'Testing/Automation/tests/dup.spec.ts'] });
  eq(p, 'outcome / traceability', [r.json.outcome, r.json.checks.traceability], ['FAIL', 'FAIL']);
  truthy(p, 'duplicate mapping named', r.json.problems.some((x) => /duplicate mapping/.test(x)));
  const proj2 = projectA('a-unknown');
  fs.writeFileSync(path.join(proj2, 'Testing/Automation/tests/orders.spec.ts'), specText("await expect(orders.nameCell('Alpha')).toHaveText('Alpha');").replace('[TC-02]', '[TC-02] [TC-99]'));
  const r2 = A(proj2);
  truthy(p, 'an ID the document does not know is named', r2.json.problems.some((x) => /TC-99/.test(x)));
  check('9 A FAIL traceability: duplicate mapping, unknown ID', p, r.json);
}

/* 10 — A FAIL assertions: a placeholder assertion; then the targeted-review path for an untraceable / conditional one. */
{
  const p = [];
  const proj = projectA('a-assert');
  fs.writeFileSync(path.join(proj, 'Testing/Automation/tests/orders.spec.ts'), specText('expect(1).toBe(1);'));
  const r = A(proj);
  eq(p, 'placeholder assertion → FAIL', [r.json.outcome, r.json.checks.assertions], ['FAIL', 'FAIL']);
  truthy(p, 'listed with its rule', r.json.problems.some((x) => /placeholder-assertion/.test(x)));
  // conditional assertion inside a helper: static analysis cannot prove it runs → a targeted review closes it, nothing else does
  const proj2 = projectA('a-review');
  fs.writeFileSync(path.join(proj2, 'Testing/Automation/pages/OrdersPage.ts'), fs.readFileSync(path.join(proj2, 'Testing/Automation/pages/OrdersPage.ts'), 'utf8').replace("import { type Page, type Locator } from '@playwright/test';", "import { expect, type Page, type Locator } from '@playwright/test';").replace(/\n}\s*$/, "\n\n  async expectListed(name: string) {\n    if (name) {\n      await expect(this.nameCell(name)).toHaveText(name);\n    }\n  }\n}\n"));
  fs.writeFileSync(path.join(proj2, 'Testing/Automation/tests/orders.spec.ts'), specText("await orders.expectListed('Alpha');"));
  const r1 = A(proj2);
  const open = (r1.json.problems || []).filter((x) => /^assertions: /.test(x));
  eq(p, 'conditional assertion → FAIL until reviewed', [r1.json.outcome, r1.json.checks.assertions], ['FAIL', 'FAIL']);
  truthy(p, 'the item is a file:line rule reference', open.length === 1 && /assertions-(conditional|unresolved)/.test(open[0]));
  if (open.length === 1) {
    const ref = open[0].replace(/^assertions: /, '');
    fs.writeFileSync(path.join(proj2, 'review.json'), JSON.stringify({ snapshot: 'wrong-snapshot', items: { [ref]: 'expectListed asserts the row text whenever a name is given' } }));
    const wrong = A(proj2, ['--assertion-review', 'review.json']);
    eq(p, 'a review written for another snapshot is ignored', wrong.json.checks.assertions, 'FAIL');
    fs.writeFileSync(path.join(proj2, 'review.json'), JSON.stringify({ snapshot: r1.json.snapshotId, items: { [ref]: 'short' } }));
    eq(p, 'a reason under 8 characters does not close it', A(proj2, ['--assertion-review', 'review.json']).json.checks.assertions, 'FAIL');
    fs.writeFileSync(path.join(proj2, 'review.json'), JSON.stringify({ snapshot: r1.json.snapshotId, items: { [ref]: 'expectListed asserts the row text whenever a name is given' } }));
    const ok = A(proj2, ['--assertion-review', 'review.json']);
    eq(p, 'a targeted review of exactly that line closes it', [ok.json.outcome, ok.json.checks.assertions], ['PASS', 'PASS']);
    const g = jread(path.join(proj2, RR, '.runs', 'phase-1.checkpoint-A.json'));
    truthy(p, 'the review is on the record', g.assertionReview.length === 1);
  }
  check('10 A FAIL assertions: placeholder; conditional closed only by a targeted review of that line', p, r.json);
}

/* 11 — A NOT_RUN without files; evaluateA hard paths: never PASS a check that did not run. */
{
  const p = [];
  const r = A(PA, [], { files: [] });
  eq(p, 'no --files → NOT_RUN exit 3', [r.status, r.json && r.json.outcome], [3, 'NOT_RUN']);
  const base = { ruleToCheck: {}, mapping: {}, coverage: { judgements: { tcs: [] }, errors: [] }, docIds: [], snapshotId: 's1' };
  const ok = { gate: 'PASS', counts: { files: 1 }, findings: [], notRun: [], scope: { unreadable: [], parseFailures: [] } };
  eq(p, 'validator error → BLOCKED', evaluateA({ ...base, components: { tsc: { status: 'PASS' }, validator: { error: 'boom' } } }).verdict, 'BLOCKED');
  eq(p, 'validator NOT_RUN → NOT_RUN', evaluateA({ ...base, components: { tsc: { status: 'PASS' }, validator: { ...ok, gate: 'NOT_RUN', gateReason: 'no spec' } } }).verdict, 'NOT_RUN');
  eq(p, 'unreadable file → BLOCKED', evaluateA({ ...base, components: { tsc: { status: 'PASS' }, validator: { ...ok, scope: { unreadable: [{ file: 'a' }], parseFailures: [] } } } }).verdict, 'BLOCKED');
  eq(p, 'tsc did not run → BLOCKED (never PASS)', evaluateA({ ...base, components: { tsc: { status: 'notRun', reason: 'no tsc' }, validator: ok } }).verdict, 'BLOCKED');
  eq(p, 'everything clean → PASS', evaluateA({ ...base, components: { tsc: { status: 'PASS' }, validator: ok } }).verdict, 'PASS');
  check('11 A NOT_RUN / BLOCKED paths never PASS a check that did not run', p, {});
}

/* 12 — the mapping scan reads test titles only. */
{
  const p = [];
  const proj = path.join(TMP, 'map'); fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'a.spec.ts'), "test('[TC-01] a', async () => {});\ntest.fixme('[TC-02][TC-03] b', async () => {});\n// test('[TC-09] commented title', …)\nconst s = 'TC-10';\n");
  eq(p, 'mapping', scanMapping(proj, ['a.spec.ts']), { 'TC-01': ['a.spec.ts'], 'TC-02': ['a.spec.ts'], 'TC-03': ['a.spec.ts'], 'TC-09': ['a.spec.ts'] });
  check('12 mapping scan: [TC-ID] of test titles (variants of one file are one mapping)', p, {});
}

/* ---------- stage sandbox: Full's run-stage fixture + a fake Playwright; the real run-stage.mjs runs underneath ---------- */
const STAGES = { smoke: ['TC-001', 'TC-002', 'TC-003', 'TC-010'], positive: ['TC-004', 'TC-005', 'TC-007', 'TC-008'], negative: ['TC-006', 'TC-011', 'TC-012'] };
const SPEC = 'tests/Orders_Tests/03-create-order.spec.ts';
function stageBox(name) {
  const root = path.join(TMP, name);
  const results = path.join(root, 'reports', 'US-1234-create-order');
  fs.mkdirSync(path.join(results, '.runs'), { recursive: true });
  const run = jread(path.join(FX, 'run-stage', 'phase-3.json'));
  run.lite = { version: '1', project: 'chromium', stages: STAGES, max_workers: 2, specs: [SPEC], log: 'automation-logs/US-1234-create-order/run-progress-selftest.log' };
  fs.writeFileSync(path.join(results, '.runs', 'phase-3.json'), JSON.stringify(run, null, 2));
  fs.copyFileSync(path.join(FULL_DIR, 'assets', 'timeouts.template.ts'), path.join(root, 'timeouts.ts'));
  return { root, results, runFile: path.join(results, '.runs', 'phase-3.json') };
}
// a copy of the fake with a second failing smoke TC (TC-001) so the gate sees 50 % — Full's fixture is never edited
const FAKE_BAD_DIR = path.join(TMP, 'fake-bad');
fs.mkdirSync(FAKE_BAD_DIR, { recursive: true });
fs.copyFileSync(FAKE_PW, path.join(FAKE_BAD_DIR, 'fake-playwright.mjs'));
{ const suite = jread(path.join(FX, 'run-stage', 'suite.json')); for (const t of suite.tests) if (/\[TC-001\]/.test(t.title)) { t.outcome = 'failed'; t.error = 'expect(locator).toBeVisible() failed'; } fs.writeFileSync(path.join(FAKE_BAD_DIR, 'suite.json'), JSON.stringify(suite)); }
const BAD = path.join(FAKE_BAD_DIR, 'fake-playwright.mjs');
const S = (sb, stg, extra = [], scenario = {}, cli = FAKE_PW) => lite(['stage', '--run-file', sb.runFile, '--stage', stg, '--cli', cli, ...extra], { cwd: sb.root, env: { QA_LEDGER: 'off', FAKE_PW_SCENARIO: JSON.stringify(scenario) } });
const summaries = (sb) => fs.existsSync(path.join(sb.results, 'artifacts', 'progress')) ? fs.readdirSync(path.join(sb.results, 'artifacts', 'progress')).filter((f) => /^first-.*\.summary\.json$/.test(f)) : [];

/* 13 — stage: one worker without proof of independence, compact counts, failures named, next action. */
{
  const p = [];
  const sb = stageBox('st1');
  const r = S(sb, 'smoke', ['--stage-tcs', 'TC-001,TC-002,TC-003,TC-010']);
  const j = r.json || {};
  eq(p, 'exit / outcome', [r.status, j.outcome], [0, 'COMPLETED']);
  eq(p, 'counts', [j.counts && j.counts.passed, j.counts && j.counts.failed, j.counts && j.counts.tcs], [3, 1, 4]);
  eq(p, 'one worker, serial, and why', [j.workers, j.scheduler], [1, 'serial']);
  truthy(p, 'serial reason reported', /readiness|no readiness|candidate concurrency|without proof/i.test(String(j.serialBecause || '')) || j.serialBecause);
  eq(p, 'the failing TC is named', j.failing, ['TC-003']);
  eq(p, 'smoke gate 25 % ≤ 30 % continues', j.smokeGate && j.smokeGate.decision, 'continue');
  truthy(p, 'next action asks for classification of the failure', /classify 1 failure/.test(j.next || ''));
  truthy(p, 'compact: no log or payload in the stdout line', r.stdout.length < 2500);
  const pos = S(sb, 'positive', ['--stage-tcs', 'TC-004,TC-007']);
  eq(p, 'positive runs after a passing gate ([TC-007][TC-008] is one test, two TCs)', [pos.json && pos.json.outcome, pos.json && pos.json.counts && pos.json.counts.passed], ['COMPLETED', 3]);
  // a cap of 2 asks for the readiness check; without a proven-independent plan (no real specs here) it must stay serial, never above the cap
  const sb2 = stageBox('st1b');
  const cap = S(sb2, 'smoke', ['--stage-tcs', 'TC-001,TC-002,TC-003,TC-010', '--max-workers', '2']);
  truthy(p, 'cap 2: completes and never exceeds the cap', cap.json && cap.json.outcome === 'COMPLETED' && cap.json.workers >= 1 && cap.json.workers <= 2 && cap.json.workerCap === 2);
  truthy(p, 'cap 2 without proof of independence stays on one worker and says why', cap.json && cap.json.workers === 1 && (cap.json.readiness || cap.json.serialBecause));
  check('13 stage: compact verdict, one worker by default, gate continues ≤ 30 %, cap never exceeded', p, j);
}

/* 13b — the worker policy: max 5, at least 2 when ≥ 2 independent TCs are proven, otherwise 1. */
{
  const p = [];
  const w = (cap, k) => pickWorkers({ cap, candidateConcurrency: k });
  eq(p, 'no proof of independence (1 unit / unknown) → 1', [w(5, 1), w(5, undefined), w(5, 0), w(5, NaN)], [1, 1, 1, 1]);
  eq(p, 'exactly 2 independent → 2', w(5, 2), 2);
  eq(p, '3 independent → 3, 5 → 5', [w(5, 3), w(5, 5)], [3, 5]);
  eq(p, 'more independent units than the maximum → 5', [w(5, 12), w(undefined, 12)], [5, 5]);
  eq(p, 'a --max-workers above 5 is clamped to 5', w(9, 12), 5);
  eq(p, 'a lower --max-workers wins', [w(2, 12), w(3, 12)], [2, 3]);
  eq(p, '--max-workers 1 → serial whatever the proof', w(1, 12), 1);
  check('13b worker policy: max 5, min 2 for proven-independent TCs, 1 when they share data', p, {});
}

/* 13c — no host-memory gate: a tiny host makes Full's ledger refuse ("insufficient capacity"); Lite never stops or waits on it —
   preflight stays READY and the stage runs serially without the ledger (one worker). */
{
  const p = [];
  const TINY = JSON.stringify({ availableMb: 300, totalMemMb: 32768, cpus: 8, cpuPct: 5 }); // a normal machine with almost no FREE memory (the E2 run)
  const sb = stageBox('st-mem');
  const pf = lite(['preflight', '--run-file', sb.runFile, '--cli', FAKE_PW], { cwd: sb.root, env: { QA_CAPACITY_HOST_FIXTURE: TINY } });
  eq(p, 'preflight on a low-memory host: READY (memory never blocks)', [pf.status, pf.json && pf.json.outcome], [0, 'READY']);
  truthy(p, 'no memory text left in the blocking reason', pf.json && !/insufficient capacity|free memory/.test(String(pf.json.reason || '')));
  if (pf.json && /^low/.test(pf.json.memory)) eq(p, 'low memory → the run file remembers: serial without the ledger', jread(sb.runFile).lite.no_ledger, true);
  const st = lite(['stage', '--run-file', sb.runFile, '--stage', 'smoke', '--stage-tcs', 'TC-001,TC-002,TC-003,TC-010', '--cli', FAKE_PW], { cwd: sb.root, env: { QA_CAPACITY_HOST_FIXTURE: TINY } });
  eq(p, 'stage runs anyway (never blocked / waiting on memory)', [st.json && st.json.outcome, st.json && st.json.workers], ['COMPLETED', 1]);
  // the memory reasons are recognised wherever run-stage puts them, including the sub-reasons it joins with "; "
  const { isMemoryReason } = await import(pathToFileURL(LITE).href);
  for (const s of ['insufficient capacity — 1024 MB total − 2048 MB reserve < 1536 MB per worker', '1 cores − 2 reserved < 1.5 per worker', 'free memory admits no headed worker right now (300 MB available)']) truthy(p, 'memory reason recognised: ' + s.slice(0, 40), isMemoryReason(s));
  for (const s of ['config location: outside the automation root', 'environment unreachable: http://x', 'environment lease: held by another run']) truthy(p, 'non-memory reason still blocks: ' + s.slice(0, 30), !isMemoryReason(s));
  // no preflight flag: a serial stage never enters the ledger, so low free memory cannot make it wait
  const sb2 = stageBox('st-mem2');
  const t0 = Date.now();
  const st2 = lite(['stage', '--run-file', sb2.runFile, '--stage', 'smoke', '--stage-tcs', 'TC-001,TC-002,TC-003,TC-010', '--cli', FAKE_PW], { cwd: sb2.root, env: { QA_CAPACITY_HOST_FIXTURE: TINY } });
  eq(p, 'serial stage on low free memory: COMPLETED, 1 worker', [st2.json && st2.json.outcome, st2.json && st2.json.workers], ['COMPLETED', 1]);
  truthy(p, 'no admission wait (well under the 10-minute budget)', Date.now() - t0 < 120000);
  // Full's hard floor stays (Full is unchanged): a host whose TOTAL memory cannot hold one browser is refused by Full itself
  const sb3 = stageBox('st-mem3');
  const st3 = lite(['stage', '--run-file', sb3.runFile, '--stage', 'smoke', '--stage-tcs', 'TC-001', '--cli', FAKE_PW], { cwd: sb3.root, env: { QA_CAPACITY_HOST_FIXTURE: JSON.stringify({ availableMb: 300, totalMemMb: 1024, cpus: 1, cpuPct: 5 }) } });
  eq(p, 'host below one browser: BLOCKED by Full, reason named', [st3.json && st3.json.outcome, /insufficient capacity/.test(String(st3.json && st3.json.reason))], ['BLOCKED', true]);
  check('13c no host-memory gate in Lite: preflight READY, serial stages never wait on memory; Full\'s one-browser floor stays', p, { pf: pf.json && pf.json.memory, st: st.json && st.json.memoryGate });
}

/* 14 — the 30 % smoke gate: > 30 % stops positive / negative; their TCs are never executed (NOT_RUN, never PASS). */
{
  const p = [];
  const sb = stageBox('st2');
  const r = S(sb, 'smoke', ['--stage-tcs', 'TC-001,TC-002,TC-003,TC-010'], {}, BAD);
  eq(p, 'smoke ran', r.json && r.json.outcome, 'COMPLETED');
  eq(p, 'fail % over the limit', [r.json.smokeGate.failPct, r.json.smokeGate.decision], [50, 'classify']);
  truthy(p, 'next says the gate failed', /smoke gate failed/.test(r.json.next));
  const pos = S(sb, 'positive', ['--stage-tcs', 'TC-004,TC-007'], {}, BAD);
  eq(p, 'positive refused: exit 1 STOPPED', [pos.status, pos.json && pos.json.outcome], [1, 'STOPPED']);
  truthy(p, 'reason names the gate and the limit', /smoke gate: 50% failed \(limit 30%\)/.test(pos.json.reason));
  truthy(p, 'NOT_RUN stated, never PASS', /stay NOT_RUN/.test(pos.json.reason));
  eq(p, 'the refused stage executed nothing (only the smoke summary exists)', summaries(sb), ['first-smoke-1.summary.json']);
  const neg = S(sb, 'negative', ['--stage-tcs', 'TC-006'], {}, BAD);
  eq(p, 'negative refused too', [neg.status, neg.json && neg.json.outcome], [1, 'STOPPED']);
  check('14 smoke gate: > 30 % stops positive and negative, nothing executed', p, pos.json);
}

/* 15 — staged order and NO VERDICT. */
{
  const p = [];
  const sb = stageBox('st3');
  const early = S(sb, 'positive', ['--stage-tcs', 'TC-004']);
  eq(p, 'positive before smoke → BLOCKED', [early.status, early.json && early.json.outcome], [2, 'BLOCKED']);
  truthy(p, 'reason names the order', /smoke stage first/.test(early.json.reason));
  eq(p, 'nothing executed', summaries(sb), []);
  const sb2 = stageBox('st4');
  const nv = S(sb2, 'smoke', ['--stage-tcs', 'TC-001,TC-002,TC-003,TC-010'], { parallel: 'no-verdict', 'serial-orders': 'no-verdict' });
  truthy(p, 'smoke without a verdict is reported', nv.json && (nv.json.smokeGate ? nv.json.smokeGate.decision === 'no_verdict' : true));
  const pos = S(sb2, 'positive', ['--stage-tcs', 'TC-004']);
  eq(p, 'no verdict → positive refused', [pos.status, pos.json && pos.json.outcome], [1, 'STOPPED']);
  truthy(p, 'reason says NO VERDICT', /NO VERDICT/.test(pos.json.reason));
  check('15 staged order enforced; smoke NO VERDICT stops the rest', p, { early: early.json && early.json.reason });
}

/* 16 — rerun-select: exactly the TCs a fix made stale; unchanged code → "Re-run not needed". */
{
  const p = [];
  const root = path.join(TMP, 'impact', 'project');
  fs.cpSync(path.join(FX, 'impact', 'project'), root, { recursive: true });
  const rr = path.join(root, 'reports', 'US-9-impact');
  const progress = path.join(rr, 'artifacts', 'progress');
  fs.mkdirSync(path.join(rr, '.runs'), { recursive: true }); fs.mkdirSync(progress, { recursive: true });
  const specs = ['tests/Orders_Tests/01-orders.spec.ts', 'tests/Orders_Tests/03-orders-dashboard.spec.ts'];
  const impact = await import(pathToFileURL(path.join(FULL, 'impact.mjs')).href);
  const fp = impact.fingerprintTests({ root, specs, cache: new Map() });
  const tcs = Object.keys(fp.tcs);
  fs.writeFileSync(path.join(progress, 'first-positive-1.summary.json'), JSON.stringify({ schema: 'skill5-run-stage/1', run: 'first', stage: 'positive', seq: 1, startedAt: '2026-10-01T09:00:00.000Z', tcs: Object.fromEntries(tcs.map((t) => [t, 'PASS'])), executed: Object.fromEntries(tcs.map((t) => [t, { status: 'PASS' }])), code: { tcs: fp.tcs, tests: fp.tests, files: fp.files, branches: fp.branches || {}, changed_during_call: [] } }));
  fs.writeFileSync(path.join(rr, '.runs', 'phase-1.json'), JSON.stringify({ schema: 'skill6-run/1', phase: 1, results_root: 'reports/US-9-impact', run_plan: { groups: [] }, lite: { specs, stages: { smoke: [], positive: tcs, negative: [] } } }));
  const runFile = path.join(rr, '.runs', 'phase-1.json');
  const none = lite(['rerun-select', '--run-file', runFile], { cwd: root });
  eq(p, 'unchanged code → nothing to re-run', [none.status, none.json.rerun, none.json.impactLevel], [0, [], null]);
  truthy(p, 'says Re-run not needed', /Re-run not needed/.test(none.json.next));
  const page = path.join(root, 'pages', 'OrderPage.ts');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace("name: 'Save'", "name: 'Store'"));
  const changed = lite(['rerun-select', '--run-file', runFile], { cwd: root });
  const want = ['TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08'].filter((t) => tcs.includes(t));
  truthy(p, 'a changed member stales some TCs and not all', changed.json.rerun.length > 0 && changed.json.rerun.length < tcs.length);
  truthy(p, 'impact level reported', ['file', 'method', 'branch'].includes(changed.json.impactLevel));
  truthy(p, 'grouped by stage for the stage calls', changed.json.byStage.positive.length === changed.json.rerun.length);
  truthy(p, 'next names the refresh of Checkpoint A', /checkpoint-a/.test(changed.json.next));
  check('16 rerun-select: unchanged → none; a changed page-object member → only the TCs that reach it', p, { stale: changed.json.rerun, of: tcs.length, want });
}

/* 16b — RC-L7: `lite teardown` runs the run-level restore / reset ONCE as a setup-stage journey (@setup @run:teardown) that is
   never a result; RC-L8: `--burn-in` reaches run-stage (×3) in a re-run; H3: a skipped test's annotation is its row's reason. */
const FAKE_TD_DIR = path.join(TMP, 'fake-td');
fs.mkdirSync(FAKE_TD_DIR, { recursive: true });
fs.copyFileSync(FAKE_PW, path.join(FAKE_TD_DIR, 'fake-playwright.mjs'));
{ const suite = jread(path.join(FX, 'run-stage', 'suite.json')); suite.tests.push({ file: 'tests/Orders_Tests/99-teardown-orders.spec.ts', describe: ['teardown'], title: 'Restore the environment once', tags: ['@setup', '@run:teardown'], outcome: 'passed' }); fs.writeFileSync(path.join(FAKE_TD_DIR, 'suite.json'), JSON.stringify(suite)); }
const TD = path.join(FAKE_TD_DIR, 'fake-playwright.mjs');
const argvFiles = (dir) => { const out = []; const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/fake-argv[\\/][^\\/]+\.json$/.test(f)) out.push(jread(f)); } }; walk(dir); return out; };
{
  const p = [];
  const sb = stageBox('st-td');
  const tdSpec = 'tests/Orders_Tests/99-teardown-orders.spec.ts';
  fs.mkdirSync(path.join(sb.root, 'tests', 'Orders_Tests'), { recursive: true });
  fs.writeFileSync(path.join(sb.root, tdSpec), "test('Restore the environment once', { tag: ['@setup', '@run:teardown'] }, async () => {});\n");
  S(sb, 'smoke', ['--stage-tcs', 'TC-001,TC-002,TC-003,TC-010'], {}, TD);
  const neg = S(sb, 'negative', ['--stage-tcs', 'TC-006,TC-011'], {}, TD);
  eq(p, 'negative ran', neg.json && neg.json.outcome, 'COMPLETED');
  const rd = await import(pathToFileURL(path.join(FULL, 'run-data.mjs')).href);
  const m1 = rd.runData({ _: ['merge'], 'run-file': sb.runFile });
  eq(p, 'H3: a SKIP row carries its skip-annotation reason (never a silent SKIP)', m1.tcs && m1.tcs['TC-011'], 'SKIP — skipped: precondition not met');
  const td = lite(['teardown', '--run-file', sb.runFile, '--spec', tdSpec, '--cli', TD], { cwd: sb.root, env: { QA_LEDGER: 'off' } });
  eq(p, 'teardown COMPLETED, one journey passed', [td.status, td.json && td.json.outcome, td.json && td.json.journeys && td.json.journeys.passed], [0, 'COMPLETED', 1]);
  const run = jread(sb.runFile);
  truthy(p, 'the run file remembers the teardown group and spec', (run.run_plan.setup_groups || []).some((g) => g.name === 'teardown' && g.spec === tdSpec) && run.lite.teardown && run.lite.teardown.spec === tdSpec);
  const tdArgv = argvFiles(sb.results).filter((a) => /@setup/.test(String(a.flags && a.flags.grep)));
  truthy(p, 'teardown filtered to @setup @run:teardown only, one worker', tdArgv.length === 1 && /@run:teardown/.test(tdArgv[0].flags.grep) && !/@run:setup-order-items/.test(tdArgv[0].flags.grep));
  const m2 = rd.runData({ _: ['merge'], 'run-file': sb.runFile });
  eq(p, 'the teardown is never a TC result (merge unchanged)', m2.tcs, m1.tcs);
  const again = lite(['teardown', '--run-file', sb.runFile, '--cli', TD], { cwd: sb.root, env: { QA_LEDGER: 'off' } });
  eq(p, 'a second teardown uses the remembered spec', again.json && again.json.outcome, 'COMPLETED');
  const bi = S(sb, 'negative', ['--run', 'rerun', '--stage-tcs', 'TC-006,TC-011', '--tcs', 'TC-006', '--burn-in', 'TC-006'], {}, TD);
  const burn = argvFiles(sb.results).filter((a) => String(a.flags && a.flags['repeat-each']) === '3' && /TC-006/.test(String(a.flags.grep)));
  truthy(p, 'L8: --burn-in reaches run-stage as a ×3 repeat of the healed TC', bi.json && bi.json.outcome === 'COMPLETED' && burn.length >= 1);
  check('16b teardown once as a setup journey; --burn-in passthrough; SKIP reason from the annotation', p, { td: td.json, bi: bi.json && bi.json.outcome });
}

/* ---------- finalize sandbox: Full's run-data fixture (a complete phase) + a Lite Checkpoint A record ---------- */
const SHOTS = ['TC-001/chromium--none--r0/attempt-1.png', 'TC-002/chromium--none--r0/attempt-1.png', 'TC-002/chromium--none--r0/attempt-1-failed.png', 'TC-002/chromium--none--r0/attempt-2.png', 'TC-003/chromium--none--r0/attempt-1.png', 'TC-003/chromium--none--r0/attempt-1-failed.png', 'TC-003/chromium--none--r0/attempt-2.png', 'TC-003/chromium--none--r1/attempt-1.png', 'TC-003/chromium--none--r2/attempt-1.png', 'TC-005/chromium--variation-a--r0/attempt-1.png', 'TC-005/chromium--variation-a--r0/attempt-2.png'].map((s) => 'screenshots/US-9001-sample/phase-1/' + s);
async function finBox(name, { gateA = true } = {}) {
  const dir = path.join(TMP, name);
  fs.cpSync(path.join(FX, 'run-data', 'automation'), dir, { recursive: true });
  for (const s of SHOTS) { const f = path.join(dir, s); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'PNG stub — not application evidence\n'); }
  fs.mkdirSync(path.join(dir, 'helpers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'helpers', 'evidence.ts'), 'export const x = 1;\n');
  const rr = path.join(dir, 'reports', 'US-9001-sample');
  if (gateA) {
    const check = await import(pathToFileURL(path.join(FULL, 'check.mjs')).href);
    const s = check.takeSnapshot({ root: dir, resultsRoot: rr, checkpoint: 'A', phase: 1, files: ['helpers/evidence.ts'], automationRoot: '.' });
    const rec = { schema: 'skill5-gate/1', checkpoint: 'A', phase: 1, verdict: 'PASS', profile: 'lite', snapshotId: s.snapshotId, rehash: { matched: true, differences: [] }, results: [] };
    fs.writeFileSync(path.join(rr, '.runs', 'phase-1.checkpoint-A.json'), JSON.stringify(rec));
    fs.mkdirSync(path.join(rr, 'artifacts', 'checks', s.snapshotId), { recursive: true });
    fs.writeFileSync(path.join(rr, 'artifacts', 'checks', s.snapshotId, 'gate-A.json'), JSON.stringify(rec));
  }
  fs.writeFileSync(path.join(dir, 'judgements.json'), JSON.stringify({ parallel_checks: [{ tc: 'TC-002', cause: 'test_data_conflict', resolution: 'test-side: the status filter is session state (learned conflict)' }] }));
  return { dir, rr };
}
const F = (b, extra = []) => lite(['finalize', '--root', b.dir, '--automation-root', '.', '--results-root', 'reports/US-9001-sample', '--phase', '1', '--files', 'helpers/evidence.ts', ...extra], { cwd: b.dir });

/* 17 — finalize: one call, three checks, gate-B record, publish, ACCEPTED; downstream readers accept the record. */
{
  const p = [];
  const b = await finBox('fin1');
  const r = F(b, ['--judgements', 'judgements.json']);
  const j = r.json || {};
  eq(p, 'exit / outcome', [r.status, j.outcome], [0, 'PUBLISHED']);
  eq(p, 'the three checks', j.checks, { 'results-integrity': 'PASS', 'tc-status-coverage': 'PASS', 'failure-evidence': 'PASS' });
  eq(p, 'accepted', j.acceptance, 'ACCEPTED');
  truthy(p, 'no review cycle: one call', !/AWAITING/.test(r.stdout));
  const gate = path.join(b.rr, '.runs', 'phase-1.checkpoint-B.json');
  truthy(p, 'gate-B record', fs.existsSync(gate));
  if (fs.existsSync(gate)) {
    const g = jread(gate);
    eq(p, 'schema / checkpoint / verdict / profile', [g.schema, g.checkpoint, g.verdict, g.profile], ['skill5-gate/1', 'B', 'PASS', 'lite']);
    eq(p, 'exactly three Lite checks', g.results.map((x) => x.checkId), ['lite:results-integrity', 'lite:tc-status-coverage', 'lite:failure-evidence']);
    truthy(p, 'frozen drafts + freshness + gate A reference', Object.keys(g.frozen.drafts).length >= 3 && g.freshness.known === true && g.gateA && g.gateA.verdict === 'PASS');
  }
  for (const f of ['TEST-RUN-REPORT-sample.md', 'BUG-REPORT-sample.md', 'TEST-RUN-REPORT-sample.html']) truthy(p, 'published ' + f, fs.existsSync(path.join(b.rr, f)));
  const rd = await import(pathToFileURL(path.join(FULL, 'run-data.mjs')).href);
  const rend = await import(pathToFileURL(path.join(FULL, 'render-run-report.mjs')).href);
  const h = rd.runData({ _: ['handoff'], 'run-file': path.join(b.rr, '.runs', 'phase-1.json') });
  eq(p, 'Full handoff reads the Lite records', h.outcome, 'OK');
  const pg = rend.render({ reportPath: path.join(b.rr, 'TEST-RUN-REPORT-sample.md'), gatePath: gate, root: b.rr });
  eq(p, 'Full renderer accepts the Lite gate record', [pg.payload.gate, (pg.model.warnings || []).filter((w) => /gate/.test(w.kind))], ['PASS', []]);
  const acc = rd.runData({ _: ['acceptance'], 'run-file': path.join(b.rr, '.runs', 'phase-1.json') });
  eq(p, 'Full acceptance agrees', acc.acceptance.verdict, 'ACCEPTED');
  check('17 finalize: one call → 3 checks → gate-B → publish → ACCEPTED; Full readers accept it', p, j);
}

/* 18 — finalize keeps what acceptance says: published but NOT ACCEPTED while a concurrency finding is unresolved. */
{
  const p = [];
  const b = await finBox('fin2');
  const r = F(b);
  eq(p, 'checkpoint passes', [r.json.outcome, r.json.checks['results-integrity']], ['PUBLISHED', 'PASS']);
  eq(p, 'acceptance NOT ACCEPTED with the reason', [r.json.acceptance, (r.json.notAccepted || []).some((x) => /TC-002/.test(x))], ['NOT ACCEPTED', true]);
  truthy(p, 'next never claims completion', /NOT ACCEPTED/.test(r.json.next) && !/AUTOMATION COMPLETE/.test(r.json.next.split(':')[0]));
  check('18 finalize: an unresolved finding keeps the run NOT ACCEPTED', p, r.json);
}

/* 19 — finalize BLOCKED without Checkpoint A; FAIL on missing evidence publishes nothing. */
{
  const p = [];
  const b0 = await finBox('fin3', { gateA: false });
  const r0 = F(b0, ['--judgements', 'judgements.json']);
  eq(p, 'no Checkpoint A → BLOCKED at checkpoint-A', [r0.status, r0.json.outcome, r0.json.step], [2, 'BLOCKED', 'checkpoint-A']);
  truthy(p, 'nothing published', !fs.existsSync(path.join(b0.rr, 'TEST-RUN-REPORT-sample.md')));
  const b = await finBox('fin4');
  fs.rmSync(path.join(b.dir, SHOTS[0]));
  const r = F(b, ['--judgements', 'judgements.json']);
  eq(p, 'missing evidence image → FAIL', [r.status, r.json.outcome], [1, 'FAIL']);
  eq(p, 'results-integrity FAIL', r.json.checks['results-integrity'], 'FAIL');
  truthy(p, 'the missing artifact is listed', (r.json.problems || []).some((x) => /results-integrity: 18/.test(x)));
  truthy(p, 'nothing published (no report, no page)', !fs.existsSync(path.join(b.rr, 'TEST-RUN-REPORT-sample.md')) && !fs.existsSync(path.join(b.rr, 'TEST-RUN-REPORT-sample.html')));
  eq(p, 'gate-B records FAIL', jread(path.join(b.rr, '.runs', 'phase-1.checkpoint-B.json')).verdict, 'FAIL');
  const bad = await finBox('fin5');
  fs.writeFileSync(path.join(bad.dir, 'bad-judgements.json'), JSON.stringify({ results: { 'TC-404': { classification: 'app_bug' } } }));
  const rj = F(bad, ['--judgements', 'bad-judgements.json']);
  eq(p, 'an unknown TC in the judgements → rejected as a whole, BLOCKED', [rj.json.outcome, rj.json.step], ['BLOCKED', 'judge']);
  check('19 finalize: BLOCKED without Checkpoint A; missing evidence FAILs and publishes nothing; bad judgements rejected', p, r.json);
}

/* 19b — RC-L6 + L19 (shared run-data.mjs): a finalize after a FAILED Checkpoint B publishes a report whose status lines come from
   the gate record of the snapshot it publishes — never the earlier snapshot's FAIL, never "pending". */
{
  const p = [];
  const b = await finBox('fin-l6');
  const shot = path.join(b.dir, SHOTS[0]);
  const bytes = fs.readFileSync(shot);
  fs.rmSync(shot);
  const r1 = F(b, ['--judgements', 'judgements.json']);
  eq(p, 'first finalize: B FAIL recorded, nothing published', [r1.json && r1.json.outcome, jread(path.join(b.rr, '.runs', 'phase-1.checkpoint-B.json')).verdict, fs.existsSync(path.join(b.rr, 'TEST-RUN-REPORT-sample.md'))], ['FAIL', 'FAIL', false]);
  fs.writeFileSync(shot, bytes);
  const r2 = F(b, ['--judgements', 'judgements.json']);
  eq(p, 'second finalize: PUBLISHED + ACCEPTED', [r2.json && r2.json.outcome, r2.json && r2.json.acceptance], ['PUBLISHED', 'ACCEPTED']);
  const rep = fs.existsSync(path.join(b.rr, 'TEST-RUN-REPORT-sample.md')) ? fs.readFileSync(path.join(b.rr, 'TEST-RUN-REPORT-sample.md'), 'utf8') : '';
  // L19: the status lines come from the gate record of the snapshot being published — an earlier FAIL record never shows
  const sid2 = r2.json && r2.json.snapshotId;
  const status = (rep.match(/^(?:\*\*Compliance:\*\*|- \*\*(?:Compliance|Acceptance):\*\*).*$/gm) || []).join('\n');
  truthy(p, 'L19: the published header shows the B record of the published snapshot (PASS ' + sid2 + ')', rep.split('\n').some((l) => l.startsWith('**Compliance:**') && l.includes('Checkpoint B PASS (' + sid2 + ')')));
  truthy(p, 'L19: never the earlier snapshot\'s FAIL, never "pending"', !/Checkpoint B FAIL/.test(rep) && !/pending/i.test(status));
  truthy(p, 'L19: the acceptance line says ACCEPTED', /^- \*\*Acceptance:\*\* ACCEPTED\s*$/m.test(rep));
  eq(p, 'L19: finalize reports the resolved status lines', !!(r2.json && r2.json.statusLines && r2.json.statusLines.resolved > 0), true);
  const pub = jread(path.join(b.rr, '.runs', 'phase-1.json'));
  truthy(p, 'the frozen pre-gate acceptance is not poisoned by the stale B', pub.acceptance && !(pub.acceptance.reasons || []).some((x) => /Checkpoint B not PASS/.test(x)));
  check('19b finalize after a failed B: no stale B verdict in the published report or acceptance', p, { r2: r2.json && r2.json.outcome });
}

/* 19c — RC-L5: the bug-entry template of stage-4-finalize.md, filled in, passes the renderer gate on the first draft. */
{
  const p = [];
  const b = await finBox('fin-bug');
  const md = fs.readFileSync(path.join(SKILL, 'references', 'stage-4-finalize.md'), 'utf8');
  const tpl = (md.match(/```md\r?\n([\s\S]*?)```/) || [])[1] || '';
  truthy(p, 'the stage file carries the template', /### BUG-1/.test(tpl) && /## Bugs/.test(tpl));
  const shotRel = posixRel(b.rr, path.join(b.dir, SHOTS[2]));
  const filled = tpl.replace('{feature}', 'sample').replace('{US-id} {story name}', 'US-9001 sample').replace(/\{N\}/g, '1').replace('{open}', '1').replace('{total}', '1')
    .replace('TC-07 (also TC-07b)', 'TC-002').replace(/(\*\*Screenshot:\*\* \[[^\]]+\]\()[^)]*\)/, '$1' + shotRel + ')');
  fs.writeFileSync(path.join(b.rr, 'artifacts', 'drafts', 'phase-1', 'BUG-REPORT-sample.md'), filled);
  fs.writeFileSync(path.join(b.dir, 'bug-judgements.json'), JSON.stringify({ ...jread(path.join(b.dir, 'judgements.json')), bugs: [{ id: 'BUG-1', title: 'The system does not show X when Y', tc_id: 'TC-002', severity: 'High', status: 'open' }] }));
  const r = F(b, ['--judgements', 'bug-judgements.json']);
  eq(p, 'renderer gate passes on the first draft → PUBLISHED', [r.json && r.json.outcome, r.json && r.json.step], ['PUBLISHED', 'publish']);
  truthy(p, 'published bug file carries BUG-1', fs.existsSync(path.join(b.rr, 'BUG-REPORT-sample.md')) && /### BUG-1/.test(fs.readFileSync(path.join(b.rr, 'BUG-REPORT-sample.md'), 'utf8')));
  check('19c bug template: renderer gate PASS on the first draft', p, r.json && { outcome: r.json.outcome, step: r.json.step, reason: r.json.reason, mismatches: r.json.mismatches });
}

/* 20 — Checkpoint B checks 2 and 3 (pure): status coverage and failure evidence, every rule of the contract. */
{
  const p = [];
  const png = () => true;
  const row = (tc, status, extra = {}) => ({ tc_id: tc, status, variants: [{ variant_slug: 'v', attempts: [{ attempt: 1, status }] }], ...extra });
  const base = () => ({ run_plan: { groups: [{ tcs: ['TC-1', 'TC-2'] }], layers: {} }, delivery: { screenshots: 'failed' }, results: [row('TC-1', 'PASS'), row('TC-2', 'PASS')] });
  const ev = (run, verify = { checks: {} }, o = {}) => evaluateB({ run, verify, fresh: { stale: [], known: true }, snapshotId: 's', automationRoot: '/auto', failClasses: ['app_bug', 'automation_failure', 'environment_failure', 'data_missing', 'selector_failure', 'assertion_failure'], isFileFn: png, ...o });
  eq(p, 'clean run → PASS', ev(base()).verdict, 'PASS');
  const r1 = base(); r1.results.pop();
  eq(p, 'an in-scope TC without a final status → coverage FAIL', ev(r1).results[1].status, 'FAIL');
  const r2 = base(); r2.results.push(row('TC-2', 'PASS'));
  truthy(p, 'conflicting duplicate rows → FAIL', ev(r2).results[1].evidenceRef.some((x) => /conflicting/.test(x)));
  const r3 = base(); r3.results[1] = row('TC-2', 'NOT_RUN');
  eq(p, 'NOT_RUN without a reason is never silently excluded → FAIL', ev(r3).results[1].status, 'FAIL');
  const r3b = base(); r3b.results[1] = row('TC-2', 'NOT_RUN', { status_reason: 'not started: smoke gate failed' });
  eq(p, 'NOT_RUN with its reason is preserved (PASS of the check, status kept)', [ev(r3b).results[1].status, r3b.results[1].status], ['verified-mechanical', 'NOT_RUN']);
  const r4 = base(); r4.results[1] = row('TC-2', 'FAIL');
  eq(p, 'FAIL without a classification → failure FAIL', ev(r4).results[2].status, 'FAIL');
  const r5 = base(); r5.results[1] = row('TC-2', 'FAIL', { classification: 'app_bug', root_cause: 'the list shows the wrong status' }); r5.results[1].variants[0].attempts[0].failure_screenshot = 'x.png';
  eq(p, 'classified FAIL with evidence and the original outcome → PASS of the check', ev(r5).results[2].status, 'verified-mechanical');
  const r6 = JSON.parse(JSON.stringify(r5)); r6.unverified_assumptions = [{ tc_id: 'TC-2', interpretation: 'x' }];
  truthy(p, '@unverified-assumption is never app_bug', ev(r6).results[2].evidenceRef.some((x) => /never app_bug/.test(x)));
  const r7 = JSON.parse(JSON.stringify(r5)); r7.results[1].root_cause = '';
  truthy(p, 'app_bug without the original expected outcome on record → FAIL', ev(r7).results[2].evidenceRef.some((x) => /without the original expected/.test(x)));
  truthy(p, 'missing failure image → FAIL', ev(r5, { checks: {} }, { isFileFn: () => false }).results[2].evidenceRef.some((x) => /failure image missing/.test(x)));
  const r8 = JSON.parse(JSON.stringify(r5)); r8.delivery.screenshots = 'none';
  eq(p, 'screenshots none: no image owed', ev(r8, { checks: {} }, { isFileFn: () => false }).results[2].status, 'verified-mechanical');
  const r9 = JSON.parse(JSON.stringify(r5)); r9.results[1].classification = 'made_up';
  truthy(p, 'a classification outside the vocabulary → FAIL', ev(r9).results[2].evidenceRef.some((x) => /outside the vocabulary/.test(x)));
  const r10 = base(); r10.results[0].variants[0].attempts = [{ attempt: 1, status: 'FAIL' }];
  truthy(p, 'PASS whose final attempt is not a PASS → integrity FAIL (a failure is never converted)', ev(r10).results[0].status === 'FAIL');
  eq(p, 'verify check 18 FAIL → integrity FAIL', ev(base(), { checks: { '18': { status: 'FAIL', evidence: 'image missing' } } }).results[0].status, 'FAIL');
  const un = ev(base(), { checks: { '16b': { status: 'unresolved', evidence: 'no teardown heartbeat' } } });
  eq(p, 'unresolved runtime check → BLOCKED, never PASS', un.verdict, 'BLOCKED');
  eq(p, 'stale results → not PASS', ev(base(), { checks: {} }, { fresh: { stale: [{ tc: 'TC-1' }], known: true } }).verdict === 'PASS', false);
  const adv = ev(base(), { checks: { '37': { status: 'FAIL', evidence: 'path' } } });
  eq(p, 'an advisory Full check is reported, not gating', [adv.verdict, adv.advisory.length], ['PASS', 1]);
  check('20 Checkpoint B contract: status coverage, preserved statuses, failure evidence, classification, integrity', p, {});
}

/* ================= 1.3.0 — every fixture below is a small made-up project (a shop: cart / profile / orders pages) ================= */
const LITE_MOD = await import(pathToFileURL(LITE).href);
const filesHash = (dirs) => { const out = {}; const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out[posixRel(TMP, f)] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } }; dirs.forEach(walk); return JSON.stringify(out); };
// a fake Playwright CLI that behaves like the real one on the points that matter: without --reporter it writes the config's
// JSON fallback file and test-results; it honours --output / PW_STAGE_JSON; it prints the resolved titles it is given
const FAKE_SFX = path.join(TMP, 'fake-sfx.mjs');
fs.writeFileSync(FAKE_SFX, [
  "import fs from 'node:fs'; import path from 'node:path';",
  'const a = process.argv.slice(2);',
  "if (!a.includes('--reporter=list')) { fs.mkdirSync('artifacts/stages', { recursive: true }); fs.writeFileSync('artifacts/stages/unnamed.json', String(Date.now())); }",
  "if (process.env.PW_STAGE_JSON) fs.writeFileSync(process.env.PW_STAGE_JSON, '{}');",
  "const out = (a.find((x) => x.startsWith('--output=')) || '').slice(9) || process.env.PW_OUTPUT_DIR || 'test-results';",
  "fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, '.last-run.json'), String(Date.now()));",
  "const lines = JSON.parse(process.env.FAKE_LIST_LINES || '[]');",
  "console.log('Listing tests:'); for (const l of lines) console.log('  ' + l);",
  "console.log('Total: ' + (lines.length || 2) + ' tests in 1 file');",
].join('\n') + '\n');

/* 23 — P-A / L11: (a) the --list of Checkpoint A writes nothing under any output root; (b) a file under artifacts is never a TC
   input; (c) a page object imported by 2 of 5 specs stales exactly those TCs; (d) the same without any JSON reporter. */
function shopProject(name, { jsonReporter }) {
  const root = path.join(TMP, name);
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  w('playwright.config.ts', "import { defineConfig } from '@playwright/test';\nexport default defineConfig({\n  testDir: './tests',\n  reporter: [['line']" + (jsonReporter ? ", ['json', { outputFile: process.env.PW_STAGE_JSON ?? 'artifacts/stages/unnamed.json' }]" : '') + "],\n  projects: [{ name: 'desktop' }],\n});\n");
  w('pages/CartPage.ts', "import type { Page } from '@playwright/test';\nexport class CartPage {\n  constructor(private readonly page: Page) {}\n  async open(): Promise<void> { await this.page.goto('/cart'); }\n  total() { return this.page.getByTestId('cart-total'); }\n}\n");
  w('pages/ProfilePage.ts', "import type { Page } from '@playwright/test';\nexport class ProfilePage {\n  constructor(private readonly page: Page) {}\n  async open(): Promise<void> { await this.page.goto('/profile'); }\n  name() { return this.page.getByTestId('profile-name'); }\n}\n");
  w('test-data/users.json', '{ "display": "Sample User" }\n');
  if (jsonReporter) w('artifacts/stages/unnamed.json', '{ "from": "an earlier inspection run" }\n');
  const spec = (id, cls, file, extra = '') => w('tests/' + file, "import { test, expect } from '@playwright/test';\nimport { " + cls + " } from '../pages/" + cls + "';\n\ntest.describe('REQ-1: shop', () => {\n  test('[" + id + "] Validate that the screen shows its value', async ({ page }) => {\n    const p = new " + cls + "(page);\n    await p.open();" + extra + "\n    await expect(p." + (cls === 'CartPage' ? 'total' : 'name') + "()).toBeVisible();\n  });\n});\n");
  spec('TC-11', 'CartPage', 'a-cart.spec.ts'); spec('TC-12', 'CartPage', 'b-cart.spec.ts');
  spec('TC-13', 'ProfilePage', 'c-profile.spec.ts', "\n    const users = '../test-data/users.json';\n    expect(users).toBeTruthy();");
  spec('TC-14', 'ProfilePage', 'd-profile.spec.ts'); spec('TC-15', 'ProfilePage', 'e-profile.spec.ts');
  return root;
}
async function shopBaseline(root) {
  const rr = path.join(root, 'reports', 'US-5-shop');
  const progress = path.join(rr, 'artifacts', 'progress');
  fs.mkdirSync(path.join(rr, '.runs'), { recursive: true }); fs.mkdirSync(progress, { recursive: true });
  const specs = ['a-cart', 'b-cart', 'c-profile', 'd-profile', 'e-profile'].map((s) => 'tests/' + s + '.spec.ts');
  const impact = await import(pathToFileURL(path.join(FULL, 'impact.mjs')).href);
  const fp = impact.fingerprintTests({ root, specs, cache: new Map() });
  const tcs = Object.keys(fp.tcs);
  fs.writeFileSync(path.join(progress, 'first-positive-1.summary.json'), JSON.stringify({ schema: 'skill5-run-stage/1', run: 'first', stage: 'positive', seq: 1, startedAt: '2026-10-01T09:00:00.000Z', tcs: Object.fromEntries(tcs.map((t) => [t, 'PASS'])), executed: Object.fromEntries(tcs.map((t) => [t, { status: 'PASS' }])), code: { tcs: fp.tcs, tests: fp.tests, files: fp.files, branches: fp.branches || {}, changed_during_call: [] } }));
  const runFile = path.join(rr, '.runs', 'phase-1.json');
  fs.writeFileSync(runFile, JSON.stringify({ schema: 'skill6-run/1', phase: 1, results_root: 'reports/US-5-shop', run_plan: { groups: [] }, lite: { specs, stages: { smoke: [], positive: tcs, negative: [] } } }));
  return { runFile, tcs };
}
{
  const p = [];
  // (a) side effects of the inspection run
  const proj = projectA('a-sidefx');
  const auto = path.join(proj, 'Testing/Automation');
  const ctl = path.join(TMP, 'sfx-control'); fs.mkdirSync(ctl, { recursive: true });
  spawnSync(process.execPath, [FAKE_SFX, 'test', '--list'], { cwd: ctl, encoding: 'utf8' });
  truthy(p, '(a) control: the fake writes the JSON fallback file without --reporter=list', fs.existsSync(path.join(ctl, 'artifacts', 'stages', 'unnamed.json')));
  const roots = ['artifacts', 'test-results', 'screenshots', 'automation-logs', 'playwright-report'].map((d) => path.join(auto, d));
  const before = filesHash(roots);
  const r = A(proj, ['--cli', FAKE_SFX]);
  eq(p, '(a) checkpoint-a with the list run → PASS', r.json && r.json.outcome, 'PASS');
  eq(p, '(a) no file under any output root changed (hash before / after)', filesHash(roots), before);
  truthy(p, '(a) no JSON fallback file, no test-results folder', !fs.existsSync(path.join(auto, 'artifacts', 'stages', 'unnamed.json')) && !fs.existsSync(path.join(auto, 'test-results')));
  // (b) + (c): a config WITH the JSON fallback literal
  const shop = shopProject('shop-json', { jsonReporter: true });
  const sb = await shopBaseline(shop);
  eq(p, '(b) baseline: nothing to re-run', lite(['rerun-select', '--run-file', sb.runFile], { cwd: shop }).json.rerun, []);
  fs.writeFileSync(path.join(shop, 'artifacts', 'stages', 'unnamed.json'), '{ "rewritten": "by a --list" }\n');
  fs.mkdirSync(path.join(shop, 'test-results'), { recursive: true }); fs.writeFileSync(path.join(shop, 'test-results', '.last-run.json'), '{}');
  const b1 = lite(['rerun-select', '--run-file', sb.runFile], { cwd: shop });
  eq(p, '(b) a rewritten file under artifacts / test-results → stale: []', [b1.json.stale, b1.json.rerun], [[], []]);
  fs.writeFileSync(path.join(shop, 'pages', 'CartPage.ts'), fs.readFileSync(path.join(shop, 'pages', 'CartPage.ts'), 'utf8').replace("'cart-total'", "'cart-sum'"));
  eq(p, '(c) a page object imported by 2 of 5 specs → exactly those TCs', lite(['rerun-select', '--run-file', sb.runFile], { cwd: shop }).json.rerun.sort(), ['TC-11', 'TC-12']);
  fs.writeFileSync(path.join(shop, 'test-data', 'users.json'), '{ "display": "Another User" }\n');
  eq(p, '(c) a declared test-data file is still an input (allow-list, not "ignore data")', lite(['rerun-select', '--run-file', sb.runFile], { cwd: shop }).json.rerun.sort(), ['TC-11', 'TC-12', 'TC-13']);
  // (d) a config without any JSON reporter behaves the same
  const shop2 = shopProject('shop-nojson', { jsonReporter: false });
  const sb2 = await shopBaseline(shop2);
  fs.mkdirSync(path.join(shop2, 'artifacts', 'stages'), { recursive: true }); fs.writeFileSync(path.join(shop2, 'artifacts', 'stages', 'smoke.json'), '{}');
  eq(p, '(d) no JSON reporter: a file under artifacts → stale: []', lite(['rerun-select', '--run-file', sb2.runFile], { cwd: shop2 }).json.rerun, []);
  const impact = await import(pathToFileURL(path.join(FULL, 'impact.mjs')).href);
  eq(p, 'isOutputPath: output roots yes, a test-data file no', ['artifacts/stages/x.json', 'reports/US-1/a.json', 'test-results/r.json', '.auth/u.json', 'test-data/users.json', 'fixtures/test-results.json'].map((f) => impact.isOutputPath(shop, path.join(shop, f))), [true, true, true, true, false, false]);
  check('23 L11: inspection --list has no side effects; output roots are never TC inputs (with and without a JSON reporter)', p, { a: r.json && r.json.outcome });
}

/* 24 — P1: the auth strategy comes from the probe (or the learning file), never from the story. Fixture A: a cookie session
   that survives the reset → setup project, one sign-in per role; fixture B: a token app whose reset ends sessions → API helper;
   fixture C: no API sign-in path → UI fallback only with its reason. Sign-in warning; no stored session after close-out. */
{
  const p = [];
  const { authStrategy, uiSignIns } = LITE_MOD;
  const pick = (x) => ({ strategy: x.strategy, per: x.per });
  eq(p, 'A: cookie, survives the reset → setup project per role', pick(authStrategy({ mechanism: 'cookie', survivesReset: 'true', languageScope: 'profile' })), { strategy: 'setup-project', per: ['role'] });
  eq(p, 'A: language kept in the session → per role × language', pick(authStrategy({ mechanism: 'cookie', survivesReset: 'no-reset', languageScope: 'session' })), { strategy: 'setup-project', per: ['role', 'language'] });
  eq(p, 'B: token, the reset ends sessions, API sign-in exists → API helper', authStrategy({ mechanism: 'token', survivesReset: 'false', apiSignin: 'yes' }).strategy, 'api-helper');
  truthy(p, 'B: the reset ends sessions and nothing said about an API path → asks', /api-signin/.test(authStrategy({ mechanism: 'token', survivesReset: 'false' }).error || ''));
  truthy(p, 'C: no API path and no reason → refused', /fallback-reason/.test(authStrategy({ mechanism: 'other', survivesReset: 'false', apiSignin: 'no' }).error || ''));
  eq(p, 'C: no API path with a reason → UI fallback', authStrategy({ mechanism: 'other', survivesReset: 'false', apiSignin: 'no', fallbackReason: 'the app offers no sign-in endpoint' }).strategy, 'ui-fallback');
  // the command on a synthetic run file
  const proj = path.join(TMP, 'auth-shop'); const rr = path.join(proj, 'reports', 'US-5-shop'); fs.mkdirSync(path.join(rr, '.runs'), { recursive: true });
  const rf = path.join(rr, '.runs', 'phase-1.json');
  fs.writeFileSync(rf, JSON.stringify({ schema: 'skill6-run/1', phase: 1, results_root: 'reports/US-5-shop', environment: { name: 'local', class: null }, run_plan: { groups: [] }, lite: { project: 'desktop' } }));
  const a1 = lite(['auth', '--run-file', rf, '--mechanism', 'cookie', '--survives-reset', 'true', '--language-scope', 'session', '--source', 'learning'], { cwd: proj });
  eq(p, 'auth from the learning file → setup project, recorded', [a1.json && a1.json.outcome, a1.json && a1.json.strategy, jread(rf).auth && jread(rf).auth.source, jread(rf).auth && jread(rf).auth.per], ['OK', 'setup-project', 'learning', ['role', 'language']]);
  truthy(p, '.auth/ is git-ignored in the automation root', /^\.auth\/$/m.test(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8')));
  fs.mkdirSync(path.join(proj, '.auth'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.auth', 'probe.json'), JSON.stringify({ mechanism: 'token', survives_reset: false, language_scope: 'profile', cookie_names: [], storage_keys: ['session-token'] }));
  const a2 = lite(['auth', '--run-file', rf, '--probe', '.auth/probe.json', '--api-signin', 'yes'], { cwd: proj });
  eq(p, 'auth from a probe file (B) → API helper, source probe', [a2.json && a2.json.strategy, jread(rf).auth.source, jread(rf).auth.survives_reset], ['api-helper', 'probe', false]);
  fs.writeFileSync(path.join(proj, '.auth', 'bad-probe.json'), JSON.stringify({ mechanism: 'token', survives_reset: false, token_value: 'eyJhbGciOi' }));
  eq(p, 'a probe that holds anything but names / booleans is refused', lite(['auth', '--run-file', rf, '--probe', '.auth/bad-probe.json', '--api-signin', 'yes'], { cwd: proj }).json.outcome, 'BLOCKED');
  fs.writeFileSync(path.join(proj, 'tests-auth.setup.ts'), '// probe journey\n');
  truthy(p, 'the probe run is refused off a test / staging environment (it may reset)', /test \/ staging/.test(lite(['auth', '--run-file', rf, '--probe-spec', 'tests-auth.setup.ts'], { cwd: proj }).json.reason || ''));
  const a3 = lite(['auth', '--run-file', rf, '--mechanism', 'other', '--survives-reset', 'false', '--api-signin', 'no', '--fallback-reason', 'the app offers no sign-in endpoint'], { cwd: proj });
  eq(p, 'C: UI fallback recorded with its reason in the run file', [a3.json && a3.json.strategy, jread(rf).auth.fallback_reason], ['ui-fallback', 'the app offers no sign-in endpoint']);
  fs.writeFileSync(path.join(proj, '.auth', 'buyer.json'), '{}');
  const cl = lite(['auth', '--run-file', rf, '--clear'], { cwd: proj });
  eq(p, '--clear removes every stored session', [cl.json && cl.json.removed, fs.existsSync(path.join(proj, '.auth'))], [3, false]);
  // the static sign-in warning
  const sp = path.join(proj, 'tests', 'switch.spec.ts'); fs.mkdirSync(path.dirname(sp), { recursive: true });
  fs.writeFileSync(sp, [
    "import { test, expect } from '@playwright/test';",
    "import { SignInPage } from '../pages/SignInPage';",
    "test.describe('REQ-1: carts', () => {",
    "  test('[TC-21] Validate that a buyer and a reviewer see the same cart', async ({ page }) => {",
    "    const signIn = new SignInPage(page);",
    "    await signIn.signInAs('buyer');",
    "    await signIn.signInAs('reviewer');",
    "    await expect(page).toHaveTitle(/Cart/);",
    "  });",
    "  test('[TC-22] Validate that sign-in with a locked account is refused twice', async ({ page }) => {",
    "    const signIn = new SignInPage(page);",
    "    await signIn.signInAs('locked'); await signIn.signInAs('locked');",
    "    await expect(page).toHaveTitle(/Sign in/);",
    "  });",
    "  test('[TC-23] Validate that the cart total uses the stored state', async ({ page, request }) => {",
    "    await authApi.signInAs('buyer'); await request.get('/api/cart');",
    "    await expect(page).toHaveTitle(/Cart/);",
    "  });",
    "});",
    "test.describe('REQ-2: profile', () => {",
    "  test.beforeEach(async ({ page }) => { await new SignInPage(page).signInAs('buyer'); });",
    "  test('[TC-24] Validate that the profile opens for a reviewer too', async ({ page }) => {",
    "    await new SignInPage(page).signInAs('reviewer');",
    "    await expect(page).toHaveTitle(/Profile/);",
    "  });",
    "});",
  ].join('\n') + '\n');
  const si = await uiSignIns(proj, ['tests/switch.spec.ts']);
  eq(p, 'sign-in warning: a role switch (×2) and a beforeEach + body sign-in; never a sign-in TC or an API helper', si.map((x) => (x.title.match(/^\[(TC-\d+)\]/) || [])[1] + '×' + x.count), ['TC-21×2', 'TC-24×2']);
  // close-out: finalize removes stored sessions
  const b = await finBox('fin-auth');
  fs.mkdirSync(path.join(b.dir, '.auth'), { recursive: true }); fs.writeFileSync(path.join(b.dir, '.auth', 'buyer.json'), '{"cookies":[]}');
  const fz = F(b, ['--judgements', 'judgements.json']);
  eq(p, 'no stored session left after close-out (finalize PUBLISHED)', [fz.json && fz.json.outcome, fz.json && fz.json.authStateRemoved, fs.existsSync(path.join(b.dir, '.auth'))], ['PUBLISHED', 1, false]);
  check('24 P1: strategy from the probe (A setup project · B API helper · C UI fallback with reason), sign-in warning, sessions removed at close-out', p, {});
}

/* 25 — L10: setup / teardown journeys. A DECLARED (annotation) and LISTED (run file) journey is exempt from the [TC-ID] rule only;
   an undeclared spec without a TC-ID still FAILs; a journey with a TC-ID FAILs. */
{
  const p = [];
  const proj = projectA('a-journey');
  const rf = path.join(proj, RR, '.runs', 'phase-1.json');
  const J = 'Testing/Automation/tests/zz-restore.teardown.spec.ts';
  const journeySpec = (title, ann) => "import { test, expect } from '@playwright/test';\nimport { OrdersPage } from '../pages/OrdersPage';\n\ntest.describe('teardown: restore what the run changed', () => {\n  test('" + title + "', { tag: ['@setup', '@run:teardown']" + (ann ? ", annotation: { type: 'journey', description: 'teardown' }" : '') + " }, async ({ page }) => {\n    const orders = new OrdersPage(page);\n    await orders.create('Cleanup');\n    await expect(orders.nameCell('Cleanup')).toHaveText('Cleanup');\n  });\n});\n";
  fs.writeFileSync(path.join(proj, J), journeySpec('Restore the sample data once', false));
  const r1 = A(proj, [], { files: [...SCOPE, J] });
  truthy(p, 'an undeclared spec without a [TC-ID] → FAIL, with the journey hint', r1.json && r1.json.outcome === 'FAIL' && r1.json.problems.some((x) => /trace-title-missing-tcid.*declare it/.test(x)));
  fs.writeFileSync(path.join(proj, J), journeySpec('Restore the sample data once', true));
  const r2 = A(proj, [], { files: [...SCOPE, J] });
  truthy(p, 'declared but not listed in the run file → FAIL naming lite journey', r2.json && r2.json.outcome === 'FAIL' && r2.json.problems.some((x) => /does not list — lite journey/.test(x)));
  const jn = lite(['journey', '--run-file', rf, '--spec', J], { cwd: proj });
  eq(p, 'lite journey lists it (automation-root relative)', [jn.json && jn.json.outcome, (jread(rf).lite.journeys || []).map((x) => x.spec + ':' + x.kind)], ['OK', ['tests/zz-restore.teardown.spec.ts:teardown']]);
  const r3 = A(proj, [], { files: [...SCOPE, J] });
  eq(p, 'declared + listed journey → PASS (exempt from the [TC-ID] rule only)', [r3.json && r3.json.outcome, r3.json && r3.json.journeys], ['PASS', 1]);
  fs.writeFileSync(path.join(proj, J), journeySpec('[TC-01] Restore the sample data once', true));
  eq(p, 'lite journey refuses a journey with a [TC-ID]', lite(['journey', '--run-file', rf, '--spec', J], { cwd: proj }).json.outcome, 'BLOCKED');
  const r4 = A(proj, [], { files: [...SCOPE, J] });
  truthy(p, 'a journey title with a [TC-ID] → FAIL', r4.json && r4.json.outcome === 'FAIL' && r4.json.problems.some((x) => /journey .* carries a \[TC-ID\]/.test(x)));
  check('25 L10: declared + listed journeys exempt from [TC-ID] only; undeclared → FAIL; journey with a TC-ID → FAIL', p, { r3: r3.json && r3.json.outcome });
}

/* 26 — L16: traceability reads the RESOLVED titles of `playwright test --list` — a loop over a literal list passes; a resolved
   title without a TC-ID, with two TC-IDs, or a duplicate TC + variant fails, naming the resolved title. */
{
  const p = [];
  const { parseListTitles, evaluateA: evA } = LITE_MOD;
  const sample = ['Listing tests:', '  [desktop] › Orders_Tests\\loop.spec.ts:7:5 › REQ-1: language variants › [TC-31] Validate that the banner is translated [lang: en]', '  [desktop] › Orders_Tests/loop.spec.ts:7:5 › REQ-1: language variants › [TC-32] Validate that the banner is translated [lang: fr]', 'Total: 2 tests in 1 file'].join('\n');
  const root = path.join(TMP, 'list-shop'); const ar = path.join(root, 'Testing', 'Automation');
  eq(p, 'parseListTitles: project, spec mapped onto the scope, line, last title segment', parseListTitles(sample, { root, ar, specs: ['Testing/Automation/tests/Orders_Tests/loop.spec.ts'] }), [
    { project: 'desktop', file: 'Testing/Automation/tests/Orders_Tests/loop.spec.ts', line: 7, title: '[TC-31] Validate that the banner is translated [lang: en]' },
    { project: 'desktop', file: 'Testing/Automation/tests/Orders_Tests/loop.spec.ts', line: 7, title: '[TC-32] Validate that the banner is translated [lang: fr]' }]);
  const okV = { gate: 'PASS', findings: [], counts: { files: 1 }, scope: { unreadable: [], parseFailures: [] } };
  const cov2 = { judgements: { tcs: [{ tc: 'TC-31', status: 'Fully Covered' }, { tc: 'TC-32', status: 'Fully Covered' }] }, errors: [], summary: null };
  const ev = (resolved, variantOf = null) => evA({ components: { tsc: { status: 'PASS' }, validator: okV }, ruleToCheck: {}, mapping: LITE_MOD.tcIdsOf ? Object.fromEntries(['TC-31', 'TC-32'].map((t) => [t, ['loop.spec.ts']])) : {}, coverage: cov2, docIds: ['TC-31', 'TC-32'], review: null, snapshotId: 's', resolved, variantOf });
  const t = (id, lang, line = 7) => ({ project: 'desktop', file: 'loop.spec.ts', line, title: (id ? '[' + id + '] ' : '') + 'Validate that the banner is translated [lang: ' + lang + ']' });
  eq(p, 'a loop over a literal list → PASS', ev([t('TC-31', 'en'), t('TC-32', 'fr')]).verdict, 'PASS');
  const noId = ev([t('TC-31', 'en'), t(null, 'fr')]);
  truthy(p, 'a loop that resolves to a title without a TC-ID → FAIL naming the resolved title', noId.verdict === 'FAIL' && noId.results[2].evidenceRef.some((x) => /resolved title "Validate that the banner is translated \[lang: fr\]" carries no \[TC-ID\]/.test(x)));
  const dup = ev([t('TC-31', 'en'), t('TC-31', 'en', 9), t('TC-32', 'fr')]);
  truthy(p, 'two resolved titles with the same TC-ID and variant → FAIL (duplicate)', dup.verdict === 'FAIL' && dup.results[2].evidenceRef.some((x) => /duplicate/.test(x)));
  const two = ev([{ project: 'desktop', file: 'loop.spec.ts', line: 7, title: '[TC-31] [TC-32] Validate both at once' }]);
  truthy(p, 'a resolved title with two TC-IDs → FAIL (exactly one per test)', two.verdict === 'FAIL' && two.results[2].evidenceRef.some((x) => /exactly one per test/.test(x)));
  const rd = await import(pathToFileURL(path.join(FULL, 'run-data.mjs')).href);
  eq(p, 'the same TC in two declared variations (Full\'s " — variation X") → PASS', ev([{ project: 'desktop', file: 'loop.spec.ts', line: 7, title: '[TC-31] Validate the banner — variation A' }, { project: 'desktop', file: 'loop.spec.ts', line: 7, title: '[TC-31] Validate the banner — variation B' }, t('TC-32', 'fr')], rd.variationSlug).verdict, 'PASS');
  // integration: a loop spec in a project — resolved titles PASS; without them (static fallback) the loop is unreadable
  const loopSpec = "import { test, expect } from '@playwright/test';\nimport { OrdersPage } from '../pages/OrdersPage';\nimport { captureEvidence } from '../helpers/evidence';\n\ntest.describe('REQ-001: an order can be created and listed', () => {\n  for (const [id, name] of [['TC-01', 'Alpha'], ['TC-02', 'Beta']] as const) {\n    test(`[${id}] Validate that the order ${name} appears in the list`, async ({ page }, testInfo) => {\n      const orders = new OrdersPage(page);\n      await orders.create(name);\n      await captureEvidence(page, testInfo);\n      await expect(orders.nameCell(name)).toHaveText(name);\n    });\n  }\n});\n";
  const lines = ['[chromium] › orders.spec.ts:7:5 › REQ-001: an order can be created and listed › [TC-01] Validate that the order Alpha appears in the list', '[chromium] › orders.spec.ts:7:5 › REQ-001: an order can be created and listed › [TC-02] Validate that the order Beta appears in the list'];
  const pr = projectA('a-loop');
  fs.writeFileSync(path.join(pr, 'Testing/Automation/tests/orders.spec.ts'), loopSpec);
  const ri = A(pr, ['--cli', FAKE_SFX], { env: { FAKE_LIST_LINES: JSON.stringify(lines) } });
  eq(p, 'loop spec + resolved titles → PASS, traceability from resolved titles', [ri.json && ri.json.outcome, ri.json && ri.json.traceability], ['PASS', 'resolved titles (2)']);
  const pf = projectA('a-loop-static');
  fs.writeFileSync(path.join(pf, 'Testing/Automation/tests/orders.spec.ts'), loopSpec);
  const rs = A(pf, ['--cli', FAKE_LIST]);
  eq(p, 'static fallback (no resolved titles) cannot read the loop → traceability FAIL', [rs.json && rs.json.outcome, rs.json && rs.json.checks && rs.json.checks.traceability], ['FAIL', 'FAIL']);
  check('26 L16: resolved titles — loop over a literal list PASS; no TC-ID / two TC-IDs / duplicate variant FAIL; static fallback', p, { ri: ri.json && ri.json.problems });
}

/* 27 — L17 + L18 (shared validator): page identity ignores what a base class or a shared component declares; a skip / fixme
   reason may be a literal, a template without expressions or a const string (local or imported) — nothing else. */
{
  const p = [];
  const va = await import(pathToFileURL(path.join(FULL, 'validate-automation.mjs')).href);
  const vx = path.join(TMP, 'vx-shop');
  const w = (f, t) => { fs.mkdirSync(path.dirname(path.join(vx, f)), { recursive: true }); fs.writeFileSync(path.join(vx, f), t); };
  const READY = "    await this.page.locator('main[aria-busy=\"false\"]').waitFor();\n    await this.page.locator('.page-loading').waitFor({ state: 'hidden' });\n";
  w('pages/BasePage.ts', "import type { Page } from '@playwright/test';\nexport class BasePage {\n  constructor(protected readonly page: Page) {}\n  async waitReady(): Promise<void> {\n" + READY + "  }\n}\n");
  w('pages/Toast.ts', "import type { Locator } from '@playwright/test';\nexport class Toast {\n  constructor(private readonly root: Locator) {}\n  message() { return this.root.locator('.toast-message'); }\n  close() { return this.root.locator('.toast-close'); }\n}\n");
  const sub = (name, route, own) => w('pages/' + name + '.ts', "import { BasePage } from './BasePage';\nexport class " + name + " extends BasePage {\n  async open(): Promise<void> { await this.page.goto('" + route + "'); }\n  async ready(): Promise<void> {\n" + READY + "  }\n  toast() { return this.page.locator('.toast-message'); }\n  closeToast() { return this.page.locator('.toast-close'); }\n  value() { return this.page.getByTestId('" + own + "'); }\n}\n");
  sub('CartPage', '/cart', 'cart-total'); sub('ProfilePage', '/profile', 'profile-name');
  const plain = (name, route, root) => w('pages/' + name + '.ts', "import type { Page } from '@playwright/test';\nexport class " + name + " {\n  constructor(private readonly page: Page) {}\n  async open(): Promise<void> { await this.page.goto('" + route + "'); }\n  root() { return this.page.getByTestId('" + root + "'); }\n  rows() { return this.page.locator('.order-row'); }\n}\n");
  plain('OrderList', '/orders', 'orders-root'); plain('OrdersOverview', '/orders', 'orders-root');
  const run = (files, spec = false) => va.analyze({ root: vx, args: {}, paths: { manifestState: 'absent', manifestFile: null, automationRoot: '.', tests: 'tests', pages: 'pages', layers: null }, files: files.map((f) => path.join(vx, f)), treatAsSpec: spec, tcIds: new Set(['TC-1']), reqIds: null, tcIdSource: 'selftest', reqIdSource: null, allowList: { entries: [], file: null } });
  const pairs = run(['pages/CartPage.ts']).findings.filter((f) => f.ruleId === 'pom-duplicate-page').map((f) => [f.pair.a.class, f.pair.b.class].sort().join('+'));
  truthy(p, 'L17: two pages extending one base that repeat its readiness waits and a component\'s locators → not a pair', !pairs.includes('CartPage+ProfilePage'));
  truthy(p, 'L17: a subclass and its own base → never a pair', !pairs.some((x) => /BasePage/.test(x)));
  truthy(p, 'L17: two classes with the same route and root → still a candidate (FAIL until decided)', pairs.includes('OrderList+OrdersOverview'));
  // L18
  w('helpers/reasons.ts', "export const SANDBOX_MISSING = 'the payment sandbox is not configured on this environment';\n");
  const mods = [
    "import { test } from '@playwright/test';",
    "import { SANDBOX_MISSING } from '../helpers/reasons';",
    "import { SANDBOX_MISSING as NO_SANDBOX } from '../helpers/reasons';",
    "const LOCAL_REASON = 'the export service is disabled on this environment';",
    "let mutable = 'the export service is disabled on this environment';",
    "const reasonFor = (x: string) => 'disabled: ' + x;",
    "test.describe('REQ-1: modifiers', () => {",
    "  test('[TC-1] literal', async () => {",
    "    test.skip(process.env.SHOP_MODE === 'offline', 'the export service is disabled here');",            // 9  declared
    "    test.skip(process.env.SHOP_MODE === 'offline', LOCAL_REASON);",                                    // 10 declared
    "    test.fixme(process.env.SHOP_MODE === 'offline', SANDBOX_MISSING);",                                // 11 declared
    "    test.fixme(process.env.SHOP_MODE === 'offline', NO_SANDBOX);",                                     // 12 declared
    "    test.skip(process.env.SHOP_MODE === 'offline', `the export service is disabled`);",              // 13 declared
    "    test.skip(process.env.SHOP_MODE === 'offline', mutable);",                                         // 14 no reason
    "    test.skip(process.env.SHOP_MODE === 'offline', '');",                                              // 15 no reason
    "    test.skip(process.env.SHOP_MODE === 'offline', reasonFor('export'));",                             // 16 no reason
    "    test.skip(process.env.SHOP_MODE === 'offline', `disabled: ${process.env.SHOP_MODE}`);",            // 17 no reason
    "  });",
    "});",
  ].join('\n') + '\n';
  w('tests/mods.spec.ts', mods);
  const mf = run(['tests/mods.spec.ts'], true).findings;
  const lines = (id) => mf.filter((f) => f.ruleId === id).map((f) => f.line).sort((a, b) => a - b);
  eq(p, 'L18: literal, local const, imported const (also aliased), template without expressions → declared', lines('modifier-declared'), [9, 10, 11, 12, 13]);
  eq(p, 'L18: let, empty string, function call, template with an expression → modifier-no-reason', lines('modifier-no-reason'), [14, 15, 16, 17]);
  check('27 L17 + L18 (shared validator): base / component members are not page identity; const-string skip reasons resolve', p, { pairs });
}

/* 28 — L19: the status lines are rendered from the gate records of the snapshot being published; a forced mismatch fails the
   renderer gate (Full's renderer — shared by both skills). */
{
  const p = [];
  const b = await finBox('fin-l19');
  const r = F(b, ['--judgements', 'judgements.json']);
  eq(p, 'PUBLISHED', r.json && r.json.outcome, 'PUBLISHED');
  const repF = path.join(b.rr, 'TEST-RUN-REPORT-sample.md');
  const rep = fs.existsSync(repF) ? fs.readFileSync(repF, 'utf8') : '';
  const gateFile = path.join(b.rr, '.runs', 'phase-1.checkpoint-B.json');
  const g = jread(gateFile);
  truthy(p, 'B PASS → header PASS with its snapshot', rep.split('\n').some((l) => l.startsWith('**Compliance:**') && l.includes('Checkpoint B PASS (' + g.snapshotId + ')') && l.includes('Checkpoint A ' + g.gateA.verdict + ' (' + g.gateA.snapshotId + ')')));
  const rend = await import(pathToFileURL(path.join(FULL, 'render-run-report.mjs')).href);
  eq(p, 'the published report agrees with its gate record', rend.render({ reportPath: repF, gatePath: gateFile, root: b.rr }).payload.gate, 'PASS');
  fs.writeFileSync(repF, rep.replace('Checkpoint B PASS (' + g.snapshotId + ')', 'Checkpoint B BLOCKED (' + g.snapshotId + ')'));
  const mm = rend.render({ reportPath: repF, gatePath: gateFile, root: b.rr });
  eq(p, 'a forced mismatch → renderer gate MISMATCH (status-line)', [mm.payload.gate, mm.payload.mismatches.some((x) => x.kind === 'status-line')], ['MISMATCH', true]);
  check('28 L19: status lines from the gate records of the published snapshot; a mismatch fails the renderer gate', p, {});
}

/* 29 — any Spec Kit project: a constitution and test artifacts, NO Testing/qa-manifest.json and NO learning file. Constitution-first
   discovery of the inputs and the automation root, nothing created or edited outside the results, every gate unchanged. */
{
  const p = [];
  const proj = path.join(TMP, 'speckit');
  const src = path.join(FX, 'check', 'project', 'Testing');
  const feat = path.join(proj, 'specs', '001-orders');
  const constFile = path.join(proj, '.specify', 'memory', 'constitution.md');
  fs.mkdirSync(path.dirname(constFile), { recursive: true });
  fs.writeFileSync(constFile, '# Orders Constitution\n\n## Testing\n- End-to-end tests live in `tests/e2e/` (Playwright, TypeScript, Page Object Model).\n- Unit tests live in `tests/unit/`.\n- Feature specs live in `specs/<feature>/spec.md`; see https://example.test/docs for the style guide.\n');
  const constBefore = fs.readFileSync(constFile, 'utf8');
  fs.mkdirSync(feat, { recursive: true });
  fs.copyFileSync(path.join(src, 'Manual_Test', 'TEST-CASES-orders.md'), path.join(feat, 'TEST-CASES-orders.md'));
  fs.copyFileSync(path.join(src, 'Manual_Test', 'TEST-DATA-orders.md'), path.join(feat, 'TEST-DATA-orders.md'));
  fs.copyFileSync(path.join(src, 'Requirements', 'REQ-orders.md'), path.join(feat, 'spec.md'));
  const RR2 = 'tests/e2e/reports/001-orders';

  // init-run with no --tc: the one TEST-CASES-*.md, its TEST-DATA, the spec above it; the automation root from the constitution
  const r = lite(['init-run', '--environment', 'local', '--env-class', 'test'], { cwd: proj });
  eq(p, 'init-run without manifest / learning file: OK', [r.status, r.json && r.json.outcome], [0, 'OK']);
  eq(p, 'automation root from the constitution', r.json && r.json.automationRoot, 'tests/e2e (constitution)');
  eq(p, 'results root under it', r.json && r.json.resultsRoot, RR2);
  eq(p, 'sources found once, optional ones null', r.json && r.json.sources, { tc: 'specs/001-orders/TEST-CASES-orders.md', data: 'specs/001-orders/TEST-DATA-orders.md', spec: 'specs/001-orders/spec.md', constitution: '.specify/memory/constitution.md', manifest: null, learning: null });
  const runFile = path.join(proj, RR2, '.runs', 'phase-1.json');
  if (fs.existsSync(runFile)) {
    const run = jread(runFile);
    eq(p, 'run file keeps the sources + root source', [run.lite.sources.automation_root, run.lite.sources.automation_root_source, run.lite.sources.spec], ['tests/e2e', 'constitution', 'specs/001-orders/spec.md']);
    eq(p, 'a Spec Kit feature folder is the story', [run.user_story_id, run.feature], ['001-orders', 'orders']);
  } else p.push('run file missing at ' + RR2 + '/.runs/phase-1.json');

  // several TC documents → BLOCKED with the candidates (the one question); a folder narrows it
  const feat2 = path.join(proj, 'specs', '002-invoices');
  fs.mkdirSync(feat2, { recursive: true });
  fs.copyFileSync(path.join(feat, 'TEST-CASES-orders.md'), path.join(feat2, 'TEST-CASES-invoices.md'));
  const amb = lite(['init-run'], { cwd: proj });
  eq(p, 'two TC documents → BLOCKED with both candidates', [amb.status, amb.json && amb.json.outcome, amb.json && amb.json.candidates && amb.json.candidates.length], [2, 'BLOCKED', 2]);
  const byDir = lite(['init-run', '--tc', 'specs/001-orders', '--phase', '9'], { cwd: proj });
  eq(p, '--tc <folder> picks its one document', [byDir.json && byDir.json.outcome, byDir.json && byDir.json.sources && byDir.json.sources.tc], ['OK', 'specs/001-orders/TEST-CASES-orders.md']);
  fs.rmSync(feat2, { recursive: true, force: true });
  fs.rmSync(path.join(proj, RR2, '.runs', 'phase-9.json'), { force: true });

  // the automation in tests/e2e; reconcile and Checkpoint A without a manifest: the four checks PASS, POM is enforced
  fs.cpSync(path.join(src, 'Automation'), path.join(proj, 'tests', 'e2e'), { recursive: true });
  node('config-inventory.mjs', ['reconcile', '--root', '.', '--results-root', RR2, '--run-file', RR2 + '/.runs/phase-1.json', '--apply'], proj);
  truthy(p, 'reconcile found tests/e2e without --automation-root (helpers installed there)', fs.existsSync(path.join(proj, 'tests', 'e2e', 'helpers', 'steps.ts')));
  fs.writeFileSync(path.join(proj, 'cov.json'), JSON.stringify(COV_FULL));
  const SK = ['tests/e2e/tests/orders.spec.ts', 'tests/e2e/pages/OrdersPage.ts', 'tests/e2e/helpers/evidence.ts'];
  const AK = () => lite(['checkpoint-a', '--results-root', RR2, '--phase', '1', '--files', SK.join(','), '--tc', 'specs/001-orders/TEST-CASES-orders.md', '--data', 'specs/001-orders/TEST-DATA-orders.md', '--req', 'specs/001-orders/spec.md', '--coverage', 'cov.json', '--tsc', FAKE_TSC], { cwd: proj });
  const a1 = AK();
  eq(p, 'Checkpoint A PASS without a manifest', [a1.status, a1.json && a1.json.outcome, a1.json && a1.json.checks], [0, 'PASS', { tsc: 'PASS', pom: 'PASS', traceability: 'PASS', assertions: 'PASS' }]);
  truthy(p, 'gate record in the discovered results root', fs.existsSync(path.join(proj, RR2, '.runs', 'phase-1.checkpoint-A.json')));
  fs.writeFileSync(path.join(proj, SK[0]), specText("await expect(page.locator('#order-name')).toHaveText('Alpha');"));
  const a2 = AK();
  eq(p, 'POM still enforced (tests/e2e/pages found without a manifest): raw locator → pom FAIL', [a2.json && a2.json.outcome, a2.json && a2.json.checks && a2.json.checks.pom], ['FAIL', 'FAIL']);

  // preflight: the project root is named, the config is the one in tests/e2e, nothing blocks on the missing files
  const pf = lite(['preflight', '--run-file', RR2 + '/.runs/phase-1.json', '--cli', FAKE_PW], { cwd: proj });
  eq(p, 'preflight READY without manifest / learning file', [pf.status, pf.json && pf.json.outcome], [0, 'READY']);
  eq(p, 'preflight resolves the config in tests/e2e', pf.json && pf.json.config, 'tests/e2e/playwright.config.ts');
  truthy(p, 'no config-location or manifest reason', pf.json && !/config location|manifest|learning/i.test(String(pf.json.reason || '')));

  // nothing created or edited outside the results: no Testing/, no learning file, the constitution byte-identical
  truthy(p, 'no Testing/ folder created', !fs.existsSync(path.join(proj, 'Testing')));
  truthy(p, 'no learning file created', !fs.existsSync(path.join(proj, 'Testing', 'project-learning.md')) && !fs.readdirSync(proj).some((f) => /learning/i.test(f)));
  eq(p, 'constitution unchanged', fs.readFileSync(constFile, 'utf8') === constBefore, true);

  // the engine's one resolver: manifest → constitution → the project's one Playwright config → Spec Kit default → default
  const env = await import(pathToFileURL(path.join(FULL, 'project-env.mjs')).href);
  const mk = (name, files) => { const d = path.join(TMP, name); for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), t); } fs.mkdirSync(d, { recursive: true }); return d; };
  const cfg = "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests' });\n";
  eq(p, 'resolver: constitution', env.discoverAutomationRoot(proj), { path: 'tests/e2e', source: 'constitution' });
  eq(p, 'resolver: the one Playwright config', env.discoverAutomationRoot(mk('r-cfg', { 'e2e/playwright.config.ts': cfg, 'src/app.ts': '' })), { path: 'e2e', source: 'playwright-config' });
  eq(p, 'resolver: Spec Kit default', env.discoverAutomationRoot(mk('r-sk', { '.specify/templates/x.md': '' })), { path: 'tests/e2e', source: 'default' });
  eq(p, 'resolver: manifest first', env.discoverAutomationRoot(mk('r-mf', { 'Testing/qa-manifest.json': JSON.stringify({ paths: { automationRoot: 'qa/auto' } }), '.specify/memory/constitution.md': '`tests/e2e/`' })), { path: 'qa/auto', source: 'manifest' });
  eq(p, 'resolver: nothing documented', env.discoverAutomationRoot(mk('r-none', { 'README.md': '' })), { path: 'Testing/Automation', source: 'default' });
  eq(p, 'constitution paths: backticked repo paths only (no URLs, globs, ..)', env.constitutionPaths(proj), ['tests/e2e', 'tests/unit', 'specs/<feature>/spec.md'].filter((x) => !/[<>]/.test(x)));
  check('29 Spec Kit project without manifest / learning file: constitution-first discovery, gates unchanged, nothing created', p, { init: r.json && r.json.sources, a: a1.json && a1.json.outcome, pf: pf.json && pf.json.outcome });
}

/* 21 — the documents: progressive loading budget, no subagents, every named command exists, the Full skill is declared. */
{
  const p = [];
  const read = (f) => (fs.existsSync(path.join(SKILL, f)) ? fs.readFileSync(path.join(SKILL, f), 'utf8') : null);
  const tok = (s) => Math.ceil(s.length / 4);
  const skill = read('SKILL.md'); const rules = read('references/lite-rules.md');
  truthy(p, 'SKILL.md exists', skill); truthy(p, 'references/lite-rules.md exists', rules);
  if (skill && rules) {
    truthy(p, 'always-loaded set (SKILL.md + lite-rules.md) ≤ 4000 tokens: ' + (tok(skill) + tok(rules)), tok(skill) + tok(rules) <= 4000);
    truthy(p, 'frontmatter has no Agent / Task tool', !/^allowed-tools:.*\b(Agent|Task)\b/m.test(skill));
    truthy(p, 'SKILL.md states: no subagents by default', /no subagent/i.test(skill));
    truthy(p, 'SKILL.md declares the standalone engine', skill.includes('**Standalone:**') && skill.includes('`engine/`'));
    truthy(p, 'SKILL.md says the model never reads script source', /never reads? (a )?script/i.test(skill));
    for (const [, s] of skill.matchAll(/scripts\/([a-z-]+\.mjs)/g)) truthy(p, 'named script exists: ' + s, fs.existsSync(path.join(here, s)) || fs.existsSync(path.join(FULL, s)));
    for (const w of ['AUTOMATION COMPLETE', 'BLOCKED', 'ENVIRONMENT_BLOCKED']) truthy(p, 'return string ' + w, skill.includes(w));
    // 1.5.1: the folder IS the name, every documented call path resolves, the versions agree, nothing is pre-approved wholesale
    const name = (skill.match(/^name:\s*(\S+)/m) || [])[1];
    eq(p, 'front-matter name equals the folder name', name, path.basename(SKILL));
    eq(p, 'metadata.version equals LITE_VERSION', (skill.match(/^\s+version:\s*"([^"]+)"/m) || [])[1], LITE_VERSION);
    const fm = (skill.match(/^allowed-tools:(.*)$/m) || [])[1] || '';
    truthy(p, 'allowed-tools pre-approves no bare Bash / MCP server', !fm.split(',').map((s) => s.trim()).some((s) => s === 'Bash' || /^mcp__/.test(s)));
  }
  const docs = ['SKILL.md', 'INPUT.txt', ...fs.readdirSync(path.join(SKILL, 'references')).filter((f) => f.endsWith('.md')).map((f) => 'references/' + f)];
  for (const d of docs) {
    for (const [, folder, rest] of (read(d) || '').matchAll(/\.claude\/skills\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._\/-]*[A-Za-z0-9_-])/g)) {
      if (!folder.startsWith('link-qc-5c') && !folder.includes('lite')) continue; // other skills are named, not called
      eq(p, d + ': documented folder', folder, path.basename(SKILL));
      if (/\.(mjs|md|ts)$/.test(rest)) truthy(p, d + ': documented path resolves: ' + rest, fs.existsSync(path.join(SKILL, rest)));
    }
  }
  const input = read('INPUT.txt') || '';
  eq(p, 'INPUT.txt VERSION equals LITE_VERSION', (input.match(/^VERSION:\s*(\S+)/m) || [])[1], LITE_VERSION);
  truthy(p, 'INPUT.txt declares no hard dependency on the Full skill', !/DEPENDS ON \(hard\)/.test(input));
  truthy(p, 'stage 1 reads the anchored Status: line', (read('references/stage-1-prepare.md') || '').includes('^\\*{0,2}Status:'));
  for (const f of ['stage-1-prepare', 'stage-2-checkpoint-a', 'stage-3-execute', 'stage-4-finalize']) {
    const t = read('references/' + f + '.md');
    truthy(p, f + '.md exists', t);
    if (t) truthy(p, f + '.md ≤ 3000 tokens: ' + tok(t), tok(t) <= 3000);
  }
  // H-LF (1.3.0): the learning file holds app / environment facts; tooling workarounds go to Deviations; old tooling lines ignored
  const s1 = read('references/stage-1-prepare.md') || ''; const s4 = read('references/stage-4-finalize.md') || '';
  truthy(p, 'H-LF: stage 1 ignores [type: tooling] lines of an older skill version', /\[type: tooling\] \[skill: x\.y\.z\]` from an older skill version\s+is ignored/.test(s1));
  truthy(p, 'H-LF: stage 4 sends a tooling workaround to Deviations, never the learning file', /workaround for a skill \/ tooling defect goes under\s+Deviations/.test(s4));
  truthy(p, 'H-LF: rule 14 says app / environment facts only', /facts about the app \/ environment only/.test(rules || ''));
  for (const tpl of ['teardown.spec.ts', 'auth.setup.ts', 'auth.ts', 'base-page.ts']) truthy(p, '1.3.0 template present: ' + tpl, fs.existsSync(path.join(SKILL, 'assets', 'templates', tpl)));
  truthy(p, 'journey templates carry the journey annotation', ['teardown.spec.ts', 'auth.setup.ts'].every((t) => /type: 'journey', description: '(setup|teardown)'/.test(fs.readFileSync(path.join(SKILL, 'assets', 'templates', t), 'utf8'))));
  const sch = read('references/schemas.md');
  truthy(p, 'schemas.md exists and ≤ 2000 tokens', sch && tok(sch) <= 2000);
  truthy(p, 'INPUT.txt exists', input);
  check('21 documents: budgets, no subagents, commands exist, dependency + returns declared', p, {});
}

/* 22 — the Full skill was not touched by this harness. */
{
  const p = [];
  eq(p, 'Full scripts hash before/after', hashTree(FULL) === FULL_BEFORE, true);
  check('22 Full skill untouched by the harness', p, {});
}

/* 30 — the vendored engine matches its manifest: no unrecorded local edit, no partial refresh (ENGINE.md). */
{
  const p = [];
  let m = null; try { m = jread(MANIFEST); } catch { p.push('engine manifest missing or unreadable: ' + posixRel(SKILL, MANIFEST)); }
  const detail = {};
  if (m) {
    const now = engineFiles();
    detail.changed = now.filter((r) => r in m.files && m.files[r] !== engineHash(r));
    detail.extra = now.filter((r) => !(r in m.files));
    detail.missing = Object.keys(m.files).filter((r) => !now.includes(r));
    for (const k of ['changed', 'extra', 'missing']) eq(p, 'engine files ' + k, detail[k], []);
    eq(p, 'engine version equals the manifest', engineVersion(), m.engineVersion);
    const full = path.join(SKILL, '..', 'link-qc-5-test-run-automation', 'SKILL.md');
    detail.fullInstalled = fs.existsSync(full) ? (fs.readFileSync(full, 'utf8').match(/version:\s*"([^"]+)"/) || [])[1] || null : null; // informational only
  }
  check('30 engine matches its manifest (no unrecorded edit)', p, detail);
}

fs.rmSync(TMP, { recursive: true, force: true });
const out = { tool: 'selftest-lite', cases: cases.length, passed: cases.filter((c) => c.ok).length, failed: failed.length, ...(failed.length ? { failures: failed } : {}), ...(process.argv.includes('--pretty') ? { detail: cases } : {}) };
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(failed.length ? 1 : 0);
