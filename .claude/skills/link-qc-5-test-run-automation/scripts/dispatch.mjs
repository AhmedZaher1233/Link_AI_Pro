#!/usr/bin/env node
// dispatch.mjs — the pure scheduling core of skill 5's dispatcher (optimisation plan Revision 3 §3.2 / §3.5 and
// Revision 3.1 §3.5 / §4.4): the claim conflict rules, conflict-aware list scheduling over execution units, and the
// worker ramp. Node >= 18, zero dependencies.
//
// PURE BY DESIGN: no file, no process, no clock of its own — every decision takes `now` from the caller. run-stage.mjs
// owns the children, the capacity ledger and the admission file; parallel-plan.mjs imports the conflict rules from here,
// so the readiness check and the dispatcher can never disagree about what conflicts.
//
// Claims: { key, mode: read | write | aggregate-read | exclusive, own?: true, source, evidence }.
//   Keys: rec:D{n} · rec:lit:{entity}:{literal} · col:{entity}[@D{n}] · col:*[@D{n}] · acct:A{n} · bg:{effect}@{scope} ·
//   shared:{slug} · learned:{id} · global:{what} · '*' (everything).
// Rules (§3.2) — symmetric, either order, never together when they conflict:
//   - read ∥ read, read ∥ aggregate-read, aggregate-read ∥ aggregate-read are compatible;
//   - write ∥ write only where BOTH are `own` appends on the same collection (each adds its own unique record) or the
//     same background effect; any other write pair on a key they share conflicts;
//   - a read or an aggregate-read conflicts with every write it covers: the same key; `col:*` covers every collection
//     and record; `col:X` covers `col:X@D{n}`; `col:X@D{n}` / `col:*@D{n}` cover `rec:D{n}`, every `col:…@D{n}` and the
//     unscoped `col:X` of the same collection; `bg:E@*` covers every scope of E;
//   - exclusive conflicts with everything on its key, and an exclusive '*' with everything at all (barrier / run-alone).
// Unique record names prove only one thing: two tests do not write the SAME record. They never remove a setup,
// teardown, aggregate, account / session or background claim — parallel-plan.mjs derives those separately.
//
// Scheduler (§3.5): dynamic conflict-aware list scheduling. A unit starts only when it is compatible with every running
// unit AND every not-yet-finished pool unit; priority = expected duration (longest first) → conflict degree → TC order,
// with aging (a unit ready for longer than `agingMs` goes first, and while it is blocked nothing that would delay it
// starts); a barrier (exclusive '*') starts only when nothing runs. Never connected-component lanes: A–B–C with A∥C
// compatible runs A and C together.
//
// Ramp (Revision 3.1 §4.4): W0 = min(w0, ceiling); a window = at least max(`minTests`, workers) completed tests AND
// `minWindowMs` of WALL time (the summed wall spans of its samples — pool batches accumulate); the first window sets the
// throughput and p95 baselines; after one healthy W0 window ONE trial at W+1 (or straight to a remembered validated
// `target`) for one window, kept only with >= `trialGainPct` % more throughput per wall minute (normalised by expected
// durations) and health, otherwise reverted and the run plateaus; −1 on unexplained interference, environment-wide
// throttling or p95 > 1.5× baseline (scoped throttling only blocks an increase); halve at once on a crash / launch
// failure; `spacingWindows` windows between changes; never above the ceiling.
//
// Library only — `node dispatch.mjs --help` prints this contract's summary.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DISPATCH_SCHEMA = 'skill5-dispatch/1';
export const GLOBAL_KEY = '*';
export const MODES = ['read', 'write', 'aggregate-read', 'exclusive'];

const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });

/* ---------------- keys and claims ---------------- */

