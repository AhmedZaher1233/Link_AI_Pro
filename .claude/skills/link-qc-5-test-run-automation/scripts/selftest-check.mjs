#!/usr/bin/env node
// selftest-check.mjs — regression harness for check.mjs (the compliance checkpoints' deterministic half).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing self-test means a checkpoint verdict from check.mjs
// cannot be trusted: record the checkpoint by hand (compliance-checkpoints.md §5) until it passes again.
//
// It works on temporary copies of fixtures/check/project (never on the fixtures themselves), never touches the
// capacity ledger in the user's home (local compliance slots are injected) and spawns only the fixture fake tools.
// Every count below is worked out by hand from the check catalogue (CHECKS) and the fixture files — see each case.
//
// Run: node selftest-check.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { RULES } from './validate-automation.mjs';
import {
  CHECKS, RULE_TO_CHECK, NEVER_NA_AT_B, unitsFor, requiredUnits, takeSnapshot, rehash, decideGate, runGate, runChecks,
  runValidator, recordResult, recordBatch, parseBatch, readResults, resultsFile, carryShadow, freshnessOf, runPool, timeoutReport, parseTimeoutValues,
  lintFacts, harnessKey, harnessRun, skillVersionOf, fileSha, listFiles,
} from './check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(here, 'fixtures', 'check');
const FX_PROJECT = path.join(FX, 'project');
const CHECK = path.join(here, 'check.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-check-selftest-'));
const SCOPE = ['Testing/Automation/tests/orders.spec.ts', 'Testing/Automation/pages/OrdersPage.ts', 'Testing/Automation/helpers/evidence.ts'];
const DOCS = { tc: 'Testing/Manual_Test/TEST-CASES-orders.md', data: 'Testing/Manual_Test/TEST-DATA-orders.md', req: ['Testing/Requirements/REQ-orders.md'] };
// The B8 rules of the validator change how many mechanical units exist (each present rule adds one tool:validator unit
// to 6, 25a, 28, 43 and 49; 46a has one unit either way and 47 already has absolute-url).
const B8_PRESENT = ['constant-redeclared', 'admission-contract', 'empty-catch', 'timeout-literal', 'network-guard-missing'].filter((r) => r in RULES).length;

const cases = [];
const fail = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
const eq = (p, what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(what + ': ' + JSON.stringify(got) + ' != ' + JSON.stringify(want)); };
const truthy = (p, what, v) => { if (!v) p.push(what); };

function freshProject(name) {
  const proj = path.join(TMP, name);
  fs.cpSync(FX_PROJECT, proj, { recursive: true });
  const rr = path.join(proj, 'Testing', 'Automation', 'reports', 'US-1-orders');
  fs.mkdirSync(path.join(rr, '.runs'), { recursive: true });
  fs.copyFileSync(path.join(FX, 'run-file.json'), path.join(rr, '.runs', 'phase-1.json'));
  return { proj, rr };
}
const snap = (P, checkpoint, files = SCOPE) => takeSnapshot({ root: P.proj, resultsRoot: P.rr, checkpoint, phase: 1, files, ...DOCS });
const localSlots = (limit = 2, selfHeld = false) => ({ mode: 'local', limit, selfHeld, acquire: async () => null, release: async () => {}, activate: async () => {}, close: async () => {} });
/** A complete current-snapshot result set: tool units verified-mechanical, scope verified-semantic, phase verified by script. */
const fullSet = (checkpoint, s) => requiredUnits(checkpoint, s.body.facts).map((q, i) => ({
  checkId: q.checkId, unit: q.unit, snapshotId: s.snapshotId,
  status: q.unit === 'scope' ? 'verified-semantic' : 'verified-mechanical',
  reason: q.unit === 'phase' ? '0 events in 3 commands this phase (harness)' : 'harness: verified',
  evidenceRef: q.unit === 'scope' ? ['Testing/Automation/tests/orders.spec.ts:8'] : [],
  executor: q.unit.startsWith('tool:') ? 'V' : q.unit === 'phase' ? 'S' : 'M', at: '2026-01-01T10:00:00.000Z', _line: i + 1,
}));
const writeResults = (rr, id, recs) => {
  const f = resultsFile(rr, id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, recs.map(({ _line, ...r }) => JSON.stringify(r)).join('\n') + '\n');
};
const ok = { matched: true, differences: [] };
const why = (g) => g.rejected.map((x) => x.checkId + '|' + x.unit + '|' + x.why);

/* 1 — the catalogue: 1-50 with 16 / 25 / 46 / 48 split into code (a) and runtime (b) rows; units per checkpoint. */
{
  const p = [];
  const ids = CHECKS.map((c) => c.id);
  eq(p, 'check count (50 − 4 split items + 8 halves)', ids.length, 54);
  for (const x of ['16a', '16b', '25a', '25b', '46a', '46b', '48a', '48b']) truthy(p, 'missing check ' + x, ids.includes(x));
  for (const x of ['16', '25', '46', '48']) truthy(p, 'split item still present: ' + x, !ids.includes(x));
  eq(p, 'never N/A at B', NEVER_NA_AT_B, ['16b', '18', '19', '25b', '46b', '48a', '48b']);
  for (const [rule, list] of Object.entries(RULE_TO_CHECK)) for (const id of list) truthy(p, 'rule ' + rule + ' maps to unknown check ' + id, ids.includes(id));
  for (const r of Object.keys(RULES)) truthy(p, 'validator rule not mapped to any check: ' + r, (RULE_TO_CHECK[r] || []).length > 0);
  const by = (id) => CHECKS.find((c) => c.id === id);
  eq(p, '27 with type-aware lint', unitsFor(by('27'), 'A', { lintFloatingPromises: true }), ['tool:lint']);
  eq(p, '27 without', unitsFor(by('27'), 'A', { lintFloatingPromises: false }), ['scope']);
  eq(p, '35 (type check + scan)', unitsFor(by('35'), 'A', {}), ['tool:tsc', 'tool:scan']);
  eq(p, '18 at A', unitsFor(by('18'), 'A', {}), []);
  eq(p, '18 at B', unitsFor(by('18'), 'B', {}), ['scope', 'phase']);
  eq(p, '7 (semantic only)', unitsFor(by('7'), 'A', {}), ['scope']);
  eq(p, '33 at B (runtime + the validator rule mapped to it)', unitsFor(by('33'), 'B', {}), ['tool:validator', 'phase']);
  eq(p, '44 (config inventory + review)', unitsFor(by('44'), 'A', {}), ['tool:configs', 'scope']);
  eq(p, '43 (protections + review; the timeout-literal rule when present)', unitsFor(by('43'), 'A', { validatorRuleIds: [] }), ['tool:protections', 'scope']);
  check('1 catalogue: 54 checks, a/b halves, never-N/A list, rule mapping, units per checkpoint', p, { checks: ids.length, b8Present: B8_PRESENT });
}

