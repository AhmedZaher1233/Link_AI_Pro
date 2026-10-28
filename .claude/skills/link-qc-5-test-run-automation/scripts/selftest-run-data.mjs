#!/usr/bin/env node
// selftest-run-data.mjs — regression harness for run-data.mjs (merge, report fragments, readiness, handoff, the
// runtime-evidence checks, run-level acceptance, draft-init and publish).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. Every case works on a temporary copy of
// scripts/fixtures/run-data/automation/ (the story US-9001-sample, phase 1 — see the fixture README for what happened in
// it); the screenshot stubs are written into the copy. Every expected value below was computed by hand from the fixture.
// Run: node selftest-run-data.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  locate, loadSummaries, phaseCommands, buildExecutions, mergePhase, applyMerge, reportFragments, ledgerSections, readinessTable, handoff, verifyRuntime,
  recordChecks, computeAcceptance, gateRecords, initDrafts, publishPhase, runData, hhmmss, variationSlug, planAt, stageText,
  pairSpan, canonicalPath, resolveReqId, applyJudgements, deliveryOf, imageOwed,
} from './run-data.mjs';
import { render, pageState } from './render-run-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'run-data');
const SCRIPT = path.join(here, 'run-data.mjs');
const STORY_REL = path.join('reports', 'US-9001-sample');
const SHOTS = [
  'TC-001/chromium--none--r0/attempt-1.png',
  'TC-002/chromium--none--r0/attempt-1.png', 'TC-002/chromium--none--r0/attempt-1-failed.png', 'TC-002/chromium--none--r0/attempt-2.png',
  'TC-003/chromium--none--r0/attempt-1.png', 'TC-003/chromium--none--r0/attempt-1-failed.png', 'TC-003/chromium--none--r0/attempt-2.png',
  'TC-003/chromium--none--r1/attempt-1.png', 'TC-003/chromium--none--r2/attempt-1.png',
  'TC-005/chromium--variation-a--r0/attempt-1.png', 'TC-005/chromium--variation-a--r0/attempt-2.png',
].map((p) => 'screenshots/US-9001-sample/phase-1/' + p);
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const shaText = (s) => crypto.createHash('sha256').update(s.replace(/\r\n?/g, '\n'), 'utf8').digest('hex');

const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
const eq = (p, what, got, want) => { const a = JSON.stringify(got); const b = JSON.stringify(want); if (a !== b) p.push(what + ': got ' + a + ', want ' + b); };

