#!/usr/bin/env node
// validate-automation.mjs — read-only static screen for generated Playwright automation.
// Node >= 18, zero dependencies. Never touches the code it scans; the ONE file it may write is the
// full payload, and only behind --out <file>.
//
// WHAT THIS IS: a screen, not a judge. It reports what a token-level scan over
// comment/string-stripped source can establish with confidence. Everything it cannot
// establish is emitted at severity `review` and must be closed by semantic review —
// it is never guessed in either direction.
//
// A `gate: PASS` means "no banned text pattern was found". It does NOT mean the tests
// are correct, nor that they verify their requirement. See `limits` in the payload.
//
// Model-facing output is compact: --summary prints the gate, the counts and the first open items
// (summarize(): the SAME analyze() payload, so the summary gate is the full gate by construction) and
// --out <file> keeps the full payload on disk. --page-scan prints the discovery digest of every page
// class under the automation root (pageScanDigest()) for the automation inventory.
//
// Exit code is 0 by default (the result lives in the JSON payload), matching the other
// read-only scripts in this suite. `--strict` maps the gate onto an exit code for CI.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, print, isDir, isFile, read, rel, posix, sha256, digestOf,
  loadStripped, matchDelim, splitArgs, findBodyRange, testIdentifiers, findBlocks,
  importMap, findMemberBody, isStraightLine, walk, isSpecFile, isCodeFile, ancestorOfKind,
} from './scan-lib.mjs';
import { parseTcDocument, tcLayer } from './tc-hash.mjs';

export const SCHEMA_VERSION = 1;

/* ---------------- rule catalogue ---------------- */

// severity: violation | warning | review | info
// exemptible: may a qa-allow pragma or the project allow-list downgrade it?
export const RULES = {
  'focus-only':                  { severity: 'violation', exemptible: false, title: 'Focused test or suite would silence the rest of the run' },
  'modifier-no-reason':          { severity: 'violation', exemptible: false, title: 'skip/fixme/fail/slow without a reason' },
  'placeholder-assertion':       { severity: 'violation', exemptible: false, title: 'Assertion compares literals and verifies nothing' },
  'empty-test-body':             { severity: 'violation', exemptible: false, title: 'Test body is empty' },
  'no-assertions':               { severity: 'violation', exemptible: false, title: 'Test asserts nothing, directly or through the methods it calls' },
  'evidence-missing':            { severity: 'violation', exemptible: false, title: 'No assertion-point evidence captured, directly or through the methods it calls' },
  'evidence-in-hook':            { severity: 'violation', exemptible: false, title: 'Assertion-point evidence captured from a teardown hook' },
  'evidence-duplicate':          { severity: 'violation', exemptible: false, title: 'More than one assertion-point evidence call in one test' },
  'trace-title-missing-tcid':    { severity: 'violation', exemptible: false, title: 'Test title carries no [TC-ID]' },
  'trace-unknown-tcid':          { severity: 'violation', exemptible: false, title: 'Test title references a TC-ID that is not in the approved source' },
  'hardcoded-credential':        { severity: 'warning',   exemptible: false, title: 'Credential-looking literal in automation code' },
  'exception-not-permitted':     { severity: 'violation', exemptible: false, title: 'qa-allow used on a rule that may never be excepted' },

  'pom-raw-locator':             { severity: 'violation', exemptible: true,  title: 'Raw locator in a spec file' },
  'pom-navigation':              { severity: 'violation', exemptible: true,  title: 'Raw page navigation or page-level driving in a spec file' },
  'pom-evaluate':                { severity: 'violation', exemptible: true,  title: 'In-page evaluation from a spec file' },
  'pom-keyboard':                { severity: 'violation', exemptible: true,  title: 'Raw keyboard/mouse input from a spec file' },
  'pom-chained-locator':         { severity: 'violation', exemptible: true,  title: 'Chaining off an exposed page-object locator' },
  'pom-spec-helper':             { severity: 'violation', exemptible: true,  title: 'UI helper declared in a spec file' },

  'wait-for-timeout':            { severity: 'warning',   exemptible: true,  title: 'Fixed wait — prefer an observable condition' },
  'bare-set-timeout':            { severity: 'warning',   exemptible: true,  title: 'Bare timer — prefer an observable condition' },
  'absolute-url':                { severity: 'warning',   exemptible: true,  title: 'Absolute URL in automation code' },
  'wait-network-idle':           { severity: 'warning',   exemptible: true,  title: 'networkidle used as a readiness condition — prefer an explicit application-ready signal' },
  'positional-unscoped':         { severity: 'warning',   exemptible: true,  title: 'first()/last()/nth() on an unscoped locator chain with no justification' },
  'step-missing':                { severity: 'warning',   exemptible: true,  title: 'Test body has no named step (test.step or an imported step wrapper) — only reported with --require-steps' },
  'trace-describe-missing-reqid':{ severity: 'warning',   exemptible: true,  title: 'Suite title carries no requirement ID' },
  'trace-unknown-reqid':         { severity: 'warning',   exemptible: true,  title: 'Suite title references a requirement ID that is not in the resolved sources' },
  'trace-title-dynamic':         { severity: 'warning',   exemptible: false, title: 'Title is built at runtime — its IDs cannot be read statically' },
  'manifest-unreadable':         { severity: 'warning',   exemptible: false, title: 'qa-manifest.json could not be parsed — fallback paths used' },
  'pom-inventory-unreadable':    { severity: 'warning',   exemptible: false, title: 'automation-inventory.md could not be read or holds no decision table — no candidate pair counts as decided' },
  'exception-malformed':         { severity: 'warning',   exemptible: false, title: 'qa-allow is malformed or its source does not resolve — not honoured' },
  'exception-expired':           { severity: 'warning',   exemptible: false, title: 'Allow-list entry has expired — not honoured' },
  'exception-unused':            { severity: 'info',      exemptible: false, title: 'Allow-list entry matched nothing in scope' },

  'assertions-call-found':       { severity: 'info',      exemptible: false, title: 'Assertion call site found on a straight-line path (execution not proven)' },
  'evidence-call-found':         { severity: 'info',      exemptible: false, title: 'Evidence call site found on a straight-line path (execution not proven)' },
  'modifier-declared':           { severity: 'info',      exemptible: false, title: 'Declared modifier with a reason' },
  'trace-uncovered-id':          { severity: 'info',      exemptible: false, title: 'Known TC-ID has no test referencing it' },
  'pom-duplicate-page-decided':  { severity: 'info',      exemptible: false, title: 'Page-class candidate pair covered by a decision row of the automation inventory' },

  'pom-duplicate-page':          { severity: 'review',    exemptible: false, title: 'Two page classes look like the same page — decide reuse / extend / create in the automation inventory' },
  'assertions-conditional':      { severity: 'review',    exemptible: false, title: 'Assertion reached only through a branch, loop, callback or early return' },
  'assertions-unresolved':       { severity: 'review',    exemptible: false, title: 'Assertion could not be traced — a call hop was unfollowable' },
  'evidence-conditional':        { severity: 'review',    exemptible: false, title: 'Evidence reached only through a branch, loop, callback or early return' },
  'evidence-unresolved':         { severity: 'review',    exemptible: false, title: 'Evidence could not be traced — a call hop was unfollowable' },
  'evidence-placement-unproven': { severity: 'review',    exemptible: false, title: 'Evidence placement relative to teardown cannot be established statically' },
  'outcome-coverage-unassessed': { severity: 'review',    exemptible: false, title: 'Requirement is linked to a test; whether its required outcomes are asserted is undetermined' },
  'exception-unverified':        { severity: 'review',    exemptible: false, title: 'Exception is well-formed; whether its source justifies it here is undetermined' },
  'pom-architecture-unknown':    { severity: 'review',    exemptible: false, title: 'Project layer layout could not be determined — POM rules not applied to this file' },

  // B8 — stricter deterministic rules, STAGED at severity `review`: each finding is an open item the
  // checkpoint must close; none of them moves the scanner gate (only an undecided pom-duplicate-page does).
  'constant-redeclared':         { severity: 'review',    exemptible: true,  title: 'Timeout / tolerance / threshold constant declared in a spec instead of its one source' },
  'empty-catch':                 { severity: 'review',    exemptible: false, title: 'Empty catch — an error is swallowed with no statement and no explanation' },
  'timeout-literal':             { severity: 'review',    exemptible: false, title: 'Inline timeout value — every timeout comes from timeouts.ts' },
  'console-guard-missing':       { severity: 'review',    exemptible: true,  title: 'Console guard not attached in beforeEach and reported in afterEach' },
  'network-guard-missing':       { severity: 'review',    exemptible: true,  title: 'Network guard not attached in beforeEach and reported in afterEach' },
  'admission-contract':          { severity: 'review',    exemptible: true,  title: 'Side-effecting fixture or beforeAll can start before admission (workerAdmission / unitAdmission)' },

  // 3.0 — test layers ([API] / [DB] lines, skill 3's layer gate). Evidence and record rules are fail-closed: a missing or
  // bypassed record is a violation, never a review item; layer-unresolved is the second review item that moves the gate.
  'layer-mismatch':              { severity: 'violation', exemptible: false, title: 'Test layer of the code differs from the TC document, or the spec file runs it in the wrong Playwright project' },
  'layer-unresolved':            { severity: 'review',    exemptible: false, title: 'Test layer (ui / api / db) could not be established — the evidence it owes is undetermined' },
  'record-missing':              { severity: 'violation', exemptible: false, title: 'No assertion-point record captured by an API / DB test, directly or through the methods it calls' },
  'record-in-hook':              { severity: 'violation', exemptible: false, title: 'Assertion-point record captured from a teardown hook' },
  'record-duplicate':            { severity: 'violation', exemptible: false, title: 'More than one assertion-point record call in one test' },
  'record-call-found':           { severity: 'info',      exemptible: false, title: 'Record call site found on a straight-line path (execution not proven)' },
  'record-conditional':          { severity: 'review',    exemptible: false, title: 'Record reached only through a branch, loop, callback or early return' },
  'record-unresolved':           { severity: 'review',    exemptible: false, title: 'Record could not be traced — a call hop was unfollowable' },
  'record-placement-unproven':   { severity: 'review',    exemptible: false, title: 'Record placement relative to teardown cannot be established statically' },
  'api-raw-request':             { severity: 'violation', exemptible: true,  title: 'Raw HTTP request in a spec, or a request that bypasses the recorded API layer' },
  'api-record-missing':          { severity: 'violation', exemptible: false, title: 'API test without the recorded request (attachApiRecord) in its spec or fixture module' },
  'api-mutation-unledgered':     { severity: 'violation', exemptible: false, title: 'API client bypasses the recorded request (fetch / newContext / an HTTP library) — no record, no ledger, no gate check' },
  'api-effect-undeclared':       { severity: 'violation', exemptible: false, title: 'API client call without a declared effect (read · mutation · auth · unknown)' },
  'api-effect-mismatch':         { severity: 'violation', exemptible: false, title: 'API client call declares another effect than the automation-inventory mapping row' },
  'api-redirect-enabled':        { severity: 'violation', exemptible: false, title: 'Automatic redirects enabled — every redirect target is validated before a request is sent' },
  'api-secret-header':           { severity: 'violation', exemptible: false, title: 'Token, key or cookie literal in a request header or body' },
  'api-mutation-in-setup-unlabelled': { severity: 'review', exemptible: false, title: 'Data-changing request in setup code without purpose: "setup"' },
  'db-raw-sql':                  { severity: 'violation', exemptible: true,  title: 'SQL text in a spec — queries belong in a db/ query object' },
  'db-driver-import':            { severity: 'violation', exemptible: true,  title: 'Database driver imported outside db/ and helpers/db' },
  'db-connection-literal':       { severity: 'violation', exemptible: false, title: 'Connection string with a credential in automation code' },
  'db-env-not-qc':               { severity: 'review',    exemptible: true,  title: 'Database connection read from an environment variable that is not the QC-named one' },
  'db-record-missing':           { severity: 'violation', exemptible: false, title: 'DB test without the recorded client (attachDbRecord), or a db/ read that bypasses it' },
  'db-write-unledgered':         { severity: 'violation', exemptible: false, title: 'Database write that bypasses the ledger (ORM / driver write on an unrecorded client)' },
  'db-write-freeform':           { severity: 'violation', exemptible: false, title: 'Write SQL text instead of the structured insert / update / delete of the recorded client' },
};

// Every rule → the compliance-checkpoints.md §2 item(s) it decides or feeds (Revision 3.1 numbering: 16a / 25a /
// 46a are the code halves of 16 / 25 / 46). check.mjs maps mechanical results onto checklist items with it.
export const RULE_CHECKS = {
  'focus-only': ['20'], 'modifier-no-reason': ['21'], 'modifier-declared': ['21'],
  'placeholder-assertion': ['8'], 'empty-test-body': ['8'], 'no-assertions': ['8'],
  'assertions-call-found': ['9'], 'assertions-conditional': ['9'], 'assertions-unresolved': ['9'],
  'evidence-missing': ['14'], 'evidence-call-found': ['14'], 'evidence-conditional': ['14'], 'evidence-unresolved': ['14'],
  'evidence-in-hook': ['15'], 'evidence-duplicate': ['15'], 'evidence-placement-unproven': ['16a'],
  'trace-title-missing-tcid': ['29'], 'trace-describe-missing-reqid': ['29'], 'trace-title-dynamic': ['29'],
  'trace-unknown-tcid': ['30'], 'trace-unknown-reqid': ['30'], 'trace-uncovered-id': ['34'], 'outcome-coverage-unassessed': ['33', '34'],
  'hardcoded-credential': ['38'],
  'exception-not-permitted': ['39'], 'exception-malformed': ['39'], 'exception-expired': ['39'], 'exception-unused': ['39'], 'exception-unverified': ['39'],
  'pom-raw-locator': ['1'], 'pom-navigation': ['1'], 'pom-evaluate': ['1'], 'pom-keyboard': ['1'], 'pom-architecture-unknown': ['1'],
  'pom-chained-locator': ['2'], 'pom-spec-helper': ['4'],
  'pom-duplicate-page': ['5'], 'pom-duplicate-page-decided': ['5'], 'pom-inventory-unreadable': ['5'],
  'wait-for-timeout': ['24'], 'bare-set-timeout': ['24'], 'wait-network-idle': ['42'], 'positional-unscoped': ['41'], 'step-missing': ['40'],
  'absolute-url': ['47'], 'manifest-unreadable': ['36'],
  'constant-redeclared': ['6'], 'empty-catch': ['28'], 'timeout-literal': ['43'],
  'console-guard-missing': ['46a'], 'network-guard-missing': ['49'], 'admission-contract': ['25a', '47'],
  // 3.0 — 51 API layer · 52 DB layer · 53 data changes · 54 records
  'layer-mismatch': ['51', '52'], 'layer-unresolved': ['51', '52'],
  'record-missing': ['54'], 'record-in-hook': ['54'], 'record-duplicate': ['54'], 'record-call-found': ['54'], 'record-conditional': ['54'], 'record-unresolved': ['54'], 'record-placement-unproven': ['54'],
  'api-raw-request': ['51'], 'api-record-missing': ['51', '54'], 'api-mutation-unledgered': ['51', '53'], 'api-effect-undeclared': ['51', '53'], 'api-effect-mismatch': ['51', '53'], 'api-redirect-enabled': ['51', '53'],
  'api-secret-header': ['38', '51'], 'api-mutation-in-setup-unlabelled': ['53'],
  'db-raw-sql': ['52'], 'db-driver-import': ['52'], 'db-connection-literal': ['38', '52'], 'db-env-not-qc': ['52'], 'db-record-missing': ['52', '54'], 'db-write-unledgered': ['53'], 'db-write-freeform': ['53'],
};

