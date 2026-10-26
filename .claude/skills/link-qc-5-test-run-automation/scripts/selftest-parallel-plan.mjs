#!/usr/bin/env node
// selftest-parallel-plan.mjs — regression harness for parallel-plan.mjs (the Parallel Execution Readiness Check).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing self-test means the readiness check cannot be trusted:
// the hand-written run plan stays the plan of record and `--scheduler dispatch` must not be used.
//
// Each case copies fixtures/parallel-plan/{project,story} to a fresh temporary directory (optionally applies text
// mutations) and compares the payload with values worked out by hand from the fixture — see the fixture README for the
// claim of every TC and the expected classes, units, conflicts and plan.
//
// Run: node selftest-parallel-plan.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planParallel, tcClaims, SCHEMA_VERSION } from './parallel-plan.mjs';
import { claimsConflict } from './dispatch.mjs';
import { parseTcDocument, parseTestData, tcHash } from './tc-hash.mjs';
import { parseArgs, print } from './scan-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'parallel-plan');
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const sorted = (a) => [...a].sort(natural);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const temps = [];

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallel-plan-selftest-'));
  temps.push(dir);
  fs.cpSync(path.join(FIX, 'project'), path.join(dir, 'project'), { recursive: true });
  fs.cpSync(path.join(FIX, 'story'), path.join(dir, 'story'), { recursive: true });
  return { dir, root: path.join(dir, 'project'), story: path.join(dir, 'story') };
}

/** Replace exactly one occurrence of `from` in file; throws when it is absent or ambiguous. */
function mutate(file, from, to) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const at = text.indexOf(from);
  if (at < 0) throw new Error('mutation anchor not found in ' + path.basename(file) + ': ' + JSON.stringify(from.slice(0, 60)));
  if (text.indexOf(from, at + 1) >= 0) throw new Error('mutation anchor is ambiguous in ' + path.basename(file) + ': ' + JSON.stringify(from.slice(0, 60)));
  fs.writeFileSync(file, text.slice(0, at) + to + text.slice(at + from.length));
}

const inputs = (f) => ({
  root: f.root,
  tc: path.join(f.story, 'TEST-CASES-orders.md'),
  data: path.join(f.story, 'TEST-DATA-orders.md'),
  learning: path.join(f.story, 'project-learning.md'),
  runFile: path.join(f.story, '.runs', 'phase-1.json'),
});
const plan = (f, extra = {}) => planParallel({ ...inputs(f), ...extra });
const unitOf = (p, tc) => p.units.find((u) => u.tcs.includes(tc)) || null;
const conflictBetween = (p, a, b) => {
  const ua = unitOf(p, a), ub = unitOf(p, b);
  return p.conflicts.find((c) => (c.a === ua.id && c.b === ub.id) || (c.a === ub.id && c.b === ua.id)) || null;
};
const hasClaim = (claims, want) => claims.some((c) => Object.entries(want).every(([k, v]) => c[k] === v));

