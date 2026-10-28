#!/usr/bin/env node
// selftest.mjs — regression harness for validate-automation.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a test harness, not one of the
// read-only reporting scripts, so the "always exit 0" convention does not apply here.
// Do not "fix" it to exit 0 — a failing self-test means the validator's verdicts cannot be
// trusted, and the automation compliance gate must be recorded BLOCKED rather than passed.
//
// Run: node selftest.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { analyze, summarize, pageScanDigest, RULES, RULE_CHECKS } from './validate-automation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TC = ['TC-01', 'TC-02', 'TC-03'];
const REQ = ['REQ-014'];

// automationRoot is the folder the page-class pass (case 18) walks; it points at fixtures/pages so
// the six duplicate roots under fixtures/pom/ never leak into cases 1-17.
const paths = () => ({
  manifestState: 'absent', manifestFile: null,
  automationRoot: 'fixtures/pages', tests: 'fixtures', pages: 'fixtures/pages', layers: null,
});

function run(fixture, { req = false, root = here, args = {} } = {}) {
  return analyze({
    root,
    args,
    paths: paths(),
    files: [path.join('fixtures', fixture)],
    treatAsSpec: true,
    tcIds: new Set(TC),
    reqIds: req ? new Set(REQ) : null,
    tcIdSource: 'selftest', reqIdSource: req ? 'selftest' : null,
    allowList: { entries: [], file: null },
  });
}

const at = (r, ruleId, line) => r.findings.some((f) => f.ruleId === ruleId && f.line === line);
const has = (r, ruleId) => r.findings.some((f) => f.ruleId === ruleId);
const sev = (r, s) => r.findings.filter((f) => f.severity === s).map((f) => f.ruleId + '@' + f.line).sort();

const cases = [];
const fail = [];

function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}

/* 1 — valid code passes cleanly and raises nothing at all. */
{
  const r = run('valid.fixture.ts');
  const p = [];
  if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' != PASS');
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0 (' + sev(r, 'violation') + ')');
  if (r.counts.warning !== 0) p.push('warnings ' + r.counts.warning + ' != 0 (' + sev(r, 'warning') + ')');
  if (r.counts.review !== 0) p.push('review ' + r.counts.review + ' != 0 (' + sev(r, 'review') + ')');
  check('1 valid code is not flagged', p, { gate: r.gate });
}

/* 2 — every definite violation is caught, at the right line, and nothing else is. */
{
  const r = run('violations.fixture.ts');
  const expected = [
    ['focus-only', 7], ['modifier-no-reason', 12], ['placeholder-assertion', 19],
    ['pom-navigation', 23], ['pom-raw-locator', 24], ['evidence-missing', 30],
    ['trace-title-missing-tcid', 34], ['no-assertions', 39],
  ];
  const p = [];
  if (r.gate !== 'FAIL') p.push('gate ' + r.gate + ' != FAIL');
  for (const [id, line] of expected) if (!at(r, id, line)) p.push('missing ' + id + '@' + line);
  if (r.counts.violation !== expected.length) p.push('violations ' + r.counts.violation + ' != ' + expected.length + ' (' + sev(r, 'violation') + ')');
  if (!at(r, 'wait-for-timeout', 25)) p.push('missing wait-for-timeout@25');
  if (r.counts.warning !== 1) p.push('warnings ' + r.counts.warning + ' != 1 (' + sev(r, 'warning') + ')');
  check('2 definite violations are caught', p, { violations: sev(r, 'violation') });
}

/* 3 — justified exceptions are honoured, a malformed one is not, and neither is silent. */
{
  const r = run('justified.fixture.ts', { req: true });
  const p = [];
  if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' != PASS');
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0 (' + sev(r, 'violation') + ')');
  if (r.exceptions.length !== 3) p.push('exceptions ' + r.exceptions.length + ' != 3');
  if (!at(r, 'exception-malformed', 31)) p.push('missing exception-malformed@31');
  const kinds = r.exceptions.map((e) => e.kind).sort();
  if (!kinds.includes('justification-comment')) p.push('inline justification not recorded as an exception');
  if (r.exceptions.some((e) => !/PENDING/.test(e.substantiveValidation))) p.push('an exception claims substantive validation it has not had');
  const unverified = r.findings.filter((f) => f.ruleId === 'exception-unverified').length;
  if (unverified !== 3) p.push('exception-unverified ' + unverified + ' != 3 — every honoured exception must stay open for substantive review');
  for (const e of r.exceptions) if (!r.findings.some((f) => f.ruleId === e.ruleId && f.line === e.line && f.severity === 'info')) p.push('excepted finding for ' + e.ruleId + ' was removed instead of downgraded');
  check('3 justified exceptions honoured, malformed one rejected', p, { kinds });
}

/* 4 — a helper-based assertion is NOT rejected, and the result never claims verification. */
{
  const r = run('indirect.fixture.ts');
  const p = [];
  if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' != PASS');
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0 (' + sev(r, 'violation') + ')');
  if (!at(r, 'assertions-call-found', 8)) p.push('missing assertions-call-found@8');
  if (!at(r, 'evidence-call-found', 8)) p.push('missing evidence-call-found@8');
  if (!at(r, 'evidence-placement-unproven', 8)) p.push('missing evidence-placement-unproven@8 — placement must stay a review item');
  const f = r.findings.find((x) => x.ruleId === 'assertions-call-found');
  if (!f || !/thing\.page\.fixture/.test(f.resolvedIn || '')) p.push('assertion was not resolved to the page object');
  if (f && /verified/i.test(f.message)) p.push('message claims verification for a call site');
  check('4 helper-based assertion accepted as a call site, not as proof', p, { resolvedIn: f && f.resolvedIn });
}

/* 5 — FALSE PASS GUARD: evidence in a method nobody calls must not rescue the spec. */
{
  const r = run('uncalled.fixture.ts');
  const p = [];
  if (r.gate !== 'FAIL') p.push('gate ' + r.gate + ' != FAIL');
  if (!at(r, 'evidence-missing', 7)) p.push('missing evidence-missing@7 — presence in an uncalled method must not count');
  if (has(r, 'evidence-call-found')) p.push('evidence was credited from a method the test never calls');
  check('5 evidence in an uncalled method is still missing', p, {});
}

/* 6 — FALSE PASS GUARD: an unfollowable hop is unresolved, never missing and never passed. */
{
  const r = run('unfollowable.fixture.ts');
  const p = [];
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0 — a scanner limit must not become a code violation');
  if (!at(r, 'evidence-unresolved', 7)) p.push('missing evidence-unresolved@7');
  if (has(r, 'evidence-missing')) p.push('an unfollowable hop was reported as missing evidence');
  if (has(r, 'evidence-call-found')) p.push('an unfollowable hop was reported as found');
  check('6 unfollowable hop is reported unresolved', p, {});
}

/* 7 — FALSE PASS GUARD: a call site behind a branch is not a straight-line call. */
{
  const r = run('conditional.fixture.ts');
  const p = [];
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0');
  if (!at(r, 'evidence-conditional', 13)) p.push('missing evidence-conditional@13');
  if (!at(r, 'assertions-conditional', 9)) p.push('missing assertions-conditional@9');
  if (!at(r, 'assertions-conditional', 18)) p.push('missing assertions-conditional@18');
  if (has(r, 'evidence-call-found')) p.push('a guarded evidence call was reported as straight-line');
  if (has(r, 'assertions-call-found')) p.push('a guarded assertion was reported as straight-line');
  check('7 conditional call paths go to review, not to a clean result', p, {});
}

/* 8 — FALSE PASS GUARD: an exception cannot authorise a non-exemptible rule. */
{
  const r = run('not-permitted.fixture.ts');
  const p = [];
  if (r.gate !== 'FAIL') p.push('gate ' + r.gate + ' != FAIL');
  if (!at(r, 'exception-not-permitted', 9)) p.push('missing exception-not-permitted@9');
  if (!at(r, 'placeholder-assertion', 10)) p.push('missing placeholder-assertion@10');
  const ph = r.findings.find((f) => f.ruleId === 'placeholder-assertion');
  if (ph && ph.severity !== 'violation') p.push('placeholder-assertion was downgraded to ' + ph.severity + ' by a qa-allow');
  if (r.exceptions.length !== 0) p.push('an exception was honoured on a non-exemptible rule');
  check('8 exception cannot bypass a non-exemptible rule', p, {});
}