/** A temporary copy of the fixture automation root with the screenshot stubs written. */
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-data-'));
  fs.cpSync(path.join(FX, 'automation'), dir, { recursive: true });
  for (const s of SHOTS) { const f = path.join(dir, s); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'PNG stub — not application evidence\n'); }
  const story = path.join(dir, STORY_REL);
  const drafts = path.join(story, 'artifacts', 'drafts', 'phase-1');
  const t = {
    dir, story, drafts, runFile: path.join(drafts, '.runs', 'phase-1.json'), pubRunFile: path.join(story, '.runs', 'phase-1.json'),
    summary: (n) => path.join(story, 'artifacts', 'progress', n), hb: (n) => path.join(story, 'artifacts', 'progress', n),
    json: (p) => JSON.parse(fs.readFileSync(p, 'utf8')), put: (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  t.edit = (p, fn) => t.put(p, fn(t.json(p)));
  return t;
}
function load(runFile) {
  const loc = locate({ runFile });
  const ctx = { ...loc, summaries: loadSummaries(loc.resultsRoot) };
  ctx.cmds = phaseCommands(ctx);
  ctx.execs = buildExecutions(ctx);
  const m = mergePhase(ctx);
  return { loc, ctx, m, mctx: { ...ctx, run: applyMerge(loc.run, m) } };
}
const mergeWrite = (t) => runData({ _: ['merge'], 'run-file': t.runFile, write: true });
const draftPage = (t) => { const r = render({ reportPath: path.join(t.drafts, 'TEST-RUN-REPORT-sample.md'), base: t.story, root: t.story }); fs.writeFileSync(path.join(t.drafts, 'TEST-RUN-REPORT-sample.html'), r.html || ''); return r; };
const gate = (checkpoint, verdict, extra = {}) => ({ schema: 'skill5-gate/1', checkpoint, phase: 1, verdict, snapshotId: 'snap-' + checkpoint.toLowerCase(), snapshotFile: 'artifacts/checks/snap-' + checkpoint.toLowerCase() + '/snapshot.json', decidedAt: '2026-10-01T09:30:00Z', rehash: { matched: true, differences: [] }, results: [], rejected: [], na: [], ...extra });
const writeGate = (t, k, o) => t.put(path.join(t.story, '.runs', 'phase-1.checkpoint-' + k + '.json'), o);
const frozenOf = (t) => ({ drafts: { 'TEST-RUN-REPORT-sample.md': sha(path.join(t.drafts, 'TEST-RUN-REPORT-sample.md')), 'BUG-REPORT-sample.md': sha(path.join(t.drafts, 'BUG-REPORT-sample.md')), '.runs/phase-1.json': sha(t.runFile) } });

/* 1 — merge: statuses of record, attempts, evidence, variants, counts — and a dry run writes nothing. */
{
  const t = tmp();
  try {
    const before = sha(t.runFile);
    const { loc, ctx, m } = load(t.runFile);
    const p = [];
    eq(p, 'located results root', path.relative(t.dir, loc.resultsRoot), STORY_REL);
    eq(p, 'automation root', loc.automationRoot, t.dir);
    eq(p, 'rrRel', loc.rrRel, 'reports/US-9001-sample');
    eq(p, 'summaries', ctx.summaries.map((s) => s._file), ['first-smoke-1.summary.json', 'first-positive-1.summary.json', 'first-negative-1.summary.json', 'rerun-positive-1.summary.json']);
    eq(p, 'commands', ctx.cmds.length, 7);
    eq(p, 'executions', m.merged.executions.length, 10);
    const st = Object.fromEntries(m.results.map((r) => [r.tc_id, r.status]));
    eq(p, 'statuses', st, { 'TC-001': 'PASS', 'TC-002': 'PASS', 'TC-003': 'PASS', 'TC-004': 'SKIP', 'TC-005': 'INCOMPLETE' });
    eq(p, 'totals', m.totals, { total: 5, passed: 3, failed: 0, incomplete: 1, skipped: 1, not_run: 0 });
    eq(p, 'stages', m.stages, { smoke: { total: 1, passed: 1, failed: 0, incomplete: 0, skipped: 0, not_run: 0 }, positive: { total: 3, passed: 2, failed: 0, incomplete: 1, skipped: 0, not_run: 0 }, negative: { total: 1, passed: 0, failed: 0, incomplete: 0, skipped: 1, not_run: 0 } });
    eq(p, 'variant_totals', m.variant_totals, { passed: 4, failed: 0, skipped: 1, not_run: 1 });
    const r = (tc) => m.results.find((x) => x.tc_id === tc);
    const S = 'screenshots/US-9001-sample/phase-1/';
    eq(p, 'TC-001 evidence', r('TC-001').evidence_screenshot, S + 'TC-001/chromium--none--r0/attempt-1.png');
    eq(p, 'TC-001 name / req (derived)', [r('TC-001').test_name, r('TC-001').req_id], ['Create an order with valid data', 'REQ-01']);
    const a2 = r('TC-002').variants[0].attempts;
    eq(p, 'TC-002 attempts', a2.map((a) => [a.attempt, a.stage, a.command, a.status, a.evidence_screenshot, a.failure_screenshot, a.code_fingerprint]), [
      [1, 'positive', 'normal', 'FAIL', S + 'TC-002/chromium--none--r0/attempt-1.png', S + 'TC-002/chromium--none--r0/attempt-1-failed.png', 'fp-tc002-a'],
      [2, 'positive · isolation', 'isolation', 'PASS', S + 'TC-002/chromium--none--r0/attempt-2.png', null, 'fp-tc002-a']]);
    eq(p, 'TC-002 record', [r('TC-002').evidence_screenshot, r('TC-002').failure_screenshot, r('TC-002').duration_ms, r('TC-002').run_group, r('TC-002').run_mode, r('TC-002').rerun], [S + 'TC-002/chromium--none--r0/attempt-2.png', null, 20000, 'serial:interference', 'serial', null]);
    const a3 = r('TC-003').variants[0].attempts;
    eq(p, 'TC-003 burn-in folds into the required variant', [r('TC-003').variants.length, r('TC-003').variants[0].variant_slug], [1, 'chromium--none--r0']);
    eq(p, 'TC-003 attempts', a3.map((a) => [a.attempt, a.stage, a.status, a.evidence_screenshot]), [
      [1, 'positive', 'FAIL', S + 'TC-003/chromium--none--r0/attempt-1.png'], [2, 'positive · burn-in', 'PASS', S + 'TC-003/chromium--none--r0/attempt-2.png'],
      [3, 'positive · burn-in', 'PASS', S + 'TC-003/chromium--none--r1/attempt-1.png'], [4, 'positive · burn-in', 'PASS', S + 'TC-003/chromium--none--r2/attempt-1.png']]);
    eq(p, 'TC-003 record', [r('TC-003').evidence_screenshot, r('TC-003').duration_ms, r('TC-003').rerun, r('TC-003').healed_in_first_run, r('TC-003').root_cause, r('TC-003').classification], [S + 'TC-003/chromium--none--r2/attempt-1.png', 12000, { reason: 'impacted', changed: ['pages/OrderPage.ts'] }, true, 'the save button moved into the toolbar', 'N/A']);
    eq(p, 'TC-004 skip', [r('TC-004').variants.length, r('TC-004').attempts, r('TC-004').classification, r('TC-004').missing_variants, r('TC-004').evidence_screenshot], [0, 0, 'data_missing', [], null]);
    eq(p, 'TC-004 merged.tcs', m.merged.tcs.find((x) => x.tc_id === 'TC-004').skipped_variants, ['chromium--none--r0']);
    eq(p, 'TC-005 incomplete', [r('TC-005').classification, r('TC-005').status_reason, r('TC-005').missing_variants, r('TC-005').test_name, r('TC-005').req_id, r('TC-005').evidence_screenshot], ['incomplete: chromium--variation-b--r0', 'incomplete: chromium--variation-b--r0', ['chromium--variation-b--r0'], 'Order total recalculates', 'REQ-02', S + 'TC-005/chromium--variation-a--r0/attempt-2.png']);
    eq(p, 'TC-005 attempts', r('TC-005').variants[0].attempts.map((a) => a.stage), ['positive', 'positive · isolation']);
    eq(p, 'merged.stages', [m.merged.stages.length, m.merged.stages[0].json_path, m.merged.stages[0].run, m.merged.stages[6].command], [7, 'reports/US-9001-sample/artifacts/stages/smoke-parallel.json', 'first', 'burn-in']);
    const pc = m.parallel_checks;
    eq(p, 'parallel_checks', pc.map((x) => [x.tc, x.outcome, x.workers, x.parallel_attempt, x.alone_attempt, x.moved_to, x.cause, x.resolution, x.learning_line, x.overlap_rerun]), [['TC-002', 'interference', 2, 1, 2, 'serial:interference', 'unexplained', null, 'the orders list keeps the status filter of the session', [{ tc: 'TC-005', status: 'PASS' }]]]);
    eq(p, 'smoke_gate', m.smoke_gate, { fail_pct: 0, eligible: 1, verdict: 'passed', cycles: 0, excluded_unverified_assumption: 0, action_taken: null });
    eq(p, 'concurrency', [m.concurrency.max_concurrent_workers, m.concurrency.average_workers, m.concurrency.peak_cpu_pct, m.concurrency.min_available_mb, m.concurrency.actual_s, m.concurrency.planned_s, m.concurrency.scheduler, m.concurrency.isolation_outcomes], [2, 1.4, 74, 6900, 397, 200, 'groups', 1]);
    eq(p, 'timeouts.events kept (model-recorded step timeout)', m.timeouts.events.map((e) => [e.tc, e.kind, e.classification]), [['TC-003', 'step', 'selector_failure']]);
    eq(p, 'warnings', m.warnings, []);
    if (sha(t.runFile) !== before) p.push('a dry merge changed the run file');
    check('1 merge: statuses, attempts, evidence, variants, counts; dry run writes nothing', p, { totals: m.totals });
  } finally { t.cleanup(); }
}

/* 2 — merge --write keeps every model-owned field and is idempotent. */
{
  const t = tmp();
  try {
    const p = [];
    const before = t.json(t.runFile);
    const w = mergeWrite(t);
    eq(p, 'outcome / writes', [w.outcome, w.writes.length], ['OK', 1]);
    const after = t.json(t.runFile);
    for (const k of ['heal_log', 'deviations', 'data_readiness', 'coverage_snapshot', 'impact', 'run_plan', 'run_plan_adjustments', 'skips', 'bugs', 'compliance', 'status']) eq(p, 'kept ' + k, after[k], before[k]);
    eq(p, 'kept timeouts.initial', after.timeouts.initial, before.timeouts.initial);
    const once = fs.readFileSync(t.runFile, 'utf8');
    mergeWrite(t);
    if (fs.readFileSync(t.runFile, 'utf8') !== once) p.push('a second merge changed the run file (not idempotent)');
    // a model edit survives the next merge: classification, root cause, a resolution
    t.edit(t.runFile, (o) => { o.results.find((x) => x.tc_id === 'TC-002').root_cause = 'shared session filter'; o.parallel_checks[0].resolution = 'test-side: the status filter is session state (learned conflict)'; return o; });
    mergeWrite(t);
    const again = t.json(t.runFile);
    eq(p, 'root_cause kept', again.results.find((x) => x.tc_id === 'TC-002').root_cause, 'shared session filter');
    eq(p, 'resolution kept', again.parallel_checks[0].resolution, 'test-side: the status filter is session state (learned conflict)');
    check('2 merge --write keeps model-owned fields and is idempotent', p, {});
  } finally { t.cleanup(); }
}

/* 3 — report fragments: the exact markdown, and the hand-written draft report renders PASS against the merged run file. */
{
  const t = tmp();
  try {
    const p = [];
    mergeWrite(t);
    const { mctx, m } = load(t.runFile);
    const acc = computeAcceptance(mctx, m, gateRecords(mctx.resultsRoot, 1));
    const f = reportFragments(mctx, m, { acceptance: acc, gates: gateRecords(mctx.resultsRoot, 1) });
    eq(p, 'outcome', f.outcome, 'INCOMPLETE');
    eq(p, 'history row', f.historyRow, '| 1 | 2026-10-01 | INCOMPLETE | 3 | 0 | 1 | 1 | 0 | 5 | 00:22:00 | — |');
    eq(p, 'history header', f.historyHeader, '| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run | Total | Duration | Bugs |');
    eq(p, 'phase heading', f.phaseHeading, '## Phase 1 — 2026-10-01');
    eq(p, 'stages table', f.stagesTable, ['| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run |', '|---|---|---|---|---|---|---|', '| Smoke | 1 | 1 | 0 | 0 | 0 | 0 |', '| Positive | 3 | 2 | 0 | 1 | 0 | 0 |', '| Negative | 1 | 0 | 0 | 0 | 1 | 0 |', '| Positive (re-run) | 1 | 1 | 0 | 0 | 0 | 0 |', '| **Total** | 5 | 3 | 0 | 1 | 1 | 0 |'].join('\n'));
    eq(p, 'smoke-gate line', f.smokeGateLine, '**Smoke gate:** passed — fail% 0% — no action needed');
    const draft = fs.readFileSync(path.join(t.drafts, 'TEST-RUN-REPORT-sample.md'), 'utf8').replace(/\r\n?/g, '\n');
    for (const line of f.resultsTable.split('\n')) if (!draft.includes(line + '\n')) p.push('results line not in the draft report: ' + line);
    for (const line of f.stagesTable.split('\n')) if (!draft.includes(line + '\n')) p.push('stages line not in the draft report: ' + line);
    for (const want of ['**Status:** INCOMPLETE', '**Latest results:** 3 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run of 5 TCs']) if (!f.header.includes(want)) p.push('header lacks ' + want);
    for (const want of ['- **Re-run:** 1 TC (1 impacted · 0 no verdict · 0 added), 1 burn-in, 1 heal iteration(s)', '- **Isolation checks:** 1 failed beside others → 1 passed alone (interference) · 0 confirmed · 0 rate_limited', '- **Rate limits:** none seen', '- **Duration:** 00:22:00 (planned ~00:03:20 · serial-only ~00:05:00)', '- **Timeouts:** test 90 s · step 30 s · action 15 s · navigation 30 s · expect 10 s — 0 calibrated · 0 watchdog events', '- **Progress log:** ../../automation-logs/US-9001-sample/run-progress-2026-10-01-0900.log', '- **Screenshots:** ../../screenshots/US-9001-sample/phase-1/']) if (!f.runBullets.includes(want)) p.push('run bullets lack ' + want);
    if (!f.runBullets.some((b) => b.startsWith('- **Acceptance:** NOT ACCEPTED — Checkpoint A gate record missing; unexplained first-attempt regression: TC-002'))) p.push('acceptance bullet: ' + f.runBullets.find((b) => /Acceptance/.test(b)));
    const r = render({ reportPath: path.join(t.drafts, 'TEST-RUN-REPORT-sample.md'), base: t.story, root: t.story });
    if (r.payload.gate !== 'PASS') p.push('draft report + merged run file: renderer gate ' + r.payload.gate + ' — ' + r.payload.gateReason + ' ' + JSON.stringify(r.payload.mismatches) + JSON.stringify(r.payload.errors));
    if (r.payload.warnings.some((w) => w.kind === 'evidence-file-missing')) p.push('evidence links do not resolve with --base');
    check('3 report fragments: exact markdown, consistent with a draft report the renderer accepts', p, { outcome: f.outcome });
  } finally { t.cleanup(); }
}

/* 4 — readiness block and handoff view. */
{
  const t = tmp();
  try {
    const p = [];
    const { mctx, m } = load(t.runFile);
    eq(p, 'readiness', readinessTable(mctx.run).markdown, ['**Verdict:** READY-WITH-SKIPS', '', '| Gap | TCs | Decision | Source | Provisioning | Identifiers / names | Effective stamped values | Verified on | Cleanup |', '|---|---|---|---|---|---|---|---|---|', '| customer without orders | TC-004 | skip — QC declined | qc | — | — | — | — | — |'].join('\n'));
    eq(p, 'readiness — all ready', readinessTable({ data_readiness: { verdict: 'READY', gaps: [] } }).markdown, 'all ready');
    const h = handoff(mctx, m, gateRecords(mctx.resultsRoot, 1));
    eq(p, 'handoff', [h.schema, h.phase, h.tc_scope.total, h.failures.map((x) => x.tc + ' ' + x.status), h.findings.map((x) => x.tc + ' ' + x.cause), h.compliance.A, h.compliance.freshness], ['skill5-handoff/1', 1, 5, ['TC-005 INCOMPLETE'], ['TC-002 unexplained'], null, { stale: [] }]);
    if (!h.next_actions.some((x) => /TC-002/.test(x)) || !h.next_actions.includes('Checkpoint B pending')) p.push('next actions ' + JSON.stringify(h.next_actions));
    check('4 readiness block and handoff view', p, {});
  } finally { t.cleanup(); }
}

/* 5 — verify: every runtime check PASS on the fixture (after merge + draft page), records written once per snapshot. */
{
  const t = tmp();
  try {
    const p = [];
    mergeWrite(t); draftPage(t);
    const { mctx, m } = load(t.runFile);
    const v = verifyRuntime(mctx, m, { learning: path.join(FX, 'learning.md') });
    eq(p, 'gate', v.gate, 'PASS');
    eq(p, 'check ids (natural order — integer-like object keys always enumerate first)', Object.keys(v.checks).sort((x, y) => x.localeCompare(y, 'en', { numeric: true })), ['16b', '18', '22', '23', '25b', '31', '32', '33', '34', '37', '38', '43', '45', '46b', '48a', '48b', '50', '53', '54']);
    for (const [id, c] of Object.entries(v.checks)) if (c.status !== 'PASS') p.push(id + ' ' + c.status + ': ' + c.evidence + ' ' + JSON.stringify(c.details));
    eq(p, '16b evidence', v.checks['16b'].evidence, '7 passing tests: evidence recorded before teardown');
    eq(p, '18 evidence', v.checks['18'].evidence, '9 attempt images on disk; draft report, bug file, run file and page present');
    eq(p, '46b evidence', v.checks['46b'].evidence, '9 executed tests, each with its console report');
    eq(p, '48a zero stops — PASS with evidence, never N/A', v.checks['48a'].evidence, '0 stops in 7 command(s)');
    eq(p, '48b', v.checks['48b'].evidence, '1 watchdog / stall / admission / timeout event(s), each classified');
    eq(p, '38 scanned', v.checks['38'].evidence, '5 file(s) scanned, no credential-shaped value');
    eq(p, 'freshness', v.freshness.status, 'PASS');
    const rec = recordChecks(mctx.resultsRoot, 'snap-b', v.checks);
    eq(p, 'records written', rec.written.length, 19);
    const lines = fs.readFileSync(rec.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    if (!lines.every((x) => x.executor === 'S' && x.unit === 'phase' && x.snapshotId === 'snap-b' && x.status === 'verified-mechanical')) p.push('record shape ' + JSON.stringify(lines[0]));
    const again = recordChecks(mctx.resultsRoot, 'snap-b', v.checks);
    eq(p, 'second record: nothing written twice', [again.written.length, again.skipped.length], [0, 19]);
    check('5 verify: all runtime checks PASS, zero events PASS with evidence, one record per check and snapshot', p, { gate: v.gate });
  } finally { t.cleanup(); }
}

/* 6 — verify: each runtime check fails (or stays unresolved) on the evidence that breaks it. */
{
  const p = [];
  const run = (mutate) => { const t = tmp(); try { mergeWrite(t); draftPage(t); mutate(t); const { mctx, m } = load(t.runFile); return verifyRuntime(mctx, m, {}); } finally { t.cleanup(); } };
  const swapLines = (file, fn) => { const lines = fs.readFileSync(file, 'utf8').split('\n'); fs.writeFileSync(file, fn(lines).join('\n')); };
  // 16b — TC-001's evidence after its teardown
  const v1 = run((t) => swapLines(t.hb('smoke-parallel.jsonl'), (l) => l.map((x) => x.replace('"at":"2026-10-01T09:00:19.000Z","worker":0,"tc":"TC-001","event":"evidence"', '"at":"2026-10-01T09:00:20.700Z","worker":0,"tc":"TC-001","event":"evidence"'))));
  if (v1.checks['16b'].status !== 'FAIL' || !/TC-001/.test(v1.checks['16b'].details.join(' '))) p.push('16b evidence-after-teardown: ' + JSON.stringify(v1.checks['16b']));
  if (v1.gate !== 'FAIL') p.push('16b failure must fail the gate: ' + v1.gate);
  // 46b — one console report missing → FAIL; none at all → unresolved (old guard)
  const v2 = run((t) => swapLines(t.hb('positive-parallel-attempt2.jsonl'), (l) => l.filter((x) => !/console-report/.test(x))));
  if (v2.checks['46b'].status !== 'FAIL') p.push('46b one missing: ' + JSON.stringify(v2.checks['46b']));
  const v3 = run((t) => { for (const f of fs.readdirSync(path.join(t.story, 'artifacts', 'progress')).filter((x) => x.endsWith('.jsonl'))) swapLines(t.hb(f), (l) => l.filter((x) => !/console-report/.test(x))); });
  if (v3.checks['46b'].status !== 'unresolved' || v3.gate !== 'BLOCKED') p.push('46b none at all → unresolved / BLOCKED: ' + v3.checks['46b'].status + ' ' + v3.gate);
  // 18 — an image deleted
  const v4 = run((t) => fs.rmSync(path.join(t.dir, SHOTS[3])));
  if (v4.checks['18'].status !== 'FAIL' || !/TC-002/.test(v4.checks['18'].details.join(' '))) p.push('18 missing image: ' + JSON.stringify(v4.checks['18']));
  // 48b — an unclassified event FAILs; zero events PASS with evidence
  const v5 = run((t) => t.edit(t.runFile, (o) => { o.timeouts.events[0].classification = null; return o; }));
  if (v5.checks['48b'].status !== 'FAIL') p.push('48b unclassified: ' + JSON.stringify(v5.checks['48b']));
  const v6 = run((t) => t.edit(t.runFile, (o) => { o.timeouts.events = []; return o; }));
  if (v6.checks['48b'].status !== 'PASS' || v6.checks['48b'].evidence !== '0 watchdog, stall, admission-wait or timeout events in this phase') p.push('48b zero events: ' + JSON.stringify(v6.checks['48b']));
  // 38 — a credential in the progress log: FAIL with file:line, the value never printed
  const v7 = run((t) => fs.appendFileSync(path.join(t.dir, 'automation-logs', 'US-9001-sample', 'run-progress-2026-10-01-0900.log'), 'login password: Hunter22secret\n'));
  if (v7.checks['38'].status !== 'FAIL' || JSON.stringify(v7.checks['38']).includes('Hunter22secret') || !/run-progress-2026-10-01-0900\.log:\d+/.test(v7.checks['38'].details.join(' '))) p.push('38 secret: ' + JSON.stringify(v7.checks['38']));
  // 50 — a scratch probe left behind
  const v8 = run((t) => { const d = path.join(t.dir, 'test-results', 'qa-scratch'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'probe.spec.ts'), '// probe\n'); });
  if (v8.checks['50'].status !== 'FAIL') p.push('50 scratch: ' + JSON.stringify(v8.checks['50']));
  // 25b — the isolation move missing
  const v9 = run((t) => t.edit(t.runFile, (o) => { o.run_plan_adjustments = []; return o; }));
  if (v9.checks['25b'].status !== 'FAIL' || !/TC-002/.test(v9.checks['25b'].details.join(' '))) p.push('25b move missing: ' + JSON.stringify(v9.checks['25b']));
  // 25b — a serial group run with 2 workers
  const v10 = run((t) => t.edit(t.summary('first-positive-1.summary.json'), (o) => { o.groups[1].workers = 2; return o; }));
  if (v10.checks['25b'].status !== 'FAIL' || !/serial:orders/.test(v10.checks['25b'].details.join(' '))) p.push('25b serial workers: ' + JSON.stringify(v10.checks['25b']));
  // freshness — a stale TC
  const v11 = run((t) => t.edit(t.runFile, (o) => { o.impact.final_check.stale = [{ tc: 'TC-003', changed: ['pages/OrderPage.ts'] }]; return o; }));
  if (v11.freshness.status !== 'FAIL' || v11.gate !== 'FAIL') p.push('freshness stale: ' + JSON.stringify(v11.freshness));
  // 43 — a calibration record without evidence
  const v12 = run((t) => t.edit(t.runFile, (o) => { o.timeouts.adjusted = [{ key: 'step.long', from_ms: 120000, to_ms: 180000, reason: 'export renders server-side', evidence: '' }]; return o; }));
  if (v12.checks['43'].status !== 'FAIL') p.push('43 incomplete calibration: ' + JSON.stringify(v12.checks['43']));
  // 23 — a predicted skip reported PASS
  const v13 = run((t) => t.edit(t.runFile, (o) => { o.data_readiness.predicted_skips = ['TC-001']; return o; }));
  if (v13.checks['23'].status !== 'FAIL' || !/TC-001/.test(v13.checks['23'].details.join(' '))) p.push('23 skip reported PASS: ' + JSON.stringify(v13.checks['23']));
  check('6 verify: each runtime check fails on the evidence that breaks it; no console report at all stays unresolved', p, {});
}

/* 7 — acceptance (Revision 3.1 §3.8): pre-gate and final, every NOT ACCEPTED reason. */
{
  const p = [];
  const acc = (prep) => { const t = tmp(); try { prep(t); const { mctx, m } = load(t.runFile); return computeAcceptance(mctx, m, gateRecords(mctx.resultsRoot, 1)); } finally { t.cleanup(); } };
  const resolve = (t) => t.edit(t.runFile, (o) => { o.parallel_checks[0].resolution = 'test-side: the status filter is session state (learned conflict)'; return o; });
  const a0 = acc(() => {});
  eq(p, 'base', [a0.verdict, a0.mode, a0.reasons], ['NOT ACCEPTED', 'pre-gate', ['Checkpoint A gate record missing', 'unexplained first-attempt regression: TC-002 (failed beside other tests, passed alone, no evidenced cause)']]);
  const a1 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); resolve(t); });
  eq(p, 'clean, pre-gate', [a1.verdict, a1.mode, a1.conditional_on, a1.reasons], ['ACCEPTED', 'pre-gate', ['Checkpoint B PASS'], []]);
  const a2 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); writeGate(t, 'B', gate('B', 'PASS', { freshness: { stale: [], source: 'impact.final_check' } })); resolve(t); });
  eq(p, 'clean, final', [a2.verdict, a2.mode, a2.conditional_on], ['ACCEPTED', 'final', []]);
  const a3 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); t.edit(t.summary('first-positive-1.summary.json'), (o) => { o.interference[0].cause = 'possible_product_concurrency_defect'; return o; }); });
  eq(p, 'seeded concurrency defect', [a3.verdict, a3.reasons], ['NOT ACCEPTED', ['possible product concurrency defect unresolved: TC-002']]);
  const a4 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); resolve(t); t.edit(t.summary('first-negative-1.summary.json'), (o) => { o.tcs['TC-004'] = 'NOT_RUN'; o.reasons['TC-004'] = 'not started: admission timeout (host pressure)'; return o; }); });
  eq(p, 'admission timeout', [a4.verdict, a4.reasons], ['NOT ACCEPTED', ['required TC not run by admission / pressure / deferral / lease: TC-004 (not started: admission timeout (host pressure))']]);
  const a5 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); resolve(t); t.edit(t.summary('first-negative-1.summary.json'), (o) => { o.tcs['TC-004'] = 'NOT_RUN'; o.reasons['TC-004'] = 'not started: deferred until 2026-10-01T09:30:00Z'; return o; }); });
  eq(p, 'deferral', [a5.verdict, a5.reasons], ['NOT ACCEPTED', ['required TC not run by admission / pressure / deferral / lease: TC-004 (not started: deferred until 2026-10-01T09:30:00Z)']]);
  const a6 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); resolve(t); t.edit(t.summary('first-smoke-1.summary.json'), (o) => { o.smokeGate = { failPct: null, limit: 30, eligible: 0, decision: 'no_verdict', verdict: 'NO VERDICT' }; return o; }); });
  eq(p, 'smoke NO VERDICT', [a6.verdict, a6.reasons], ['NOT ACCEPTED', ['smoke gate: NO VERDICT']]);
  const a7 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); writeGate(t, 'B', gate('B', 'BLOCKED')); resolve(t); });
  eq(p, 'gate B BLOCKED', [a7.verdict, a7.mode, a7.reasons], ['NOT ACCEPTED', 'final', ['Checkpoint B not PASS (BLOCKED)']]);
  const a8 = acc((t) => { writeGate(t, 'A', gate('A', 'PASS')); writeGate(t, 'B', gate('B', 'PASS', { rehash: { matched: false, differences: ['tests/x.spec.ts'] } })); resolve(t); });
  eq(p, 'void snapshot', [a8.verdict, a8.reasons], ['NOT ACCEPTED', ['Checkpoint B snapshot void (re-hash differs)']]);
  // --write stores it in the run file (the draft, before the freeze)
  const t = tmp();
  try {
    writeGate(t, 'A', gate('A', 'PASS')); resolve(t);
    const w = runData({ _: ['acceptance'], 'run-file': t.runFile, write: true });
    eq(p, '--write', [w.outcome, t.json(t.runFile).acceptance.verdict, t.json(t.runFile).acceptance.mode], ['ACCEPTED', 'ACCEPTED', 'pre-gate']);
  } finally { t.cleanup(); }
  check('7 acceptance: clean ACCEPTED (pre-gate / final); concurrency defect, unexplained regression, admission timeout, deferral, NO VERDICT, gate B not PASS, void snapshot → NOT ACCEPTED', p, {});
}

