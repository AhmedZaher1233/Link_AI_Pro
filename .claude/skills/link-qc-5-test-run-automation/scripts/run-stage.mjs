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
// - a FAIL from a command that ran tests side by side (workers > 1, or a command whose run overlapped another one —
//   dispatch's pool and unit children) is re-run ALONE (workers 1) after the stage's commands — the isolation check; a
//   pass alone is parallel interference, never a hidden retry (the parallel attempt stays in the history); the tests
//   that overlapped it — in any command running at the time — run alone too;
// - a failure whose failing step's OWN request was throttled (429, or 403 / 503 with rate-limit headers,
//   written by helpers/network-guard.ts) is isolated after the server's deadline — never shortened; refused
//   again → INCOMPLETE `rate_limited`; a deadline beyond --max-wait defers the TC (NOT_RUN "deferred until"),
//   never `rate_limited` by itself; a 503 + Retry-After without rate-limit evidence is temporary
//   unavailability: the failure keeps its outcome and is classified normally;
// - refusals cool down only their SCOPE (service / account / endpoint — published to the admission file);
//   workers drop only for an environment-wide scope.
// The original failure is never lost: interference (failed beside, passed alone) keeps the parallel attempt
// and gets a cause from evidence — test_data_conflict · possible_product_concurrency_defect · environment ·
// unexplained.
//
// Capacity (default on): every command reserves its full --workers in the machine-wide capacity ledger
// (capacity.mjs) before it is spawned — through ledger-exec.mjs, which registers itself — and releases them
// only when its process tree is gone. --no-ledger / QA_LEDGER=off (the rollback switch) or a failed process
// listing never mean "uncoordinated": every command then runs under an EXCLUSIVE reservation — one Playwright
// command at a time on this machine, never above the ceiling — and dispatch is off; when the coordination directory or
// the ledger file cannot be used, nothing is started (BLOCKED, "no safe coordination"). In BOTH modes a command runs
// under ledger-exec.mjs and its reservation is released only on a FRESH process table that shows nothing it owns alive —
// a browser that outlives the command, also a detached or re-parented one, keeps the slots held and is terminated only
// when the table shows it with its recorded identity (capacity.mjs releaseConfirmed); no table → the slots stay held
// ("could not be confirmed stopped") and later commands wait, never launched beside it.
// Harness seam QA_CAPACITY_HOST_FIXTURE (a JSON file or inline JSON {availableMb, totalMemMb, cpus, cpuPct}) replaces
// the host's memory / CPU readings the ledger decides on, so a self-test never depends on this machine's free memory.
// The machine ceiling is AUTO (capacity.mjs resolveCeiling: the host's total memory / CPU and the headed per-worker
// demand, bounded by config.json machineMaxWorkers) and can only be lowered here. Host pressure (2 s sampler — the
// ONE host sampler of the call) stops new spawns and pauses new tests through the admission file; an environment
// lease (--env-id, acquired at intake by `capacity.mjs lease acquire`) must stay held by this run.
// Scheduler (default auto): with the ledger on and an OK readiness payload (--units, parallel-plan.mjs) whose
// dependency fingerprint still matches — else re-planned here — the stage is DISPATCHED: the conflict-free pool runs
// in batches (one multi-worker command each, workers from the ramp, which adapts between batches), every restricted
// unit as its own child, never two conflicting units at once. Without that proof it runs SERIALLY (workers 1) —
// a remembered worker count is never evidence of independence. --scheduler groups (explicit) runs the legacy
// hand-built run plan; --scheduler dispatch (explicit) refuses instead of falling back.
// Local runs are headed (visible windows); CI / no graphical desktop → headless, reported. status.json + one log line
// show the Auto ceiling, the active workers and their TCs whenever that changes.
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
//        [--interval 5000] [--status-every 30000] [--ceiling-margin <ms>]
//        [--telemetry [--telemetry-interval 2000] [--tree-interval 30000]]
//        [--ceilings auto --timeouts <timeouts.ts>] [--silence <ms>] [--timeouts-mode active|shadow]
//        [--no-ledger] [--capacity-dir <dir>] [--env-id <id>] [--max-wait <ms>]
//        [--scheduler auto|groups|dispatch] [--units <parallel-plan.json>] [--strict] [--pretty]
//   node run-stage.mjs reclaim [--capacity-dir <dir>] [--dry-run]     (user-run: orphaned trees of crashed runs)
// Telemetry is OPT-IN (--telemetry) and OBSERVE ONLY: it reuses the ledger sampler's host readings and adds the
// running command's process tree to the summary's `telemetry`; nothing reads it back to decide anything.
// Exit code 0 by default (the outcome is in the payload); --strict maps COMPLETED 0 · STOPPED_* 1 ·
// FRESHNESS_FAILED / SPAWN_FAILED / BLOCKED 2 · NOT_RUN 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, print, posix, read, isFile, sha256 } from './scan-lib.mjs';
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
// helpers/admission.ts: a worker that was not admitted throws instead of running its worker fixtures / beforeAll
const ADMISSION_REFUSED = /AdmissionRefusedError: admission timeout \((.*)\) — not started/;
const STRICT_EXIT = { COMPLETED: 0, STOPPED_FROZEN: 1, STOPPED_CEILING: 1, FRESHNESS_FAILED: 2, SPAWN_FAILED: 2, BLOCKED: 2, NOT_RUN: 3 };
const OUTCOME_RANK = ['COMPLETED', 'STOPPED_FROZEN', 'STOPPED_CEILING', 'FRESHNESS_FAILED', 'SPAWN_FAILED', 'BLOCKED'];
const here = path.dirname(fileURLToPath(import.meta.url));
// QA_CAPACITY_TRACE={file}: the same append-only diagnostic capacity.mjs writes (command start / stop / end, the first
// heartbeat) — off unless set, never read by any decision
const TRACE_FILE = process.env.QA_CAPACITY_TRACE || null;
function trace(event, data = {}) {
  if (!TRACE_FILE) return;
  try { fs.appendFileSync(TRACE_FILE, JSON.stringify({ at: new Date().toISOString(), t: Date.now(), pid: process.pid, who: 'run-stage.mjs', event, ...data }) + '\n'); } catch { /* diagnostics never fail a caller */ }
}
const firstHeartbeatAt = (file) => { try { const l = fs.readFileSync(file, 'utf8').split('\n').find((x) => x.trim()); return l ? Date.parse(JSON.parse(l).at) : null; } catch { return null; } };
// auto (default): dispatch on a fresh, OK readiness payload with the ledger on; otherwise SERIAL (workers 1) — never
// multi-worker without proven independence. groups: the legacy hand-built run plan (explicit maintainer rollback only).
export const SCHEDULERS = ['auto', 'groups', 'dispatch'];
export const TIMEOUT_MODES = ['shadow', 'active'];
// pool batches under dispatch: the ramp re-sizes the workers between batches; a batch is max(4 × workers, 8) TCs
export const BATCH_PER_WORKER = 4;
export const BATCH_MIN = 8;
const RAMP_FILE = 'ramp.json';
export const MAX_WAIT_DEFAULT = 600000;          // longest admission / pressure / server-deadline wait per stage
export const LONG_DEADLINE_MS = 600000;          // step deadlines this long are reported (timeouts shadow log)
const ADMISSION_SCHEMA = 'skill5-admission/1';
// the documented NOT_RUN / INCOMPLETE reasons (prefixes the renderer already accepts)
export const REASON = {
  admissionTimeout: (why) => 'not started: admission timeout (' + why + ')',
  noCoordination: (why) => 'not started: no safe coordination (' + why + ')',
  hostPressure: 'not started: host pressure',
  deferred: (iso) => 'not started: deferred until ' + iso,
  lease: (why) => 'not started: environment lease (' + why + ')',
  waitBudget: (deadline) => 'interrupted: wait budget exhausted (server deadline ' + deadline + ')',
};
// deterministic jitter for the harness only (QA_JITTER=max | zero); full jitter otherwise
const rand = process.env.QA_JITTER === 'max' ? () => 1 : process.env.QA_JITTER === 'zero' ? () => 0 : Math.random;

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
        const notes = [...(test.annotations || []), ...((last && last.annotations) || [])].filter((x) => x && x.type);
        const annotations = notes.map((x) => x.type);
        const noteOf = (type) => { const n = notes.find((x) => x.type === type); return n ? String(n.description ?? '') : null; };
        const errText = rawErr ? String(rawErr) : '';
        const budget = errText.match(/wait budget exhausted \(server deadline ([^)]+)\)/);
        const refusedWorker = status === 'FAIL' ? errText.match(ADMISSION_REFUSED) : null;
        out.push({
          title: spec.title, file: spec.file || suite.file || null, line: spec.line || null, tags, suite: t.join(' > '),
          project, repeat, status, duration_ms: results.reduce((a, r) => a + (r.duration || 0), 0),
          tcs: tcIdsOf(spec.title), annotations,
          unverifiedAssumption: tags.includes('@unverified-assumption') || /@unverified-assumption/.test(spec.title),
          rateLimitError: !!(rawErr && RATE_LIMIT_ERROR.test(errText)),
          // the helpers' documented outcomes (assets/admission + rate-limit templates): never a FAIL or a SKIP of the TC
          waitBudget: rawErr && RATE_LIMIT_ERROR.test(errText) ? (budget ? budget[1].trim() : 'a rate-limit slot out of reach') : null,
          deferredUntil: status === 'SKIP' ? noteOf('rate-limit-deferred') : null,
          admissionTimeout: status === 'SKIP' ? noteOf('admission-timeout') : refusedWorker ? refusedWorker[1] : null,
          expectsRefusal: annotations.includes('expects-refusal'),
          consoleErrors: annotations.includes('console-errors'),
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

// the status of record of one collected test (pure): the helpers' documented non-verdicts — an admission timeout (a
// test skipped by unitAdmission, a worker refused by workerAdmission's AdmissionRefusedError, their serial followers)
// or a deferral before any side effect is NOT_RUN, a mid-step wait budget below the server's deadline is INCOMPLETE —
// none is a FAIL, a SKIP or `rate_limited`; anything else keeps its status
export function classifyTest(t) {
  const st = t.status;
  if ((st === 'SKIP' || st === 'FAIL' || st === 'NOT_RUN') && t.admissionTimeout !== null && t.admissionTimeout !== undefined) return { status: 'NOT_RUN', reason: REASON.admissionTimeout(t.admissionTimeout || 'admission wait exceeded') };
  if (st === 'SKIP' && t.deferredUntil !== null && t.deferredUntil !== undefined) return { status: 'NOT_RUN', reason: REASON.deferred(t.deferredUntil || 'the server deadline') };
  if (st === 'FAIL' && t.waitBudget) return { status: 'INCOMPLETE', reason: REASON.waitBudget(t.waitBudget) };
  return { status: st, reason: null };
}

// a test skipped with no skip / fixme annotation after a FAILED test of the same describe is a
// serial-chain follower Playwright skipped for us: NOT_RUN "not started: depends on …", never SKIP; after a test whose
// worker was not admitted (AdmissionRefusedError) the followers were not started for that same reason
export function markFollowers(tests) {
  const firstFail = new Map();
  for (const t of tests) {
    if (t.status === 'FAIL' && !firstFail.has(t.suite)) firstFail.set(t.suite, { id: t.tcs[0] || t.title, admission: t.admissionTimeout ?? null });
    else if (t.status === 'SKIP' && firstFail.has(t.suite) && !t.annotations.some((a) => /^(skip|fixme)$/i.test(a))) {
      const first = firstFail.get(t.suite);
      t.status = 'NOT_RUN';
      if (first.admission !== null) t.admissionTimeout = first.admission;
      else t.follower = first.id;
    }
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

// METHOD + path: the guard's path template when present (numeric / uuid segments already {id}), else the URL's pathname
const matchOf = (r) => { let p = r.path || r.url || ''; if (!r.path) { try { p = new URL(r.url).pathname; } catch { /* already a path */ } } return (r.method ? String(r.method).toUpperCase() + ' ' : '') + p; };
const hasLimitHeaders = (r) => [r.limit, r.remaining, r.reset, r.reset_s].some((x) => x !== null && x !== undefined) || !!r.policy;

// one guard record → throttling | unavailable | server-error | network | policy | paced | null.
// Throttling = 429, or 403 / 503 WITH rate-limit headers (or a learned throttle signature). A 503 + Retry-After
// without that evidence is temporary unavailability — never throttling, never `rate_limited`. Older helpers wrote
// every 429 and 503 + Retry-After as kind "refused"; the same rule reads them.
export function classifyRecord(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.kind === 'paced' || r.kind === 'policy') return r.kind;
  if (r.kind === 'network-error') return 'network';
  if (r.kind === 'server-error') return 'server-error';
  if (r.kind === 'unavailable') return 'unavailable';
  const s = Number(r.status);
  if (s === 429) return 'throttling';
  if (s === 403 || s === 503) {
    if (hasLimitHeaders(r) || r.throttle_signature) return 'throttling';
    return s === 503 ? 'unavailable' : null;          // a plain 403 is an authorization answer, not a refusal record
  }
  return r.kind === 'refused' ? 'throttling' : null;
}

// does a configured rate-limit `match` ("POST /api/session" or "/api/session") cover a record's METHOD + path?
const splitMatch = (m) => { const x = String(m || '').trim(); const sp = x.indexOf(' '); return sp > 0 && /^[A-Za-z]+$/.test(x.slice(0, sp)) ? { method: x.slice(0, sp).toUpperCase(), path: x.slice(sp + 1).trim() } : { method: null, path: x }; };
export const matchCovers = (cfg, rec) => { const a = splitMatch(cfg); const b = splitMatch(rec); return !!a.path && a.path === b.path && (!a.method || a.method === b.method); };

// the server's own deadline of a refusal (Retry-After as an absolute time, else delta-seconds, else RateLimit-Reset)
export function notBeforeOf(r) {
  const at = typeof r.at === 'number' ? r.at : Date.parse(r.at);
  if (r.retry_after_at) { const t = Date.parse(r.retry_after_at); if (!Number.isNaN(t)) return t; }
  if (typeof r.retry_after_s === 'number' && Number.isFinite(at)) return at + r.retry_after_s * 1000;
  const reset = typeof r.reset_s === 'number' ? r.reset_s : typeof r.reset === 'number' ? r.reset : null;
  if (reset !== null && Number.isFinite(at)) return at + reset * 1000;
  return null;
}

// network-guard records of one command, classified
export function rateLimitRecords(file) {
  const refused = [];
  const unavailable = [];
  const serverErrors = [];
  const networkErrors = [];
  const policies = [];
  for (const r of jsonl(file)) {
    const cls = classifyRecord(r);
    const row = { at: Date.parse(r.at), tcs: tcsOfField(r.tc), match: matchOf(r), status: r.status ?? null, retry_after_s: typeof r.retry_after_s === 'number' ? r.retry_after_s : null,
      step: r.step || null, account: r.account || null, host: r.host || null, request_id: r.request_id ?? null, scope: r.scope || null };
    if (cls === 'policy') policies.push({ match: matchOf(r), limit: r.limit ?? null, remaining: r.remaining ?? null, reset: r.reset ?? r.reset_s ?? null, window_s: r.window_s ?? null, policy: r.policy || null });
    else if (cls === 'throttling') refused.push({ ...row, notBefore: notBeforeOf(r) });
    else if (cls === 'unavailable') unavailable.push({ ...row, notBefore: notBeforeOf(r) });
    else if (cls === 'server-error') serverErrors.push(row);
    else if (cls === 'network') networkErrors.push({ ...row, error: r.error ? filterLine(String(r.error)).slice(0, 120) : null });
  }
  return { refused, unavailable, serverErrors, networkErrors, policies };
}

// how long to wait before the refused scope is used again. With a server deadline (Retry-After / RateLimit-Reset):
// the longest one, NEVER shortened and never capped. Without one (a self-chosen backoff): the full-jitter BOUND
// min(cap, base × 2^round) — the caller draws the wait in [0, bound] (jitterWait).
export function cooldownFor(refused, defaultMs, maxMs, round = 0) {
  if (!refused.length) return 0;
  const ra = refused.map((r) => r.retry_after_s).filter((x) => typeof x === 'number');
  if (ra.length) return Math.max(...ra) * 1000;
  return Math.min(maxMs, defaultMs * Math.pow(2, Math.max(0, round)));
}
export const hasServerDeadline = (refused) => refused.some((r) => typeof r.retry_after_s === 'number' || r.notBefore);
export const jitterWait = (bound) => Math.round(rand() * Math.max(0, bound));

// the scope of a set of throttling refusals: a configured service whose match covers the request (account-scoped
// limits per account) → service:{name}[/account]; else endpoint:{METHOD path}. Refusals that span ≥ 2 configured
// services, or ≥ 3 unconfigured endpoints, or a record the helper marked environment-wide → environment.
export function refusalScopes(refused, rateLimits) {
  const scopes = new Map();
  const svcOf = (r) => Object.entries(rateLimits || {}).find(([, l]) => l && l.match && matchCovers(l.match, r.match));
  for (const r of refused) {
    let scope;
    if (r.scope === 'environment') scope = 'environment';
    else {
      const s = svcOf(r);
      if (s) scope = s[1].scope === 'account' && r.account ? 'account:' + r.account : 'service:' + s[0];
      else scope = 'endpoint:' + r.match;
    }
    const e = scopes.get(scope) || { scope, kind: 'throttling', count: 0, notBefore: null, tcs: [] };
    e.count++;
    if (r.notBefore) e.notBefore = Math.max(e.notBefore || 0, r.notBefore);
    e.tcs = uniq([...e.tcs, ...r.tcs]);
    scopes.set(scope, e);
  }
  const list = [...scopes.values()];
  const services = list.filter((s) => s.scope.startsWith('service:') || s.scope.startsWith('account:')).length;
  const endpoints = list.filter((s) => s.scope.startsWith('endpoint:')).length;
  const environmentWide = list.some((s) => s.scope === 'environment') || services >= 2 || endpoints >= 3;
  return { scopes: list.map((s) => ({ ...s, notBefore: s.notBefore ? iso(s.notBefore) : null })), environmentWide };
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

/* ---------------- ceilings and the silence limit from timeouts.ts (the documented arithmetic, done here) ---------------- */

// the numeric keys of the project's timeouts.ts (comments stripped; 90_000 → 90000); missing keys → null
export function parseTimeouts(text) {
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const num = (s) => (s === undefined ? null : Number(String(s).replace(/_/g, '')));
  const block = (key) => { const m = src.match(new RegExp('\\b' + key + '\\s*:\\s*\\{([^{}]*)\\}')); return m ? m[1] : null; };
  const inBlock = (b, key) => { if (b === null) return null; const m = b.match(new RegExp('\\b' + key + '\\s*:\\s*([\\d_]+)')); return m ? num(m[1]) : null; };
  const flat = (key) => { const m = src.match(new RegExp('\\b' + key + '\\s*:\\s*([\\d_]+)\\s*[,}\\n]')); return m ? num(m[1]) : null; };
  const test = block('test'); const step = block('step'); const stall = block('stall'); const admission = block('admission');
  return {
    testDefault: inBlock(test, 'default'), testLong: inBlock(test, 'long'), expect: flat('expect'), action: flat('action'), navigation: flat('navigation'),
    hook: flat('hook'), stepDefault: inBlock(step, 'default'), stepLong: inBlock(step, 'long'), watchdogGrace: flat('watchdog_grace'),
    stallSilence: inBlock(stall, 'silence'), admissionMaxWait: inBlock(admission, 'max_wait'),
  };
}

// the silence limit of the smart-timeout rule: TIMEOUTS.stall.silence, else min(3 × max(action, navigation, expect),
// DEFAULT_SILENCE_MS) but never below that max (a healthy single action is never a stall); no timeouts.ts → the default
export const DEFAULT_SILENCE_MS = 55000;
export function silenceOf(t) {
  if (t && t.stallSilence > 0) return t.stallSilence;
  const m = Math.max(t && t.action || 0, t && t.navigation || 0, t && t.expect || 0);
  return m > 0 ? Math.max(m, Math.min(3 * m, DEFAULT_SILENCE_MS)) : DEFAULT_SILENCE_MS;
}

// the test budget of every TC from the spec text: TIMEOUTS.test.long when its test body names it, else test.default
export function budgetsFrom(specTexts, t) {
  const out = {};
  for (const text of specTexts) {
    const parts = String(text || '').split(/(?=\btest(?:\.(?:only|skip|fixme|fail|slow))?\s*\()/);
    for (const part of parts) {
      const head = part.slice(0, 400);
      const ids = tcIdsOf((head.match(/['"`]([^'"`]*\[TC-[^'"`]*)['"`]/) || [])[1] || '');
      for (const tc of ids) out[tc] = /TIMEOUTS\.test\.long/.test(part) ? t.testLong : t.testDefault;
    }
  }
  return out;
}

// (Σ test budgets ÷ workers) + one hook budget + one teardown budget, × 1.2, + the pacing floor
// ⌈calls ÷ pace⌉ × window per limited service the group calls — references/execution.md <live_progress>
export function ceilingFor({ tcs, workers, t, budgets = {}, rateLimits = {} }) {
  const sum = tcs.reduce((s, tc) => s + (budgets[tc] || t.testDefault || 0), 0);
  let floor = 0;
  for (const l of Object.values(rateLimits || {})) {
    const pace = Number(l.pace) > 0 ? Number(l.pace) : Number(l.limit) > 1 ? Number(l.limit) - 1 : 0;
    const windowMs = Number(l.window_s) > 0 ? Number(l.window_s) * 1000 : 0;
    if (!pace || !windowMs) continue;
    const per = l.calls_per_tc;
    const calls = tcs.reduce((s, tc) => s + (typeof per === 'number' ? per : per && typeof per === 'object' ? Number(per[tc] ?? per.default ?? 1) : 1), 0);
    floor += Math.ceil(calls / pace) * windowMs;
  }
  return Math.ceil(((sum / Math.max(1, workers)) + (t.hook || 0) + (t.testDefault || 0)) * 1.2 + floor);
}

/* ---------------- messages ---------------- */

const phrase = (c) => c.passed + ' passed, ' + c.failed + ' failed, ' + c.skipped + ' skipped'
  + (c.incomplete ? ', ' + c.incomplete + ' incomplete' : '') + ', ' + c.notRun + ' not run'
  + (c.expectedFailures ? ', ' + c.expectedFailures + ' expected failure' + (c.expectedFailures === 1 ? '' : 's') : '');
const short = (c) => c.passed + ' passed · ' + c.failed + ' failed' + (c.skipped ? ' · ' + c.skipped + ' skipped' : '')
  + (c.notRun + c.incomplete ? ' · ' + (c.notRun + c.incomplete) + ' not run' : '');

// fail% over the ELIGIBLE smoke results — PASS + FAIL of the latest attempt; SKIP, an expected failure,
// NOT_RUN and INCOMPLETE carry no smoke verdict. None eligible → NO VERDICT: positive and negative do not start.
export function smokeGateOf(c) {
  const eligible = (c.passed || 0) + (c.failed || 0);
  if (eligible <= 0) return { failPct: null, limit: SMOKE_GATE_LIMIT, eligible: 0, decision: 'no_verdict', verdict: 'NO VERDICT', reason: 'no smoke TC produced a PASS or FAIL' };
  const failPct = Math.round((c.failed / eligible) * 1000) / 10;
  const ok = failPct <= SMOKE_GATE_LIMIT;
  return { failPct, limit: SMOKE_GATE_LIMIT, eligible, decision: ok ? 'continue' : 'classify', verdict: ok ? 'PASS' : 'ABOVE_LIMIT' };
}

const ids = (xs) => xs.join(', ');

// the stage's chat message — phase-wide cumulative; the model adds only what a script cannot know:
// the gate decision above the limit, defect classification, compliance status
export function buildUpdate({ run, stage, label, outcome, reason, call, cumulative, failures, notRun, blockers, evidenceDir, durationMs, isolation, rateLimit, deferred = [], interferenceCauses = [], pressure = null, workers = null }) {
  const L = [];
  const runText = (RUN_LABEL[run] || run + ' run') + (label ? ', ' + label : '');
  const word = STAGE_WORD[stage];
  const stopped = outcome === 'BLOCKED' || outcome === 'SPAWN_FAILED' || outcome === 'FRESHNESS_FAILED';
  if (stopped) L.push(word + ' stopped (' + runText + '): ' + reason + '.');
  else if (stage === 'setup') L.push(word + ' completed (' + runText + '): ' + call.journeys.passed + ' passed, ' + call.journeys.failed + ' failed — ' + mmss(durationMs) + '.');
  else if (run === 'rerun') L.push(word + ' completed (' + runText + '): ' + plural(call.counts.tcs, 'TC') + ' re-run → ' + phrase(call.counts) + ' — ' + mmss(durationMs) + '.');
  else L.push(word + ' completed (' + runText + '): ' + phrase(call.counts) + ' — ' + plural(call.counts.tcs, 'TC') + ', ' + mmss(durationMs) + '.');
  if (workers) L.push(workers);
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
    const adjText = (x) => x.scope && x.scope !== 'environment'
      ? x.scope + ' cool-down ' + secs(x.cooldown_ms) + ' s before ' + x.group + ' (scoped: workers unchanged)'
      : 'cool-down ' + secs(x.cooldown_ms) + ' s, ' + x.group + ' workers ' + x.workers_from + ' → ' + x.workers_to;
    L.push('Rate limit: ' + rateLimit.services.map((s) => s.match + ' refused ' + s.count + '×' + (s.retry_after_max_s !== null ? ' (Retry-After ' + s.retry_after_max_s + ' s)' : '')).join('; ')
      + (rateLimit.adjustments.length ? ' → ' + rateLimit.adjustments.map(adjText).join('; ') : '') + '.');
  } else if (rateLimit && rateLimit.policies.length) {
    L.push('Rate-limit policy seen: ' + rateLimit.policies.map((p) => p.match + ' limit ' + p.limit + (p.window_s ? ' per ' + p.window_s + ' s' : '')).join('; ') + '.');
  }
  if (rateLimit && rateLimit.unavailable) L.push('Temporary unavailability: ' + rateLimit.unavailable + ' response(s) 503 + Retry-After without rate-limit evidence — the failures keep their outcome and are classified normally.');
  if (deferred && deferred.length) L.push('Deferred: ' + deferred.map((d) => d.tc + ' until ' + d.until).join(', ') + ' — not started, the server\'s deadline was beyond the wait budget (never rate_limited by itself).');
  if (interferenceCauses && interferenceCauses.length) L.push('Interference causes: ' + interferenceCauses.map((e) => e.tc + ' ' + e.cause).join(', ') + (interferenceCauses.some((e) => e.cause === 'possible_product_concurrency_defect' || e.cause === 'unexplained') ? ' — unresolved until classified (run acceptance).' : '.'));
  if (pressure && pressure.episodes && pressure.episodes.length) L.push('Host pressure: ' + pressure.episodes.length + ' episode(s), ' + (pressure.blockedAdmissions || 0) + ' admission(s) held back — running tests were never stopped for it.');
  L.push('Blockers: ' + (blockers.length ? blockers.join('; ') : 'none') + '.');
  const st = cumulative.stages;
  if (stage === 'smoke') {
    if (cumulative.setup) L.push('Setup journeys: ' + cumulative.setup.passed + ' passed, ' + cumulative.setup.failed + ' failed.');
    if (!stopped && st.smoke) {
      const g = smokeGateOf(st.smoke);
      if (g.decision === 'no_verdict') L.push('Smoke gate: NO VERDICT — no smoke TC produced a PASS or FAIL; positive and negative do not start (interactive: fix and run a smoke retry, or stop · pipeline: stop).');
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

/* ---------------- telemetry — OPT-IN (--telemetry), OBSERVE ONLY (never an input to a decision, a gate or a command) --
   Phase 0 of the optimisation plan: host memory / CPU and the event-loop lag every --telemetry-interval (taken from the
   ledger's sampler when the ledger runs), the process tree of the running command (count, working set) every
   --tree-interval, written to the stage summary as `telemetry`. Off by default; the summary's `host` carries the
   sampler's minima / peaks either way. Nothing here changes what runs, when, or with which workers. */

export const TELEMETRY_SCHEMA = 'skill5-telemetry/1';
const MB = 1024 * 1024;
const mb = (bytes) => (typeof bytes === 'number' ? Math.round(bytes / MB) : null);

function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
  return { idle, total };
}

// one process-table snapshot as [{pid, ppid, rssBytes}] — PowerShell CIM on Windows, ps elsewhere.
// QA_TELEMETRY_PS_FIXTURE (harness only) names a JSON table whose "ROOT" pid stands for the first root.
export function processTable(timeoutMs, rootPid) {
  const fixture = process.env.QA_TELEMETRY_PS_FIXTURE;
  if (fixture) {
    try {
      const rows = JSON.parse(fs.readFileSync(fixture, 'utf8'));
      const sub = (v) => (v === 'ROOT' ? rootPid : Number(v));
      return Promise.resolve({ rows: rows.map((r) => ({ pid: sub(r.pid), ppid: sub(r.ppid), rssBytes: Number(r.rssBytes) || 0 })), error: null });
    } catch (e) { return Promise.resolve({ rows: null, error: 'fixture: ' + e.message }); }
  }
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    const child = win
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.WorkingSetSize)" }'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      : spawn('ps', ['-A', '-o', 'pid=,ppid=,rss='], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve({ rows: null, error: 'process listing timed out' }); }, timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ rows: null, error: e.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      const rows = [];
      for (const line of out.split(/\r?\n/)) {
        const f = line.trim().split(win ? ',' : /\s+/).map(Number);
        if (f.length >= 3 && f.every((x) => Number.isFinite(x))) rows.push({ pid: f[0], ppid: f[1], rssBytes: win ? f[2] : f[2] * 1024 });
      }
      resolve(rows.length ? { rows, error: null } : { rows: null, error: 'empty process listing' });
    });
  });
}

// the roots and every descendant of them in one process table: count and summed working set
export function descendantsOf(rows, roots) {
  const kids = new Map();
  const byPid = new Map();
  for (const r of rows || []) { byPid.set(r.pid, r); if (!kids.has(r.ppid)) kids.set(r.ppid, []); kids.get(r.ppid).push(r.pid); }
  const seen = new Set();
  const queue = roots.filter((p) => byPid.has(p));
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p)) continue;
    seen.add(p);
    for (const c of kids.get(p) || []) if (!seen.has(c)) queue.push(c);
  }
  let rss = 0;
  for (const p of seen) rss += byPid.get(p).rssBytes || 0;
  return { count: seen.size, rssBytes: rss };
}

