#!/usr/bin/env node
// selftest-run-stage.mjs — regression harness for run-stage.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// Every case runs the REAL run-stage.mjs (and through it the real watchdog.mjs) against
// fixtures/run-stage/fake-playwright.mjs in a throw-away automation root under the OS temp folder:
// command shape, stage filters, freeze stops with a process-tree kill, the outer ceiling, the
// freshness gate, false-freeze guards, phase-wide stage messages, secret filtering, refusals, the
// isolation check (interference, false pass, rate limits, breaker), adaptive workers, serial-chain
// followers, burn-in, the re-run and the per-TC code fingerprint read back by impact.mjs select.
// A failing case means run-stage.mjs cannot be trusted to run a stage unattended.
//
// Run: node selftest-run-stage.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildFilter, tcIdsOf, aggregate, applyAdjustments, rateLimitsOf, cooldownFor, smokeGateOf, markFollowers, OUTPUT_KEEP } from './run-stage.mjs';

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
  if (pl && (pl.groups.filter((g) => g.command === 'normal').map((g) => g.name).join(',') !== 'parallel,serial:orders')) p.push('group order ' + pl.groups.map((g) => g.name));
  if (pl && !pl.groups.some((g) => g.command === 'isolation' && g.name === 'parallel' && g.workers === 1)) p.push('TC-003 failed beside another test but was not re-run alone');
  if (!/smoke-parallel\.ratelimit\.jsonl$/.test(e.PW_RATE_LIMIT_FILE || '') || !/rate-limit\.state\.json$/.test(e.PW_RATE_LIMIT_STATE || '') || e.PW_RATE_LIMITS !== '{}') p.push('rate-limit env wrong: ' + JSON.stringify(e));
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
  const fin = stage(sb, ['--stage', 'smoke', '--run', 'final', '--stage-tcs', SMOKE]);
  if (!fin.payload || fin.payload.outcome !== 'BLOCKED' || !/clean full re-run no longer exists/.test(fin.payload.reason)) p.push('--run final not refused with the re-run hint: ' + (fin.payload && fin.payload.reason));
  const noTcs = stage(sb, ['--stage', 'smoke', '--run', 'first']);
  if (!noTcs.payload || noTcs.payload.outcome !== 'BLOCKED') p.push('a stage without --stage-tcs ran');
  check('9 --reporter / --config / retries / a missing ceiling / no stage TCs / --run final are refused before spawning', p, {});
}

