#!/usr/bin/env node
// Deterministic validation for link-qc-1-generate-update-testing-structure. READ-ONLY.
// Emits one row per validation item with PASS / FAIL / WARN / NOT_RUN and a reason.
// A row is PASS only when its check actually executed and succeeded.
//
// Usage: node validate-setup.mjs [--root <path>] [--pretty]
//          [--mcp playwright=PASS,azure-devops=FAIL,docx=NOT_RUN[,figma=PASS][,azure-devops-attachments=PASS]]   ← Claude-side MCP probe results
//          Rows for the browser tool of skills 3c, 5b and 9 (Playwright CLI, its browser, .gitignore, the secrets file) are WARN
//          at worst — 3c and 5b are optional and their tool is never a prerequisite for 3b or any other skill. The same holds
//          for link-qc-6-ui-testing's optional extras (Figma MCP, Python + Pillow) and for the optional
//          `azure-devops-attachments` server of skills 8 / 9 (cloud projects): WARN at worst, never FAIL.
//          [--sync-report <path-to-json-from-sync-qa-skills --check>]
import path from 'node:path';
import { parseArgs, print, read, isFile, scanGit, scanSuite, scanTesting, scanSteering, scanLearning, scanMcp, scanToolchain, scanAutomationTypes, scanManifest, scanPat, scanGitignore, scanBrowserSecrets, scanExecutionLimits, SKILLS, SYNC_COMMAND, STEERING_CANONICAL, PLAYWRIGHT_CLI_IGNORE, ADO_SERVER, ADO_CLOUD_PACKAGE, ADO_SELF_HOSTED_PACKAGE, PAT_VAR_CLOUD, PAT_VAR_SELF_HOSTED, ENV_RESTART_HINT, ADO_ATTACHMENTS_SERVER, ADO_ATTACHMENTS_LAUNCHER, ADO_ATTACHMENTS_PACKAGE_PIN, ADO_ATTACHMENTS_PROBE } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const rows = [];
const row = (item, status, reason) => rows.push({ item, status, reason });

const tc = scanToolchain(root);
row('Node.js', tc.node ? (/^v(1[89]|[2-9]\d)\./.test(tc.node) ? 'PASS' : 'WARN') : 'FAIL', tc.node ? `${tc.node}${tc.nodeVersionFile ? ` (${tc.nodeVersionFile} present)` : ''}` : 'node not found on PATH');
row('NPM', tc.npm && tc.packageJson && tc.packageJsonValid ? 'PASS' : (tc.npm ? 'WARN' : 'FAIL'), tc.npm ? (tc.packageJson ? (tc.packageJsonValid ? `npm ${tc.npm}, package.json parses` : 'package.json does not parse') : 'no package.json') : 'npm not found');
row('Playwright', tc.playwright && tc.playwrightDependency ? 'PASS' : (tc.playwright || tc.playwrightDependency ? 'WARN' : 'FAIL'), tc.playwright ? `${tc.playwright}${tc.playwrightDependency ? '' : ' — not in package.json'}` : (tc.playwrightDependency ? 'dependency declared but npx playwright not runnable' : 'not installed'));
row('Playwright cfg', tc.playwrightConfig ? (tc.testDir && tc.testDirExists === false ? 'WARN' : 'PASS') : 'FAIL', tc.playwrightConfig ? `${tc.playwrightConfig}; testDir=${tc.testDir ?? 'default'}${tc.testDirExists === false ? ' (folder missing)' : ''}` : 'no playwright.config.*');
// skill 5: its helpers import node:* and read process.env, and Checkpoint A runs the project's own tsc --noEmit
const autoTypes = scanAutomationTypes(root);
row('Automation types', !autoTypes.packageJson || !autoTypes.playwrightProject ? 'NOT_RUN' : autoTypes.missing.length ? 'WARN' : 'PASS', !autoTypes.packageJson ? 'no automation package.json yet' : !autoTypes.playwrightProject ? `${autoTypes.automationRoot}/package.json does not declare @playwright/test` : autoTypes.missing.length ? `${autoTypes.automationRoot}: ${autoTypes.missing.map((p) => p + (autoTypes.declared[p] ? ' (declared, not installed)' : '')).join(', ')} missing — skill 5's Checkpoint A type check (tsc --noEmit) fails on its helpers ("Cannot find name 'process'" / 'node:fs'); install in ${autoTypes.automationRoot}: ${autoTypes.installCommand}` : `${Object.entries(autoTypes.installed).map(([k, v]) => k + ' ' + v).join(', ')} in ${autoTypes.automationRoot} — skill 5's helpers and its tsc check resolve`);
// The browser tool of skills 3c, 5b and 9 — optional, never FAIL. Absent → WARN with the opt-in install hint.
row('Playwright CLI', tc.playwrightCli.version ? 'PASS' : 'WARN', tc.playwrightCli.version ? `playwright-cli ${tc.playwrightCli.version} (${tc.playwrightCli.where}) — used by link-qc-3c-validate-manual-test-cases-cli, link-qc-5b-test-run-manual-cli and link-qc-9-retesting only` : 'not installed — needed only by link-qc-3c-validate-manual-test-cases-cli, link-qc-5b-test-run-manual-cli and link-qc-9-retesting (bugs without an automated TC); /sync-skills --tools installs it (3b works without it)');
row('Playwright CLI browser', !tc.playwrightCli.version ? 'NOT_RUN' : tc.playwrightCliBrowser ? 'PASS' : 'WARN', !tc.playwrightCli.version ? 'playwright-cli absent' : tc.playwrightCliBrowser ? `chromium present in ${tc.playwrightCliBrowserDir} (cache check; 3c / 5b verify with their first open)` : `no chromium in the Playwright browsers cache${tc.playwrightCliBrowserDir ? ' (' + tc.playwrightCliBrowserDir + ')' : ''} — /sync-skills --tools runs playwright-cli install-browser`);
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

