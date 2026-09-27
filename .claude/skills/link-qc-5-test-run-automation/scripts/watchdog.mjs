#!/usr/bin/env node
// watchdog.mjs — freeze decision + result reconstruction for one stage / run-group command.
// Node >= 18, zero dependencies. Read-only by default; writes ONE file, only behind --write.
//
// WHAT THIS DECIDES: whether a Playwright worker is HUNG (not merely slow), from explicit
// progress records only — never from console silence, never from an unchanged stage JSON.
//
//   heartbeat  {results_root}/artifacts/progress/{stage}-{group}.jsonl   written by helpers/steps.ts
//              and helpers/evidence.ts: one JSON object per line —
//              { at, worker, tc, step?, event: start|progress|end|evidence|test-start|test-end,
//                deadline_ms? (start), outcome? (end: ok|timeout|error), note? }
//   results    {results_root}/artifacts/progress/{stage}-{group}.results.jsonl   written by
//              helpers/progress-reporter.ts on every onTestEnd —
//              { at, worker, tc: [..], title, status: passed|failed|timedOut|skipped|interrupted,
//                duration_ms, retry, project }
//   plan       the run-plan group ({ name, mode, workers, tcs[] }) or the whole run_plan + --group
//
// A worker is FROZEN only when ALL of these hold for its newest open step (a `start` with no `end`):
//   1. now - clock > deadline_ms + grace, where clock = the newest `progress` record of that step,
//      else the `start` itself — a documented long deadline is honoured as written;
//   2. no newer heartbeat record of any kind exists for that worker (a newer record means the
//      worker moved on — the missing `end` is a helper bug, not a hang);
//   3. no result line for that worker is newer than the step start.
// Playwright's own step / test timeout fires AT deadline_ms; a step still open at deadline +
// grace with no `end` therefore means Playwright itself could not act — the driver is hung.
//
// Reconstruction (always computed, applied by the skill on a stop):
//   completed[]    every result line whose TC is in the group — real statuses, kept as they are
//   interrupted[]  TCs with a heartbeat start / test-start and no result — INCOMPLETE, reason names
//                  the step and elapsed time; other workers' in-flight TCs are `collateral`
//   not_started[]  planned TCs with no record at all — NOT_RUN, reason `not started: watchdog stop`
//
// Exit code is 0 by default (the verdict lives in the payload); --strict maps
// OK 0 · FROZEN 1 · BLOCKED 2 · NOT_RUN 3 for a poll loop.
import fs from 'node:fs';
import path from 'node:path';

/* ---------------- argv + output (copied verbatim from scan-lib.mjs — never imported across skills) ---------------- */

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

function print(obj, args) {
  process.stdout.write(JSON.stringify(obj, null, args.pretty ? 2 : 0) + '\n');
}

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const str = (v) => (typeof v === 'string' ? v : null);

export const SCHEMA_VERSION = 'skill6-watchdog/1';
export const DEFAULT_GRACE_MS = 60_000;

const STATUS_MAP = { passed: 'PASS', failed: 'FAIL', timedOut: 'FAIL', skipped: 'SKIP', interrupted: 'INCOMPLETE' };
const EVENTS = new Set(['start', 'progress', 'end', 'evidence', 'test-start', 'test-end']);

/* ---------------- parsing ---------------- */

