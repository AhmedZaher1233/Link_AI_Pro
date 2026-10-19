#!/usr/bin/env node
// run-stage.mjs — runs ONE stage of a skill-5 run (setup / smoke / positive / negative): every
// run-plan group of that stage in plan order, one Playwright command per group (plus a burn-in
// command for healed tests and the automatic isolation check), each command monitored HERE —
// watchdog.mjs every --interval, the outer ceiling, the per-command freshness gate — and returns ONE
// compact JSON payload when the stage is over. Node >= 18, zero dependencies.
//
// The suite's one runner. It spawns the consumer project's Playwright, writes only under
// {results_root}/artifacts/ (stage-filtered group files `*.plan.json`, stage summaries
// `*.summary.json`; Playwright and the project's helpers write the stage JSONs, heartbeats and
// rate-limit records there) and appends to the run's progress log. Playwright's outputDir is ONE folder per
// command (artifacts/test-output/phase-{N}/{stage}-{group}[-attempt{n}]/ — Playwright wipes only its own), so
// a later command never deletes an earlier one's traces and failure screenshots; pruneOutput() bounds it per
// phase. The model starts it as ONE
// background command per stage and waits for the completion notice — it never polls it. The stage's
// chat message is `update`.
//
// Parallelism may change how long a stage takes, never a TC's status:
// - a FAIL from a command that ran tests side by side (workers > 1) is re-run ALONE (workers 1) after
//   the stage's commands — the isolation check; a pass alone is parallel interference, never a hidden
//   retry (the parallel attempt stays in the history); the tests that overlapped it run alone too;
// - a failure whose failing step saw the application refuse requests (429 / 503 + Retry-After, written
//   by helpers/network-guard.ts) is isolated after a cool-down; refused again → INCOMPLETE `rate_limited`;
// - refusals in a command slow the rest of the stage down (cool-down, fewer workers, scaled ceiling).
//
// Contract: references/execution.md (<live_progress>, <staged_execution>, <first_run>),
// references/final-run.md (<second_run> — the re-run), references/run-report.md §3 (file names),
// watchdog.mjs (freeze verdicts — imported, never re-derived here) and impact.mjs (the per-TC code
// fingerprint stored in every summary — imported lazily; a failure there never stops a stage).
//
// Usage:
//   node run-stage.mjs --run-file <results_root>/.runs/phase-N.json --stage setup|smoke|positive|negative
//        --run first|rerun --stage-tcs <TC,…> --ceilings <group=ms,…> --grace <ms> --log <progress log>
//        --project <browser project> --cwd <automation root> [--spec <file,…>] [--groups <name,…>]
//        [--tcs <TC,…>] [--burn-in <TC,…>] [--extra repeat-each=N,last-failed,workers=N]
//        [--cooldown <ms>] [--cooldown-max <ms>] [--label <text>] [--headless]
//        [--cli <playwright cli.js>] [--cmd "<run command>"] [--stage-json-source <path>]
//        [--interval 5000] [--status-every 30000] [--ceiling-margin <ms>] [--strict] [--pretty]
// Exit code 0 by default (the outcome is in the payload); --strict maps COMPLETED 0 · STOPPED_* 1 ·
// FRESHNESS_FAILED / SPAWN_FAILED / BLOCKED 2 · NOT_RUN 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, print, posix, read, isFile } from './scan-lib.mjs';
import { run as watchdogRun } from './watchdog.mjs';

export const SCHEMA_VERSION = 'skill5-run-stage/1';
export const SMOKE_GATE_LIMIT = 30;
export const BURN_IN_REPEATS = 3;
const ISOLATION_FLOOR = 3;          // the mass-failure breaker: more than max(3, 30 %) failures beside others → no isolation
const ISOLATION_SHARE = 0.3;
const STAGES = ['setup', 'smoke', 'positive', 'negative'];
const RUNS = ['first', 'rerun'];
const RUN_LABEL = { first: 'first run', rerun: 're-run' };
const STAGE_TAG = { setup: '@setup', smoke: '@smoke', positive: '@positive', negative: '@negative' };
const STAGE_WORD = { setup: 'Setup journeys', smoke: 'Smoke tests', positive: 'Positive tests', negative: 'Negative tests' };
export const ACTIVITY = { setup: 'Preparing Test Data — setup journeys', smoke: 'Running Smoke Tests', positive: 'Running Positive Tests', negative: 'Running Negative Tests' };
const EXTRA_ALLOWED = new Set(['repeat-each', 'last-failed', 'workers']);
const REFUSED_IN_CMD = /(^|\s)(--reporter|--config|-c|--grep|-g|--grep-invert|--project|--retries)(\s|=|$)/;
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;
const DLL_CRASH = /3221225794|0xC0000142/i;
const NO_TESTS = /no tests found/i;
const RATE_LIMIT_ERROR = /RateLimitWaitError/;
const STRICT_EXIT = { COMPLETED: 0, STOPPED_FROZEN: 1, STOPPED_CEILING: 1, FRESHNESS_FAILED: 2, SPAWN_FAILED: 2, BLOCKED: 2, NOT_RUN: 3 };
const OUTCOME_RANK = ['COMPLETED', 'STOPPED_FROZEN', 'STOPPED_CEILING', 'FRESHNESS_FAILED', 'SPAWN_FAILED', 'BLOCKED'];
const here = path.dirname(fileURLToPath(import.meta.url));

const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const slugOf = (name) => String(name).replace(/[:\s/\\]+/g, '-');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statSafe = (p) => { try { return fs.statSync(p); } catch { return null; } };
const readdirSafe = (d) => { try { return fs.readdirSync(d); } catch { return []; } };

// Playwright WIPES its outputDir before every command, so each command gets its own folder under
// {results_root}/artifacts/test-output/phase-{N}/ — a later command (the next group, the isolation check, a burn-in,
// the next stage, the re-run) can no longer delete the traces and failure screenshots of an earlier one while the
// heal still needs them. Bounded at every call: the folders of EARLIER phases (their investigation ended with the
// phase) and the loose entries of the pre-folder layout are removed, the current phase keeps its newest `keep`
// command folders, and a higher phase is never touched.
export const OUTPUT_KEEP = 100;
export function pruneOutput(base, phase, keep = OUTPUT_KEEP) {
  const removed = [];
  const rm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); removed.push(posix(path.relative(base, p))); } catch { /* held open — retried at the next call */ } };
  for (const e of readdirSafe(base)) {
    const m = e.match(/^phase-(\d+)$/);
    if (!m || Number(m[1]) < phase) rm(path.join(base, e));
  }
  const cur = path.join(base, 'phase-' + phase);
  const dirs = readdirSafe(cur).map((e) => ({ p: path.join(cur, e), st: statSafe(path.join(cur, e)) }))
    .filter((x) => x.st && x.st.isDirectory()).sort((x, y) => y.st.mtimeMs - x.st.mtimeMs);
  for (const x of dirs.slice(keep)) rm(x.p);
  return removed;
}
// --last-failed reads .last-run.json from the command's own (new) outputDir BEFORE Playwright wipes it: seed it with
// the newest one of the phase — the previous command's, as the old shared folder held it.
function seedLastRun(phaseDir, outDir) {
  const last = readdirSafe(phaseDir).map((e) => path.join(phaseDir, e, '.last-run.json')).map((p) => ({ p, st: statSafe(p) }))
    .filter((x) => x.st && x.p !== path.join(outDir, '.last-run.json')).sort((x, y) => y.st.mtimeMs - x.st.mtimeMs)[0];
  if (!last) return null;
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(last.p, path.join(outDir, '.last-run.json'));
  return last.p;
}
const iso = (ms) => new Date(ms).toISOString();
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const secs = (ms) => Math.round((ms || 0) / 100) / 10;
const uniq = (xs) => [...new Set(xs)];
const tcsOfField = (v) => (Array.isArray(v) ? v.map(String) : String(v || '').split(',').map((s) => s.trim()).filter(Boolean));
const jsonl = (file) => {
  const out = [];
  for (const line of (read(file) || '').split(/\r?\n/)) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped here; the watchdog judges the heartbeat */ } }
  return out;
};
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