// `current()` returns the running command ({ child, command }) or, under --scheduler dispatch, a list of them;
// `snapshot(timeoutMs, rootPid)` defaults to processTable (the capacity ledger passes its own cached listing)
export function startTelemetry({ intervalMs = 2000, treeIntervalMs = 30000, current, snapshot = processTable, hostSample = null }) {
  const runningOf = () => { const c = current(); return (Array.isArray(c) ? c : [c]).filter((x) => x && x.child && x.child.pid !== undefined); };
  const t = { samples: 0, availStart: os.freemem(), availMin: null, availSum: 0, cpuPeak: null, cpuSum: 0, cpuN: 0, lagMax: 0,
    tree: { samples: 0, peakRss: null, peakCount: null, errors: 0, lastError: null }, perCommand: new Map() };
  const forCmd = (g) => {
    if (!g) return null;
    if (!t.perCommand.has(g)) t.perCommand.set(g, { samples: 0, availMin: null, cpuPeak: null, treeSamples: 0, rssPeak: null, countPeak: null });
    return t.perCommand.get(g);
  };
  let prev = cpuTimes();
  let expected = Date.now() + intervalMs;
  const timer = setInterval(() => {
    const now = Date.now();
    // with the capacity ledger the host readings come from its sampler (one sampler per call); without it, our own
    const hs = hostSample ? hostSample() : null;
    t.lagMax = Math.max(t.lagMax, hs && typeof hs.lagMs === 'number' ? hs.lagMs : now - expected);
    expected = now + intervalMs;
    let free;
    let cpu;
    if (hs) { free = hs.freeBytes; cpu = typeof hs.cpuPct === 'number' ? hs.cpuPct : null; }
    else {
      free = os.freemem();
      const cur = cpuTimes();
      const dt = cur.total - prev.total;
      cpu = dt > 0 ? Math.round(1000 * (1 - (cur.idle - prev.idle) / dt)) / 10 : null;
      prev = cur;
    }
    t.samples++;
    t.availMin = t.availMin === null ? free : Math.min(t.availMin, free);
    t.availSum += free;
    if (cpu !== null) { t.cpuPeak = t.cpuPeak === null ? cpu : Math.max(t.cpuPeak, cpu); t.cpuSum += cpu; t.cpuN++; }
    for (const r of runningOf()) {
      const c = forCmd(r.command);
      if (c) { c.samples++; c.availMin = c.availMin === null ? free : Math.min(c.availMin, free); if (cpu !== null) c.cpuPeak = c.cpuPeak === null ? cpu : Math.max(c.cpuPeak, cpu); }
    }
  }, intervalMs);
  timer.unref();
  let busy = false;
  const treeTimer = setInterval(async () => {
    const running = runningOf();
    if (busy || !running.length) return;
    busy = true;
    try {
      const snap = await snapshot(10000, running[0].child.pid);
      if (!snap.rows) { t.tree.errors++; t.tree.lastError = snap.error; return; }
      let any = false;
      let rssAll = 0, countAll = 0;
      for (const { child, command } of running) {
        const d = descendantsOf(snap.rows, [child.pid]);
        if (!d.count) continue; // the command ended while the table was read
        any = true;
        rssAll += d.rssBytes; countAll += d.count;
        const c = forCmd(command);
        if (c) { c.treeSamples++; c.rssPeak = Math.max(c.rssPeak || 0, d.rssBytes); c.countPeak = Math.max(c.countPeak || 0, d.count); }
      }
      if (!any) return;
      t.tree.samples++;
      t.tree.peakRss = Math.max(t.tree.peakRss || 0, rssAll);
      t.tree.peakCount = Math.max(t.tree.peakCount || 0, countAll);
    } finally { busy = false; }
  }, treeIntervalMs);
  treeTimer.unref();
  return {
    stop() {
      clearInterval(timer);
      clearInterval(treeTimer);
      return {
        schema: TELEMETRY_SCHEMA, observeOnly: true, intervalMs, treeIntervalMs,
        host: { platform: process.platform, cpus: os.cpus().length, totalMemMb: mb(os.totalmem()) },
        samples: t.samples,
        memory: { availableAtStartMb: mb(t.availStart), availableMinMb: mb(t.availMin), availableAvgMb: t.samples ? mb(t.availSum / t.samples) : null },
        cpu: { peakPct: t.cpuPeak, avgPct: t.cpuN ? Math.round((t.cpuSum / t.cpuN) * 10) / 10 : null },
        eventLoopLagMaxMs: t.lagMax,
        tree: { samples: t.tree.samples, available: t.tree.samples > 0 || t.tree.errors === 0, peakRssMb: mb(t.tree.peakRss), peakProcesses: t.tree.peakCount, errors: t.tree.errors, lastError: t.tree.lastError },
        commands: [...t.perCommand].map(([g, c]) => ({ group: g.name, command: g.kind, attempt: g.attempt || null, workers: g.workers, samples: c.samples, minAvailableMb: mb(c.availMin), peakCpuPct: c.cpuPeak,
          treeSamples: c.treeSamples, peakRssMb: mb(c.rssPeak), peakProcesses: c.countPeak })),
      };
    },
  };
}

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

// [start, end] and title of the step that failed for this TC (the last step that ended in error / timeout)
function failingStepWindow(progressFile, tc) {
  let start = null;
  let win = null;
  for (const r of jsonl(progressFile)) {
    if (!r.step || !tcsOfField(r.tc).includes(tc)) continue;
    if (r.event === 'start') start = Date.parse(r.at);
    else if (r.event === 'end' && (r.outcome === 'error' || r.outcome === 'timeout') && start !== null) win = { start, end: Date.parse(r.at), step: r.step };
  }
  return win;
}

// the throttling refusals of the failing step's OWN requests: matched by step title when the guard names the step,
// by the step's time window for older helpers. A refusal elsewhere in the test never makes the failure `rate_limited`.
const SLACK_MS = 500;
function refusedInFailingStep(cmd, tc) {
  const win = failingStepWindow(cmd.progressFile, tc);
  if (!win) return [];
  const mine = (cmd.rate ? cmd.rate.refused : []).filter((r) => r.tcs.includes(tc));
  if (mine.some((r) => r.step)) return mine.filter((r) => r.step === win.step);
  return mine.filter((r) => r.at >= win.start - SLACK_MS && r.at <= win.end + SLACK_MS);
}

// application-error / environment evidence of one TC's attempt in one command (B23 cause classification)
function symptomsOf(cmd, tc, tests) {
  const rate = cmd.rate || {};
  const app = [];
  const env = [];
  for (const r of rate.serverErrors || []) if (r.tcs.includes(tc)) app.push('HTTP ' + r.status + ' ' + r.match);
  for (const t of tests || []) if (t.tcs.includes(tc) && t.consoleErrors) app.push('browser console errors (console-errors.txt)');
  for (const r of rate.unavailable || []) if (r.tcs.includes(tc)) env.push('503 + Retry-After ' + r.match + ' (temporary unavailability)');
  for (const r of rate.networkErrors || []) if (r.tcs.includes(tc)) env.push('no response: ' + r.match + (r.error ? ' (' + r.error + ')' : ''));
  return { app: uniq(app), env: uniq(env) };
}

/* ---------------- one command ---------------- */