export const LIMITS = [
  'A PASS proves no banned text pattern was found. It does not prove the tests are correct, meaningful, or that they verify their requirement — only review against the approved test case does that.',
  'Text analysis, not a parser. Identifiers are matched by name; dynamic dispatch, computed member access and locators built by string concatenation are invisible.',
  'Regex literals are not detected. A regex containing a quote or an unbalanced brace surfaces as a parse failure and BLOCKED, never as a PASS.',
  'Call sites are not execution. A *-call-found result means a call exists with no visible branch before it; whether it runs is never established here.',
  'Evidence placement relative to teardown is not verified. The scan rejects capture from a teardown hook and counts calls; that the call sits at the assertion point is a review item.',
  'At most three call hops are followed, and only through relative imports. Bare packages, TS path aliases, barrel re-exports, base classes and mixins are reported unresolved, never as violations.',
  'Assertion quality is not judged. Only literal-vs-literal tautologies are detected; an assertion on the wrong thing passes every rule here.',
  'Traceability is linkage only, and only as good as the supplied ID list. Without --tc-ids / --req-ids those rules do not run at all. IDs are never derived or invented.',
  'Modifier reasons are checked for presence, not truth.',
  'Exceptions are checked for form and for a resolving source, never for substance. Whether the cited source justifies the exception is a review item.',
  'Credential detection is keyword-based: a secret in a neutrally named variable is missed, and a harmless literal beside a key named token is a false positive.',
  'Only files in the resolved scope are examined. Specs living elsewhere are invisible unless pointed at with --files.',
  'Steps are recognised only in the scanned file: test.step() and a step wrapper IMPORTED into the spec. A step inside a page-object method does not count for the spec that calls it, and step-missing runs only behind --require-steps.',
  'Positional scoping (first/last/nth) is judged on the receiver chain of that call: a filter() segment, or a named getByRole / getByTestId root narrowed by a further getBy*, counts as scoped. An array .filter on a different receiver in the same statement does not; a locator scoped by an earlier assignment is a false positive to justify with a comment.',
  'networkidle detection reads string literals next to waitForLoadState( or waitUntil: only; a readiness helper that hides the literal behind a constant is invisible.',
  'Page-class duplicate detection (pom-duplicate-page) only produces CANDIDATES: a class is a page when its constructor takes a Page or it extends a page class; two classes in two files match on a normalized name (case, a trailing "s" / "Page", a numeric file prefix ignored), on an identical goto / gotoAppPath / navigate or url-field literal, or on two or more identical locator call literals. A route or locator built at runtime is invisible; a base-class route is not inherited; whether a match is a duplicate is decided by the inventory row, never here.',
  'The B8 rules (constant-redeclared, empty-catch, timeout-literal, console-guard-missing, network-guard-missing, admission-contract) are staged at severity review: every finding is an open item for the checkpoint and none moves the scanner gate. They match names and shapes only: constant-redeclared reads spec-level numeric declarations whose name says timeout / tolerance / threshold / delay / deadline / wait / retry / interval / poll / ms (and any TIMEOUTS declaration); timeout-literal reads timeout / actionTimeout / navigationTimeout / globalTimeout / deadline object properties and .setTimeout / setDefaultTimeout / setDefaultNavigationTimeout calls whose value is a numeric literal or a numeric constant of the same file (timeouts.ts itself is the policy and is skipped); a value imported from another module is invisible.',
  'empty-catch fires on a catch block or a .catch() handler with an empty body ({} , a lone ";", undefined, void 0) and no comment inside it. A comment inside the block is the documented swallow (evidence-only helpers, best-effort cleanup) and never fires; a value fallback such as .catch(() => false) is not flagged here and stays a semantic item of check 28.',
  'The guard rules run only when the guard helper is DEFINED under the automation root (attachConsoleGuard / attachNetworkGuard, or the names given with --console-guard-fn / --network-guard-fn); otherwise they land in notRun[]. A test is covered when a beforeEach of its file or of an enclosing describe calls the helper with its handle kept and an afterEach covering it calls handle.report(); attachment through a fixture counts when the module the spec imports its test function from calls the helper (one hop — that fixture is then trusted to report).',
  'Test layers (3.0): a test is ui when it destructures page / context / browser or reaches a pages/ object, api when it destructures request or reaches an api/ client, db when it reaches a db/ object — directly, through a `new X()` of an import, or through a fixture of the module it imports its test function from whose body does `new X()` of such an import (one hop). A seeding fixture that only calls request internally does not make a test api. Nothing found → ui in a project without api/ and db/ folders, else layer-unresolved (review, the scanner gate BLOCKED). With a TC document behind --tc-ids, the document layer (tc-hash tcLayer) is compared exactly with the code layer (layer-mismatch); the evidence a test owes is the union of both: an image for ui / hybrid, a record for api / db / api+db / hybrid.',
  'API / DB rules read names and shapes: SQL is recognised by its leading keyword in a string literal; a driver by its import specifier; a declared effect by an `effect:` property with a string literal in the call options; a redirect override by a numeric `maxRedirects:` other than 0; a secret header by the previous string literal naming authorization / cookie / x-api-key / … or a Bearer / Basic / JWT-shaped literal. Whether a write touches a record the run did not create cannot be decided statically — db-record refuses it at runtime and run-data check 53 fails it.',
  'admission-contract runs only when {automation root}/helpers/admission.(ts|js|mts|cts|mjs|cjs) exists. Fixture dependencies are traced inside one test.extend({…}) object of one file (a dependency defined elsewhere is named as untraceable); "side-effecting" is a heuristic — a call into a prerequest/ import, request.post / put / patch / delete, a page-object create / add / save / update / delete / remove / submit / approve / reject / upload / import / assign method, or a login / sign-in call. A side effect behind dynamic dispatch is invisible.',
];

const NON_RECEIVERS = new Set(['page', 'this', 'expect', 'test', 'Promise', 'Object', 'JSON', 'Math', 'console', 'process', 'Array', 'String', 'Number', 'Date', 'await']);
const CLEANUP_WORDS = /(delete|cleanup|clean_?up|teardown|reset|purge|remove|dispose)/i;
const JUSTIFY_WORDS = /(retry|back-?off|debounce|throttle|poll|animation|transition|sla|rate.?limit|timing|deliberate|intentional|req-|tc-|us-)/i;

/* ---------------- path resolution ---------------- */

function resolvePaths(root, args, pushFinding) {
  const manifestPath = path.join(root, 'Testing/qa-manifest.json');
  let manifest = null;
  let manifestState = 'absent';
  if (isFile(manifestPath)) {
    const raw = read(manifestPath);
    try { manifest = JSON.parse(raw); manifestState = 'used'; }
    catch { manifestState = 'invalid-json'; pushFinding('manifest-unreadable', rel(root, manifestPath), 1, 'qa-manifest.json does not parse; canonical fallback paths used instead.'); }
  }
  const p = (manifest && manifest.paths) || {};
  const layers = (manifest && manifest.automation && manifest.automation.layers) || null;
  return {
    manifestState,
    manifestFile: manifestState === 'absent' ? null : rel(root, manifestPath),
    automationRoot: str(args['automation-root']) || p.automationRoot || 'Testing/Automation',
    tests: str(args['tests-path']) || p.tests || 'Testing/Automation/tests',
    pages: str(args['pages-path']) || p.pages || 'Testing/Automation/pages',
    api: str(args['api-path']) || p.api || path.posix.join(str(args['automation-root']) || p.automationRoot || 'Testing/Automation', 'api'),
    db: str(args['db-path']) || p.db || path.posix.join(str(args['automation-root']) || p.automationRoot || 'Testing/Automation', 'db'),
    layers,
  };
}

const str = (v) => (typeof v === 'string' ? v : null);

/* ---------------- id lists ---------------- */

function loadIds(value, root, kind) {
  if (!value || value === true) return { ids: null, source: null };
  const raw = String(value);
  const asPath = path.resolve(root, raw);
  const re = kind === 'tc' ? /\bTC-[A-Za-z0-9_.-]*[A-Za-z0-9]/g : /\b(?:REQ|US|AC|FR)-[A-Za-z0-9_.-]*[A-Za-z0-9]/g;
  if (isFile(asPath)) {
    const text = read(asPath) || '';
    if (asPath.endsWith('.json')) {
      try {
        const j = JSON.parse(text);
        const ids = Array.isArray(j) ? j : Array.isArray(j.ids) ? j.ids : Object.keys(j);
        return { ids: new Set(ids.map(String)), source: rel(root, asPath) };
      } catch { /* fall through to token scan */ }
    }
    return { ids: new Set(text.match(re) || []), source: rel(root, asPath) };
  }
  return { ids: new Set(raw.split(',').map((s) => s.trim()).filter(Boolean)), source: 'cli' };
}

/* ---------------- exception pragmas ---------------- */

// The separator must be surrounded by whitespace so it cannot split a hyphenated rule id.
const PRAGMA = /^\s*qa-allow(-block|-file)?\s*:\s*([A-Za-z0-9_,\s-]+?)\s*(?:(?:—|:|-)\s+(.*))?$/;

function collectPragmas(s) {
  const out = [];
  for (const c of s.comments) {
    for (const rawLine of c.text.split('\n')) {
      const m = PRAGMA.exec(rawLine.replace(/^\s*\*+/, '').trim());
      if (!m) continue;
      const rules = m[2].split(',').map((x) => x.trim()).filter(Boolean);
      const reason = (m[3] || '').trim();
      const refMatch = reason.match(/\(([^)]+)\)\s*$/);
      out.push({
        scopeKind: m[1] === '-file' ? 'file' : m[1] === '-block' ? 'block' : 'line',
        rules, reason,
        ref: refMatch ? refMatch[1].trim() : null,
        line: c.line, start: c.start, end: c.end, trailing: c.trailing,
      });
    }
  }
  return out;
}

/** Format validity only — never substance. */
function validatePragma(p, ctx) {
  const problems = [];
  if (!p.rules.length) problems.push('no rule id');
  const unknown = p.rules.filter((r) => !RULES[r]);
  if (unknown.length) problems.push('unknown rule id: ' + unknown.join(', '));
  const nonExemptible = p.rules.filter((r) => RULES[r] && !RULES[r].exemptible);
  const body = p.reason.replace(/\([^)]*\)\s*$/, '').trim();
  if (body.length < 12) problems.push('reason must be at least 12 characters of substance');
  if (!p.ref) problems.push('no (source) reference');
  else if (!sourceResolves(p.ref, ctx)) problems.push('source reference "' + p.ref + '" does not resolve to a known ID or an existing file');
  if (p.scopeKind === 'file' && !p.rules.every((r) => r.startsWith('pom-'))) problems.push('file scope is only allowed for architecture-dependent pom-* rules');
  return { problems, nonExemptible };
}

function sourceResolves(ref, ctx) {
  const tokens = ref.match(/\b(?:TC|REQ|US|AC|FR)-[A-Za-z0-9_.-]*[A-Za-z0-9]/g) || [];
  for (const t of tokens) {
    if (ctx.tcIds && ctx.tcIds.has(t)) return true;
    if (ctx.reqIds && ctx.reqIds.has(t)) return true;
  }
  if (tokens.length && !ctx.tcIds && !ctx.reqIds) return false;
  const filePart = ref.split(/\s+/)[0].replace(/[),;]+$/, '');
  if (filePart && /[\/.]/.test(filePart) && isFile(path.resolve(ctx.root, filePart))) return true;
  return false;
}

function pragmaCovers(p, finding, blocks) {
  if (!p.rules.includes(finding.ruleId)) return false;
  if (p.scopeKind === 'file') return true;
  if (p.trailing) return finding.line === p.line;
  if (p.scopeKind === 'block') {
    const b = blocks.filter((x) => x.body && x.headStart > p.end).sort((a, c) => a.headStart - c.headStart)[0];
    return !!b && finding.offset >= b.body.start && finding.offset < b.body.end;
  }
  // line scope: the next code line, widened to that whole block when one opens there
  if (finding.line === p.line + 1) return true;
  const b = blocks.find((x) => x.body && x.line === p.line + 1);
  return !!b && finding.offset >= b.body.start && finding.offset < b.body.end;
}

/* ---------------- allow list ---------------- */

function loadAllowList(root, args, pushFinding) {
  const given = str(args['allow-file']);
  const file = given ? path.resolve(root, given) : path.join(root, 'Testing/qa-allow.json');
  if (!isFile(file)) return { entries: [], file: null };
  let json;
  try { json = JSON.parse(read(file) || ''); }
  catch { pushFinding('exception-malformed', rel(root, file), 1, 'allow list does not parse — no project-wide exception honoured'); return { entries: [], file: rel(root, file) }; }
  const today = new Date().toISOString().slice(0, 10);
  const entries = [];
  for (const e of json.allow || []) {
    const entry = { ...e, used: false, active: true, file: e.file || '**' };
    if (e.expires && String(e.expires) < today) {
      entry.active = false;
      pushFinding('exception-expired', rel(root, file), 1, 'entry for ' + e.ruleId + ' expired on ' + e.expires + ' — not honoured');
    }
    if (entry.active && RULES[e.ruleId] && !RULES[e.ruleId].exemptible) {
      entry.active = false;
      pushFinding('exception-not-permitted', rel(root, file), 1, 'allow-list entry targets ' + e.ruleId + ', which may never be excepted');
    }
    entries.push(entry);
  }
  return { entries, file: rel(root, file) };
}

/** Minimal glob -> RegExp: `*` within a path segment, `**` across segments. */
function globToRe(glob) {
  const g = String(glob);
  let out = '^';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { out += '.*'; i++; } else out += '[^/]*';
    } else if ('.+^${}()|[]\\?'.includes(c)) {
      out += '\\' + c;
    } else out += c;
  }
  return new RegExp(out + '$');
}

/* ---------------- indirect resolution ---------------- */

function receiverTargets(spec, block, imports, opts, skipNames) {
  const skip = skipNames || new Set();
  const targets = [];
  const broken = [];
  const bodyCode = spec.code.slice(block.body.start, block.body.end);

  const varToFile = new Map();
  for (const m of spec.code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:await\s+)?new\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const imp = imports.get(m[2]);
    if (imp && imp.file) varToFile.set(m[1], imp.file);
    else if (imp) broken.push({ name: m[2], reason: 'bare or unresolved import: ' + imp.spec });
  }

  const seen = new Set();
  for (const m of bodyCode.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const recv = m[1];
    const method = m[2];
    if (NON_RECEIVERS.has(recv) || skip.has(recv)) continue;
    const key = recv + '.' + method;
    if (seen.has(key)) continue;
    seen.add(key);
    let file = varToFile.get(recv) || null;
    if (!file && imports.has(recv)) {
      const imp = imports.get(recv);
      if (imp.file) file = imp.file;
      else { broken.push({ name: recv, reason: 'bare or unresolved import: ' + imp.spec }); continue; }
    }
    if (!file) file = guessFixtureFile(recv, opts);
    if (file) targets.push({ file, method, via: key });
    else broken.push({ name: recv, reason: 'receiver could not be resolved to a module (fixture, alias or inherited binding)' });
  }

  for (const m of bodyCode.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const fn = m[2];
    if (!imports.has(fn) || seen.has(fn) || skip.has(fn) || NON_RECEIVERS.has(fn)) continue;
    // `new X(...)` is a constructor, not a helper call — the instance is followed via varToFile.
    if (/\bnew\s+$/.test(bodyCode.slice(Math.max(0, m.index - 6), m.index + m[1].length))) continue;
    seen.add(fn);
    const imp = imports.get(fn);
    if (imp.file) targets.push({ file: imp.file, method: fn, via: fn + '()' });
    else broken.push({ name: fn, reason: 'bare or unresolved import: ' + imp.spec });
  }
  return { targets, broken };
}

function guessFixtureFile(name, opts) {
  const dirs = [opts.pagesDir, opts.apiDir, opts.dbDir].filter((d) => d && isDir(d));
  if (!dirs.length) return null;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  if (want.length < 4) return null;
  const files = dirs.flatMap((d) => walk(d, isCodeFile, 6));
  for (const f of files) {
    const base = norm(path.basename(f).replace(/\.[^.]+$/, ''));
    if (base === want || base.startsWith(want) || want.startsWith(base)) return f;
  }
  return null;
}

/**
 * Follow the methods a test actually invokes, looking for `needle` in their own bodies.
 * Returns { status: 'found'|'conditional'|'unresolved'|'absent', ... }.
 * Presence elsewhere in a module is never accepted — only the invoked method's body counts.
 */