/* 9 — FALSE PASS GUARD: a linked requirement is not a covered requirement. */
{
  const r = run('partial.fixture.ts', { req: true });
  const p = [];
  if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' != PASS');
  if (!at(r, 'outcome-coverage-unassessed', 8)) p.push('missing outcome-coverage-unassessed@8');
  if (!/NOT_ASSESSED/.test(r.traceability.requirementOutcomeCoverage)) p.push('traceability claims requirement outcome coverage');
  if (!/Linkage is not coverage/i.test(r.traceability.note)) p.push('traceability note does not separate linkage from coverage');
  check('9 linkage is reported without claiming coverage', p, {});
}

/* 10 — FALSE PASS GUARD: code the scanner cannot read is BLOCKED, never PASS. */
{
  const r = run('unstrippable.fixture.ts');
  const p = [];
  if (r.gate !== 'BLOCKED') p.push('gate ' + r.gate + ' != BLOCKED');
  if (r.scope.parseFailures.length !== 1) p.push('parseFailures ' + r.scope.parseFailures.length + ' != 1');
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0 — a scanner limit must not become a code violation');
  if (!/scopeDigest/.test(r.gateReason)) p.push('BLOCKED reason does not point at the alternative-verification route');
  check('10 unscannable valid code is BLOCKED, not PASS and not a violation', p, {});
}

