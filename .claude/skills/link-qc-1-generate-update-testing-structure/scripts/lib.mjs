// Shared read-only scanners for preflight.mjs and validate-setup.mjs.
// Node >= 18, zero dependencies. Nothing in this file writes to disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const SKILLS = [
  'link-qc-1-generate-update-testing-structure',
  'link-qc-2-review-requirements',
  'link-qc-3-generate-manual-test-cases',
  'link-qc-3b-validate-manual-test-cases',
  'link-qc-3c-validate-manual-test-cases-cli',
  'link-qc-4-publish-test-cases-azure',
  'link-qc-5-test-run-automation',
  'link-qc-6-ui-testing',
  'link-qc-7-sync-tc-status-to-azure',
  'link-qc-8-sync-bugs-azure',
  'link-qc-9-retesting',
  'link-qc-10-white-box-testing',
  'link-qc-11-discover-business-rules',
  'link-qc-12-adhd-output-style',
];
// Folder names the suite used before the link-qc-N naming (and the folders merged into another skill).
// sync-qa-skills.mjs --apply removes a legacy folder once its replacement is in place; validate-setup.mjs reports it.
export const SKILL_RENAMES = {
  '1-generate-update-testing-structure': 'link-qc-1-generate-update-testing-structure',
  '2-review-requirements': 'link-qc-2-review-requirements',
  '3-generate-manual-test-cases': 'link-qc-3-generate-manual-test-cases',
  '3b-validate-manual-test-cases': 'link-qc-3b-validate-manual-test-cases',
  '3c-validate-manual-test-cases-cli': 'link-qc-3c-validate-manual-test-cases-cli',
  '5-publish-test-cases-azure': 'link-qc-4-publish-test-cases-azure',
  '6-test-run-automation': 'link-qc-5-test-run-automation',
  'qc-ui': 'link-qc-6-ui-testing',
  'link-qc-1-sync-testcase-to-azure': 'link-qc-4-publish-test-cases-azure',
  'link-qc-2-sync-tc-status-to-azure': 'link-qc-7-sync-tc-status-to-azure',
  'link-qc-3-sync-bug-from-md-to-azure': 'link-qc-8-sync-bugs-azure',
  'link-qc-4-sync-bugstatus-azure-to-md': 'link-qc-8-sync-bugs-azure',
  'link-qc-5-sync-bugstatus-md-to-azure': 'link-qc-8-sync-bugs-azure',
  'link-qc-6-retesting': 'link-qc-9-retesting',
  '4-white-box-testing': 'link-qc-10-white-box-testing',
  '7-discover-business-rules': 'link-qc-11-discover-business-rules',
  'i-have-adhd': 'link-qc-12-adhd-output-style',
};
export const SYNC_COMMAND = '.claude/commands/sync-skills.md';

// Clean replace (sync-qa-skills.mjs --apply --replace --yes): delete OUR skill folders and re-download them.
// Pure planning, no I/O. Only folders in SKILLS / SKILL_RENAMES can ever land in `replace` / `remove`;
// every other folder under .claude/skills/ is in `keep`. A wanted folder the source lacks is `refused`, never deleted.
// The scope is the skill folders + the /sync-skills command only — .mcp.json, .gitignore, tools and every
// other file keep the normal (non-destructive) sync behaviour.
export function planReplace({ targetDirs = [], wanted = SKILLS, sourceDirs = [] }) {
  const want = wanted.filter((s) => SKILLS.includes(s));
  const replace = want.filter((s) => targetDirs.includes(s) && sourceDirs.includes(s));
  const install = want.filter((s) => !targetDirs.includes(s) && sourceDirs.includes(s));
  const refused = want.filter((s) => !sourceDirs.includes(s)).map((s) => ({ folder: s, reason: 'MISSING-IN-SOURCE — kept as it is' }));
  const remove = targetDirs.filter((e) => e in SKILL_RENAMES && want.includes(SKILL_RENAMES[e]) && sourceDirs.includes(SKILL_RENAMES[e]))
    .map((e) => ({ folder: e, replacement: SKILL_RENAMES[e] }));
  const keep = targetDirs.filter((e) => !SKILLS.includes(e) && !(e in SKILL_RENAMES));
  return { replace, install, remove, keep, refused };
}
export const REPLACE_WARNING = 'This sync DELETES the Link QA skill folders listed below and downloads fresh copies from {repo} ({branch}), together with .claude/commands/sync-skills.md. '
  + 'If you enhanced or edited any Link skill, those changes are removed and replaced with the new version ({edited} edited files, {extra} extra files — listed below). '
  + 'Only these skill folders and the command are affected; your other skills ({kept}) and every other file are not touched. Continue?';
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
  uiTesting: 'Testing/UI-Testing',
};
export const LEGACY_TESTING_NAMES = ['Testing/requirements', 'Testing/automation', 'Testing/white-box-testing', 'testing', 'automation'];

