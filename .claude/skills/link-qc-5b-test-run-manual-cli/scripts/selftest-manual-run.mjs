#!/usr/bin/env node
// selftest-manual-run.mjs — the 5b-only harness (NOT mirrored): renders fixtures/manual-run/ — a story
// whose phase 1 was written by skill 5 (automation) and whose phase 2 was written by this skill
// (manual run through playwright-cli) — through the MIRRORED renderer and checks what a manual
// phase must look like on the shared page.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a test harness, not one of the
// read-only reporting scripts. A failing case means a manual phase would render wrong: do not
// deliver a page until it passes again (the markdown reports are still the deliverable).
//
// Every case works on a temporary copy of scripts/fixtures/manual-run/automation/ so the fixture
// and the relative screenshot / reply links stay untouched. Run: node selftest-manual-run.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { render, CLASSIFICATIONS } from './render-run-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (...p) => path.join(here, 'fixtures', 'manual-run', ...p);
const norm = (s) => s.replace(/\r\n?/g, '\n');
const read = (p) => norm(fs.readFileSync(p, 'utf8'));
const SCRIPT = path.join(here, 'render-run-report.mjs');
const STORY = path.join('reports', 'US-2000-ask-assistant');
const REPORT = fx('automation', STORY, 'TEST-RUN-REPORT-ask-assistant.md');
const BUGS = fx('automation', STORY, 'BUG-REPORT-ask-assistant.md');
const GOLDEN = fx('golden', 'TEST-RUN-REPORT-ask-assistant.html');

const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
function tmpCopy(mutate = (s) => s, mutateBugs = (s) => s) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-manual-run-'));
  fs.cpSync(fx('automation'), dir, { recursive: true });
  const report = path.join(dir, STORY, 'TEST-RUN-REPORT-ask-assistant.md');
  const bugs = path.join(dir, STORY, 'BUG-REPORT-ask-assistant.md');
  fs.writeFileSync(report, mutate(read(REPORT)));
  fs.writeFileSync(bugs, mutateBugs(read(BUGS)));
  return { dir, story: path.join(dir, STORY), report, bugs, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const wkinds = (r) => r.payload.warnings.map((w) => w.kind);
const section = (html, re) => (html.match(re) || [''])[0];

/* 1 — golden: byte-for-byte, PASS, no warnings, no mismatches — a manual phase after an automation phase in the same files. */
{
  const r = render({ reportPath: REPORT, root: here });
  const p = [];
  if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' != PASS: ' + r.payload.gateReason);
  if (r.payload.warnings.length) p.push('warnings on the fixture: ' + wkinds(r).join(','));
  if (r.payload.mismatches.length) p.push('mismatches on the fixture: ' + JSON.stringify(r.payload.mismatches));
  if (!fs.existsSync(GOLDEN)) p.push('golden page missing — render it with the command in fixtures/manual-run/README.md');
  else if (norm(r.html || '') !== read(GOLDEN)) p.push('page differs from golden');
  if (r.payload.counts.phases !== 2) p.push('expected 2 phases');
  check('1 golden page — skill-5 phase 1 + manual phase 2', p, { bytes: (r.html || '').length });
}

/* 2 — the manual phase is the latest: its counts, its PARTIAL bucket, its outcome and its Run bullets reach the page as written. */
{
  const r = render({ reportPath: REPORT, root: here });
  const p = []; const html = r.html || '';
  const c = r.payload.counts.latest;
  if (!c || c.passed !== 2 || c.failed !== 1 || c.partial !== 1 || c.total !== 4) p.push('latest counts wrong: ' + JSON.stringify(c));
  if (r.payload.document.status !== 'FAILURES') p.push('status ' + r.payload.document.status + ' != FAILURES');
  for (const s of ['manual run — playwright-cli 0.9.2 (skill 5b)', 'headed · one session per account', 'A1 attended', '— (manual run)', '00:28:40 (manual run · one session per account)', 'not authorized · 0 made · 0 cleaned up · 0 left']) if (!html.includes(s)) p.push('Run bullet missing on the page: ' + s);
  if (html.includes('attended ·') && /password|passcode/i.test(section(html, /Login method[\s\S]{0,200}/))) p.push('a login method line carries a secret-shaped word');
  if (!/PARTIAL — human step pending/.test(html)) p.push('PARTIAL status missing');
  check('2 manual phase counts, outcome and Run bullets', p, { latest: c });
}

