#!/usr/bin/env node
// selftest-config-inventory.mjs — regression harness for config-inventory.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing self-test means the inventory's
// reference scan cannot be trusted, and the skill must not delete ANY configuration file.
//
// Run: node selftest-config-inventory.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { inventory, reconcile, helperState, topLevelUseIndex } from './config-inventory.mjs';

const eq9 = (p, what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(what + ': ' + JSON.stringify(got) + ' != ' + JSON.stringify(want)); };

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (t) => path.join(here, 'fixtures', 'config-inventory', t);
const cfg = (r, name) => r.configs.find((c) => c.basename === name);
const refKinds = (c) => c.references.map((x) => x.kind + ':' + x.file + (x.line ? ':' + x.line : '') + (x.inComment ? '#' : '')).sort();

const cases = [];
const fail = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}

const before = inventory({ root: fx('before'), automationRoot: 'Testing/Automation' });
const after = inventory({ root: fx('after'), automationRoot: 'Testing/Automation' });

/* 1 — every config is found; references from a package script, a CI file and docs are attributed to the right config. */
{
  const p = [];
  if (before.verdict !== 'multiple') p.push('verdict ' + before.verdict + ' != multiple');
  if (before.counts.configs !== 4) p.push('configs ' + before.counts.configs + ' != 4');
  if (before.shared !== 'Testing/Automation/playwright.config.ts') p.push('shared config not identified: ' + before.shared);
  const us = cfg(before, 'playwright.us-1234.config.ts');
  if (!us) p.push('per-story config not found');
  else {
    if (!us.references.some((r) => r.kind === 'package-script' && r.script === 'test:us1234')) p.push('package.json script reference missing for the per-story config');
    if (us.mergeable !== 'candidate') p.push('per-story config mergeable ' + us.mergeable + ' != candidate');
  }
  const ci = cfg(before, 'playwright.ci.config.ts');
  if (!ci) p.push('CI config not found');
  else {
    if (!ci.references.some((r) => r.kind === 'ci' && /e2e\.yml$/.test(r.file))) p.push('workflow reference missing for the CI config');
    if (!ci.references.some((r) => r.kind === 'docs' && /RUNBOOK\.md$/.test(r.file))) p.push('docs reference missing for the CI config');
    if (!ci.references.some((r) => r.kind === 'package-script')) p.push('package script reference missing for the CI config');
  }
  check('1 configs found and references attributed (package script, CI, docs)', p, { us: us && refKinds(us), ci: ci && refKinds(ci) });
}

/* 2 — a candidate nothing refers to is deletable; a referenced candidate is not. */
{
  const p = [];
  if (!before.deletable.includes('Testing/Automation/playwright.legacy.config.ts')) p.push('orphaned legacy config not listed as deletable');
  if (before.deletable.includes('Testing/Automation/playwright.us-1234.config.ts')) p.push('a config with live references was listed as deletable');
  if (before.deletable.includes('Testing/Automation/playwright.config.ts')) p.push('the shared config was listed as deletable');
  check('2 only an unreferenced candidate is deletable', p, { deletable: before.deletable });
}

/* 3 — settings the shared file cannot reproduce silently mark a config blocked; blocked is never deletable. */
{
  const p = [];
  const ci = cfg(before, 'playwright.ci.config.ts');
  const settings = ci ? ci.blocking.map((b) => b.setting) : [];
  for (const s of ['globalSetup', 'webServer', 'custom reporter with options']) if (!settings.includes(s)) p.push('blocking setting not detected: ' + s);
  if (ci && ci.mergeable !== 'blocked') p.push('CI config mergeable ' + ci.mergeable + ' != blocked');
  const shared = cfg(before, 'playwright.config.ts');
  if (shared && shared.blocking.length) p.push('the shared config must not carry blocking settings (it may set anything)');
  const orphanBlocked = inventory({ root: fx('before'), automationRoot: 'Testing/Automation' });
  // simulate: a blocked config with zero references must still not be deletable
  const legacyBlockedLike = orphanBlocked.configs.filter((c) => c.mergeable === 'blocked' && c.references.length === 0);
  for (const c of legacyBlockedLike) if (orphanBlocked.deletable.includes(c.file)) p.push('a blocked config with no references was listed as deletable: ' + c.file);
  check('3 blocking settings keep a config out of the merge', p, { settings });
}