export const STEERING_DIR = 'docs/steering';
export const STEERING_CANONICAL = { L1: 'L1-testing-foundation.md', L2: 'L2-testing-qa-standards.md', L3: 'L3-project-testing.md' };
export const LEARNING_FILE = 'Testing/project-learning.md';
export const LEARNING_SHARED_SECTIONS = ['## Index', '## Project Knowledge', '## Common Flows', '## UI Knowledge', '## Test Data', '## Locale Knowledge', '## Automation Tricks'];
export const LEARNING_MODEL_SECTIONS = [
  '### Setup Model (skill 1)', '### Requirements Review Model (skill 2)', '### Manual TC Model (skill 3)',
  '### Validation Model (skill 3b)', '### CLI Validation Model (skill 3c)', '### Publish Model (skill 4)', '### Automation Model (skill 5)',
  '### UI Visual QA Model (skill 6)', '### Azure Sync Model (skills 7 to 9)',
  '### White-Box Model (skill 10)', '### Rule Discovery Model (skill 11)',
];
// Headings written by earlier releases → the canonical heading (skill 1 Mode B renames them in place; the body is kept).
export const LEARNING_LEGACY_HEADINGS = {
  '### Automation Model (skill 6)': '### Automation Model (skill 5)',
  '### Publish Model (skill 5)': '### Publish Model (skill 4)',
  '### White-Box Model (skill 4)': '### White-Box Model (skill 10)',
  '### Rule Discovery Model (skill 7)': '### Rule Discovery Model (skill 11)',
  '### UI Visual QA Model (skill qc-ui)': '### UI Visual QA Model (skill 6)',
  '### Azure Sync Model (skills link-qc-1…link-qc-6)': '### Azure Sync Model (skills 7 to 9)',
};
export const MCP_REQUIRED = ['playwright', 'azure-devops', 'docx'];
// Azure DevOps MCP — ONE entry keyed `azure-devops`, two possible servers chosen by hosting type:
//   cloud       (dev.azure.com / *.visualstudio.com) → Microsoft's @azure-devops/mcp, PAT as base64(":" + PAT)
//                in PERSONAL_ACCESS_TOKEN = ${AZURE_DEVOPS_PAT_B64}
//   self-hosted (any other host, e.g. an on-prem Azure DevOps Server) → @tiberriver256/mcp-server-azure-devops,
//                raw PAT in AZURE_DEVOPS_PAT = ${AZURE_DEVOPS_PAT}, plus AZURE_DEVOPS_ORG_URL (https://host/Collection),
//                AZURE_DEVOPS_AUTH_METHOD=pat and AZURE_DEVOPS_DEFAULT_PROJECT. No test-plan / suite tools.
// The user-run PAT script stores BOTH variables from one prompt; the scanners check whichever one .mcp.json references.
export const ADO_SERVER = 'azure-devops';
export const ADO_CLOUD_HOSTS = ['dev.azure.com', 'visualstudio.com'];
export const ADO_CLOUD_PACKAGE = '@azure-devops/mcp';
export const ADO_SELF_HOSTED_PACKAGE = '@tiberriver256/mcp-server-azure-devops';
export const PAT_VAR_CLOUD = 'AZURE_DEVOPS_PAT_B64';
export const PAT_VAR_SELF_HOSTED = 'AZURE_DEVOPS_PAT';
export const PAT_VARS = [PAT_VAR_CLOUD, PAT_VAR_SELF_HOSTED];
// A new user-level environment variable reaches an MCP server only after the editor process is restarted.
export const ENV_RESTART_HINT = 'fully quit VS Code (all windows) and relaunch — a window reload or an /mcp reconnect keeps the old environment';
// Optional servers: reported, never required. `figma` (Figma's remote Dev Mode MCP, OAuth through /mcp —
// no token in any file) is used by link-qc-6-ui-testing only, for exact design tokens; screenshots work without it.
export const MCP_OPTIONAL = ['figma'];
export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';
// Python + Pillow (+ numpy): link-qc-6-ui-testing's static-image annotation fallback only (live URLs need none of it).
// `sync-qa-skills.mjs --apply --tools` installs the two packages when a Python interpreter exists; the
// interpreter itself is never installed by this suite.
export const PYTHON_PACKAGES = ['pillow', 'numpy'];
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
// Playwright CLI (@playwright/cli) — the browser tool of link-qc-3c-validate-manual-test-cases-cli only. Installed
// globally by `sync-qa-skills.mjs --apply --tools` (opt-in); never a prerequisite for 3b or any other skill.
export const PLAYWRIGHT_CLI_PACKAGE = '@playwright/cli';
export const PLAYWRIGHT_CLI_BIN = 'playwright-cli';
export const PLAYWRIGHT_CLI_IGNORE = '.playwright-cli/';
// Optional browser secrets file for 3c (and any Playwright MCP backend): written ONLY by the user through
// scripts/set-playwright-secrets.ps1 / .sh. The scripts here check existence, never content.
export const BROWSER_SECRETS_VAR = 'PLAYWRIGHT_MCP_SECRETS_FILE';
export const BROWSER_SECRETS_FILE = path.join(os.homedir(), '.link-ai-pro', 'playwright-secrets.env');

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
    isCanonicalRepo: remote.ok && /AhmedZaher1233\/Link_AI_Pro(\.git)?$/i.test(remote.out),
    azureDevOps: detectAdoHosting(remote.ok ? remote.out : null) };
}