/** 'col:order@D1' → { kind: 'col', name: 'order', scope: 'D1' }; 'bg:audit@order' → { kind: 'bg', name: 'audit', scope: 'order' }. */
export function parseKey(key) {
  const k = String(key || '');
  if (k === GLOBAL_KEY) return { kind: GLOBAL_KEY, name: GLOBAL_KEY, scope: null };
  const colon = k.indexOf(':');
  const kind = colon < 0 ? k : k.slice(0, colon);
  const rest = colon < 0 ? '' : k.slice(colon + 1);
  if (kind === 'col' || kind === 'bg') {
    const at = rest.lastIndexOf('@');
    return at < 0 ? { kind, name: rest, scope: null } : { kind, name: rest.slice(0, at), scope: rest.slice(at + 1) };
  }
  return { kind, name: rest, scope: null };
}

/** Does a read / aggregate-read on `readKey` observe a write on `writeKey`? */
export function covers(readKey, writeKey) {
  if (readKey === writeKey) return true;
  if (readKey === GLOBAL_KEY || writeKey === GLOBAL_KEY) return true;
  const r = parseKey(readKey);
  const w = parseKey(writeKey);
  if (r.kind === 'col') {
    if (r.name === '*' && !r.scope) return w.kind === 'col' || w.kind === 'rec';
    if (!r.scope) return w.kind === 'col' && w.name === r.name;
    // scoped reader: everything under the same data item, and the unscoped writes of the same collection
    if (w.kind === 'rec') return w.name === r.scope;
    if (w.kind === 'col') return w.scope === r.scope || (!w.scope && r.name !== '*' && w.name === r.name);
    return false;
  }
  if (r.kind === 'bg') return w.kind === 'bg' && w.name === r.name && (r.scope === '*' || w.scope === '*' || w.scope === r.scope);
  return false;
}

const isRead = (c) => c.mode === 'read' || c.mode === 'aggregate-read';

/** Two own appends that never conflict with each other: the same collection or the same background effect. */
function appendCompatible(a, b) {
  if (!a.own || !b.own) return false;
  const ka = parseKey(a.key);
  const kb = parseKey(b.key);
  if (ka.kind === 'col' && kb.kind === 'col') return ka.name === kb.name || ka.name === '*' || kb.name === '*';
  if (ka.kind === 'bg' && kb.kind === 'bg') return ka.name === kb.name;
  return false;
}

/** The key a pair of claims conflicts on, or null. */
export function claimPairConflict(a, b) {
  if (!a || !b || !MODES.includes(a.mode) || !MODES.includes(b.mode)) return null;
  for (const [x, y] of [[a, b], [b, a]]) {
    if (x.mode !== 'exclusive') continue;
    if (x.key === GLOBAL_KEY || y.key === GLOBAL_KEY || covers(x.key, y.key) || covers(y.key, x.key)) return x.key;
  }
  const aw = a.mode === 'write';
  const bw = b.mode === 'write';
  if (aw && bw) {
    const overlap = a.key === b.key || covers(a.key, b.key) || covers(b.key, a.key);
    if (!overlap) return null;
    if (appendCompatible(a, b)) return null;
    return a.key === b.key ? a.key : [a.key, b.key].sort(natural).join(' ~ ');
  }
  if (aw && isRead(b)) return covers(b.key, a.key) ? b.key : null;
  if (bw && isRead(a)) return covers(a.key, b.key) ? a.key : null;
  return null;
}

/** Every key two claim lists conflict on. */
export function claimsConflict(ca = [], cb = []) {
  const keys = new Set();
  for (const a of ca || []) for (const b of cb || []) {
    const k = claimPairConflict(a, b);
    if (k) keys.add(k);
  }
  return { conflict: keys.size > 0, keys: [...keys].sort(natural) };
}

/** A unit pair: their claims, plus an order dependency (`after`) in either direction. */
export function unitsConflict(ua, ub) {
  if (!ua || !ub || ua.id === ub.id) return { conflict: false, keys: [] };
  const r = claimsConflict(ua.claims || [], ub.claims || []);
  const keys = new Set(r.keys);
  if ((ua.after || []).includes(ub.id) || (ub.after || []).includes(ua.id)) keys.add('order');
  return { conflict: keys.size > 0, keys: [...keys].sort(natural) };
}

