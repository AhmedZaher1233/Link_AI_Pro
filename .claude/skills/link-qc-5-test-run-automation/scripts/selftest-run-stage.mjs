#!/usr/bin/env node
// selftest-run-stage.mjs — regression harness for run-stage.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// Every case runs the REAL run-stage.mjs (and through it the real watchdog.mjs) against
// fixtures/run-stage/fake-playwright.mjs in a throw-away automation root under the OS temp folder:
// command shape, stage filters, freeze stops with a process-tree kill, the outer ceiling, the
// freshness gate, false-freeze guards, phase-wide stage messages, secret filtering, refusals, the
// isolation check (interference, false pass, rate limits, breaker), scoped vs environment-wide refusals,
// serial-chain followers, burn-in, the re-run, the per-TC code fingerprint read back by impact.mjs select, the
// observe-only telemetry (it never changes a status, a count or a command), the smoke gate's NO VERDICT,
// deferrals and the wait budget, admission timeouts, server deadlines never shortened, interference causes, the
// silence rule (shadow / active), the auto ceilings, the capacity ledger, the environment lease and dispatch.
// Cases 1-32 run with the capacity ledger OFF (QA_LEDGER=off) — which since 2.0 means EXCLUSIVE execution in a throw-away
// coordination directory (QA_CAPACITY_DIR, one per harness run); QA_LEDGER_SELFTEST=on runs the SAME cases with the ledger
// on (the ledger-enabled variant — run both before a commit). Either way cases 1-32 see fixed host readings
// (QA_CAPACITY_HOST_FIXTURE) and a fixed process table (QA_CAPACITY_PS_FIXTURE): no result depends on this machine's free
// memory or on what else runs here. Cases 33-38 use their own throw-away directories and the machine's real process
// listing (36: the rollback hard cap; 37: skill 9 beside skill 5; 38: a browser that outlives its command, a failed
// listing — the reservation stays held, never released on a guess). Every case that does not name a --scheduler runs the
// legacy groups scheduler (the run plan it was written for); 40 checks the default auto: serial without proof of independence.
// A failing case means run-stage.mjs cannot be trusted to run a stage unattended.
//
// Run: node selftest-run-stage.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { buildFilter, tcIdsOf, aggregate, applyAdjustments, rateLimitsOf, cooldownFor, smokeGateOf, markFollowers, OUTPUT_KEEP, descendantsOf, TELEMETRY_SCHEMA,
  classifyRecord, refusalScopes, parseTimeouts, silenceOf, ceilingFor, budgetsFrom, matchCovers, REASON } from './run-stage.mjs';

// the old cases describe the runner without the capacity ledger; the ledger cases switch it on explicitly
process.env.QA_LEDGER = process.env.QA_LEDGER_SELFTEST === 'on' ? 'on' : 'off';

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
// never the real ~/.link-ai-pro/capacity: every case without its own directory shares one throw-away coordination directory
const SHARED_CAP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-capacity-shared-'));
sandboxes.push(SHARED_CAP);
process.env.QA_CAPACITY_DIR = SHARED_CAP;
// fixed host readings (memory / CPU) and a fixed process table (this run-stage process only) for every case that does not
// ask for the real listing (REAL); a case may pass its own QA_CAPACITY_HOST_FIXTURE
const HOST_FIXTURE = JSON.stringify({ availableMb: 65536, totalMemMb: 131072, cpus: 16, cpuPct: 5 });
const FIXDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-stage-fixtures-'));
sandboxes.push(FIXDIR);
const PS_FIXTURE = path.join(FIXDIR, 'ps.json');
fs.writeFileSync(PS_FIXTURE, JSON.stringify([{ pid: 'SELF', ppid: 'PARENT', start: null, cmd: 'node run-stage.mjs (fixture table)' }]));
const REAL = { QA_CAPACITY_PS_FIXTURE: '' };
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
  // the hand-built run plan these cases were written for: the explicit legacy scheduler (the default auto would run
  // them SERIALLY — no readiness payload); the auto / dispatch cases pass their own --scheduler
  if (!args.includes('--scheduler')) argv.push('--scheduler', 'groups');
  const r = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 90000, env: { ...process.env, QA_CAPACITY_HOST_FIXTURE: HOST_FIXTURE, QA_CAPACITY_PS_FIXTURE: PS_FIXTURE, FAKE_PW_SCENARIO: JSON.stringify(scenario), ...extraEnv } });
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
    const wd = spawnSync(process.execPath, [WATCHDOG, '--plan', path.join(prog, 'smoke-parallel.plan.json'), '--heartbeat', path.join(prog, 'smoke-parallel.jsonl'),
      '--results', path.join(prog, 'smoke-parallel.results.jsonl'), '--grace', '200', '--stage', 'smoke', '--group', 'parallel', '--now', mine.decided_at, '--write', '--out', out], { encoding: 'utf8' });
    let direct = null; try { direct = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { p.push('direct watchdog.mjs --write produced nothing: exit ' + wd.status + ' ' + String(wd.stdout || '').slice(0, 400) + ' ' + String(wd.stderr || '').slice(0, 400)); }
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
  if (g.failPct !== null || g.decision !== 'no_verdict' || g.verdict !== 'NO VERDICT') p.push('smokeGateOf without a PASS or FAIL must be NO VERDICT: ' + JSON.stringify(g));
  if (smokeGateOf({ tcs: 4, passed: 2, failed: 1, skipped: 0, incomplete: 1, notRun: 0, expectedFailures: 0 }).failPct !== 33.3) p.push('smokeGateOf must leave no-verdict TCs out of the denominator');
  // B16a: SKIP and an expected failure are no smoke verdict either — 1 failed of 2 eligible = 50 %, not 25 %
  const g4 = smokeGateOf({ tcs: 4, passed: 1, failed: 1, skipped: 1, incomplete: 0, notRun: 0, expectedFailures: 1 });
  if (g4.failPct !== 50 || g4.eligible !== 2 || g4.decision !== 'classify' || g4.verdict !== 'ABOVE_LIMIT') p.push('smokeGateOf over PASS + FAIL only: ' + JSON.stringify(g4));
  if (cooldownFor([], 60000, 120000) !== 0 || cooldownFor([{ retry_after_s: 5 }, { retry_after_s: 2 }], 60000, 120000) !== 5000 || cooldownFor([{ retry_after_s: null }], 60000, 30000) !== 30000) p.push('cooldownFor');
  // a server deadline is never shortened or capped; a self-chosen backoff doubles per round up to the cap (the jitter bound)
  if (cooldownFor([{ retry_after_s: 500 }], 60000, 120000) !== 500000) p.push('cooldownFor capped a Retry-After: ' + cooldownFor([{ retry_after_s: 500 }], 60000, 120000));
  if (cooldownFor([{ retry_after_s: null }], 1000, 30000, 2) !== 4000 || cooldownFor([{ retry_after_s: null }], 1000, 3000, 5) !== 3000) p.push('cooldownFor backoff bound');
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

/* 16 — SCOPED REFUSALS: one service refused in one command → its scope (service:login) cools down — published to the
   admission file, and without the project's admission helper the runner waits before the next command — but the next
   command keeps its workers and ceiling (no stage-wide halving); PW_RATE_LIMITS carries the plan's limits + adjustments;
   a 429 on a passing test never triggers isolation. */
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
    if (!b || b.flags.workers !== '2' || b.env.PW_GLOBAL_TIMEOUT !== '20000') p.push('a scoped refusal changed the next command\'s workers / ceiling: ' + JSON.stringify(b && { w: b.flags.workers, t: b.env.PW_GLOBAL_TIMEOUT }));
    const adj = pl.rateLimit.adjustments.find((x) => x.group === 'parallel-b');
    if (!adj || adj.workers_from !== 2 || adj.workers_to !== 2 || adj.cooldown_ms !== 1000 || adj.scope !== 'service:login') p.push('adjustment ' + JSON.stringify(pl.rateLimit.adjustments));
    if (!(pl.rateLimit.scopes || []).some((s) => s.scope === 'service:login' && s.count === 1)) p.push('scopes ' + JSON.stringify(pl.rateLimit.scopes));
    if (pl.isolation.ran.includes('TC-004')) p.push('a passing test that saw a 429 was isolated');
    if (!pl.rateLimit.policies.some((x) => x.limit === 5)) p.push('the policy header was not reported');
    let lim = null; try { lim = JSON.parse(argvOf(sb, 'parallel', 1).env.PW_RATE_LIMITS); } catch { /* reported below */ }
    if (!lim || !lim.login || lim.login.pace !== 3 || lim.login.limit !== 5) p.push('PW_RATE_LIMITS ' + JSON.stringify(lim));
    let scopes = null; try { scopes = JSON.parse(argvOf(sb, 'parallel', 1).env.PW_UNIT_SCOPES); } catch { /* reported below */ }
    if (!scopes || JSON.stringify(scopes['TC-004']) !== JSON.stringify(['service:login'])) p.push('PW_UNIT_SCOPES ' + JSON.stringify(scopes));
    if (!/\nRate limit: POST \/api\/session refused 1× \(Retry-After 1 s\) → service:login cool-down 1 s before parallel-b \(scoped: workers unchanged\)\./.test(pl.update)) p.push('update: ' + pl.update);
    let adm = null; try { adm = JSON.parse(fs.readFileSync(path.join(sb.results, 'artifacts', 'progress', 'admission.json'), 'utf8')); } catch { p.push('no admission file'); }
    if (adm && (adm.schema !== 'skill5-admission/1' || adm.state !== 'open' || !(adm.seq >= 2))) p.push('admission file ' + JSON.stringify(adm));
  }
  check('16 a scoped refusal cools down only its scope (admission file; runner waits without the helper); workers and ceiling unchanged', p, { rateLimit: pl && pl.rateLimit });
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