/* 2 — snapshot A: content-addressed (same content → same id, reused), per-TC hashes, the four predicates of the fixture,
   and the hand-counted required set: 64 units (43 gained tool:protections) + one per present B8 rule (worked out check by check in the README sense:
   26 and 39 have no subject, 16b / 18 / 19 / 22 / 25b / 32 / 46b / 48a / 48b are runtime-only). */
const P1 = freshProject('p1');
const sA = snap(P1, 'A');
{
  const p = [];
  const again = snap(P1, 'A');
  eq(p, 'same content → same id', again.snapshotId, sA.snapshotId);
  eq(p, 'second snapshot reused', again.reused, true);
  truthy(p, 'snapshot file written', fs.existsSync(sA.file));
  eq(p, 'per-TC hashes', Object.keys(sA.snapshot.body.tc.perTc).sort(), ['TC-01', 'TC-02']);
  const pr = sA.snapshot.body.facts.predicates;
  eq(p, 'predicates (no subject)', Object.fromEntries(Object.entries(pr).map(([k, v]) => [k, v.noSubject])), { 'api-setup': true, 'fail-slow': true, exceptions: true, 'rate-limit-step': true });
  eq(p, 'required units at A', requiredUnits('A', sA.snapshot.body.facts).length, 64 + B8_PRESENT);
  truthy(p, 'scopeDigest recorded', /^[0-9a-f]{64}$/.test(String(sA.snapshot.body.scopeDigest)));
  eq(p, 'nothing B-only at A', ['evidence', 'artifacts', 'gateA', 'drafts'].filter((k) => k in sA.snapshot.body), []);
  check('2 snapshot A: content-addressed, per-TC hashes, predicates, 64 + B8 required units', p, { id: sA.snapshotId, warnings: sA.warnings });
}

/* 3 — gate A on a complete set: PASS; the 17 runtime halves are scheduled-for-B automatically; N/A for 22, 26, 39 and the
   slot part of 49 with their predicate evidence; the separate gate record is written. */
const recsA = fullSet('A', sA.snapshot);
{
  const p = [];
  const g = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: recsA, rehashResult: ok });
  eq(p, 'verdict', g.verdict, 'PASS');
  eq(p, 'rejected', why(g), []);
  eq(p, 'auto scheduled-for-B', g.counts.auto, 17);
  eq(p, 'N/A entries', g.na.map((x) => x.checkId + (x.part ? ':' + x.part : '')).sort(), ['22', '26', '39', '49:slot']);
  truthy(p, 'every auto record is scheduled-for-B', g.results.filter((r) => r.auto).every((r) => r.status === 'scheduled-for-B' && r.unit === 'phase'));
  writeResults(P1.rr, sA.snapshotId, recsA);
  const w = runGate({ resultsRoot: P1.rr, snapshotId: sA.snapshotId, checkpoint: 'A' });
  eq(p, 'runGate verdict', w.record && w.record.verdict, 'PASS');
  eq(p, 'rehash at gate time', w.record && w.record.rehash.matched, true);
  eq(p, 'record path', w.written && path.basename(w.written), 'phase-1.checkpoint-A.json');
  truthy(p, 'gate record on disk', w.written && fs.existsSync(w.written));
  truthy(p, 'no internal line numbers in the record', w.record && w.record.results.every((r) => !('_line' in r)));
  check('3 gate A: complete set → PASS, 17 scheduled-for-B, predicate N/A, separate record', p, { counts: g.counts });
}

/* 4 — T-27: missing / stale / contradictory / duplicate results BLOCK and are never merged; N/A only with a true
   predicate; a runtime item at A is scheduled-for-B, never PASS; an unknown status is a protocol error. */
{
  const p = [];
  const base = (r) => ({ ...r });
  const g1 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: recsA.filter((r) => !(r.checkId === '7' && r.unit === 'scope')), rehashResult: ok });
  eq(p, 'missing → BLOCKED', [g1.verdict, why(g1)], ['BLOCKED', ['7|scope|missing']]);
  const three = recsA.find((r) => r.checkId === '3' && r.unit === 'scope');
  const g2 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...recsA, { ...base(three), snapshotId: 'ffffffffffffffff', _line: 900 }], rehashResult: ok });
  eq(p, 'stale → BLOCKED', [g2.verdict, why(g2)], ['BLOCKED', ['3|scope|stale']]);
  const g3 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...recsA, { ...base(three), status: 'unresolved', reason: 'second reviewer disagrees', _line: 901 }], rehashResult: ok });
  eq(p, 'contradictory → BLOCKED', [g3.verdict, why(g3)], ['BLOCKED', ['3|scope|contradictory']]);
  const g4 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...recsA, { ...base(three), _line: 902 }], rehashResult: ok });
  eq(p, 'duplicate → BLOCKED', [g4.verdict, why(g4)], ['BLOCKED', ['3|scope|duplicate']]);
  const g5 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: recsA.map((r) => (r.checkId === '7' && r.unit === 'scope' ? { ...r, status: 'N/A', reason: 'looks out of scope' } : r)), rehashResult: ok });
  eq(p, 'N/A without a predicate → BLOCKED', [g5.verdict, why(g5)], ['BLOCKED', ['7|scope|na-not-allowed']]);
  const g6 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...recsA, { checkId: '39', unit: 'scope', snapshotId: sA.snapshotId, status: 'N/A', reason: 'no exception honoured in scope', evidenceRef: [], executor: 'M', _line: 903 }], rehashResult: ok });
  eq(p, 'N/A with a true predicate → accepted', [g6.verdict, g6.na.filter((x) => x.checkId === '39').map((x) => x.recorded)], ['PASS', [true]]);
  const g7 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...recsA, { checkId: '18', unit: 'phase', snapshotId: sA.snapshotId, status: 'verified-mechanical', reason: 'images exist', evidenceRef: [], executor: 'S', _line: 904 }], rehashResult: ok });
  eq(p, 'runtime item verified at A → BLOCKED', [g7.verdict, why(g7)], ['BLOCKED', ['18|phase|scheduled-at-B']]);
  const g8 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...recsA, { ...base(three), checkId: '12', status: 'PASS', _line: 905 }], rehashResult: ok });
  eq(p, 'unknown status → BLOCKED', [g8.verdict, why(g8)], ['BLOCKED', ['12|scope|invalid-status']]);
  check('4 T-27 result rules: missing / stale / contradictory / duplicate / N/A / scheduled / invalid', p, {});
}

