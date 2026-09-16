#!/usr/bin/env node
// Deterministic validation for 1-generate-update-testing-structure. READ-ONLY.
// Emits one row per validation item with PASS / FAIL / WARN / NOT_RUN and a reason.
// A row is PASS only when its check actually executed and succeeded.
//
// Usage: node validate-setup.mjs [--root <path>] [--pretty]
//          [--mcp playwright=PASS,azure-devops=FAIL,docx=NOT_RUN]   ← Claude-side MCP probe results
//          [--sync-report <path-to-json-from-sync-qa-skills --check>]
import path from 'node:path';
import { parseArgs, print, read, isFile, scanSuite, scanTesting, scanSteering, scanLearning, scanMcp, scanToolchain, scanManifest, scanPat, SKILLS, SYNC_COMMAND, STEERING_CANONICAL } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || process.cwd());
const rows = [];
const row = (item, status, reason) => rows.push({ item, status, reason });

const tc = scanToolchain(root);
row('Node.js', tc.node ? (/^v(1[89]|[2-9]\d)\./.test(tc.node) ? 'PASS' : 'WARN') : 'FAIL', tc.node ? `${tc.node}${tc.nodeVersionFile ? ` (${tc.nodeVersionFile} present)` : ''}` : 'node not found on PATH');
row('NPM', tc.npm && tc.packageJson && tc.packageJsonValid ? 'PASS' : (tc.npm ? 'WARN' : 'FAIL'), tc.npm ? (tc.packageJson ? (tc.packageJsonValid ? `npm ${tc.npm}, package.json parses` : 'package.json does not parse') : 'no package.json') : 'npm not found');
row('Playwright', tc.playwright && tc.playwrightDependency ? 'PASS' : (tc.playwright || tc.playwrightDependency ? 'WARN' : 'FAIL'), tc.playwright ? `${tc.playwright}${tc.playwrightDependency ? '' : ' — not in package.json'}` : (tc.playwrightDependency ? 'dependency declared but npx playwright not runnable' : 'not installed'));
row('Playwright cfg', tc.playwrightConfig ? (tc.testDir && tc.testDirExists === false ? 'WARN' : 'PASS') : 'FAIL', tc.playwrightConfig ? `${tc.playwrightConfig}; testDir=${tc.testDir ?? 'default'}${tc.testDirExists === false ? ' (folder missing)' : ''}` : 'no playwright.config.*');

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
const docxUnpinned = m.valid && m.docx.present && !m.docx.pinned;
row('.mcp.json', !m.exists ? 'FAIL' : !m.valid ? 'FAIL' : m.inlineSecrets ? 'FAIL' : docxUnpinned ? 'FAIL' : (m.missing.length || m.docx.legacyWord.length) ? 'WARN' : 'PASS', !m.exists ? 'missing' : !m.valid ? 'invalid JSON' : m.inlineSecrets ? 'inline secret detected — must use ${AZURE_DEVOPS_PAT_B64}' : `servers: ${m.servers.join(', ')}` + (m.missing.length ? `; missing: ${m.missing.join(', ')}` : '') + (docxUnpinned ? '; docx args missing `--with mcp<2` — add "--with", "mcp<2" before the final docx-mcp-server arg (unpinned mcp 2.x breaks the server import)' : '') + (m.docx.legacyWord.length ? `; legacy word server superseded by docx: ${m.docx.legacyWord.join(', ')} — run /sync-skills or remove it` : ''));

// PAT: existence only (user-level env var / shell profile). The value is never read, printed or compared.
const pat = scanPat();
row('PAT env var', m.servers.includes('azure-devops') ? (pat.persisted ? 'PASS' : 'FAIL') : (pat.persisted ? 'PASS' : 'WARN'), pat.persisted ? `${pat.name} set (${pat.scope})${pat.inProcess ? '' : '; not visible to this process yet — reopen the session'}` : `${pat.name} not set — user runs ${pat.setupScript} (masked prompt), then reopens the session`);

// MCP reachability is probed by Claude through the MCP tools; results are passed in. Absent → NOT_RUN, never PASS.
const probes = Object.fromEntries(String(args.mcp || '').split(',').filter(Boolean).map((kv) => kv.split('=')));
for (const [server, label] of [['playwright', 'Playwright MCP'], ['azure-devops', 'Azure DevOps MCP'], ['docx', 'Docx MCP']]) {
  const p = (probes[server] || 'NOT_RUN').toUpperCase();
  const configured = server === 'docx' ? m.docx.present : m.servers.includes(server);
  row(label, ['PASS', 'FAIL', 'WARN'].includes(p) ? p : 'NOT_RUN', configured ? (p === 'NOT_RUN' ? 'configured; reachability not probed this run' : `probe ${p}`) : 'not configured');
}

const su = scanSuite(root);
row('QA Skills', su.missing.length || su.invalid.length ? 'FAIL' : (su.uppercaseDir ? 'WARN' : 'PASS'), `${su.present.length}/${SKILLS.length} present` + (su.missing.length ? `; missing: ${su.missing.join(', ')}` : '') + (su.invalid.length ? `; invalid front-matter: ${su.invalid.join(', ')}` : '') + (su.uppercaseDir ? `; folder is .claude/${su.skillsDir.split('/').pop()} (canonical: .claude/skills)` : ''));
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