// a raw Playwright JSON report → one row per test execution (the last result is the status of record);
// repeats of --repeat-each are numbered by order (the JSON carries no repeat index)
export function collectTests(report, resultsRoot) {
  const out = [];
  const walk = (suite, titles) => {
    const t = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      const seen = new Map();
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
        const rawErr = last && ((last.error && last.error.message) || ((last.errors || [])[0] && last.errors[0].message)) || null;
        const project = test.projectName || null;
        const repeat = seen.get(project) || 0;
        seen.set(project, repeat + 1);
        const annotations = [...(test.annotations || []), ...((last && last.annotations) || [])].map((x) => x && x.type).filter(Boolean);
        out.push({
          title: spec.title, file: spec.file || suite.file || null, line: spec.line || null, tags, suite: t.join(' > '),
          project, repeat, status, duration_ms: results.reduce((a, r) => a + (r.duration || 0), 0),
          tcs: tcIdsOf(spec.title), annotations,
          unverifiedAssumption: tags.includes('@unverified-assumption') || /@unverified-assumption/.test(spec.title),
          rateLimitError: !!(rawErr && RATE_LIMIT_ERROR.test(String(rawErr))),
          error: rawErr ? filterLine(String(rawErr).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 200) : null,
          screenshot: shot ? posix(path.relative(resultsRoot, shot.path)) : null,
        });
      }
    }
    for (const s of suite.suites || []) walk(s, t);
  };
  for (const s of (report && report.suites) || []) walk(s, []);
  return out;
}

// a test skipped with no skip / fixme annotation after a FAILED test of the same describe is a
// serial-chain follower Playwright skipped for us: NOT_RUN "not started: depends on …", never SKIP
export function markFollowers(tests) {
  const firstFail = new Map();
  for (const t of tests) {
    if (t.status === 'FAIL' && !firstFail.has(t.suite)) firstFail.set(t.suite, t.tcs[0] || t.title);
    else if (t.status === 'SKIP' && firstFail.has(t.suite) && !t.annotations.some((a) => /^(skip|fixme)$/i.test(a))) { t.status = 'NOT_RUN'; t.follower = firstFail.get(t.suite); }
  }
  return tests;
}

// the provisional status of one TC from its tests in one command (statuses of record come from the merge)
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

/* ---------------- rate limits ---------------- */

const matchOf = (r) => { let p = r.url || ''; try { p = new URL(r.url).pathname; } catch { /* already a path */ } return (r.method ? String(r.method).toUpperCase() + ' ' : '') + p; };

// network-guard records of one command: refusals and policy headers, by service
export function rateLimitRecords(file) {
  const refused = [];
  const policies = [];
  for (const r of jsonl(file)) {
    if (r.kind === 'policy') policies.push({ match: matchOf(r), limit: r.limit ?? null, remaining: r.remaining ?? null, reset: r.reset ?? null, window_s: r.window_s ?? null });
    else if (r.kind === 'refused' || r.status === 429) refused.push({ at: Date.parse(r.at), tcs: tcsOfField(r.tc), match: matchOf(r), status: r.status ?? null, retry_after_s: typeof r.retry_after_s === 'number' ? r.retry_after_s : null });
  }
  return { refused, policies };
}

export function cooldownFor(refused, defaultMs, maxMs) {
  if (!refused.length) return 0;
  const ra = refused.map((r) => r.retry_after_s).filter((x) => typeof x === 'number');
  return Math.min(ra.length ? Math.max(...ra) * 1000 : defaultMs, maxMs);
}

// the run plan's rate_limits[] + every `rate-limit` adjustment → the PW_RATE_LIMITS object
export function rateLimitsOf(plan, adjustments) {
  const out = {};
  for (const r of plan.rate_limits || []) if (r && r.service) out[r.service] = { match: r.match ?? null, limit: r.limit ?? null, window_s: r.window_s ?? null, pace: r.pace ?? null, scope: r.scope ?? null, at: r.at ?? null, calls_per_tc: r.calls_per_tc ?? null };
  for (const a of adjustments || []) if (a && a.kind === 'rate-limit' && a.service) out[a.service] = { ...(out[a.service] || {}), ...(a.to && typeof a.to === 'object' ? a.to : {}) };
  return out;
}

// append-only run_plan_adjustments[]: move a TC between groups, change a group's workers
export function applyAdjustments(plan, adjustments) {
  const p = JSON.parse(JSON.stringify(plan));
  const applied = [];
  for (const a of adjustments || []) {
    if (!a || typeof a !== 'object') continue;
    if (a.kind === 'move' && a.tc && a.to) {
      for (const g of p.groups) g.tcs = (g.tcs || []).filter((x) => x !== a.tc);
      let to = p.groups.find((g) => g.name === a.to);
      if (!to) { to = { name: a.to, mode: 'serial', workers: 1, tcs: [], reason: a.reason || 'moved by an adjustment' }; p.groups.push(to); }
      to.tcs.push(a.tc);
      applied.push(a);
    } else if (a.kind === 'workers' && a.group && Number(a.to) > 0) {
      const g = p.groups.find((x) => x.name === a.group);
      if (g) { g.workers = Number(a.to); applied.push(a); }
    } else if (a.kind === 'rate-limit' && a.service) applied.push(a);
  }
  return { plan: p, applied };
}

/* ---------------- messages ---------------- */

const phrase = (c) => c.passed + ' passed, ' + c.failed + ' failed, ' + c.skipped + ' skipped'
  + (c.incomplete ? ', ' + c.incomplete + ' incomplete' : '') + ', ' + c.notRun + ' not run'
  + (c.expectedFailures ? ', ' + c.expectedFailures + ' expected failure' + (c.expectedFailures === 1 ? '' : 's') : '');
const short = (c) => c.passed + ' passed · ' + c.failed + ' failed' + (c.skipped ? ' · ' + c.skipped + ' skipped' : '')
  + (c.notRun + c.incomplete ? ' · ' + (c.notRun + c.incomplete) + ' not run' : '');

// fail% over the smoke TCs WITH a verdict (NOT_RUN / INCOMPLETE are no verdict); none → classify
export function smokeGateOf(c) {
  const withVerdict = c.tcs - c.notRun - c.incomplete;
  if (withVerdict <= 0) return { failPct: null, limit: SMOKE_GATE_LIMIT, decision: 'classify', reason: 'no smoke verdict' };
  const failPct = Math.round((c.failed / withVerdict) * 1000) / 10;
  return { failPct, limit: SMOKE_GATE_LIMIT, decision: failPct <= SMOKE_GATE_LIMIT ? 'continue' : 'classify' };
}

const ids = (xs) => xs.join(', ');

