// Text engine for validate-automation.mjs — no rule knowledge lives here.
// Node >= 18, zero dependencies. Nothing in this file writes to disk.
//
// This is deliberately NOT a JavaScript/TypeScript parser. It strips comments and
// string literals so token checks cannot fire inside them, balances braces to find
// block bodies, and follows relative imports. Anything beyond that — type
// resolution, control flow, inheritance — is out of scope by design: the caller
// routes those cases to semantic review instead of guessing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/* ---------------- argv + output (copied verbatim from skill 1's lib.mjs) ----------------
   Not imported across skill folders: /sync-skills copies one skill folder at a time,
   so skill 5 must run even when skill 1 is not present. */

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

export function print(obj, args) {
  process.stdout.write(JSON.stringify(obj, null, args.pretty ? 2 : 0) + '\n');
}

export const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
export const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

export const posix = (p) => String(p).replace(/\\/g, '/');
export const rel = (root, p) => posix(path.relative(root, p)) || posix(path.basename(p));
export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** Stable digest over a { path: sha256 } map — order-independent, content-addressed. */
export function digestOf(fileHashes) {
  const lines = Object.keys(fileHashes).sort().map((k) => k + ':' + fileHashes[k]);
  return { scopeDigest: sha256(lines.join('\n')), fileCount: lines.length };
}

/* ---------------- source stripping ---------------- */

/**
 * Blank out comment bodies and string/template interiors, preserving length and every
 * newline so offsets and line numbers still map 1:1 onto the original source.
 *
 * Quotes and backticks themselves are KEPT so call shapes survive; the `${...}` holes of
 * a template literal are left as live code so brace balance stays correct.
 *
 * Regex literals are NOT detected (that needs a real parser). A regex containing a quote
 * or an unbalanced brace can therefore confuse the scan; that surfaces as `parseError`,
 * which the caller turns into BLOCKED — never into a silent PASS.
 */
export function stripSource(src) {
  const n = src.length;
  const buf = src.split('');
  const comments = [];
  const strings = [];
  const lineStarts = [0];
  for (let k = 0; k < n; k++) if (src[k] === '\n') lineStarts.push(k + 1);
  const lineOf = (off) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= off) lo = m; else hi = m - 1; }
    return lo + 1;
  };
  const blank = (a, b) => { for (let k = a; k < b; k++) if (buf[k] !== '\n' && buf[k] !== '\r') buf[k] = ' '; };
  const codeBefore = (off) => /\S/.test(src.slice(lineStarts[lineOf(off) - 1], off));

  const DQ = '"';
  const SQ = String.fromCharCode(39);
  const BT = '`';

  const stack = [{ t: 'code', brace: 0, fromTmpl: false }];
  let i = 0;
  let parseError = null;

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const d = src[i + 1];

    if (top.t === 'tmpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && d === '{') {
        blank(top.chunk, i);
        stack.push({ t: 'code', brace: 0, fromTmpl: true });
        i += 2; continue;
      }
      if (c === BT) {
        blank(top.chunk, i);
        strings.push({ start: top.start, end: i, line: lineOf(top.start), quote: BT, value: src.slice(top.start + 1, i) });
        stack.pop(); i++; continue;
      }
      i++; continue;
    }

    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? n : j;
      comments.push({ kind: 'line', start: i, end, line: lineOf(i), text: src.slice(i + 2, end), trailing: codeBefore(i) });
      blank(i, end); i = end; continue;
    }
    if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      if (j < 0) { parseError = 'unterminated block comment at line ' + lineOf(i); blank(i, n); break; }
      const end = j + 2;
      comments.push({ kind: 'block', start: i, end, line: lineOf(i), text: src.slice(i + 2, end - 2), trailing: codeBefore(i) });
      blank(i, end); i = end; continue;
    }
    if (c === DQ || c === SQ) {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c || src[j] === '\n') break;
        j++;
      }
      if (j >= n || src[j] === '\n') { parseError = 'unterminated string at line ' + lineOf(i); break; }
      blank(i + 1, j);
      strings.push({ start: i, end: j, line: lineOf(i), quote: c, value: src.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (c === BT) { stack.push({ t: 'tmpl', start: i, chunk: i + 1 }); i++; continue; }

    if (c === '{') { top.brace++; i++; continue; }
    if (c === '}') {
      if (top.brace === 0 && top.fromTmpl) {
        stack.pop();
        stack[stack.length - 1].chunk = i + 1;
        i++; continue;
      }
      if (top.brace > 0) top.brace--;
      i++; continue;
    }
    i++;
  }

  if (!parseError && stack.length > 1) {
    const open = stack[stack.length - 1];
    parseError = 'unterminated template literal at line ' + lineOf(open.start || 0);
  }

  return { code: buf.join(''), comments, strings, lineStarts, lineOf, parseError };
}

/** Read a file and strip it; null when unreadable. Cached by absolute path. */
export function loadStripped(file, cache) {
  if (cache && cache.has(file)) return cache.get(file);
  const src = read(file);
  const out = src === null ? null : Object.assign(stripSource(src), { src, file });
  if (cache) cache.set(file, out);
  return out;
}

