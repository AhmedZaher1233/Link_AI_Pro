#!/usr/bin/env node
// selftest-dispatch.mjs — regression harness for dispatch.mjs (claim conflicts, conflict-aware list scheduling, the ramp).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing self-test means the dispatcher cannot be trusted:
// run-stage.mjs must stay on `--scheduler groups`.
//
// Pure functions only — no files, no processes, no clock: every `now` is given. Expected values are worked out by hand
// in the comments of each case.
//
// Run: node selftest-dispatch.mjs [--pretty]
import { claimsConflict, unitsConflict, isGlobal, createScheduler, createRamp, covers, DISPATCH_SCHEMA } from './dispatch.mjs';
import { parseArgs, print } from './scan-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const cases = [];
function check(name, fn) {
  const problems = [];
  try { fn(problems); } catch (e) { problems.push('threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  cases.push({ name, verdict: problems.length ? 'FAIL' : 'PASS', problems });
}

const R = (key) => ({ key, mode: 'read' });
const A = (key) => ({ key, mode: 'aggregate-read' });
const W = (key, own = false) => ({ key, mode: 'write', ...(own ? { own: true } : {}) });
const X = (key) => ({ key, mode: 'exclusive' });
const U = (id, claims, expectedMs, extra = {}) => ({ id, claims, expectedMs, tcs: [id.toUpperCase()], ...extra });
const started = (s) => s.state().started;

/* 1 — the §3.2 rule matrix, both orders of every pair. */
check('1 claim conflict rules (§3.2), symmetric', (p) => {
  const rows = [
    ['read ∥ read', R('rec:D1'), R('rec:D1'), false],
    ['read ∥ aggregate-read', R('rec:D1'), A('col:order'), false],
    ['aggregate ∥ aggregate', A('col:order'), A('col:order'), false],
    ['read vs write of the record', R('rec:D1'), W('rec:D1'), true],
    ['two own appends', W('col:order', true), W('col:order', true), false],
    ['own appends, one scoped', W('col:order', true), W('col:order@D1', true), false],
    ['own vs non-own write', W('col:order', true), W('col:order'), true],
    ['aggregate observes an append', A('col:order'), W('col:order', true), true],
    ['scoped aggregate vs the data item', A('col:order@D1'), W('rec:D1'), true],
    ['scoped aggregate vs another collection under the item', A('col:order@D1'), W('col:item@D1', true), true],
    ['scoped aggregate vs its collection unscoped', A('col:order@D1'), W('col:order', true), true],
    ['unknown scoped aggregate vs another unscoped collection', A('col:*@D1'), W('col:order', true), false],
    ['unknown aggregate vs any collection', A('col:*'), W('col:product', true), true],
    ['different collections', A('col:product'), W('col:order', true), false],
    ['background reader vs writer', A('bg:audit@order'), W('bg:audit@order', true), true],
    ['background writers', W('bg:audit@order', true), W('bg:audit@order', true), false],
    ['background reader of every scope', A('bg:audit@*'), W('bg:audit@level', true), true],
    ['account lockout vs sign-in', R('acct:A2'), W('acct:A2'), true],
    ['two sign-ins', R('acct:A1'), R('acct:A1'), false],
    ['same shared data', W('shared:x'), W('shared:x'), true],
    ['learned conflict', W('learned:L1'), W('learned:L1'), true],
    ['exclusive everything', X('*'), R('acct:A1'), true],
    ['exclusive on its key', X('global:settings'), R('global:settings'), true],
    ['exclusive on another key', X('global:settings'), R('acct:A1'), false],
  ];
  for (const [name, a, b, want] of rows) {
    const ab = claimsConflict([a], [b]).conflict;
    const ba = claimsConflict([b], [a]).conflict;
    if (ab !== want || ba !== want) p.push(name + ': ' + ab + ' / ' + ba + ' != ' + want);
  }
  if (!covers('col:*', 'rec:D9') || covers('col:order@D1', 'rec:D2')) p.push('covers() edge cases');
  const k = claimsConflict([W('col:order', true), A('bg:audit@order')], [W('col:order'), W('bg:audit@order', true)]);
  if (JSON.stringify(k.keys) !== JSON.stringify(['bg:audit@order', 'col:order'])) p.push('keys ' + JSON.stringify(k.keys));
});

/* 2 — units: claims plus order dependencies; a barrier is global. */
check('2 unitsConflict: claims, order (after), isGlobal', (p) => {
  const a = U('a', [R('acct:A1')], 1);
  const b = U('b', [R('acct:A1')], 1, { after: ['a'] });
  const r = unitsConflict(a, b);
  if (!r.conflict || JSON.stringify(r.keys) !== JSON.stringify(['order'])) p.push('order ' + JSON.stringify(r));
  if (unitsConflict(a, a).conflict) p.push('a unit never conflicts with itself');
  if (!isGlobal(U('g', [X('*')], 1)) || isGlobal(U('h', [X('global:settings')], 1))) p.push('isGlobal');
});

/* 3 — A–B–C (A conflicts with B, B with C, A∥C compatible), A=60, C=50, B=30: A and C run together, then B.
   Connected-component lanes would have run A, B and C one after another. */
check('3 A–B–C: A∥C first, then B — never lanes', (p) => {
  const ua = U('a', [W('col:k1')], 60);
  const ub = U('b', [A('col:k1'), A('col:k2')], 30);
  const uc = U('c', [W('col:k2')], 50);
  const s = createScheduler({ units: [ua, ub, uc] });
  const r1 = s.next({ running: [], freeSlots: 2, now: 0 });
  const r2 = s.next({ running: ['a'], freeSlots: 1, now: 0 });
  const r3 = s.next({ running: ['a', 'c'], freeSlots: 0, now: 0 });
  if (!r1.start || r1.start.id !== 'a' || !r2.start || r2.start.id !== 'c') p.push('starts ' + JSON.stringify([r1.start && r1.start.id, r2.start && r2.start.id]));
  if (r3.start || r3.waitReason !== 'no free slot') p.push('no slot ' + JSON.stringify(r3));
  s.done('c', { now: 50 });
  const r4 = s.next({ running: ['a'], freeSlots: 1, now: 50 });
  if (r4.start || !/conflicts with running a/.test(r4.waitReason)) p.push('B must wait for A ' + JSON.stringify(r4));
  s.done('a', { now: 60 });
  const r5 = s.next({ running: [], freeSlots: 2, now: 60 });
  if (!r5.start || r5.start.id !== 'b') p.push('B after both ' + JSON.stringify(r5));
  if (JSON.stringify(started(s)) !== JSON.stringify(['a', 'c', 'b'])) p.push('order ' + JSON.stringify(started(s)));
});

/* 4 — the same shape with B the longest (90): B goes first (priority), then A∥C — still never lanes. */
check('4 A–B–C with B longest: B, then A∥C', (p) => {
  const s = createScheduler({ units: [U('a', [W('col:k1')], 60), U('b', [A('col:k1'), A('col:k2')], 90), U('c', [W('col:k2')], 50)] });
  const r1 = s.next({ running: [], freeSlots: 2, now: 0 });
  const r2 = s.next({ running: ['b'], freeSlots: 1, now: 0 });
  if (!r1.start || r1.start.id !== 'b' || r2.start) p.push('B first, alone ' + JSON.stringify([r1.start && r1.start.id, r2.start && r2.start.id]));
  s.done('b', { now: 90 });
  const r3 = s.next({ running: [], freeSlots: 2, now: 90 });
  const r4 = s.next({ running: ['a'], freeSlots: 1, now: 90 });
  if (!r3.start || r3.start.id !== 'a' || !r4.start || r4.start.id !== 'c') p.push('then A∥C ' + JSON.stringify([r3.start && r3.start.id, r4.start && r4.start.id]));
});

/* 5 — a barrier starts only when nothing runs, and nothing starts while it runs. */
check('5 barrier: waits until nothing runs; blocks every start while it runs', (p) => {
  const s = createScheduler({ units: [U('g', [X('*')], 10), U('a', [R('acct:A1')], 100), U('c', [R('acct:A1')], 100), U('d', [R('acct:A1')], 5)] });
  const r1 = s.next({ running: [], freeSlots: 1, now: 0 });
  const r2 = s.next({ running: ['a'], freeSlots: 1, now: 0 });
  if (!r1.start || r1.start.id !== 'a' || !r2.start || r2.start.id !== 'c') p.push('a then c ' + JSON.stringify([r1.start && r1.start.id, r2.start && r2.start.id]));
  s.done('a', { now: 100 });
  const r3 = s.next({ running: ['c'], freeSlots: 1, now: 100 });
  if (!r3.start || r3.start.id !== 'd') p.push('d starts beside c while the barrier waits ' + JSON.stringify(r3));
  const r4 = s.next({ running: ['c', 'd'], freeSlots: 1, now: 100 });
  if (r4.start || !/barrier g waits until nothing runs/.test(r4.waitReason)) p.push('barrier wait ' + JSON.stringify(r4));
  s.done('c', { now: 100 }); s.done('d', { now: 105 });
  const r5 = s.next({ running: [], freeSlots: 1, now: 105 });
  if (!r5.start || r5.start.id !== 'g') p.push('barrier starts when nothing runs ' + JSON.stringify(r5));
  const t = createScheduler({ units: [U('g', [X('*')], 10), U('h', [R('acct:A1')], 1)] });
  const t1 = t.next({ running: [], freeSlots: 2, now: 0 });
  const t2 = t.next({ running: ['g'], freeSlots: 1, now: 0 });
  if (!t1.start || t1.start.id !== 'g' || t2.start || !/conflicts with running g/.test(t2.waitReason)) p.push('nothing beside a running barrier ' + JSON.stringify([t1.start && t1.start.id, t2]));
});

/* 6 — never a unit that conflicts with an unfinished pool unit; pool units are never started here. */
check('6 pool constraint: waits for the unfinished pool unit; pool units are not scheduled', (p) => {
  const s = createScheduler({ units: [U('p', [W('col:x')], 10), U('x', [A('col:x')], 10)], pool: ['p'] });
  const r1 = s.next({ running: [], poolPending: ['p'], freeSlots: 1, now: 0 });
  if (r1.start || !/unfinished pool unit p/.test(r1.waitReason)) p.push('waits for the pool ' + JSON.stringify(r1));
  const r2 = s.next({ running: [], poolPending: [], freeSlots: 1, now: 10 });
  if (!r2.start || r2.start.id !== 'x') p.push('starts after the pool ' + JSON.stringify(r2));
  if (s.state().started.includes('p') || s.state().pending.includes('p')) p.push('a pool unit was scheduled');
  const r3 = s.next({ running: ['x'], freeSlots: 1, now: 10 });
  if (r3.start || r3.waitReason !== 'nothing pending') p.push('nothing pending ' + JSON.stringify(r3));
});

/* 7 — aging: a barrier ready since 0 with agingMs 1000; from t=1500 nothing that would delay it starts (a4 waits), and
   it starts as soon as the running units finish. Without aging a4 would start at t=1500. */
check('7 aging prevents starvation of a barrier', (p) => {
  const units = () => [U('g', [X('*')], 10), U('a1', [R('acct:A1')], 100), U('a2', [R('acct:A1')], 100), U('a3', [R('acct:A1')], 100), U('a4', [R('acct:A1')], 100)];
  const s = createScheduler({ units: units(), agingMs: 1000, startAt: 0 });
  const go = (running, slots, now) => s.next({ running, freeSlots: slots, now });
  const x1 = go([], 2, 0), x2 = go(['a1'], 1, 0);
  if (!x1.start || x1.start.id !== 'a1' || !x2.start || x2.start.id !== 'a2') p.push('t0 starts ' + JSON.stringify([x1.start && x1.start.id, x2.start && x2.start.id]));
  s.done('a1', { now: 500 });
  const x3 = go(['a2'], 1, 500);
  if (!x3.start || x3.start.id !== 'a3') p.push('t500 a3 ' + JSON.stringify(x3));
  s.done('a2', { now: 1500 });
  const x4 = go(['a3'], 1, 1500);
  if (x4.start) p.push('t1500 started ' + x4.start.id + ' although g is aged');
  s.done('a3', { now: 2000 });
  const x5 = go([], 2, 2000);
  if (!x5.start || x5.start.id !== 'g') p.push('t2000 g ' + JSON.stringify(x5));
  const x6 = go(['g'], 1, 2000);
  if (x6.start) p.push('a4 beside the running barrier');
  s.done('g', { now: 2010 });
  const x7 = go([], 2, 2010);
  if (!x7.start || x7.start.id !== 'a4') p.push('a4 after g ' + JSON.stringify(x7));
  const n = createScheduler({ units: units(), agingMs: 1e12, startAt: 0 });
  n.next({ running: [], freeSlots: 2, now: 0 }); n.next({ running: ['a1'], freeSlots: 1, now: 0 });
  n.done('a1', { now: 500 }); n.next({ running: ['a2'], freeSlots: 1, now: 500 });
  n.done('a2', { now: 1500 });
  const y = n.next({ running: ['a3'], freeSlots: 1, now: 1500 });
  if (!y.start || y.start.id !== 'a4') p.push('without aging a4 starts at t1500 ' + JSON.stringify(y));
});

/* 8 — a unit with a predecessor waits for it. */
check('8 order dependency: the follower waits for its predecessor', (p) => {
  const s = createScheduler({ units: [U('x', [R('acct:A1')], 10), U('y', [R('acct:A1')], 50, { after: ['x'] })] });
  const r1 = s.next({ running: [], freeSlots: 2, now: 0 });
  const r2 = s.next({ running: ['x'], freeSlots: 1, now: 0 });
  if (!r1.start || r1.start.id !== 'x' || r2.start || !/waiting for predecessor x/.test(r2.waitReason)) p.push('waits ' + JSON.stringify([r1.start && r1.start.id, r2]));
  s.done('x', { now: 10 });
  const r3 = s.next({ running: [], freeSlots: 1, now: 10 });
  if (!r3.start || r3.start.id !== 'y') p.push('y after x ' + JSON.stringify(r3));
});

// ramp windows: three tests per window, one minute apart, each `expectedMs` of work; window throughput = work per minute
const windowOf = (r, t0, expectedMs, health = {}) => {
  let d;
  for (let i = 1; i <= 3; i++) d = r.record({ now: t0 + i * 60000, completed: 1, expectedMs, cpuPct: 40, availableMb: 9000, needMb: 4000, ...health });
  return d;
};

/* 9 — T-36: the initial trial only after one healthy W0 window; < 10 % gain reverts and the run plateaus.
   W1: 3×60 s of work in 180 s → 60 000/min, healthy → trial at 3. W2: 3×63 s → 63 000 (+5 %) → revert to 2, plateau.
   W3: 3×90 s (+50 %) → hold (plateau). */
check('9 ramp: trial after a healthy W0 window; +5 % reverts; plateau holds', (p) => {
  const r = createRamp({ w0: 2, ceiling: 3, startAt: 0 });
  if (r.workers() !== 2) p.push('W0 ' + r.workers());
  const open = r.record({ now: 60000, completed: 1, expectedMs: 60000, cpuPct: 40, availableMb: 9000, needMb: 4000 });
  if (open.action !== 'hold' || !/window open/.test(open.reason)) p.push('open window ' + JSON.stringify(open));
  const w1 = (() => { let d; for (let i = 2; i <= 3; i++) d = r.record({ now: i * 60000, completed: 1, expectedMs: 60000, cpuPct: 40, availableMb: 9000, needMb: 4000 }); return d; })();
  if (w1.action !== 'trial' || r.workers() !== 3) p.push('W1 ' + JSON.stringify(w1));
  const w2 = windowOf(r, 180000, 63000);
  if (w2.action !== 'revert' || r.workers() !== 2) p.push('W2 ' + JSON.stringify(w2));
  const w3 = windowOf(r, 360000, 90000);
  if (w3.action !== 'hold' || r.workers() !== 2 || !/plateau/.test(w3.reason)) p.push('W3 ' + JSON.stringify(w3));
  if (JSON.stringify(r.history().map((h) => h.action)) !== JSON.stringify(['trial', 'revert', 'hold'])) p.push('history ' + JSON.stringify(r.history().map((h) => h.action)));
});

/* 10 — +20 % keeps the trial; the next healthy window holds at the ceiling (3). */
check('10 ramp: +20 % keeps W+1; never above the ceiling', (p) => {
  const r = createRamp({ w0: 2, ceiling: 3, startAt: 0 });
  windowOf(r, 0, 60000);
  const w2 = windowOf(r, 180000, 72000);
  if (w2.action !== 'keep' || r.workers() !== 3) p.push('keep ' + JSON.stringify(w2));
  const w3 = windowOf(r, 360000, 90000);
  if (w3.action !== 'hold' || r.workers() !== 3 || !/ceiling/.test(w3.reason)) p.push('ceiling hold ' + JSON.stringify(w3));
  const one = createRamp({ w0: 2, ceiling: 1, startAt: 0 });
  if (one.workers() !== 1) p.push('W0 = min(2, ceiling 1) ' + one.workers());
  const w = windowOf(one, 0, 60000);
  if (w.action !== 'hold' || one.workers() !== 1) p.push('ceiling 1 ' + JSON.stringify(w));
});

/* 11 — an unhealthy first window (CPU 80 %) gives no trial; the next healthy window does. */
check('11 ramp: no trial after an unhealthy W0 window; the next healthy one trials', (p) => {
  const r = createRamp({ w0: 2, ceiling: 3, startAt: 0 });
  const w1 = windowOf(r, 0, 60000, { cpuPct: 80 });
  if (w1.action !== 'hold' || r.workers() !== 2 || !/unhealthy/.test(w1.reason)) p.push('unhealthy W1 ' + JSON.stringify(w1));
  const w2 = windowOf(r, 180000, 60000);
  if (w2.action !== 'trial' || r.workers() !== 3) p.push('healthy W2 ' + JSON.stringify(w2));
  const m = createRamp({ w0: 2, ceiling: 3, startAt: 0 });
  const lowMem = windowOf(m, 0, 60000, { availableMb: 3000 });
  if (lowMem.action !== 'hold' || m.workers() !== 2) p.push('memory below the need ' + JSON.stringify(lowMem));
});

/* 12 — a crash halves at once (and plateaus); p95 > 1.5× baseline and interference decrease after the spacing. */
check('12 ramp: crash halves at once; slow p95 / interference decrease', (p) => {
  const r = createRamp({ w0: 2, ceiling: 4, startAt: 0 });
  const c = r.record({ now: 1000, completed: 0, crash: true });
  if (c.action !== 'halve' || r.workers() !== 1) p.push('crash ' + JSON.stringify(c));
  const after = windowOf(r, 1000, 60000);
  if (after.action !== 'hold' || r.workers() !== 1) p.push('after a crash ' + JSON.stringify(after));
  const s = createRamp({ w0: 2, ceiling: 2, startAt: 0 });
  windowOf(s, 0, 60000, { p95Ms: 1000 });
  const slow = windowOf(s, 180000, 60000, { p95Ms: 2000 });
  if (slow.action !== 'decrease' || s.workers() !== 1) p.push('p95 decrease ' + JSON.stringify(slow));
  const i = createRamp({ w0: 2, ceiling: 2, startAt: 0 });
  windowOf(i, 0, 60000);
  const intf = windowOf(i, 180000, 60000, { interference: true });
  if (intf.action !== 'decrease' || i.workers() !== 1) p.push('interference decrease ' + JSON.stringify(intf));
  if (DISPATCH_SCHEMA !== 'skill5-dispatch/1') p.push('schema ' + DISPATCH_SCHEMA);
});

/* 13 — a unit next() handed out whose reservation the caller could not take goes back to pending (requeue) and is
   offered again; requeue of an unknown / finished unit is refused. x (50) is picked first, requeued, offered again first. */
check('13 requeue: a refused start goes back to pending and is offered again', (p) => {
  const s = createScheduler({ units: [U('x', [R('acct:A1')], 50), U('y', [R('acct:A2')], 10)] });
  const r1 = s.next({ running: [], freeSlots: 1, now: 0 });
  if (!r1.start || r1.start.id !== 'x') p.push('first pick ' + JSON.stringify(r1));
  if (s.requeue('x', { now: 5 }) !== true || !s.state().pending.includes('x') || started(s).includes('x')) p.push('requeue x ' + JSON.stringify(s.state()));
  const r2 = s.next({ running: [], freeSlots: 1, now: 6 });
  if (!r2.start || r2.start.id !== 'x') p.push('x offered again first ' + JSON.stringify(r2));
  s.done('x', { now: 20 });
  if (s.requeue('x') !== false || s.requeue('nope') !== false) p.push('requeue of a finished / unknown unit must be refused');
  if (!s.state().log.some((e) => e.event === 'requeue' && e.unit === 'x')) p.push('requeue not logged');
});

/* 14 — POOL BATCHES: the window clock is the summed WALL span of its batches (never summed test durations); short batches
   accumulate into one window; a batch at another worker count restarts it; scoped throttling only blocks an increase,
   environment-wide throttling decreases; a remembered validated count is the first trial's target. */
check('14 ramp over batches: wall-clock windows, accumulation, scoped vs environment throttling, remembered target', (p) => {
  const ok = { cpuPct: 40, availableMb: 9000, needMb: 4000 };
  // two 30 s batches of 4 tests at 2 workers = one 60 s window (8 tests) → trial at 3; tests ran 4 × 50 s each (overlapping)
  const r = createRamp({ w0: 2, ceiling: 4, minWindowMs: 60000, spacingWindows: 1, startAt: 0 });
  const b1 = r.record({ now: 31000, workers: 2, completed: 4, wallMs: 30000, durationMs: 200000, ...ok });
  if (b1.action !== 'hold' || !/window open: 4\/3 tests, 30\/60 s/.test(b1.reason)) p.push('first batch keeps the window open: ' + JSON.stringify(b1));
  const b2 = r.record({ now: 62000, workers: 2, completed: 4, wallMs: 30000, ...ok });
  if (b2.action !== 'trial' || r.workers() !== 3) p.push('two batches close one window → trial: ' + JSON.stringify(b2));
  // a batch at 3 workers with 25 % more tests per wall minute → kept
  const b3 = r.record({ now: 92000, workers: 3, completed: 10, wallMs: 60000, ...ok });
  if (b3.action !== 'keep' || r.workers() !== 3) p.push('the trial window over wall time: ' + JSON.stringify(b3));
  // scoped throttling: unhealthy (no increase) but never a decrease
  const b4 = r.record({ now: 152000, workers: 3, completed: 10, wallMs: 60000, refusal: true, ...ok });
  if (b4.action !== 'hold' || r.workers() !== 3 || !/scoped throttling/.test(b4.reason)) p.push('scoped throttling: ' + JSON.stringify(b4));
  // environment-wide throttling: −1
  const b5 = r.record({ now: 212000, workers: 3, completed: 10, wallMs: 60000, envRefusal: true, ...ok });
  if (b5.action !== 'decrease' || r.workers() !== 2) p.push('environment-wide throttling: ' + JSON.stringify(b5));
  // a batch at another worker count (admission lowered it) restarts the window
  const w = createRamp({ w0: 2, ceiling: 4, minWindowMs: 60000, spacingWindows: 1, startAt: 0 });
  w.record({ now: 31000, workers: 2, completed: 4, wallMs: 30000, ...ok });
  const lowered = w.record({ now: 62000, workers: 1, completed: 4, wallMs: 30000, ...ok });
  if (lowered.action !== 'hold' || !/30\/60 s/.test(lowered.reason)) p.push('another worker count restarts the window: ' + JSON.stringify(lowered));
  // a remembered validated count: the first trial goes straight to it (kept / reverted by the same rule)
  const m = createRamp({ w0: 2, ceiling: 8, minWindowMs: 60000, spacingWindows: 1, startAt: 0, target: 6 });
  const t = m.record({ now: 61000, workers: 2, completed: 4, wallMs: 60000, ...ok });
  if (t.action !== 'trial' || m.workers() !== 6 || !/remembered/.test(t.reason)) p.push('remembered target: ' + JSON.stringify(t));
  const back = m.record({ now: 122000, workers: 6, completed: 6, wallMs: 60000, cpuPct: 85, availableMb: 9000, needMb: 4000 });
  if (back.action !== 'revert' || m.workers() !== 2) p.push('an unhealthy trial reverts to W0: ' + JSON.stringify(back));
  if (typeof r.validated !== 'function' || r.validated() !== 3) p.push('validated() ' + (typeof r.validated === 'function' ? r.validated() : 'missing'));
});

const verdict = cases.every((c) => c.verdict === 'PASS') ? 'PASS' : 'FAIL';
print({ tool: 'selftest-dispatch', cases, verdict }, args);
process.exit(verdict === 'PASS' ? 0 : 1);