/* 3 — `ai_rubric_failure` is a catalogue classification (no warning); the two repeats render as variants with their attempts; the reply files are plain evidence links that resolve. */
{
  const r = render({ reportPath: REPORT, root: here });
  const p = []; const html = r.html || '';
  if (!CLASSIFICATIONS.includes('ai_rubric_failure')) p.push('ai_rubric_failure not in the renderer catalogue');
  if (wkinds(r).includes('unknown-classification')) p.push('ai_rubric_failure warned');
  const card = section(html, /<[^>]*id="phase-2"[\s\S]*?(?=<[^>]*id="phase-|<[^>]*id="bugs|$)/);
  if (!/ai_rubric_failure/.test(card)) p.push('classification not rendered in the phase-2 card');
  if (!/manual-cli--none--r0/.test(card) || !/manual-cli--none--r1/.test(card)) p.push('the two repeats (variants r0 / r1) are not rendered');
  const replyLinks = (html.match(/manual-cli--none--r1\/reply\.md/g) || []).length;
  if (replyLinks < 1) p.push('reply.md link missing from the page');
  if (r.payload.counts.evidenceMissing) p.push('an evidence link (image or reply.md) does not resolve');
  const t = tmpCopy((s) => s.replace('| FAIL | positive | 00:04:30 | ai_rubric_failure |', '| FAIL | positive | 00:04:30 | ai_rubric |'));
  try { const r2 = render({ reportPath: t.report, root: here }); if (!wkinds(r2).includes('unknown-classification')) p.push('a misspelt classification did not warn'); } finally { t.cleanup(); }
  check('3 ai_rubric_failure row, repeats as variants, reply.md evidence', p, { replyLinks });
}

/* 4 — bugs across both skills: BUG-1 (skill 5, phase 1) resolved by the manual retest; BUG-2 in the assistant voice, open, linking reply.md. */
{
  const r = render({ reportPath: REPORT, root: here });
  const p = []; const html = r.html || '';
  const bugs = r.payload.document.bugs || r.payload.bugs || null;
  if (r.payload.counts.bugs !== 2) p.push('expected 2 bugs, got ' + r.payload.counts.bugs);
  if (!/resolved \(phase 2\)/.test(html)) p.push('BUG-1 is not shown resolved (phase 2)');
  if (!/The assistant doesn(?:&#39;|'|’)t state the receipt condition/.test(html)) p.push('BUG-2 title (assistant voice) missing');
  const b2 = section(html, /<[^>]*id="BUG-2"[\s\S]*?(?=<[^>]*id="BUG-|$)/);
  if (!/reply\.md/.test(b2)) p.push('BUG-2 card does not link reply.md');
  if (/password|secret|token/i.test(b2)) p.push('BUG-2 card carries a secret-shaped word');
  const t = tmpCopy((s) => s, (b) => b.replace('- **Status:** resolved (phase 2)', '- **Status:** open'));
  try { const r2 = render({ reportPath: t.report, root: here }); if (!r2.payload.mismatches.length) p.push('a bug status disagreeing with the phase table was not reported as a mismatch'); } finally { t.cleanup(); }
  check('4 bug numbering and statuses across skills 5 and 5b', p, { bugs: bugs ? 'payload' : 'counts' });
}

/* 5 — CLI: --strict exits 0 on the fixture; a phase-2 run file missing warns (never blocks); the renderer never writes without --write. */
{
  const p = [];
  const call = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: cwd || here });
  const r1 = call(['--report', REPORT, '--strict']);
  if (r1.status !== 0) p.push('--strict exit ' + r1.status + ' on the fixture: ' + r1.stdout.slice(0, 300));
  const t = tmpCopy();
  try {
    fs.rmSync(path.join(t.story, '.runs', 'phase-2.json'));
    const r2 = render({ reportPath: t.report, root: here });
    if (!wkinds(r2).includes('run-file-missing')) p.push('missing phase-2 run file did not warn');
    if (r2.payload.gate === 'BLOCKED') p.push('a missing run file must never BLOCK');
    if (fs.existsSync(path.join(t.story, 'TEST-RUN-REPORT-ask-assistant.html'))) p.push('dry run wrote a page');
  } finally { t.cleanup(); }
  check('5 CLI strict exit, run-file-missing warns, dry run writes nothing', p, {});
}

const out = {
  tool: 'selftest-manual-run',
  skill: path.basename(path.resolve(here, '..')),
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'A manual phase would render wrong. Do not deliver a page until this passes; the markdown reports remain the deliverable.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
