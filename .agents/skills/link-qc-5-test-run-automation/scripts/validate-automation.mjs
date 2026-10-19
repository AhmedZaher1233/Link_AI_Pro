#!/usr/bin/env node
// validate-automation.mjs — read-only static screen for generated Playwright automation.
// Node >= 18, zero dependencies. Never writes anything.
//
// WHAT THIS IS: a screen, not a judge. It reports what a token-level scan over
// comment/string-stripped source can establish with confidence. Everything it cannot
// establish is emitted at severity `review` and must be closed by semantic review —
// it is never guessed in either direction.
//
// A `gate: PASS` means "no banned text pattern was found". It does NOT mean the tests
// are correct, nor that they verify their requirement. See `limits` in the payload.
//
// Exit code is 0 by default (the result lives in the JSON payload), matching the other
// read-only scripts in this suite. `--strict` maps the gate onto an exit code for CI.
import path from 'node:path';
import fs from 'node:fs';
import {
  parseArgs, print, isDir, isFile, read, rel, sha256, digestOf,
  loadStripped, matchDelim, testIdentifiers, findBlocks,
  importMap, findMemberBody, isStraightLine, walk, isSpecFile, isCodeFile, ancestorOfKind,
} from './scan-lib.mjs';

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
  if (!opts.pagesDir || !isDir(opts.pagesDir)) return null;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  if (want.length < 4) return null;
  const files = walk(opts.pagesDir, isCodeFile, 6);
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
  const evidenceFn = opts.evidenceFn || str((opts.args || {})['evidence-fn']) || 'captureEvidence';
  const evidenceRe = new RegExp('\\b' + evidenceFn + '\\s*\\(');
  const evidenceReG = new RegExp('\\b' + evidenceFn + '\\s*\\(', 'g');

  /* --- architecture --- */
  const layersKnown = !!(paths.layers || isDir(pagesDir));
  const analysisOpts = { pagesDir, root };

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
        scanPom(s, add);
      }
    }

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

      // evidence
      const direct = [...bodyCode.matchAll(evidenceReG)].map((m) => b.body.start + m.index);
      evidenceReG.lastIndex = 0;
      if (direct.length > 1) {
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

  /* --- uncovered ids --- */
  const uncoveredTcIds = tcIds ? [...tcIds].filter((id) => !referencedTcIds.has(id)) : [];
  for (const id of uncoveredTcIds) push('trace-uncovered-id', tcIdSource || 'supplied list', 1, id + ' has no test referencing it in the scanned scope.');

  /* --- page-class pass: the WHOLE automation root, whatever folder a page class lives in --- */
  const inventoryArg = opts.inventory !== undefined ? opts.inventory : str((opts.args || {}).inventory);
  const pageScan = scanPageClasses({ root, automationDir, files, cache, inventoryArg, push, addNotRun });
  for (const f of pageScan.classes) if (!fileHashes[f.file]) fileHashes[f.file] = f.sha256;

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
  const counts = { files: filesScanned.length, tests: filesScanned.reduce((a, f) => a + f.tests, 0), violation: 0, warning: 0, review: 0, info: 0, exceptions: exceptions.length, notRun: notRun.length, byRule: {}, byFile: {} };
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
      paths: { tests: paths.tests, pages: paths.pages, automationRoot: paths.automationRoot },
      layersDeclared: !!paths.layers, scopeMode, evidenceFn, requireSteps,
      allowFile: allow.file, inventoryFile: pageScan.inventory.file,
      idSources: { tcIds: tcIdSource, tcIdCount: tcIds ? tcIds.size : 0, reqIds: reqIdSource, reqIdCount: reqIds ? reqIds.size : 0 },
    },
    scope: { filesScanned, supportFilesRead: [...supportFilesRead].map((f) => rel(root, f)), unreadable, parseFailures },
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

function scanPom(s, add) {
  const checks = [
    ['pom-raw-locator', /\b(page|ctx|context)\s*\??\.\s*(locator|getByTestId|getByRole|getByLabel|getByPlaceholder|getByText|getByTitle|getByAltText|frameLocator)\s*\(/g, 'Raw locator in a spec — selectors belong in the page object.'],
    ['pom-navigation', /\bpage\s*\??\.\s*(goto|reload|goBack|goForward|waitForSelector|addInitScript|setContent|route)\s*\(/g, 'Raw page driving in a spec — wrap it in a page-object method.'],
    ['pom-evaluate', /\??\.\s*(evaluate|evaluateHandle|\$\$eval|\$eval)\s*\(/g, 'In-page evaluation in a spec — expose it as a page-object method that returns the observable result.'],
    ['pom-keyboard', /\bpage\s*\??\.\s*(keyboard|mouse|touchscreen)\s*\./g, 'Raw input in a spec — expose it as a page-object method that returns the observable result.'],
  ];
  for (const [id, re, msg] of checks) for (const m of s.code.matchAll(re)) add(id, s.lineOf(m.index), msg);

  for (const m of s.code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)\s*\??\.\s*(locator|count|innerText|textContent|nth|first|last|all|getBy[A-Za-z]+)\s*\(/g)) {
    if (NON_RECEIVERS.has(m[1])) continue;
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
    out.push({ file: relFile, line: s.lineOf(m.index), name: m[1], extends: m[2] || null, takesPage, routes: [...routes].sort(), locators: [...locators].sort(), nameNorm: pageNameNorm(m[1]), stemNorm: stemNorm(relFile) });
  }
  return out;
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

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'validate-automation',
  usage: 'node validate-automation.mjs [--root <dir>] [--pretty] [--files a,b] [--tests-path <dir>] [--pages-path <dir>] [--automation-root <dir>] [--tc-ids <csv|file>] [--req-ids <csv|file>] [--allow-file <path>] [--evidence-fn <name>] [--inventory <automation-inventory.md>] [--require-steps] [--strict]',
  notes: [
    'Read-only. Default exit code is 0; the verdict lives in the JSON payload.',
    '--strict exits 1 on FAIL, 2 on BLOCKED, 3 on NOT_RUN.',
    'The scanner gate is not the compliance gate: review[] and notRun[] items must be closed separately.',
    '--require-steps also reports step-missing (warning) for every test with no test.step() / imported step() — pass it for specs this run generated or updated.',
    'Every page class under the automation root is compared (pom-duplicate-page); --inventory <automation-inventory.md> turns a candidate pair covered by a decision row into pom-duplicate-page-decided (info). An undecided pair keeps the gate BLOCKED.',
  ],
  rules: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, { severity: v.severity, exemptible: v.exemptible, title: v.title }])),
  limits: LIMITS,
};

const STRICT_EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3 };

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const root = path.resolve(str(args.root) || process.cwd());
  const filesArg = str(args.files);
  const report = analyze({
    root, args,
    files: filesArg ? filesArg.split(',').map((f) => f.trim()).filter(Boolean) : null,
    treatAsSpec: !!args['treat-as-spec'],
  });
  print(report, args);
  return args.strict ? (STRICT_EXIT[report.gate] ?? 0) : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === new URL(`file://${path.resolve(process.argv[1] || '')}`).href) {
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