/* 23 — TELEMETRY is observe-only: the summary carries host memory / CPU, the event-loop lag and the running command's
   process tree (count, working set) per command; with --no-telemetry the same stage gives the same statuses, counts and
   Playwright command lines, and the summary says so. The tree walk is cycle-safe and ignores unrelated processes. */
{
  const p = [];
  const MB = 1024 * 1024;
  const rows = [{ pid: 10, ppid: 1, rssBytes: 100 * MB }, { pid: 11, ppid: 10, rssBytes: 200 * MB }, { pid: 12, ppid: 11, rssBytes: 300 * MB },
    { pid: 13, ppid: 99, rssBytes: 999 * MB }, { pid: 14, ppid: 14, rssBytes: 1 }];
  const d = descendantsOf(rows, [10]);
  if (d.count !== 3 || d.rssBytes !== 600 * MB) p.push('descendantsOf(10) = ' + JSON.stringify(d) + ' — want 3 processes, 600 MB');
  if (descendantsOf(rows, [14]).count !== 1) p.push('a self-parented process must not loop or count twice');
  if (descendantsOf(rows, [77]).count !== 0) p.push('a root missing from the table has no tree');

  const sb = sandbox();
  const table = path.join(sb.root, 'ps-fixture.json');
  fs.writeFileSync(table, JSON.stringify([{ pid: 'ROOT', ppid: 1, rssBytes: 100 * MB }, { pid: 900001, ppid: 'ROOT', rssBytes: 200 * MB },
    { pid: 900002, ppid: 900001, rssBytes: 300 * MB }, { pid: 900003, ppid: 4242, rssBytes: 999 * MB }]));
  const on = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--telemetry', '--telemetry-interval', '50', '--tree-interval', '50'], {}, { QA_TELEMETRY_PS_FIXTURE: table });
  const sOn = summaryFull(sb, on.payload);
  const t = sOn && sOn.telemetry;
  if (!t) p.push('no telemetry in the summary');
  else {
    if (t.schema !== TELEMETRY_SCHEMA || t.observeOnly !== true) p.push('telemetry schema / observeOnly ' + JSON.stringify([t.schema, t.observeOnly]));
    if (!(t.samples >= 1) || !(t.memory.availableMinMb > 0) || !(t.memory.availableAtStartMb > 0) || !(t.host.totalMemMb > 0) || !(t.host.cpus >= 1)) p.push('host samples missing: ' + JSON.stringify({ samples: t.samples, memory: t.memory, host: t.host }));
    if (t.cpu.peakPct !== null && !(t.cpu.peakPct >= 0 && t.cpu.peakPct <= 100)) p.push('cpu peak out of range ' + t.cpu.peakPct);
    if (!(t.tree.samples >= 1) || t.tree.peakProcesses !== 3 || t.tree.peakRssMb !== 600) p.push('process tree ' + JSON.stringify(t.tree) + ' — want 3 processes / 600 MB from the fixture table');
    const cmds = (t.commands || []).map((c) => c.group + ':' + c.command).sort().join(',');
    if (!/parallel:normal/.test(cmds) || !/serial:orders:normal/.test(cmds)) p.push('per-command telemetry misses a command: ' + cmds);
    if ((t.commands || []).some((c) => c.peakProcesses !== null && c.peakProcesses !== 3)) p.push('per-command tree peak ' + JSON.stringify(t.commands));
  }
  const parOn = argvOf(sb, 'parallel');
  const sb2 = sandbox();
  const off = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--no-telemetry']);
  const sOff = summaryFull(sb2, off.payload);
  const parOff = argvOf(sb2, 'parallel');
  if (!sOff || JSON.stringify(sOff.telemetry) !== JSON.stringify({ disabled: true, observeOnly: true })) p.push('--no-telemetry summary telemetry ' + JSON.stringify(sOff && sOff.telemetry));
  if (!on.payload || !off.payload || JSON.stringify(on.payload.counts) !== JSON.stringify(off.payload.counts) || on.payload.outcome !== off.payload.outcome) p.push('telemetry changed the outcome / counts: ' + JSON.stringify([on.payload && on.payload.counts, off.payload && off.payload.counts]));
  if (!sOn || !sOff || JSON.stringify(sOn.tcs) !== JSON.stringify(sOff.tcs)) p.push('telemetry changed a status: ' + JSON.stringify([sOn && sOn.tcs, sOff && sOff.tcs]));
  const shape = (a) => a && { flags: a.flags, specs: a.specs, envKeys: Object.keys(a.env).sort(), workers: a.env.PW_WORKERS, ceiling: a.env.PW_GLOBAL_TIMEOUT };
  if (JSON.stringify(shape(parOn)) !== JSON.stringify(shape(parOff))) p.push('telemetry changed the Playwright command: ' + JSON.stringify([shape(parOn), shape(parOff)]));
  check('23 telemetry is observe-only: host + process-tree samples per command; --no-telemetry gives identical statuses, counts and commands', p, { telemetry: t && { samples: t.samples, tree: t.tree, commands: (t.commands || []).length } });
}

/* 24 — SMOKE NO VERDICT (B16a): every smoke TC skipped → no PASS / FAIL → NO VERDICT; positive is refused before anything spawns. */
{
  const p = [];
  const sb = sandbox();
  const sm = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'no-verdict', 'serial-orders': 'no-verdict' }).payload;
  if (!sm || !sm.smokeGate || sm.smokeGate.decision !== 'no_verdict' || sm.smokeGate.verdict !== 'NO VERDICT') p.push('smoke gate ' + JSON.stringify(sm && sm.smokeGate));
  if (sm && !/\nSmoke gate: NO VERDICT — no smoke TC produced a PASS or FAIL; positive and negative do not start/.test(sm.update)) p.push('update: ' + (sm && sm.update));
  const pos = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE]);
  if (!pos.payload || pos.payload.outcome !== 'BLOCKED' || !/smoke gate NO VERDICT/.test(pos.payload.reason)) p.push('positive after NO VERDICT: ' + (pos.payload && pos.payload.outcome + ' ' + pos.payload.reason));
  if (fs.existsSync(path.join(sb.results, 'artifacts', 'stages', 'positive-parallel.json'))) p.push('the positive stage spawned Playwright after NO VERDICT');
  check('24 smoke NO VERDICT: no PASS / FAIL → positive and negative refused', p, { gate: sm && sm.smokeGate });
}

/* 25 — DEFERRAL: a test the helper deferred before any side effect is NOT_RUN "deferred until", never SKIP or rate_limited;
   due inside the stage window it is re-queued alone after the deadline and gets its verdict; an hour away it stays deferred. */
{
  const p = [];
  const sb = sandbox();
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'deferred' }, { FAKE_DEFER_MS: '1500' }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome));
  else {
    if (s.tcs['TC-002'] !== 'PASS') p.push('the deferred TC was not re-queued to a verdict: ' + s.tcs['TC-002'] + ' — ' + s.reasons['TC-002']);
    if (!s.deferred.some((d) => d.tc === 'TC-002' && /^\d{4}-\d\d-\d\dT/.test(d.until || ''))) p.push('deferred[] ' + JSON.stringify(s.deferred));
    const rq = s.groups.find((g) => g.command === 'normal' && g.tcs.join() === 'TC-002' && g.workers === 1);
    if (!rq || !(rq.attempt >= 2)) p.push('no alone re-queue command for TC-002: ' + JSON.stringify(s.groups.map((g) => [g.name, g.command, g.attempt, g.tcs])));
    if (pl.isolation.rate_limited.length) p.push('a deferral became rate_limited');
  }
  const sb2 = sandbox();
  const far = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'deferred-far' }).payload;
  const s2 = summaryFull(sb2, far);
  if (!s2 || s2.tcs['TC-002'] !== 'NOT_RUN' || !/^not started: deferred until \d{4}-/.test(s2.reasons['TC-002'] || '')) p.push('deferred-far: ' + JSON.stringify(s2 && [s2.tcs['TC-002'], s2.reasons['TC-002']]));
  if (far && !/\nDeferred: TC-002 until /.test(far.update)) p.push('update has no Deferred line: ' + (far && far.update));
  check('25 deferral → NOT_RUN "deferred until"; re-queued alone when due inside the stage window', p, {});
}