/* 4 — after every reference is rewritten, the per-story config becomes deletable; the CI config stays. */
{
  const p = [];
  const us = cfg(after, 'playwright.us-1234.config.ts');
  if (!us) p.push('per-story config missing from the after tree');
  else if (us.references.length !== 0) p.push('references still found after the rewrite: ' + refKinds(us).join(', '));
  if (!after.deletable.includes('Testing/Automation/playwright.us-1234.config.ts')) p.push('per-story config not deletable after the rewrite');
  if (after.deletable.includes('Testing/Automation/playwright.ci.config.ts')) p.push('the still-referenced, blocked CI config was listed as deletable');
  check('4 zero references after the rewrite → deletable', p, { deletable: after.deletable });
}

/* 5 — a mention inside a YAML comment or a Markdown code fence still counts (deletion stays conservative). */
{
  const p = [];
  const us = cfg(before, 'playwright.us-1234.config.ts');
  const comment = us && us.references.find((r) => r.kind === 'ci' && r.inComment);
  if (!comment) p.push('the workflow comment mentioning the per-story config was not counted');
  const ci = cfg(before, 'playwright.ci.config.ts');
  const fence = ci && ci.references.find((r) => r.kind === 'docs' && /npx playwright test/.test(r.text));
  if (!fence) p.push('the Markdown code-fence reference was not counted');
  check('5 comments and code fences count as references', p, {});
}

/* 6 — no config → none; only the shared file → single, with nothing deletable. */
{
  const p = [];
  const none = inventory({ root: fx('none'), automationRoot: 'Testing/Automation' });
  if (none.verdict !== 'none' || none.configs.length) p.push('empty tree verdict ' + none.verdict);
  const single = inventory({ root: fx('single'), automationRoot: 'Testing/Automation' });
  if (single.verdict !== 'single') p.push('single tree verdict ' + single.verdict);
  if (single.deletable.length) p.push('single tree lists something deletable');
  if (single.shared !== 'Testing/Automation/playwright.config.ts') p.push('single tree shared ' + single.shared);
  check('6 none / single verdicts', p, {});
}

/* 7 — CLI: always exit 0, one JSON object on stdout, --help documented. */
{
  const p = [];
  const script = path.join(here, 'config-inventory.mjs');
  const call = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const r = call(['--root', fx('before')]);
  if (r.status !== 0) p.push('exit ' + r.status + ' != 0');
  try { const o = JSON.parse(r.stdout); if (o.readOnly !== true) p.push('payload does not declare readOnly'); } catch { p.push('stdout is not a single JSON object'); }
  const h = call(['--help']);
  try { const o = JSON.parse(h.stdout); if (!/deletable/.test(JSON.stringify(o.notes))) p.push('--help does not explain deletable[]'); } catch { p.push('--help is not JSON'); }
  check('7 CLI exit code and payload shape', p, {});
}