/** A barrier / run-alone unit: an exclusive claim on everything. */
export const isGlobal = (u) => !!u && (u.claims || []).some((c) => c.mode === 'exclusive' && c.key === GLOBAL_KEY);

/* ---------------- the scheduler ---------------- */

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && x >= 0).sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

/**
 * Conflict-aware list scheduling over the units of one stage. `units` holds every unit of the stage (pool units
 * included — the caller runs the pool as ONE multi-worker child and reports its unfinished units as `poolPending`);
 * `pool` lists the pool unit ids, which are never started here. `history` maps unit id → expected ms (overrides
 * `unit.expectedMs`); an unknown duration counts as the median of the known ones.
 */
export function createScheduler({ units = [], pool = [], history = {}, agingMs = 600000, startAt = 0 } = {}) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const poolSet = new Set(pool);
  const sched = units.filter((u) => !poolSet.has(u.id));
  const known = sched.map((u) => (typeof history[u.id] === 'number' ? history[u.id] : u.expectedMs)).filter((x) => typeof x === 'number');
  const fallback = median(known);
  const expected = new Map(sched.map((u) => [u.id, typeof history[u.id] === 'number' ? history[u.id] : (typeof u.expectedMs === 'number' ? u.expectedMs : fallback)]));
  const cache = new Map();
  const conflictOf = (a, b) => {
    const k = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
    if (!cache.has(k)) cache.set(k, unitsConflict(a, b));
    return cache.get(k);
  };
  const degree = new Map(sched.map((u) => [u.id, units.filter((o) => o.id !== u.id && conflictOf(u, o).conflict).length]));
  const firstTc = (u) => [...(u.tcs || [])].sort(natural)[0] || u.id;
  const pending = new Set(sched.map((u) => u.id));
  const done = new Map();
  const started = new Map();
  const readySince = new Map();
  const log = [];
  const predecessorsDone = (u) => (u.after || []).every((p) => done.has(p) || !byId.has(p));
  for (const u of sched) if (predecessorsDone(u)) readySince.set(u.id, startAt);
  const isAged = (u, now) => readySince.has(u.id) && now - readySince.get(u.id) >= agingMs;
  // aged units first — the longest-waiting, then the most constrained (a barrier conflicts with everything, so it is the
  // one that keeps being passed over); otherwise expected duration → conflict degree → TC order
  const rank = (now) => (a, b) => {
    const ag = isAged(a, now), bg = isAged(b, now);
    if (ag !== bg) return ag ? -1 : 1;
    if (ag && bg) {
      const d = readySince.get(a.id) - readySince.get(b.id);
      if (d) return d;
      const g = degree.get(b.id) - degree.get(a.id);
      if (g) return g;
    }
    return (expected.get(b.id) - expected.get(a.id)) || (degree.get(b.id) - degree.get(a.id)) || natural(firstTc(a), firstTc(b)) || natural(a.id, b.id);
  };

  function next({ running = [], poolPending = [], freeSlots = 1, now = 0 } = {}) {
    if (!pending.size) return { start: null, waitReason: 'nothing pending' };
    if (!(freeSlots >= 1)) return { start: null, waitReason: 'no free slot' };
    const runningUnits = running.map((id) => byId.get(id) || { id, claims: [] });
    const poolUnits = poolPending.map((id) => byId.get(id)).filter(Boolean);
    const blockers = (u) => {
      const r = runningUnits.filter((x) => conflictOf(u, x).conflict).map((x) => x.id);
      const p = poolUnits.filter((x) => conflictOf(u, x).conflict).map((x) => x.id);
      return { r, p };
    };
    const candidates = [...pending].map((id) => byId.get(id)).sort(rank(now));
    const eligible = candidates.filter(predecessorsDone);
    if (!eligible.length) {
      const u = candidates[0];
      const wait = (u.after || []).filter((p) => !done.has(p) && byId.has(p));
      return { start: null, waitReason: 'waiting for predecessor ' + wait.join(', ') };
    }
    const agedBlocked = eligible.filter((u) => {
      if (!isAged(u, now)) return false;
      const b = blockers(u);
      return b.r.length > 0 || b.p.length > 0 || (isGlobal(u) && (running.length > 0 || poolPending.length > 0));
    });
    let reason = null;
    for (const u of eligible) {
      const b = blockers(u);
      if (isGlobal(u) && (running.length || poolPending.length)) { reason = reason || 'barrier ' + u.id + ' waits until nothing runs'; continue; }
      if (b.r.length) { reason = reason || u.id + ' conflicts with running ' + b.r.join(', '); continue; }
      if (b.p.length) { reason = reason || u.id + ' conflicts with unfinished pool unit ' + b.p.join(', '); continue; }
      const delays = agedBlocked.find((a) => a.id !== u.id && (isGlobal(a) || conflictOf(a, u).conflict));
      if (delays) { reason = reason || 'draining for aged unit ' + delays.id; continue; }
      pending.delete(u.id);
      started.set(u.id, now);
      log.push({ at: now, event: 'start', unit: u.id });
      return { start: u, waitReason: null };
    }
    return { start: null, waitReason: reason || 'no runnable unit' };
  }

  function markDone(unitId, { status = 'done', now = 0 } = {}) {
    if (done.has(unitId)) return;
    done.set(unitId, { status, at: now });
    pending.delete(unitId);
    log.push({ at: now, event: 'done', unit: unitId, status });
    for (const u of sched) if (pending.has(u.id) && !readySince.has(u.id) && predecessorsDone(u)) readySince.set(u.id, now);
  }

  // the caller could not start a unit next() handed out (its reservation was refused): it goes back to pending with its
  // ready time and aging kept, as if never picked
  function requeue(unitId, { now = 0 } = {}) {
    if (!started.has(unitId) || done.has(unitId)) return false;
    started.delete(unitId);
    pending.add(unitId);
    log.push({ at: now, event: 'requeue', unit: unitId });
    return true;
  }

  function state() {
    return {
      schema: DISPATCH_SCHEMA,
      pending: [...pending].sort(natural),
      started: [...started.keys()],
      done: [...done.keys()],
      expected: Object.fromEntries(expected),
      degree: Object.fromEntries(degree),
      log: log.slice(),
    };
  }

  return { next, done: markDone, requeue, state };
}