/* 26 — WAIT BUDGET: a mid-step RateLimitWaitError "wait budget exhausted (server deadline …)" is INCOMPLETE "interrupted: …",
   never FAIL, never isolated, never rate_limited by itself. */
{
  const p = [];
  const sb = sandbox();
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'wait-budget' }).payload;
  const s = summaryFull(sb, pl);
  if (!s || s.tcs['TC-002'] !== 'INCOMPLETE' || s.reasons['TC-002'] !== REASON.waitBudget('2026-01-01T00:00:00.000Z')) p.push('TC-002 ' + JSON.stringify(s && [s.tcs['TC-002'], s.reasons['TC-002']]));
  if (pl && (pl.isolation.ran.includes('TC-002') || pl.isolation.rate_limited.includes('TC-002'))) p.push('a wait-budget INCOMPLETE was isolated / rate_limited: ' + JSON.stringify(pl.isolation));
  if (pl && pl.failures.some((f) => f.tcs.includes('TC-002'))) p.push('TC-002 listed as a failure');
  check('26 wait budget exhausted → INCOMPLETE "interrupted: wait budget exhausted (server deadline …)"', p, {});
}

/* 27 — ADMISSION TIMEOUT: a test the admission fixture skipped is NOT_RUN "not started: admission timeout (…)", counted, a blocker. */
{
  const p = [];
  const sb = sandbox();
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'admission-timeout' }).payload;
  const s = summaryFull(sb, pl);
  if (!s || s.tcs['TC-002'] !== 'NOT_RUN' || s.reasons['TC-002'] !== REASON.admissionTimeout('host pressure')) p.push('TC-002 ' + JSON.stringify(s && [s.tcs['TC-002'], s.reasons['TC-002']]));
  if (!s || !(s.admission.timeouts || []).includes('TC-002')) p.push('admission.timeouts ' + JSON.stringify(s && s.admission));
  if (pl && !pl.blockers.some((b) => /not started by admission \(TC-002\)/.test(b))) p.push('no admission blocker: ' + JSON.stringify(pl && pl.blockers));
  // the watchdog reads admission-wait / deferred heartbeats as information, never as malformed records
  if (pl && pl.flags.watchdogUnreadable) p.push('an admission-wait heartbeat made the watchdog unreadable');
  // a WORKER that was not admitted throws AdmissionRefusedError (its worker fixtures / beforeAll never run): the test is
  // NOT_RUN admission timeout — never a FAIL, never isolated, never a bug — and a serial follower Playwright then skipped
  // is NOT_RUN for the same reason (not "depends on … (failed)")
  const sb2 = sandbox();
  const pl2 = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: 'worker-refused' }).payload;
  const s2 = summaryFull(sb2, pl2);
  const why = REASON.admissionTimeout('host pressure (memory)');
  if (!s2 || s2.tcs['TC-002'] !== 'NOT_RUN' || s2.reasons['TC-002'] !== why) p.push('worker refused: TC-002 ' + JSON.stringify(s2 && [s2.tcs['TC-002'], s2.reasons['TC-002']]));
  if (pl2 && (pl2.isolation.ran.includes('TC-002') || (pl2.failures || []).some((f) => f.tcs.includes('TC-002')))) p.push('a refused worker became a failure / was isolated: ' + JSON.stringify([pl2.isolation, pl2.failures]));
  const sb3 = customSandbox((j) => { j.run_plan.groups.push({ name: 'serial:chain', mode: 'serial', workers: 1, tcs: ['TC-030', 'TC-031'], reason: 'TC-031 approves the order TC-030 submits' }); });
  const pl3 = stage(sb3, ['--stage', 'positive', '--run', 'first', '--stage-tcs', 'TC-030,TC-031', '--ceilings', CEILINGS + ',serial:chain=20000'], { 'serial-chain': 'worker-refused' }).payload;
  const s3 = summaryFull(sb3, pl3);
  if (!s3 || s3.tcs['TC-030'] !== 'NOT_RUN' || s3.tcs['TC-031'] !== 'NOT_RUN' || s3.reasons['TC-030'] !== why || s3.reasons['TC-031'] !== why) p.push('worker refused in a chain: ' + JSON.stringify(s3 && [s3.tcs, s3.reasons]));
  check('27 admission timeout → NOT_RUN "not started: admission timeout (…)" + blocker; the heartbeat stays readable; a refused worker (AdmissionRefusedError) and its serial followers → NOT_RUN, never FAIL', p, {});
}

/* 28 — SERVER DEADLINE NEVER SHORTENED: Retry-After 2 s with --cooldown-max 500 → the isolation waits 2 s (not 0.5 s);
   with --max-wait 1000 the refused TC is deferred instead — not isolated, not rate_limited. */
{
  const p = [];
  const sb = sandbox();
  const t0 = Date.now();
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--cooldown', '300', '--cooldown-max', '500'], { parallel: 'rate-limit' }, { FAKE_RETRY_AFTER: '2' }).payload;
  if (!pl || pl.isolation.cooldown_ms !== 2000) p.push('isolation cool-down ' + (pl && pl.isolation.cooldown_ms) + ' — the server\'s 2 s were shortened');
  if (Date.now() - t0 < 2000) p.push('the stage waited less than the Retry-After');
  if (pl && !pl.isolation.rate_limited.includes('TC-002')) p.push('refused alone after the deadline must still be rate_limited: ' + JSON.stringify(pl.isolation));
  const sb2 = sandbox();
  const d = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--max-wait', '1000'], { parallel: 'rate-limit' }, { FAKE_RETRY_AFTER: '5' }).payload;
  const s2 = summaryFull(sb2, d);
  if (!s2 || s2.tcs['TC-002'] !== 'NOT_RUN' || !/^not started: deferred until /.test(s2.reasons['TC-002'] || '')) p.push('beyond --max-wait: ' + JSON.stringify(s2 && [s2.tcs['TC-002'], s2.reasons['TC-002']]));
  if (d && (d.isolation.rate_limited.includes('TC-002') || !d.isolation.deferred.includes('TC-002'))) p.push('deferred isolation ' + JSON.stringify(d && d.isolation));
  if (d && !d.isolation.failed_alone.includes('TC-003')) p.push('the TC without a refusal must still be isolated at once: ' + JSON.stringify(d && d.isolation));
  check('28 Retry-After never shortened (uncapped wait); beyond --max-wait → deferred, never rate_limited', p, {});
}

/* 29 — ENVIRONMENT-WIDE refusals (two configured services refused) → the rest of the stage cools down with half the
   workers and a scaled ceiling — the only case in which workers drop. */
{
  const p = [];
  const sb = customSandbox((j) => {
    j.run_plan.groups.splice(1, 0, { name: 'parallel-b', mode: 'parallel', workers: 2, tcs: ['TC-020', 'TC-021'] });
    j.run_plan.rate_limits = [{ service: 'login', match: 'POST /api/session', limit: 5, window_s: 60, pace: 4, scope: 'machine', at: 'start' },
      { service: 'report', match: 'GET /api/report', limit: 10, window_s: 60, pace: 9, scope: 'machine', at: 'step', calls_per_tc: { default: 0, 'TC-004': 1 } }];
  });
  const pl = stage(sb, ['--stage', 'positive', '--run', 'first', '--stage-tcs', POSITIVE + ',TC-020,TC-021', '--ceilings', CEILINGS + ',parallel-b=20000', '--cooldown', '300', '--cooldown-max', '1500'], { parallel: 'env-refusal' }).payload;
  const b = argvOf(sb, 'parallel-b', 1);
  if (!b || b.flags.workers !== '1' || b.env.PW_GLOBAL_TIMEOUT !== '40000') p.push('parallel-b not halved / ceiling not scaled: ' + JSON.stringify(b && { w: b.flags.workers, t: b.env.PW_GLOBAL_TIMEOUT }));
  const adj = pl && pl.rateLimit.adjustments.find((x) => x.group === 'parallel-b');
  if (!adj || adj.scope !== 'environment' || adj.workers_to !== 1 || adj.cooldown_ms !== 1000) p.push('adjustment ' + JSON.stringify(pl && pl.rateLimit.adjustments));
  if (pl && !pl.proposals.some((x) => x.kind === 'workers' && x.group === 'parallel-b' && x.to === 1)) p.push('no workers proposal: ' + JSON.stringify(pl && pl.proposals));
  const rs = refusalScopes([{ match: 'POST /api/session', tcs: ['TC-1'], notBefore: null }, { match: 'GET /api/report', tcs: ['TC-1'], notBefore: null }], { login: { match: 'POST /api/session' }, report: { match: 'GET /api/report' } });
  if (!rs.environmentWide) p.push('two configured services refused must be environment-wide: ' + JSON.stringify(rs));
  const one = refusalScopes([{ match: 'POST /api/session', tcs: ['TC-1'], account: 'A1', notBefore: null }], { login: { match: '/api/session', scope: 'account' } });
  if (one.environmentWide || one.scopes[0].scope !== 'account:A1') p.push('an account-scoped limit must stay account-scoped: ' + JSON.stringify(one));
  if (!matchCovers('/api/session', 'POST /api/session') || matchCovers('GET /api/session', 'POST /api/session') || !matchCovers('post /api/session', 'POST /api/session')) p.push('matchCovers');
  check('29 environment-wide refusals halve the workers of the rest of the stage; scoped ones never do', p, {});
}