/**
 * Hosting type of an Azure DevOps URL (git remote, story URL or org URL). Pure; never guesses.
 *   cloud       — host is dev.azure.com / ssh.dev.azure.com / *.visualstudio.com
 *                 https://[org@]dev.azure.com/{org}/{project}/_git/{repo}  ·  git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *                 https://{org}.visualstudio.com/{project}/_git/{repo}     ·  https://dev.azure.com/{org}
 *   self-hosted — any other host whose path is ADO-shaped: /[tfs/]{collection}/{project}/_git/{repo},
 *                 /[tfs/]{collection}/{project}/_workitems/edit/{id}, or a bare https://host[:port]/[tfs/]{collection}
 *   null        — not an Azure DevOps URL (GitHub, GitLab, empty, unparsable)
 * orgUrl is what AZURE_DEVOPS_ORG_URL needs (https://host[:port]/[tfs/]{collection}) or https://dev.azure.com/{org}.
 */
export function detectAdoHosting(url) {
  const none = { hosting: null, orgUrl: null, organization: null, collection: null, project: null };
  if (!url || typeof url !== 'string') return none;
  const s = url.trim();
  const ssh = s.match(/^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com(?::|\/)v3\/([^/]+)\/([^/]+)\/([^/]+)\/?$/i);
  if (ssh) return { hosting: 'cloud', orgUrl: `https://dev.azure.com/${ssh[1]}`, organization: ssh[1], collection: null, project: decodeURIComponent(ssh[2]) };
  let u; try { u = new URL(s); } catch { return none; }
  if (!/^https?:$/.test(u.protocol)) return none;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const marker = parts.findIndex((p) => /^_(git|workitems|apis|build|testPlans|testManagement|boards|wiki)$/i.test(p));
  const before = marker >= 0 ? parts.slice(0, marker) : parts;
  if (host === 'dev.azure.com') {
    if (!before.length) return none;
    return { hosting: 'cloud', orgUrl: `https://dev.azure.com/${before[0]}`, organization: before[0], collection: null, project: before[1] || null };
  }
  const vs = host.match(/^([^.]+)\.visualstudio\.com$/);
  if (vs) return { hosting: 'cloud', orgUrl: `https://${host}`, organization: vs[1], collection: null, project: before[0] && !/^defaultcollection$/i.test(before[0]) ? before[0] : before[1] || null };
  if (ADO_CLOUD_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return none; // other Microsoft hosts (e.g. vssps) — not an org URL
  // Self-hosted: needs an ADO-shaped path, or at least one path segment (the collection) on a bare org URL.
  const tfs = before.length && /^tfs$/i.test(before[0]) ? 1 : 0;
  const collection = before[tfs] || null;
  if (!collection) return none;
  if (marker < 0 && before.length !== tfs + 1) return none; // without an ADO marker only a bare org URL (host/[tfs/]collection) counts — github.com/user/repo does not
  const project = before[tfs + 1] || null;
  const origin = `${u.protocol}//${u.host}`;
  return { hosting: 'self-hosted', orgUrl: `${origin}/${tfs ? 'tfs/' : ''}${collection}`, organization: null, collection, project };
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
    localOnly: skillsDir ? fs.readdirSync(skillsDir).filter((e) => isDir(path.join(skillsDir, e)) && !SKILLS.includes(e) && !(e in SKILL_RENAMES)) : [],
    legacy: skillsDir ? fs.readdirSync(skillsDir).filter((e) => isDir(path.join(skillsDir, e)) && e in SKILL_RENAMES).map((e) => ({ folder: e, replacement: SKILL_RENAMES[e] })) : [],
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

/** The JSON-level apply of planMcpMigration(): removes legacy word entries, adds / re-pins docx. Pure — the caller
 *  writes the file. It never touches any other server (the `azure-devops` entry — cloud or self-hosted — in
 *  particular); scripts/selftest.mjs guards that. `keepCommand(existingCommand)` decides whether an existing absolute
 *  launcher path is kept (sync passes an isFile check; tests pass a stub). */
export function applyMcpMigration(json, uvxPath, keepCommand = (c) => typeof c === 'string' && c !== 'uvx' && isFile(c)) {
  const out = [];
  const plan = planMcpMigration(json);
  json.mcpServers = json.mcpServers || {};
  for (const name of plan.legacyWord) { delete json.mcpServers[name]; out.push({ action: 'mcp-removed', server: name, reason: `${LEGACY_WORD_PACKAGE} is superseded by ${DOCX_SERVER}` }); }
  const needsDocx = plan.actions.some((a) => a.startsWith('add:') || a.startsWith('pin:'));
  if (needsDocx) {
    const name = plan.docxName || DOCX_SERVER;
    const existing = json.mcpServers[name] || {};
    json.mcpServers[name] = { ...existing, command: keepCommand(existing.command) ? existing.command : uvxPath, args: [...DOCX_ARGS] };
    out.push({ action: plan.docxPresent ? 'mcp-updated' : 'mcp-added', server: name, command: json.mcpServers[name].command, pin: DOCX_MCP_PIN });
  }
  return { json, applied: out, plan };
}

/** Which Azure DevOps server an `azure-devops` entry configures, which PAT variable it references, and whether a raw
 *  token was typed into it. Values of env keys that look like secrets are never returned. */
export function inspectAdoEntry(entry) {
  const none = { present: false, package: null, hosting: null, patVar: null, patKey: null, orgUrl: null, defaultProject: null, authMethod: null, inlinePat: false };
  if (!entry || typeof entry !== 'object') return none;
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  const env = entry.env && typeof entry.env === 'object' ? entry.env : {};
  const pkg = args.some((a) => a.startsWith(ADO_SELF_HOSTED_PACKAGE)) ? 'self-hosted' : args.some((a) => a.startsWith(ADO_CLOUD_PACKAGE)) ? 'cloud' : null;
  const patKey = ['PERSONAL_ACCESS_TOKEN', PAT_VAR_SELF_HOSTED].find((k) => typeof env[k] === 'string') || null;
  const patRef = patKey ? String(env[patKey]) : '';
  const ref = patRef.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}$/);
  const patVar = ref ? ref[1] : null;
  const inlinePat = Boolean(patKey) && !ref && patRef.trim().length > 0;
  const orgUrl = typeof env.AZURE_DEVOPS_ORG_URL === 'string' ? env.AZURE_DEVOPS_ORG_URL : (pkg === 'cloud' && args[2] && !args[2].startsWith('-') ? `https://dev.azure.com/${args[2]}` : null);
  const hosting = pkg === 'cloud' ? 'cloud' : pkg === 'self-hosted' ? (detectAdoHosting(orgUrl).hosting || 'self-hosted') : detectAdoHosting(orgUrl).hosting;
  return { present: true, package: pkg, hosting, patVar, patKey, orgUrl, defaultProject: typeof env.AZURE_DEVOPS_DEFAULT_PROJECT === 'string' ? env.AZURE_DEVOPS_DEFAULT_PROJECT : null, authMethod: typeof env.AZURE_DEVOPS_AUTH_METHOD === 'string' ? env.AZURE_DEVOPS_AUTH_METHOD : null, inlinePat };
}