/* 10 — stage-based messages: setup → smoke → positive → negative (first run), phase-wide cumulative; a re-run reports its subset and the phase; attempts never reuse a file. */
{
  const p = [];
  const sb = sandbox();
  const setup = stage(sb, ['--stage', 'setup', '--run', 'first']).payload;
  const smoke = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]).payload;
  const pos = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE]).payload;
  const neg = stage(sb, ['--stage', 'negative', '--run', 'first', '--stage-tcs', NEGATIVE]).payload;
  const re = stage(sb, ['--stage', 'smoke', '--run', 'rerun', '--stage-tcs', SMOKE, '--tcs', 'TC-003']).payload;
  const has = (pl, rx, what) => { if (!pl || !rx.test(pl.update)) p.push(what + ' — got: ' + (pl && JSON.stringify(pl.update))); };
  has(setup, /^Setup journeys completed \(first run\): 1 passed, 0 failed/, 'setup message');
  has(smoke, /^Smoke tests completed \(first run\): 3 passed, 1 failed, 0 skipped, 0 not run — 4 TCs/, 'smoke counts');
  has(smoke, /\nFailed: TC-003\./, 'smoke failures');
  has(smoke, /\nIsolation check: 1 TC re-run alone: 0 passed alone, 1 failed again \(confirmed: TC-003\)\./, 'isolation line');
  has(smoke, /\nSetup journeys: 1 passed, 0 failed\./, 'setup line inside the smoke message');
  has(smoke, /\nSmoke gate: 25% failed \(limit 30%\) — Positive tests may continue\./, 'smoke gate line');
  has(pos, /^Positive tests completed \(first run\): 3 passed, 1 failed, 0 skipped, 0 not run — 4 TCs/, 'positive counts');
  has(pos, /unverified assumption: TC-005 — never an application bug/, 'unverified assumption named');
  has(pos, /\nPhase so far: Smoke 3 passed · 1 failed \| Positive 3 passed · 1 failed — combined 6 passed, 2 failed, 0 skipped, 0 not run of 8 TCs\./, 'cumulative after positive');
  has(neg, /\nPhase totals: Smoke 3 passed · 1 failed \| Positive 3 passed · 1 failed \| Negative 2 passed · 0 failed · 1 skipped — Passed 8 · Failed 2 · Skipped 1 · Not run 0 of 11 TCs\./, 'phase totals after negative');
  has(neg, /\nEvidence: screenshots\/US-1234-create-order\/phase-3\//, 'evidence folder');
  has(re, /^Smoke tests completed \(re-run\): 1 TC re-run → 0 passed, 1 failed, 0 skipped, 0 not run/, 're-run label and subset');
  has(re, /\nSmoke gate: 25% failed \(limit 30%\)/, 'phase-wide smoke gate in the re-run');
  if (re && re.counts.tcs !== 1) p.push('the re-run counted ' + (re && re.counts.tcs) + ' TCs, not its subset of 1');
  const reCmd = re && re.groups.find((g) => g.command === 'normal');
  if (!reCmd || !(reCmd.attempt > 2)) p.push('the re-run reused an attempt number: ' + JSON.stringify(re && re.groups));
  const a3 = reCmd && argvOf(sb, 'parallel', reCmd.attempt);
  if (!a3 || a3.env.PW_STAGE_ATTEMPT !== String(reCmd.attempt) || a3.flags.grep !== buildFilter({ stage: 'smoke', group: 'parallel', tcs: ['TC-003'] }).grep) p.push('re-run command shape wrong');
  const stagesDir = fs.readdirSync(path.join(sb.results, 'artifacts', 'stages'));
  if (new Set(stagesDir).size !== stagesDir.length || !stagesDir.includes('smoke-parallel-attempt2.json')) p.push('stage files ' + stagesDir.join(','));
  if (!fs.existsSync(path.join(sb.results, 'artifacts', 'progress', 'rerun-smoke-1.summary.json'))) p.push('no rerun-smoke-1 summary');
  const sb2 = sandbox();
  const hot = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--groups', 'parallel', '--tcs', 'TC-001,TC-003']).payload;
  has(hot, /\nSmoke gate: 50% failed \(limit 30%\) — classify every smoke failure before deciding/, 'gate above the limit asks for classification');
  if (hot && hot.smokeGate && hot.smokeGate.decision !== 'classify') p.push('smokeGate.decision ' + hot.smokeGate.decision);
  const rq = argvOf(sb2, 'parallel');
  if (!rq || rq.flags.grep !== buildFilter({ stage: 'smoke', group: 'parallel', tcs: ['TC-001', 'TC-003'] }).grep) p.push('--tcs filter not applied to the command');
  check('10 one phase-wide message per stage; the re-run reports its subset + the phase; attempts numbered', p, { smoke: smoke && smoke.update, rerun: re && re.update });
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
  const g = smokeGateOf({ tcs: 2, passed: 0, failed: 0, skipped: 0, incomplete: 1, notRun: 1, expectedFailures: 0 });
  if (g.failPct !== null || g.decision !== 'classify') p.push('smokeGateOf without a verdict must classify: ' + JSON.stringify(g));
  if (smokeGateOf({ tcs: 4, passed: 2, failed: 1, skipped: 0, incomplete: 1, notRun: 0, expectedFailures: 0 }).failPct !== 33.3) p.push('smokeGateOf must leave no-verdict TCs out of the denominator');
  if (cooldownFor([], 60000, 120000) !== 0 || cooldownFor([{ retry_after_s: 5 }, { retry_after_s: 2 }], 60000, 120000) !== 5000 || cooldownFor([{ retry_after_s: null }], 60000, 30000) !== 30000) p.push('cooldownFor');
  const plan = { groups: [{ name: 'parallel', tcs: ['TC-1', 'TC-2'], workers: 2 }], rate_limits: [{ service: 'login', match: 'POST /api/session', limit: 5, window_s: 60, pace: 4 }] };
  const adj = [{ kind: 'move', tc: 'TC-2', from: 'parallel', to: 'serial:isolated' }, { kind: 'workers', group: 'parallel', to: 1 }, { kind: 'rate-limit', service: 'login', to: { pace: 3 } }];
  const ap = applyAdjustments(plan, adj);
  if (ap.plan.groups[0].tcs.join() !== 'TC-1' || ap.plan.groups[0].workers !== 1 || !ap.plan.groups.some((x) => x.name === 'serial:isolated' && x.tcs.join() === 'TC-2' && x.workers === 1) || plan.groups[0].tcs.length !== 2) p.push('applyAdjustments ' + JSON.stringify(ap.plan));
  const rl = rateLimitsOf(plan, adj);
  if (!rl.login || rl.login.pace !== 3 || rl.login.limit !== 5) p.push('rateLimitsOf ' + JSON.stringify(rl));
  const fol = markFollowers([{ suite: 'f > chain', status: 'FAIL', tcs: ['TC-30'], annotations: [] }, { suite: 'f > chain', status: 'SKIP', tcs: ['TC-31'], annotations: [] }, { suite: 'f > chain', status: 'SKIP', tcs: ['TC-32'], annotations: ['skip'] }, { suite: 'f > other', status: 'SKIP', tcs: ['TC-33'], annotations: [] }]);
  if (fol[1].status !== 'NOT_RUN' || fol[1].follower !== 'TC-30' || fol[2].status !== 'SKIP' || fol[3].status !== 'SKIP') p.push('markFollowers ' + JSON.stringify(fol));
  check('13 a missing Playwright CLI fails fast with every TC NOT_RUN; helpers', p, {});
}

