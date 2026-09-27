#!/usr/bin/env node
// Deterministic validation for link-qc-1-generate-update-testing-structure. READ-ONLY.
// Emits one row per validation item with PASS / FAIL / WARN / NOT_RUN and a reason.
// A row is PASS only when its check actually executed and succeeded.
//
// Usage: node validate-setup.mjs [--root <path>] [--pretty]
//          [--mcp playwright=PASS,azure-devops=FAIL,docx=NOT_RUN]   ← Claude-side MCP probe results
//          Rows for skill 3c's browser tool (Playwright CLI, its browser, .gitignore, the secrets file) are WARN at
//          worst — 3c is optional and its tool is never a prerequisite for 3b or any other skill. The same holds
//          for link-qc-6-ui-testing's optional extras (Figma MCP, Python + Pillow): WARN at worst, never FAIL.
//          [--sync-report <path-to-json-from-sync-qa-skills --check>]
import path from 'node:path';
import { parseArgs, print, read, isFile, scanGit, scanSuite, scanTesting, scanSteering, scanLearning, scanMcp, scanToolchain, scanManifest, scanPat, scanGitignore, scanBrowserSecrets, SKILLS, SYNC_COMMAND, STEERING_CANONICAL, PLAYWRIGHT_CLI_IGNORE, ADO_SERVER, ADO_CLOUD_PACKAGE, ADO_SELF_HOSTED_PACKAGE, PAT_VAR_CLOUD, PAT_VAR_SELF_HOSTED, ENV_RESTART_HINT } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const rows = [];
const row = (item, status, reason) => rows.push({ item, status, reason });

const tc = scanToolchain(root);
row('Node.js', tc.node ? (/^v(1[89]|[2-9]\d)\./.test(tc.node) ? 'PASS' : 'WARN') : 'FAIL', tc.node ? `${tc.node}${tc.nodeVersionFile ? ` (${tc.nodeVersionFile} present)` : ''}` : 'node not found on PATH');
row('NPM', tc.npm && tc.packageJson && tc.packageJsonValid ? 'PASS' : (tc.npm ? 'WARN' : 'FAIL'), tc.npm ? (tc.packageJson ? (tc.packageJsonValid ? `npm ${tc.npm}, package.json parses` : 'package.json does not parse') : 'no package.json') : 'npm not found');
row('Playwright', tc.playwright && tc.playwrightDependency ? 'PASS' : (tc.playwright || tc.playwrightDependency ? 'WARN' : 'FAIL'), tc.playwright ? `${tc.playwright}${tc.playwrightDependency ? '' : ' — not in package.json'}` : (tc.playwrightDependency ? 'dependency declared but npx playwright not runnable' : 'not installed'));
row('Playwright cfg', tc.playwrightConfig ? (tc.testDir && tc.testDirExists === false ? 'WARN' : 'PASS') : 'FAIL', tc.playwrightConfig ? `${tc.playwrightConfig}; testDir=${tc.testDir ?? 'default'}${tc.testDirExists === false ? ' (folder missing)' : ''}` : 'no playwright.config.*');
// Skill 3c's browser tool — optional, never FAIL. Absent → WARN with the opt-in install hint.
row('Playwright CLI', tc.playwrightCli.version ? 'PASS' : 'WARN', tc.playwrightCli.version ? `playwright-cli ${tc.playwrightCli.version} (${tc.playwrightCli.where}) — used by link-qc-3c-validate-manual-test-cases-cli only` : 'not installed — needed only by link-qc-3c-validate-manual-test-cases-cli; /sync-skills --tools installs it (3b works without it)');
row('Playwright CLI browser', !tc.playwrightCli.version ? 'NOT_RUN' : tc.playwrightCliBrowser ? 'PASS' : 'WARN', !tc.playwrightCli.version ? 'playwright-cli absent' : tc.playwrightCliBrowser ? `chromium present in ${tc.playwrightCliBrowserDir} (cache check; 3c verifies with its first open)` : `no chromium in the Playwright browsers cache${tc.playwrightCliBrowserDir ? ' (' + tc.playwrightCliBrowserDir + ')' : ''} — /sync-skills --tools runs playwright-cli install-browser`);
// link-qc-6-ui-testing's static-image annotation fallback — optional, never FAIL. Live-URL audits need no Python at all.
row('Python + Pillow', tc.python.ready ? 'PASS' : 'WARN', tc.python.ready ? `${tc.python.command} ${tc.python.version}, pillow ${tc.python.packages.pillow}, numpy ${tc.python.packages.numpy} — link-qc-6-ui-testing can annotate static design images` : tc.python.command ? `${tc.python.command} ${tc.python.version} found but ${Object.entries(tc.python.packages).filter(([, v]) => !v).map(([k]) => k).join(' + ')} missing — /sync-skills --tools installs them (link-qc-6-ui-testing static-image annotation only; live URLs need none)` : 'no Python interpreter — optional: link-qc-6-ui-testing annotates live pages in the DOM without it; install Python 3 and run /sync-skills --tools only to annotate static design images');
const gi = scanGitignore(root);
const inGit = isFile(path.join(root, '.git', 'HEAD')) || isFile(path.join(root, '.git'));
row('.gitignore', !inGit ? 'NOT_RUN' : gi.ignoresPlaywrightCli ? 'PASS' : 'WARN', !inGit ? 'not a git repository' : gi.ignoresPlaywrightCli ? `${PLAYWRIGHT_CLI_IGNORE} ignored` : `${gi.exists ? '' : 'no .gitignore; '}${PLAYWRIGHT_CLI_IGNORE} not ignored — playwright-cli snapshots would be committed; /sync-skills --tools adds the line`);

