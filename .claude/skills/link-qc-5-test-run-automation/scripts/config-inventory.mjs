#!/usr/bin/env node
// config-inventory.mjs — read-only inventory of Playwright config files and everything that
// still refers to them. Node >= 18, zero dependencies. Never writes anything.
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

const HELP = {
  tool: 'config-inventory',
  usage: 'node config-inventory.mjs [--root <project>] [--automation-root <dir>] [--pretty]',
  notes: [
    'Read-only. Always exits 0; the result lives in the JSON payload.',
    'Lists every playwright*.config.* under the root (6 levels, generated folders skipped), the references to each (package.json scripts, CI files, docs, other configs, code — comments and code fences included) and the settings that block a merge.',
    'deletable[] = merge candidates with zero remaining references; the skill deletes nothing until a re-run after rewriting the references lists the file there.',
  ],
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const root = path.resolve(str(args.root) || process.cwd());
  print(inventory({ root, automationRoot: str(args['automation-root']) || 'Testing/Automation' }), args);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url === new URL(`file://${path.resolve(process.argv[1] || '')}`).href) {
  try { process.exit(main()); }
  catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'config-inventory', schemaVersion: SCHEMA_VERSION, readOnly: true, verdict: 'none', configs: [], deletable: [], errors: [{ file: null, reason: 'internal error: ' + e.message }] }, args);
    process.exit(0);
  }
}