/* ---------------- delimiter balancing ---------------- */

const OPENERS = '({[';
const CLOSERS = ')}]';

/** Index of the delimiter matching the one at `open`, or -1. */
export function matchDelim(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Top-level comma split of the argument list between `open` and `close`. */
export function splitArgs(code, open, close) {
  const out = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (OPENERS.includes(c)) depth++;
    else if (CLOSERS.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push([start, i]); start = i + 1; }
  }
  out.push([start, close]);
  return out.filter(([a, b]) => code.slice(a, b).trim().length);
}

/** Body range of the last function-shaped argument: arrow, concise arrow, or function. */
export function findBodyRange(code, args) {
  for (let i = args.length - 1; i >= 0; i--) {
    const [a, b] = args[i];
    const seg = code.slice(a, b);
    const arrow = seg.indexOf('=>');
    if (arrow >= 0) {
      const after = a + arrow + 2;
      const brace = code.indexOf('{', after);
      if (brace >= 0 && brace < b && !/\S/.test(code.slice(after, brace))) {
        const end = matchDelim(code, brace);
        if (end > 0) return { start: brace + 1, end, braced: true };
      }
      return { start: after, end: b, braced: false };
    }
    if (/^\s*(export\s+)?(async\s+)?function\b/.test(seg)) {
      const p = code.indexOf('(', a);
      const pc = matchDelim(code, p);
      const brace = pc > 0 ? code.indexOf('{', pc) : -1;
      if (brace >= 0 && brace < b) {
        const end = matchDelim(code, brace);
        if (end > 0) return { start: brace + 1, end, braced: true };
      }
    }
  }
  return null;
}

/* ---------------- test / describe blocks ---------------- */

