#!/usr/bin/env node
// run-stage.mjs — runs ONE stage of a skill-5 run (setup / smoke / positive / negative): every
// run-plan group of that stage in plan order, one Playwright command per group, each command
// monitored HERE — watchdog.mjs every --interval, the outer ceiling, the per-command freshness
// gate — and returns ONE compact JSON payload when the stage is over. Node >= 18, zero dependencies.
//
// The suite's one runner. It spawns the consumer project's Playwright, writes only under
// {results_root}/artifacts/ (stage-filtered group files `*.plan.json`, stage summaries
// `*.summary.json`; Playwright and the project's helpers write the stage JSONs and heartbeats there)
// and appends to the run's progress log. The model starts it as ONE background command per stage
// and waits for the completion notice — it never polls it. The stage's chat message is `update`.
//
// Contract: references/execution.md (<live_progress>, <staged_execution>), references/run-report.md
// §3 (file names) and watchdog.mjs (freeze verdicts — imported, never re-derived here).
//
// Usage:
//   node run-stage.mjs --run-file <results_root>/.runs/phase-N.json --stage setup|smoke|positive|negative
//        --run first|final --stage-tcs <TC,…> --ceilings <group=ms,…> --grace <ms> --log <progress log>
//        --project <browser project> --cwd <automation root> [--spec <file,…>] [--groups <name,…>]
//        [--tcs <TC,…>] [--extra repeat-each=N,last-failed,workers=N] [--label <text>] [--headless]
//        [--cli <playwright cli.js>] [--cmd "<run command>"] [--stage-json-source <path>]
//        [--interval 5000] [--status-every 30000] [--ceiling-margin <ms>] [--strict] [--pretty]
// Exit code 0 by default (the outcome is in the payload); --strict maps COMPLETED 0 · STOPPED_* 1 ·
// FRESHNESS_FAILED / SPAWN_FAILED / BLOCKED 2 · NOT_RUN 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, posix, read, isFile } from './scan-lib.mjs';
import { run as watchdogRun } from './watchdog.mjs';

export const SCHEMA_VERSION = 'skill5-run-stage/1';
export const SMOKE_GATE_LIMIT = 30;
const STAGES = ['setup', 'smoke', 'positive', 'negative'];
const STAGE_TAG = { setup: '@setup', smoke: '@smoke', positive: '@positive', negative: '@negative' };
const STAGE_WORD = { setup: 'Setup journeys', smoke: 'Smoke tests', positive: 'Positive tests', negative: 'Negative tests' };
export const ACTIVITY = { setup: 'Preparing Test Data — setup journeys', smoke: 'Running Smoke Tests', positive: 'Running Positive Tests', negative: 'Running Negative Tests' };
const EXTRA_ALLOWED = new Set(['repeat-each', 'last-failed', 'workers']);
const REFUSED_IN_CMD = /(^|\s)(--reporter|--config|-c|--grep|-g|--grep-invert|--project|--retries)(\s|=|$)/;
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;
const DLL_CRASH = /3221225794|0xC0000142/i;
const NO_TESTS = /no tests found/i;
const STRICT_EXIT = { COMPLETED: 0, STOPPED_FROZEN: 1, STOPPED_CEILING: 1, FRESHNESS_FAILED: 2, SPAWN_FAILED: 2, BLOCKED: 2, NOT_RUN: 3 };
const OUTCOME_RANK = ['COMPLETED', 'STOPPED_FROZEN', 'STOPPED_CEILING', 'FRESHNESS_FAILED', 'SPAWN_FAILED', 'BLOCKED'];

const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const slugOf = (name) => String(name).replace(/[:\s/\\]+/g, '-');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statSafe = (p) => { try { return fs.statSync(p); } catch { return null; } };
const iso = (ms) => new Date(ms).toISOString();
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
export const filterLine = (line) => (SECRET_LINE.test(line) ? '[line withheld: it looks like a credential]' : line);
export function mmss(ms) {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(r) : two(m) + ':' + two(r);
}

/* ---------------- titles, filters, the Playwright JSON report ---------------- */

// every [TC-ID] token of a title — "[TC-01][TC-02]" and "[TC-01, TC-02]" both count for each TC
export function tcIdsOf(text) {
  const ids = [];
  for (const m of String(text || '').matchAll(/\[([^\]]+)\]/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (/^TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(t) && !ids.includes(t)) ids.push(t);
    }
  }
  return ids;
}

// ONE lookahead regex per command — version-independent (repeated --grep flags are never relied on).
// Every tag is guarded at its end, so @run:serial-order never selects @run:serial-orders.
export function buildFilter({ stage, group, tcs }) {
  const end = '(?![\\w:-])';
  let grep = '(?=.*' + esc(STAGE_TAG[stage]) + end + ')(?=.*' + esc('@run:' + slugOf(group)) + end + ')';
  if (tcs && tcs.length) grep += '(?=.*[\\[,]\\s*(?:' + tcs.map(esc).join('|') + ')\\s*[\\],])';
  const invert = stage === 'positive' || stage === 'negative' ? esc('@smoke') + end : null;
  return { grep, invert };
}

// a raw Playwright JSON report → one row per test (the last result is the status of record)
export function collectTests(report, resultsRoot) {
  const out = [];
  const walk = (suite, titles) => {
    const t = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1] || null;
        const tags = (spec.tags || []).map((x) => (String(x).startsWith('@') ? String(x) : '@' + x));
        const shot = last && (last.attachments || []).find((a) => a && a.path && /image\//.test(a.contentType || '') && /screenshot/i.test(a.name || ''));
        let status;
        if (!last) status = 'NOT_RUN';
        else if (last.status === 'interrupted') status = 'INCOMPLETE';
        else if (last.status === 'skipped') status = 'SKIP';
        else if (test.expectedStatus === 'failed') status = last.status === 'passed' ? 'FAIL' : 'XFAIL';
        else status = last.status === 'passed' ? 'PASS' : 'FAIL';
        const err = last && ((last.error && last.error.message) || ((last.errors || [])[0] && last.errors[0].message)) || null;
        out.push({
          title: spec.title, file: spec.file || suite.file || null, line: spec.line || null, tags,
          project: test.projectName || null, status, duration_ms: results.reduce((a, r) => a + (r.duration || 0), 0),
          tcs: tcIdsOf(spec.title),
          unverifiedAssumption: tags.includes('@unverified-assumption') || /@unverified-assumption/.test(spec.title),
          error: err ? filterLine(String(err).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 200) : null,
          screenshot: shot ? posix(path.relative(resultsRoot, shot.path)) : null,
        });
      }
    }
    for (const s of suite.suites || []) walk(s, t);
  };
  for (const s of (report && report.suites) || []) walk(s, []);
  return out;
}

