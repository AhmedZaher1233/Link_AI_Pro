#!/usr/bin/env node
// impact.mjs — decides which test cases (TC-IDs) of a story's Playwright spec files are impacted by
// code changes since each TC last ran, so skill 5 re-runs only those. Node >= 18, zero dependencies.
//
// Read-only. It reads the automation root and the stage summaries run-stage.mjs wrote under
// {results_root}/artifacts/progress/, and returns ONE JSON payload. It never writes anything.
//
// FAIL SAFE BY DESIGN — it over-selects, never under-selects. Whatever it cannot follow precisely
// widens the selection: a receiver it cannot type is matched BY NAME against every class of the test's
// import closure (our code must be statically imported to run), and code it cannot follow at all — a
// dynamic member access (`this[x]`, `obj[name](…)`), a relative `require(` / `import(`, `eval`, an
// import that resolves to nothing, a module it cannot scan — marks the test `unknown`, and an unknown
// test is ALWAYS stale. It never guesses a receiver from a variable name. A receiver typed `C` (annotation,
// return type, fixture type, `this` inside a C member) may hold a subclass at runtime, so every subclass of C in
// the test's import closure contributes its own resolution of the member (its override); only a `new C(…)` value
// is known to be exactly C. A `serial:{gap}` group is fed by `setup:{gap}` and by every setup group whose
// `feeds: ["serial:…"]` names it.
//
// Model (plan A2, references/final-run.md <second_run>): a test's fingerprint is the sha256 over its
// parts, each `partId=sha` (text normalized: comments and whitespace dropped, `@run:` scheduling tags and
// a describe's `mode` removed, string literals kept byte for byte — a selector edit counts):
//   test:{testId}                 the test call            hook:{file}::{describe}::{kind}#{n}  hooks in scope
//   spec:{file}                   the spec remainder        describe:{file}::{path}              ancestor describe remainders
//   fixture:{file}#{name}         used test.extend fixtures setup:{gap}                          setup journey of a serial:{gap} TC
//   module:{file}                 remainder of a split module (imports, top-level code, class heads, non-member statements)
//   file:{file}                   a module hashed whole (no class / fixture / timeouts split, or not delimitable)
//   member:{file}#{Class}.{name}  a class member the test actually REACHES (methods, accessors, arrow members, locator fields)
//   data:{file}                   a data file imported or referenced by a path literal
//   config:{file}                 playwright.config.* / tsconfig.json       playwright:version   the installed Playwright
//   timeouts:{key}                one flattened TIMEOUTS key (`operations.save`) — config-referenced keys are global
// A TC's fingerprint is the sha256 over `testId=fingerprint` of every test carrying it.
//
// Contract: references/final-run.md (<second_run>), references/run-report.md §3 (summary files);
// run-stage.mjs imports `fingerprintTests` (start / end of a call) and `selectStale`; parallel-plan.mjs imports
// `closureOf` (per test: the closure files and part ids); `reverseDependencies` answers "which tests / TCs depend on
// these changed files" (fail safe: a test with an unknown part depends on everything).
//
// Usage:
//   node impact.mjs fingerprint --root <automation_root> [--spec a,b] [--tcs TC-1,TC-2] [--run-file <phase-N.json>] [--pretty]
//   node impact.mjs select --root <automation_root> [--spec a,b] --progress <results_root>/artifacts/progress [--run-file <phase-N.json>] [--pretty]
//   node impact.mjs reverse --root <automation_root> [--spec a,b] --files <changed file,…> [--parts <part id,…>] [--run-file <phase-N.json>] [--pretty]
// Exit code always 0 — the result is in the payload; an error is { outcome: 'BLOCKED', reason }.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, print, read, isFile, isDir, rel, sha256, stripSource, matchDelim, findBlocks,
  testIdentifiers, walk, isSpecFile, isCodeFile, splitArgs,
} from './scan-lib.mjs';

export const SCHEMA_VERSION = 'skill5-impact/1';

const CODE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx'];
const DATA_EXT = /\.(json|csv|tsv|xlsx?|txt|xml|png|jpe?g|gif|pdf|docx?|sql|graphql|gql|ya?ml)$/i;   // 3.0: query files and API contracts too
const CONFIG_RE = /^playwright.*\.config\.(ts|mts|cts|js|mjs|cjs)$/i;
const HOOKS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const TEST_MODS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);
const LOCATOR_METHODS = new Set(['locator', 'getByTestId', 'getByRole', 'getByLabel', 'getByPlaceholder', 'getByText', 'getByTitle', 'getByAltText', 'frameLocator', 'first', 'last', 'nth', 'filter', 'and', 'or', 'contentFrame', 'owner']);
const CLASS_MODS = new Set(['public', 'private', 'protected', 'static', 'readonly', 'async', 'override', 'abstract', 'declare', 'accessor']);
const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'throw', 'try', 'catch', 'finally', 'await', 'async', 'yield', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'function', 'class', 'extends', 'implements', 'const', 'let', 'var', 'import', 'export', 'from', 'as', 'type', 'interface', 'enum', 'declare', 'namespace', 'module', 'abstract', 'public', 'private', 'protected', 'static', 'readonly', 'override', 'get', 'set', 'true', 'false', 'null', 'undefined', 'keyof', 'satisfies', 'is', 'asserts', 'infer', 'debugger', 'with', 'require', 'eval']);
const GLOBALS = new Set(['console', 'JSON', 'Math', 'process', 'Object', 'Array', 'Promise', 'Date', 'Number', 'String', 'Boolean', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Buffer', 'URL', 'URLSearchParams', 'window', 'document', 'globalThis', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Intl', 'Symbol', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Reflect', 'Proxy', 'BigInt', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone', 'fetch', 'TextEncoder', 'TextDecoder', 'AbortController', 'navigator', 'location', 'localStorage', 'sessionStorage', '__dirname', '__filename', 'module', 'exports']);
const PRIMS = new Set(['string', 'number', 'boolean', 'void', 'undefined', 'null', 'never', 'object', 'bigint', 'symbol', 'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Map', 'Set', 'Date', 'RegExp', 'Error', 'Buffer', 'Function', 'String', 'Number', 'Boolean', 'Object', 'URL']);
const BUILTIN_FIXTURES = new Set(['page', 'context', 'browser', 'browserName', 'request', 'playwright', 'baseURL', 'headless', 'viewport', 'channel', 'isMobile', 'hasTouch', 'locale', 'timezoneId', 'storageState', 'trace', 'video', 'screenshot', 'testIdAttribute', 'javaScriptEnabled', 'userAgent', 'colorScheme', 'deviceScaleFactor', 'extraHTTPHeaders', 'geolocation', 'httpCredentials', 'ignoreHTTPSErrors', 'offline', 'permissions', 'proxy', 'acceptDownloads', 'bypassCSP', 'launchOptions', 'contextOptions', 'connectOptions', 'actionTimeout', 'navigationTimeout', 'serviceWorkers']);
const NODE_BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '').split('/')[0]));

const LIB = Object.freeze({ k: 'lib' });
const DATA = Object.freeze({ k: 'data' });
const ID_START = /[A-Za-z_$#]/;
const ID_CHAR = /[\w$]/;

const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿';
const csvList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean);
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort(natural).map((k) => [k, o[k]]));
const shaBuf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readBuf = (p) => { try { return fs.readFileSync(p); } catch { return null; } };

function skipWs(code, i, end = code.length) { while (i < end && isWs(code[i])) i++; return i; }
function prevNonWs(code, i) { let j = i - 1; while (j >= 0 && isWs(code[j])) j--; return j; }
function readIdent(code, i) {
  if (i >= code.length || !ID_START.test(code[i])) return null;
  let j = i + 1;
  while (j < code.length && ID_CHAR.test(code[j])) j++;
  return { name: code.slice(i, j), end: j };
}
function readDotted(code, i) {
  const first = readIdent(code, i);
  if (!first) return null;
  let name = first.name, j = first.end;
  for (;;) {
    const k = skipWs(code, j);
    if (code[k] !== '.' || code[k + 1] === '.') break;
    const nx = readIdent(code, skipWs(code, k + 1));
    if (!nx) break;
    name += '.' + nx.name; j = nx.end;
  }
  return { name, end: j };
}
/** code[i] === '<' → index just after the matching '>' (generic brackets), or -1. */
function skipAngle(code, i) {
  let depth = 0;
  for (let k = i; k < code.length; k++) {
    const c = code[k];
    if (c === '<') depth++;
    else if (c === '>') { if (code[k - 1] === '=') continue; depth--; if (depth === 0) return k + 1; }
    else if (c === '(' || c === '[' || c === '{') { const e = matchDelim(code, k); if (e < 0) return -1; k = e; }
    else if (c === ';' || c === ')' || c === ']' || c === '}') return -1;
  }
  return -1;
}
function subtract([a, b], holes) {
  const out = [];
  let cur = a;
  for (const [h0, h1] of holes) {
    if (h1 <= cur || h0 >= b) continue;
    if (h0 > cur) out.push([cur, h0]);
    cur = Math.max(cur, h1);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}
const inRanges = (ranges, i) => ranges.some(([a, b]) => i >= a && i < b);

/**
 * Type text from i until a stop char at depth 0. stops: any of '=;{,)' plus 'A' (stop at `=>`).
 * nlStop: a newline also ends the type when the next line starts a new statement / member.
 */
function readType(code, i, end, stops, nlStop) {
  let k = i;
  let angle = 0;
  while (k < end) {
    const c = code[k];
    if (c === '(' || c === '[' || c === '{') {
      if (angle === 0 && stops.includes(c)) break;
      const e = matchDelim(code, k);
      if (e < 0) return { start: i, end: k, fail: true };
      k = e + 1; continue;
    }
    if (c === '<') { angle++; k++; continue; }
    if (c === '>') { if (code[k - 1] !== '=' && angle > 0) angle--; k++; continue; }
    if (angle === 0) {
      if (c === '=' && code[k + 1] === '>') { if (stops.includes('A')) break; k += 2; continue; }
      if (c === ')' || c === ']' || c === '}') break;
      if (stops.includes(c)) break;
      if (c === '\n' && nlStop) {
        const n = skipWs(code, k, end);
        const p = prevNonWs(code, k);
        if (!'|&,:<(=.'.includes(code[p]) && !'|&.=)>]'.includes(code[n])) break;
      }
    }
    k++;
  }
  return { start: i, end: k };
}

/** End of an expression starting at a: `;`, an enclosing closer, or a newline that ends the statement (ASI). */
function exprEnd(code, a, end) {
  let k = a;
  while (k < end) {
    const c = code[k];
    if (c === '(' || c === '[' || c === '{') {
      const e = matchDelim(code, k);
      if (e < 0 || e >= end) return end;
      k = e + 1; continue;
    }
    if (c === ';' || c === ')' || c === ']' || c === '}') return k;
    if (c === '\n') {
      const n = skipWs(code, k, end);
      const p = prevNonWs(code, k);
      const nc = code[n] || '';
      const pc = code[p] || '';
      if (nc === '}' || n >= end) return k;
      const contNext = '.?:,+-*/%&|^=<>'.includes(nc);
      const contPrev = '=+-*/%&|^<>,(.?:[{!~'.includes(pc) || /(^|[^\w$])(await|new|return|typeof|in|of|instanceof|as)$/.test(code.slice(Math.max(0, p - 11), p + 1));
      if (!contNext && !contPrev) return k;
    }
    k++;
  }
  return k;
}

/* ================================================================ context ================================================================ */

function makeCtx(root, cache) {
  const ctx = { root, cache, warnings: [], partSha: new Map(), fileShaCache: new Map(), closures: new Map(), typing: new Set(), memo: new Map() };
  ctx.tsconfig = loadTsconfig(root, ctx);
  ctx.packages = loadPackages(root);
  return ctx;
}

function readJsonc(file) {
  const src = read(file);
  if (src === null) return null;
  const s = stripSource(src);
  const buf = src.split('');
  for (const c of s.comments) for (let k = c.start; k < c.end; k++) if (buf[k] !== '\n') buf[k] = ' ';
  for (const mt of s.code.matchAll(/,(\s*[}\]])/g)) buf[mt.index] = ' ';
  try { return JSON.parse(buf.join('')); } catch { return null; }
}

function loadTsconfig(root, ctx) {
  const chain = [];
  let file = path.join(root, 'tsconfig.json');
  for (let k = 0; k < 6 && file && isFile(file); k++) {
    const j = readJsonc(file);
    if (!j) { ctx.warnings.push('tsconfig could not be parsed: ' + rel(root, file)); break; }
    chain.push({ file, j });
    const ext = j.extends;
    if (typeof ext === 'string' && ext.startsWith('.')) {
      const f = path.resolve(path.dirname(file), ext);
      file = isFile(f) ? f : (isFile(f + '.json') ? f + '.json' : null);
    } else file = null;
  }
  if (!chain.length) return null;
  let baseUrl = null, paths = null, pathsDir = null;
  for (const { file: f, j } of chain.slice().reverse()) {
    const co = j.compilerOptions || {};
    if (typeof co.baseUrl === 'string') baseUrl = path.resolve(path.dirname(f), co.baseUrl);
    if (co.paths && typeof co.paths === 'object') { paths = co.paths; pathsDir = path.dirname(f); }
  }
  const prefixLen = (p) => p.split('*')[0].length;
  const list = Object.entries(paths || {})
    .map(([pattern, targets]) => ({ pattern, targets: Array.isArray(targets) ? targets.filter((t) => typeof t === 'string') : [] }))
    .sort((a, b) => prefixLen(b.pattern) - prefixLen(a.pattern) || natural(a.pattern, b.pattern));
  return { baseUrl, pathsBase: baseUrl || pathsDir || root, paths: list, files: chain.map((c) => c.file) };
}