const t = scanTesting(root);
const missingFolders = Object.entries(t.folders).filter(([, v]) => !v).map(([k]) => k);
row('Folder layout', t.allPresent ? 'PASS' : (t.rootExists || t.legacyNames.length ? 'WARN' : 'FAIL'), t.allPresent ? 'Testing/ complete' : (missingFolders.length ? `missing: ${missingFolders.join(', ')}` : 'no Testing/ root') + (t.legacyNames.length ? `; legacy names: ${t.legacyNames.join(', ')}` : ''));

const s = scanSteering(root);
const steeringStatus = !s.exists ? 'FAIL' : (!s.layers.L1 || !s.layers.L2) ? 'FAIL' : (s.nonCanonical.length || s.duplicates.length || !s.readme) ? 'WARN' : (!s.layers.L3 ? 'WARN' : 'PASS');
row('Steering Docs', steeringStatus, !s.exists ? 'docs/steering/ missing' : `L1=${s.layers.L1 ?? 'MISSING'} L2=${s.layers.L2 ?? 'MISSING'} L3=${s.layers.L3 ?? 'MISSING'}; README ${s.readme ? 'present' : 'missing'}` + (s.nonCanonical.length ? `; non-canonical: ${s.nonCanonical.join(', ')}` : '') + (s.duplicates.length ? `; duplicate layers: ${s.duplicates.join(', ')}` : ''));
const l1l2Generic = ['L1', 'L2'].map((L) => s.layers[L] ? read(path.join(root, 'docs/steering', s.layers[L])) || '' : '').every((txt) => !/(SMO|Strategy360|Link-Dev|localhost:\d+|https?:\/\/[a-z0-9.-]+\.(com|net|io)\/)/i.test(txt));
row('L1/L2 generic', s.layers.L1 && s.layers.L2 ? (l1l2Generic ? 'PASS' : 'WARN') : 'NOT_RUN', s.layers.L1 && s.layers.L2 ? (l1l2Generic ? 'no product-specific tokens detected (heuristic)' : 'possible product-specific content in L1/L2 — review') : 'L1/L2 missing');

const lf = scanLearning(root);
row('Learning File', !lf.exists ? 'FAIL' : (lf.missingShared.length || lf.missingModel.length || lf.legacyHeadings.length ? 'WARN' : 'PASS'), !lf.exists ? (lf.legacyFile ? 'only legacy .planning/project-learning.md' : 'Testing/project-learning.md missing') : `${lf.lines} lines` + (lf.missingShared.length ? `; missing shared: ${lf.missingShared.join(', ')}` : '') + (lf.missingModel.length ? `; missing model sections: ${lf.missingModel.length}` : '') + (lf.legacyHeadings.length ? `; legacy headings: ${lf.legacyHeadings.join(', ')}` : ''));

