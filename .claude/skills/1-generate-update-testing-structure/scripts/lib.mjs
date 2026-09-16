// Shared read-only scanners for preflight.mjs and validate-setup.mjs.
// Node >= 18, zero dependencies. Nothing in this file writes to disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const SKILLS = [
  '1-generate-update-testing-structure',
  '2-review-requirements',
  '3-generate-manual-test-cases',
  '4-white-box-testing',
  '5-publish-test-cases-azure',
  '6-test-run-automation',
  '7-discover-business-rules',
];
export const SYNC_COMMAND = '.claude/commands/sync-skills.md';
export const SOURCE_REPO = 'https://github.com/AhmedZaher1233/Link_AI_Pro';

export const TESTING_FOLDERS = {
  requirements: 'Testing/Requirements',
  manualTestCases: 'Testing/Manual_Test/TestCases',
  automationRoot: 'Testing/Automation',
  pages: 'Testing/Automation/pages',
  tests: 'Testing/Automation/tests',
  reports: 'Testing/Automation/reports',
  screenshots: 'Testing/Automation/screenshots',
  automationLogs: 'Testing/Automation/automation-logs',
  whiteBox: 'Testing/White_Box_Testing',
};
export const LEGACY_TESTING_NAMES = ['Testing/requirements', 'Testing/automation', 'Testing/white-box-testing', 'testing', 'automation'];

export const STEERING_DIR = 'docs/steering';
export const STEERING_CANONICAL = { L1: 'L1-testing-foundation.md', L2: 'L2-testing-qa-standards.md', L3: 'L3-project-testing.md' };
export const LEARNING_FILE = 'Testing/project-learning.md';
export const LEARNING_SHARED_SECTIONS = ['## Index', '## Project Knowledge', '## Common Flows', '## UI Knowledge', '## Test Data', '## Locale Knowledge', '## Automation Tricks'];
export const LEARNING_MODEL_SECTIONS = [
  '### Setup Model (skill 1)', '### Requirements Review Model (skill 2)', '### Manual TC Model (skill 3)',
  '### White-Box Model (skill 4)', '### Publish Model (skill 5)', '### Automation Model (skill 6)', '### Rule Discovery Model (skill 7)',
];
export const LEARNING_LEGACY_HEADINGS = { '### Automation Model (skill 5)': '### Automation Model (skill 6)' };
export const MCP_REQUIRED = ['playwright', 'azure-devops', 'docx'];
// Docx MCP (docx-mcp-server by SecurityRonin) — replaces the legacy read-only `word` server
// (office-word-mcp-server). The `--with mcp<2` pin is mandatory: the package declares an
// unpinned `mcp` dependency, uv resolves mcp 2.x and the server crashes on import
// (ModuleNotFoundError: No module named 'mcp.server.fastmcp').
export const DOCX_SERVER = 'docx';
export const DOCX_PACKAGE = 'docx-mcp-server';
export const DOCX_MCP_PIN = 'mcp<2';
export const DOCX_ARGS = ['--from', DOCX_PACKAGE, '--with', DOCX_MCP_PIN, DOCX_PACKAGE];
export const LEGACY_WORD_PACKAGE = 'office-word-mcp-server';
export const LEGACY_WORD_ENTRYPOINT = 'word_mcp_server';
export const MANIFEST = 'Testing/qa-manifest.json';

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

export const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
export const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
export const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
export const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
export const nonEmpty = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };

/** Case-exact directory entry lookup (Windows/macOS are case-insensitive on disk). */
export function actualName(parent, wanted) {
  try { return fs.readdirSync(parent).find((e) => e.toLowerCase() === wanted.toLowerCase()) ?? null; } catch { return null; }
}

export function run(cmd, cwd, timeout = 20000) {
  try { return { ok: true, out: execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], timeout, windowsHide: true }).toString().trim() }; }
  catch (e) { return { ok: false, out: (e.stdout?.toString() || e.stderr?.toString() || e.message || '').trim() }; }
}

export function frontMatter(text) {
  if (!text || !text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const fm = {};
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2];
  }
  return fm;
}