/* ---------------- the ramp ---------------- */

// A sample is one closed piece of pool work: { now, completed, expectedMs?, wallMs?, workers?, cpuPct?, availableMb?,
// needMb?, refusal?, envRefusal?, interference?, crash?, p95Ms? }. wallMs is the MONOTONIC wall span of that piece
// (a pool batch: Playwright start-up and clean-up included) — when given, the window's clock is the sum of the wallMs
// of its samples, never summed test durations; without it the clock is now − window start (older records). expectedMs
// only normalises throughput. Samples accumulate until the window closes; a sample at another worker count than the
// current one restarts the window (only comparable work is combined). refusal (a scoped throttling refusal — account /
// endpoint / service) only blocks an increase: it is paced in its own scope and never lowers concurrency for the other
// units; envRefusal (environment-wide throttling) decreases like unexplained interference. target: a remembered,
// previously validated worker count — the first trial may go straight to it (kept / reverted by the same rule).
export function createRamp({ w0 = 2, ceiling = 2, minTests = 3, minWindowMs = 180000, trialGainPct = 10, cpuHealthyPct = 70, p95Factor = 1.5, spacingWindows = 2, startAt = null, target = null } = {}) {
  const cap = Math.max(1, Math.floor(Number(ceiling) || 1));
  let workers = Math.max(1, Math.min(Math.floor(Number(w0) || 1), cap));
  const remembered = Number.isInteger(Number(target)) && Number(target) > 0 ? Math.min(cap, Number(target)) : null;
  let phase = 'initial';          // initial → trial → steady
  let plateau = false;
  let baseline = null;            // { throughput, p95 }
  let trial = null;               // { from, baseline }
  let sinceChange = Infinity;     // windows closed since the last workers change
  const history = [];
  const win = { start: startAt, wallMs: 0, timed: false, tests: 0, workMs: 0, allExpected: true, unhealthy: [], p95: null, interference: false, envRefusal: false };
  const reset = (now) => { win.start = now; win.wallMs = 0; win.timed = false; win.tests = 0; win.workMs = 0; win.allExpected = true; win.unhealthy = []; win.p95 = null; win.interference = false; win.envRefusal = false; };
  const note = (now, action, reason, extra = {}) => { const d = { at: now, action, workers, reason, ...extra }; history.push(d); return { action, workers, reason }; };
  const needTests = () => Math.max(minTests, workers);

  function record(sample = {}) {
    const now = Number(sample.now) || 0;
    if (win.start === null) win.start = now;
    // only work done at the current worker count is comparable
    if (Number.isInteger(sample.workers) && sample.workers !== workers && !sample.crash) reset(now);
    const completed = Math.max(0, Number(sample.completed) || 0);
    win.tests += completed;
    if (typeof sample.wallMs === 'number' && sample.wallMs >= 0) { win.wallMs += sample.wallMs; win.timed = true; }
    if (completed) {
      if (typeof sample.expectedMs === 'number') win.workMs += sample.expectedMs;
      else win.allExpected = false;
    }
    if (typeof sample.cpuPct === 'number' && sample.cpuPct >= cpuHealthyPct) win.unhealthy.push('cpu ' + sample.cpuPct + ' %');
    if (typeof sample.availableMb === 'number' && typeof sample.needMb === 'number' && sample.availableMb < sample.needMb) win.unhealthy.push('available memory ' + sample.availableMb + ' MB < ' + sample.needMb + ' MB');
    if (sample.refusal) win.unhealthy.push('scoped throttling');
    if (sample.envRefusal) { win.unhealthy.push('environment-wide throttling'); win.envRefusal = true; }
    if (sample.interference) { win.unhealthy.push('interference'); win.interference = true; }
    if (typeof sample.p95Ms === 'number') win.p95 = Math.max(win.p95 || 0, sample.p95Ms);
    if (sample.crash) {
      const from = workers;
      workers = Math.max(1, Math.floor(workers / 2));
      plateau = true;
      if (phase === 'trial') phase = 'steady';
      trial = null;
      sinceChange = 0;
      reset(now);
      return note(now, 'halve', 'browser crash or launch failure — workers ' + from + ' → ' + workers + '; no further increase this run');
    }
    const elapsed = win.timed ? win.wallMs : now - win.start;
    if (win.tests < needTests() || elapsed < minWindowMs || !(elapsed > 0)) return { action: 'hold', workers, reason: 'window open: ' + win.tests + '/' + needTests() + ' tests, ' + Math.round(elapsed / 1000) + '/' + Math.round(minWindowMs / 1000) + ' s' };
    // throughput per minute of wall time: expected work done (normalised by expected durations) when every completed
    // test carried one, else completed tests; two windows are compared on the measure both of them have
    const rate = { work: win.allExpected && win.workMs > 0 ? (win.workMs / elapsed) * 60000 : null, count: (win.tests / elapsed) * 60000 };
    const throughput = rate.work !== null ? rate.work : rate.count;
    const gainOf = (cur, base) => {
      const k = cur.work !== null && base.work !== null ? 'work' : 'count';
      return base[k] > 0 ? ((cur[k] - base[k]) / base[k]) * 100 : 0;
    };
    const healthy = win.unhealthy.length === 0;
    const p95 = win.p95;
    const why = healthy ? 'healthy window' : 'unhealthy window (' + [...new Set(win.unhealthy)].join(', ') + ')';
    const up = () => (remembered && remembered > workers + 1 && !history.some((h) => h.action === 'revert') ? remembered : workers + 1);
    let out;
    if (phase === 'initial') {
      if (!baseline) baseline = { throughput: rate, p95 };
      if (healthy && !plateau && workers + 1 <= cap) {
        trial = { from: workers, baseline: rate };
        workers = up();
        phase = 'trial';
        sinceChange = 0;
        out = note(now, 'trial', why + ' at W0 — one window at ' + workers + ' workers' + (workers > trial.from + 1 ? ' (the remembered validated count)' : ''), { throughput });
      } else {
        if (healthy) phase = 'steady';
        sinceChange += 1;
        out = note(now, 'hold', why + (workers + 1 > cap ? ' — at the ceiling (' + cap + ')' : plateau ? ' — plateau' : ''), { throughput });
      }
    } else if (phase === 'trial') {
      const gain = gainOf(rate, trial.baseline);
      if (healthy && gain >= trialGainPct) {
        baseline = { throughput: rate, p95: p95 ?? (baseline && baseline.p95) };
        phase = 'steady';
        sinceChange = 1;
        out = note(now, 'keep', 'throughput +' + Math.round(gain * 10) / 10 + ' % and healthy — ' + workers + ' workers kept', { throughput });
      } else {
        const from = workers;
        workers = trial.from;
        plateau = true;
        phase = 'steady';
        sinceChange = 0;
        out = note(now, 'revert', (healthy ? 'throughput ' + (gain >= 0 ? '+' : '') + Math.round(gain * 10) / 10 + ' % (< ' + trialGainPct + ' %)' : why) + ' — workers ' + from + ' → ' + workers + '; plateau for this run', { throughput });
      }
      trial = null;
    } else {
      const slow = typeof p95 === 'number' && baseline && typeof baseline.p95 === 'number' && baseline.p95 > 0 && p95 > baseline.p95 * p95Factor;
      if ((win.interference || win.envRefusal || slow) && workers > 1 && sinceChange >= spacingWindows) {
        const from = workers;
        workers -= 1;
        sinceChange = 0;
        out = note(now, 'decrease', (win.interference ? 'unexplained interference' : win.envRefusal ? 'environment-wide throttling' : 'p95 ' + p95 + ' ms > ' + p95Factor + '× baseline ' + baseline.p95 + ' ms') + ' — workers ' + from + ' → ' + workers, { throughput });
      } else if (healthy && !plateau && workers + 1 <= cap && sinceChange >= spacingWindows) {
        trial = { from: workers, baseline: rate };
        workers += 1;
        phase = 'trial';
        sinceChange = 0;
        out = note(now, 'trial', why + ' — one window at ' + workers + ' workers', { throughput });
      } else {
        sinceChange += 1;
        out = note(now, 'hold', why + (plateau ? ' — plateau' : workers + 1 > cap ? ' — at the ceiling (' + cap + ')' : ''), { throughput });
      }
    }
    reset(now);
    return out;
  }

  // the highest worker count a closed window proved healthy at (a kept trial or a healthy hold) — null when none
  const validated = () => { let v = null; for (const h of history) if (h.action === 'keep' || (h.action === 'hold' && /^healthy/.test(h.reason))) v = Math.max(v || 0, h.workers); return v; };
  return { workers: () => workers, record, history: () => history.slice(), validated, state: () => ({ phase, plateau, baseline, workers, ceiling: cap, target: remembered }) };
}

/* ---------------- CLI (help only — this is a library) ---------------- */

const HELP = {
  tool: 'dispatch', schema: DISPATCH_SCHEMA,
  usage: 'library — import { claimsConflict, unitsConflict, createScheduler, createRamp } from "./dispatch.mjs"',
  notes: [
    'Pure: no I/O, no clock of its own; run-stage.mjs owns the children, the ledger and the admission file.',
    'Conflict rules are shared with parallel-plan.mjs, so the readiness check and the dispatcher never disagree.',
    'A unit starts only when compatible with every running unit and every unfinished pool unit; barriers only when nothing runs.',
  ],
};

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.stdout.write(JSON.stringify(HELP, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
