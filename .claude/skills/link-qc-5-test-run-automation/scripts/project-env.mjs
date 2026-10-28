#!/usr/bin/env node
// project-env.mjs — where the consumer project's OWN Playwright, TypeScript, ESLint and shared Playwright config live
// (skill 5). Node >= 18, ESM, zero dependencies, read-only. Imported by run-stage.mjs, check.mjs, scratch.mjs,
// config-inventory.mjs and parallel-plan.mjs; never by skill 5b (scan-lib.mjs — the 5 / 5b mirror — stays untouched).
//
// Contract (references/schemas/paths-and-evidence.md):
//   - project walks never enter dependency / generated folders or a skill installation (.claude, .agents, .codex,
//     .cursor, .windsurf, .github/skills, the manifest's paths.skillsDir, any folder holding a SKILL.md) — the skill's own
//     test fixtures (scripts/fixtures/**/playwright.config.ts) are never "the project's config";
//   - a package is resolved the way Node resolves it from the automation root (hoisting, workspaces, symlinked
//     installs), then by an upward node_modules walk — never by assuming {cwd}/node_modules;
//   - the shared config follows ONE supported order: explicit path → qa-manifest framework.configFile → the automation
//     root's playwright.config.* → the --config / -c of a `playwright test` package script → the project root's
//     playwright.config.*; several equal candidates are reported `ambiguous`, never resolved by picking the first.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'skill5-project-env/1';

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const posix = (p) => String(p).replace(/\\/g, '/');
const rel = (root, p) => posix(path.relative(root, p)) || '.';

/* ---------------- what a project walk never enters ---------------- */

// dependency and generated output
export const GENERATED_DIRS = Object.freeze(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', 'blob-report',
  '.next', 'out', '.turbo', '.cache', '.playwright-cli', '.remember', 'screenshots', 'automation-logs', 'reports']);
// agent / skill installation roots — a synced skill ships its own fixtures and examples
export const SKILL_ROOTS = Object.freeze(['.claude', '.agents', '.codex', '.cursor', '.windsurf', '.continue', '.aider']);
const FIXTURE_DIRS = new Set(['fixtures', '__fixtures__', 'examples', 'example', '__snapshots__']);

/**
 * Is this directory outside the project's own code for discovery purposes? `extra` = more absolute paths to skip (the
 * manifest's paths.skillsDir). A folder holding SKILL.md, and fixtures / examples below a skill or a `scripts` folder, are
 * excluded too.
 */
export function isExcludedDir(absDir, { extra = [] } = {}) {
  const name = path.basename(absDir);
  if (GENERATED_DIRS.includes(name) || SKILL_ROOTS.includes(name)) return true;
  const p = posix(path.resolve(absDir)).toLowerCase();
  if (/\/\.github\/skills(\/|$)/.test(p)) return true;
  for (const x of extra) { const e = posix(path.resolve(x)).toLowerCase(); if (p === e || p.startsWith(e + '/')) return true; }
  if (isFile(path.join(absDir, 'SKILL.md'))) return true;
  if (FIXTURE_DIRS.has(name.toLowerCase()) && underSkill(absDir)) return true;
  return false;
}
// a fixtures / examples folder belongs to a skill when one of its nearest ancestors holds a SKILL.md
function underSkill(absDir) {
  let d = path.dirname(path.resolve(absDir));
  for (let i = 0; i < 5; i++) {
    if (isFile(path.join(d, 'SKILL.md'))) return true;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return false;
}

/** Every file under `root` (depth-limited) outside the excluded folders, sorted for a stable order. */
export function walkProject(root, { depth = 6, extra = [] } = {}) {
  const out = [];
  const walk = (dir, d) => {
    if (d < 0) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!isExcludedDir(full, { extra })) walk(full, d - 1); }
      else if (e.isFile()) out.push(full);
    }
  };
  walk(path.resolve(root), depth);
  return out;
}

/* ---------------- the manifest ---------------- */