/* ---------------- scanners ---------------- */

export function scanGit(root) {
  const isRepo = isDir(path.join(root, '.git')) || run('git rev-parse --is-inside-work-tree', root).ok;
  if (!isRepo) return { isRepo: false };
  const status = run('git status --porcelain', root);
  const remote = run('git remote get-url origin', root);
  return { isRepo: true, dirty: status.ok ? status.out.length > 0 : null, remote: remote.ok ? remote.out : null,
    isCanonicalRepo: remote.ok && /AhmedZaher1233\/Link_AI_Pro(\.git)?$/i.test(remote.out) };
}

export function scanSuite(root) {
  const claude = path.join(root, '.claude');
  const dirName = actualName(claude, 'skills');
  const skillsDir = dirName ? path.join(claude, dirName) : null;
  const present = [], missing = [], invalid = [];
  for (const s of SKILLS) {
    const f = skillsDir ? path.join(skillsDir, s, 'SKILL.md') : null;
    if (f && isFile(f) && nonEmpty(f)) {
      const fm = frontMatter(read(f));
      if (fm && fm.name && fm.description) present.push(s); else invalid.push(s);
    } else missing.push(s);
  }
  return {
    skillsDir: skillsDir ? path.relative(root, skillsDir).replace(/\\/g, '/') : null,
    uppercaseDir: dirName !== null && dirName !== 'skills',
    present, missing, invalid,
    syncCommand: isFile(path.join(root, SYNC_COMMAND)),
    localOnly: skillsDir ? fs.readdirSync(skillsDir).filter((e) => isDir(path.join(skillsDir, e)) && !SKILLS.includes(e)) : [],
  };
}

export function scanTesting(root) {
  const testingName = actualName(root, 'Testing');
  const folders = {};
  for (const [k, rel] of Object.entries(TESTING_FOLDERS)) folders[k] = isDir(path.join(root, rel));
  const legacy = LEGACY_TESTING_NAMES.filter((rel) => {
    const parent = path.join(root, path.dirname(rel)), want = path.basename(rel);
    const actual = actualName(parent, want);
    return actual !== null && actual !== want.replace(/^./, (c) => c.toUpperCase()) && isDir(path.join(parent, actual)) && actual === want;
  });
  const specFiles = globCount(root, /\.(spec|test)\.(ts|js|mjs|cjs)$/, ['node_modules', '.git', 'dist', 'build']);
  const pagesDirs = findDirs(root, 'pages', ['node_modules', '.git', 'dist', 'build']).length;
  return {
    rootExists: testingName !== null && isDir(path.join(root, testingName)),
    rootName: testingName,
    folders,
    allPresent: Object.values(folders).every(Boolean),
    legacyNames: legacy,
    specFileCount: specFiles,
    pageObjectDirs: pagesDirs,
  };
}

export function scanSteering(root) {
  const dir = path.join(root, STEERING_DIR);
  if (!isDir(dir)) return { exists: false, files: [], layers: { L1: null, L2: null, L3: null }, readme: false, nonCanonical: [], duplicates: [] };
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md') && f.toLowerCase() !== 'readme.md').map((name) => {
    const layer = (name.match(/^(L[123])[-_ ]/i) || [])[1]?.toUpperCase() ?? null;
    const canonical = layer ? name === STEERING_CANONICAL[layer] : /^L\d-[a-z0-9-]+\.md$/.test(name);
    return { name, layer, canonical, nonEmpty: nonEmpty(path.join(dir, name)) };
  });
  const layers = { L1: null, L2: null, L3: null }, duplicates = [];
  for (const f of files) if (f.layer) { if (layers[f.layer]) duplicates.push(f.layer); else layers[f.layer] = f.name; }
  return { exists: true, files, layers, readme: isFile(path.join(dir, 'README.md')), nonCanonical: files.filter((f) => !f.canonical).map((f) => f.name), duplicates };
}