const m = scanMcp(root);
const ado = m.azureDevops;
const docxUnpinned = m.valid && m.docx.present && !m.docx.pinned;
// Which PAT variable the azure-devops entry references decides the inline-secret hint and the PAT row below.
const expectedPatVar = ado.patVar || (ado.package === 'self-hosted' ? PAT_VAR_SELF_HOSTED : PAT_VAR_CLOUD);
const adoShape = ado.present ? (ado.package === 'self-hosted' && (ado.authMethod !== 'pat' || !ado.orgUrl) ? `self-hosted entry ${!ado.orgUrl ? 'has no AZURE_DEVOPS_ORG_URL (https://host/Collection)' : 'needs AZURE_DEVOPS_AUTH_METHOD=pat'}` : ado.package === null ? 'azure-devops entry uses an unknown package (expected @azure-devops/mcp or @tiberriver256/mcp-server-azure-devops)' : null) : null;
const adoDesc = ado.present ? `; azure-devops: ${ado.package === 'self-hosted' ? `self-hosted (${ADO_SELF_HOSTED_PACKAGE}${ado.orgUrl ? ', ' + ado.orgUrl : ''})` : ado.package === 'cloud' ? `cloud (${ADO_CLOUD_PACKAGE})` : 'unknown package'}` : '';
row('.mcp.json', !m.exists ? 'FAIL' : !m.valid ? 'FAIL' : m.inlineSecrets ? 'FAIL' : docxUnpinned ? 'FAIL' : (m.missing.length || m.docx.legacyWord.length || adoShape) ? 'WARN' : 'PASS', !m.exists ? 'missing' : !m.valid ? 'invalid JSON' : m.inlineSecrets ? `inline secret detected — ${ado.inlinePat ? `${ado.patKey} holds a literal token; ` : ''}must reference the user-level variable as \${${expectedPatVar}} (user runs ${process.platform === 'win32' ? 'scripts/set-azure-devops-pat.ps1' : 'scripts/set-azure-devops-pat.sh'})` : `servers: ${m.servers.join(', ')}` + adoDesc + (m.missing.length ? `; missing: ${m.missing.join(', ')}` : '') + (adoShape ? `; ${adoShape}` : '') + (docxUnpinned ? '; docx args missing `--with mcp<2` — add "--with", "mcp<2" before the final docx-mcp-server arg (unpinned mcp 2.x breaks the server import)' : '') + (m.docx.legacyWord.length ? `; legacy word server superseded by docx: ${m.docx.legacyWord.join(', ')} — run /sync-skills or remove it` : ''));

// Azure DevOps hosting: from the git remote (evidence for a NEW entry) and from the entry itself. Never PASS without evidence.
const g = scanGit(root);
const remoteAdo = g.isRepo ? g.azureDevOps : null;
const hostingEvidence = ado.present && ado.hosting ? `${ado.hosting} per .mcp.json` : remoteAdo?.hosting ? `${remoteAdo.hosting} per git remote (${remoteAdo.orgUrl})` : null;
const hostingMismatch = ado.present && remoteAdo?.hosting && ado.hosting && remoteAdo.hosting !== ado.hosting;
row('Azure DevOps hosting', hostingMismatch ? 'WARN' : hostingEvidence ? 'PASS' : ado.present ? 'WARN' : 'NOT_RUN', hostingMismatch ? `git remote says ${remoteAdo.hosting} (${remoteAdo.orgUrl}) but the .mcp.json entry is ${ado.hosting} — the package must match the hosting (dev.azure.com / *.visualstudio.com → @azure-devops/mcp; any other host → @tiberriver256/mcp-server-azure-devops)` : hostingEvidence ? hostingEvidence + (remoteAdo?.hosting && ado.present ? `; git remote agrees (${remoteAdo.orgUrl})` : '') : ado.present ? 'entry present but its hosting cannot be told from its args/env' : `${g.isRepo ? (g.remote ? 'git remote is not an Azure DevOps URL' : 'no git remote') : 'not a git repository'} and no azure-devops entry yet — ask the user for a User Story URL to detect cloud vs self-hosted`);

// PAT: existence only (user-level env var / shell profile) of the variable the entry references. The value is never read, printed or compared.
const pat = scanPat(ado.present ? expectedPatVar : null);
row('PAT env var', !pat.persisted && !pat.inProcess ? (ado.present ? 'FAIL' : 'WARN') : pat.sessionMissing ? 'WARN' : 'PASS', pat.persisted || pat.inProcess ? `${pat.name} ${pat.persisted ? `set (${pat.scope})` : 'present in this session only (not persisted)'}${pat.sessionMissing ? ` — saved on this machine but missing from this session: ${ENV_RESTART_HINT}` : ''}` : `${pat.checked.join(' / ')} not set — user runs ${pat.setupScript} (masked prompt; stores ${PAT_VAR_CLOUD} and ${PAT_VAR_SELF_HOSTED}), then must ${ENV_RESTART_HINT}`);