/* 30 — INTERFERENCE CAUSES (B23) from evidence only: an HTTP 500 in the parallel attempt → possible_product_concurrency_defect;
   a 503 + Retry-After without rate-limit headers → environment (temporary unavailability, never throttling); nothing → unexplained.
   The status of record stays the alone result (PASS); the classifier helpers behave. */
{
  const p = [];
  const causeOf = (scenario) => {
    const sb = sandbox();
    const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], { parallel: scenario }).payload;
    const e = pl && pl.interference.find((x) => x.tc === 'TC-002' && x.kind === 'failed-beside-passed-alone');
    return { pl, e, s: summaryFull(sb, pl) };
  };
  const a = causeOf('interference-5xx');
  if (!a.e || a.e.cause !== 'possible_product_concurrency_defect' || !a.e.cause_evidence.some((x) => /HTTP 500 POST \/api\/orders\/\{id\}\/lines/.test(x))) p.push('5xx: ' + JSON.stringify(a.e));
  if (!a.s || a.s.tcs['TC-002'] !== 'PASS') p.push('the status of record must stay the alone PASS');
  if (a.pl && !/\nInterference causes: TC-002 possible_product_concurrency_defect — unresolved until classified/.test(a.pl.update)) p.push('update: ' + (a.pl && a.pl.update));
  const u = causeOf('unavailable');
  if (!u.e || u.e.cause !== 'environment' || !u.e.cause_evidence.some((x) => /503 \+ Retry-After GET \/api\/orders/.test(x))) p.push('unavailable: ' + JSON.stringify(u.e));
  if (u.pl && (u.pl.isolation.rate_limited.length || u.pl.rateLimit.refused !== 0 || !(u.pl.rateLimit.unavailable >= 1))) p.push('503 + Retry-After treated as throttling: ' + JSON.stringify(u.pl && u.pl.rateLimit));
  const n = causeOf('interference');
  if (!n.e || n.e.cause !== 'unexplained') p.push('no evidence must be unexplained: ' + JSON.stringify(n.e));
  if (classifyRecord({ status: 429 }) !== 'throttling' || classifyRecord({ kind: 'refused', status: 503, retry_after_s: 5 }) !== 'unavailable'
    || classifyRecord({ kind: 'refused', status: 503, remaining: 0, limit: 5 }) !== 'throttling' || classifyRecord({ kind: 'refused', status: 403 }) !== null
    || classifyRecord({ kind: 'server-error', status: 500 }) !== 'server-error' || classifyRecord({ kind: 'policy', limit: 5 }) !== 'policy') p.push('classifyRecord');
  check('30 interference causes from evidence: 5xx → possible product defect, 503 → environment, none → unexplained', p, {});
}

/* 31 — SMART TIMEOUTS: a long step silent past --silence + grace is recorded in timeouts_shadow.would_stop (shadow — never
   stopped); with --timeouts-mode active the same step is stopped as FROZEN by the silence rule. */
{
  const p = [];
  const sb = sandbox();
  const sh = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--silence', '300', '--timeouts-mode', 'shadow'], { parallel: 'quiet-long' }).payload;
  const s = summaryFull(sb, sh);
  if (!sh || sh.outcome !== 'COMPLETED' || sh.groups.some((g) => g.stop)) p.push('shadow mode stopped something: ' + JSON.stringify(sh && sh.groups));
  if (!s || !s.timeouts_shadow.would_stop.some((w) => w.tc === 'TC-001' && w.step === 'perform the steps' && w.silence_ms === 300)) p.push('would_stop ' + JSON.stringify(s && s.timeouts_shadow));
  if (s && s.timeouts_shadow.mode !== 'shadow') p.push('mode ' + s.timeouts_shadow.mode);
  const sb2 = sandbox();
  // active is the DEFAULT now: no --timeouts-mode flag
  const ac = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--silence', '300'], { parallel: 'quiet-long' }).payload;
  const s2 = summaryFull(sb2, ac);
  if (!ac || ac.outcome !== 'STOPPED_FROZEN') p.push('active mode outcome ' + (ac && ac.outcome));
  if (s2 && !s2.groups.some((g) => g.stop && g.stop.rule === 'silence')) p.push('the stop is not recorded as the silence rule: ' + JSON.stringify(s2.groups.map((g) => g.stop)));
  if (s2 && !s2.watchdog_events.some((e) => e.rule === 'silence')) p.push('watchdog event without the silence rule');
  // min(3 × max, 55 s) but never below the slowest single operation; nothing known → the 55 s default
  if (silenceOf({ action: 15000, navigation: 30000, expect: 10000 }) !== 55000 || silenceOf({ action: 15000, navigation: 30000, expect: 10000, stallSilence: 45000 }) !== 45000 || silenceOf({ action: 15000, navigation: 10000, expect: 5000 }) !== 45000 || silenceOf({}) !== 55000 || silenceOf(null) !== 55000) p.push('silenceOf');
  check('31 the silence rule: active (the default) stops as FROZEN (rule silence); --timeouts-mode shadow only records "would have frozen"', p, {});
}