function resolveIndirect(spec, block, needleRe, opts, cache, imports, skipNames) {
  const { targets, broken } = receiverTargets(spec, block, imports, opts, skipNames);
  const brokenHops = [...broken];
  const queue = targets.map((t) => ({ ...t, depth: 1 }));
  const visited = new Set();

  while (queue.length) {
    const t = queue.shift();
    const key = t.file + '#' + t.method;
    if (visited.has(key)) continue;
    visited.add(key);
    const mod = loadStripped(t.file, cache);
    if (!mod) { brokenHops.push({ name: t.via, reason: 'module unreadable' }); continue; }
    if (mod.parseError) { brokenHops.push({ name: t.via, reason: 'module could not be scanned: ' + mod.parseError }); continue; }
    const range = findMemberBody(mod, t.method);
    if (!range) { brokenHops.push({ name: t.via, reason: 'method body not found in ' + path.basename(t.file) + ' (inherited, mixed in or dynamically defined)' }); continue; }
    const body = mod.code.slice(range.start, range.end);
    const hit = needleRe.exec(body);
    needleRe.lastIndex = 0;
    if (hit) {
      const at = range.start + hit.index;
      const straight = isStraightLine(mod.code, range.start, at);
      return { status: straight ? 'found' : 'conditional', file: mod.file, line: mod.lineOf(at), via: t.via, brokenHops };
    }
    if (t.depth < 3) {
      const inner = importMap(mod, mod.file);
      for (const m of body.matchAll(/\b(this|[A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
        const recv = m[1];
        const method = m[2];
        if (NON_RECEIVERS.has(recv) && recv !== 'this') continue;
        if (recv === 'this') { queue.push({ file: t.file, method, via: t.via + ' -> this.' + method + '()', depth: t.depth + 1 }); continue; }
        const imp = inner.get(recv);
        if (imp && imp.file) queue.push({ file: imp.file, method, via: t.via + ' -> ' + recv + '.' + method + '()', depth: t.depth + 1 });
        else if (imp) brokenHops.push({ name: t.via + ' -> ' + recv, reason: 'bare or unresolved import: ' + imp.spec });
      }
    }
  }
  if (brokenHops.length) return { status: 'unresolved', brokenHops };
  if (!targets.length) return { status: 'absent', brokenHops, noCalls: true };
  return { status: 'absent', brokenHops };
}

/* ---------------- literal / assertion helpers ---------------- */

const LITERAL = /^\s*(true|false|null|undefined|-?\d+(?:\.\d+)?|'[^']*'|"[^"]*"|`[^`]*`|\[\s*\]|\{\s*\})\s*$/;
const TRUTHY_MATCHERS = new Set(['toBeTruthy', 'toBeFalsy', 'toBeDefined', 'toBeNull', 'toBeUndefined']);

function assertionSites(code, body, expectIds) {
  const names = [...expectIds].join('|');
  const re = new RegExp('(^|[^\\w$.])(' + names + ')\\s*\\(', 'g');
  const slice = code.slice(body.start, body.end);
  const out = [];
  for (const m of slice.matchAll(re)) {
    const open = body.start + m.index + m[0].length - 1;
    const close = matchDelim(code, open);
    if (close < 0) continue;
    const subject = code.slice(open + 1, close);
    const tail = code.slice(close + 1, close + 120);
    const chain = tail.match(/^\s*\??\.\s*(?:not\s*\.\s*|resolves\s*\.\s*|rejects\s*\.\s*)*([A-Za-z]\w*)\s*\(/);
    let matcher = null;
    let matcherArg = null;
    if (chain) {
      matcher = chain[1];
      const argOpen = close + 1 + tail.indexOf('(', chain[0].length - 1);
      const argClose = matchDelim(code, argOpen);
      if (argClose > 0) matcherArg = code.slice(argOpen + 1, argClose);
    }
    out.push({ offset: open, subject, matcher, matcherArg });
  }
  return out;
}

/* ---------------- the analyzer ---------------- */

export function analyze(opts) {
  const root = opts.root;
  const findings = [];
  const notRun = [];
  const exceptions = [];
  const cache = new Map();

  const push = (ruleId, file, line, message, extra) => {
    const r = RULES[ruleId];
    findings.push({ ruleId, severity: r ? r.severity : 'warning', file, line, message, ...(extra || {}) });
  };

  const paths = opts.paths || resolvePaths(root, opts.args || {}, (id, f, l, m) => push(id, f, l, m));
  const testsDir = path.resolve(root, paths.tests);
  const pagesDir = path.resolve(root, paths.pages);
  const automationDir = path.resolve(root, paths.automationRoot);
  const apiDir = path.resolve(root, paths.api || path.posix.join(paths.automationRoot, 'api'));
  const dbDir = path.resolve(root, paths.db || path.posix.join(paths.automationRoot, 'db'));
  const dirs = { pagesDir, apiDir, dbDir, automationDir };
  // A project with an api/ or db/ layer: an unresolved test layer is a review item there, `ui` everywhere else.
  const backendProject = isDir(apiDir) || isDir(dbDir);

  /* --- scope --- */
  let files = [];
  let targetMissing = false;
  let scopeMode = 'all';
  if (opts.files && opts.files.length) {
    scopeMode = 'files';
    files = opts.files.map((f) => path.resolve(root, f));
  } else if (!isDir(testsDir)) {
    targetMissing = true;
  } else {
    files = walk(testsDir, isSpecFile, 12);
  }
  const specOf = (f) => (opts.treatAsSpec ? true : isSpecFile(f) || f.startsWith(testsDir + path.sep));

  /* --- allow list --- */
  const allow = opts.allowList || loadAllowList(root, opts.args || {}, (id, f, l, m) => push(id, f, l, m));

  /* --- id lists --- */
  const tcIds = opts.tcIds !== undefined ? opts.tcIds : loadIds((opts.args || {})['tc-ids'], root, 'tc').ids;
  const reqIds = opts.reqIds !== undefined ? opts.reqIds : loadIds((opts.args || {})['req-ids'], root, 'req').ids;
  const tcIdSource = opts.tcIdSource || loadIds((opts.args || {})['tc-ids'], root, 'tc').source;
  const reqIdSource = opts.reqIdSource || loadIds((opts.args || {})['req-ids'], root, 'req').source;
  // Every notRun entry is an APPLICABLE check that did not execute — never an "N/A".
  const NOT_RUN_RESOLUTION = 'Applicable but not executed. Close it by supplying the input, by other project tooling, or by documented semantic review. Recording it PASS or N/A is invalid; until it is closed the compliance gate is BLOCKED for this item.';
  const addNotRun = (ruleId, reason, scope) => notRun.push({ ruleId, applicable: true, reason, scope: scope || 'all files', resolution: NOT_RUN_RESOLUTION });
  if (!tcIds) addNotRun('trace-unknown-tcid', 'no --tc-ids supplied; this script never invents IDs');
  if (!reqIds) addNotRun('trace-unknown-reqid', 'no --req-ids supplied; this script never invents IDs');
  if (!reqIds) addNotRun('outcome-coverage-unassessed', 'no --req-ids supplied; requirement outcome coverage was not assessed here');

  const requireSteps = !!(opts.requireSteps || (opts.args || {})['require-steps']);
  const recordFn = opts.recordFn || str((opts.args || {})['record-fn']) || 'captureRecord';
  const recordReG = new RegExp('\\b' + recordFn + '\\s*\\(', 'g');
  const docLayers = opts.docLayers !== undefined ? opts.docLayers : docLayersOf(root, (opts.args || {})['tc-ids']);
  const dbEnvAllowed = new Set(String(opts.dbEnv || (opts.args || {})['db-env'] || '').split(',').map((x) => x.trim()).filter(Boolean));
  const layerTests = [];
  const layerCounts = { ui: 0, hybrid: 0, api: 0, db: 0, 'api+db': 0, unresolved: 0 };
  const layerUse = { ui: 0, api: 0, db: 0 };
  const backendCounts = { mutationMembers: 0 };
  const need = { record: 0, api: 0, db: 0 };
  const evidenceFn = opts.evidenceFn || str((opts.args || {})['evidence-fn']) || 'captureEvidence';
  const evidenceRe = new RegExp('\\b' + evidenceFn + '\\s*\\(');
  const evidenceReG = new RegExp('\\b' + evidenceFn + '\\s*\\(', 'g');

  /* --- architecture --- */
  const layersKnown = !!(paths.layers || isDir(pagesDir));
  const analysisOpts = { pagesDir, apiDir, dbDir, root };

  /* --- B8 preconditions: the guard helpers and the admission layer the project actually has --- */
  const consoleFn = opts.consoleGuardFn || str((opts.args || {})['console-guard-fn']) || 'attachConsoleGuard';
  const networkFn = opts.networkGuardFn || str((opts.args || {})['network-guard-fn']) || 'attachNetworkGuard';
  const guardHelpers = { console: helperDefinedUnder(automationDir, consoleFn, cache, root), network: helperDefinedUnder(automationDir, networkFn, cache, root) };
  const admissionHelper = admissionHelperIn(automationDir, root);
  const recordHelpers = { api: helperDefinedUnder(automationDir, 'attachApiRecord', cache, root), db: helperDefinedUnder(automationDir, 'attachDbRecord', cache, root), record: helperDefinedUnder(automationDir, recordFn, cache, root) };
  let specsWithTests = 0;

  const filesScanned = [];
  const unreadable = [];
  const parseFailures = [];
  const supportFilesRead = new Set();
  const fileHashes = {};
  const referencedTcIds = new Set();

  for (const file of files) {
    const relFile = rel(root, file);
    const src = read(file);
    if (src === null) { unreadable.push({ file: relFile, error: 'could not be read' }); continue; }
    fileHashes[relFile] = sha256(src);
    const s = loadStripped(file, cache);
    if (!s || s.parseError) {
      parseFailures.push({ file: relFile, reason: s ? s.parseError : 'could not be scanned' });
      continue;
    }
    const isSpec = specOf(file);
    const { ids, focusIds, expectIds } = testIdentifiers(s);
    const blocks = findBlocks(s, new Set([...ids, ...focusIds]));
    if (blocks.parseFail) parseFailures.push({ file: relFile, reason: 'a test/describe call could not be balanced' });

    const fileFindings = [];
    const add = (ruleId, line, message, extra) => {
      const r = RULES[ruleId];
      fileFindings.push({ ruleId, severity: r ? r.severity : 'warning', file: relFile, line, message, ...(extra || {}) });
    };

    const pragmas = collectPragmas(s);
    const pragmaCtx = { root, tcIds, reqIds };
    const honoured = [];
    for (const p of pragmas) {
      const { problems, nonExemptible } = validatePragma(p, pragmaCtx);
      if (nonExemptible.length) {
        add('exception-not-permitted', p.line, 'qa-allow targets ' + nonExemptible.join(', ') + ' — these may never be excepted; the underlying finding keeps its full severity.');
        continue;
      }
      if (problems.length) {
        add('exception-malformed', p.line, 'qa-allow not honoured: ' + problems.join('; '));
        continue;
      }
      honoured.push(p);
    }

    const testBlocks = blocks.filter((b) => b.body && (b.kind === 'test' || /^test\.(skip|fixme|fail|slow)$/.test(b.kind)));
    const describeBlocks = blocks.filter((b) => b.body && b.kind.startsWith('describe'));

    /* --- test layers (3.0): what each test touches, its document layer, the evidence it owes --- */
    const fileImports = importMap(s, file);
    const fixKinds = isSpec && testBlocks.length ? fixtureKinds(s, file, cache, dirs) : new Map();
    const layerOf = new Map();
    for (const b of testBlocks) {
      const L = testLayerOf(s, b, blocks, fileImports, fixKinds, dirs);
      const code = L.layer || (backendProject ? 'unresolved' : 'ui');
      const tcs = b.title && !b.title.template ? titleTokens(b.title.text, /^TC-/) : [];
      const docs = docLayers ? tcs.map((t) => docLayers.get(t)).filter(Boolean) : [];
      const image = needsImage(code) || docs.some((d) => d === 'ui' || d === 'hybrid');
      const record = needsRecord(code) || docs.some(needsRecord);
      const usesApi = L.uses.api || docs.some((d) => d === 'api' || d === 'api+db' || d === 'hybrid');
      const usesDb = L.uses.db || docs.some((d) => d === 'db' || d === 'api+db');
      layerOf.set(b, { code, uses: L.uses, via: L.via, tcs, docs, image, record, usesApi, usesDb });
      layerCounts[code]++; for (const k of ['ui', 'api', 'db']) if (L.uses[k]) layerUse[k]++;
      if (record) need.record++; if (usesApi) need.api++; if (usesDb) need.db++;
      layerTests.push({ file: relFile, line: b.line, tcs, layer: code, document: docs.length ? uniqList(docs).join(',') : null, via: L.via });
    }
    const browserTests = testBlocks.filter((b) => !isBackendLayer(layerOf.get(b).code));
    const backendBodies = testBlocks.filter((b) => isBackendLayer(layerOf.get(b).code)).map((b) => b.body);

    /* --- rule 1: focused execution --- */
    for (const b of blocks) {
      if (b.kind === 'test.only' || b.kind === 'describe.only') add('focus-only', b.line, b.ident + '.' + b.chain.join('.') + ' would silence every other test in the run. Use --grep / --project / --last-failed for a targeted run instead of editing the file.');
    }
    for (const m of s.code.matchAll(/(^|[^\w$.])(fit|fdescribe)\s*\(/g)) add('focus-only', s.lineOf(m.index), m[2] + '() focuses the run.');

    /* --- rule 2: modifier policy --- */
    for (const b of blocks) {
      const mod = b.kind.match(/^(?:test|describe)\.(skip|fixme|fail|slow)$/);
      if (!mod) continue;
      const form = b.body ? 'block' : (b.args.length >= 2 ? 'conditional' : 'unconditional');
      let reason = null;
      for (let i = b.body ? 1 : 0; i < b.args.length; i++) {
        const [a, c] = b.args[i];
        const lit = s.strings.find((t) => t.start >= a && t.end <= c);
        if (lit && lit.value.trim().length >= 8) { reason = lit.value.trim(); break; }
      }
      if (!reason) reason = adjacentJustification(s, b.line, 8);
      if (reason) add('modifier-declared', b.line, mod[1] + ' (' + form + ') declared: ' + reason, { modifier: mod[1], form, reason });
      else add('modifier-no-reason', b.line, mod[1] + ' (' + form + ') carries no reason. Give the reason as an argument or a justification comment so the skipped or expected-failing scenario stays visible in the status model.', { modifier: mod[1], form });
    }

    /* --- rule 4: POM, spec files only --- */
    if (isSpec) {
      if (!layersKnown) {
        add('pom-architecture-unknown', 1, 'Neither qa-manifest.json automation.layers nor a pages folder was found, so layer ownership could not be established; POM rules were not applied to this file.');
      } else {
        scanPom(s, add, (off) => backendBodies.some((r) => off >= r.start && off < r.end));
      }
      // queries and drivers belong in db/ (3.0): SQL text in a spec is the same violation as an inline selector
      for (const lit of s.strings) if (SQL_ANY.test(lit.value)) add('db-raw-sql', lit.line, 'SQL text in a spec — a query belongs in a db/ query object read through the recorded client (read(name, sql, params)); the spec calls that object only.');
    }
    scanBackendText(s, relFile, file, dirs, add, isSpec);

    /* --- rule 7 + 8: waits, credentials, URLs (all layers) --- */
    for (const m of s.code.matchAll(/\bpage\s*\??\.\s*waitForTimeout\s*\(/g)) {
      const line = s.lineOf(m.index);
      const just = adjacentJustification(s, line, 15, JUSTIFY_WORDS);
      if (just) add('wait-for-timeout', line, 'fixed wait, justified: ' + just, { justification: just });
      else add('wait-for-timeout', line, 'Fixed wait with no stated reason — prefer an observable condition or bounded polling. A justified retry backoff or an explicit timing requirement is fine: say so in a comment or a qa-allow.');
    }
    for (const m of s.code.matchAll(/(^|[^\w$.])setTimeout\s*\(/g)) {
      const line = s.lineOf(m.index);
      const just = adjacentJustification(s, line, 15, JUSTIFY_WORDS);
      if (just) add('bare-set-timeout', line, 'timer, justified: ' + just, { justification: just });
      else add('bare-set-timeout', line, 'Bare timer with no stated reason — prefer an observable condition or bounded polling.');
    }
    /* --- rule 9: networkidle as readiness (all layers) --- */
    for (const lit of s.strings) {
      if (lit.value !== 'networkidle') continue;
      const before = s.code.slice(Math.max(0, lit.start - 64), lit.start);
      if (!/waitForLoadState\s*\(\s*$/.test(before) && !/waitUntil\s*:\s*$/.test(before)) continue;
      const just = adjacentJustification(s, lit.line, 15, JUSTIFY_WORDS);
      if (just) add('wait-network-idle', lit.line, 'networkidle wait, justified: ' + just, { justification: just });
      else add('wait-network-idle', lit.line, 'networkidle is not an application-ready signal: it never settles on pages that poll or stream, and it settles too early on pages that load lazily. Wait for the loader to hide, for the response that carries the data, or for a web-first assertion on the element the step needs.');
    }
    /* --- rule 10: positional selectors on an unscoped chain (all layers) --- */
    for (const m of s.code.matchAll(/\.\s*(first|last)\s*\(\s*\)|\.\s*nth\s*\(/g)) {
      const line = s.lineOf(m.index);
      if (fileFindings.some((f) => f.ruleId === 'pom-chained-locator' && f.line === line)) continue;
      if (backendBodies.some((r) => m.index >= r.start && m.index < r.end)) continue;   // first() on response data in an api / db test is no locator
      const chain = receiverChain(s.code, m.index);
      if (isScopedChain(chain)) continue;
      const just = adjacentJustification(s, line, 15, null);
      const which = m[1] || 'nth';
      if (just) add('positional-unscoped', line, which + '() on an unscoped chain, justified: ' + just, { justification: just, chain: chain.segments });
      else add('positional-unscoped', line, which + '() picks an element by position on a chain with no filter({ has | hasText }) or named-container scope (' + (chain.segments.join('.') || 'root') + '). Scope the locator, or state on the line above why the position is the requirement.', { chain: chain.segments });
    }
    for (const lit of s.strings) {
      const before = s.code.slice(Math.max(0, lit.start - 48), lit.start);
      if (/(password|passwd|pwd|secret|token|api_?key|apikey|credential|clientSecret|auth)\s*[:=]\s*$/i.test(before)
        && lit.value.length >= 4 && !/process\.env|\$\{|^<|REPLACE|xxxx/i.test(lit.value)) {
        add('hardcoded-credential', lit.line, 'Credential-looking literal assigned next to a secret-named key. Credentials belong in the environment layer, never in files or logs.');
      }
      if (/^https?:\/\//i.test(lit.value) && !/w3\.org|schema\.org/i.test(lit.value)) {
        const lineText = lineTextAt(s, lit.line);
        if (!/process\.env|baseURL|qa-allow/i.test(lineText)) add('absolute-url', lit.line, 'Absolute URL in automation code — resolve it through the environment layer / baseURL.');
      }
    }

    /* --- B8 rules, staged at review (checks 6, 28, 43, 46a, 49, 25a) --- */
    if (isSpec) scanConstants(s, add);
    scanEmptyCatch(s, add);
    scanTimeoutLiterals(s, relFile, add);
    // the console / network guards watch a page — they apply to the browser-project tests only (3.0)
    if (isSpec && browserTests.length) {
      specsWithTests++;
      if (guardHelpers.console) scanGuard('console-guard-missing', consoleFn, 'console guard', s, file, blocks, browserTests, cache, add);
      if (guardHelpers.network) scanGuard('network-guard-missing', networkFn, 'network guard', s, file, blocks, browserTests, cache, add);
    }
    if (admissionHelper) scanAdmission(s, file, blocks, add);

    /* --- rules 3 + 5 + 6: per test --- */
    for (const b of testBlocks) {
      const bodyCode = s.code.slice(b.body.start, b.body.end);
      const title = b.title ? b.title.text : '';
      const imports = importMap(s, file);

      if (!bodyCode.replace(/[\s;]/g, '').length) {
        add('empty-test-body', b.line, 'Test body is empty — it verifies nothing.');
        continue;
      }

      // steps (opt-in): a named step is test.step() nested in this test, or a call to a step
      // wrapper the spec IMPORTS. A local function named step, or a step inside a page-object
      // method, does not count (limit 13).
      if (requireSteps) {
        const nested = blocks.some((x) => x.kind === 'step' && ancestorOfKind(x, 'test') === b);
        const imp = imports.get('step');
        const wrapped = !!imp && /(^|[^\w$.])step\s*\(/.test(bodyCode);
        if (!nested && !wrapped) add('step-missing', b.line, 'No named step in this test. Wrap each manual step in step(title, body) so the report, the trace and the timeout record name the step that ran or timed out.');
      }

      // assertions
      const sites = assertionSites(s.code, b.body, expectIds);
      for (const site of sites) {
        const subjLit = LITERAL.test(site.subject);
        const argLit = site.matcherArg !== null && LITERAL.test(site.matcherArg);
        const truthy = site.matcher && TRUTHY_MATCHERS.has(site.matcher) && site.matcherArg === null;
        if (subjLit && (argLit || truthy)) {
          add('placeholder-assertion', s.lineOf(site.offset), 'Assertion compares literals (' + site.subject.trim() + (site.matcher ? ' / ' + site.matcher : '') + ') and verifies nothing about the application.');
        }
      }
      if (!sites.length) {
        const r = resolveIndirect(s, b, /\bexpect\s*\(/g, analysisOpts, cache, imports, expectIds);
        if (r.status === 'found') add('assertions-call-found', b.line, 'No direct assertion; an assertion call site was found on a straight-line path in ' + rel(root, r.file) + ':' + r.line + ' via ' + r.via + '. Call sites are not execution — whether it runs, and whether it asserts the required outcome, is a review item.', { resolvedIn: rel(root, r.file), resolvedLine: r.line, via: r.via });
        else if (r.status === 'conditional') add('assertions-conditional', b.line, 'The only assertion found is reached through a branch, loop, callback or after an early return (' + rel(root, r.file) + ':' + r.line + ' via ' + r.via + '). Whether it executes cannot be established statically.', { resolvedIn: rel(root, r.file), resolvedLine: r.line, via: r.via });
        else if (r.status === 'unresolved') add('assertions-unresolved', b.line, 'No direct assertion, and the call chain could not be followed: ' + r.brokenHops.map((h) => h.name + ' (' + h.reason + ')').join('; ') + '. Neither presence nor absence is claimed — resolve by review.', { brokenHops: r.brokenHops });
        else add('no-assertions', b.line, 'Test asserts nothing: no assertion in the body, and every method it calls was followed to its own body without finding one.');
        if (r.file) supportFilesRead.add(r.file);
      }

      // layer (3.0): the document layer must equal the code layer; backend-only tests live in *.api.spec / *.db.spec files
      const lay = layerOf.get(b);
      if (lay.code === 'unresolved') add('layer-unresolved', b.line, 'The test layer could not be established: the test touches no page / context / browser, no request, and no pages/ · api/ · db/ object this scan can resolve (' + (lay.via.join('; ') || 'nothing found') + '). Whether it owes an image or a record is undetermined — resolve it (destructure the fixture it uses, or construct the layer object in the spec) or close it by review.');
      for (const t of lay.tcs) {
        const d = docLayers ? docLayers.get(t) : null;
        if (d && d !== 'unknown' && lay.code !== 'unresolved' && d !== lay.code) add('layer-mismatch', b.line, t + ' is a ' + d + ' test case in the TC document but this test is ' + lay.code + ' (' + (lay.via.join('; ') || 'nothing found') + ') — implement the layer the document designed (an [API] / [DB] line through api/ / db/, a UI line through a page object), never a substitute.', { tc: t, document: d, code: lay.code });
      }
      if (isSpec && (backendProject || BACKEND_SPEC.test(file))) {
        if (isBackendLayer(lay.code) && !BACKEND_SPEC.test(file)) add('layer-mismatch', b.line, 'A ' + lay.code + ' test in a browser spec file — it would run in the browser project. Move it to a *.api.spec.ts / *.db.spec.ts file (the backend project).', { code: lay.code, specKind: 'browser' });
        if (!isBackendLayer(lay.code) && lay.code !== 'unresolved' && BACKEND_SPEC.test(file)) add('layer-mismatch', b.line, 'A ' + lay.code + ' test in a backend spec file (' + path.basename(file) + ') — the backend project has no browser. Move it to a browser spec file.', { code: lay.code, specKind: 'backend' });
      }
      // API / DB through their layers only (3.0): no raw request, the recorded request and client attached
      for (const m of bodyCode.matchAll(RAW_REQUEST)) add('api-raw-request', s.lineOf(b.body.start + m.index), 'Raw ' + m[0].replace(/\s+/g, '').replace(/\($/, '') + '() in a test — an API call belongs in an api/ endpoint client over the recorded request; the spec calls client methods only.');
      for (const m of bodyCode.matchAll(BYPASS_CALL)) add('api-raw-request', s.lineOf(b.body.start + m.index + (m[1] || '').length), 'A request outside the recorded API layer (' + (m[2] || m[0].trim()) + ') — no record, no ledger, no gate check.');
      if (/(^|[^\w$.])new\s+[A-Za-z_$][\w$]*\s*\(\s*request\b/.test(bodyCode)) add('api-raw-request', b.line, 'An api/ client is built over the raw request fixture — build it over the recorded request (the fixture that calls attachApiRecord) so every call is recorded, paced and gated.');
      if (lay.usesApi) {
        if (!recordHelpers.api) { if (!notRun.some((x) => x.ruleId === 'api-record-missing')) addNotRun('api-record-missing', 'no attachApiRecord() definition under the automation root (' + paths.automationRoot + ') — the skill installs helpers/api-record.ts; without it no API call is recorded, paced or gated', 'api tests'); }
        else if (!/\battachApiRecord\s*\(/.test(s.code) && !fixtureModuleCalls(s, file, cache, '\\battachApiRecord\\s*\\(')) add('api-record-missing', b.line, 'This API test reaches no recorded request: neither the spec nor the fixture module it imports its test function from calls attachApiRecord() — its calls would leave no record and pass no gate check.');
      }
      if (lay.usesDb) {
        if (!recordHelpers.db) { if (!notRun.some((x) => x.ruleId === 'db-record-missing')) addNotRun('db-record-missing', 'no attachDbRecord() definition under the automation root (' + paths.automationRoot + ') — the skill installs helpers/db-record.ts; without it no query is recorded and no write is bounded', 'db tests'); }
        else if (!/\battachDbRecord\s*\(/.test(s.code) && !fixtureModuleCalls(s, file, cache, '\\battachDbRecord\\s*\\(')) add('db-record-missing', b.line, 'This DB test reaches no recorded client: neither the spec nor its fixture module calls attachDbRecord() — its queries would leave no record and its writes no ledger.');
      }

      // record (3.0) — api / db / api+db / hybrid tests: one assertion-point record, the same rules as the image
      if (lay.record) {
        const directR = [...bodyCode.matchAll(recordReG)].map((m) => b.body.start + m.index);
        recordReG.lastIndex = 0;
        if (directR.length > 1) add('record-duplicate', s.lineOf(directR[1]), directR.length + ' ' + recordFn + '() calls in one test — exactly one assertion-point record per test (every request / query of the test is an entry in it).');
        else if (directR.length === 1) {
          const at = directR[0];
          if (isStraightLine(s.code, b.body.start, at)) { if (CLEANUP_WORDS.test(s.code.slice(b.body.start, at))) add('record-placement-unproven', s.lineOf(at), 'A cleanup-looking call appears before ' + recordFn + '() — confirm the record still holds the state the Expected Result names.'); }
          else add('record-conditional', s.lineOf(at), recordFn + '() is reached through a branch, loop, callback or after an early return — an attempt could finish with no record.');
        } else {
          const r = resolveIndirect(s, b, new RegExp(recordReG.source, 'g'), analysisOpts, cache, imports, expectIds);
          if (r.status === 'found') { add('record-call-found', b.line, 'No direct ' + recordFn + '(); a call site was found on a straight-line path in ' + rel(root, r.file) + ':' + r.line + ' via ' + r.via + '.', { resolvedIn: rel(root, r.file), resolvedLine: r.line, via: r.via }); add('record-placement-unproven', b.line, 'The record is captured inside ' + r.via + ' — whether it runs at the assertion point and before teardown cannot be established statically.'); }
          else if (r.status === 'conditional') add('record-conditional', b.line, 'The only ' + recordFn + '() found is reached through a branch, loop, callback or after an early return (' + rel(root, r.file) + ':' + r.line + ' via ' + r.via + ').');
          else if (r.status === 'unresolved') add('record-unresolved', b.line, 'No direct ' + recordFn + '(), and the call chain could not be followed: ' + r.brokenHops.map((h) => h.name + ' (' + h.reason + ')').join('; ') + '.', { brokenHops: r.brokenHops });
          else add('record-missing', b.line, 'This ' + lay.code + ' test owes a record (its API / DB lines are evidence) but no ' + recordFn + '() is in its body or in any method it calls — the attempt would end without evidence and can never PASS.');
          if (r.file) supportFilesRead.add(r.file);
        }
      }

      // evidence — the assertion-point image, owed by ui / hybrid tests (and every test of a project without a backend layer)
      const direct = lay.image ? [...bodyCode.matchAll(evidenceReG)].map((m) => b.body.start + m.index) : [];
      evidenceReG.lastIndex = 0;
      if (!lay.image) { /* a pure api / db / api+db test owes a record, not an image (item 54) */ }
      else if (direct.length > 1) {
        add('evidence-duplicate', s.lineOf(direct[1]), direct.length + ' ' + evidenceFn + '() calls in one test — exactly one assertion-point image per test.');
      } else if (direct.length === 1) {
        const at = direct[0];
        if (isStraightLine(s.code, b.body.start, at)) {
          const before = s.code.slice(b.body.start, at);
          if (CLEANUP_WORDS.test(before)) add('evidence-placement-unproven', s.lineOf(at), 'A cleanup-looking call appears before ' + evidenceFn + '() in this body — confirm the image still shows the state the Expected Result names.');
        } else {
          add('evidence-conditional', s.lineOf(at), evidenceFn + '() is reached through a branch, loop, callback or after an early return — an attempt could finish with no image.');
        }
      } else {
        const r = resolveIndirect(s, b, evidenceRe.global ? evidenceRe : new RegExp(evidenceRe.source, 'g'), analysisOpts, cache, imports, expectIds);
        if (r.status === 'found') {
          add('evidence-call-found', b.line, 'No direct ' + evidenceFn + '(); a call site was found on a straight-line path in ' + rel(root, r.file) + ':' + r.line + ' via ' + r.via + '. Call sites are not execution.', { resolvedIn: rel(root, r.file), resolvedLine: r.line, via: r.via });
          add('evidence-placement-unproven', b.line, 'Evidence is captured inside ' + r.via + ', so whether it runs at the assertion point and before teardown cannot be established statically.');
        } else if (r.status === 'conditional') {
          add('evidence-conditional', b.line, 'The only ' + evidenceFn + '() found is reached through a branch, loop, callback or after an early return (' + rel(root, r.file) + ':' + r.line + ' via ' + r.via + ').', { resolvedIn: rel(root, r.file), resolvedLine: r.line, via: r.via });
        } else if (r.status === 'unresolved') {
          add('evidence-unresolved', b.line, 'No direct ' + evidenceFn + '(), and the call chain could not be followed: ' + r.brokenHops.map((h) => h.name + ' (' + h.reason + ')').join('; ') + '. Neither presence nor absence is claimed — resolve by review.', { brokenHops: r.brokenHops });
        } else {
          add('evidence-missing', b.line, 'No ' + evidenceFn + '() in the body, and every method this test calls was followed to its own body without finding one. Presence elsewhere in an imported file is not proof — an uncalled method captures nothing.');
        }
        if (r.file) supportFilesRead.add(r.file);
      }

      // traceability
      if (b.title && b.title.template) {
        add('trace-title-dynamic', b.line, 'Title is built at runtime, so its [TC-ID] cannot be read statically.');
      } else {
        const tokens = titleTokens(title, /^TC-/);
        if (!tokens.length) add('trace-title-missing-tcid', b.line, 'Test title carries no [TC-ID] — the execution cannot be mapped back to the approved test case.');
        for (const t of tokens) {
          referencedTcIds.add(t);
          if (tcIds && !tcIds.has(t)) add('trace-unknown-tcid', b.line, 'Title references ' + t + ', which is not in the approved source (' + (tcIdSource || 'supplied list') + ').');
        }
      }
    }

    /* --- evidence in teardown hooks --- */
    for (const h of blocks) {
      if (!/^hook\.(afterEach|afterAll)$/.test(h.kind) || !h.body) continue;
      const hookCode = s.code.slice(h.body.start, h.body.end);
      const m = evidenceReG.exec(hookCode);
      evidenceReG.lastIndex = 0;
      if (m) add('evidence-in-hook', s.lineOf(h.body.start + m.index), evidenceFn + '() called from ' + h.kind.split('.')[1] + ' — teardown has already run, so the image would contradict the result it is attached to. Failure-attachment copying belongs here; the assertion-point image does not.');
      const r = recordReG.exec(hookCode);
      recordReG.lastIndex = 0;
      if (r) add('record-in-hook', s.lineOf(h.body.start + r.index), recordFn + '() called from ' + h.kind.split('.')[1] + ' — the assertion-point record is written in the test at its assertion point; the hook only writes the failure record.');
    }

    /* --- describe traceability --- */
    for (const d of describeBlocks) {
      if (!d.title) continue;
      if (d.title.template) continue;
      const tokens = plainTokens(d.title.text, /\b(?:REQ|US|AC|FR)-[A-Za-z0-9_.-]*[A-Za-z0-9]/g);
      if (!tokens.length) add('trace-describe-missing-reqid', d.line, 'Suite title carries no requirement ID.');
      for (const t of tokens) {
        if (reqIds && !reqIds.has(t)) add('trace-unknown-reqid', d.line, 'Suite title references ' + t + ', which is not in the resolved requirement sources (' + (reqIdSource || 'supplied list') + ').');
        if (reqIds && reqIds.has(t)) add('outcome-coverage-unassessed', d.line, t + ' is linked to tests here. Linkage is not coverage: whether the requirement\'s required outcomes are actually asserted is undetermined by this scan.', { requirementId: t });
      }
    }

    /* --- apply exceptions --- */
    for (const f of fileFindings) {
      const ruleMeta = RULES[f.ruleId];
      if (!ruleMeta || !ruleMeta.exemptible || f.severity === 'info') { findings.push(f); continue; }
      const p = honoured.find((x) => pragmaCovers(x, f, blocks));
      const entry = !p && allow.entries.find((e) => e.active && e.ruleId === f.ruleId && globToRe(e.file).test(f.file) && (!e.line || e.line === f.line));
      if (!p && !entry && !f.justification) { findings.push(f); continue; }
      if (entry) entry.used = true;
      const kind = p ? 'pragma:' + p.scopeKind : entry ? 'project-list' : 'justification-comment';
      const exception = {
        ruleId: f.ruleId, file: f.file, line: f.line, kind,
        declaredAt: p ? p.line : (f.justification ? f.line : null),
        reason: p ? p.reason : entry ? entry.reason : f.justification,
        source: p ? p.ref : entry ? (entry.source || null) : null,
        originalSeverity: f.severity,
        substantiveValidation: 'PENDING — open the source and record whether it justifies this rule in this scope',
      };
      exceptions.push(exception);
      const clean = { ...f, severity: 'info', exception };
      delete clean.justification;
      findings.push(clean);
      findings.push({
        ruleId: 'exception-unverified', severity: 'review', file: f.file, line: f.line,
        message: kind === 'justification-comment'
          ? 'The ' + f.ruleId + ' finding is suppressed by an inline justification with no source reference. Whether that justification holds is undetermined here — verify and record it before the compliance gate can pass.'
          : 'Exception for ' + f.ruleId + ' is well-formed and its source resolves. Whether "' + exception.source + '" actually justifies this rule in this scope is undetermined here — verify and record it before the compliance gate can pass.',
        exceptionRef: exception,
      });
    }

    filesScanned.push({
      file: relFile, kind: isSpec ? 'spec' : 'support', bytes: src.length, sha256: fileHashes[relFile],
      tests: testBlocks.length, describes: describeBlocks.length,
    });
  }

  /* --- unused allow-list entries --- */
  for (const e of allow.entries) if (e.active && !e.used) push('exception-unused', allow.file || 'Testing/qa-allow.json', 1, 'entry for ' + e.ruleId + ' (' + e.file + ') matched nothing in scope');

  /* --- guard rules that could not run: no helper of that name under the automation root --- */
  if (specsWithTests) {
    if (!guardHelpers.console) addNotRun('console-guard-missing', 'no ' + consoleFn + '() definition under the automation root (' + paths.automationRoot + ') — the skill installs helpers/console-guard.ts; for a project equivalent under another name pass --console-guard-fn <name>, otherwise close check 46a by semantic review', 'spec files');
    if (!guardHelpers.network) addNotRun('network-guard-missing', 'no ' + networkFn + '() definition under the automation root (' + paths.automationRoot + ') — the skill always installs helpers/network-guard.ts; for a project equivalent under another name pass --network-guard-fn <name>, otherwise close check 49 by semantic review', 'spec files');
  }

  /* --- uncovered ids --- */
  const uncoveredTcIds = tcIds ? [...tcIds].filter((id) => !referencedTcIds.has(id)) : [];
  for (const id of uncoveredTcIds) push('trace-uncovered-id', tcIdSource || 'supplied list', 1, id + ' has no test referencing it in the scanned scope.');

  /* --- page-class pass: the WHOLE automation root, whatever folder a page class lives in --- */
  const inventoryArg = opts.inventory !== undefined ? opts.inventory : str((opts.args || {}).inventory);
  const pageScan = scanPageClasses({ root, automationDir, files, cache, inventoryArg, push, addNotRun });
  for (const f of pageScan.classes) if (!fileHashes[f.file]) fileHashes[f.file] = f.sha256;

  /* --- backend pass (3.0): every non-spec automation file of a project with an api/ or db/ layer --- */
  let backendFiles = 0;
  if (backendProject) {
    const mapping = mappingRows(root, inventoryArg);
    const scannedRel = new Set(filesScanned.map((f) => f.file));
    for (const abs of walk(automationDir, (p) => isCodeFile(p) && !isSpecFile(p), 12)) {
      if (scannedRel.has(rel(root, abs))) continue;
      const s = loadStripped(abs, cache);
      if (!s || s.parseError) continue;
      backendFiles++;
      const relFile = rel(root, abs);
      if (!fileHashes[relFile]) fileHashes[relFile] = sha256(s.src);
      const add = (ruleId, line, message, extra) => { const r = RULES[ruleId]; findings.push({ ruleId, severity: r ? r.severity : 'warning', file: relFile, line, message, ...(extra || {}) }); };
      scanBackendText(s, relFile, abs, dirs, add);
      scanBackendMembers(s, relFile, abs, dirs, mapping, dbEnvAllowed, add, backendCounts);
    }
  }
  if (need.record && !recordHelpers.record) addNotRun('record-missing', 'no ' + recordFn + '() definition under the automation root (' + paths.automationRoot + ') — the skill installs helpers/record.ts; for a project equivalent under another name pass --record-fn <name>, otherwise close check 54 by semantic review', 'api / db tests');

  /* --- fingerprint --- */
  for (const f of supportFilesRead) {
    const r = rel(root, f);
    if (!fileHashes[r]) { const src = read(f); if (src !== null) fileHashes[r] = sha256(src); }
  }
  for (const cfg of configFiles(root, automationDir, allow.file, paths.manifestFile, cache)) {
    const src = read(cfg.abs);
    if (src !== null) fileHashes[cfg.rel] = sha256(src);
  }
  const fp = digestOf(fileHashes);

  /* --- counts and gate --- */
  const counts = { files: filesScanned.length, tests: filesScanned.reduce((a, f) => a + f.tests, 0), violation: 0, warning: 0, review: 0, info: 0, exceptions: exceptions.length, notRun: notRun.length, byRule: {}, byFile: {}, layers: layerCounts, layerUse, mutationMembers: backendCounts.mutationMembers };
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    counts.byRule[f.ruleId] = (counts.byRule[f.ruleId] || 0) + 1;
    if (f.severity === 'violation') counts.byFile[f.file] = (counts.byFile[f.file] || 0) + 1;
  }
  const review = findings.filter((f) => f.severity === 'review');

  let gate;
  let gateReason;
  if (!filesScanned.length && !parseFailures.length && !unreadable.length) {
    gate = 'NOT_RUN';
    gateReason = targetMissing ? 'target folder not found: ' + paths.tests
      : scopeMode === 'all' ? 'no spec files matched under ' + paths.tests
      : 'the --files selection matched no readable file';
  } else if (unreadable.length || parseFailures.length) {
    gate = 'BLOCKED';
    gateReason = unreadable.length + ' unreadable + ' + parseFailures.length + ' unscannable file(s) — the scan is incomplete, so PASS cannot be asserted. Close the affected checks with other tooling or documented review against the same scopeDigest.';
  } else if (counts.violation > 0) {
    gate = 'FAIL';
    gateReason = counts.violation + ' violation(s) in ' + Object.keys(counts.byFile).length + ' file(s)';
  } else if (layerCounts.unresolved > 0) {
    // the second review item that moves the scanner gate: which evidence a test owes is undecided until its layer is
    gate = 'BLOCKED';
    gateReason = layerCounts.unresolved + ' test(s) whose layer (ui / api / db) could not be established (layer-unresolved) — whether they owe an image or a record is undetermined';
  } else if (pageScan.undecided > 0) {
    // The one review item that moves the scanner gate: Checkpoint A cannot open until every
    // candidate pair has a decision row, and the row IS the documented semantic review —
    // pass it back through --inventory and the item closes mechanically.
    gate = 'BLOCKED';
    gateReason = pageScan.undecided + ' page-class duplicate candidate(s) without an automation-inventory decision (pom-duplicate-page) — record one decision row naming both classes in automation-inventory.md and re-run with --inventory <file>';
  } else {
    gate = 'PASS';
    gateReason = counts.files + ' file(s), ' + counts.tests + ' test(s), 0 violations, ' + counts.warning + ' warning(s), ' + counts.review + ' item(s) needing review, ' + counts.exceptions + ' declared exception(s)';
  }

  return {
    tool: 'validate-automation',
    schemaVersion: SCHEMA_VERSION,
    readOnly: true,
    root,
    generatedOn: new Date().toISOString(),
    config: {
      manifest: paths.manifestFile, manifestState: paths.manifestState,
      paths: { tests: paths.tests, pages: paths.pages, automationRoot: paths.automationRoot, api: rel(root, apiDir), db: rel(root, dbDir) },
      layersDeclared: !!paths.layers, scopeMode, evidenceFn, recordFn, requireSteps, backendProject, backendFiles,
      recordHelpers, documentLayers: docLayers ? docLayers.size : null,
      allowFile: allow.file, inventoryFile: pageScan.inventory.file,
      idSources: { tcIds: tcIdSource, tcIdCount: tcIds ? tcIds.size : 0, reqIds: reqIdSource, reqIdCount: reqIds ? reqIds.size : 0 },
      b8: { consoleGuardFn: consoleFn, consoleGuardHelper: guardHelpers.console, networkGuardFn: networkFn, networkGuardHelper: guardHelpers.network, admissionHelper },
    },
    scope: { filesScanned, supportFilesRead: [...supportFilesRead].map((f) => rel(root, f)), unreadable, parseFailures, tests: layerTests },
    pageScan: {
      note: 'Every page class under the automation root (constructor takes a Page, or extends a page class), wherever it lives. Candidate pairs are evidence for the automation inventory, never a verdict; an undecided pair keeps the scanner gate BLOCKED until its inventory row is passed with --inventory.',
      root: rel(root, automationDir), filesScanned: pageScan.filesScanned, classes: pageScan.classes.map((c) => ({ file: c.file, line: c.line, name: c.name, extends: c.extends, routes: c.routes, locators: c.locators.length })),
      candidates: pageScan.candidates, decided: pageScan.decided, undecided: pageScan.undecided, inventory: pageScan.inventory,
    },
    fingerprint: { scopeDigest: fp.scopeDigest, fileCount: fp.fileCount, files: fileHashes, excludes: ['reports/', 'screenshots/', 'automation-logs/', 'coverage/'] },
    findings,
    review,
    exceptions,
    notRun,
    traceability: {
      note: 'Linkage is not coverage. A referenced ID proves a test points at a requirement; it does not prove the requirement\'s required outcomes are asserted.',
      tcIdsKnown: tcIds ? tcIds.size : null,
      tcIdsReferenced: [...referencedTcIds].sort(),
      uncoveredTcIds: uncoveredTcIds.sort(),
      requirementOutcomeCoverage: 'NOT_ASSESSED — see outcome-coverage-unassessed review items',
    },
    counts,
    gate,
    gateReason,
    complianceNote: 'This gate is the SCANNER gate only. A compliance checkpoint may record PASS only when there are no confirmed violations AND every review[] and notRun[] item has been closed — by this scanner, by other project tooling, or by documented semantic review carried out against this same scopeDigest. Every review[] and notRun[] entry is an APPLICABLE check: leaving one open keeps the checkpoint BLOCKED for that item, and recording it as PASS or as "N/A" is invalid. N/A belongs only to a rule that has no subject in this scope.',
    limits: LIMITS,
  };
}

/* ---------------- helpers used by analyze ---------------- */

function scanPom(s, add, inBackendTest = () => false) {
  const checks = [
    ['pom-raw-locator', /\b(page|ctx|context)\s*\??\.\s*(locator|getByTestId|getByRole|getByLabel|getByPlaceholder|getByText|getByTitle|getByAltText|frameLocator)\s*\(/g, 'Raw locator in a spec — selectors belong in the page object.'],
    ['pom-navigation', /\bpage\s*\??\.\s*(goto|reload|goBack|goForward|waitForSelector|addInitScript|setContent|route)\s*\(/g, 'Raw page driving in a spec — wrap it in a page-object method.'],
    ['pom-evaluate', /\??\.\s*(evaluate|evaluateHandle|\$\$eval|\$eval)\s*\(/g, 'In-page evaluation in a spec — expose it as a page-object method that returns the observable result.'],
    ['pom-keyboard', /\bpage\s*\??\.\s*(keyboard|mouse|touchscreen)\s*\./g, 'Raw input in a spec — expose it as a page-object method that returns the observable result.'],
  ];
  for (const [id, re, msg] of checks) for (const m of s.code.matchAll(re)) add(id, s.lineOf(m.index), msg);

  for (const m of s.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\??\.\s*(locator|count|innerText|textContent|nth|first|last|all|getBy[A-Za-z]+)\s*\(/g)) {
    if (NON_RECEIVERS.has(m[1])) continue;
    if (inBackendTest(m.index)) continue;   // result.rows.count() / body.items.first() in an api / db test is data, not a locator
    add('pom-chained-locator', s.lineOf(m.index), 'Chaining .' + m[3] + '() off ' + m[1] + '.' + m[2] + ' reaches through an exposed locator — that is the same violation as an inline selector, one level deeper. Add a page-object method that returns the result.');
  }

  const bodies = [];
  for (const b of findBlocks(s, testIdentifiers(s).ids)) if (b.body) bodies.push(b.body);
  const inAnyBody = (off) => bodies.some((r) => off >= r.start && off < r.end);
  const DECL = /(^|\n)[ \t]*(?:export\s+)?(?:async\s+function\s+([A-Za-z_$][\w$]*)|function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
  for (const m of DECL.exec ? s.code.matchAll(DECL) : []) {
    const off = m.index + m[1].length;
    if (inAnyBody(off)) continue;
    const name = m[2] || m[3] || m[4] || m[5];
    const line = s.lineOf(off);
    const lineText = lineTextAt(s, line);
    // a one-line delegating alias to a fixture is explicitly allowed
    if (/=>[^{]*\(.*\)\s*;?\s*$/.test(lineText) && !/\{\s*$/.test(lineText)) continue;
    add('pom-spec-helper', line, 'A spec file holds test cases only; "' + name + '" drives or wraps behaviour that belongs in its owning layer (page object, fixture, or the project\'s equivalent).');
  }
}

function lineTextAt(s, line) {
  const start = s.lineStarts[line - 1];
  const end = line < s.lineStarts.length ? s.lineStarts[line] : s.code.length;
  return s.code.slice(start, end);
}

function adjacentJustification(s, line, minLen, wordRe) {
  for (const c of s.comments) {
    if (c.line !== line && c.line !== line - 1) continue;
    const text = c.text.replace(/^\s*\*+/, '').trim();
    if (text.length < minLen) continue;
    if (/^qa-allow/.test(text)) continue;
    if (wordRe && !wordRe.test(text)) continue;
    return text;
  }
  return null;
}

/** Requirement IDs are written inline in a suite title (`REQ-014: …`), not in brackets. */
function plainTokens(title, re) {
  return [...new Set(String(title).match(re) || [])];
}

function titleTokens(title, re) {
  const out = [];
  for (const m of String(title).matchAll(/\[([^\]]+)\]/g))
    for (const part of m[1].split(','))
      if (re.test(part.trim())) out.push(part.trim());
  return out;
}

/* ---------------- test layers + API / DB rules (3.0) ----------------
   The layer decides the Playwright project and the evidence a test owes (an image for ui / hybrid, a record for api /
   db / api+db / hybrid). It is read from what the test touches — never guessed: nothing found is `unresolved` in a
   project that has an api/ or db/ layer (review, the scanner gate BLOCKED), and `ui` in every other project. */

const BROWSER_PARAMS = new Set(['page', 'context', 'browser']);
const DB_DRIVERS = /^(?:pg|pg-promise|postgres|mysql|mysql2(?:\/promise)?|mssql|tedious|oracledb|mongodb|mongoose|@prisma\/client|knex|typeorm|sequelize|better-sqlite3|sqlite3|ioredis|redis)$/;
// SELECT needs a column list of SQL tokens before FROM ("Select a country from the list" is a label, not a query)
const SQL_ANY = /^\s*(?:select\s+(?:distinct\s+|top\s+\d+\s+)?(?:\*|[\w.*"[\]()]+(?:\s*,\s*[\w.*"[\]()]+)*)\s+from\s+[\w."[\]]+|insert\s+into\s|update\s+[\w."[\]]+\s+set\s|delete\s+from\s|merge\s+into\s|truncate\s|exec(?:ute)?\s+[\w.[\]]+|with\s+\w+\s+as\s*\()/i;
const SQL_WRITE = /^\s*(?:insert\s+into\s|update\s+[\w."[\]]+\s+set\s|delete\s+from\s|merge\s+into\s|truncate\s|alter\s+table\s|drop\s+table\s|create\s+table\s)/i;
const CONN_LITERAL = /^[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@|(?:^|;)\s*(?:password|pwd)\s*=\s*[^;\s]{3,}/i;
const SECRET_HEADER_KEYS = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token)$/i;
const TOKEN_VALUE = /^(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}$|^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}$/;
const QC_DB_ENV = /^QA_DB(?:_[A-Z0-9]+)*_URL$/;
const EFFECTS = new Set(['read', 'mutation', 'auth', 'unknown']);
const LEDGER_RECEIVERS = new Set(['db', 'ledger', 'dbRecord', 'recorded']);
const RECORD_HELPER_FILES = /(^|[\\/])helpers[\\/](?:record|api-record|db-record|redact)\.(?:ts|js|mts|cts|mjs|cjs)$/;
const DB_ADAPTER_FILE = /(^|[\\/])helpers[\\/]db\.(?:ts|js|mts|cts|mjs|cjs)$/;
const BACKEND_SPEC = /\.(?:api|db)\.spec\.[cm]?[jt]sx?$/i;
const RAW_REQUEST = /\b(request|apiContext|apiRequest)\s*\??\.\s*(get|post|put|patch|delete|head|fetch)\s*\(|\bpage\s*\??\.\s*request\s*\??\.\s*(get|post|put|patch|delete|head|fetch)\s*\(/g;
const BYPASS_CALL = /(^|[^\w$.])(fetch|axios|got|superagent)\s*[.(]|\b(?:globalThis|window|self)\s*\??\.\s*fetch\s*\(|\.\s*newContext\s*\(|\bhttps?\s*\.\s*(?:request|get)\s*\(/g;
const ORM_WRITE = /\b([A-Za-z_$][\w$]*)((?:\s*\??\.\s*[A-Za-z_$][\w$]*)*?)\s*\??\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany|insert|save|remove|destroy|bulkCreate|truncate|increment|decrement|\$executeRaw|\$executeRawUnsafe)\s*\(/g;
const DB_READ = /\b([A-Za-z_$][\w$]*)((?:\s*\??\.\s*[A-Za-z_$][\w$]*)*?)\s*\??\.\s*(query|execute|raw|\$queryRaw|\$queryRawUnsafe|findFirst|findMany|findUnique|findOne|findAll|findByPk|aggregate)\s*\(/g;

const needsImage = (l) => l === 'ui' || l === 'hybrid' || l === 'unresolved';
const needsRecord = (l) => l === 'api' || l === 'db' || l === 'api+db' || l === 'hybrid';
const isBackendLayer = (l) => l === 'api' || l === 'db' || l === 'api+db';
const layerFrom = (u) => (u.ui ? (u.api || u.db ? 'hybrid' : 'ui') : u.api && u.db ? 'api+db' : u.api ? 'api' : u.db ? 'db' : null);
const under = (file, dir) => !!file && !!dir && path.resolve(file).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep);
const kindOfFile = (file, dirs) => (under(file, dirs.apiDir) ? 'api' : under(file, dirs.dbDir) ? 'db' : under(file, dirs.pagesDir) ? 'ui' : null);
// a path inside the automation root (helpers/…, prerequest/…) — never matched against the absolute path
const autoRel = (abs, dirs) => (dirs.automationDir ? path.relative(dirs.automationDir, abs) : abs);

/** TC document behind --tc-ids → Map(TC-ID → layer), or null when the source is not a TC document. */
function docLayersOf(root, tcArg) {
  if (!tcArg || tcArg === true) return null;
  const abs = path.resolve(root, String(tcArg));
  if (!isFile(abs) || !/\.md$/i.test(abs)) return null;
  const tcs = parseTcDocument(read(abs) || '');
  if (!tcs.length) return null;
  return new Map(tcs.map((t) => [t.id, tcLayer(t).layer]));
}

/** Fixture name → 'ui' | 'api' | 'db' for the fixtures whose VALUE is a layer object (one hop: the module the spec imports its test function from). */
function fixtureKinds(s, file, cache, dirs) {
  const out = new Map();
  const imports = importMap(s, file);
  for (const id of testIdentifiers(s).ids) {
    const imp = imports.get(id);
    if (!imp || !imp.file) continue;
    const mod = loadStripped(imp.file, cache);
    if (!mod || mod.parseError) continue;
    const modImports = importMap(mod, mod.file);
    for (const d of fixtureDefinitions(mod)) {
      const body = mod.code.slice(d.body.start, d.body.end);
      if (!/(^|[^\w$.])use\s*\(/.test(body)) continue;
      let kind = null;
      if (/\battachApiRecord\s*\(/.test(body)) kind = 'api';
      else if (/\battachDbRecord\s*\(/.test(body)) kind = 'db';
      else {
        const vars = new Map();
        for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?new\s+([A-Za-z_$][\w$]*)\s*\(/g)) vars.set(m[1], m[2]);
        const used = /(^|[^\w$.])use\s*\(\s*(?:new\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))/.exec(body);
        const cls = used ? used[2] || vars.get(used[3]) : null;
        const ci = cls ? modImports.get(cls) : null;
        if (ci && ci.file) kind = kindOfFile(ci.file, dirs);
      }
      if (kind) out.set(d.name, kind);
    }
  }
  return out;
}

/** What one test touches → { layer, uses: {ui, api, db}, via[] }. `layer` is null when nothing was found. */
function testLayerOf(s, b, blocks, imports, fixKinds, dirs) {
  const u = { ui: false, api: false, db: false };
  const via = [];
  const mark = (k, why) => { if (!u[k]) via.push(k + ': ' + why); u[k] = true; };
  const take = (names, where) => {
    for (const n of names) {
      if (BROWSER_PARAMS.has(n)) mark('ui', n + where);
      else if (n === 'request') mark('api', 'request' + where);
      else if (fixKinds.has(n)) mark(fixKinds.get(n), n + ' fixture' + where);
    }
  };
  const arg = (b.args || []).find(([a, c]) => b.body.start >= a && b.body.start <= c);
  if (arg) take(paramDeps(s.code, arg[0], b.body.start).names, '');
  for (const h of coveringHooks(blocks, b, 'beforeEach')) if (h.args && h.args.length) { const [fa] = h.args[h.args.length - 1]; take(paramDeps(s.code, fa, h.body.start).names.filter((n) => BROWSER_PARAMS.has(n)), ' (beforeEach)'); }
  const body = s.code.slice(b.body.start, b.body.end);
  const fileVars = new Map();
  for (const m of s.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?new\s+([A-Za-z_$][\w$]*)\s*\(/g)) fileVars.set(m[1], m[2]);
  for (const [name, imp] of imports) {
    if (!imp.file) continue;
    const k = kindOfFile(imp.file, dirs);
    if (!k) continue;
    if (new RegExp('(^|[^\\w$.])' + escRe(name) + '\\s*[.(]').test(body) || new RegExp('\\bnew\\s+' + escRe(name) + '\\s*\\(').test(body)) { mark(k, name); continue; }
    for (const [v, cls] of fileVars) if (cls === name && new RegExp('(^|[^\\w$.])' + escRe(v) + '\\s*\\??\\.').test(body)) { mark(k, v + ' (' + name + ')'); break; }
  }
  if (/\bpage\s*\??\.\s*request\b/.test(body)) { mark('ui', 'page.request'); mark('api', 'page.request'); }
  return { layer: layerFrom(u), uses: u, via };
}

/** An `effect:` string literal inside the call's argument range, or null. */
function effectOf(s, open, close) {
  const seg = s.code.slice(open, close);
  const m = /\beffect\s*:\s*/.exec(seg);
  if (!m) return null;
  const at = open + m.index + m[0].length;
  const lit = s.strings.find((t) => t.start === at);
  return lit ? lit.value : '(not a literal)';
}
const normPathTemplate = (p) => String(p || '').split('?')[0].replace(/\$\{[^}]*\}|\{[^}]*\}|:[A-Za-z_]\w*|<[^>]*>/g, '{}').replace(/\/+$/, '').toLowerCase();

/** The API / DB mapping table of the automation inventory (columns Method | Path | Effect, found by name). */
function mappingRows(root, inventoryArg) {
  if (!inventoryArg) return [];
  const text = read(path.resolve(root, String(inventoryArg)));
  if (text === null) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/\*\*|`/g, '').trim());
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-+/.test(lines[i + 1])) continue;
    const h = cells(lines[i]).map((x) => x.toLowerCase());
    const ci = { method: h.findIndex((x) => /^method/.test(x)), path: h.findIndex((x) => /^(path|endpoint)/.test(x)), effect: h.findIndex((x) => /^effect/.test(x)) };
    if (ci.method < 0 || ci.path < 0 || ci.effect < 0) continue;
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      rows.push({ line: j + 1, method: (c[ci.method] || '').toUpperCase(), path: normPathTemplate(c[ci.path]), effect: (c[ci.effect] || '').toLowerCase().split(/\s/)[0] });
    }
    i += 1;
  }
  return rows;
}

/** Rules that read any automation file: connection literals, secret header values, redirect overrides, driver imports, write SQL. */
function scanBackendText(s, relFile, abs, dirs, add, inSpec = false) {
  const inRoot = autoRel(abs, dirs);
  const exemptHelper = RECORD_HELPER_FILES.test(inRoot);
  for (let i = 0; i < s.strings.length; i++) {
    const lit = s.strings[i];
    if (CONN_LITERAL.test(lit.value)) add('db-connection-literal', lit.line, 'Connection string with a credential in a literal — the connection string lives only in the QC-named environment variable (db_access: env:{VAR}), never in a file.');
    const prev = s.strings[i - 1];
    const keyed = prev && /:\s*$/.test(s.code.slice(prev.end + 1, lit.start)) && SECRET_HEADER_KEYS.test(prev.value);
    if (!exemptHelper && ((keyed && lit.value.length >= 8 && !/^\$\{|process\.env|^<|REPLACE|xxxx/i.test(lit.value)) || TOKEN_VALUE.test(lit.value.trim()))) add('api-secret-header', lit.line, 'A token, key or cookie written as a literal' + (keyed ? ' for "' + prev.value + '"' : '') + ' — authenticate through the API-auth helper / the role\'s environment variables, never a value in code.');
    if (!exemptHelper && !inSpec && SQL_WRITE.test(lit.value)) add('db-write-freeform', lit.line, 'Write SQL text — a test changes data only through the recorded client\'s structured insert / update / delete (db-record), which bounds every statement to run-owned primary keys, checks cascades and triggers, and ledgers the write.');
    if (/(?:from|require\(|import\()\s*$/.test(s.code.slice(Math.max(0, lit.start - 12), lit.start)) && DB_DRIVERS.test(lit.value) && !under(abs, dirs.dbDir) && !DB_ADAPTER_FILE.test(inRoot)) add('db-driver-import', lit.line, 'Database driver "' + lit.value + '" imported outside db/ and helpers/db — the driver is reached only through the db/ layer over the recorded client.');
  }
  for (const m of s.code.matchAll(/\bmaxRedirects\s*:\s*(\d+)/g)) if (Number(m[1]) !== 0) add('api-redirect-enabled', s.lineOf(m.index), 'maxRedirects: ' + m[1] + ' follows redirects automatically — every call keeps maxRedirects: 0 and the recorded request validates each Location against the permitted hosts BEFORE sending (and never re-sends a mutation after 301 / 302 / 303).');
}

/** api/ and db/ member rules, prerequest / fixture labels. Runs over every non-spec automation file of a project with a backend layer. */
function scanBackendMembers(s, relFile, abs, dirs, mapping, dbEnvAllowed, add, counts) {
  const inRoot = autoRel(abs, dirs);
  if (RECORD_HELPER_FILES.test(inRoot)) return;
  if (under(abs, dirs.apiDir)) {
    for (const m of s.code.matchAll(BYPASS_CALL)) add('api-mutation-unledgered', s.lineOf(m.index + (m[1] || '').length), 'The API client sends a request outside the recorded request (' + (m[2] || m[0].trim()) + ') — no record, no resource ledger, no data-changes gate check, no redirect validation. Use the recorded request the fixture hands over.');
    for (const m of s.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*(get|post|put|patch|delete|head|fetch)\s*\(/g)) {
      if (!/request|api|http|client|ctx/i.test(m[1]) || COLLECTION_RECEIVERS.has(m[1])) continue;
      const open = m.index + m[0].length - 1;
      const close = matchDelim(s.code, open);
      if (close < 0) continue;
      const eff = effectOf(s, open, close);
      const line = s.lineOf(m.index);
      if (!eff || !EFFECTS.has(eff)) { add('api-effect-undeclared', line, m[1] + '.' + m[2] + '() declares no effect' + (eff ? ' ("' + eff + '" is not read / mutation / auth / unknown)' : '') + ' — every call carries effect: "read" | "mutation" | "auth" | "unknown" from the automation-inventory mapping row (never decided by the HTTP method).'); continue; }
      if (eff === 'mutation' || eff === 'unknown') counts.mutationMembers++;
      const first = s.strings.find((t) => t.start >= open + 1 && t.start <= open + 3);
      const method = m[2] === 'fetch' ? null : m[2].toUpperCase();
      if (first && method) {
        const row = mapping.find((r) => r.method === method && r.path === normPathTemplate(first.value));
        if (row && row.effect && row.effect !== eff) add('api-effect-mismatch', line, method + ' ' + first.value + ' declares effect "' + eff + '" but the automation-inventory mapping row (line ' + row.line + ') says "' + row.effect + '" — the mapping row, decided from the verified contract, is the authority.');
      }
    }
  }
  if (under(abs, dirs.dbDir)) {
    const recvOk = (root, chain) => LEDGER_RECEIVERS.has(root) || (root === 'this' && /^\s*\??\.\s*(db|ledger|dbRecord|recorded)\b/.test(chain));
    for (const m of s.code.matchAll(ORM_WRITE)) {
      if (COLLECTION_RECEIVERS.has(m[1]) || NON_RECEIVERS.has(m[1]) && m[1] !== 'this') continue;
      if (recvOk(m[1], m[2])) { if (/^(insert|update|delete)$/.test(m[3])) counts.mutationMembers++; continue; }
      add('db-write-unledgered', s.lineOf(m.index), m[1] + m[2].replace(/\s+/g, '') + '.' + m[3] + '() writes through an unrecorded client — every write goes through the recorded client\'s insert / update / delete, which bounds it to run-owned keys and ledgers it.');
    }
    for (const m of s.code.matchAll(DB_READ)) {
      if (COLLECTION_RECEIVERS.has(m[1]) || NON_RECEIVERS.has(m[1]) && m[1] !== 'this') continue;
      if (recvOk(m[1], m[2])) continue;
      add('db-record-missing', s.lineOf(m.index), m[1] + m[2].replace(/\s+/g, '') + '.' + m[3] + '() reads through an unrecorded client — use the recorded client\'s read(name, sql, params) so the query and its result are evidence.');
    }
  }
  if (under(abs, dirs.dbDir) || DB_ADAPTER_FILE.test(inRoot)) {
    for (const m of s.code.matchAll(/\bprocess\s*\.\s*env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['"]))/g)) {
      let name = m[1];
      if (!name) { const lit = s.strings.find((t) => t.start === m.index + m[0].length - 1); name = lit ? lit.value : '(computed)'; }
      if (QC_DB_ENV.test(name) || dbEnvAllowed.has(name) || /^(PW_|QA_DATA_|QA_DB_EXPECTED)/.test(name)) continue;
      add('db-env-not-qc', s.lineOf(m.index), 'process.env.' + name + ' — the connection comes only from the QC-named variable (default QA_DB[_NAME]_URL; another name only via db_access: env:{VAR} → --db-env ' + name + ').');
    }
  }
  if (/^(?:prerequest|fixtures)[\\/]/.test(inRoot)) {
    for (const m of s.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*(post|put|patch|delete)\s*\(/g)) {
      if (!/request|api|http|client/i.test(m[1]) || COLLECTION_RECEIVERS.has(m[1])) continue;
      const open = m.index + m[0].length - 1;
      const close = matchDelim(s.code, open);
      if (close < 0 || /\bpurpose\s*:/.test(s.code.slice(open, close))) continue;
      add('api-mutation-in-setup-unlabelled', s.lineOf(m.index), m[1] + '.' + m[2] + '() changes data in setup code without purpose: "setup" — label it so the record and the ledger keep setup apart from the behaviour under test (and the test-data consent applies, not the data-changes gate).');
    }
  }
}

/* ---------------- B8 rules — staged at severity `review` (Revision 3 B8; Revision 3.1 §3.5) ----------------
   Each one reads names and shapes of comment/string-stripped code, like every rule above; what it cannot
   establish it never claims. A finding is an open item for the checkpoint; none of them moves the gate. */

const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniqList = (xs) => [...new Set(xs)];
const NUMERIC_EXPR = /^[\s\d_.+\-*/()]+$/;
const isNumericExpr = (v) => NUMERIC_EXPR.test(v) && /\d/.test(v);
// `const NAME[: Type] = value` up to the end of the statement or line (strings are blanked, so a quoted number never matches)
const DECLARATION = /(^|[^\w$.])(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[A-Za-z_$][\w$<>\[\]|. ]*)?=\s*([^;\n]+)/g;
const declaredValue = (raw) => raw.trim().replace(/\s+as\s+const\s*$/, '').replace(/,\s*$/, '').trim();
// words of an identifier: camelCase, PascalCase and SNAKE_CASE split alike ("maxWaitMs" → max wait ms)
const nameWords = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_$]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
const POLICY_WORDS = new Set(['timeout', 'timeouts', 'tolerance', 'threshold', 'thresholds', 'delay', 'deadline', 'wait', 'retries', 'retry', 'interval', 'epsilon', 'precision', 'budget', 'grace', 'poll', 'duration', 'ms', 'millis', 'seconds', 'secs']);

/** check 6 — a spec redeclares a timeout / tolerance / threshold (or the TIMEOUTS policy itself). Specs only. */
function scanConstants(s, add) {
  for (const m of s.code.matchAll(DECLARATION)) {
    const name = m[3];
    const value = declaredValue(m[4]);
    const at = m.index + m[1].length;
    if (name === 'TIMEOUTS') {
      add('constant-redeclared', s.lineOf(at), '"TIMEOUTS" is declared in a spec and shadows the project policy — import it from timeouts.ts, the one source of every timeout (check 6).', { constant: name });
      continue;
    }
    if (!isNumericExpr(value) || !nameWords(name).some((w) => POLICY_WORDS.has(w))) continue;
    add('constant-redeclared', s.lineOf(at), '"' + name + ' = ' + value + '" declares a timeout / tolerance / threshold in a spec. One source decides it: take it from timeouts.ts (TIMEOUTS.*) or from the page object that owns the constant, so calibration and review see one value (check 6).', { constant: name, value });
  }
}

// an empty .catch() handler: () => {} · (e) => {} · e => {} · (e: Error) => undefined · async () => {} · function () {}
const EMPTY_HANDLER = /^(?:async\s+)?(?:\(\s*(?:[A-Za-z_$][\w$]*\s*(?::\s*[A-Za-z_$][\w$.<>\[\]| ]*)?)?\s*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{\s*;?\s*\}|undefined|void\s+0)$|^(?:async\s+)?function\s*[A-Za-z_$]?[\w$]*\s*\([^)]*\)\s*\{\s*;?\s*\}$/;
const commentWithin = (s, a, b) => s.comments.some((c) => c.start > a && c.end <= b);

/** check 28 — an error swallowed with no statement and no explanation. Every layer. */
function scanEmptyCatch(s, add) {
  for (const m of s.code.matchAll(/(^|[^\w$.])catch\s*(?:\([^)]*\))?\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchDelim(s.code, open);
    if (close < 0) continue;
    if (s.code.slice(open + 1, close).replace(/[\s;]/g, '').length) continue;
    if (commentWithin(s, open, close)) continue;   // the documented swallow: the comment inside says why
    add('empty-catch', s.lineOf(m.index + m[1].length), 'Empty catch: the error is swallowed with no statement and no explanation. Surface it (rethrow, or fail the step with a message naming what broke) — or, when swallowing is deliberate (an evidence-only helper, best-effort cleanup), say why in a comment inside the block (check 28).');
  }
  for (const m of s.code.matchAll(/\.\s*catch\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchDelim(s.code, open);
    if (close < 0) continue;
    if (!EMPTY_HANDLER.test(s.code.slice(open + 1, close).trim())) continue;
    if (commentWithin(s, open, close)) continue;
    add('empty-catch', s.lineOf(m.index), 'Empty .catch() handler: the rejection is swallowed with no statement and no explanation. Let it fail the step — or, when swallowing is deliberate (a late rejection already reported, best-effort cleanup), say why in a comment inside the handler (check 28).');
  }
}

const TIMEOUT_KEY = /(^|[^\w$.])(timeout|actionTimeout|navigationTimeout|globalTimeout|deadline)\s*:\s*([^,}\n)]+)/g;
const TIMEOUT_CALL = /\.\s*(setTimeout|setDefaultTimeout|setDefaultNavigationTimeout)\s*\(\s*([^()]*?)\s*\)/g;
const ZERO = /^\(?\s*0+(?:\.0+)?\s*\)?$/;

/** check 43 — an inline timeout value. Every layer except the policy file itself (timeouts.ts). */
function scanTimeoutLiterals(s, relFile, add) {
  if (/(^|\/)timeouts\.(ts|tsx|mts|cts|js|mjs|cjs)$/i.test(relFile)) return;
  const numericConsts = new Map();
  for (const m of s.code.matchAll(DECLARATION)) { const v = declaredValue(m[4]); if (isNumericExpr(v)) numericConsts.set(m[3], v); }
  const literalOf = (raw) => {
    const v = String(raw).trim();
    if (isNumericExpr(v)) return { value: v, via: null };
    if (numericConsts.has(v)) return { value: numericConsts.get(v), via: v };
    return null;
  };
  const policy = ' — every timeout comes from timeouts.ts (TIMEOUTS.*; a known long operation gets an operations.* key with its reason beside it), so calibration and the watchdog see one policy';
  for (const m of s.code.matchAll(TIMEOUT_KEY)) {
    const at = m.index + m[1].length;
    let k = at - 1;
    while (k >= 0 && /\s/.test(s.code[k])) k--;
    if (k < 0 || (s.code[k] !== '{' && s.code[k] !== ',')) continue;   // an object-literal property only (never a ternary or a type)
    const lit = literalOf(m[3]);
    if (!lit) continue;
    const zero = ZERO.test(lit.value.replace(/_/g, ''));
    add('timeout-literal', s.lineOf(at), 'Inline timeout "' + m[2] + ': ' + m[3].trim() + '"' + (lit.via ? ' (' + lit.via + ' = ' + lit.value + ' in this file)' : '') + policy + (zero ? '; 0 also disables the limit entirely' : '') + ' (check 43).', { key: m[2], value: lit.value });
  }
  for (const m of s.code.matchAll(TIMEOUT_CALL)) {
    const lit = literalOf(m[2]);
    if (!lit) continue;
    add('timeout-literal', s.lineOf(m.index), '"' + m[1] + '(' + m[2].trim() + ')" sets an inline budget' + (lit.via ? ' (' + lit.via + ' = ' + lit.value + ' in this file)' : '') + policy + ' (check 43).', { key: m[1], value: lit.value });
  }
}

/** The file under `dir` that DEFINES `fnName` (function / const / export list), or null. */
function helperDefinedUnder(dir, fnName, cache, root) {
  if (!isDir(dir)) return null;
  const n = escRe(fnName);
  const re = new RegExp('\\bfunction\\s*\\*?\\s*' + n + '\\b|\\b(?:const|let|var)\\s+' + n + '\\s*(?::[^=;]+)?=|\\bexport\\s*\\{[^}]*\\b' + n + '\\b');
  for (const f of walk(dir, (p) => isCodeFile(p) && !isSpecFile(p), 12)) {
    const s = loadStripped(f, cache);
    if (s && !s.parseError && re.test(s.code)) return rel(root, f);
  }
  return null;
}

/** Hooks of `kind` that run for test block `t`: file-level ones and those of every enclosing describe. */
function coveringHooks(blocks, t, kind) {
  const anc = new Set();
  for (let p = t.parent; p; p = p.parent) anc.add(p);
  return blocks.filter((h) => h.kind === 'hook.' + kind && h.body && (h.parent === null || anc.has(h.parent)));
}

/** One hop: the module the spec imports its test function from calls the guard (an automatic fixture). */
function fixtureModuleCalls(s, file, cache, callSource) {
  const imports = importMap(s, file);
  for (const id of testIdentifiers(s).ids) {
    const imp = imports.get(id);
    if (!imp || !imp.file) continue;
    const mod = loadStripped(imp.file, cache);
    if (mod && !mod.parseError && new RegExp(callSource).test(mod.code)) return true;
  }
  return false;
}

/** checks 46a / 49 — the guard attached in a covering beforeEach, its handle kept and reported in a covering afterEach. */
function scanGuard(ruleId, fnName, what, s, file, blocks, testBlocks, cache, add) {
  const callRe = new RegExp('(^|[^\\w$.])' + escRe(fnName) + '\\s*\\(', 'g');
  const calls = [...s.code.matchAll(callRe)].map((m) => m.index + m[1].length);
  if (!calls.length && fixtureModuleCalls(s, file, cache, callRe.source)) return;   // attached through the test layer's fixture
  const inside = (r, off) => off >= r.start && off < r.end;
  const seen = new Set();
  const emit = (line, msg) => { if (seen.has(line + '|' + msg)) return; seen.add(line + '|' + msg); add(ruleId, line, msg); };
  for (const t of testBlocks) {
    const hookCalls = calls.filter((off) => coveringHooks(blocks, t, 'beforeEach').some((h) => inside(h.body, off)));
    if (!hookCalls.length) {
      const own = calls.find((off) => inside(t.body, off));
      if (own !== undefined) emit(s.lineOf(own), fnName + '() is called inside the test body, not in a beforeEach — attach the ' + what + ' once per test in beforeEach (and report it in afterEach) so every test of the spec is covered (code-craft §11).');
      else emit(t.line, 'No ' + what + ' for this test: ' + fnName + '() is not attached in a beforeEach that covers it, nor by the fixture module the spec imports its test function from. Attach it in beforeEach and report it in afterEach (code-craft §11).');
      continue;
    }
    const handles = [];
    for (const off of hookCalls) {
      const mm = /([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?$/.exec(s.code.slice(Math.max(0, off - 120), off));
      if (mm) handles.push(mm[1]);
    }
    if (!handles.length) { emit(s.lineOf(hookCalls[0]), fnName + '() is attached in beforeEach but its handle is not kept, so report() can never run in afterEach — what the ' + what + ' collects is lost (code-craft §11).'); continue; }
    const reported = coveringHooks(blocks, t, 'afterEach').some((h) => handles.some((v) => new RegExp('(^|[^\\w$.])' + escRe(v) + '\\s*\\??\\.\\s*report\\s*\\(').test(s.code.slice(h.body.start, h.body.end))));
    if (!reported) emit(s.lineOf(hookCalls[0]), fnName + '() is attached in beforeEach but never reported in afterEach (' + uniqList(handles).join(' / ') + '.report(testInfo)) — what the ' + what + ' collects is lost (code-craft §11).');
  }
}

/** {automation root}/helpers/admission.* — the admission contract has a subject only when the layer exists. */
function admissionHelperIn(dir, root) {
  for (const e of ['ts', 'js', 'mts', 'cts', 'mjs', 'cjs']) { const f = path.join(dir, 'helpers', 'admission.' + e); if (isFile(f)) return rel(root, f); }
  return null;
}

// Playwright's own fixtures: a dependency on one of them never admits anything, and is never "untraceable"
const PW_FIXTURES = new Set(['page', 'context', 'browser', 'browserName', 'request', 'baseURL', 'playwright', 'isMobile', 'headless', 'viewport', 'launchOptions', 'contextOptions', 'storageState', 'locale', 'timezoneId', 'colorScheme', 'channel', 'javaScriptEnabled', 'video', 'trace', 'screenshot', 'connectOptions', 'userAgent', 'acceptDownloads', 'actionTimeout', 'navigationTimeout', 'bypassCSP', 'deviceScaleFactor', 'extraHTTPHeaders', 'geolocation', 'hasTouch', 'httpCredentials', 'ignoreHTTPSErrors', 'offline', 'permissions', 'proxy', 'serviceWorkers', 'testIdAttribute', 'defaultBrowserType']);
const COLLECTION_RECEIVERS = new Set(['set', 'map', 'seen', 'cache', 'list', 'arr', 'array', 'ids', 'names', 'items', 'headers', 'params', 'searchParams', 'classList', 'url', 'urls', 'keys', 'values', 'result', 'results', 'acc', 'out', 'errors', 'warnings', 'parts', 'formData']);

/** The first side effect a body shows (heuristic, see LIMITS), or null. */
function sideEffectIn(code, start, end, prereq) {
  const body = code.slice(start, end);
  for (const n of prereq) if (new RegExp('(^|[^\\w$.])' + escRe(n) + '\\s*[(.]').test(body)) return n + ' (prerequest/)';
  let m;
  const http = /([A-Za-z_$][\w$]*)\s*\??\.\s*(post|put|patch|delete)\s*\(/g;
  while ((m = http.exec(body))) if (/request|api|client|http|ctx|context/i.test(m[1])) return m[1] + '.' + m[2] + '()';
  const po = /([A-Za-z_$][\w$]*|\))\s*\??\.\s*((?:create|add|save|update|delete|remove|submit|approve|reject|upload|import|assign)[A-Za-z0-9_$]*)\s*\(/g;
  while ((m = po.exec(body))) if (!COLLECTION_RECEIVERS.has(m[1])) return '.' + m[2] + '()';
  const login = /(^|[^\w$])((?:log_?in|sign_?in)[A-Za-z0-9_$]*)\s*\(/gi;
  while ((m = login.exec(body))) if (!/\bnew\s+$/.test(body.slice(Math.max(0, m.index - 6), m.index + m[1].length))) return m[2] + '()';
  return null;
}

/** Names a fixture or hook function destructures from its first parameter ({ a, b: alias, ...rest }). */
function paramDeps(code, start, end) {
  const p = code.indexOf('(', start);
  if (p < 0 || p >= end) return { names: [], destructured: false };
  const pc = matchDelim(code, p);
  if (pc < 0 || pc > end) return { names: [], destructured: false };
  const params = splitArgs(code, p, pc);
  if (!params.length) return { names: [], destructured: true };
  const [a, b] = params[0];
  let k = a;
  while (k < b && /\s/.test(code[k])) k++;
  if (code[k] !== '{') return { names: [], destructured: false };
  const ke = matchDelim(code, k);
  if (ke < 0) return { names: [], destructured: false };
  const names = [];
  for (const [x, y] of splitArgs(code, k, ke)) { const mm = /^\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)/.exec(code.slice(x, y)); if (mm) names.push(mm[1]); }
  return { names, destructured: true };
}

/** Every function fixture of every `.extend[<…>]({ … })` object in a stripped module. */
function fixtureDefinitions(s) {
  const defs = [];
  const code = s.code;
  for (const m of code.matchAll(/\.\s*extend\s*(?=[<(])/g)) {
    let i = m.index + m[0].length;
    if (code[i] === '<') {   // skip the generic type arguments (an arrow `=>` inside them is not a closer)
      let depth = 0;
      for (; i < code.length; i++) {
        if (code[i] === '<') depth++;
        else if (code[i] === '>' && code[i - 1] !== '=') { depth--; if (depth === 0) { i++; break; } }
      }
      while (i < code.length && /\s/.test(code[i])) i++;
    }
    if (code[i] !== '(') continue;
    const close = matchDelim(code, i);
    if (close < 0) continue;
    let j = i + 1;
    while (j < close && /\s/.test(code[j])) j++;
    if (code[j] !== '{') continue;
    const objEnd = matchDelim(code, j);
    if (objEnd < 0) continue;
    for (const [a, b] of splitArgs(code, j, objEnd)) {
      let ks = a;
      while (ks < b && /\s/.test(code[ks])) ks++;
      let name = null;
      let v = -1;
      const idm = /^([A-Za-z_$][\w$]*)\s*:/.exec(code.slice(ks, b));
      if (idm) { name = idm[1]; v = ks + idm[0].length; }
      else {
        const lit = s.strings.find((t) => t.start === ks);
        const rest = lit ? /^\s*:/.exec(code.slice(lit.end + 1, b)) : null;
        if (rest) { name = lit.value; v = lit.end + 1 + rest[0].length; }
      }
      if (!name) continue;   // a shorthand or a spread is not a definition this scan can read
      while (v < b && /\s/.test(code[v])) v++;
      let fnStart = v;
      let fnEnd = b;
      let scope = 'test';
      if (code[v] === '[') {
        const arrEnd = matchDelim(code, v);
        if (arrEnd < 0 || arrEnd > b) continue;
        const parts = splitArgs(code, v, arrEnd);
        if (!parts.length) continue;
        [fnStart, fnEnd] = parts[0];
        if (parts[1]) {
          const opt = code.slice(parts[1][0], parts[1][1]);
          const sc = /\bscope\s*:\s*(['"`])/.exec(opt);
          const lit = sc ? s.strings.find((t) => t.start === parts[1][0] + sc.index + sc[0].length - 1) : null;
          if (lit && lit.value === 'worker') scope = 'worker';
        }
      }
      if (!/^(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/.test(code.slice(fnStart, fnEnd).trim())) continue;   // a value or option fixture
      const body = findBodyRange(code, [[fnStart, fnEnd]]);
      if (!body) continue;
      defs.push({ name, scope, deps: paramDeps(code, fnStart, fnEnd), body, line: s.lineOf(ks) });
    }
  }
  return defs;
}

/** checks 25a / 47 — Revision 3.1 §3.5: every side-effecting fixture / beforeAll depends on the admission fixtures. */
function scanAdmission(s, file, blocks, add) {
  const prereq = [];
  for (const [local, imp] of importMap(s, file)) if (/prerequest/i.test(imp.spec)) prereq.push(local);
  const defs = fixtureDefinitions(s);
  const byName = new Map(defs.map((d) => [d.name, d]));
  const ADMISSION_NAMES = new Set(['workerAdmission', 'unitAdmission']);
  const reaches = (name, target, seen = new Set()) => {
    if (seen.has(name)) return { ok: false, external: [] };
    seen.add(name);
    const d = byName.get(name);
    if (!d) return { ok: false, external: [] };
    const external = [];
    for (const dep of d.deps.names) {
      if (dep === target) return { ok: true, external: [] };
      if (byName.has(dep)) { const r = reaches(dep, target, seen); if (r.ok) return r; external.push(...r.external); }
      else if (!PW_FIXTURES.has(dep) && !ADMISSION_NAMES.has(dep)) external.push(dep);
    }
    return { ok: false, external };
  };
  for (const d of defs) {
    if (ADMISSION_NAMES.has(d.name)) continue;
    const effect = sideEffectIn(s.code, d.body.start, d.body.end, prereq);
    if (!effect) continue;
    const target = d.scope === 'worker' ? 'workerAdmission' : 'unitAdmission';
    const kind = d.scope === 'worker' ? 'Worker fixture' : 'Test fixture';
    const tail = ' — add ' + target + ' to its parameters' + (d.scope === 'worker' ? '' : ' (or depend on a fixture that does)') + '; until then parallel-plan treats its unit as U4, admitted only at spawn (Revision 3.1 §3.5).';
    if (!d.deps.destructured) { add('admission-contract', d.line, kind + ' "' + d.name + '" has a side effect (' + effect + ') and its dependencies are not destructured, so its admission cannot be traced' + tail, { fixture: d.name, scope: d.scope }); continue; }
    const r = reaches(d.name, target);
    if (r.ok) continue;
    const ext = uniqList(r.external);
    add('admission-contract', d.line, kind + ' "' + d.name + '" has a side effect (' + effect + ') but does not depend on ' + target + (ext.length ? ' (directly, or through ' + ext.join(', ') + ' — defined elsewhere, not traceable here)' : '') + ': it can start before its ' + (d.scope === 'worker' ? 'worker' : 'unit') + ' is admitted' + tail, { fixture: d.name, scope: d.scope, untraceable: ext });
  }
  for (const h of blocks) {
    if (h.kind !== 'hook.beforeAll' || !h.body || !h.args.length) continue;
    const effect = sideEffectIn(s.code, h.body.start, h.body.end, prereq);
    if (!effect) continue;
    const [fa, fb] = h.args[h.args.length - 1];
    const deps = paramDeps(s.code, fa, fb);
    if (deps.names.includes('workerAdmission') || deps.names.some((n) => byName.has(n) && reaches(n, 'workerAdmission').ok)) continue;
    add('admission-contract', h.line, 'beforeAll has a side effect (' + effect + ') but does not take workerAdmission as a parameter: it runs before any admission of its units. Add { workerAdmission } to its parameters; until then its describe is a U4 unit, admitted only at spawn (Revision 3.1 §3.5).', { hook: 'beforeAll' });
  }
}

function configFiles(root, automationDir, allowFile, manifestFile, cache) {
  const out = [];
  const seen = new Set();
  const addIf = (abs) => { const r = rel(root, abs); if (isFile(abs) && !seen.has(r)) { seen.add(r); out.push({ abs, rel: r }); return true; } return false; };
  const configs = [];
  for (const dir of [root, automationDir]) {
    if (!isDir(dir)) continue;
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) if (/^playwright.*\.config\.(ts|js|mjs|cjs)$/i.test(e) && addIf(path.join(dir, e))) configs.push(path.join(dir, e));
  }
  // One hop of RELATIVE imports from each config (the shared timeout policy, an env module):
  // editing them must invalidate a recorded gate exactly as editing the config does. Bare
  // packages and unresolvable specifiers are skipped; a config that cannot be stripped still
  // hashes on its own.
  for (const cfg of configs) {
    const s = cache ? loadStripped(cfg, cache) : null;
    if (!s || s.parseError) continue;
    for (const [, imp] of importMap(s, cfg)) if (imp.file && isCodeFile(imp.file)) addIf(imp.file);
  }
  if (allowFile) addIf(path.resolve(root, allowFile));
  if (manifestFile) addIf(path.resolve(root, manifestFile));
  return out;
}

/* ---------------- page-class duplicate candidates (pom-duplicate-page) ---------------- */

const LOCATOR_CALL = /\.\s*(locator|getByTestId|getByRole|getByLabel|getByPlaceholder|getByText|getByTitle|getByAltText|frameLocator)\s*\(/g;
const ROUTE_CALL = /\.\s*(goto|gotoAppPath|navigate)\s*\(/g;
const ROUTE_FIELD = /\b(url|path|route|pageUrl|pagePath|relativeUrl|baseRoute)\s*(?::\s*string)?\s*=\s*$/i;
const CLASS_HEAD = /\bclass\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?[^{;]*\{/g;

/** Case, separators, a trailing "s" and a trailing "Page" ignored — the same normalization for class names and file stems. */
function pageNameNorm(name) {
  let n = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  n = n.replace(/page$/, '').replace(/s$/, '').replace(/page$/, '');
  return n;
}
function stemNorm(file) {
  return pageNameNorm(path.basename(file).replace(/\.[^.]+$/, '').replace(/\.(page|po|pageobject)$/i, '').replace(/^\d+[-_. ]*/, ''));
}
const routeNorm = (v) => String(v).replace(/^(\$\{[^}]*\})+/, '').trim().replace(/\/+$/, '').toLowerCase();

/** The page classes of one stripped module: name, base, routes and locator keys (string literals inside the class body only). */
function pageClassesOf(s, relFile) {
  const out = [];
  for (const m of s.code.matchAll(CLASS_HEAD)) {
    const brace = m.index + m[0].length - 1;
    const end = matchDelim(s.code, brace);
    if (end < 0) continue;
    const body = s.code.slice(brace + 1, end);
    const strings = s.strings.filter((t) => t.start > brace && t.end < end);
    const inRange = (a, b) => strings.filter((t) => t.start >= a && t.end <= b).map((t) => t.value);
    let takesPage = false;
    const ctor = /\bconstructor\s*\(/.exec(body);
    if (ctor) {
      const open = brace + 1 + ctor.index + ctor[0].length - 1;
      const close = matchDelim(s.code, open);
      const params = close > 0 ? s.code.slice(open + 1, close) : '';
      takesPage = /:\s*Page\b/.test(params) || /(^|[,(\s])page\s*(?:[,)]|$)/.test(params.replace(/\s+/g, ' ').trim() + ')');
    }
    const locators = new Set();
    for (const c of body.matchAll(LOCATOR_CALL)) {
      const open = brace + 1 + c.index + c[0].length - 1;
      const close = matchDelim(s.code, open);
      if (close < 0) continue;
      const lits = inRange(open, close);
      if (lits.length) locators.add(c[1] + ':' + lits.join('|'));
    }
    const routes = new Set();
    for (const c of body.matchAll(ROUTE_CALL)) {
      const open = brace + 1 + c.index + c[0].length - 1;
      const close = matchDelim(s.code, open);
      if (close < 0) continue;
      const lits = inRange(open, close);
      if (lits.length && routeNorm(lits[0])) routes.add(routeNorm(lits[0]));
    }
    for (const t of strings) {
      const before = s.code.slice(Math.max(brace + 1, t.start - 48), t.start);
      if (ROUTE_FIELD.test(before) && routeNorm(t.value)) routes.add(routeNorm(t.value));
    }
    out.push({ file: relFile, line: s.lineOf(m.index), name: m[1], extends: m[2] || null, takesPage, routes: [...routes].sort(), locators: [...locators].sort(), nameNorm: pageNameNorm(m[1]), stemNorm: stemNorm(relFile), members: classMembers(s.code, brace, end) });
  }
  return out;
}

// a member head at depth 0 of a class body: modifiers, then the name, then ( : = ; < ? ! — fields, methods, accessors
const MEMBER_HEAD = /^(?:(?:public|private|protected|static|readonly|override|declare|abstract|async|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*[?!]?\s*(?:[(:=;<]|$)/;
const NOT_MEMBERS = new Set(['constructor', 'if', 'for', 'while', 'switch', 'return', 'await', 'const', 'let', 'var', 'new', 'catch', 'function', 'super', 'this', 'else', 'do', 'try', 'throw']);

/** Member names declared directly in a class body (fields, methods, accessors; the constructor excluded). */
function classMembers(code, open, close) {
  const names = [];
  let depth = 0;
  let atStart = true;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') { depth++; atStart = false; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0 && c === '}') atStart = true; continue; }
    if (depth !== 0) continue;
    if (c === ';' || c === '\n') { atStart = true; continue; }
    if (/\s/.test(c) || !atStart) continue;
    atStart = false;
    const m = MEMBER_HEAD.exec(code.slice(i, Math.min(close, i + 200)));
    if (m && !NOT_MEMBERS.has(m[1]) && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

/** The decision table of automation-inventory.md: rows with the identifiers and file tokens their Class / Candidates cells mention. */
function loadInventory(root, inventoryArg, push) {
  if (!inventoryArg) return { file: null, rows: [], state: 'not-supplied' };
  const abs = path.resolve(root, String(inventoryArg));
  const relFile = rel(root, abs);
  const text = read(abs);
  if (text === null) { push('pom-inventory-unreadable', relFile, 1, 'automation-inventory.md not found or unreadable — no candidate pair is decided.'); return { file: relFile, rows: [], state: 'unreadable' }; }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/\*\*|`/g, '').trim());
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-+/.test(lines[i + 1])) continue;
    const header = cells(lines[i]).map((h) => h.toLowerCase());
    const ci = { screen: header.findIndex((h) => /^screen/.test(h)), decision: header.findIndex((h) => /^decision/.test(h)), cls: header.findIndex((h) => /^class/.test(h)), cand: header.findIndex((h) => /^candidates?/.test(h)), reason: header.findIndex((h) => /^reason/.test(h)) };
    if (ci.decision < 0 || ci.cls < 0 || ci.cand < 0) continue;
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      const mention = [c[ci.cls] || '', c[ci.cand] || ''].join(' ');
      rows.push({
        line: j + 1, screen: c[ci.screen] || '', decision: c[ci.decision] || '', cls: c[ci.cls] || '', candidates: c[ci.cand] || '', reason: ci.reason >= 0 ? c[ci.reason] || '' : '',
        ids: new Set((mention.match(/[A-Za-z_$][\w$]*/g) || []).map((x) => x.toLowerCase())),
        files: new Set((mention.match(/[\w./\\-]+\.(?:ts|tsx|mts|js|mjs|cjs|jsx)\b/g) || []).map((x) => x.replace(/\\/g, '/').toLowerCase())),
      });
    }
    i += 1;
  }
  if (!rows.length) push('pom-inventory-unreadable', relFile, 1, 'automation-inventory.md holds no decision table (columns Screen | Decision | Class | Candidates considered | Reason) — no candidate pair is decided.');
  return { file: relFile, rows, state: rows.length ? 'used' : 'no-table' };
}

/** A row covers a pair when it names BOTH classes (or, for two classes of the same name, both files with a folder component). */
function rowCovers(row, a, b) {
  const fileHit = (c) => [...row.files].some((tok) => tok.includes('/') ? c.file.toLowerCase().endsWith(tok) : path.basename(c.file).toLowerCase() === tok);
  if (a.name.toLowerCase() !== b.name.toLowerCase() && row.ids.has(a.name.toLowerCase()) && row.ids.has(b.name.toLowerCase())) return true;
  return fileHit(a) && fileHit(b) && (a.file !== b.file);
}

function scanPageClasses({ root, automationDir, files, cache, inventoryArg, push, addNotRun }) {
  const seen = new Set();
  const targets = [];
  const consider = (f) => { const abs = path.resolve(f); if (!seen.has(abs) && isCodeFile(abs) && !isSpecFile(abs)) { seen.add(abs); targets.push(abs); } };
  for (const f of walk(automationDir, (p) => isCodeFile(p) && !isSpecFile(p), 12)) consider(f);
  for (const f of files || []) consider(f);
  const classes = [];
  let filesScanned = 0;
  for (const abs of targets) {
    const relFile = rel(root, abs);
    const s = loadStripped(abs, cache);
    if (!s) continue;
    if (s.parseError) { addNotRun('pom-duplicate-page', relFile + ' could not be scanned (' + s.parseError + ') — its page classes were not compared', relFile); continue; }
    filesScanned++;
    if (!/\bclass\s+[A-Za-z_$]/.test(s.code)) continue;
    for (const c of pageClassesOf(s, relFile)) classes.push({ ...c, sha256: sha256(s.src) });
  }
  // A class that extends a qualifying class (by simple name) qualifies too — one extra pass, no deeper.
  const qualifies = (c) => c.takesPage || (c.extends && /page$/i.test(c.extends.split('.').pop()));
  const qualified = new Set(classes.filter(qualifies).map((c) => c.name));
  const pages = classes.filter((c) => qualifies(c) || (c.extends && qualified.has(c.extends.split('.').pop())))
    .sort((x, y) => (x.file < y.file ? -1 : x.file > y.file ? 1 : x.line - y.line));   // deterministic pair order, independent of the walk
  const inventory = loadInventory(root, inventoryArg, push);
  let decided = 0; let undecided = 0; let candidates = 0;
  for (let i = 0; i < pages.length; i++) for (let j = i + 1; j < pages.length; j++) {
    const a = pages[i]; const b = pages[j];
    if (a.file === b.file) continue;
    const kinds = []; const detail = {};
    if (a.nameNorm && (a.nameNorm === b.nameNorm || a.stemNorm === b.stemNorm)) { kinds.push('name'); detail.name = a.nameNorm === b.nameNorm ? 'normalized class names both "' + a.nameNorm + '"' : 'normalized file stems both "' + a.stemNorm + '"'; }
    const routes = a.routes.filter((r) => b.routes.includes(r));
    if (routes.length) { kinds.push('route'); detail.route = routes; }
    const shared = a.locators.filter((l) => b.locators.includes(l));
    if (shared.length >= 2) { kinds.push('locators'); detail.locators = shared; }
    if (!kinds.length) continue;
    candidates++;
    const pair = { a: { file: a.file, line: a.line, class: a.name }, b: { file: b.file, line: b.line, class: b.name } };
    const row = inventory.rows.find((r) => rowCovers(r, a, b));
    const evidenceText = kinds.map((k) => k + (k === 'name' ? ' — ' + detail.name : ' — ' + detail[k].join(', '))).join('; ');
    if (row) {
      decided++;
      push('pom-duplicate-page-decided', a.file, a.line, a.name + ' (' + a.file + ':' + a.line + ') and ' + b.name + ' (' + b.file + ':' + b.line + ') are a candidate pair (' + evidenceText + ') decided by ' + inventory.file + ':' + row.line + ' — screen "' + row.screen + '": ' + row.decision + '.', { pair, evidence: kinds[0], evidenceKinds: kinds, detail, decision: row.decision, screen: row.screen, inventoryFile: inventory.file, inventoryLine: row.line });
    } else {
      undecided++;
      push('pom-duplicate-page', a.file, a.line, a.name + ' (' + a.file + ':' + a.line + ') and ' + b.name + ' (' + b.file + ':' + b.line + ') look like the same page (evidence: ' + evidenceText + '). This is a candidate, not a verdict: decide reuse / extend / create in automation-inventory.md — one row naming both classes with the reason — and pass it with --inventory. Until then the scanner gate stays BLOCKED and Checkpoint A cannot open.', { pair, evidence: kinds[0], evidenceKinds: kinds, detail });
    }
  }
  return { filesScanned, classes: pages, candidates, decided, undecided, inventory: { file: inventory.file, state: inventory.state, rows: inventory.rows.length } };
}

/* ---------------- receiver-chain analysis for positional selectors ---------------- */

/**
 * Walk backwards from the `.` of a `.first()/.last()/.nth()` call over the member chain that
 * feeds it: `root.seg(args).seg(args)…`. Returns the segment names (root first) and, per
 * segment, whether its argument list mentions a `name:` key. A SHAPE walk over stripped
 * code, not a parser: anything it cannot follow ends the chain, which counts as unscoped.
 */
function receiverChain(code, dotAt) {
  const segments = [];
  const named = [];
  let pos = dotAt;
  const skipWs = () => { while (pos > 0 && /\s/.test(code[pos - 1])) pos--; };
  let guard = 0;
  while (guard++ < 40) {
    skipWs();
    if (pos > 0 && code[pos - 1] === ')') {
      let depth = 0; let i = pos - 1;
      for (; i >= 0; i--) {
        const c = code[i];
        if (c === ')' || c === '}' || c === ']') depth++;
        else if (c === '(' || c === '{' || c === '[') { depth--; if (depth === 0) break; }
      }
      if (i < 0) break;
      const args = code.slice(i + 1, pos - 1);
      pos = i;
      skipWs();
      const idm = /([A-Za-z_$][\w$]*)$/.exec(code.slice(Math.max(0, pos - 64), pos));
      if (!idm) break;
      segments.unshift(idm[1]);
      named.unshift(/\bname\s*:/.test(args));
      pos -= idm[1].length;
      skipWs();
      if (pos > 0 && code[pos - 1] === '.') { pos--; if (pos > 0 && code[pos - 1] === '?') pos--; continue; }
      break;
    }
    const idm = /([A-Za-z_$][\w$]*)$/.exec(code.slice(Math.max(0, pos - 64), pos));
    if (idm) { segments.unshift(idm[1]); named.unshift(false); }
    break;
  }
  return { segments, named };
}

function isScopedChain(chain) {
  const { segments, named } = chain;
  if (segments.includes('filter')) return true;
  const rootIdx = segments.findIndex((x, i) => (x === 'getByRole' && named[i]) || x === 'getByTestId');
  if (rootIdx >= 0 && segments.slice(rootIdx + 1).some((x) => /^getBy[A-Z]/.test(x) || x === 'locator')) return true;
  return false;
}

/* ---------------- compact outputs (A3) and the discovery digest (A9) ---------------- */

const SUMMARY_CAP = 20;
const OPEN_ORDER = { violation: 0, review: 1, warning: 2 };

/**
 * The model-facing summary of ONE analyze() payload: the gate and its reason copied verbatim (so the summary gate
 * is the full gate by construction), the counts, and the first open items. `out` names the file the full payload
 * was written to — the findings, review[], notRun[] and exceptions[] live there, every one still an applicable check.
 */
export function summarize(payload, { out = null, cap = SUMMARY_CAP } = {}) {
  const findings = Array.isArray(payload.findings) ? payload.findings : [];
  const open = findings.filter((f) => f.severity in OPEN_ORDER)
    .sort((a, b) => OPEN_ORDER[a.severity] - OPEN_ORDER[b.severity] || (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line || 0) - (b.line || 0)))
    .map((f) => f.ruleId + ' ' + f.file + ':' + f.line);
  const c = payload.counts || {};
  const ps = payload.pageScan || null;
  const fp = payload.fingerprint || null;
  return {
    tool: 'validate-automation', schemaVersion: SCHEMA_VERSION, summary: true, readOnly: !out, root: payload.root,
    gate: payload.gate, gateReason: payload.gateReason,
    counts: { files: c.files ?? 0, tests: c.tests ?? 0, violation: c.violation ?? 0, warning: c.warning ?? 0, review: c.review ?? 0, info: c.info ?? 0, exceptions: c.exceptions ?? 0, notRun: c.notRun ?? 0 },
    byRule: c.byRule || {},
    open: open.slice(0, cap), openTotal: open.length,
    review: findings.filter((f) => f.severity === 'review').length,
    notRun: (payload.notRun || []).length,
    notRunItems: (payload.notRun || []).slice(0, cap).map((n) => n.ruleId + ' — ' + (n.scope || 'all files')),
    exceptions: (payload.exceptions || []).length,
    fingerprint: fp ? { scopeDigest: fp.scopeDigest, files: fp.fileCount } : null,
    pageScan: ps ? { classes: (ps.classes || []).length, candidates: ps.candidates, decided: ps.decided, undecided: ps.undecided } : null,
    full: out,
    note: 'Summary of the full payload — same analyze() call, same gate. Every open review[] / notRun[] item is an APPLICABLE check until closed (compliance-checkpoints.md §1); the full list is in `full`' + (out ? '' : ' (not written: pass --out <file>)') + '.',
  };
}

/**
 * The discovery digest of every page class under the automation root — the machine half of the automation
 * inventory in one call (routes, locator counts, member names, duplicate candidates, decided pairs).
 * Candidates are evidence for the inventory row, never a verdict.
 */
export function pageScanDigest(opts) {
  const root = opts.root;
  const args = opts.args || {};
  const warnings = [];
  const paths = opts.paths || resolvePaths(root, args, (id, f, l, m) => warnings.push({ ruleId: id, file: f, line: l, message: m }));
  const automationDir = path.resolve(root, paths.automationRoot);
  const findings = [];
  const notRun = [];
  const push = (ruleId, file, line, message, extra) => findings.push({ ruleId, severity: RULES[ruleId] ? RULES[ruleId].severity : 'warning', file, line, message, ...(extra || {}) });
  const inventoryArg = opts.inventory !== undefined ? opts.inventory : str(args.inventory);
  const files = (opts.files || []).map((f) => path.resolve(root, f));
  const scan = scanPageClasses({ root, automationDir, files, cache: new Map(), inventoryArg, push, addNotRun: (ruleId, reason, scope) => notRun.push({ ruleId, reason, scope }) });
  const label = (x) => x.class + ' (' + x.file + ':' + x.line + ')';
  const MEMBER_CAP = 40;
  for (const f of findings) if (f.severity === 'warning') warnings.push({ ruleId: f.ruleId, file: f.file, line: f.line, message: f.message });
  return {
    tool: 'validate-automation', schemaVersion: SCHEMA_VERSION, mode: 'page-scan', readOnly: true, root,
    automationRoot: rel(root, automationDir), filesScanned: scan.filesScanned,
    counts: { classes: scan.classes.length, candidates: scan.candidates, decided: scan.decided, undecided: scan.undecided },
    classes: scan.classes.map((c) => ({ class: c.name, file: c.file, line: c.line, extends: c.extends, routes: c.routes.slice(0, 5), locators: c.locators.length, members: (c.members || []).slice(0, MEMBER_CAP), membersTotal: (c.members || []).length })),
    duplicates: findings.filter((f) => f.ruleId === 'pom-duplicate-page').map((f) => ({ a: label(f.pair.a), b: label(f.pair.b), evidence: (f.evidenceKinds || [f.evidence]).join('+') })),
    decided: findings.filter((f) => f.ruleId === 'pom-duplicate-page-decided').map((f) => ({ a: label(f.pair.a), b: label(f.pair.b), decision: f.decision, inventoryLine: f.inventoryLine })),
    inventory: scan.inventory,
    notRun, warnings,
    note: 'Discovery digest for the automation inventory: every page class of the automation root. A duplicate pair is a candidate, never a verdict — the inventory row decides (reuse / extend / create), and an undecided pair keeps the validator gate BLOCKED until that row is passed with --inventory.',
  };
}

/** --out: the full payload, written atomically (temp + rename) — the only file this script ever writes. */
function writeFull(file, payload) {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
  fs.renameSync(tmp, abs);
  return posix(abs);
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'validate-automation',
  usage: 'node validate-automation.mjs [--root <dir>] [--summary] [--out <file>] [--files a,b] [--tests-path <dir>] [--pages-path <dir>] [--automation-root <dir>] [--tc-ids <csv|file>] [--req-ids <csv|file>] [--allow-file <path>] [--evidence-fn <name>] [--console-guard-fn <name>] [--network-guard-fn <name>] [--inventory <automation-inventory.md>] [--require-steps] [--strict] [--pretty]  |  node validate-automation.mjs --page-scan [--root <dir>] [--automation-root <dir>] [--inventory <md>] [--strict] [--pretty]',
  notes: [
    'Read-only on the code it scans. Default exit code is 0; the verdict lives in the JSON payload.',
    '--strict exits 1 on FAIL, 2 on BLOCKED, 3 on NOT_RUN.',
    '--summary prints the compact summary of the same payload (gate, counts, the first 20 open items); --out <file> writes the full payload there (the only file this script writes). The summary gate is the full gate.',
    '--page-scan prints the discovery digest of every page class under the automation root (routes, locator counts, members, duplicate candidates, decided pairs) for the automation inventory; with --strict it exits 2 while a candidate pair is undecided.',
    'The scanner gate is not the compliance gate: review[] and notRun[] items must be closed separately.',
    '--require-steps also reports step-missing (warning) for every test with no test.step() / imported step() — pass it for specs this run generated or updated.',
    'Every page class under the automation root is compared (pom-duplicate-page); --inventory <automation-inventory.md> turns a candidate pair covered by a decision row into pom-duplicate-page-decided (info). An undecided pair keeps the gate BLOCKED.',
    'B8 rules (constant-redeclared, empty-catch, timeout-literal, console-guard-missing, network-guard-missing, admission-contract) are staged at severity review: open items for the checkpoint, never a gate change. The guard rules need the guard helper under the automation root (else notRun); admission-contract runs only when helpers/admission.* exists.',
  ],
  rules: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, { severity: v.severity, exemptible: v.exemptible, title: v.title, checks: RULE_CHECKS[k] || [] }])),
  limits: LIMITS,
};

const STRICT_EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3 };

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const root = path.resolve(str(args.root) || process.cwd());
  if (args['page-scan']) {
    const digest = pageScanDigest({ root, args });
    print(digest, args);
    return args.strict ? (digest.counts.undecided > 0 ? 2 : 0) : 0;
  }
  const filesArg = str(args.files);
  const report = analyze({
    root, args,
    files: filesArg ? filesArg.split(',').map((f) => f.trim()).filter(Boolean) : null,
    treatAsSpec: !!args['treat-as-spec'],
  });
  const out = str(args.out) ? writeFull(str(args.out), report) : null;
  print(args.summary ? summarize(report, { out }) : report, args);
  return args.strict ? (STRICT_EXIT[report.gate] ?? 0) : 0;
}

// the CLI entry: a realpath comparison — a URL string built from argv[1] misses an 8.3 short path (C:\\Users\\NAME~1\\…), a
// symlink or another drive-letter case and the script then exited 0 having done nothing
if ((() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })()) {
  let code = 0;
  try { code = main(); }
  catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({
      tool: 'validate-automation', schemaVersion: SCHEMA_VERSION, readOnly: true,
      root: path.resolve(str(args.root) || process.cwd()), generatedOn: new Date().toISOString(),
      findings: [], review: [], exceptions: [],
      notRun: [{ ruleId: '*', reason: 'internal error: ' + e.message }],
      counts: { violation: 0, warning: 0, review: 0, info: 0 },
      gate: 'BLOCKED', gateReason: 'internal error: ' + e.message,
      limits: LIMITS,
    }, args);
    code = args.strict ? 2 : 0;
  }
  process.exit(code);
}