// the stage's chat message — phase-wide cumulative; the model adds only what a script cannot know:
// the gate decision above the limit, defect classification, compliance status
export function buildUpdate({ run, stage, label, outcome, reason, call, cumulative, failures, notRun, blockers, evidenceDir, durationMs, isolation, rateLimit }) {
  const L = [];
  const runText = (RUN_LABEL[run] || run + ' run') + (label ? ', ' + label : '');
  const word = STAGE_WORD[stage];
  const stopped = outcome === 'BLOCKED' || outcome === 'SPAWN_FAILED' || outcome === 'FRESHNESS_FAILED';
  if (stopped) L.push(word + ' stopped (' + runText + '): ' + reason + '.');
  else if (stage === 'setup') L.push(word + ' completed (' + runText + '): ' + call.journeys.passed + ' passed, ' + call.journeys.failed + ' failed — ' + mmss(durationMs) + '.');
  else if (run === 'rerun') L.push(word + ' completed (' + runText + '): ' + plural(call.counts.tcs, 'TC') + ' re-run → ' + phrase(call.counts) + ' — ' + mmss(durationMs) + '.');
  else L.push(word + ' completed (' + runText + '): ' + phrase(call.counts) + ' — ' + plural(call.counts.tcs, 'TC') + ', ' + mmss(durationMs) + '.');
  if (failures.length) {
    const f = uniq(failures.flatMap((x) => x.tcs.length ? x.tcs : [x.title]));
    const ua = uniq(failures.filter((x) => x.unverifiedAssumption).flatMap((x) => x.tcs));
    L.push('Failed: ' + f.join(', ') + (ua.length ? ' (unverified assumption: ' + ua.join(', ') + ' — never an application bug)' : '') + '.');
  }
  if (notRun.length) {
    const byReason = new Map();
    for (const n of notRun) { const k = n.reason || 'not run'; if (!byReason.has(k)) byReason.set(k, []); byReason.get(k).push(n.tc); }
    L.push('Not run / incomplete: ' + [...byReason].map(([r, tcs]) => tcs.join(', ') + ' — ' + r).join('; ') + '.');
  }
  if (isolation && isolation.skipped) L.push('Isolation check skipped — ' + isolation.skipped + '; classify before trusting these failures (environment or application-wide).');
  else if (isolation && isolation.ran.length) {
    const parts = [isolation.passed_alone.length + ' passed alone' + (isolation.passed_alone.length ? ' (parallel interference: ' + ids(isolation.passed_alone) + ')' : ''),
      isolation.failed_alone.length + ' failed again' + (isolation.failed_alone.length ? ' (confirmed: ' + ids(isolation.failed_alone) + ')' : '')];
    if (isolation.rate_limited.length) parts.push(isolation.rate_limited.length + ' rate limited (' + ids(isolation.rate_limited) + ')');
    L.push('Isolation check: ' + plural(isolation.ran.length, 'TC') + ' re-run alone' + (isolation.cooldown_ms ? ' after a ' + secs(isolation.cooldown_ms) + ' s cool-down' : '') + ': ' + parts.join(', ') + '.');
    if (isolation.overlap_rerun.length) {
      const bad = isolation.overlap_failed_alone || [];
      L.push('Tests that ran beside them, re-run alone: ' + ids(isolation.overlap_rerun) + ' — ' + (bad.length ? ids(bad) + ' failed alone (the pass beside others was not a verdict)' : 'all passed') + '.');
    }
  }
  if (rateLimit && rateLimit.refused) {
    L.push('Rate limit: ' + rateLimit.services.map((s) => s.match + ' refused ' + s.count + '×' + (s.retry_after_max_s !== null ? ' (Retry-After ' + s.retry_after_max_s + ' s)' : '')).join('; ')
      + (rateLimit.adjustments.length ? ' → ' + rateLimit.adjustments.map((x) => 'cool-down ' + secs(x.cooldown_ms) + ' s, ' + x.group + ' workers ' + x.workers_from + ' → ' + x.workers_to).join('; ') : '') + '.');
  } else if (rateLimit && rateLimit.policies.length) {
    L.push('Rate-limit policy seen: ' + rateLimit.policies.map((p) => p.match + ' limit ' + p.limit + (p.window_s ? ' per ' + p.window_s + ' s' : '')).join('; ') + '.');
  }
  L.push('Blockers: ' + (blockers.length ? blockers.join('; ') : 'none') + '.');
  const st = cumulative.stages;
  if (stage === 'smoke') {
    if (cumulative.setup) L.push('Setup journeys: ' + cumulative.setup.passed + ' passed, ' + cumulative.setup.failed + ' failed.');
    if (!stopped && st.smoke) {
      const g = smokeGateOf(st.smoke);
      if (g.failPct === null) L.push('Smoke gate: no smoke verdict — classify before deciding.');
      else L.push('Smoke gate: ' + g.failPct + '% failed (limit ' + g.limit + '%) — ' + (g.decision === 'continue'
        ? 'Positive tests may continue.'
        : 'classify every smoke failure before deciding: heal and re-run the failed smoke TCs, or stop on an application-error majority.'));
    }
  } else if (stage === 'positive') {
    L.push('Phase so far: ' + ['smoke', 'positive'].filter((s) => st[s]).map((s) => s[0].toUpperCase() + s.slice(1) + ' ' + short(st[s])).join(' | ')
      + ' — combined ' + phrase(cumulative.total) + ' of ' + plural(cumulative.total.tcs, 'TC') + '.');
  } else if (stage === 'negative') {
    const t = cumulative.total;
    L.push('Phase totals: ' + ['smoke', 'positive', 'negative'].filter((s) => st[s]).map((s) => s[0].toUpperCase() + s.slice(1) + ' ' + short(st[s])).join(' | ')
      + ' — Passed ' + t.passed + ' · Failed ' + t.failed + ' · Skipped ' + t.skipped + ' · Not run ' + (t.notRun + t.incomplete)
      + (t.incomplete ? ' (' + t.incomplete + ' interrupted or rate limited)' : '') + ' of ' + plural(t.tcs, 'TC') + '.');
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
  for (const o of jsonl(resultsFile)) {
    const st = { passed: 'PASS', failed: 'FAIL', timedOut: 'FAIL', skipped: 'SKIP', interrupted: 'INCOMPLETE' }[o.status] || 'NOT_RUN';
    for (const tc of Array.isArray(o.tc) ? o.tc : []) done.set(tc, st);
    if (typeof o.duration_ms === 'number' && o.status !== 'skipped') durations.push(o.duration_ms);
  }
  return { done, avg: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, samples: durations.length };
}

/* ---------------- heartbeat reading for the isolation check ---------------- */

// [start, end] of each TC's test in one command (test-start → test-end)
function testIntervals(progressFile) {
  const open = new Map();
  const out = [];
  for (const r of jsonl(progressFile)) {
    if (r.event !== 'test-start' && r.event !== 'test-end') continue;
    const key = r.worker + '|' + r.tc;
    const at = Date.parse(r.at);
    if (r.event === 'test-start') open.set(key, at);
    else if (open.has(key)) { out.push({ tcs: tcsOfField(r.tc), start: open.get(key), end: at }); open.delete(key); }
  }
  for (const [key, start] of open) out.push({ tcs: tcsOfField(key.split('|').slice(1).join('|')), start, end: Infinity });
  return out;
}

// [start, end] of the step that failed for this TC (the last step that ended in error / timeout)
function failingStepWindow(progressFile, tc) {
  let start = null;
  let win = null;
  for (const r of jsonl(progressFile)) {
    if (!r.step || !tcsOfField(r.tc).includes(tc)) continue;
    if (r.event === 'start') start = Date.parse(r.at);
    else if (r.event === 'end' && (r.outcome === 'error' || r.outcome === 'timeout') && start !== null) win = { start, end: Date.parse(r.at) };
  }
  return win;
}

const SLACK_MS = 500;
function refusedInFailingStep(cmd, tc) {
  const win = failingStepWindow(cmd.progressFile, tc);
  if (!win) return [];
  return (cmd.rate ? cmd.rate.refused : []).filter((r) => r.tcs.includes(tc) && r.at >= win.start - SLACK_MS && r.at <= win.end + SLACK_MS);
}

/* ---------------- one command ---------------- */

async function runCommand(ctx, g, laterGroups) {
  const { log } = ctx;
  fs.mkdirSync(path.dirname(g.stageJson), { recursive: true });
  fs.mkdirSync(path.dirname(g.progressFile), { recursive: true });
  fs.writeFileSync(g.planFile, JSON.stringify({ name: g.name, mode: g.mode, workers: g.workers, stage: ctx.stage, command: g.kind, tcs: g.tcs }, null, 2) + '\n');
  try { fs.rmSync(ctx.rateLimitState + '.lock', { recursive: true, force: true }); } catch { /* a lock that cannot be removed is broken by the helper's stale-lock rule */ }
  const { grep, invert } = buildFilter({ stage: ctx.stage, group: g.name, tcs: g.onlyTcs });
  const pwArgs = ['test', ...g.specs, '--project=' + ctx.project, '--grep', grep];
  if (invert) pwArgs.push('--grep-invert', invert);
  pwArgs.push('--workers=' + g.workers, ...g.extraArgs);
  if (g.extraArgs.includes('--last-failed')) g.lastRunFrom = seedLastRun(ctx.outputPhaseDir, g.outputDir);
  const env = { ...process.env, PW_STAGE_JSON: g.stageJson, PW_PROGRESS_FILE: g.progressFile, PW_OUTPUT_DIR: g.outputDir,
    PW_GLOBAL_TIMEOUT: String(g.ceilingMs), PW_WORKERS: String(g.workers), PW_PHASE: String(ctx.phase), PW_STAGE_ATTEMPT: String(g.attempt),
    PW_RATE_LIMIT_FILE: g.rateLimitFile, PW_RATE_LIMIT_STATE: ctx.rateLimitState, PW_RATE_LIMITS: ctx.rateLimitsJson };
  if (ctx.headless) env.PW_HEADLESS = '1'; else delete env.PW_HEADLESS;
  let child;
  let spawnError = null;
  const shown = (ctx.cmd ? ctx.cmd : 'playwright') + ' ' + pwArgs.map((x) => (/\s|[|()]/.test(x) ? JSON.stringify(x) : x)).join(' ');
  g.command = shown;
  g.startedAt = Date.now();
  const what = g.kind === 'normal' ? '' : g.kind + ' · ';
  log(ctx.activity + ' · ' + g.name + ' (' + what + g.mode + ' ×' + g.workers + ', ' + (ctx.headless ? 'headless' : 'headed') + ') · start · '
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
    log(ctx.activity + ' · ' + g.name + ' (' + what + g.mode + ' ×' + g.workers + ') · ' + doneTcs.length + '/' + g.tcs.length + ' TCs done · stage ' + Math.min(100, Math.round((doneStage / planned) * 100))
      + '% · passed ' + n('PASS') + ' · failed ' + n('FAIL') + ' · skipped ' + n('SKIP') + ' · not run ' + (g.tcs.length - doneTcs.length)
      + ' · current ' + current + ' · elapsed ' + mmss(Date.now() - g.startedAt) + eta + ' · watchdog ' + (verdict || wd.verdict));
  };
  while (!exited) {
    await Promise.race([onExit, sleep(ctx.intervalMs)]);
    if (exited) break;
    const elapsed = Date.now() - g.startedAt;
    if (elapsed > g.ceilingMs + g.marginMs) {
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
  g.rate = rateLimitRecords(g.rateLimitFile);
  log(ctx.activity + ' · ' + g.name + ' · ' + what + 'end · exit ' + (exitInfo.code ?? exitInfo.signal ?? '—') + ' · ' + mmss(g.finishedAt - g.startedAt)
    + ' · freshness ' + g.freshness.gate + (g.freshness.reason ? ' (' + g.freshness.reason + ')' : '') + (g.source ? ' · source ' + g.source : '')
    + (g.rate.refused.length ? ' · ' + plural(g.rate.refused.length, 'refused request') : ''));
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

// statuses of one finished command: the stage JSON, or the watchdog reconstruction after a stop.
// A TC that ran through a test shared with a listed TC ("[TC-07][TC-08]") is recorded too.
function commandStatuses(ctx, g) {
  const tcs = {};
  const reasons = {};
  const failures = [];
  const journeys = { passed: 0, failed: 0, other: 0 };
  const unplanned = [];
  const rateLimitErrors = new Set();
  if (g.source === 'incremental+watchdog') {
    let file = null; try { file = JSON.parse(read(g.watchdogFile)); } catch { /* unreadable → everything below stays NOT_RUN */ }
    for (const c of (file && file.completed) || []) tcs[c.tc] = c.status;
    for (const i of (file && file.interrupted) || []) { tcs[i.tc] = 'INCOMPLETE'; reasons[i.tc] = i.reason; }
    for (const n of (file && file.not_started) || []) { tcs[n.tc] = 'NOT_RUN'; reasons[n.tc] = n.reason; }
    for (const c of (file && file.completed) || []) if (c.status === 'FAIL') failures.push({ tcs: [c.tc], title: c.title, group: g.name, status: 'FAIL', error: null, screenshot: null, unverifiedAssumption: false });
  } else if (g.source === 'json') {
    let report = null; try { report = JSON.parse(read(g.stageJson)); } catch { /* covered by the freshness gate */ }
    const tests = markFollowers(collectTests(report, ctx.resultsRoot));
    const per = {};
    for (const t of tests) {
      if (ctx.stage === 'setup' && !t.tcs.length) { if (t.status === 'PASS') journeys.passed++; else if (t.status === 'FAIL') journeys.failed++; else journeys.other++; }
      for (const tc of t.tcs) {
        if (!g.tcs.includes(tc) && !ctx.stageTcs.includes(tc) && !unplanned.includes(tc)) unplanned.push(tc);
        (per[tc] = per[tc] || []).push(t.status);
        if (t.follower) reasons[tc] = 'not started: depends on ' + t.follower + ' (failed)';
        if (t.rateLimitError) rateLimitErrors.add(tc);
      }
      if (t.status === 'FAIL') failures.push({ tcs: t.tcs, title: t.title, group: g.name, status: 'FAIL', error: t.error, screenshot: t.screenshot, unverifiedAssumption: t.unverifiedAssumption, repeat: t.repeat });
    }
    for (const [tc, list] of Object.entries(per)) tcs[tc] = aggregate(list);
  }
  for (const tc of g.tcs) if (!(tc in tcs)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = g.source === 'none' ? 'no test matched the stage filter — check its tags' : 'no result for this TC in the stage JSON'; }
  return { tcs, reasons, failures, journeys, unplanned, rateLimitErrors };
}

/* ---------------- the code fingerprint (impact.mjs, imported lazily — never fatal) ---------------- */

async function fingerprintCall(ctx, tcs) {
  try {
    const mod = await import(pathToFileURL(path.join(here, 'impact.mjs')).href);
    const fp = mod.fingerprintTests({ root: ctx.cwd, specs: ctx.fpSpecs, tcs, runPlan: ctx.plan });
    return { schema: fp.schema, tcs: fp.tcs || {}, tests: fp.tests || {}, files: fp.files || {}, warnings: fp.warnings || [], error: null };
  } catch (e) {
    return { schema: null, tcs: {}, tests: {}, files: {}, warnings: [], error: 'impact.mjs: ' + (e && e.message ? e.message : String(e)) };
  }
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
  if (run === 'final') errors.push('--run final was removed — the clean full re-run no longer exists: use --run rerun --tcs <the TCs impact.mjs select returns>');
  else if (!RUNS.includes(run)) errors.push('--run must be first | rerun');
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
  const burnIn = csv(a['burn-in']);
  const msFlag = (k, dflt) => { if (a[k] === undefined) return dflt; const v = Number(a[k]); if (!(v >= 0)) { errors.push('--' + k + ' must be milliseconds'); return dflt; } return v; };
  const cooldownMs = msFlag('cooldown', 60000);
  const cooldownMaxMs = msFlag('cooldown-max', 120000);
  const cmd = typeof a.cmd === 'string' ? a.cmd : null;
  if (cmd && REFUSED_IN_CMD.test(cmd)) errors.push('--cmd may not carry --reporter / --config / --grep / --project / --retries: the stage filter and the shared config are this script\'s');
  const graceMs = a.grace !== undefined && a.grace !== true ? Number(a.grace) : 60000;
  if (a.grace === undefined) warnings.push('no --grace: the watchdog uses 60 s — pass TIMEOUTS.watchdog_grace');
  if (Number.isNaN(graceMs) || graceMs < 0) errors.push('--grace must be milliseconds');
  if (errors.length) return { ...base, outcome: 'BLOCKED', reason: errors[0], errors, warnings };

  let runJson; try { runJson = JSON.parse(read(runFile)); } catch { runJson = null; }
  const rawPlan = runJson && (runJson.run_plan || (Array.isArray(runJson.groups) ? runJson : null));
  if (!rawPlan || !Array.isArray(rawPlan.groups)) return { ...base, outcome: 'BLOCKED', reason: 'the run file has no run_plan.groups[] — write {run_file}.run_plan first', errors: ['no run_plan'], warnings };
  const adjustments = Array.isArray(runJson.run_plan_adjustments) ? runJson.run_plan_adjustments : [];
  const { plan, applied } = applyAdjustments(rawPlan, adjustments);
  const rateLimits = rateLimitsOf(plan, adjustments);
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
  const notInCall = burnIn.filter((tc) => !groups.some((g) => g.tcs.includes(tc)));
  if (notInCall.length) warnings.push('--burn-in names TCs this call does not run: ' + notInCall.join(', '));

  const stagesDir = path.join(resultsRoot, 'artifacts', 'stages');
  const progressDir = path.join(resultsRoot, 'artifacts', 'progress');
  let cliPath = null;
  if (!cmd) {
    const candidates = typeof a.cli === 'string' ? [path.resolve(cwd, a.cli)] : [path.join(cwd, 'node_modules', '@playwright', 'test', 'cli.js'), path.join(cwd, 'node_modules', 'playwright', 'cli.js')];
    cliPath = candidates.find((p) => isFile(p)) || null;
  }
  const specs = csv(a.spec);
  if (!specs.length && stage !== 'setup') warnings.push('no --spec: the whole automation project is filtered by tags only');
  for (const g of groups) if (!g.specs) g.specs = specs;
  const activity = ACTIVITY[stage] + ' (' + RUN_LABEL[run] + (label ? ' — ' + label : '') + ')';
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.mkdirSync(progressDir, { recursive: true });
  const log = (msg, raw) => { try { fs.appendFileSync(logPath, (raw ? msg : new Date().toISOString() + ' · ' + msg) + '\n'); } catch { /* the payload still carries everything */ } };

  // Playwright output: one folder per command under the phase; earlier phases and the old flat layout pruned now
  const outputBase = path.join(resultsRoot, 'artifacts', 'test-output');
  const outputPhaseDir = path.join(outputBase, 'phase-' + (phase || 0));
  const outputPruned = pruneOutput(outputBase, phase || 0);
  const trimmed = outputPruned.filter((p) => p.startsWith('phase-' + (phase || 0) + '/'));
  if (outputPruned.length) log(activity + ' · test-output · removed ' + plural(outputPruned.length, 'folder') + ' of earlier phases / the old flat layout'
    + (trimmed.length ? ' and the oldest ' + trimmed.length + ' of this phase (more than ' + OUTPUT_KEEP + ')' : ''));
  if (trimmed.length) warnings.push('test-output: this phase holds more than ' + OUTPUT_KEEP + ' command folders — the oldest ' + trimmed.length + ' (traces, failure screenshots) were removed');

  // commands: per group a normal command (its TCs minus the burn-in ones) and a burn-in command
  const reserved = new Map();
  const allocate = (g) => {
    const stem = stage + '-' + slugOf(g.name);
    let max = reserved.get(stem) || 0;
    // the output folders count too: an attempt number — and so a folder Playwright would wipe — is never reused
    for (const f of [...readdirSafe(stagesDir), ...readdirSafe(progressDir), ...readdirSafe(outputPhaseDir)]) {
      if (!f.startsWith(stem)) continue;
      const rest = f.slice(stem.length);
      const m = rest.match(/^-attempt(\d+)(\.|$)/);
      if (m) max = Math.max(max, Number(m[1])); else if (/^(\.|$)/.test(rest)) max = Math.max(max, 1);
    }
    g.attempt = max + 1;
    reserved.set(stem, g.attempt);
    const fileStem = g.attempt === 1 ? stem : stem + '-attempt' + g.attempt;
    g.stageJson = path.join(stagesDir, fileStem + '.json');
    g.progressFile = path.join(progressDir, fileStem + '.jsonl');
    g.resultsFile = path.join(progressDir, fileStem + '.results.jsonl');
    g.watchdogFile = path.join(progressDir, fileStem + '.watchdog.json');
    g.planFile = path.join(progressDir, fileStem + '.plan.json');
    g.rateLimitFile = path.join(progressDir, fileStem + '.ratelimit.jsonl');
    g.outputDir = path.join(outputPhaseDir, fileStem);
  };
  const scaled = (g, k) => Math.round(g.ceilingMs * Math.max(1, (k * g.workers) / Math.max(1, g.tcs.length)));
  const commands = [];
  for (const g of groups) {
    const burn = g.tcs.filter((tc) => burnIn.includes(tc));
    const normal = g.tcs.filter((tc) => !burn.includes(tc));
    if (normal.length || stage === 'setup') commands.push({ ...g, kind: 'normal', tcs: normal, onlyTcs: onlyTcs.length || burn.length ? normal : null, extraArgs: extraArgs.slice(), group: g });
    if (burn.length) commands.push({ ...g, kind: 'burn-in', workers: 1, tcs: burn, onlyTcs: burn, extraArgs: ['--repeat-each=' + BURN_IN_REPEATS], ceilingMs: scaled(g, burn.length) * BURN_IN_REPEATS, group: g });
  }

  const ctx = {
    a, stage, run, label, activity, resultsRoot, cwd, phase, project, specs, cmd, cliPath, stageTcs, plan, outputPhaseDir,
    fpSpecs: uniq([...specs, ...((plan.setup_groups || []).map((s) => s.spec).filter(Boolean))]),
    rateLimitState: path.join(progressDir, 'rate-limit.state.json'), rateLimitsJson: JSON.stringify(rateLimits),
    headless: a.headless === true || a.headless === 'true', graceMs, stageJsonSource: typeof a['stage-json-source'] === 'string' ? a['stage-json-source'] : null,
    intervalMs: Number(a.interval) > 0 ? Number(a.interval) : 5000, statusEveryMs: Number(a['status-every']) > 0 ? Number(a['status-every']) : 30000,
    flags: { watchdogTrusted: true, windowsDllInitCrash: false, watchdogUnreadable: false }, warnings, log, current: null,
    plannedTotal: commands.reduce((s, g) => s + g.tcs.length, 0), doneBefore: 0,
  };
  ctx.freezeKills = watchdogSane();
  if (!ctx.freezeKills) { ctx.flags.watchdogTrusted = false; warnings.push('the watchdog failed its sanity check — freeze stops are disabled for this stage; only the outer ceiling applies and every stop is recorded unresolved'); }
  const stopSignals = () => { if (ctx.current) killTree(ctx.current); log(activity + ' · interrupted by a signal — the running command was stopped'); process.exit(130); };
  process.once('SIGINT', stopSignals);
  process.once('SIGTERM', stopSignals);

  const startedAt = Date.now();
  const callTcs = uniq(commands.flatMap((g) => g.tcs));
  const codeStart = stage === 'setup' ? null : await fingerprintCall(ctx, callTcs);
  if (codeStart && codeStart.error) warnings.push('code fingerprint unavailable (' + codeStart.error + ') — every TC of this call will read as stale to impact.mjs select');
  log(activity + ' · stage start · ' + (commands.length ? commands.map((g) => g.name + (g.kind === 'normal' ? '' : ' ' + g.kind) + ' ×' + g.workers + ' (' + plural(g.tcs.length, 'TC') + ')').join(', ') : 'no group has TCs in this stage')
    + (skippedGroups.length ? ' · skipped: ' + skippedGroups.map((s) => s.name).join(', ') : '') + ' · results ' + posix(resultsRoot));
  for (const s of skippedGroups) log(activity + ' · ' + s.name + ' · skipped — ' + s.reason);

  const ran = [];
  const notRunGroups = [];
  let outcome = 'COMPLETED';
  let reason = null;
  const rateAdjustments = [];
  const cooldowns = [];
  let pendingCooldown = 0;
  let refusalSeen = false;
  const exec = async (g, later) => {
    if (!cliPath && !cmd) {
      g.spawnError = 'Playwright CLI entry not found under ' + posix(cwd) + '/node_modules (@playwright/test/cli.js) — pass --cli or --cmd';
    } else {
      allocate(g);
      // a ceiling margin of max(60 s, 10 %) unless given — Playwright stops itself at its ceiling first
      g.marginMs = Number(a['ceiling-margin']) >= 0 && a['ceiling-margin'] !== undefined ? Number(a['ceiling-margin']) : Math.max(60000, Math.round(g.ceilingMs * 0.1));
      await runCommand(ctx, g, later);
      ctx.doneBefore += g.tcs.length;
    }
    ran.push(g);
    if (g.spawnError) { outcome = 'SPAWN_FAILED'; reason = g.name + ': ' + g.spawnError; log(activity + ' · ' + g.name + ' · SPAWN FAILED — ' + g.spawnError); }
    else if (g.freshness.gate === 'FAIL') { outcome = 'FRESHNESS_FAILED'; reason = g.name + ': ' + g.freshness.reason; }
    else if (g.stop) {
      const o = g.stop.kind === 'ceiling' ? 'STOPPED_CEILING' : 'STOPPED_FROZEN';
      if (OUTCOME_RANK.indexOf(o) > OUTCOME_RANK.indexOf(outcome)) outcome = o;
    }
    return outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED';
  };
  const stopRest = (rest, g) => {
    const why = outcome === 'SPAWN_FAILED' ? 'not started: Playwright could not be started' : 'not started: the stage stopped after the freshness gate failed in ' + g.name;
    for (const r of rest) notRunGroups.push({ name: r.name, tcs: r.tcs, reason: why });
  };

  for (let i = 0; i < commands.length; i++) {
    const g = commands[i];
    if (refusalSeen) {
      // the application refused requests earlier in this stage: cool down, then fewer workers and a scaled ceiling
      const adj = { after: ran.length ? ran[ran.length - 1].name : null, group: g.name, command: g.kind, workers_from: g.workers, workers_to: g.workers, ceiling_from: g.ceilingMs, ceiling_to: g.ceilingMs, cooldown_ms: pendingCooldown };
      if (g.workers > 1) { const w = Math.max(1, Math.floor(g.workers / 2)); g.ceilingMs = Math.round(g.ceilingMs * (g.workers / w)); g.workers = w; adj.workers_to = w; adj.ceiling_to = g.ceilingMs; }
      if (pendingCooldown) { log(activity + ' · rate limit · cool-down ' + secs(pendingCooldown) + ' s before ' + g.name); cooldowns.push(pendingCooldown); await sleep(pendingCooldown); pendingCooldown = 0; }
      if (adj.cooldown_ms || adj.workers_to !== adj.workers_from) rateAdjustments.push(adj);
    }
    const ok = await exec(g, commands.slice(i + 1));
    if (!ok) { stopRest(commands.slice(i + 1), g); break; }
    if (g.rate && g.rate.refused.length) { refusalSeen = true; pendingCooldown = Math.max(pendingCooldown, cooldownFor(g.rate.refused, cooldownMs, cooldownMaxMs)); }
  }

  /* ---- statuses, command by command (a later command that produced a result wins for its TCs) ---- */
  const tcs = {};
  const reasons = {};
  const lastCmd = {};
  const executed = {};
  const perCmd = new Map();
  const journeys = { passed: 0, failed: 0, other: 0 };
  const journeysByGroup = {};
  const blockers = [];
  const absorb = (g) => {
    if (g.spawnError) { for (const tc of g.tcs) if (!(tc in tcs)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = 'not started: Playwright could not be started'; } blockers.push('Playwright could not be started for ' + g.name + ' — ' + g.spawnError); return; }
    if (g.freshness.gate === 'FAIL') { for (const tc of g.tcs) { tcs[tc] = 'NOT_RUN'; reasons[tc] = 'freshness gate failed — results not trusted'; } blockers.push('freshness gate failed in ' + g.name + ' (' + g.freshness.reason + ') — fix the reporting step and re-run the stage'); return; }
    const r = commandStatuses(ctx, g);
    perCmd.set(g, r);
    for (const [tc, s] of Object.entries(r.tcs)) {
      if (s === 'NOT_RUN' && tc in tcs && tcs[tc] !== 'NOT_RUN') continue;
      tcs[tc] = s;
      if (r.reasons[tc]) reasons[tc] = r.reasons[tc]; else delete reasons[tc];
      lastCmd[tc] = g;
      if (s !== 'NOT_RUN') executed[tc] = { status: s, command: g.kind, attempt: g.attempt, group: g.name };
    }
    journeys.passed += r.journeys.passed; journeys.failed += r.journeys.failed; journeys.other += r.journeys.other;
    if (stage === 'setup') journeysByGroup[g.name] = { passed: r.journeys.passed, failed: r.journeys.failed, other: r.journeys.other };
    if (r.unplanned.length) warnings.push(g.name + ': executed but not in --stage-tcs: ' + r.unplanned.join(', ') + ' — check the stage tags against the document');
    if (g.source === 'none') warnings.push(g.name + ': no test matched the stage filter although the plan lists ' + plural(g.tcs.length, 'TC') + ' — check the @run / stage tags');
  };
  for (const g of ran) absorb(g);

  /* ---- the isolation check: a failure beside other tests is not a verdict until the TC ran alone ---- */
  const isolation = { ran: [], passed_alone: [], failed_alone: [], rate_limited: [], overlap_rerun: [], overlap_failed_alone: [], skipped: null, cooldown_ms: 0 };
  const interference = [];
  const stageAlive = outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED';
  const refusedOf = (g, tc) => (perCmd.get(g) && perCmd.get(g).rateLimitErrors.has(tc) ? [{ match: 'RateLimitWaitError', tcs: [tc], retry_after_s: null }] : []).concat(refusedInFailingStep(g, tc));
  if (stageAlive && stage !== 'setup') {
    const candidates = [];
    const besideOthers = new Set();
    for (const g of ran) if (g.kind === 'normal' && g.workers > 1 && perCmd.has(g)) for (const tc of g.tcs) besideOthers.add(tc);
    for (const [tc, s] of Object.entries(tcs)) {
      const g = lastCmd[tc];
      if (s !== 'FAIL' || !g || g.kind === 'isolation') continue;
      const inStep = refusedOf(g, tc);
      if ((g.kind === 'normal' && g.workers > 1) || inStep.length) candidates.push({ tc, g, refused: inStep });
    }
    const parallelFailed = candidates.filter((c) => c.g.workers > 1).length;
    const limit = Math.max(ISOLATION_FLOOR, Math.ceil(ISOLATION_SHARE * besideOthers.size));
    if (parallelFailed > limit) {
      isolation.skipped = 'mass failure: ' + parallelFailed + ' of ' + besideOthers.size + ' TCs that ran beside others failed';
      blockers.push('isolation check skipped — ' + isolation.skipped + ' (environment or application-wide?)');
      for (const c of candidates) if (c.refused.length) { tcs[c.tc] = 'INCOMPLETE'; reasons[c.tc] = 'rate_limited: ' + uniq(c.refused.map((r) => r.match)).join(', ') + ' refused (not isolated: mass failure)'; isolation.rate_limited.push(c.tc); }
    } else if (candidates.length) {
      const allRefused = ran.flatMap((g) => (g.rate ? g.rate.refused : []));
      const cd = Math.max(pendingCooldown, cooldownFor(allRefused, cooldownMs, cooldownMaxMs));
      if (cd) { log(activity + ' · isolation check · cool-down ' + secs(cd) + ' s (rate limit)'); cooldowns.push(cd); await sleep(cd); }
      isolation.cooldown_ms = cd;
      const byGroup = new Map();
      for (const c of candidates) { const k = c.g.group || c.g; if (!byGroup.has(k)) byGroup.set(k, { base: c.g, list: [] }); byGroup.get(k).list.push(c); }
      const iso = [];
      for (const [, { base, list }] of byGroup) {
        const ts = uniq(list.map((c) => c.tc));
        iso.push({ ...base.group, kind: 'isolation', workers: 1, tcs: ts, onlyTcs: ts, extraArgs: [], ceilingMs: scaled(base.group || base, ts.length), group: base.group || base, from: list });
      }
      for (let i = 0; i < iso.length; i++) {
        const g = iso[i];
        const ok = await exec(g, iso.slice(i + 1));
        if (!ok) { stopRest(iso.slice(i + 1), g); break; }
        absorb(g);
        for (const c of g.from) {
          isolation.ran.push(c.tc);
          const s = tcs[c.tc];
          const again = refusedOf(g, c.tc);
          if (s === 'PASS') { isolation.passed_alone.push(c.tc); interference.push({ tc: c.tc, kind: 'failed-beside-passed-alone', group: c.g.name, parallel_attempt: c.g.attempt, isolated_attempt: g.attempt, refused_before: c.refused.length, overlapped: [] }); }
          else if (s === 'FAIL' && again.length) { tcs[c.tc] = 'INCOMPLETE'; reasons[c.tc] = 'rate_limited: ' + uniq(again.map((r) => r.match)).join(', ') + ' refused when run alone' + (cd ? ' after a ' + secs(cd) + ' s cool-down' : ''); isolation.rate_limited.push(c.tc); }
          else if (s === 'FAIL') isolation.failed_alone.push(c.tc);
        }
      }
      // the tests that ran beside an interfered TC: their pass is re-checked alone (a false PASS guard)
      const overlap = new Map();
      for (const e of interference) {
        const src = ran.find((x) => x.kind === 'normal' && x.name === e.group && x.attempt === e.parallel_attempt);
        if (!src) continue;
        const spans = testIntervals(src.progressFile);
        const mine = spans.filter((s) => s.tcs.includes(e.tc));
        const others = uniq(spans.filter((s) => !s.tcs.includes(e.tc) && mine.some((m) => s.start < m.end && m.start < s.end)).flatMap((s) => s.tcs))
          .filter((tc) => tcs[tc] === 'PASS' && !isolation.ran.includes(tc) && src.tcs.concat(ctx.stageTcs).includes(tc));
        e.overlapped = others;
        if (!others.length) continue;
        if (!overlap.has(src.group || src)) overlap.set(src.group || src, { base: src, list: [] });
        overlap.get(src.group || src).list.push(...others);
      }
      const ov = [];
      for (const [, { base, list }] of overlap) { const ts = uniq(list).filter((tc) => !ov.some((x) => x.tcs.includes(tc))); if (ts.length) ov.push({ ...base.group, kind: 'isolation', workers: 1, tcs: ts, onlyTcs: ts, extraArgs: [], ceilingMs: scaled(base.group || base, ts.length), group: base.group || base }); }
      for (let i = 0; i < ov.length && outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED'; i++) {
        const g = ov[i];
        const ok = await exec(g, ov.slice(i + 1));
        if (!ok) { stopRest(ov.slice(i + 1), g); break; }
        absorb(g);
        for (const tc of g.tcs) {
          isolation.overlap_rerun.push(tc);
          if (tcs[tc] === 'FAIL') { isolation.overlap_failed_alone.push(tc); interference.push({ tc, kind: 'passed-beside-failed-alone', group: g.name, isolated_attempt: g.attempt }); }
        }
      }
    }
  }
  process.removeListener('SIGINT', stopSignals);
  process.removeListener('SIGTERM', stopSignals);

  /* ---- events, failures of record, counts ---- */
  const mergedStages = [];
  const watchdogEvents = [];
  const timeoutEvents = [];
  const requeue = [];
  const relr = (p) => posix(path.relative(resultsRoot, p));
  for (const g of ran) {
    if (g.spawnError || !g.freshness || g.freshness.gate === 'FAIL') continue;
    mergedStages.push({ name: stage, group: g.name, command: g.kind, attempt: g.attempt, project, json_path: g.source === 'json' ? relr(g.stageJson) : null,
      started_at: iso(g.startedAt), finished_at: iso(g.finishedAt), source: g.source, ...(g.source === 'incremental+watchdog' ? { watchdog_path: relr(g.watchdogFile) } : {}) });
    if (g.stop) {
      const again = g.tcs.filter((tc) => tcs[tc] === 'INCOMPLETE' || tcs[tc] === 'NOT_RUN');
      if (again.length && g.kind === 'normal') requeue.push({ group: g.name, tcs: again, after: 'the heal — in the re-run' });
      if (g.stop.kind === 'watchdog') {
        for (const f of g.stop.frozen || []) {
          watchdogEvents.push({ stage, group: g.name, worker: f.worker, tc: f.tc, step: f.step, elapsed_ms: f.elapsed_ms, deadline_ms: f.deadline_ms, action: 'stopped' });
          timeoutEvents.push({ tc: f.tc, step: f.step, elapsed_ms: f.elapsed_ms, deadline_ms: f.deadline_ms, expected: f.expected, kind: 'watchdog', evidence: relr(g.progressFile) });
        }
        const f = (g.stop.frozen || [])[0];
        blockers.push('watchdog stop in ' + g.name + (f ? ': ' + f.tc + ' froze in step "' + f.step + '"' : '') + ' — timeout_failure; re-queued in the re-run after the heal');
      } else {
        watchdogEvents.push({ stage, group: g.name, worker: null, tc: null, step: null, elapsed_ms: g.stop.elapsed_ms, deadline_ms: g.ceilingMs, action: 'ceiling-stop' });
        timeoutEvents.push({ tc: null, step: null, elapsed_ms: g.stop.elapsed_ms, deadline_ms: g.ceilingMs, expected: null, kind: 'ceiling', evidence: relr(g.progressFile) });
        blockers.push('outer ceiling stop in ' + g.name + ' — Playwright did not stop at its own ceiling (timeout_failure)');
      }
    }
    if (g.dllCrash) blockers.push('worker crash 0xC0000142 in ' + g.name + ' — environment_failure, never an application or test defect');
  }
  for (const n of notRunGroups) for (const tc of n.tcs) if (!(tc in tcs) || tcs[tc] === 'NOT_RUN') { tcs[tc] = 'NOT_RUN'; reasons[tc] = n.reason; }
  for (const tc of inNoGroup) if (!onlyTcs.length || onlyTcs.includes(tc)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = 'in no run-plan group'; }
  if (!ctx.flags.watchdogTrusted) blockers.push('watchdog untrusted this stage — only the outer ceiling applied');
  if (ctx.flags.watchdogUnreadable) blockers.push('a heartbeat could not be read — only the outer ceiling applied there');
  // failures of record: from the command that last produced each failed TC's result
  const failures = [];
  for (const g of ran) {
    const r = perCmd.get(g);
    if (!r) continue;
    for (const f of r.failures) if (!f.tcs.length || f.tcs.some((tc) => lastCmd[tc] === g && tcs[tc] === 'FAIL')) failures.push(f);
  }
  const counts = countOf(tcs);
  const notRun = Object.entries(tcs).filter(([, s]) => s === 'NOT_RUN' || s === 'INCOMPLETE').map(([tc, s]) => ({ tc, status: s, reason: reasons[tc] || null }));

  const services = new Map();
  const policies = new Map();
  for (const g of ran) {
    for (const r of (g.rate ? g.rate.refused : [])) {
      const s = services.get(r.match) || { match: r.match, count: 0, retry_after_max_s: null, tcs: [] };
      s.count++;
      if (typeof r.retry_after_s === 'number') s.retry_after_max_s = Math.max(s.retry_after_max_s ?? 0, r.retry_after_s);
      s.tcs = uniq([...s.tcs, ...r.tcs]);
      services.set(r.match, s);
    }
    for (const p of (g.rate ? g.rate.policies : [])) if (!policies.has(p.match)) policies.set(p.match, p);
  }
  const rateLimit = { refused: [...services.values()].reduce((s, x) => s + x.count, 0), services: [...services.values()], policies: [...policies.values()], cooldowns_ms: cooldowns, adjustments: rateAdjustments, limits: rateLimits };

  /* ---- the code fingerprint at the end: an edit during the call makes its TCs stale ---- */
  let code = null;
  if (codeStart) {
    const end = await fingerprintCall(ctx, callTcs);
    const endTcs = Object.fromEntries(Object.entries(end.tcs).map(([tc, v]) => [tc, v.fingerprint]));
    const changed = codeStart.error || end.error ? [] : callTcs.filter((tc) => (codeStart.tcs[tc] && codeStart.tcs[tc].fingerprint) !== endTcs[tc]);
    code = { schema: codeStart.schema, tcs: codeStart.tcs, tests: codeStart.tests, files: codeStart.files, end_tcs: endTcs, changed_during_call: changed, error: codeStart.error || end.error || null, warnings: codeStart.warnings };
    if (changed.length) warnings.push('code changed while the stage ran — stale for impact.mjs select: ' + changed.join(', '));
  }

  /* ---- the summary file + the cumulative view of this phase ---- */
  const prefix = run + '-' + stage + '-';
  const seq = 1 + readdirSafe(progressDir).filter((f) => f.startsWith(prefix) && f.endsWith('.summary.json')).length;
  const summaryFile = path.join(progressDir, prefix + seq + '.summary.json');
  const finishedAt = Date.now();
  const summary = {
    tool: 'run-stage', schema: SCHEMA_VERSION, run, stage, seq, label, phase, activity, outcome, reason,
    startedAt: iso(startedAt), finishedAt: iso(finishedAt), durationMs: finishedAt - startedAt,
    plannedTcs: callTcs, tcs, reasons, executed, counts, journeys: stage === 'setup' ? journeys : undefined, journeysByGroup: stage === 'setup' ? journeysByGroup : undefined,
    failures, notRun, isolation, interference, rateLimit, burnIn,
    groups: ran.map((g) => ({ name: g.name, command: g.kind, mode: g.mode, workers: g.workers, attempt: g.attempt || null, tcs: g.tcs, onlyTcs: g.onlyTcs || null, extra: g.extraArgs, ceilingMs: g.ceilingMs, playwright: g.command || null,
      stageJson: g.stageJson ? relr(g.stageJson) : null, progressFile: g.progressFile ? relr(g.progressFile) : null, resultsFile: g.resultsFile ? relr(g.resultsFile) : null,
      rateLimitFile: g.rateLimitFile ? relr(g.rateLimitFile) : null, watchdogFile: g.stop ? relr(g.watchdogFile) : null, planFile: g.planFile ? relr(g.planFile) : null,
      outputDir: g.outputDir ? relr(g.outputDir) : null, lastRunFrom: g.lastRunFrom ? relr(g.lastRunFrom) : undefined,
      exit: g.exit || null, startedAt: g.startedAt ? iso(g.startedAt) : null, finishedAt: g.finishedAt ? iso(g.finishedAt) : null,
      durationMs: g.finishedAt ? g.finishedAt - g.startedAt : 0, freshness: g.freshness || { gate: 'FAIL', reason: g.spawnError }, source: g.source || null,
      refused: g.rate ? g.rate.refused.length : 0, stop: g.stop ? { kind: g.stop.kind, reason: g.stop.reason, verdict: g.stop.verdict } : null })),
    skippedGroups, notRunGroups, requeue, adjustments_applied: applied, merged_stages: mergedStages, watchdog_events: watchdogEvents, timeout_events: timeoutEvents, output_pruned: outputPruned,
    smokeGate: stage === 'smoke' ? smokeGateOf(counts) : undefined, flags: ctx.flags, warnings, code,
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  const cumulative = cumulativeOf(progressDir);
  if (stage === 'smoke' && cumulative.stages.smoke) summary.smokeGate = smokeGateOf(cumulative.stages.smoke);
  const relCwd = posix(path.relative(cwd, resultsRoot));
  const evidenceDir = /^reports\//.test(relCwd) ? 'screenshots/' + relCwd.slice('reports/'.length) + '/phase-' + phase + '/' : null;
  summary.cumulative = cumulative;
  summary.update = buildUpdate({ run, stage, label, outcome, reason, call: { counts, journeys }, cumulative, failures, notRun, blockers, evidenceDir, durationMs: finishedAt - startedAt, isolation, rateLimit });
  summary.blockers = blockers;
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  log(activity + ' · stage end · ' + outcome + ' · ' + summary.update.split('\n')[0]);

  // stdout stays small: what the stage message and the next decision need; the rest is in the summary
  return {
    ...base, activity, phase, outcome, reason, durationMs: summary.durationMs, counts,
    failures: failures.slice(0, 20).map((f) => ({ tcs: f.tcs, title: f.title ? f.title.slice(0, 120) : null, group: f.group, error: f.error, screenshot: f.screenshot, unverifiedAssumption: f.unverifiedAssumption || undefined })),
    notRun: notRun.slice(0, 40), smokeGate: summary.smokeGate,
    isolation, interference, rateLimit: { refused: rateLimit.refused, services: rateLimit.services, policies: rateLimit.policies, cooldowns_ms: cooldowns, adjustments: rateAdjustments },
    code: code ? { tcs: Object.keys(code.tcs).length, changed_during_call: code.changed_during_call, error: code.error } : null,
    groups: summary.groups.map((g) => ({ name: g.name, command: g.command, attempt: g.attempt, workers: g.workers, tcs: g.tcs.length, source: g.source, freshness: g.freshness.gate, stop: g.stop ? g.stop.kind : null, exit: g.exit ? g.exit.code : null, outputDir: g.outputDir })),
    skippedGroups, notRunGroups: notRunGroups.map((n) => ({ name: n.name, tcs: n.tcs.length, reason: n.reason })), requeue, blockers,
    flags: ctx.flags, warnings, update: summary.update, summaryFile: relr(summaryFile), log: posix(logPath),
  };
}

// every stage summary of this PHASE (first run and re-run), ordered by start time; per TC the latest
// result wins (a later NOT_RUN never erases an earlier verdict — impact.mjs decides staleness)
export function cumulativeOf(progressDir) {
  const files = readdirSafe(progressDir).filter((f) => /^(first|rerun)-[a-z]+-\d+\.summary\.json$/.test(f));
  const parsed = files.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(progressDir, f), 'utf8')); } catch { return null; } }).filter(Boolean)
    .sort((x, y) => (Date.parse(x.startedAt) || 0) - (Date.parse(y.startedAt) || 0) || (x.seq || 0) - (y.seq || 0));
  const maps = {};
  const setupByGroup = {};
  for (const s of parsed) {
    if (s.stage === 'setup') {
      const by = s.journeysByGroup || { [s.seq + '']: s.journeys || { passed: 0, failed: 0 } };
      for (const [k, v] of Object.entries(by)) setupByGroup[k] = v;
      continue;
    }
    const m = (maps[s.stage] = maps[s.stage] || {});
    for (const [tc, st] of Object.entries(s.tcs || {})) if (st !== 'NOT_RUN' || !(tc in m)) m[tc] = st;
  }
  const setupGroups = Object.values(setupByGroup);
  const setup = setupGroups.length ? setupGroups.reduce((acc, v) => ({ passed: acc.passed + (v.passed || 0), failed: acc.failed + (v.failed || 0) }), { passed: 0, failed: 0 }) : null;
  const stages = {};
  const all = {};
  for (const st of ['smoke', 'positive', 'negative']) if (maps[st]) { stages[st] = countOf(maps[st]); Object.assign(all, maps[st]); }
  return { stages, total: countOf(all), setup };
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'run-stage',
  usage: 'node run-stage.mjs --run-file <.runs/phase-N.json> --stage setup|smoke|positive|negative --run first|rerun --stage-tcs <TC,…> --ceilings <group=ms,…> --grace <ms> --log <progress log> --project <name> --cwd <automation root> [--spec <file,…>] [--groups <name,…>] [--tcs <TC,…>] [--burn-in <TC,…>] [--extra repeat-each=N,last-failed,workers=N] [--cooldown <ms>] [--cooldown-max <ms>] [--label <text>] [--headless] [--cli <cli.js>] [--cmd "<run command>"] [--stage-json-source <path>] [--interval <ms>] [--status-every <ms>] [--ceiling-margin <ms>] [--strict] [--pretty]',
  notes: [
    'Start it as ONE background command per stage and wait for its completion notice; never poll it. The stage message is `update`.',
    '--run first for the first run (and its smoke retries); --run rerun for the targeted re-run of the TCs impact.mjs select returns. --run final was removed.',
    'A FAIL beside other tests (workers > 1) is re-run alone inside the same call (the isolation check); refused requests cool the rest of the stage down.',
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