export function scanLearning(root) {
  const p = path.join(root, LEARNING_FILE);
  const legacy = path.join(root, '.planning/project-learning.md');
  if (!isFile(p)) return { exists: false, legacyFile: isFile(legacy), missingShared: LEARNING_SHARED_SECTIONS, missingModel: LEARNING_MODEL_SECTIONS, legacyHeadings: [] };
  const text = read(p) || '';
  const has = (h) => new RegExp('^' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm').test(text);
  return {
    exists: true, legacyFile: isFile(legacy),
    missingShared: LEARNING_SHARED_SECTIONS.filter((h) => !has(h)),
    missingModel: LEARNING_MODEL_SECTIONS.filter((h) => !has(h)),
    legacyHeadings: Object.keys(LEARNING_LEGACY_HEADINGS).filter((h) => has(h)),
    lines: text.split(/\r?\n/).length,
  };
}

/**
 * Pure analysis of a parsed .mcp.json — no I/O. Tells which legacy `word` servers exist, whether the
 * `docx` server is present and correctly pinned, and which actions a migration would perform.
 * actions: 'remove:<server>' for every legacy word server, 'add:docx' when missing, 'pin:docx' when
 * present but its args are not exactly DOCX_ARGS.
 */
export function planMcpMigration(json) {
  const servers = (json && json.mcpServers) || {};
  const argsOf = (s) => Array.isArray(s?.args) ? s.args.map(String) : [];
  const isLegacyWord = (s) => argsOf(s).some((a) => a.includes(LEGACY_WORD_PACKAGE) || a === LEGACY_WORD_ENTRYPOINT) || String(s?.command || '').includes(LEGACY_WORD_ENTRYPOINT);
  const isDocx = (s) => argsOf(s).includes(DOCX_PACKAGE);
  const legacyWord = Object.entries(servers).filter(([, s]) => isLegacyWord(s) && !isDocx(s)).map(([n]) => n);
  const docxEntry = servers[DOCX_SERVER] && isDocx(servers[DOCX_SERVER]) ? servers[DOCX_SERVER] : (Object.values(servers).find(isDocx) || null);
  const docxName = docxEntry ? (Object.entries(servers).find(([, s]) => s === docxEntry) || [DOCX_SERVER])[0] : null;
  const docxPresent = Boolean(docxEntry);
  const a = argsOf(docxEntry);
  const docxPinned = docxPresent && a.some((x, i) => x === '--with' && a[i + 1] === DOCX_MCP_PIN);
  const argsCanonical = docxPresent && JSON.stringify(a) === JSON.stringify(DOCX_ARGS);
  const actions = [...legacyWord.map((n) => `remove:${n}`)];
  if (!docxPresent) actions.push(`add:${DOCX_SERVER}`);
  else if (!argsCanonical) actions.push(`pin:${docxName}`);
  return { legacyWord, docxName, docxPresent, docxPinned, argsCanonical, actions };
}

/** Absolute path of the uvx launcher, so MCP launches never depend on PATH. Falls back to 'uvx'. */
export function resolveUvx() {
  const r = process.platform === 'win32' ? run('where.exe uvx') : run('command -v uvx');
  const first = r.ok ? r.out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) : null;
  return first ? { path: first.replace(/\\/g, '/'), found: true } : { path: 'uvx', found: false };
}

export function scanMcp(root) {
  const p = path.join(root, '.mcp.json');
  const emptyDocx = { present: false, pinned: false, legacyWord: [], actions: [] };
  if (!isFile(p)) return { exists: false, valid: false, servers: [], missing: MCP_REQUIRED, inlineSecrets: false, docx: emptyDocx };
  let json = null;
  try { json = JSON.parse(read(p)); } catch { return { exists: true, valid: false, servers: [], missing: MCP_REQUIRED, inlineSecrets: false, docx: emptyDocx }; }
  const servers = Object.keys(json.mcpServers || {});
  const text = read(p);
  const inlineSecrets = /"PERSONAL_ACCESS_TOKEN"\s*:\s*"(?!\$\{)[^"]{8,}"/.test(text) || /:[A-Za-z0-9+/]{40,}={0,2}/.test(text);
  const plan = planMcpMigration(json);
  const docx = { present: plan.docxPresent, pinned: plan.docxPinned, legacyWord: plan.legacyWord, actions: plan.actions };
  const missing = MCP_REQUIRED.filter((s) => (s === DOCX_SERVER ? !plan.docxPresent : !servers.includes(s)));
  return { exists: true, valid: true, servers, missing, inlineSecrets, docx };
}

