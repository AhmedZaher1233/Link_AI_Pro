#!/usr/bin/env node
// READ-ONLY preflight for 1-generate-update-testing-structure.
// Captures the ORIGINAL project state and classifies NEW vs EXISTING before anything is changed.
// Usage: node preflight.mjs [--root <path>] [--pretty]
// Exit code is always 0; every result lives in the JSON payload.
import path from 'node:path';
import { parseArgs, print, scanGit, scanSuite, scanTesting, scanSteering, scanLearning, scanMcp, scanToolchain, scanManifest, scanPat, SKILLS } from './lib.mjs';

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
const pat = scanPat(); // existence only — the value is never read into the output

// Classification markers. M5 (skills installed) is reported but deliberately NOT used for
// classification: the skill itself installs skills, so it must not change the evidence it judges.
const markers = {
  M1: { label: 'Testing root exists', present: testing.rootExists || testing.legacyNames.length > 0, evidence: testing.rootExists ? `${testing.rootName}/ present` : (testing.legacyNames[0] || null) },
  M2: { label: 'Automation code exists', present: testing.specFileCount > 0 || testing.pageObjectDirs > 0, evidence: `${testing.specFileCount} spec files, ${testing.pageObjectDirs} pages/ dirs` },
  M3: { label: 'Playwright configured', present: Boolean(toolchain.playwrightConfig) || toolchain.playwrightDependency, evidence: toolchain.playwrightConfig || (toolchain.playwrightDependency ? '@playwright/test in package.json' : null) },
  M4: { label: 'MCP configured', present: mcp.valid && mcp.servers.some((s) => ['playwright', 'azure-devops', 'word'].includes(s)), evidence: mcp.servers.join(', ') || null },
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
  markers, git, suite, testing, steering, learning, mcp, toolchain, manifest, pat,
  warnings: [
    mcp.servers.includes('azure-devops') && !pat.persisted ? `${pat.name} is not set for this user — ask the user to run ${pat.setupScript} (masked prompt) and reopen the session` : null,
    suite.uppercaseDir ? `non-canonical skills folder .claude/${suite.skillsDir.split('/').pop()} — canonical is .claude/skills` : null,
    steering.nonCanonical.length ? `non-canonical steering names: ${steering.nonCanonical.join(', ')}` : null,
    steering.duplicates.length ? `duplicate steering layers: ${steering.duplicates.join(', ')}` : null,
    learning.legacyHeadings.length ? `legacy learning-file headings: ${learning.legacyHeadings.join(', ')}` : null,
    mcp.inlineSecrets ? '.mcp.json appears to contain an inline secret' : null,
    testing.legacyNames.length ? `legacy testing folder names: ${testing.legacyNames.join(', ')}` : null,
    git.isRepo && git.dirty ? 'git working tree is dirty (Mode C requires clean or explicit acceptance)' : null,
  ].filter(Boolean),
}, args);
