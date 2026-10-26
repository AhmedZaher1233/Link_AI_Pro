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
// Payload: { configs[], shared, verdict: none | single | multiple, deletable[], errors[] }.
// Always exits 0 (the result lives in the payload).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.next', 'out', 'screenshots', 'automation-logs', 'reports']);
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

function walk(dir, depth, acc) {
  if (depth < 0 || !isDir(dir)) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, depth - 1, acc); }
    else if (e.isFile()) acc.push(full);
  }
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

export function inventory({ root, automationRoot }) {
  const errors = [];
  const autoDir = path.resolve(root, automationRoot || 'Testing/Automation');
  const all = walk(root, 6, []);
  const configFiles = all.filter((f) => CONFIG_RE.test(path.basename(f)));
  const refCandidates = all.filter((f) => classifyReferenceFile(root, f) !== null);

  const configs = configFiles.map((abs) => {
    const relFile = rel(root, abs);
    const base = path.basename(abs);
    const stem = base.replace(/\.(ts|js|mjs|cjs)$/i, '');
    const isDefault = DEFAULT_RE.test(base);
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
      isDefault, inAutomationRoot: path.dirname(abs) === autoDir,
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
    // a config that only refers to itself by the default name (import base) is not a reference to the default
    cfg.mergeable = cfg.isDefault ? 'shared' : cfg.blocking.length ? 'blocked' : 'candidate';
  }

  const shared = configs.filter((c) => c.isDefault);
  const sharedInRoot = shared.find((c) => c.inAutomationRoot) || shared[0] || null;
  const deletable = configs
    .filter((c) => !c.isDefault && c.mergeable === 'candidate' && c.references.length === 0)
    .map((c) => c.file);
  const verdict = configs.length === 0 ? 'none' : configs.length === 1 && configs[0].isDefault ? 'single' : 'multiple';
  return {
    tool: 'config-inventory',
    schemaVersion: SCHEMA_VERSION,
    readOnly: true,
    root,
    automationRoot: rel(root, autoDir),
    generatedOn: new Date().toISOString(),
    verdict,
    shared: sharedInRoot ? sharedInRoot.file : null,
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
      shared: 'the playwright.config.* in the automation root is the one shared configuration; every other playwright*.config.* is a merge candidate',
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
       personal / persistent browser profile).
   --apply changes ONLY these supported shapes, idempotently, after copying every original to
   {results_root}/artifacts/reconcile/{stamp}/ (+ summary.md, before → after): missing timeouts.ts keys added from the
   template; a literal `actionTimeout` / `navigationTimeout: 0` → TIMEOUTS.action / .navigation, a missing pair added to
   the top-level `use: {` (both only when the config imports TIMEOUTS); `retries: N` → 0; a literal `headless: true` → the
   PW_HEADLESS-driven value; an absent helper copied from the template. Everything else — an unfamiliar shape, a .env
   line, an environment variable, a persistent profile — is a conflict[] with file:line and the reason, never
   overwritten, and its protection is reported NOT active. An explicit worker maximum (config.json machineMaxWorkers,
   qa-manifest execution.maxWorkers) is never touched. */

export const TARGETS = Object.freeze({ singleOperationMs: 60000, silencePlusGraceMs: 115000, stepDefaultMs: 60000 });
const PLAYWRIGHT_DEFAULTS = { action: 0, navigation: 0, expect: 5000, test: 30000, globalTimeout: 0 };
const HELPERS = ['steps', 'progress-reporter', 'admission', 'network-guard', 'rate-limit'];
const TIMEOUT_KEYS = ['stall', 'diagnostics', 'admission', 'rate_limit'];
const here = path.dirname(fileURLToPath(import.meta.url));

function stripComments(t) { return String(t || '').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1'); }

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

export function reconcile({ root, automationRoot = 'Testing/Automation', resultsRoot = null, runFile = null, apply = false, assetsDir = path.join(here, '..', 'assets'), env = process.env, now = new Date() } = {}) {
  const autoDir = path.resolve(root, automationRoot);
  const settings = [];
  const conflicts = [];
  const plan = [];          // { file, kind, find?, replace?, insertAfter?, text?, copyFrom?, why }
  const set = (key, value, source, status, file = null, line = null, note = null) => settings.push({ key, value, source, status, ...(file ? { file: rel(root, file) } : {}), ...(line ? { line } : {}), ...(note ? { note } : {}) });
  const conflict = (file, line, reason) => conflicts.push({ file: file ? rel(root, file) : null, line, reason });
  const inv = inventory({ root, automationRoot });
  const sharedAbs = inv.shared ? path.resolve(root, inv.shared) : null;
  const cfgText = sharedAbs ? read(sharedAbs) || '' : '';
  const cfg = stripComments(cfgText);
  const tFile = ['timeouts.ts', 'timeouts.js', 'timeouts.mjs'].map((n) => path.join(autoDir, n)).find(isFile) || null;
  const tText = tFile ? read(tFile) || '' : '';
  const values = timeoutValues(tText);
  const importsTimeouts = /\bimport\s*\{[^}]*\bTIMEOUTS\b[^}]*\}\s*from\s*['"`][^'"`]*timeouts['"`]/.test(cfg);
  // approved exceptions: run-file timeouts.adjusted[] {key, reason, evidence}
  let approved = new Set();
  if (runFile) { try { const j = JSON.parse(read(path.resolve(root, runFile)) || 'null'); approved = new Set(((j && j.timeouts && j.timeouts.adjusted) || []).filter((a) => a && a.key && a.reason && a.evidence).map((a) => String(a.key).replace(/^TIMEOUTS\./, ''))); } catch { /* none */ } }
  const exceptionOnLine = (key) => { const lines = tText.split(/\r?\n/); const leaf = key.split('.').pop(); return lines.some((l) => new RegExp('\\b' + leaf + '\\s*:').test(l) && /\/\/\s*exception:\s*\S/.test(l)); };
  const judged = (key, v, limit) => (v > limit ? (approved.has(key) || exceptionOnLine(key) ? 'exception-approved' : 'above-target') : 'ok');

  if (!sharedAbs) conflict(null, null, 'no shared playwright.config.* — skill 5 creates it from the template (code-craft §8); nothing reconciled');
  else {
    // per-operation budgets in the shared config (every occurrence: top-level `use` and every project override)
    for (const [key, label] of [['actionTimeout', 'action'], ['navigationTimeout', 'navigation']]) {
      const hits = [...cfg.matchAll(new RegExp('\\b' + key + '\\s*:\\s*([^,\\n}]+)', 'g'))];
      if (!hits.length) {
        set(key, PLAYWRIGHT_DEFAULTS[label], 'playwright-default', 'unbounded-operation', sharedAbs, null, 'not set — Playwright waits without limit');
        const useAt = [...cfg.matchAll(/\buse\s*:\s*\{/g)];
        if (importsTimeouts && useAt.length >= 1) plan.push({ file: sharedAbs, kind: 'insert-use', key, text: key + ': TIMEOUTS.' + label + ',', why: key + ' missing → TIMEOUTS.' + label });
        else conflict(sharedAbs, null, key + ' is not set and the config ' + (importsTimeouts ? 'has no `use: {` block' : 'does not import TIMEOUTS from timeouts.ts') + ' — add `' + key + ': TIMEOUTS.' + label + '` by hand');
        continue;
      }
      for (const h of hits) {
        const v = resolveExpr(h[1], values);
        const line = lineOf(cfg, h.index);
        if (v === 0 || v === Infinity) {
          set(key, h[1].trim(), 'config', 'unbounded-operation', sharedAbs, line);
          if (importsTimeouts && /^\s*(0|Infinity)\s*$/.test(h[1])) plan.push({ file: sharedAbs, kind: 'replace-line', line, find: new RegExp('\\b' + key + '\\s*:\\s*(0|Infinity)\\b'), replace: key + ': TIMEOUTS.' + label, why: key + ' ' + h[1].trim() + ' → TIMEOUTS.' + label });
          else conflict(sharedAbs, line, key + ' resolves to no limit (' + h[1].trim() + ') in a shape this step does not rewrite');
        } else if (v === null) set(key, h[1].trim(), 'config', 'ok', sharedAbs, line, 'expression not resolved statically');
        else set(key, v, /TIMEOUTS\./.test(h[1]) ? 'timeouts.ts' : 'config', judged(label, v, TARGETS.singleOperationMs), sharedAbs, line);
      }
    }
    const top = (re) => { const m = cfg.match(re); return m ? { expr: m[1], line: lineOf(cfg, m.index) } : null; };
    const testT = top(/(?:^|[\s,{])timeout\s*:\s*([^,\n}]+)/);
    if (!testT) set('timeout', PLAYWRIGHT_DEFAULTS.test, 'playwright-default', 'ok', sharedAbs);
    else { const v = resolveExpr(testT.expr, values); set('timeout', v ?? testT.expr.trim(), /TIMEOUTS\./.test(testT.expr) ? 'timeouts.ts' : 'config', v === 0 ? 'unbounded-operation' : 'ok', sharedAbs, testT.line); if (v === 0) conflict(sharedAbs, testT.line, 'the test budget is 0 (no limit) — set timeout: TIMEOUTS.test.default'); }
    const gt = top(/\bglobalTimeout\s*:\s*([^\n}]+?)\s*,?\s*$/m);
    set('globalTimeout', gt ? gt.expr.trim() : 'unset', gt ? 'config' : 'playwright-default', gt && /PW_GLOBAL_TIMEOUT/.test(gt.expr) ? 'ok' : 'no-suite-timeout', sharedAbs, gt ? gt.line : null, 'informational — run-stage.mjs bounds every command (PW_GLOBAL_TIMEOUT + its outer ceiling)');
    const rt = top(/\bretries\s*:\s*([^,\n}]+)/);
    if (rt && /^\s*[1-9]\d*\s*$/.test(rt.expr)) { set('retries', Number(rt.expr), 'config', 'protection-disabled', sharedAbs, rt.line, 'retries hide failures'); plan.push({ file: sharedAbs, kind: 'replace-line', line: rt.line, find: /\bretries\s*:\s*[1-9]\d*/, replace: 'retries: 0', why: 'retries ' + rt.expr.trim() + ' → 0' }); }
    else if (rt && !/^\s*0\s*$/.test(rt.expr)) { set('retries', rt.expr.trim(), 'config', 'protection-disabled', sharedAbs, rt.line); conflict(sharedAbs, rt.line, 'retries is an expression (' + rt.expr.trim() + ') — skill 5 runs with retries: 0'); }
    else set('retries', 0, rt ? 'config' : 'playwright-default', 'ok', sharedAbs, rt ? rt.line : null);
    for (const h of cfg.matchAll(/\bheadless\s*:\s*true\b/g)) {
      const line = lineOf(cfg, h.index);
      set('headless', true, 'config', 'protection-disabled', sharedAbs, line, 'forced headless — local runs must be visible (CI / no-desktop use PW_HEADLESS)');
      plan.push({ file: sharedAbs, kind: 'replace-line', line, find: /\bheadless\s*:\s*true\b/, replace: "headless: process.env.PW_HEADLESS === '1' || process.env.PW_HEADLESS === 'true'", why: 'headless: true → PW_HEADLESS-driven' });
    }
  }
  // persistent / personal browser profiles anywhere in the automation code — never rewritten here
  for (const f of walk(autoDir, 4, []).filter((x) => CODE_RE.test(x) && !/node_modules|test-results/.test(x))) {
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
  // the always-installed helpers
  for (const h of HELPERS) {
    const present = ['ts', 'js', 'mts'].some((x) => isFile(path.join(autoDir, 'helpers', h + '.' + x)));
    if (present) continue;
    set('helpers/' + h, 'missing', 'project', 'protection-disabled', null, null, 'copied from the template');
    const src = path.join(assetsDir, h + '.template.ts');
    if (isFile(src)) plan.push({ file: path.join(autoDir, 'helpers', h + '.ts'), kind: 'copy', copyFrom: src, why: 'helpers/' + h + '.ts installed from the template' });
    else conflict(null, null, 'helpers/' + h + ' is missing and its template was not found (' + posix(src) + ')');
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
    const ORDER = { 'replace-line': 0, 'insert-use': 1, 'add-key': 2, copy: 3 };
    for (const p of [...plan].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
      let text = isFile(p.file) ? read(p.file) : null;
      if (p.kind === 'copy') { if (text !== null) continue; fs.mkdirSync(path.dirname(p.file), { recursive: true }); fs.copyFileSync(p.copyFrom, p.file); changes.push({ file: rel(root, p.file), change: p.why }); continue; }
      if (text === null) continue;
      let next = text;
      if (p.kind === 'replace-line') {
        const lines = text.split('\n');
        const i = p.line - 1;
        if (lines[i] !== undefined && p.find.test(lines[i])) { lines[i] = lines[i].replace(p.find, p.replace); next = lines.join('\n'); }
      } else if (p.kind === 'insert-use') {
        if (new RegExp('\\b' + p.key + '\\s*:').test(stripComments(text))) continue;
        next = text.replace(/\buse\s*:\s*\{/, (m) => m + '\n    ' + p.text);
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
  const pending = settings.filter((s) => s.status === 'protection-disabled' || s.status === 'unbounded-operation' || s.status === 'above-target');
  return result(apply ? (conflicts.length ? 'PARTIAL' : 'APPLIED') : pending.length ? 'CHANGES_NEEDED' : 'OK', null);

  function result(outcome, reason) {
    return {
      tool: 'config-inventory', command: 'reconcile', schemaVersion: SCHEMA_VERSION, readOnly: !apply || !changes.length, outcome, reason,
      root: posix(root), automationRoot: rel(root, autoDir), shared: inv.shared, timeoutsFile: tFile ? rel(root, tFile) : null,
      settings, planned: plan.map((p) => ({ file: rel(root, p.file), change: p.why })), changes, conflicts,
      blocking: settings.filter((s) => s.status === 'protection-disabled' || s.status === 'unbounded-operation' || s.status === 'above-target').map((s) => s.key + (s.file ? ' (' + s.file + (s.line ? ':' + s.line : '') + ')' : '') + ': ' + s.status),
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
  usage: 'node config-inventory.mjs [--root <project>] [--automation-root <dir>] [--pretty]  ·  node config-inventory.mjs reconcile --root <project> [--automation-root <dir>] [--results-root <dir>] [--run-file <.runs/phase-N.json>] [--apply] [--pretty]',
  notes: [
    'Inventory: read-only. Always exits 0; the result lives in the JSON payload.',
    'Lists every playwright*.config.* under the root (6 levels, generated folders skipped), the references to each (package.json scripts, CI files, docs, other configs, code — comments and code fences included) and the settings that block a merge.',
    'deletable[] = merge candidates with zero remaining references; the skill deletes nothing until a re-run after rewriting the references lists the file there.',
    'reconcile: the EFFECTIVE execution settings (value, source, status ok · unbounded-operation · no-suite-timeout · above-target · exception-approved · protection-disabled). Dry-run by default; --apply (needs --results-root) backs every original up to artifacts/reconcile/{stamp}/ with summary.md and changes only the supported shapes; anything else is a conflict[] (file:line, reason), never overwritten. outcome OK · CHANGES_NEEDED (dry-run) · APPLIED · PARTIAL (conflicts left) · BLOCKED.',
  ],
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const root = path.resolve(str(args.root) || process.cwd());
  const automationRoot = str(args['automation-root']) || 'Testing/Automation';
  if (args._[0] === 'reconcile') { print(reconcile({ root, automationRoot, resultsRoot: str(args['results-root']), runFile: str(args['run-file']), apply: !!args.apply }), args); return 0; }
  print(inventory({ root, automationRoot }), args);
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
