#!/usr/bin/env node
// config-inventory.mjs — read-only inventory of Playwright config files and everything that
// still refers to them, and `reconcile` (below): the effective execution settings an existing project runs with,
// reconciled to skill 5's protections. Node >= 18, zero dependencies. Writes only behind `reconcile --apply`.
//
// WHY: skill 5 keeps ONE shared playwright.config.ts. Before an extra config (a per-story
// playwright.us-{id}.config.ts, a playwright.ci.config.ts, …) may be merged and removed, every
// reference to it — package.json scripts, CI files, docs, other configs, code — must be
// rewritten, and its settings must be reproducible in the shared file. This script lists the
// configs, the references and the settings that block a merge; the skill decides, and deletes a
// merged config ONLY when a re-run shows zero remaining references. Deletion is never done here.
//
// Payload: { configs[], shared, sharedSource, ambiguous[], rejected[], verdict: none | single | multiple, deletable[], errors[] }.
// The walk never enters a skill installation (.claude/skills/** and its fixtures), dependency or generated folders, and
// `shared` comes from project-env.mjs resolveSharedConfig (explicit → manifest → automation root → package script →
// project root; ambiguity reported, never resolved by picking one). Always exits 0 (the result lives in the payload).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { walkProject, resolveSharedConfig, automationRootOf, readManifest, skillDirsOf } from './project-env.mjs';

/* ---------------- argv + output (copied verbatim from scan-lib.mjs — never imported across skills) ---------------- */

