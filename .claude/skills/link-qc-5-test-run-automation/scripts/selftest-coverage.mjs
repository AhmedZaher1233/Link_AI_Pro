#!/usr/bin/env node
// selftest-coverage.mjs — regression harness for coverage.mjs (the static coverage arithmetic, CSVs, snapshot, delta).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. Fixture: scripts/fixtures/coverage/ (see its README); every expected
// value below was computed by hand. Writes happen only in a temporary copy. Run: node selftest-coverage.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coverage, computeCoverage, csvField, round1 } from './coverage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'coverage');
const SCRIPT = path.join(here, 'coverage.mjs');
const J = path.join(FX, 'judgements.json');
const RUN2 = path.join(FX, 'story', '.runs', 'phase-2.json');
const DOC = path.join(FX, 'TEST-CASES-sample.md');
const NOW = '2026-10-01T08:57:00.000Z';
const STORY = 'US-9001 — Sample orders';

const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
const eq = (p, what, got, want) => { const a = JSON.stringify(got); const b = JSON.stringify(want); if (a !== b) p.push(what + ': got ' + a + ', want ' + b); };
const base = (extra = {}) => coverage({ _: [], judgements: J, 'run-file': RUN2, now: NOW, csv: true, ...extra });

const SUMMARY = [
  'User Story,Requirement ID(s),Stage,Total TCs,Fully Covered,Partially Covered,Not Covered,Weighted Coverage %,Distinct Automated TC-IDs',
  STORY + ',REQ-01,Smoke,1,1,0,0,100,1',
  STORY + ',"REQ-02, REQ-03",Positive,2,1,1,0,75,2',
  STORY + ',"REQ-02, REQ-04",Negative,2,0,1,1,25,1',
  STORY + ',"REQ-01, REQ-02, REQ-03, REQ-04",TOTAL,5,2,2,1,60,4',
  '', 'Legend',
  'Fully Covered,1.0,a test asserts the TC\'s expected result end-to-end and actually runs',
  'Partially Covered,0.5,automation exists but is weaker than the TC',
  'Not Covered,0.0,no test exercises the scenario (incl. manual — not automated)',
  '', 'Notes',
  '1,weighted % = (full × 1.0 + partial × 0.5) / total × 100 (one decimal)',
  '2,target 80% (default) — soft block',
  '3,role loops and data gates mean an automated TC-ID is not always a test that executes',
  '4,manual-gap categories present: Not an automation candidate; Empty State (Negative); Per-Row Enumeration & Identity',
].join('\n') + '\n';
const DETAIL = [
  'User Story,Requirement ID(s),TC-ID,Test Case Title,Type,Smoke,Automation Candidate,Coverage Status,Requirement Outcome Coverage,Mapped Test(s),Manual Testing Recommended,Notes / Recommendation',
  STORY + ',REQ-01,TC-001,Create an order with valid data,Positive,Yes,YES,Fully Covered,Full,tests/Orders_Tests/orders.spec.ts › [TC-001] Create an order with valid data,No,-',
  STORY + ',REQ-02,TC-002,Filter orders by status,Positive,No,YES,Fully Covered,Partial,tests/Orders_Tests/orders.spec.ts › [TC-002] Filter orders by status,No,-',
  STORY + ',REQ-03,TC-003,Every order row shows its owner,Positive,No,YES,Partially Covered,Partial,tests/Orders_Tests/orders.spec.ts › [TC-003] Every order row shows its owner,Yes,checks the first row only where the TC says every row',
  STORY + ',REQ-04,TC-004,Empty list message for a customer without orders,Negative,No,YES,Partially Covered,Missing,tests/Orders_Tests/orders.spec.ts › [TC-004] Empty list message,Yes,data-gated: skips when the customer has orders',
  STORY + ',REQ-02,TC-005,Print the order confirmation,Negative,No,NO,Not Covered,Partial,-,Yes,manual — not automated',
].join('\n') + '\n';
const MANUAL = [
  'Category,User Story,TC-ID,Scenario,Why Manual,Priority',
  'Not an automation candidate,' + STORY + ',TC-005,Print the order confirmation,the print dialog is outside the browser,Medium',
  'Empty State (Negative),' + STORY + ',TC-004,A customer without orders sees the empty-list message,no customer without orders exists in the environment,High',
  'Per-Row Enumeration & Identity,' + STORY + ',TC-003,Every row of the orders list shows the order owner,the test checks the first row only,Low',
].join('\n') + '\n';
const FRAGMENT = [
  '| Stage | Total TCs | Fully | Partially | Not | Weighted % |', '|---|---|---|---|---|---|',
  '| Smoke | 1 | 1 | 0 | 0 | 100 |', '| Positive | 2 | 1 | 1 | 0 | 75 |', '| Negative | 2 | 0 | 1 | 1 | 25 |', '| **Total** | 5 | 2 | 2 | 1 | 60 |', '',
  '**Target:** 80% (default, soft block) — **BELOW TARGET** · **Δ vs phase 1:** +10 pts — improved TC-002, TC-004 · TCs added +1 (TC-005)', '',
  '| Requirement | Outcome | Asserted by |', '|---|---|---|', '| REQ-01 | Full | TC-001 |', '| REQ-02 | Partial | TC-002 |', '| REQ-03 | Partial | TC-003 |', '| REQ-04 | Missing | — |',
].join('\n');