/* 5 — closure: a mechanical `unresolved` needs a verified-semantic scope result of the same check; a mechanical FAIL is
   never closed. */
{
  const p = [];
  const swap = (id, unit, patch) => recsA.map((r) => (r.checkId === id && r.unit === unit ? { ...r, ...patch } : r));
  const open = swap('35', 'tool:tsc', { status: 'unresolved', reason: 'the type check did not run: TypeScript not found' });
  const g1 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: open, rehashResult: ok });
  eq(p, 'unresolved tool unit without a closing scope', [g1.verdict, why(g1)], ['BLOCKED', ['35|scope|missing']]);
  const closing = [...open, { checkId: '35', unit: 'scope', snapshotId: sA.snapshotId, status: 'verified-semantic', reason: 'imports checked by reading every import line', evidenceRef: ['Testing/Automation/tests/orders.spec.ts:1'], executor: 'M', _line: 950 }];
  const g2 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: closing, rehashResult: ok });
  eq(p, 'closed by the scope result', [g2.verdict, g2.closed.map((x) => x.checkId + '|' + x.unit)], ['PASS', ['35|tool:tsc']]);
  const failed = swap('20', 'tool:validator', { status: 'FAIL', reason: '1 violation of focus-only', evidenceRef: ['Testing/Automation/tests/bad.spec.ts:5 focus-only'] });
  const g3 = decideGate({ checkpoint: 'A', snapshot: sA.snapshot, records: [...failed, { checkId: '20', unit: 'scope', snapshotId: sA.snapshotId, status: 'verified-semantic', reason: 'reviewer says it is fine', evidenceRef: ['x:1'], executor: 'M', _line: 951 }], rehashResult: ok });
  eq(p, 'a FAIL is never closed', [g3.verdict, g3.fail.map((x) => x.checkId + '|' + x.unit)], ['FAIL', ['20|tool:validator']]);
  check('5 closure: unresolved closed only by verified-semantic scope; FAIL never', p, {});
}

/* 6 — T-28: an edit after the snapshot voids the checkpoint (gate and run alike). */
{
  const p = [];
  const P2 = freshProject('p2');
  const s = snap(P2, 'A');
  writeResults(P2.rr, s.snapshotId, fullSet('A', s.snapshot));
  fs.appendFileSync(path.join(P2.proj, 'Testing', 'Automation', 'pages', 'OrdersPage.ts'), '\n// edited after the snapshot\n');
  const rh = rehash(s.snapshot);
  eq(p, 'rehash notices the edit', [rh.matched, rh.differences.some((d) => d.section === 'files' && d.key === 'Testing/Automation/pages/OrdersPage.ts')], [false, true]);
  const g = runGate({ resultsRoot: P2.rr, snapshotId: s.snapshotId, checkpoint: 'A', dryRun: true });
  eq(p, 'gate voided', [g.record.verdict, g.record.rejected.some((x) => x.why === 'void'), g.written], ['BLOCKED', true, null]);
  check('6 T-28 an edit during a checkpoint voids it', p, { differences: rh.differences.length });
}

/* 7 — Checkpoint B: drafts + evidence + gate record A frozen; complete set with runtime results PASS (zero events PASS
   with evidence — T-26); the record is separate and the drafts and run file stay byte-identical (T-29); 78 + B8 units (43 gained tool:protections). */
const draftsDir = path.join(P1.rr, 'artifacts', 'drafts', 'phase-1');
fs.cpSync(path.join(FX, 'drafts'), draftsDir, { recursive: true });
const draftShaBefore = Object.fromEntries(listFiles(draftsDir).map((f) => [path.relative(draftsDir, f).replace(/\\/g, '/'), fileSha(f)]));
const runFileSha = fileSha(path.join(P1.rr, '.runs', 'phase-1.json'));
const sB = snap(P1, 'B');
const recsB = fullSet('B', sB.snapshot);
{
  const p = [];
  const b = sB.snapshot.body;
  eq(p, 'frozen drafts', Object.keys(b.drafts).sort(), ['.runs/phase-1.json', 'BUG-REPORT-orders.md', 'TEST-RUN-REPORT-orders.html', 'TEST-RUN-REPORT-orders.md']);
  eq(p, 'evidence manifest', Object.keys(b.evidence), ['Testing/Automation/screenshots/US-1-orders/phase-1/TC-01/chromium--none--r0/attempt-1.png']);
  eq(p, 'gate record A frozen', b.gateA && b.gateA.verdict, 'PASS');
  eq(p, 'required units at B', requiredUnits('B', b.facts).length, 78 + B8_PRESENT);
  writeResults(P1.rr, sB.snapshotId, recsB);
  const w = runGate({ resultsRoot: P1.rr, snapshotId: sB.snapshotId, checkpoint: 'B', impact: path.join(FX, 'impact-fresh.json') });
  eq(p, 'verdict', w.record && [w.record.verdict, why(w.record)], ['PASS', []]);
  eq(p, 'freshness', w.record && [w.record.freshness.known, w.record.freshness.stale, w.record.freshness.source], [true, [], 'impact.mjs select payload']);
  eq(p, 'record name', w.written && path.basename(w.written), 'phase-1.checkpoint-B.json');
  eq(p, 'frozen.drafts = the drafts', w.record && w.record.frozen.drafts, draftShaBefore);
  const after = Object.fromEntries(listFiles(draftsDir).map((f) => [path.relative(draftsDir, f).replace(/\\/g, '/'), fileSha(f)]));
  eq(p, 'drafts untouched', after, draftShaBefore);
  eq(p, 'run file untouched', fileSha(path.join(P1.rr, '.runs', 'phase-1.json')), runFileSha);
  const zero = w.record && w.record.results.find((r) => r.checkId === '48b' && r.unit === 'phase');
  eq(p, 'zero events recorded as a PASS with evidence (48b)', zero && [zero.status, /0 events/.test(zero.reason)], ['verified-mechanical', true]);
  check('7 Checkpoint B: frozen drafts / evidence / record A, PASS, separate record, drafts untouched (T-26, T-29)', p, { counts: w.record && w.record.counts });
}