function parseJsonl(text, kind, errors) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { errors.push({ source: kind, line: i + 1, reason: 'not valid JSON' }); continue; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errors.push({ source: kind, line: i + 1, reason: 'not an object' }); continue; }
    const at = Date.parse(obj.at);
    if (Number.isNaN(at)) { errors.push({ source: kind, line: i + 1, reason: 'missing or invalid "at" timestamp' }); continue; }
    if (kind === 'heartbeat') {
      if (!EVENTS.has(obj.event)) { errors.push({ source: kind, line: i + 1, reason: 'unknown event "' + obj.event + '"' }); continue; }
      if (typeof obj.worker !== 'number') { errors.push({ source: kind, line: i + 1, reason: 'missing numeric "worker"' }); continue; }
      if (obj.event === 'start' && (typeof obj.deadline_ms !== 'number' || obj.deadline_ms <= 0)) { errors.push({ source: kind, line: i + 1, reason: '"start" without a positive deadline_ms' }); continue; }
      if ((obj.event === 'start' || obj.event === 'end' || obj.event === 'progress') && !str(obj.step)) { errors.push({ source: kind, line: i + 1, reason: '"' + obj.event + '" without a step title' }); continue; }
    } else {
      if (typeof obj.worker !== 'number') { errors.push({ source: kind, line: i + 1, reason: 'missing numeric "worker"' }); continue; }
      if (!Array.isArray(obj.tc) || !obj.tc.length) { errors.push({ source: kind, line: i + 1, reason: 'missing "tc" list' }); continue; }
      if (!STATUS_MAP[obj.status]) { errors.push({ source: kind, line: i + 1, reason: 'unknown status "' + obj.status + '"' }); continue; }
    }
    out.push({ ...obj, _at: at, _line: i + 1 });
  }
  return out;
}

function loadGroup(planPath, groupName, errors) {
  const text = read(planPath);
  if (text === null) { errors.push({ source: 'plan', line: 0, reason: 'plan file could not be read: ' + planPath }); return null; }
  let plan;
  try { plan = JSON.parse(text); } catch { errors.push({ source: 'plan', line: 0, reason: 'plan file is not valid JSON' }); return null; }
  if (plan && Array.isArray(plan.groups)) {
    const all = [...(plan.setup_groups || []), ...plan.groups];
    const g = groupName ? all.find((x) => x.name === groupName) : (all.length === 1 ? all[0] : null);
    if (!g) { errors.push({ source: 'plan', line: 0, reason: groupName ? 'group "' + groupName + '" not in the run plan' : 'run plan has several groups — pass --group' }); return null; }
    return g;
  }
  if (plan && Array.isArray(plan.tcs)) return plan;
  errors.push({ source: 'plan', line: 0, reason: 'plan is neither a run_plan with groups[] nor a group with tcs[]' });
  return null;
}

/* ---------------- decision ---------------- */

export function decide({ heartbeat, results, group, now, graceMs }) {
  const byWorker = new Map();
  for (const h of heartbeat) {
    if (!byWorker.has(h.worker)) byWorker.set(h.worker, []);
    byWorker.get(h.worker).push(h);
  }
  const workers = [];
  const frozen = [];
  for (const [worker, recs] of [...byWorker.entries()].sort((a, b) => a[0] - b[0])) {
    recs.sort((a, b) => a._at - b._at || a._line - b._line);
    // newest open step: the last `start` with no later `end` for the same (tc, step)
    let open = null;
    for (const r of recs) {
      if (r.event === 'start') open = r;
      else if (r.event === 'end' && open && r.tc === open.tc && r.step === open.step) open = null;
    }
    const last = recs[recs.length - 1];
    const w = { worker, state: 'idle', tc: last.tc || null, step: null, last_event: last.event, last_at: new Date(last._at).toISOString() };
    if (open) {
      const progress = recs.filter((r) => r.event === 'progress' && r.tc === open.tc && r.step === open.step && r._at >= open._at);
      const clock = progress.length ? progress[progress.length - 1]._at : open._at;
      const newerHeartbeat = recs.some((r) => r !== open && r._at > clock && !(r.event === 'progress' && r.tc === open.tc && r.step === open.step));
      const newerResult = results.some((r) => r.worker === worker && r._at > open._at);
      const elapsed = now - open._at;
      const sinceClock = now - clock;
      const limit = open.deadline_ms + graceMs;
      Object.assign(w, {
        state: 'in-step', tc: open.tc, step: open.step,
        started_at: new Date(open._at).toISOString(), elapsed_ms: elapsed, deadline_ms: open.deadline_ms,
        progress_records: progress.length, since_last_progress_ms: sinceClock,
        remaining_before_freeze_ms: Math.max(0, limit - sinceClock),
      });
      if (sinceClock > limit && !newerHeartbeat && !newerResult) {
        w.state = 'frozen';
        frozen.push({
          worker, tc: open.tc, step: open.step, elapsed_ms: elapsed, deadline_ms: open.deadline_ms, grace_ms: graceMs,
          since_last_progress_ms: sinceClock, expected: open.note || null,
          reason: 'step "' + open.step + '" open for ' + Math.round(sinceClock / 1000) + ' s with no progress, past its own deadline (' + Math.round(open.deadline_ms / 1000) + ' s) + grace (' + Math.round(graceMs / 1000) + ' s); Playwright\'s own timeout did not fire — the worker is hung',
        });
      } else if (newerHeartbeat || newerResult) {
        w.state = 'moved-on';
        w.note = 'the step never recorded an end but the worker produced newer records — a helper defect, not a hang';
      }
    }
    workers.push(w);
  }
  return { workers, frozen };
}