/* 8 — draft-init: refuses over existing drafts; seeds from the published files. */
{
  const t = tmp();
  try {
    const p = [];
    const r0 = initDrafts({ resultsRoot: t.story, phase: 1, feature: 'sample' });
    eq(p, 'existing drafts', r0.outcome, 'REFUSED');
    fs.rmSync(path.join(t.story, 'artifacts', 'drafts'), { recursive: true, force: true });
    const r1 = initDrafts({ resultsRoot: t.story, phase: 1, feature: 'sample' });
    eq(p, 'seeded', [r1.outcome, r1.copied], ['CREATED', ['.runs/phase-1.json']]);
    if (sha(path.join(t.drafts, '.runs', 'phase-1.json')) !== sha(t.pubRunFile)) p.push('seeded run file is not a byte copy');
    check('8 draft-init refuses over drafts, seeds from the published files', p, {});
  } finally { t.cleanup(); }
}

/* 9 — publish: gated on Checkpoint B PASS and the frozen hashes; byte-identical promotion; page from drafts + gate record; reproduction. */
{
  const p = [];
  // no gate record → NOT_RUN; a gate record that is not PASS → REFUSED; nothing written either way
  {
    const t = tmp();
    try {
      mergeWrite(t);
      const r0 = publishPhase({ resultsRoot: t.story, phase: 1 });
      eq(p, 'no gate', r0.outcome, 'NOT_RUN');
      writeGate(t, 'B', gate('B', 'BLOCKED', { frozen: frozenOf(t) }));
      const r1 = publishPhase({ resultsRoot: t.story, phase: 1 });
      eq(p, 'B BLOCKED', [r1.outcome, /Checkpoint B is BLOCKED/.test(r1.reason)], ['REFUSED', true]);
      if (fs.existsSync(path.join(t.story, 'TEST-RUN-REPORT-sample.md')) || fs.existsSync(path.join(t.story, 'TEST-RUN-REPORT-sample.html'))) p.push('a refused publish wrote a file');
    } finally { t.cleanup(); }
  }
  // a draft edited after the freeze → REFUSED, nothing written
  {
    const t = tmp();
    try {
      mergeWrite(t);
      writeGate(t, 'B', gate('B', 'PASS', { frozen: frozenOf(t) }));
      fs.appendFileSync(path.join(t.drafts, 'TEST-RUN-REPORT-sample.md'), '\n- edited after the freeze\n');
      const before = sha(t.pubRunFile);
      const r = publishPhase({ resultsRoot: t.story, phase: 1 });
      eq(p, 'edited after freeze', [r.outcome, /changed after the freeze/.test(r.reason)], ['REFUSED', true]);
      if (fs.existsSync(path.join(t.story, 'TEST-RUN-REPORT-sample.md')) || sha(t.pubRunFile) !== before) p.push('a refused publish promoted a file');
    } finally { t.cleanup(); }
  }
  // the good path
  {
    const t = tmp();
    try {
      mergeWrite(t);
      const gateObj = gate('B', 'PASS', { frozen: frozenOf(t) });
      writeGate(t, 'B', gateObj);
      const gateFile = path.join(t.story, '.runs', 'phase-1.checkpoint-B.json');
      const r = publishPhase({ resultsRoot: t.story, phase: 1 });
      eq(p, 'published', [r.outcome, r.promoted, r.page, r.reproduced], ['PUBLISHED', ['TEST-RUN-REPORT-sample.md', 'BUG-REPORT-sample.md', '.runs/phase-1.json'], 'TEST-RUN-REPORT-sample.html', true]);
      for (const f of ['TEST-RUN-REPORT-sample.md', 'BUG-REPORT-sample.md', '.runs/phase-1.json']) if (sha(path.join(t.story, f)) !== sha(path.join(t.drafts, f))) p.push(f + ' is not byte-identical to its draft');
      const page = fs.readFileSync(path.join(t.story, 'TEST-RUN-REPORT-sample.html'), 'utf8');
      const st = pageState(page);
      if (!st.provenance || st.handEdited || st.recorded.gate !== shaText(fs.readFileSync(gateFile, 'utf8'))) p.push('page provenance / gate hash: ' + JSON.stringify(st));
      if (!/Gate record[\s\S]{0,200}Checkpoint B PASS · phase 1 · snapshot snap-b · 2026-10-01/.test(page)) p.push('the page does not show the gate record');
      const pre = render({ reportPath: path.join(t.drafts, 'TEST-RUN-REPORT-sample.md'), runsDir: path.join(t.drafts, '.runs'), base: t.story, gatePath: gateFile, root: t.story });
      if (pre.html !== page) p.push('the page of the drafts (rendered with --base) differs from the published page');
      // a hand-edited published page is refused without force, replaced with it
      fs.writeFileSync(path.join(t.story, 'TEST-RUN-REPORT-sample.html'), page.replace('Sources of truth:', 'Sources of truth (edited):'));
      const r2 = publishPhase({ resultsRoot: t.story, phase: 1 });
      eq(p, 'hand-edited page', [r2.outcome, /edited by hand/.test(r2.reason)], ['REFUSED', true]);
      const r3 = publishPhase({ resultsRoot: t.story, phase: 1, force: true });
      eq(p, 'hand-edited page with force', r3.outcome, 'PUBLISHED');
    } finally { t.cleanup(); }
  }
  check('9 publish: B PASS + frozen hashes required, byte-identical promotion, page from drafts + gate record, reproduced', p, {});
}

