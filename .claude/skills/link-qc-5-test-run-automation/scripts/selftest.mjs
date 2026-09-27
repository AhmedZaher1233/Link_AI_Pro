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
import { analyze } from './validate-automation.mjs';

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