// a sandbox whose run plan is changed for one case (an extra parallel lane, a chain group, rate limits)
function customSandbox(mutate) {
  const sb = sandbox();
  const j = JSON.parse(fs.readFileSync(sb.runFile, 'utf8'));
  mutate(j);
  fs.writeFileSync(sb.runFile, JSON.stringify(j, null, 2));
  return sb;
}
const summaryFull = (sb, pl) => (pl ? summaryOf(sb, pl) : null);

/* 14 — ISOLATION: a TC that fails only beside other tests passes alone → PASS, parallel interference; the test that ran beside it is re-run alone (false-PASS guard); a real failure is confirmed alone. */
{
  const p = [];
  const sb = sandbox();
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'interference' }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome));
  else {
    if (s.tcs['TC-002'] !== 'PASS' || s.tcs['TC-003'] !== 'FAIL' || s.tcs['TC-001'] !== 'PASS') p.push('statuses ' + JSON.stringify(s.tcs));
    if (pl.isolation.passed_alone.join() !== 'TC-002' || pl.isolation.failed_alone.join() !== 'TC-003') p.push('isolation ' + JSON.stringify(pl.isolation));
    const e = pl.interference.find((x) => x.tc === 'TC-002');
    if (!e || e.kind !== 'failed-beside-passed-alone' || !e.overlapped.includes('TC-001')) p.push('interference record ' + JSON.stringify(pl.interference));
    if (!pl.isolation.overlap_rerun.includes('TC-001') || pl.isolation.overlap_failed_alone.length) p.push('overlap re-run ' + JSON.stringify(pl.isolation));
    if (pl.failures.some((f) => f.tcs.includes('TC-002'))) p.push('a TC that passed alone is still listed as failed');
    const iso = argvOf(sb, 'parallel', 2);
    if (!iso || iso.flags.workers !== '1' || iso.flags.grep !== buildFilter({ stage: 'smoke', group: 'parallel', tcs: ['TC-002', 'TC-003'] }).grep) p.push('the isolation command is not workers 1 on the two failed TCs: ' + JSON.stringify(iso && iso.flags));
    if (iso && iso.flags['repeat-each']) p.push('the isolation command inherited --repeat-each');
    if (!/\nIsolation check: 2 TCs re-run alone: 1 passed alone \(parallel interference: TC-002\), 1 failed again \(confirmed: TC-003\)\./.test(pl.update)) p.push('update: ' + pl.update);
    if (!/\nTests that ran beside them, re-run alone: TC-001 — all passed\./.test(pl.update)) p.push('no overlap line: ' + pl.update);
    if (!s.groups.some((g) => g.command === 'isolation') || !s.merged_stages.some((m) => m.command === 'isolation')) p.push('isolation commands missing from groups / merged_stages');
    if (pl.smokeGate.failPct !== 25) p.push('smoke gate after isolation ' + JSON.stringify(pl.smokeGate));
  }
  const sb2 = sandbox();
  const p2 = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'false-pass' }).payload;
  if (!p2 || summaryFull(sb2, p2).tcs['TC-001'] !== 'FAIL' || p2.isolation.overlap_failed_alone.join() !== 'TC-001') p.push('false-pass: TC-001 passed beside TC-002 but fails alone — must end FAIL: ' + JSON.stringify(p2 && p2.isolation));
  if (p2 && !/TC-001 failed alone \(the pass beside others was not a verdict\)/.test(p2.update)) p.push('false-pass update: ' + p2.update);
  check('14 isolation check: interference → PASS alone (+ overlap re-run), confirmed failure, false PASS caught', p, { isolation: pl && pl.isolation });
}