export function readManifest(root) { return readJson(path.join(path.resolve(root), 'Testing', 'qa-manifest.json')); }
/** The automation root: explicit → manifest paths.automationRoot → Testing/Automation. */
export function automationRootOf(root, explicit = null, manifest = undefined) {
  if (typeof explicit === 'string' && explicit) return explicit;
  const m = manifest === undefined ? readManifest(root) : manifest;
  return (m && m.paths && typeof m.paths.automationRoot === 'string' && m.paths.automationRoot) || 'Testing/Automation';
}
export function skillDirsOf(root, manifest = undefined) {
  const m = manifest === undefined ? readManifest(root) : manifest;
  const d = m && m.paths && typeof m.paths.skillsDir === 'string' ? m.paths.skillsDir : null;
  return d ? [path.resolve(root, d)] : [];
}

/* ---------------- packages, binaries and the Playwright CLI ---------------- */

/**
 * Resolve an installed package from `startDir` the way Node would (hoisted / workspace / symlinked installs), then by an
 * upward node_modules walk. → { dir, version, pkgJson, via, tried[] } | { dir: null, tried[] }.
 */
export function resolvePackage(startDir, pkg) {
  const start = path.resolve(startDir);
  const tried = [];
  try {
    const req = createRequire(path.join(start, '__link_qc_resolve__.js'));
    const pj = req.resolve(pkg + '/package.json');
    const data = readJson(pj);
    if (data) return { dir: path.dirname(pj), version: data.version || null, pkgJson: data, via: 'node-resolution', tried };
  } catch (e) { tried.push('node resolution from ' + posix(start) + ': ' + (e && e.code ? e.code : 'not found')); }
  for (let dir = start; ; dir = path.dirname(dir)) {
    const pj = path.join(dir, 'node_modules', ...pkg.split('/'), 'package.json');
    tried.push(posix(pj));
    if (isFile(pj)) { const data = readJson(pj); return { dir: path.dirname(pj), version: (data && data.version) || null, pkgJson: data, via: 'node_modules walk', tried }; }
    if (path.dirname(dir) === dir) break;
  }
  return { dir: null, version: null, pkgJson: null, via: null, tried };
}

/** The file a package's bin entry (or `fallbackRel`) names, resolved from `startDir`. */
export function resolveBin(startDir, pkg, fallbackRel, { binName = null } = {}) {
  const r = resolvePackage(startDir, pkg);
  if (!r.dir) {
    // a package folder without a readable package.json (a partial or vendored install): the binary itself, upward
    for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
      const f = path.join(dir, 'node_modules', ...pkg.split('/'), ...String(fallbackRel).split('/'));
      if (isFile(f)) return { file: f, package: pkg, version: null, via: 'node_modules walk (binary)', tried: r.tried };
      if (path.dirname(dir) === dir) break;
    }
    return { file: null, package: pkg, version: null, tried: r.tried };
  }
  const bin = r.pkgJson && r.pkgJson.bin;
  const fromBin = typeof bin === 'string' ? bin : bin && typeof bin === 'object' ? (bin[binName || ''] || Object.values(bin)[0]) : null;
  for (const relPath of [fallbackRel, fromBin].filter(Boolean)) {
    const f = path.join(r.dir, relPath);
    if (isFile(f)) return { file: f, package: pkg, version: r.version, via: r.via, tried: r.tried };
    r.tried.push(posix(f));
  }
  return { file: null, package: pkg, version: r.version, tried: r.tried };
}

/**
 * The consumer project's Playwright test CLI. `explicit` (--cli) is resolved against `cwd`, then `root`; a missing explicit
 * path is an error of its own, never silently replaced. Otherwise @playwright/test, then playwright, from `cwd`.
 * → { cli, package, version, source, tried[], error? }
 */