function loadPackages(root) {
  const names = new Set();
  const dirs = [];
  let dir = root;
  for (let k = 0; k < 30; k++) {
    dirs.push(dir);
    const pj = path.join(dir, 'package.json');
    if (isFile(pj)) {
      try {
        const j = JSON.parse(read(pj));
        for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
          for (const n of Object.keys(j[key] || {})) names.add(n);
      } catch { /* an unreadable package.json declares nothing */ }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return { names, dirs };
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolveFileLike(base) {
  if (isFile(base)) return base;
  const noJs = base.replace(/\.(m|c)?jsx?$/, '');
  if (noJs !== base) for (const e of CODE_EXT) if (isFile(noJs + e)) return noJs + e;
  for (const e of CODE_EXT) if (isFile(base + e)) return base + e;
  for (const e of CODE_EXT) if (isFile(path.join(base, 'index' + e))) return path.join(base, 'index' + e);
  return null;
}

function matchPattern(pattern, spec) {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === spec ? '' : null;
  const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
  if (spec.length < pre.length + post.length || !spec.startsWith(pre) || !spec.endsWith(post)) return null;
  return spec.slice(pre.length, spec.length - post.length);
}

function resolveSpec(ctx, m, spec) {
  const ok = (f) => ({ status: 'ok', abs: f, kind: isCodeFile(f) ? 'code' : 'data' });
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const f = resolveFileLike(path.resolve(m.dir, spec));
    return f ? ok(f) : { status: 'unresolved', why: 'no such file' };
  }
  if (spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0])) return { status: 'lib' };
  const ts = ctx.tsconfig;
  if (ts) {
    for (const p of ts.paths) {
      const sub = matchPattern(p.pattern, spec);
      if (sub === null) continue;
      for (const t of p.targets) {
        const f = resolveFileLike(path.resolve(ts.pathsBase, t.replace('*', sub)));
        if (f) return ok(f);
      }
      return { status: 'unresolved', why: "matches the tsconfig path '" + p.pattern + "' but no file exists" };
    }
    if (ts.baseUrl) { const f = resolveFileLike(path.resolve(ts.baseUrl, spec)); if (f) return ok(f); }
  }
  const pkg = packageName(spec);
  if (ctx.packages.names.has(pkg) || ctx.packages.dirs.some((d) => isDir(path.join(d, 'node_modules', pkg)))) return { status: 'lib' };
  return { status: 'unresolved', why: 'neither a tsconfig alias nor a declared or installed package' };
}

function fileSha(ctx, abs) {
  if (ctx.fileShaCache.has(abs)) return ctx.fileShaCache.get(abs);
  const buf = readBuf(abs);
  const v = buf ? shaBuf(buf) : sha256('(missing)');
  ctx.fileShaCache.set(abs, v);
  return v;
}

/* ================================================================ module analysis ================================================================ */

function getMod(ctx, abs) {
  const key = 'impact:mod:' + abs;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  const m = analyzeModule(ctx, abs);
  ctx.cache.set(key, m);
  return m;
}

