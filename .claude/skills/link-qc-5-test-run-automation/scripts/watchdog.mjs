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
//              plus the informational events of the admission / guard / stall helpers:
//              admission-wait / rate-wait { phase: start|end, reason, budget_ms } · stall { step, silence_ms,
//              classification } · teardown · console-report { entries, unexpected } · deferred { until, scope }.
//              None of them is a step: they never open one, never close one and never count as progress
//              of an open step (a `stall` record of the open step is the helper saying it is SILENT).
//   results    {results_root}/artifacts/progress/{stage}-{group}.results.jsonl   written by
//              helpers/progress-reporter.ts on every onTestEnd —
//              { at, worker, tc: [..], title, status: passed|failed|timedOut|skipped|interrupted,
//                duration_ms, retry, project }
//   plan       the run-plan group ({ name, mode, workers, tcs[] }) or the whole run_plan + --group
//
// Open steps are a STACK per worker (a nested step never hides its parent). A worker is FROZEN when, for any open
// step whose test it has not left (no newer test-start / test-end / teardown / console-report, no newer result):
//   1. DEADLINE: now - start > deadline_ms + grace — the deadline is FIXED from the step's start; progress never
//      extends it (a documented long deadline is honoured as written); or
//   2. SILENCE (--silence <ms>, the step's own silence_ms first; ACTIVE by default): a LONG step (deadline_ms >
//      silence) without MEANINGFUL progress for longer than silence + grace. Meaningful = a progress record the
//      helper marked meaningful (a counter that rose, a new milestone), or — older helpers — a note whose n/m
//      counter rose; a changed message, a timestamp, repeated polling, the same counter again and every
//      informational heartbeat never count. A nested step starting / ending is activity of its parent.
//      --silence-mode shadow only reports it (`would_freeze[]`).
//   3. WAIT BUDGET: an open admission-wait / rate-wait past its own budget_ms + grace. While such a bounded wait is
//      open it is never a UI stall (no silence verdict), but the enclosing step's fixed deadline still applies.
// Playwright's own step / test timeout fires AT deadline_ms; a step still open at deadline + grace with no `end`
// therefore means Playwright itself could not act — the driver is hung.
//
// Reconstruction (always computed, applied by the skill on a stop):
//   completed[]    every result line whose TC is in the group — real statuses, kept as they are
//   interrupted[]  TCs with a heartbeat start / test-start and no result — INCOMPLETE, reason names
//                  the step and elapsed time; other workers' in-flight TCs are `collateral`
//   not_started[]  planned TCs with no record at all — NOT_RUN, reason `not started: watchdog stop`
// A heartbeat `tc` of a test that covers several TCs is the joined list ("TC-01,TC-02"); every TC in
// it is matched. --stop-reason names a stop that was NOT a freeze (run-stage.mjs's outer-ceiling
// kill): with no frozen worker the reasons read `interrupted: {reason}` / `not started: {reason}`.
//
// Exit code is 0 by default (the verdict lives in the payload); --strict maps
// OK 0 · FROZEN 1 · BLOCKED 2 · NOT_RUN 3 for a poll loop.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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
// step events + the informational events (never a step, never progress of a step)
export const STEP_EVENTS = ['start', 'progress', 'end', 'evidence', 'test-start', 'test-end'];
export const INFO_EVENTS = ['admission-wait', 'rate-wait', 'stall', 'teardown', 'console-report', 'deferred'];
const EVENTS = new Set([...STEP_EVENTS, ...INFO_EVENTS]);
export const SILENCE_MODES = ['active', 'shadow'];

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

// Meaningful progress (the silence clock): a `progress` record whose helper marked it `meaningful: true`; one marked
// `meaningful: false` never counts. Older helpers write no flag: then only a note carrying an `n/m` counter whose n
// rose (same m) counts — a changed message, a timestamp, repeated polling or the same counter again never does.
const COUNTER = /(\d+)\s*\/\s*(\d+)/;
export function meaningfulProgress(records) {
  const out = [];
  let last = null;
  for (const r of records) {
    if (r.meaningful === true) { out.push(r); continue; }
    if (r.meaningful === false) continue;
    const m = COUNTER.exec(String(r.note || ''));
    if (!m) continue;
    const n = Number(m[1]);
    const total = Number(m[2]);
    if (last && last.total === total ? n > last.n : n > 0) out.push(r);
    last = { n, total };
  }
  return out;
}

// records that mean the worker left the step's test (the missing `end` is then a helper defect, not a hang)
const MOVED_ON = new Set(['test-start', 'test-end', 'teardown', 'console-report']);
// bounded waits: never a UI stall, but FROZEN past their own budget + grace (no wait extends a run indefinitely)
const WAIT_EVENTS = new Set(['admission-wait', 'rate-wait']);
export const DEFAULT_WAIT_BUDGET_MS = 600_000;

