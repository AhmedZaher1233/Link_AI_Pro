#!/usr/bin/env node
// selftest-scratch.mjs — regression harness for scratch.mjs (the investigation runner).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// Every case runs the REAL scratch.mjs against fixtures/scratch/fake-playwright.mjs in a throw-away copy of
// fixtures/impact/project placed at {tmp}/Testing/Automation (the validator's default automation root): refusals
// before any browser, the overlay, the environment it removes, secret filtering, the labelled payload, the outer
// kill, the write-outside guard, clean, and — the point of the whole design — that a scratch probe is invisible to
// validate-automation.mjs, impact.mjs and config-inventory.mjs and writes nothing into a story's run, progress or
// evidence folders. A failing case means a scratch investigation could leak into an official result.
//
// Run: node selftest-scratch.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanSpec, FORBIDDEN, SCRATCH_REL, OVERLAY, findCli } from './scratch.mjs';
import * as cap from './capacity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = path.join(here, 'scratch.mjs');
const FAKE = path.join(here, 'fixtures', 'scratch', 'fake-playwright.mjs');
const PROJECT = path.join(here, 'fixtures', 'impact', 'project');
const pretty = process.argv.includes('--pretty');

const cases = [], fail = [], sandboxes = [];
// never the real ~/.link-ai-pro/capacity: the probes of every case reserve in a throw-away coordination directory
const SHARED_CAP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scratch-capacity-'));
sandboxes.push(SHARED_CAP);
process.env.QA_CAPACITY_DIR = SHARED_CAP;
delete process.env.QA_LEDGER;
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
function sandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scratch-'));
  sandboxes.push(tmp);
  const root = path.join(tmp, 'Testing', 'Automation');
  fs.cpSync(PROJECT, root, { recursive: true });
  const results = path.join(tmp, 'Testing', 'Requirements', 'US-1-create-order', 'reports');
  fs.mkdirSync(path.join(results, '.runs'), { recursive: true });
  fs.mkdirSync(path.join(results, 'artifacts', 'progress'), { recursive: true });
  fs.mkdirSync(path.join(results, 'screenshots'), { recursive: true });
  fs.writeFileSync(path.join(results, '.runs', 'phase-1.json'), '{"schema":"skill6-run/1","status":"final"}\n');
  const old = new Date(Date.now() - 3600 * 1000);
  const progress = path.join(results, 'artifacts', 'progress', 'first-smoke-1.summary.json');
  fs.writeFileSync(progress, '{}\n');
  fs.utimesSync(progress, old, old);
  return { tmp, root, results, scratch: path.join(root, ...SCRATCH_REL.split('/')) };
}
function probe(sb, name, body) {
  const f = path.join(sb.scratch, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
}
const PROBE = (marker = 'pass', extra = '') => `import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
// fake:${marker}
test('probe › save button resolves', async ({ page }) => {
  const login = new LoginPage(page);
  console.log(await login.password.isVisible());
  ${extra}
});
`;
function scratch(sb, args, env = {}) {
  const r = spawnSync(process.execPath, [SCRATCH, ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
  let payload = null;
  try { payload = JSON.parse(r.stdout); } catch { /* reported by the case */ }
  return { status: r.status, payload, stdout: r.stdout, stderr: r.stderr };
}
const runArgs = (sb, spec, more = []) => ['run', '--root', sb.root, '--spec', spec, '--cli', FAKE, '--results-root', sb.results, ...more];
const call = (sb) => { try { return JSON.parse(fs.readFileSync(path.join(sb.scratch, 'fake-call.json'), 'utf8')); } catch { return null; } };
const treeHash = (dir) => {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(dir, f) + ':' + crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')); } };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort().join('\n');
};

// 1. A probe outside the scratch folder is refused, nothing runs
{
  const sb = sandbox();
  const inTests = path.join(sb.root, 'tests', 'probe.spec.ts');
  fs.writeFileSync(inTests, PROBE());
  const nested = probe(sb, path.join('sub', 'probe.spec.ts'), PROBE());
  const a = scratch(sb, runArgs(sb, inTests)).payload;
  const b = scratch(sb, runArgs(sb, nested)).payload;
  const p = [];
  if (a?.outcome !== 'refused' || a.refused?.[0]?.reason !== 'outside-scratch') p.push('a probe under tests/ was not refused');
  if (b?.outcome !== 'refused' || b.refused?.[0]?.reason !== 'outside-scratch') p.push('a probe in a sub-folder of the scratch folder was not refused');
  if (call(sb)) p.push('Playwright was started for a refused probe');
  check('1 outside the scratch folder → refused, no browser', p, { a: a?.refused, b: b?.refused });
}

// 2. Every forbidden pattern refuses; comments and look-alikes do not (false-positive guards)
{
  const bad = {
    'official-evidence': "await captureEvidence(page, testInfo, 'x');",
    'own-screenshot': "await page.screenshot({ path: 'x.png' });",
    'storage-state': "await page.context().storageState();",
    'file-write': "import fs from 'node:fs'; fs.writeFileSync('x', 'y');",
    'env-read': "const u = process.env.A1_USER;",
    'credential-print': "const a = account('A1'); console.log(a.password);",
    'tc-id': "test('TC-07 save', async () => {});",
  };
  const p = [];
  for (const [id, line] of Object.entries(bad)) {
    const r = scanSpec(PROBE('pass', line)).map((x) => x.reason);
    if (!r.includes(id)) p.push(`${id} not refused`);
  }
  const clean = scanSpec(PROBE('pass', "// heal of TC-07: captureEvidence is not called here; process.env is not read\n  /* storageState */ await login.password.fill('typed input');"));
  if (clean.length) p.push('false positive: ' + clean.map((x) => x.reason).join(', '));
  if (FORBIDDEN.length !== Object.keys(bad).length) p.push('a FORBIDDEN rule has no case here');
  check('2 forbidden patterns refused (comments, a password locator and a typed input are not)', p, { rules: FORBIDDEN.map((f) => f.id) });
}

// 3-6. One observed probe: overlay, environment, payload labels, secret filtering
{
  const sb = sandbox();
  const spec = probe(sb, 'probe.spec.ts', PROBE('secret'));
  const env = { PW_STAGE_JSON: 'x.json', PW_PROGRESS_FILE: 'p.jsonl', PW_PHASE: '3', PW_STAGE_ATTEMPT: '2', PW_RATE_LIMIT_FILE: 'r', PW_RATE_LIMIT_STATE: 's', PW_RATE_LIMITS: '{}', PW_HEADLESS: '1', A1_PASSWORD: 'Sup3r-Secret-Value' };
  const r = scratch(sb, runArgs(sb, spec), env).payload;
  const c = call(sb);
  const overlay = fs.existsSync(path.join(sb.scratch, OVERLAY)) ? fs.readFileSync(path.join(sb.scratch, OVERLAY), 'utf8') : '';
  const p3 = [];
  for (const want of ["import base from '../../playwright.config'", "testDir: '.'", 'workers: 1', 'retries: 0', 'globalSetup: undefined', 'globalTeardown: undefined', "outputDir: './out'", 'process.env.PW_SCRATCH_JSON', "trace: 'on'", "screenshot: 'on'", 'testMatch: /probe\\.spec\\.ts$/'])
    if (!overlay.includes(want)) p3.push('overlay lacks ' + want);
  if (/^playwright.*\.config\./.test(OVERLAY)) p3.push('overlay name matches playwright*.config.*');
  check('3 overlay over the shared config (1 worker, no retries, own reporter and output, no global setup)', p3, { overlay: overlay.split('\n').length + ' lines' });
  const p4 = [];
  if (!c) p4.push('Playwright was not called');
  else {
    for (const k of ['PW_STAGE_JSON', 'PW_PROGRESS_FILE', 'PW_PHASE', 'PW_STAGE_ATTEMPT', 'PW_RATE_LIMIT_FILE', 'PW_RATE_LIMIT_STATE', 'PW_RATE_LIMITS', 'PW_HEADLESS']) if (k in c.env) p4.push(k + ' reached Playwright');
    if (!c.env.PW_OUTPUT_DIR || !path.resolve(c.env.PW_OUTPUT_DIR).startsWith(sb.scratch)) p4.push('PW_OUTPUT_DIR not inside the scratch folder');
    if (!c.env.PW_SCRATCH_JSON) p4.push('PW_SCRATCH_JSON missing');
    if (path.resolve(c.cwd) !== path.resolve(sb.root)) p4.push('cwd is not the automation root');
    if (c.argv[0] !== 'test' || c.argv[1] !== 'probe.spec.ts' || !c.argv.includes('--config')) p4.push('command shape: ' + c.argv.join(' '));
  }
  check('4 run-stage variables removed, scratch output dir + json set, cwd = automation root', p4, { env: c?.env });
  const p5 = [];
  const all = JSON.stringify(r);
  if (all.includes('hunter2')) p5.push('a credential line reached the payload');
  if (all.includes('Sup3r-Secret-Value')) p5.push('the A1_PASSWORD value reached the payload');
  if (!all.includes('[line withheld')) p5.push('credential line not withheld');
  if (!all.includes('[redacted]')) p5.push('env value not redacted');
  check('5 credential lines withheld and credential-named env values redacted', p5, { output: r?.output });
  const p6 = [];
  if (r?.kind !== 'investigation' || r.officialResult !== false || !/never a TC result/.test(r.notice || '')) p6.push('payload not labelled as an investigation');
  if (r?.schema !== 'skill5-scratch/1') p6.push('schema');
  if (r?.outcome !== 'observed') p6.push('outcome ' + r?.outcome);
  if (r?.tests?.[0]?.status !== 'passed' || !/save button/.test(r.tests[0].title)) p6.push('tests[] not parsed');
  if (!r?.artifacts?.includes('test-results/qa-scratch/out/trace.zip')) p6.push('trace artifact missing');
  if (r?.artifacts?.some((x) => /LoginPage/.test(x))) p6.push('an attachment outside the scratch folder was listed');
  check('6 payload labelled investigation / officialResult false, tests and in-folder artifacts parsed', p6, { outcome: r?.outcome, tests: r?.tests, artifacts: r?.artifacts });
  // a failing probe is still an observation, never a FAIL of anything; its error line is filtered
  fs.writeFileSync(spec, PROBE('fail'));
  const f = scratch(sb, runArgs(sb, spec)).payload;
  const p6b = [];
  if (f?.outcome !== 'observed' || f.tests?.[0]?.status !== 'failed') p6b.push('failed probe not reported as an observation');
  if (JSON.stringify(f).includes('hunter2')) p6b.push('credential in the error line');
  // --headless reaches Playwright only when asked
  scratch(sb, runArgs(sb, spec, ['--headless']));
  if (call(sb)?.env?.PW_HEADLESS !== '1') p6b.push('--headless not passed');
  check('6b failing probe = observed + filtered error; --headless only on request', p6b, { tests: f?.tests });
}

// 7. A probe that hangs is killed at the timeout + margin
{
  const sb = sandbox();
  const spec = probe(sb, 'hang.spec.ts', PROBE('hang'));
  const t0 = Date.now();
  const r = scratch(sb, runArgs(sb, spec, ['--timeout', '1000', '--kill-margin', '500'])).payload;
  const p = [];
  if (r?.outcome !== 'timeout') p.push('outcome ' + r?.outcome);
  if (Date.now() - t0 > 30000) p.push('not killed in time');
  check('7 hanging probe killed → timeout', p, { outcome: r?.outcome, error: r?.error });
}

// 8. A file written outside test-results/ → violation
{
  const sb = sandbox();
  const spec = probe(sb, 'leak.spec.ts', PROBE('write-outside'));
  const r = scratch(sb, runArgs(sb, spec)).payload;
  const p = [];
  if (r?.outcome !== 'violation') p.push('outcome ' + r?.outcome);
  if (!r?.writesOutside?.some((x) => /pages\/Leak\.ts$/.test(x))) p.push('the leaked file is not named');
  check('8 write outside the scratch folder → violation, file named', p, { writesOutside: r?.writesOutside });
}

// 9. clean removes the folder; a second clean reports absent
{
  const sb = sandbox();
  probe(sb, 'probe.spec.ts', PROBE());
  const a = scratch(sb, ['clean', '--root', sb.root]).payload;
  const b = scratch(sb, ['clean', '--root', sb.root]).payload;
  const p = [];
  if (a?.outcome !== 'removed' || fs.existsSync(sb.scratch)) p.push('first clean: ' + a?.outcome);
  if (b?.outcome !== 'absent') p.push('second clean: ' + b?.outcome);
  check('9 clean → removed, then absent', p, { a: a?.outcome, b: b?.outcome });
}

// 10. The scanners never see a scratch probe or its overlay
{
  const sb = sandbox();
  const strip = (o) => JSON.stringify(o, (k, v) => (/^(generatedOn|generatedAt|at|durationMs|root|automationRoot)$/.test(k) ? undefined : v));
  const node = (script, args) => { const r = spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8', timeout: 60000 }); try { return JSON.parse(r.stdout); } catch { return { unreadable: r.stdout.slice(0, 200) }; } };
  const scan = () => ({
    validator: node('validate-automation.mjs', ['--root', sb.tmp]),
    impact: node('impact.mjs', ['fingerprint', '--root', sb.root]),
    configs: node('config-inventory.mjs', ['--root', sb.tmp]),
  });
  const before = scan();
  const spec = probe(sb, 'probe.spec.ts', PROBE('pass', "await page.locator('#save').click(); await page.waitForTimeout(500);"));
  scratch(sb, runArgs(sb, spec)); // writes the overlay, out/ and report.json too
  const after = scan();
  const p = [];
  for (const k of Object.keys(before)) if (strip(before[k]) !== strip(after[k])) p.push(k + ' output changed with a scratch probe present');
  if (before.validator?.fingerprint?.scopeDigest !== after.validator?.fingerprint?.scopeDigest) p.push('scopeDigest changed');
  if (!fs.existsSync(path.join(sb.scratch, OVERLAY))) p.push('overlay was not written — the case proves nothing');
  check('10 validate-automation / impact fingerprint / config-inventory identical with a scratch probe + overlay present', p, { scopeDigest: after.validator?.fingerprint?.scopeDigest });
}

// 11. Nothing lands in the story's run, progress or evidence folders; a fresh progress file refuses the probe
{
  const sb = sandbox();
  const spec = probe(sb, 'probe.spec.ts', PROBE());
  const before = treeHash(sb.results);
  const r = scratch(sb, runArgs(sb, spec)).payload;
  const after = treeHash(sb.results);
  const p = [];
  if (r?.outcome !== 'observed') p.push('outcome ' + r?.outcome);
  if (before !== after) p.push('the results root changed');
  const fresh = path.join(sb.results, 'artifacts', 'progress', 'first-positive-2.jsonl');
  fs.writeFileSync(fresh, '{}\n');
  const busy = scratch(sb, runArgs(sb, spec)).payload;
  if (busy?.outcome !== 'refused' || busy.refused?.[0]?.reason !== 'stage-in-flight') p.push('a stage in flight did not refuse the probe');
  check('11 results root untouched (.runs / artifacts/progress / screenshots); stage in flight → refused', p, { busy: busy?.refused });
}

// 12. Missing shared config or Playwright → refused; the project's Playwright is found from a parent folder
{
  const sb = sandbox();
  const spec = probe(sb, 'probe.spec.ts', PROBE());
  fs.renameSync(path.join(sb.root, 'playwright.config.ts'), path.join(sb.root, 'pw.ts'));
  const noCfg = scratch(sb, ['run', '--root', sb.root, '--spec', spec, '--cli', FAKE]).payload;
  const noCli = scratch(sb, ['run', '--root', sb.root, '--spec', spec, '--config', 'pw.ts', '--cli', 'node_modules/none/cli.js']).payload;
  const cli = path.join(sb.tmp, 'node_modules', '@playwright', 'test', 'cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true }); fs.writeFileSync(cli, '// stub\n');
  const found = findCli(sb.root);
  const p = [];
  if (!noCfg?.refused?.some((x) => x.reason === 'no-config')) p.push('no config not refused');
  if (!noCli?.refused?.some((x) => x.reason === 'no-playwright')) p.push('no Playwright not refused');
  if (found !== cli) p.push('cli not found upwards: ' + found);
  check('12 no shared config / no Playwright → refused; Playwright resolved from a parent node_modules', p, { found });
}

// 13. The machine ceiling covers a probe: one slot reserved and released (nothing left in the ledger); a ceiling another
//     run fills → refused "capacity", no browser; QA_LEDGER=off → the slot is exclusive; a torn ledger → "no-coordination"
{
  const p = [];
  const capDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scratch-cap-')); sandboxes.push(d); return d; };
  const sb = sandbox();
  const spec = probe(sb, 'probe.spec.ts', PROBE());
  const d1 = capDir();
  const ok = scratch(sb, runArgs(sb, spec), { QA_CAPACITY_DIR: d1 }).payload;
  if (ok?.outcome !== 'observed' || !ok.capacity || ok.capacity.released !== true || ok.capacity.exclusive !== false) p.push('a probe must hold one slot and release it: ' + JSON.stringify(ok?.capacity) + ' ' + ok?.outcome);
  if (cap.readLedger(d1).entries.length) p.push('entries left after the probe: ' + JSON.stringify(cap.readLedger(d1).entries));
  const d2 = capDir();
  const held = await cap.reserve({ dir: d2, cls: 'playwright', units: 2, limit: 2, liveness: 'pid', owner: { runId: 'another-run' } });
  const sb2 = sandbox();
  const full = scratch(sb2, runArgs(sb2, probe(sb2, 'probe.spec.ts', PROBE()), ['--max-wait', '500']), { QA_CAPACITY_DIR: d2 }).payload;
  if (full?.outcome !== 'refused' || full.refused?.[0]?.reason !== 'capacity') p.push('a full ceiling must refuse the probe: ' + JSON.stringify(full?.refused));
  if (call(sb2)) p.push('Playwright was started over a full ceiling');
  if (held.ok) await cap.release({ dir: d2, token: held.token, rows: null });
  const d3 = capDir();
  const sb3 = sandbox();
  const ex = scratch(sb3, runArgs(sb3, probe(sb3, 'probe.spec.ts', PROBE())), { QA_CAPACITY_DIR: d3, QA_LEDGER: 'off' }).payload;
  if (ex?.outcome !== 'observed' || ex.capacity?.exclusive !== true || ex.capacity?.released !== true) p.push('QA_LEDGER=off: ' + JSON.stringify(ex?.capacity));
  const d4 = capDir();
  fs.writeFileSync(path.join(d4, 'ledger.json'), '{ torn');
  const sb4 = sandbox();
  const torn = scratch(sb4, runArgs(sb4, probe(sb4, 'probe.spec.ts', PROBE())), { QA_CAPACITY_DIR: d4 }).payload;
  if (torn?.outcome !== 'refused' || torn.refused?.[0]?.reason !== 'no-coordination') p.push('a torn ledger must refuse: ' + JSON.stringify(torn?.refused));
  if (call(sb4)) p.push('Playwright was started without coordination');
  check('13 the machine ceiling covers a probe: reserve → release; full → refused; QA_LEDGER=off exclusive; torn ledger → no-coordination', p, { capacity: ok?.capacity });
}

for (const s of sandboxes) { try { fs.rmSync(s, { recursive: true, force: true }); } catch { /* best effort */ } }
const out = { tool: 'selftest-scratch', cases: cases.length, passed: cases.length - fail.length, failed: fail.length, overall: fail.length ? 'FAIL' : 'PASS', fail, results: cases };
process.stdout.write(JSON.stringify(out, null, pretty ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