function analyzeModule(ctx, abs) {
  const m = {
    abs, rel: rel(ctx.root, abs), dir: path.dirname(abs), kind: isCodeFile(abs) ? 'code' : 'data',
    src: '', code: '', s: null, strings: [], strAt: new Map(), parseError: null, exMask: null, depth: null,
    imports: new Map(), deps: [], unresolved: [], reexports: [], importRanges: [],
    classes: [], localDecls: new Map(), exports: new Map(), timeouts: null, fixtureDecls: new Map(),
    holes: [], whole: true, remainder: null, classFail: null,
  };
  if (m.kind === 'data') return m;
  const src = read(abs);
  if (src === null) { m.parseError = 'unreadable'; return m; }
  m.src = src;
  const s = stripSource(src);
  m.s = s; m.code = s.code; m.strings = s.strings;
  for (const t of s.strings) m.strAt.set(t.start, t);
  if (s.parseError) { m.parseError = s.parseError; return m; }
  m.exMask = new Uint8Array(src.length);
  for (const c of s.comments) m.exMask.fill(1, c.start, c.end);
  m.depth = new Int32Array(src.length + 1);
  let d = 0;
  for (let i = 0; i < m.code.length; i++) { m.depth[i] = d; const c = m.code[i]; if (c === '{') d++; else if (c === '}') d--; }
  m.depth[m.code.length] = d;
  parseImports(ctx, m);
  parseConfigureMode(m);
  parseDecls(m);
  parseClasses(m);
  parseTimeouts(m);
  parseFixtureDecls(m);
  const holes = [];
  if (!m.classFail) for (const c of m.classes) for (const e of c.members.values()) for (const r of e.ranges) holes.push(r);
  for (const t of m.fixtureDecls.values()) if (t.ok) for (const p of t.props) holes.push([p.start, p.end]);
  if (m.timeouts && !m.timeouts.fail) holes.push(m.timeouts.literal);
  if (m.classFail || (m.timeouts && m.timeouts.fail) || !holes.length) {
    m.whole = true;
    for (const c of m.classes) c.delimited = false;
  } else {
    m.whole = false;
    m.holes = holes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  m.remainder = m.whole ? [[0, m.src.length]] : subtract([0, m.src.length], m.holes);
  return m;
}

const IMPORT_RE = /(^|[^\w$.])import\s+(type\s+)?([^;'"`]*?)\s*\bfrom\s*(['"])/g;
const SIDE_IMPORT_RE = /(^|[^\w$.])import\s*(['"])/g;
const EXPORT_FROM_RE = /(^|[^\w$.])export\s+(type\s+)?(\*(?:\s*as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s*from\s*(['"])/g;

function addDep(m, r, spec) {
  if (r.status === 'ok') { if (!m.deps.some((x) => x.abs === r.abs)) m.deps.push({ abs: r.abs, kind: r.kind }); }
  else if (r.status === 'unresolved') {
    const why = "unresolved import '" + spec + "' in " + m.rel + ' (' + r.why + ')';
    if (!m.unresolved.includes(why)) m.unresolved.push(why);
  }
}

function parseNamedList(text) {
  const out = [];
  for (const part of text.split(',')) {
    const bits = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/).map((x) => x.trim());
    if (!bits[0]) continue;
    out.push({ orig: bits[0], local: bits[1] || bits[0] });
  }
  return out;
}

function parseImports(ctx, m) {
  const code = m.code;
  for (const mt of code.matchAll(IMPORT_RE)) {
    const quoteAt = mt.index + mt[0].length - 1;
    const lit = m.strAt.get(quoteAt);
    if (!lit) continue;
    const spec = lit.value;
    const r = resolveSpec(ctx, m, spec);
    m.importRanges.push([mt.index + mt[1].length, lit.end + 1]);
    addDep(m, r, spec);
    const clause = mt[3];
    const bind = (local, imported) => { if (/^[A-Za-z_$][\w$]*$/.test(local)) m.imports.set(local, { spec, imported, status: r.status, target: r.status === 'ok' ? r.abs : null, kind: r.kind || null }); };
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) for (const n of parseNamedList(braced[1])) bind(n.local, n.orig);
    const ns = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/);
    if (ns) bind(ns[1], '*');
    const dflt = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, '').replace(/,/g, ' ').trim();
    if (dflt && /^[A-Za-z_$][\w$]*$/.test(dflt)) bind(dflt, 'default');
  }
  for (const mt of code.matchAll(SIDE_IMPORT_RE)) {
    const quoteAt = mt.index + mt[0].length - 1;
    const lit = m.strAt.get(quoteAt);
    if (!lit) continue;
    m.importRanges.push([mt.index + mt[1].length, lit.end + 1]);
    addDep(m, resolveSpec(ctx, m, lit.value), lit.value);
  }
  for (const mt of code.matchAll(EXPORT_FROM_RE)) {
    const quoteAt = mt.index + mt[0].length - 1;
    const lit = m.strAt.get(quoteAt);
    if (!lit) continue;
    const spec = lit.value;
    const r = resolveSpec(ctx, m, spec);
    m.importRanges.push([mt.index + mt[1].length, lit.end + 1]);
    addDep(m, r, spec);
    const clause = mt[3].trim();
    const entry = { spec, status: r.status, abs: r.status === 'ok' ? r.abs : null, star: false, ns: null, names: [] };
    if (clause.startsWith('*')) {
      entry.star = true;
      const ns = clause.match(/as\s+([A-Za-z_$][\w$]*)/);
      if (ns) entry.ns = ns[1];
    } else entry.names = parseNamedList(clause.slice(1, -1)).map((n) => ({ orig: n.orig, exported: n.local }));
    m.reexports.push(entry);
  }
  m.importRanges.sort((a, b) => a[0] - b[0]);
}

/** `test.describe.configure({ mode: … })` — only the `mode` property is excluded from every hash. */
function parseConfigureMode(m) {
  for (const mt of m.code.matchAll(/\bdescribe\s*\.\s*configure\s*\(/g)) {
    const open = mt.index + mt[0].length - 1;
    const b = skipWs(m.code, open + 1);
    if (m.code[b] !== '{') continue;
    const close = matchDelim(m.code, b);
    if (close < 0) continue;
    for (const [a, e] of splitArgs(m.code, b, close))
      if (/^\s*(?:mode|(['"])mode\1)\s*:/.test(m.src.slice(a, e))) m.exMask.fill(1, a, e);
  }
}

function parseDecls(m) {
  const code = m.code;
  const DECL = /(^|[^\w$.])(export\s+)?(default\s+)?(?:declare\s+)?(?:abstract\s+)?(async\s+)?(function\s*\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const mt of code.matchAll(DECL)) {
    const at = mt.index + mt[1].length;
    if (m.depth[at] !== 0) continue;
    const kind = mt[5].startsWith('function') ? 'function' : mt[5];
    const name = mt[6];
    const after = mt.index + mt[0].length;
    const decl = { kind, name, at, after, annot: null, initPos: null };
    if (kind === 'const' || kind === 'let' || kind === 'var') {
      let k = skipWs(code, after);
      if (code[k] === ':') { const t = readType(code, k + 1, code.length, '=;,', true); decl.annot = code.slice(t.start, t.end).trim(); k = skipWs(code, t.end); }
      if (code[k] === '=' && code[k + 1] !== '=' && code[k + 1] !== '>') decl.initPos = skipWs(code, k + 1);
    }
    if (kind === 'function') {
      const p = code.indexOf('(', after);
      const pc = p >= 0 ? matchDelim(code, p) : -1;
      if (pc > 0) {
        const k = skipWs(code, pc + 1);
        if (code[k] === ':') { const t = readType(code, k + 1, code.length, '{;', false); decl.returnType = code.slice(t.start, t.end).trim(); }
      }
    }
    if (!m.localDecls.has(name)) m.localDecls.set(name, decl);
    if (mt[2]) m.exports.set(mt[3] ? 'default' : name, name);
  }
  for (const mt of code.matchAll(/(^|[^\w$.])export\s+default\s+/g)) {
    const at = mt.index + mt[0].length;
    if (m.depth[at] !== 0 || m.exports.has('default')) continue;
    const id = readIdent(code, at);
    if (id && /^\s*;?\s*$/.test(code.slice(id.end, exprEnd(code, id.end, code.length)))) m.exports.set('default', id.name);
    else m.exports.set('default', { expr: at });
  }
  for (const mt of code.matchAll(/(^|[^\w$.])export\s+(?:type\s+)?\{([^}]*)\}(?!\s*from\b)/g)) {
    const at = mt.index + mt[1].length;
    if (m.depth[at] !== 0) continue;
    const rest = code.slice(mt.index + mt[0].length, mt.index + mt[0].length + 12);
    if (/^\s*from\b/.test(rest)) continue;
    for (const n of parseNamedList(mt[2])) m.exports.set(n.local, n.orig);
  }
}

/* ---------------- classes and their member tables ---------------- */

function parseClasses(m) {
  const code = m.code;
  for (const mt of code.matchAll(/(^|[^\w$.#])class\b/g)) {
    const at = mt.index + mt[1].length;
    let i = skipWs(code, at + 5);
    let name = null;
    const nameTok = readIdent(code, i);
    if (nameTok && nameTok.name !== 'extends' && nameTok.name !== 'implements') { name = nameTok.name; i = nameTok.end; }
    let j = skipWs(code, i);
    if (code[j] === '<') { const g = skipAngle(code, j); if (g < 0) { m.classFail = 'class head at line ' + m.s.lineOf(at); continue; } j = g; }
    let k = j;
    while (k < code.length && code[k] !== '{') {
      if (code[k] === '<') { const g = skipAngle(code, k); if (g < 0) break; k = g; continue; }
      if (code[k] === '(') { const e = matchDelim(code, k); if (e < 0) break; k = e + 1; continue; }
      if (code[k] === ';' || code[k] === '}' || code[k] === ')' || code[k] === '=') break;
      k++;
    }
    if (code[k] !== '{') continue;
    const header = code.slice(j, k);
    const ext = /\bextends\s+([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/.exec(header);
    if (!name) {
      const nm = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*$/.exec(code.slice(Math.max(0, at - 120), at));
      if (nm) name = nm[1];
    }
    const close = matchDelim(code, k);
    if (close < 0) { m.classFail = 'unbalanced class body at line ' + m.s.lineOf(at); continue; }
    const cls = { mod: m, name: name || '(anonymous)', base: ext ? ext[1].replace(/\s+/g, '') : null, start: at, open: k, close, members: new Map(), fields: new Map(), ctorParams: new Map(), delimited: true };
    const why = parseClassBody(m, cls);
    if (why) { cls.delimited = false; m.classFail = cls.name + ': ' + why; }
    m.classes.push(cls);
  }
}

function fieldInfo(cls, name) {
  if (!cls.fields.has(name)) cls.fields.set(name, { name, annots: [], inits: [] });
  return cls.fields.get(name);
}

function addMember(cls, entry) {
  const prev = cls.members.get(entry.name);
  if (!prev) { cls.members.set(entry.name, { ...entry, ranges: [[entry.start, entry.end]] }); return; }
  prev.ranges.push([entry.start, entry.end]);
  if (!prev.returnType && entry.returnType) prev.returnType = entry.returnType;
  if (entry.kind === 'get') { prev.kind = 'get'; prev.body = entry.body; prev.returnType = entry.returnType || prev.returnType; }
}

/** Arrow-function initializer → { returnType, body, concise } or null. */
function arrowShape(code, a, b) {
  let k = skipWs(code, a, b);
  const w = readIdent(code, k);
  if (w && w.name === 'async') k = skipWs(code, w.end, b);
  if (code[k] === '<') { const g = skipAngle(code, k); if (g < 0) return null; k = skipWs(code, g, b); }
  let rt = null;
  if (code[k] === '(') {
    const pc = matchDelim(code, k);
    if (pc < 0 || pc >= b) return null;
    k = skipWs(code, pc + 1, b);
    if (code[k] === ':') { const t = readType(code, k + 1, b, 'A', false); rt = code.slice(t.start, t.end).trim(); k = skipWs(code, t.end, b); }
  } else {
    const id = readIdent(code, k);
    if (!id) return null;
    k = skipWs(code, id.end, b);
  }
  if (code[k] !== '=' || code[k + 1] !== '>') return null;
  const bs = skipWs(code, k + 2, b);
  if (code[bs] === '{') { const be = matchDelim(code, bs); if (be < 0) return null; return { returnType: rt, body: [bs + 1, be], concise: null }; }
  return { returnType: rt, body: [bs, b], concise: [bs, b] };
}

function parseClassBody(m, cls) {
  const code = m.code;
  const end = cls.close;
  let i = cls.open + 1;
  const fieldDecls = [];
  let ctor = null;
  for (let guard = 0; guard < 100000; guard++) {
    while (i < end && (isWs(code[i]) || code[i] === ';')) i++;
    if (i >= end) break;
    const start = i;
    while (code[i] === '@') {
      const d = readDotted(code, i + 1);
      if (!d) return 'decorator';
      i = skipWs(code, d.end, end);
      if (code[i] === '(') { const e = matchDelim(code, i); if (e < 0) return 'decorator'; i = skipWs(code, e + 1, end); }
    }
    const mods = new Set();
    let accessor = null;
    for (;;) {
      const w = readIdent(code, i);
      if (!w) break;
      const after = skipWs(code, w.end, end);
      const nc = code[after] || '';
      const isModWord = CLASS_MODS.has(w.name) || w.name === 'get' || w.name === 'set';
      if (isModWord && (ID_START.test(nc) || nc === '[' || nc === '"' || nc === "'" || nc === '*' || (w.name === 'static' && nc === '{'))) {
        if (w.name === 'get' || w.name === 'set') accessor = w.name; else mods.add(w.name);
        i = after; continue;
      }
      break;
    }
    if (mods.has('static') && code[i] === '{') { const e = matchDelim(code, i); if (e < 0) return 'static block'; i = e + 1; continue; }
    if (code[i] === '*') i = skipWs(code, i + 1, end);
    let name = null;
    const idt = readIdent(code, i);
    if (idt) { name = idt.name; i = idt.end; }
    else if (code[i] === '"' || code[i] === "'") { const st = m.strAt.get(i); if (!st) return 'member name'; name = st.value; i = st.end + 1; }
    else if (code[i] === '[') { const e = matchDelim(code, i); if (e < 0) return 'computed member'; i = e + 1; }
    else if (/\d/.test(code[i])) { const mm = /^\d[\w.]*/.exec(code.slice(i, i + 40)); name = mm[0]; i += mm[0].length; }
    else return 'unexpected token at line ' + m.s.lineOf(i);
    i = skipWs(code, i, end);
    if (code[i] === '?' || code[i] === '!') i = skipWs(code, i + 1, end);
    if (code[i] === '<') { const g = skipAngle(code, i); if (g < 0) return 'generic method'; i = skipWs(code, g, end); }
    if (code[i] === '(') {
      const pc = matchDelim(code, i);
      if (pc < 0 || pc >= end) return 'method parameters';
      let j = skipWs(code, pc + 1, end);
      let rt = null;
      if (code[j] === ':') { const t = readType(code, j + 1, end, '{;', false); rt = code.slice(t.start, t.end).trim(); j = skipWs(code, t.end, end); }
      if (code[j] === '{') {
        const be = matchDelim(code, j);
        if (be < 0 || be >= end) return 'method body';
        const entry = { kind: name === 'constructor' ? 'ctor' : (accessor || 'method'), name, start, end: be + 1, params: [i, pc], returnType: rt, body: [j + 1, be], concise: null, isStatic: mods.has('static') };
        if (entry.kind === 'ctor') ctor = entry;
        else if (name !== null) addMember(cls, entry);
        i = be + 1; continue;
      }
      i = code[j] === ';' ? j + 1 : j;   // signature (overload / abstract): stays in the class remainder
      continue;
    }
    // field (or arrow-function property)
    let j = i;
    let last = i;
    let annot = null;
    if (code[j] === ':') { const t = readType(code, j + 1, end, '=;', true); annot = code.slice(t.start, t.end).trim(); last = t.end; j = skipWs(code, t.end, end); }
    let init = null;
    if (code[j] === '=' && code[j + 1] !== '>' && code[j + 1] !== '=') {
      const a = skipWs(code, j + 1, end);
      const e = exprEnd(code, a, end);
      init = [a, e]; last = e;
    }
    const n2 = skipWs(code, last, end);
    const fend = code[n2] === ';' ? n2 + 1 : last;
    if (fend <= start) return 'field at line ' + m.s.lineOf(start);
    if (name !== null) {
      const arrow = init ? arrowShape(code, init[0], init[1]) : null;
      if (arrow) addMember(cls, { kind: 'arrow', name, start, end: fend, returnType: arrow.returnType || null, body: arrow.body, concise: arrow.concise, isStatic: mods.has('static') });
      else fieldDecls.push({ name, start, end: fend, annot, init, isStatic: mods.has('static') });
    }
    i = fend;
  }
  // constructor: parameter properties, typed params, `this.x = …;` statements at the body's top level
  const assigns = [];
  if (ctor) {
    for (const [a, b] of splitArgs(code, ctor.params[0], ctor.params[1])) {
      const t = code.slice(a, b);
      const pm = /^\s*(?:@[\w$.]+(?:\([^)]*\))?\s*)*((?:(?:public|private|protected|readonly|override)\s+)*)([A-Za-z_$][\w$]*)\s*\??\s*(?::\s*([^=]*?))?\s*(?:=[\s\S]*)?$/.exec(t);
      if (!pm) continue;
      if (pm[3]) cls.ctorParams.set(pm[2], pm[3].trim());
      if (pm[1].trim()) { const f = fieldInfo(cls, pm[2]); if (pm[3]) f.annots.push(pm[3].trim()); }
    }
    const [bs, be] = ctor.body;
    const baseDepth = m.depth[bs];
    for (const mt of code.slice(bs, be).matchAll(/(^|[;{}\n])(\s*)this\s*\.\s*([A-Za-z_$#][\w$]*)\s*=(?![=>])/g)) {
      const s0 = bs + mt.index + mt[1].length + mt[2].length;
      if (m.depth[s0] !== baseDepth) continue;
      const a = skipWs(code, bs + mt.index + mt[0].length, be);
      const e = exprEnd(code, a, be);
      const n2 = skipWs(code, e, be);
      assigns.push({ name: mt[3], start: s0, end: code[n2] === ';' ? n2 + 1 : e, init: [a, e] });
    }
  }
  for (const f of fieldDecls) { const fi = fieldInfo(cls, f.name); if (f.annot) fi.annots.push(f.annot); if (f.init) fi.inits.push(f.init); }
  for (const a of assigns) fieldInfo(cls, a.name).inits.push(a.init);
  // split a field out only when its ONE initializer is a pure locator expression or `new Component(…)`
  const names = new Set([...fieldDecls.map((f) => f.name), ...assigns.map((a) => a.name)]);
  for (const name of names) {
    if (cls.members.has(name)) continue;
    const decls = fieldDecls.filter((f) => f.name === name);
    const as = assigns.filter((a) => a.name === name);
    if (decls.length > 1) continue;
    const decl = decls[0] || null;
    let init = null, ranges = null;
    if (decl && decl.init && !as.length) { init = decl.init; ranges = [[decl.start, decl.end]]; }
    else if (as.length === 1 && !(decl && decl.init)) { init = as[0].init; ranges = decl ? [[decl.start, decl.end], [as[0].start, as[0].end]] : [[as[0].start, as[0].end]]; }
    if (!init) continue;
    const pure = pureInit(m, cls, init);
    if (!pure) continue;
    cls.members.set(name, { kind: 'field', name, ranges, pure, init, returnType: null, body: init, concise: init, isStatic: !!(decl && decl.isStatic) });
    fieldInfo(cls, name).pure = pure;
  }
  return null;
}

function pureArgs(code, a, b) {
  const s = code.slice(a, b);
  if (/(^|[^\w$])(await|new|function|yield)(?![\w$])/.test(s) || s.includes('=>')) return false;
  for (const mt of s.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
    const p = prevNonWs(s, mt.index);
    if (s[p] !== '.' || !LOCATOR_METHODS.has(mt[1])) return false;
  }
  return true;
}

const LOCATOR_TYPE = /^(Page|Locator|FrameLocator)\b/;

/** 'locator' | 'new' | null — a pure locator chain off a page / locator receiver, or `new Component(…)`. */
function pureInit(m, cls, [a, b]) {
  const code = m.code;
  const s = skipWs(code, a, b);
  let e = b;
  while (e > s && isWs(code[e - 1])) e--;
  const nw = /^new\s+([A-Za-z_$][\w$.]*)\s*(<[^()]*>)?\s*\(/.exec(code.slice(s, e));
  if (nw) {
    const open = s + nw[0].length - 1;
    const close = matchDelim(code, open);
    return close === e - 1 && pureArgs(code, open + 1, close) ? 'new' : null;
  }
  let k = s;
  const t = readIdent(code, k);
  if (!t) return null;
  let ok = false;
  if (t.name === 'this') {
    k = skipWs(code, t.end, e);
    if (code[k] !== '.') return null;
    const f = readIdent(code, skipWs(code, k + 1, e));
    if (!f) return null;
    const fi = cls.fields.get(f.name);
    ok = f.name === 'page' || f.name === 'root' || !!(fi && fi.annots.some((x) => LOCATOR_TYPE.test(x)));
    k = f.end;
  } else {
    ok = t.name === 'page' || t.name === 'root' || LOCATOR_TYPE.test(cls.ctorParams.get(t.name) || '');
    k = t.end;
  }
  if (!ok) return null;
  let segs = 0;
  for (;;) {
    k = skipWs(code, k, e);
    if (k >= e) break;
    if (code[k] !== '.') return null;
    const mm = readIdent(code, skipWs(code, k + 1, e));
    if (!mm || !LOCATOR_METHODS.has(mm.name)) return null;
    const p = skipWs(code, mm.end, e);
    if (code[p] !== '(') return null;
    const c = matchDelim(code, p);
    if (c < 0 || c >= e || !pureArgs(code, p + 1, c)) return null;
    k = c + 1; segs++;
  }
  return segs ? 'locator' : null;
}

/* ---------------- TIMEOUTS (key level) ---------------- */

function parseTimeouts(m) {
  const mt = /(^|[^\w$.])(?:export\s+)?const\s+TIMEOUTS(?![\w$])/.exec(m.code);
  if (!mt) return;
  const at = mt.index + mt[1].length;
  if (m.depth[at] !== 0) return;
  const exported = m.exports.has('TIMEOUTS') || [...m.exports.values()].includes('TIMEOUTS');
  if (!exported) return;
  const code = m.code;
  let k = skipWs(code, mt.index + mt[0].length);
  if (code[k] === ':') { const t = readType(code, k + 1, code.length, '=;', false); k = skipWs(code, t.end); }
  if (code[k] !== '=') { m.timeouts = { fail: 'TIMEOUTS has no initializer' }; return; }
  k = skipWs(code, k + 1);
  if (code[k] !== '{') { m.timeouts = { fail: 'TIMEOUTS is not an object literal' }; return; }
  const close = matchDelim(code, k);
  if (close < 0) { m.timeouts = { fail: 'TIMEOUTS literal is unbalanced' }; return; }
  const keys = new Map();
  const why = parseObj(m, k, close, '', keys);
  m.timeouts = why ? { fail: why } : { literal: [k, close + 1], keys };
}

function parseObj(m, open, close, prefix, keys) {
  const code = m.code;
  for (const [a0, b] of splitArgs(code, open, close)) {
    const a = skipWs(code, a0, b);
    if (code.startsWith('...', a)) return 'spread in TIMEOUTS';
    let key = null, k = a;
    const id = readIdent(code, a);
    if (id) { key = id.name; k = id.end; }
    else if (code[a] === '"' || code[a] === "'") { const st = m.strAt.get(a); if (!st) return 'key'; key = st.value; k = st.end + 1; }
    else if (/\d/.test(code[a])) { const mm = /^\d[\w.]*/.exec(code.slice(a, a + 30)); key = mm[0]; k = a + mm[0].length; }
    else return 'computed key in TIMEOUTS';
    k = skipWs(code, k, b);
    if (k >= b) { keys.set(prefix + key, sha256(key)); continue; }   // shorthand
    if (code[k] !== ':') return 'method or accessor in TIMEOUTS';
    const v = skipWs(code, k + 1, b);
    let ve = b;
    while (ve > v && isWs(code[ve - 1])) ve--;
    if (code[v] === '{' && matchDelim(code, v) === ve - 1) {
      const why = parseObj(m, v, ve - 1, prefix + key + '.', keys);
      if (why) return why;
    } else keys.set(prefix + key, sha256(normalizeSlice(m, v, ve)));
  }
  return null;
}

/* ---------------- test.extend fixtures ---------------- */

function destructureNames(code, open, close) {
  const out = [];
  for (const [a, b] of splitArgs(code, open, close)) {
    const t = code.slice(a, b).trim();
    if (t.startsWith('...')) { out.push('...'); continue; }
    const id = /^([A-Za-z_$][\w$]*)/.exec(t);
    if (id) out.push(id[1]);
  }
  return out;
}

/** First-parameter destructuring + second parameter name of the function in [a, b). */
function fnParams(code, a, b) {
  let k = skipWs(code, a, b);
  let w = readIdent(code, k);
  if (w && w.name === 'async') { k = skipWs(code, w.end, b); w = readIdent(code, k); }
  if (w && w.name === 'function') { k = skipWs(code, w.end, b); if (code[k] === '*') k = skipWs(code, k + 1, b); const nm = readIdent(code, k); if (nm) k = skipWs(code, nm.end, b); }
  if (code[k] !== '(') { const id = readIdent(code, k); return { names: [], rest: id ? [id.name] : [] }; }
  const pc = matchDelim(code, k);
  if (pc < 0) return { names: [], rest: [] };
  const params = splitArgs(code, k, pc);
  const out = { names: [], rest: [] };
  params.forEach(([pa, pb], idx) => {
    const s = skipWs(code, pa, pb);
    if (idx === 0 && code[s] === '{') { const c = matchDelim(code, s); if (c > 0) out.names = destructureNames(code, s, c); }
    else { const id = readIdent(code, s); if (id) out.rest.push(id.name); }
  });
  return out;
}

function parseTypeProps(code, open, close) {
  const out = new Map();
  let depth = 0, start = open + 1;
  const flush = (a, b) => {
    const t = code.slice(a, b);
    const mm = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+?)\s*$/.exec(t);
    if (mm) out.set(mm[1], mm[2]);
  };
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if ('({[<'.includes(c)) depth++;
    else if (')}]'.includes(c) || (c === '>' && code[i - 1] !== '=')) depth--;
    else if ((c === ';' || c === ',' || c === '\n') && depth === 0) { flush(start, i); start = i + 1; }
  }
  flush(start, close);
  return out;
}

function typePropsOf(m, typeText) {
  if (!typeText) return new Map();
  const [a, b] = typeText;
  const s = skipWs(m.code, a, b);
  if (m.code[s] === '{') { const c = matchDelim(m.code, s); return c > 0 ? parseTypeProps(m.code, s, c) : new Map(); }
  const id = readIdent(m.code, s);
  if (!id) return new Map();
  const def = new RegExp('(?:type\\s+' + reEsc(id.name) + '\\s*=\\s*|interface\\s+' + reEsc(id.name) + '\\s*(?:extends[^{]*)?)\\{').exec(m.code);
  if (!def) return new Map();
  const open = def.index + def[0].length - 1;
  const c = matchDelim(m.code, open);
  return c > 0 ? parseTypeProps(m.code, open, c) : new Map();
}

function parseFixtureDecls(m) {
  const code = m.code;
  for (const d of m.localDecls.values()) {
    if (d.kind !== 'const' && d.kind !== 'let' && d.kind !== 'var') continue;
    if (d.initPos == null) continue;
    const k = d.initPos;
    const merge = /^mergeTests\s*\(/.exec(code.slice(k, k + 40));
    if (merge) {
      const open = k + merge[0].length - 1;
      const close = matchDelim(code, open);
      const bases = close > 0 ? splitArgs(code, open, close).map(([a, b]) => code.slice(a, b).trim()).filter((x) => /^[A-Za-z_$][\w$]*$/.test(x)) : [];
      m.fixtureDecls.set(d.name, { ok: close > 0, merge: bases, props: [], typeProps: new Map(), reason: close > 0 ? null : 'mergeTests call is unbalanced' });
      continue;
    }
    const head = /^([A-Za-z_$][\w$]*)\s*\.\s*extend\b/.exec(code.slice(k, k + 200));
    if (!head) continue;
    const t = { ok: false, base: head[1], props: [], typeProps: new Map(), reason: null };
    m.fixtureDecls.set(d.name, t);
    let i = skipWs(code, k + head[0].length);
    let typeText = null;
    if (code[i] === '<') { const g = skipAngle(code, i); if (g < 0) { t.reason = 'extend<…> type is unbalanced'; continue; } typeText = [i + 1, g - 1]; i = skipWs(code, g); }
    if (code[i] !== '(') { t.reason = 'extend is not called'; continue; }
    const close = matchDelim(code, i);
    if (close < 0) { t.reason = 'extend call is unbalanced'; continue; }
    const after = skipWs(code, close + 1);
    if (code[after] === '.') { t.reason = 'chained extend calls are not followed'; continue; }
    t.typeProps = typePropsOf(m, typeText);
    const args = splitArgs(code, i, close);
    if (!args.length) { t.ok = true; continue; }
    const o = skipWs(code, args[0][0], args[0][1]);
    if (code[o] !== '{') { t.reason = 'extend argument is not an object literal'; continue; }
    const oc = matchDelim(code, o);
    if (oc < 0) { t.reason = 'extend object is unbalanced'; continue; }
    let bad = null;
    for (const [pa0, pb0] of splitArgs(code, o, oc)) {
      const pa = skipWs(code, pa0, pb0);
      let pb = pb0;
      while (pb > pa && isWs(code[pb - 1])) pb--;
      if (code.startsWith('...', pa)) { bad = 'spread in the fixture object'; break; }
      let q = pa;
      let w = readIdent(code, q);
      if (w && w.name === 'async' && ID_START.test(code[skipWs(code, w.end, pb)] || '')) { q = skipWs(code, w.end, pb); w = readIdent(code, q); }
      let name = null;
      if (w) { name = w.name; q = w.end; }
      else if (code[q] === '"' || code[q] === "'") { const st = m.strAt.get(q); if (st) { name = st.value; q = st.end + 1; } }
      if (!name) { bad = 'fixture key'; break; }
      q = skipWs(code, q, pb);
      const fnFrom = code[q] === ':' ? skipWs(code, q + 1, pb) : q;
      const fnStart = code[fnFrom] === '[' ? fnFrom + 1 : fnFrom;
      const params = code[q] === '(' ? fnParams(code, q, pb) : fnParams(code, fnStart, pb);
      const useTypes = [...code.slice(pa, pb).matchAll(/\buse\s*\(\s*(?:await\s+)?new\s+([A-Za-z_$][\w$.]*)/g)].map((x) => x[1]);
      t.props.push({ name, start: pa, end: pb, deps: params.names.filter((x) => x !== '...'), useTypes });
    }
    if (bad) { t.reason = bad; t.props = []; continue; }
    t.ok = true;
  }
}

/* ================================================================ normalization + part hashing ================================================================ */

function canon(s) {
  return s.replace(/,+(?=[\]\)}])/g, '').replace(/([\[({]),+/g, '$1').replace(/,{2,}/g, ',');
}

/** Source slice with comments and excluded ranges removed, whitespace collapsed, `@run:` tags dropped — literals kept byte for byte. */
function normalizeSlice(m, a, b) {
  const src = m.src, ex = m.exMask;
  let out = '';
  let pend = false;
  let i = a;
  while (i < b) {
    if (ex && ex[i]) { pend = true; i++; continue; }
    const st = m.strAt.get(i);
    if (st && st.end < b) {
      let lit = src.slice(st.start, st.end + 1);
      if (lit.includes('@run:')) { lit = lit.replace(/\s*@run:[^\s'"`]*/g, ''); if (/^(['"`])\s*\1$/.test(lit)) lit = ''; }
      out += lit; pend = false;
      i = st.end + 1; continue;
    }
    const c = src[i];
    if (isWs(c)) { pend = true; i++; continue; }
    if (pend && out && ID_CHAR.test(out[out.length - 1]) && ID_CHAR.test(c)) out += ' ';
    pend = false; out += c; i++;
  }
  return canon(out);
}

function normText(m, ranges) {
  if (m.parseError) return m.src;
  return ranges.map(([a, b]) => normalizeSlice(m, a, b)).filter(Boolean).join('\n');
}

function partSha(ctx, id, m, ranges) {
  if (ctx.partSha.has(id)) return ctx.partSha.get(id);
  const v = sha256(normText(m, ranges));
  ctx.partSha.set(id, v);
  return v;
}

/* ================================================================ exports, classes, types ================================================================ */

function resolveExport(ctx, abs, name, seen = new Set()) {
  if (!abs) return null;
  const key = abs + '#' + name;
  if (seen.has(key)) return null;
  seen.add(key);
  const m = getMod(ctx, abs);
  if (m.kind !== 'code' || m.parseError) return null;
  if (m.exports.has(name)) {
    const local = m.exports.get(name);
    if (typeof local === 'object') return { mod: m, expr: local.expr };
    const imp = m.imports.get(local);
    if (imp) {
      if (imp.status === 'lib') return { lib: true };
      if (imp.status !== 'ok') return null;
      if (imp.imported === '*') return { ns: imp.target };
      return resolveExport(ctx, imp.target, imp.imported, seen);
    }
    return { mod: m, local };
  }
  for (const re of m.reexports) {
    if (re.star) {
      if (re.ns && re.ns === name) return re.status === 'ok' ? { ns: re.abs } : re.status === 'lib' ? { lib: true } : null;
      continue;
    }
    const hit = re.names.find((n) => n.exported === name);
    if (hit) {
      if (re.status === 'lib') return { lib: true };
      if (re.status !== 'ok') return null;
      return resolveExport(ctx, re.abs, hit.orig, seen);
    }
  }
  let libStar = false;
  for (const re of m.reexports) {
    if (!re.star || re.ns) continue;
    if (re.status === 'lib') { libStar = true; continue; }
    if (re.status !== 'ok') continue;
    const r = resolveExport(ctx, re.abs, name, seen);
    if (r) return r;
  }
  return libStar ? { lib: true } : null;
}

const classByName = (m, name) => m.classes.find((c) => c.name === name) || null;

function classOfOrigin(ctx, o, depth = 0) {
  if (!o) return null;
  if (o.lib) return 'lib';
  if (!o.mod || !o.local) return null;
  const c = classByName(o.mod, o.local);
  if (c) return c;
  const d = o.mod.localDecls.get(o.local);
  if (d && d.initPos != null && depth < 8) {
    const id = /^([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(o.mod.code.slice(d.initPos, exprEnd(o.mod.code, d.initPos, o.mod.code.length)));
    if (id) return resolveClassName(ctx, o.mod, id[1], depth + 1);
  }
  return null;
}

/** cls | 'lib' | null (unresolved or not a class). */
function resolveClassName(ctx, m, dotted, depth = 0) {
  const parts = String(dotted).split('.');
  if (parts.length > 1) {
    const imp = m.imports.get(parts[0]);
    if (imp && imp.status === 'lib') return 'lib';
    if (imp && imp.imported === '*' && imp.status === 'ok') return classOfOrigin(ctx, resolveExport(ctx, imp.target, parts[1]), depth);
    return null;
  }
  const name = parts[0];
  const local = classByName(m, name);
  if (local) return local;
  const imp = m.imports.get(name);
  if (imp) {
    if (imp.status === 'lib') return 'lib';
    if (imp.status !== 'ok' || imp.imported === '*') return null;
    return classOfOrigin(ctx, resolveExport(ctx, imp.target, imp.imported), depth);
  }
  if (m.localDecls.has(name)) return classOfOrigin(ctx, { mod: m, local: name }, depth);
  if (GLOBALS.has(name) || PRIMS.has(name)) return 'lib';
  return null;
}

// exact: the runtime class is known to be `cls` itself (a `new X(…)` value) — otherwise a subclass may be held.
const inst = (cls, conc, exact) => ({ k: 'class', cls, inst: true, conc: conc || null, exact: !!exact });
const stat = (cls) => ({ k: 'class', cls, inst: false, conc: null });

function uniq(types) {
  const out = [];
  const seen = new Set();
  for (const t of types) {
    const key = t.k === 'class' ? 'c|' + t.cls.mod.abs + '|' + t.cls.name + '|' + t.inst + '|' + !!t.exact + '|' + (t.conc ? t.conc.mod.abs + t.conc.name : '') : t.k === 'ns' ? 'n|' + t.abs : t.k === 'fn' ? 'f|' + t.mod.abs + '|' + t.name : t.k;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function splitTop(text, seps) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('({[<'.includes(c)) depth++;
    else if (')}]'.includes(c) || (c === '>' && text[i - 1] !== '=')) depth--;
    else if (depth === 0 && seps.includes(c)) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

function typeFromAnnotation(ctx, m, text, concrete) {
  const out = [];
  if (!text) return out;
  for (let piece of splitTop(String(text), '|&')) {
    let p = piece.trim().replace(/^readonly\s+/, '');
    while (p.startsWith('(') && matchDelim(p, 0) === p.length - 1) p = p.slice(1, -1).trim();
    if (!p || /\[\]$/.test(p)) continue;
    if (/^['"`\d-]/.test(p)) { out.push(LIB); continue; }
    if (p[0] === '{' || p[0] === '(' || p[0] === '[') continue;
    const nm = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/.exec(p);
    if (!nm) continue;
    const name = nm[0].replace(/\s+/g, '');
    const rest = p.slice(nm[0].length).trim();
    const inner = rest.startsWith('<') ? rest.slice(1, rest.lastIndexOf('>')) : '';
    if (name === 'Promise' || name === 'PromiseLike' || name === 'Awaited') { out.push(...typeFromAnnotation(ctx, m, inner, concrete)); continue; }
    if (name === 'this') { if (concrete) out.push(inst(concrete)); continue; }
    if (name === 'any' || name === 'unknown' || name === 'Array' || name === 'ReadonlyArray' || name === 'typeof' || name === 'keyof') continue;
    if (PRIMS.has(name)) { out.push(LIB); continue; }
    const c = resolveClassName(ctx, m, name);
    if (c === 'lib') out.push(LIB);
    else if (c) out.push(inst(c));
  }
  return uniq(out);
}

function lookupMember(ctx, cls, name) {
  const seen = new Set();
  let c = cls;
  while (c && !seen.has(c)) {
    seen.add(c);
    if (!c.delimited) return { opaque: true };
    const e = c.members.get(name);
    if (e) return { owner: c, entry: e };
    const f = c.fields.get(name);
    if (f) return { owner: c, field: f };
    if (!c.base) return null;
    const b = resolveClassName(ctx, c.mod, c.base);
    if (b === 'lib') return { lib: true };
    if (!b) return { unresolvedBase: true };
    c = b;
  }
  return null;
}

function classAt(m, pos) {
  let best = null;
  for (const c of m.classes) if (c.open < pos && pos < c.close && (!best || c.open > best.open)) best = c;
  return best;
}

function remainderOf(m) { return m.remainder || [[0, m.src.length]]; }

function memberItem(owner, name, entry, concrete, exact = false) {
  return {
    key: 'm|' + owner.mod.abs + '|' + owner.name + '|' + name + '|' + concrete.mod.abs + '|' + concrete.name + '|' + (exact ? 'x' : 'v'),
    mod: owner.mod, ranges: entry.ranges, concrete, exact: !!exact, lex: owner,
    scopes: [...(entry.body ? [entry.body] : entry.ranges), ...remainderOf(owner.mod)], fixtures: null,
  };
}

function classItem(owner, concrete) {
  return { key: 'c|' + owner.mod.abs + '|' + owner.name + '|' + concrete.name, mod: owner.mod, ranges: [], concrete, lex: owner, scopes: [], fixtures: null };
}

function modItem(m) { return { key: 'mod|' + m.abs, mod: m, ranges: [], concrete: null, lex: null, scopes: [], fixtures: null }; }

function guarded(ctx, key, fn) {
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  if (ctx.typing.has(key)) return [];
  ctx.typing.add(key);
  let v;
  try { v = fn(); } finally { ctx.typing.delete(key); }
  ctx.memo.set(key, v);
  return v;
}

function returnTypesOf(ctx, owner, entry, conc) {
  return guarded(ctx, 'rt|' + owner.mod.abs + '|' + owner.name + '|' + entry.name + '|' + conc.mod.abs + '|' + conc.name, () => {
    if (entry.kind === 'field') return fieldTypesOf(ctx, owner, owner.fields.get(entry.name) || { annots: [], inits: [entry.init] }, conc);
    if (entry.returnType) return typeFromAnnotation(ctx, owner.mod, entry.returnType, conc);
    const item = memberItem(owner, entry.name, entry, conc);
    if (entry.concise) return typeOfRange(ctx, item, entry.concise[0], entry.concise[1]);
    const out = [];
    if (entry.body) {
      const [a, b] = entry.body;
      for (const mt of owner.mod.code.slice(a, b).matchAll(/(?<![\w$.])return(?![\w$])/g)) {
        const p = skipWs(owner.mod.code, a + mt.index + 6, b);
        if (owner.mod.code[p] === ';' || owner.mod.code[p] === '}') continue;
        out.push(...typeOfRange(ctx, item, p, exprEnd(owner.mod.code, p, b)));
      }
    }
    return uniq(out);
  });
}

function fieldTypesOf(ctx, owner, f, conc) {
  return guarded(ctx, 'ft|' + owner.mod.abs + '|' + owner.name + '|' + f.name + '|' + conc.mod.abs + '|' + conc.name, () => {
    if (f.pure === 'locator') return [LIB];
    const out = [];
    for (const a of f.annots) out.push(...typeFromAnnotation(ctx, owner.mod, a, conc));
    const item = classItem(owner, conc);
    for (const [a, b] of f.inits) out.push(...typeOfRange(ctx, item, a, b));
    return uniq(out);
  });
}

function declTypesOf(ctx, o) {
  if (!o) return [];
  if (o.lib) return [LIB];
  if (o.ns) return [{ k: 'ns', abs: o.ns }];
  if (o.expr != null) return typeOfRange(ctx, modItem(o.mod), o.expr, exprEnd(o.mod.code, o.expr, o.mod.code.length));
  const c = classByName(o.mod, o.local);
  if (c) return [stat(c)];
  const d = o.mod.localDecls.get(o.local);
  if (!d) return [];
  if (d.kind === 'function') return [{ k: 'fn', mod: o.mod, name: d.name, returnType: d.returnType || null }];
  if (d.kind === 'interface' || d.kind === 'type' || d.kind === 'enum') return [DATA];
  return guarded(ctx, 'decl|' + o.mod.abs + '|' + o.local, () => {
    if (d.annot) return typeFromAnnotation(ctx, o.mod, d.annot, null);
    if (d.initPos != null) return typeOfRange(ctx, modItem(o.mod), d.initPos, exprEnd(o.mod.code, d.initPos, o.mod.code.length));
    return [];
  });
}

function importTypes(ctx, imp) {
  if (imp.status === 'lib') return [LIB];
  if (imp.status !== 'ok') return [];
  if (imp.kind === 'data') return [DATA];
  if (imp.imported === '*') return [{ k: 'ns', abs: imp.target }];
  return declTypesOf(ctx, resolveExport(ctx, imp.target, imp.imported));
}

/** Bindings of `name` visible from the item: declarations, assignments and typed parameters, scope by scope. */
function scopeBindings(ctx, item, name) {
  const m = item.mod;
  const code = m.code;
  const nm = reEsc(name);
  const declRe = new RegExp('(?<![\\w$.])(?:const|let|var)\\s+' + nm + '(?![\\w$])', 'g');
  const assignRe = new RegExp('(?<![\\w$.])' + nm + '\\s*=(?![=>])', 'g');
  const paramRe = new RegExp('[(,]\\s*(?:(?:public|private|protected|readonly|override)\\s+)*' + nm + '\\s*\\??\\s*:', 'g');
  let found = false;
  const out = [];
  const conc = item.concrete;
  for (const [a, b] of item.scopes) {
    let hasDecl = false;
    const slice = code.slice(a, b);
    for (const mt of slice.matchAll(declRe)) {
      hasDecl = true; found = true;
      let k = skipWs(code, a + mt.index + mt[0].length, b);
      if (code[k] === ':') { const t = readType(code, k + 1, b, '=;,', true); out.push(...typeFromAnnotation(ctx, m, code.slice(t.start, t.end), conc)); k = skipWs(code, t.end, b); }
      if (code[k] === '=' && code[k + 1] !== '=' && code[k + 1] !== '>') { const p = skipWs(code, k + 1, b); out.push(...typeOfRange(ctx, item, p, exprEnd(code, p, b))); }
    }
    for (const mt of slice.matchAll(assignRe)) {
      const at = a + mt.index;
      if (/(?:const|let|var)\s+$/.test(code.slice(Math.max(0, at - 8), at))) continue;
      found = true;
      const p = skipWs(code, at + mt[0].length, b);
      out.push(...typeOfRange(ctx, item, p, exprEnd(code, p, b)));
    }
    for (const mt of slice.matchAll(paramRe)) {
      hasDecl = true; found = true;
      const t = readType(code, a + mt.index + mt[0].length, b, ',=', false);
      out.push(...typeFromAnnotation(ctx, m, code.slice(t.start, t.end), conc));
    }
    if (hasDecl) break;
  }
  return found ? uniq(out) : null;
}

function identTypes(ctx, item, name) {
  return guarded(ctx, 'id|' + item.key + '|' + name, () => {
    const b = item.scopes.length ? scopeBindings(ctx, item, name) : null;
    if (b) return b;
    if (item.fixtures && item.fixtures.has(name)) return item.fixtures.get(name);
    const m = item.mod;
    const lc = classByName(m, name);
    if (lc) return [stat(lc)];
    const imp = m.imports.get(name);
    if (imp) return importTypes(ctx, imp);
    if (m.localDecls.has(name)) return declTypesOf(ctx, { mod: m, local: name });
    if (GLOBALS.has(name)) return [LIB];
    return [];
  });
}

function typeOfPrimary(ctx, item, pr, pos) {
  const m = item.mod;
  switch (pr.kind) {
    case 'this': { const c = item.concrete || classAt(m, pos); return c ? [inst(c, null, !!(item.concrete && item.exact))] : []; }
    case 'super': {
      const lex = item.lex || classAt(m, pos);
      if (!lex || !lex.base) return [];
      const b = resolveClassName(ctx, lex.mod, lex.base);
      if (b === 'lib') return [LIB];
      return b ? [inst(b, item.concrete || lex, !!(item.concrete && item.exact))] : [];
    }
    case 'new': { const c = resolveClassName(ctx, m, pr.name); if (c === 'lib') return [LIB]; return c ? [inst(c, null, true)] : []; }
    case 'ident': return identTypes(ctx, item, pr.name);
    case 'paren': return typeOfRange(ctx, item, pr.start, pr.end);
    default: return [];
  }
}

function typeOfRange(ctx, item, a, b) {
  const code = item.mod.code;
  let i = skipWs(code, a, b);
  for (;;) {
    const w = readIdent(code, i);
    if (w && (w.name === 'await' || w.name === 'void')) { i = skipWs(code, w.end, b); continue; }
    break;
  }
  if (i >= b) return [];
  const c = code[i];
  if (c === '{') return [DATA];
  if (c === '[') return [];
  if (c === '"' || c === "'" || c === '`' || /\d/.test(c)) return [LIB];
  const w = readIdent(code, i);
  if (w && (w.name === 'true' || w.name === 'false' || w.name === 'null' || w.name === 'undefined' || w.name === 'typeof')) return [LIB];
  if (w && (w.name === 'async' || w.name === 'function')) return [];
  const ch = parseChain(code, i, b);
  if (!ch) return [];
  let t = evalChain(ctx, null, item, ch, false);
  const tail = code.slice(ch.end, b);
  const as = /^\s*!?\s*as\s+([\s\S]+?)\s*;?\s*$/.exec(tail);
  if (as) t = /^const\b/.test(as[1]) ? t : typeFromAnnotation(ctx, item.mod, as[1], item.concrete);
  return t;
}

/* ================================================================ chains and reachability ================================================================ */

/** primary (new X(…) | this | super | ident | ( … )) followed by .prop / ?.prop / (call) / [index] segments. */
function parseChain(code, i, limit) {
  let primary, j;
  if (code[i] === '(') {
    const c = matchDelim(code, i);
    if (c < 0 || c >= limit) return null;
    primary = { kind: 'paren', start: i + 1, end: c };
    j = c + 1;
  } else {
    const id = readIdent(code, i);
    if (!id) return null;
    if (id.name === 'new') {
      let k = skipWs(code, id.end, limit);
      const n = readDotted(code, k);
      if (!n) return null;
      k = skipWs(code, n.end, limit);
      if (code[k] === '<') { const g = skipAngle(code, k); if (g > 0) k = skipWs(code, g, limit); }
      if (code[k] === '(') { const c = matchDelim(code, k); if (c < 0) return null; primary = { kind: 'new', name: n.name }; j = c + 1; }
      else { primary = { kind: 'new', name: n.name }; j = n.end; }
    } else if (id.name === 'this' || id.name === 'super') { primary = { kind: id.name }; j = id.end; }
    else { primary = { kind: 'ident', name: id.name }; j = id.end; }
  }
  const segs = [];
  while (j < limit) {
    let k = skipWs(code, j, limit);
    if (code[k] === '!' && code[k + 1] !== '=') { j = k + 1; continue; }
    if (code[k] === '?' && code[k + 1] === '.') {
      k = skipWs(code, k + 2, limit);
      if (code[k] === '(' || code[k] === '[') { /* optional call / index */ }
      else { const id = readIdent(code, k); if (!id) break; segs.push({ t: 'prop', name: id.name, pos: k }); j = id.end; continue; }
    } else if (code[k] === '.' && code[k + 1] !== '.') {
      k = skipWs(code, k + 1, limit);
      const id = readIdent(code, k);
      if (!id) break;
      segs.push({ t: 'prop', name: id.name, pos: k }); j = id.end; continue;
    }
    if (code[k] === '(') { const c = matchDelim(code, k); if (c < 0 || c >= limit) break; segs.push({ t: 'call', range: [k + 1, c], pos: k }); j = c + 1; continue; }
    if (code[k] === '[') {
      if (/\n/.test(code.slice(j, k))) break;
      const c = matchDelim(code, k); if (c < 0 || c >= limit) break;
      segs.push({ t: 'index', range: [k + 1, c], pos: k }); j = c + 1; continue;
    }
    break;
  }
  return { primary, segs, end: j };
}

function literalIndex(m, [a, b]) {
  const s = skipWs(m.code, a, b);
  const st = m.strAt.get(s);
  if (st && (st.quote !== '`' || !st.value.includes('${')) && !/\S/.test(m.code.slice(st.end + 1, b))) return st.value;
  return null;
}

function evalChain(ctx, st, item, ch, reach) {
  const m = item.mod;
  let T = typeOfPrimary(ctx, item, ch.primary, ch.segs.length ? ch.segs[0].pos : 0);
  const segs = ch.segs;
  for (let k = 0; k < segs.length; k++) {
    const sg = segs[k];
    if (sg.t === 'prop' || (sg.t === 'index' && literalIndex(m, sg.range) !== null)) {
      const name = sg.t === 'prop' ? sg.name : literalIndex(m, sg.range);
      const called = !!(segs[k + 1] && segs[k + 1].t === 'call');
      if (reach) reachMember(ctx, st, T, name);
      T = memberTypes(ctx, T, name, called);
      if (called) k++;
    } else if (sg.t === 'call') {
      const out = [];
      for (const t of T) {
        if (t.k === 'lib') out.push(LIB);
        else if (t.k === 'fn' && t.returnType) out.push(...typeFromAnnotation(ctx, t.mod, t.returnType, null));
      }
      T = uniq(out);
    } else {
      // non-literal index: a call through it, or any `this[…]`, is dynamic — the test cannot be followed
      if (reach && (segs[k + 1] && segs[k + 1].t === 'call' || (k === 0 && ch.primary.kind === 'this')))
        st.unknown.add('dynamic member access in ' + m.rel + ':' + m.s.lineOf(sg.pos));
      T = [];
    }
  }
  return T;
}

function memberTypes(ctx, T, name, called) {
  const out = [];
  for (const t of T) {
    if (t.k === 'lib' || t.k === 'data') { out.push(t); continue; }
    if (t.k === 'ns') { out.push(...declTypesOf(ctx, resolveExport(ctx, t.abs, name))); continue; }
    if (t.k !== 'class') continue;
    const r = lookupMember(ctx, t.cls, name);
    if (!r) continue;
    if (r.lib) { out.push(LIB); continue; }
    if (r.opaque || r.unresolvedBase) continue;
    const conc = t.conc || t.cls;
    if (r.entry && r.entry.kind !== 'field') {
      if (r.entry.kind === 'get' || r.entry.kind === 'set' || called) {
        let rt = returnTypesOf(ctx, r.owner, r.entry, conc);
        if (!rt.length && !t.inst && called) rt = [inst(t.cls)];   // static factory without a return type → the class
        out.push(...rt);
      }
      continue;
    }
    const f = r.field || r.owner.fields.get(name);
    if (f) out.push(...fieldTypesOf(ctx, r.owner, f, conc));
  }
  return uniq(out);
}

function enqueueMember(ctx, st, owner, name, entry, concrete, exact = false) {
  const item = memberItem(owner, name, entry, concrete, exact);
  if (st.seen.has(item.key)) return;
  st.seen.add(item.key);
  const pid = 'member:' + owner.mod.rel + '#' + owner.name + '.' + name;
  if (!st.parts.has(pid)) st.parts.set(pid, partSha(ctx, pid, owner.mod, entry.ranges));
  st.queue.push(item);
}

function byName(ctx, st, name) {
  if (st.byNameDone.has(name)) return;
  st.byNameDone.add(name);
  for (const c of st.closureClasses) {
    const r = lookupMember(ctx, c, name);
    if (r && r.entry) enqueueMember(ctx, st, r.owner, name, r.entry, c, true);   // every class of the closure is enumerated, subclasses included
  }
}

/** Every class of the test's closure that extends `cls`, directly or transitively. */
function subclassesOf(ctx, st, cls) {
  if (!st.subMemo) st.subMemo = new Map();
  if (st.subMemo.has(cls)) return st.subMemo.get(cls);
  const out = [];
  for (const s of st.closureClasses) {
    if (s === cls) continue;
    const seen = new Set([s]);
    let c = s;
    for (let k = 0; k < 32 && c && c.base; k++) {
      const b = resolveClassName(ctx, c.mod, c.base);
      if (!b || b === 'lib' || seen.has(b)) break;
      if (b === cls) { out.push(s); break; }
      seen.add(b);
      c = b;
    }
  }
  st.subMemo.set(cls, out);
  return out;
}

function reachMember(ctx, st, T, name) {
  if (!T.length) { byName(ctx, st, name); return; }
  for (const t of T) {
    if (t.k !== 'class') continue;
    const r = lookupMember(ctx, t.cls, name);
    if (!r || r.unresolvedBase) { byName(ctx, st, name); continue; }
    if (r.entry) enqueueMember(ctx, st, r.owner, name, r.entry, t.conc || t.cls, t.exact);
    // a receiver typed `C` (annotation, return type, fixture type, `this` of a C member) may hold a subclass at
    // runtime: every subclass of C in the closure contributes its own resolution of the member (its override, or
    // the inherited body with that subclass as `this`). Only a `new C(…)` value is known to be exactly C.
    if (t.inst && !t.exact) for (const s of subclassesOf(ctx, st, t.conc || t.cls)) {
      const rs = lookupMember(ctx, s, name);
      if (rs && rs.entry) enqueueMember(ctx, st, rs.owner, name, rs.entry, s, true);
    }
  }
}

function precededByKeyword(code, p) {
  let s = p;
  while (s > 0 && ID_CHAR.test(code[s - 1])) s--;
  return KEYWORDS.has(code.slice(s, p + 1));
}

function scanItem(ctx, st, item) {
  const m = item.mod;
  if (m.parseError) return;
  const code = m.code;
  for (const [a, b] of item.ranges) {
    for (const d of code.slice(a, b).matchAll(/(?<![\w$.])(require|import|eval)\s*\(|(?<![\w$.])new\s+Function\s*\(/g)) {
      const at = a + d.index;
      if (d[1] === 'require' || d[1] === 'import') {
        const q = skipWs(code, at + d[0].length, b);
        const lit = m.strAt.get(q);
        const after = lit ? skipWs(code, lit.end + 1, b) : -1;
        if (lit && lit.quote !== '`' && code[after] === ')' && !lit.value.startsWith('.') && !lit.value.startsWith('/')) continue;
      }
      st.unknown.add('dynamic ' + (d[1] || 'Function') + '(…) in ' + m.rel + ':' + m.s.lineOf(at));
    }
    const re = /[A-Za-z_$#][\w$]*|\(/g;
    re.lastIndex = a;
    let mt;
    while ((mt = re.exec(code)) && mt.index < b) {
      const i = mt.index;
      const tok = mt[0];
      const p = prevNonWs(code, i);
      const pc = p >= 0 ? code[p] : '';
      if (tok === '(') {
        if (pc && (ID_CHAR.test(pc) || pc === ')' || pc === ']') && !(ID_CHAR.test(pc) && precededByKeyword(code, p))) continue;
        const c = matchDelim(code, i);
        if (c < 0 || c >= b) continue;
        const n = skipWs(code, c + 1, b);
        if (!(code[n] === '.' || code[n] === '[' || (code[n] === '?' && code[n + 1] === '.'))) continue;
      } else {
        if (pc === '.' || (i > 0 && ID_CHAR.test(code[i - 1]))) continue;
        if (KEYWORDS.has(tok)) continue;
      }
      const ch = parseChain(code, i, b);
      if (!ch || !ch.segs.some((s) => s.t !== 'call')) continue;
      evalChain(ctx, st, item, ch, true);
    }
  }
}

/* ---------------- references inside hashed regions: TIMEOUTS keys, data files ---------------- */

function timeoutNames(ctx, m) {
  const key = 'impact:tnames:' + m.abs;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  const out = [];
  if (m.timeouts && !m.timeouts.fail) out.push({ re: new RegExp('(?<![\\w$.])TIMEOUTS((?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*)(\\s*\\[)?', 'g'), tmod: m });
  for (const [local, imp] of m.imports) {
    if (imp.status !== 'ok' || imp.kind !== 'code') continue;
    if (imp.imported === '*') {
      const o = resolveExport(ctx, imp.target, 'TIMEOUTS');
      if (o && o.mod && o.local === 'TIMEOUTS' && o.mod.timeouts && !o.mod.timeouts.fail)
        out.push({ re: new RegExp('(?<![\\w$.])' + reEsc(local) + '\\s*\\.\\s*TIMEOUTS((?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*)(\\s*\\[)?', 'g'), tmod: o.mod });
      continue;
    }
    const o = resolveExport(ctx, imp.target, imp.imported);
    if (o && o.mod && o.local === 'TIMEOUTS' && o.mod.timeouts && !o.mod.timeouts.fail)
      out.push({ re: new RegExp('(?<![\\w$.])' + reEsc(local) + '((?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*)(\\s*\\[)?', 'g'), tmod: o.mod });
  }
  ctx.memo.set(key, out);
  return out;
}

function addTimeoutKeys(tmod, segs, bracket, parts) {
  const keys = tmod.timeouts.keys;
  const put = (k) => parts.set('timeouts:' + k, keys.get(k));
  const prefix = segs.join('.');
  if (!segs.length) { for (const k of keys.keys()) put(k); return; }
  if (keys.has(prefix) && !bracket) { put(prefix); return; }
  let hit = false;
  for (const k of keys.keys()) if (k.startsWith(prefix + '.')) { put(k); hit = true; }
  if (keys.has(prefix)) { put(prefix); hit = true; }
  if (hit) return;
  for (let n = segs.length - 1; n > 0; n--) { const k = segs.slice(0, n).join('.'); if (keys.has(k)) { put(k); return; } }
  parts.set('timeouts:' + prefix, sha256('(absent)'));
}

function regionRefs(ctx, m, ranges, parts, files) {
  if (m.kind !== 'code' || m.parseError) return;
  const code = m.code;
  for (const { re, tmod } of timeoutNames(ctx, m)) {
    for (const [a, b] of ranges) {
      re.lastIndex = a;
      let mt;
      while ((mt = re.exec(code)) && mt.index < b) {
        if (inRanges(m.importRanges, mt.index)) continue;
        const before = code.slice(Math.max(0, mt.index - 16), mt.index);
        if (/\btypeof\s+$/.test(before) || /\b(?:const|let|var)\s+$/.test(before)) continue;
        if (/^\s*(?:,|\}|as\b)/.test(code.slice(mt.index + mt[0].length, mt.index + mt[0].length + 4)) && !mt[1] && /[{,]\s*$/.test(before)) continue;
        const segs = (mt[1] || '').replace(/[\s?]/g, '').split('.').filter(Boolean);
        addTimeoutKeys(tmod, segs, !!mt[2], parts);
      }
    }
  }
  for (const t of m.strings) {
    if (!inRanges(ranges, t.start)) continue;
    const v = t.value;
    if (!DATA_EXT.test(v) || v.includes('${') || /^[a-z]+:\/\//i.test(v)) continue;
    for (const base of [m.dir, ctx.root]) {
      const f = path.resolve(base, v);
      if (isFile(f)) { parts.set('data:' + rel(ctx.root, f), fileSha(ctx, f)); files.add(f); break; }
    }
  }
}

/* ================================================================ closure ================================================================ */

function moduleClosure(ctx, starts) {
  const list = Array.isArray(starts) ? starts : [starts];
  const key = list.join('|');
  if (ctx.closures.has(key)) return ctx.closures.get(key);
  const seen = new Set();
  const order = [];
  const queue = [...list];
  while (queue.length) {
    const abs = queue.shift();
    if (seen.has(abs)) continue;
    seen.add(abs);
    order.push(abs);
    const m = getMod(ctx, abs);
    for (const d of m.deps) if (!seen.has(d.abs)) queue.push(d.abs);
  }
  ctx.closures.set(key, order);
  return order;
}

/** module: / file: / data: parts of every module of a closure (the start files excluded). */
function closureParts(ctx, mods, exclude, parts, files, unknown, roots, wholeForAll) {
  for (const abs of mods) {
    if (exclude.has(abs)) continue;
    const m = getMod(ctx, abs);
    files.add(abs);
    if (m.kind === 'data') { parts.set('data:' + m.rel, fileSha(ctx, abs)); continue; }
    for (const u of m.unresolved) unknown.add(u);
    if (m.parseError) { parts.set('file:' + m.rel, sha256(m.src)); unknown.add('module could not be scanned (' + m.parseError + '): ' + m.rel); continue; }
    const tm = m.timeouts && !m.timeouts.fail;
    if (m.whole || (wholeForAll && !tm)) {
      const r = [[0, m.src.length]];
      parts.set('file:' + m.rel, partSha(ctx, 'file:' + m.rel, m, r));
      roots.push({ key: 'w|' + abs, mod: m, ranges: r, concrete: null, lex: null, scopes: r, fixtures: null });
    } else {
      const r = remainderOf(m);
      parts.set('module:' + m.rel, partSha(ctx, 'module:' + m.rel, m, r));
      roots.push({ key: 'r|' + abs, mod: m, ranges: r, concrete: null, lex: null, scopes: r, fixtures: null });
    }
  }
}

/* ================================================================ globals ================================================================ */

function playwrightVersion(root) {
  let dir = root;
  for (let k = 0; k < 30; k++) {
    for (const pkg of ['@playwright/test', 'playwright']) {
      const pj = path.join(dir, 'node_modules', pkg, 'package.json');
      if (isFile(pj)) { try { const v = JSON.parse(read(pj)).version; if (v) return pkg + '@' + v; } catch { /* unreadable */ } }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return 'none';
}

function buildGlobals(ctx, failedTimeouts) {
  const parts = new Map();
  const files = new Set();
  const unknown = new Set();
  let entries = [];
  try { entries = fs.readdirSync(ctx.root).filter((e) => CONFIG_RE.test(e)).sort(natural); } catch { /* no root listing */ }
  const configs = entries.map((e) => path.join(ctx.root, e)).filter(isFile);
  for (const f of ctx.tsconfig ? ctx.tsconfig.files : []) { parts.set('config:' + rel(ctx.root, f), fileSha(ctx, f)); files.add(f); }
  const starts = [];
  for (const cfg of configs) {
    const m = getMod(ctx, cfg);
    files.add(cfg);
    parts.set('config:' + m.rel, m.parseError ? sha256(m.src) : partSha(ctx, 'config:' + m.rel, m, [[0, m.src.length]]));
    if (m.parseError) { unknown.add('config could not be scanned: ' + m.rel); continue; }
    for (const u of m.unresolved) unknown.add(u);
    starts.push(cfg);
    for (const t of m.strings) {
      if (!/^\.\.?\//.test(t.value) || t.value.includes('${')) continue;
      const f = resolveFileLike(path.resolve(m.dir, t.value));
      if (f && isCodeFile(f)) starts.push(f);
    }
  }
  const mods = starts.length ? moduleClosure(ctx, [...new Set(starts)]) : [];
  const roots = [];
  closureParts(ctx, mods, new Set(configs), parts, files, unknown, roots, true);
  for (const cfg of configs) { const m = getMod(ctx, cfg); if (!m.parseError) regionRefs(ctx, m, [[0, m.src.length]], parts, files); }
  for (const r of roots) regionRefs(ctx, r.mod, r.ranges, parts, files);
  for (const abs of [...failedTimeouts].sort()) { const m = getMod(ctx, abs); parts.set('file:' + m.rel, sha256(m.src)); files.add(abs); }
  parts.set('playwright:version', sha256(playwrightVersion(ctx.root)));
  return { parts, files, unknown };
}

/* ================================================================ specs ================================================================ */

const normTitle = (t) => String(t || '').replace(/(^|\s)@[\w:.\-/]+/g, ' ').replace(/\s+/g, ' ').trim();

function tcIdsOf(text) {
  const ids = [];
  for (const mt of String(text || '').matchAll(/\[([^\]]+)\]/g)) {
    for (const part of mt[1].split(',')) {
      const t = part.trim();
      if (/^TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(t) && !ids.includes(t)) ids.push(t);
    }
  }
  return ids;
}

function blockTitle(m, b) {
  if (!b.args.length) return null;
  const s = skipWs(m.code, b.args[0][0], b.args[0][1]);
  const st = m.strAt.get(s);
  return st ? st.value : null;
}

/** Tests of one spec file with their spec-level parts and reachability roots. */
function analyzeSpec(ctx, m) {
  const key = 'impact:spec:' + m.abs;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  const res = { tests: [], warnings: [], unknown: [] };
  ctx.memo.set(key, res);
  if (m.parseError) {
    res.warnings.push('spec could not be scanned (' + m.parseError + '): ' + m.rel);
    res.tests.push({ id: m.rel + '::(unscannable)', title: '(unscannable)', describe: [], tcs: tcIdsOf(m.src), range: null, unscannable: true });
    return res;
  }
  const ids = testIdentifiers(m.s).ids;
  const blocks = findBlocks(m.s, ids);
  if (blocks.parseFail) { res.warnings.push('spec could not be fully scanned: ' + m.rel); res.unknown.push('spec could not be fully scanned: ' + m.rel); }
  const isDescribe = (b) => b.body && b.chain[0] === 'describe' && !b.chain.includes('configure');
  const isHook = (b) => b.body && HOOKS.has(b.chain[0]);
  const isTest = (b) => b.body && (b.chain.length === 0 || (b.chain.length === 1 && TEST_MODS.has(b.chain[0]))) && blockTitle(m, b) !== null;
  const relevant = blocks.filter((b) => isDescribe(b) || isHook(b) || isTest(b));
  const anc = (b) => { let p = b.parent; while (p && !isDescribe(p)) p = p.parent; return p; };
  for (const b of relevant) b._anc = anc(b);
  const describes = relevant.filter(isDescribe);
  const dKey = new Map();
  const pathOf = (d) => { const out = []; for (let p = d; p; p = p._anc) out.unshift(normTitle(blockTitle(m, p)) || '(anonymous)'); return out; };
  const dupCount = new Map();
  for (const d of describes) {
    const p = pathOf(d).join(' > ');
    const n = (dupCount.get(p) || 0) + 1;
    dupCount.set(p, n);
    dKey.set(d, n > 1 ? p + ' #' + n : p);
  }
  const range = (b) => [b.headStart, b.close + 1];
  const top = relevant.filter((b) => !b._anc);
  const specRem = subtract([0, m.src.length], top.map(range).sort((x, y) => x[0] - y[0]));
  const dRem = new Map();
  for (const d of describes) dRem.set(d, subtract(range(d), relevant.filter((b) => b._anc === d).map(range).sort((x, y) => x[0] - y[0])));
  const hooks = relevant.filter(isHook);
  const hookIds = new Map();
  const hookN = new Map();
  for (const h of hooks) {
    const container = h._anc ? dKey.get(h._anc) : '';
    const k = container + '|' + h.chain[0];
    const n = (hookN.get(k) || 0) + 1;
    hookN.set(k, n);
    hookIds.set(h, 'hook:' + m.rel + '::' + container + '::' + h.chain[0] + '#' + n);
  }
  const seenIds = new Map();
  for (const t of relevant.filter(isTest)) {
    const ancestors = [];
    for (let p = t._anc; p; p = p._anc) ancestors.push(p);   // inner → outer
    const describe = ancestors.slice().reverse().map((d) => normTitle(blockTitle(m, d)) || '(anonymous)');
    const raw = blockTitle(m, t);
    let id = m.rel + '::' + describe.join(' > ') + '::' + normTitle(raw);
    const n = (seenIds.get(id) || 0) + 1;
    seenIds.set(id, n);
    if (n > 1) id += ' #' + n;
    const inScope = hooks.filter((h) => !h._anc || ancestors.includes(h._anc));
    const fnArg = t.args.find(([a, b]) => a <= t.body.start && t.body.start <= b) || t.args[t.args.length - 1];
    const params = fnParams(m.code, fnArg[0], fnArg[1]);
    const fixtureNames = new Set(params.names);
    const restNames = new Set(params.rest);
    for (const h of inScope) {
      const ha = h.args.find(([a, b]) => a <= h.body.start && h.body.start <= b) || h.args[h.args.length - 1];
      const hp = fnParams(m.code, ha[0], ha[1]);
      for (const x of hp.names) fixtureNames.add(x);
      for (const x of hp.rest) restNames.add(x);
    }
    res.tests.push({
      id, title: normTitle(raw), describe, tcs: tcIdsOf(raw), ident: t.ident, range: range(t),
      hooks: inScope.map((h) => ({ id: hookIds.get(h), range: range(h) })),
      describes: ancestors.map((d) => ({ id: 'describe:' + m.rel + '::' + dKey.get(d), ranges: dRem.get(d) })),
      specRemainder: specRem, fixtureNames: [...fixtureNames].filter((x) => x !== '...'), restNames: [...restNames],
    });
  }
  return res;
}

/** Merged fixture table of the binding `name` in module m: Map(fixture → { mod, name, start, end, deps, useTypes, typeText }). */
function fixtureTable(ctx, m, name, depth = 0) {
  const key = 'impact:fx:' + m.abs + '#' + name;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  ctx.memo.set(key, { ok: false, reason: 'circular fixture definition', map: new Map() });
  const res = (() => {
    if (depth > 12) return { ok: false, reason: 'fixture chain too deep', map: new Map() };
    const decl = m.fixtureDecls.get(name);
    if (decl) {
      if (!decl.ok) return { ok: false, reason: "fixtures of '" + name + "' in " + m.rel + ' could not be parsed (' + decl.reason + ')', map: new Map() };
      const bases = decl.merge ? decl.merge : [decl.base];
      const map = new Map();
      let ok = true, reason = null;
      for (const b of bases) {
        const t = fixtureBinding(ctx, m, b, depth + 1);
        if (!t.ok) { ok = false; reason = t.reason; }
        for (const [k, v] of t.map) map.set(k, v);
      }
      for (const p of decl.props) map.set(p.name, { ...p, mod: m, typeText: decl.typeProps.get(p.name) || null });
      return { ok, reason, map };
    }
    const d = m.localDecls.get(name);
    if (d && d.initPos != null) {
      const id = /^([A-Za-z_$][\w$]*)\s*;?\s*$/.exec(m.code.slice(d.initPos, exprEnd(m.code, d.initPos, m.code.length)));
      if (id) return fixtureBinding(ctx, m, id[1], depth + 1);
    }
    return { ok: false, reason: "the test binding '" + name + "' in " + m.rel + ' is not a recognised test.extend / mergeTests', map: new Map() };
  })();
  ctx.memo.set(key, res);
  return res;
}

function fixtureBinding(ctx, m, name, depth) {
  const imp = m.imports.get(name);
  if (imp) {
    if (imp.status === 'lib') return { ok: true, reason: null, map: new Map() };
    if (imp.status !== 'ok') return { ok: false, reason: "the test binding '" + name + "' in " + m.rel + ' comes from an unresolved import', map: new Map() };
    const o = resolveExport(ctx, imp.target, imp.imported);
    if (!o) return { ok: false, reason: "the test binding '" + name + "' in " + m.rel + ' could not be resolved', map: new Map() };
    if (o.lib) return { ok: true, reason: null, map: new Map() };
    if (!o.mod || !o.local) return { ok: false, reason: "the test binding '" + name + "' in " + m.rel + ' is not a plain export', map: new Map() };
    return fixtureTable(ctx, o.mod, o.local, depth);
  }
  if (m.localDecls.has(name)) return fixtureTable(ctx, m, name, depth);
  return { ok: true, reason: null, map: new Map() };   // the default `test` of a file that imports none: Playwright's own
}

function fixtureTypes(ctx, table, name) {
  const f = table.map.get(name);
  if (!f) return BUILTIN_FIXTURES.has(name) || table.ok ? [LIB] : [];
  if (f.typeText) return typeFromAnnotation(ctx, f.mod, f.typeText, null);
  const out = [];
  for (const u of f.useTypes) { const c = resolveClassName(ctx, f.mod, u); if (c === 'lib') out.push(LIB); else if (c) out.push(inst(c)); }
  return uniq(out);
}

/* ================================================================ fingerprint ================================================================ */

function fingerprintOne(ctx, specMod, t, spec, globals, setupParts) {
  const st = {
    parts: new Map(globals.parts), unknown: new Set([...globals.unknown, ...spec.unknown]), files: new Set(globals.files),
    queue: [], seen: new Set(), byNameDone: new Set(), closureClasses: [],
  };
  st.files.add(specMod.abs);
  if (t.unscannable) {
    st.parts.set('test:' + t.id, sha256(specMod.src));
    st.unknown.add('spec could not be scanned: ' + specMod.rel);
    return finish(st, t);
  }
  const mods = moduleClosure(ctx, specMod.abs);
  for (const abs of mods) { const m = getMod(ctx, abs); if (m.kind === 'code' && !m.whole) st.closureClasses.push(...m.classes); }
  for (const c of specMod.classes) if (!st.closureClasses.includes(c)) st.closureClasses.push(c);
  const roots = [];
  for (const u of specMod.unresolved) st.unknown.add(u);
  closureParts(ctx, mods, new Set([specMod.abs]), st.parts, st.files, st.unknown, roots, false);
  // spec-level parts
  const scopes = [t.range, ...t.hooks.map((h) => h.range), ...t.describes.flatMap((d) => d.ranges), ...t.specRemainder];
  const table = fixtureBinding(ctx, specMod, t.ident, 0);
  if (!table.ok) st.unknown.add(table.reason);
  const fixtures = new Map();
  for (const n of t.fixtureNames) fixtures.set(n, fixtureTypes(ctx, table, n));
  for (const n of t.restNames) if (!fixtures.has(n)) fixtures.set(n, [LIB]);
  const specItem = (key, ranges) => ({ key, mod: specMod, ranges, concrete: null, lex: null, scopes, fixtures });
  st.parts.set('test:' + t.id, partSha(ctx, 'test:' + t.id, specMod, [t.range]));
  roots.push(specItem('t|' + t.id, [t.range]));
  for (const h of t.hooks) { st.parts.set(h.id, partSha(ctx, h.id, specMod, [h.range])); roots.push(specItem('h|' + h.id, [h.range])); }
  for (const d of t.describes) { st.parts.set(d.id, partSha(ctx, d.id, specMod, d.ranges)); roots.push(specItem('d|' + d.id, d.ranges)); }
  st.parts.set('spec:' + specMod.rel, partSha(ctx, 'spec:' + specMod.rel, specMod, t.specRemainder));
  roots.push(specItem('s|' + specMod.rel, t.specRemainder));
  // fixtures the test and its hooks destructure, with their dependencies
  const used = new Set();
  const want = [...t.fixtureNames];
  while (want.length) {
    const n = want.shift();
    if (used.has(n)) continue;
    used.add(n);
    const f = table.map.get(n);
    if (!f) continue;
    for (const dep of f.deps) want.push(dep);
    const pid = 'fixture:' + f.mod.rel + '#' + f.name;
    st.parts.set(pid, partSha(ctx, pid, f.mod, [[f.start, f.end]]));
    const fx = new Map();
    for (const dep of f.deps) fx.set(dep, fixtureTypes(ctx, table, dep));
    roots.push({ key: 'f|' + pid, mod: f.mod, ranges: [[f.start, f.end]], concrete: null, lex: null, scopes: [[f.start, f.end], ...remainderOf(f.mod)], fixtures: fx });
  }
  // setup journeys feeding a serial:{gap} TC
  for (const tc of t.tcs) for (const [pid, sha] of setupParts(tc)) st.parts.set(pid, sha);
  // reachability
  const regions = [];
  for (const r of roots) { st.seen.add(r.key); st.queue.push(r); }
  while (st.queue.length) {
    const item = st.queue.shift();
    regions.push(item);
    scanItem(ctx, st, item);
  }
  for (const r of regions) regionRefs(ctx, r.mod, r.ranges, st.parts, st.files);
  return finish(st, t);
}

function finish(st, t) {
  const parts = {};
  for (const k of [...st.parts.keys()].sort(natural)) parts[k] = st.parts.get(k);
  const fingerprint = sha256(Object.keys(parts).map((k) => k + '=' + parts[k]).join('\n'));
  return { id: t.id, tcs: t.tcs, title: t.title, describe: t.describe, fingerprint, parts, unknown: [...st.unknown].sort(natural), files: st.files };
}

function resolveSpecList(ctx, specs) {
  const list = csvList(specs);
  if (!list.length) return walk(ctx.root, isSpecFile).sort((a, b) => natural(rel(ctx.root, a), rel(ctx.root, b)));
  const out = [];
  for (const s of list) {
    const cands = path.isAbsolute(s) ? [s] : [path.resolve(ctx.root, s), path.resolve(s)];
    const f = cands.find(isFile);
    if (f) { if (!out.includes(f)) out.push(f); } else ctx.warnings.push('spec not found: ' + s);
  }
  return out.sort((a, b) => natural(rel(ctx.root, a), rel(ctx.root, b)));
}

/**
 * Fingerprint every test (and TC) of the given spec files.
 * `cache` holds parsed files keyed by absolute path and is never invalidated: pass a fresh Map per snapshot.
 */
export function fingerprintTests({ root, specs = [], tcs = null, runPlan = null, cache = new Map() } = {}) {
  if (!root) throw new Error('--root is required');
  const absRoot = path.resolve(String(root));
  if (!isDir(absRoot)) throw new Error('automation root not found: ' + root);
  const ctx = makeCtx(absRoot, cache);
  const specFiles = resolveSpecList(ctx, specs);
  const failedT = new Set();
  for (const f of specFiles) for (const abs of moduleClosure(ctx, f)) { const m = getMod(ctx, abs); if (m.timeouts && m.timeouts.fail) failedT.add(abs); }
  const globals = buildGlobals(ctx, failedT);
  const setupParts = setupResolver(ctx, runPlan, globals);
  const tests = {};
  const tcMap = new Map();
  const closureByTest = new Map();
  for (const f of specFiles) {
    const m = getMod(ctx, f);
    if (m.kind !== 'code') continue;
    const spec = analyzeSpec(ctx, m);
    for (const w of spec.warnings) if (!ctx.warnings.includes(w)) ctx.warnings.push(w);
    for (const t of spec.tests) {
      const r = fingerprintOne(ctx, m, t, spec, globals, setupParts);
      tests[r.id] = { file: m.rel, title: r.title, describe: r.describe, tcs: r.tcs, fingerprint: r.fingerprint, parts: r.parts, unknown: r.unknown };
      closureByTest.set(r.id, r.files);
      for (const tc of r.tcs) { if (!tcMap.has(tc)) tcMap.set(tc, []); tcMap.get(tc).push(r.id); }
    }
  }
  const want = tcs ? new Set(csvList(tcs)) : null;
  if (want) for (const tc of want) if (!tcMap.has(tc)) ctx.warnings.push(tc + ' is not carried by any test of the scanned specs');
  const outTcs = {};
  const keepTests = new Set();
  const closureByTc = new Map();
  for (const tc of [...tcMap.keys()].sort(natural)) {
    if (want && !want.has(tc)) continue;
    const ids = tcMap.get(tc).slice().sort(natural);
    const unknown = new Set();
    const cl = new Set();
    for (const id of ids) { keepTests.add(id); for (const u of tests[id].unknown) unknown.add(u); for (const f of closureByTest.get(id)) cl.add(rel(absRoot, f)); }
    outTcs[tc] = { fingerprint: sha256(ids.map((id) => id + '=' + tests[id].fingerprint).join('\n')), tests: ids, unknown: [...unknown].sort(natural) };
    closureByTc.set(tc, cl);
  }
  const outTests = {};
  const files = {};
  for (const id of Object.keys(tests).sort(natural)) {
    if (want && !keepTests.has(id)) continue;
    outTests[id] = tests[id];
    for (const f of closureByTest.get(id)) files[rel(absRoot, f)] = fileSha(ctx, f);
  }
  const out = { schema: SCHEMA_VERSION, root: absRoot, tcs: outTcs, tests: outTests, files: sortObj(files), warnings: ctx.warnings.slice() };
  Object.defineProperty(out, '_closureByTc', { value: closureByTc, enumerable: false });
  // per test: the closure files (relative, sorted) — not part of the payload; closureOf() / reverseDependencies() read it
  const closureRel = new Map();
  for (const id of Object.keys(outTests)) closureRel.set(id, [...closureByTest.get(id)].map((f) => rel(absRoot, f)).sort(natural));
  Object.defineProperty(out, '_closureByTest', { value: closureRel, enumerable: false });
  return out;
}

function setupResolver(ctx, runPlan, globals) {
  const gaps = new Map();
  const plan = runPlan && (runPlan.run_plan || runPlan);
  if (!plan || !Array.isArray(plan.groups)) return () => [];
  // a serial group is fed by `setup:{gap}` (same gap name) and by every setup group that lists it in `feeds`
  const setups = (plan.setup_groups || []).filter((x) => x && typeof x.name === 'string' && x.name.startsWith('setup:'));
  for (const g of plan.groups) {
    if (!g || typeof g.name !== 'string') continue;
    const fed = setups.filter((sg) => (g.name.startsWith('serial:') && sg.name === 'setup:' + g.name.slice('serial:'.length)) || (Array.isArray(sg.feeds) && sg.feeds.includes(g.name)));
    for (const sg of fed) for (const tc of g.tcs || []) { if (!gaps.has(tc)) gaps.set(tc, new Set()); gaps.get(tc).add(sg.name.slice('setup:'.length)); }
  }
  const memo = new Map();
  const fpGap = (gap) => {
    if (memo.has(gap)) return memo.get(gap);
    const sg = (plan.setup_groups || []).find((x) => x && x.name === 'setup:' + gap);
    let v;
    if (!sg) v = null;
    else {
      const specs = csvList(Array.isArray(sg.spec) ? sg.spec : sg.spec || '');
      const lines = [];
      for (const s of specs) {
        const f = [path.resolve(ctx.root, s), path.resolve(s)].find(isFile);
        if (!f) { ctx.warnings.push('setup spec not found for setup:' + gap + ': ' + s); lines.push(s + '=(missing)'); continue; }
        const m = getMod(ctx, f);
        const spec = analyzeSpec(ctx, m);
        for (const t of spec.tests) {
          const r = fingerprintOne(ctx, m, t, spec, globals, () => []);
          for (const [k, sha] of Object.entries(r.parts)) lines.push(k + '=' + sha);
          for (const u of r.unknown) lines.push('unknown=' + u);
        }
      }
      v = sha256([...new Set(lines)].sort(natural).join('\n'));
    }
    memo.set(gap, v);
    return v;
  };
  return (tc) => {
    const out = [];
    for (const gap of [...(gaps.get(tc) || [])].sort(natural)) { const v = fpGap(gap); if (v) out.push(['setup:' + gap, v]); }
    return out;
  };
}

/* ================================================================ select ================================================================ */

const SUMMARY_RE = /^(first|rerun)-(.+)-(\d+)\.summary\.json$/;

function loadSummaries(dir, warnings) {
  if (!dir || !isDir(dir)) { warnings.push('progress directory not found: ' + (dir || '(none)') + ' — every TC is never_run'); return []; }
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { /* unreadable */ }
  for (const e of entries) {
    if (!SUMMARY_RE.test(e)) continue;
    let j = null;
    try { j = JSON.parse(read(path.join(dir, e))); } catch { warnings.push('summary is not valid JSON: ' + e); continue; }
    if (!j || typeof j !== 'object') continue;
    const t = Date.parse(j.startedAt);
    if (Number.isNaN(t)) warnings.push('summary has no valid startedAt (ordered last): ' + e);
    out.push({ file: e, j, t: Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t });
  }
  out.sort((a, b) => a.t - b.t || natural(a.file, b.file));
  return out;
}

export function selectStale({ root, specs = [], progressDir, runPlan = null } = {}) {
  const cache = new Map();
  const cur = fingerprintTests({ root, specs, runPlan, cache });
  const warnings = [...cur.warnings];
  const sums = loadSummaries(progressDir, warnings);
  const tcsNow = Object.keys(cur.tcs).sort(natural);
  const res = { schema: SCHEMA_VERSION, stale: [], fresh: [], fresh_by_member_only: [], never_run: [], no_verdict: [], expanded: [], outside_scope: [], unknown: [], warnings };
  const staleSet = new Map();
  for (const tc of tcsNow) {
    const now = cur.tcs[tc];
    if (now.unknown.length) res.unknown.push({ tc, reasons: now.unknown });
    let last = null;
    for (const s of sums) if (s.j.executed && Object.prototype.hasOwnProperty.call(s.j.executed, tc)) last = s;
    let status = null, reason = null;
    for (const s of sums) if (s.j.tcs && Object.prototype.hasOwnProperty.call(s.j.tcs, tc)) { status = s.j.tcs[tc]; reason = (s.j.reasons && s.j.reasons[tc]) || null; }
    if (status === 'NOT_RUN' || status === 'INCOMPLETE') res.no_verdict.push({ tc, status, reason });
    if (!last) { res.never_run.push(tc); continue; }
    const code = last.j.code;
    const lastRef = { run: last.j.run || null, stage: last.j.stage || null, seq: last.j.seq ?? null, startedAt: last.j.startedAt || null, summary: last.file };
    const stored = code && code.tcs && code.tcs[tc];
    let why = null;
    if (!code) why = 'no code fingerprint in its latest summary';
    else if (code.error) why = 'code fingerprint failed in its latest summary: ' + code.error;
    else if (Array.isArray(code.changed_during_call) && code.changed_during_call.includes(tc)) why = 'code changed during its latest call';
    else if (!stored) why = 'no fingerprint for this TC in its latest summary';
    else if (stored.fingerprint !== now.fingerprint) why = 'code changed since its latest run';
    else if (now.unknown.length) why = 'unknown: the impact of a change cannot be decided';
    if (!why) {
      const storedFiles = (code && code.files) || {};
      const cl = cur._closureByTc.get(tc) || new Set();
      const changedFile = [...cl].some((f) => Object.prototype.hasOwnProperty.call(storedFiles, f) && storedFiles[f] !== cur.files[f]);
      (changedFile ? res.fresh_by_member_only : res.fresh).push(tc);
      continue;
    }
    const changed = new Set();
    if (stored && code && code.tests) {
      const before = new Map();
      for (const id of stored.tests || []) for (const [k, v] of Object.entries((code.tests[id] && code.tests[id].parts) || {})) before.set(k, v);
      const after = new Map();
      for (const id of now.tests) for (const [k, v] of Object.entries(cur.tests[id].parts)) after.set(k, v);
      for (const [k, v] of after) if (before.get(k) !== v) changed.add(k);
      for (const k of before.keys()) if (!after.has(k)) changed.add(k);
    }
    staleSet.set(tc, { tc, changed: [...changed].sort(natural), last: lastRef, reason: why });
  }
  // a stale TC re-runs its shared tests ([TC-07][TC-08]) — every TC on such a test is re-run with it
  const neighbours = new Map();
  for (const t of Object.values(cur.tests)) for (const a of t.tcs) for (const b of t.tcs) if (a !== b) { if (!neighbours.has(a)) neighbours.set(a, new Set()); neighbours.get(a).add(b); }
  const never = new Set(res.never_run);
  for (let changedAny = true; changedAny;) {
    changedAny = false;
    for (const tc of [...staleSet.keys()]) {
      for (const nb of neighbours.get(tc) || []) {
        if (staleSet.has(nb) || never.has(nb) || !cur.tcs[nb]) continue;
        const because = [...(neighbours.get(nb) || [])].filter((x) => staleSet.has(x)).sort(natural);
        staleSet.set(nb, { tc: nb, changed: [], last: null, reason: 'shares a test with ' + because.join(', ') });
        res.expanded.push({ tc: nb, because });
        changedAny = true;
      }
    }
  }
  const expandedSet = new Set(res.expanded.map((e) => e.tc));
  res.fresh = res.fresh.filter((x) => !expandedSet.has(x));
  res.fresh_by_member_only = res.fresh_by_member_only.filter((x) => !expandedSet.has(x));
  res.stale = [...staleSet.values()].sort((a, b) => natural(a.tc, b.tc));
  res.expanded.sort((a, b) => natural(a.tc, b.tc));
  // other specs of the automation root that reach a changed part
  if (csvList(specs).length) {
    const changedIds = new Set(res.stale.flatMap((s) => s.changed));
    if (changedIds.size) {
      const inScope = new Set(Object.values(cur.tests).map((t) => t.file));
      const others = walk(cur.root, isSpecFile).map((f) => rel(cur.root, f)).filter((r) => !inScope.has(r)).sort(natural);
      if (others.length) {
        const fp = fingerprintTests({ root: cur.root, specs: others, runPlan, cache });
        const bySpec = new Map();
        for (const t of Object.values(fp.tests)) {
          const hit = Object.keys(t.parts).filter((k) => changedIds.has(k));
          if (!hit.length) continue;
          if (!bySpec.has(t.file)) bySpec.set(t.file, { spec: t.file, tcs: new Set(), changed: new Set() });
          const e = bySpec.get(t.file);
          for (const tc of t.tcs) e.tcs.add(tc);
          for (const h of hit) e.changed.add(h);
        }
        res.outside_scope = [...bySpec.values()].sort((a, b) => natural(a.spec, b.spec)).map((e) => ({ spec: e.spec, tcs: [...e.tcs].sort(natural), changed: [...e.changed].sort(natural) }));
      }
    }
  }
  return res;
}

/* ================================================================ closure / reverse dependencies ================================================================ */

/** The part ids of a test that name `file` (posix, relative): spec / module / file / data / config / test / hook / describe / member / fixture parts. */
function partsNaming(parts, file) {
  const out = [];
  for (const k of Object.keys(parts)) {
    const colon = k.indexOf(':');
    if (colon < 0) continue;
    const rest = k.slice(colon + 1);
    if (rest === file || rest.startsWith(file + '::') || rest.startsWith(file + '#')) out.push(k);
  }
  return out;
}

/**
 * Per test of the given specs: the files its fingerprint closure reaches (the spec, its import closure, the data files
 * it references, every config / tsconfig / timeouts module), its part ids and its unknown reasons; per TC the union
 * over its tests. Read-only — the code view behind parallel-plan.mjs and reverseDependencies().
 */
export function closureOf({ root, specs = [], runPlan = null, cache = new Map() } = {}) {
  const fp = fingerprintTests({ root, specs, runPlan, cache });
  const tests = {};
  const acc = new Map();
  for (const [id, t] of Object.entries(fp.tests)) {
    const files = fp._closureByTest.get(id) || [];
    tests[id] = { file: t.file, title: t.title, describe: t.describe, tcs: t.tcs, files, parts: Object.keys(t.parts), unknown: t.unknown };
    for (const tc of t.tcs) {
      if (!acc.has(tc)) acc.set(tc, { tests: [], files: new Set(), unknown: new Set() });
      const e = acc.get(tc);
      e.tests.push(id);
      for (const f of files) e.files.add(f);
      for (const u of t.unknown) e.unknown.add(u);
    }
  }
  const tcs = {};
  for (const tc of [...acc.keys()].sort(natural)) {
    const e = acc.get(tc);
    tcs[tc] = { tests: e.tests.sort(natural), files: [...e.files].sort(natural), unknown: [...e.unknown].sort(natural) };
  }
  return { schema: SCHEMA_VERSION, root: fp.root, tests, tcs, warnings: fp.warnings };
}

/**
 * Which tests / TCs depend on the changed `files` (posix, relative to the root, or absolute): a test depends on a file
 * its closure reaches or one of its parts names, on any part id listed in `parts`, and — with a run plan — on the
 * closure of the setup journey feeding its serial:{gap} group. FAIL SAFE: a test with an unknown part depends on
 * everything (reason `unknown`). Read-only; Checkpoint B's incremental shadow and the parallel readiness check use it.
 */
export function reverseDependencies({ root, specs = [], files = [], parts = [], runPlan = null, cache = new Map() } = {}) {
  const fp = fingerprintTests({ root, specs, runPlan, cache });
  const absRoot = fp.root;
  const norm = [...new Set(csvList(files).map((f) => (path.isAbsolute(f) ? rel(absRoot, f) : f.replace(/\\/g, '/').replace(/^\.\//, ''))))].sort(natural);
  const wantParts = new Set(csvList(parts));
  const setupFiles = new Map();
  const plan = runPlan && (runPlan.run_plan || runPlan);
  for (const sg of (plan && Array.isArray(plan.setup_groups) ? plan.setup_groups : [])) {
    if (!sg || typeof sg.name !== 'string' || !sg.name.startsWith('setup:')) continue;
    const specsOf = csvList(Array.isArray(sg.spec) ? sg.spec : sg.spec || '');
    if (!specsOf.length) continue;
    try {
      const s = fingerprintTests({ root: absRoot, specs: specsOf, cache });
      const set = new Set();
      for (const id of Object.keys(s.tests)) for (const f of s._closureByTest.get(id) || []) set.add(f);
      setupFiles.set(sg.name.slice('setup:'.length), set);
    } catch { /* an unreadable setup spec: its gap is matched by the part only */ }
  }
  const tests = [];
  const tcs = new Set();
  const unknown = [];
  for (const [id, t] of Object.entries(fp.tests)) {
    const closure = new Set(fp._closureByTest.get(id) || []);
    const via = new Set();
    for (const f of norm) {
      if (closure.has(f)) via.add('closure:' + f);
      for (const k of partsNaming(t.parts, f)) via.add(k);
    }
    for (const k of Object.keys(t.parts)) {
      if (wantParts.has(k)) via.add(k);
      if (k.startsWith('setup:')) { const set = setupFiles.get(k.slice('setup:'.length)); if (set && norm.some((f) => set.has(f))) via.add(k); }
    }
    if (t.unknown.length) unknown.push({ test: id, tcs: t.tcs, reasons: t.unknown });
    if (!via.size && !t.unknown.length) continue;
    tests.push({ test: id, file: t.file, tcs: t.tcs, via: [...via].sort(natural), reason: via.size ? 'depends' : 'unknown' });
    for (const tc of t.tcs) tcs.add(tc);
  }
  tests.sort((a, b) => natural(a.test, b.test));
  unknown.sort((a, b) => natural(a.test, b.test));
  return { schema: SCHEMA_VERSION, root: absRoot, files: norm, parts: [...wantParts].sort(natural), tests, tcs: [...tcs].sort(natural), unknown, warnings: fp.warnings };
}

/* ================================================================ CLI ================================================================ */

const USAGE = [
  'impact.mjs — which TCs are impacted by code changes since they last ran (read-only).',
  '',
  '  node impact.mjs fingerprint --root <automation_root> [--spec a,b] [--tcs TC-1,TC-2] [--run-file <phase-N.json>] [--pretty]',
  '  node impact.mjs select --root <automation_root> [--spec a,b] --progress <results_root>/artifacts/progress [--run-file <phase-N.json>] [--pretty]',
  '  node impact.mjs reverse --root <automation_root> [--spec a,b] --files <changed file,…> [--parts <part id,…>] [--run-file <phase-N.json>] [--pretty]',
  '',
  'Exit code is always 0; the result (or { outcome: "BLOCKED", reason }) is the JSON payload.',
].join('\n');

function runPlanFrom(file) {
  if (!file) return null;
  const txt = read(path.resolve(String(file)));
  if (txt === null) throw new Error('run file not found: ' + file);
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error('run file is not valid JSON: ' + file); }
  return j.run_plan || (Array.isArray(j.groups) ? j : null);
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (args.help || cmd === 'help' || !cmd) { process.stdout.write(USAGE + '\n'); return; }
  try {
    if (cmd !== 'fingerprint' && cmd !== 'select' && cmd !== 'reverse') throw new Error("unknown command '" + cmd + "' — use fingerprint, select or reverse");
    if (!args.root || args.root === true) throw new Error('--root <automation_root> is required');
    const runPlan = args['run-file'] && args['run-file'] !== true ? runPlanFrom(args['run-file']) : null;
    const specs = typeof args.spec === 'string' ? args.spec : [];
    if (cmd === 'fingerprint') {
      const r = fingerprintTests({ root: args.root, specs, tcs: typeof args.tcs === 'string' ? args.tcs : null, runPlan });
      print({ tool: 'impact', command: cmd, outcome: 'OK', ...r }, args);
    } else if (cmd === 'reverse') {
      if (typeof args.files !== 'string' && typeof args.parts !== 'string') throw new Error('--files <changed file,…> (or --parts <part id,…>) is required');
      const r = reverseDependencies({ root: args.root, specs, files: typeof args.files === 'string' ? args.files : [], parts: typeof args.parts === 'string' ? args.parts : [], runPlan });
      print({ tool: 'impact', command: cmd, outcome: 'OK', ...r }, args);
    } else {
      if (!args.progress || args.progress === true) throw new Error('--progress <results_root>/artifacts/progress is required');
      const r = selectStale({ root: args.root, specs, progressDir: path.resolve(String(args.progress)), runPlan });
      print({ tool: 'impact', command: cmd, outcome: 'OK', ...r }, args);
    }
  } catch (e) {
    print({ tool: 'impact', command: cmd || null, outcome: 'BLOCKED', reason: e && e.message ? e.message : String(e) }, args);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