/** Identifiers that behave as `test` or `expect` in this file, including aliases. */
export function testIdentifiers(s) {
  const ids = new Set(['test', 'it']);
  const focusIds = new Set(['fit', 'fdescribe']);
  const expectIds = new Set(['expect']);
  for (const m of s.code.matchAll(/\bimport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const bits = part.split(/\s+as\s+/).map((x) => x.trim());
      const orig = bits[0];
      const local = bits[1] || bits[0];
      if (!orig || !/^[A-Za-z_$][\w$]*$/.test(local)) continue;
      if (orig === 'test' || orig === 'it') ids.add(local);
      if (orig === 'expect') expectIds.add(local);
    }
  }
  for (const m of s.code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:\.\s*extend\b)?/g))
    if (ids.has(m[2])) ids.add(m[1]);
  for (const m of s.code.matchAll(/\b(?:const|let|var)\s*\{[^}]*\btest\s*:\s*([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
  return { ids, focusIds, expectIds };
}

function classifyChain(chain) {
  if (chain.includes('only')) return chain.includes('describe') ? 'describe.only' : 'test.only';
  const last = chain[chain.length - 1];
  if (['skip', 'fixme', 'fail', 'slow'].includes(last)) return chain.includes('describe') ? 'describe.' + last : 'test.' + last;
  if (chain[0] === 'describe') return 'describe';
  if (['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].includes(chain[0])) return 'hook.' + chain[0];
  if (chain[0] === 'step') return 'step';
  if (chain.length === 0) return 'test';
  return 'other';
}

function readTitle(s, span) {
  if (!span) return null;
  const hit = s.strings.find((t) => t.start >= span[0] && t.end <= span[1]);
  return hit ? { text: hit.value, line: hit.line, template: hit.quote === '`' } : null;
}

/**
 * Every `test`/`describe`/hook call in the file, with its title, body range and parent.
 * `parseFail` is set on the returned array when a head could not be balanced.
 */
export function findBlocks(s, ids) {
  const names = [...ids].map((x) => x.replace(/\$/g, '\\$')).join('|');
  const head = new RegExp('(^|[^\\w$.])(' + names + ')((?:\\s*\\??\\.\\s*[A-Za-z_$][\\w$]*)*)\\s*\\(', 'g');
  const blocks = [];
  let parseFail = false;
  for (const m of s.code.matchAll(head)) {
    const headStart = m.index + m[1].length;
    const open = m.index + m[0].length - 1;
    const close = matchDelim(s.code, open);
    if (close < 0) { parseFail = true; continue; }
    const chain = m[3].replace(/[\s?]/g, '').split('.').filter(Boolean);
    const args = splitArgs(s.code, open, close);
    blocks.push({
      ident: m[2], chain, kind: classifyChain(chain),
      headStart, line: s.lineOf(headStart), open, close, args,
      title: readTitle(s, args[0]),
      body: findBodyRange(s.code, args),
    });
  }
  blocks.sort((a, b) => a.headStart - b.headStart);
  for (const b of blocks) {
    let parent = null;
    for (const p of blocks) {
      if (p === b || !p.body) continue;
      if (p.body.start < b.headStart && b.headStart < p.body.end) {
        if (!parent || p.headStart > parent.headStart) parent = p;
      }
    }
    b.parent = parent;
  }
  blocks.parseFail = parseFail;
  return blocks;
}

/** The nearest enclosing block whose kind starts with `prefix`, or null. */
export function ancestorOfKind(block, prefix) {
  for (let p = block.parent; p; p = p.parent) if (p.kind.startsWith(prefix)) return p;
  return null;
}

/* ---------------- imports and member bodies ---------------- */

const EXT_ORDER = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx'];

/** Resolve a RELATIVE specifier to a file on disk; null for bare packages and misses. */
export function resolveModule(fromDir, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(fromDir, spec.replace(/\.js$/, ''));
  if (isFile(base)) return base;
  for (const e of EXT_ORDER) if (isFile(base + e)) return base + e;
  for (const e of EXT_ORDER) if (isFile(path.join(base, 'index' + e))) return path.join(base, 'index' + e);
  return null;
}

/** Imported bindings of a file: Map(localName -> { file|null, spec, bare }). */
export function importMap(s, file) {
  const out = new Map();
  const dir = path.dirname(file);
  for (const m of s.code.matchAll(/\bimport\s+([^;]*?)\s*from\s*(['"`])/g)) {
    const quoteAt = m.index + m[0].length - 1;
    const lit = s.strings.find((t) => t.start === quoteAt);
    if (!lit) continue;
    const spec = lit.value;
    const resolved = resolveModule(dir, spec);
    const clause = m[1];
    const names = [];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) for (const part of braced[1].split(',')) {
      const bits = part.split(/\s+as\s+/).map((x) => x.trim());
      const local = bits[1] || bits[0];
      if (local && /^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
    }
    const dflt = clause.replace(/\{[^}]*\}/, '').replace(/^\s*,|,\s*$/g, '').trim();
    if (dflt && /^[A-Za-z_$][\w$]*$/.test(dflt)) names.push(dflt);
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) names.push(ns[1]);
    for (const nm of names) out.set(nm, { file: resolved, spec, bare: !spec.startsWith('.') });
  }
  return out;
}

const MEMBER_SHAPES = (m) => [
  new RegExp('(^|[\\n;{}])\\s*(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+)*(?:async\\s+)?' + m + '\\s*\\('),
  new RegExp('\\b' + m + '\\s*(?::[^=\\n]+)?=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::[^=\\n]+)?=>\\s*\\{'),
  new RegExp('\\b(?:export\\s+)?(?:async\\s+)?function\\s+' + m + '\\s*\\('),
];

/** Body range of a named method/function in a stripped module, or null. */
export function findMemberBody(mod, name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null;
  for (const re of MEMBER_SHAPES(name)) {
    const m = re.exec(mod.code);
    if (!m) continue;
    const from = m.index;
    const paren = mod.code.indexOf('(', from);
    const arrowBrace = mod.code.indexOf('{', from);
    let brace;
    if (paren >= 0 && (arrowBrace < 0 || paren < arrowBrace)) {
      const pc = matchDelim(mod.code, paren);
      if (pc < 0) continue;
      brace = mod.code.indexOf('{', pc);
    } else brace = arrowBrace;
    if (brace < 0) continue;
    const end = matchDelim(mod.code, brace);
    if (end < 0) continue;
    return { start: brace + 1, end, line: mod.lineOf(brace) };
  }
  return null;
}

/* ---------------- path-shape analysis (NOT control flow) ---------------- */

const BRANCH_WORD = /\b(if|else|for|while|switch|try|catch|finally|do)\b/;

/**
 * Does `at` sit on a straight line within [start, end)? This is a SHAPE check, not
 * control-flow analysis: it answers "no visible branch, callback or earlier
 * return/throw stands between the body start and this offset" and nothing stronger.
 * Whatever it cannot answer "yes" to is routed to semantic review by the caller.
 */
export function isStraightLine(code, start, at) {
  const before = code.slice(start, at);
  if (/\breturn\b|\bthrow\b/.test(before)) return false;
  // Any unclosed nesting at `at` means we are inside a branch, loop or callback body.
  let depth = 0;
  for (let i = start; i < at; i++) {
    const c = code[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
  }
  if (depth !== 0) return false;
  // A ternary or short-circuit guard on the same statement also makes it conditional.
  const stmtStart = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
  const stmt = before.slice(stmtStart + 1);
  if (/\?|&&|\|\|/.test(stmt)) return false;
  if (BRANCH_WORD.test(stmt)) return false;
  return true;
}

/* ---------------- file discovery ---------------- */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.next', 'out']);

export function walk(dir, predicate, depth = 12, acc = []) {
  if (depth < 0 || !isDir(dir)) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, predicate, depth - 1, acc);
    } else if (e.isFile() && predicate(full)) acc.push(full);
  }
  return acc;
}

export const isSpecFile = (p) => /\.(spec|test)\.(ts|tsx|mts|js|mjs|cjs|jsx)$/i.test(p);
export const isCodeFile = (p) => /\.(ts|tsx|mts|js|mjs|cjs|jsx)$/i.test(p);