/* 10 — helpers and the CLI. */
{
  const p = [];
  eq(p, 'hhmmss', [hhmmss(0), hhmmss(15000), hhmmss(1320000), hhmmss(3723000), hhmmss(null)], ['00:00:00', '00:00:15', '00:22:00', '01:02:03', '—']);
  eq(p, 'variationSlug', [variationSlug('[TC-005] Order total recalculates — variation A'), variationSlug('[TC-001] Create an order'), variationSlug('[TC-009] Edit — variation Long name @run:parallel')], ['variation-a', 'none', 'variation-long-name']);
  eq(p, 'stageText', [stageText({ stage: 'positive', command: 'normal', run: 'rerun' }), stageText({ stage: 'smoke', command: 'isolation', run: 'first' }), stageText({ stage: 'smoke', command: 'normal', run: 'first', label: 'smoke retry' })], ['positive · re-run', 'smoke · isolation', 'smoke · smoke retry']);
  const plan = { groups: [{ name: 'parallel', mode: 'parallel', workers: 2, tcs: ['TC-1', 'TC-2'] }] };
  const adj = [{ at: '2026-10-01T10:00:00Z', kind: 'move', tc: 'TC-2', to: 'serial:x' }];
  eq(p, 'planAt before / after', [planAt(plan, adj, Date.parse('2026-10-01T09:00:00Z')).groups.length, planAt(plan, adj, Date.parse('2026-10-01T11:00:00Z')).groups.map((g) => g.name + ':' + g.tcs.join('+'))], [1, ['parallel:TC-1', 'serial:x:TC-2']]);
  const t = tmp();
  try {
    const call = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: t.dir });
    const m = call(['merge', '--run-file', t.runFile, '--strict']);
    let pm = null; try { pm = JSON.parse(m.stdout); } catch { p.push('merge stdout is not one JSON object'); }
    if (m.status !== 0 || !pm || pm.outcome !== 'OK' || pm.counts.total !== 5) p.push('merge CLI: exit ' + m.status + ' ' + (pm && pm.outcome));
    const nr = call(['publish', '--strict']);
    if (nr.status !== 3) p.push('publish without arguments --strict exit ' + nr.status + ' (want 3)');
    const v = call(['verify', '--run-file', path.join(t.dir, 'missing.json'), '--strict']);
    if (v.status !== 3) p.push('verify on a missing run file --strict exit ' + v.status + ' (want 3)');
    const bad = call(['nonsense']);
    if (bad.status !== 0 || JSON.parse(bad.stdout).outcome !== 'BLOCKED') p.push('an unknown subcommand must be BLOCKED with exit 0 (no --strict)');
  } finally { t.cleanup(); }
  check('10 helpers and CLI exit codes', p, {});
}