/* 32 — AUTO CEILINGS (A10): --ceilings auto with timeouts.ts → (Σ budgets ÷ workers + hook + teardown) × 1.2 + pacing floor,
   per group; the computed values are in proposals[]. */
{
  const p = [];
  const sb = sandbox();
  fs.writeFileSync(path.join(sb.root, 'timeouts.ts'), ['export const TIMEOUTS = {', '  test: { default: 90_000, long: 180_000 },', '  expect: 10_000,', '  action: 15_000,', '  navigation: 30_000,', '  hook: 60_000,', '  step: { default: 30_000, long: 120_000 },', '  watchdog_grace: 60_000,', '} as const;', ''].join('\n'));
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--ceilings', 'auto', '--timeouts', 'timeouts.ts']).payload;
  const par = argvOf(sb, 'parallel');
  const ser = argvOf(sb, 'serial-orders');
  // parallel: 3 × 90 000 ÷ 2 = 135 000 + 60 000 + 90 000 = 285 000 × 1.2 = 342 000; serial: 90 000 + 60 000 + 90 000 = 240 000 × 1.2 = 288 000
  if (!par || par.env.PW_GLOBAL_TIMEOUT !== '342000') p.push('parallel ceiling ' + (par && par.env.PW_GLOBAL_TIMEOUT));
  if (!ser || ser.env.PW_GLOBAL_TIMEOUT !== '288000') p.push('serial ceiling ' + (ser && ser.env.PW_GLOBAL_TIMEOUT));
  const pr = pl && pl.proposals.find((x) => x.kind === 'ceilings');
  if (!pr || pr.computed.parallel !== 342000 || pr.computed['serial:orders'] !== 288000) p.push('proposal ' + JSON.stringify(pr));
  const t = parseTimeouts(fs.readFileSync(path.join(here, '..', 'assets', 'timeouts.template.ts'), 'utf8'));
  if (t.testDefault !== 90000 || t.testLong !== 180000 || t.action !== 15000 || t.navigation !== 30000 || t.hook !== 60000 || t.stallSilence !== 55000 || t.watchdogGrace !== 60000 || t.admissionMaxWait !== 600000) p.push('parseTimeouts(template) ' + JSON.stringify(t));
  const rl = { login: { limit: 5, window_s: 60, pace: 4, calls_per_tc: { default: 1 } } };
  if (ceilingFor({ tcs: ['TC-1', 'TC-2'], workers: 2, t: { testDefault: 90000, testLong: 180000, hook: 60000 }, budgets: { 'TC-2': 180000 }, rateLimits: rl }) !== 402000) p.push('ceilingFor with a long test and a pacing floor');
  const bud = budgetsFrom(["test('[TC-1] a', async () => { await x(); });\ntest('[TC-2] b', async () => { test.setTimeout(TIMEOUTS.test.long); });"], { testDefault: 90000, testLong: 180000 });
  if (bud['TC-1'] !== 90000 || bud['TC-2'] !== 180000) p.push('budgetsFrom ' + JSON.stringify(bud));
  const noT = stage(sandbox(), ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--ceilings', 'auto']).payload;
  if (!noT || noT.outcome !== 'BLOCKED' || !/needs the project's timeouts\.ts/.test(noT.reason)) p.push('--ceilings auto without timeouts.ts must be BLOCKED: ' + (noT && noT.reason));
  check('32 auto ceilings from timeouts.ts (the documented arithmetic) + proposals; no timeouts.ts → BLOCKED', p, { proposal: pr });
}

/* 33 — CAPACITY LEDGER (real process listing, throw-away coordination directory, fixed host readings): every command reserves
   its workers under the ceiling and releases them when a table shows its tree gone; scarce host memory lowers a 2-worker
   group to 1 with a record (never raised); a ledger another run holds full → nothing starts, NOT_RUN "admission timeout"
   after --max-wait. */
let capacityMod = null;
try { capacityMod = await import(pathToFileURL(path.join(here, 'capacity.mjs')).href); } catch { capacityMod = null; }
const capDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-capacity-')); sandboxes.push(d); fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ machineMaxWorkers: 2 })); return d; };
{
  const p = [];
  if (!capacityMod) p.push('capacity.mjs could not be imported');
  else {
    const dir = capDir();
    const sb = sandbox();
    const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir, ...REAL }).payload;
    const s = summaryFull(sb, pl);
    if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome) + ' ' + (pl && pl.reason));
    if (!s || !s.ledger.enabled || s.ledger.ceiling !== 2) p.push('ledger record ' + JSON.stringify(s && s.ledger));
    if (s && s.ledger.reservations.some((r) => !r.token || r.released !== true || r.confirmed !== 'table')) p.push('a reservation was not released on a table: ' + JSON.stringify(s.ledger.reservations));
    const led = capacityMod.readLedger(dir);
    if ((led.entries || []).length) p.push('entries left in the ledger: ' + JSON.stringify(led.entries));
    // ample (fixed) host memory: 2 workers under ceiling 2, nothing lowered
    const par = argvOf(sb, 'parallel');
    if (!par || par.flags.workers !== '2' || (s && s.ledger.lowered.length)) p.push('parallel workers ' + (par && par.flags.workers) + ' lowered ' + JSON.stringify(s && s.ledger.lowered) + ' — want 2, nothing lowered');
    // scarce (fixed) host memory: 6000 MB available, reserve 4096 MB (25 % of 16 GB), 1536 MB per headed worker → room for
    // exactly one worker: the 2-worker group runs ×1 and the lowering is recorded
    const sbS = sandbox();
    const scarce = stage(sbS, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: capDir(), ...REAL, QA_CAPACITY_HOST_FIXTURE: JSON.stringify({ availableMb: 6000, totalMemMb: 16384, cpus: 16, cpuPct: 5 }) }).payload;
    const sS = summaryFull(sbS, scarce);
    const parS = argvOf(sbS, 'parallel');
    if (!parS || parS.flags.workers !== '1' || !sS || !sS.ledger.lowered.some((l) => l.group === 'parallel' && l.from === 2 && l.to === 1 && /host capacity/.test(l.by))) p.push('scarce memory: workers ' + (parS && parS.flags.workers) + ' lowered ' + JSON.stringify(sS && sS.ledger.lowered));
    // another run holds both slots (its owner — this harness — is alive): nothing may start
    const dir2 = capDir();
    const held = await capacityMod.reserve({ dir: dir2, cls: 'playwright', units: 2, limit: 2, owner: { runId: 'another-run', runFile: 'other/.runs/phase-1.json' }, waitMs: 0 });
    if (!held || !held.ok) p.push('could not pre-fill the ledger: ' + JSON.stringify(held));
    const sb2 = sandbox();
    const t0 = Date.now();
    const full = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--max-wait', '1500'], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir2, ...REAL }).payload;
    const s2 = summaryFull(sb2, full);
    if (!s2 || !['TC-001', 'TC-002', 'TC-003', 'TC-010'].every((tc) => s2.tcs[tc] === 'NOT_RUN' && /^not started: (admission timeout|host pressure)/.test(s2.reasons[tc] || ''))) p.push('full ledger: ' + JSON.stringify(s2 && { tcs: s2.tcs, reasons: s2.reasons }));
    if (fs.existsSync(path.join(sb2.results, 'artifacts', 'fake-argv'))) p.push('Playwright was spawned over a full ledger');
    if (Date.now() - t0 > 60000) p.push('the bounded wait took ' + (Date.now() - t0) + ' ms');
    if (held && held.ok) { try { await capacityMod.release({ dir: dir2, token: held.token, rows: (await capacityMod.processSnapshot({})).rows || [] }); } catch { /* the temp dir is removed anyway */ } }
  }
  check('33 capacity ledger: reserve → run → confirmed release (nothing left); scarce memory lowers 2 → 1 with a record; a full ledger → NOT_RUN admission timeout, nothing spawned', p, {});
}