/* 1 — arithmetic, verdict, delta, manual priorities, log line and the report block. */
{
  const p = [];
  const r = base();
  eq(p, 'outcome / verdict', [r.outcome, r.verdict, r.weightedPct, r.target, r.targetSource, r.mechanism], ['OK', 'BELOW TARGET', 60, 80, 'default', 'soft block']);
  eq(p, 'byStage', r.byStage, { smoke: { total: 1, full: 1, partial: 0, none: 0, weightedPct: 100 }, positive: { total: 2, full: 1, partial: 1, none: 0, weightedPct: 75 }, negative: { total: 2, full: 0, partial: 1, none: 1, weightedPct: 25 } });
  eq(p, 'totals', r.totals, { total: 5, full: 2, partial: 2, none: 1, weightedPct: 60 });
  eq(p, 'requirements', r.requirements, { total: 4, full: 1, partial: 2, missing: 1, assumed: 0 });
  eq(p, 'manual', r.manual, { total: 3, high: 1, medium: 1, low: 1 });
  eq(p, 'delta', r.delta, { against: '.runs/phase-1.json', pctChange: 10, improved: ['TC-002', 'TC-004'], regressed: [], added: ['TC-005'], removed: [] });
  eq(p, 'gaps (fixable: candidate YES, not fully covered)', r.gaps, ['TC-003', 'TC-004']);
  eq(p, 'log line', r.logLine, 'Validating Automation Code — coverage: 60% weighted (Full 2 · Partial 2 · None 1) — target 80% (default) — BELOW TARGET → repairing');
  eq(p, 'fragment', r.fragment, FRAGMENT);
  eq(p, 'snapshot', [r.snapshot.measuredAt, r.snapshot.weightedPct, r.snapshot.verdict, r.snapshot.tcs['TC-005'], r.snapshot.requirements.length], [NOW, 60, 'BELOW TARGET', 'Not Covered', 4]);
  eq(p, 'round1', [round1(83.333), round1(75), round1(0.05)], [83.3, 75, 0.1]);
  check('1 arithmetic, verdict, delta, manual priorities, log line, report block', p, { pct: r.weightedPct });
}

/* 2 — the three CSVs, exact (headers of coverage.md step 5; a field with a comma is quoted). */
{
  const p = [];
  const r = base();
  eq(p, 'coverage-summary.csv', r.csv.summary, SUMMARY);
  eq(p, 'coverage-detail.csv', r.csv.detail, DETAIL);
  eq(p, 'manual-scenarios.csv', r.csv.manual, MANUAL);
  eq(p, 'csvField', [csvField('a,b'), csvField('say "hi"'), csvField('plain'), csvField(null)], ['"a,b"', '"say ""hi"""', 'plain', '']);
  check('2 the three CSVs, exact', p, {});
}

/* 3 — the verdict follows target and mechanism; --strict exit codes. */
{
  const p = [];
  eq(p, 'target 60 → PASS', base({ target: '60' }).verdict, 'PASS');
  eq(p, 'override', [base({ override: true }).verdict, base({ override: true }).logLine.endsWith('BELOW TARGET → user override')], ['user override', true]);
  eq(p, 'hard block', base({ mechanism: 'hard block' }).verdict, 'BLOCKED');
  eq(p, 'report-only', base({ mechanism: 'report-only' }).verdict, 'report-only');
  const call = (args) => spawnSync(process.execPath, [SCRIPT, '--judgements', J, '--run-file', RUN2, '--now', NOW, ...args], { encoding: 'utf8' });
  eq(p, 'strict BELOW TARGET', call(['--strict']).status, 1);
  eq(p, 'strict PASS', call(['--strict', '--target', '60']).status, 0);
  eq(p, 'strict hard block', call(['--strict', '--mechanism', 'hard block']).status, 2);
  eq(p, 'default exit', call([]).status, 0);
  check('3 verdict by target and mechanism; strict exit codes', p, {});
}