// Execution limits (skills 5 and 9): the machine's worker ceiling and the coordination directory — read-only; skill 1 never
// writes config.json and never raises a limit (references/toolchain.md "Execution limits").
const xl = scanExecutionLimits(root);
const xc = xl.ceiling;
const overrides = [...xc.lowered.map((l) => `lowered to ${l.value} by ${l.by}`), ...xc.refusedRaises.map((r) => `${r.by}=${r.value} ignored (only lowers)`), ...xc.invalid.map((i) => `${i.by}=${JSON.stringify(i.value)} invalid (ignored)`)];
const ceilingSource = xc.source === 'auto' ? `Auto: ${xc.auto.host.totalMemMb} MB / ${xc.auto.host.cpus} cores → ${xc.auto.byMem} by memory, ${xc.auto.byCpu} by CPU` : xc.source === 'auto-fallback' ? 'Auto fallback — ' + xc.auto.reason : 'config error';
const ledgerOff = xl.ledgerMode === 'exclusive' || xl.ledgerVarPersisted;
row('Execution limits', xl.config.exists && !xl.config.valid ? 'WARN' : (xc.refusedRaises.length || xc.invalid.length || xl.warnings.length || ledgerOff || xc.source === 'auto-fallback' ? 'WARN' : 'PASS'),
  (xl.config.exists && !xl.config.valid ? `${xl.config.error} — the ceiling falls back to 1 until it is fixed by hand; ` : '')
  + `machine ceiling ${xc.base} (${ceilingSource}; upper bound ${xc.upper.value} from ${xc.upper.from === 'config' ? 'config.json' : 'AUTO_MAX'}), effective ${xc.effective} worker(s) — a run starts at 2 and its ramp adapts within it`
  + (overrides.length ? '; ' + overrides.join('; ') : '')
  + (xl.ledgerMode === 'exclusive' ? '; QA_LEDGER=off in this session — skills 5 / 9 run one Playwright command at a time, serially (protection reduced)' : '')
  + (xl.ledgerVarPersisted ? '; QA_LEDGER is saved at user level — if it is "off" every later run is exclusive and serial; remove it unless that is intended' : '')
  + (xl.warnings.length ? '; ' + xl.warnings.join('; ') : '')
  + '; config.json machineMaxWorkers only bounds Auto — skills never write it');
row('Coordination directory', !xl.writable || (xl.ledger.exists && !xl.ledger.valid) ? 'FAIL' : 'PASS',
  !xl.writable ? `${xl.dir} (${xl.dirSource}) is not writable${xl.writableVia && xl.writableVia !== xl.dir ? ' (checked at ' + xl.writableVia + ')' : ''} — skills 5 and 9 refuse to launch Playwright ("no safe coordination"); set QA_CAPACITY_DIR to a writable absolute path`
  : xl.ledger.exists && !xl.ledger.valid ? `${xl.ledger.error} in ${xl.dir} — skills 5 and 9 refuse to launch Playwright until it is repaired (delete it only while no run is active)`
  : `${xl.dir} (${xl.dirSource === 'home' ? 'default' : xl.dirSource})${xl.dirExists ? '' : ' — created by the first skill 5 / 9 run'}`);

