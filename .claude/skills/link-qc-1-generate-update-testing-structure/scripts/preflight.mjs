#!/usr/bin/env node
// READ-ONLY preflight for link-qc-1-generate-update-testing-structure.
// Captures the ORIGINAL project state and classifies NEW vs EXISTING before anything is changed.
// Usage: node preflight.mjs [--root <path>] [--pretty]
// Exit code is always 0; every result lives in the JSON payload.
import path from 'node:path';
import { parseArgs, print, scanGit, scanSuite, scanTesting, scanSteering, scanLearning, scanMcp, scanToolchain, scanManifest, scanPat, scanGitignore, scanBrowserSecrets, SKILLS, PLAYWRIGHT_CLI_IGNORE, ENV_RESTART_HINT, PAT_VAR_CLOUD, PAT_VAR_SELF_HOSTED } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());

const git = scanGit(root);
const suite = scanSuite(root);
const testing = scanTesting(root);
const steering = scanSteering(root);
const learning = scanLearning(root);
const mcp = scanMcp(root);
const toolchain = scanToolchain(root);
const manifest = scanManifest(root);
// PAT: existence only, of the variable the azure-devops entry references (both known names when there is no entry) — the value is never read into the output.
const pat = scanPat(mcp.azureDevops.present ? mcp.azureDevops.patVar || (mcp.azureDevops.package === 'self-hosted' ? PAT_VAR_SELF_HOSTED : PAT_VAR_CLOUD) : null);
// Hosting of the Azure DevOps entry vs the git remote (cloud = dev.azure.com / *.visualstudio.com; anything else = self-hosted). Details: mcp.azureDevops + git.azureDevOps.
const azureDevOps = { hosting: mcp.azureDevops.hosting || (git.isRepo ? git.azureDevOps.hosting : null) || null,
  source: mcp.azureDevops.hosting ? '.mcp.json' : git.isRepo && git.azureDevOps.hosting ? 'git remote' : null,
  mismatch: Boolean(mcp.azureDevops.present && mcp.azureDevops.hosting && git.isRepo && git.azureDevOps.hosting && git.azureDevOps.hosting !== mcp.azureDevops.hosting) };
const gitignore = scanGitignore(root);
const browserSecrets = scanBrowserSecrets(); // existence only — the file is never read

// Classification markers. M5 (skills installed) is reported but deliberately NOT used for
// classification: the skill itself installs skills, so it must not change the evidence it judges.
const markers = {
  M1: { label: 'Testing root exists', present: testing.rootExists || testing.legacyNames.length > 0, evidence: testing.rootExists ? `${testing.rootName}/ present` : (testing.legacyNames[0] || null) },
  M2: { label: 'Automation code exists', present: testing.specFileCount > 0 || testing.pageObjectDirs > 0, evidence: `${testing.specFileCount} spec files, ${testing.pageObjectDirs} pages/ dirs` },
  M3: { label: 'Playwright configured', present: Boolean(toolchain.playwrightConfig) || toolchain.playwrightDependency, evidence: toolchain.playwrightConfig || (toolchain.playwrightDependency ? '@playwright/test in package.json' : null) },
  M4: { label: 'MCP configured', present: mcp.valid && (mcp.docx.present || mcp.servers.some((s) => ['playwright', 'azure-devops', 'word'].includes(s))), evidence: mcp.servers.join(', ') || null }, // legacy `word` still counts as evidence of an existing setup
  M5: { label: 'QA skills installed (informational only)', present: suite.present.length > 0, evidence: `${suite.present.length}/${SKILLS.length} present`, usedForClassification: false },
  M6: { label: 'Steering docs exist', present: steering.exists && steering.files.length > 0, evidence: steering.exists ? Object.values(steering.layers).filter(Boolean).join(', ') || 'dir present, no layer files' : null },
  M7: { label: 'Learning file exists', present: learning.exists || learning.legacyFile, evidence: learning.exists ? 'Testing/project-learning.md' : (learning.legacyFile ? '.planning/project-learning.md (legacy)' : null) },
};
const secondary = ['M3', 'M4', 'M6', 'M7'].filter((k) => markers[k].present).length;
const classification = (markers.M1.present || markers.M2.present || secondary >= 2) ? 'EXISTING' : 'NEW';
const onlyPlaywright = classification === 'NEW' && markers.M3.present;