// the provisional status of one TC from its tests in one stage (final statuses come from the merge)
export function aggregate(statuses) {
  if (!statuses.length) return 'NOT_RUN';
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('INCOMPLETE')) return 'INCOMPLETE';
  const only = (s) => statuses.every((x) => x === s);
  for (const s of ['SKIP', 'NOT_RUN', 'XFAIL', 'PASS']) if (only(s)) return s;
  const ran = statuses.some((x) => x === 'PASS' || x === 'XFAIL');
  const missed = statuses.some((x) => x === 'SKIP' || x === 'NOT_RUN');
  if (ran && missed) return 'INCOMPLETE';
  return 'PASS';
}

export function countOf(map) {
  const c = { tcs: 0, passed: 0, failed: 0, skipped: 0, incomplete: 0, notRun: 0, expectedFailures: 0 };
  for (const s of Object.values(map)) {
    c.tcs++;
    if (s === 'PASS') c.passed++;
    else if (s === 'FAIL') c.failed++;
    else if (s === 'SKIP') c.skipped++;
    else if (s === 'INCOMPLETE') c.incomplete++;
    else if (s === 'XFAIL') c.expectedFailures++;
    else c.notRun++;
  }
  return c;
}

/* ---------------- messages ---------------- */

const phrase = (c) => c.passed + ' passed, ' + c.failed + ' failed, ' + c.skipped + ' skipped'
  + (c.incomplete ? ', ' + c.incomplete + ' incomplete' : '') + ', ' + c.notRun + ' not run'
  + (c.expectedFailures ? ', ' + c.expectedFailures + ' expected failure' + (c.expectedFailures === 1 ? '' : 's') : '');
const short = (c) => c.passed + ' passed · ' + c.failed + ' failed' + (c.skipped ? ' · ' + c.skipped + ' skipped' : '')
  + (c.notRun + c.incomplete ? ' · ' + (c.notRun + c.incomplete) + ' not run' : '');

export function smokeGateOf(c) {
  const failPct = c.tcs ? Math.round((c.failed / c.tcs) * 1000) / 10 : 0;
  return { failPct, limit: SMOKE_GATE_LIMIT, decision: failPct <= SMOKE_GATE_LIMIT ? 'continue' : 'classify' };
}

// the stage's chat message — cumulative within the run (first / final); the model adds only what a
// script cannot know: the gate decision above the limit, defect classification, compliance status
export function buildUpdate({ run, stage, label, outcome, reason, call, cumulative, failures, notRun, blockers, evidenceDir, durationMs }) {
  const L = [];
  const runText = run + ' run' + (label ? ', ' + label : '');
  const word = STAGE_WORD[stage];
  if (outcome === 'BLOCKED' || outcome === 'SPAWN_FAILED' || outcome === 'FRESHNESS_FAILED') {
    L.push(word + ' stopped (' + runText + '): ' + reason + '.');
  } else if (stage === 'setup') {
    L.push(word + ' completed (' + runText + '): ' + call.journeys.passed + ' passed, ' + call.journeys.failed + ' failed — ' + mmss(durationMs) + '.');
  } else {
    L.push(word + ' completed (' + runText + '): ' + phrase(call.counts) + ' — ' + plural(call.counts.tcs, 'TC') + ', ' + mmss(durationMs) + '.');
  }
  if (failures.length) {
    const ids = [...new Set(failures.flatMap((f) => f.tcs.length ? f.tcs : [f.title]))];
    const ua = [...new Set(failures.filter((f) => f.unverifiedAssumption).flatMap((f) => f.tcs))];
    L.push('Failed: ' + ids.join(', ') + (ua.length ? ' (unverified assumption: ' + ua.join(', ') + ' — never an application bug)' : '') + '.');
  }
  if (notRun.length) {
    const byReason = new Map();
    for (const n of notRun) { const k = n.reason || 'not run'; if (!byReason.has(k)) byReason.set(k, []); byReason.get(k).push(n.tc); }
    L.push('Not run / incomplete: ' + [...byReason].map(([r, tcs]) => tcs.join(', ') + ' — ' + r).join('; ') + '.');
  }
  L.push('Blockers: ' + (blockers.length ? blockers.join('; ') : 'none') + '.');
  const st = cumulative.stages;
  const stageRan = outcome !== 'BLOCKED' && outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED';
  if (stage === 'smoke') {
    if (cumulative.setup) L.push('Setup journeys: ' + cumulative.setup.passed + ' passed, ' + cumulative.setup.failed + ' failed.');
    const executed = st.smoke ? st.smoke.tcs - st.smoke.notRun : 0;
    if (stageRan && executed > 0) {
      const g = smokeGateOf(st.smoke);
      L.push('Smoke gate: ' + g.failPct + '% failed (limit ' + g.limit + '%) — ' + (g.decision === 'continue'
        ? 'Positive tests may continue.'
        : 'classify every smoke failure before deciding: heal and re-run the smoke stage, or stop on an application-error majority.'));
    }
  } else if (stage === 'positive') {
    L.push('So far (' + run + ' run): ' + ['smoke', 'positive'].filter((s) => st[s]).map((s) => s[0].toUpperCase() + s.slice(1) + ' ' + short(st[s])).join(' | ')
      + ' — combined ' + phrase(cumulative.total) + ' of ' + plural(cumulative.total.tcs, 'TC') + '.');
  } else if (stage === 'negative') {
    const t = cumulative.total;
    L.push(run[0].toUpperCase() + run.slice(1) + ' run totals: ' + ['smoke', 'positive', 'negative'].filter((s) => st[s]).map((s) => s[0].toUpperCase() + s.slice(1) + ' ' + short(st[s])).join(' | ')
      + ' — Passed ' + t.passed + ' · Failed ' + t.failed + ' · Skipped ' + t.skipped + ' · Not run ' + (t.notRun + t.incomplete)
      + (t.incomplete ? ' (' + t.incomplete + ' interrupted)' : '') + ' of ' + plural(t.tcs, 'TC') + '.');
    if (evidenceDir) L.push('Evidence: ' + evidenceDir);
  }
  return L.join('\n');
}

/* ---------------- process control ---------------- */

export function killTree(child) {
  if (!child || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  }
}