export function reconstruct({ heartbeat, results, group, frozen }) {
  const planned = group.tcs.slice();
  const completed = [];
  const seen = new Set();
  for (const r of [...results].sort((a, b) => a._at - b._at)) {
    for (const tc of r.tc) {
      if (!planned.includes(tc)) continue;
      seen.add(tc);
      const prev = completed.find((c) => c.tc === tc);
      const row = { tc, status: STATUS_MAP[r.status], raw_status: r.status, worker: r.worker, at: new Date(r._at).toISOString(), duration_ms: r.duration_ms ?? null, retry: r.retry ?? 0, project: r.project || null, title: r.title || null };
      if (prev) Object.assign(prev, row); else completed.push(row);
    }
  }
  const frozenWorkers = new Set(frozen.map((f) => f.worker));
  const interrupted = [];
  const started = new Map();
  for (const h of [...heartbeat].sort((a, b) => a._at - b._at)) {
    if (!h.tc || !planned.includes(h.tc) || seen.has(h.tc)) continue;
    if (h.event === 'test-start' || h.event === 'start' || h.event === 'progress' || h.event === 'evidence') started.set(h.tc, h);
    if (h.event === 'test-end') started.delete(h.tc);
  }
  for (const [tc, h] of started) {
    const f = frozen.find((x) => x.tc === tc);
    const openStep = f ? f.step : (h.step || null);
    interrupted.push({
      tc, status: 'INCOMPLETE', worker: h.worker, step: openStep,
      elapsed_ms: f ? f.elapsed_ms : null,
      collateral: !f,
      reason: f
        ? 'interrupted: watchdog at step "' + f.step + '" after ' + Math.round(f.elapsed_ms / 1000) + ' s'
        : 'interrupted: collateral (watchdog stop of worker ' + [...frozenWorkers].join(', ') + ')',
    });
  }
  const done = new Set([...seen, ...interrupted.map((i) => i.tc)]);
  const not_started = planned.filter((tc) => !done.has(tc)).map((tc) => ({ tc, status: 'NOT_RUN', reason: 'not started: watchdog stop' }));
  return { completed, interrupted, not_started };
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'watchdog',
  usage: 'node watchdog.mjs --heartbeat <jsonl> --results <jsonl> --plan <group-or-run-plan.json> [--group <name>] [--stage <name>] [--now <ISO>] [--grace <ms>] [--out <watchdog.json>] [--write] [--pretty] [--strict]',
  notes: [
    'Read-only unless --write. Default exit code is 0; --strict maps OK 0 · FROZEN 1 · BLOCKED 2 · NOT_RUN 3.',
    'A freeze needs an open step past its OWN deadline + grace with no progress, no newer worker record and no newer result. Console silence and a stale stage JSON never count.',
    'Reconstruction (completed / interrupted / not_started) is always in the payload; the skill applies it only when it stops the command.',
  ],
};

const STRICT_EXIT = { OK: 0, FROZEN: 1, BLOCKED: 2, NOT_RUN: 3 };

