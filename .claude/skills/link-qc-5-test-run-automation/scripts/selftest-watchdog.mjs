#!/usr/bin/env node
// selftest-watchdog.mjs — regression harness for watchdog.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// A failing self-test means the freeze verdicts cannot be trusted: the skill must then rely on
// the outer ceiling only and record every stop as `unresolved`, never as a watchdog decision.
//
// Run: node selftest-watchdog.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run } from './watchdog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f) => path.join(here, 'fixtures', 'watchdog', f);
const GROUP = fx('group.json');
const GRACE = '60000';

const cases = [];
const fail = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
const wd = (args) => run({ plan: GROUP, grace: GRACE, ...args });

/* 1 — a slow step INSIDE its own (long) deadline is not a freeze. */
{
  const r = wd({ heartbeat: fx('slow.heartbeat.jsonl'), now: '2026-09-20T10:01:30Z' });
  const p = [];
  if (r.verdict !== 'OK') p.push('verdict ' + r.verdict + ' != OK');
  if (!r.workers[0] || r.workers[0].state !== 'in-step') p.push('worker 0 state ' + (r.workers[0] && r.workers[0].state) + ' != in-step');
  if (r.workers[0] && r.workers[0].deadline_ms !== 120000) p.push('the step\'s own deadline (120 s) was not honoured');
  if (r.workers[0] && r.workers[0].remaining_before_freeze_ms <= 0) p.push('remaining_before_freeze_ms should still be positive');
  check('1 slow step inside its own deadline is not frozen', p, { worker: r.workers[0] });
}