export function decide({ heartbeat, results, group, now, graceMs, silenceMs = null, silenceMode = 'active' }) {
  const byWorker = new Map();
  for (const h of heartbeat) {
    if (!byWorker.has(h.worker)) byWorker.set(h.worker, []);
    byWorker.get(h.worker).push(h);
  }
  const workers = [];
  const frozen = [];
  const wouldFreeze = [];
  const stalls = [];
  const silence = Number(silenceMs) > 0 ? Number(silenceMs) : null;
  const sec = (ms) => Math.round(ms / 1000);
  for (const [worker, recs] of [...byWorker.entries()].sort((a, b) => a[0] - b[0])) {
    recs.sort((a, b) => a._at - b._at || a._line - b._line);
    for (const r of recs) if (r.event === 'stall') stalls.push({ worker, tc: r.tc || null, step: r.step || null, at: new Date(r._at).toISOString(), silence_ms: r.silence_ms ?? null, classification: r.classification || null, diagnostics: r.diagnostics || null });
    // the open steps as a STACK: a nested step never hides its parent; an `end` closes the newest matching start
    const stack = [];
    for (const r of recs) {
      if (r.event === 'start') stack.push(r);
      else if (r.event === 'end') { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tc === r.tc && stack[i].step === r.step) { stack.splice(i, 1); break; } }
    }
    // the newest open bounded wait (admission or a server-directed rate-limit wait)
    let waiting = null;
    for (const r of recs) if (WAIT_EVENTS.has(r.event)) waiting = r.phase === 'end' ? (waiting && waiting.event === r.event ? null : waiting) : r;
    const last = recs[recs.length - 1];
    const w = { worker, state: 'idle', tc: last.tc || null, step: null, last_event: last.event, last_at: new Date(last._at).toISOString() };
    const newerResultThan = (t) => results.some((r) => r.worker === worker && r._at > t);
    const movedOnAfter = (t) => recs.some((r) => r._at > t && MOVED_ON.has(r.event)) || newerResultThan(t);
    if (waiting && !movedOnAfter(waiting._at)) {
      const budget = Number(waiting.budget_ms) > 0 ? Number(waiting.budget_ms) : DEFAULT_WAIT_BUDGET_MS;
      const waited = now - waiting._at;
      Object.assign(w, { state: waiting.event, tc: waiting.tc || null, reason: waiting.reason || null, waiting_since: new Date(waiting._at).toISOString(), budget_ms: budget });
      if (waited > budget + graceMs) {
        w.state = 'frozen';
        frozen.push({ worker, tc: waiting.tc || null, step: waiting.step || '(' + waiting.event + ')', elapsed_ms: waited, deadline_ms: budget, grace_ms: graceMs, since_last_progress_ms: waited, expected: null, rule: 'wait-budget',
          reason: waiting.event + ' open for ' + sec(waited) + ' s, past its own budget (' + sec(budget) + ' s) + grace (' + sec(graceMs) + ' s) — a bounded wait never extends the run' });
      }
    }
    if (w.state !== 'frozen' && stack.length) {
      const innermost = stack[stack.length - 1];
      // judge every open step, innermost first: each has its own FIXED deadline (measured from its start — progress
      // never extends it) and its own silence clock (its meaningful progress, or a nested step starting / ending)
      for (const open of [...stack].reverse()) {
        if (movedOnAfter(open._at)) continue;
        const own = recs.filter((r) => r.event === 'progress' && r.tc === open.tc && r.step === open.step && r._at >= open._at);
        const meaningful = meaningfulProgress(own);
        const nested = recs.filter((r) => (r.event === 'start' || r.event === 'end') && r !== open && r._at > open._at && r.tc === open.tc);
        // a bounded wait that ended inside the step restarts its silence clock (the wait had its own budget)
        const waits = recs.filter((r) => WAIT_EVENTS.has(r.event) && r._at > open._at);
        const clock = Math.max(open._at, ...meaningful.map((r) => r._at), ...nested.map((r) => r._at), ...waits.map((r) => r._at));
        const elapsed = now - open._at;
        const sinceClock = now - clock;
        const limit = open.deadline_ms + graceMs;
        const stepSilence = Number(open.silence_ms) > 0 ? Number(open.silence_ms) : silence;
        const inWait = !!(waiting && waiting._at >= open._at);
        if (open === innermost) Object.assign(w, {
          state: inWait ? w.state : 'in-step', tc: open.tc, step: open.step,
          started_at: new Date(open._at).toISOString(), elapsed_ms: elapsed, deadline_ms: open.deadline_ms,
          progress_records: own.length, meaningful_progress: meaningful.length, since_last_progress_ms: sinceClock,
          remaining_before_freeze_ms: Math.max(0, limit - elapsed), ...(stack.length > 1 ? { open_steps: stack.length } : {}),
        });
        if (elapsed > limit) {
          w.state = 'frozen';
          // (no `rule` key: a deadline freeze keeps the record shape of the written watchdog file)
          frozen.push({
            worker, tc: open.tc, step: open.step, elapsed_ms: elapsed, deadline_ms: open.deadline_ms, grace_ms: graceMs,
            since_last_progress_ms: sinceClock, expected: open.note || null,
            reason: 'step "' + open.step + '" open for ' + sec(elapsed) + ' s ' + (clock === open._at ? 'with no progress' : '(last meaningful progress ' + sec(sinceClock) + ' s ago)')
              + ', past its own deadline (' + sec(open.deadline_ms) + ' s) + grace (' + sec(graceMs) + ' s); Playwright\'s own timeout did not fire — the worker is hung',
          });
          break;
        }
        const silentLong = stepSilence !== null && !inWait && open.deadline_ms > stepSilence && sinceClock > stepSilence + graceMs;
        if (silentLong) {
          const at = new Date(clock + stepSilence + graceMs).toISOString();
          const reason = 'long step "' + open.step + '" without meaningful progress for ' + sec(sinceClock) + ' s — past the silence limit (' + sec(stepSilence) + ' s) + grace (' + sec(graceMs) + ' s), deadline ' + sec(open.deadline_ms) + ' s';
          if (silenceMode === 'active') {
            w.state = 'frozen';
            frozen.push({ worker, tc: open.tc, step: open.step, elapsed_ms: elapsed, deadline_ms: open.deadline_ms, grace_ms: graceMs, silence_ms: stepSilence,
              since_last_progress_ms: sinceClock, expected: open.note || null, rule: 'silence', reason: reason + '; stopped by the silence rule' });
            break;
          }
          if (open === innermost) w.would_freeze_at = at;
          wouldFreeze.push({ worker, tc: open.tc, step: open.step, at, silence_ms: stepSilence, deadline_ms: open.deadline_ms, since_last_progress_ms: sinceClock, reason: reason + ' — would have frozen here (shadow: not stopped)' });
        }
      }
      if (w.state !== 'frozen' && stack.every((open) => movedOnAfter(open._at))) {
        w.state = 'moved-on';
        w.note = 'the step never recorded an end but the worker produced newer records — a helper defect, not a hang';
      }
    }
    workers.push(w);
  }
  return { workers, frozen, wouldFreeze, stalls };
}

