#!/usr/bin/env node
// selftest-impact.mjs — regression harness for impact.mjs (the targeted re-run selector).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing self-test means the impact selection
// cannot be trusted: the skill must then re-run every TC instead of the selected subset.
//
// Each case copies fixtures/impact/project/ to a fresh temporary directory, applies one text mutation,
// fingerprints before and after, and compares the set of TCs whose fingerprint changed with the expected
// set — exactly, so both an under-selection (a missed impact) and an over-selection (lost precision) fail.
// The select cases write synthetic run-stage summaries to a temporary progress directory.
//
// Run: node selftest-impact.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprintTests, selectStale, closureOf, reverseDependencies, SCHEMA_VERSION } from './impact.mjs';
import { parseArgs, print } from './scan-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures', 'impact');
const PROJECT = path.join(FIX, 'project');
const IN_SCOPE = ['tests/Orders_Tests/00-setup-order-items.spec.ts', 'tests/Orders_Tests/01-orders.spec.ts', 'tests/Orders_Tests/03-orders-dashboard.spec.ts'];
const ALL01 = ['TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08'];
const ALL = [...ALL01, 'TC-09', 'TC-10', 'TC-90', 'TC-91'];
const SAVE_CALLERS = ['TC-01', 'TC-03', 'TC-05', 'TC-06', 'TC-90'];
const RUN_PLAN = {
  setup_groups: [{ name: 'setup:orders', mode: 'serial', workers: 1, spec: 'tests/Orders_Tests/00-setup-order-items.spec.ts' }],
  groups: [
    { name: 'parallel', mode: 'parallel', workers: 2, tcs: ['TC-01', 'TC-02', 'TC-03', 'TC-05', 'TC-06', 'TC-07', 'TC-08', 'TC-09', 'TC-10'] },
    { name: 'serial:orders', mode: 'serial', workers: 1, tcs: ['TC-04'] },
  ],
};

const natural = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const sorted = (a) => [...a].sort(natural);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const temps = [];

function copyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-selftest-'));
  temps.push(dir);
  const root = path.join(dir, 'project');
  fs.cpSync(PROJECT, root, { recursive: true });
  return root;
}

/** Replace exactly one occurrence of `from` in root/file; throws when it is absent or ambiguous. */
function mutate(root, file, from, to) {
  const abs = path.join(root, file);
  const text = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  const at = text.indexOf(from);
  if (at < 0) throw new Error('mutation anchor not found in ' + file + ': ' + JSON.stringify(from.slice(0, 60)));
  if (text.indexOf(from, at + 1) >= 0) throw new Error('mutation anchor is ambiguous in ' + file + ': ' + JSON.stringify(from.slice(0, 60)));
  fs.writeFileSync(abs, text.slice(0, at) + to + text.slice(at + from.length));
}

const fp = (root, opts = {}) => fingerprintTests({ root, cache: new Map(), ...opts });

function changedTcs(before, after) {
  const out = new Set();
  for (const tc of new Set([...Object.keys(before.tcs), ...Object.keys(after.tcs)]))
    if (!before.tcs[tc] || !after.tcs[tc] || before.tcs[tc].fingerprint !== after.tcs[tc].fingerprint) out.add(tc);
  return sorted(out);
}

let baselineCache = null;
function baseline() {
  if (!baselineCache) baselineCache = fp(copyProject());
  return baselineCache;
}

