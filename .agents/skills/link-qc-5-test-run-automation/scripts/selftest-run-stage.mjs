#!/usr/bin/env node
// selftest-run-stage.mjs — regression harness for run-stage.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// Every case runs the REAL run-stage.mjs (and through it the real watchdog.mjs) against
// fixtures/run-stage/fake-playwright.mjs in a throw-away automation root under the OS temp folder:
// command shape, stage filters, freeze stops with a process-tree kill, the outer ceiling, the
// freshness gate, false-freeze guards, cumulative stage messages, secret filtering and refusals.
// A failing case means run-stage.mjs cannot be trusted to run a stage unattended.
//
// Run: node selftest-run-stage.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildFilter, tcIdsOf, aggregate } from './run-stage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUN_STAGE = path.join(here, 'run-stage.mjs');
const WATCHDOG = path.join(here, 'watchdog.mjs');
const fx = (f) => path.join(here, 'fixtures', 'run-stage', f);
const FAKE = fx('fake-playwright.mjs');
const SPEC = 'tests/Orders_Tests/03-create-order.spec.ts';
const CEILINGS = 'parallel=20000,serial:orders=20000,serial:orders-archive=20000,setup:order-items=20000';
const SMOKE = 'TC-001,TC-002,TC-003,TC-010';
const POSITIVE = 'TC-004,TC-005,TC-007,TC-008';
const NEGATIVE = 'TC-006,TC-011,TC-012';