/** Any server env value under a secret-looking key that is not an `${VAR}` reference. Structural — independent of formatting. */
function hasInlineEnvSecret(json) {
  for (const s of Object.values((json && json.mcpServers) || {})) {
    const env = s && typeof s === 'object' && s.env && typeof s.env === 'object' ? s.env : {};
    for (const [k, v] of Object.entries(env)) {
      if (!/PAT|TOKEN|SECRET|PASSWORD/i.test(k)) continue;
      if (typeof v === 'string' && v.trim().length >= 8 && !/^\$\{/.test(v.trim())) return true;
    }
  }
  return false;
}

export function scanMcp(root) {
  const p = path.join(root, '.mcp.json');
  const emptyDocx = { present: false, pinned: false, legacyWord: [], actions: [] };
  const noOptional = Object.fromEntries(MCP_OPTIONAL.map((s) => [s, false]));
  const noAdo = inspectAdoEntry(null);
  if (!isFile(p)) return { exists: false, valid: false, servers: [], missing: MCP_REQUIRED, optional: noOptional, inlineSecrets: false, docx: emptyDocx, azureDevops: noAdo };
  let json = null;
  try { json = JSON.parse(read(p)); } catch { return { exists: true, valid: false, servers: [], missing: MCP_REQUIRED, optional: noOptional, inlineSecrets: false, docx: emptyDocx, azureDevops: noAdo }; }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { exists: true, valid: false, servers: [], missing: MCP_REQUIRED, optional: noOptional, inlineSecrets: false, docx: emptyDocx, azureDevops: noAdo };
  const servers = Object.keys(json.mcpServers || {});
  const text = read(p);
  const inlineSecrets = hasInlineEnvSecret(json)
    || /"(PERSONAL_ACCESS_TOKEN|AZURE_DEVOPS_PAT)"\s*:\s*"(?!\$\{)[^"]{8,}"/.test(text)
    || /:[A-Za-z0-9+/]{40,}={0,2}/.test(text);
  const plan = planMcpMigration(json);
  const docx = { present: plan.docxPresent, pinned: plan.docxPinned, legacyWord: plan.legacyWord, actions: plan.actions };
  const missing = MCP_REQUIRED.filter((s) => (s === DOCX_SERVER ? !plan.docxPresent : !servers.includes(s)));
  const optional = Object.fromEntries(MCP_OPTIONAL.map((s) => [s, servers.includes(s)]));
  const azureDevops = inspectAdoEntry((json.mcpServers || {})[ADO_SERVER]);
  return { exists: true, valid: true, servers, missing, optional, inlineSecrets, docx, azureDevops };
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
  const cli = scanPlaywrightCli(root);
  const py = scanPython(root);
  return {
    node: node.ok ? node.out : null, npm: npm.ok ? npm.out : null,
    playwright: pw.ok ? pw.out.replace(/^Version\s*/i, '') : null,
    playwrightCli: cli.playwrightCli, playwrightCliBrowser: cli.playwrightCliBrowser, playwrightCliBrowserDir: cli.playwrightCliBrowserDir,
    python: py,
    packageJson: pkg, packageJsonValid: pkgValid, playwrightDependency: pwDep,
    playwrightConfig: cfg ? path.relative(root, cfg).replace(/\\/g, '/') : null,
    testDir: grab('testDir'), outputDir: grab('outputDir'),
    testDirExists: grab('testDir') ? isDir(path.resolve(root, grab('testDir'))) : null,
    nodeVersionFile: nodeVersionFile ? path.basename(nodeVersionFile) : null,
  };
}