/* 8 — Checkpoint B refusals: never-N/A runtime checks, unknown or stale freshness, scheduled-for-B at B. */
{
  const p = [];
  const fresh = { known: true, stale: [], source: 'harness' };
  const g1 = decideGate({ checkpoint: 'B', snapshot: sB.snapshot, records: recsB.map((r) => (r.checkId === '48a' ? { ...r, status: 'N/A', reason: 'no stop happened this phase' } : r)), rehashResult: ok, freshness: fresh });
  eq(p, '48a N/A at B', [g1.verdict, why(g1)], ['BLOCKED', ['48a|phase|na-not-allowed']]);
  const g2 = decideGate({ checkpoint: 'B', snapshot: sB.snapshot, records: recsB, rehashResult: ok, freshness: { known: false, stale: [], source: null } });
  eq(p, 'no freshness check', [g2.verdict, why(g2)], ['BLOCKED', ['freshness|phase|missing']]);
  const stale = freshnessOf({ impactJson: JSON.parse(fs.readFileSync(path.join(FX, 'impact-stale.json'), 'utf8')) });
  eq(p, 'stale payload read', stale, { known: true, stale: ['TC-02'], source: 'impact.mjs select payload' });
  const g3 = decideGate({ checkpoint: 'B', snapshot: sB.snapshot, records: recsB, rehashResult: ok, freshness: stale });
  eq(p, 'stale result → BLOCKED', [g3.verdict, g3.open.map((x) => x.checkId)], ['BLOCKED', ['freshness']]);
  const g4 = decideGate({ checkpoint: 'B', snapshot: sB.snapshot, records: recsB.map((r) => (r.checkId === '16b' ? { ...r, status: 'scheduled-for-B' } : r)), rehashResult: ok, freshness: fresh });
  eq(p, 'scheduled-for-B at B', [g4.verdict, why(g4)], ['BLOCKED', ['16b|phase|scheduled-at-B']]);
  check('8 Checkpoint B refusals: never-N/A, freshness unknown / stale, nothing scheduled at B', p, {});
}

/* 9 — T-30: B7 carry in shadow — only linked current-snapshot results, invalidated by a TC change, nothing when the tools
   change, and an old snapshot id in the current results is rejected. */
{
  const p = [];
  const P3 = freshProject('p3');
  const a = snap(P3, 'A');
  for (const [id, ev] of [['3', 'Testing/Automation/pages/OrdersPage.ts:11'], ['7', 'Testing/Automation/tests/orders.spec.ts:12'], ['11', 'Testing/Automation/tests/orders.spec.ts:19']]) {
    const r = recordResult({ resultsRoot: P3.rr, snapshotId: a.snapshotId, checkId: id, unit: 'scope', status: 'verified-semantic', reason: 'reviewed against TC and REQ-001', evidence: [ev] });
    truthy(p, 'record ' + id + ' accepted', r.ok);
  }
  recordResult({ resultsRoot: P3.rr, snapshotId: a.snapshotId, checkId: '20', unit: 'tool:validator', status: 'verified-mechanical', reason: '', executor: 'V' });
  const tcFile = path.join(P3.proj, DOCS.tc);
  fs.writeFileSync(tcFile, fs.readFileSync(tcFile, 'utf8').replace('The confirmation "Saved" is displayed.', 'The confirmation "Saved" is displayed in the page header.'));
  const b = snap(P3, 'B');
  const c = carryShadow({ fromSnapshot: a.snapshot, toSnapshot: b.snapshot, fromRecords: readResults(resultsFile(P3.rr, a.snapshotId)) });
  eq(p, 'shadow header', [c.mode, c.toolsChanged, c.changedFiles, c.fallback], ['shadow', false, 0, false]);
  eq(p, 'carriable (deps unchanged)', c.carriable.map((x) => x.checkId), ['3']);
  eq(p, 'invalidated by the TC change', c.invalidated.map((x) => x.checkId + ':' + x.sections.join('+')).sort(), ['11:tc', '7:tc']);
  const carried = c.carriable[0];
  eq(p, 'linked current-snapshot result', carried && [carried.snapshotId, carried.carriedFrom.snapshotId, carried.proof.files.old === carried.proof.files.current], [b.snapshotId, a.snapshotId, true]);
  truthy(p, 'carry wrote no result', !fs.existsSync(resultsFile(P3.rr, b.snapshotId)));
  const g = decideGate({ checkpoint: 'B', snapshot: b.snapshot, records: [{ ...carried, snapshotId: a.snapshotId, _line: 1 }], rehashResult: ok, freshness: { known: true, stale: [], source: 'harness' } });
  truthy(p, 'an old snapshot id is rejected as stale', g.rejected.some((x) => x.checkId === '3' && x.why === 'stale'));
  const changedTools = JSON.parse(JSON.stringify(b.snapshot));
  changedTools.body.tools.validatorRules = '0'.repeat(64);
  const c2 = carryShadow({ fromSnapshot: a.snapshot, toSnapshot: changedTools, fromRecords: readResults(resultsFile(P3.rr, a.snapshotId)) });
  eq(p, 'tools changed → nothing carried', [c2.toolsChanged, c2.carriable.length], [true, 0]);
  check('9 T-30 carry in shadow only: linked results, invalidation, tools change, old ids rejected', p, { invalidated: c.invalidated });
}

/* 10 — T-31: the mechanical results agree with the validator's own (legacy) gate — summary ≡ full ≡ analyze(); every
   violation lands in a FAIL record; a violation-free scope produces no tool:validator FAIL; no second recording. */
{
  const p = [];
  const P4 = freshProject('p4');
  const fakeTools = async (name) => (name === 'tsc' ? { status: 'PASS', errors: [] } : { status: 'PASS', floating: [], problems: 0 });
  const bad = snap(P4, 'A', ['Testing/Automation/tests/bad.spec.ts', 'Testing/Automation/helpers/evidence.ts']);
  const legacy = runValidator(bad.snapshot.inputs);
  const { compact, full } = await runChecks({ root: P4.proj, resultsRoot: P4.rr, snapshotId: bad.snapshotId, runTool: fakeTools, slots: localSlots(2) });
  eq(p, 'legacy gate of the bad spec', legacy.gate, 'FAIL');
  eq(p, 'summary gate ≡ legacy', compact.components.validator.gate, legacy.gate);
  eq(p, 'full counts ≡ legacy', full.components.validator.counts, legacy.counts);
  eq(p, 'summary violations ≡ legacy', compact.components.validator.counts.violation, legacy.counts.violation);
  const recs = readResults(resultsFile(P4.rr, bad.snapshotId));
  eq(p, 'one mechanical record per tool unit', recs.length, requiredUnits('A', bad.snapshot.body.facts).filter((q) => q.unit.startsWith('tool:')).length);
  for (const f of legacy.findings.filter((x) => x.severity === 'violation')) {
    const ref = f.file + ':' + f.line + ' ' + f.ruleId;
    truthy(p, 'violation not in a FAIL record: ' + ref, recs.some((r) => r.status === 'FAIL' && (r.evidenceRef || []).includes(ref)));
  }
  eq(p, 'focus-only → check 20 FAIL', recs.find((r) => r.checkId === '20' && r.unit === 'tool:validator').status, 'FAIL');
  eq(p, 'raw locator → check 1 FAIL', recs.find((r) => r.checkId === '1' && r.unit === 'tool:validator').status, 'FAIL');
  const again = await runChecks({ root: P4.proj, resultsRoot: P4.rr, snapshotId: bad.snapshotId, runTool: fakeTools, slots: localSlots(2) });
  eq(p, 'never recorded twice', [again.compact.recorded, readResults(resultsFile(P4.rr, bad.snapshotId)).length], [0, recs.length]);
  const clean = snap(P4, 'A');
  const cleanLegacy = runValidator(clean.snapshot.inputs);
  await runChecks({ root: P4.proj, resultsRoot: P4.rr, snapshotId: clean.snapshotId, runTool: fakeTools, slots: localSlots(2) });
  eq(p, 'clean scope has no violation', cleanLegacy.counts.violation, 0);
  eq(p, 'clean scope → no tool:validator FAIL', readResults(resultsFile(P4.rr, clean.snapshotId)).filter((r) => r.unit === 'tool:validator' && r.status === 'FAIL').length, 0);
  check('10 T-31 mechanical results ≡ the legacy validator gate; summary ≡ full', p, { violations: legacy.counts.violation });
}