const cases = [];
const fail = [];
const sandboxes = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-stage-'));
  sandboxes.push(root);
  const results = path.join(root, 'reports', 'US-1234-create-order');
  fs.mkdirSync(path.join(results, '.runs'), { recursive: true });
  const runFile = path.join(results, '.runs', 'phase-3.json');
  fs.copyFileSync(fx('phase-3.json'), runFile);
  return { root, results, runFile, log: path.join(root, 'automation-logs', 'US-1234-create-order', 'run-progress-selftest.log') };
}
function stage(sb, args, scenario = {}, extraEnv = {}) {
  const argv = [RUN_STAGE, '--run-file', sb.runFile, '--cwd', sb.root, '--log', sb.log, '--project', 'chromium', '--cli', FAKE,
    '--grace', '200', '--interval', '100', '--status-every', '300', '--ceiling-margin', '400', '--spec', SPEC, ...args];
  if (!args.includes('--ceilings')) argv.push('--ceilings', CEILINGS);
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 90000, env: { ...process.env, FAKE_PW_SCENARIO: JSON.stringify(scenario), ...extraEnv } });
  let payload = null;
  try { payload = JSON.parse(r.stdout); } catch { /* reported by the case */ }
  return { status: r.status, payload, stdout: r.stdout, stderr: r.stderr };
}
const argvOf = (sb, slug, attempt = 1) => { try { return JSON.parse(fs.readFileSync(path.join(sb.results, 'artifacts', 'fake-argv', slug + '-' + attempt + '.json'), 'utf8')); } catch { return null; } };
const logOf = (sb) => { try { return fs.readFileSync(sb.log, 'utf8'); } catch { return ''; } };
const summaryOf = (sb, p) => JSON.parse(fs.readFileSync(path.join(sb.results, p.summaryFile), 'utf8'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/* 1 — command shape, environment, group order, one lookahead regex with tag-end guards, nothing refused passed. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]);
  const pl = r.payload;
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome) + ' != COMPLETED ' + r.stderr);
  const par = argvOf(sb, 'parallel');
  const ser = argvOf(sb, 'serial-orders');
  const want = buildFilter({ stage: 'smoke', group: 'parallel' }).grep;
  if (!par || par.flags.grep !== want) p.push('parallel grep ' + (par && par.flags.grep) + ' != ' + want);
  if (!par || par.flags.workers !== '2' || par.flags.project !== 'chromium' || !par.specs.includes(SPEC)) p.push('parallel command lacks --workers=2 / --project / the spec');
  if (!ser || ser.flags.workers !== '1') p.push('serial group not run with --workers=1');
  for (const a of [par, ser]) if (a && a.argv.some((x) => /^--(reporter|config)/.test(x))) p.push('a --reporter / --config reached Playwright');
  if (par && par.flags['grep-invert']) p.push('smoke stage must not invert @smoke');
  const e = par ? par.env : {};
  if (!/artifacts[\\/]stages[\\/]smoke-parallel\.json$/.test(e.PW_STAGE_JSON || '')) p.push('PW_STAGE_JSON ' + e.PW_STAGE_JSON);
  if (!/artifacts[\\/]progress[\\/]smoke-parallel\.jsonl$/.test(e.PW_PROGRESS_FILE || '')) p.push('PW_PROGRESS_FILE ' + e.PW_PROGRESS_FILE);
  if (e.PW_GLOBAL_TIMEOUT !== '20000' || e.PW_PHASE !== '3' || e.PW_STAGE_ATTEMPT !== '1' || e.PW_WORKERS !== '2') p.push('PW_GLOBAL_TIMEOUT / PW_PHASE / PW_STAGE_ATTEMPT / PW_WORKERS wrong: ' + JSON.stringify(e));
  if ('PW_HEADLESS' in e) p.push('PW_HEADLESS set on a headed run');
  if (pl && JSON.stringify(pl.skippedGroups) !== JSON.stringify([{ name: 'serial:orders-archive', reason: 'no TCs of this stage in this group' }])) p.push('the group without smoke TCs was not skipped and named: ' + JSON.stringify(pl && pl.skippedGroups));
  if (pl && (pl.groups.map((g) => g.name).join(',') !== 'parallel,serial:orders')) p.push('group order ' + pl.groups.map((g) => g.name));
  if (pl && (pl.counts.passed !== 3 || pl.counts.failed !== 1 || pl.counts.tcs !== 4)) p.push('counts ' + JSON.stringify(pl.counts));
  if (pl && pl.groups.some((g) => g.freshness !== 'PASS' || g.source !== 'json')) p.push('freshness / source not PASS / json');
  const log = logOf(sb);
  if (!/Running Smoke Tests \(first run\) · parallel \(parallel ×2, headed\) · start/.test(log)) p.push('the log has no start line with the activity name');
  if (!/\|\s+✓\s+1 \[chromium\]/.test(log)) p.push('line-reporter output not appended to the log');
  if (!/· parallel \(parallel ×2\) · \d+\/3 TCs done · stage \d+% · passed \d+ · failed \d+ · skipped \d+ · not run \d+ · current .+ · elapsed \d\d:\d\d · remaining .+ · watchdog \w+/.test(log)
    && !/· parallel · end ·/.test(log)) p.push('neither a status line nor an end line for the parallel group in the log');
  if (!/stage end · COMPLETED/.test(log)) p.push('no stage end line');
  check('1 command shape, environment, plan order, regex, nothing refused reaches Playwright', p, { groups: pl && pl.groups });
}

/* 2 — the tag-end guard: @run:serial-orders never selects @run:serial-orders-archive; a TC the filter does not select is NOT_RUN, named; "No tests found" is not a freshness failure. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'negative', '--run', 'first', '--stage-tcs', NEGATIVE]);
  const pl = r.payload;
  const tc = (id) => summaryOf(sb, pl).tcs[id];
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome));
  else {
    if (tc('TC-011') !== 'SKIP' || tc('TC-012') !== 'PASS' || tc('TC-006') !== 'PASS') p.push('statuses ' + JSON.stringify(summaryOf(sb, pl).tcs));
    const ser = argvOf(sb, 'serial-orders');
    if (!ser || !ser.flags['grep-invert']) p.push('negative stage must invert @smoke');
  }
  const sb2 = sandbox();
  const r2 = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE + ',TC-011'], { 'serial-orders': 'no-tests' });
  const pl2 = r2.payload;
  if (!pl2 || pl2.outcome !== 'COMPLETED') p.push('no-tests: outcome ' + (pl2 && pl2.outcome) + ' — "No tests found" must not fail the freshness gate');
  else {
    const g = pl2.groups.find((x) => x.name === 'serial:orders');
    if (!g || g.source !== 'none') p.push('no-tests group source ' + (g && g.source));
    const nr = pl2.notRun.find((n) => n.tc === 'TC-010');
    if (!nr || !/no test matched the stage filter/.test(nr.reason)) p.push('TC-010 not NOT_RUN with the filter reason');
    if (!pl2.warnings.some((w) => /no test matched the stage filter/.test(w))) p.push('no warning for a planned group the filter left empty');
  }
  check('2 tag-end guard; unmatched planned TCs stay visible as NOT_RUN; no-tests is not a freshness failure', p, {});
}

/* 3 — FROZEN: detected inside the script (no polling by the model), the process TREE killed, the watchdog file written for this stage's TCs only, the next group still runs, re-queue list returned. */
let frozenSandbox = null;
{
  const p = [];
  const sb = sandbox();
  frozenSandbox = sb;
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'freeze' });
  const pl = r.payload;
  if (!pl || pl.outcome !== 'STOPPED_FROZEN') p.push('outcome ' + (pl && pl.outcome) + ' != STOPPED_FROZEN ' + r.stderr);
  else {
    const g = pl.groups.find((x) => x.name === 'parallel');
    if (!g || g.stop !== 'watchdog' || g.source !== 'incremental+watchdog' || g.freshness !== 'PASS') p.push('frozen group record ' + JSON.stringify(g));
    const wf = path.join(sb.results, 'artifacts', 'progress', 'smoke-parallel.watchdog.json');
    let file = null; try { file = JSON.parse(fs.readFileSync(wf, 'utf8')); } catch { p.push('no watchdog file at ' + wf); }
    if (file) {
      const planned = [...file.completed.map((c) => c.tc), ...file.interrupted.map((c) => c.tc), ...file.not_started.map((c) => c.tc)].sort().join(',');
      if (planned !== 'TC-001,TC-002,TC-003') p.push('the watchdog file covers ' + planned + ' — only this stage\'s TCs of the group may appear');
      if (!file.interrupted.some((i) => i.tc === 'TC-002' && /watchdog at step "save the order"/.test(i.reason))) p.push('TC-002 not interrupted at its step');
    }
    const st = summaryOf(sb, pl).tcs;
    if (st['TC-001'] !== 'PASS' || st['TC-002'] !== 'INCOMPLETE' || st['TC-003'] !== 'NOT_RUN') p.push('statuses ' + JSON.stringify(st));
    if (st['TC-010'] !== 'PASS') p.push('the serial group after the stop did not run');
    if (!pl.requeue.length || pl.requeue[0].tcs.join(',') !== 'TC-002,TC-003') p.push('re-queue list ' + JSON.stringify(pl.requeue));
    const s = summaryOf(sb, pl);
    if (!s.watchdog_events.length || s.watchdog_events[0].action !== 'stopped' || !s.timeout_events.length || s.timeout_events[0].kind !== 'watchdog') p.push('watchdog / timeout events missing');
    if (!/STOPPED — watchdog: worker \d+ frozen in step "save the order"/.test(logOf(sb))) p.push('the stop is not in the log');
  }
  let pid = null; try { pid = Number(fs.readFileSync(path.join(sb.results, 'artifacts', 'fake-grandchild.pid'), 'utf8')); } catch { p.push('the fake never started its grandchild'); }
  if (pid && alive(pid)) { p.push('grandchild ' + pid + ' survived — the process tree was not killed'); try { process.kill(pid); } catch { /* best effort */ } }
  check('3 a frozen worker stops its command and kills the whole process tree; the rest of the stage runs', p, { requeue: pl && pl.requeue });
}