const cases = [];
function check(name, fn) {
  const problems = [];
  let detail;
  try { detail = fn(problems); } catch (e) { problems.push('threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  cases.push({ name, verdict: problems.length ? 'FAIL' : 'PASS', problems, ...(detail && problems.length ? { detail } : {}) });
}

/** A mutation case: the TCs whose fingerprint changed must equal `expected` exactly. */
function impactCase(name, mutations, expected, opts = {}) {
  check(name, (p) => {
    const root = copyProject();
    const before = opts.before ? opts.before(root) : (opts.fpOpts ? fp(root, opts.fpOpts) : baseline());
    for (const [file, from, to] of mutations) mutate(root, file, from, to);
    const after = fp(root, opts.fpOpts || {});
    const got = changedTcs(before, after);
    if (!same(got, expected)) p.push('changed TCs ' + JSON.stringify(got) + ' != expected ' + JSON.stringify(sorted(expected)));
    const unknown = Object.entries(after.tcs).filter(([, v]) => v.unknown.length).map(([k]) => k);
    if (!opts.allowUnknown && unknown.length) p.push('unexpected unknown TCs: ' + unknown.join(', '));
    if (opts.extra) opts.extra(p, before, after);
    return { got, expected: sorted(expected) };
  });
}

/** A run-stage summary as run-stage.mjs writes it, built from a fingerprint snapshot. */
function summary(snap, { run = 'first', stage, seq = 1, startedAt, tcs, reasons = {}, executed = Object.keys(tcs), code = true, changedDuringCall = [], tamper = {} }) {
  const out = { tool: 'run-stage', run, stage, seq, startedAt, finishedAt: startedAt, tcs, reasons, executed: {} };
  for (const tc of executed) out.executed[tc] = { status: tcs[tc] || 'PASS', command: 'normal', attempt: 1, group: 'parallel' };
  if (code) {
    const c = { schema: snap.schema, tcs: {}, tests: {}, files: snap.files, changed_during_call: changedDuringCall, error: null };
    for (const tc of executed) {
      const t = snap.tcs[tc];
      if (!t) continue;
      c.tcs[tc] = { fingerprint: tamper[tc] || t.fingerprint, tests: t.tests, unknown: t.unknown };
      for (const id of t.tests) c.tests[id] = { fingerprint: snap.tests[id].fingerprint, parts: snap.tests[id].parts };
    }
    out.code = c;
  }
  return out;
}

function writeSummaries(list) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impact-progress-'));
  temps.push(dir);
  for (const s of list) fs.writeFileSync(path.join(dir, s.run + '-' + s.stage + '-' + s.seq + '.summary.json'), JSON.stringify(s, null, 2));
  fs.writeFileSync(path.join(dir, 'first-smoke-1.json'), '{"not":"a summary"}');   // other JSON files are ignored
  return dir;
}

const tcsOf = (list) => list.map((x) => (typeof x === 'string' ? x : x.tc));
const allPass = (ids) => Object.fromEntries(ids.map((t) => [t, 'PASS']));

/* 1 — deterministic baseline: same bytes twice and from another directory; every TC fingerprinted, none unknown, reach precise. */
check('1 deterministic baseline, every TC fingerprinted, no unknown, precise reach', (p) => {
  const r1 = copyProject();
  const a = fp(r1);
  const b = fp(r1);
  if (JSON.stringify(a) !== JSON.stringify(b)) p.push('two fingerprints of the same tree differ');
  const c = fp(copyProject());
  for (const tc of ALL) if (!c.tcs[tc] || c.tcs[tc].fingerprint !== (a.tcs[tc] || {}).fingerprint) p.push(tc + ' fingerprint depends on the directory');
  if (a.schema !== SCHEMA_VERSION) p.push('schema ' + a.schema);
  if (!same(Object.keys(a.tcs), ALL)) p.push('TCs ' + JSON.stringify(Object.keys(a.tcs)));
  for (const [tc, v] of Object.entries(a.tcs)) {
    if (!/^[0-9a-f]{64}$/.test(v.fingerprint)) p.push(tc + ' fingerprint is not a sha256');
    if (!v.tests.length) p.push(tc + ' has no test');
    if (v.unknown.length) p.push(tc + ' unknown: ' + v.unknown.join('; '));
  }
  if (a.warnings.length) p.push('warnings on the clean fixture: ' + a.warnings.join('; '));
  if (a.tcs['TC-07'].tests.length !== 2 || a.tcs['TC-08'].tests.length !== 1) p.push('TC-07 must carry 2 tests, TC-08 1');
  const parts = (tc) => new Set(a.tcs[tc].tests.flatMap((id) => Object.keys(a.tests[id].parts)));
  const has = (tc, id, want = true) => { if (parts(tc).has(id) !== want) p.push(tc + (want ? ' lacks ' : ' must not have ') + id); };
  has('TC-02', 'member:pages/OrderPage.ts#OrderPage.cancel');
  has('TC-02', 'member:pages/OrderPage.ts#OrderPage.save', false);
  has('TC-01', 'timeouts:operations.save');
  has('TC-02', 'timeouts:operations.save', false);
  has('TC-02', 'timeouts:test.default');
  has('TC-05', 'member:pages/ArchivedOrderPage.ts#ArchivedOrderPage.goto');
  has('TC-05', 'member:pages/OrderPage.ts#OrderPage.goto', false);
  has('TC-10', 'member:pages/BasePage.ts#BasePage.open', false);
  has('TC-91', 'member:pages/OrderPage.ts#OrderPage.save', false);
  has('TC-04', 'data:helpers/data/orders.json');
  has('TC-06', 'fixture:fixtures/test.ts#orderPage');
  has('TC-06', 'fixture:fixtures/test.ts#signedIn');
  has('TC-01', 'hook:tests/Orders_Tests/01-orders.spec.ts::Orders — create::beforeEach#1');
  has('TC-01', 'playwright:version');
  has('TC-09', 'module:pages/ArchivedOrderPage.ts', false);
  return { tcs: Object.keys(a.tcs) };
});

/* 2 — a method body change selects only the tests that reach the method. */
impactCase('2 method body change selects only its callers',
  [['pages/OrderPage.ts', 'await this.quantityInput.fill(String(quantity));', 'await this.quantityInput.fill(String(quantity));\n    await this.quantityInput.press(\'Tab\');']],
  ['TC-01', 'TC-02', 'TC-03', 'TC-06']);

/* 3 — a locator field change selects only the methods using it, then their tests. */
impactCase('3 locator field change selects methods using it, then their tests',
  [['pages/OrderPage.ts', "page.getByRole('button', { name: 'Cancel' })", "page.getByRole('button', { name: 'Cancel', exact: true })"]],
  ['TC-02']);

/* 4 — comment-only and whitespace-only edits select nothing. */
impactCase('4 comment-only and whitespace-only edits select nothing', [
  ['pages/OrderPage.ts', '  async save(): Promise<void> {\n    await this.saveButton.click();', '  // Saves the form and waits for the banner.\n  async save():    Promise<void>\n  {\n\n        await   this.saveButton.click(); /* the one save button */'],
  ['helpers/steps.ts', 'return test.step(name, body, { timeout });', '\n\n  return test.step(name,body,{timeout}) ; // deadline per step'],
  ['tests/Orders_Tests/01-orders.spec.ts', "await orders.createOrder('Sample Customer', 2);", "// create the order\n    await orders.createOrder( 'Sample Customer' , 2 );"],
  ['timeouts.ts', 'operations: { save: 20_000, search: 12_000 },', 'operations: {\n    save: 20_000, // the slowest operation\n    search: 12_000,\n  },'],
], []);

/* 5 — scheduling-only edits (@run: tags, describe.configure mode) select nothing. */
impactCase('5 @run: tag and describe.configure mode edits select nothing', [
  ['tests/Orders_Tests/01-orders.spec.ts', "{ tag: ['@smoke', '@run:parallel'] }", "{ tag: ['@run:serial-orders', '@smoke'] }"],
  ['tests/Orders_Tests/01-orders.spec.ts', "{ tag: ['@positive', '@run:serial-orders'] }", "{ tag: ['@positive'] }"],
  ['tests/Orders_Tests/01-orders.spec.ts', "test.describe.configure({ mode: 'parallel' });", "test.describe.configure({ mode: 'serial' });"],
  ['tests/Orders_Tests/01-orders.spec.ts', '[TC-05] Validate that an archived order can be restored', '[TC-05] Validate that an archived order can be restored @run:serial-archive'],
], []);

/* 6 — a test body change selects that TC only. */
impactCase('6 test body change selects that TC only',
  [['tests/Orders_Tests/01-orders.spec.ts', "page.getByRole('heading', { name: 'Orders' })", "page.getByRole('heading', { name: 'Orders list' })"]],
  ['TC-02']);

/* 7 — a describe hook change selects every TC in that describe. */
impactCase('7 describe hook change selects every TC of the describe',
  [['tests/Orders_Tests/01-orders.spec.ts', 'loginPage = new LoginPage(page);', "loginPage = new LoginPage(page);\n    await page.goto('/');"]],
  ['TC-01', 'TC-02', 'TC-03']);

/* 8 — a spec-level constant table selects the TCs of the file; a describe-level one those of the describe. */
impactCase('8a spec-level constant table change selects the TCs of the file',
  [['tests/Orders_Tests/01-orders.spec.ts', "{ label: 'ten items', quantity: 10 }", "{ label: 'ten items', quantity: 12 }"]],
  ALL01);
impactCase('8b describe-level constant change selects the TCs of the describe',
  [['tests/Orders_Tests/01-orders.spec.ts', "const ARCHIVE_NOTE = 'archived by the suite';", "const ARCHIVE_NOTE = 'archived by the test suite';"]],
  ['TC-04', 'TC-05']);

/* 9 — a helper module (no class) change selects every importer. */
impactCase('9 helper module change selects all importers',
  [['helpers/format.ts', "return customer + ' x ' + quantity;", "return customer + ' × ' + quantity;"]],
  [...ALL01, 'TC-90', 'TC-91']);

/* 10 — page objects imported through the barrel (export { X } from / export * from). */
impactCase('10a member reached through the barrel (export { X } from) selects its caller only',
  [['pages/ArchivedOrderPage.ts', 'await this.restoreButton.click();', 'await this.restoreButton.dblclick();']],
  ['TC-05']);
impactCase('10b module remainder of a barrel target selects the importers of the barrel',
  [['pages/ArchivedOrderPage.ts', "const ARCHIVE_ROUTE = '/orders/archived';", "const ARCHIVE_ROUTE = '/orders/archive';"]],
  ALL01);
impactCase('10c member reached through export * selects its caller only',
  [['pages/components/DataTable.ts', ".locator('td').nth(column)", ".locator('td, th').nth(column)"]],
  ['TC-07']);

/* 11 — a class imported through a tsconfig paths alias is resolved precisely. */
impactCase('11 member of an alias-imported class selects its importer test only',
  [['pages/OrderPage.ts', 'await this.customerInput.fill(order.customer);', 'await this.customerInput.fill(order.customer.trim());']],
  ['TC-04']);

/* 12 — dynamic access and imports that cannot be resolved make the test unknown — always stale. */
check('12 unresolvable alias / bare import and dynamic access → unknown, always stale', (p) => {
  const root = copyProject();
  fs.mkdirSync(path.join(root, 'tests', 'Dynamic_Tests'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'extra', '04-dynamic.spec.ts'), path.join(root, 'tests', 'Dynamic_Tests', '04-dynamic.spec.ts'));
  mutate(root, 'tests/Orders_Tests/03-orders-dashboard.spec.ts', "import { DashboardPage } from '../../pages/DashboardPage';", "import { DashboardPage } from '../../pages/DashboardPage';\nimport { MissingPage } from '@pages/MissingPage';\nimport { sharedThing } from '@shared/thing';");
  const after = fp(root);
  const unknown = sorted(Object.entries(after.tcs).filter(([, v]) => v.unknown.length).map(([k]) => k));
  if (!same(unknown, ['TC-09', 'TC-10', 'TC-80'])) p.push('unknown TCs ' + JSON.stringify(unknown) + ' != ["TC-09","TC-10","TC-80"]');
  const r80 = (after.tcs['TC-80'] || { unknown: [] }).unknown.join(' ');
  if (!/dynamic member access/.test(r80)) p.push('TC-80 reason does not name the dynamic access: ' + r80);
  const r09 = (after.tcs['TC-09'] || { unknown: [] }).unknown.join(' ');
  if (!/@pages\/MissingPage/.test(r09) || !/@shared\/thing/.test(r09)) p.push('TC-09 reasons do not name both unresolved imports: ' + r09);
  if (after.tcs['TC-81'] && after.tcs['TC-81'].unknown.length) p.push('TC-81 (static call) must not be unknown');
  // select: a TC whose fingerprint did not change is still stale while it is unknown
  const progress = writeSummaries([summary(after, { stage: 'positive', startedAt: '2026-10-19T10:00:00.000Z', tcs: allPass(Object.keys(after.tcs)) })]);
  const sel = selectStale({ root, progressDir: progress });
  for (const tc of ['TC-09', 'TC-10', 'TC-80']) if (!tcsOf(sel.stale).includes(tc)) p.push(tc + ' not stale although unknown');
  if (!same(tcsOf(sel.unknown), ['TC-09', 'TC-10', 'TC-80'])) p.push('select unknown[] ' + JSON.stringify(tcsOf(sel.unknown)));
  if (tcsOf(sel.stale).includes('TC-81')) p.push('TC-81 stale although nothing changed');
  return { unknown, stale: tcsOf(sel.stale) };
});

/* 13 — TIMEOUTS at key level: a key reached by code → those TCs; a config-referenced key → every TC; an unreferenced key → none. */
impactCase('13a timeouts operations.save selects only the TCs reaching it',
  [['timeouts.ts', 'save: 20_000', 'save: 25_000']], SAVE_CALLERS);
impactCase('13b config-referenced timeouts key (test.default) selects every TC',
  [['timeouts.ts', 'test: { default: 90_000', 'test: { default: 120_000']], ALL);
impactCase('13c unreferenced timeouts key selects nothing',
  [['timeouts.ts', 'search: 12_000', 'search: 15_000']], []);

/* 14 — inheritance: base member → every caller incl. subclass callers; a subclass override → the callers that may hold that
   subclass (an exact `new X(…)` value of the base class never does; a base-typed value always may — 14e / 14f). */
impactCase('14a base class member change selects subclass callers too (OrderPage.save via ArchivedOrderPage.restore)',
  [['pages/OrderPage.ts', 'await this.saveButton.click();', 'await this.saveButton.click({ force: true });']], SAVE_CALLERS);
impactCase('14b grand-base member change (BasePage.open) selects every caller through the chain',
  [['pages/BasePage.ts', 'await this.page.goto(route);', "await this.page.goto(route, { waitUntil: 'load' });"]],
  ['TC-01', 'TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08', 'TC-09', 'TC-90']);
impactCase('14c subclass override change selects only the subclass callers',
  [['pages/ArchivedOrderPage.ts', 'await this.open(ARCHIVE_ROUTE);', "await this.open(ARCHIVE_ROUTE + '?view=all');"]], ['TC-05']);
impactCase('14d overridden base method change does not select the subclass callers',
  [['pages/OrderPage.ts', 'await this.open(this.route);', "await this.open(this.route + '?view=all');"]],
  ['TC-04', 'TC-06', 'TC-07', 'TC-08', 'TC-90']);

// TC-02's `orders` comes from openOrders(): Promise<OrderPage> — base-typed, so it may hold an ArchivedOrderPage
// (in 01's closure). TC-10 makes the same call, but ArchivedOrderPage is not in 03's import closure: it cannot hold one.
impactCase('14e base-typed receiver: a subclass override change selects the callers holding a base-typed value too',
  [['pages/ArchivedOrderPage.ts', 'await this.open(ARCHIVE_ROUTE);', "await this.open(ARCHIVE_ROUTE + '?view=all');"]], ['TC-02', 'TC-05'],
  { before: (root) => {
    mutate(root, 'tests/Orders_Tests/01-orders.spec.ts', "await step('Fill and cancel the form'", "await orders.goto();\n    await step('Fill and cancel the form'");
    mutate(root, 'tests/Orders_Tests/03-orders-dashboard.spec.ts', "  await orders.table.sortBy('Date');", "  await orders.goto();\n  await orders.table.sortBy('Date');");
    return fp(root); } });
impactCase('14f a base method called on a base-typed value also reaches the overrides of the methods it calls on this',
  [['pages/ArchivedOrderPage.ts', 'await this.open(ARCHIVE_ROUTE);', "await this.open(ARCHIVE_ROUTE + '?view=all');"]], ['TC-02', 'TC-05'],
  { before: (root) => {
    mutate(root, 'pages/OrderPage.ts', '  async rowCount(): Promise<number> {', '  async reopen(): Promise<void> {\n    await this.goto();\n  }\n\n  async rowCount(): Promise<number> {');
    mutate(root, 'tests/Orders_Tests/01-orders.spec.ts', "await step('Fill and cancel the form'", "await orders.reopen();\n    await step('Fill and cancel the form'");
    return fp(root); } });

/* 15 — test.extend fixtures: a fixture body (or a fixture it depends on) selects the tests using it. */
impactCase('15a fixture body change selects the tests using the fixture',
  [['fixtures/test.ts', 'await use(orders);', 'await orders.table.count();\n    await use(orders);']], ['TC-06']);
impactCase('15b dependency fixture change selects the tests using the dependent fixture',
  [['fixtures/test.ts', "await login.login('admin.user',", "await login.login('admin.other',"]], ['TC-06']);

/* 16 — method return types carry the receiver type down a chain (login() → DashboardPage → openOrders()). */
impactCase('16a member reached through a return-type chain selects its callers',
  [['pages/DashboardPage.ts', 'await this.ordersLink.click();', 'await this.ordersLink.dblclick();']],
  ['TC-01', 'TC-02', 'TC-03', 'TC-10']);
impactCase('16b the same chain without a return annotation is followed through `return new X(…)`',
  [['pages/DashboardPage.ts', 'await this.ordersLink.click();', 'await this.ordersLink.dblclick();']],
  ['TC-01', 'TC-02', 'TC-03', 'TC-10'],
  { before: (root) => { mutate(root, 'pages/LoginPage.ts', 'async login(user: string, phrase: string): Promise<DashboardPage> {', 'async login(user: string, phrase: string) {'); return fp(root); } });

/* 17 — a data file referenced by a path literal selects its test. */
impactCase('17 data file referenced by a path literal selects that TC',
  [['helpers/data/orders.json', '"quantity": 2', '"quantity": 3']], ['TC-04']);

/* 18 — the setup journey feeding a serial:{gap} group (run plan given) selects that group's TCs. */
impactCase('18a setup journey spec change selects the TCs of serial:{gap}',
  [['tests/Orders_Tests/00-setup-order-items.spec.ts', "'Setup Customer', 3", "'Setup Customer', 4"]], ['TC-04'],
  { fpOpts: { runPlan: RUN_PLAN } });
impactCase('18b the same change without a run plan selects nothing (setup tests carry no TC)',
  [['tests/Orders_Tests/00-setup-order-items.spec.ts', "'Setup Customer', 3", "'Setup Customer', 4"]], []);
impactCase('18c a page member reached only by the setup journey selects serial:{gap} through setup:{gap}',
  [['fixtures/test.ts', 'await orders.goto();', "await orders.goto();\n    await orders.fillForm('', 0);"]], ['TC-04', 'TC-06'],
  { fpOpts: { runPlan: RUN_PLAN } });

impactCase('18d an explicit setup_groups[].feeds link selects the TCs of the fed group',
  [['tests/Orders_Tests/00-setup-order-items.spec.ts', "'Setup Customer', 3", "'Setup Customer', 4"]], ['TC-04'],
  { fpOpts: { runPlan: { setup_groups: [{ name: 'setup:order-items', spec: 'tests/Orders_Tests/00-setup-order-items.spec.ts', feeds: ['serial:orders'] }], groups: RUN_PLAN.groups } } });
impactCase('18e a setup group that neither matches the gap name nor lists it in feeds selects nothing',
  [['tests/Orders_Tests/00-setup-order-items.spec.ts', "'Setup Customer', 3", "'Setup Customer', 4"]], [],
  { fpOpts: { runPlan: { setup_groups: [{ name: 'setup:order-items', spec: 'tests/Orders_Tests/00-setup-order-items.spec.ts' }], groups: RUN_PLAN.groups } } });

/* 19 — a test carrying several TCs: TC-07 stale through its own test → TC-08 (shared test only) is expanded. */
check('19 multi-TC title: a stale TC-07 expands to TC-08 through the shared test', (p) => {
  const root = copyProject();
  const before = fp(root);
  const progress = writeSummaries([summary(before, { stage: 'positive', startedAt: '2026-10-19T10:00:00.000Z', tcs: allPass(ALL) })]);
  mutate(root, 'tests/Orders_Tests/01-orders.spec.ts', 'expect(await grid.cellText(0, 0))', 'expect(await grid.cellText(0, 1))');
  const after = fp(root);
  if (!same(changedTcs(before, after), ['TC-07'])) p.push('fingerprint changes ' + JSON.stringify(changedTcs(before, after)) + ' != ["TC-07"]');
  const sel = selectStale({ root, progressDir: progress });
  if (!same(tcsOf(sel.stale), ['TC-07', 'TC-08'])) p.push('stale ' + JSON.stringify(tcsOf(sel.stale)) + ' != ["TC-07","TC-08"]');
  const e = sel.expanded.find((x) => x.tc === 'TC-08');
  if (!e || !same(e.because, ['TC-07'])) p.push('expanded ' + JSON.stringify(sel.expanded));
  const s07 = sel.stale.find((x) => x.tc === 'TC-07');
  if (!s07 || !s07.changed.some((c) => c.startsWith('test:') && c.includes('[TC-07] Validate that the first row'))) p.push('TC-07 changed[] does not name its own test: ' + JSON.stringify(s07 && s07.changed));
  if (tcsOf(sel.fresh).includes('TC-08')) p.push('TC-08 also listed fresh');
  return { stale: sel.stale, expanded: sel.expanded };
});

/* 20 — another story's spec that reaches a changed part is reported, never run. */
check('20 outside-scope spec reaching a changed part is reported', (p) => {
  const root = copyProject();
  const before = fp(root, { specs: IN_SCOPE });
  if (Object.keys(before.tcs).some((tc) => tc === 'TC-90' || tc === 'TC-91')) p.push('out-of-scope TCs fingerprinted in scope');
  const progress = writeSummaries([summary(before, { stage: 'positive', startedAt: '2026-10-19T10:00:00.000Z', tcs: allPass(Object.keys(before.tcs)) })]);
  mutate(root, 'pages/OrderPage.ts', 'await this.saveButton.click();', 'await this.saveButton.click({ force: true });');
  const sel = selectStale({ root, specs: IN_SCOPE, progressDir: progress });
  if (!same(tcsOf(sel.stale), ['TC-01', 'TC-03', 'TC-05', 'TC-06'])) p.push('stale ' + JSON.stringify(tcsOf(sel.stale)));
  const want = [{ spec: 'tests/Other_Tests/02-other.spec.ts', tcs: ['TC-90'], changed: ['member:pages/OrderPage.ts#OrderPage.save'] }];
  if (JSON.stringify(sel.outside_scope) !== JSON.stringify(want)) p.push('outside_scope ' + JSON.stringify(sel.outside_scope) + ' != ' + JSON.stringify(want));
  const all = selectStale({ root, progressDir: progress });
  if (all.outside_scope.length) p.push('outside_scope must be empty when every spec is in scope');
  return { outside: sel.outside_scope };
});

/* 21 — a selector string literal edit (blanked in the scanner's code view) is detected. */
impactCase('21 selector string literal change is detected',
  [['pages/OrderPage.ts', "page.getByRole('button', { name: 'Save' })", "page.getByRole('button', { name: 'Save order' })"]], SAVE_CALLERS);

/* 22 — select across first-run and re-run summaries, ordered by startedAt (never by file name). */
check('22 select over first + rerun summaries ordered by startedAt; no_verdict, never_run, changed_during_call, missing code', (p) => {
  const root = copyProject();
  const fp0 = fp(root, { specs: IN_SCOPE });
  const S = [];
  // file-name order: first-negative < first-positive < first-smoke < rerun-positive; time order: smoke < positive < negative < rerun
  S.push(summary(fp0, { stage: 'smoke', startedAt: '2026-10-19T10:00:00.000Z', tcs: { 'TC-01': 'PASS', 'TC-05': 'FAIL', 'TC-09': 'PASS' }, tamper: { 'TC-05': 'f'.repeat(64) } }));
  S.push(summary(fp0, {
    stage: 'positive', startedAt: '2026-10-19T10:10:00.000Z',
    tcs: { 'TC-02': 'PASS', 'TC-03': 'INCOMPLETE', 'TC-04': 'INCOMPLETE', 'TC-05': 'PASS', 'TC-06': 'PASS', 'TC-07': 'PASS', 'TC-08': 'PASS', 'TC-10': 'NOT_RUN' },
    reasons: { 'TC-03': 'interrupted: step frozen', 'TC-04': 'interrupted: step frozen', 'TC-10': 'not started: smoke gate failed' },
    executed: ['TC-02', 'TC-03', 'TC-04', 'TC-05', 'TC-06', 'TC-07', 'TC-08'], changedDuringCall: ['TC-07'],
  }));
  S.push(summary(fp0, { stage: 'negative', startedAt: '2026-10-19T10:15:00.000Z', tcs: { 'TC-09': 'PASS' }, code: false }));
  mutate(root, 'pages/OrderPage.ts', 'await this.quantityInput.fill(String(quantity));', "await this.quantityInput.fill(String(quantity));\n    await this.quantityInput.press('Tab');");
  const fp1 = fp(root, { specs: IN_SCOPE });
  S.push(summary(fp1, { run: 'rerun', stage: 'positive', startedAt: '2026-10-19T10:30:00.000Z', tcs: { 'TC-01': 'PASS', 'TC-03': 'PASS' } }));
  const sel = selectStale({ root, specs: IN_SCOPE, progressDir: writeSummaries(S) });
  const exp = {
    stale: ['TC-02', 'TC-06', 'TC-07', 'TC-08', 'TC-09'], fresh: ['TC-01', 'TC-03'], fresh_by_member_only: ['TC-04', 'TC-05'],
    never_run: ['TC-10'], no_verdict: ['TC-04', 'TC-10'], expanded: ['TC-08'],
  };
  for (const [k, v] of Object.entries(exp)) if (!same(tcsOf(sel[k]), v)) p.push(k + ' ' + JSON.stringify(tcsOf(sel[k])) + ' != ' + JSON.stringify(v));
  const by = (tc) => sel.stale.find((x) => x.tc === tc) || {};
  if (!same(by('TC-02').changed || [], ['member:pages/OrderPage.ts#OrderPage.fillForm'])) p.push('TC-02 changed ' + JSON.stringify(by('TC-02').changed));
  if (!/no code/.test(by('TC-09').reason || '')) p.push('TC-09 reason ' + by('TC-09').reason);
  if (!by('TC-09').last || by('TC-09').last.summary !== 'first-negative-1.summary.json') p.push('TC-09 last ' + JSON.stringify(by('TC-09').last));
  if (!/during/.test(by('TC-07').reason || '')) p.push('TC-07 reason ' + by('TC-07').reason);
  const nv = sel.no_verdict.find((x) => x.tc === 'TC-10');
  if (!nv || nv.status !== 'NOT_RUN' || nv.reason !== 'not started: smoke gate failed') p.push('no_verdict TC-10 ' + JSON.stringify(nv));
  const nv4 = sel.no_verdict.find((x) => x.tc === 'TC-04');
  if (!nv4 || nv4.status !== 'INCOMPLETE') p.push('no_verdict TC-04 ' + JSON.stringify(nv4));
  return sel;
});

/* 23 — an unreached member of a reached file changed: fingerprints fresh, flagged fresh_by_member_only. */
check('23 fresh_by_member_only: an unreached member of a reached file changed', (p) => {
  const root = copyProject();
  const before = fp(root, { specs: IN_SCOPE });
  const progress = writeSummaries([summary(before, { stage: 'positive', startedAt: '2026-10-19T10:00:00.000Z', tcs: allPass(Object.keys(before.tcs)) })]);
  mutate(root, 'pages/OrderPage.ts', "{ name: 'Export' }", "{ name: 'Export CSV' }");
  const sel = selectStale({ root, specs: IN_SCOPE, progressDir: progress });
  if (sel.stale.length) p.push('stale ' + JSON.stringify(tcsOf(sel.stale)));
  const inScope = ALL01.concat(['TC-09', 'TC-10']);
  if (!same(sel.fresh_by_member_only, inScope)) p.push('fresh_by_member_only ' + JSON.stringify(sel.fresh_by_member_only));
  if (sel.fresh.length) p.push('fresh ' + JSON.stringify(sel.fresh));
  if (sel.outside_scope.length) p.push('outside_scope must stay empty without a stale TC: ' + JSON.stringify(sel.outside_scope));
  return { fbm: sel.fresh_by_member_only };
});

/* 24 — the CLI: both commands return OK payloads; a missing root is BLOCKED; exit code 0 throughout. */
check('24 CLI fingerprint / select / BLOCKED, exit 0', (p) => {
  const root = copyProject();
  const script = path.join(here, 'impact.mjs');
  const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
  const f = run('fingerprint', '--root', root, '--tcs', 'TC-01,TC-07');
  const fj = f.status === 0 ? JSON.parse(f.stdout) : null;
  if (!fj || fj.outcome !== 'OK' || !same(Object.keys(fj.tcs), ['TC-01', 'TC-07'])) p.push('fingerprint --tcs: ' + (f.stdout || f.stderr).slice(0, 200));
  if (fj && Object.values(fj.tests).some((t) => !t.tcs.some((x) => x === 'TC-01' || x === 'TC-07'))) p.push('fingerprint --tcs kept a test of another TC');
  const runFile = path.join(path.dirname(root), 'phase-1.json');
  fs.writeFileSync(runFile, JSON.stringify({ schema: 'skill6-run/1', run_plan: RUN_PLAN }));
  const s = run('select', '--root', root, '--spec', IN_SCOPE.join(','), '--progress', path.join(path.dirname(root), 'none'), '--run-file', runFile);
  const sj = s.status === 0 ? JSON.parse(s.stdout) : null;
  if (!sj || sj.outcome !== 'OK' || sj.never_run.length !== 10) p.push('select without summaries: ' + (s.stdout || s.stderr).slice(0, 200));
  const b = run('fingerprint', '--root', path.join(root, 'no-such-dir'));
  const bj = b.status === 0 ? JSON.parse(b.stdout) : null;
  if (!bj || bj.outcome !== 'BLOCKED' || !bj.reason) p.push('missing root: ' + (b.stdout || b.stderr).slice(0, 200));
  const h = run('--help');
  if (h.status !== 0 || !/fingerprint/.test(h.stdout)) p.push('--help');
});

/* 25 — reverseDependencies follows the closure: a data file, a helper module, a spec and the config select exactly the
   tests whose closure reaches them; a file nothing reaches selects nothing. */
check('25 reverse dependencies follow the closure: data file, helper module, spec, config', (p) => {
  const root = copyProject();
  const tcsFor = (files, opts = {}) => reverseDependencies({ root, files, cache: new Map(), ...opts }).tcs;
  const d = tcsFor(['helpers/data/orders.json']);
  if (!same(d, ['TC-04'])) p.push('orders.json → ' + JSON.stringify(d));
  const h = tcsFor(['helpers/format.ts']);
  if (!same(h, [...ALL01, 'TC-90', 'TC-91'])) p.push('format.ts → ' + JSON.stringify(h));
  const s = tcsFor(['tests/Orders_Tests/03-orders-dashboard.spec.ts']);
  if (!same(s, ['TC-09', 'TC-10'])) p.push('03 spec → ' + JSON.stringify(s));
  const c = tcsFor(['playwright.config.ts']);
  if (!same(c, ALL)) p.push('config → ' + JSON.stringify(c));
  const none = reverseDependencies({ root, files: ['helpers/no-such-file.ts'], cache: new Map() });
  if (none.tcs.length || none.tests.length) p.push('a file nothing reaches selected ' + JSON.stringify(none.tcs));
  const r = reverseDependencies({ root, files: ['helpers/data/orders.json'], cache: new Map() });
  const t = r.tests[0] || { via: [] };
  if (r.tests.length !== 1 || !t.via.includes('closure:helpers/data/orders.json') || !t.via.includes('data:helpers/data/orders.json') || t.reason !== 'depends') p.push('orders.json test entry ' + JSON.stringify(r.tests));
  const byPart = reverseDependencies({ root, parts: ['member:pages/OrderPage.ts#OrderPage.cancel'], cache: new Map() });
  if (!same(byPart.tcs, ['TC-02'])) p.push('part member:…#OrderPage.cancel → ' + JSON.stringify(byPart.tcs));
  return { d, h, s };
});

/* 26 — fail safe: an unknown test is always included; a setup journey reaches its serial:{gap} TCs only with a run plan. */
check('26 reverse dependencies: unknown tests always included; setup journey → serial:{gap} with a run plan', (p) => {
  const root = copyProject();
  fs.mkdirSync(path.join(root, 'tests', 'Dynamic_Tests'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'extra', '04-dynamic.spec.ts'), path.join(root, 'tests', 'Dynamic_Tests', '04-dynamic.spec.ts'));
  const r = reverseDependencies({ root, files: ['helpers/data/orders.json'], cache: new Map() });
  if (!same(r.tcs, ['TC-04', 'TC-80'])) p.push('unknown + data → ' + JSON.stringify(r.tcs));
  const u = r.tests.find((x) => x.tcs.includes('TC-80'));
  if (!u || u.reason !== 'unknown' || u.via.length) p.push('TC-80 entry ' + JSON.stringify(u));
  if (!r.unknown.some((x) => x.tcs.includes('TC-80'))) p.push('unknown[] lacks TC-80');
  if (r.tcs.includes('TC-81')) p.push('TC-81 (static call) must not be included');
  const clean = copyProject();
  const withPlan = reverseDependencies({ root: clean, files: ['tests/Orders_Tests/00-setup-order-items.spec.ts'], runPlan: RUN_PLAN, cache: new Map() });
  if (!same(withPlan.tcs, ['TC-04'])) p.push('setup spec with a run plan → ' + JSON.stringify(withPlan.tcs));
  const s04 = withPlan.tests.find((x) => x.tcs.includes('TC-04'));
  if (!s04 || !s04.via.includes('setup:orders')) p.push('TC-04 via ' + JSON.stringify(s04 && s04.via));
  const noPlan = reverseDependencies({ root: clean, files: ['tests/Orders_Tests/00-setup-order-items.spec.ts'], cache: new Map() });
  if (noPlan.tcs.length) p.push('setup spec without a run plan → ' + JSON.stringify(noPlan.tcs));
  return { tcs: r.tcs, withPlan: withPlan.tcs };
});

/* 27 — closureOf: per test and per TC closure files and part ids; the fingerprint payload itself is unchanged. */
check('27 closureOf: per test / per TC closure files; fingerprint payload keys unchanged', (p) => {
  const root = copyProject();
  const c = closureOf({ root, cache: new Map() });
  const f04 = (c.tcs['TC-04'] || {}).files || [];
  for (const f of ['helpers/data/orders.json', 'playwright.config.ts', 'timeouts.ts', 'tests/Orders_Tests/01-orders.spec.ts', 'pages/OrderPage.ts']) if (!f04.includes(f)) p.push('TC-04 closure lacks ' + f);
  const f09 = (c.tcs['TC-09'] || {}).files || [];
  if (f09.includes('helpers/format.ts')) p.push('TC-09 closure must not include helpers/format.ts');
  if (f09.includes('tests/Orders_Tests/01-orders.spec.ts')) p.push('TC-09 closure must not include another spec');
  if (!same(Object.keys(c.tcs), ALL)) p.push('TCs ' + JSON.stringify(Object.keys(c.tcs)));
  if (((c.tcs['TC-07'] || {}).tests || []).length !== 2) p.push('TC-07 must carry 2 tests');
  const any = Object.values(c.tests)[0] || {};
  if (!Array.isArray(any.parts) || !any.parts.some((k) => k.startsWith('test:'))) p.push('tests[].parts must list the part ids');
  const keys = Object.keys(fp(root)).join(',');
  if (keys !== 'schema,root,tcs,tests,files,warnings') p.push('fingerprint payload keys changed: ' + keys);
});

/* 28 — the CLI reverse command: OK payload; without --files / --parts BLOCKED; exit code 0; --help lists it. */
check('28 CLI reverse / BLOCKED without --files, exit 0', (p) => {
  const root = copyProject();
  const script = path.join(here, 'impact.mjs');
  const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
  const r = run('reverse', '--root', root, '--files', 'helpers/data/orders.json');
  const rj = r.status === 0 ? JSON.parse(r.stdout) : null;
  if (!rj || rj.outcome !== 'OK' || rj.command !== 'reverse' || !same(rj.tcs, ['TC-04'])) p.push('reverse: ' + (r.stdout || r.stderr).slice(0, 200));
  const b = run('reverse', '--root', root);
  const bj = b.status === 0 ? JSON.parse(b.stdout) : null;
  if (!bj || bj.outcome !== 'BLOCKED' || !/--files/.test(bj.reason || '')) p.push('reverse without --files: ' + (b.stdout || b.stderr).slice(0, 200));
  const h = run('--help');
  if (h.status !== 0 || !/reverse/.test(h.stdout)) p.push('--help does not list reverse');
});

for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
const verdict = cases.every((c) => c.verdict === 'PASS') ? 'PASS' : 'FAIL';
print({ tool: 'selftest-impact', cases, verdict }, args);
process.exit(verdict === 'PASS' ? 0 : 1);