function parseArgs(argv) {
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

function print(obj, args) {
  process.stdout.write(JSON.stringify(obj, null, args.pretty ? 2 : 0) + '\n');
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const posix = (p) => String(p).replace(/\\/g, '/');
const rel = (root, p) => posix(path.relative(root, p)) || posix(path.basename(p));
const str = (v) => (typeof v === 'string' ? v : null);

export const SCHEMA_VERSION = 1;

const CONFIG_RE = /^playwright.*\.config\.(ts|js|mjs|cjs)$/i;
const DEFAULT_RE = /^playwright\.config\.(ts|js|mjs|cjs)$/i;
const CI_RE = /^(azure-pipelines.*\.ya?ml|\.gitlab-ci\.ya?ml|Jenkinsfile|Dockerfile.*|docker-compose.*\.ya?ml|bitbucket-pipelines\.ya?ml|\.travis\.ya?ml|\.circleci)$/i;
const CODE_RE = /\.(ts|tsx|mts|js|mjs|cjs|jsx)$/i;

// Settings that a shared config cannot reproduce as a projects[] entry or an env-driven `use`
// value without a human decision. Their presence marks the config `blocked` (keep + report).
const BLOCKING = [
  ['globalSetup', /\bglobalSetup\s*:/],
  ['globalTeardown', /\bglobalTeardown\s*:/],
  ['webServer', /\bwebServer\s*:/],
  ['testDir', /\btestDir\s*:/],
  ['custom reporter with options', /\[\s*['"`]\.{1,2}\/[^'"`]+['"`]\s*,\s*\{/],
  ['storageState', /\bstorageState\s*:/],
  ['snapshotDir / snapshotPathTemplate', /\bsnapshot(Dir|PathTemplate)\s*:/],
];
// Settings that merge as a projects[] entry or a documented `use` override — reported for review.
const REVIEW = [
  ['projects', /\bprojects\s*:/],
  ['use', /\buse\s*:/],
  ['reporter', /\breporter\s*:/],
  ['timeout / expect.timeout', /\b(timeout|expect)\s*:/],
  ['workers / fullyParallel / retries', /\b(workers|fullyParallel|retries)\s*:/],
  ['testMatch / testIgnore', /\btest(Match|Ignore)\s*:/],
];

// the project's own files only: dependency / generated folders and skill installations (the skill's fixtures) are skipped
function walk(dir, depth, acc, root = dir) {
  if (!isDir(dir)) return acc;
  acc.push(...walkProject(dir, { depth, extra: skillDirsOf(root) }));
  return acc;
}

function classifyReferenceFile(root, file) {
  const r = rel(root, file);
  const base = path.basename(file);
  if (base === 'package.json') return 'package-script';
  if (/^\.github\/workflows\/.*\.ya?ml$/i.test(r) || CI_RE.test(base) || /^\.circleci\//.test(r)) return 'ci';
  if (/\.(md|markdown|txt|rst)$/i.test(base)) return 'docs';
  if (CONFIG_RE.test(base)) return 'config';
  if (CODE_RE.test(base)) return 'code';
  if (/\.(ya?ml|json|toml|ini|env|sh|ps1|cmd|bat)$/i.test(base)) return 'script-or-settings';
  return null;
}

export function inventory({ root, automationRoot = null, config = null }) {
  const errors = [];
  const manifest = readManifest(root);
  const autoRel = automationRootOf(root, automationRoot, manifest);
  const autoDir = path.resolve(root, autoRel);
  const all = walk(root, 6, [], root);
  const configFiles = all.filter((f) => CONFIG_RE.test(path.basename(f)));
  const refCandidates = all.filter((f) => classifyReferenceFile(root, f) !== null);
  const resolved = resolveSharedConfig({ root, automationRoot: autoRel, explicit: config, manifest });
  const sharedAbs = resolved.shared ? path.resolve(root, resolved.shared) : null;
  // a shared config outside the walked depth (or found through a package script) still belongs in the list
  if (sharedAbs && !configFiles.some((f) => path.resolve(f) === sharedAbs)) configFiles.push(sharedAbs);

  const configs = configFiles.map((abs) => {
    const relFile = rel(root, abs);
    const base = path.basename(abs);
    const stem = base.replace(/\.(ts|js|mjs|cjs)$/i, '');
    const isShared = sharedAbs !== null && path.resolve(abs) === sharedAbs;
    const isDefault = DEFAULT_RE.test(base) || isShared;
    const src = read(abs);
    if (src === null) errors.push({ file: relFile, reason: 'could not be read' });
    const text = src || '';
    const blocking = [];
    const review = [];
    const lines = text.split(/\r?\n/);
    // blocking / review settings matter for merge CANDIDATES only — the shared file may set anything
    if (!isDefault) for (let i = 0; i < lines.length; i++) {
      for (const [setting, re] of BLOCKING) if (re.test(lines[i])) blocking.push({ setting, line: i + 1, text: lines[i].trim().slice(0, 160) });
      for (const [setting, re] of REVIEW) if (re.test(lines[i])) review.push({ setting, line: i + 1, text: lines[i].trim().slice(0, 160) });
    }
    const imports = [...text.matchAll(/\b(?:import|require)\b[^'"`;]*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    const extendsBase = imports.some((s) => /playwright\.config/.test(s) || /^\.\/playwright\.config$/.test(s));
    return {
      file: relFile, dir: posix(path.relative(root, path.dirname(abs))) || '.', basename: base, stem,
      isDefault, isShared, inAutomationRoot: path.dirname(abs) === autoDir,
      sha256: null, bytes: text.length,
      extendsSharedConfig: extendsBase,
      blocking, review,
      references: [],
    };
  });

  // reference scan — conservative: a mention inside a comment or a Markdown code fence counts,
  // because a human reading it would still follow it.
  for (const cfg of configs) {
    const needle = new RegExp('(^|[^A-Za-z0-9_])' + cfg.stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.(ts|js|mjs|cjs))?(?![A-Za-z0-9_])');
    for (const f of refCandidates) {
      if (path.resolve(f) === path.resolve(root, cfg.file)) continue;
      const kind = classifyReferenceFile(root, f);
      const text = read(f);
      if (text === null) continue;
      if (kind === 'package-script') {
        let pkg = null;
        try { pkg = JSON.parse(text); } catch { errors.push({ file: rel(root, f), reason: 'package.json does not parse — scanned as text' }); }
        if (pkg && pkg.scripts) {
          for (const [name, cmd] of Object.entries(pkg.scripts)) if (needle.test(String(cmd))) cfg.references.push({ file: rel(root, f), kind, line: null, script: name, text: String(cmd).slice(0, 160) });
          continue;
        }
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!needle.test(lines[i])) continue;
        const isComment = /^\s*(#|\/\/|\*|<!--)/.test(lines[i]);
        cfg.references.push({ file: rel(root, f), kind, line: i + 1, text: lines[i].trim().slice(0, 160), ...(isComment ? { inComment: true } : {}) });
      }
    }
    // a config that only refers to itself by the default name (import base) is not a reference to the default; another
    // default-named file that is NOT the resolved shared one stays a candidate — never silently treated as shared
    cfg.mergeable = cfg.isShared ? 'shared' : resolved.ambiguous.includes(cfg.file) ? 'ambiguous' : cfg.isDefault ? 'not-shared' : cfg.blocking.length ? 'blocked' : 'candidate';
  }

  const shared = configs.filter((c) => c.isDefault);
  const deletable = configs
    .filter((c) => !c.isDefault && !c.isShared && c.mergeable === 'candidate' && c.references.length === 0)
    .map((c) => c.file);
  const verdict = configs.length === 0 ? 'none' : configs.length === 1 && (configs[0].isShared || configs[0].isDefault) ? 'single' : 'multiple';
  return {
    tool: 'config-inventory',
    schemaVersion: SCHEMA_VERSION,
    readOnly: true,
    root,
    automationRoot: rel(root, autoDir),
    generatedOn: new Date().toISOString(),
    verdict,
    shared: resolved.shared,
    sharedSource: resolved.source,
    ambiguous: resolved.ambiguous,
    rejected: resolved.rejected,
    ...(resolved.error ? { sharedError: resolved.error } : {}),
    sharedCount: shared.length,
    configs,
    deletable,
    counts: {
      configs: configs.length,
      candidates: configs.filter((c) => c.mergeable === 'candidate').length,
      blocked: configs.filter((c) => c.mergeable === 'blocked').length,
      referencesScanned: refCandidates.length,
    },
    rules: {
      shared: 'the shared configuration is resolved in this order: explicit (--config) → qa-manifest framework.configFile → the automation root\'s playwright.config.* → the --config of a `playwright test` package script → the project root\'s playwright.config.*; several equal candidates are `ambiguous` (decided by a human, never by order); skill installations, fixtures and generated folders are never searched; every other playwright*.config.* is a merge candidate',
      blocked: 'a candidate that sets ' + BLOCKING.map((b) => b[0]).join(', ') + ' is kept and reported under "Configurations not merged" unless a human reproduces that setting in the shared file',
      deletable: 'a candidate may be deleted only when this inventory, re-run AFTER every reference was rewritten, lists it under deletable[] — a reference in a comment or a docs code fence still counts',
    },
    errors,
  };
}

/* ---------------- reconcile: the EFFECTIVE execution settings, and targeted fixes (only behind --apply) ----------------
   The protections every skill-5 run relies on: finite action / navigation / test budgets, active stall protection
   (timeouts.ts stall + diagnostics keys), the always-installed helpers, no retries, local runs visible, never a personal /
   persistent browser profile. Each setting is reported with its value, its SOURCE and a precise status:
     ok · unbounded-operation (an action / navigation / test budget of 0 or unset → Playwright waits forever)
     · no-suite-timeout (no globalTimeout: informational — run-stage.mjs sets PW_GLOBAL_TIMEOUT per command)
     · above-target (a single operation > 60 s, silence + grace > 115 s, step.default > 60 s)
     · exception-approved (above target WITH a named `operations` entry, an `// exception: <reason>` comment on that line,
       or a run-file timeouts.adjusted[] record {key, reason, evidence})
     · protection-disabled (retries > 0, a forced local headless, a missing helper / timeouts key, QA_LEDGER=off, a
       personal / persistent browser profile)
     · unresolved (the effective value cannot be established statically — an expression, a config package this step
       cannot read, an ambiguous shared config: nothing is inserted and the protection is NOT reported active)
     · outdated (a helper older than its template that cannot be proven an untouched template copy: kept, reported).
   The effective configuration is the shared config PLUS the configs it imports (relative imports of modules that define
   configuration, followed transitively — a base / preset config spread or passed to defineConfig); project-level `use`
   overrides are judged one by one. A setting found in a base is judged — and edited — in the file that holds it.
   --apply changes ONLY these supported shapes, idempotently, after copying every original to
   {results_root}/artifacts/reconcile/{stamp}/ (+ summary.md, before → after): missing timeouts.ts keys added from the
   template; a literal `actionTimeout` / `navigationTimeout: 0` → TIMEOUTS.action / .navigation and a missing one added to
   the shared config's TOP-LEVEL `use: {` (brace depth 1 of the config object — never a project's `use`; both only when that
   file imports TIMEOUTS and no unreadable config package could set the value); `retries: N` → 0; a literal `headless: true`
   → the PW_HEADLESS-driven value; an absent helper installed from its template, and an OUTDATED helper replaced only when
   its recorded template hash (`// @link-qc-5-template {name} {version} sha256=…`) still matches its content or its content
   equals the current template — a customised or unknown copy is never replaced. Everything else — an unfamiliar shape, a
   .env line, an environment variable, a persistent profile — is a conflict[] with file:line and the reason, never
   overwritten, and its protection is reported NOT active. An explicit worker maximum (config.json machineMaxWorkers,
   qa-manifest execution.maxWorkers, a `workers:` in the config) is never touched. */

export const TARGETS = Object.freeze({ singleOperationMs: 60000, silencePlusGraceMs: 115000, stepDefaultMs: 60000 });
const PLAYWRIGHT_DEFAULTS = { action: 0, navigation: 0, expect: 5000, test: 30000, globalTimeout: 0 };
// the always-installed helpers (code-craft §9, §11; 3.0 §16-19) and what a current copy must contain (capability probes —
// used only to tell "older" from "current" for a copy WITHOUT a template marker; they never authorise a replacement)
export const HELPER_PROBES = Object.freeze({
  steps: [/\bmeaningful\b/, /\bdeadline_ms\b/, /\bregisterPage\b/],
  'progress-reporter': [/['"]test-start['"]/, /\brepeat\s*:/],
  admission: [/\bworkerAdmission\b/, /\bAdmissionRefusedError\b/],
  'network-guard': [/\battachNetworkGuard\b/, /\brecordApiResponse\b/],
  'rate-limit': [/\brateLimitSlot\b/, /\breserveStartSlots\b/, /\bRateLimitCancelledError\b/],
  record: [/\breportRecord\b/, /\bcaptureRecord\b/],
  redact: [/BEGIN redact-core/],
  'data-ledger': [/\bappendLedger\b/, /\bownedKeys\b/],
  'api-record': [/\battachApiRecord\b/, /\bRedirectRefusedError\b/],
  'db-record': [/\battachDbRecord\b/, /\bCascadeScopeError\b/],
});
const HELPERS = ['steps', 'progress-reporter', 'admission', 'network-guard', 'rate-limit'];
const HELPERS_BACKEND = ['record', 'redact', 'data-ledger', 'api-record', 'db-record'];
const TIMEOUT_KEYS = ['stall', 'diagnostics', 'admission', 'rate_limit'];
const here = path.dirname(fileURLToPath(import.meta.url));

function stripComments(t) { return String(t || '').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1'); }

/** Comments and string contents → spaces, newlines kept: the SAME length and line numbers as the original. */
export function maskCode(text) {
  const s = String(text || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') { out += '  '; i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; } if (i < s.length) { out += '  '; i += 2; } continue; }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < s.length && s[i] !== c) { if (s[i] === '\\' && i + 1 < s.length) { out += '  '; i += 2; continue; } out += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < s.length) { out += c; i++; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function matchClose(m, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [];
  for (let i = open; i < m.length; i++) {
    const c = m[i];
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === '}' || c === ')' || c === ']') { if (stack.pop() !== c) return -1; if (!stack.length) return i; }
  }
  return -1;
}

/** The `{` of the config OBJECT: the last object argument of defineConfig(…), else `export default {` / `module.exports = {`. */
export function configObjectStart(text) {
  const m = maskCode(text);
  const dc = /\bdefineConfig\s*\(/.exec(m);
  if (dc) {
    const open = dc.index + dc[0].length - 1;
    const close = matchClose(m, open);
    if (close < 0) return -1;
    let last = -1;
    let depth = 0;
    for (let i = open + 1; i < close; i++) {
      const c = m[i];
      if (c === '{' && depth === 0) { last = i; const e = matchClose(m, i); if (e < 0) return -1; i = e; continue; }
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
    }
    return last;
  }
  const ex = /\bexport\s+default\s*\{|\bmodule\.exports\s*=\s*\{/.exec(m);
  return ex ? ex.index + ex[0].length - 1 : -1;
}

/** Index of the `{` of the TOP-LEVEL `use: {` of the config object (brace depth 1), or -1. Never a project's `use`. */
export function topLevelUseIndex(text) {
  const m = maskCode(text);
  const start = configObjectStart(text);
  if (start < 0) return -1;
  const end = matchClose(m, start);
  if (end < 0) return -1;
  let depth = 0;
  for (let i = start + 1; i < end; i++) {
    const c = m[i];
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; continue; }
    if (depth === 0 && /[A-Za-z_$]/.test(c) && !/[\w$]/.test(m[i - 1] || '')) {
      const k = /^use\s*:\s*\{/.exec(m.slice(i, i + 40));
      if (k) return i + k[0].length - 1;
    }
  }
  return -1;
}

function resolveRelModule(fromDir, spec) {
  const base = path.resolve(fromDir, spec);
  for (const c of [base, ...['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'].map((x) => base + x), ...['index.ts', 'index.js'].map((x) => path.join(base, x))]) if (isFile(c)) return c;
  return null;
}
const DEFINES_CONFIG = /\bdefineConfig\s*\(|\buse\s*:\s*\{|\bprojects\s*:\s*\[|\b(actionTimeout|navigationTimeout|retries|headless)\s*:/;

/** The shared config and every config module it imports (transitively); `external[]` = config packages not readable here. */
export function configChain(sharedAbs) {
  const files = [];
  const external = [];
  const unreadable = [];
  const seen = new Set();
  const visit = (abs) => {
    if (seen.has(path.resolve(abs)) || files.length >= 10) return;
    seen.add(path.resolve(abs));
    const text = read(abs);
    if (text === null) { unreadable.push(abs); return; }
    const masked = maskCode(text);
    files.push({ file: abs, text, masked });
    const code = stripComments(text);
    for (const im of code.matchAll(/\bimport\s+[^;'"`]*?\bfrom\s*['"`]([^'"`]+)['"`]|\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) {
      const spec = im[1] || im[2];
      if (/^(@playwright\/test|playwright\/test|playwright|node:|dotenv)/.test(spec)) continue;
      if (spec.startsWith('.')) {
        const target = resolveRelModule(path.dirname(abs), spec);
        if (!target) { unreadable.push(path.resolve(path.dirname(abs), spec)); continue; }
        if (DEFINES_CONFIG.test(stripComments(read(target) || ''))) visit(target);
      } else if (/config|preset|playwright/i.test(spec)) external.push(spec);
    }
  };
  if (sharedAbs) visit(sharedAbs);
  return { files, external: [...new Set(external)], unreadable };
}

/** TIMEOUTS = { … } → { 'test.default': 90000, 'stall.silence': 55000, … } (comments ignored). */
export function timeoutValues(text) {
  const out = {};
  const src = stripComments(text);
  const start = src.search(/TIMEOUTS\s*=\s*\{/);
  if (start < 0) return out;
  const body = src.slice(src.indexOf('{', start) + 1);
  const stack = [];
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(\{|[\d_]+(?:\.\d+)?)|(\})/g)) {
    if (m[3]) { if (!stack.length) break; stack.pop(); continue; }
    if (m[2] === '{') { stack.push(m[1]); continue; }
    out[[...stack, m[1]].join('.')] = Number(m[2].replace(/_/g, ''));
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const resolveExpr = (expr, values) => {
  const e = String(expr).trim().replace(/[,;]$/, '');
  if (/^Infinity$/.test(e)) return Infinity;
  if (/^[\d_]+(\.\d+)?$/.test(e)) return Number(e.replace(/_/g, ''));
  const m = e.match(/^TIMEOUTS\.([\w.$]+)$/);
  return m && m[1] in values ? values[m[1]] : null;
};

/* ---------------- helper templates: marker, body hash, versions ---------------- */

export const TEMPLATE_MARKER_RE = /^\/\/\s*@link-qc-5-template\s+([\w.-]+)\s+(\d+\.\d+\.\d+)(?:\s+sha256=([0-9a-f]{64}))?\s*$/m;
const lf = (t) => String(t || '').replace(/\r\n?/g, '\n');
/** The marker of a helper / template (searched in its first 15 lines), or null. */
export function templateMarker(text) {
  const head = lf(text).split('\n').slice(0, 15).join('\n');
  const m = TEMPLATE_MARKER_RE.exec(head);
  return m ? { name: m[1], version: m[2], sha256: m[3] || null, line: m[0] } : null;
}
/** The content a template hash covers: the text with its marker line removed, LF line ends. */
export function templateBody(text) {
  const t = lf(text);
  const mk = templateMarker(t);
  return mk ? t.replace(mk.line + '\n', '').replace(mk.line, '') : t;
}
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const semverLt = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
/** The installed form of a template: its marker stamped with the hash of its body. */
export function stampedTemplate(text) {
  const t = lf(text);
  const mk = templateMarker(t);
  if (!mk) return t;
  return t.replace(mk.line, '// @link-qc-5-template ' + mk.name + ' ' + mk.version + ' sha256=' + sha(templateBody(t)));
}
/**
 * What reconcile may do with one helper: { state: absent | current | outdated-safe | outdated-customised | outdated-unknown
 * | unverified, why, missing[] }. Only `absent` and `outdated-safe` are ever written.
 */
export function helperState(projectText, templateText, name) {
  const tm = templateMarker(templateText);
  const tBody = templateBody(templateText);
  if (projectText === null || projectText === undefined) return { state: 'absent', why: 'missing' };
  const body = templateBody(projectText);
  const pm = templateMarker(projectText);
  if (lf(body) === tBody) return { state: 'current', why: 'identical to the current template' };
  const probes = HELPER_PROBES[name] || [];
  const missing = probes.filter((re) => !re.test(projectText)).map((re) => re.source);
  if (pm && pm.sha256) {
    const untouched = sha(body) === pm.sha256;
    const older = tm ? semverLt(pm.version, tm.version) || (pm.version === tm.version && pm.sha256 !== sha(tBody)) : false;
    if (!older) return { state: 'current', why: 'template ' + pm.version + (untouched ? '' : ', locally modified') };
    return untouched ? { state: 'outdated-safe', why: 'an untouched copy of template ' + pm.version + ' (its recorded hash matches) — the template is ' + (tm ? tm.version : '?'), missing }
      : { state: 'outdated-customised', why: 'template ' + pm.version + ' modified after install (its content no longer matches the recorded hash) — never replaced', missing };
  }
  if (missing.length) return { state: 'outdated-unknown', why: 'older than the template (missing: ' + missing.join(', ') + ') and not a known template version — never replaced automatically', missing };
  return { state: 'unverified', why: 'no template marker; every capability probe present — kept as is', missing };
}

export function reconcile({ root, automationRoot = null, resultsRoot = null, runFile = null, apply = false, config = null, assetsDir = path.join(here, '..', 'assets'), env = process.env, now = new Date() } = {}) {
  const autoRel = automationRootOf(root, automationRoot);
  const autoDir = path.resolve(root, autoRel);
  const settings = [];
  const conflicts = [];
  const plan = [];          // { file, kind, find?, replace?, key?, text?, content?, why }
  const set = (key, value, source, status, file = null, line = null, note = null) => settings.push({ key, value, source, status, ...(file ? { file: rel(root, file) } : {}), ...(line ? { line } : {}), ...(note ? { note } : {}) });
  const conflict = (file, line, reason) => conflicts.push({ file: file ? rel(root, file) : null, line, reason });
  const inv = inventory({ root, automationRoot: autoRel, config });
  const sharedAbs = inv.shared ? path.resolve(root, inv.shared) : null;
  const chain = configChain(sharedAbs);
  const sharedEntry = chain.files[0] || null;
  const tFile = ['timeouts.ts', 'timeouts.js', 'timeouts.mjs'].map((n) => path.join(autoDir, n)).find(isFile) || null;
  const tText = tFile ? read(tFile) || '' : '';
  const values = timeoutValues(tText);
  const importsTimeouts = (e) => /\bimport\s*\{[^}]*\bTIMEOUTS\b[^}]*\}\s*from\s*['"`][^'"`]*timeouts['"`]/.test(stripComments(e.text));
  let runJson = null;
  if (runFile) { try { runJson = JSON.parse(read(path.resolve(root, runFile)) || 'null'); } catch { runJson = null; } }
  // approved exceptions: run-file timeouts.adjusted[] {key, reason, evidence}
  const approved = new Set(((runJson && runJson.timeouts && runJson.timeouts.adjusted) || []).filter((a) => a && a.key && a.reason && a.evidence).map((a) => String(a.key).replace(/^TIMEOUTS\./, '')));
  const exceptionOnLine = (key) => { const lines = tText.split(/\r?\n/); const leaf = key.split('.').pop(); return lines.some((l) => new RegExp('\\b' + leaf + '\\s*:').test(l) && /\/\/\s*exception:\s*\S/.test(l)); };
  const judged = (key, v, limit) => (v > limit ? (approved.has(key) || exceptionOnLine(key) ? 'exception-approved' : 'above-target') : 'ok');
  // every occurrence of `key:` in the chain, with its file, its line and its expression (comments / strings masked)
  const hitsOf = (key) => chain.files.flatMap((e) => [...e.masked.matchAll(new RegExp('\\b' + key + '\\s*:\\s*([^,\\n}]+)', 'g'))].map((h) => ({ entry: e, expr: e.text.slice(h.index + h[0].length - h[1].length, h.index + h[0].length), index: h.index, line: lineOf(e.masked, h.index) })));

  if (!sharedAbs) {
    if (inv.ambiguous && inv.ambiguous.length) {
      conflict(null, null, 'the shared Playwright config is ambiguous (' + inv.ambiguous.join(', ') + ') — name it (task input / --config, or qa-manifest framework.configFile); no config setting was reconciled');
      set('shared config', 'ambiguous', 'discovery', 'unresolved', null, null, inv.ambiguous.join(', '));
    } else conflict(null, null, (inv.sharedError || 'no shared playwright.config.*') + ' — skill 5 creates it from the template only when the project has no Playwright config at all (code-craft §8); nothing reconciled');
  } else if (!sharedEntry) {
    conflict(sharedAbs, null, 'the shared config could not be read — no config setting was reconciled');
    set('shared config', 'unreadable', 'discovery', 'unresolved', sharedAbs);
  } else {
    for (const u of chain.unreadable) conflict(u, null, 'an import of the shared config could not be read — settings it may hold are unresolved');
    const externalNote = chain.external.length ? 'the config imports ' + chain.external.join(', ') + ', which this step cannot read' : null;
    // per-operation budgets (every occurrence: top-level `use`, project overrides, base configs)
    for (const [key, label] of [['actionTimeout', 'action'], ['navigationTimeout', 'navigation']]) {
      const hits = hitsOf(key);
      if (!hits.length) {
        if (externalNote) { set(key, 'unresolved', 'external config', 'unresolved', sharedAbs, null, externalNote + ' — it may set ' + key); conflict(sharedAbs, null, key + ' is not set in the readable configuration and ' + externalNote + ' — confirm the effective value by hand (nothing inserted)'); continue; }
        set(key, PLAYWRIGHT_DEFAULTS[label], 'playwright-default', 'unbounded-operation', sharedAbs, null, 'not set — Playwright waits without limit');
        if (importsTimeouts(sharedEntry) && topLevelUseIndex(sharedEntry.text) >= 0) plan.push({ file: sharedAbs, kind: 'insert-use', key, text: key + ': TIMEOUTS.' + label + ',', why: key + ' missing → TIMEOUTS.' + label });
        else conflict(sharedAbs, null, key + ' is not set and the shared config ' + (importsTimeouts(sharedEntry) ? 'has no top-level `use: {` block' : 'does not import TIMEOUTS from timeouts.ts') + ' — add `' + key + ': TIMEOUTS.' + label + '` to its top-level use by hand');
        continue;
      }
      for (const h of hits) {
        const v = resolveExpr(h.expr, values);
        const f = h.entry.file;
        if (v === 0 || v === Infinity) {
          set(key, h.expr.trim(), 'config', 'unbounded-operation', f, h.line);
          if (importsTimeouts(h.entry) && /^\s*(0|Infinity)\s*$/.test(h.expr)) plan.push({ file: f, kind: 'replace-line', line: h.line, find: new RegExp('\\b' + key + '\\s*:\\s*(0|Infinity)\\b'), replace: key + ': TIMEOUTS.' + label, why: key + ' ' + h.expr.trim() + ' → TIMEOUTS.' + label });
          else conflict(f, h.line, key + ' resolves to no limit (' + h.expr.trim() + ') in a shape this step does not rewrite' + (importsTimeouts(h.entry) ? '' : ' (this file does not import TIMEOUTS)'));
        } else if (v === null) { set(key, h.expr.trim(), 'config', 'unresolved', f, h.line, 'expression not resolved statically'); conflict(f, h.line, key + ' is the expression `' + h.expr.trim() + '` — its effective value cannot be established here; confirm it is finite by hand'); }
        else set(key, v, /TIMEOUTS\./.test(h.expr) ? 'timeouts.ts' : 'config', judged(label, v, TARGETS.singleOperationMs), f, h.line);
      }
    }
    // the test budget: the config object's own `timeout` (shared first, then its base configs)
    const testHits = hitsOf('timeout').filter((h) => { const before = h.entry.masked.slice(Math.max(0, h.index - 30), h.index); return !/expect\s*:\s*\{\s*$/.test(before); });
    if (!testHits.length) set('timeout', PLAYWRIGHT_DEFAULTS.test, externalNote ? 'unknown' : 'playwright-default', externalNote ? 'unresolved' : 'ok', sharedAbs, null, externalNote || null);
    else for (const h of testHits.slice(0, 3)) {
      const v = resolveExpr(h.expr, values);
      set('timeout', v ?? h.expr.trim(), /TIMEOUTS\./.test(h.expr) ? 'timeouts.ts' : 'config', v === 0 ? 'unbounded-operation' : v === null ? 'unresolved' : 'ok', h.entry.file, h.line, v === null ? 'expression not resolved statically' : null);
      if (v === 0) conflict(h.entry.file, h.line, 'the test budget is 0 (no limit) — set timeout: TIMEOUTS.test.default');
    }
    const gt = hitsOf('globalTimeout')[0] || null;
    set('globalTimeout', gt ? gt.expr.trim() : 'unset', gt ? 'config' : 'playwright-default', gt && /PW_GLOBAL_TIMEOUT/.test(gt.expr) ? 'ok' : 'no-suite-timeout', gt ? gt.entry.file : sharedAbs, gt ? gt.line : null, 'informational — run-stage.mjs bounds every command (PW_GLOBAL_TIMEOUT + its outer ceiling)');
    const rts = hitsOf('retries');
    if (!rts.length) set('retries', 0, externalNote ? 'unknown' : 'playwright-default', externalNote ? 'unresolved' : 'ok', sharedAbs, null, externalNote || null);
    for (const rt of rts) {
      if (/^\s*[1-9]\d*\s*$/.test(rt.expr)) { set('retries', Number(rt.expr), 'config', 'protection-disabled', rt.entry.file, rt.line, 'retries hide failures'); plan.push({ file: rt.entry.file, kind: 'replace-line', line: rt.line, find: /\bretries\s*:\s*[1-9]\d*/, replace: 'retries: 0', why: 'retries ' + rt.expr.trim() + ' → 0' }); }
      else if (!/^\s*0\s*$/.test(rt.expr)) { set('retries', rt.expr.trim(), 'config', 'protection-disabled', rt.entry.file, rt.line); conflict(rt.entry.file, rt.line, 'retries is an expression (' + rt.expr.trim() + ') — skill 5 runs with retries: 0'); }
      else set('retries', 0, 'config', 'ok', rt.entry.file, rt.line);
    }
    for (const e of chain.files) for (const h of e.masked.matchAll(/\bheadless\s*:\s*true\b/g)) {
      const line = lineOf(e.masked, h.index);
      set('headless', true, 'config', 'protection-disabled', e.file, line, 'forced headless — local runs must be visible (CI / no-desktop use PW_HEADLESS)');
      plan.push({ file: e.file, kind: 'replace-line', line, find: /\bheadless\s*:\s*true\b/, replace: "headless: process.env.PW_HEADLESS === '1' || process.env.PW_HEADLESS === 'true'", why: 'headless: true → PW_HEADLESS-driven' });
    }
  }
  // persistent / personal browser profiles anywhere in the automation code — never rewritten here
  for (const f of walk(autoDir, 4, [], root).filter((x) => CODE_RE.test(x))) {
    const t = stripComments(read(f) || '');
    for (const m of t.matchAll(/\b(launchPersistentContext|userDataDir)\b/g)) { const line = lineOf(t, m.index); set('browser profile', m[1], 'code', 'protection-disabled', f, line, 'a persistent / personal profile — every worker must own a temporary browser'); conflict(f, line, m[1] + ': a persistent / personal browser profile is never used by skill 5 runs — replace it with the fixture browser'); }
  }
  // .env files that force headless or switch the coordination off — reported, never edited (they hold secrets)
  for (const f of [path.join(autoDir, '.env'), path.join(autoDir, '.env.local'), path.join(root, '.env')].filter(isFile)) {
    (read(f) || '').split(/\r?\n/).forEach((l, i) => {
      if (/^\s*PW_HEADLESS\s*=\s*(1|true)\b/i.test(l)) { set('PW_HEADLESS', l.split('=')[1].trim(), 'env-file', 'protection-disabled', f, i + 1); conflict(f, i + 1, 'PW_HEADLESS forced in an env file — remove that line for visible local runs (this step never edits env files)'); }
      if (/^\s*QA_LEDGER\s*=\s*off\b/i.test(l)) { set('QA_LEDGER', 'off', 'env-file', 'protection-disabled', f, i + 1); conflict(f, i + 1, 'QA_LEDGER=off in an env file — the run would be exclusive and serial; remove the line'); }
    });
  }
  if (String(env.QA_LEDGER || '').trim() === 'off') { set('QA_LEDGER', 'off', 'environment', 'protection-disabled', null, null, 'exclusive, serial execution'); conflict(null, null, 'QA_LEDGER=off is set in the environment — unset it (user setting; this step never changes it)'); }
  // timeouts.ts: the keys the active stall protection reads, and the targets
  if (!tFile) conflict(null, null, 'no timeouts.ts in the automation root — skill 5 copies the template (code-craft §9)');
  else {
    const has = (k) => new RegExp('\\b' + k + '\\s*:').test(stripComments(tText));
    for (const k of TIMEOUT_KEYS) if (!has(k)) { set('TIMEOUTS.' + k, 'missing', 'template-default', 'protection-disabled', tFile, null, 'the helpers fall back to the template default'); plan.push({ file: tFile, kind: 'add-key', key: k, why: 'TIMEOUTS.' + k + ' added from the template' }); }
    for (const k of ['action', 'navigation', 'expect']) if (k in values) set('TIMEOUTS.' + k, values[k], 'timeouts.ts', values[k] === 0 ? 'unbounded-operation' : judged(k, values[k], TARGETS.singleOperationMs), tFile);
    if ('step.default' in values) set('TIMEOUTS.step.default', values['step.default'], 'timeouts.ts', judged('step.default', values['step.default'], TARGETS.stepDefaultMs), tFile);
    const silence = values['stall.silence'] ?? null;
    const grace = values.watchdog_grace ?? 60000;
    if (silence !== null) set('TIMEOUTS.stall.silence + watchdog_grace', silence + grace, 'timeouts.ts', judged('stall.silence', silence + grace, TARGETS.silencePlusGraceMs), tFile);
    for (const [k, v] of Object.entries(values)) if (k.startsWith('operations.')) set('TIMEOUTS.' + k, v, 'timeouts.ts', 'exception-approved', tFile, null, 'a named operation exception');
  }
  // the always-installed helpers: absent → installed; outdated → replaced ONLY when proven an untouched template copy
  const layers = Object.values((runJson && runJson.run_plan && runJson.run_plan.layers) || {});
  const backend = layers.some((l) => l && l !== 'ui');
  for (const h of [...HELPERS, ...(backend ? HELPERS_BACKEND : [])]) {
    const existing = ['ts', 'js', 'mts'].map((x) => path.join(autoDir, 'helpers', h + '.' + x)).find(isFile) || null;
    const src = path.join(assetsDir, h + '.template.ts');
    const tText2 = read(src);
    if (tText2 === null) { if (!existing) conflict(null, null, 'helpers/' + h + ' is missing and its template was not found (' + posix(src) + ')'); continue; }
    const st = helperState(existing ? read(existing) : null, tText2, h);
    const target = existing || path.join(autoDir, 'helpers', h + '.ts');
    if (st.state === 'absent') { set('helpers/' + h, 'missing', 'project', 'protection-disabled', null, null, 'installed from the template'); plan.push({ file: target, kind: 'copy', content: stampedTemplate(tText2), why: 'helpers/' + h + '.ts installed from the template' }); }
    else if (st.state === 'outdated-safe') { set('helpers/' + h, 'outdated', 'project', 'protection-disabled', target, null, st.why); plan.push({ file: target, kind: 'replace-helper', content: stampedTemplate(tText2), why: 'helpers/' + h + ' upgraded to the current template (' + st.why + ')' }); }
    else if (st.state === 'outdated-customised' || st.state === 'outdated-unknown') { set('helpers/' + h, 'outdated', 'project', 'outdated', target, null, st.why); conflict(target, null, 'helpers/' + h + ': ' + st.why + ' — compare it with assets/' + h + '.template.ts and merge by hand'); }
    else set('helpers/' + h, st.state, 'project', 'ok', target, null, st.why);
  }

  // --apply: back up, then change only the planned shapes (each idempotent: re-checked against the current text)
  const changes = [];
  let backup = null;
  if (apply && plan.length) {
    if (!resultsRoot) return result('BLOCKED', '--apply needs --results-root (the backup goes to {results_root}/artifacts/reconcile/)');
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    backup = path.join(path.resolve(root, resultsRoot), 'artifacts', 'reconcile', stamp);
    const before = new Map();
    for (const p of plan) {
      if (before.has(p.file)) continue;
      before.set(p.file, isFile(p.file) ? read(p.file) : null);
      if (isFile(p.file)) { const to = path.join(backup, rel(root, p.file)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(p.file, to); }
    }
    const tmpl = read(path.join(assetsDir, 'timeouts.template.ts')) || '';
    // line replacements first (their recorded line numbers are the original file's), insertions after
    const ORDER = { 'replace-line': 0, 'insert-use': 1, 'add-key': 2, copy: 3, 'replace-helper': 3 };
    for (const p of [...plan].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
      let text = isFile(p.file) ? read(p.file) : null;
      if (p.kind === 'copy') { if (text !== null) continue; fs.mkdirSync(path.dirname(p.file), { recursive: true }); fs.writeFileSync(p.file, p.content); changes.push({ file: rel(root, p.file), change: p.why }); continue; }
      if (text === null) continue;
      let next = text;
      if (p.kind === 'replace-helper') {
        // re-checked now: the file must still be the untouched copy the plan judged (never a customised one)
        const st = helperState(text, read(path.join(assetsDir, path.basename(p.file).replace(/\.(m?ts|js)$/, '') + '.template.ts')) || '', path.basename(p.file).replace(/\.(m?ts|js)$/, ''));
        if (st.state !== 'outdated-safe') continue;
        next = p.content;
      } else if (p.kind === 'replace-line') {
        const lines = text.split('\n');
        const i = p.line - 1;
        if (lines[i] !== undefined && p.find.test(lines[i])) { lines[i] = lines[i].replace(p.find, p.replace); next = lines.join('\n'); }
      } else if (p.kind === 'insert-use') {
        if (new RegExp('\\b' + p.key + '\\s*:').test(maskCode(text))) continue;
        const at = topLevelUseIndex(text);
        if (at < 0) { conflict(p.file, null, p.key + ' could not be inserted: no top-level `use: {` found at apply time — add it by hand'); continue; }
        next = text.slice(0, at + 1) + '\n    ' + p.text + text.slice(at + 1);
      } else if (p.kind === 'add-key') {
        if (new RegExp('\\b' + p.key + '\\s*:').test(stripComments(text))) continue;
        const block = templateBlock(tmpl, p.key);
        const close = text.lastIndexOf('} as const');
        if (!block || close < 0) { conflict(p.file, null, 'TIMEOUTS.' + p.key + ' could not be added (no `} as const` closing the TIMEOUTS object) — add it from the template by hand'); continue; }
        next = text.slice(0, close) + block + '\n' + text.slice(close);
      }
      if (next !== text) { fs.writeFileSync(p.file, next); changes.push({ file: rel(root, p.file), change: p.why }); }
    }
    const lines = ['# Reconcile ' + now.toISOString(), '', 'Originals: this folder (same relative paths). Restore a file by copying it back.', '', '| File | Change |', '|---|---|',
      ...changes.map((c) => '| ' + c.file + ' | ' + c.change + ' |'), '', '## Not changed (conflicts — protection NOT active until resolved)', '',
      ...(conflicts.length ? conflicts.map((c) => '- ' + (c.file ? c.file + (c.line ? ':' + c.line : '') + ' — ' : '') + c.reason) : ['- none'])];
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'summary.md'), lines.join('\n') + '\n');
  }
  const pending = settings.filter((s) => ['protection-disabled', 'unbounded-operation', 'above-target', 'unresolved', 'outdated'].includes(s.status));
  return result(apply ? (conflicts.length ? 'PARTIAL' : 'APPLIED') : pending.length ? 'CHANGES_NEEDED' : 'OK', null);

  function result(outcome, reason) {
    return {
      tool: 'config-inventory', command: 'reconcile', schemaVersion: SCHEMA_VERSION, readOnly: !apply || !changes.length, outcome, reason,
      root: posix(root), automationRoot: rel(root, autoDir), shared: inv.shared, sharedSource: inv.sharedSource || null, ambiguous: inv.ambiguous || [],
      chain: chain.files.map((e) => rel(root, e.file)), externalConfigs: chain.external, timeoutsFile: tFile ? rel(root, tFile) : null,
      settings, planned: plan.map((p) => ({ file: rel(root, p.file), change: p.why })), changes, conflicts,
      blocking: settings.filter((s) => s.status === 'protection-disabled' || s.status === 'unbounded-operation' || s.status === 'above-target').map((s) => s.key + (s.file ? ' (' + s.file + (s.line ? ':' + s.line : '') + ')' : '') + ': ' + s.status),
      // not proven either way — a semantic scope review closes them (check.mjs tool:protections → unresolved), never a PASS
      unresolved: settings.filter((s) => s.status === 'unresolved' || s.status === 'outdated').map((s) => s.key + (s.file ? ' (' + s.file + (s.line ? ':' + s.line : '') + ')' : '') + ': ' + s.status + (s.note ? ' — ' + s.note : '')),
      // what the run must refresh after a change: the readiness payload and the Checkpoint A snapshot are stale
      refresh: changes.length ? ['parallel-plan.mjs --out (readiness)', 'check.mjs checkpoint --checkpoint A (a new snapshot)'] : [],
      backup: backup ? rel(root, backup) : null, targets: TARGETS,
    };
  }
}

// one top-level key of the template's TIMEOUTS object with its leading doc comment, indented as in the template
function templateBlock(tmpl, key) {
  const lines = tmpl.split('\n');
  const at = lines.findIndex((l) => new RegExp('^  ' + key + '\\s*:').test(l));
  if (at < 0) return null;
  let start = at;
  while (start > 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[start - 1])) start--;
  let end = at;
  if (/\{\s*$/.test(lines[at])) { let depth = 0; for (let i = at; i < lines.length; i++) { depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length; if (depth <= 0) { end = i; break; } } }
  return lines.slice(start, end + 1).join('\n');
}

const HELP = {
  tool: 'config-inventory',
  usage: 'node config-inventory.mjs [--root <project>] [--automation-root <dir>] [--config <shared config>] [--pretty]  ·  node config-inventory.mjs reconcile --root <project> [--automation-root <dir>] [--config <shared config>] [--results-root <dir>] [--run-file <.runs/phase-N.json>] [--apply] [--pretty]',
  notes: [
    'Inventory: read-only. Always exits 0; the result lives in the JSON payload.',
    'Lists every playwright*.config.* of the PROJECT under the root (6 levels; dependency / generated folders and skill installations — .claude, .agents, … and their fixtures — never searched), the references to each (package.json scripts, CI files, docs, other configs, code — comments and code fences included) and the settings that block a merge. --automation-root defaults to qa-manifest paths.automationRoot. `shared` is resolved explicit → manifest framework.configFile → automation root → package-script --config → project root; several equal candidates → ambiguous[] (shared null), never the first one.',
    'deletable[] = merge candidates with zero remaining references; the skill deletes nothing until a re-run after rewriting the references lists the file there.',
    'reconcile: the EFFECTIVE execution settings of the shared config and the config modules it imports (value, source, status ok · unbounded-operation · no-suite-timeout · above-target · exception-approved · protection-disabled · unresolved · outdated). Dry-run by default; --apply (needs --results-root) backs every original up to artifacts/reconcile/{stamp}/ with summary.md and changes only the supported shapes; an outdated helper is replaced only when its recorded template hash proves it untouched; anything else is a conflict[] (file:line, reason), never overwritten, and an unresolved setting is never filled in. outcome OK · CHANGES_NEEDED (dry-run) · APPLIED · PARTIAL (conflicts left) · BLOCKED; refresh[] names what must be re-run after a change.',
  ],
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const root = path.resolve(str(args.root) || process.cwd());
  const automationRoot = automationRootOf(root, str(args['automation-root']));
  const config = str(args.config);
  if (args._[0] === 'reconcile') { print(reconcile({ root, automationRoot, config, resultsRoot: str(args['results-root']), runFile: str(args['run-file']), apply: !!args.apply }), args); return 0; }
  print(inventory({ root, automationRoot, config }), args);
  return 0;
}

// the CLI entry: a realpath comparison — a URL string built from argv[1] misses an 8.3 short path (C:\\Users\\NAME~1\\…), a
// symlink or another drive-letter case and the script then exited 0 having done nothing
if ((() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })()) {
  try { process.exit(main()); }
  catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'config-inventory', schemaVersion: SCHEMA_VERSION, readOnly: true, verdict: 'none', configs: [], deletable: [], errors: [{ file: null, reason: 'internal error: ' + e.message }] }, args);
    process.exit(0);
  }
}