// Browser secrets file (3c, optional): existence of the user-level variable and the file it names — the content is never read.
const bs = scanBrowserSecrets();
row('Browser secrets file', bs.persisted && bs.fileExists ? 'PASS' : 'WARN', bs.persisted && bs.fileExists ? `${bs.name} set (${bs.scope}); file present — 3c can log in by secret name` : bs.persisted ? `${bs.name} set but the file it names is missing — re-run ${bs.setupScript}` : `${bs.name} not set — optional: attended login works without it; for unattended 3c logins the user runs ${bs.setupScript} (masked prompts, file outside the repo)`);

// MCP reachability is probed by Claude through the MCP tools; results are passed in. Absent → NOT_RUN, never PASS.
const probes = Object.fromEntries(String(args.mcp || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
for (const [server, label] of [['playwright', 'Playwright MCP'], ['azure-devops', 'Azure DevOps MCP'], ['docx', 'Docx MCP']]) {
  const p = (probes[server] || 'NOT_RUN').toUpperCase();
  const configured = server === 'docx' ? m.docx.present : m.servers.includes(server);
  const probeHint = server === ADO_SERVER && ado.present ? ` (${ado.package === 'self-hosted' ? 'self-hosted: list_projects' : 'cloud: core_list_projects'})` : '';
  row(label, ['PASS', 'FAIL', 'WARN'].includes(p) ? p : 'NOT_RUN', configured ? (p === 'NOT_RUN' ? `configured; reachability not probed this run${probeHint}` : `probe ${p}${p === 'FAIL' && server === ADO_SERVER && pat.sessionMissing ? ` — ${pat.name} is not in this session: ${ENV_RESTART_HINT}` : ''}`) : 'not configured');
}
// Figma MCP (link-qc-6-ui-testing, optional): not configured → WARN with the setup hint, never FAIL; configured → probe result or NOT_RUN.
{
  const p = (probes.figma || 'NOT_RUN').toUpperCase();
  row('Figma MCP', !m.optional.figma ? 'WARN' : ['PASS', 'FAIL', 'WARN'].includes(p) ? p : 'NOT_RUN', m.optional.figma ? (p === 'NOT_RUN' ? 'configured; reachability not probed this run (needs a Figma login through /mcp)' : `probe ${p}`) : 'not configured — optional, link-qc-6-ui-testing only: exact design tokens from Figma links (mcp-setup.md §2c); design screenshots work without it');
}

const su = scanSuite(root);
row('QA Skills', su.missing.length || su.invalid.length ? 'FAIL' : (su.uppercaseDir ? 'WARN' : 'PASS'), `${su.present.length}/${SKILLS.length} present` + (su.missing.length ? `; missing: ${su.missing.join(', ')}` : '') + (su.invalid.length ? `; invalid front-matter: ${su.invalid.join(', ')}` : '') + (su.uppercaseDir ? `; folder is .claude/${su.skillsDir.split('/').pop()} (canonical: .claude/skills)` : ''));
if (su.legacy.length) row('Legacy skill folders', 'WARN', su.legacy.map((l) => `${l.folder} → ${l.replacement}`).join(', ') + ' — renamed in this release; run /sync-skills (--apply removes them once the replacement is in place)');
let sync = null;
if (args['sync-report'] && isFile(args['sync-report'])) { try { sync = JSON.parse(read(args['sync-report'])); } catch {} }
row('Skills current', sync ? (sync.summary?.updated || sync.summary?.new ? 'WARN' : (sync.error ? 'NOT_RUN' : 'PASS')) : 'NOT_RUN', sync ? (sync.error ? `sync check failed: ${sync.error}` : `vs ${sync.source?.ref ?? 'source'}: ${sync.summary?.current ?? 0} current, ${sync.summary?.updated ?? 0} behind, ${sync.summary?.new ?? 0} missing`) : 'no --sync-report given (run sync-qa-skills.mjs --check)');
row('sync-skills cmd', isFile(path.join(root, SYNC_COMMAND)) ? 'PASS' : 'FAIL', SYNC_COMMAND);

const mf = scanManifest(root);
row('Manifest', mf.exists && mf.valid ? 'PASS' : (mf.exists ? 'FAIL' : 'WARN'), mf.exists ? (mf.valid ? `schema ${mf.schemaVersion}, generated ${mf.generatedOn}, ${mf.deviations} deviation(s)` : 'invalid JSON') : 'Testing/qa-manifest.json missing (written by Mode B/C or new-project run)');

const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
print({ tool: 'validate-setup', readOnly: true, root, generatedOn: new Date().toISOString(), rows, counts,
  overall: counts.FAIL ? 'FAIL' : (counts.WARN || counts.NOT_RUN ? 'PARTIAL' : 'PASS'),
  canonicalSteeringNames: STEERING_CANONICAL }, args);