/* 34 — ENVIRONMENT LEASE: --env-id with no lease held by this run → nothing starts; every TC NOT_RUN "environment lease". */
{
  const p = [];
  if (!capacityMod) p.push('capacity.mjs could not be imported');
  else {
    const sb = sandbox();
    const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--env-id', 'deadbeefdeadbeef'], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: capDir(), ...REAL }).payload;
    const s = summaryFull(sb, pl);
    if (!pl || pl.outcome !== 'BLOCKED' || !/environment lease/.test(pl.reason || '')) p.push('outcome ' + (pl && pl.outcome + ' ' + pl.reason));
    if (!s || !['TC-001', 'TC-002', 'TC-003', 'TC-010'].every((tc) => /^not started: environment lease \(/.test(s.reasons[tc] || ''))) p.push('reasons ' + JSON.stringify(s && s.reasons));
    if (fs.existsSync(path.join(sb.results, 'artifacts', 'fake-argv'))) p.push('Playwright was spawned without the lease');
    let lim = null; try { lim = JSON.parse(fs.readFileSync(path.join(sb.results, 'artifacts', 'progress', 'admission.json'), 'utf8')); } catch { /* reported below */ }
    if (!lim || lim.state !== 'open') p.push('the admission file must end open: ' + JSON.stringify(lim));
  }
  check('34 environment lease not held → nothing starts, NOT_RUN "environment lease (…)"', p, {});
}

/* 35 — DISPATCH (explicit --scheduler dispatch, needs the ledger): the conflict-free pool as a 2-worker batch, restricted units as their own
   children, the conflicting unit never beside its conflict; without the ledger dispatch is refused. */
{
  const p = [];
  const sb = sandbox();
  const units = {
    schema: 'skill5-parallel-plan/1', mode: 'shadow', pool: ['u1', 'u2'],
    units: [
      { id: 'u1', type: 'U1', stages: ['smoke'], spec: SPEC, tcs: ['TC-001'], claims: [{ key: 'rec:order', mode: 'write', source: 'field', evidence: 'x' }], class: 'parallel-ready', selector: { specs: [SPEC], describe: null, tcs: ['TC-001'] }, scopes: [], reasons: [] },
      { id: 'u2', type: 'U1', stages: ['smoke'], spec: SPEC, tcs: ['TC-002'], claims: [{ key: 'list:orders', mode: 'read', source: 'field', evidence: 'x' }], class: 'parallel-ready', selector: { specs: [SPEC], describe: null, tcs: ['TC-002'] }, scopes: [], reasons: [] },
      { id: 'u3', type: 'U1', stages: ['smoke'], spec: SPEC, tcs: ['TC-003'], claims: [{ key: 'rec:order', mode: 'exclusive', source: 'fail-safe', evidence: 'x' }], class: 'restricted', selector: { specs: [SPEC], describe: null, tcs: ['TC-003'] }, scopes: [], reasons: ['conflicts with u1'] },
      { id: 'u4', type: 'U2', stages: ['smoke'], spec: SPEC, tcs: ['TC-010'], claims: [{ key: 'rec:line-items', mode: 'write', source: 'field', evidence: 'x' }], class: 'ordered', selector: { specs: [SPEC], describe: 'serial:orders', tcs: ['TC-010'] }, scopes: [], reasons: [] },
    ],
    conflicts: [{ a: 'u1', b: 'u3', keys: ['rec:order'], kind: 'resource' }],
  };
  const unitsFile = path.join(sb.root, 'parallel-plan.json');
  fs.writeFileSync(unitsFile, JSON.stringify(units, null, 2));
  const off = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--scheduler', 'dispatch', '--units', unitsFile, '--ceilings', 'default=20000'], {}, { QA_LEDGER: 'off' }).payload;
  if (!off || off.outcome !== 'BLOCKED' || !/dispatch needs the capacity ledger/.test(off.reason || '')) p.push('dispatch without the ledger must be refused: ' + (off && off.reason));
  if (capacityMod) {
    const sb2 = sandbox();
    const uf = path.join(sb2.root, 'parallel-plan.json');
    fs.writeFileSync(uf, JSON.stringify(units, null, 2));
    const pl = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--scheduler', 'dispatch', '--units', uf, '--ceilings', 'default=20000'], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: capDir(), ...REAL }).payload;
    const s = summaryFull(sb2, pl);
    if (!pl || pl.outcome !== 'COMPLETED') p.push('dispatch outcome ' + (pl && pl.outcome + ' ' + pl.reason));
    else {
      if (s.tcs['TC-001'] !== 'PASS' || s.tcs['TC-002'] !== 'PASS' || s.tcs['TC-003'] !== 'FAIL' || s.tcs['TC-010'] !== 'PASS') p.push('statuses ' + JSON.stringify(s.tcs));
      // the pool runs in BATCHES (pool-b1, pool-b2 …); two pool TCs fit one batch of max(4 × workers, 8)
      const pool = argvOf(sb2, 'pool-b1');
      if (!pool || pool.flags.workers !== '2' || pool.flags.grep !== buildFilterFor('smoke', ['TC-001', 'TC-002'])) p.push('pool command ' + JSON.stringify(pool && pool.flags));
      const tl = s.dispatch.timeline;
      const at = (u) => tl.find((x) => x.unit === u);
      if (!at('pool') || !at('u3') || !at('u4')) p.push('timeline ' + JSON.stringify(tl));
      else if (Date.parse(at('u3').start) < Date.parse(at('pool').start)) p.push('u3 started before the pool');
      // u3 (workers 1) is re-run alone exactly when its command overlapped another one (u4 may run beside it) — its own
      // worker count never decides; alone it fails again (FAIL of record)
      if (at('u3')) {
        const sp = (u) => [Date.parse(at(u).start), Date.parse(at(u).end)];
        const beside = ['pool', 'u4'].some((u) => at(u) && sp(u)[0] < sp('u3')[1] && sp('u3')[0] < sp(u)[1]);
        if (beside !== pl.isolation.ran.includes('TC-003')) p.push('TC-003 isolation ' + pl.isolation.ran.includes('TC-003') + ' but its command ran beside another: ' + beside);
        if (beside && !pl.isolation.failed_alone.includes('TC-003')) p.push('TC-003 not failed alone: ' + JSON.stringify(pl.isolation));
      }
      // one ramp sample per batch, timed by the batch's wall span; a short stage closes no 60 s window (validated stays null)
      const rr = s.dispatch.rampRecords || [];
      if (rr.length !== 1 || rr[0].batch !== 1 || !(rr[0].wallMs >= 0) || rr[0].workers !== 2) p.push('ramp records ' + JSON.stringify(rr));
      if (s.dispatch.validatedWorkers !== null && !(s.dispatch.validatedWorkers >= 1 && s.dispatch.validatedWorkers <= 2)) p.push('validatedWorkers ' + s.dispatch.validatedWorkers);
      // the 2-worker pool batch consumes ONE reservation of 2 slots (its tests are admitted inside it, never reserved again);
      // each restricted unit reserves its own 1; the reserved slots never exceed the ceiling at any moment of the timeline
      const res = s.ledger.reservations.filter((r) => r.token); // the granted ones (a refused attempt is listed without a token)
      const isPool = (r) => /^pool-b\d+$/.test(r.group);
      const poolRes = res.filter(isPool);
      if (poolRes.length !== 1 || poolRes[0].units !== 2) p.push('pool reservations ' + JSON.stringify(poolRes));
      // three commands of the schedule, plus one slot per isolation command (u3 alone when it ran beside u4)
      const isoCmds = pl.groups.filter((g) => g.command === 'isolation').length;
      if (res.length !== 3 + isoCmds || res.some((r) => !isPool(r) && r.units !== 1) || res.some((r) => r.released !== true)) p.push('reservations ' + JSON.stringify(res.map((r) => ({ group: r.group, units: r.units, released: r.released }))));
      if (tl && at('pool') && at('u3') && at('u4')) {
        const units = { pool: 2, u3: 1, u4: 1 };
        const span = (u) => [Date.parse(at(u).start), Date.parse(at(u).end)];
        for (const t of [...new Set(tl.map((x) => Date.parse(x.start)))]) {
          const busy = Object.keys(units).filter((u) => { const sp = span(u); return sp[0] <= t && t < sp[1]; }).reduce((n, u) => n + units[u], 0);
          if (busy > 2) { p.push('more than the ceiling reserved at ' + new Date(t).toISOString() + ': ' + busy); break; }
        }
      }
    }
  }
  check('35 dispatch: pool ×2 + restricted units, never two conflicting units; refused without the ledger', p, {});
}

/* 36 — ROLLBACK HARD CAP: QA_LEDGER=off never launches uncoordinated. (a) every command runs under an EXCLUSIVE, PID-judged
   reservation, released afterwards, and the machine ceiling lowers --workers (config 1 → the 2-worker group runs ×1);
   (b) another run's live reservation keeps an exclusive stage from starting — NOT_RUN "admission timeout (exclusive
   execution …)", nothing spawned; (c) another run's exclusive command keeps a LEDGER-mode stage from starting;
   (d) an unreadable ledger → BLOCKED "no safe coordination", nothing spawned. */
{
  const p = [];
  if (!capacityMod) p.push('capacity.mjs could not be imported');
  else {
    const ALL = ['TC-001', 'TC-002', 'TC-003', 'TC-010'];
    const dir = capDir();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ machineMaxWorkers: 1 }));
    const sb = sandbox();
    const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], {}, { QA_LEDGER: 'off', QA_CAPACITY_DIR: dir, ...REAL }).payload;
    const s = summaryFull(sb, pl);
    if (!pl || pl.outcome !== 'COMPLETED') p.push('(a) outcome ' + (pl && pl.outcome + ' ' + pl.reason));
    if (!s || s.ledger.mode !== 'exclusive' || s.ledger.ceiling !== 1 || !s.ledger.exclusive || s.ledger.exclusive.reason !== 'QA_LEDGER=off') p.push('(a) ledger record ' + JSON.stringify(s && s.ledger));
    if (s && (!s.ledger.reservations.length || s.ledger.reservations.some((r) => !r.exclusive || !r.token || r.released !== true))) p.push('(a) reservations ' + JSON.stringify(s.ledger.reservations));
    if ((capacityMod.readLedger(dir).entries || []).length) p.push('(a) entries left in the ledger: ' + JSON.stringify(capacityMod.readLedger(dir).entries));
    const par = argvOf(sb, 'parallel');
    if (!par || par.flags.workers !== '1') p.push('(a) hard cap: the parallel group ran with --workers=' + (par && par.flags.workers) + ' over a ceiling of 1');
    if (s && !s.ledger.lowered.some((l) => l.group === 'parallel' && l.from === 2 && l.to === 1)) p.push('(a) the lowering is not recorded: ' + JSON.stringify(s.ledger.lowered));
    if (!pl || !(pl.warnings || []).some((w) => /EXCLUSIVE execution/.test(w))) p.push('(a) no exclusive-execution warning');
    if (!pl || !pl.ledger || pl.ledger.mode !== 'exclusive') p.push('(a) compact payload ledger.mode ' + JSON.stringify(pl && pl.ledger));
    // (b)
    const dir2 = capDir();
    const held = await capacityMod.reserve({ dir: dir2, cls: 'playwright', units: 1, limit: 2, liveness: 'pid', owner: { runId: 'another-run', runFile: 'other/.runs/phase-1.json' } });
    const sb2 = sandbox();
    const b2 = stage(sb2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--max-wait', '1500'], {}, { QA_LEDGER: 'off', QA_CAPACITY_DIR: dir2, ...REAL }).payload;
    const s2 = summaryFull(sb2, b2);
    if (!held.ok) p.push('(b) could not pre-fill the ledger: ' + JSON.stringify(held));
    if (!s2 || !ALL.every((tc) => s2.tcs[tc] === 'NOT_RUN' && /^not started: admission timeout \(exclusive execution/.test(s2.reasons[tc] || ''))) p.push('(b) ' + JSON.stringify(s2 && { tcs: s2.tcs, reasons: s2.reasons }));
    if (fs.existsSync(path.join(sb2.results, 'artifacts', 'fake-argv'))) p.push('(b) Playwright was spawned beside another run\'s command');
    if (held.ok) await capacityMod.release({ dir: dir2, token: held.token, rows: null });
    // (c)
    const dir3 = capDir();
    const ex = await capacityMod.reserve({ dir: dir3, cls: 'playwright', units: 1, limit: 2, exclusive: true, liveness: 'pid', owner: { runId: 'rollback-run', runFile: 'other/.runs/phase-1.json' } });
    const sb3 = sandbox();
    const b3 = stage(sb3, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--max-wait', '1500'], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir3, ...REAL }).payload;
    const s3 = summaryFull(sb3, b3);
    if (!ex.ok) p.push('(c) could not take the exclusive reservation: ' + JSON.stringify(ex));
    if (!s3 || !ALL.every((tc) => s3.tcs[tc] === 'NOT_RUN' && /^not started: (admission timeout|host pressure)/.test(s3.reasons[tc] || ''))) p.push('(c) ' + JSON.stringify(s3 && { tcs: s3.tcs, reasons: s3.reasons }));
    if (fs.existsSync(path.join(sb3.results, 'artifacts', 'fake-argv'))) p.push('(c) a ledger-mode command started beside an exclusive one');
    if (ex.ok) await capacityMod.release({ dir: dir3, token: ex.token, rows: null });
    // (d)
    const dir4 = capDir();
    fs.writeFileSync(path.join(dir4, 'ledger.json'), '{ not json');
    const sb4 = sandbox();
    const b4 = stage(sb4, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], {}, { QA_LEDGER: 'off', QA_CAPACITY_DIR: dir4, ...REAL }).payload;
    if (!b4 || b4.outcome !== 'BLOCKED' || !/^no safe coordination/.test(b4.reason || '')) p.push('(d) ' + JSON.stringify(b4 && { outcome: b4.outcome, reason: b4.reason }));
    if (fs.existsSync(path.join(sb4.results, 'artifacts', 'fake-argv'))) p.push('(d) Playwright was spawned without coordination');
  }
  check('36 rollback hard cap: QA_LEDGER=off → exclusive execution under the ceiling; other runs block it both ways; an unusable ledger starts nothing', p, {});
}

