#!/usr/bin/env node
'use strict';
// Launcher for the OPTIONAL `azure-devops-attachments` MCP server — cloud Azure DevOps projects only.
//
// Copied by link-qc-1-generate-update-testing-structure (Mode B / C / new project) from
// assets/mcp-launchers/azure-devops-attachments.cjs into <project>/.claude/mcp-launchers/. Never edited by hand and
// never updated by /sync-skills (that copies skill folders only): validate-setup.mjs reports an outdated copy and
// skill 1 Mode B replaces it.
//
// Why: Microsoft's @azure-devops/mcp (the `azure-devops` entry) can download work-item attachments but cannot upload
// one from disk. This launcher starts @tiberriver256/mcp-server-azure-devops (pinned) against the SAME cloud
// organization, so skills 8 and 9 can attach evidence screenshots with create_work_item_attachment (and remove one
// they added in error with delete_work_item_attachment). Those two tools are the only ones the skills use from it.
// Self-hosted projects already run that server as `azure-devops` and need no launcher.
//
// Secrets: the official server takes AZURE_DEVOPS_PAT_B64 = base64(":" + PAT); this server needs the plain PAT in
// AZURE_DEVOPS_PAT. If AZURE_DEVOPS_PAT is already set (the user-run set-azure-devops-pat script stores both) it is
// used unchanged; otherwise it is derived here from AZURE_DEVOPS_PAT_B64, in memory only. The token is never printed,
// logged or written. Required env from the .mcp.json entry: AZURE_DEVOPS_ORG_URL (https://dev.azure.com/{ORG_NAME}),
// AZURE_DEVOPS_AUTH_METHOD=pat, AZURE_DEVOPS_DEFAULT_PROJECT.
const { spawn } = require('node:child_process');

const PACKAGE = '@tiberriver256/mcp-server-azure-devops@0.1.49';
const env = { ...process.env };

if (!env.AZURE_DEVOPS_PAT && env.AZURE_DEVOPS_PAT_B64) {
  const decoded = Buffer.from(env.AZURE_DEVOPS_PAT_B64, 'base64').toString('utf8');
  env.AZURE_DEVOPS_PAT = decoded.startsWith(':') ? decoded.slice(1) : env.AZURE_DEVOPS_PAT_B64;
}
if (!env.AZURE_DEVOPS_PAT) {
  process.stderr.write('azure-devops-attachments: neither AZURE_DEVOPS_PAT nor AZURE_DEVOPS_PAT_B64 is set for this process — run scripts/set-azure-devops-pat.ps1 / .sh, then fully quit VS Code (all windows) and relaunch\n');
  process.exit(1);
}
if (!env.AZURE_DEVOPS_ORG_URL) {
  process.stderr.write('azure-devops-attachments: AZURE_DEVOPS_ORG_URL is missing from the .mcp.json entry (expected https://dev.azure.com/{ORG_NAME})\n');
  process.exit(1);
}
env.AZURE_DEVOPS_AUTH_METHOD = env.AZURE_DEVOPS_AUTH_METHOD || 'pat';

const win = process.platform === 'win32';
const child = spawn('npx', ['-y', PACKAGE], { stdio: 'inherit', env, shell: win, windowsHide: true });
child.on('error', (e) => { process.stderr.write(`azure-devops-attachments: cannot start npx — ${e.message}\n`); process.exit(1); });
child.on('exit', (code, signal) => process.exit(signal ? 1 : code === null ? 1 : code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