/* 15 — RATE LIMIT: a refusal inside the failing step → cool-down from Retry-After → alone, refused again → INCOMPLETE rate_limited (no verdict); refused only once → PASS alone. */
{
  const p = [];
  const sb = sandbox();
  const t0 = Date.now();
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--cooldown', '300', '--cooldown-max', '1500'], { parallel: 'rate-limit' }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome));
  else {
    if (s.tcs['TC-002'] !== 'INCOMPLETE' || !/^rate_limited: POST \/api\/session refused when run alone after a 1 s cool-down$/.test(s.reasons['TC-002'] || '')) p.push('TC-002 ' + s.tcs['TC-002'] + ' — ' + s.reasons['TC-002']);
    if (pl.isolation.rate_limited.join() !== 'TC-002' || pl.isolation.cooldown_ms !== 1000) p.push('isolation ' + JSON.stringify(pl.isolation));
    if (pl.rateLimit.refused < 2 || pl.rateLimit.services[0].match !== 'POST /api/session' || pl.rateLimit.services[0].retry_after_max_s !== 1) p.push('rateLimit ' + JSON.stringify(pl.rateLimit));
    if (pl.smokeGate.failPct !== 33.3 || pl.smokeGate.decision !== 'classify') p.push('the smoke gate must leave the rate-limited TC out: ' + JSON.stringify(pl.smokeGate));
    if (!/\nRate limit: POST \/api\/session refused \d+× \(Retry-After 1 s\)/.test(pl.update) || !/1 rate limited \(TC-002\)/.test(pl.update)) p.push('update: ' + pl.update);
    if (Date.now() - t0 < 1000) p.push('no cool-down happened');
    const iso = argvOf(sb, 'parallel', 2);
    if (!iso || !/smoke-parallel-attempt2\.ratelimit\.jsonl$/.test(iso.env.PW_RATE_LIMIT_FILE || '')) p.push('the isolation command has no own rate-limit file');
  }
  const sb2 = sandbox();
  const p2 = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--cooldown', '300', '--cooldown-max', '1500'], { parallel: 'rate-limit-once' }).payload;
  const s2 = summaryFull(sb2, p2);
  if (!p2 || s2.tcs['TC-002'] !== 'PASS' || !p2.isolation.passed_alone.includes('TC-002') || !(p2.interference.find((x) => x.tc === 'TC-002') || {}).refused_before) p.push('refused once: must pass alone with the refusal recorded: ' + JSON.stringify(p2 && p2.interference));
  check('15 rate limit: cool-down from Retry-After, refused alone → INCOMPLETE rate_limited, refused once → PASS alone', p, { rateLimit: pl && pl.rateLimit });
}