/* 37 — SKILL 9 beside SKILL 5, on skill 9's call shape (`--run rerun --tcs … --label "retest — skill 9"`): without --env-id
   it still runs (the older shape — a warning, never a refusal); with skill 9's OWN lease for this run file (another run id)
   it runs; while skill 5's run of another story holds the environment it is BLOCKED and nothing starts; a playwright-cli
   session hold of skill 9 that fills the ceiling keeps a skill 5 stage from starting until it is released. */
{
  const p = [];
  if (!capacityMod) p.push('capacity.mjs could not be imported');
  else {
    const ENV = 'e9e9e9e9e9e9e9e9';
    const RETEST = ['--stage', 'smoke', '--run', 'rerun', '--stage-tcs', SMOKE, '--tcs', 'TC-001', '--label', 'retest — skill 9'];
    const sb = sandbox();
    stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]);
    const old = stage(sb, RETEST).payload;
    if (!old || old.outcome !== 'COMPLETED' || !(old.warnings || []).some((w) => /no --env-id/.test(w))) p.push('the older skill 9 shape: ' + JSON.stringify(old && { outcome: old.outcome, reason: old.reason }));
    const dir = capDir();
    // an earlier run leased the same application under ANOTHER id and left a book: skill 9's commands pace against it
    const EARLIER = 'e8e8e8e8e8e8e8e8';
    await capacityMod.acquireLease({ dir, envId: EARLIER, members: ['app.example.com', 'api.example.com'], runId: 'R-earlier', runFile: 'C:/other/.runs/phase-1.json', owner: { pid: process.pid, start: null } });
    await capacityMod.releaseLease({ dir, envId: EARLIER, runId: 'R-earlier' });
    const own = await capacityMod.acquireLease({ dir, envId: ENV, members: ['app.example.com'], runId: 'skill9-retest-1', runFile: sb.runFile.replace(/\\/g, '/'), owner: { pid: process.pid, start: null } });
    const ok9 = stage(sb, [...RETEST, '--env-id', ENV], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir, ...REAL }).payload;
    const s9 = summaryFull(sb, ok9);
    if (!own.ok || !ok9 || ok9.outcome !== 'COMPLETED' || !s9 || s9.lease.valid !== true) p.push('skill 9\'s own lease for the run file: ' + JSON.stringify({ own: own.ok, outcome: ok9 && ok9.outcome, reason: ok9 && ok9.reason, lease: s9 && s9.lease }));
    const argvDir = path.join(sb.results, 'artifacts', 'fake-argv');
    const leased = (fs.existsSync(argvDir) ? fs.readdirSync(argvDir) : []).map((f) => JSON.parse(fs.readFileSync(path.join(argvDir, f), 'utf8'))).filter((x) => x.env && x.env.PW_ENV_ID === ENV);
    if (own.bookId !== EARLIER || !s9 || s9.lease.bookId !== EARLIER || !leased.length || leased.some((x) => !String(x.env.PW_RATE_LIMIT_STATE || '').replace(/\\/g, '/').endsWith('/rate-limits/' + EARLIER + '.json')))
      p.push('the overlapping identity did not share the earlier book: ' + JSON.stringify({ book: own.bookId, lease: s9 && s9.lease, state: leased.map((x) => x.env.PW_RATE_LIMIT_STATE) }));
    if (s9 && s9.tcs['TC-001'] !== 'PASS') p.push('retest TC-001 ' + s9.tcs['TC-001']);
    const dir2 = capDir();
    await capacityMod.acquireLease({ dir: dir2, envId: ENV, members: ['app.example.com'], runId: 'R5-other-story', runFile: 'C:/other/reports/US-2/.runs/phase-1.json', owner: { pid: process.pid, start: null } });
    const sbB = sandbox();
    const bl = stage(sbB, [...RETEST, '--env-id', ENV], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir2, ...REAL }).payload;
    const sB = summaryFull(sbB, bl);
    if (!bl || bl.outcome !== 'BLOCKED' || !/environment lease/.test(bl.reason || '')) p.push('skill 5 holds the environment: ' + JSON.stringify(bl && { outcome: bl.outcome, reason: bl.reason }));
    if (!sB || !/^not started: environment lease \(the environment is leased by run R5-other-story/.test(sB.reasons['TC-001'] || '')) p.push('reason ' + JSON.stringify(sB && sB.reasons));
    if (fs.existsSync(path.join(sbB.results, 'artifacts', 'fake-argv'))) p.push('the retest started while skill 5 held the environment');
    const dir3 = capDir();
    const hold = await capacityMod.acquireHold({ dir: dir3, runId: 'skill9-retest-2', owner: { pid: process.pid, start: null }, units: 2, label: 'playwright-cli session' });
    const sbH = sandbox();
    const h1 = stage(sbH, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--max-wait', '1500'], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir3, ...REAL }).payload;
    const sH = summaryFull(sbH, h1);
    if (!hold.ok) p.push('could not take the session hold: ' + JSON.stringify(hold));
    if (!sH || !['TC-001', 'TC-002', 'TC-003', 'TC-010'].every((tc) => sH.tcs[tc] === 'NOT_RUN' && /^not started: (admission timeout|host pressure)/.test(sH.reasons[tc] || ''))) p.push('beside a full session hold: ' + JSON.stringify(sH && { tcs: sH.tcs, reasons: sH.reasons }));
    if (fs.existsSync(path.join(sbH.results, 'artifacts', 'fake-argv'))) p.push('a skill 5 command started beside skill 9\'s browsers over the ceiling');
    await capacityMod.releaseHold({ dir: dir3, runId: 'skill9-retest-2' });
    const sbH2 = sandbox();
    const h2 = stage(sbH2, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE], {}, { QA_LEDGER: 'on', QA_CAPACITY_DIR: dir3, ...REAL }).payload;
    if (!h2 || h2.outcome !== 'COMPLETED') p.push('after the hold was released: ' + JSON.stringify(h2 && { outcome: h2.outcome, reason: h2.reason }));
  }
  check('37 skill 9 beside skill 5: the older call shape runs; its own lease for the run file runs; skill 5\'s lease blocks it; its session hold counts against the ceiling', p, {});
}