async function runCommand(ctx, g, laterGroups) {
  const { log } = ctx;
  fs.mkdirSync(path.dirname(g.stageJson), { recursive: true });
  fs.mkdirSync(path.dirname(g.progressFile), { recursive: true });
  fs.writeFileSync(g.planFile, JSON.stringify({ name: g.name, mode: g.mode, workers: g.workers, stage: ctx.stage, command: g.kind, tcs: g.tcs }, null, 2) + '\n');
  // the rate-limit state and its lock are SHARED (other workers, commands and runs on this environment): never deleted here
  const { grep, invert } = g.filter || buildFilter({ stage: ctx.stage, group: g.name, tcs: g.onlyTcs });
  const pwArgs = ['test', ...g.specs, '--project=' + ctx.project, '--grep', grep];
  if (invert) pwArgs.push('--grep-invert', invert);
  pwArgs.push('--workers=' + g.workers, ...g.extraArgs);
  if (g.extraArgs.includes('--last-failed')) g.lastRunFrom = seedLastRun(ctx.outputPhaseDir, g.outputDir);
  const env = { ...process.env, PW_STAGE_JSON: g.stageJson, PW_PROGRESS_FILE: g.progressFile, PW_OUTPUT_DIR: g.outputDir,
    PW_GLOBAL_TIMEOUT: String(g.ceilingMs), PW_WORKERS: String(g.workers), PW_PHASE: String(ctx.phase), PW_STAGE_ATTEMPT: String(g.attempt),
    PW_RATE_LIMIT_FILE: g.rateLimitFile, PW_RATE_LIMIT_STATE: ctx.rateLimitState, PW_RATE_LIMITS: ctx.rateLimitsJson,
    // admission, scopes, unique-data lane, cancellation and stall diagnostics (assets/admission + rate-limit + steps templates)
    // the unit of each TC: dispatch units as planned; a serial run-plan group is admitted as ONE unit (a chain is never
    // paused half-way); a parallel group maps nothing — every test is admitted on its own
    PW_ADMISSION_FILE: ctx.admissionFile, PW_UNIT_SCOPES: ctx.unitScopesJson,
    PW_UNIT_MAP: JSON.stringify(g.unitMap || (g.mode === 'serial' && g.kind === 'normal' ? Object.fromEntries(g.tcs.map((tc) => [tc, g.name])) : {})),
    PW_LANE: String(g.lane || 1), PW_CANCEL_FILE: ctx.cancelFile, PW_DIAGNOSTICS_DIR: g.diagnosticsDir };
  if (ctx.envId) env.PW_ENV_ID = ctx.envId; else delete env.PW_ENV_ID;
  if (ctx.headless) env.PW_HEADLESS = '1'; else delete env.PW_HEADLESS;
  let child;
  let spawnError = null;
  const shown = (ctx.cmd ? ctx.cmd : 'playwright') + ' ' + pwArgs.map((x) => (/\s|[|()]/.test(x) ? JSON.stringify(x) : x)).join(' ');
  g.command = shown;
  g.startedAt = Date.now();
  trace('cmd-start', { group: g.name, kind: g.kind, attempt: g.attempt, workers: g.workers, ceilingMs: g.ceilingMs, token: g.ledgerToken || g.exclusiveToken || null });
  const what = g.kind === 'normal' ? '' : g.kind + ' · ';
  log(ctx.activity + ' · ' + g.name + ' (' + what + g.mode + ' ×' + g.workers + ', ' + (ctx.headless ? 'headless' : 'headed') + ') · start · '
    + plural(g.tcs.length, 'TC') + ' · attempt ' + g.attempt + ' · ceiling ' + mmss(g.ceilingMs) + (g.ledgerToken ? ' · ledger ' + g.workers + ' slot(s)' : g.exclusiveToken ? ' · exclusive ' + g.workers + ' slot(s)' : '') + ' · ' + shown);
  // under the ledger AND in exclusive execution the command runs under ledger-exec.mjs, which registers its own pid
  // against the reservation token at once (a parent that dies right after the spawn never leaves the child unaccounted
  // for) and hands the token to the whole tree (QA_LEDGER_TOKEN — a re-parented browser keeps it)
  const resToken = g.ledgerToken || g.exclusiveToken || null;
  const resDir = g.ledgerToken ? ctx.ledger.dir : g.exclusiveToken ? ctx.excl.dir : null;
  const wrap = (argv0, argv, shell) => (resToken
    ? { file: process.execPath, args: [path.join(here, 'ledger-exec.mjs'), resToken, '--capacity-dir', resDir, ...(shell ? ['--shell'] : []), '--', argv0, ...argv], shell: false }
    : { file: argv0, args: argv, shell });
  try {
    if (ctx.cmd) {
      const quote = process.platform === 'win32' ? quoteWin : quotePosix;
      if (process.platform === 'win32' && pwArgs.some((x) => /["%]/.test(x))) throw new Error('an argument holds " or % — not passed through cmd.exe');
      const line = ctx.cmd + ' ' + pwArgs.map(quote).join(' ');
      if (resToken) { const w = wrap(line, [], true); child = spawn(w.file, w.args, { cwd: ctx.cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
      else child = spawn(line, { cwd: ctx.cwd, env, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      // no shell: the lookahead regex reaches Playwright byte for byte on every platform
      const w = wrap(process.execPath, [ctx.cliPath, ...pwArgs], false);
      child = spawn(w.file, w.args, { cwd: ctx.cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    }
  } catch (e) { spawnError = e; }
  ctx.current = child || null;
  ctx.currentCommand = child ? g : null;
  if (child) ctx.running.set(g, child);
  if (child && ctx.publishStatus) ctx.publishStatus('start');
  if (child) g.childPid = child.pid;
  if (child && g.ledgerToken && ctx.ledger) await ctx.ledger.activate(g, child);
  else if (child && g.exclusiveToken && ctx.excl) await ctx.excl.activate(g, child);
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
  const wdArgs = { plan: g.planFile, heartbeat: g.progressFile, results: g.resultsFile, grace: String(ctx.graceMs), stage: ctx.stage, group: g.name,
    ...(ctx.silenceMs ? { silence: String(ctx.silenceMs), silenceMode: ctx.timeoutsMode } : {}) };
  const safeWd = (extra) => {
    let v;
    try { v = watchdogRun({ ...wdArgs, ...extra }); } catch (e) { return { verdict: 'BLOCKED', reason: 'internal error: ' + e.message }; }
    // the timeouts shadow log: every long silent step the silence rule WOULD have stopped (A15), once per step
    for (const f of v.would_freeze || []) {
      const key = g.name + '|' + g.attempt + '|' + f.worker + '|' + f.tc + '|' + f.step;
      if (!ctx.shadow.seen.has(key)) { ctx.shadow.seen.add(key); ctx.shadow.would_stop.push({ group: g.name, command: g.kind, attempt: g.attempt, worker: f.worker, tc: f.tc, step: f.step, at: f.at, silence_ms: f.silence_ms, deadline_ms: f.deadline_ms }); }
    }
    return v;
  };
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
      { const fh = firstHeartbeatAt(g.progressFile); trace('cmd-ceiling-stop', { group: g.name, attempt: g.attempt, token: g.ledgerToken || g.exclusiveToken || null, elapsedMs: elapsed, ceilingMs: g.ceilingMs, marginMs: g.marginMs, firstHeartbeatAfterMs: fh ? fh - g.startedAt : null, watchdogVerdict: w.verdict, watchdogReason: w.reason || null }); }
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
          g.stop = { kind: 'watchdog', reason: w.reason, frozen: w.frozen, verdict: 'FROZEN', written: true, rule: f.rule || 'deadline' };
          log(ctx.activity + ' · ' + g.name + ' · STOPPED — watchdog: worker ' + f.worker + ' frozen in step "' + f.step + '" of ' + f.tc + ' for '
            + Math.round(f.since_last_progress_ms / 1000) + ' s ('
            + (f.rule === 'silence' ? 'silent past the silence limit ' + Math.round(f.silence_ms / 1000) + ' s + grace ' + Math.round(f.grace_ms / 1000) + ' s, deadline ' + Math.round(f.deadline_ms / 1000) + ' s'
              : 'deadline ' + Math.round(f.deadline_ms / 1000) + ' s + grace ' + Math.round(f.grace_ms / 1000) + ' s') + ')'
            + (f.expected ? '; expected: ' + f.expected : '') + '; process tree killed');
          break;
        }
      }
    }
    if (Date.now() - lastStatus >= ctx.statusEveryMs) { statusLine(); lastStatus = Date.now(); }
    if (ctx.publishStatus) ctx.publishStatus('tick');
  }
  if (child && !exited) {
    await Promise.race([onExit, sleep(10000)]);
    if (!exited) { killTree(child); await Promise.race([onExit, sleep(5000)]); }
    if (!exited) ctx.warnings.push(g.name + ': the process did not exit after the kill (pid ' + child.pid + ')');
  }
  if (child && !closed) await Promise.race([onClose, sleep(2000)]);
  ctx.running.delete(g);
  if (ctx.publishStatus) ctx.publishStatus('end');
  if (ctx.current === child) { ctx.current = null; ctx.currentCommand = null; }
  g.finishedAt = Date.now();
  g.exit = exitInfo;
  g.noTests = noTests;
  if (spawnError) { g.spawnError = spawnError.message; return g; }
  freshness(ctx, g);
  g.rate = rateLimitRecords(g.rateLimitFile);
  // the timeouts shadow log: documented step deadlines of 10 min or more, and every stall the step helper reported
  for (const r of jsonl(g.progressFile)) {
    if (r.event === 'start' && Number(r.deadline_ms) >= LONG_DEADLINE_MS) ctx.shadow.long_deadlines.push({ group: g.name, attempt: g.attempt, tc: r.tc || null, step: r.step || null, deadline_ms: r.deadline_ms });
    else if (r.event === 'stall') ctx.shadow.stalls.push({ group: g.name, attempt: g.attempt, tc: r.tc || null, step: r.step || null, silence_ms: r.silence_ms ?? null, classification: r.classification || null, diagnostics: r.diagnostics ? posix(path.relative(ctx.resultsRoot, path.resolve(ctx.cwd, r.diagnostics))) : null });
  }
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
    trace('freshness-failed', { group: g.name, attempt: g.attempt, stop: g.stop, watchdogFile: !!st, startedAt: g.startedAt, firstHeartbeatAfterMs: (() => { const fh = firstHeartbeatAt(g.progressFile); return fh ? fh - g.startedAt : null; })() });
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
  const deferred = [];
  const admissionTimeouts = [];
  let tests = [];
  if (g.source === 'incremental+watchdog') {
    let file = null; try { file = JSON.parse(read(g.watchdogFile)); } catch { /* unreadable → everything below stays NOT_RUN */ }
    for (const c of (file && file.completed) || []) tcs[c.tc] = c.status;
    for (const i of (file && file.interrupted) || []) { tcs[i.tc] = 'INCOMPLETE'; reasons[i.tc] = i.reason; }
    for (const n of (file && file.not_started) || []) { tcs[n.tc] = 'NOT_RUN'; reasons[n.tc] = n.reason; }
    for (const c of (file && file.completed) || []) if (c.status === 'FAIL') failures.push({ tcs: [c.tc], title: c.title, group: g.name, status: 'FAIL', error: null, screenshot: null, unverifiedAssumption: false });
  } else if (g.source === 'json') {
    let report = null; try { report = JSON.parse(read(g.stageJson)); } catch { /* covered by the freshness gate */ }
    tests = markFollowers(collectTests(report, ctx.resultsRoot));
    const per = {};
    for (const t of tests) {
      if (ctx.stage === 'setup' && !t.tcs.length) { if (t.status === 'PASS') journeys.passed++; else if (t.status === 'FAIL') journeys.failed++; else journeys.other++; }
      const { status: st, reason: why } = classifyTest(t);
      for (const tc of t.tcs) {
        if (!g.tcs.includes(tc) && !ctx.stageTcs.includes(tc) && !unplanned.includes(tc)) unplanned.push(tc);
        (per[tc] = per[tc] || []).push(st);
        if (t.follower) reasons[tc] = 'not started: depends on ' + t.follower + ' (failed)';
        if (why) reasons[tc] = why;
        if (t.rateLimitError) rateLimitErrors.add(tc);
        if (st === 'NOT_RUN' && t.deferredUntil !== null) deferred.push({ tc, until: t.deferredUntil || null, scope: null });
        if (st === 'NOT_RUN' && t.admissionTimeout !== null) admissionTimeouts.push(tc);
      }
      if (st === 'FAIL') failures.push({ tcs: t.tcs, title: t.title, group: g.name, status: 'FAIL', error: t.error, screenshot: t.screenshot, unverifiedAssumption: t.unverifiedAssumption, repeat: t.repeat });
    }
    for (const [tc, list] of Object.entries(per)) tcs[tc] = aggregate(list);
  }
  for (const tc of g.tcs) if (!(tc in tcs)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = g.source === 'none' ? 'no test matched the stage filter — check its tags' : 'no result for this TC in the stage JSON'; }
  return { tcs, reasons, failures, journeys, unplanned, rateLimitErrors, deferred, admissionTimeouts, tests };
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

/* ---------------- capacity: the ledger, the lease, host pressure, the admission file ---------------- */

const MBYTE = 1024 * 1024;
async function loadModule(name) {
  try { return await import(pathToFileURL(path.join(here, name)).href); } catch (e) { return { loadError: (e && e.message) || String(e) }; }
}

// QA_CAPACITY_HOST_FIXTURE (harness only): fixed host readings for the ledger's decisions — never the telemetry
let hostFixtureCache;
export function hostFixture() {
  if (hostFixtureCache !== undefined) return hostFixtureCache;
  const raw = process.env.QA_CAPACITY_HOST_FIXTURE;
  hostFixtureCache = null;
  if (raw) {
    try { const v = JSON.parse(/^\s*\{/.test(raw) ? raw : fs.readFileSync(raw, 'utf8')); if (v && typeof v === 'object') hostFixtureCache = v; } catch { /* ignored: the real readings apply */ }
  }
  return hostFixtureCache;
}
const hostTotalMemMb = () => { const f = hostFixture(); return f && f.totalMemMb > 0 ? f.totalMemMb : Math.round(os.totalmem() / MBYTE); };
const hostCpus = () => { const f = hostFixture(); return f && f.cpus > 0 ? f.cpus : os.cpus().length; };

// available memory as the host reports it, bounded by a cgroup v2 limit inside a container
export function availableMemMb() {
  const f = hostFixture();
  if (f && typeof f.availableMb === 'number') return Math.max(0, Math.round(f.availableMb));
  let avail = os.freemem() / MBYTE;
  try {
    const max = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    const cur = Number(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
    if (max !== 'max' && Number(max) > 0 && cur >= 0) avail = Math.min(avail, (Number(max) - cur) / MBYTE);
  } catch { /* not a cgroup v2 container */ }
  return Math.max(0, Math.round(avail));
}

// Testing/qa-manifest.json seen from the automation root (execution.maxWorkers may only LOWER the ceiling)
function readManifest(cwd) {
  for (const p of [path.join(cwd, 'qa-manifest.json'), path.join(cwd, '..', 'qa-manifest.json'), path.join(cwd, 'Testing', 'qa-manifest.json'), path.join(cwd, '..', 'Testing', 'qa-manifest.json')]) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* next candidate */ }
  }
  return null;
}

// the measured working set per Playwright worker of our own trees (EWMA across runs of this user) — the bootstrap
// demand of capacity.mjs applies until one is measured
const DEMAND_FILE = 'demand.json';
function readDemand(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, DEMAND_FILE), 'utf8')) || {}; } catch { return {}; } }
function writeDemand(cap, dir, kind, memMbPerWorker) {
  if (!(memMbPerWorker > 0)) return;
  try {
    const d = readDemand(dir);
    const prev = d[kind];
    d[kind] = prev && prev.memMb > 0
      ? { memMb: Math.round(prev.memMb * 0.7 + memMbPerWorker * 0.3), samples: (prev.samples || 0) + 1, at: iso(Date.now()) }
      : { memMb: Math.round(memMbPerWorker), samples: 1, at: iso(Date.now()) };
    cap.writeJsonAtomic(path.join(dir, DEMAND_FILE), d);
  } catch { /* the estimate keeps its last value */ }
}

// the last worker count the ramp proved healthy, per environment and browser kind — PERFORMANCE HISTORY only: a ramp
// trial target after a valid readiness payload proved independence, never evidence that tests may run together
const rampKey = (envId, kind) => (envId || 'no-environment') + '|' + kind;
function readRampMemory(dir, envId, kind) {
  try { const v = JSON.parse(fs.readFileSync(path.join(dir, RAMP_FILE), 'utf8'))[rampKey(envId, kind)]; return v && Number.isInteger(v.validated) && v.validated > 0 ? v.validated : null; } catch { return null; }
}
function writeRampMemory(cap, dir, envId, kind, validated) {
  if (!(Number.isInteger(validated) && validated > 0)) return;
  try {
    let d = {};
    try { d = JSON.parse(fs.readFileSync(path.join(dir, RAMP_FILE), 'utf8')) || {}; } catch { d = {}; }
    d[rampKey(envId, kind)] = { validated, at: iso(Date.now()) };
    cap.writeJsonAtomic(path.join(dir, RAMP_FILE), d);
  } catch { /* the memory keeps its last value */ }
}

// local runs are HEADED (the user watches the workers' windows); --headless, CI or no graphical desktop → the headless
// profile, with the reason reported (an explicit --headless has no reason to report)
export function displayOf(a, env = process.env, platform = process.platform) {
  if (a.headless === true || a.headless === 'true') return { headed: false, source: '--headless', reason: null };
  if (env && env.CI && !/^(0|false|no)$/i.test(String(env.CI).trim())) return { headed: false, source: 'ci', reason: 'CI environment' };
  if (platform === 'linux' && !(env && (env.DISPLAY || env.WAYLAND_DISPLAY))) return { headed: false, source: 'no-desktop', reason: 'no graphical desktop (no DISPLAY / WAYLAND_DISPLAY)' };
  return { headed: true, source: 'default', reason: null };
}

// kill one process we own (pid + start verified against the latest table by the caller)
function killPid(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

// PW_UNIT_SCOPES: per TC, every rate-limited service it calls (calls_per_tc, default 1) and its dispatch unit's scopes
export function unitScopesOf(tcs, rateLimits, units = []) {
  const out = {};
  for (const tc of tcs) {
    const s = [];
    for (const [name, l] of Object.entries(rateLimits || {})) {
      const per = l && l.calls_per_tc;
      const calls = typeof per === 'number' ? per : per && typeof per === 'object' ? Number(per[tc] ?? per.default ?? 1) : 1;
      if (calls > 0) s.push('service:' + name);
    }
    for (const u of units) if ((u.tcs || []).includes(tc)) s.push(...(u.scopes || []));
    out[tc] = uniq(s);
  }
  return out;
}

// one ISO instant from a deferral / deadline text, or null; a time that may be epoch ms or ISO
const instantOf = (s) => { const t = Date.parse(String(s || '')); return Number.isNaN(t) ? null : t; };
const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v));

// a clean command base for a re-queue / isolation / overlap command: the run-plan group, or — under dispatch — the
// unit command's identity only (never its files, stop, freshness or reservation)
// unit identity (one per source command, so the isolation of several TCs of one pool is still ONE command)
const BASES = new WeakMap();
const baseOf = (src) => {
  if (src.group) return src.group;
  if (!BASES.has(src)) BASES.set(src, { name: src.name, mode: src.mode, workers: src.workers, tcs: src.tcs, ceilingMs: src.ceilingMs, specs: src.specs, unitId: src.unitId, filter: src.filter });
  return BASES.get(src);
};

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
  const ceilingsAuto = a.ceilings === 'auto';
  const ceilings = {};
  if (!ceilingsAuto) for (const pair of csv(a.ceilings)) { const i = pair.lastIndexOf('='); const ms = Number(pair.slice(i + 1)); if (i > 0 && ms > 0) ceilings[pair.slice(0, i)] = ms; else errors.push('bad --ceilings entry "' + pair + '" (group=milliseconds, or --ceilings auto with --timeouts)'); }
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
  const maxWaitMs = msFlag('max-wait', MAX_WAIT_DEFAULT);
  const cmd = typeof a.cmd === 'string' ? a.cmd : null;
  if (cmd && REFUSED_IN_CMD.test(cmd)) errors.push('--cmd may not carry --reporter / --config / --grep / --project / --retries: the stage filter and the shared config are this script\'s');
  // telemetry is an opt-in measurement (--telemetry); --no-telemetry is accepted and changes nothing
  const telemetryOff = !(a.telemetry === true || a.telemetry === 'true');
  const telemetryIntervalMs = msFlag('telemetry-interval', 2000) || 2000;
  const treeIntervalMs = msFlag('tree-interval', 30000) || 30000;
  const scheduler = typeof a.scheduler === 'string' ? a.scheduler : 'auto';
  if (!SCHEDULERS.includes(scheduler)) errors.push('--scheduler must be auto | groups | dispatch');
  // the silence rule STOPS by default (active); --timeouts-mode shadow is the explicit rollback (reports only)
  const timeoutsMode = typeof a['timeouts-mode'] === 'string' ? a['timeouts-mode'] : 'active';
  if (!TIMEOUT_MODES.includes(timeoutsMode)) errors.push('--timeouts-mode must be active | shadow');
  const ledgerOff = a['no-ledger'] === true || a['no-ledger'] === 'true' || a.ledger === 'off' || process.env.QA_LEDGER === 'off';
  const envId = typeof a['env-id'] === 'string' ? a['env-id'] : null;
  const unitsPath = typeof a.units === 'string' ? path.resolve(a.units) : null;
  if (scheduler === 'dispatch' && stage === 'setup') errors.push('--scheduler dispatch runs smoke / positive / negative — setup journeys always run as their groups');
  if (scheduler === 'dispatch' && (!unitsPath || !isFile(unitsPath))) errors.push('--scheduler dispatch needs --units <the parallel-plan.mjs payload>');
  if (scheduler === 'dispatch' && !ceilingsAuto && !ceilings.default) errors.push('--scheduler dispatch needs --ceilings auto (with timeouts.ts) or a --ceilings default=<ms> entry: units are not run-plan groups');
  if (errors.length) return { ...base, outcome: 'BLOCKED', reason: errors[0], errors, warnings };

  // timeouts.ts: the auto ceilings, the watchdog grace and the silence limit of the smart-timeout rule
  const timeoutsPath = typeof a.timeouts === 'string' ? path.resolve(cwd, a.timeouts) : (isFile(path.join(cwd, 'timeouts.ts')) ? path.join(cwd, 'timeouts.ts') : null);
  const tmo = timeoutsPath && isFile(timeoutsPath) ? parseTimeouts(read(timeoutsPath)) : null;
  if (ceilingsAuto && !(tmo && tmo.testDefault > 0)) return { ...base, outcome: 'BLOCKED', reason: '--ceilings auto needs the project\'s timeouts.ts with test.default (--timeouts <path>)', errors: ['no timeouts.ts'], warnings };
  const graceMs = a.grace !== undefined && a.grace !== true ? Number(a.grace) : (tmo && tmo.watchdogGrace > 0 ? tmo.watchdogGrace : 60000);
  if (a.grace === undefined && !(tmo && tmo.watchdogGrace > 0)) warnings.push('no --grace and no TIMEOUTS.watchdog_grace: the watchdog uses 60 s');
  if (Number.isNaN(graceMs) || graceMs < 0) return { ...base, outcome: 'BLOCKED', reason: '--grace must be milliseconds', errors: ['--grace'], warnings };
  const silenceMs = a.silence !== undefined && a.silence !== true ? Number(a.silence) : silenceOf(tmo);
  if (!(silenceMs >= 0)) return { ...base, outcome: 'BLOCKED', reason: '--silence must be milliseconds', errors: ['--silence'], warnings };
  // visible browsers for a local run; no graphical desktop → the documented headless profile, reported
  const display = displayOf(a);
  if (display.reason && !display.headed) warnings.push('browser windows unavailable (' + display.reason + ') — the headless profile runs');

  let runJson; try { runJson = JSON.parse(read(runFile)); } catch { runJson = null; }
  const rawPlan = runJson && (runJson.run_plan || (Array.isArray(runJson.groups) ? runJson : null));
  if (!rawPlan || !Array.isArray(rawPlan.groups)) return { ...base, outcome: 'BLOCKED', reason: 'the run file has no run_plan.groups[] — write {run_file}.run_plan first', errors: ['no run_plan'], warnings };
  const adjustments = Array.isArray(runJson.run_plan_adjustments) ? runJson.run_plan_adjustments : [];
  const { plan, applied } = applyAdjustments(rawPlan, adjustments);
  const rateLimits = rateLimitsOf(plan, adjustments);
  const resultsRoot = path.dirname(path.dirname(runFile));
  const phase = Number(runJson.phase) || Number((path.basename(runFile).match(/phase-(\d+)/) || [])[1]) || null;
  // the run's identity in the ledger and the lease — the same rule as `capacity.mjs lease acquire --run-file`
  const runId = (runJson && typeof runJson.run_id === 'string' && runJson.run_id.trim()) || sha256(posix(runFile)).slice(0, 16);
  const onlyGroups = csv(a.groups);
  const onlyTcs = csv(a.tcs);
  const specs = csv(a.spec);
  const budgets = ceilingsAuto ? budgetsFrom(uniq([...specs, ...((plan.setup_groups || []).map((s) => s.spec).filter(Boolean))]).map((s) => read(path.resolve(cwd, s)) || ''), tmo) : {};
  const computedCeilings = {};
  const ceilingOf = (name, tcs, workers) => {
    const given = ceilings[name] || ceilings[slugOf(name)];
    if (given) return given;
    if (ceilingsAuto) { const ms = ceilingFor({ tcs: tcs.length ? tcs : ['(setup journey)'], workers, t: tmo, budgets, rateLimits }); computedCeilings[name] = ms; return ms; }
    return ceilings.default || null;
  };
  const source = stage === 'setup' ? (plan.setup_groups || []) : plan.groups;
  const mayDispatch = stage !== 'setup' && (scheduler === 'dispatch' || (scheduler === 'auto' && !!unitsPath));
  const groups = [];
  const skippedGroups = [];
  const inNoGroup = stageTcs.filter((tc) => !plan.groups.some((g) => (g.tcs || []).includes(tc)));
  for (const pg of source) {
    if (onlyGroups.length && !onlyGroups.includes(pg.name)) continue;
    let tcs = stage === 'setup' ? (pg.tcs || []).slice() : (pg.tcs || []).filter((tc) => stageTcs.includes(tc));
    if (onlyTcs.length) tcs = tcs.filter((tc) => onlyTcs.includes(tc));
    if (stage !== 'setup' && !tcs.length) { skippedGroups.push({ name: pg.name, reason: 'no TCs of this stage in this group' }); continue; }
    // never more workers than the group has TCs to run side by side
    const planned = workersOverride || pg.workers || (pg.mode === 'parallel' ? (plan.workers_parallel || 2) : 1);
    const workers = stage !== 'setup' ? Math.max(1, Math.min(planned, tcs.length)) : planned;
    // a group without a ceiling is an error only when groups will run (dispatch units take --ceilings auto / default)
    const ceilingMs = mayDispatch ? (ceilingOf(pg.name, tcs, workers) || null) : ceilingOf(pg.name, tcs, workers);
    if (!ceilingMs && !mayDispatch) errors.push('no ceiling for group "' + pg.name + '" (--ceilings ' + pg.name + '=<ms>, or --ceilings auto with the project\'s timeouts.ts)');
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
  // B16a: a smoke stage of this phase that produced no PASS / FAIL keeps the FIRST run's positive and negative from
  // starting (a targeted re-run — skill 5's impacted TCs, skill 9's retests — is not the staged first run)
  if ((stage === 'positive' || stage === 'negative') && run === 'first') {
    const smoke = cumulativeOf(progressDir).stages.smoke;
    if (smoke && smokeGateOf(smoke).decision === 'no_verdict') return { ...base, outcome: 'BLOCKED', reason: 'smoke gate NO VERDICT — no smoke TC of this phase produced a PASS or FAIL; fix and run a smoke retry (or stop) before the ' + stage + ' stage', errors: ['smoke gate NO VERDICT'], warnings };
  }
  let cliPath = null;
  if (!cmd) {
    const candidates = typeof a.cli === 'string' ? [path.resolve(cwd, a.cli)] : [path.join(cwd, 'node_modules', '@playwright', 'test', 'cli.js'), path.join(cwd, 'node_modules', 'playwright', 'cli.js')];
    cliPath = candidates.find((p) => isFile(p)) || null;
  }
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

  /* ---- coordination: the capacity ledger (default), else EXCLUSIVE execution — never an uncoordinated launch ---- */
  const cap = await loadModule('capacity.mjs');
  if (cap.loadError) return { ...base, outcome: 'BLOCKED', reason: 'no safe coordination — capacity.mjs could not be loaded (' + cap.loadError + '); nothing was started (restore the skill folder with /sync-skills)', errors: ['capacity.mjs'], warnings };
  const coordDir = typeof a['capacity-dir'] === 'string' ? path.resolve(a['capacity-dir']) : cap.resolveCapacityDir();
  {
    // the coordination directory must be writable and the ledger readable — otherwise no launch can be coordinated
    let why = null;
    try { fs.mkdirSync(coordDir, { recursive: true }); fs.accessSync(coordDir, fs.constants.W_OK); } catch (e) { why = 'the coordination directory ' + posix(coordDir) + ' is not writable (' + (e.code || e.message) + ') — set QA_CAPACITY_DIR to a writable absolute path'; }
    const led0 = why ? null : cap.readLedger(coordDir);
    if (led0 && led0.error) why = led0.error;
    if (why) return { ...base, outcome: 'BLOCKED', reason: 'no safe coordination — ' + why + '; nothing was started', errors: ['coordination'], warnings };
  }
  // Auto: from the host's total memory / CPU (the harness's fixed readings when set; capacity.mjs's cgroup-aware ones
  // otherwise) and the demand of the browser kind that runs; config.json machineMaxWorkers bounds it
  const ceil = cap.resolveCeiling({ dir: coordDir, env: process.env, manifest: readManifest(cwd), workersFlag: workersOverride,
    host: hostFixture() ? { totalMemMb: hostTotalMemMb(), cpus: hostCpus() } : null, kind: display.headed ? 'headed' : 'headless' });
  for (const r of ceil.refusedRaises || []) warnings.push('the machine ceiling can only be lowered here: ' + r.by + '=' + r.value + ' ignored (ceiling ' + ceil.ceiling + ' from ' + ceil.source + ')');
  if (ceil.auto && ceil.auto.reason) warnings.push('Auto ceiling: ' + ceil.auto.reason);
  // the hard cap holds in every mode: no command runs above the machine ceiling (never raised)
  const loweredByCeiling = [];
  for (const g of groups) if (g.workers > ceil.ceiling) { loweredByCeiling.push({ group: g.name, from: g.workers, to: ceil.ceiling, by: 'machine ceiling (' + ceil.source + ')' }); g.workers = ceil.ceiling; }
  let ledger = null;
  let excl = null;
  let exclReason = ledgerOff ? (process.env.QA_LEDGER === 'off' ? 'QA_LEDGER=off' : '--no-ledger') : null;
  const ledgerRecord = { enabled: false, mode: null, ceiling: ceil.ceiling, source: ceil.source, upper: ceil.upper, auto: ceil.auto, display, dir: posix(coordDir), lowered: loweredByCeiling, reservations: [], sweep: null, demand: null };
  const leaseRecord = { envId, valid: null, reason: null, bookId: null };
  if (!ledgerOff) {
    const dir = coordDir;
    const totalMemMb = hostTotalMemMb();
    const cpus = hostCpus();
    const reserves = cap.reservesFor({ ci: !!process.env.CI, totalMemMb, cpus });
    const headless = !display.headed;
    const kind = headless ? 'headless' : 'headed';
    const measured = readDemand(dir)[kind];
    const boot = cap.BOOTSTRAP_DEMAND[kind];
    const per = measured && measured.memMb > 0 ? { memMb: Math.round(measured.memMb * 1.2), cpu: boot.cpu, measured: true } : { ...boot, measured: false };
    ledger = { cap, dir, ceiling: ceil.ceiling, ceil, reserves, per, kind, cpus, pm: cap.createPressureMonitor({ reserveMb: reserves.memMb, workerMemMb: per.memMb }), rows: null, rowsAt: 0, observed: {}, availMb: availableMemMb(), lastCpu: 0, lastLag: 0, hostStats: { samples: 0, minAvailableMb: null, peakCpuPct: null, maxLagMs: 0 }, timer: null };
    // the latest process table — a cached one when a listing fails, NULL when none was ever read (capacity.mjs then
    // treats liveness as unknown: nothing is released or broken — never an empty table that would read as "all dead")
    ledger.snapshot = async (maxAgeMs = 5000) => {
      if (ledger.rows && Date.now() - ledger.rowsAt < maxAgeMs) return ledger.rows;
      let s;
      try { s = await cap.processSnapshot({ timeoutMs: 10000 }); } catch (e) { s = { rows: null, error: e.message }; }
      if (s.rows) { ledger.rows = s.rows; ledger.rowsAt = Date.now(); }
      else ledger.listingError = s.error || 'empty process listing';
      return ledger.rows || null;
    };
    // a table taken NOW — never the cached one: what tracks, confirms or releases a reservation must see the processes
    // as they are (a stale table would drop a browser started since, or release a command whose tree still runs)
    ledger.fresh = async () => {
      let s;
      try { s = await cap.processSnapshot({ timeoutMs: 10000 }); } catch (e) { s = { rows: null, error: e.message }; }
      if (s.rows) { ledger.rows = s.rows; ledger.rowsAt = Date.now(); return s.rows; }
      ledger.listingError = s.error || 'empty process listing';
      return null;
    };
    Object.assign(ledgerRecord, { enabled: true, ceiling: ceil.ceiling, source: ceil.source, configured: ceil.configured, refusedRaises: ceil.refusedRaises || [], ceilingLowered: ceil.lowered || [], dir: posix(dir), demand: { kind, memMbPerWorker: per.memMb, measured: per.measured }, reserves });
    const rows0 = await ledger.snapshot(0);
    if (!rows0) {
      // without a process table the ledger's tree tracking cannot work: the stage falls back to EXCLUSIVE execution
      ledgerRecord.enabled = false;
      ledgerRecord.unavailable = 'process listing failed: ' + (ledger.listingError || 'unknown');
      exclReason = 'the process listing failed (' + (ledger.listingError || 'unknown') + ')';
      ledger = null;
    } else {
      ledgerRecord.mode = 'ledger';
      try { ledgerRecord.sweep = await cap.sweep({ dir, rows: rows0 }); } catch (e) { warnings.push('ledger sweep failed: ' + e.message); }
      for (const l of (ledgerRecord.sweep && ledgerRecord.sweep.leasesReleased) || []) warnings.push('an environment lease of a run whose owner is gone was released (' + l.envId + ', ' + (l.warning || 'released') + ')');
    }
  }
  if (!ledger) {
    // EXCLUSIVE execution: one Playwright command at a time on this machine (≤ the ceiling) — the hard cap survives the
    // rollback; host-pressure admission and dispatch are what is switched off. Ownership stays: every command runs under
    // ledger-exec.mjs, its tree is walked whenever a listing works, and its reservation is released only when a fresh
    // table confirms nothing it owns is alive (no table → it stays held, the next command waits)
    excl = { dir: coordDir, ceiling: ceil.ceiling, ceil, reason: exclReason, listingError: null };
    excl.fresh = async () => {
      let s;
      try { s = await cap.processSnapshot({ timeoutMs: 10000 }); } catch (e) { s = { rows: null, error: e.message }; }
      if (!s.rows) excl.listingError = s.error || 'empty process listing';
      return s.rows || null;
    };
    Object.assign(ledgerRecord, { mode: 'exclusive', exclusive: { reason: exclReason } });
    const rowsX = await excl.fresh();
    try { ledgerRecord.sweep = await cap.sweep({ dir: coordDir, rows: rowsX }); } catch (e) { warnings.push('ledger sweep failed: ' + e.message); }
    warnings.push('capacity ledger off (' + exclReason + ') — EXCLUSIVE execution: one Playwright command at a time on this machine, at most ' + ceil.ceiling + ' worker(s); host-pressure admission and dispatch are off; a command\'s slots are released only when a process table confirms its processes ended'
      + (rowsX ? '' : ' — the process listing failed (' + (excl.listingError || 'unknown') + '), so a finished command stays held until a table confirms it'));
  }
  /* ---- the scheduler: dispatch only on proven independence; auto otherwise runs SERIALLY, never multi-worker ---- */
  const schedRec = { requested: scheduler, used: null, fallback: null, changed: [], replanned: false };
  let mode = scheduler;              // dispatch | groups (explicit legacy plan) | serial (auto without proof)
  let dsp = null;
  let unitsPlan = null;
  const readUnits = () => { try { return JSON.parse(read(unitsPath)); } catch { return null; } };
  if (scheduler === 'dispatch') {
    if (!ledger) return { ...base, outcome: 'BLOCKED', reason: 'dispatch needs the capacity ledger — this stage would run in exclusive execution (' + exclReason + '), so dispatch is off (run with --scheduler auto: serial)', errors: ['no ledger'], warnings };
    dsp = await loadModule('dispatch.mjs');
    if (dsp.loadError) return { ...base, outcome: 'BLOCKED', reason: 'dispatch.mjs could not be loaded (' + dsp.loadError + ')', errors: ['dispatch.mjs'], warnings };
    unitsPlan = readUnits();
    if (!unitsPlan || !Array.isArray(unitsPlan.units)) return { ...base, outcome: 'BLOCKED', reason: '--units is not a parallel-plan.mjs payload (no units[])', errors: ['bad --units'], warnings };
    // dispatch runs only on a readiness check that completed: its conflict validation is what keeps units apart
    if (unitsPlan.schema !== 'skill5-parallel-plan/1') return { ...base, outcome: 'BLOCKED', reason: '--units is not a parallel-plan.mjs payload (schema ' + JSON.stringify(unitsPlan.schema || null) + ')', errors: ['bad --units'], warnings };
    if (unitsPlan.outcome === 'BLOCKED') return { ...base, outcome: 'BLOCKED', reason: 'the parallel readiness check is BLOCKED (' + (unitsPlan.reason || 'see its payload') + ') — no dispatch on an unvalidated plan (run with --scheduler auto: serial)', errors: ['readiness BLOCKED'], warnings };
    if (!Array.isArray(unitsPlan.conflicts)) return { ...base, outcome: 'BLOCKED', reason: '--units carries no conflict list — re-run parallel-plan.mjs', errors: ['bad --units'], warnings };
  } else if (scheduler === 'auto') {
    let why = stage === 'setup' ? 'setup journeys run one at a time'
      : !ledger ? 'capacity ledger off — exclusive execution (' + exclReason + ')'
      : !unitsPath ? 'no readiness payload (--units)'
      : !isFile(unitsPath) ? 'readiness payload not found (' + posix(unitsPath) + ')'
      : !ceilingsAuto && !ceilings.default ? 'no --ceilings auto / default= for execution units' : null;
    if (!why) {
      unitsPlan = readUnits();
      why = !unitsPlan || !Array.isArray(unitsPlan.units) || unitsPlan.schema !== 'skill5-parallel-plan/1' ? 'the readiness payload is not a parallel-plan.mjs payload'
        : unitsPlan.outcome !== 'OK' ? 'the readiness check is ' + (unitsPlan.outcome || 'without an outcome') + (unitsPlan.reason ? ' (' + unitsPlan.reason + ')' : '')
        : !Array.isArray(unitsPlan.conflicts) ? 'the readiness payload has no conflict list' : null;
    }
    if (!why) {
      // fresh only while everything it was decided on is unchanged: code (specs, helpers, page objects, fixtures, config,
      // timeouts), TCs, TEST-DATA, the learning file, the run plan and the environment — else it is re-planned here
      const pp = await loadModule('parallel-plan.mjs');
      if (pp.loadError) why = 'parallel-plan.mjs could not be loaded (' + pp.loadError + ')';
      else {
        const inp = unitsPlan.inputs || {};
        const saved = inp.fingerprint || null;
        let changed;
        try {
          const cur = saved ? pp.readinessFingerprint({ root: cwd, specs: saved.specs || [], tc: inp.tc, data: inp.data, learning: inp.learning, runFile: inp.runFile, environment: envId }) : null;
          changed = saved ? pp.fingerprintChanges(saved, cur) : ['fingerprint (a payload without one)'];
        } catch (e) { changed = ['fingerprint (' + e.message + ')']; }
        const samePath = (x, y) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() === path.resolve(y).toLowerCase() : path.resolve(x) === path.resolve(y));
        if (unitsPlan.root && !samePath(unitsPlan.root, cwd)) changed.push('automation root');
        if (inp.runFile && !samePath(inp.runFile, runFile)) changed.push('run file');
        if (changed.length) {
          schedRec.changed = changed;
          let fresh;
          try { fresh = pp.planParallel({ root: cwd, specs: (saved && saved.specs) || [], tc: inp.tc, data: inp.data, learning: inp.learning, runFile, progress: inp.progress, environment: envId }); } catch (e) { fresh = { outcome: 'BLOCKED', reason: e.message }; }
          if (fresh.outcome === 'OK') {
            unitsPlan = fresh;
            schedRec.replanned = true;
            try { fs.writeFileSync(unitsPath, JSON.stringify(fresh, null, 2) + '\n'); } catch (e) { warnings.push('the re-planned readiness payload could not be written back (' + e.message + ') — this call uses it in memory'); }
          } else why = 'the readiness payload is stale (' + changed.join(', ') + ') and re-planning gave ' + fresh.outcome + (fresh.reason ? ' (' + fresh.reason + ')' : '');
        }
      }
    }
    if (!why) {
      const stageSet = new Set(groups.flatMap((g) => g.tcs).filter((tc) => !burnIn.includes(tc)));
      const inUnits = new Set(unitsPlan.units.filter((u) => (u.stages || []).includes(stage)).flatMap((u) => u.tcs || []));
      const missing = [...stageSet].filter((tc) => !inUnits.has(tc));
      if (missing.length) why = 'in no execution unit of the readiness payload: ' + missing.join(', ');
    }
    if (!why) { dsp = await loadModule('dispatch.mjs'); if (dsp.loadError) { why = 'dispatch.mjs could not be loaded (' + dsp.loadError + ')'; dsp = null; } }
    mode = why ? 'serial' : 'dispatch';
    schedRec.fallback = why;
  }
  schedRec.used = mode;
  if (mode === 'serial') {
    // no proof of independence: every group runs with ONE worker (its ceiling re-computed or scaled for it)
    for (const g of groups) {
      if (g.workers > 1) { const one = ceilingsAuto ? ceilingOf(g.name, g.tcs, 1) : null; g.ceilingMs = one || (g.ceilingMs ? Math.round(g.ceilingMs * g.workers) : null); g.serialFallback = true; g.workers = 1; }
      if (!g.ceilingMs) return { ...base, outcome: 'BLOCKED', reason: 'no ceiling for group "' + g.name + '" (--ceilings ' + g.name + '=<ms>, or --ceilings auto with the project\'s timeouts.ts)', errors: ['no ceiling'], warnings };
    }
    if (schedRec.fallback && stage !== 'setup') log(ACTIVITY[stage] + ' · scheduler · serial — ' + schedRec.fallback);
  }
  // the environment lease: held by this run, or the stage does not start anything
  let leaseBlock = null;
  if (envId) {
    try {
      const lv = await cap.validateLease({ dir: coordDir, envId, runId, runFile: posix(runFile), rows: ledger ? await ledger.snapshot() : null });
      Object.assign(leaseRecord, { valid: !!lv.valid, reason: lv.reason || null, bookId: lv.bookId || envId });
      if (!lv.valid) leaseBlock = lv.reason || 'not held by this run';
    } catch (e) { Object.assign(leaseRecord, { valid: false, reason: 'lease check failed: ' + e.message }); leaseBlock = leaseRecord.reason; }
  } else warnings.push('no --env-id: no environment lease is checked — runs on the same environment are not coordinated (capacity.mjs lease acquire at intake)');

  // commands: per group a normal command (its TCs minus the burn-in ones) and a burn-in command
  const reservedAttempts = new Map();
  const allocate = (g) => {
    const stem = stage + '-' + slugOf(g.name);
    let max = reservedAttempts.get(stem) || 0;
    // the output folders count too: an attempt number — and so a folder Playwright would wipe — is never reused
    for (const f of [...readdirSafe(stagesDir), ...readdirSafe(progressDir), ...readdirSafe(outputPhaseDir)]) {
      if (!f.startsWith(stem)) continue;
      const rest = f.slice(stem.length);
      const m = rest.match(/^-attempt(\d+)(\.|$)/);
      if (m) max = Math.max(max, Number(m[1])); else if (/^(\.|$)/.test(rest)) max = Math.max(max, 1);
    }
    g.attempt = max + 1;
    reservedAttempts.set(stem, g.attempt);
    const fileStem = g.attempt === 1 ? stem : stem + '-attempt' + g.attempt;
    g.stageJson = path.join(stagesDir, fileStem + '.json');
    g.progressFile = path.join(progressDir, fileStem + '.jsonl');
    g.resultsFile = path.join(progressDir, fileStem + '.results.jsonl');
    g.watchdogFile = path.join(progressDir, fileStem + '.watchdog.json');
    g.planFile = path.join(progressDir, fileStem + '.plan.json');
    g.rateLimitFile = path.join(progressDir, fileStem + '.ratelimit.jsonl');
    g.outputDir = path.join(outputPhaseDir, fileStem);
    g.diagnosticsDir = path.join(resultsRoot, 'artifacts', 'diagnostics', 'phase-' + (phase || 0), fileStem);
  };
  const scaled = (g, k) => Math.round(g.ceilingMs * Math.max(1, (k * g.workers) / Math.max(1, g.tcs.length)));
  const commands = [];
  if (mode !== 'dispatch') {
    for (const g of groups) {
      const burn = g.tcs.filter((tc) => burnIn.includes(tc));
      const normal = g.tcs.filter((tc) => !burn.includes(tc));
      if (normal.length || stage === 'setup') commands.push({ ...g, kind: 'normal', tcs: normal, onlyTcs: onlyTcs.length || burn.length ? normal : null, extraArgs: extraArgs.slice(), group: g });
      if (burn.length) commands.push({ ...g, kind: 'burn-in', workers: 1, tcs: burn, onlyTcs: burn, extraArgs: ['--repeat-each=' + BURN_IN_REPEATS], ceilingMs: scaled(g, burn.length) * BURN_IN_REPEATS, group: g });
    }
  }

  // dispatch: the stage's execution units (parallel-plan.mjs) — the conflict-free pool as one multi-worker child,
  // every restricted unit as its own child; selected by spec + stage tag + TC list (never a split unit)
  const stageTcSet = new Set(groups.flatMap((g) => g.tcs));
  const dispatchUnits = mode === 'dispatch'
    ? unitsPlan.units.filter((u) => (u.stages || []).includes(stage))
      .map((u) => ({ ...u, tcs: (u.tcs || []).filter((tc) => stageTcSet.has(tc) && !burnIn.includes(tc)) })).filter((u) => u.tcs.length)
    : [];
  if (mode === 'dispatch') {
    const covered = new Set(dispatchUnits.flatMap((u) => u.tcs));
    const uncovered = [...stageTcSet].filter((tc) => !covered.has(tc) && !burnIn.includes(tc));
    if (uncovered.length) warnings.push('dispatch: in no execution unit of this stage (re-run parallel-plan.mjs): ' + uncovered.join(', ') + ' — reported NOT_RUN');
    for (const g of groups) {
      const burn = g.tcs.filter((tc) => burnIn.includes(tc));
      if (burn.length) commands.push({ ...g, kind: 'burn-in', workers: 1, tcs: burn, onlyTcs: burn, extraArgs: ['--repeat-each=' + BURN_IN_REPEATS], ceilingMs: scaled(g, burn.length) * BURN_IN_REPEATS, group: g });
    }
    for (const tc of uncovered) inNoGroup.push(tc);
  }

  const admissionFile = path.join(progressDir, 'admission.json');
  const cancelFile = path.join(progressDir, 'cancel.flag');
  try { fs.rmSync(cancelFile, { force: true }); } catch { /* re-created on a stop */ }
  // a refused worker's note (helpers/admission.ts) belongs to one call's state — its seq restarts with every call
  try { fs.rmSync(admissionFile + '.refused', { force: true }); } catch { /* the helper re-checks the seq and the state */ }
  const ctx = {
    a, stage, run, label, activity, resultsRoot, cwd, phase, project, specs, cmd, cliPath, stageTcs, plan, outputPhaseDir,
    fpSpecs: uniq([...specs, ...((plan.setup_groups || []).map((s) => s.spec).filter(Boolean))]),
    // the rate-limit book: SHARED per environment in the coordination directory when the environment is known
    // overlapping environment identities share ONE book (the lease's bookId — capacity.mjs resolveBook)
    rateLimitState: envId ? path.join(coordDir, 'rate-limits', (leaseRecord.bookId || envId) + '.json') : path.join(progressDir, 'rate-limit.state.json'),
    rateLimitsJson: JSON.stringify(rateLimits),
    headless: !display.headed, graceMs, stageJsonSource: typeof a['stage-json-source'] === 'string' ? a['stage-json-source'] : null,
    intervalMs: Number(a.interval) > 0 ? Number(a.interval) : 5000, statusEveryMs: Number(a['status-every']) > 0 ? Number(a['status-every']) : 30000,
    flags: { watchdogTrusted: true, windowsDllInitCrash: false, watchdogUnreadable: false }, warnings, log, current: null, running: new Map(),
    plannedTotal: commands.reduce((s, g) => s + g.tcs.length, 0) + dispatchUnits.reduce((s, u) => s + u.tcs.length, 0), doneBefore: 0,
    admissionFile, cancelFile, envId, runId, maxWaitMs, silenceMs, timeoutsMode, ledger, excl,
    unitScopesJson: JSON.stringify(unitScopesOf([...stageTcSet], rateLimits, dispatchUnits)),
    admission: { state: 'open', reason: null, cooldowns: [], seq: 0 }, admissionUpdates: 0, laneSeq: 0,
    shadow: { seen: new Set(), would_stop: [], long_deadlines: [], stalls: [] },
  };
  // the admission state children read (assets/admission.template.ts) — written ONLY here, temp + rename, ≤ 1 s after a change
  const publishAdmission = (patch) => {
    Object.assign(ctx.admission, patch);
    ctx.admission.seq++;
    const now = Date.now();
    ctx.admission.cooldowns = ctx.admission.cooldowns.filter((c) => Date.parse(c.until) > now);
    const body = JSON.stringify({ schema: ADMISSION_SCHEMA, runId, seq: ctx.admission.seq, updatedAt: iso(now), state: ctx.admission.state, reason: ctx.admission.reason, cooldowns: ctx.admission.cooldowns, maxWaitMs });
    try { const tmp = admissionFile + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, body); fs.renameSync(tmp, admissionFile); }
    catch { try { fs.writeFileSync(admissionFile, body); } catch { /* the children keep the last state they read */ } }
    ctx.admissionUpdates++;
  };
  publishAdmission({ state: leaseBlock ? 'paused' : 'open', reason: leaseBlock ? 'environment lease: ' + leaseBlock : null });
  // the live worker view (artifacts/progress/status.json + one log line) — written only when it CHANGES: a command
  // starts or ends, a test starts or ends (pass / fail), the worker count changes; never on a timer, never polled
  const statusFile = path.join(progressDir, 'status.json');
  let lastStatusKey = null;
  ctx.publishStatus = (event) => {
    const active = [...ctx.running.keys()].map((g) => ({ command: g.name, workers: g.workers, tcs: g.progressFile ? uniq(testIntervals(g.progressFile).filter((s) => s.end === Infinity).flatMap((s) => s.tcs)) : [] }));
    const key = JSON.stringify(active);
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    const activeWorkers = active.reduce((s, x) => s + x.workers, 0);
    const line = 'Auto ceiling ' + ceil.ceiling + ' (' + ceil.source + ') · active ' + activeWorkers + ' worker(s)'
      + (active.length ? ' · ' + active.map((x) => x.command + ' ×' + x.workers + ': ' + (x.tcs.join(', ') || '—')).join(' · ') : '') + ' · ' + (display.headed ? 'headed' : 'headless — ' + (display.reason || 'requested'));
    try { const tmp = statusFile + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ schema: 'skill5-status/1', at: iso(Date.now()), event, stage, run, ceiling: ceil.ceiling, ceilingSource: ceil.source, headed: display.headed, activeWorkers, active, line }, null, 2) + '\n'); fs.renameSync(tmp, statusFile); } catch { /* the log line still carries it */ }
    log(activity + ' · status · ' + line);
  };
  let pressureEpisodes = [];
  if (ledger) {
    let prevCpu = cpuTimes();
    let expected = Date.now() + 2000;
    ledger.timer = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - expected);
      expected = now + 2000;
      const cur = cpuTimes();
      const dt = cur.total - prevCpu.total;
      ledger.lastCpu = dt > 0 ? Math.round(1000 * (1 - (cur.idle - prevCpu.idle) / dt)) / 10 : ledger.lastCpu;
      const hf = hostFixture();
      if (hf && typeof hf.cpuPct === 'number') ledger.lastCpu = hf.cpuPct;
      prevCpu = cur;
      ledger.availMb = availableMemMb();
      ledger.lastLag = lag;
      // the ONE host sampler of the call: its readings feed the pressure monitor, the ramp, the summary's `host` and
      // (with --telemetry) the telemetry — nothing samples the host a second time
      const hs = ledger.hostStats;
      hs.samples++;
      hs.minAvailableMb = hs.minAvailableMb === null ? ledger.availMb : Math.min(hs.minAvailableMb, ledger.availMb);
      if (typeof ledger.lastCpu === 'number') hs.peakCpuPct = hs.peakCpuPct === null ? ledger.lastCpu : Math.max(hs.peakCpuPct, ledger.lastCpu);
      hs.maxLagMs = Math.max(hs.maxLagMs, lag);
      const s = ledger.pm.sample({ now, availableMb: ledger.availMb, cpuPct: ledger.lastCpu, lagMs: lag });
      if (s && s.changed) {
        publishAdmission(s.state === 'pressure' ? { state: 'paused', reason: 'host pressure: ' + (s.reason || 'resources below the reserve') } : { state: leaseBlock ? 'paused' : 'open', reason: leaseBlock ? 'environment lease: ' + leaseBlock : null });
        log(activity + ' · host ' + (s.state === 'pressure' ? 'PRESSURE — new commands and new tests held back: ' + (s.reason || '') : 'recovered — admissions resume'));
      }
    }, 2000);
    ledger.timer.unref();
    // the descendants of every running reservation (browsers included, by profile marker) and their working set
    ledger.trackTimer = setInterval(async () => {
      if (!ctx.running.size || ledger.tracking) return;
      ledger.tracking = true;
      try {
        const rows = await ledger.fresh();
        if (!rows) return;   // no table this time: the next interval tries again (nothing is decided on an unknown table)
        for (const [g, child] of ctx.running) {
          if (!g.ledgerToken) continue;
          try { await cap.track({ dir: ledger.dir, token: g.ledgerToken, rows }); } catch { /* next interval */ }
          const d = descendantsOf(rows.map((r) => ({ pid: r.pid, ppid: r.ppid, rssBytes: r.rssBytes || 0 })), [child.pid]);
          if (d.count) { ledger.observed[g.ledgerToken] = Math.round(d.rssBytes / MBYTE); g.peakRssMb = Math.max(g.peakRssMb || 0, ledger.observed[g.ledgerToken]); }
        }
      } finally { ledger.tracking = false; }
    }, treeIntervalMs);
    ledger.trackTimer.unref();
  }
  if (excl) {
    // exclusive execution keeps the ownership record: the command's tree (browsers included) whenever a listing works
    excl.trackTimer = setInterval(async () => {
      if (!ctx.running.size || excl.tracking) return;
      excl.tracking = true;
      try {
        const rows = await excl.fresh();
        if (!rows) return;
        for (const [g] of ctx.running) if (g.exclusiveToken) { try { await cap.track({ dir: excl.dir, token: g.exclusiveToken, rows }); } catch { /* next interval */ } }
      } finally { excl.tracking = false; }
    }, treeIntervalMs);
    excl.trackTimer.unref();
  }
  const underPressure = () => { if (!ledger) return false; const st = ledger.pm.state(); return (typeof st === 'string' ? st : st && st.state) === 'pressure'; };
  // the host admits a command of k workers now? (memory / CPU after everything committed, pressure, the lease)
  const admissionFor = (k, capacityOnly = false) => (led) => {
    const now = Date.now();
    const committed = cap.committedOutstanding((led && led.entries) || [], ledger.observed, now);
    const idleCores = ledger.cpus * (1 - (ledger.lastCpu || 0) / 100);
    return cap.admissionCheck({ availableMb: ledger.availMb, idleCores, committed, demand: { memMb: ledger.per.memMb * k, cpu: ledger.per.cpu * k }, reserves: ledger.reserves,
      pressure: capacityOnly ? false : underPressure(), leaseValid: capacityOnly ? true : !leaseBlock });
  };
  // reserve a command's full --workers before it is spawned; the host may LOWER a group's workers (never raise),
  // zero admissible → wait up to --max-wait, then the command's TCs are NOT_RUN with the reason
  ledger && (ledger.reserveFor = async (g, waitMs) => {
    const t0 = Date.now();
    let led = null;
    try { led = cap.readLedger(ledger.dir); } catch { led = null; }
    if (g.workers > 1 && led) {
      // the largest worker count the host's CAPACITY admits now (a passing pressure episode never lowers it — the
      // reservation below waits for it instead); none admissible → wait for one worker, never for more
      let k = g.workers;
      while (k > 1 && !(admissionFor(k, true)(led) || {}).ok) k--;
      if (k < g.workers) {
        ledgerRecord.lowered.push({ group: g.name, command: g.kind, from: g.workers, to: k, by: 'host capacity (memory / CPU after the reserve)' });
        g.ceilingMs = Math.round(g.ceilingMs * (g.workers / k));
        g.workers = k;
      }
    }
    if (led && !(admissionFor(g.workers)(led) || {}).ok && typeof ledger.pm.noteBlocked === 'function') ledger.pm.noteBlocked();
    let r;
    try {
      r = await cap.reserve({ dir: ledger.dir, cls: 'playwright', units: g.workers, limit: ledger.ceiling, machineCeiling: ceil.base, demand: { memMb: ledger.per.memMb * g.workers, cpu: ledger.per.cpu * g.workers },
        owner: { runId, runFile: posix(runFile) }, environment: envId, admission: admissionFor(g.workers), waitMs, pollMs: 2000, snapshot: ledger.fresh });
    } catch (e) { r = e instanceof cap.LockBusyError ? { ok: false, reason: 'capacity ledger busy (' + e.message + ')' } : { ok: false, code: 'coordination', reason: 'the capacity ledger could not be used (' + e.message + ')' }; }
    const rec = { token: r.ok ? r.token : null, group: g.name, command: g.kind, units: g.workers, waitedMs: Date.now() - t0, released: null, alive: [] };
    ledgerRecord.reservations.push(rec);
    if (r.ok) { g.ledgerToken = r.token; g.ledgerRec = rec; return { ok: true }; }
    const why = leaseBlock ? REASON.lease(leaseBlock) : r.code === 'ledger-error' || r.code === 'coordination' ? REASON.noCoordination(r.reason) : underPressure() ? REASON.hostPressure : REASON.admissionTimeout(r.reason || 'machine ceiling: no free worker slot');
    rec.reason = why;
    return { ok: false, reason: why };
  });
  // the spawned process (the ledger-exec wrapper) with its spawn moment — compared leniently, refined by the tree walk
  const activateWith = (coord, token, g, child) => cap.activate({ dir: coord.dir, token, pid: child.pid, start: g.startedAt || Date.now(), startSource: 'spawn' });
  ledger && (ledger.activate = async (g, child) => { try { await activateWith(ledger, g.ledgerToken, g, child); } catch (e) { warnings.push('ledger activate failed for ' + g.name + ': ' + e.message); } });
  // release only on a fresh table that shows nothing the command owns alive — our own leftovers (with their recorded
  // identity) are stopped first; no table → the slots stay held and later commands wait
  const releaseCmd = async (coord, token, g, label) => {
    const r = await cap.releaseConfirmed({ dir: coord.dir, token, snapshot: coord.fresh, attempts: 4, delayMs: 2000, kill: killPid });
    g.ledgerRec.released = r.released;
    g.ledgerRec.alive = r.alive || [];
    g.ledgerRec.confirmed = r.confirmed;
    if (r.killed.length) g.ledgerRec.killed = r.killed;
    if (!r.released) warnings.push(label + ': ' + g.name + ' still holds ' + g.workers + ' slot(s) — ' + (r.confirmed === 'none'
      ? 'no process table could be read, so its processes could not be confirmed stopped; later commands wait until a table confirms it (`capacity.mjs sweep`), or a user frees it after checking (`capacity.mjs release --token ' + token + ' --force`)'
      : (g.ledgerRec.alive.length || 'some') + ' of its processes are still alive (state releasing; `run-stage.mjs reclaim` or the next sweep resolves it)'));
  };
  ledger && (ledger.releaseFor = async (g) => {
    if (!g.ledgerToken) return;
    await releaseCmd(ledger, g.ledgerToken, g, 'ledger');
    if (g.peakRssMb && g.workers) writeDemand(cap, ledger.dir, ledger.kind, g.peakRssMb / g.workers);
  });
  // exclusive execution: the command waits until no other Playwright command runs on the machine, then holds the class
  // alone; its owner is judged by PID, its release needs a fresh table (confirm: 'table')
  excl && (excl.reserveFor = async (g, waitMs) => {
    const t0 = Date.now();
    let r;
    try {
      r = await cap.reserve({ dir: excl.dir, cls: 'playwright', units: g.workers, limit: excl.ceiling, machineCeiling: ceil.base, exclusive: true, liveness: 'pid', confirm: 'table', owner: { runId, runFile: posix(runFile) }, environment: envId, waitMs, pollMs: 2000, snapshot: excl.fresh });
    } catch (e) { r = e instanceof cap.LockBusyError ? { ok: false, reason: 'capacity ledger busy (' + e.message + ')' } : { ok: false, code: 'coordination', reason: 'the capacity ledger could not be used (' + e.message + ')' }; }
    const rec = { token: r.ok ? r.token : null, group: g.name, command: g.kind, units: g.workers, exclusive: true, waitedMs: Date.now() - t0, released: null, alive: [] };
    ledgerRecord.reservations.push(rec);
    if (r.ok) { g.exclusiveToken = r.token; g.ledgerRec = rec; return { ok: true }; }
    const why = r.code === 'ledger-error' || r.code === 'coordination' ? REASON.noCoordination(r.reason) : REASON.admissionTimeout('exclusive execution: ' + (r.reason || 'another Playwright command runs on this machine'));
    rec.reason = why;
    return { ok: false, reason: why };
  });
  excl && (excl.activate = async (g, child) => { try { await activateWith(excl, g.exclusiveToken, g, child); } catch (e) { warnings.push('exclusive reservation: activate failed for ' + g.name + ': ' + e.message); } });
  excl && (excl.releaseFor = async (g) => { if (g.exclusiveToken) await releaseCmd(excl, g.exclusiveToken, g, 'exclusive reservation'); });

  ctx.freezeKills = watchdogSane();
  if (!ctx.freezeKills) { ctx.flags.watchdogTrusted = false; warnings.push('the watchdog failed its sanity check — freeze stops are disabled for this stage; only the outer ceiling applies and every stop is recorded unresolved'); }
  const stopSignals = () => {
    try { fs.writeFileSync(cancelFile, iso(Date.now())); } catch { /* the kill below still stops everything */ }
    for (const [, child] of ctx.running) killTree(child);
    if (ctx.current) killTree(ctx.current);
    log(activity + ' · interrupted by a signal — the running command(s) were stopped');
    process.exit(130);
  };
  process.once('SIGINT', stopSignals);
  process.once('SIGTERM', stopSignals);

  const startedAt = Date.now();
  const callTcs = uniq([...commands.flatMap((g) => g.tcs), ...dispatchUnits.flatMap((u) => u.tcs)]);
  const codeStart = stage === 'setup' ? null : await fingerprintCall(ctx, callTcs);
  if (codeStart && codeStart.error) warnings.push('code fingerprint unavailable (' + codeStart.error + ') — every TC of this call will read as stale to impact.mjs select');
  log(activity + ' · stage start · ' + (mode === 'dispatch' ? 'dispatch: ' + plural(dispatchUnits.length, 'unit') + ' (' + plural(callTcs.length, 'TC') + ')'
    : commands.length ? commands.map((g) => g.name + (g.kind === 'normal' ? '' : ' ' + g.kind) + ' ×' + g.workers + ' (' + plural(g.tcs.length, 'TC') + ')').join(', ') : 'no group has TCs in this stage')
    + (skippedGroups.length ? ' · skipped: ' + skippedGroups.map((s) => s.name).join(', ') : '') + ' · results ' + posix(resultsRoot)
    + (ledger ? ' · ledger ceiling ' + ledger.ceiling + ' (' + ledger.ceil.source + ')' : ' · exclusive execution (' + exclReason + '), ceiling ' + ceil.ceiling + ' (' + ceil.source + ')'));
  for (const s of skippedGroups) log(activity + ' · ' + s.name + ' · skipped — ' + s.reason);
  // observe only: started after the setup work above, stopped before any result is merged
  const telemetry = telemetryOff ? null : startTelemetry({ intervalMs: telemetryIntervalMs, treeIntervalMs, current: () => [...ctx.running].map(([g, child]) => ({ child, command: g })),
    // the ledger's 2 s sampler already reads memory / CPU / lag: telemetry reuses those readings
    ...(ledger ? { hostSample: () => ({ freeBytes: ledger.availMb * MBYTE, cpuPct: ledger.lastCpu, lagMs: ledger.lastLag }) } : {}),
    // an explicit telemetry fixture (harness) wins over the ledger's table
    ...(ledger && !process.env.QA_TELEMETRY_PS_FIXTURE ? { snapshot: async () => { const rows = await ledger.snapshot(Math.max(5000, treeIntervalMs - 1000)); return rows ? { rows: rows.map((r) => ({ pid: r.pid, ppid: r.ppid, rssBytes: r.rssBytes || 0 })), error: null } : { rows: null, error: ledger.listingError || 'no process table' }; } } : {}) });

  const ran = [];
  const notRunGroups = [];
  let outcome = 'COMPLETED';
  let reason = null;
  const rateAdjustments = [];
  const cooldowns = [];
  const rateScopes = [];
  const deferredAll = [];
  let pendingCooldown = 0;
  let envRefusal = false;
  let scopedWait = null;
  let refusalRounds = 0;
  const admissionHelper = isFile(path.join(cwd, 'helpers', 'admission.ts')) || isFile(path.join(cwd, 'helpers', 'admission.js'));
  // one command: reserve (ledger) → spawn → monitor → release; `reserved` = a reservation the dispatcher already holds.
  // Once the host refused one command for the whole --max-wait, the rest of the stage is not started either.
  let admissionGaveUp = null;
  const exec = async (g, later, { reserved = false } = {}) => {
    if (leaseBlock) { g.notAdmitted = REASON.lease(leaseBlock); ran.push(g); return true; }
    if (admissionGaveUp && !reserved) { g.notAdmitted = admissionGaveUp; ran.push(g); return true; }
    if (!cliPath && !cmd) {
      g.spawnError = 'Playwright CLI entry not found under ' + posix(cwd) + '/node_modules (@playwright/test/cli.js) — pass --cli or --cmd';
    } else {
      const coord = ledger || excl;
      if (coord && !reserved) {
        const r = await coord.reserveFor(g, maxWaitMs);
        if (!r.ok) { g.notAdmitted = r.reason; admissionGaveUp = r.reason; ran.push(g); log(activity + ' · ' + g.name + ' · NOT STARTED — ' + r.reason); return true; }
      }
      allocate(g);
      g.lane = ++ctx.laneSeq;
      // a ceiling margin of max(60 s, 10 %) unless given — Playwright stops itself at its ceiling first
      g.marginMs = Number(a['ceiling-margin']) >= 0 && a['ceiling-margin'] !== undefined ? Number(a['ceiling-margin']) : Math.max(60000, Math.round(g.ceilingMs * 0.1));
      try { await runCommand(ctx, g, later); } finally { if (ledger && g.ledgerToken) await ledger.releaseFor(g); else if (excl && g.exclusiveToken) await excl.releaseFor(g); }
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
  // refusals of a finished command: environment-wide → fewer workers + a cool-down for the rest of the stage (as before);
  // scoped → the scope's cool-down goes to the admission file (tests touching it wait inside), and without the
  // admission helper the runner waits for it before the next command — workers unchanged
  const afterRefusals = (g) => {
    if (!g.rate || !g.rate.refused.length) return;
    refusalRounds++;
    const sc = refusalScopes(g.rate.refused, rateLimits);
    rateScopes.push(...sc.scopes.map((s) => ({ ...s, group: g.name, attempt: g.attempt })));
    const bound = cooldownFor(g.rate.refused, cooldownMs, cooldownMaxMs, refusalRounds - 1);
    const wait = hasServerDeadline(g.rate.refused) ? bound : jitterWait(bound);
    const until = iso(Date.now() + wait);
    if (sc.environmentWide) {
      envRefusal = true;
      pendingCooldown = Math.max(pendingCooldown, wait);
      publishAdmission({ cooldowns: [...ctx.admission.cooldowns, { scope: 'environment', until }] });
      return;
    }
    publishAdmission({ cooldowns: [...ctx.admission.cooldowns, ...sc.scopes.map((s) => ({ scope: s.scope, until: s.notBefore && Date.parse(s.notBefore) > Date.now() + wait ? s.notBefore : until }))] });
    if (!admissionHelper) scopedWait = { ms: Math.max(scopedWait ? scopedWait.ms : 0, wait), scope: sc.scopes.map((s) => s.scope).join(', ') };
  };
  const beforeNext = async (g) => {
    if (envRefusal) {
      // the application refused requests environment-wide earlier in this stage: cool down, then fewer workers and a scaled ceiling
      const adj = { after: ran.length ? ran[ran.length - 1].name : null, group: g.name, command: g.kind, workers_from: g.workers, workers_to: g.workers, ceiling_from: g.ceilingMs, ceiling_to: g.ceilingMs, cooldown_ms: pendingCooldown, scope: 'environment' };
      if (g.workers > 1) { const w = Math.max(1, Math.floor(g.workers / 2)); g.ceilingMs = Math.round(g.ceilingMs * (g.workers / w)); g.workers = w; adj.workers_to = w; adj.ceiling_to = g.ceilingMs; }
      if (pendingCooldown > maxWaitMs) return { deferUntil: iso(Date.now() + pendingCooldown) };
      if (pendingCooldown) { log(activity + ' · rate limit (environment-wide) · cool-down ' + secs(pendingCooldown) + ' s before ' + g.name); cooldowns.push(pendingCooldown); await sleep(pendingCooldown); pendingCooldown = 0; }
      if (adj.cooldown_ms || adj.workers_to !== adj.workers_from) rateAdjustments.push(adj);
    } else if (scopedWait && scopedWait.ms) {
      const adj = { after: ran.length ? ran[ran.length - 1].name : null, group: g.name, command: g.kind, workers_from: g.workers, workers_to: g.workers, ceiling_from: g.ceilingMs, ceiling_to: g.ceilingMs, cooldown_ms: scopedWait.ms, scope: scopedWait.scope };
      if (scopedWait.ms > maxWaitMs) return { deferUntil: iso(Date.now() + scopedWait.ms) };
      log(activity + ' · rate limit · ' + scopedWait.scope + ' cool-down ' + secs(scopedWait.ms) + ' s before ' + g.name + ' (no admission helper in the project: the runner waits; workers unchanged)');
      cooldowns.push(scopedWait.ms);
      await sleep(scopedWait.ms);
      rateAdjustments.push(adj);
      scopedWait = null;
    }
    return {};
  };
  const deferCommand = (g, until) => {
    for (const tc of g.tcs) deferredAll.push({ tc, until, scope: envRefusal ? 'environment' : (scopedWait && scopedWait.scope) || null });
    notRunGroups.push({ name: g.name, tcs: g.tcs, reason: REASON.deferred(until) });
    log(activity + ' · ' + g.name + ' · deferred until ' + until + ' — the server\'s deadline is beyond --max-wait');
  };

  /* ---- groups: one command after another, in plan order ---- */
  for (let i = 0; i < commands.length; i++) {
    const g = commands[i];
    const b = await beforeNext(g);
    if (b.deferUntil) { for (const r of commands.slice(i)) deferCommand(r, b.deferUntil); break; }
    const ok = await exec(g, commands.slice(i + 1));
    if (!ok) { stopRest(commands.slice(i + 1), g); break; }
    afterRefusals(g);
  }

  /* ---- dispatch: units side by side, never two conflicting ones, within the ledger ---- */
  const dispatchRecord = { scheduler: mode, schedulerDecision: schedRec, timeline: [], conflicts: [], pool: [], validatedWorkers: null, ramp: [], rampRecords: [], units: dispatchUnits.length };
  if (mode === 'dispatch' && dispatchUnits.length && outcome === 'COMPLETED') {
    const prior = readdirSafe(progressDir).filter((f) => /^(first|rerun)-[a-z]+-\d+\.summary\.json$/.test(f))
      .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(progressDir, f), 'utf8')); } catch { return null; } }).filter(Boolean)
      .sort((x, y) => (Date.parse(x.startedAt) || 0) - (Date.parse(y.startedAt) || 0));
    const replay = prior.flatMap((s) => (s.dispatch && s.dispatch.rampRecords) || []);
    // the remembered validated count is read once per phase (the first dispatched stage) and replayed as it was then
    const priorTarget = prior.map((s) => s.dispatch && s.dispatch.rampTarget).find((v) => v !== undefined);
    const target = replay.length ? (priorTarget ?? null) : readRampMemory(coordDir, envId, ledger.kind);
    dispatchRecord.rampTarget = target;
    // windows of 60 s of summed batch wall time, one window between changes — the batches let it converge in a stage
    const ramp = dsp.createRamp({ w0: Math.min(2, ledger.ceiling), ceiling: ledger.ceiling, minWindowMs: 60000, spacingWindows: 1, target });
    for (const r of replay) ramp.record(r);
    const poolIds = new Set((unitsPlan.pool || []).filter((id) => dispatchUnits.some((u) => u.id === id)));
    const poolUnits = dispatchUnits.filter((u) => poolIds.has(u.id));
    dispatchRecord.pool = [...poolIds];
    dispatchRecord.conflicts = (unitsPlan.conflicts || []).filter((c) => dispatchUnits.some((u) => u.id === c.a) && dispatchUnits.some((u) => u.id === c.b));
    const history = Object.fromEntries(dispatchUnits.map((u) => [u.id, u.expectedMs || null]));
    const sched = dsp.createScheduler({ units: dispatchUnits, pool: [...poolIds], history });
    const mkCmd = (name, unitId, tcs, workers, specsOf, unitMap) => ({
      name, unitId, mode: workers > 1 ? 'parallel' : 'serial', workers, tcs, onlyTcs: tcs, specs: specsOf.length ? specsOf : specs, extraArgs: extraArgs.slice(), kind: 'normal',
      ceilingMs: ceilingOf(name, tcs, workers) || 1, filter: unitFilterOf(stage, tcs), unitMap, group: null,
    });
    const specsOfUnit = (u) => uniq(((u.selector && u.selector.specs) || [u.spec]).filter(Boolean));
    const runningUnits = new Map();      // unit id (or 'pool') → { g, promise }
    const pending = dispatchUnits.filter((u) => !poolIds.has(u.id)).map((u) => ({ u, waitingSince: null }));
    let poolPending = new Set(poolIds);
    let poolCmd = null;
    const globalUnit = (id) => { const u = dispatchUnits.find((x) => x.id === id); return !!(u && typeof dsp.isGlobal === 'function' && dsp.isGlobal(u)); };
    // one command to its end: the timeline (a run-alone / barrier unit marked `global` — run-data verify 25b checks it
    // overlapped nothing), the scheduler, the scoped cool-downs
    const runOne = async (key, g, unitIds, reserved) => {
      const t0 = Date.now();
      const ok = await exec(g, [], { reserved });
      dispatchRecord.timeline.push({ unit: key, units: unitIds, command: g.name, attempt: g.attempt || null, start: iso(g.startedAt || t0), end: iso(g.finishedAt || Date.now()), workers: g.workers, tcs: g.tcs,
        ...(unitIds.some(globalUnit) ? { global: true } : {}), ...(g.batch ? { batch: g.batch } : {}), notAdmitted: g.notAdmitted || undefined });
      for (const id of unitIds) { try { sched.done(id, { status: ok && !g.notAdmitted ? 'done' : 'stopped' }); } catch { /* unknown to the scheduler */ } }
      afterRefusals(g);
      return ok;
    };
    // a unit command runs under the reservation the loop below took
    const launch = (key, g, unitIds, reserved) => {
      const promise = runOne(key, g, unitIds, reserved).then((ok) => { runningUnits.delete(key); return ok; });
      runningUnits.set(key, { g, promise });
    };
    // the ramp sees every pool batch: completed tests, the batch's monotonic wall span (start-up and clean-up included),
    // host health from the ledger's sampler, throttling split by scope, crashes; expected durations only normalise
    const rampSample = (g, take, wallMs) => {
      if (g.notAdmitted || g.spawnError) return;
      const lines = jsonl(g.resultsFile);
      const durs = lines.map((l) => Number(l.duration_ms) || 0).filter((x) => x > 0).sort((x, y) => x - y);
      const p95 = durs.length ? durs[Math.min(durs.length - 1, Math.ceil(0.95 * durs.length) - 1)] : null;
      const expectedMs = take.every((u) => typeof u.expectedMs === 'number') ? take.reduce((s, u) => s + u.expectedMs, 0) : undefined;
      const sc = g.rate && g.rate.refused.length ? refusalScopes(g.rate.refused, rateLimits) : null;
      const rec = { now: Date.now(), batch: g.batch, workers: g.workers, completed: lines.length, wallMs, durationMs: (g.finishedAt || Date.now()) - (g.startedAt || Date.now()), expectedMs,
        cpuPct: ledger.lastCpu, availableMb: ledger.availMb, needMb: ledger.reserves.memMb + ledger.per.memMb,
        refusal: !!(sc && !sc.environmentWide), envRefusal: !!(sc && sc.environmentWide), crash: !!g.dllCrash, interference: false, p95Ms: p95 };
      dispatchRecord.rampRecords.push(rec);
      let d = null;
      try { d = ramp.record(rec); } catch (e) { warnings.push('ramp: ' + e.message); }
      if (d && d.action !== 'hold') log(activity + ' · ramp · ' + d.action + ' → ' + d.workers + ' worker(s) — ' + d.reason);
    };
    // the pool in BATCHES: each batch is one multi-worker command over the next pool units (never a split unit), its
    // workers = the ramp's count, never above the ceiling slots free now; reserved and released (confirmed) per batch
    const poolQueue = poolUnits.slice();
    let poolSeq = 0;
    const runPoolBatches = async () => {
      while (poolQueue.length && outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED') {
        let w = Math.max(1, Math.min(ramp.workers(), ledger.ceiling));
        try { const led = cap.readLedger(ledger.dir); if (!led.error) w = Math.max(1, Math.min(w, ledger.ceiling - cap.usedUnits(led.entries, 'playwright'))); } catch { /* the reservation still bounds it */ }
        const size = Math.max(BATCH_PER_WORKER * w, BATCH_MIN);
        const take = [];
        while (poolQueue.length && (!take.length || take.reduce((s, u) => s + u.tcs.length, 0) + poolQueue[0].tcs.length <= size)) take.push(poolQueue.shift());
        const tcsB = uniq(take.flatMap((u) => u.tcs));
        poolCmd = mkCmd('pool-b' + (++poolSeq), 'pool', tcsB, Math.min(w, tcsB.length), uniq(take.flatMap(specsOfUnit)), Object.fromEntries(take.flatMap((u) => u.tcs.map((tc) => [tc, u.id]))));
        poolCmd.batch = poolSeq;
        const t0 = performance.now();
        const ok = await runOne('pool', poolCmd, take.map((u) => u.id), false);
        rampSample(poolCmd, take, Math.round(performance.now() - t0));
        if (!ok) { if (poolQueue.length) stopRest([{ name: 'pool (remaining batches)', tcs: uniq(poolQueue.splice(0).flatMap((u) => u.tcs)) }], poolCmd); return false; }
      }
      return true;
    };
    if (poolUnits.length) {
      const promise = runPoolBatches().then((ok) => { runningUnits.delete('pool'); return ok; });
      runningUnits.set('pool', { g: null, promise });
    }
    // pool units not finished yet (queued, or in the running batch without a result) keep conflicting units waiting
    const poolDone = () => {
      if (!runningUnits.has('pool')) { poolPending = new Set(); return; }
      const finished = poolCmd && poolCmd.resultsFile ? new Set(jsonl(poolCmd.resultsFile).flatMap((r) => (Array.isArray(r.tc) ? r.tc : []))) : new Set();
      const inBatch = new Set(poolCmd && poolCmd.unitMap ? Object.values(poolCmd.unitMap) : []);
      poolPending = new Set([...poolIds].filter((id) => {
        if (poolQueue.some((u) => u.id === id)) return true;
        if (!inBatch.has(id)) return false;
        const u = dispatchUnits.find((x) => x.id === id);
        return !(u && u.tcs.every((tc) => finished.has(tc)));
      }));
    };
    while (pending.length || runningUnits.size) {
      if (outcome === 'SPAWN_FAILED' || outcome === 'FRESHNESS_FAILED') break;
      poolDone();
      let started = true;
      while (started && pending.length) {
        started = false;
        const pick = sched.next({ running: [...runningUnits.keys()].filter((k) => k !== 'pool'), poolPending: [...poolPending], freeSlots: ledger.ceiling, now: Date.now() });
        const unit = pick && pick.start;
        if (!unit) break;
        const idx = pending.findIndex((p) => p.u.id === unit.id);
        if (idx < 0) break;
        const entry = pending[idx];
        const g = mkCmd('unit:' + unit.id, unit.id, entry.u.tcs, 1, specsOfUnit(entry.u), Object.fromEntries(entry.u.tcs.map((tc) => [tc, unit.id])));
        const r = await ledger.reserveFor(g, 0);
        if (!r.ok) {
          // next() already counted the unit as started: hand it back, or it would never be offered again
          try { sched.requeue(unit.id, { now: Date.now() }); } catch { /* an older dispatch.mjs: the bounded wait below still ends the loop */ }
          entry.waitingSince = entry.waitingSince || Date.now();
          if (Date.now() - entry.waitingSince > maxWaitMs) { pending.splice(idx, 1); notRunGroups.push({ name: g.name, tcs: g.tcs, reason: r.reason }); try { sched.done(unit.id, { status: 'not-started' }); } catch { /* ignore */ } started = true; }
          break;
        }
        pending.splice(idx, 1);
        launch(unit.id, g, [unit.id], true);
        started = true;
      }
      if (!runningUnits.size && pending.length) {
        // nothing runs and nothing could start: capacity / pressure keeps every unit out — wait (bounded), never forever
        const oldest = Math.min(...pending.map((p) => p.waitingSince || Date.now()));
        if (Date.now() - oldest > maxWaitMs) {
          for (const p of pending.splice(0)) notRunGroups.push({ name: 'unit:' + p.u.id, tcs: p.u.tcs, reason: underPressure() ? REASON.hostPressure : REASON.admissionTimeout('no admissible unit within ' + secs(maxWaitMs) + ' s') });
          break;
        }
        for (const p of pending) p.waitingSince = p.waitingSince || Date.now();
      }
      await Promise.race([...[...runningUnits.values()].map((x) => x.promise), sleep(ctx.intervalMs)]);
    }
    // interference is known only after the isolation check: the ramp gets it then (see below)
    if (poolSeq) dispatchRecord.pendingRamp = { ramp };
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
  const admissionTimeouts = [];
  const absorb = (g) => {
    if (g.notAdmitted) { for (const tc of g.tcs) if (!(tc in tcs) || tcs[tc] === 'NOT_RUN') { tcs[tc] = 'NOT_RUN'; reasons[tc] = g.notAdmitted; } return; }
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
    deferredAll.push(...r.deferred);
    admissionTimeouts.push(...r.admissionTimeouts);
    journeys.passed += r.journeys.passed; journeys.failed += r.journeys.failed; journeys.other += r.journeys.other;
    if (stage === 'setup') journeysByGroup[g.name] = { passed: r.journeys.passed, failed: r.journeys.failed, other: r.journeys.other };
    if (r.unplanned.length) warnings.push(g.name + ': executed but not in --stage-tcs: ' + r.unplanned.join(', ') + ' — check the stage tags against the document');
    if (g.source === 'none') warnings.push(g.name + ': no test matched the stage filter although the plan lists ' + plural(g.tcs.length, 'TC') + ' — check the @run / stage tags');
  };
  for (const g of ran) absorb(g);

  /* ---- deferred TCs whose server deadline falls inside the stage window run again once it has passed ---- */
  const stageAlive = () => outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED' && !leaseBlock;
  if (stageAlive() && stage !== 'setup') {
    const due = uniq(deferredAll.filter((d) => tcs[d.tc] === 'NOT_RUN' && d.until && instantOf(d.until) !== null && instantOf(d.until) - Date.now() <= maxWaitMs).map((d) => d.tc));
    if (due.length) {
      const waitMs = Math.max(0, Math.max(...deferredAll.filter((d) => due.includes(d.tc)).map((d) => instantOf(d.until))) - Date.now());
      log(activity + ' · deferred · ' + plural(due.length, 'TC') + ' re-queued after the server deadline (' + secs(waitMs) + ' s): ' + due.join(', '));
      if (waitMs) { cooldowns.push(waitMs); await sleep(waitMs); }
      const byGroup = new Map();
      for (const tc of due) { const src = lastCmd[tc] || ran.find((x) => x.tcs.includes(tc)); const k = src ? baseOf(src) : null; if (!k) continue; if (!byGroup.has(k)) byGroup.set(k, { b: k, list: [] }); byGroup.get(k).list.push(tc); }
      for (const [, { b, list }] of byGroup) {
        // a re-queued attempt is an ordinary command of its group / unit (next attempt number), alone
        const g = { ...b, kind: 'normal', requeued: true, workers: 1, tcs: list, onlyTcs: list, extraArgs: [], ceilingMs: scaled(b, list.length), group: b, filter: b.filter ? unitFilterOf(stage, list) : null };
        const ok = await exec(g, []);
        if (!ok) break;
        absorb(g);
      }
    }
  }

  /* ---- the isolation check: a failure beside other tests is not a verdict until the TC ran alone ---- */
  const isolation = { ran: [], passed_alone: [], failed_alone: [], rate_limited: [], overlap_rerun: [], overlap_failed_alone: [], skipped: null, cooldown_ms: 0, deferred: [] };
  const interference = [];
  const testsOf = (g) => (perCmd.get(g) ? perCmd.get(g).tests : []);
  const refusedOf = (g, tc) => (testsOf(g).some((t) => t.tcs.includes(tc) && t.expectsRefusal) ? [] : refusedInFailingStep(g, tc));
  // a command ran BESIDE OTHERS when it had workers > 1 or its run overlapped another command of this call (dispatch:
  // the pool and every unit child run side by side, each with workers 1) — never judged by its own worker count alone
  const overlapsCmd = (a, b) => a !== b && a.startedAt && b.startedAt && a.startedAt < (b.finishedAt || Infinity) && b.startedAt < (a.finishedAt || Infinity);
  const sideBy = (g) => ran.filter((o) => o.kind === 'normal' && overlapsCmd(g, o));
  const concurrent = (g) => g.kind === 'normal' && (g.workers > 1 || sideBy(g).length > 0);
  if (stageAlive() && stage !== 'setup') {
    const candidates = [];
    const besideOthers = new Set();
    for (const g of ran) if (concurrent(g) && perCmd.has(g)) for (const tc of g.tcs) besideOthers.add(tc);
    for (const [tc, s] of Object.entries(tcs)) {
      const g = lastCmd[tc];
      if (s !== 'FAIL' || !g || g.kind === 'isolation') continue;
      const inStep = refusedOf(g, tc);
      if (concurrent(g) || inStep.length) candidates.push({ tc, g, refused: inStep });
    }
    const parallelFailed = candidates.filter((c) => concurrent(c.g)).length;
    const limit = Math.max(ISOLATION_FLOOR, Math.ceil(ISOLATION_SHARE * besideOthers.size));
    if (parallelFailed > limit) {
      isolation.skipped = 'mass failure: ' + parallelFailed + ' of ' + besideOthers.size + ' TCs that ran beside others failed';
      blockers.push('isolation check skipped — ' + isolation.skipped + ' (environment or application-wide?)');
      for (const c of candidates) if (c.refused.length) { tcs[c.tc] = 'INCOMPLETE'; reasons[c.tc] = 'rate_limited: ' + uniq(c.refused.map((r) => r.match)).join(', ') + ' refused (not isolated: mass failure)'; isolation.rate_limited.push(c.tc); }
    } else if (candidates.length) {
      // the server's deadline for the refused ones — never shortened; beyond --max-wait the TC is deferred, not isolated
      const refusedAll = candidates.flatMap((c) => c.refused);
      const bound = refusedAll.length ? cooldownFor(refusedAll, cooldownMs, cooldownMaxMs, refusalRounds) : 0;
      const cd = refusedAll.length ? Math.max(pendingCooldown, hasServerDeadline(refusedAll) ? bound : jitterWait(bound)) : 0;
      const plain = candidates.filter((c) => !c.refused.length);
      let refusedC = candidates.filter((c) => c.refused.length);
      if (refusedC.length && cd > maxWaitMs) {
        const until = iso(Date.now() + cd);
        for (const c of refusedC) { tcs[c.tc] = 'NOT_RUN'; reasons[c.tc] = REASON.deferred(until); deferredAll.push({ tc: c.tc, until, scope: 'isolation check' }); isolation.deferred.push(c.tc); }
        refusedC = [];
      }
      const batchesOf = (list) => {
        const byGroup = new Map();
        for (const c of list) { const k = baseOf(c.g); if (!byGroup.has(k)) byGroup.set(k, { b: k, list: [] }); byGroup.get(k).list.push(c); }
        const out = [];
        for (const [, { b, list: l }] of byGroup) {
          const ts = uniq(l.map((c) => c.tc));
          out.push({ ...b, kind: 'isolation', workers: 1, tcs: ts, onlyTcs: ts, extraArgs: [], ceilingMs: scaled(b, ts.length), group: b, from: l, filter: b.filter ? unitFilterOf(stage, ts) : null, unitMap: null });
        }
        return out;
      };
      const runIso = async (iso2) => {
        for (let i = 0; i < iso2.length; i++) {
          const g = iso2[i];
          const ok = await exec(g, iso2.slice(i + 1));
          if (!ok) { stopRest(iso2.slice(i + 1), g); return false; }
          // not admitted (capacity / pressure / lease): the parallel FAIL is no verdict and none was produced alone
          if (g.notAdmitted) { for (const c of g.from) { tcs[c.tc] = 'NOT_RUN'; reasons[c.tc] = g.notAdmitted; } continue; }
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
        return true;
      };
      let alive = await runIso(batchesOf(plain));
      if (alive && refusedC.length) {
        if (cd) { log(activity + ' · isolation check · waiting ' + secs(cd) + ' s for the refused scope (server deadline, never shortened)'); cooldowns.push(cd); await sleep(cd); }
        isolation.cooldown_ms = cd;
        alive = await runIso(batchesOf(refusedC));
      }
      // the tests that ran beside an interfered TC: their pass is re-checked alone (a false PASS guard) — in its own
      // command AND in every command that ran at the same time (dispatch), each re-run under its own command's group
      const overlap = new Map();
      for (const e of interference) {
        const src = ran.find((x) => x.kind === 'normal' && x.name === e.group && x.attempt === e.parallel_attempt);
        if (!src) continue;
        const mine = testIntervals(src.progressFile).filter((s) => s.tcs.includes(e.tc));
        const all = [];
        for (const c of [src, ...sideBy(src)]) {
          const spans = testIntervals(c.progressFile).filter((s) => !s.tcs.includes(e.tc) && mine.some((m) => s.start < m.end && m.start < s.end));
          const ts = uniq(spans.flatMap((s) => s.tcs)).filter((tc) => tcs[tc] === 'PASS' && !isolation.ran.includes(tc) && c.tcs.concat(ctx.stageTcs).includes(tc) && !all.includes(tc));
          if (!ts.length) continue;
          all.push(...ts);
          if (!overlap.has(c.group || c)) overlap.set(c.group || c, { base: c, list: [] });
          overlap.get(c.group || c).list.push(...ts);
        }
        e.overlapped = all;
        e.window = mine.length ? { start: Math.min(...mine.map((m) => m.start)), end: Math.max(...mine.map((m) => m.end)) } : null;
      }
      const ov = [];
      for (const [, { base: src, list }] of overlap) { const b = baseOf(src); const ts = uniq(list).filter((tc) => !ov.some((x) => x.tcs.includes(tc))); if (ts.length) ov.push({ ...b, kind: 'isolation', workers: 1, tcs: ts, onlyTcs: ts, extraArgs: [], ceilingMs: scaled(b, ts.length), group: b, filter: b.filter ? unitFilterOf(stage, ts) : null, unitMap: null }); }
      for (let i = 0; alive && i < ov.length && outcome !== 'SPAWN_FAILED' && outcome !== 'FRESHNESS_FAILED'; i++) {
        const g = ov[i];
        const ok = await exec(g, ov.slice(i + 1));
        if (!ok) { stopRest(ov.slice(i + 1), g); break; }
        if (g.notAdmitted) { blockers.push('the false-PASS guard could not run alone (' + g.notAdmitted + ') for ' + g.tcs.join(', ') + ' — their pass beside others stays unconfirmed'); continue; }
        absorb(g);
        for (const tc of g.tcs) {
          isolation.overlap_rerun.push(tc);
          if (tcs[tc] === 'FAIL') { isolation.overlap_failed_alone.push(tc); interference.push({ tc, kind: 'passed-beside-failed-alone', group: g.name, isolated_attempt: g.attempt }); }
        }
      }
      // the CAUSE of each interference, from evidence only (status of record stays the alone result)
      const pressureNow = ledger ? (ledger.pm.episodes() || []) : [];
      for (const e of interference) {
        if (e.kind !== 'failed-beside-passed-alone') continue;
        const src = ran.find((x) => x.kind === 'normal' && x.name === e.group && x.attempt === e.parallel_attempt);
        const evidence = [];
        let cause = 'unexplained';
        const myUnit = dispatchUnits.find((u) => u.tcs.includes(e.tc));
        const conflictWith = myUnit && dsp && typeof dsp.unitsConflict === 'function'
          ? e.overlapped.map((tc) => dispatchUnits.find((u) => u.tcs.includes(tc))).filter(Boolean).map((u) => ({ u, c: dsp.unitsConflict(myUnit, u) })).filter((x) => x.c && x.c.conflict) : [];
        const sym = src ? symptomsOf(src, e.tc, testsOf(src)) : { app: [], env: [] };
        const pressed = pressureNow.filter((p) => e.window && toMs(p.start) <= e.window.end && (p.end === null || p.end === undefined || toMs(p.end) >= e.window.start));
        if (conflictWith.length) { cause = 'test_data_conflict'; evidence.push(...conflictWith.map((x) => 'claims overlap with ' + x.u.tcs.join('/') + ': ' + (x.c.keys || []).join(', '))); }
        else if (sym.app.length) { cause = 'possible_product_concurrency_defect'; evidence.push(...sym.app); }
        else if (sym.env.length || pressed.length) { cause = 'environment'; evidence.push(...sym.env, ...pressed.map((p) => 'host pressure ' + p.reason)); }
        else evidence.push('failed beside ' + (e.overlapped.join(', ') || 'other tests') + ', passed alone — no evidence of the cause');
        e.cause = cause;
        e.cause_evidence = uniq(evidence);
      }
    }
  }
  process.removeListener('SIGINT', stopSignals);
  process.removeListener('SIGTERM', stopSignals);
  if (ledger) { clearInterval(ledger.timer); clearInterval(ledger.trackTimer); }
  const telemetryRecord = telemetry ? telemetry.stop() : { disabled: true, observeOnly: true };
  // the ramp's verdict on the pool window (interference known only now) and the validated workers (smoke = preflight)
  if (dispatchRecord.pendingRamp) {
    const { ramp } = dispatchRecord.pendingRamp;
    const unexplained = interference.some((e) => e.kind === 'failed-beside-passed-alone' && (e.cause === 'unexplained' || e.cause === 'possible_product_concurrency_defect'));
    if (unexplained) {
      // a zero-test sample: the open window turns unhealthy, so the next closed window decreases instead of trialling
      const rec = { now: Date.now(), workers: ramp.workers(), completed: 0, interference: true };
      dispatchRecord.rampRecords.push(rec);
      try { ramp.record(rec); } catch (e) { warnings.push('ramp: ' + e.message); }
    }
    dispatchRecord.ramp = typeof ramp.history === 'function' ? ramp.history() : [];
    dispatchRecord.validatedWorkers = typeof ramp.validated === 'function' ? ramp.validated() : null;
    // performance history for the next run on this environment — never evidence of independence
    if (!unexplained && !underPressure() && dispatchRecord.validatedWorkers) writeRampMemory(cap, coordDir, envId, ledger.kind, dispatchRecord.validatedWorkers);
    dispatchRecord.next = { workers: ramp.workers() };
    delete dispatchRecord.pendingRamp;
  }
  if (leaseBlock) { outcome = 'BLOCKED'; reason = 'environment lease: ' + leaseBlock + ' — nothing was started (capacity.mjs lease acquire at intake, then re-run the stage)'; blockers.push(reason); }
  publishAdmission({ state: 'open', reason: null });

  /* ---- events, failures of record, counts ---- */
  const mergedStages = [];
  const watchdogEvents = [];
  const timeoutEvents = [];
  const requeue = [];
  const relr = (p) => posix(path.relative(resultsRoot, p));
  for (const g of ran) {
    if (g.notAdmitted || g.spawnError || !g.freshness || g.freshness.gate === 'FAIL') continue;
    mergedStages.push({ name: stage, group: g.name, command: g.kind, attempt: g.attempt, project, json_path: g.source === 'json' ? relr(g.stageJson) : null,
      started_at: iso(g.startedAt), finished_at: iso(g.finishedAt), source: g.source, ...(g.unitId ? { unit: g.unitId } : {}), ...(g.source === 'incremental+watchdog' ? { watchdog_path: relr(g.watchdogFile) } : {}) });
    if (g.stop) {
      const again = g.tcs.filter((tc) => tcs[tc] === 'INCOMPLETE' || tcs[tc] === 'NOT_RUN');
      if (again.length && g.kind === 'normal') requeue.push({ group: g.name, tcs: again, after: 'the heal — in the re-run' });
      if (g.stop.kind === 'watchdog') {
        for (const f of g.stop.frozen || []) {
          watchdogEvents.push({ stage, group: g.name, worker: f.worker, tc: f.tc, step: f.step, elapsed_ms: f.elapsed_ms, deadline_ms: f.deadline_ms, action: 'stopped', ...(f.rule === 'silence' ? { rule: 'silence', silence_ms: f.silence_ms } : {}) });
          timeoutEvents.push({ tc: f.tc, step: f.step, elapsed_ms: f.elapsed_ms, deadline_ms: f.deadline_ms, expected: f.expected, kind: 'watchdog', evidence: relr(g.progressFile) });
        }
        const f = (g.stop.frozen || [])[0];
        blockers.push('watchdog stop in ' + g.name + (f ? ': ' + f.tc + ' froze in step "' + f.step + '"' + (f.rule === 'silence' ? ' (silence rule)' : '') : '') + ' — timeout_failure; re-queued in the re-run after the heal');
      } else {
        watchdogEvents.push({ stage, group: g.name, worker: null, tc: null, step: null, elapsed_ms: g.stop.elapsed_ms, deadline_ms: g.ceilingMs, action: 'ceiling-stop' });
        timeoutEvents.push({ tc: null, step: null, elapsed_ms: g.stop.elapsed_ms, deadline_ms: g.ceilingMs, expected: null, kind: 'ceiling', evidence: relr(g.progressFile) });
        blockers.push('outer ceiling stop in ' + g.name + ' — Playwright did not stop at its own ceiling (timeout_failure)');
      }
    }
    if (g.dllCrash) blockers.push('worker crash 0xC0000142 in ' + g.name + ' — environment_failure, never an application or test defect');
  }
  for (const n of notRunGroups) for (const tc of n.tcs) if (!(tc in tcs) || tcs[tc] === 'NOT_RUN') { tcs[tc] = 'NOT_RUN'; reasons[tc] = n.reason; }
  for (const tc of inNoGroup) if (!onlyTcs.length || onlyTcs.includes(tc)) { tcs[tc] = 'NOT_RUN'; reasons[tc] = mode === 'dispatch' && stageTcSet.has(tc) ? 'in no execution unit of this stage' : 'in no run-plan group'; }
  if (!ctx.flags.watchdogTrusted) blockers.push('watchdog untrusted this stage — only the outer ceiling applied');
  if (ctx.flags.watchdogUnreadable) blockers.push('a heartbeat could not be read — only the outer ceiling applied there');
  const notAdmitted = Object.entries(reasons).filter(([tc, r]) => tcs[tc] === 'NOT_RUN' && /^not started: (admission timeout|host pressure|environment lease|no safe coordination)/.test(r || '')).map(([tc]) => tc);
  if (notAdmitted.length) blockers.push(plural(notAdmitted.length, 'TC') + ' not started by admission (' + notAdmitted.join(', ') + ') — the run is NOT ACCEPTED until they run');
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
  let unavailableCount = 0;
  for (const g of ran) {
    for (const r of (g.rate ? g.rate.refused : [])) {
      const s = services.get(r.match) || { match: r.match, count: 0, retry_after_max_s: null, tcs: [] };
      s.count++;
      if (typeof r.retry_after_s === 'number') s.retry_after_max_s = Math.max(s.retry_after_max_s ?? 0, r.retry_after_s);
      s.tcs = uniq([...s.tcs, ...r.tcs]);
      services.set(r.match, s);
    }
    for (const p of (g.rate ? g.rate.policies : [])) if (!policies.has(p.match)) policies.set(p.match, p);
    unavailableCount += g.rate ? g.rate.unavailable.length : 0;
  }
  const rateLimit = { refused: [...services.values()].reduce((s, x) => s + x.count, 0), services: [...services.values()], policies: [...policies.values()], cooldowns_ms: cooldowns, adjustments: rateAdjustments, limits: rateLimits, scopes: rateScopes, unavailable: unavailableCount };

  // proposals the model appends to run_plan_adjustments[] (append-only) instead of working them out by hand
  const proposals = [];
  for (const e of interference) if (e.kind === 'failed-beside-passed-alone') proposals.push({ kind: 'move', tc: e.tc, from: e.group, to: 'serial:' + slugOf(e.group) + '-isolated', reason: 'failed beside other tests, passed alone (' + (e.cause || 'unexplained') + ')', evidence: relr(path.join(progressDir, (stage + '-' + slugOf(e.group)) + (e.parallel_attempt > 1 ? '-attempt' + e.parallel_attempt : '') + '.jsonl')) });
  for (const p of policies.values()) if (p.limit && !Object.values(rateLimits).some((l) => l && l.match && matchCovers(l.match, p.match))) proposals.push({ kind: 'rate-limit', service: p.match, to: { match: p.match, limit: p.limit, window_s: p.window_s, pace: Math.max(1, p.limit - 1), scope: 'machine' }, reason: 'advertised by the application (RateLimit / X-RateLimit headers)', evidence: 'network-guard policy record' });
  for (const adj of rateAdjustments) if (adj.scope === 'environment' && adj.workers_to !== adj.workers_from) proposals.push({ kind: 'workers', group: adj.group, from: adj.workers_from, to: adj.workers_to, reason: 'environment-wide refusals in this stage', evidence: 'rateLimit.adjustments' });
  if (Object.keys(computedCeilings).length) proposals.push({ kind: 'ceilings', computed: computedCeilings, formula: '(Σ test budgets ÷ workers + hook + teardown) × 1.2 + pacing floor', source: timeoutsPath ? posix(path.relative(cwd, timeoutsPath)) : null });

  /* ---- the code fingerprint at the end: an edit during the call makes its TCs stale ---- */
  let code = null;
  if (codeStart) {
    const end = await fingerprintCall(ctx, callTcs);
    const endTcs = Object.fromEntries(Object.entries(end.tcs).map(([tc, v]) => [tc, v.fingerprint]));
    const changed = codeStart.error || end.error ? [] : callTcs.filter((tc) => (codeStart.tcs[tc] && codeStart.tcs[tc].fingerprint) !== endTcs[tc]);
    code = { schema: codeStart.schema, tcs: codeStart.tcs, tests: codeStart.tests, files: codeStart.files, end_tcs: endTcs, changed_during_call: changed, error: codeStart.error || end.error || null, warnings: codeStart.warnings };
    if (changed.length) warnings.push('code changed while the stage ran — stale for impact.mjs select: ' + changed.join(', '));
  }

  // one line of the stage message: the Auto ceiling, the scheduler (and why it ran serially), the workers used / the ramp
  const workersLine = () => {
    if (stage === 'setup') return null;
    const used = uniq(ran.filter((g) => g.kind === 'normal' && !g.notAdmitted && g.workers).map((g) => g.workers));
    const rampMoves = (dispatchRecord.ramp || []).filter((h) => h.action !== 'hold').map((h) => h.action + ' ' + h.workers);
    return 'Workers: Auto ceiling ' + ceil.ceiling + ' (' + ceil.source + (ceil.upper && ceil.upper.from === 'config' ? ', bound ' + ceil.upper.value + ' by config' : '') + ') · '
      + (mode === 'dispatch' ? 'dispatch' + (schedRec.replanned ? ' (readiness re-planned: ' + schedRec.changed.join(', ') + ')' : '') : mode === 'serial' ? 'serial — ' + (schedRec.fallback || 'no proof of independence') : 'groups (legacy run plan)')
      + ' · used ' + (used.length ? used.join(' / ') : '—') + (rampMoves.length ? ' · ramp ' + rampMoves.join(', ') : '') + ' · ' + (display.headed ? 'headed' : 'headless (' + (display.reason || '--headless') + ')') + '.';
  };

  /* ---- the summary file + the cumulative view of this phase ---- */
  const prefix = run + '-' + stage + '-';
  const seq = 1 + readdirSafe(progressDir).filter((f) => f.startsWith(prefix) && f.endsWith('.summary.json')).length;
  const summaryFile = path.join(progressDir, prefix + seq + '.summary.json');
  const finishedAt = Date.now();
  pressureEpisodes = ledger ? (ledger.pm.episodes() || []) : [];
  const interferenceCauses = interference.filter((e) => e.cause).map((e) => ({ tc: e.tc, cause: e.cause }));
  const summary = {
    tool: 'run-stage', schema: SCHEMA_VERSION, run, stage, seq, label, phase, activity, outcome, reason,
    startedAt: iso(startedAt), finishedAt: iso(finishedAt), durationMs: finishedAt - startedAt,
    plannedTcs: callTcs, tcs, reasons, executed, counts, journeys: stage === 'setup' ? journeys : undefined, journeysByGroup: stage === 'setup' ? journeysByGroup : undefined,
    failures, notRun, isolation, interference, rateLimit, burnIn, deferred: uniq(deferredAll.map((d) => JSON.stringify(d))).map((s) => JSON.parse(s)),
    groups: ran.map((g) => ({ name: g.name, command: g.kind, mode: g.mode, workers: g.workers, attempt: g.attempt || null, unit: g.unitId || undefined, lane: g.lane || undefined, tcs: g.tcs, onlyTcs: g.onlyTcs || null, extra: g.extraArgs, ceilingMs: g.ceilingMs, playwright: g.command || null,
      stageJson: g.stageJson ? relr(g.stageJson) : null, progressFile: g.progressFile ? relr(g.progressFile) : null, resultsFile: g.resultsFile ? relr(g.resultsFile) : null,
      rateLimitFile: g.rateLimitFile ? relr(g.rateLimitFile) : null, watchdogFile: g.stop ? relr(g.watchdogFile) : null, planFile: g.planFile ? relr(g.planFile) : null,
      outputDir: g.outputDir ? relr(g.outputDir) : null, lastRunFrom: g.lastRunFrom ? relr(g.lastRunFrom) : undefined,
      exit: g.exit || null, startedAt: g.startedAt ? iso(g.startedAt) : null, finishedAt: g.finishedAt ? iso(g.finishedAt) : null,
      durationMs: g.finishedAt ? g.finishedAt - g.startedAt : 0, freshness: g.freshness || (g.notAdmitted ? { gate: 'NOT_RUN', reason: g.notAdmitted } : { gate: 'FAIL', reason: g.spawnError }), source: g.source || null,
      refused: g.rate ? g.rate.refused.length : 0, stop: g.stop ? { kind: g.stop.kind, reason: g.stop.reason, verdict: g.stop.verdict, rule: g.stop.rule || undefined } : null, notAdmitted: g.notAdmitted || undefined })),
    skippedGroups, notRunGroups, requeue, adjustments_applied: applied, merged_stages: mergedStages, watchdog_events: watchdogEvents, timeout_events: timeoutEvents, output_pruned: outputPruned,
    smokeGate: stage === 'smoke' ? smokeGateOf(counts) : undefined, flags: ctx.flags, warnings, code, telemetry: telemetryRecord,
    ledger: ledgerRecord, lease: leaseRecord, host: ledger ? ledger.hostStats : null, display, status: relr(statusFile),
    pressure: { episodes: pressureEpisodes, blockedAdmissions: pressureEpisodes.reduce((s, p) => s + (p.blockedAdmissions || 0), 0) },
    admission: { file: relr(admissionFile), updates: ctx.admissionUpdates, timeouts: uniq(admissionTimeouts), helperInstalled: admissionHelper },
    dispatch: dispatchRecord, scheduler: schedRec,
    timeouts_shadow: { mode: timeoutsMode, silence_ms: silenceMs, would_stop: ctx.shadow.would_stop, long_deadlines: ctx.shadow.long_deadlines, stalls: ctx.shadow.stalls },
    proposals,
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  const cumulative = cumulativeOf(progressDir);
  if (stage === 'smoke' && cumulative.stages.smoke) summary.smokeGate = smokeGateOf(cumulative.stages.smoke);
  const relCwd = posix(path.relative(cwd, resultsRoot));
  const evidenceDir = /^reports\//.test(relCwd) ? 'screenshots/' + relCwd.slice('reports/'.length) + '/phase-' + phase + '/' : null;
  summary.cumulative = cumulative;
  summary.update = buildUpdate({ run, stage, label, outcome, reason, call: { counts, journeys }, cumulative, failures, notRun, blockers, evidenceDir, durationMs: finishedAt - startedAt, isolation, rateLimit,
    deferred: summary.deferred, interferenceCauses, pressure: summary.pressure, workers: workersLine() });
  summary.blockers = blockers;
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  log(activity + ' · stage end · ' + outcome + ' · ' + summary.update.split('\n')[0]);

  // stdout stays small: what the stage message and the next decision need; the rest is in the summary
  return {
    ...base, activity, phase, outcome, reason, durationMs: summary.durationMs, counts,
    failures: failures.slice(0, 20).map((f) => ({ tcs: f.tcs, title: f.title ? f.title.slice(0, 120) : null, group: f.group, error: f.error, screenshot: f.screenshot, unverifiedAssumption: f.unverifiedAssumption || undefined })),
    notRun: notRun.slice(0, 40), smokeGate: summary.smokeGate,
    isolation, interference, rateLimit: { refused: rateLimit.refused, services: rateLimit.services, policies: rateLimit.policies, cooldowns_ms: cooldowns, adjustments: rateAdjustments, scopes: rateScopes, unavailable: unavailableCount },
    deferred: summary.deferred, proposals,
    code: code ? { tcs: Object.keys(code.tcs).length, changed_during_call: code.changed_during_call, error: code.error } : null,
    groups: summary.groups.map((g) => ({ name: g.name, command: g.command, attempt: g.attempt, workers: g.workers, tcs: g.tcs.length, source: g.source, freshness: g.freshness.gate, stop: g.stop ? g.stop.kind : null, exit: g.exit ? g.exit.code : null, outputDir: g.outputDir, notAdmitted: g.notAdmitted })),
    skippedGroups, notRunGroups: notRunGroups.map((n) => ({ name: n.name, tcs: n.tcs.length, reason: n.reason })), requeue, blockers,
    scheduler: { used: mode, fallback: schedRec.fallback, replanned: schedRec.replanned || undefined, changed: schedRec.changed.length ? schedRec.changed : undefined },
    ledger: { enabled: ledgerRecord.enabled, mode: ledgerRecord.mode, ceiling: ledgerRecord.ceiling, source: ledgerRecord.source, headed: display.headed, lowered: ledgerRecord.lowered, unreleased: ledgerRecord.reservations.filter((r) => r.token && r.released === false).length },
    lease: leaseRecord, pressure: { episodes: summary.pressure.episodes.length, blockedAdmissions: summary.pressure.blockedAdmissions },
    dispatch: mode === 'dispatch' ? { units: dispatchRecord.units, pool: dispatchRecord.pool.length, timeline: dispatchRecord.timeline.length, validatedWorkers: dispatchRecord.validatedWorkers } : undefined,
    timeoutsShadow: { mode: timeoutsMode, wouldStop: ctx.shadow.would_stop.length, longDeadlines: ctx.shadow.long_deadlines.length, stalls: ctx.shadow.stalls.length },
    flags: ctx.flags, warnings, update: summary.update, summaryFile: relr(summaryFile), log: posix(logPath),
  };
}

// the dispatch / re-queue filter: stage tag + TC list (no @run: lookahead — units are not run-plan groups)
function unitFilterOf(stage, tcs) {
  const end = '(?![\\w:-])';
  return { grep: '(?=.*' + esc(STAGE_TAG[stage]) + end + ')(?=.*[\\[,]\\s*(?:' + tcs.map(esc).join('|') + ')\\s*[\\],])', invert: stage === 'positive' || stage === 'negative' ? esc('@smoke') + end : null };
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
  usage: 'node run-stage.mjs --run-file <.runs/phase-N.json> --stage setup|smoke|positive|negative --run first|rerun --stage-tcs <TC,…> --ceilings <group=ms,…|auto> [--timeouts <timeouts.ts>] [--grace <ms>] --log <progress log> --project <name> --cwd <automation root> [--spec <file,…>] [--groups <name,…>] [--tcs <TC,…>] [--burn-in <TC,…>] [--extra repeat-each=N,last-failed,workers=N] [--cooldown <ms>] [--cooldown-max <ms>] [--label <text>] [--headless] [--cli <cli.js>] [--cmd "<run command>"] [--stage-json-source <path>] [--interval <ms>] [--status-every <ms>] [--ceiling-margin <ms>] [--telemetry [--telemetry-interval <ms>] [--tree-interval <ms>]] [--silence <ms>] [--timeouts-mode active|shadow] [--no-ledger] [--capacity-dir <dir>] [--env-id <id>] [--max-wait <ms>] [--scheduler auto|groups|dispatch] [--units <parallel-plan.json>] [--strict] [--pretty]  ·  node run-stage.mjs reclaim [--capacity-dir <dir>] [--dry-run]',
  notes: [
    'Start it as ONE background command per stage and wait for its completion notice; never poll it. The stage message is `update`; artifacts/progress/status.json shows the active workers and their TCs.',
    '--run first for the first run (and its smoke retries); --run rerun for the targeted re-run of the TCs impact.mjs select returns. --run final was removed.',
    'Scheduler auto (default): dispatch when the ledger is on and --units is an OK parallel-plan.mjs payload whose dependency fingerprint (code, TCs, TEST-DATA, learning file, run plan, environment) still matches — re-planned here when it does not; the pool runs in batches whose workers the ramp adapts. Otherwise SERIAL (workers 1), with the reason in `scheduler.fallback`. --scheduler groups: the legacy hand-built run plan (explicit rollback); --scheduler dispatch: refuses instead of falling back.',
    'A FAIL beside other tests (workers > 1, or beside another command) is re-run alone inside the same call (the isolation check); refused requests cool down only their scope (workers drop only for environment-wide refusals).',
    'Freeze stops come only from watchdog.mjs FROZEN verdicts: a step past its fixed deadline + grace, or (active by default) a long step without meaningful progress past the silence limit + grace; --timeouts-mode shadow only reports the latter. A command that outlives PW_GLOBAL_TIMEOUT + margin is killed as an outer-ceiling stop.',
    'Freshness: every command needs a stage JSON newer than its start, or — after a stop — the watchdog file; otherwise the stage stops (FRESHNESS_FAILED).',
    'Exit code 0 by default; --strict maps COMPLETED 0 · STOPPED_* 1 · FRESHNESS_FAILED / SPAWN_FAILED / BLOCKED 2 · NOT_RUN 3.',
    'Telemetry is opt-in (--telemetry) and observe-only; it reuses the ledger sampler\'s host readings. The summary\'s `host` carries the sampler\'s minima / peaks either way.',
    'Capacity ledger (default on): every command reserves its workers under the AUTO machine ceiling (host memory / CPU, headed demand, bounded by config.json machineMaxWorkers; only ever lowered here) and releases them when its process tree is confirmed gone; host pressure holds new commands and new tests back (admission file); a not-admitted command is NOT_RUN "not started: admission timeout / host pressure" after --max-wait (10 min).',
    '--no-ledger / QA_LEDGER=off (rollback) and a failed process listing switch to EXCLUSIVE execution: one Playwright command at a time on this machine, never above the ceiling, serial (no host-pressure admission, no dispatch). An unusable coordination directory or ledger file → BLOCKED "no safe coordination", nothing started.',
    '--env-id <id> (from `capacity.mjs lease acquire` at intake): the environment lease must be held by this run, else nothing starts (NOT_RUN "not started: environment lease"). The rate-limit book is then shared per environment in the coordination directory.',
    'Rate limits: the server\'s deadline (Retry-After / RateLimit-Reset) is never shortened; beyond --max-wait the TC is deferred (NOT_RUN "deferred until"), never rate_limited by itself; 503 + Retry-After without rate-limit headers is temporary unavailability.',
    'Smoke gate: fail% over PASS + FAIL only; none → NO VERDICT, and positive / negative are refused until a smoke retry gives a verdict.',
    '--ceilings auto --timeouts <timeouts.ts>: the documented ceiling arithmetic is done here (proposals[] carries it). --grace defaults to TIMEOUTS.watchdog_grace; the silence limit to TIMEOUTS.stall.silence (else min(3 × max(action, navigation, expect), 55 s)).',
    'Local runs are headed; --headless, CI or no graphical desktop → headless, reported in the stage message.',
    'reclaim (user-run): terminates only orphaned process trees a crashed run left in the ledger, matched by pid + start time or a recorded browser-profile marker.',
  ],
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  if (args._[0] === 'reclaim') {
    const cap = await loadModule('capacity.mjs');
    if (cap.loadError) { print({ tool: 'run-stage', command: 'reclaim', outcome: 'BLOCKED', reason: 'capacity.mjs could not be loaded: ' + cap.loadError }, args); return args.strict ? 2 : 0; }
    const dir = typeof args['capacity-dir'] === 'string' ? path.resolve(args['capacity-dir']) : cap.resolveCapacityDir();
    const snap = await cap.processSnapshot({ timeoutMs: 15000 });
    if (!snap.rows) { print({ tool: 'run-stage', command: 'reclaim', outcome: 'BLOCKED', reason: 'process listing unavailable: ' + snap.error }, args); return args.strict ? 2 : 0; }
    const swept = await cap.sweep({ dir, rows: snap.rows });
    const r = await cap.reclaim({ dir, rows: snap.rows, dryRun: args['dry-run'] === true || args['dry-run'] === 'true' });
    print({ tool: 'run-stage', command: 'reclaim', outcome: 'COMPLETED', dir: posix(dir), dryRun: args['dry-run'] === true || args['dry-run'] === 'true', sweep: swept, reclaim: r }, args);
    return 0;
  }
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