/* 16 — ADAPTIVE: refusals in one command → the next command starts after the cool-down with half the workers and a scaled ceiling; PW_RATE_LIMITS carries the plan's limits + adjustments; a 429 on a passing test never triggers isolation. */
{
  const p = [];
  const sb = customSandbox((j) => {
    j.run_plan.groups.splice(1, 0, { name: 'parallel-b', mode: 'parallel', workers: 2, tcs: ['TC-020', 'TC-021'] });
    j.run_plan.rate_limits = [{ service: 'login', match: 'POST /api/session', limit: 5, window_s: 60, pace: 4, scope: 'machine', at: 'start' }];
    j.run_plan_adjustments = [{ at: '2026-10-19T10:00:00Z', stage: 'smoke', kind: 'rate-limit', service: 'login', from: { pace: 4 }, to: { pace: 3 }, reason: 'learned', evidence: 'x' }];
  });
  const pl = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE + ',TC-020,TC-021', '--ceilings', CEILINGS + ',parallel-b=20000', '--cooldown', '300', '--cooldown-max', '1500'], { parallel: 'refused-ok' }).payload;
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome) + ' ' + (pl && pl.reason));
  else {
    const b = argvOf(sb, 'parallel-b', 1);
    if (!b || b.flags.workers !== '1' || b.env.PW_GLOBAL_TIMEOUT !== '40000') p.push('parallel-b not halved / ceiling not scaled: ' + JSON.stringify(b && { w: b.flags.workers, t: b.env.PW_GLOBAL_TIMEOUT }));
    const adj = pl.rateLimit.adjustments.find((x) => x.group === 'parallel-b');
    if (!adj || adj.workers_from !== 2 || adj.workers_to !== 1 || adj.cooldown_ms !== 1000) p.push('adjustment ' + JSON.stringify(pl.rateLimit.adjustments));
    if (pl.isolation.ran.includes('TC-004')) p.push('a passing test that saw a 429 was isolated');
    if (!pl.rateLimit.policies.some((x) => x.limit === 5)) p.push('the policy header was not reported');
    let lim = null; try { lim = JSON.parse(argvOf(sb, 'parallel', 1).env.PW_RATE_LIMITS); } catch { /* reported below */ }
    if (!lim || !lim.login || lim.login.pace !== 3 || lim.login.limit !== 5) p.push('PW_RATE_LIMITS ' + JSON.stringify(lim));
    if (!/\nRate limit: POST \/api\/session refused 1× \(Retry-After 1 s\) → cool-down 1 s, parallel-b workers 2 → 1\./.test(pl.update)) p.push('update: ' + pl.update);
  }
  check('16 refusals slow the rest of the stage (cool-down, workers halved, ceiling scaled); limits reach the tests', p, { rateLimit: pl && pl.rateLimit });
}

/* 17 — MASS-FAILURE BREAKER: everything failing beside other tests is not isolated one by one; it is flagged for classification. */
{
  const p = [];
  const sb = sandbox();
  const pl = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE], { parallel: 'mass-fail' }).payload;
  if (!pl || !pl.isolation.skipped || !/mass failure: 4 of 4 TCs that ran beside others failed/.test(pl.isolation.skipped)) p.push('breaker ' + JSON.stringify(pl && pl.isolation));
  if (argvOf(sb, 'parallel', 2)) p.push('an isolation command ran despite the breaker');
  if (pl && !pl.blockers.some((b) => /isolation check skipped/.test(b))) p.push('the breaker is not a blocker');
  if (pl && !/\nIsolation check skipped — mass failure/.test(pl.update)) p.push('update: ' + pl.update);
  check('17 a mass failure beside other tests trips the breaker instead of isolating every TC', p, {});
}

/* 18 — SERIAL CHAIN: a follower Playwright skipped after its predecessor failed is NOT_RUN "depends on", never SKIP; a genuine skip stays SKIP. */
{
  const p = [];
  const sb = customSandbox((j) => { j.run_plan.groups.push({ name: 'serial:chain', mode: 'serial', workers: 1, tcs: ['TC-030', 'TC-031'], reason: 'TC-031 approves the order TC-030 submits' }); });
  const pl = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', 'TC-030,TC-031', '--ceilings', CEILINGS + ',serial:chain=20000'], { 'serial-chain': 'chain' }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || s.tcs['TC-030'] !== 'FAIL' || s.tcs['TC-031'] !== 'NOT_RUN' || s.reasons['TC-031'] !== 'not started: depends on TC-030 (failed)') p.push('chain ' + JSON.stringify(s && { tcs: s.tcs, reasons: s.reasons }));
  if (pl && pl.isolation.ran.length) p.push('a workers-1 failure without a refusal was isolated');
  check('18 a serial-chain follower is NOT_RUN "depends on {TC} (failed)"', p, {});
}

