#!/usr/bin/env node
// selftest-config-inventory.mjs — regression harness for config-inventory.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. A failing self-test means the inventory's
// reference scan cannot be trusted, and the skill must not delete ANY configuration file.
//
// Run: node selftest-config-inventory.mjs [--pretty]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inventory } from './config-inventory.mjs';

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