/* 11 — the type check: absent → notRun (never PASS) and its unit unresolved; the fake compiler's error → FAIL. */
{
  const p = [];
  const P5 = freshProject('p5');
  const r1 = await runChecks({ root: P5.proj, files: SCOPE, noLedger: true });
  eq(p, 'tsc absent → notRun', r1.compact.components.tsc.status, 'notRun');
  eq(p, 'run gate never PASS without the type check', r1.compact.gate, 'BLOCKED');
  const s = snap(P5, 'A');
  await runChecks({ root: P5.proj, resultsRoot: P5.rr, snapshotId: s.snapshotId, slots: localSlots(2) });
  const recs = readResults(resultsFile(P5.rr, s.snapshotId));
  eq(p, '35 units', ['tool:tsc', 'tool:scan'].map((u) => (recs.find((r) => r.checkId === '35' && r.unit === u) || {}).status), ['unresolved', 'verified-mechanical']);
  process.env.FAKE_TSC = 'fail';
  const r2 = await runChecks({ root: P5.proj, files: SCOPE, tsc: path.join(FX, 'bin', 'fake-tsc.mjs'), noLedger: true });
  delete process.env.FAKE_TSC;
  eq(p, 'fake compiler error', [r2.compact.components.tsc.status, r2.compact.components.tsc.errors, r2.compact.gate], ['FAIL', 1, 'FAIL']);
  eq(p, 'error relative to the project root', (r2.compact.components.tsc.first[0] || '').startsWith('Testing/Automation/tests/orders.spec.ts:3 TS2307'), true);
  const r3 = await runChecks({ root: P5.proj, files: SCOPE, tsc: path.join(FX, 'bin', 'fake-tsc.mjs'), noLedger: true });
  eq(p, 'fake compiler clean', r3.compact.components.tsc.status, 'PASS');
  check('11 type check: absent → notRun / unresolved, error → FAIL, clean → PASS', p, {});
}

/* 12 — A14: never more tool processes at once than the compliance limit; a refused slot is notRun, not a crash. */
{
  const p = [];
  let live = 0;
  let seen = 0;
  const job = (i) => ({ name: 'j' + i, run: async () => { live++; seen = Math.max(seen, live); await new Promise((r) => setTimeout(r, 15)); live--; return { status: 'PASS', i }; } });
  const two = await runPool([0, 1, 2, 3, 4].map(job), 2);
  eq(p, 'limit 2', [two.maxActive, seen, two.results.map((r) => r.i)], [2, 2, [0, 1, 2, 3, 4]]);
  seen = 0;
  const one = await runPool([0, 1, 2].map(job), 1);
  eq(p, 'limit 1', [one.maxActive, seen], [1, 1]);
  const refused = await runPool([0, 1, 2].map(job), 2, { acquire: async (j) => { if (j.name === 'j1') throw new Error('ledger full'); return null; } });
  eq(p, 'refused slot', refused.results.map((r) => r.status), ['PASS', 'notRun', 'PASS']);
  let toolLive = 0;
  let toolSeen = 0;
  const runTool = async () => { toolLive++; toolSeen = Math.max(toolSeen, toolLive); await new Promise((r) => setTimeout(r, 15)); toolLive--; return { status: 'PASS', errors: [], floating: [], problems: 0 }; };
  const P6 = freshProject('p6');
  const r = await runChecks({ root: P6.proj, files: SCOPE, lint: true, runTool, slots: localSlots(2, true) });
  eq(p, 'this process holds one of 2 slots → tools one at a time', [r.full.slots.spawnLimit, r.full.slots.maxActive, toolSeen], [1, 1, 1]);
  check('12 A14 compliance limit respected', p, {});
}

/* 13 — A15: unlimited / missing action and navigation budgets and deadlines of 10 minutes or more (observe only). */
{
  const p = [];
  const t = timeoutReport({ root: FX_PROJECT, automationRoot: 'Testing/Automation', configFiles: ['Testing/Automation/playwright.config.ts'] });
  eq(p, 'unlimited', t.unlimited.map((u) => u.setting + '=' + u.value), ['actionTimeout=0', 'navigationTimeout=missing']);
  eq(p, 'long deadlines', t.long, [{ key: 'TIMEOUTS.operations.nightly_import', ms: 900000 }]);
  eq(p, 'timeouts file', t.timeoutsFile, 'Testing/Automation/timeouts.ts');
  const v = parseTimeoutValues(fs.readFileSync(path.join(FX_PROJECT, 'Testing', 'Automation', 'timeouts.ts'), 'utf8'));
  eq(p, 'parsed keys', [v['test.default'], v['step.long'], v.action, v['operations.nightly_import'], v.watchdog_grace], [90000, 120000, 15000, 900000, 60000]);
  check('13 A15 timeout report', p, {});
}