/* 38 — FALLBACK OWNERSHIP (QA_LEDGER=off, the real process listing). (a) A "browser" that outlives its command — detached,
   with a Playwright profile marker — keeps the exclusive reservation held: it is the run's (a child of the recorded
   command), so run-stage terminates it and only then releases; an unrelated process with a look-alike marker, started
   before the run, is never touched. (b) The process listing fails (an unreadable table): the finished command cannot be
   confirmed stopped, its slots stay held, the stage's next command is NOT_RUN "admission timeout (… could not be confirmed
   stopped …)" and nothing is launched beside it; `capacity.mjs release --token … --force` (user-run) frees it. */
{
  const p = [];
  if (!capacityMod) p.push('capacity.mjs could not be imported');
  else {
    const dir = capDir();
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-decoy-'));
    sandboxes.push(decoyDir);
    const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', '--', '--user-data-dir=' + path.join(decoyDir, 'playwright_chromiumdev_profile-decoy')], { detached: true, stdio: 'ignore', windowsHide: true });
    decoy.unref();
    const sb = sandbox();
    const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--groups', 'parallel'], { parallel: 'orphan-browser' }, { QA_LEDGER: 'off', QA_CAPACITY_DIR: dir, ...REAL, FAKE_ORPHAN_DIR: sb.root }).payload;
    const s = summaryFull(sb, pl);
    // every command of the stage (the first run and the isolation re-run of its failure) leaves its own orphan
    let orphans = [];
    try { orphans = fs.readFileSync(path.join(sb.results, 'artifacts', 'fake-orphan.pid'), 'utf8').split(/\s+/).filter(Boolean).map(Number); } catch { /* reported below */ }
    const recs = s ? s.ledger.reservations.filter((r) => r.token) : [];
    if (!pl || pl.outcome !== 'COMPLETED') p.push('(a) outcome ' + (pl && pl.outcome + ' ' + pl.reason));
    if (!orphans.length || orphans.length !== recs.length) p.push('(a) orphans ' + JSON.stringify(orphans) + ' for ' + recs.length + ' command(s)');
    for (const o of orphans) if (alive(o)) { p.push('(a) the run\'s orphaned browser ' + o + ' is still alive after the stage'); try { process.kill(o); } catch { /* gone */ } }
    // each reservation was held until ITS browser was stopped (the table showed it alive at release), then released on a table
    if (recs.some((r) => r.released !== true || r.confirmed !== 'table' || (r.killed || []).length !== 1 || !orphans.includes(r.killed[0]))) p.push('(a) a reservation was not held until its browser was stopped: ' + JSON.stringify(recs));
    if (!alive(decoy.pid)) p.push('(a) an unrelated process with a look-alike profile marker was terminated');
    try { process.kill(decoy.pid); } catch { /* gone */ }
    if ((capacityMod.readLedger(dir).entries || []).length) p.push('(a) entries left in the ledger: ' + JSON.stringify(capacityMod.readLedger(dir).entries));
    // (b) no process table at all
    const dirB = capDir();
    const sbB = sandbox();
    const plB = stage(sbB, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--max-wait', '1500'], {}, { QA_LEDGER: 'off', QA_CAPACITY_DIR: dirB, QA_CAPACITY_PS_FIXTURE: path.join(FIXDIR, 'no-such-table.json') }).payload;
    const sB = summaryFull(sbB, plB);
    const first = sB && sB.ledger.reservations.find((r) => r.token);
    if (!first || first.released !== false || first.confirmed !== 'none') p.push('(b) the first command was released without a table: ' + JSON.stringify(sB && sB.ledger.reservations));
    const notRun = sB ? Object.keys(sB.tcs).filter((tc) => sB.tcs[tc] === 'NOT_RUN') : [];
    if (!notRun.length || !notRun.every((tc) => /^not started: admission timeout \(exclusive execution: .*could not be confirmed stopped/.test(sB.reasons[tc] || ''))) p.push('(b) the next command: ' + JSON.stringify(sB && { tcs: sB.tcs, reasons: sB.reasons }));
    const argvFiles = (() => { try { return fs.readdirSync(path.join(sbB.results, 'artifacts', 'fake-argv')); } catch { return []; } })();
    if (argvFiles.length !== 1) p.push('(b) commands launched: ' + JSON.stringify(argvFiles) + ' — want only the first');
    const held = (capacityMod.readLedger(dirB).entries || []).filter((e) => e.confirm === 'table');
    if (held.length !== 1 || held[0].state !== 'releasing') p.push('(b) ledger ' + JSON.stringify(capacityMod.readLedger(dirB).entries));
    if (held.length) {
      const f = spawnSync(process.execPath, [path.join(here, 'capacity.mjs'), 'release', '--token', held[0].token, '--force', '--capacity-dir', dirB], { encoding: 'utf8' });
      let o = null;
      try { o = JSON.parse(f.stdout); } catch { /* reported below */ }
      if (!o || o.ok !== true || o.forced !== true || (capacityMod.readLedger(dirB).entries || []).length) p.push('(b) release --force: ' + (f.stdout || f.stderr));
    }
  }
  check('38 fallback ownership: a browser that outlives its command holds the reservation until it is stopped (an unrelated look-alike untouched); no process table → held, the next command waits, --force frees it', p, {});
}

/* 39 — DISPATCH ISOLATION ACROSS COMMANDS (the ledger, the real process listing): two single-worker unit children run side
   by side; TC-002 fails only beside the OTHER command → re-run alone (passes: interference, never a FAIL of record), and
   TC-001, which passed in the other command during TC-002's run, is re-checked alone too (the false-PASS guard crosses
   command boundaries). A command's own workers 1 never exempts it from the isolation check. */
if (capacityMod) {
  const p = [];
  const sb = sandbox();
  const unit = (id, tc) => ({ id, type: 'U1', stages: ['smoke'], spec: SPEC, tcs: [tc], claims: [], class: 'restricted', selector: { specs: [SPEC], describe: null, tcs: [tc] }, scopes: [], reasons: [] });
  const uf = path.join(sb.root, 'parallel-plan.json');
  fs.writeFileSync(uf, JSON.stringify({ schema: 'skill5-parallel-plan/1', mode: 'readiness', outcome: 'OK', pool: [], units: [unit('u1', 'TC-001'), unit('u2', 'TC-002')], conflicts: [] }, null, 2));
  const pl = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', 'TC-001,TC-002', '--scheduler', 'dispatch', '--units', uf, '--ceilings', 'default=20000'],
    { '*': 'cross-interference' }, { QA_LEDGER: 'on', QA_CAPACITY_DIR: capDir(), FAKE_CROSS_WAIT_MS: '4000', ...REAL }).payload;
  const s = summaryFull(sb, pl);
  if (!pl || pl.outcome !== 'COMPLETED') p.push('outcome ' + (pl && pl.outcome + ' ' + pl.reason));
  else {
    const tl = s.dispatch.timeline;
    const at = (u) => tl.find((x) => x.unit === u);
    const overlapped = at('u1') && at('u2') && Date.parse(at('u1').start) < Date.parse(at('u2').end) && Date.parse(at('u2').start) < Date.parse(at('u1').end);
    if (!overlapped) p.push('the two unit commands did not run side by side: ' + JSON.stringify(tl));
    if (!pl.isolation.ran.includes('TC-002') || !pl.isolation.passed_alone.includes('TC-002')) p.push('TC-002 failed beside the other command but was not re-run alone: ' + JSON.stringify(pl.isolation));
    if (s.tcs['TC-002'] !== 'PASS' || s.tcs['TC-001'] !== 'PASS') p.push('statuses ' + JSON.stringify(s.tcs));
    const e = pl.interference.find((x) => x.tc === 'TC-002' && x.kind === 'failed-beside-passed-alone');
    if (!e || !e.overlapped.includes('TC-001')) p.push('interference record lacks the overlapping test of the other command: ' + JSON.stringify(pl.interference));
    if (!pl.isolation.overlap_rerun.includes('TC-001')) p.push('TC-001 passed in the other command beside the failure but was not re-checked alone: ' + JSON.stringify(pl.isolation));
  }
  check('39 dispatch isolation: a FAIL beside another single-worker command is re-run alone; the other command\'s overlapping pass is re-checked alone', p, {});
}

/* 40 — SCHEDULER AUTO (the default) without proof of independence runs SERIALLY: no --units, a BLOCKED readiness payload
   and the ledger off each give workers 1 for every command (never the run plan's 2), with the reason in
   summary.scheduler.fallback; the statuses are the same as under the legacy groups scheduler. */
{
  const p = [];
  const call = (extraArgs, env = {}) => { const sb = sandbox(); const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE, '--scheduler', 'auto', ...extraArgs], {}, env).payload; return { sb, r, s: r ? summaryFull(sb, r) : null }; };
  const none = call([]);
  if (!none.r || none.r.outcome !== 'COMPLETED') p.push('no payload: outcome ' + (none.r && none.r.outcome + ' ' + none.r.reason));
  else {
    const par = argvOf(none.sb, 'parallel');
    if (!par || par.flags.workers !== '1') p.push('no payload: the parallel group ran with ' + (par && par.flags.workers) + ' workers — want 1');
    if (!none.s || none.s.scheduler.used !== 'serial' || !/no readiness payload|capacity ledger off/.test(none.s.scheduler.fallback || '')) p.push('no payload: scheduler ' + JSON.stringify(none.s && none.s.scheduler));
    if (!/\nWorkers: Auto ceiling \d+ .*serial — /.test(none.r.update)) p.push('no payload: the stage message has no workers line: ' + none.r.update);
  }
  const blockedFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-units-')), 'parallel-plan.json');
  sandboxes.push(path.dirname(blockedFile));
  fs.writeFileSync(blockedFile, JSON.stringify({ schema: 'skill5-parallel-plan/1', mode: 'readiness', outcome: 'BLOCKED', reason: 'TC document not found', units: [], conflicts: [] }));
  const blocked = call(['--units', blockedFile, '--ceilings', 'default=20000']);
  if (!blocked.r || blocked.r.outcome !== 'COMPLETED') p.push('BLOCKED payload: outcome ' + (blocked.r && blocked.r.outcome + ' ' + blocked.r.reason));
  else {
    const par = argvOf(blocked.sb, 'parallel');
    if (!par || par.flags.workers !== '1') p.push('BLOCKED payload: workers ' + (par && par.flags.workers));
    if (!blocked.s || blocked.s.scheduler.used !== 'serial') p.push('BLOCKED payload: scheduler ' + JSON.stringify(blocked.s && blocked.s.scheduler));
  }
  const legacy = (() => { const sb = sandbox(); const r = stage(sb, ['--stage', 'smoke', '--run', 'first', '--stage-tcs', SMOKE]).payload; return r ? summaryFull(sb, r) : null; })();
  if (none.s && legacy && JSON.stringify(none.s.tcs) !== JSON.stringify(legacy.tcs)) p.push('serial changed a status: ' + JSON.stringify([none.s.tcs, legacy.tcs]));
  check('40 scheduler auto without proof of independence runs serially (workers 1), with the reason; statuses unchanged', p, {});
}

// the dispatch / re-queue filter as run-stage builds it (stage tag + TC list, no @run: tag)
function buildFilterFor(stage, tcs) {
  const end = '(?![\\w:-])';
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return '(?=.*' + esc('@' + stage) + end + ')(?=.*[\\[,]\\s*(?:' + tcs.map(esc).join('|') + ')\\s*[\\],])';
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