/* 4 — completeness against the approved document; invalid judgements BLOCK. */
{
  const p = [];
  const ok = base({ 'tc-doc': DOC });
  eq(p, 'complete', [ok.outcome, ok.missingTcs], ['OK', []]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-coverage-'));
  try {
    const doc6 = path.join(dir, 'TEST-CASES-sample.md');
    fs.writeFileSync(doc6, fs.readFileSync(DOC, 'utf8').replace(/\s*$/, '\n') + '| TC-006 | Negative | Cancel an order |\n');
    const miss = base({ 'tc-doc': doc6 });
    eq(p, 'TC-006 without a judgement', [miss.outcome, miss.missingTcs], ['BLOCKED', ['TC-006']]);
    const bad = JSON.parse(fs.readFileSync(J, 'utf8')); bad.tcs[1].status = 'Mostly Covered';
    const bj = path.join(dir, 'bad.json'); fs.writeFileSync(bj, JSON.stringify(bad));
    const rb = coverage({ _: [], judgements: bj, now: NOW });
    if (rb.outcome !== 'BLOCKED' || !rb.errors.some((e) => /Mostly Covered/.test(e))) p.push('an unknown status must BLOCK: ' + rb.outcome);
    const w = coverage({ _: [], judgements: bj, now: NOW, write: true, 'results-root': dir });
    if (fs.existsSync(path.join(dir, 'coverage'))) p.push('a BLOCKED measurement wrote CSVs');
    void w;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  check('4 completeness against the document; invalid judgements BLOCK and write nothing', p, {});
}

/* 5 — --write replaces the CSVs and sets the run file's coverage_snapshot; a dry run writes nothing. */
{
  const p = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-coverage-'));
  try {
    fs.cpSync(path.join(FX, 'story'), dir, { recursive: true });
    const run2 = path.join(dir, '.runs', 'phase-2.json');
    const before = fs.readFileSync(run2, 'utf8');
    coverage({ _: [], judgements: J, 'run-file': run2, now: NOW });
    if (fs.existsSync(path.join(dir, 'coverage')) || fs.readFileSync(run2, 'utf8') !== before) p.push('a dry run wrote something');
    fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true }); fs.writeFileSync(path.join(dir, 'coverage', 'coverage-summary.csv'), 'old\n');
    const w = coverage({ _: [], judgements: J, 'run-file': run2, now: NOW, write: true });
    eq(p, 'writes', w.writes.length, 4);
    eq(p, 'summary file', fs.readFileSync(path.join(dir, 'coverage', 'coverage-summary.csv'), 'utf8'), SUMMARY);
    eq(p, 'detail file', fs.readFileSync(path.join(dir, 'coverage', 'coverage-detail.csv'), 'utf8'), DETAIL);
    eq(p, 'manual file', fs.readFileSync(path.join(dir, 'coverage', 'manual-scenarios.csv'), 'utf8'), MANUAL);
    const run = JSON.parse(fs.readFileSync(run2, 'utf8'));
    eq(p, 'run file snapshot', [run.phase, run.coverage_snapshot.weightedPct, run.coverage_snapshot.delta.against, run.coverage_snapshot.measuredAt], [2, 60, '.runs/phase-1.json', NOW]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  check('5 --write replaces the CSVs and sets coverage_snapshot; dry run writes nothing', p, {});
}

/* 6 — no prior measurement; a legacy coverage-previous.json is the fallback (read-only). */
{
  const p = [];
  const j = JSON.parse(fs.readFileSync(J, 'utf8'));
  const none = computeCoverage(j, { previous: null, now: NOW });
  eq(p, 'no prior', [none.delta.against, none.fragment.includes('**Δ:** no prior measurement')], [null, true]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-coverage-'));
  try {
    fs.mkdirSync(path.join(dir, '.runs'));
    fs.writeFileSync(path.join(dir, '.runs', 'phase-1.json'), JSON.stringify({ schema: 'skill6-run/1', phase: 1 }));
    fs.writeFileSync(path.join(dir, 'coverage-previous.json'), JSON.stringify({ weightedPct: 40, tcs: { 'TC-001': 'Fully Covered', 'TC-002': 'Not Covered' } }));
    const before = fs.readFileSync(path.join(dir, 'coverage-previous.json'), 'utf8');
    const r = coverage({ _: [], judgements: J, 'results-root': dir, phase: '2', now: NOW });
    eq(p, 'legacy fallback', [r.delta.against, r.delta.pctChange, r.delta.improved, r.delta.added], ['coverage-previous.json (legacy, read-only)', 20, ['TC-002'], ['TC-003', 'TC-004', 'TC-005']]);
    if (fs.readFileSync(path.join(dir, 'coverage-previous.json'), 'utf8') !== before) p.push('the legacy file was written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  check('6 no prior measurement; legacy coverage-previous.json read-only fallback', p, {});
}

const out = { tool: 'selftest-coverage', ran: cases.length, ok: fail.length === 0, cases, mismatches: fail,
  note: fail.length ? 'coverage.mjs disagrees with its fixture — do not use its numbers until this passes.' : 'All fixtures behave as documented.' };
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