/* 14 — Check 27: deterministic only with type-aware no-floating-promises; the project lint's floating promise is a FAIL. */
{
  const p = [];
  const typed = lintFacts([path.join(FX, 'eslint', 'typed')]);
  const plain = lintFacts([path.join(FX, 'eslint', 'plain')]);
  const none = lintFacts([path.join(FX_PROJECT, 'Testing', 'Automation')]);
  eq(p, 'typed', [typed.enabled, typed.typeAware, typed.floatingPromises], [true, true, true]);
  eq(p, 'plain', [plain.enabled, plain.typeAware, plain.floatingPromises], [true, false, false]);
  eq(p, 'no lint config', none.floatingPromises, false);
  process.env.FAKE_ESLINT = 'floating';
  const P7 = freshProject('p7');
  const r = await runChecks({ root: P7.proj, files: SCOPE, lint: true, eslint: path.join(FX, 'bin', 'fake-eslint.mjs'), runTool: undefined, tsc: path.join(FX, 'bin', 'fake-tsc.mjs'), noLedger: true });
  delete process.env.FAKE_ESLINT;
  eq(p, 'lint component', [r.compact.components.lint.status, r.compact.components.lint.floating], ['FAIL', 1]);
  check('14 Check 27 lint determinism and the lint component', p, {});
}

/* 15 — record: the vocabulary, a reason, evidence for verified-semantic, no credential; a duplicate is appended with a
   warning and the gate rejects it. */
{
  const p = [];
  const R = (x) => recordResult({ resultsRoot: P1.rr, snapshotId: sA.snapshotId, unit: 'scope', ...x });
  eq(p, 'unknown status refused', R({ checkId: '7', status: 'PASS', reason: 'looks fine to me' }).ok, false);
  eq(p, 'verified-semantic without evidence refused', R({ checkId: '7', status: 'verified-semantic', reason: 'read every assertion' }).ok, false);
  eq(p, 'credential-looking reason refused', R({ checkId: '7', status: 'unresolved', reason: 'password: hunter2 seen in a helper' }).ok, false);
  eq(p, 'unknown check refused', R({ checkId: '99', status: 'unresolved', reason: 'what is this check' }).ok, false);
  const before = readResults(resultsFile(P1.rr, sA.snapshotId)).length;
  const first = R({ checkId: '12', status: 'verified-semantic', reason: 'no conflict between TC-01 / TC-02 and REQ-001', evidence: ['Testing/Requirements/REQ-orders.md:1'] });
  eq(p, 'duplicate of the case-3 set is appended with a warning', [first.ok, first.warnings.some((w) => /duplicate/.test(w))], [true, true]);
  eq(p, 'one line appended', readResults(resultsFile(P1.rr, sA.snapshotId)).length, before + 1);
  const g = runGate({ resultsRoot: P1.rr, snapshotId: sA.snapshotId, checkpoint: 'A', dryRun: true });
  eq(p, 'the gate rejects the duplicate', [g.record.verdict, why(g.record)], ['BLOCKED', ['12|scope|duplicate']]);
  check('15 record validation and duplicate handling', p, {});
}

/* 16 — T-38 / B20: the harness cache key changes with every input and comes back when the input does. */
{
  const p = [];
  const SK = path.join(TMP, 'skill');
  fs.mkdirSync(path.join(SK, 'scripts', 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(SK, 'assets'), { recursive: true });
  const put = (rel, text) => fs.writeFileSync(path.join(SK, rel), text);
  put('SKILL.md', '---\nname: sample\nmetadata:\n  version: "9.9.9"\ndescription: sample\n---\n# sample\n');
  put('scripts/a.mjs', 'export const a = 1;\n');
  put('scripts/selftest-x.mjs', 'process.exit(0);\n');
  put('scripts/fixtures/f.txt', 'f\n');
  put('assets/t.txt', 't\n');
  const RT = { node: 'v20.0.0', platform: 'linux', arch: 'x64', tz: 'UTC' };
  const key = (o = {}) => harnessKey({ skillDir: SK, name: 'selftest-x.mjs', env: o.env || {}, runtime: o.runtime || RT }).key;
  const k0 = key();
  eq(p, 'version read', skillVersionOf(SK), '9.9.9');
  const mutate = (rel, text, label) => { const old = fs.existsSync(path.join(SK, rel)) ? fs.readFileSync(path.join(SK, rel), 'utf8') : null; put(rel, text); truthy(p, label + ' did not change the key', key() !== k0); if (old === null) fs.rmSync(path.join(SK, rel)); else put(rel, old); };
  mutate('scripts/a.mjs', 'export const a = 2;\n', 'implementation');
  mutate('scripts/selftest-x.mjs', 'process.exit(1);\n', 'harness');
  mutate('scripts/fixtures/f.txt', 'g\n', 'fixture');
  mutate('scripts/fixtures/golden.html', '<p>g</p>\n', 'a new golden');
  mutate('assets/t.txt', 'u\n', 'asset');
  mutate('package-lock.json', '{}\n', 'lockfile');
  mutate('SKILL.md', '---\nname: sample\nmetadata:\n  version: "9.9.10"\ndescription: sample\n---\n# sample\n', 'skill version');
  for (const [label, rt] of [['node', { ...RT, node: 'v22.0.0' }], ['platform', { ...RT, platform: 'win32' }], ['arch', { ...RT, arch: 'arm64' }], ['timezone', { ...RT, tz: 'Etc/GMT-4' }]]) truthy(p, label + ' did not change the key', key({ runtime: rt }) !== k0);
  truthy(p, 'LANG did not change the key', key({ env: { LANG: 'ar' } }) !== k0);
  truthy(p, 'a QA_ setting did not change the key', key({ env: { QA_MAX_WORKERS: '1' } }) !== k0);
  eq(p, 'the cache folder itself is not an input', key({ env: { QA_HARNESS_CACHE_DIR: path.join(TMP, 'elsewhere') } }), k0);
  eq(p, 'restored inputs → the same key', key(), k0);
  const cacheDir = path.join(TMP, 'hcache');
  const d1 = await harnessRun({ name: 'selftest-x.mjs', dryRun: true, skillDir: SK, env: {}, cacheDir, runtime: RT });
  eq(p, 'no cache → would run', [d1.cached, d1.wouldRun], [false, true]);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'link-qc-5-selftest-x.json'), JSON.stringify({ name: 'selftest-x.mjs', key: k0, passedAt: '2026-01-01T00:00:00.000Z' }));
  const d2 = await harnessRun({ name: 'selftest-x.mjs', dryRun: true, skillDir: SK, env: {}, cacheDir, runtime: RT });
  eq(p, 'exact key → cached pass', [d2.cached, d2.ok], [true, true]);
  put('scripts/a.mjs', 'export const a = 3;\n');
  const d3 = await harnessRun({ name: 'selftest-x.mjs', dryRun: true, skillDir: SK, env: {}, cacheDir, runtime: RT });
  eq(p, 'changed input → runs again', [d3.cached, d3.wouldRun], [false, true]);
  eq(p, 'a path is never a harness name', (await harnessRun({ name: '../x.mjs', dryRun: true, skillDir: SK, env: {}, cacheDir, runtime: RT })).ok, false);
  check('16 T-38 / B20 harness cache key and reuse', p, {});
}