/* 4 — the stand-in file equals a direct watchdog.mjs --write on the same inputs and instant (no second decision logic). */
{
  const p = [];
  const sb = frozenSandbox;
  const prog = path.join(sb.results, 'artifacts', 'progress');
  let mine = null; try { mine = JSON.parse(fs.readFileSync(path.join(prog, 'smoke-parallel.watchdog.json'), 'utf8')); } catch { p.push('case 3 left no watchdog file'); }
  if (mine) {
    const out = path.join(prog, 'direct.watchdog.json');
    spawnSync(process.execPath, [WATCHDOG, '--plan', path.join(prog, 'smoke-parallel.plan.json'), '--heartbeat', path.join(prog, 'smoke-parallel.jsonl'),
      '--results', path.join(prog, 'smoke-parallel.results.jsonl'), '--grace', '200', '--stage', 'smoke', '--group', 'parallel', '--now', mine.decided_at, '--write', '--out', out], { encoding: 'utf8' });
    let direct = null; try { direct = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { p.push('direct watchdog.mjs --write produced nothing'); }
    if (direct) for (const k of ['verdict', 'completed', 'interrupted', 'not_started', 'counts']) if (JSON.stringify(direct[k]) !== JSON.stringify(mine[k])) p.push(k + ' differs between run-stage and watchdog.mjs');
  }
  check('4 the stop file is exactly what watchdog.mjs --write decides for the same inputs', p, {});
}

/* 5 — FALSE-FREEZE GUARD: a long step inside its own deadline, with no console output, is never killed. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'quiet-long' });
  const pl = r.payload;
  if (!pl || pl.outcome !== 'COMPLETED' || pl.groups.some((g) => g.stop)) p.push('a quiet in-deadline step was stopped: ' + JSON.stringify(pl && pl.groups));
  check('5 a quiet step inside its own deadline is never stopped', p, {});
}

/* 6 — FALSE-FREEZE GUARD: an unreadable heartbeat (BLOCKED) is never a freeze, even over an expired step. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'malformed' });
  const pl = r.payload;
  if (!pl || pl.outcome !== 'COMPLETED' || pl.groups.some((g) => g.stop)) p.push('an unreadable heartbeat led to a stop: ' + JSON.stringify(pl && pl.groups));
  if (pl && !pl.flags.watchdogUnreadable) p.push('the unreadable heartbeat is not flagged');
  if (pl && !pl.blockers.some((b) => /could not be read/.test(b))) p.push('the outer-ceiling-only fallback is not named as a blocker');
  check('6 a malformed heartbeat never triggers a kill; it is flagged and only the ceiling applies', p, {});
}

/* 7 — OUTER CEILING: Playwright that outlives PW_GLOBAL_TIMEOUT + margin is killed; reasons name the ceiling, not a freeze. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--ceilings', 'parallel=600,serial:orders=20000'], { parallel: 'hang-between' });
  const pl = r.payload;
  if (!pl || pl.outcome !== 'STOPPED_CEILING') p.push('outcome ' + (pl && pl.outcome) + ' != STOPPED_CEILING');
  else {
    const s = summaryOf(sb, pl);
    if (s.tcs['TC-001'] !== 'PASS' || s.tcs['TC-002'] !== 'NOT_RUN' || s.tcs['TC-003'] !== 'NOT_RUN') p.push('statuses ' + JSON.stringify(s.tcs));
    if (!/^not started: outer ceiling stop after \d+ s$/.test(s.reasons['TC-002'] || '')) p.push('reason ' + s.reasons['TC-002']);
    if (!s.timeout_events.some((e) => e.kind === 'ceiling') || !s.watchdog_events.some((e) => e.action === 'ceiling-stop')) p.push('ceiling events missing');
    if (s.tcs['TC-010'] !== 'PASS') p.push('the next group did not run after the ceiling stop');
  }
  check('7 a command past its ceiling + margin is killed and reported as an outer-ceiling stop', p, {});
}

/* 8 — FRESHNESS GATE: a missing or stale stage JSON stops the stage; the groups after it are NOT_RUN with the reason. */
{
  const p = [];
  for (const scenario of ['no-json', 'stale-json']) {
    const sb = sandbox();
    const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: scenario });
    const pl = r.payload;
    if (!pl || pl.outcome !== 'FRESHNESS_FAILED') { p.push(scenario + ': outcome ' + (pl && pl.outcome)); continue; }
    if (!pl.notRunGroups.length || pl.notRunGroups[0].name !== 'serial:orders') p.push(scenario + ': later group not listed NOT_RUN');
    if (argvOf(sb, 'serial-orders')) p.push(scenario + ': the next group ran after a freshness failure');
    if (scenario === 'stale-json' && !/stale/.test(pl.reason)) p.push('stale JSON not named stale: ' + pl.reason);
    if (!/^Smoke tests stopped \(first run\)/.test(pl.update)) p.push(scenario + ': update does not say the stage stopped');
    if (!pl.notRun.some((n) => n.tc === 'TC-010')) p.push(scenario + ': TC-010 not reported NOT_RUN');
  }
  check('8 a missing or stale stage JSON stops the stage; nothing is assembled from line output', p, {});
}