// a heartbeat `tc` is a string — one TC-ID, or the comma-joined list of a test that covers several
const tcsOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export function reconstruct({ heartbeat, results, group, frozen, stopReason }) {
  const planned = (group.tcs || []).slice();
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
    for (const tc of tcsOf(h.tc)) {
      if (!planned.includes(tc) || seen.has(tc)) continue;
      if (h.event === 'test-start' || h.event === 'start' || h.event === 'progress' || h.event === 'evidence') started.set(tc, h);
      if (h.event === 'test-end') started.delete(tc);
    }
  }
  const other = stopReason && !frozenWorkers.size ? stopReason : null;
  for (const [tc, h] of started) {
    const f = frozen.find((x) => tcsOf(x.tc).includes(tc));
    const openStep = f ? f.step : (h.step || null);
    interrupted.push({
      tc, status: 'INCOMPLETE', worker: h.worker, step: openStep,
      elapsed_ms: f ? f.elapsed_ms : null,
      collateral: !f,
      reason: f
        ? 'interrupted: watchdog at step "' + f.step + '" after ' + Math.round(f.elapsed_ms / 1000) + ' s'
        : other ? 'interrupted: ' + other
          : 'interrupted: collateral (watchdog stop of worker ' + [...frozenWorkers].join(', ') + ')',
    });
  }
  const done = new Set([...seen, ...interrupted.map((i) => i.tc)]);
  const not_started = planned.filter((tc) => !done.has(tc)).map((tc) => ({ tc, status: 'NOT_RUN', reason: 'not started: ' + (other || 'watchdog stop') }));
  return { completed, interrupted, not_started };
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'watchdog',
  usage: 'node watchdog.mjs --heartbeat <jsonl> --results <jsonl> --plan <group-or-run-plan.json> [--group <name>] [--stage <name>] [--now <ISO>] [--grace <ms>] [--silence <ms>] [--silence-mode active|shadow] [--stop-reason <text>] [--out <watchdog.json>] [--write] [--pretty] [--strict]',
  notes: [
    'Read-only unless --write. Default exit code is 0; --strict maps OK 0 · FROZEN 1 · BLOCKED 2 · NOT_RUN 3.',
    'A deadline freeze needs an open step (nested steps included) past its OWN fixed deadline + grace — progress never extends it — whose worker has not left the test (no newer test-start / test-end / teardown / console-report, no newer result). Console silence and a stale stage JSON never count.',
    '--silence <ms>: a LONG step (deadline > silence) without MEANINGFUL progress past silence + grace is declared FROZEN (--silence-mode active, the default) or only reported in would_freeze[] (shadow). An open admission-wait / rate-wait is never a UI stall but is FROZEN past its own budget_ms + grace. stall / teardown / console-report / deferred records are informational, never a step and never progress.',
    'Reconstruction (completed / interrupted / not_started) is always in the payload; the skill applies it only when it stops the command.',
    '--stop-reason names a stop that was not a freeze (the outer-ceiling kill of run-stage.mjs); with no frozen worker it replaces "collateral (watchdog stop …)" / "watchdog stop" in the reasons.',
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
  const stopReason = str(args.stopReason) || str(args['stop-reason']) || null;
  const silenceRaw = args.silence !== undefined ? args.silence : args.silenceMs;
  const silenceMs = silenceRaw !== undefined && silenceRaw !== null && silenceRaw !== true ? Number(silenceRaw) : null;
  const silenceMode = str(args.silenceMode) || str(args['silence-mode']) || 'active';
  const base = { tool: 'watchdog', schema: SCHEMA_VERSION, readOnly: true, now: new Date(now).toISOString(), grace_ms: graceMs, stage: str(args.stage) || null, group: str(args.group) || null };
  if (!planPath) return { ...base, verdict: 'NOT_RUN', reason: 'no --plan supplied', errors, warnings };
  if (Number.isNaN(now)) return { ...base, verdict: 'BLOCKED', reason: '--now is not a valid timestamp', errors, warnings };
  if (Number.isNaN(graceMs) || graceMs < 0) return { ...base, verdict: 'BLOCKED', reason: '--grace must be a non-negative number of milliseconds', errors, warnings };
  if (silenceMs !== null && (Number.isNaN(silenceMs) || silenceMs < 0)) return { ...base, verdict: 'BLOCKED', reason: '--silence must be a non-negative number of milliseconds', errors, warnings };
  if (!SILENCE_MODES.includes(silenceMode)) return { ...base, verdict: 'BLOCKED', reason: '--silence-mode must be active | shadow', errors, warnings };
  if (silenceMs) base.silence = { ms: silenceMs, mode: silenceMode };
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
  const { workers, frozen, wouldFreeze, stalls } = decide({ heartbeat, results, group, now, graceMs, silenceMs, silenceMode });
  const reconstruction = reconstruct({ heartbeat, results, group, frozen, stopReason });
  const verdict = frozen.length ? 'FROZEN' : 'OK';
  const payload = {
    ...base, verdict,
    reason: frozen.length ? frozen.map((f) => 'worker ' + f.worker + ': ' + f.reason).join('; ') : 'every worker is idle, progressing, or inside its step deadline',
    workers, frozen, ...(silenceMs ? { would_freeze: wouldFreeze } : {}), ...(stalls.length ? { stalls } : {}), reconstruction,
    counts: { planned: group.tcs.length, completed: reconstruction.completed.length, interrupted: reconstruction.interrupted.length, not_started: reconstruction.not_started.length, workers: workers.length, frozen: frozen.length },
    errors, warnings, writes: [],
  };
  if (args.write) {
    const out = str(args.out);
    if (!out) { payload.warnings.push('--write without --out: nothing written'); return payload; }
    const file = {
      schema: SCHEMA_VERSION, stage: payload.stage, group: payload.group, decided_at: payload.now, verdict,
      grace_ms: graceMs, frozen, source: 'incremental+watchdog',
      ...(stopReason ? { stop_reason: stopReason } : {}),
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

// the CLI entry: a realpath comparison — a URL string built from argv[1] misses an 8.3 short path (C:\\Users\\NAME~1\\…), a
// symlink or another drive-letter case and the script then exited 0 having done nothing
if ((() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })()) {
  let code = 0;
  try { code = main(); }
  catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'watchdog', schema: SCHEMA_VERSION, verdict: 'BLOCKED', reason: 'internal error: ' + e.message, errors: [{ source: 'internal', line: 0, reason: e.message }] }, args);
    code = args.strict ? 2 : 0;
  }
  process.exit(code);
}