// Browser secrets file (3c, 5b and 9, optional): existence of the user-level variable and the file it names — the content is never read.
const bs = scanBrowserSecrets();
row('Browser secrets file', bs.persisted && bs.fileExists ? 'PASS' : 'WARN', bs.persisted && bs.fileExists ? `${bs.name} set (${bs.scope}); file present — 3c, 5b and 9 can log in by secret name` : bs.persisted ? `${bs.name} set but the file it names is missing — re-run ${bs.setupScript}` : `${bs.name} not set — optional: attended login works without it; for unattended 3c / 5b / 9 logins the user runs ${bs.setupScript} (masked prompts, file outside the repo)`);

// MCP reachability is probed by Claude through the MCP tools; results are passed in. Absent → NOT_RUN, never PASS.
const probes = Object.fromEntries(String(args.mcp || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
for (const [server, label] of [['playwright', 'Playwright MCP'], ['azure-devops', 'Azure DevOps MCP'], ['docx', 'Docx MCP']]) {
  const p = (probes[server] || 'NOT_RUN').toUpperCase();
  const configured = server === 'docx' ? m.docx.present : m.servers.includes(server);
  const probeHint = server === ADO_SERVER && ado.present ? ` (${ado.package === 'self-hosted' ? 'self-hosted: list_projects' : 'cloud: core_list_projects'})` : '';
  row(label, ['PASS', 'FAIL', 'WARN'].includes(p) ? p : 'NOT_RUN', configured ? (p === 'NOT_RUN' ? `configured; reachability not probed this run${probeHint}` : `probe ${p}${p === 'FAIL' && server === ADO_SERVER && pat.sessionMissing ? ` — ${pat.name} is not in this session: ${ENV_RESTART_HINT}` : ''}`) : 'not configured');
}
// Azure DevOps attachments MCP (skills 8 / 9, cloud projects, optional): the second server that uploads evidence attachments from
// disk. WARN at worst, never FAIL on its own (a literal token in its env makes the .mcp.json row FAIL, as for every server).
{
  const at = m.adoAttachments;
  const p = (probes[ADO_ATTACHMENTS_SERVER] || 'NOT_RUN').toUpperCase();
  const cloud = ado.present && ado.package === 'cloud', selfHosted = ado.present && ado.package === 'self-hosted';
  let status, reason;
  if (!at.present) {
    if (selfHosted) { status = 'PASS'; reason = `not needed — the self-hosted azure-devops entry (${ADO_SELF_HOSTED_PACKAGE}) already uploads attachments (create_work_item_attachment)`; }
    else if (cloud) { status = 'WARN'; reason = `not configured — optional, cloud projects only: skills 8 / 9 leave evidence attachments pending with manual upload instructions until skill 1 Mode B adds the ${ADO_ATTACHMENTS_SERVER} entry and copies ${ADO_ATTACHMENTS_LAUNCHER} (mcp-setup.md §2d)`; }
    else { status = 'NOT_RUN'; reason = 'no azure-devops entry yet — decided with it (cloud → skill 1 Mode B adds it; self-hosted → not needed)'; }
  } else if (at.inlinePat) { status = 'WARN'; reason = `${ADO_ATTACHMENTS_SERVER} entry carries a literal token — remove the key; the launcher reads ${PAT_VAR_SELF_HOSTED} / ${PAT_VAR_CLOUD} from the environment (the .mcp.json row stays FAIL until it is removed)`; }
  else if (!at.launcherReferenced) { status = 'WARN'; reason = `${ADO_ATTACHMENTS_SERVER} entry does not run the launcher — expected "command": "node", "args": ["${ADO_ATTACHMENTS_LAUNCHER}"] (template block _optional_azure_devops_attachments_server)`; }
  else if (!at.launcherExists) { status = 'WARN'; reason = `entry present but ${ADO_ATTACHMENTS_LAUNCHER} is missing — the server cannot start; re-run skill 1 Mode B (it copies assets/mcp-launchers/azure-devops-attachments.cjs; /sync-skills never does)`; }
  else if (at.launcherCurrent === false) { status = 'WARN'; reason = `${ADO_ATTACHMENTS_LAUNCHER} differs from skill 1's asset copy (${at.package || 'package not readable'} vs ${ADO_ATTACHMENTS_PACKAGE_PIN}) — launcher outdated; re-run skill 1 Mode B (/sync-skills never updates it)`; }
  else {
    status = ['PASS', 'FAIL', 'WARN'].includes(p) ? p : 'NOT_RUN';
    reason = p === 'NOT_RUN'
      ? `configured (${at.package || ADO_ATTACHMENTS_PACKAGE_PIN} via ${ADO_ATTACHMENTS_LAUNCHER}${at.launcherCurrent ? ', current' : ''}${selfHosted ? '; redundant on self-hosted — the azure-devops entry already uploads' : ''}); reachability not probed this run (probe: ${ADO_ATTACHMENTS_PROBE})`
      : `probe ${p}${p === 'FAIL' && pat.sessionMissing ? ` — ${pat.name} is not in this session: ${ENV_RESTART_HINT}` : ''}`;
  }
  row('Azure DevOps attachments MCP', status, reason);
}
// Figma MCP (link-qc-6-ui-testing, optional): not configured → WARN with the setup hint, never FAIL; configured → probe result or NOT_RUN.
{
  const p = (probes.figma || 'NOT_RUN').toUpperCase();
  row('Figma MCP', !m.optional.figma ? 'WARN' : ['PASS', 'FAIL', 'WARN'].includes(p) ? p : 'NOT_RUN', m.optional.figma ? (p === 'NOT_RUN' ? 'configured; reachability not probed this run (needs a Figma login through /mcp)' : `probe ${p}`) : 'not configured — optional, link-qc-6-ui-testing only: exact design tokens from Figma links (mcp-setup.md §2c); design screenshots work without it');
}

const su = scanSuite(root);
row('QA Skills', su.missing.length || su.invalid.length ? 'FAIL' : (su.uppercaseDir ? 'WARN' : 'PASS'), `${su.present.length}/${SKILLS.length} present` + (su.missing.length ? `; missing: ${su.missing.join(', ')}` : '') + (su.invalid.length ? `; invalid front-matter: ${su.invalid.join(', ')}` : '') + (su.uppercaseDir ? `; folder is .claude/${su.skillsDir.split('/').pop()} (canonical: .claude/skills)` : '') + (Object.keys(su.versions).length ? `; versions: ${Object.entries(su.versions).map(([k, v]) => `${k} ${v}`).join(', ')}` : ''));
if (su.legacy.length) row('Legacy skill folders', 'WARN', su.legacy.map((l) => `${l.folder} → ${l.replacement}`).join(', ') + ' — renamed in this release; run /sync-skills (--apply removes them once the replacement is in place)');
let sync = null;
if (args['sync-report'] && isFile(args['sync-report'])) { try { sync = JSON.parse(read(args['sync-report'])); } catch {} }
// versions[] (sync --check): a skill whose SKILL.md metadata.version is behind the source is BEHIND even when no file
// count says so; an older report without versions[] keeps the file-count reading.
const behindV = (sync?.versions || []).filter((v) => ['update-available', 'pre-versioning'].includes(v.versionStatus));
const versioned = (sync?.versions || []).filter((v) => v.sourceVersion || v.installedVersion);
const versionNote = versioned.length ? '; versions: ' + versioned.map((v) => `${v.skill} ${v.installedVersion ?? 'unversioned'} → ${v.sourceVersion ?? 'unversioned'} (${v.versionStatus})`).join(', ') : '';
row('Skills current', sync ? (sync.summary?.updated || sync.summary?.new || behindV.length ? 'WARN' : (sync.error ? 'NOT_RUN' : 'PASS')) : 'NOT_RUN', sync ? (sync.error ? `sync check failed: ${sync.error}` : `vs ${sync.source?.ref ?? 'source'}: ${sync.summary?.current ?? 0} current, ${sync.summary?.updated ?? 0} behind, ${sync.summary?.new ?? 0} missing` + versionNote) : 'no --sync-report given (run sync-qa-skills.mjs --check)');
row('sync-skills cmd', isFile(path.join(root, SYNC_COMMAND)) ? 'PASS' : 'FAIL', SYNC_COMMAND);

const mf = scanManifest(root);
row('Manifest', mf.exists && mf.valid ? 'PASS' : (mf.exists ? 'FAIL' : 'WARN'), mf.exists ? (mf.valid ? `schema ${mf.schemaVersion}, generated ${mf.generatedOn}, ${mf.deviations} deviation(s)` : 'invalid JSON') : 'Testing/qa-manifest.json missing (written by Mode B/C or new-project run)');

const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
print({ tool: 'validate-setup', readOnly: true, root, generatedOn: new Date().toISOString(), rows, counts,
  overall: counts.FAIL ? 'FAIL' : (counts.WARN || counts.NOT_RUN ? 'PARTIAL' : 'PASS'),
  canonicalSteeringNames: STEERING_CANONICAL }, args);