/* 2 — an open step past deadline + grace with no progress, no newer record, no result → FROZEN. */
{
  const r = wd({ heartbeat: fx('frozen.heartbeat.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'FROZEN') p.push('verdict ' + r.verdict + ' != FROZEN');
  if (r.frozen.length !== 1 || r.frozen[0].worker !== 0) p.push('frozen worker not named');
  if (r.frozen[0] && r.frozen[0].step !== 'save the order') p.push('frozen step not named');
  if (r.frozen[0] && r.frozen[0].expected !== 'the success toast is visible') p.push('expected condition not carried');
  if (r.frozen[0] && Math.abs(r.frozen[0].elapsed_ms - 115000) > 1) p.push('elapsed_ms ' + r.frozen[0].elapsed_ms + ' != 115000');
  check('2 open step past deadline + grace with no progress is frozen', p, { frozen: r.frozen });
}

/* 3 — the step DEADLINE is fixed from its start: a progress record (even a meaningful one) never extends it. Start 10:00:05,
   deadline 30 s, progress "rows loaded 40/100" at 10:01:30, now 10:02:00: 115 s > 30 s + 60 s grace → FROZEN; the
   meaningful progress is still measured (30 s ago). */
{
  const r = wd({ heartbeat: fx('progress.heartbeat.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'FROZEN') p.push('verdict ' + r.verdict + ' != FROZEN — progress must never extend a step deadline');
  if (r.frozen[0] && (r.frozen[0].elapsed_ms !== 115000 || !/last meaningful progress 30 s ago/.test(r.frozen[0].reason))) p.push('frozen ' + JSON.stringify(r.frozen[0]));
  if (r.workers[0] && r.workers[0].progress_records !== 1) p.push('progress record not counted');
  if (r.workers[0] && r.workers[0].since_last_progress_ms !== 30000) p.push('since_last_progress_ms ' + r.workers[0].since_last_progress_ms + ' != 30000');
  check('3 a fixed deadline: progress never extends it', p, {});
}

/* 4 — Playwright already recorded the step's own timeout (end: timeout): not a hang. */
{
  const r = wd({ heartbeat: fx('ended.heartbeat.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'OK') p.push('verdict ' + r.verdict + ' != OK — a step that ended by timeout is a failing test, not a freeze');
  if (r.workers[0] && r.workers[0].state !== 'idle') p.push('worker 0 state ' + r.workers[0].state + ' != idle');
  check('4 a step ended by its own timeout is not frozen', p, {});
}

/* 5 — two workers: one frozen, one progressing → FROZEN; both in-flight TCs interrupted, the second as collateral. */
{
  const r = wd({ heartbeat: fx('two-workers.heartbeat.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'FROZEN') p.push('verdict ' + r.verdict + ' != FROZEN');
  if (r.frozen.length !== 1 || r.frozen[0].worker !== 0) p.push('exactly worker 0 must be frozen, got ' + JSON.stringify(r.frozen.map((f) => f.worker)));
  const w1 = r.workers.find((w) => w.worker === 1);
  if (!w1 || w1.state !== 'in-step') p.push('worker 1 should be in-step (10 s into a 30 s deadline)');
  const ints = r.reconstruction.interrupted;
  const t1 = ints.find((i) => i.tc === 'TC-001');
  const t2 = ints.find((i) => i.tc === 'TC-002');
  if (!t1 || t1.collateral !== false || !/watchdog at step "save the order"/.test(t1.reason)) p.push('TC-001 not reported as the interrupted frozen test');
  if (!t2 || t2.collateral !== true || !/collateral/.test(t2.reason)) p.push('TC-002 not reported as collateral');
  if (r.reconstruction.not_started.length !== 4) p.push('not_started ' + r.reconstruction.not_started.length + ' != 4');
  check('5 one frozen worker stops the command; the other worker\'s test is collateral', p, { interrupted: ints });
}

/* 6 — reconstruction on a 6-TC group from a run plan: completed keep real statuses; interrupted names step + elapsed; never-started listed. */
{
  const r = run({ plan: fx('run-plan.json'), group: 'parallel', grace: GRACE, heartbeat: fx('reconstruct.heartbeat.jsonl'), results: fx('reconstruct.results.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'FROZEN') p.push('verdict ' + r.verdict + ' != FROZEN');
  const c = r.reconstruction.completed.map((x) => x.tc + ':' + x.status).sort().join(' ');
  if (c !== 'TC-001:PASS TC-002:FAIL TC-003:SKIP') p.push('completed statuses wrong: ' + c);
  const i = r.reconstruction.interrupted;
  if (i.length !== 1 || i[0].tc !== 'TC-004') p.push('interrupted should be exactly TC-004, got ' + JSON.stringify(i.map((x) => x.tc)));
  if (i[0] && (i[0].step !== 'approve the request' || Math.abs(i[0].elapsed_ms - 104000) > 1 || i[0].status !== 'INCOMPLETE')) p.push('interrupted row lacks step / elapsed / INCOMPLETE: ' + JSON.stringify(i[0]));
  const n = r.reconstruction.not_started.map((x) => x.tc).join(' ');
  if (n !== 'TC-005 TC-006') p.push('not_started wrong: ' + n);
  if (r.reconstruction.not_started.some((x) => x.status !== 'NOT_RUN' || !/not started: watchdog stop/.test(x.reason))) p.push('not_started rows lack NOT_RUN + reason');
  if (r.counts.planned !== 6) p.push('planned count ' + r.counts.planned + ' != 6');
  check('6 completed / interrupted / not-started reconstructed from a run-plan group', p, { counts: r.counts });
}

/* 7 — between tests (no open step) the heartbeat never freezes, however long ago. */
{
  const r = wd({ heartbeat: fx('idle.heartbeat.jsonl'), now: '2026-09-20T10:30:00Z' });
  const p = [];
  if (r.verdict !== 'OK') p.push('verdict ' + r.verdict + ' != OK — an idle worker is the outer ceiling\'s business, never the heartbeat\'s');
  if (r.workers[0] && r.workers[0].state !== 'idle') p.push('state ' + r.workers[0].state + ' != idle');
  check('7 an idle worker is never frozen by the heartbeat', p, {});
}

/* 8 — FALSE FREEZE GUARD: a malformed line → BLOCKED with the line number, never a FROZEN verdict. */
{
  const r = wd({ heartbeat: fx('malformed.heartbeat.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'BLOCKED') p.push('verdict ' + r.verdict + ' != BLOCKED');
  if (!r.errors.length || r.errors[0].line !== 3) p.push('error line ' + (r.errors[0] && r.errors[0].line) + ' != 3');
  if (r.frozen && r.frozen.length) p.push('a freeze was derived despite an unreadable record');
  check('8 malformed heartbeat blocks the verdict instead of freezing', p, { errors: r.errors });
}

/* 9 — --write produces the watchdog file byte for byte (deterministic for a fixed --now). */
{
  const p = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-watchdog-'));
  try {
    const out = path.join(tmp, 'positive-parallel.watchdog.json');
    const r = run({ plan: fx('run-plan.json'), group: 'parallel', stage: 'positive', grace: GRACE, heartbeat: fx('reconstruct.heartbeat.jsonl'), results: fx('reconstruct.results.jsonl'), now: '2026-09-20T10:02:00Z', write: true, out });
    if (r.readOnly !== false || !r.writes.length) p.push('--write did not report a write');
    const got = fs.readFileSync(out, 'utf8');
    const golden = fs.readFileSync(fx(path.join('golden', 'watchdog.json')), 'utf8');
    if (got !== golden) p.push('written file differs from golden/watchdog.json — regenerate only for a deliberate change');
    const dry = run({ plan: fx('run-plan.json'), group: 'parallel', stage: 'positive', grace: GRACE, heartbeat: fx('reconstruct.heartbeat.jsonl'), results: fx('reconstruct.results.jsonl'), now: '2026-09-20T10:02:00Z' });
    if (dry.readOnly !== true || (dry.writes && dry.writes.length)) p.push('a dry run wrote something');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('9 --write matches the golden and a dry run writes nothing', p, {});
}

/* 10 — NOT_RUN without a heartbeat file, and --strict exit codes. */
{
  const p = [];
  const r = wd({ heartbeat: fx('does-not-exist.jsonl'), now: '2026-09-20T10:02:00Z' });
  if (r.verdict !== 'NOT_RUN') p.push('missing heartbeat → verdict ' + r.verdict + ' != NOT_RUN');
  const script = path.join(here, 'watchdog.mjs');
  const call = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const ok = call(['--plan', GROUP, '--heartbeat', fx('slow.heartbeat.jsonl'), '--now', '2026-09-20T10:01:30Z', '--grace', GRACE, '--strict']);
  if (ok.status !== 0) p.push('OK exit ' + ok.status + ' != 0');
  const frozen = call(['--plan', GROUP, '--heartbeat', fx('frozen.heartbeat.jsonl'), '--now', '2026-09-20T10:02:00Z', '--grace', GRACE, '--strict']);
  if (frozen.status !== 1) p.push('FROZEN exit ' + frozen.status + ' != 1');
  const blocked = call(['--plan', GROUP, '--heartbeat', fx('malformed.heartbeat.jsonl'), '--now', '2026-09-20T10:02:00Z', '--strict']);
  if (blocked.status !== 2) p.push('BLOCKED exit ' + blocked.status + ' != 2');
  const notRun = call(['--plan', GROUP, '--heartbeat', fx('nope.jsonl'), '--strict']);
  if (notRun.status !== 3) p.push('NOT_RUN exit ' + notRun.status + ' != 3');
  const plain = call(['--plan', GROUP, '--heartbeat', fx('frozen.heartbeat.jsonl'), '--now', '2026-09-20T10:02:00Z']);
  if (plain.status !== 0) p.push('default exit ' + plain.status + ' != 0');
  try { JSON.parse(plain.stdout); } catch { p.push('stdout is not a single JSON object'); }
  check('10 NOT_RUN without a heartbeat; strict exit codes OK 0 · FROZEN 1 · BLOCKED 2 · NOT_RUN 3', p, {});
}

/* 11 — a test covering several TCs ("TC-005,TC-006" in the heartbeat) that hangs: BOTH TCs are interrupted, never "not started". */
{
  const r = wd({ heartbeat: fx('multi-tc.heartbeat.jsonl'), results: fx('multi-tc.results.jsonl'), now: '2026-09-20T10:02:00Z' });
  const p = [];
  if (r.verdict !== 'FROZEN') p.push('verdict ' + r.verdict + ' != FROZEN');
  const ints = r.reconstruction ? r.reconstruction.interrupted : [];
  for (const tc of ['TC-005', 'TC-006']) {
    const row = ints.find((i) => i.tc === tc);
    if (!row) p.push(tc + ' missing from interrupted[]');
    else if (row.collateral !== false || !/watchdog at step "submit both requests"/.test(row.reason)) p.push(tc + ' not reported as the frozen test: ' + row.reason);
  }
  const ns = r.reconstruction ? r.reconstruction.not_started.map((x) => x.tc).join(' ') : '';
  if (ns !== 'TC-002 TC-003 TC-004') p.push('not_started wrong: ' + ns);
  const done = r.reconstruction ? r.reconstruction.completed.map((x) => x.tc + ':' + x.status).join(' ') : '';
  if (done !== 'TC-001:PASS') p.push('completed wrong: ' + done);
  check('11 a multi-TC test in flight is interrupted for every TC it covers', p, { interrupted: ints });
}

/* 12 — --stop-reason (the outer-ceiling kill, no frozen worker): reasons name the stop; without it the old wording stays. */
{
  const p = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-watchdog-'));
  try {
    const base = { heartbeat: fx('ceiling.heartbeat.jsonl'), now: '2026-09-20T10:10:00Z' };
    const legacy = wd(base);
    if (legacy.verdict !== 'OK') p.push('verdict ' + legacy.verdict + ' != OK (no step is open)');
    const li = legacy.reconstruction.interrupted.find((i) => i.tc === 'TC-001');
    if (!li || !/^interrupted: collateral \(watchdog stop of worker \)$/.test(li.reason)) p.push('without --stop-reason the legacy wording must stay: ' + (li && li.reason));
    if (legacy.reconstruction.not_started.some((x) => x.reason !== 'not started: watchdog stop')) p.push('without --stop-reason not_started must read "not started: watchdog stop"');
    const out = path.join(tmp, 'smoke-parallel.watchdog.json');
    const r = wd({ ...base, stopReason: 'outer ceiling stop after 420 s', write: true, out });
    const ri = r.reconstruction.interrupted.find((i) => i.tc === 'TC-001');
    if (!ri || ri.reason !== 'interrupted: outer ceiling stop after 420 s') p.push('ceiling reason not applied: ' + (ri && ri.reason));
    if (r.reconstruction.not_started.length !== 5 || r.reconstruction.not_started.some((x) => x.reason !== 'not started: outer ceiling stop after 420 s')) p.push('not_started rows must carry the stop reason');
    const file = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (file.stop_reason !== 'outer ceiling stop after 420 s' || file.source !== 'incremental+watchdog') p.push('written file lacks stop_reason / source');
    const cli = spawnSync(process.execPath, [path.join(here, 'watchdog.mjs'), '--plan', GROUP, '--heartbeat', fx('ceiling.heartbeat.jsonl'), '--now', '2026-09-20T10:10:00Z', '--stop-reason', 'outer ceiling stop after 420 s'], { encoding: 'utf8' });
    const c = JSON.parse(cli.stdout);
    if (!c.reconstruction || c.reconstruction.interrupted[0].reason !== 'interrupted: outer ceiling stop after 420 s') p.push('--stop-reason not honoured on the CLI');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('12 --stop-reason names a non-freeze stop; default wording unchanged', p, {});
}

// cases 13-15 write their heartbeat to a throw-away file; T0 = 10:00:00Z, records at T0 + seconds
const T0 = Date.parse('2026-09-20T10:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
function hbFile(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-watchdog-'));
  const f = path.join(dir, 'hb.jsonl');
  fs.writeFileSync(f, records.map((r) => JSON.stringify({ worker: 0, tc: 'TC-001', ...r, at: at(r.at) })).join('\n') + '\n');
  return f;
}

/* 13 — MEANINGFUL progress only: a long step (deadline 600 s) whose notes keep CHANGING ("polling", a timestamp) but whose
   counter stopped at 5/10 is silent since its last rise (20 s): at 136 s, 116 s > silence 55 s + grace 60 s → FROZEN by the
   silence rule (active, the default); --silence-mode shadow only reports it; a counter that rose (6/10 at 70 s) keeps it alive. */
{
  const p = [];
  const base = [{ at: 0, event: 'test-start' }, { at: 1, step: 'export the report', event: 'start', deadline_ms: 600000 }, { at: 20, step: 'export the report', event: 'progress', note: 'rows 5/10' },
    { at: 40, step: 'export the report', event: 'progress', note: 'polling' }, { at: 60, step: 'export the report', event: 'progress', note: 'polling at 10:01:00' },
    { at: 70, step: 'export the report', event: 'progress', note: 'rows 5/10' }, { at: 80, step: 'export the report', event: 'progress', note: 'still waiting', meaningful: false }];
  const stuck = hbFile(base);
  const a = wd({ heartbeat: stuck, now: at(136), silence: '55000' });
  if (a.verdict !== 'FROZEN' || !a.frozen[0] || a.frozen[0].rule !== 'silence' || a.frozen[0].since_last_progress_ms !== 116000) p.push('active: ' + JSON.stringify(a.frozen));
  const s = wd({ heartbeat: stuck, now: at(136), silence: '55000', silenceMode: 'shadow' });
  if (s.verdict !== 'OK' || !(s.would_freeze || []).length) p.push('shadow: ' + JSON.stringify([s.verdict, s.would_freeze]));
  const moving = hbFile([...base, { at: 85, step: 'export the report', event: 'progress', note: 'rows 6/10' }]);
  const m = wd({ heartbeat: moving, now: at(136), silence: '55000' });
  if (m.verdict !== 'OK' || (m.workers[0] && m.workers[0].since_last_progress_ms !== 51000)) p.push('a rising counter: ' + JSON.stringify([m.verdict, m.workers[0]]));
  const flagged = hbFile([...base, { at: 85, step: 'export the report', event: 'progress', note: 'upload', meaningful: true }]);
  if (wd({ heartbeat: flagged, now: at(136), silence: '55000' }).verdict !== 'OK') p.push('a helper-marked meaningful record must count');
  check('13 meaningful progress only: changed text / timestamps / polling never reset the silence clock; a rising counter does', p, {});
}

/* 14 — NESTED steps: the parent stays watched after its child ends (stack); its fixed deadline still applies. Parent 30 s from
   1 s, child 2-5 s; at 95 s the parent is 94 s old > 30 s + 60 s → FROZEN on the parent. */
{
  const p = [];
  const f = hbFile([{ at: 0, event: 'test-start' }, { at: 1, step: 'place the order', event: 'start', deadline_ms: 30000 }, { at: 2, step: 'fill the form', event: 'start', deadline_ms: 10000 },
    { at: 5, step: 'fill the form', event: 'end', outcome: 'ok' }]);
  const r = wd({ heartbeat: f, now: at(95) });
  if (r.verdict !== 'FROZEN' || !r.frozen[0] || r.frozen[0].step !== 'place the order') p.push('nested: ' + JSON.stringify(r.frozen));
  const ok = wd({ heartbeat: f, now: at(60) });
  if (ok.verdict !== 'OK' || !ok.workers[0] || ok.workers[0].step !== 'place the order') p.push('parent watched inside its deadline: ' + JSON.stringify(ok.workers[0]));
  check('14 a nested step never hides its parent; the parent\'s fixed deadline applies', p, {});
}

/* 15 — BOUNDED waits: an open admission-wait / rate-wait is never a UI stall (no silence verdict) but is FROZEN past its own
   budget + grace; inside a step the step's fixed deadline still applies. */
{
  const p = [];
  const adm = hbFile([{ at: 0, event: 'test-start' }, { at: 1, event: 'admission-wait', phase: 'start', reason: 'host pressure', budget_ms: 1000 }]);
  const inBudget = wd({ heartbeat: adm, now: at(30), silence: '1000' });
  if (inBudget.verdict !== 'OK' || !inBudget.workers[0] || inBudget.workers[0].state !== 'admission-wait') p.push('inside its budget: ' + JSON.stringify(inBudget.workers[0]));
  const past = wd({ heartbeat: adm, now: at(63) });
  if (past.verdict !== 'FROZEN' || !past.frozen[0] || past.frozen[0].rule !== 'wait-budget') p.push('past its budget: ' + JSON.stringify(past.frozen));
  const rate = hbFile([{ at: 0, event: 'test-start' }, { at: 1, step: 'sign in', event: 'start', deadline_ms: 600000 }, { at: 2, step: 'sign in', event: 'rate-wait', phase: 'start', reason: 'rate limit: login', budget_ms: 120000 }]);
  const waiting = wd({ heartbeat: rate, now: at(150), silence: '55000' });
  if (waiting.verdict !== 'OK') p.push('a server-directed wait inside its budget is no stall: ' + JSON.stringify(waiting.frozen));
  const over = wd({ heartbeat: rate, now: at(185), silence: '55000' });
  if (over.verdict !== 'FROZEN' || !over.frozen[0] || over.frozen[0].rule !== 'wait-budget') p.push('a rate wait past its budget: ' + JSON.stringify(over.frozen));
  check('15 bounded waits: never a UI stall, FROZEN only past their own budget + grace', p, {});
}

const out = {
  tool: 'selftest-watchdog',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'watchdog.mjs disagrees with its own fixtures. Do not stop a run on its verdicts; rely on the outer ceiling and record stops as unresolved.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