/* 8 — RECONCILE on a throw-away project with every supported problem: dry-run lists them with precise statuses and changes
   nothing; --apply backs the originals up, fixes only the supported shapes, leaves the unfamiliar ones as conflicts (an
   env file forcing headless, a persistent profile) and a second apply changes nothing (idempotent). */
{
  const p = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-reconcile-'));
  try {
    const auto = path.join(root, 'Testing', 'Automation');
    fs.mkdirSync(path.join(auto, 'helpers'), { recursive: true });
    fs.writeFileSync(path.join(auto, 'timeouts.ts'), ['export const TIMEOUTS = {', '  test: { default: 90_000, long: 180_000 },', '  expect: 10_000,', '  action: 15_000,', '  navigation: 90_000, // exception: the SSO redirect chain takes 70-80 s (calibrated phase 2)', '  hook: 60_000,', '  step: { default: 30_000, long: 120_000 },', '  watchdog_grace: 60_000,', '} as const;', ''].join('\n'));
    const config = ["import { defineConfig } from '@playwright/test';", "import { TIMEOUTS } from './timeouts';", 'export default defineConfig({', '  retries: 2,', '  timeout: TIMEOUTS.test.default,', '  use: {', '    headless: true,', '    actionTimeout: 0,', '  },', '});', ''].join('\n');
    fs.writeFileSync(path.join(auto, 'playwright.config.ts'), config);
    fs.writeFileSync(path.join(auto, '.env'), 'BASE_URL=https://app.example.test\nPW_HEADLESS=1\n');
    fs.writeFileSync(path.join(auto, 'helpers', 'login.ts'), 'export const ctx = (b) => b.launchPersistentContext("C:/profile");\n');
    for (const h of ['steps', 'progress-reporter', 'admission', 'network-guard', 'rate-limit']) fs.writeFileSync(path.join(auto, 'helpers', h + '.ts'), '// ' + h + '\n');
    fs.rmSync(path.join(auto, 'helpers', 'admission.ts'));
    const st = (r, key) => (r.settings.find((s) => s.key === key) || {}).status;
    const dry = reconcile({ root, automationRoot: 'Testing/Automation', env: {} });
    if (dry.outcome !== 'CHANGES_NEEDED' || dry.changes.length) p.push('dry-run ' + JSON.stringify([dry.outcome, dry.changes]));
    if (st(dry, 'actionTimeout') !== 'unbounded-operation' || st(dry, 'navigationTimeout') !== 'unbounded-operation') p.push('unbounded operations ' + JSON.stringify(dry.settings.filter((s) => /Timeout/.test(s.key))));
    if (st(dry, 'globalTimeout') !== 'no-suite-timeout') p.push('a missing globalTimeout is informational, not an unbounded operation: ' + st(dry, 'globalTimeout'));
    if (st(dry, 'retries') !== 'protection-disabled' || st(dry, 'headless') !== 'protection-disabled' || st(dry, 'helpers/admission') !== 'protection-disabled' || st(dry, 'TIMEOUTS.stall') !== 'protection-disabled') p.push('disabled protections ' + JSON.stringify(dry.settings));
    if (st(dry, 'TIMEOUTS.navigation') !== 'exception-approved') p.push('a documented exception must be approved: ' + st(dry, 'TIMEOUTS.navigation'));
    if (!dry.conflicts.some((c) => /\.env$/.test(c.file || '') && c.line === 2) || !dry.conflicts.some((c) => /login\.ts$/.test(c.file || ''))) p.push('conflicts ' + JSON.stringify(dry.conflicts));
    if (fs.readFileSync(path.join(auto, 'playwright.config.ts'), 'utf8') !== config) p.push('a dry run changed the config');
    const noRoot = reconcile({ root, automationRoot: 'Testing/Automation', apply: true, env: {} });
    if (noRoot.outcome !== 'BLOCKED') p.push('--apply without --results-root must be BLOCKED: ' + noRoot.outcome);
    const rr = 'Testing/Automation/reports/US-1';
    const ap = reconcile({ root, automationRoot: 'Testing/Automation', resultsRoot: rr, apply: true, env: {}, now: new Date('2026-10-26T10:00:00Z') });
    const cfgAfter = fs.readFileSync(path.join(auto, 'playwright.config.ts'), 'utf8');
    if (!/retries: 0/.test(cfgAfter) || !/actionTimeout: TIMEOUTS\.action/.test(cfgAfter) || !/navigationTimeout: TIMEOUTS\.navigation/.test(cfgAfter) || /headless: true/.test(cfgAfter)) p.push('config after apply:\n' + cfgAfter);
    const tAfter = fs.readFileSync(path.join(auto, 'timeouts.ts'), 'utf8');
    if (!/\bstall\s*:/.test(tAfter) || !/\bdiagnostics\s*:/.test(tAfter) || !/navigation: 90_000, \/\/ exception/.test(tAfter)) p.push('timeouts.ts after apply:\n' + tAfter);
    if (!fs.existsSync(path.join(auto, 'helpers', 'admission.ts'))) p.push('the missing helper was not installed');
    if (fs.readFileSync(path.join(auto, '.env'), 'utf8') !== 'BASE_URL=https://app.example.test\nPW_HEADLESS=1\n') p.push('an env file was edited');
    const bk = path.join(root, rr, 'artifacts', 'reconcile', '2026-10-26T10-00-00-000Z');
    if (ap.outcome !== 'PARTIAL' || fs.readFileSync(path.join(bk, 'Testing', 'Automation', 'playwright.config.ts'), 'utf8') !== config || !fs.existsSync(path.join(bk, 'summary.md'))) p.push('backup / outcome ' + JSON.stringify([ap.outcome, ap.backup]));
    const again = reconcile({ root, automationRoot: 'Testing/Automation', resultsRoot: rr, apply: true, env: {}, now: new Date('2026-10-26T10:05:00Z') });
    if (again.changes.length) p.push('a second apply changed something: ' + JSON.stringify(again.changes));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  check('8 reconcile: precise statuses, dry-run writes nothing, apply backs up + fixes supported shapes, conflicts kept, idempotent', p, {});
}

/* 9 — 3.1 discovery and migration: a synced skill's fixture config is never found or chosen (the project's own is); two
   equal candidates are ambiguous (no shared, reconcile changes no config); a missing timeout goes into the TOP-LEVEL use,
   never a project's; an outdated helper is replaced only when its recorded template hash proves it untouched — a
   customised one is kept and reported; a second apply changes nothing. */
{
  const p = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-discovery-'));
  const cfgText = (extra = '') => ["import { defineConfig } from '@playwright/test';", "import { TIMEOUTS } from './timeouts';", 'export default defineConfig({', '  retries: 0,', '  projects: [{ name: "chromium", use: { actionTimeout: TIMEOUTS.action } }],', '  use: {', '    actionTimeout: TIMEOUTS.action,', '  },' + extra, '});', ''].join('\n');
  try {
    const auto = path.join(root, 'Testing', 'Automation');
    const skillFx = path.join(root, '.claude', 'skills', 'some-skill', 'scripts', 'fixtures', 'a');
    fs.mkdirSync(skillFx, { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'skills', 'some-skill', 'SKILL.md'), '---\nname: some-skill\n---\n');
    fs.writeFileSync(path.join(skillFx, 'playwright.config.ts'), cfgText());
    fs.mkdirSync(path.join(auto, 'helpers'), { recursive: true });
    fs.writeFileSync(path.join(auto, 'playwright.config.ts'), cfgText());
    fs.writeFileSync(path.join(auto, 'timeouts.ts'), ['export const TIMEOUTS = {', '  test: { default: 90_000 },', '  action: 15_000,', '  navigation: 30_000,', '  stall: { silence: 30_000 },', '  diagnostics: { keep: 5 },', '  admission: { max_wait: 600_000 },', '  rate_limit: { cooldown: 60_000 },', '} as const;', ''].join('\n'));
    const inv = inventory({ root, automationRoot: 'Testing/Automation' });
    eq9(p, 'the project config is shared', [inv.shared, inv.sharedSource], ['Testing/Automation/playwright.config.ts', 'automation root']);
    if (inv.configs.some((c) => /\.claude/.test(c.file))) p.push('a skill fixture config was listed: ' + inv.configs.map((c) => c.file).join(', '));
    eq9(p, 'verdict single', inv.verdict, 'single');
    // the missing navigationTimeout goes into the TOP-LEVEL use (the project use already has actionTimeout)
    const rr = 'Testing/Automation/reports/US-1';
    const a1 = reconcile({ root, automationRoot: 'Testing/Automation', resultsRoot: rr, apply: true, env: {}, now: new Date('2026-10-28T10:00:00Z') });
    const after = fs.readFileSync(path.join(auto, 'playwright.config.ts'), 'utf8');
    const topUse = after.slice(after.indexOf('  use: {'));
    if (!/navigationTimeout: TIMEOUTS\.navigation/.test(topUse) || /projects:[^\n]*navigationTimeout/.test(after)) p.push('navigationTimeout not inserted into the top-level use only:\n' + after);
    // helpers: absent → installed with a stamped marker
    const steps = path.join(auto, 'helpers', 'steps.ts');
    const installed = fs.existsSync(steps) ? fs.readFileSync(steps, 'utf8') : '';
    if (!/@link-qc-5-template steps \d+\.\d+\.\d+ sha256=[0-9a-f]{64}/.test(installed)) p.push('the installed helper carries no stamped template marker');
    eq9(p, 'the installed copy is current', helperState(installed, fs.readFileSync(path.join(here, '..', 'assets', 'steps.template.ts'), 'utf8'), 'steps').state, 'current');
    // an untouched copy of an OLDER template version (its recorded hash matches its content) → replaced, backed up
    const oldBody = '// helpers/steps.ts — an older template body\nexport const step = () => null;\n';
    const shaOf = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    fs.writeFileSync(steps, '// @link-qc-5-template steps 3.0.0 sha256=' + shaOf(oldBody) + '\n' + oldBody);
    // a CUSTOMISED older copy (content changed after install) → kept, reported
    const pr = path.join(auto, 'helpers', 'progress-reporter.ts');
    const prBody = '// helpers/progress-reporter.ts — older\nexport default class X {}\n';
    fs.writeFileSync(pr, '// @link-qc-5-template progress-reporter 3.0.0 sha256=' + shaOf(prBody) + '\n' + prBody + '// a local change\n');
    const a2 = reconcile({ root, automationRoot: 'Testing/Automation', resultsRoot: rr, apply: true, env: {}, now: new Date('2026-10-28T10:05:00Z') });
    if (!/@link-qc-5-template steps \d+\.\d+\.\d+ sha256=/.test(fs.readFileSync(steps, 'utf8')) || /an older template body/.test(fs.readFileSync(steps, 'utf8'))) p.push('the untouched older helper was not upgraded');
    if (!a2.backup || !fs.existsSync(path.join(root, a2.backup, 'Testing', 'Automation', 'helpers', 'steps.ts'))) p.push('the upgraded helper was not backed up');
    if (!/a local change/.test(fs.readFileSync(pr, 'utf8'))) p.push('a customised helper was overwritten');
    if (!a2.conflicts.some((c) => /progress-reporter/.test(c.file || '') && /modified after install/.test(c.reason))) p.push('the customised helper is not reported: ' + JSON.stringify(a2.conflicts));
    const a3 = reconcile({ root, automationRoot: 'Testing/Automation', resultsRoot: rr, apply: true, env: {}, now: new Date('2026-10-28T10:10:00Z') });
    if (a3.changes.length) p.push('a third apply changed something: ' + JSON.stringify(a3.changes));
    // two equal candidates at the project root and none in the automation root → ambiguous, no shared, no config edit
    fs.rmSync(path.join(auto, 'playwright.config.ts'));
    fs.writeFileSync(path.join(root, 'playwright.config.ts'), cfgText());
    fs.writeFileSync(path.join(root, 'playwright.config.js'), cfgText());
    const amb = inventory({ root, automationRoot: 'Testing/Automation' });
    eq9(p, 'ambiguous, never the first', [amb.shared, amb.ambiguous.length], [null, 2]);
    const ra = reconcile({ root, automationRoot: 'Testing/Automation', env: {} });
    if (!ra.conflicts.some((c) => /ambiguous/.test(c.reason))) p.push('reconcile does not report the ambiguous config');
    if (ra.planned.some((x) => /playwright\.config/.test(x.file))) p.push('reconcile planned a config edit on an ambiguous config');
    eq9(p, 'top-level use index ignores a project use', topLevelUseIndex(cfgText()) === cfgText().indexOf('  use: {') + '  use: {'.length - 1, true);
    void a1;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  check('9 discovery skips skill fixtures, ambiguity reported, top-level use only, hash-verified helper upgrade, idempotent', p, {});
}

const out = {
  tool: 'selftest-config-inventory',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'config-inventory.mjs disagrees with its own fixtures. Do not delete any configuration file on its word.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