/** playwright-cli (@playwright/cli): version + where it was found, and whether a Playwright browser cache exists.
 *  The cache check only says "a chromium build is present under the Playwright browsers folder" — it is not a PASS
 *  on its own; the real check is 3c's first `open`. */
export function scanPlaywrightCli(root) {
  const g = run(`${PLAYWRIGHT_CLI_BIN} --version`, root, 30000);
  const l = g.ok ? { ok: false } : run(`npx --no-install ${PLAYWRIGHT_CLI_BIN} --version`, root, 30000);
  const version = (r) => (r.out.match(/\d+\.\d+\.\d+[^\s]*/) || [r.out.split(/\r?\n/)[0]])[0];
  const playwrightCli = g.ok ? { version: version(g), where: 'global' } : l.ok ? { version: version(l), where: 'local' } : { version: null, where: null };
  const home = os.homedir();
  const dirs = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright') : null, path.join(home, '.cache', 'ms-playwright'), path.join(home, 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  const dir = dirs.find(isDir) || null;
  let browser = null;
  if (dir) { try { browser = fs.readdirSync(dir).some((e) => /^chromium/i.test(e) && isDir(path.join(dir, e))); } catch { browser = null; } }
  return { playwrightCli, playwrightCliBrowser: browser, playwrightCliBrowserDir: dir ? dir.replace(/\\/g, '/') : null };
}