/* 11 — FALSE PASS GUARD: a recorded run is invalidated by a later code change. */
{
  const p = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-validate-'));
  try {
    fs.cpSync(path.join(here, 'fixtures'), path.join(tmp, 'fixtures'), { recursive: true });
    const before = run('valid.fixture.ts', { root: tmp }).fingerprint;
    const spec = path.join(tmp, 'fixtures', 'valid.fixture.ts');
    fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8') + ' ');
    const after = run('valid.fixture.ts', { root: tmp }).fingerprint;
    if (before.scopeDigest === after.scopeDigest) p.push('scopeDigest did not change after a one-byte edit — stale results would survive');

    fs.mkdirSync(path.join(tmp, 'fixtures', 'reports'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'fixtures', 'reports', 'phase-1.json'), '{"generated":true}');
    const withReport = run('valid.fixture.ts', { root: tmp }).fingerprint;
    if (withReport.scopeDigest !== after.scopeDigest) p.push('a generated report changed the code fingerprint — the run would invalidate itself');
    if (Object.keys(withReport.files).some((f) => /\/(reports|screenshots|automation-logs|coverage)\//.test(f))) p.push('a generated artifact was hashed into the code fingerprint');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('11 fingerprint tracks code, excludes generated output', p, {});
}

/* 12 — the gate reaches the caller through an exit code as well as the payload. */
{
  const p = [];
  const script = path.join(here, 'validate-automation.mjs');
  const call = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const notRun = call(['--root', here, '--strict']);
  if (notRun.status !== 3) p.push('NOT_RUN exit ' + notRun.status + ' != 3');
  const plain = call(['--root', here]);
  if (plain.status !== 0) p.push('default exit ' + plain.status + ' != 0');
  try { JSON.parse(plain.stdout); } catch { p.push('stdout is not a single JSON object'); }
  const failRun = call(['--root', here, '--tests-path', 'fixtures', '--pages-path', 'fixtures/pages',
    '--files', 'fixtures/violations.fixture.ts', '--treat-as-spec', '--tc-ids', TC.join(','), '--strict']);
  if (failRun.status !== 1) p.push('FAIL exit ' + failRun.status + ' != 1');
  const blocked = call(['--root', here, '--tests-path', 'fixtures', '--pages-path', 'fixtures/pages',
    '--files', 'fixtures/unstrippable.fixture.ts', '--treat-as-spec', '--tc-ids', TC.join(','), '--strict']);
  if (blocked.status !== 2) p.push('BLOCKED exit ' + blocked.status + ' != 2');
  check('12 strict exit codes distinguish PASS / FAIL / BLOCKED / NOT_RUN', p, {});
}

/* 13 — FALSE PASS GUARD: an unexecuted applicable check is never PASS and never "N/A". */
{
  const r = analyze({
    root: here, paths: paths(), files: [path.join('fixtures', 'valid.fixture.ts')],
    treatAsSpec: true, tcIds: null, reqIds: null,   // no ID lists supplied → those rules cannot run
    tcIdSource: null, reqIdSource: null, allowList: { entries: [], file: null },
  });
  const p = [];
  if (!r.notRun.length) p.push('ID rules silently vanished instead of being reported notRun');
  for (const n of r.notRun) {
    if (n.applicable !== true) p.push(n.ruleId + ' notRun entry is not marked applicable');
    if (!/Recording it PASS or N\/A is invalid/.test(n.resolution || '')) p.push(n.ruleId + ' notRun entry does not forbid PASS / N\\A');
    if (!/BLOCKED/.test(n.resolution || '')) p.push(n.ruleId + ' notRun entry does not say it blocks the gate');
  }
  if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' != PASS');
  if (!/notRun\[\] entry is an APPLICABLE check/.test(r.complianceNote)) p.push('complianceNote does not state that notRun items are applicable checks');
  if (!/"N\/A" is invalid|as "N\/A", is invalid|or as "N\/A"/.test(r.complianceNote)) p.push('complianceNote does not rule out recording an open item as N/A');
  check('13 unexecuted applicable checks are reported, not silently dropped or marked N/A', p, { notRun: r.notRun.map((n) => n.ruleId) });
}

/* 14 — timing rules: every true positive at its line; step-missing only behind --require-steps. */
{
  const plain = run('timing.fixture.ts', { req: true });
  const stepped = run('timing.fixture.ts', { req: true, args: { 'require-steps': true } });
  const p = [];
  if (plain.gate !== 'PASS') p.push('gate ' + plain.gate + ' != PASS — warnings must never move the gate');
  if (!at(plain, 'positional-unscoped', 10)) p.push('missing positional-unscoped@10 (rows.first() on a bare locator)');
  if (!at(plain, 'wait-network-idle', 11)) p.push('missing wait-network-idle@11 (waitForLoadState)');
  if (!at(plain, 'wait-network-idle', 12)) p.push('missing wait-network-idle@12 (waitUntil option)');
  if (has(plain, 'step-missing')) p.push('step-missing reported without --require-steps');
  if (plain.counts.warning !== 3) p.push('warnings ' + plain.counts.warning + ' != 3 (' + sev(plain, 'warning') + ')');
  if (plain.config.requireSteps !== false) p.push('payload does not record requireSteps=false');
  if (!at(stepped, 'step-missing', 7)) p.push('missing step-missing@7 under --require-steps');
  if (stepped.counts.warning !== 4) p.push('warnings under --require-steps ' + stepped.counts.warning + ' != 4 (' + sev(stepped, 'warning') + ')');
  if (stepped.gate !== 'PASS') p.push('gate under --require-steps ' + stepped.gate + ' != PASS');
  check('14 timing / positional / step true positives at known lines', p, { warnings: sev(stepped, 'warning') });
}

/* 15 — FALSE-POSITIVE GUARD: scoped, justified, excepted, commented and string-only forms are clean. */
{
  const r = run('timing-clean.fixture.ts', { req: true, args: { 'require-steps': true } });
  const p = [];
  if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' != PASS');
  if (r.counts.violation !== 0) p.push('violations ' + r.counts.violation + ' != 0 (' + sev(r, 'violation') + ')');
  if (r.counts.warning !== 0) p.push('warnings ' + r.counts.warning + ' != 0 (' + sev(r, 'warning') + ')');
  if (has(r, 'wait-network-idle')) p.push('networkidle flagged from a plain string constant, a comment, or a waitForLoadState("load")');
  if (has(r, 'step-missing')) p.push('step-missing despite an imported step wrapper and a nested test.step');
  if (r.findings.some((f) => f.ruleId === 'positional-unscoped' && [15, 16].includes(f.line))) p.push('a filter()-scoped chain was flagged as unscoped');
  const excepted = r.findings.filter((f) => f.ruleId === 'positional-unscoped' && f.severity === 'info').map((f) => f.line).sort();
  if (excepted.join(',') !== '18,20') p.push('justified (18) and qa-allow (20) positionals expected as info exceptions, got ' + excepted.join(','));
  if (r.exceptions.length !== 2) p.push('exceptions ' + r.exceptions.length + ' != 2');
  const unverified = r.findings.filter((f) => f.ruleId === 'exception-unverified').length;
  if (unverified !== 2) p.push('exception-unverified ' + unverified + ' != 2 — an excepted positional still needs substantive review');
  check('15 timing rules do not fire on scoped, justified, excepted, commented or string-only forms', p, { excepted });
}

/* 16 — FALSE-NEGATIVE GUARD: an unrelated filter, a local step function and a page-object step never satisfy the rules. */
{
  const r = run('timing-negative.fixture.ts', { req: true, args: { 'require-steps': true } });
  const p = [];
  if (r.gate !== 'FAIL') p.push('gate ' + r.gate + ' != FAIL');
  if (!at(r, 'pom-spec-helper', 7)) p.push('missing pom-spec-helper@7 — a local step() is still a spec helper');
  if (!at(r, 'positional-unscoped', 16)) p.push('missing positional-unscoped@16 — an array .filter on another receiver in the same statement must not scope');
  if (!at(r, 'positional-unscoped', 17)) p.push('missing positional-unscoped@17 — a filter on an unrelated receiver joined by && must not scope');
  if (!at(r, 'step-missing', 12)) p.push('missing step-missing@12 — a LOCAL function named step must not count as a step');
  if (!at(r, 'step-missing', 26)) p.push('missing step-missing@26 — a test.step inside the page object must not count for the spec');
  if (r.counts.warning !== 4) p.push('warnings ' + r.counts.warning + ' != 4 (' + sev(r, 'warning') + ')');
  check('16 look-alike scoping and stepping are not credited', p, { warnings: sev(r, 'warning') });
}

/* 17 — FALSE PASS GUARD: the shared config's own relative imports are part of the fingerprint. */
{
  const p = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-validate-cfg-'));
  try {
    fs.cpSync(path.join(here, 'fixtures'), path.join(tmp, 'fixtures'), { recursive: true });
    const cfgDir = path.join(tmp, 'fixtures', 'pages');   // paths().automationRoot
    fs.writeFileSync(path.join(cfgDir, 'playwright.config.ts'),
      "import { defineConfig } from '@playwright/test';\nimport { TIMEOUTS } from './timeouts';\nexport default defineConfig({ timeout: TIMEOUTS.test });\n");
    fs.writeFileSync(path.join(cfgDir, 'timeouts.ts'), 'export const TIMEOUTS = { test: 90_000 };\n');
    fs.writeFileSync(path.join(cfgDir, 'notes.md'), '# notes\n');
    const base = run('valid.fixture.ts', { root: tmp }).fingerprint;
    if (!Object.keys(base.files).some((f) => /playwright\.config\.ts$/.test(f))) p.push('the config itself was not hashed');
    if (!Object.keys(base.files).some((f) => /\btimeouts\.ts$/.test(f))) p.push('the config\'s relative import (timeouts.ts) was not hashed — editing the timeout policy would not invalidate a recorded gate');
    if (Object.keys(base.files).some((f) => /node_modules|@playwright/.test(f))) p.push('a bare package import was hashed');

    fs.writeFileSync(path.join(cfgDir, 'timeouts.ts'), 'export const TIMEOUTS = { test: 120_000 };\n');
    const edited = run('valid.fixture.ts', { root: tmp }).fingerprint;
    if (edited.scopeDigest === base.scopeDigest) p.push('scopeDigest did not change after editing timeouts.ts');

    fs.writeFileSync(path.join(cfgDir, 'notes.md'), '# notes\nchanged\n');
    const notes = run('valid.fixture.ts', { root: tmp }).fingerprint;
    if (notes.scopeDigest !== edited.scopeDigest) p.push('an unrelated markdown file changed the fingerprint');

    fs.writeFileSync(path.join(cfgDir, 'playwright.broken.config.ts'),
      "import { x } from './missing-module';\nexport default { use: { headless: false } };\n");
    const broken = run('valid.fixture.ts', { root: tmp });
    if (!Object.keys(broken.fingerprint.files).some((f) => /playwright\.broken\.config\.ts$/.test(f))) p.push('a config with an unresolvable import was not hashed');
    if (broken.gate !== 'PASS') p.push('an unresolvable config import changed the gate to ' + broken.gate);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('17 fingerprint follows one hop of the config\'s relative imports', p, {});
}

/* 18 — page-class duplicate candidates (pom-duplicate-page): one sub-case per row of fixtures/pom/README.md.
   The rule produces CANDIDATES; the inventory row decides. An undecided pair keeps the gate BLOCKED. */
{
  const pomRoot = (name) => 'fixtures/pom/' + name;
  const pomRun = (name, file, extra = {}) => analyze({
    root: here, args: {},
    paths: { manifestState: 'absent', manifestFile: null, automationRoot: pomRoot(name), tests: pomRoot(name) + '/tests', pages: pomRoot(name) + '/pages', layers: null },
    files: [pomRoot(name) + '/pages/' + file], treatAsSpec: false,
    tcIds: new Set(TC), reqIds: null, tcIdSource: 'selftest', reqIdSource: null, allowList: { entries: [], file: null }, ...extra,
  });
  const dup = (r) => r.findings.filter((f) => f.ruleId === 'pom-duplicate-page');
  const decided = (r) => r.findings.filter((f) => f.ruleId === 'pom-duplicate-page-decided');
  const p = [];

  // (1) same class name in two files → review, evidence name, gate BLOCKED
  const r1 = pomRun('same-name', 'OrderPage.ts');
  if (dup(r1).length !== 1) p.push('same-name: expected 1 pom-duplicate-page, got ' + dup(r1).length);
  else { const f = dup(r1)[0]; if (f.severity !== 'review' || f.evidence !== 'name') p.push('same-name: severity/evidence ' + f.severity + '/' + f.evidence); if (!f.pair || !/checkout\/OrderPage\.ts$/.test(f.pair.b.file) || f.pair.a.class !== 'OrderPage' || f.pair.b.class !== 'OrderPage') p.push('same-name: pair does not name both files and classes: ' + JSON.stringify(f.pair)); if (!/candidate, not a verdict/.test(f.message)) p.push('same-name: message claims a verdict'); }
  if (r1.gate !== 'BLOCKED' || !/pom-duplicate-page/.test(r1.gateReason)) p.push('same-name: gate ' + r1.gate + ' — an undecided candidate must BLOCK the scanner gate');
  if (!r1.review.some((f) => f.ruleId === 'pom-duplicate-page')) p.push('same-name: the finding is not in review[]');
  if (r1.pageScan.classes.length !== 2 || r1.pageScan.undecided !== 1 || r1.pageScan.decided !== 0) p.push('same-name: pageScan ' + JSON.stringify({ classes: r1.pageScan.classes.length, undecided: r1.pageScan.undecided, decided: r1.pageScan.decided }));
  if (!Object.keys(r1.fingerprint.files).some((f) => /checkout\/OrderPage\.ts$/.test(f))) p.push('same-name: the second page file (found by the root walk, not by --files) was not hashed into the fingerprint');

  // (2) different class name, same route → review, evidence route (reuse the existing page under another name)
  const r2 = pomRun('same-route', 'OrderListPage.ts');
  if (dup(r2).length !== 1 || dup(r2)[0].evidence !== 'route' || !dup(r2)[0].evidenceKinds.includes('route') || dup(r2)[0].evidenceKinds.includes('name')) p.push('same-route: ' + JSON.stringify(dup(r2).map((f) => f.evidenceKinds)));
  if (dup(r2).length && (dup(r2)[0].detail.route || []).join() !== '/orders') p.push('same-route: shared route not reported: ' + JSON.stringify(dup(r2)[0].detail));

  // (3) numeric-prefixed / case-variant twin → review, evidence name (false-negative guard)
  const r3 = pomRun('prefixed-twin', 'ListingPage.ts');
  if (dup(r3).length !== 1 || dup(r3)[0].evidence !== 'name') p.push('prefixed-twin: ' + JSON.stringify(dup(r3).map((f) => f.evidenceKinds)) + ' — "4-listingpage.ts" / "ListingPages" must match "ListingPage"');

  // (4) legitimately shared route + an inventory row naming both → pom-duplicate-page-decided (info), --strict PASS
  const r4 = pomRun('shared-route', 'DashboardPage.ts', { inventory: pomRoot('shared-route') + '/automation-inventory.md' });
  if (dup(r4).length !== 0) p.push('shared-route+inventory: still ' + dup(r4).length + ' undecided pom-duplicate-page');
  if (decided(r4).length !== 1) p.push('shared-route+inventory: expected 1 pom-duplicate-page-decided, got ' + decided(r4).length);
  else { const f = decided(r4)[0]; if (f.severity !== 'info' || !/^reuse DashboardPage/.test(f.decision) || f.evidence !== 'route' || !f.inventoryLine) p.push('shared-route+inventory: decided finding lacks the row decision: ' + JSON.stringify({ sev: f.severity, decision: f.decision, evidence: f.evidence, line: f.inventoryLine })); }
  if (r4.gate !== 'PASS') p.push('shared-route+inventory: gate ' + r4.gate + ' != PASS (' + r4.gateReason + ')');
  if (r4.config.inventoryFile === null || r4.pageScan.inventory.rows !== 2) p.push('shared-route+inventory: inventory not recorded in the payload: ' + JSON.stringify(r4.pageScan.inventory));

  // (5) the same shared route with NO row → review, --strict BLOCKED (an unaddressed candidate fails the checkpoint)
  const r5 = pomRun('shared-route', 'DashboardPage.ts');
  if (dup(r5).length !== 1 || decided(r5).length !== 0 || r5.gate !== 'BLOCKED') p.push('shared-route without inventory: dup ' + dup(r5).length + ' decided ' + decided(r5).length + ' gate ' + r5.gate);
  const script = path.join(here, 'validate-automation.mjs');
  const cli = (extra) => spawnSync(process.execPath, [script, '--root', here, '--automation-root', pomRoot('shared-route'), '--tests-path', pomRoot('shared-route') + '/tests', '--pages-path', pomRoot('shared-route') + '/pages', '--files', pomRoot('shared-route') + '/pages/DashboardPage.ts', '--tc-ids', TC.join(','), '--strict', ...extra], { encoding: 'utf8' });
  const strictPass = cli(['--inventory', pomRoot('shared-route') + '/automation-inventory.md']);
  if (strictPass.status !== 0) p.push('--strict with the inventory exit ' + strictPass.status + ' != 0');
  const strictBlocked = cli([]);
  if (strictBlocked.status !== 2) p.push('--strict without the inventory exit ' + strictBlocked.status + ' != 2 (BLOCKED)');
  let cliPayload; try { cliPayload = JSON.parse(strictBlocked.stdout); } catch { p.push('CLI stdout is not a single JSON object'); }
  if (cliPayload && cliPayload.gate !== 'BLOCKED') p.push('CLI gate ' + cliPayload.gate);
  // an inventory path that does not exist, or a table without the decision columns → warning, nothing decided
  const r5b = pomRun('shared-route', 'DashboardPage.ts', { inventory: pomRoot('shared-route') + '/missing-inventory.md' });
  if (!has(r5b, 'pom-inventory-unreadable') || dup(r5b).length !== 1) p.push('missing inventory file must warn and decide nothing');

  // (6) two pages sharing ONE common loader locator → no hit (threshold is 2 — false-positive guard)
  const r6 = pomRun('common-loader', 'OrderPage.ts');
  if (dup(r6).length || decided(r6).length) p.push('common-loader: one shared locator raised a candidate: ' + JSON.stringify(dup(r6).map((f) => f.evidenceKinds)));
  if (r6.gate !== 'PASS') p.push('common-loader: gate ' + r6.gate + ' (' + r6.gateReason + ')');
  if (r6.pageScan.classes.length !== 2) p.push('common-loader: both page classes must still be listed in pageScan');

  // the existing fixtures (one page class) never raise the rule
  const r7 = run('valid.fixture.ts');
  if (has(r7, 'pom-duplicate-page') || has(r7, 'pom-duplicate-page-decided')) p.push('a single page class raised a duplicate finding');
  check('18 page-class duplicate candidates: name / route / prefixed twin / decided vs undecided shared route / common loader', p, { sameName: dup(r1).length, sameRoute: dup(r2).length, twin: dup(r3).length, decided: decided(r4).length, undecided: dup(r5).length, loader: dup(r6).length });
}

/* ---------------- cases 19-26: compact outputs, the discovery digest and the B8 rules (fixtures/b8/README.md) ---------------- */

// One fixture file, scanned with its own automation root (the guard and admission roots carry their helpers).
const b8Run = (file, { automationRoot = 'fixtures/pages', spec = true, req = false, args = {} } = {}) => analyze({
  root: here, args,
  paths: { manifestState: 'absent', manifestFile: null, automationRoot, tests: automationRoot + '/tests', pages: 'fixtures/pages', layers: null },
  files: [path.join('fixtures', file)], treatAsSpec: spec,
  tcIds: new Set(TC), reqIds: req ? new Set(REQ) : null, tcIdSource: 'selftest', reqIdSource: req ? 'selftest' : null,
  allowList: { entries: [], file: null },
});
const lines = (r, ruleId) => r.findings.filter((f) => f.ruleId === ruleId).map((f) => f.line).sort((a, b) => a - b).join(',');
const expectLines = (p, r, ruleId, want, label) => { const got = lines(r, ruleId); if (got !== want) p.push(label + ': ' + ruleId + ' at [' + got + '] != [' + want + ']'); };
const B8 = ['constant-redeclared', 'empty-catch', 'timeout-literal', 'console-guard-missing', 'network-guard-missing', 'admission-contract'];

/* 19 — A3: the summary is the full payload's gate and counts, compact; --out keeps the full payload on disk. */
{
  const p = [];
  for (const [fixture, gate] of [['violations.fixture.ts', 'FAIL'], ['valid.fixture.ts', 'PASS'], ['unstrippable.fixture.ts', 'BLOCKED']]) {
    const full = run(fixture);
    const s = summarize(full);
    if (s.gate !== full.gate || s.gate !== gate) p.push(fixture + ': summary gate ' + s.gate + ' / full ' + full.gate + ' != ' + gate);
    if (s.gateReason !== full.gateReason) p.push(fixture + ': summary gateReason differs from the full payload');
    for (const k of ['violation', 'warning', 'review', 'info', 'exceptions', 'notRun']) if (s.counts[k] !== full.counts[k]) p.push(fixture + ': counts.' + k + ' ' + s.counts[k] + ' != ' + full.counts[k]);
    if (s.notRun !== full.notRun.length || s.review !== full.review.length || s.exceptions !== full.exceptions.length) p.push(fixture + ': notRun / review / exceptions totals differ');
    if (s.open.length > 20) p.push(fixture + ': open[] holds ' + s.open.length + ' items (cap 20)');
    const openTotal = full.findings.filter((f) => ['violation', 'review', 'warning'].includes(f.severity)).length;
    if (s.openTotal !== openTotal) p.push(fixture + ': openTotal ' + s.openTotal + ' != ' + openTotal);
    if (!s.fingerprint || s.fingerprint.scopeDigest !== full.fingerprint.scopeDigest) p.push(fixture + ': fingerprint.scopeDigest differs');
    if (s.full !== null || s.readOnly !== true) p.push(fixture + ': a summary without --out claims a written file');
    if (JSON.stringify(s).length >= JSON.stringify(full).length) p.push(fixture + ': the summary is not smaller than the full payload');
  }
  const sv = summarize(run('violations.fixture.ts'));
  if (sv.open[0] !== 'focus-only fixtures/violations.fixture.ts:7') p.push('open[0] ' + sv.open[0] + ' != the first violation "focus-only fixtures/violations.fixture.ts:7"');
  const iWarn = sv.open.indexOf('wait-for-timeout fixtures/violations.fixture.ts:25');
  const iLastViolation = sv.open.indexOf('no-assertions fixtures/violations.fixture.ts:39');
  if (iWarn < 0 || iLastViolation < 0 || iWarn < iLastViolation) p.push('violations must be listed before warnings (wait-for-timeout@25 at ' + iWarn + ', no-assertions@39 at ' + iLastViolation + ')');
  // CLI: --summary --out <file> prints the summary and writes the full payload; --strict maps the SAME gate
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-validate-sum-'));
  try {
    const outFile = path.join(tmp, 'checks', 'validator-full.json');
    const cli = spawnSync(process.execPath, [path.join(here, 'validate-automation.mjs'), '--root', here, '--tests-path', 'fixtures', '--pages-path', 'fixtures/pages',
      '--files', 'fixtures/violations.fixture.ts', '--treat-as-spec', '--tc-ids', TC.join(','), '--summary', '--out', outFile, '--strict'], { encoding: 'utf8' });
    if (cli.status !== 1) p.push('--summary --strict exit ' + cli.status + ' != 1 (FAIL)');
    let s = null; try { s = JSON.parse(cli.stdout); } catch { p.push('--summary stdout is not one JSON object'); }
    let full = null; try { full = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { p.push('--out did not write a readable full payload'); }
    if (s && (s.summary !== true || s.gate !== 'FAIL')) p.push('CLI summary: ' + JSON.stringify({ summary: s.summary, gate: s.gate }));
    if (s && s.full !== outFile.replace(/\\/g, '/')) p.push('CLI summary full ' + s.full + ' != ' + outFile.replace(/\\/g, '/'));
    if (s && full && (full.gate !== s.gate || full.fingerprint.scopeDigest !== s.fingerprint.scopeDigest || !Array.isArray(full.findings) || !Array.isArray(full.limits))) p.push('the written full payload does not match the summary');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  check('19 --summary is the full gate and counts, compact; --out keeps the full payload', p, { open: sv.open.length, openTotal: sv.openTotal });
}

/* 20 — A9: the page-scan digest lists every page class with its members, the candidates and the decided pairs. */
{
  const p = [];
  const pomPaths = (name) => ({ manifestState: 'absent', manifestFile: null, automationRoot: 'fixtures/pom/' + name, tests: 'fixtures/pom/' + name + '/tests', pages: 'fixtures/pom/' + name + '/pages', layers: null });
  const d1 = pageScanDigest({ root: here, paths: pomPaths('same-name') });
  if (d1.mode !== 'page-scan' || d1.counts.classes !== 2 || d1.counts.undecided !== 1 || d1.counts.decided !== 0) p.push('same-name counts ' + JSON.stringify(d1.counts));
  const order = d1.classes.find((c) => /pages\/OrderPage\.ts$/.test(c.file));
  if (!order || ['saveButton', 'statusBadge', 'open', 'expectStatus'].join() !== order.members.join() || order.membersTotal !== 4) p.push('OrderPage members ' + JSON.stringify(order && order.members) + ' (constructor excluded, fields and methods in order)');
  if (!order || order.locators !== 2 || order.routes.join() !== '/orders/new') p.push('OrderPage locators / routes ' + JSON.stringify(order && { locators: order.locators, routes: order.routes }));
  if (d1.duplicates.length !== 1 || d1.duplicates[0].evidence !== 'name' || !/OrderPage \(fixtures\/pom\/same-name\/pages\/checkout\/OrderPage\.ts:\d+\)/.test(d1.duplicates[0].b)) p.push('same-name duplicates ' + JSON.stringify(d1.duplicates));
  const d4 = pageScanDigest({ root: here, paths: pomPaths('shared-route'), inventory: 'fixtures/pom/shared-route/automation-inventory.md' });
  if (d4.counts.decided !== 1 || d4.counts.undecided !== 0 || d4.duplicates.length !== 0) p.push('shared-route+inventory counts ' + JSON.stringify(d4.counts));
  if (!d4.decided.length || !/^reuse DashboardPage/.test(d4.decided[0].decision) || !d4.decided[0].inventoryLine) p.push('shared-route decided pair lacks its row: ' + JSON.stringify(d4.decided));
  const d6 = pageScanDigest({ root: here, paths: pomPaths('common-loader') });
  if (d6.counts.classes !== 2 || d6.counts.candidates !== 0) p.push('common-loader digest ' + JSON.stringify(d6.counts));
  const cli = (extra) => spawnSync(process.execPath, [path.join(here, 'validate-automation.mjs'), '--root', here, '--page-scan', '--strict', ...extra], { encoding: 'utf8' });
  const undecided = cli(['--automation-root', 'fixtures/pom/same-name']);
  if (undecided.status !== 2) p.push('--page-scan --strict with an undecided pair exit ' + undecided.status + ' != 2');
  let dj = null; try { dj = JSON.parse(undecided.stdout); } catch { p.push('--page-scan stdout is not one JSON object'); }
  if (dj && (dj.mode !== 'page-scan' || dj.counts.undecided !== 1 || dj.automationRoot !== 'fixtures/pom/same-name')) p.push('CLI digest ' + JSON.stringify(dj && { mode: dj.mode, counts: dj.counts, root: dj.automationRoot }));
  const decidedCli = cli(['--automation-root', 'fixtures/pom/shared-route', '--inventory', 'fixtures/pom/shared-route/automation-inventory.md']);
  if (decidedCli.status !== 0) p.push('--page-scan --strict with every pair decided exit ' + decidedCli.status + ' != 0');
  check('20 --page-scan digest: classes, members, candidates and decided pairs; --strict BLOCKED while undecided', p, { sameName: d1.counts, sharedRoute: d4.counts });
}

/* 21 — constant-redeclared (check 6): true positives, false-positive guards, false-negative guards. */
{
  const p = [];
  const tp = b8Run('b8/constants/tp.fixture.ts');
  expectLines(p, tp, 'constant-redeclared', '6,7,11', 'tp');
  if (tp.gate !== 'PASS') p.push('tp gate ' + tp.gate + ' — a review-severity B8 finding must never move the gate');
  if (tp.findings.some((f) => f.ruleId === 'constant-redeclared' && f.severity !== 'review')) p.push('constant-redeclared is not review severity');
  const fp = b8Run('b8/constants/fp.fixture.ts');
  expectLines(p, fp, 'constant-redeclared', '', 'fp (expected count, label map, TIMEOUTS reference, non-policy name, commented and quoted numbers)');
  if (fp.gate !== 'PASS' || fp.counts.review !== 0) p.push('fp gate ' + fp.gate + ' review ' + fp.counts.review + ' (' + sev(fp, 'review') + ')');
  const fn = b8Run('b8/constants/fn.fixture.ts');
  expectLines(p, fn, 'constant-redeclared', '6,7,8', 'fn (typed + exported + arithmetic, parenthesised let, TIMEOUTS shadowed)');
  // a support file is not a spec: the rule never reads page objects or helpers
  const support = b8Run('b8/constants/tp.fixture.ts', { spec: false });
  expectLines(p, support, 'constant-redeclared', '', 'support file');
  check('21 constant-redeclared: TP / FP / FN, specs only, review severity', p, { tp: lines(tp, 'constant-redeclared'), fn: lines(fn, 'constant-redeclared') });
}

/* 22 — empty-catch (check 28). */
{
  const p = [];
  const tp = b8Run('b8/catch/tp.fixture.ts', { spec: false });
  expectLines(p, tp, 'empty-catch', '6,11', 'tp');
  const fp = b8Run('b8/catch/fp.fixture.ts', { spec: false });
  expectLines(p, fp, 'empty-catch', '', 'fp (commented block, rethrow, commented handler, rethrowing handler, value fallback)');
  const fn = b8Run('b8/catch/fn.fixture.ts', { spec: false });
  expectLines(p, fn, 'empty-catch', '5,8,9,10', 'fn (whitespace + typed parameter, lone ";", => undefined, async () => {})');
  for (const r of [tp, fp, fn]) if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' — empty-catch is staged at review and must not move the gate');
  check('22 empty-catch: TP / FP / FN in every layer', p, { tp: lines(tp, 'empty-catch'), fn: lines(fn, 'empty-catch') });
}

/* 23 — timeout-literal (check 43). */
{
  const p = [];
  const tp = b8Run('b8/timeout/tp.fixture.ts', { spec: false });
  expectLines(p, tp, 'timeout-literal', '8,9,13,14', 'tp');
  const zero = tp.findings.find((f) => f.ruleId === 'timeout-literal' && f.line === 14);
  if (!zero || !/disables the limit/.test(zero.message)) p.push('timeout: 0 is not reported as an unlimited value');
  if (has(tp, 'bare-set-timeout')) p.push('test.setTimeout(…) raised bare-set-timeout (it is a budget, not a timer)');
  const fp = b8Run('b8/timeout/fp.fixture.ts', { spec: false });
  expectLines(p, fp, 'timeout-literal', '', 'fp (TIMEOUTS reference, computed budget, type literal, ternary)');
  const fn = b8Run('b8/timeout/fn.fixture.ts', { spec: false });
  expectLines(p, fn, 'timeout-literal', '10,12', 'fn (deadline arithmetic, a same-file numeric constant)');
  const viaConst = fn.findings.find((f) => f.ruleId === 'timeout-literal' && f.line === 12);
  if (!viaConst || !/WAIT = 7_000/.test(viaConst.message)) p.push('the constant behind "timeout: WAIT" is not named in the message');
  const policy = b8Run('b8/timeout/timeouts.ts', { spec: false });
  expectLines(p, policy, 'timeout-literal', '', 'timeouts.ts (the policy file itself)');
  for (const r of [tp, fp, fn, policy]) if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' (' + r.gateReason + ')');
  check('23 timeout-literal: TP / FP / FN; the policy file is skipped', p, { tp: lines(tp, 'timeout-literal'), fn: lines(fn, 'timeout-literal') });
}

/* 24 — console-guard-missing (46a) and network-guard-missing (49): need the helpers under the automation root. */
{
  const p = [];
  const root = { automationRoot: 'fixtures/b8/guards' };
  const tp = b8Run('b8/guards/tests/tp.fixture.ts', root);
  expectLines(p, tp, 'console-guard-missing', '7', 'tp');
  expectLines(p, tp, 'network-guard-missing', '7', 'tp');
  if (!tp.config.b8 || !/console-guard\.ts$/.test(tp.config.b8.consoleGuardHelper || '') || !/network-guard\.ts$/.test(tp.config.b8.networkGuardHelper || '')) p.push('the guard helpers were not found under the guard root: ' + JSON.stringify(tp.config.b8));
  for (const f of ['fp.fixture.ts', 'fixture-fp.fixture.ts']) {
    const r = b8Run('b8/guards/tests/' + f, root);
    expectLines(p, r, 'console-guard-missing', '', f);
    expectLines(p, r, 'network-guard-missing', '', f);
    if (r.notRun.some((n) => /guard-missing/.test(n.ruleId))) p.push(f + ': a guard rule landed in notRun[] although the helpers exist');
  }
  const fn = b8Run('b8/guards/tests/fn.fixture.ts', root);
  expectLines(p, fn, 'console-guard-missing', '10,21', 'fn (handle not kept; only in the test body)');
  expectLines(p, fn, 'network-guard-missing', '10,20', 'fn (never reported; not attached for the second describe)');
  const msg = (line, ruleId) => (fn.findings.find((f) => f.ruleId === ruleId && f.line === line) || {}).message || '';
  if (!/handle is not kept/.test(msg(10, 'console-guard-missing'))) p.push('fn console@10 does not say the handle is not kept');
  if (!/never reported/.test(msg(10, 'network-guard-missing'))) p.push('fn network@10 does not say it is never reported');
  if (!/inside the test body/.test(msg(21, 'console-guard-missing'))) p.push('fn console@21 does not say it is called inside the test body');
  // no helper under the root → the rules cannot run: notRun, never a finding and never silence
  const none = b8Run('b8/guards/tests/tp.fixture.ts');
  if (has(none, 'console-guard-missing') || has(none, 'network-guard-missing')) p.push('a guard finding without a helper under the automation root');
  for (const id of ['console-guard-missing', 'network-guard-missing']) {
    const n = none.notRun.find((x) => x.ruleId === id);
    if (!n || n.applicable !== true || !/BLOCKED/.test(n.resolution || '')) p.push(id + ' is not an applicable notRun item without its helper');
  }
  for (const r of [tp, fn]) if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' — guard findings are review severity');
  check('24 guard rules: TP / FP (hooks, fixture) / FN; notRun without the helper', p, { tp: [lines(tp, 'console-guard-missing'), lines(tp, 'network-guard-missing')], fn: [lines(fn, 'console-guard-missing'), lines(fn, 'network-guard-missing')] });
}

/* 25 — admission-contract (25a / 47): only when helpers/admission.* exists. */
{
  const p = [];
  const root = { automationRoot: 'fixtures/b8/admission', spec: false };
  const tp = b8Run('b8/admission/fixtures/tp.fixture.ts', root);
  expectLines(p, tp, 'admission-contract', '6,11,15', 'tp (worker + prerequest, request.post, login)');
  const worker = tp.findings.find((f) => f.ruleId === 'admission-contract' && f.line === 6);
  if (!worker || !/workerAdmission/.test(worker.message) || worker.scope !== 'worker') p.push('the worker fixture finding does not name workerAdmission: ' + JSON.stringify(worker && { msg: worker.message, scope: worker.scope }));
  const unit = tp.findings.find((f) => f.ruleId === 'admission-contract' && f.line === 11);
  if (!unit || !/unitAdmission/.test(unit.message)) p.push('the test fixture finding does not name unitAdmission');
  if (!tp.config.b8 || !/helpers\/admission\.ts$/.test(tp.config.b8.admissionHelper || '')) p.push('admission helper not recorded: ' + JSON.stringify(tp.config.b8));
  const fp = b8Run('b8/admission/fixtures/fp.fixture.ts', root);
  expectLines(p, fp, 'admission-contract', '', 'fp (direct, transitive, read-only, option)');
  const fn = b8Run('b8/admission/fixtures/fn.fixture.ts', root);
  expectLines(p, fn, 'admission-contract', '10,14', 'fn (through a non-admitted fixture; worker fixture on unitAdmission, renamed prerequest import)');
  const hooks = b8Run('b8/admission/tests/hooks.fixture.ts', { automationRoot: 'fixtures/b8/admission' });
  expectLines(p, hooks, 'admission-contract', '8', 'hooks (beforeAll without workerAdmission; the one with it is clean)');
  // without helpers/admission.* the rule has no subject: no finding, no notRun
  const off = b8Run('b8/admission/fixtures/tp.fixture.ts', { spec: false });
  if (has(off, 'admission-contract') || off.notRun.some((n) => n.ruleId === 'admission-contract')) p.push('admission-contract ran without helpers/admission.* under the automation root');
  for (const r of [tp, fn, hooks]) if (r.gate !== 'PASS') p.push('gate ' + r.gate + ' (' + r.gateReason + ')');
  check('25 admission-contract: TP / FP / FN, beforeAll, inactive without the admission layer', p, { tp: lines(tp, 'admission-contract'), fn: lines(fn, 'admission-contract'), hooks: lines(hooks, 'admission-contract') });
}

/* 26 — staged severity and exemptibility of the B8 rules. */
{
  const p = [];
  const exemptible = { 'constant-redeclared': true, 'empty-catch': false, 'timeout-literal': false, 'console-guard-missing': true, 'network-guard-missing': true, 'admission-contract': true };
  const checks = { 'constant-redeclared': '6', 'empty-catch': '28', 'timeout-literal': '43', 'console-guard-missing': '46a', 'network-guard-missing': '49', 'admission-contract': '25a' };
  for (const id of B8) {
    if (!RULES[id]) { p.push(id + ' is not in RULES'); continue; }
    if (RULES[id].severity !== 'review') p.push(id + ' severity ' + RULES[id].severity + ' != review (staged)');
    if (RULES[id].exemptible !== exemptible[id]) p.push(id + ' exemptible ' + RULES[id].exemptible + ' != ' + exemptible[id]);
    if (!(RULE_CHECKS[id] || []).includes(checks[id])) p.push(id + ' does not map to check ' + checks[id] + ': ' + JSON.stringify(RULE_CHECKS[id]));
  }
  for (const id of Object.keys(RULES)) if (!RULE_CHECKS[id]) p.push(id + ' has no RULE_CHECKS entry');
  const r = b8Run('b8/pragmas.fixture.ts', { req: true });
  const honoured = r.findings.find((f) => f.ruleId === 'constant-redeclared' && f.line === 8);
  if (!honoured || honoured.severity !== 'info' || !honoured.exception) p.push('qa-allow on constant-redeclared (exemptible) was not honoured: ' + JSON.stringify(honoured && { severity: honoured.severity }));
  if (!at(r, 'exception-unverified', 8)) p.push('the honoured B8 exception is not left open as exception-unverified@8');
  if (!at(r, 'exception-not-permitted', 13)) p.push('qa-allow on empty-catch (non-exemptible) did not raise exception-not-permitted@13');
  const swallow = r.findings.find((f) => f.ruleId === 'empty-catch' && f.line === 14);
  if (!swallow || swallow.severity !== 'review') p.push('empty-catch@14 was downgraded by a qa-allow: ' + JSON.stringify(swallow && swallow.severity));
  if (r.gate !== 'FAIL') p.push('gate ' + r.gate + ' != FAIL (the not-permitted qa-allow is a violation)');
  // the existing fixtures raise no B8 finding at all
  for (const f of ['valid.fixture.ts', 'violations.fixture.ts', 'justified.fixture.ts', 'timing.fixture.ts', 'timing-clean.fixture.ts', 'timing-negative.fixture.ts']) {
    const x = run(f, { req: true });
    const hit = x.findings.filter((y) => B8.includes(y.ruleId)).map((y) => y.ruleId + '@' + y.line);
    if (hit.length) p.push(f + ' raised B8 findings: ' + hit.join(', '));
  }
  check('26 B8 rules are staged at review with their exemptibility; a qa-allow follows the existing exemption rules', p, {});
}

/* ---------------- cases 27-31: test layers and the API / DB rules (fixtures/layers, fixtures/layers-bad) ----------------
   Every expected finding is a `// expect: rule-id[, rule-id]` marker on its line, so the lines below are read from the
   fixtures, never hand-counted. The clean specs are false-positive guards; fn.spec.ts holds the false-negative guards. */
const LAYER_RULES = Object.keys(RULES).filter((r) => /^(layer|record|api|db)-/.test(r));
const LROOT = 'fixtures/layers';
const layerRun = (file, { automationRoot = LROOT, doc = true, inventory = null, args = {} } = {}) => analyze({
  root: here,
  args: { ...(doc ? { 'tc-ids': LROOT + '/TEST-CASES-layers.md' } : {}), ...(inventory ? { inventory } : {}), ...args },
  paths: { manifestState: 'absent', manifestFile: null, automationRoot, tests: automationRoot + '/tests', pages: automationRoot + '/pages', api: automationRoot + '/api', db: automationRoot + '/db', layers: null },
  files: file ? [path.join(LROOT, file)] : [], reqIds: null, allowList: { entries: [], file: null },
});
/** { rule-id: 'l1,l2' } from the `expect:` markers of one fixture file. */
function markers(rel) {
  const out = {};
  fs.readFileSync(path.join(here, rel), 'utf8').replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
    const m = l.match(/\/\/ expect: ([\w, -]+)$/);
    if (m) for (const id of m[1].split(',').map((x) => x.trim())) (out[id] = out[id] || []).push(i + 1);
  });
  for (const k of Object.keys(out)) out[k] = out[k].sort((a, b) => a - b).join(',');
  return out;
}
const ulines = (r, ruleId, fileRe) => [...new Set(r.findings.filter((f) => f.ruleId === ruleId && (!fileRe || fileRe.test(f.file))).map((f) => f.line))].sort((a, b) => a - b).join(',');
/** Every layer rule found in `rel` equals the markers of that file — nothing missing, nothing extra. */
function expectMarkers(p, r, rel, label) {
  const want = markers(rel);
  const re = new RegExp(rel.replace(/.*fixtures[\\/]/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]') + '$');
  for (const id of LAYER_RULES) {
    const got = ulines(r, id, re);
    if (got !== (want[id] || '')) p.push(label + ': ' + id + ' at [' + got + '] != [' + (want[id] || '') + ']');
  }
}

/* 27 — layer classification: the clean api / api+db / db / hybrid / ui specs PASS with the right layers and no layer rule. */
{
  const p = [];
  const want = { 'tests/orders.api.spec.ts': ['api', 'api+db'], 'tests/orders.db.spec.ts': ['db'], 'tests/hybrid.spec.ts': ['hybrid', 'ui'], 'tests/fp.api.spec.ts': ['api'] };
  for (const [f, layers] of Object.entries(want)) {
    const r = layerRun(f);
    if (r.gate !== 'PASS') p.push(f + ': gate ' + r.gate + ' (' + r.gateReason + ')');
    const got = r.scope.tests.map((t) => t.layer);
    if (JSON.stringify(got) !== JSON.stringify(layers)) p.push(f + ': layers ' + JSON.stringify(got) + ' != ' + JSON.stringify(layers));
    const docs = r.scope.tests.map((t) => t.document);
    if (JSON.stringify(docs) !== JSON.stringify(layers)) p.push(f + ': document layers ' + JSON.stringify(docs) + ' != ' + JSON.stringify(layers));
    expectMarkers(p, r, LROOT + '/' + f, f);
    if (r.counts.warning) p.push(f + ': ' + r.counts.warning + ' warning(s) — a data chain was taken for a locator: ' + sev(r, 'warning'));
  }
  // the image is owed by ui / hybrid only, the record by api / db / api+db / hybrid (a pure API test with no image is clean)
  const api = layerRun('tests/orders.api.spec.ts');
  if (has(api, 'evidence-missing') || has(api, 'console-guard-missing')) p.push('an API test was held to an image / the console guard');
  if (api.notRun.some((n) => /guard-missing/.test(n.ruleId))) p.push('the guard rules landed in notRun for a spec without browser tests');
  const hyb = layerRun('tests/hybrid.spec.ts');
  if (!hyb.notRun.some((n) => n.ruleId === 'console-guard-missing')) p.push('the guard rule did not apply to the hybrid / ui tests (no helper → notRun expected)');
  // a project WITHOUT an api/ or db/ layer: every legacy test stays ui, nothing is unresolved
  const legacy = run('valid.fixture.ts');
  if (legacy.counts.layers.unresolved || legacy.counts.layers.ui !== legacy.counts.tests) p.push('legacy fixture layers ' + JSON.stringify(legacy.counts.layers));
  if (legacy.config.backendProject) p.push('the legacy fixture root was taken for a backend project');
  check('27 layer classification: api / api+db / db / hybrid / ui derived from what the test touches, the image and the record owed per layer, legacy ui', p, { api: api.counts.layers, hybrid: hyb.counts.layers });
}

/* 28 — the API rules: true positives (tp-api), false-negative guards (fn), the record rules, gate FAIL. */
{
  const p = [];
  for (const f of ['tests/tp-api.api.spec.ts', 'tests/fn.spec.ts', 'tests/tp-db.db.spec.ts']) {
    const r = layerRun(f);
    expectMarkers(p, r, LROOT + '/' + f, f);
    if (r.gate !== 'FAIL') p.push(f + ': gate ' + r.gate + ' != FAIL');
  }
  for (const id of ['record-missing', 'record-in-hook', 'record-duplicate', 'api-record-missing', 'db-record-missing', 'api-secret-header', 'db-connection-literal', 'layer-mismatch', 'db-write-unledgered', 'db-write-freeform', 'api-mutation-unledgered', 'api-effect-undeclared', 'api-effect-mismatch', 'api-redirect-enabled']) {
    if (!RULES[id] || RULES[id].severity !== 'violation' || RULES[id].exemptible) p.push(id + ' must be a non-exemptible violation (fail closed): ' + JSON.stringify(RULES[id]));
  }
  for (const id of LAYER_RULES) for (const c of RULE_CHECKS[id] || []) if (!['38', '51', '52', '53', '54'].includes(c)) p.push(id + ' maps to check ' + c + ' (layer rules feed 38 / 51-54 only)');
  check('28 API / DB spec rules: TP and FN markers, records fail closed, non-exemptible', p, {});
}

/* 29 — backend members (fixtures/layers-bad): effect undeclared / mismatching the mapping, bypassed requests, redirects,
   secret headers, unledgered ORM writes, unrecorded reads, free-form write SQL, a non-QC connection variable, an
   unlabelled setup mutation; the clean members beside them and the recorded helpers stay silent. */
{
  const p = [];
  const r = layerRun(null, { automationRoot: 'fixtures/layers-bad', inventory: LROOT + '/automation-inventory.md' });
  for (const f of ['fixtures/layers-bad/api/BadApi.ts', 'fixtures/layers-bad/db/BadDb.ts', 'fixtures/layers-bad/fixtures/setup.ts']) {
    const want = markers(f);
    const base = path.basename(f).replace('.', '\\.');
    for (const id of LAYER_RULES) { const got = ulines(r, id, new RegExp(base + '$')); if (got !== (want[id] || '')) p.push(path.basename(f) + ': ' + id + ' at [' + got + '] != [' + (want[id] || '') + ']'); }
  }
  // the clean layer root: recorded helpers, OrdersApi / OrdersDb, the adapter and the fixtures raise nothing
  const clean = layerRun('tests/orders.api.spec.ts', { inventory: LROOT + '/automation-inventory.md' });
  const noisy = clean.findings.filter((f) => LAYER_RULES.includes(f.ruleId)).map((f) => f.ruleId + '@' + f.file + ':' + f.line);
  if (noisy.length) p.push('clean members raised: ' + noisy.join(', '));
  if (clean.counts.mutationMembers !== 3) p.push('mutationMembers ' + clean.counts.mutationMembers + ' != 3 (OrdersApi.create, OrdersDb.create / rename)');
  // no inventory → no mapping row → no mismatch (the effect stays declared)
  const noInv = layerRun(null, { automationRoot: 'fixtures/layers-bad' });
  if (has(noInv, 'api-effect-mismatch')) p.push('api-effect-mismatch without an inventory mapping');
  // a QC-named connection variable is accepted with --db-env
  const env = layerRun(null, { automationRoot: 'fixtures/layers-bad', args: { 'db-env': 'DATABASE_URL' } });
  if (has(env, 'db-env-not-qc')) p.push('--db-env DATABASE_URL did not accept the QC-named variable');
  check('29 backend members: every marked violation found, the clean members silent, the mapping decides the effect', p, { mutationMembers: clean.counts.mutationMembers });
}

/* 30 — layer mismatch and unresolved: the document layer is compared exactly with the code layer; backend tests live in
   *.api / *.db spec files and browser tests outside them; an unresolved layer moves the scanner gate to BLOCKED. */
{
  const p = [];
  for (const f of ['tests/tp-layer.spec.ts', 'tests/tp-layer2.api.spec.ts']) { const r = layerRun(f); expectMarkers(p, r, LROOT + '/' + f, f); if (r.gate !== 'FAIL') p.push(f + ': gate ' + r.gate); }
  const tp = layerRun('tests/tp-layer.spec.ts');
  const docMis = tp.findings.find((f) => f.ruleId === 'layer-mismatch' && f.tc === 'TC-06');
  if (!docMis || docMis.document !== 'ui' || docMis.code !== 'api') p.push('TC-06 (document ui, code api) not reported as a document mismatch: ' + JSON.stringify(docMis && { d: docMis.document, c: docMis.code }));
  if (!at(tp, 'evidence-missing', 11)) p.push('the document layer (ui) did not keep the image owed — evidence must be the union of both layers');
  // without the TC document only the file rule remains; the code layer alone decides the evidence
  const noDoc = layerRun('tests/tp-layer.spec.ts', { doc: false });
  if (noDoc.findings.some((f) => f.ruleId === 'layer-mismatch' && f.tc)) p.push('a document mismatch without a document');
  if (has(noDoc, 'evidence-missing')) p.push('an API test without a document was held to an image');
  const un = layerRun('tests/unresolved.spec.ts');
  expectMarkers(p, un, LROOT + '/tests/unresolved.spec.ts', 'unresolved');
  if (un.gate !== 'BLOCKED' || !/layer-unresolved/.test(un.gateReason)) p.push('unresolved layer: gate ' + un.gate + ' (' + un.gateReason + ')');
  if (!has(un, 'evidence-unresolved') && !has(un, 'evidence-missing')) p.push('an unresolved test was not held to an image (fail closed)');
  check('30 layer mismatch (document, file) and an unresolved layer (gate BLOCKED); evidence = union of both layers', p, {});
}

/* 31 — the payload: layer counts, use counts, the per-test list, the paths and helpers; the summary keeps the gate. */
{
  const p = [];
  const r = layerRun('tests/orders.api.spec.ts');
  const c = r.counts;
  if (JSON.stringify(c.layers) !== JSON.stringify({ ui: 0, hybrid: 0, api: 1, db: 0, 'api+db': 1, unresolved: 0 })) p.push('counts.layers ' + JSON.stringify(c.layers));
  if (JSON.stringify(c.layerUse) !== JSON.stringify({ ui: 0, api: 2, db: 1 })) p.push('counts.layerUse ' + JSON.stringify(c.layerUse));
  if (!r.config.backendProject || !/helpers[\\/]api-record\.ts$/.test(r.config.recordHelpers.api || '') || !/helpers[\\/]db-record\.ts$/.test(r.config.recordHelpers.db || '') || !/helpers[\\/]record\.ts$/.test(r.config.recordHelpers.record || '')) p.push('config: ' + JSON.stringify({ b: r.config.backendProject, h: r.config.recordHelpers }));
  if (r.config.documentLayers !== 6) p.push('documentLayers ' + r.config.documentLayers + ' != 6');
  if (r.scope.tests.length !== 2 || !r.scope.tests.every((t) => t.via.length)) p.push('scope.tests ' + JSON.stringify(r.scope.tests));
  const sm = summarize(r);
  if (sm.gate !== r.gate) p.push('summary gate ' + sm.gate + ' != ' + r.gate);
  // no record helper under the root → record-missing is an applicable notRun (never silence)
  const bad = layerRun(null, { automationRoot: 'fixtures/layers-bad' });
  void bad;
  check('31 layer payload: counts, uses, per-test list, helpers; summary gate unchanged', p, { layers: c.layers, use: c.layerUse });
}

const out = {
  tool: 'selftest-validate-automation',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'The validator disagrees with its own fixtures. Its verdicts cannot be trusted: record the compliance gate BLOCKED rather than passed.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
