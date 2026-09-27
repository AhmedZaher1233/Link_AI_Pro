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

const paths = () => ({
  manifestState: 'absent', manifestFile: null,
  automationRoot: 'fixtures', tests: 'fixtures', pages: 'fixtures/pages', layers: null,
});

function run(fixture, { req = false, root = here } = {}) {
  return analyze({
    root,
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