/* 19 — BURN-IN in a re-run: healed TCs run alone with --repeat-each=3 and a ×3 ceiling; any failing repeat is FAIL; the other re-run TCs run once without them. */
{
  const p = [];
  const sb = sandbox();
  stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE]);
  const pl = stage(sb, ['--stage', 'positive', '--run', 'rerun', '--stage-tcs', POSITIVE, '--tcs', 'TC-004,TC-007', '--burn-in', 'TC-004'], { parallel: 'flaky-repeat' }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome));
  else {
    const burn = s.groups.find((g) => g.command === 'burn-in');
    const normal = s.groups.find((g) => g.command === 'normal');
    const bArgv = burn && argvOf(sb, 'parallel', burn.attempt);
    const nArgv = normal && argvOf(sb, 'parallel', normal.attempt);
    if (!bArgv || bArgv.flags['repeat-each'] !== '3' || bArgv.flags.workers !== '1' || bArgv.env.PW_GLOBAL_TIMEOUT !== '60000' || bArgv.flags.grep !== buildFilter({ stage: 'positive', group: 'parallel', tcs: ['TC-004'] }).grep) p.push('burn-in command ' + JSON.stringify(bArgv && { f: bArgv.flags, t: bArgv.env.PW_GLOBAL_TIMEOUT }));
    if (!nArgv || nArgv.flags.grep !== buildFilter({ stage: 'positive', group: 'parallel', tcs: ['TC-007'] }).grep || nArgv.flags['repeat-each']) p.push('normal re-run command ' + JSON.stringify(nArgv && nArgv.flags));
    if (s.tcs['TC-004'] !== 'FAIL' || s.tcs['TC-007'] !== 'PASS' || s.tcs['TC-008'] !== 'PASS') p.push('statuses ' + JSON.stringify(s.tcs));
    if (!/^Positive tests completed \(re-run\): 3 TCs re-run → 2 passed, 1 failed/.test(pl.update)) p.push('update: ' + pl.update);
    if (!/\nPhase so far: .*Positive 2 passed · 2 failed/.test(pl.update)) p.push('phase-wide positive counts: ' + pl.update);
  }
  check('19 burn-in: --repeat-each=3, workers 1, ceiling ×3, a failing repeat is FAIL; the rest of the re-run runs once', p, {});
}

/* 20 — PHASE-WIDE ORDER: a first-run smoke retry and a later re-run are ordered by start time, not by run name or sequence number. */
{
  const p = [];
  const sb = sandbox();
  stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]);
  stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--tcs', 'TC-003', '--label', 'smoke retry']);
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'rerun', '--stage-tcs', SMOKE, '--tcs', 'TC-003'], { parallel: 'all-pass' }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || s.cumulative.stages.smoke.failed !== 0 || s.cumulative.stages.smoke.passed !== 4) p.push('cumulative smoke ' + JSON.stringify(s && s.cumulative.stages.smoke));
  if (pl && !/\nSmoke gate: 0% failed \(limit 30%\) — Positive tests may continue\./.test(pl.update)) p.push('update: ' + (pl && pl.update));
  check('20 the phase-wide view takes the latest result by start time (first-smoke-2 never overrides rerun-smoke-1)', p, {});
}