/* 9 — refusals happen before anything is spawned. */
{
  const p = [];
  const sb = sandbox();
  const tries = [
    ['--extra', 'reporter=list'],
    ['--extra', 'retries=2'],
    ['--cmd', 'npx playwright test --reporter=list'],
    ['--cmd', 'npx playwright test --config playwright.us-1.config.ts'],
    ['--ceilings', 'parallel=20000'],
  ];
  for (const t of tries) {
    const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, ...t]);
    if (!r.payload || r.payload.outcome !== 'BLOCKED') p.push(t.join(' ') + ' → ' + (r.payload && r.payload.outcome) + ' (must be BLOCKED)');
  }
  if (fs.existsSync(path.join(sb.results, 'artifacts', 'fake-argv'))) p.push('Playwright was spawned despite a refusal');
  const noTcs = stage(sb, ['--stage', 'smoke', '--run', 'first']);
  if (!noTcs.payload || noTcs.payload.outcome !== 'BLOCKED') p.push('a stage without --stage-tcs ran');
  check('9 --reporter / --config / retries / a missing ceiling / no stage TCs are refused before spawning', p, {});
}

/* 10 — stage-based messages: setup → smoke → positive → negative (first run), cumulative; the final run starts its own count; attempts never reuse a file. */
{
  const p = [];
  const sb = sandbox();
  const setup = stage(sb, ['--stage', 'setup', '--run', 'first']).payload;
  const smoke = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]).payload;
  const pos = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE]).payload;
  const neg = stage(sb, ['--stage', 'negative', '--run', 'first', '--stage-tcs', NEGATIVE]).payload;
  const fin = stage(sb, ['--stage', 'smoke', '--run', 'final', '--stage-tcs', SMOKE]).payload;
  const has = (pl, re, what) => { if (!pl || !re.test(pl.update)) p.push(what + ' — got: ' + (pl && JSON.stringify(pl.update))); };
  has(setup, /^Setup journeys completed \(first run\): 1 passed, 0 failed/, 'setup message');
  has(smoke, /^Smoke tests completed \(first run\): 3 passed, 1 failed, 0 skipped, 0 not run — 4 TCs/, 'smoke counts');
  has(smoke, /\nFailed: TC-003\./, 'smoke failures');
  has(smoke, /\nSetup journeys: 1 passed, 0 failed\./, 'setup line inside the smoke message');
  has(smoke, /\nSmoke gate: 25% failed \(limit 30%\) — Positive tests may continue\./, 'smoke gate line');
  has(pos, /^Positive tests completed \(first run\): 3 passed, 1 failed, 0 skipped, 0 not run — 4 TCs/, 'positive counts');
  has(pos, /unverified assumption: TC-005 — never an application bug/, 'unverified assumption named');
  has(pos, /\nSo far \(first run\): Smoke 3 passed · 1 failed \| Positive 3 passed · 1 failed — combined 6 passed, 2 failed, 0 skipped, 0 not run of 8 TCs\./, 'cumulative after positive');
  has(neg, /\nFirst run totals: Smoke 3 passed · 1 failed \| Positive 3 passed · 1 failed \| Negative 2 passed · 0 failed · 1 skipped — Passed 8 · Failed 2 · Skipped 1 · Not run 0 of 11 TCs\./, 'final cumulative after negative');
  has(neg, /\nEvidence: screenshots\/US-1234-create-order\/phase-3\//, 'evidence folder');
  has(fin, /^Smoke tests completed \(final run\): 3 passed, 1 failed/, 'final-run label');
  if (fin && /So far|totals/.test(fin.update)) p.push('the final run mixed in first-run counts');
  if (!fs.existsSync(path.join(sb.results, 'artifacts', 'stages', 'smoke-parallel-attempt2.json'))) p.push('the final run did not get attempt 2 files');
  const a2 = argvOf(sb, 'parallel', 2);
  if (!a2 || a2.env.PW_STAGE_ATTEMPT !== '2') p.push('PW_STAGE_ATTEMPT not 2 on the second smoke command');
  const sb2 = sandbox();
  const hot = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--groups', 'parallel', '--tcs', 'TC-001,TC-003']).payload;
  has(hot, /\nSmoke gate: 50% failed \(limit 30%\) — classify every smoke failure before deciding/, 'gate above the limit asks for classification');
  if (hot && hot.smokeGate && hot.smokeGate.decision !== 'classify') p.push('smokeGate.decision ' + hot.smokeGate.decision);
  const rq = argvOf(sb2, 'parallel');
  if (!rq || rq.flags.grep !== buildFilter({ stage: 'smoke', group: 'parallel', tcs: ['TC-001', 'TC-003'] }).grep) p.push('--tcs filter not applied to the command');
  check('10 one cumulative message per stage; final run counted on its own; attempts numbered', p, { smoke: smoke && smoke.update });
}