/* 17 — CLI: one JSON object, --help documents the six subcommands, a gate without inputs is BLOCKED (exit 0; 2 with --strict). */
{
  const p = [];
  const call = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });
  const h = call(['--help']);
  try { const o = JSON.parse(h.stdout); eq(p, 'usage lines', o.usage.length, 6); } catch { p.push('--help is not one JSON object'); }
  const g = call(['gate']);
  eq(p, 'gate without inputs exits 0', g.status, 0);
  try { eq(p, 'gate without inputs', JSON.parse(g.stdout).verdict, 'BLOCKED'); } catch { p.push('gate output is not JSON'); }
  eq(p, '--strict exit', call(['gate', '--strict']).status, 2);
  check('17 CLI shape and exit codes', p, {});
}

/* 18 — B18 / B22 parity: references/expected-differences.md lists every check of CHECKS exactly once; its 2.0 columns are
   the code's (units per checkpoint, mapped rules, N/A predicate, never N/A); a row is `identical` exactly when it is
   structurally identical to its legacy row (same kind at the same checkpoints, no predicate, no never-N/A, no R / L unit);
   every cited ED is defined and every defined ED is cited. */
{
  const p = [];
  const regFile = path.join(here, '..', 'references', 'expected-differences.md');
  const text = fs.existsSync(regFile) ? fs.readFileSync(regFile, 'utf8').replace(/\r\n?/g, '\n') : '';
  if (!text) p.push('references/expected-differences.md is missing');
  const cells = (line) => line.split('|').slice(1, -1).map((s) => s.trim());
  const parity = text.split('\n').filter((l) => /^\| (\d+[ab]?) \| (M\+S|M|S) · /.test(l)).map(cells);
  const defined = new Set(text.split('\n').filter((l) => /^\| ED-\d+ \|/.test(l)).map((l) => cells(l)[0]));
  const cited = new Set();
  const seen = new Map();
  for (const r of parity) seen.set(r[0], (seen.get(r[0]) || 0) + 1);
  for (const c of CHECKS) if (seen.get(c.id) !== 1) p.push('check ' + c.id + ' listed ' + (seen.get(c.id) || 0) + ' times');
  for (const id of seen.keys()) if (!CHECKS.some((c) => c.id === id)) p.push('row ' + id + ' is not a check of CHECKS');
  const KIND = { 'M+S': 'MS', M: 'M', S: 'S' };
  for (const r of parity) {
    const c = CHECKS.find((x) => x.id === r[0]);
    if (!c) continue;
    const [, legacy, units, rules, na, never, verdict] = r;
    const want = 'A: ' + (c.A || '—') + ' · B: ' + (c.B || '—');
    if (units !== want) p.push(c.id + ' units "' + units + '" != code "' + want + '"');
    if (rules !== (c.rules.length ? String(c.rules.length) : '—')) p.push(c.id + ' rules ' + rules + ' != ' + c.rules.length);
    const naCode = c.na ? c.na : c.naPart ? 'part: ' + c.naPart : '—';
    if (na !== naCode) p.push(c.id + ' N/A "' + na + '" != code "' + naCode + '"');
    if (never !== (c.neverNA ? 'yes' : '—')) p.push(c.id + ' never-N/A "' + never + '" != code ' + c.neverNA);
    const [lk, lat] = legacy.split(' · ');
    const at = new Set(lat.split(','));
    const sameKind = (u, cp) => (at.has(cp) ? u === KIND[lk] : !u);
    const structural = sameKind(c.A, 'A') && sameKind(c.B, 'B') && !c.na && !c.naPart && !c.neverNA && !/[RL]/.test((c.A || '') + (c.B || ''));
    const eds = (verdict.match(/ED-\d+/g) || []);
    eds.forEach((e) => cited.add(e));
    if (verdict === 'identical' && !structural) p.push(c.id + ' marked identical but differs structurally (' + legacy + ' → ' + want + ')');
    if (verdict !== 'identical' && (structural || !/^differs: ED-\d+(, ED-\d+)*$/.test(verdict))) p.push(c.id + ' marked "' + verdict + '" — ' + (structural ? 'structurally identical' : 'not "differs: ED-n, …"'));
  }
  for (const e of ['ED-1', 'ED-2', 'ED-3']) cited.add(e); // the protocol rows apply to every check
  for (const e of cited) if (!defined.has(e)) p.push(e + ' cited but not defined');
  for (const e of defined) if (!cited.has(e)) p.push(e + ' defined but never cited');
  const counts = { identical: parity.filter((r) => r[6] === 'identical').length, differ: parity.filter((r) => r[6] !== 'identical').length };
  const m = text.match(/Totals: (\d+) identical · (\d+) differ/);
  if (!m || Number(m[1]) !== counts.identical || Number(m[2]) !== counts.differ) p.push('the Totals line does not match the table: ' + JSON.stringify(counts));
  if (!/\*\*Status: (PROPOSED|APPROVED)/.test(text)) p.push('no Status line');
  check('18 B18 / B22 parity register matches the catalogue (identical ⇔ structurally identical, every ED defined and cited)', p, counts);
}