/* 21 — CODE FINGERPRINT: every summary carries impact.mjs's per-TC fingerprint; after an edit to one test, impact.mjs select names only that TC stale. */
{
  const p = [];
  const sb = sandbox();
  const specFile = path.join(sb.root, SPEC);
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.mkdirSync(path.join(sb.root, 'pages'), { recursive: true });
  fs.writeFileSync(path.join(sb.root, 'pages', 'OrderPage.ts'), [
    "import type { Page } from '@playwright/test';",
    'export class OrderPage {',
    '  constructor(private readonly page: Page) {}',
    "  async open() { await this.page.goto('/orders'); }",
    "  async save() { await this.page.getByTestId('order-save-button').click(); }",
    '}', ''].join('\n'));
  fs.writeFileSync(specFile, [
    "import { test, expect } from '@playwright/test';",
    "import { OrderPage } from '../../pages/OrderPage';",
    "test.describe('REQ-01: create an order', () => {",
    "  test('[TC-001] Validate that an order is created', { tag: ['@positive', '@smoke', '@run:parallel'] }, async ({ page }) => { const o = new OrderPage(page); await o.open(); await o.save(); });",
    "  test('[TC-002] Validate that the order list opens', { tag: ['@positive', '@smoke', '@run:parallel'] }, async ({ page }) => { const o = new OrderPage(page); await o.open(); });",
    '});', ''].join('\n'));
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', 'TC-001,TC-002', '--groups', 'parallel']).payload;
  const s = summaryFull(sb, pl);
  const fp = s && s.code && s.code.tcs && s.code.tcs['TC-001'] && s.code.tcs['TC-001'].fingerprint;
  if (!s || !s.code || s.code.error) p.push('no code fingerprint in the summary: ' + JSON.stringify(s && s.code && s.code.error));
  else if (!/^[0-9a-f]{64}$/.test(fp || '')) p.push('TC-001 fingerprint ' + fp);
  if (s && s.code && s.code.changed_during_call.length) p.push('changed_during_call without an edit: ' + s.code.changed_during_call);
  fs.writeFileSync(path.join(sb.root, 'pages', 'OrderPage.ts'), fs.readFileSync(path.join(sb.root, 'pages', 'OrderPage.ts'), 'utf8').replace("'order-save-button'", "'order-submit-button'"));
  const sel = spawnSync(process.execPath, [path.join(here, 'impact.mjs'), 'select', '--root', sb.root, '--spec', SPEC, '--progress', path.join(sb.results, 'artifacts', 'progress')], { encoding: 'utf8' });
  let out = null; try { out = JSON.parse(sel.stdout); } catch { p.push('impact.mjs select gave no JSON: ' + sel.stdout.slice(0, 200) + sel.stderr.slice(0, 200)); }
  if (out) {
    const stale = (out.stale || []).map((x) => x.tc);
    const fresh2 = (out.fresh || []).includes('TC-002') || (out.fresh_by_member_only || []).includes('TC-002');
    if (!stale.includes('TC-001') || stale.includes('TC-002') || !fresh2) p.push('select after a selector edit in save(): stale ' + stale + ' fresh ' + out.fresh + ' by-member ' + out.fresh_by_member_only);
  }
  check('21 summaries carry the per-TC code fingerprint; impact.mjs select names only the TC the edit touched', p, {});
}