/** Python interpreter + the packages link-qc-6-ui-testing's annotation fallback imports. Detection only; nothing is installed here.
 *  The Windows Store `python` alias exits non-zero with "Python was not found", so it never counts as found. */
export function scanPython(root) {
  const candidates = process.platform === 'win32' ? ['py -3', 'python', 'python3'] : ['python3', 'python'];
  let command = null, version = null;
  for (const c of candidates) {
    const r = run(`${c} --version`, root, 15000);
    if (r.ok && /^Python \d/.test(r.out)) { command = c; version = r.out.replace(/^Python\s*/, ''); break; }
  }
  if (!command) return { command: null, version: null, packages: Object.fromEntries(PYTHON_PACKAGES.map((p) => [p, null])), ready: false };
  const probe = run(`${command} -c "import PIL, numpy; print(PIL.__version__, numpy.__version__)"`, root, 30000);
  const [pil, np] = probe.ok ? probe.out.split(/\s+/) : [null, null];
  const packages = { pillow: pil || null, numpy: np || null };
  return { command, version, packages, ready: Boolean(pil && np) };
}

/** .gitignore: does it ignore the playwright-cli output folder? (existence + one line, never rewritten here) */
export function scanGitignore(root) {
  const p = path.join(root, '.gitignore');
  if (!isFile(p)) return { exists: false, ignoresPlaywrightCli: false };
  const lines = (read(p) || '').split(/\r?\n/).map((l) => l.trim());
  return { exists: true, ignoresPlaywrightCli: lines.some((l) => l === PLAYWRIGHT_CLI_IGNORE || l === PLAYWRIGHT_CLI_IGNORE.replace(/\/$/, '') || l === '/' + PLAYWRIGHT_CLI_IGNORE || l === '/' + PLAYWRIGHT_CLI_IGNORE.replace(/\/$/, '')) };
}