export function run(args) {
  const errors = [];
  const warnings = [];
  const heartbeatPath = str(args.heartbeat);
  const resultsPath = str(args.results);
  const planPath = str(args.plan);
  const now = args.now ? Date.parse(String(args.now)) : Date.now();
  const graceMs = args.grace !== undefined ? Number(args.grace) : DEFAULT_GRACE_MS;
  const base = { tool: 'watchdog', schema: SCHEMA_VERSION, readOnly: true, now: new Date(now).toISOString(), grace_ms: graceMs, stage: str(args.stage) || null, group: str(args.group) || null };
  if (!planPath) return { ...base, verdict: 'NOT_RUN', reason: 'no --plan supplied', errors, warnings };
  if (Number.isNaN(now)) return { ...base, verdict: 'BLOCKED', reason: '--now is not a valid timestamp', errors, warnings };
  if (Number.isNaN(graceMs) || graceMs < 0) return { ...base, verdict: 'BLOCKED', reason: '--grace must be a non-negative number of milliseconds', errors, warnings };
  const group = loadGroup(planPath, str(args.group), errors);
  if (!group) return { ...base, verdict: 'BLOCKED', reason: errors[0].reason, errors, warnings };
  base.group = group.name || base.group;
  if (!heartbeatPath || !isFile(heartbeatPath)) return { ...base, verdict: 'NOT_RUN', reason: 'no heartbeat file yet (' + (heartbeatPath || 'none given') + ') — the command has not produced a progress record; only the outer ceiling applies', errors, warnings, planned: group.tcs };
  const heartbeat = parseJsonl(read(heartbeatPath) || '', 'heartbeat', errors);
  let results = [];
  if (resultsPath && isFile(resultsPath)) results = parseJsonl(read(resultsPath) || '', 'results', errors);
  else warnings.push('no results file (' + (resultsPath || 'none given') + ') — completed[] is empty; every started TC will read as interrupted on a stop');
  if (errors.length) {
    return { ...base, verdict: 'BLOCKED', reason: errors.length + ' malformed line(s) — a freeze verdict is never derived from a record that could not be read', errors, warnings, workers: [], frozen: [] };
  }
  const { workers, frozen } = decide({ heartbeat, results, group, now, graceMs });
  const reconstruction = reconstruct({ heartbeat, results, group, frozen });
  const verdict = frozen.length ? 'FROZEN' : 'OK';
  const payload = {
    ...base, verdict,
    reason: frozen.length ? frozen.map((f) => 'worker ' + f.worker + ': ' + f.reason).join('; ') : 'every worker is idle, progressing, or inside its step deadline',
    workers, frozen, reconstruction,
    counts: { planned: group.tcs.length, completed: reconstruction.completed.length, interrupted: reconstruction.interrupted.length, not_started: reconstruction.not_started.length, workers: workers.length, frozen: frozen.length },
    errors, warnings, writes: [],
  };
  if (args.write) {
    const out = str(args.out);
    if (!out) { payload.warnings.push('--write without --out: nothing written'); return payload; }
    const file = {
      schema: SCHEMA_VERSION, stage: payload.stage, group: payload.group, decided_at: payload.now, verdict,
      grace_ms: graceMs, frozen, source: 'incremental+watchdog',
      completed: reconstruction.completed, interrupted: reconstruction.interrupted, not_started: reconstruction.not_started,
      counts: payload.counts,
    };
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
    payload.readOnly = false;
    payload.writes.push({ file: out, kind: 'watchdog', bytes: fs.statSync(out).size });
  }
  return payload;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const payload = run(args);
  print(payload, args);
  return args.strict ? (STRICT_EXIT[payload.verdict] ?? 0) : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === new URL(`file://${path.resolve(process.argv[1] || '')}`).href) {
  let code = 0;
  try { code = main(); }
  catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'watchdog', schema: SCHEMA_VERSION, verdict: 'BLOCKED', reason: 'internal error: ' + e.message, errors: [{ source: 'internal', line: 0, reason: e.message }] }, args);
    code = args.strict ? 2 : 0;
  }
  process.exit(code);
}