/* 11 — test layers (3.0): the evidence a TC owes follows its layer (an image for ui / hybrid, a record for api / db /
   api+db / hybrid), fail-closed — a missing, malformed, mismatched or unsealed record, or a PASS whose record holds a
   failed assertion, FAILs 18 / 54; backend TCs belong to the backend project (25b); 46b is unresolved, never a vacuous
   PASS, when only backend tests ran; check 53 reads the ownership ledgers (consent, production, ownership, read-back,
   in doubt) and acceptance counts what the run could not start or prove. Synthetic phase on a temp folder. */
{
  const p = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-data-layers-'));
  try {
    const ar = dir; const rr = path.join(dir, 'reports', 'US-1');
    const shotsRel = 'screenshots/US-1';
    const recDir = (tc, slug) => path.join(ar, shotsRel, 'phase-1', tc, slug);
    const { sealRecord } = await import('./redact.mjs');
    const writeRec = (tc, slug, a, extra = {}) => {
      const rec = { schema: 'skill5-record/1', tc, tcs: [tc], test_id: 't', title: '[' + tc + ']', project: slug.split('--')[0], attempt: a, retry: 0, layer: 'api', identity: null, entries: [{ id: 'e1', seq: 1, step: null, step_title: null, purpose: 'test', channel: 'api', method: 'POST', path: '/api/orders', status: 201 }], assertions: [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e1', target: 'status', outcome: 'pass' }], redaction: {}, ...extra };
      const sealed = sealRecord(rec, []);
      fs.mkdirSync(recDir(tc, slug), { recursive: true });
      fs.writeFileSync(path.join(recDir(tc, slug), 'attempt-' + a + '.record.json'), sealed.text);
      return shotsRel + '/phase-1/' + tc + '/' + slug + '/attempt-' + a + '.record.json';
    };
    const okRec = writeRec('TC-A1', 'backend--none--r0', 1);
    const failedAssert = writeRec('TC-A2', 'backend--none--r0', 1, { assertions: [{ id: 'a1', tc_line: 'ER1', entry_ref: 'e1', target: 'status', outcome: 'fail' }] });
    const wrongTc = writeRec('TC-OTHER', 'backend--none--r0', 1);
    fs.mkdirSync(recDir('TC-A4', 'backend--none--r0'), { recursive: true });
    fs.writeFileSync(path.join(recDir('TC-A4', 'backend--none--r0'), 'attempt-1.record.json'), '{not json');
    const brokenRec = shotsRel + '/phase-1/TC-A4/backend--none--r0/attempt-1.record.json';
    const hybImg = shotsRel + '/phase-1/TC-H1/chromium--none--r0/attempt-1.png';
    fs.mkdirSync(path.dirname(path.join(ar, hybImg)), { recursive: true }); fs.writeFileSync(path.join(ar, hybImg), 'PNG stub');
    const run = {
      schema: 'skill6-run/1', phase: 1, run_id: 'run-1', screenshots_root: shotsRel, results_root: 'reports/US-1', feature: 'layers',
      environment: { class: 'test' }, data_changes: { consent: 'yes', tcs: ['TC-A1'] },
      run_plan: { projects: ['chromium', 'backend'], backend_project: 'backend', layers: { 'TC-A1': 'api', 'TC-A2': 'api', 'TC-A3': 'api', 'TC-A4': 'db', 'TC-A5': 'api', 'TC-H1': 'hybrid', 'TC-U1': 'ui' }, backend_lines: { 'TC-A1': ['ER1'], 'TC-A2': ['ER1'] } },
    };
    const att = (status, extra) => ({ attempt: 1, status, evidence_screenshot: null, failure_screenshot: null, ...extra });
    const merged = { results: [
      { tc_id: 'TC-A1', status: 'PASS', variants: [{ variant_slug: 'backend--none--r0', attempts: [att('PASS', { evidence_record: okRec })] }] },
      { tc_id: 'TC-A2', status: 'PASS', variants: [{ variant_slug: 'backend--none--r0', attempts: [att('PASS', { evidence_record: failedAssert })] }] },
      { tc_id: 'TC-A3', status: 'PASS', variants: [{ variant_slug: 'backend--none--r0', attempts: [att('PASS', { evidence_record: wrongTc })] }] },
      { tc_id: 'TC-A4', status: 'PASS', variants: [{ variant_slug: 'backend--none--r0', attempts: [att('PASS', { evidence_record: brokenRec })] }] },
      { tc_id: 'TC-A5', status: 'PASS', variants: [{ variant_slug: 'backend--none--r0', attempts: [att('PASS')] }] },
      { tc_id: 'TC-H1', status: 'PASS', variants: [{ variant_slug: 'chromium--none--r0', attempts: [att('PASS', { evidence_screenshot: hybImg })] }] },
    ], watchdog_events: [], totals: { total: 6 } };
    // the ledger: one consented create (ok), one unconsented, one update of a record nobody created, one in doubt
    const prog = path.join(rr, 'artifacts', 'progress'); fs.mkdirSync(prog, { recursive: true });
    const L = (o) => JSON.stringify({ at: '2026-10-27T10:00:00Z', run_id: 'run-1', channel: 'db', ...o });
    fs.writeFileSync(path.join(prog, 'run-1-positive-g1.data-ledger.jsonl'), [
      L({ state: 'intent', write_id: 'w1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' }, purpose: 'test' }), L({ state: 'committed', write_id: 'w1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' } }), L({ state: 'verified', write_id: 'w1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' } }), L({ state: 'retained', write_id: 'r1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' } }),
      L({ state: 'intent', write_id: 'w2', tc: 'TC-A2', op: 'insert', table: 'orders', key: { id: 'n2' }, purpose: 'test' }), L({ state: 'committed', write_id: 'w2', tc: 'TC-A2', op: 'insert', table: 'orders', key: { id: 'n2' } }), L({ state: 'verified', write_id: 'w2', tc: 'TC-A2', op: 'insert', table: 'orders', key: { id: 'n2' } }),
      L({ state: 'intent', write_id: 'w3', tc: 'TC-A1', op: 'update', table: 'orders', key: { id: 'pre-1' }, purpose: 'test' }), L({ state: 'committed', write_id: 'w3', tc: 'TC-A1', op: 'update', table: 'orders', key: { id: 'pre-1' } }), L({ state: 'verified', write_id: 'w3', tc: 'TC-A1', op: 'update', table: 'orders', key: { id: 'pre-1' } }),
    ].join('\n') + '\n');
    const ctx = { run, phase: 1, automationRoot: ar, resultsRoot: rr, rrRel: 'reports/US-1', runFile: path.join(rr, '.runs', 'phase-1.json'), summaries: [], cmds: [], execs: [] };
    const v = verifyRuntime(ctx, merged, {});
    const d18 = (v.checks['18'].details || []).join(' | ');
    if (!/TC-A5 backend--none--r0 attempt 1: API \/ DB record missing/.test(d18)) p.push('18: a backend PASS without a record was not refused: ' + d18);
    if (/TC-A\d[^|]*image missing/.test(d18)) p.push('18: a backend TC was held to an image: ' + d18);
    if (!/TC-H1 chromium--none--r0 attempt 1: API \/ DB record missing/.test(d18)) p.push('18: a hybrid PASS without its record was not refused: ' + d18);
    const d54 = (v.checks['54'].details || []).join(' | ');
    eq(p, '54 status', v.checks['54'].status, 'FAIL');
    for (const [tc, re] of [['TC-A2', /failed assertion/], ['TC-A3', /tc "TC-OTHER" is not TC-A3/], ['TC-A4', /not valid JSON/], ['TC-A5', /no record/], ['TC-H1', /no record/]]) if (!new RegExp(tc + '[^|]*' + re.source).test(d54)) p.push('54: ' + tc + ' not refused for ' + re + ': ' + d54);
    if (/TC-A1/.test(d54)) p.push('54: the valid record of TC-A1 was refused: ' + d54);
    const d53 = (v.checks['53'].details || []).join(' | ');
    eq(p, '53 status', v.checks['53'].status, 'FAIL');
    if (!/TC-A2: insert[^|]*without the per-TC data-changes consent/.test(d53)) p.push('53: an unconsented write passed: ' + d53);
    if (!/TC-A1: update orders \{"id":"pre-1"\} on a record this run did not create/.test(d53)) p.push('53: an update of a pre-existing record passed: ' + d53);
    // in doubt → unresolved, and acceptance names it
    fs.appendFileSync(path.join(prog, 'run-1-positive-g1.data-ledger.jsonl'), L({ state: 'intent', write_id: 'w9', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n9' }, purpose: 'test' }) + '\n');
    const v2 = verifyRuntime(ctx, merged, {});
    eq(p, '53 with an intent in doubt beside the FAILs', v2.checks['53'].status, 'FAIL');
    if (!/intent without an outcome/.test((v2.checks['53'].details || []).join(' '))) p.push('53: the in-doubt intent is not listed');
    const doubtOnly = { ...ctx, run: { ...run, data_changes: { consent: 'yes', tcs: ['TC-A1', 'TC-A2'] } } };
    fs.writeFileSync(path.join(prog, 'run-1-positive-g1.data-ledger.jsonl'), [L({ state: 'intent', write_id: 'w1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' }, purpose: 'test' }), L({ state: 'committed', write_id: 'w1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' } }), L({ state: 'verified', write_id: 'w1', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n1' } }), L({ state: 'intent', write_id: 'w9', tc: 'TC-A1', op: 'insert', table: 'orders', key: { id: 'n9' }, purpose: 'test' })].join('\n') + '\n');
    eq(p, '53 with only an intent in doubt', verifyRuntime(doubtOnly, merged, {}).checks['53'].status, 'unresolved');
    // the two 3.0 report sub-sections come from the ledgers: n1 kept (never torn down), n9 in doubt — keys only
    const sec = ledgerSections(doubtOnly);
    if (!/### Retained test records/.test(sec.retainedTable || '') || !(sec.retainedTable || '').includes('| orders | {"id":"n1"} | TC-A1 | not torn down (verified) |')) p.push('ledgerSections: retained table ' + JSON.stringify(sec.retainedTable));
    if (!/### In-doubt test records/.test(sec.inDoubtTable || '') || !/n9/.test(sec.inDoubtTable || '') || /n1/.test(sec.inDoubtTable || '')) p.push('ledgerSections: in-doubt table ' + JSON.stringify(sec.inDoubtTable));
    if (Object.keys(ledgerSections({ ...doubtOnly, resultsRoot: path.join(dir, 'none') })).length) p.push('ledgerSections: a run without ledgers got sub-sections');
    // production / an unrecorded class: every write refused
    const v3 = verifyRuntime({ ...ctx, run: { ...run, environment: { class: 'production' } } }, merged, {});
    if (!/class "production"/.test((v3.checks['53'].details || []).join(' '))) p.push('53: a write on production was not refused');
    // 46b: only backend tests ran → unresolved (no vacuous PASS)
    const spans = [{ worker: 0, tc: 'TC-A1', tcs: ['TC-A1'], start: 1, end: 2, status: 'passed', events: [], cmd: { stage: 'positive', group: 'g1', attempt: 1 } }];
    const v4 = verifyRuntime({ ...ctx, cmds: [{ hb: { spans, teardowns: 0, consoleReports: 0 }, stage: 'positive', group: 'g1', attempt: 1, summary: {}, workers: 1, tcs: ['TC-A1'] }] }, merged, {});
    eq(p, '46b with only backend tests executed', v4.checks['46b'].status, 'unresolved');
    // 25b: a backend TC in the browser project, a ui TC in the backend project
    const execs = [{ tc: 'TC-A1', ran: true, project: 'chromium', modifiers: [] }, { tc: 'TC-U1', ran: true, project: 'backend', modifiers: [] }];
    const v5 = verifyRuntime({ ...ctx, execs }, merged, {});
    const d25 = (v5.checks['25b'].details || []).join(' | ');
    if (!/TC-A1: a api TC ran in the chromium project/.test(d25) || !/TC-U1: a ui TC ran in the backend project/.test(d25)) p.push('25b: wrong-project runs not refused: ' + d25);
    // acceptance: an API TC without a verdict for a reason the run must fix, and the in-doubt write
    const acc = computeAcceptance(ctx, { ...merged, results: [...merged.results, { tc_id: 'TC-A6', status: 'NOT_RUN', status_reason: 'not started: mapping unresolved (Q-3)' }, { tc_id: 'TC-A1', status: 'NOT_RUN', status_reason: 'not started: data changes not permitted' }, { tc_id: 'TC-A7', status: 'NOT_RUN', status_reason: 'not started: data changes not permitted' }], parallel_checks: [] }, { A: null, B: null });
    const r = acc.reasons.join(' | ');
    if (!/TC-A6 \(not started: mapping unresolved/.test(r)) p.push('acceptance: an unresolved mapping did not make the run NOT ACCEPTED: ' + r);
    if (!/consented data-changing TC refused: TC-A1/.test(r)) p.push('acceptance: a consented TC refused anyway was not named');
    if (/TC-A7/.test(r)) p.push('acceptance: a TC the tester did not consent to made the run NOT ACCEPTED');
    if (!/in doubt after a crash/.test(r)) p.push('acceptance: the in-doubt write was not named');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  check('11 layers: image / record per layer fail closed (18, 54), project per layer (25b), 46b never vacuous, ledger rules (53), acceptance', p, {});
}

/* 12 — 3.1 report-pipeline fixes: a freshness-failed command never crashes verify (the `hb` crash); evidence is paired
   by execution identity (repeat, worker, start time, own folder, one-worker order) and an ambiguous identity stays
   unresolved; one canonical path form; requirement ids from every source, a disagreement is a conflict. */
{
  const p = [];
  const t = tmp();
  try {
    // a freshness-FAIL command in the latest summary: phaseCommands gives it an (empty) heartbeat view, verify runs
    const sums = fs.readdirSync(path.join(t.story, 'artifacts', 'progress')).filter((f) => /\.summary\.json$/.test(f)).sort();
    t.edit(t.summary(sums[sums.length - 1]), (o) => { (o.groups || [])[0] && ((o.groups[0].freshness = { gate: 'FAIL' })); return o; });
    let crashed = null;
    try { const { ctx, m, mctx } = load(t.runFile); const c = ctx.cmds.find((x) => x.freshness === 'FAIL'); if (!c || !Array.isArray(c.hb.spans) || !c.excluded) p.push('the freshness-failed command has no empty heartbeat view'); verifyRuntime(mctx, m, {}); }
    catch (e) { crashed = e.message; }
    if (crashed) p.push('verify crashed on a freshness-failed command: ' + crashed);
  } finally { t.cleanup(); }
  // pairing — a burn-in command (workers 1) with three repeats of one TC and no start times / repeat in the heartbeats
  const mk = (id, start, folder, extra = {}) => ({ id, worker: 0, tc: 'TC-9', tcs: ['TC-9'], start, end: start + 900, status: 'passed', project: null, retry: null, repeat: null, ...extra,
    events: [{ event: 'evidence', path: 'screenshots/S/phase-1/TC-9/' + folder + '/attempt-1.png', _at: start + 500 }] });
  const cmd = { workers: 1, hb: { spans: [mk(0, 1000, 'chromium--none--r0'), mk(1, 3000, 'chromium--none--r1'), mk(2, 5000, 'chromium--none--r2')] } };
  const row = (repeat, extra = {}) => ({ project: 'chromium', repeat, retry: null, parallelIndex: null, startTime: null, ...extra });
  const taken = new Set();
  const got = [0, 1, 2].map((r) => { const k = pairSpan(cmd, row(r), 'TC-9', taken, { actual: 'chromium--none--r' + r, automationRoot: os.tmpdir() }); if (k.span) taken.add(k.span.id + '|TC-9'); return k.span ? k.span.id : null; });
  eq(p, 'burn-in repeats paired by their own folder', got, [0, 1, 2]);
  // the same three spans in ONE folder (a helper that ignores repeatEachIndex) — one worker: start order within the identity
  const same = { workers: 1, hb: { spans: [mk(0, 1000, 'chromium--none--r0'), mk(1, 3000, 'chromium--none--r0'), mk(2, 5000, 'chromium--none--r0')] } };
  const t2 = new Set();
  const got2 = [0, 1, 2].map((r) => { const k = pairSpan(same, row(r), 'TC-9', t2, { actual: 'chromium--none--r' + r, automationRoot: os.tmpdir() }); if (k.span) t2.add(k.span.id + '|TC-9'); return k.span ? k.span.id : null; });
  eq(p, 'one worker, one folder: start order within the identity', got2, [0, 1, 2]);
  // two workers, no start time, no folder difference: ambiguous — never a guess
  const multi = { workers: 2, hb: { spans: [mk(0, 1000, 'chromium--none--r0'), mk(1, 1100, 'chromium--none--r0', { worker: 1 })] } };
  eq(p, 'two workers without identity → ambiguous', !!pairSpan(multi, row(0), 'TC-9', new Set(), { actual: 'chromium--none--r0', automationRoot: os.tmpdir() }).ambiguous, true);
  // the worker slot and the start time decide when present
  eq(p, 'worker + start time', pairSpan(multi, row(0, { parallelIndex: 1, startTime: new Date(1100).toISOString() }), 'TC-9', new Set(), {}).span.id, 1);
  // paths — the canonical stored form from project-relative and absolute values
  const ar = path.join(os.tmpdir(), 'qa-paths', 'Testing', 'Automation');
  eq(p, 'project-relative → canonical', canonicalPath('Testing/Automation/screenshots/US-1/', ar), 'screenshots/US-1');
  eq(p, 'absolute → canonical', canonicalPath(path.join(ar, 'reports', 'US-1'), ar), 'reports/US-1');
  eq(p, 'canonical stays', canonicalPath('./reports/US-1', ar), 'reports/US-1');
  // requirement ids
  eq(p, 'agreeing sources', resolveReqId(null, new Set(['REQ-01', 'REQ-02']), new Set(['REQ-02'])), { value: 'REQ-02' });
  eq(p, 'run-file value kept when consistent', resolveReqId('REQ-01', new Set(['REQ-01']), null), { value: 'REQ-01' });
  eq(p, 'disagreement is a conflict, never a pick', !!resolveReqId(null, new Set(['REQ-01']), new Set(['REQ-05'])).conflict, true);
  check('12 3.1 pipeline: no hb crash, identity pairing (ambiguous stays unresolved), canonical paths, req_id conflicts', p, {});
}

/* 13 — judge: the model's judgements validated as a whole (unknown TC, vocabulary, FAIL unclassified, duplicates →
   nothing written); a valid set lands in the model-owned fields only and survives the next merge. */
{
  const p = [];
  const t = tmp();
  try {
    mergeWrite(t);
    const run = t.json(t.runFile);
    const fails = run.results.filter((r) => r.status === 'FAIL').map((r) => r.tc_id);
    const bad = applyJudgements(run, { results: { 'TC-404': { classification: 'app_bug' } }, parallel_checks: [{ tc: 'TC-002' }, { tc: 'TC-002' }] });
    if (!bad.errors.length || bad.run) p.push('an invalid set was accepted');
    if (!bad.errors.some((e) => /TC-404/.test(e))) p.push('the unknown TC was not named');
    const wrong = applyJudgements(run, { results: Object.fromEntries(fails.map((tc) => [tc, { classification: 'looks broken' }])) });
    if (fails.length && !wrong.errors.some((e) => /a FAIL takes one of/.test(e))) p.push('a FAIL classification outside the catalogue was accepted');
    const good = { results: Object.fromEntries(fails.map((tc) => [tc, { classification: 'app_bug', root_cause: 'the server rejects a valid order', severity: 'High' }])), deviations: ['harness deviation'] };
    const w = runData({ _: ['judge'], 'run-file': t.runFile, judgements: (() => { const f = path.join(t.dir, 'judgements.json'); fs.writeFileSync(f, JSON.stringify(good)); return f; })(), write: true });
    eq(p, 'valid judgements written', [w.outcome, (w.errors || []).length], ['OK', 0]);
    mergeWrite(t);
    const after = t.json(t.runFile);
    for (const tc of fails) eq(p, tc + ' classification kept by the next merge', after.results.find((r) => r.tc_id === tc).classification, 'app_bug');
    eq(p, 'deviations replaced', after.deviations, ['harness deviation']);
    const pub = runData({ _: ['judge'], 'run-file': t.pubRunFile, judgements: path.join(t.dir, 'judgements.json'), write: true });
    if (pub.outcome === 'OK' && pub.writes && pub.writes.length) p.push('judge wrote a PUBLISHED run file');
  } finally { t.cleanup(); }
  check('13 judge: validated as a whole, model-owned fields only, drafts only, kept by merge', p, {});
}

/* 14 — report --write: the script writes the draft phase section (header, one history row, the frozen sub-section
   order) and a second write is byte-identical (idempotent); earlier phases untouched; never the published report. */
{
  const p = [];
  const t = tmp();
  try {
    mergeWrite(t);
    const md = path.join(t.drafts, 'TEST-RUN-REPORT-sample.md');
    const r1 = runData({ _: ['report'], 'run-file': t.runFile, write: true });
    eq(p, 'report --write outcome', r1.outcome, 'OK');
    const once = fs.readFileSync(md, 'utf8');
    if (!/^## Phase 1 — /m.test(once) || !/^### Results$/m.test(once) || !/^### Stages$/m.test(once)) p.push('the phase section was not written');
    if ((once.match(/^## Phase 1 — /gm) || []).length !== 1) p.push('the phase heading is not unique');
    const order = [...once.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    if (order.indexOf('Run') > order.indexOf('Results') || order.indexOf('Results') > order.indexOf('Deviations')) p.push('sub-sections out of the frozen order: ' + order.join(' · '));
    runData({ _: ['report'], 'run-file': t.runFile, write: true });
    if (fs.readFileSync(md, 'utf8') !== once) p.push('a second report --write changed the draft (not idempotent)');
    const pub = runData({ _: ['report'], 'run-file': t.pubRunFile, write: true });
    eq(p, 'never the published report', pub.outcome, 'BLOCKED');
  } finally { t.cleanup(); }
  check('14 report --write: the draft phase section by script, frozen order, idempotent, drafts only', p, {});
}

/* 15 — delivery (3.1): the run's report / screenshot choice. `failed` → only the FAIL attempts (TC-002 / TC-003
   attempt 1, each with its -failed image) owe an image; `none` → none; 16b has nothing to order on this UI-only fixture;
   `md` → check 18 needs no page and publish writes none; absent → html + all (case 5 / 9 unchanged). */
{
  const p = [];
  eq(p, 'defaults', deliveryOf({}), { report: 'html', screenshots: 'all', source: 'default' });
  eq(p, 'unknown values fall back', deliveryOf({ delivery: { report: 'pdf', screenshots: 'some' } }), { report: 'html', screenshots: 'all', source: 'default' });
  eq(p, 'imageOwed', [imageOwed('all', 'PASS'), imageOwed('all', 'SKIP'), imageOwed('failed', 'PASS'), imageOwed('failed', 'FAIL'), imageOwed('none', 'FAIL')], [true, false, false, true, false]);
  const KEEP_FAILED = new Set([1, 2, 4, 5]); // TC-002 / TC-003 attempt-1 + their -failed images
  const verifyWith = (delivery, keep) => {
    const t = tmp();
    try {
      mergeWrite(t);
      t.edit(t.runFile, (o) => ({ ...o, delivery }));
      SHOTS.forEach((s, i) => { if (!keep.has(i)) fs.rmSync(path.join(t.dir, s), { force: true }); });
      const { mctx, m } = load(t.runFile);
      return verifyRuntime(mctx, m, {});
    } finally { t.cleanup(); }
  };
  const vf = verifyWith({ report: 'md', screenshots: 'failed', source: 'flag' }, KEEP_FAILED);
  eq(p, 'failed + md: 18', [vf.checks['18'].status, vf.checks['18'].evidence], ['PASS', '2 attempt images (screenshots: failed only) on disk; draft report, bug file, run file (markdown only — no page by the run\'s choice) present']);
  eq(p, 'failed: 16b nothing owed', [vf.checks['16b'].status, /none owes evidence under the run's screenshot choice \(`failed`\)/.test(vf.checks['16b'].evidence)], ['PASS', true]);
  const vfMissing = verifyWith({ report: 'md', screenshots: 'failed', source: 'flag' }, new Set([2, 4, 5]));
  if (vfMissing.checks['18'].status !== 'FAIL' || !/TC-002/.test((vfMissing.checks['18'].details || []).join(' '))) p.push('failed: a FAIL attempt without its image passed 18: ' + JSON.stringify(vfMissing.checks['18']));
  const vn = verifyWith({ report: 'html', screenshots: 'none', source: 'asked' }, new Set());
  // html: the draft page is owed — none was rendered in this case, so 18 names exactly that and no image
  const d18 = (vn.checks['18'].details || []).join(' | ');
  if (vn.checks['18'].status !== 'FAIL' || !/TEST-RUN-REPORT-sample\.html missing/.test(d18) || /image/.test(d18)) p.push('none + html: 18 must miss only the page: ' + JSON.stringify(vn.checks['18']));
  // publish under md: the markdown promoted, the renderer gate run, no page written
  const t = tmp();
  try {
    mergeWrite(t);
    t.edit(t.runFile, (o) => ({ ...o, delivery: { report: 'md', screenshots: 'all', source: 'asked' } }));
    writeGate(t, 'B', gate('B', 'PASS', { frozen: frozenOf(t) }));
    const r = publishPhase({ resultsRoot: t.story, phase: 1 });
    eq(p, 'md publish', [r.outcome, r.page, r.reportFormat, r.promoted], ['PUBLISHED', null, 'md', ['TEST-RUN-REPORT-sample.md', 'BUG-REPORT-sample.md', '.runs/phase-1.json']]);
    if (fs.existsSync(path.join(t.story, 'TEST-RUN-REPORT-sample.html'))) p.push('md publish wrote a page');
  } finally { t.cleanup(); }
  check('15 delivery: screenshots all / failed / none owed per attempt, markdown only publishes no page, defaults unchanged', p, {});
}

const out = {
  tool: 'selftest-run-data',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'run-data.mjs disagrees with its fixture — its run-file blocks, report numbers, checks or acceptance cannot be trusted until this passes.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