export function resolvePlaywrightCli(cwd, explicit = null, { root = null } = {}) {
  if (typeof explicit === 'string' && explicit) {
    const cands = [path.resolve(cwd, explicit), ...(root ? [path.resolve(root, explicit)] : [])];
    const hit = cands.find(isFile);
    if (hit) return { cli: hit, package: null, version: null, source: 'explicit --cli', tried: cands.map(posix) };
    return { cli: null, package: null, version: null, source: 'explicit --cli', tried: cands.map(posix), error: 'the --cli path does not exist (' + cands.map(posix).join(' · ') + ')' };
  }
  const tried = [];
  for (const pkg of ['@playwright/test', 'playwright']) {
    const b = resolveBin(cwd, pkg, 'cli.js', { binName: 'playwright' });
    tried.push(...b.tried);
    if (b.file) return { cli: b.file, package: pkg, version: b.version, source: b.via, tried };
  }
  return { cli: null, package: null, version: null, source: null, tried, error: 'the project\'s Playwright test CLI was not found from ' + posix(path.resolve(cwd)) + ' (Node resolution and every node_modules up to the drive root) — install @playwright/test in the automation project or pass --cli <path to its cli.js>' };
}

/* ---------------- the shared Playwright config ---------------- */

export const CONFIG_NAMES = Object.freeze(['playwright.config.ts', 'playwright.config.mts', 'playwright.config.cts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']);