/* 22 — OUTPUT ISOLATION: Playwright wipes its outputDir before every command (the fake does too), so every command
   gets its own folder under test-output/phase-{N}/ — a later command (the next group, the isolation check, the next
   call) never deletes an earlier one's trace / failure screenshot; earlier phases and the old flat layout are pruned,
   a higher phase is kept, the current phase keeps its newest OUTPUT_KEEP; --extra last-failed still reads the
   previous command's .last-run.json. */
{
  const p = [];
  const sb = sandbox();
  const out = path.join(sb.results, 'artifacts', 'test-output');
  const mk = (rel, ageMs = 0) => {
    const d = path.join(out, rel);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'trace.zip'), 'x');
    if (ageMs) { const t = new Date(Date.now() - ageMs); fs.utimesSync(d, t, t); }
  };
  mk('phase-2/smoke-parallel'); mk('legacy-flat-test-folder'); mk('phase-4/smoke-parallel');
  fs.writeFileSync(path.join(out, '.last-run.json'), '{}');
  for (let i = 0; i < OUTPUT_KEEP + 3; i++) mk('phase-3/old-' + String(i).padStart(3, '0'), 3600_000 + i * 1000); // a higher i is older
  const failFiles = (dir) => { const d = path.join(out, 'phase-3', dir); return fs.existsSync(d) ? fs.readdirSync(d).filter((e) => fs.existsSync(path.join(d, e, 'test-failed-1.png')) && fs.existsSync(path.join(d, e, 'trace.zip'))) : []; };

  // smoke: parallel (TC-003 fails beside others) → serial:orders → parallel isolation (TC-003 alone, fails again)
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]).payload;
  const dirs = pl ? pl.groups.map((g) => g.outputDir) : [];
  const want = ['artifacts/test-output/phase-3/smoke-parallel', 'artifacts/test-output/phase-3/smoke-serial-orders', 'artifacts/test-output/phase-3/smoke-parallel-attempt2'];
  if (!pl || JSON.stringify(dirs) !== JSON.stringify(want)) p.push('per-command outputDir ' + JSON.stringify(dirs) + ' != ' + JSON.stringify(want));
  const a1 = argvOf(sb, 'parallel', 1);
  if (!a1 || !/test-output[\\/]phase-3[\\/]smoke-parallel$/.test(a1.env.PW_OUTPUT_DIR || '')) p.push('PW_OUTPUT_DIR of the first command ' + (a1 && a1.env.PW_OUTPUT_DIR));
  if (failFiles('smoke-parallel').length !== 1) p.push('the first command\'s trace + failure screenshot were deleted by a later command: ' + JSON.stringify(failFiles('smoke-parallel')));
  if (failFiles('smoke-parallel-attempt2').length !== 1) p.push('the isolation command kept no trace + failure screenshot of its own');
  for (const f of (pl && pl.failures) || []) if (!f.screenshot || !fs.existsSync(path.join(sb.results, f.screenshot))) p.push('failures[].screenshot does not exist on disk: ' + f.screenshot);
  if (fs.existsSync(path.join(out, 'phase-2')) || fs.existsSync(path.join(out, 'legacy-flat-test-folder')) || fs.existsSync(path.join(out, '.last-run.json'))) p.push('an earlier phase / the old flat layout was not pruned');
  if (!fs.existsSync(path.join(out, 'phase-4', 'smoke-parallel'))) p.push('a HIGHER phase was pruned');
  const old = (() => { try { return fs.readdirSync(path.join(out, 'phase-3')); } catch { return []; } })().filter((e) => e.startsWith('old-'));
  if (old.length !== OUTPUT_KEEP || old.includes('old-' + String(OUTPUT_KEEP + 2).padStart(3, '0')) || !old.includes('old-000')) p.push('cap: ' + old.length + ' old folders left, oldest kept ' + old.includes('old-' + String(OUTPUT_KEEP + 2).padStart(3, '0')));
  if (pl && !pl.warnings.some((w) => /^test-output: this phase holds more than/.test(w))) p.push('no warning when the cap removed folders of this phase');
  const s1 = summaryFull(sb, pl);
  if (!s1 || !(s1.output_pruned || []).includes('phase-2') || !(s1.output_pruned || []).includes('legacy-flat-test-folder')) p.push('summary output_pruned ' + JSON.stringify(s1 && s1.output_pruned));

  // --extra last-failed: the new (empty) folder is seeded with the newest .last-run.json of the phase — the isolation
  // command's, which failed TC-003 — so Playwright's --last-failed selects exactly that test
  const pl2 = stage(sb, ['--stage', 'smoke', '--run', 'rerun', '--stage-tcs', SMOKE, '--groups', 'parallel', '--extra', 'last-failed']).payload;
  const a3 = argvOf(sb, 'parallel', 3);
  const seen = a3 && a3.lastRun && a3.lastRun.failedTests;
  if (!seen || seen.length !== 1 || !/\[TC-003\]/.test(seen[0])) p.push('--last-failed did not see the previous command\'s .last-run.json: ' + JSON.stringify(a3 && a3.lastRun));
  const g3 = pl2 && summaryFull(sb, pl2).groups.find((g) => g.attempt === 3);
  if (!g3 || g3.lastRunFrom !== 'artifacts/test-output/phase-3/smoke-parallel-attempt2/.last-run.json') p.push('lastRunFrom ' + (g3 && g3.lastRunFrom));

  // a later call (the positive stage) leaves the smoke folders alone
  stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE]);
  if (failFiles('smoke-parallel').length !== 1 || failFiles('smoke-parallel-attempt2').length !== 1) p.push('a later call deleted the smoke stage\'s traces');
  check('22 one Playwright outputDir per command: earlier traces / failure screenshots survive later commands and calls; earlier phases + the flat layout pruned, higher phase kept, newest ' + OUTPUT_KEEP + ' kept; --last-failed seeded', p, { dirs, pruned: s1 && (s1.output_pruned || []).length });
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