/* 11 — secrets: credential-looking output never reaches the log, the payload or the summary; env values are never written. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'secret' }, { A1_PASSWORD: 's3cr3t-value-xyz' });
  const blob = logOf(sb) + r.stdout + (r.payload ? fs.readFileSync(path.join(sb.results, r.payload.summaryFile), 'utf8') : '');
  for (const s of ['hunter2', 'abc123', 's3cr3t-value-xyz']) if (blob.includes(s)) p.push('"' + s + '" leaked');
  if (!/line withheld: it looks like a credential/.test(logOf(sb))) p.push('the withheld-line marker is missing');
  check('11 credential-looking lines are withheld; environment values never written', p, {});
}

/* 12 — 0xC0000142 worker crash flagged as environmental; --cmd passes the regex (| ( [ ) through a shell intact. */
{
  const p = [];
  const sb = sandbox();
  const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'dll-crash' });
  if (!r.payload || !r.payload.flags.windowsDllInitCrash || !r.payload.blockers.some((b) => /0xC0000142/.test(b))) p.push('the DLL-init crash is not flagged as an environment failure');
  if (r.payload && summaryOf(sb, r.payload).tcs['TC-002'] !== 'INCOMPLETE') p.push('interrupted tests of the crash not INCOMPLETE');
  const sb2 = sandbox();
  const cmd = '"' + process.execPath + '" "' + FAKE + '"';
  const c = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--groups', 'parallel', '--tcs', 'TC-001,TC-002', '--cmd', cmd]);
  const got = argvOf(sb2, 'parallel');
  const want = buildFilter({ stage: 'smoke', group: 'parallel', tcs: ['TC-001', 'TC-002'] }).grep;
  if (!got || got.flags.grep !== want) p.push('--cmd mangled the regex: ' + (got && got.flags.grep) + ' != ' + want);
  if (!c.payload || c.payload.outcome !== 'COMPLETED') p.push('--cmd run outcome ' + (c.payload && c.payload.outcome));
  check('12 0xC0000142 flagged environmental; --cmd keeps the regex intact through the shell', p, {});
}