const cases = [];
function check(name, fn) {
  const problems = [];
  try { fn(problems); } catch (e) { problems.push('threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  cases.push({ name, verdict: problems.length ? 'FAIL' : 'PASS', problems });
}

const CLASS_OF = {
  'TC-03': 'parallel-ready', 'TC-05': 'parallel-ready', 'TC-32': 'parallel-ready', 'TC-40': 'parallel-ready', 'TC-41': 'parallel-ready',
  'TC-01': 'restricted', 'TC-02': 'restricted', 'TC-04': 'restricted', 'TC-06': 'restricted', 'TC-20': 'restricted', 'TC-21': 'restricted',
  'TC-30': 'restricted', 'TC-34': 'restricted', 'TC-35': 'restricted',
  'TC-10': 'ordered', 'TC-11': 'ordered', 'TC-12': 'ordered',
  'TC-33': 'barrier', 'TC-31': 'run-alone', 'TC-50': 'not-scheduled',
};

/* 1 — the baseline: classes, units, pool, conflicts and the readiness counts worked out by hand. */
check('1 baseline: classes, units in order, pool, conflicts, readiness counts', (p) => {
  const r = plan(copyFixture());
  if (r.outcome !== 'OK') { p.push('outcome ' + r.outcome + ': ' + r.reason); return; }
  if (r.schema !== SCHEMA_VERSION || r.mode !== 'readiness') p.push('schema / mode ' + r.schema + ' ' + r.mode);
  // the shadow comparison is opt-in: absent by default; --compare adds it and changes nothing else of the payload
  if ('candidatePlan' in r || 'comparison' in r) p.push('the shadow comparison is in the default payload');
  const sh = plan(copyFixture(), { compare: true });
  if (sh.mode !== 'shadow' || !sh.candidatePlan || !sh.comparison) p.push('--compare: mode ' + sh.mode + ', candidatePlan ' + !!sh.candidatePlan + ', comparison ' + !!sh.comparison);
  const core = (x) => JSON.stringify({ tcs: x.tcs, units: x.units, conflicts: x.conflicts, pool: x.pool, readiness: x.readiness, unlock: x.unlockSuggestions });
  if (core(sh) !== core(r)) p.push('--compare changed the readiness payload itself (units, conflicts, pool, classes or readiness)');
  for (const [tc, cls] of Object.entries(CLASS_OF)) if (!r.tcs[tc] || r.tcs[tc].class !== cls) p.push(tc + ' class ' + (r.tcs[tc] && r.tcs[tc].class) + ' != ' + cls);
  if (!same(Object.keys(r.tcs), Object.keys(CLASS_OF))) p.push('TCs ' + JSON.stringify(Object.keys(r.tcs)));
  const firstTcs = r.units.map((u) => u.tcs[0]);
  const wantFirst = ['TC-01', 'TC-02', 'TC-03', 'TC-05', 'TC-06', 'TC-10', 'TC-20', 'TC-04', 'TC-30', 'TC-31', 'TC-32', 'TC-33', 'TC-34', 'TC-35', 'TC-40'];
  if (JSON.stringify(firstTcs) !== JSON.stringify(wantFirst)) p.push('unit order ' + JSON.stringify(firstTcs));
  if (r.units.some((u, i) => u.id !== 'u' + (i + 1))) p.push('unit ids are not u1…u' + r.units.length);
  const rd = r.readiness;
  const wantClasses = { 'parallel-ready': 5, restricted: 9, ordered: 3, barrier: 1, 'run-alone': 1, 'not-scheduled': 1 };
  if (JSON.stringify(rd.classes) !== JSON.stringify(wantClasses)) p.push('classes ' + JSON.stringify(rd.classes));
  if (rd.total !== 20) p.push('total ' + rd.total);
  if (JSON.stringify(rd.units) !== JSON.stringify({ U1: 10, U2: 1, U3: 2, U4: 2, total: 15 })) p.push('units ' + JSON.stringify(rd.units));
  if (!same(r.pool.map((id) => r.units.find((u) => u.id === id).tcs[0]), ['TC-03', 'TC-05'])) p.push('pool ' + JSON.stringify(r.pool));
  if (rd.pool !== 2 || rd.conflicts !== 16 || rd.globalUnits !== 2 || rd.orderDependencies !== 2) p.push('pool / conflicts / global / order ' + [rd.pool, rd.conflicts, rd.globalUnits, rd.orderDependencies].join(' / '));
  if (r.conflicts.length !== 18) p.push('conflicts[] length ' + r.conflicts.length + ' (16 pairs + 2 global)');
  if (rd.candidateConcurrency !== 7 || rd.recommendedInitialWorkers !== 2) p.push('concurrency ' + rd.candidateConcurrency + ' / workers ' + rd.recommendedInitialWorkers);
  if (rd.expectedDuration.serialOnlyMs !== 195000 || rd.expectedDuration.knownUnits !== 5 || rd.expectedDuration.unknownUnits !== 10) p.push('expected duration ' + JSON.stringify(rd.expectedDuration));
  if (!(typeof rd.expectedDuration.plannedMs === 'number' && rd.expectedDuration.plannedMs > 0)) p.push('plannedMs ' + rd.expectedDuration.plannedMs);
  if (rd.unknownEffects !== 1) p.push('unknownEffects ' + rd.unknownEffects);
  const c14 = conflictBetween(r, 'TC-01', 'TC-04');
  if (!c14 || !c14.keys.includes('col:order')) p.push('TC-01 ↔ TC-04 conflict ' + JSON.stringify(c14));
  const c26 = conflictBetween(r, 'TC-02', 'TC-06');
  if (!c26 || !c26.keys.includes('learned:L1')) p.push('TC-02 ↔ TC-06 conflict ' + JSON.stringify(c26));
  const c35 = conflictBetween(r, 'TC-34', 'TC-35');
  if (!c35 || !c35.keys.includes('acct:A2')) p.push('TC-34 ↔ TC-35 conflict ' + JSON.stringify(c35));
  if (conflictBetween(r, 'TC-04', 'TC-06')) p.push('TC-04 and TC-06 both only aggregate orders — they must not conflict');
  if (conflictBetween(r, 'TC-01', 'TC-03')) p.push('TC-01 and TC-03 must not conflict');
  for (const tc of ['TC-31', 'TC-33']) if (!r.conflicts.some((c) => c.a === unitOf(r, tc).id && c.b === '*' && c.kind === 'exclusive')) p.push(tc + ' has no exclusive conflict entry');
  if (r.errors.length) p.push('errors ' + JSON.stringify(r.errors));
});

/* 2 — units (Revision 3.1 §3.4): chains and shared-hook groups are never split; contract violations and dynamic
   generation are U4; only U1 units reach the pool (T-11, T-13, T-15). */
check('2 units: U2 chain never split, U3 hook / worker fixture, U4 contract violation and dynamic generation', (p) => {
  const r = plan(copyFixture());
  const chain = unitOf(r, 'TC-10');
  if (!chain || !same(chain.tcs, ['TC-10', 'TC-11', 'TC-12']) || chain.type !== 'U2' || chain.class !== 'ordered' || chain.selector.describe !== 'Order lifecycle' || !chain.chain) p.push('chain unit ' + JSON.stringify(chain && { tcs: chain.tcs, type: chain.type, cls: chain.class, sel: chain.selector }));
  if (unitOf(r, 'TC-11') !== chain || unitOf(r, 'TC-12') !== chain) p.push('the chain is split');
  const deps = r.orderDependencies.map((d) => d.from + '>' + d.to + ':' + d.merged);
  if (!same(deps, ['TC-10>TC-11:false', 'TC-11>TC-12:false'])) p.push('order dependencies ' + JSON.stringify(deps));
  const shared = unitOf(r, 'TC-20');
  if (!shared || !same(shared.tcs, ['TC-20', 'TC-21']) || shared.type !== 'U3' || shared.selector.describe !== 'Shared order' || !shared.reasons.some((x) => /shared hook: beforeAll/.test(x))) p.push('shared-hook unit ' + JSON.stringify(shared && { tcs: shared.tcs, type: shared.type, reasons: shared.reasons }));
  const cat = unitOf(r, 'TC-40');
  if (!cat || !same(cat.tcs, ['TC-40', 'TC-41']) || cat.type !== 'U3' || !cat.reasons.some((x) => /shared worker fixture: catalog/.test(x)) || cat.class !== 'parallel-ready') p.push('worker-fixture unit ' + JSON.stringify(cat && { tcs: cat.tcs, type: cat.type, cls: cat.class, reasons: cat.reasons }));
  const u30 = unitOf(r, 'TC-30');
  if (!u30 || u30.type !== 'U4' || !u30.reasons.some((x) => /admission contract: test-scoped fixture seededOrder/.test(x) && /unitAdmission/.test(x))) p.push('TC-30 unit ' + JSON.stringify(u30 && { type: u30.type, reasons: u30.reasons }));
  if (!r.review.some((x) => /seededOrder/.test(x))) p.push('the contract violation is not in review[]');
  const u32 = unitOf(r, 'TC-32');
  if (!u32 || u32.type !== 'U4' || !u32.reasons.some((x) => /dynamic test generation/.test(x)) || u32.class !== 'parallel-ready') p.push('TC-32 unit ' + JSON.stringify(u32 && { type: u32.type, cls: u32.class, reasons: u32.reasons }));
  for (const id of r.pool) if (r.units.find((u) => u.id === id).type !== 'U1') p.push('pool holds a non-U1 unit ' + id);
  const u01 = unitOf(r, 'TC-01');
  if (!u01 || u01.type !== 'U1' || u01.selector.describe !== null || !same(u01.selector.tcs, ['TC-01']) || !same(u01.selector.specs, ['tests/Orders_Tests/01-orders-own.spec.ts'])) p.push('TC-01 unit selector ' + JSON.stringify(u01 && u01.selector));
  if (!same(u01.stages, ['smoke'])) p.push('TC-01 unit stages ' + JSON.stringify(u01.stages));
});

/* 3 — claims (Revision 3 §3.1-§3.2): fields, accounts, aggregates, background effects, global setting, unknown effect,
   the code's hooks and fixtures, the admission scopes. */
check('3 claims: fields, accounts, aggregates, background writers, settings, unknown effects, code, scopes', (p) => {
  const r = plan(copyFixture());
  const t = (tc) => r.tcs[tc].claims;
  if (!hasClaim(t('TC-01'), { key: 'col:order', mode: 'write', own: true, source: 'field' })) p.push('TC-01 own write col:order');
  if (!hasClaim(t('TC-01'), { key: 'acct:A1', mode: 'read' })) p.push('TC-01 read acct:A1');
  if (!hasClaim(t('TC-11'), { key: 'shared:lifecycle-order', mode: 'write' })) p.push('TC-11 shared claim');
  if (!t('TC-11').some((c) => c.key === 'col:order' && c.mode === 'write' && !c.own)) p.push('TC-11 non-own write col:order');
  if (!hasClaim(t('TC-12'), { key: 'col:order', mode: 'write' })) p.push('TC-12 write col:order');
  if (!hasClaim(t('TC-04'), { key: 'col:order', mode: 'aggregate-read' })) p.push('TC-04 aggregate col:order');
  if (!hasClaim(t('TC-02'), { key: 'col:product', mode: 'aggregate-read' }) || !hasClaim(t('TC-02'), { key: 'col:product@D1', mode: 'aggregate-read' }) || !hasClaim(t('TC-02'), { key: 'rec:D1', mode: 'read' })) p.push('TC-02 claims ' + JSON.stringify(t('TC-02').map((c) => c.key + ' ' + c.mode)));
  if (!hasClaim(t('TC-06'), { key: 'bg:audit@order', mode: 'aggregate-read' }) || !hasClaim(t('TC-06'), { key: 'col:order', mode: 'aggregate-read' })) p.push('TC-06 claims ' + JSON.stringify(t('TC-06').map((c) => c.key + ' ' + c.mode)));
  for (const tc of ['TC-01', 'TC-10', 'TC-20', 'TC-30']) if (!hasClaim(unitOf(r, tc).claims, { key: 'bg:audit@order', mode: 'write', own: true })) p.push(tc + ' unit lacks the background writer claim');
  if (hasClaim(unitOf(r, 'TC-40').claims, { key: 'bg:audit@order', mode: 'write' })) p.push('the catalog unit writes no order — no background writer claim');
  if (!hasClaim(t('TC-34'), { key: 'acct:A2', mode: 'write' }) || !hasClaim(t('TC-35'), { key: 'acct:A2', mode: 'read' })) p.push('A2 claims');
  if (!hasClaim(t('TC-33'), { key: '*', mode: 'exclusive', source: 'field' })) p.push('TC-33 barrier claim');
  if (!hasClaim(t('TC-31'), { key: '*', mode: 'exclusive', source: 'fail-safe' })) p.push('TC-31 run-alone claim');
  const u20 = unitOf(r, 'TC-20').claims;
  if (!u20.some((c) => c.key === 'col:order' && c.mode === 'write' && !c.own) || !hasClaim(u20, { key: 'rec:lit:order:shared order', mode: 'write' })) p.push('TC-20 unit hook claims ' + JSON.stringify(u20.map((c) => c.key + ' ' + c.mode + (c.own ? ' own' : ''))));
  if (!hasClaim(unitOf(r, 'TC-30').claims, { key: 'col:order', mode: 'write', own: true })) p.push('TC-30 unit lacks the seededOrder fixture claim');
  if (!hasClaim(unitOf(r, 'TC-40').claims, { key: 'col:catalog', mode: 'write', own: true })) p.push('catalog unit lacks the worker fixture claim');
  if (JSON.stringify(unitOf(r, 'TC-01').scopes) !== JSON.stringify(['account:A1', 'service:login'])) p.push('TC-01 scopes ' + JSON.stringify(unitOf(r, 'TC-01').scopes));
  if (JSON.stringify(unitOf(r, 'TC-34').scopes) !== JSON.stringify(['account:A2', 'service:login'])) p.push('TC-34 scopes ' + JSON.stringify(unitOf(r, 'TC-34').scopes));
  if (unitOf(r, 'TC-01').expectedMs !== 60000 || unitOf(r, 'TC-10').expectedMs !== 80000 || unitOf(r, 'TC-02').expectedMs !== null) p.push('expectedMs ' + [unitOf(r, 'TC-01').expectedMs, unitOf(r, 'TC-10').expectedMs, unitOf(r, 'TC-02').expectedMs].join(' / '));
});

/* 3b — tcClaims on its own: a language switch, a single-session account, a changed data item, an unnamed aggregate. */
check('3b tcClaims: language switch, single-session account, unscoped change, unnamed aggregate (fail safe)', (p) => {
  const doc = [
    '### TC-90 — Switch the language', '- **Steps:**', '  1. Login as Administrator [A1]', '  2. Switch the portal to Arabic', '  3. Check the menu', '- **Data effect:** read-only', '',
    '### TC-91 — Viewer session', '- **Steps:**', '  1. Login as Viewer [A3]', '  2. Open Reports', '- **Data effect:** read-only', '',
    '### TC-92 — Change a price', '- **Steps:**', '  1. Login as Administrator [A1]', '  2. Open the price list [D1]', '  3. Change the price of the first product', '- **Data effect:** modifies', '',
    '### TC-93 — Check a total', '- **Steps:**', '  1. Login as Administrator [A1]', '  2. Check the total', '- **Data effect:** read-only', '',
  ].join('\n');
  const data = parseTestData(['## 1. Accounts', '| ID | Role | Username | Status | Note |', '|---|---|---|---|---|', '| A1 | Administrator | admin.user | READY | — |', '| A3 | Viewer | viewer.user | READY | allows one session only (single session) |'].join('\n'));
  const tcs = Object.fromEntries(parseTcDocument(doc).map((t) => [t.id, tcClaims(t, data)]));
  if (!hasClaim(tcs['TC-90'].claims, { key: 'acct:A1', mode: 'write', source: 'inferred' })) p.push('TC-90 language switch ' + JSON.stringify(tcs['TC-90'].claims));
  if (!hasClaim(tcs['TC-91'].claims, { key: 'acct:A3', mode: 'write', source: 'field' })) p.push('TC-91 single session ' + JSON.stringify(tcs['TC-91'].claims));
  if (!hasClaim(tcs['TC-92'].claims, { key: 'col:price', mode: 'write' }) || tcs['TC-92'].claims.some((c) => c.key === 'col:price' && c.own)) p.push('TC-92 change ' + JSON.stringify(tcs['TC-92'].claims));
  if (!hasClaim(tcs['TC-93'].claims, { key: 'col:*', mode: 'aggregate-read', source: 'fail-safe' })) p.push('TC-93 unnamed aggregate ' + JSON.stringify(tcs['TC-93'].claims));
  if (tcs['TC-90'].effect.mode !== 'read-only' || tcs['TC-92'].effect.mode !== 'modifies' || tcs['TC-92'].effect.source !== 'field') p.push('effects ' + JSON.stringify([tcs['TC-90'].effect, tcs['TC-92'].effect]));
});

/* 3c — the skill 3 semantics of `Data effect` / `Shared data` (link-qc-3 tc-design.md "Data effect and Shared data"),
   one row of its table each: editing a record named by its token is a write on that record (kept apart from a TC that
   reads it, not from one that reads another record); own creators run together but never beside a "latest in the list"
   reader of that collection; `(depends on TC-x)` is an order dependency; a system setting is a barrier. */
check('3c skill 3 field semantics: token-named edit, own creates vs list reader, depends on, system setting', (p) => {
  const tc = (id, title, steps, effect, shared = '—') => ['### ' + id + ' — ' + title, '- **Steps:**', ...steps.map((s, i) => '  ' + (i + 1) + '. ' + s), '- **Data effect:** ' + effect, '- **Shared data:** ' + shared, ''];
  const doc = [
    ...tc('TC-80', 'Edit the sample order', ['Login as Administrator [A1]', 'Edit order "Sample" [D3]', 'Save the order'], 'modifies'),
    ...tc('TC-81', 'View the sample order', ['Login as Administrator [A1]', 'Open order "Sample" [D3]'], 'read-only'),
    ...tc('TC-82', 'View another order', ['Login as Administrator [A1]', 'Open order "Other" [D4]'], 'read-only'),
    ...tc('TC-83', 'Create an order', ['Login as Administrator [A1]', 'Create a new order "QA-1"'], 'creates'),
    ...tc('TC-84', 'Create another order', ['Login as Administrator [A1]', 'Create a new order "QA-2"'], 'creates'),
    ...tc('TC-85', 'Latest order first', ['Login as Administrator [A1]', 'Open the Orders list', 'Check the latest order is first'], 'read-only'),
    ...tc('TC-86', 'Continue the sample order', ['Login as Administrator [A1]', 'Open order "Sample" [D3]'], 'read-only', 'order "Sample" [D3] (depends on TC-80)'),
    ...tc('TC-87', 'Change the default currency', ['Login as Administrator [A1]', 'Open the system settings and change the default currency'], 'modifies'),
    ...tc('TC-88', 'Create and edit its own order', ['Login as Administrator [A1]', 'Create a new order "QA-3"', 'Edit order "Sample" [D3]'], 'creates'),
  ].join('\n');
  const data = parseTestData(['## 1. Accounts', '| ID | Role | Username | Status | Note |', '|---|---|---|---|---|', '| A1 | Administrator | admin.user | READY | — |'].join('\n'));
  const c = Object.fromEntries(parseTcDocument(doc).map((t) => [t.id, tcClaims(t, data)]));
  const conflict = (a, b) => claimsConflict(c[a].claims, c[b].claims).conflict;
  if (!hasClaim(c['TC-80'].claims, { key: 'rec:D3', mode: 'write' })) p.push('TC-80 edits [D3] without a write on rec:D3 ' + JSON.stringify(c['TC-80'].claims));
  if (!conflict('TC-80', 'TC-81')) p.push('editing [D3] must conflict with reading [D3]');
  if (conflict('TC-80', 'TC-82')) p.push('editing [D3] must not conflict with reading [D4]');
  if (conflict('TC-83', 'TC-84')) p.push('two own creators must not conflict');
  if (!c['TC-85'].claims.some((x) => x.mode === 'aggregate-read' && /^col:order/.test(x.key)) || !c['TC-83'].claims.some((x) => x.key === 'col:order' && x.own)) p.push('list reader / own creator claims ' + JSON.stringify([c['TC-85'].claims, c['TC-83'].claims]));
  if (JSON.stringify(c['TC-86'].after) !== JSON.stringify(['TC-80'])) p.push('depends on → after ' + JSON.stringify(c['TC-86'].after));
  if (!c['TC-87'].barrier) p.push('a system setting must be a barrier ' + JSON.stringify(c['TC-87']));
  if (!hasClaim(c['TC-88'].claims, { key: 'rec:D3', mode: 'write' }) || c['TC-88'].claims.some((x) => x.key === 'col:order@D3' && x.own)) p.push('own creator that edits [D3] — the edit is not its own record ' + JSON.stringify(c['TC-88'].claims));
});

/* 4 — learned conflicts (T-41): a TC whose hash changed since the conflict was learned marks it `revalidate` — still
   honoured; with the current hash stated it is `honoured`. */
check('4 learned conflicts: hash changed → revalidate, still honoured; current hash → honoured', (p) => {
  const f = copyFixture();
  const r = plan(f);
  if (r.learned.length !== 1) { p.push('learned ' + JSON.stringify(r.learned)); return; }
  const l = r.learned[0];
  if (l.id !== 'L1' || l.line !== 4 || !same(l.tcs, ['TC-02', 'TC-06']) || l.status !== 'revalidate' || !same(l.changed, ['TC-02'])) p.push('L1 ' + JSON.stringify(l));
  if (!conflictBetween(r, 'TC-02', 'TC-06')) p.push('the revalidate conflict is not honoured');
  if (!r.review.some((x) => /L1/.test(x) && /TC-02 changed/.test(x))) p.push('review lacks the revalidate note');
  if (!r.unlockSuggestions.some((u) => u.key === 'learned:L1')) p.push('no unlock suggestion for learned:L1');
  const tcText = fs.readFileSync(path.join(f.story, 'TEST-CASES-orders.md'), 'utf8');
  const data = parseTestData(fs.readFileSync(path.join(f.story, 'TEST-DATA-orders.md'), 'utf8'));
  const h02 = tcHash(parseTcDocument(tcText).find((t) => t.id === 'TC-02'), data).slice(0, 8);
  mutate(path.join(f.story, 'project-learning.md'), 'TC-02 (hash 00000000)', 'TC-02 (hash ' + h02 + ')');
  const r2 = plan(f);
  const l2 = r2.learned[0] || {};
  if (l2.status !== 'honoured' || (l2.changed || []).length) p.push('with the current hash: ' + JSON.stringify(l2));
  if (!conflictBetween(r2, 'TC-02', 'TC-06')) p.push('the honoured conflict is gone');
});

/* 5 — the candidate plan in today's run_plan shape and the comparison with the hand plan (shadow). */
check('5 candidate plan groups and the comparison with the hand plan (--compare, the opt-in shadow)', (p) => {
  const r = plan(copyFixture(), { compare: true });
  const g = r.candidatePlan.groups;
  const names = g.map((x) => x.name);
  if (JSON.stringify(names) !== JSON.stringify(['parallel', 'serial:order', 'serial:catalog', 'account:A2', 'serial:alone-tc-31', 'serial:barrier-tc-33'])) p.push('groups ' + JSON.stringify(names));
  const by = (n) => (g.find((x) => x.name === n) || { tcs: [] });
  if (!same(by('parallel').tcs, ['TC-03', 'TC-05', 'TC-32']) || by('parallel').workers !== 2 || by('parallel').mode !== 'parallel') p.push('parallel ' + JSON.stringify(by('parallel')));
  if (!same(by('serial:order').tcs, ['TC-01', 'TC-02', 'TC-04', 'TC-06', 'TC-10', 'TC-11', 'TC-12', 'TC-20', 'TC-21', 'TC-30'])) p.push('serial:order ' + JSON.stringify(by('serial:order').tcs));
  if (!same(by('serial:catalog').tcs, ['TC-40', 'TC-41']) || !same(by('account:A2').tcs, ['TC-34', 'TC-35'])) p.push('catalog / account groups');
  if (g.filter((x) => x.mode === 'serial').some((x) => x.workers !== 1)) p.push('a serial group has workers != 1');
  if (r.candidatePlan.decisions.length !== 19) p.push('decisions ' + r.candidatePlan.decisions.length);
  const c = r.comparison;
  if (!c.handPlan || c.compared !== 19 || c.agree !== 14) p.push('comparison counts ' + JSON.stringify({ handPlan: c.handPlan, compared: c.compared, agree: c.agree }));
  if (!same(c.differences.map((d) => d.tc), ['TC-01', 'TC-02', 'TC-06', 'TC-40', 'TC-41'])) p.push('differences ' + JSON.stringify(c.differences.map((d) => d.tc)));
  if (c.differences.some((d) => d.hand.mode !== 'parallel' || d.candidate.mode !== 'serial')) p.push('every difference is hand parallel → candidate serial');
  if (c.onlyHand.length || c.onlyCandidate.length) p.push('only-hand / only-candidate ' + JSON.stringify([c.onlyHand, c.onlyCandidate]));
  for (const k of ['*', 'acct:A2', 'col:order', 'learned:L1']) if (!r.unlockSuggestions.some((u) => u.key === k)) p.push('no unlock suggestion for ' + k);
  const colOrder = r.unlockSuggestions.find((u) => u.key === 'col:order');
  if (colOrder && !same(colOrder.tcs, ['TC-04', 'TC-06'])) p.push('col:order readers ' + JSON.stringify(colOrder.tcs));
});

/* 6 — the stage filter: units and conflicts are per stage. */
check('6 stage filter: negative and smoke stages', (p) => {
  const f = copyFixture();
  const n = plan(f, { stage: 'negative', compare: true });
  if (n.outcome !== 'OK' || !same(Object.keys(n.tcs), ['TC-34']) || n.tcs['TC-34'].class !== 'parallel-ready' || n.units.length !== 1 || n.pool.length !== 1) p.push('negative ' + JSON.stringify({ tcs: Object.keys(n.tcs), units: n.units.length, pool: n.pool }));
  if (!same(n.comparison.differences.map((d) => d.tc), ['TC-34']) || n.comparison.compared !== 1) p.push('negative comparison ' + JSON.stringify(n.comparison));
  const s = plan(f, { stage: 'smoke' });
  if (!same(Object.keys(s.tcs), ['TC-01']) || s.tcs['TC-01'].class !== 'parallel-ready' || s.pool.length !== 1) p.push('smoke ' + JSON.stringify({ tcs: Object.keys(s.tcs), pool: s.pool }));
  if (s.stage !== 'smoke') p.push('stage echo ' + s.stage);
});

/* 7 — a global setup with side effects runs in every child: every unit is U4 and units never overlap. */
check('7 global setup with side effects → every unit U4, nothing in the pool', (p) => {
  const f = copyFixture();
  mutate(path.join(f.root, 'playwright.config.ts'), "testDir: './tests',", "testDir: './tests',\n  globalSetup: './global-setup.ts',");
  fs.writeFileSync(path.join(f.root, 'global-setup.ts'), [
    "import { request } from '@playwright/test';",
    "import { createOrder } from './prerequest/orderPreRequest';",
    '',
    'export default async function globalSetup(): Promise<void> {',
    '  const api = await request.newContext();',
    "  await createOrder(api, 'Global order');",
    '}',
    '',
  ].join('\n'));
  const r = plan(f);
  if (r.outcome !== 'OK') { p.push('outcome ' + r.reason); return; }
  if (r.units.some((u) => u.type !== 'U4') || r.readiness.units.U4 !== 15) p.push('unit types ' + JSON.stringify(r.readiness.units));
  if (r.pool.length) p.push('pool ' + JSON.stringify(r.pool));
  if (r.tcs['TC-03'].class !== 'restricted') p.push('TC-03 class ' + r.tcs['TC-03'].class);
  if (!r.units.every((u) => u.claims.some((c) => c.key === 'global:setup' && c.mode === 'write'))) p.push('a unit lacks the global:setup claim');
  if (!r.review.some((x) => /globalSetup/.test(x))) p.push('review lacks the global setup note');
  if (r.tcs['TC-31'].class !== 'run-alone' || r.tcs['TC-33'].class !== 'barrier') p.push('global units keep their class');
});

/* 8 — the admission contract (T-11): a compliant fixture leaves the unit U1; without helpers/admission.ts it is not checked. */
check('8 admission contract: compliant fixture → U1; no helpers/admission.ts → not checked', (p) => {
  const a = copyFixture();
  mutate(path.join(a.root, 'fixtures', 'test.ts'), 'seededOrder: async ({ request }, use) => {', 'seededOrder: async ({ request, unitAdmission }, use) => {');
  const r = plan(a);
  if (unitOf(r, 'TC-30').type !== 'U1' || r.readiness.units.U4 !== 1 || r.readiness.units.U1 !== 11) p.push('compliant: ' + JSON.stringify({ t30: unitOf(r, 'TC-30').type, units: r.readiness.units }));
  if (!r.inputs.admissionContract) p.push('the contract should be checked');
  const b = copyFixture();
  fs.renameSync(path.join(b.root, 'helpers', 'admission.ts'), path.join(b.root, 'helpers', 'admission-fixtures.ts'));
  mutate(path.join(b.root, 'fixtures', 'test.ts'), "from '../helpers/admission';", "from '../helpers/admission-fixtures';");
  const r2 = plan(b);
  if (r2.inputs.admissionContract !== false || unitOf(r2, 'TC-30').type !== 'U1') p.push('without helpers/admission.ts: ' + JSON.stringify({ contract: r2.inputs.admissionContract, t30: unitOf(r2, 'TC-30').type }));
  if (unitOf(r2, 'TC-32').type !== 'U4') p.push('dynamic generation stays U4 without the contract');
});

/* 9 — learned interference from a run file, and an order dependency across units merged into one chain. */
check('9 run-file interference; an order dependency across units becomes one U2 chain', (p) => {
  const a = copyFixture();
  const rf = path.join(a.story, '.runs', 'phase-1.json');
  const j = JSON.parse(fs.readFileSync(rf, 'utf8'));
  j.parallel_checks = [{ tc: 'TC-03', stage: 'positive', group: 'parallel', outcome: 'interference', overlapped: ['TC-05'] }];
  fs.writeFileSync(rf, JSON.stringify(j, null, 2));
  const r = plan(a, { compare: true });
  const rl = r.learned.find((l) => l.id === 'R1');
  if (!rl || !same(rl.tcs, ['TC-03', 'TC-05']) || rl.status !== 'honoured') p.push('R1 ' + JSON.stringify(rl));
  if (r.tcs['TC-03'].class !== 'restricted' || r.tcs['TC-05'].class !== 'restricted' || r.pool.length) p.push('classes ' + r.tcs['TC-03'].class + ' / ' + r.tcs['TC-05'].class + ' pool ' + JSON.stringify(r.pool));
  const par = r.candidatePlan.groups.find((g) => g.name === 'parallel');
  if (!par || !same(par.tcs, ['TC-32'])) p.push('parallel group ' + JSON.stringify(par));
  if (!r.candidatePlan.groups.some((g) => g.name === 'serial:learned' && same(g.tcs, ['TC-03', 'TC-05']))) p.push('no serial:learned group');
  const b = copyFixture();
  const tcFile = path.join(b.story, 'TEST-CASES-orders.md');
  const text = fs.readFileSync(tcFile, 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('### TC-05');
  const at = text.indexOf('- **Shared data:** —', start);
  fs.writeFileSync(tcFile, text.slice(0, at) + '- **Shared data:** help text (depends on TC-03)' + text.slice(at + '- **Shared data:** —'.length));
  const r2 = plan(b);
  const u = unitOf(r2, 'TC-03');
  if (!u || unitOf(r2, 'TC-05') !== u || u.type !== 'U2' || !u.chain || u.class !== 'ordered' || u.selector.describe !== null) p.push('merged unit ' + JSON.stringify(u && { tcs: u.tcs, type: u.type, cls: u.class, sel: u.selector }));
  if (!u.reasons.some((x) => /order dependency: TC-03 → TC-05/.test(x))) p.push('merged unit reason ' + JSON.stringify(u.reasons));
  if (r2.units.length !== 14 || r2.pool.length) p.push('units ' + r2.units.length + ' pool ' + JSON.stringify(r2.pool));
  const merged = r2.orderDependencies.filter((d) => d.merged).map((d) => d.from + '>' + d.to);
  if (r2.orderDependencies.length !== 3 || !same(merged, ['TC-03>TC-05'])) p.push('order dependencies ' + JSON.stringify(r2.orderDependencies));
  if (r2.tcs['TC-03'].class !== 'ordered' || r2.tcs['TC-05'].class !== 'ordered') p.push('merged classes');
});

/* 10 — fail safe without a TC document; code impact.mjs cannot follow runs alone. */
check('10 fail safe: no TC document → every TC run-alone; unfollowable code → run-alone', (p) => {
  const f = copyFixture();
  const r = planParallel({ root: f.root, runFile: path.join(f.story, '.runs', 'phase-1.json') });
  if (r.outcome !== 'OK') { p.push('outcome ' + r.reason); return; }
  if (Object.keys(r.tcs).length !== 19 || Object.values(r.tcs).some((t) => t.class !== 'run-alone') || r.pool.length) p.push('no document: ' + JSON.stringify({ n: Object.keys(r.tcs).length, classes: [...new Set(Object.values(r.tcs).map((t) => t.class))], pool: r.pool }));
  if (!r.warnings.some((w) => /no TC document/.test(w))) p.push('no warning for the missing document');
  const g = copyFixture();
  mutate(path.join(g.root, 'tests', 'Orders_Tests', '01-orders-own.spec.ts'), 'await info.openAbout();', "const action = 'openAbout';\n    await (info as any)[action]();");
  const r2 = plan(g);
  const t5 = r2.tcs['TC-05'];
  if (!t5 || t5.class !== 'run-alone' || !unitOf(r2, 'TC-05').claims.some((c) => c.mode === 'exclusive' && /cannot be followed statically/.test(c.evidence))) p.push('TC-05 with dynamic access ' + JSON.stringify(t5 && { cls: t5.class }));
});

/* 11 — BLOCKED inputs, the CLI, --out (the only write) and the exit codes. */
check('11 BLOCKED inputs; CLI --out writes the payload; exit 0, --strict 2 on BLOCKED', (p) => {
  if (planParallel({}).outcome !== 'BLOCKED') p.push('no root must be BLOCKED');
  if (planParallel({ root: path.join(os.tmpdir(), 'no-such-root-' + process.pid) }).outcome !== 'BLOCKED') p.push('missing root must be BLOCKED');
  const f = copyFixture();
  if (plan(f, { stage: 'final' }).outcome !== 'BLOCKED') p.push('a bad stage must be BLOCKED');
  if (plan(f, { tc: path.join(f.story, 'missing.md') }).outcome !== 'BLOCKED') p.push('a missing TC document must be BLOCKED');
  const script = path.join(here, 'parallel-plan.mjs');
  const out = path.join(f.dir, 'plan', 'parallel-plan.json');
  const i = inputs(f);
  const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
  const ok = run('--root', i.root, '--tc', i.tc, '--data', i.data, '--learning', i.learning, '--run-file', i.runFile, '--out', out);
  const okJ = ok.status === 0 ? JSON.parse(ok.stdout) : null;
  if (!okJ || okJ.outcome !== 'OK' || !okJ.writes || !fs.existsSync(out)) p.push('CLI --out: ' + (ok.stdout || ok.stderr).slice(0, 200));
  else if (JSON.parse(fs.readFileSync(out, 'utf8')).units.length !== 15) p.push('the written plan does not hold the 15 units');
  const bad = run('--root', path.join(f.dir, 'nope'), '--strict');
  if (bad.status !== 2 || JSON.parse(bad.stdout).outcome !== 'BLOCKED') p.push('--strict BLOCKED exit ' + bad.status);
  const h = run('--help');
  if (h.status !== 0 || !/parallel-plan/.test(h.stdout)) p.push('--help');
});

for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
const verdict = cases.every((c) => c.verdict === 'PASS') ? 'PASS' : 'FAIL';
print({ tool: 'selftest-parallel-plan', cases, verdict }, args);
process.exit(verdict === 'PASS' ? 0 : 1);