/** Does this text look like a Playwright test configuration (not a fixture module, not a test)? */
export function looksLikeConfig(text) {
  const t = String(text || '');
  const imports = /\bfrom\s*['"](@playwright\/test|playwright\/test)['"]|\brequire\s*\(\s*['"](@playwright\/test|playwright\/test)['"]\s*\)/.test(t);
  const shape = /\bdefineConfig\s*\(|\bexport\s+default\s*\{|\bmodule\.exports\s*=|\bexport\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/m.test(t);
  const isTest = /\btest\s*\(\s*['"`]/.test(t) && !/\bdefineConfig\s*\(/.test(t);
  const isFixture = /\.extend\s*</.test(t) && !/\bdefineConfig\s*\(/.test(t);
  return imports && shape && !isTest && !isFixture;
}

const CONFIG_ARG_RE = /(?:--config(?:=|\s+)|(?:^|\s)-c\s+)(['"]?)([^\s'"]+)\1/;
function packageScriptConfigs(pkgDir, root, extra) {
  const data = readJson(path.join(pkgDir, 'package.json'));
  const out = [];
  if (!data || !data.scripts) return out;
  for (const [name, cmd] of Object.entries(data.scripts)) {
    const s = String(cmd);
    if (!/\bplaywright\s+test\b/.test(s)) continue;
    const m = s.match(CONFIG_ARG_RE);
    if (!m) continue;
    const abs = path.resolve(pkgDir, m[2]);
    if (excludedPath(abs, root, extra)) continue;
    out.push({ file: abs, script: name, pkg: path.join(pkgDir, 'package.json') });
  }
  return out;
}
/** Is `abs` inside an excluded folder between it and the project root? (The root itself is never judged.) */
export function excludedPath(abs, root, extra = []) {
  const R = path.resolve(root);
  for (let d = path.dirname(path.resolve(abs)); ; d = path.dirname(d)) {
    if (d === R || path.dirname(d) === d) return false;
    if (isExcludedDir(d, { extra })) return true;
  }
}

/**
 * The ONE shared Playwright config, by the supported order. Never picks a fixture, never moves a file.
 * → { shared (root-relative), source, ambiguous[], rejected[{file, reason}], tried[] }
 */
export function resolveSharedConfig({ root, automationRoot = null, explicit = null, manifest = undefined } = {}) {
  const R = path.resolve(root);
  const m = manifest === undefined ? readManifest(R) : manifest;
  const ar = path.resolve(R, automationRootOf(R, automationRoot, m));
  const extra = skillDirsOf(R, m);
  const tried = [];
  const rejected = [];
  const accept = (abs) => {
    tried.push(rel(R, abs));
    if (!isFile(abs)) return false;
    if (excludedPath(abs, R, extra)) { rejected.push({ file: rel(R, abs), reason: 'inside a skill installation, a fixture / example folder or generated output' }); return false; }
    if (!looksLikeConfig(read(abs))) { rejected.push({ file: rel(R, abs), reason: 'does not import @playwright/test and export a config (defineConfig / export default)' }); return false; }
    return true;
  };
  const done = (abs, source) => ({ shared: rel(R, abs), source, automationRoot: rel(R, ar), ambiguous: [], rejected, tried });
  const ambiguous = (list, source) => ({ shared: null, source, automationRoot: rel(R, ar), ambiguous: list.map((x) => rel(R, x)), rejected, tried });
  // 1. explicit
  if (typeof explicit === 'string' && explicit) {
    const cands = [path.resolve(R, explicit), path.resolve(ar, explicit)];
    const hit = cands.find((c) => accept(c));
    return hit ? done(hit, 'explicit') : { shared: null, source: 'explicit', automationRoot: rel(R, ar), ambiguous: [], rejected, tried, error: 'the explicit config ' + explicit + ' was not found or is not a Playwright config' };
  }
  // 2. the manifest's framework.configFile (relative to the automation root, else the project root)
  const mf = m && m.framework && typeof m.framework.configFile === 'string' ? m.framework.configFile : null;
  if (mf) { const hit = [path.resolve(ar, mf), path.resolve(R, mf)].find((c) => accept(c)); if (hit) return done(hit, 'qa-manifest framework.configFile'); }
  // 3. the automation root's own playwright.config.*
  const inAr = CONFIG_NAMES.map((n) => path.join(ar, n)).filter((c) => accept(c));
  if (inAr.length === 1) return done(inAr[0], 'automation root');
  if (inAr.length > 1) return ambiguous(inAr, 'automation root');
  // 4. --config / -c of a `playwright test` package script (automation root, then project root)
  for (const dir of [ar, R]) {
    const hits = [...new Map(packageScriptConfigs(dir, R, extra).filter((x) => accept(x.file)).map((x) => [path.resolve(x.file), x])).values()];
    if (hits.length === 1) return done(hits[0].file, 'package script "' + hits[0].script + '" (' + rel(R, hits[0].pkg) + ')');
    if (hits.length > 1) return ambiguous(hits.map((h) => h.file), 'package scripts of ' + rel(R, path.join(dir, 'package.json')));
  }
  // 5. the project root's playwright.config.*
  const atRoot = path.resolve(R) === ar ? [] : CONFIG_NAMES.map((n) => path.join(R, n)).filter((c) => accept(c));
  if (atRoot.length === 1) return done(atRoot[0], 'project root');
  if (atRoot.length > 1) return ambiguous(atRoot, 'project root');
  return { shared: null, source: null, automationRoot: rel(R, ar), ambiguous: [], rejected, tried };
}

/* ---------------- CLI: a read-only diagnostic (the same answers the runner uses) ---------------- */

function main() {
  const args = process.argv.slice(2);
  const val = (k) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
  const root = path.resolve(val('root') || process.cwd());
  const m = readManifest(root);
  const ar = automationRootOf(root, val('automation-root'), m);
  const cwd = path.resolve(root, ar);
  const cfg = resolveSharedConfig({ root, automationRoot: ar, explicit: val('config'), manifest: m });
  const cli = resolvePlaywrightCli(cwd, val('cli'), { root });
  const ts = resolveBin(cwd, 'typescript', 'bin/tsc', { binName: 'tsc' });
  const out = { tool: 'project-env', schema: SCHEMA, root: posix(root), automationRoot: posix(ar),
    config: { shared: cfg.shared, source: cfg.source, ambiguous: cfg.ambiguous, rejected: cfg.rejected.slice(0, 10), error: cfg.error || undefined },
    playwright: { cli: cli.cli ? posix(cli.cli) : null, package: cli.package, version: cli.version, source: cli.source, error: cli.error || undefined },
    typescript: { tsc: ts.file ? posix(ts.file) : null, version: ts.version } };
  process.stdout.write(JSON.stringify(out, null, args.includes('--pretty') ? 2 : 0) + '\n');
}
const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) { try { main(); } catch (e) { process.stdout.write(JSON.stringify({ tool: 'project-env', schema: SCHEMA, error: 'internal error: ' + e.message }) + '\n'); } }
void isDir;