print({
  tool: 'preflight', readOnly: true, root, generatedOn: new Date().toISOString(),
  classification, classificationRule: 'EXISTING if M1 or M2, or any two of M3/M4/M6/M7; M5 never counts',
  note: onlyPlaywright ? 'Playwright present for app development only — treated as NEW' : null,
  markers, git, suite, testing, steering, learning, mcp, azureDevOps, toolchain, manifest, pat, gitignore, browserSecrets,
  warnings: [
    toolchain.playwrightCli.version && git.isRepo && !gitignore.ignoresPlaywrightCli ? `playwright-cli is installed but ${PLAYWRIGHT_CLI_IGNORE} is not in .gitignore — its snapshot files would be committed (/sync-skills --tools adds the line)` : null,
    !toolchain.playwrightCli.version && suite.present.includes('link-qc-3c-validate-manual-test-cases-cli') ? 'skill 3c is installed but playwright-cli is not — 3c will BLOCK until /sync-skills --tools runs (3b is unaffected)' : null,
    suite.present.includes('link-qc-6-ui-testing') && toolchain.python.command && !toolchain.python.ready ? `Python ${toolchain.python.version} found but pillow/numpy missing — link-qc-6-ui-testing cannot annotate static design images until /sync-skills --tools runs (live-URL audits are unaffected)` : null,
    suite.present.includes('link-qc-6-ui-testing') && mcp.valid && !mcp.optional.figma ? 'link-qc-6-ui-testing is installed but no figma MCP entry exists — optional; Figma links fall back to exported screenshots (mcp-setup.md §2c)' : null,
    mcp.servers.includes('azure-devops') && !pat.persisted && !pat.inProcess ? `${pat.name} is not set for this user — ask the user to run ${pat.setupScript} (masked prompt; stores both AZURE_DEVOPS_PAT_B64 and AZURE_DEVOPS_PAT), then ${ENV_RESTART_HINT}` : null,
    pat.sessionMissing ? `${pat.name} is saved on this machine but missing from this session — the MCP server would start without a token (401 / anonymous access): ${ENV_RESTART_HINT}` : null,
    mcp.azureDevops.inlinePat ? `.mcp.json: ${mcp.azureDevops.patKey} holds a literal token — replace it with the \${${mcp.azureDevops.package === 'self-hosted' ? 'AZURE_DEVOPS_PAT' : 'AZURE_DEVOPS_PAT_B64'}} reference and let the user rotate the token` : null,
    azureDevOps.mismatch ? `azure-devops entry is ${mcp.azureDevops.hosting} but the git remote is ${git.azureDevOps.hosting} (${git.azureDevOps.orgUrl}) — cloud needs @azure-devops/mcp, self-hosted needs @tiberriver256/mcp-server-azure-devops` : null,
    mcp.azureDevops.present && mcp.azureDevops.package === 'self-hosted' && (mcp.azureDevops.authMethod !== 'pat' || !mcp.azureDevops.orgUrl) ? 'self-hosted azure-devops entry needs AZURE_DEVOPS_ORG_URL (https://host/Collection) and AZURE_DEVOPS_AUTH_METHOD=pat' : null,
    suite.uppercaseDir ? `non-canonical skills folder .claude/${suite.skillsDir.split('/').pop()} — canonical is .claude/skills` : null,
    steering.nonCanonical.length ? `non-canonical steering names: ${steering.nonCanonical.join(', ')}` : null,
    steering.duplicates.length ? `duplicate steering layers: ${steering.duplicates.join(', ')}` : null,
    learning.legacyHeadings.length ? `legacy learning-file headings: ${learning.legacyHeadings.join(', ')}` : null,
    mcp.inlineSecrets ? '.mcp.json appears to contain an inline secret' : null,
    mcp.docx.legacyWord.length ? `legacy word MCP server (office-word-mcp-server) superseded by docx: ${mcp.docx.legacyWord.join(', ')} — /sync-skills --apply migrates it` : null,
    mcp.docx.present && !mcp.docx.pinned ? 'docx MCP entry is missing the `--with mcp<2` pin — the server will crash on import' : null,
    testing.legacyNames.length ? `legacy testing folder names: ${testing.legacyNames.join(', ')}` : null,
    git.isRepo && git.dirty ? 'git working tree is dirty (Mode C requires clean or explicit acceptance)' : null,
  ].filter(Boolean),
}, args);