export function scanToolchain(root) {
  const node = run('node --version', root), npm = run('npm --version', root);
  const pw = run('npx --no-install playwright --version', root, 30000);
  const pkg = isFile(path.join(root, 'package.json'));
  let pkgValid = false, pwDep = false;
  if (pkg) { try { const j = JSON.parse(read(path.join(root, 'package.json'))); pkgValid = true; pwDep = Boolean((j.dependencies || {})['@playwright/test'] || (j.devDependencies || {})['@playwright/test']); } catch {} }
  const cfg = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].map((f) => path.join(root, f)).find(isFile) || null;
  const cfgText = cfg ? read(cfg) || '' : '';
  const grab = (k) => (cfgText.match(new RegExp(k + '\\s*:\\s*[\'"`]([^\'"`]+)[\'"`]')) || [])[1] ?? null;
  const nodeVersionFile = ['.nvmrc', '.node-version'].map((f) => path.join(root, f)).find(isFile) || null;
  return {
    node: node.ok ? node.out : null, npm: npm.ok ? npm.out : null,
    playwright: pw.ok ? pw.out.replace(/^Version\s*/i, '') : null,
    packageJson: pkg, packageJsonValid: pkgValid, playwrightDependency: pwDep,
    playwrightConfig: cfg ? path.relative(root, cfg).replace(/\\/g, '/') : null,
    testDir: grab('testDir'), outputDir: grab('outputDir'),
    testDirExists: grab('testDir') ? isDir(path.resolve(root, grab('testDir'))) : null,
    nodeVersionFile: nodeVersionFile ? path.basename(nodeVersionFile) : null,
  };
}

/** Existence-only check of the PAT variable. Never returns or logs the value. */
export function scanPat(name = 'AZURE_DEVOPS_PAT_B64') {
  const inProcess = Boolean(process.env[name]);
  let persisted = null, scope = null;
  if (process.platform === 'win32') {
    const r = run(`reg query HKCU\\Environment /v ${name}`);
    persisted = r.ok; scope = 'user (HKCU\\Environment)';
  } else {
    const home = os.homedir();
    persisted = ['.zshrc', '.bashrc', '.bash_profile', '.profile'].some((f) => (read(path.join(home, f)) || '').split(/\r?\n/).some((l) => l.startsWith(`export ${name}=`)));
    scope = 'shell profile';
  }
  return { name, inProcess, persisted, scope, setupScript: process.platform === 'win32' ? 'scripts/set-azure-devops-pat.ps1' : 'scripts/set-azure-devops-pat.sh' };
}

export function scanManifest(root) {
  const p = path.join(root, MANIFEST);
  if (!isFile(p)) return { exists: false, valid: false };
  try { const j = JSON.parse(read(p)); return { exists: true, valid: true, schemaVersion: j.schemaVersion ?? null, generatedOn: j.generatedOn ?? null, deviations: (j.deviations || []).length }; }
  catch { return { exists: true, valid: false }; }
}

/* ---------------- helpers ---------------- */

function globCount(root, re, skip, depth = 6) {
  let n = 0;
  const walk = (d, lvl) => {
    if (lvl > depth) return;
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!skip.includes(e.name)) walk(path.join(d, e.name), lvl + 1); }
      else if (re.test(e.name)) n++;
    }
  };
  walk(root, 0);
  return n;
}

function findDirs(root, name, skip, depth = 6) {
  const hits = [];
  const walk = (d, lvl) => {
    if (lvl > depth) return;
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !skip.includes(e.name)) { if (e.name.toLowerCase() === name) hits.push(path.join(d, e.name)); walk(path.join(d, e.name), lvl + 1); }
  };
  walk(root, 0);
  return hits;
}

export function print(obj, args) {
  process.stdout.write(JSON.stringify(obj, null, args.pretty ? 2 : 0) + '\n');
}