/* 19 — record --batch: the semantic results recorded one call each and the SAME results as one batch give the identical
   gate (verdict, counts, rejections, every result); an invalid, stale, duplicate or contradictory entry — inside the batch
   or against a result already recorded — and a snapshot whose scope changed reject the WHOLE batch with nothing written;
   single-record mode is unchanged (case 15); the CLI. The detail carries the calls the batch saves on this fixture. */
{
  const p = [];
  const PI = freshProject('p-individual');
  const PB = freshProject('p-batch');
  const sI = snap(PI, 'A');
  const sBt = snap(PB, 'A');
  const set = fullSet('A', sI.snapshot);
  const mech = set.filter((r) => r.unit !== 'scope');
  const sem = set.filter((r) => r.unit === 'scope');
  writeResults(PI.rr, sI.snapshotId, mech);
  writeResults(PB.rr, sBt.snapshotId, mech);
  for (const r of sem) {
    const x = recordResult({ resultsRoot: PI.rr, snapshotId: sI.snapshotId, checkId: r.checkId, unit: r.unit, status: r.status, reason: r.reason, evidence: r.evidenceRef, executor: r.executor, at: r.at });
    if (!x.ok) p.push('individual ' + r.checkId + ': ' + x.errors.join('; '));
  }
  const entries = sem.map((r) => ({ check: r.checkId, unit: r.unit, status: r.status, reason: r.reason, evidence: r.evidenceRef, executor: r.executor }));
  const b = recordBatch({ resultsRoot: PB.rr, snapshotId: sBt.snapshotId, entries, at: sem[0].at });
  eq(p, 'batch accepted, every entry written', [b.ok, b.written, b.errors], [true, sem.length, []]);
  const view = (g) => ({ verdict: g.record.verdict, counts: g.record.counts, rejected: why(g.record), na: g.record.na, results: g.record.results.map(({ at, ...r }) => r) });
  const gI = runGate({ resultsRoot: PI.rr, snapshotId: sI.snapshotId, checkpoint: 'A', dryRun: true });
  const gB = runGate({ resultsRoot: PB.rr, snapshotId: sBt.snapshotId, checkpoint: 'A', dryRun: true });
  eq(p, 'individual records → PASS', gI.record.verdict, 'PASS');
  eq(p, 'batch ≡ individual records (gate)', view(gB), view(gI));
  eq(p, 'the same lines on disk', readResults(resultsFile(PB.rr, sBt.snapshotId)).map(({ at, _line, ...r }) => r), readResults(resultsFile(PI.rr, sI.snapshotId)).map(({ at, _line, ...r }) => r));

  // rejections: nothing written, whatever else in the batch was valid
  const PR = freshProject('p-reject');
  const sR = snap(PR, 'A');
  const f = resultsFile(PR.rr, sR.snapshotId);
  const lines = () => readResults(f).length;
  const good = entries.slice(0, 3);
  const spare = entries[3];
  const rejects = (label, batch, opts = {}, want = null) => {
    const before = lines();
    const r = recordBatch({ resultsRoot: PR.rr, snapshotId: sR.snapshotId, entries: batch, ...opts });
    eq(p, label + ': rejected, nothing written', [r.ok, r.written, lines()], [false, 0, before]);
    if (want && !r.errors.some((e) => want.test(e.error))) p.push(label + ': no error matching ' + want + ' in ' + JSON.stringify(r.errors));
    return r;
  };
  rejects('unknown check', [...good, { check: '99', unit: 'scope', status: 'unresolved', reason: 'no such check in the catalogue' }], {}, /unknown check/);
  rejects('invalid status', [...good, { ...spare, status: 'PASS' }], {}, /status must be/);
  rejects('verified-semantic without evidence', [...good, { ...spare, evidence: [] }], {}, /needs --evidence/);
  rejects('credential in a reason', [...good, { ...spare, status: 'unresolved', reason: 'password: hunter2 seen in a helper' }], {}, /credential/);
  rejects('stale entry', [...good, { ...spare, snapshot: 'ffffffffffffffff' }], {}, /^stale/);
  rejects('stale batch', good, { batchSnapshotId: 'ffffffffffffffff' }, /^stale/);
  rejects('duplicate inside the batch', [...good, good[0]], {}, /^duplicate/);
  rejects('contradictory inside the batch', [...good, { ...good[0], status: 'unresolved', reason: 'a second reviewer disagrees' }], {}, /^contradictory/);
  rejects('empty batch', [], {}, /no result/);
  rejects('scope changed after the snapshot', good, { rehashFn: () => ({ matched: false, differences: [{ section: 'files', key: SCOPE[0], was: 'a', now: 'b' }] }) }, /^stale: the snapshot no longer matches/);
  const first = recordBatch({ resultsRoot: PR.rr, snapshotId: sR.snapshotId, entries: good });
  eq(p, 'a valid batch after the rejections', [first.ok, first.written, lines()], [true, 3, 3]);
  rejects('duplicate of a recorded result', [spare, good[1]], {}, /^duplicate: results\.jsonl line/);
  rejects('contradictory with a recorded result', [spare, { ...good[2], status: 'unresolved', reason: 'reopened after the batch' }], {}, /^contradictory: results\.jsonl line/);
  eq(p, 'parseBatch forms', [parseBatch('[1]').entries.length, parseBatch('{"snapshot":"x","results":[]}').snapshotId, !!parseBatch('{"a":1}').error, !!parseBatch('nope').error], [1, 'x', true, true]);

  // the CLI: one JSON object; a rejected batch is ok:false (exit 0, 2 with --strict)
  const call = (args) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8' });
  const PC = freshProject('p-cli');
  const sC = snap(PC, 'A');
  const bf = path.join(PC.rr, 'artifacts', 'checks', sC.snapshotId, 'semantic-A.json');
  fs.writeFileSync(bf, JSON.stringify({ snapshot: sC.snapshotId, results: good }));
  const c1 = call(['record', '--results-root', PC.rr, '--snapshot', sC.snapshotId, '--batch', bf]);
  try { const o = JSON.parse(c1.stdout); eq(p, 'CLI batch', [o.ok, o.batch, o.written, c1.status], [true, true, 3, 0]); } catch { p.push('CLI batch output is not JSON: ' + c1.stdout + c1.stderr); }
  const c2 = call(['record', '--results-root', PC.rr, '--snapshot', sC.snapshotId, '--batch', bf, '--strict']);
  try { const o = JSON.parse(c2.stdout); eq(p, 'CLI repeated batch → duplicates, nothing written, --strict 2', [o.ok, o.written, c2.status, readResults(resultsFile(PC.rr, sC.snapshotId)).length], [false, 0, 2, 3]); } catch { p.push('CLI repeated batch output is not JSON'); }

  // the calls a checkpoint needs on this fixture: before one `record` per semantic result, now one `record --batch`
  const semB = requiredUnits('B', sB.snapshot.body.facts).filter((q) => q.unit === 'scope').length;
  const calls = { A: { before: 3 + sem.length, after: 4, semanticResults: sem.length }, B: { before: 4 + semB, after: 5, semanticResults: semB } };
  check('19 record --batch: ≡ individual records at the gate; any invalid / stale / duplicate / contradictory entry or a changed scope rejects the whole batch; CLI', p, { calls, note: 'A = snapshot + run + record(s) + gate; B = snapshot + run + run-data verify + record(s) + gate — per checkpoint pass, before any repair' });
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* a temp folder left behind is harmless */ }
const out = {
  tool: 'selftest-check',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'check.mjs disagrees with its fixtures — record the checkpoints by hand (compliance-checkpoints.md §5) until this passes.' : 'Every case behaves as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