const quoteWin = (a) => '"' + a + '"';
const quotePosix = (a) => "'" + String(a).replace(/'/g, "'\\''") + "'";

// the watchdog is trusted only if it still tells a hang from a quiet step on a synthetic heartbeat
function watchdogSane() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-stage-probe-'));
  try {
    const plan = path.join(dir, 'g.json');
    const hb = path.join(dir, 'g.jsonl');
    fs.writeFileSync(plan, JSON.stringify({ name: 'probe', tcs: ['TC-P1'] }));
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const lines = [
      { at: iso(t0), worker: 0, tc: 'TC-P1', event: 'test-start' },
      { at: iso(t0 + 1), worker: 0, tc: 'TC-P1', step: 'probe', event: 'start', deadline_ms: 1000 },
    ];
    fs.writeFileSync(hb, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const hung = watchdogRun({ plan, heartbeat: hb, now: iso(t0 + 5000), grace: '1000' });
    fs.appendFileSync(hb, JSON.stringify({ at: iso(t0 + 900), worker: 0, tc: 'TC-P1', step: 'probe', event: 'end', outcome: 'ok' }) + '\n');
    const fine = watchdogRun({ plan, heartbeat: hb, now: iso(t0 + 5000), grace: '1000' });
    return hung.verdict === 'FROZEN' && fine.verdict === 'OK';
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/* ---------------- incremental view (status lines only — never the result of record) ---------------- */

function incremental(resultsFile) {
  const done = new Map();
  const durations = [];
  for (const line of (read(resultsFile) || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const st = { passed: 'PASS', failed: 'FAIL', timedOut: 'FAIL', skipped: 'SKIP', interrupted: 'INCOMPLETE' }[o.status] || 'NOT_RUN';
    for (const tc of Array.isArray(o.tc) ? o.tc : []) done.set(tc, st);
    if (typeof o.duration_ms === 'number' && o.status !== 'skipped') durations.push(o.duration_ms);
  }
  return { done, avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, samples: durations.length };
}

/* ---------------- one group = one Playwright command ---------------- */

async function runGroup(ctx, g, laterGroups) {
  const { a, log } = ctx;
  fs.mkdirSync(path.dirname(g.stageJson), { recursive: true });
  fs.mkdirSync(path.dirname(g.progressFile), { recursive: true });
  fs.writeFileSync(g.planFile, JSON.stringify({ name: g.name, mode: g.mode, workers: g.workers, stage: ctx.stage, tcs: g.tcs }, null, 2) + '\n');
  const { grep, invert } = buildFilter({ stage: ctx.stage, group: g.name, tcs: ctx.onlyTcs });
  const pwArgs = ['test', ...g.specs, '--project=' + ctx.project, '--grep', grep];
  if (invert) pwArgs.push('--grep-invert', invert);
  pwArgs.push('--workers=' + g.workers, ...ctx.extraArgs);
  const env = { ...process.env, PW_STAGE_JSON: g.stageJson, PW_PROGRESS_FILE: g.progressFile, PW_OUTPUT_DIR: path.join(ctx.resultsRoot, 'artifacts', 'test-output'),
    PW_GLOBAL_TIMEOUT: String(g.ceilingMs), PW_WORKERS: String(g.workers), PW_PHASE: String(ctx.phase), PW_STAGE_ATTEMPT: String(g.attempt) };
  if (ctx.headless) env.PW_HEADLESS = '1'; else delete env.PW_HEADLESS;
  let child;
  let spawnError = null;
  const shown = (ctx.cmd ? ctx.cmd : 'playwright') + ' ' + pwArgs.map((x) => (/\s|[|()]/.test(x) ? JSON.stringify(x) : x)).join(' ');
  g.command = shown;
  g.startedAt = Date.now();
  log(ctx.activity + ' · ' + g.name + ' (' + g.mode + ' ×' + g.workers + ', ' + (ctx.headless ? 'headless' : 'headed') + ') · start · '
    + plural(g.tcs.length, 'TC') + ' · attempt ' + g.attempt + ' · ceiling ' + mmss(g.ceilingMs) + ' · ' + shown);
  try {
    if (ctx.cmd) {
      const quote = process.platform === 'win32' ? quoteWin : quotePosix;
      if (process.platform === 'win32' && pwArgs.some((x) => /["%]/.test(x))) throw new Error('an argument holds " or % — not passed through cmd.exe');
      child = spawn(ctx.cmd + ' ' + pwArgs.map(quote).join(' '), { cwd: ctx.cwd, env, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      // no shell: the lookahead regex reaches Playwright byte for byte on every platform
      child = spawn(process.execPath, [ctx.cliPath, ...pwArgs], { cwd: ctx.cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    }
  } catch (e) { spawnError = e; }
  ctx.current = child || null;
  let exited = !child;
  let exitInfo = { code: null, signal: null };
  let closed = !child;
  let noTests = false;
  const onExit = new Promise((resolve) => {
    if (!child) return resolve();
    child.on('error', (e) => { spawnError = spawnError || e; exited = true; closed = true; resolve(); });
    child.on('exit', (code, signal) => { exited = true; exitInfo = { code, signal }; resolve(); });
  });
  const onClose = new Promise((resolve) => { if (!child) return resolve(); child.on('close', () => { closed = true; resolve(); }); });
  if (child) {
    for (const stream of [child.stdout, child.stderr]) {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        buf += d;
        const parts = buf.split(/\r?\n/);
        buf = parts.pop();
        for (const line of parts) {
          if (!line.trim()) continue;
          if (NO_TESTS.test(line)) noTests = true;
          if (DLL_CRASH.test(line)) { ctx.flags.windowsDllInitCrash = true; g.dllCrash = true; }
          log('  | ' + filterLine(line), true);
        }
      });
      stream.on('end', () => { if (buf.trim()) { if (NO_TESTS.test(buf)) noTests = true; if (DLL_CRASH.test(buf)) { ctx.flags.windowsDllInitCrash = true; g.dllCrash = true; } log('  | ' + filterLine(buf), true); } });
    }
  }
  let lastStatus = Date.now();
  let blockedRun = 0;
  const wdArgs = { plan: g.planFile, heartbeat: g.progressFile, results: g.resultsFile, grace: String(ctx.graceMs), stage: ctx.stage, group: g.name };
  const safeWd = (extra) => { try { return watchdogRun({ ...wdArgs, ...extra }); } catch (e) { return { verdict: 'BLOCKED', reason: 'internal error: ' + e.message }; } };
  const statusLine = (verdict) => {
    const inc = incremental(g.resultsFile);
    const doneTcs = g.tcs.filter((t) => inc.done.has(t));
    const vals = doneTcs.map((t) => inc.done.get(t));
    const n = (s) => vals.filter((v) => v === s).length;
    const planned = ctx.plannedTotal || 1;
    const doneStage = ctx.doneBefore + doneTcs.length;
    const remainingHere = g.tcs.length - doneTcs.length;
    const later = laterGroups.reduce((s, x) => s + x.tcs.length, 0);
    const eta = inc.avg !== null && inc.samples >= 3
      ? ' · remaining ~' + mmss((inc.avg * remainingHere) / g.workers + laterGroups.reduce((s, x) => s + (inc.avg * x.tcs.length) / x.workers, 0))
        + ' (serial-only ~' + mmss(inc.avg * (remainingHere + later)) + ')'
      : ' · remaining —';
    const wd = safeWd({});
    const current = (wd.workers || []).filter((w) => w.state === 'in-step').map((w) => w.tc).join(', ') || '—';
    log(ctx.activity + ' · ' + g.name + ' (' + g.mode + ' ×' + g.workers + ') · ' + doneTcs.length + '/' + g.tcs.length + ' TCs done · stage ' + Math.round((doneStage / planned) * 100)
      + '% · passed ' + n('PASS') + ' · failed ' + n('FAIL') + ' · skipped ' + n('SKIP') + ' · not run ' + (g.tcs.length - doneTcs.length)
      + ' · current ' + current + ' · elapsed ' + mmss(Date.now() - g.startedAt) + eta + ' · watchdog ' + (verdict || wd.verdict));
  };
  while (!exited) {
    await Promise.race([onExit, sleep(ctx.intervalMs)]);
    if (exited) break;
    const elapsed = Date.now() - g.startedAt;
    if (elapsed > g.ceilingMs + ctx.marginMs) {
      killTree(child);
      const reason = 'outer ceiling stop after ' + Math.round(elapsed / 1000) + ' s';
      const w = safeWd({ write: true, out: g.watchdogFile, stopReason: reason });
      g.stop = { kind: 'ceiling', reason, elapsed_ms: elapsed, ceiling_ms: g.ceilingMs, verdict: w.verdict, written: w.verdict === 'OK' || w.verdict === 'FROZEN' };
      log(ctx.activity + ' · ' + g.name + ' · STOPPED — ' + reason + ' (Playwright did not stop at its own ceiling of ' + mmss(g.ceilingMs) + '); process tree killed');
      break;
    }
    if (ctx.freezeKills) {
      const v = safeWd({});
      if (v.verdict === 'BLOCKED') {
        blockedRun++;
        if (blockedRun === 3) { ctx.flags.watchdogUnreadable = true; log(ctx.activity + ' · ' + g.name + ' · watchdog cannot read the heartbeat (' + v.reason + ') — only the outer ceiling applies to this command'); }
      } else blockedRun = 0;
      if (v.verdict === 'FROZEN') {
        const w = safeWd({ write: true, out: g.watchdogFile });
        if (w.verdict === 'FROZEN') {
          killTree(child);
          const f = w.frozen[0];
          g.stop = { kind: 'watchdog', reason: w.reason, frozen: w.frozen, verdict: 'FROZEN', written: true };
          log(ctx.activity + ' · ' + g.name + ' · STOPPED — watchdog: worker ' + f.worker + ' frozen in step "' + f.step + '" of ' + f.tc + ' for '
            + Math.round(f.since_last_progress_ms / 1000) + ' s (deadline ' + Math.round(f.deadline_ms / 1000) + ' s + grace ' + Math.round(f.grace_ms / 1000) + ' s)'
            + (f.expected ? '; expected: ' + f.expected : '') + '; process tree killed');
          break;
        }
      }
    }
    if (Date.now() - lastStatus >= ctx.statusEveryMs) { statusLine(); lastStatus = Date.now(); }
  }
  if (child && !exited) {
    await Promise.race([onExit, sleep(10000)]);
    if (!exited) { killTree(child); await Promise.race([onExit, sleep(5000)]); }
    if (!exited) ctx.warnings.push(g.name + ': the process did not exit after the kill (pid ' + child.pid + ')');
  }
  if (child && !closed) await Promise.race([onClose, sleep(2000)]);
  ctx.current = null;
  g.finishedAt = Date.now();
  g.exit = exitInfo;
  g.noTests = noTests;
  if (spawnError) { g.spawnError = spawnError.message; return g; }
  freshness(ctx, g);
  log(ctx.activity + ' · ' + g.name + ' · end · exit ' + (exitInfo.code ?? exitInfo.signal ?? '—') + ' · ' + mmss(g.finishedAt - g.startedAt)
    + ' · freshness ' + g.freshness.gate + (g.freshness.reason ? ' (' + g.freshness.reason + ')' : '') + (g.source ? ' · source ' + g.source : ''));
  return g;
}

// the per-command freshness gate: a stage JSON newer than this command's start — or, for a stopped
// command, the watchdog file; never results assembled from the line output
function freshness(ctx, g) {
  const relr = (p) => posix(path.relative(ctx.resultsRoot, p));
  if (g.stop) {
    const st = statSafe(g.watchdogFile);
    if (g.stop.written && st && st.mtimeMs >= g.startedAt) { g.freshness = { gate: 'PASS' }; g.source = 'incremental+watchdog'; return; }
    g.freshness = { gate: 'FAIL', reason: 'stopped, and no watchdog file could be written (watchdog verdict ' + g.stop.verdict + ')' };
    return;
  }
  if (ctx.stageJsonSource) {
    const src = path.resolve(ctx.cwd, ctx.stageJsonSource);
    const st = statSafe(src);
    if (st && st.mtimeMs > g.startedAt) { fs.copyFileSync(src, g.stageJson); g.freshness = { gate: 'PASS' }; g.source = 'json'; return; }
  }
  const st = statSafe(g.stageJson);
  if (st && st.mtimeMs > g.startedAt) { g.freshness = { gate: 'PASS' }; g.source = 'json'; return; }
  if (g.noTests) { g.freshness = { gate: 'PASS', reason: 'no test matched the stage filter' }; g.source = 'none'; return; }
  g.freshness = { gate: 'FAIL', reason: st ? 'stage JSON ' + relr(g.stageJson) + ' is stale (written before this command started)' : 'stage JSON ' + relr(g.stageJson) + ' is missing — check for a --reporter override, a stray --config or a changed outputFile' };
}

// statuses of one finished group: the stage JSON, or the watchdog reconstruction after a stop
function groupStatuses(ctx, g) {
  const tcs = {};
  const reasons = {};
  const failures = [];
  const journeys = { passed: 0, failed: 0, other: 0 };
  const unplanned = [];
  if (g.source === 'incremental+watchdog') {
    let file = null; try { file = JSON.parse(read(g.watchdogFile)); } catch { /* unreadable → everything below stays NOT_RUN */ }
    for (const c of (file && file.completed) || []) tcs[c.tc] = c.status;
    for (const i of (file && file.interrupted) || []) { tcs[i.tc] = 'INCOMPLETE'; reasons[i.tc] = i.reason; }
    for (const n of (file && file.not_started) || []) { tcs[n.tc] = 'NOT_RUN'; reasons[n.tc] = n.reason; }
    for (const c of (file && file.completed) || []) if (c.status === 'FAIL') failures.push({ tcs: [c.tc], title: c.title, group: g.name, status: 'FAIL', error: null, screenshot: null, unverifiedAssumption: false });
  } else if (g.source === 'json') {
    let report = null; try { report = JSON.parse(read(g.stageJson)); } catch { /* covered by the freshness gate */ }
    const tests = collectTests(report, ctx.resultsRoot);
    const per = {};
    for (const t of tests) {
      if (ctx.stage === 'setup' && !t.tcs.length) { if (t.status === 'PASS') journeys.passed++; else if (t.status === 'FAIL') journeys.failed++; else journeys.other++; }
      for (const tc of t.tcs) {
        if (!g.tcs.includes(tc) && !unplanned.includes(tc)) unplanned.push(tc);
        (per[tc] = per[tc] || []).push(t.status);
      }
      if (t.status === 'FAIL') failures.push({ tcs: t.tcs, title: t.title, group: g.name, status: 'FAIL', error: t.error, screenshot: t.screenshot, unverifiedAssumption: t.unverifiedAssumption });
    }
    for (const [tc, list] of Object.entries(per)) tcs[tc] = aggregate(list);
  }
  for (const tc of g.tcs) if (!(tc in tcs)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = g.source === 'none' ? 'no test matched the stage filter — check its tags' : 'no result for this TC in the stage JSON'; }
  return { tcs, reasons, failures, journeys, unplanned };
}

/* ---------------- the stage ---------------- */

export async function runStage(rawArgs) {
  const a = rawArgs;
  const errors = [];
  const warnings = [];
  const stage = typeof a.stage === 'string' ? a.stage : null;
  const run = typeof a.run === 'string' ? a.run : null;
  const label = typeof a.label === 'string' ? a.label : null;
  const runFile = typeof a['run-file'] === 'string' ? path.resolve(a['run-file']) : null;
  const cwd = typeof a.cwd === 'string' ? path.resolve(a.cwd) : null;
  const logPath = typeof a.log === 'string' ? path.resolve(a.log) : null;
  const project = typeof a.project === 'string' ? a.project : null;
  const base = { tool: 'run-stage', schema: SCHEMA_VERSION, run, stage, label };
  if (!STAGES.includes(stage)) errors.push('--stage must be one of ' + STAGES.join(' | '));
  if (run !== 'first' && run !== 'final') errors.push('--run must be first | final');
  if (!runFile || !isFile(runFile)) errors.push('--run-file must name the phase\'s run file (.runs/phase-N.json)');
  if (!cwd || !statSafe(cwd)) errors.push('--cwd must name the automation root');
  if (!logPath) errors.push('--log must name this run\'s progress log');
  if (!project) errors.push('--project must name the browser project');
  const stageTcs = csv(a['stage-tcs']);
  if (stage && stage !== 'setup' && !stageTcs.length) errors.push('--stage-tcs is required: the approved document\'s TCs of this stage');
  const ceilings = {};
  for (const pair of csv(a.ceilings)) { const i = pair.lastIndexOf('='); const ms = Number(pair.slice(i + 1)); if (i > 0 && ms > 0) ceilings[pair.slice(0, i)] = ms; else errors.push('bad --ceilings entry "' + pair + '" (group=milliseconds)'); }
  const extraArgs = [];
  let workersOverride = null;
  for (const e of csv(a.extra)) {
    const [k, v] = e.split('=');
    if (!EXTRA_ALLOWED.has(k)) { errors.push('--extra "' + e + '" is refused — only repeat-each=N, last-failed, workers=N (never a reporter, config, grep, project or retries)'); continue; }
    if (k === 'workers') { if (Number(v) > 0) workersOverride = Number(v); else errors.push('--extra workers needs a number'); }
    else if (k === 'repeat-each') { if (Number(v) > 0) extraArgs.push('--repeat-each=' + Number(v)); else errors.push('--extra repeat-each needs a number'); }
    else extraArgs.push('--last-failed');
  }
  const cmd = typeof a.cmd === 'string' ? a.cmd : null;
  if (cmd && REFUSED_IN_CMD.test(cmd)) errors.push('--cmd may not carry --reporter / --config / --grep / --project / --retries: the stage filter and the shared config are this script\'s');
  const graceMs = a.grace !== undefined && a.grace !== true ? Number(a.grace) : 60000;
  if (a.grace === undefined) warnings.push('no --grace: the watchdog uses 60 s — pass TIMEOUTS.watchdog_grace');
  if (Number.isNaN(graceMs) || graceMs < 0) errors.push('--grace must be milliseconds');
  if (errors.length) return { ...base, outcome: 'BLOCKED', reason: errors[0], errors, warnings };

  let runJson; try { runJson = JSON.parse(read(runFile)); } catch { runJson = null; }
  const plan = runJson && (runJson.run_plan || (Array.isArray(runJson.groups) ? runJson : null));
  if (!plan || !Array.isArray(plan.groups)) return { ...base, outcome: 'BLOCKED', reason: 'the run file has no run_plan.groups[] — write {run_file}.run_plan first', errors: ['no run_plan'], warnings };
  const resultsRoot = path.dirname(path.dirname(runFile));
  const phase = Number(runJson.phase) || Number((path.basename(runFile).match(/phase-(\d+)/) || [])[1]) || null;
  const onlyGroups = csv(a.groups);
  const onlyTcs = csv(a.tcs);
  const source = stage === 'setup' ? (plan.setup_groups || []) : plan.groups;
  const groups = [];
  const skippedGroups = [];
  const inNoGroup = stageTcs.filter((tc) => !plan.groups.some((g) => (g.tcs || []).includes(tc)));
  for (const pg of source) {
    if (onlyGroups.length && !onlyGroups.includes(pg.name)) continue;
    let tcs = stage === 'setup' ? (pg.tcs || []).slice() : (pg.tcs || []).filter((tc) => stageTcs.includes(tc));
    if (onlyTcs.length) tcs = tcs.filter((tc) => onlyTcs.includes(tc));
    if (stage !== 'setup' && !tcs.length) { skippedGroups.push({ name: pg.name, reason: 'no TCs of this stage in this group' }); continue; }
    const workers = workersOverride || pg.workers || (pg.mode === 'parallel' ? (plan.workers_parallel || 2) : 1);
    const ceilingMs = ceilings[pg.name] || ceilings[slugOf(pg.name)];
    if (!ceilingMs) errors.push('no ceiling for group "' + pg.name + '" (--ceilings ' + pg.name + '=<ms>, computed from timeouts.ts)');
    groups.push({ name: pg.name, mode: pg.mode || (workers > 1 ? 'parallel' : 'serial'), workers, tcs, ceilingMs, specs: stage === 'setup' && pg.spec ? [pg.spec] : null });
  }
  if (onlyGroups.length) for (const n of onlyGroups) if (!source.some((g) => g.name === n)) errors.push('group "' + n + '" is not in the run plan for this stage');
  if (errors.length) return { ...base, outcome: 'BLOCKED', reason: errors[0], errors, warnings };
  if (workersOverride) warnings.push('workers overridden to ' + workersOverride + ' (reproduction run) — record it as a Deviation');
  if (inNoGroup.length) warnings.push('in --stage-tcs but in no run-plan group: ' + inNoGroup.join(', ') + ' — reported NOT_RUN');

  // attempt numbering: the next free -attempt{n} per {stage}-{group}; a progress file is never reused
  const stagesDir = path.join(resultsRoot, 'artifacts', 'stages');
  const progressDir = path.join(resultsRoot, 'artifacts', 'progress');
  const existing = [...(fs.existsSync(stagesDir) ? fs.readdirSync(stagesDir) : []), ...(fs.existsSync(progressDir) ? fs.readdirSync(progressDir) : [])];
  for (const g of groups) {
    const stem = stage + '-' + slugOf(g.name);
    let max = 0;
    for (const f of existing) {
      if (!f.startsWith(stem)) continue;
      const rest = f.slice(stem.length);
      const m = rest.match(/^-attempt(\d+)\./);
      if (m) max = Math.max(max, Number(m[1])); else if (/^\./.test(rest)) max = Math.max(max, 1);
    }
    g.attempt = max + 1;
    const fileStem = g.attempt === 1 ? stem : stem + '-attempt' + g.attempt;
    g.stageJson = path.join(stagesDir, fileStem + '.json');
    g.progressFile = path.join(progressDir, fileStem + '.jsonl');
    g.resultsFile = path.join(progressDir, fileStem + '.results.jsonl');
    g.watchdogFile = path.join(progressDir, fileStem + '.watchdog.json');
    g.planFile = path.join(progressDir, fileStem + '.plan.json');
  }

  let cliPath = null;
  if (!cmd) {
    const candidates = typeof a.cli === 'string' ? [path.resolve(cwd, a.cli)] : [path.join(cwd, 'node_modules', '@playwright', 'test', 'cli.js'), path.join(cwd, 'node_modules', 'playwright', 'cli.js')];
    cliPath = candidates.find((p) => isFile(p)) || null;
  }
  const specs = csv(a.spec);
  if (!specs.length && stage !== 'setup') warnings.push('no --spec: the whole automation project is filtered by tags only');
  for (const g of groups) if (!g.specs) g.specs = specs;
  const activity = ACTIVITY[stage] + ' (' + run + ' run' + (label ? ' — ' + label : '') + ')';
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = (msg, raw) => { try { fs.appendFileSync(logPath, (raw ? msg : new Date().toISOString() + ' · ' + msg) + '\n'); } catch { /* the payload still carries everything */ } };
  const ctx = {
    a, stage, run, label, activity, resultsRoot, cwd, phase, project, specs, cmd, cliPath, extraArgs, onlyTcs,
    headless: a.headless === true || a.headless === 'true', graceMs, stageJsonSource: typeof a['stage-json-source'] === 'string' ? a['stage-json-source'] : null,
    intervalMs: Number(a.interval) > 0 ? Number(a.interval) : 5000, statusEveryMs: Number(a['status-every']) > 0 ? Number(a['status-every']) : 30000,
    flags: { watchdogTrusted: true, windowsDllInitCrash: false, watchdogUnreadable: false }, warnings, log, current: null,
    plannedTotal: groups.reduce((s, g) => s + g.tcs.length, 0), doneBefore: 0,
  };
  ctx.freezeKills = watchdogSane();
  if (!ctx.freezeKills) { ctx.flags.watchdogTrusted = false; warnings.push('the watchdog failed its sanity check — freeze stops are disabled for this stage; only the outer ceiling applies and every stop is recorded unresolved'); }
  const stopSignals = () => { if (ctx.current) killTree(ctx.current); log(activity + ' · interrupted by a signal — the running command was stopped'); process.exit(130); };
  process.once('SIGINT', stopSignals);
  process.once('SIGTERM', stopSignals);

  const startedAt = Date.now();
  log(activity + ' · stage start · ' + (groups.length ? groups.map((g) => g.name + ' ×' + g.workers + ' (' + plural(g.tcs.length, 'TC') + ')').join(', ') : 'no group has TCs in this stage')
    + (skippedGroups.length ? ' · skipped: ' + skippedGroups.map((s) => s.name).join(', ') : '') + ' · results ' + posix(resultsRoot));
  for (const s of skippedGroups) log(activity + ' · ' + s.name + ' · skipped — ' + s.reason);
  const ran = [];
  const notRunGroups = [];
  let outcome = 'COMPLETED';
  let reason = null;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!cliPath && !cmd) {
      g.spawnError = 'Playwright CLI entry not found under ' + posix(cwd) + '/node_modules (@playwright/test/cli.js) — pass --cli or --cmd';
    } else {
      // a ceiling margin of max(60 s, 10 %) unless given — Playwright stops itself at its ceiling first
      ctx.marginMs = Number(a['ceiling-margin']) >= 0 && a['ceiling-margin'] !== undefined ? Number(a['ceiling-margin']) : Math.max(60000, Math.round(g.ceilingMs * 0.1));
      await runGroup(ctx, g, groups.slice(i + 1));
      ctx.doneBefore += g.tcs.length;
    }
    ran.push(g);
    if (g.spawnError) { outcome = 'SPAWN_FAILED'; reason = g.name + ': ' + g.spawnError; log(activity + ' · ' + g.name + ' · SPAWN FAILED — ' + g.spawnError); }
    else if (g.freshness.gate === 'FAIL') { outcome = 'FRESHNESS_FAILED'; reason = g.name + ': ' + g.freshness.reason; }
    else if (g.stop) {
      const o = g.stop.kind === 'ceiling' ? 'STOPPED_CEILING' : 'STOPPED_FROZEN';
      if (OUTCOME_RANK.indexOf(o) > OUTCOME_RANK.indexOf(outcome)) outcome = o;
    }
    if (outcome === 'SPAWN_FAILED' || outcome === 'FRESHNESS_FAILED') {
      const why = outcome === 'SPAWN_FAILED' ? 'not started: Playwright could not be started' : 'not started: the stage stopped after the freshness gate failed in ' + g.name;
      for (const rest of groups.slice(i + 1)) notRunGroups.push({ name: rest.name, tcs: rest.tcs, reason: why });
      break;
    }
  }
  process.removeListener('SIGINT', stopSignals);
  process.removeListener('SIGTERM', stopSignals);

  /* ---- statuses of this call ---- */
  const tcs = {};
  const reasons = {};
  const failures = [];
  const journeys = { passed: 0, failed: 0, other: 0 };
  const mergedStages = [];
  const watchdogEvents = [];
  const timeoutEvents = [];
  const requeue = [];
  const blockers = [];
  const relr = (p) => posix(path.relative(resultsRoot, p));
  for (const g of ran) {
    if (g.spawnError) { for (const tc of g.tcs) { tcs[tc] = 'NOT_RUN'; reasons[tc] = 'not started: Playwright could not be started'; } blockers.push('Playwright could not be started for ' + g.name + ' — ' + g.spawnError); continue; }
    if (g.freshness.gate === 'FAIL') { for (const tc of g.tcs) { tcs[tc] = 'NOT_RUN'; reasons[tc] = 'freshness gate failed — results not trusted'; } blockers.push('freshness gate failed in ' + g.name + ' (' + g.freshness.reason + ') — fix the reporting step and re-run the stage'); continue; }
    const r = groupStatuses(ctx, g);
    Object.assign(tcs, r.tcs); Object.assign(reasons, r.reasons); failures.push(...r.failures);
    journeys.passed += r.journeys.passed; journeys.failed += r.journeys.failed; journeys.other += r.journeys.other;
    if (r.unplanned.length) warnings.push(g.name + ': executed but not in --stage-tcs: ' + r.unplanned.join(', ') + ' — check the stage tags against the document');
    if (g.source === 'none') warnings.push(g.name + ': no test matched the stage filter although the plan lists ' + plural(g.tcs.length, 'TC') + ' — check the @run / stage tags');
    mergedStages.push({ name: stage, group: g.name, attempt: g.attempt, project, json_path: g.source === 'json' ? relr(g.stageJson) : null,
      started_at: iso(g.startedAt), finished_at: iso(g.finishedAt), source: g.source, ...(g.source === 'incremental+watchdog' ? { watchdog_path: relr(g.watchdogFile) } : {}) });
    if (g.stop) {
      const again = g.tcs.filter((tc) => tcs[tc] === 'INCOMPLETE' || tcs[tc] === 'NOT_RUN');
      if (again.length) requeue.push({ group: g.name, tcs: again, after: 'the heal — once' });
      if (g.stop.kind === 'watchdog') {
        for (const f of g.stop.frozen || []) {
          watchdogEvents.push({ stage, group: g.name, worker: f.worker, tc: f.tc, step: f.step, elapsed_ms: f.elapsed_ms, deadline_ms: f.deadline_ms, action: 'stopped' });
          timeoutEvents.push({ tc: f.tc, step: f.step, elapsed_ms: f.elapsed_ms, deadline_ms: f.deadline_ms, expected: f.expected, kind: 'watchdog', evidence: relr(g.progressFile) });
        }
        const f = (g.stop.frozen || [])[0];
        blockers.push('watchdog stop in ' + g.name + (f ? ': ' + f.tc + ' froze in step "' + f.step + '"' : '') + ' — timeout_failure; re-queue once after the heal');
      } else {
        watchdogEvents.push({ stage, group: g.name, worker: null, tc: null, step: null, elapsed_ms: g.stop.elapsed_ms, deadline_ms: g.ceilingMs, action: 'ceiling-stop' });
        timeoutEvents.push({ tc: null, step: null, elapsed_ms: g.stop.elapsed_ms, deadline_ms: g.ceilingMs, expected: null, kind: 'ceiling', evidence: relr(g.progressFile) });
        blockers.push('outer ceiling stop in ' + g.name + ' — Playwright did not stop at its own ceiling (timeout_failure)');
      }
    }
    if (g.dllCrash) blockers.push('worker crash 0xC0000142 in ' + g.name + ' — environment_failure, never an application or test defect');
  }
  for (const n of notRunGroups) for (const tc of n.tcs) { tcs[tc] = 'NOT_RUN'; reasons[tc] = n.reason; }
  for (const tc of inNoGroup) if (!onlyTcs.length || onlyTcs.includes(tc)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = 'in no run-plan group'; }
  if (!ctx.flags.watchdogTrusted) blockers.push('watchdog untrusted this stage — only the outer ceiling applied');
  if (ctx.flags.watchdogUnreadable) blockers.push('a heartbeat could not be read — only the outer ceiling applied there');
  const counts = countOf(tcs);
  const notRun = Object.entries(tcs).filter(([, s]) => s === 'NOT_RUN' || s === 'INCOMPLETE').map(([tc, s]) => ({ tc, status: s, reason: reasons[tc] || null }));

  /* ---- the summary file + the cumulative view of this run ---- */
  fs.mkdirSync(progressDir, { recursive: true });
  const prefix = run + '-' + stage + '-';
  const seq = 1 + fs.readdirSync(progressDir).filter((f) => f.startsWith(prefix) && f.endsWith('.summary.json')).length;
  const summaryFile = path.join(progressDir, prefix + seq + '.summary.json');
  const finishedAt = Date.now();
  const summary = {
    tool: 'run-stage', schema: SCHEMA_VERSION, run, stage, seq, label, phase, activity, outcome, reason,
    startedAt: iso(startedAt), finishedAt: iso(finishedAt), durationMs: finishedAt - startedAt,
    plannedTcs: groups.flatMap((g) => g.tcs), tcs, reasons, counts, journeys: stage === 'setup' ? journeys : undefined,
    failures, notRun,
    groups: ran.map((g) => ({ name: g.name, mode: g.mode, workers: g.workers, attempt: g.attempt, tcs: g.tcs, ceilingMs: g.ceilingMs, command: g.command || null,
      stageJson: relr(g.stageJson), progressFile: relr(g.progressFile), resultsFile: relr(g.resultsFile), watchdogFile: g.stop ? relr(g.watchdogFile) : null, planFile: relr(g.planFile),
      exit: g.exit || null, startedAt: g.startedAt ? iso(g.startedAt) : null, finishedAt: g.finishedAt ? iso(g.finishedAt) : null,
      durationMs: g.finishedAt ? g.finishedAt - g.startedAt : 0, freshness: g.freshness || { gate: 'FAIL', reason: g.spawnError }, source: g.source || null,
      stop: g.stop ? { kind: g.stop.kind, reason: g.stop.reason, verdict: g.stop.verdict } : null })),
    skippedGroups, notRunGroups, requeue, merged_stages: mergedStages, watchdog_events: watchdogEvents, timeout_events: timeoutEvents,
    smokeGate: stage === 'smoke' ? smokeGateOf(counts) : undefined, flags: ctx.flags, warnings,
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  const cumulative = cumulativeOf(progressDir, run);
  if (stage === 'smoke' && cumulative.stages.smoke) summary.smokeGate = smokeGateOf(cumulative.stages.smoke);
  const relCwd = posix(path.relative(cwd, resultsRoot));
  const evidenceDir = /^reports\//.test(relCwd) ? 'screenshots/' + relCwd.slice('reports/'.length) + '/phase-' + phase + '/' : null;
  summary.cumulative = cumulative;
  summary.update = buildUpdate({ run, stage, label, outcome, reason, call: { counts, journeys }, cumulative, failures, notRun, blockers, evidenceDir, durationMs: finishedAt - startedAt });
  summary.blockers = blockers;
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  log(activity + ' · stage end · ' + outcome + ' · ' + summary.update.split('\n')[0]);

  // stdout stays small: what the stage message and the next decision need; the rest is in the summary
  return {
    ...base, activity, phase, outcome, reason, durationMs: summary.durationMs, counts,
    failures: failures.slice(0, 20).map((f) => ({ tcs: f.tcs, title: f.title ? f.title.slice(0, 120) : null, group: f.group, error: f.error, screenshot: f.screenshot, unverifiedAssumption: f.unverifiedAssumption || undefined })),
    notRun: notRun.slice(0, 40), smokeGate: summary.smokeGate,
    groups: summary.groups.map((g) => ({ name: g.name, attempt: g.attempt, tcs: g.tcs.length, source: g.source, freshness: g.freshness.gate, stop: g.stop ? g.stop.kind : null, exit: g.exit ? g.exit.code : null })),
    skippedGroups, notRunGroups: notRunGroups.map((n) => ({ name: n.name, tcs: n.tcs.length, reason: n.reason })), requeue, blockers,
    flags: ctx.flags, warnings, update: summary.update, summaryFile: relr(summaryFile), log: posix(logPath),
  };
}

// every stage summary of this run, latest attempt winning per TC, stages in run order
export function cumulativeOf(progressDir, run) {
  const files = fs.readdirSync(progressDir).filter((f) => f.startsWith(run + '-') && f.endsWith('.summary.json'));
  const parsed = files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(progressDir, f), 'utf8')); } catch { return null; } }).filter(Boolean)
    .sort((x, y) => STAGES.indexOf(x.stage) - STAGES.indexOf(y.stage) || x.seq - y.seq);
  const maps = {};
  let setup = null;
  for (const s of parsed) {
    if (s.stage === 'setup') { setup = setup || { passed: 0, failed: 0 }; setup.passed += (s.journeys && s.journeys.passed) || 0; setup.failed += (s.journeys && s.journeys.failed) || 0; continue; }
    maps[s.stage] = { ...(maps[s.stage] || {}), ...s.tcs };
  }
  const stages = {};
  const all = {};
  for (const st of ['smoke', 'positive', 'negative']) if (maps[st]) { stages[st] = countOf(maps[st]); Object.assign(all, maps[st]); }
  return { stages, total: countOf(all), setup };
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'run-stage',
  usage: 'node run-stage.mjs --run-file <.runs/phase-N.json> --stage setup|smoke|positive|negative --run first|final --stage-tcs <TC,…> --ceilings <group=ms,…> --grace <ms> --log <progress log> --project <name> --cwd <automation root> [--spec <file,…>] [--groups <name,…>] [--tcs <TC,…>] [--extra repeat-each=N,last-failed,workers=N] [--label <text>] [--headless] [--cli <cli.js>] [--cmd "<run command>"] [--stage-json-source <path>] [--interval <ms>] [--status-every <ms>] [--ceiling-margin <ms>] [--strict] [--pretty]',
  notes: [
    'Start it as ONE background command per stage and wait for its completion notice; never poll it. The stage message is `update`.',
    'Freeze stops come only from watchdog.mjs FROZEN verdicts; a command that outlives PW_GLOBAL_TIMEOUT + margin is killed as an outer-ceiling stop.',
    'Freshness: every command needs a stage JSON newer than its start, or — after a stop — the watchdog file; otherwise the stage stops (FRESHNESS_FAILED).',
    'Exit code 0 by default; --strict maps COMPLETED 0 · STOPPED_* 1 · FRESHNESS_FAILED / SPAWN_FAILED / BLOCKED 2 · NOT_RUN 3.',
  ],
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const payload = await runStage(args);
  print(payload, args);
  return args.strict ? (STRICT_EXIT[payload.outcome] ?? 0) : 0;
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  main().then((code) => process.exit(code), (e) => {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'run-stage', schema: SCHEMA_VERSION, outcome: 'BLOCKED', reason: 'internal error: ' + e.message, errors: [e.stack || e.message] }, args);
    process.exit(args.strict ? 2 : 0);
  });
}
