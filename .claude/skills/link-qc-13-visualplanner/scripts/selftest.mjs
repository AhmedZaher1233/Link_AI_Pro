#!/usr/bin/env node
// visualplanner self-test — zero dependencies, Node >= 18. Exits non-zero on any mismatch (by design).
//   node selftest.mjs [--pretty]
// Covers page-tool.mjs (build, carry, check) on throw-away pages in a temp folder, and the Save logic of
// assets/review-system.js (register by column name, plan block) run in a sandbox.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'page-tool.mjs');
const ASSET_JS = fs.readFileSync(path.join(HERE, '..', 'assets', 'review-system.js'), 'utf8');
const results = [];
const expect = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });

const REGISTER = [
  '# Clarification register', '',
  '| # | Question | Why it Matters | Owner | Answer | Status | Skill | User | Updated in Spec | Last Updated Date |',
  '|---|---|---|---|---|---|---|---|---|---|',
  '| 12 | Retention days? | why | PO |  | Open | clarify |  | No |  |',
  '| 25 | Missing record allowed? | why | PO |  | Open | clarify |  | No |  |', '',
].join('\n');

function draft({ target = 'register', sourceFile = 'plan.md', reg = '12', extra = '', css = '', bars = true } = {}) {
  const bar = (id) => bars ? `<div class="review-bar" data-section="${id}"><div class="review-actions">` +
    '<button class="review-btn review-up"></button><button class="review-btn review-down"></button>' +
    '<button class="review-btn review-comment-btn"></button></div><div class="review-comment-box" style="display:none">' +
    '<textarea class="review-textarea"></textarea></div></div>' : '';
  const regAttr = reg === null ? '' : ` data-reg="${reg}"`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Audit — Plan Breakdown</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans&display=swap" rel="stylesheet">
<style>body{margin:0}${css}
/* @visualplanner:review-css */
</style></head>
<body>
<nav><div class="nav-actions"><button class="save-btn" id="saveReviewBtn" type="button"><span class="save-label">Save</span></button></div></nav>
<section class="section" id="section-1"><h2 class="section-title">One</h2>${extra}${bar('section-1')}</section>
<section class="section" id="section-2"><h2 class="section-title">Questions</h2>
<label class="answerer"><input class="answerer-input" id="answererInput" type="text"></label>
<div class="question-card" data-qid="Q12" data-answer="input"${regAttr}><p class="question-text">Retention days?</p><input class="answer-input" type="text"></div>
${bar('section-2')}</section>
<div class="float-actions"><button class="copy-review-btn copy-answers-btn" id="copyAnswersBtn"><span class="review-count" id="answerCount">0</span></button>
<button class="copy-review-btn" id="copyReviewBtn"><span class="review-count" id="reviewCount">0</span></button></div>
<div class="toast" id="toast" role="status"></div>
<script type="application/json" id="vp-saved-state">{}</script>
<script>
(function () {
  // Snapshot of the page as served; Save writes it back with the review state inside.
  var PRISTINE_HTML = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
  var PAGE_SLUG = 'audit';
  var FEATURE_DIR = 'specs/008-audit';
  var ANSWER_TARGET = '${target}';
  var SOURCE_FILE = '${sourceFile}';
  var root = document.documentElement;

  /* @visualplanner:review-js */
})();
</script>
</body>
</html>
`;
}

function tool(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  let payload = null;
  try { payload = JSON.parse(r.stdout); } catch (e) { /* reported below */ }
  return { code: r.status, payload, stderr: r.stderr };
}
const ids = (p) => (p && p.errors ? p.errors.map((e) => e.id) : []);

function workspace(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-selftest-'));
  const feature = path.join(dir, '008-audit');
  fs.mkdirSync(feature);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(feature, name), text);
  return { dir, feature };
}

// --- page-tool: build, carry, check -------------------------------------------------------------------------
{
  const { dir, feature } = workspace({ 'clarification_register.md': REGISTER, 'plan.md': '# Plan\n' });
  const page = path.join(feature, 'audit-breakdown.html');
  const d1 = path.join(dir, 'draft.html');
  fs.writeFileSync(d1, draft());
  let r = tool(['build', '--draft', d1, '--page', page]);
  expect('1 build: valid register draft passes and is written', r.code === 0 && r.payload.written, r.payload);
  const built = fs.existsSync(page) ? fs.readFileSync(page, 'utf8') : '';
  expect('1 build: both assets inserted, placeholders gone',
    built.includes('function fillRegister') && built.includes('.review-bar') && !built.includes('@visualplanner:review'), null);
  r = tool(['check', '--page', page]);
  expect('1 check: the built page passes', r.code === 0, r.payload);

  // carry: the existing page holds reviewers' state; a rebuild keeps it and names orphans
  const state = { sections: { 'section-1': { reaction: 'up', comment: 'ok </script> here' }, 'section-9': { comment: 'gone' } },
    answers: { Q12: { text: '365' } }, filed: {}, updatedAt: 42 };
  fs.writeFileSync(page, built.replace(/(id="vp-saved-state">)\{\}/, (m, o) => o + JSON.stringify(state).replace(/</g, '\\u003c')));
  r = tool(['build', '--draft', d1, '--page', page]);
  const after = fs.readFileSync(page, 'utf8');
  expect('2 carry: rebuild keeps the saved comments and answers',
    r.code === 0 && r.payload.carried && r.payload.carried.sections === 2 && r.payload.carried.answers === 1 &&
    after.includes('"updatedAt":42') && after.includes('ok \\u003c/script> here'), r.payload);
  expect('2 carry: feedback for a section the new page lacks is reported',
    r.payload && r.payload.carried && r.payload.carried.orphans && r.payload.carried.orphans.sections.includes('section-9'), r.payload);

  // unreadable saved state: never overwritten without --force
  fs.writeFileSync(page, built.replace(/(id="vp-saved-state">)\{\}/, '$1{broken'));
  r = tool(['build', '--draft', d1, '--page', page]);
  expect('3 carry: unreadable state blocks the overwrite', r.code === 1 && !r.payload.written &&
    fs.readFileSync(page, 'utf8').includes('{broken') && ids(r.payload).includes('carry'), r.payload);
  r = tool(['build', '--draft', d1, '--page', page, '--force']);
  expect('3 carry: --force replaces it', r.code === 0 && r.payload.written, r.payload);

  const fails = [
    ['4 check: an unescaped <script> in source text fails', { extra: '<pre><code><script>alert(1)</script></code></pre>' }, 'scripts'],
    ['4 check: scroll-snap fails', { css: 'html{scroll-snap-type:y proximity}' }, 'scroll-snap'],
    ['4 check: a section without a review bar fails', { bars: false }, 'review-bar'],
    ["4 check: ANSWER_TARGET outside the three values fails", { target: 'spec' }, 'target'],
    ['4 check: data-reg naming no register row fails', { reg: '99' }, 'data-reg'],
    ["4 check: data-reg with ANSWER_TARGET 'plan' fails", { target: 'plan' }, 'data-reg'],
    ["4 check: 'plan' with a SOURCE_FILE that is not beside the page fails", { target: 'plan', reg: null, sourceFile: 'missing.md' }, 'source-file'],
  ];
  for (const [name, opts, id] of fails) {
    const p2 = path.join(dir, 'draft-' + id + '.html');
    const target = path.join(feature, 'fail-' + id + '.html');
    fs.writeFileSync(p2, draft(opts));
    r = tool(['build', '--draft', p2, '--page', target]);
    expect(name, r.code === 1 && !fs.existsSync(target) && ids(r.payload).includes(id), r.payload);
  }
  const p3 = path.join(dir, 'draft-plan.html');
  fs.writeFileSync(p3, draft({ target: 'plan', reg: null }));
  r = tool(['build', '--draft', p3, '--page', path.join(feature, 'plan-breakdown.html')]);
  expect("5 build: 'plan' draft with the plan beside it passes", r.code === 0, r.payload);
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const { dir, feature } = workspace({ 'clarification_register.md': '| # | Question | Status |\n|---|---|---|\n| 12 | Q | Open |\n' });
  const d = path.join(dir, 'draft.html');
  fs.writeFileSync(d, draft());
  const r = tool(['build', '--draft', d, '--page', path.join(feature, 'audit-breakdown.html')]);
  expect('6 check: a register without the required columns fails', r.code === 1 && ids(r.payload).includes('register'), r.payload);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- assets/review-system.js: the Save logic, sandboxed ---------------------------------------------------------
const from = ASSET_JS.indexOf('function registerCell');
const to = ASSET_JS.indexOf('async function saveAll');
const sandbox = {
  state: { filed: {}, answers: { Q12: { text: '365' }, Q25: { text: 'Yes', choice: 'A' } } },
  document: { title: 'Audit — Plan Breakdown' },
  today: () => '01-11-2026',
  visibleText: (el) => (el ? el.textContent : ''),
  textWithout: (el) => el.textContent,
  optionText: (el) => el.textContent,
  answerMarkdown: (a) => a.text,
};
vm.runInNewContext(ASSET_JS.slice(from, to) + '\nthis.fillRegister = fillRegister; this.fillPlan = fillPlan;', sandbox);
const card = (qid, reg, q) => ({ dataset: { qid, reg }, querySelector: (sel) =>
  sel === '.question-text' ? { textContent: q } : sel.startsWith('.question-option') && qid === 'Q25' ? { textContent: 'A — Log it' } : null });
const Q12 = card('Q12', '12', 'Retention days?');
const Q25 = card('Q25', '25', 'Missing record allowed?');

{
  const r = sandbox.fillRegister(REGISTER, [Q12], 'qa@example.com');
  const row = r.text.split('\n').find((l) => l.startsWith('| 12'));
  expect('7 register: expected layout fills Answer, Status, User, Updated in Spec, date',
    r.filed.join() === '12' && row === '| 12 | Retention days? | why | PO | 365 | Answered | clarify | qa@example.com | No | 01-11-2026 |', row);
  const reordered = '| Status | # | User | Answer | Last Updated Date | Updated in Spec | Owner |\n|---|---|---|---|---|---|---|\n| Open | 12 |  |  |  | No | PO |\n';
  const r2 = sandbox.fillRegister(reordered, [Q12], 'qa@example.com');
  expect('8 register: columns are matched by name, not position',
    r2.text.split('\n')[2] === '| Answered | 12 | qa@example.com | 365 | 01-11-2026 | No | PO |', r2.text);
  const other = '| # | Question | Why | Status | Answer | Owner | Priority | Assignee | Spec Version | Date |\n|---|---|---|---|---|---|---|---|---|---|\n| 12 | Q | w | Open |  | Open | High | dev | No | x |\n';
  const r3 = sandbox.fillRegister(other, [Q12], 'qa@example.com');
  expect('9 register: a table without the register columns is never written', r3.unreadable && r3.text === other && r3.left.join() === 'Q12', r3);
  const two = REGISTER + '\n## Copy\n' + REGISTER.split('\n').slice(2).join('\n');
  const r4 = sandbox.fillRegister(two, [Q12], 'qa@example.com');
  expect('10 register: two register tables — nothing written', r4.unreadable && r4.text === two, r4.filed);
  const dup = REGISTER.replace('| 25 |', '| 12 |');
  const r5 = sandbox.fillRegister(dup, [Q12], 'qa@example.com');
  expect('11 register: a row number that is not unique is left', r5.filed.length === 0 && r5.left.join() === 'Q12', r5);
  const answered = REGISTER.replace('|  | Open | clarify |  | No |  |', '| 30 | Answered | clarify | po@example.com | Yes | 01-10-2026 |');
  const r6 = sandbox.fillRegister(answered, [Q12], 'qa@example.com');
  expect('12 register: an already answered row is left for /speckit-clarify', r6.filed.length === 0 && r6.text === answered, r6);
  const crlf = REGISTER.replace(/\n/g, '\r\n');
  const r7 = sandbox.fillRegister(crlf, [Q12, Q25], 'qa@example.com');
  expect('13 register: CRLF kept, both rows filled',
    r7.filed.join() === '12,25' && !/[^\r]\n/.test(r7.text) && r7.text.includes('| A — Log it — Yes | Answered |'), r7.text);
}
{
  const plan = '# Plan\r\n\r\nBody text.\r\n';
  const r1 = sandbox.fillPlan(plan, [Q12], 'qa@example.com');
  expect('14 plan: first Save appends one block and keeps the text and CRLF',
    r1.startsWith(plan.trimEnd()) && !/[^\r]\n/.test(r1) && r1.includes('### Q12 — Retention days?') &&
    r1.split('visualplanner:answers --').length === 3, r1);
  sandbox.state.answers.Q12.text = '400';
  const r2 = sandbox.fillPlan(r1.replace('### Q12', '### AQ-07 — Other reviewer\r\n- **Answer:**\r\n\r\n  kept\r\n\r\n### Q12'), [Q12], 'qa@example.com');
  expect("15 plan: later Save replaces this page's entry and keeps another one",
    r2.includes('  400') && !r2.includes('  365') && r2.includes('AQ-07') && r2.split('visualplanner:answers --').length === 3, r2);
  expect('16 plan: broken or doubled markers write nothing',
    sandbox.fillPlan(plan + '<!-- visualplanner:answers -->\n', [Q12], 'x') === null && sandbox.fillPlan(r1 + r1, [Q12], 'x') === null, null);
}

const failed = results.filter((r) => !r.ok);
const out = { verdict: failed.length ? 'FAIL' : 'PASS', passed: results.length - failed.length, total: results.length, failed };
process.stdout.write(JSON.stringify(process.argv.includes('--pretty') ? out : out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(failed.length ? 1 : 0);