/* 13 — a missing Playwright CLI fails fast (SPAWN_FAILED), every planned TC NOT_RUN with the reason; pure helpers behave. */
{
  const p = [];
  const sb = sandbox();
  const argv = [RUN_STAGE, '--run-file', sb.runFile, '--cwd', sb.root, '--log', sb.log, '--project', 'chromium', '--cli', 'does-not-exist.js', '--grace', '200', '--ceilings', CEILINGS, '--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE];
  const t0 = Date.now();
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 30000 });
  let pl = null; try { pl = JSON.parse(r.stdout); } catch { p.push('no JSON payload'); }
  if (pl && pl.outcome !== 'SPAWN_FAILED') p.push('outcome ' + pl.outcome);
  if (pl && !['TC-001', 'TC-002', 'TC-003', 'TC-010'].every((tc) => pl.notRun.some((n) => n.tc === tc))) p.push('planned TCs not all NOT_RUN');
  if (Date.now() - t0 > 15000) p.push('took ' + (Date.now() - t0) + ' ms — must fail fast');
  const strict = spawnSync(process.execPath, [...argv, '--strict'], { encoding: 'utf8', timeout: 30000 });
  if (strict.status !== 2) p.push('--strict exit ' + strict.status + ' != 2');
  if (tcIdsOf('[TC-01][TC-02] x').join() !== 'TC-01,TC-02' || tcIdsOf('[TC-01, TC-02b] x').join() !== 'TC-01,TC-02b' || tcIdsOf('[SETUP] x').length) p.push('tcIdsOf');
  if (aggregate(['PASS', 'SKIP']) !== 'INCOMPLETE' || aggregate(['PASS', 'FAIL']) !== 'FAIL' || aggregate(['PASS', 'PASS']) !== 'PASS' || aggregate([]) !== 'NOT_RUN') p.push('aggregate');
  const re = new RegExp(buildFilter({ stage: 'negative', group: 'serial:orders' }).grep);
  if (!re.test('x [TC-011] t @negative @run:serial-orders') || re.test('x [TC-012] t @negative @run:serial-orders-archive')) p.push('buildFilter tag-end guard');
  check('13 a missing Playwright CLI fails fast with every TC NOT_RUN; helpers', p, {});
}

for (const s of sandboxes) { try { fs.rmSync(s, { recursive: true, force: true }); } catch { /* a killed process may still hold a file on Windows */ } }
const out = {
  tool: 'selftest-run-stage',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'run-stage.mjs disagrees with its fixtures. Do not run stages through it unattended until this passes.' : 'Every stage path behaves as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