/** Existence-only check of the browser secrets file variable (3c, optional). The file is never read. */
export function scanBrowserSecrets(name = BROWSER_SECRETS_VAR) {
  const inProcess = process.env[name] || null;
  let persisted = null, value = null, scope = null;
  if (process.platform === 'win32') {
    const r = run(`reg query HKCU\\Environment /v ${name}`);
    persisted = r.ok; scope = 'user (HKCU\\Environment)';
    if (r.ok) { const m = r.out.match(/REG_[A-Z_]+\s+(.+)$/m); value = m ? m[1].trim() : null; }
  } else {
    const home = os.homedir();
    for (const f of ['.zshrc', '.bashrc', '.bash_profile', '.profile']) {
      const line = (read(path.join(home, f)) || '').split(/\r?\n/).find((l) => l.startsWith(`export ${name}=`));
      if (line) { persisted = true; value = line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '').replace(/^~/, home); break; }
    }
    if (persisted === null) persisted = false;
    scope = 'shell profile';
  }
  const file = value || inProcess;
  return { name, persisted, fileExists: file ? isFile(file) : false, scope, setupScript: process.platform === 'win32' ? 'scripts/set-playwright-secrets.ps1' : 'scripts/set-playwright-secrets.sh' };
}

/**
 * Read-only plan of what `sync-qa-skills.mjs --apply --tools` would do for skill 3c's browser tool and
 * link-qc-6-ui-testing's annotation fallback.
 * actions: 'install:playwright-cli' (global npm package missing), 'install-browser:chromium' (no chromium in
 * the Playwright browsers cache), 'gitignore:.playwright-cli/' (line missing; only inside a git repo),
 * 'pip:pillow,numpy' (a Python interpreter exists but a package is missing — never when Python is absent).
 */
export function planTools(root) {
  const cli = scanPlaywrightCli(root);
  const gi = scanGitignore(root);
  const py = scanPython(root);
  const inGit = isDir(path.join(root, '.git')) || run('git rev-parse --is-inside-work-tree', root).ok;
  const actions = [];
  if (!cli.playwrightCli.version) actions.push(`install:${PLAYWRIGHT_CLI_BIN}`);
  if (!cli.playwrightCliBrowser) actions.push('install-browser:chromium');
  if (inGit && !gi.ignoresPlaywrightCli) actions.push(`gitignore:${PLAYWRIGHT_CLI_IGNORE}`);
  if (py.command && !py.ready) actions.push(`pip:${PYTHON_PACKAGES.join(',')}`);
  return { cli: cli.playwrightCli, browserCache: cli.playwrightCliBrowser, browserDir: cli.playwrightCliBrowserDir, gitignore: gi, inGit, python: py, actions };
}

/** Is the user-level variable `name` persisted on this machine (registry hive / shell profile)? Existence only. */
function persistedEnvVar(name) {
  if (process.platform === 'win32') return { persisted: run(`reg query HKCU\\Environment /v ${name}`).ok, scope: 'user (HKCU\\Environment)' };
  const home = os.homedir();
  const persisted = ['.zshrc', '.bashrc', '.bash_profile', '.profile'].some((f) => (read(path.join(home, f)) || '').split(/\r?\n/).some((l) => l.startsWith(`export ${name}=`)));
  return { persisted, scope: 'shell profile' };
}

/**
 * Existence-only check of the PAT variable. Never returns or logs the value.
 * `name` is the variable the `.mcp.json` entry references (scanMcp().azureDevops.patVar); with no entry yet, every
 * known PAT variable is checked and the first one found is reported (`checked` lists them all).
 * `sessionMissing` = saved on the machine but not in this process — the editor has to be fully restarted.
 * `probe` (tests only) replaces the environment / persistence lookups.
 */
export function scanPat(name = null, probe = null) {
  const inProcessOf = probe?.inProcess || ((n) => Boolean(process.env[n]));
  const persistedOf = probe?.persisted || persistedEnvVar;
  const checked = name ? [name] : [...PAT_VARS];
  let pick = null;
  for (const n of checked) {
    const p = persistedOf(n);
    const r = { name: n, inProcess: inProcessOf(n), persisted: p.persisted, scope: p.scope };
    if (!pick || (!pick.persisted && !pick.inProcess && (r.persisted || r.inProcess))) pick = r;
    if (r.persisted || r.inProcess) { pick = r; break; }
  }
  const setupScript = process.platform === 'win32' ? 'scripts/set-azure-devops-pat.ps1' : 'scripts/set-azure-devops-pat.sh';
  return { ...pick, checked, sessionMissing: Boolean(pick.persisted && !pick.inProcess), restartHint: ENV_RESTART_HINT, setupScript };
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
