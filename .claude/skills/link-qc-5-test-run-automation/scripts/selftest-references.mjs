#!/usr/bin/env node
// selftest-references.mjs — regression harness for the contracts BETWEEN skill 5's instruction files: what one
// file cites from another must exist there, and what an activity needs must be loaded by then. Read-only, no
// network, zero dependencies.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE (a harness, not a reporting script).
//   1  Heal Log columns: automation-rules.md §5 defines nine; every Heal Log passage of SKILL.md, references/ and
//      assets/ cites a column by NAME, never by number (a number drifted once: "column 7 = the evidence path" while
//      column 7 is the Approved-requirement reference); the Approved-requirement reference never receives an
//      evidence / trace / screenshot path; the run-report fixture's `### Heal log` header and its run file's
//      `heal_log[]` keys follow §5 in order; every "N columns" count in a Heal Log passage is the table's.
//   2  Load before use: everything the smoke-gate STOP in execution.md needs — each `<tag>` through the block index,
//      each `*.md` it names — is in the Load column of the stopping activity or an earlier one (SKILL.md Workflow);
//      the STOP names the report contract (run-report.md) and says to load.
//   3  Block index: every `<tag>` it lists opens in a file it names; every block opened in references/ is listed.
//   4  Rule registry (references/rule-registry.md): one row per rule id, exactly one home each; the home file and
//      its block (or § section) exist; every enforcement id resolves — a validator rule in RULES, a checklist item
//      of compliance-checkpoints.md §2, a script in scripts/; every activity that needs a rule has its home loaded
//      by then (Workflow Load column, cumulative; `all` = SKILL.md); every block SKILL.md's every-activity rules
//      cite is the home of a registry row.
//
// Run: node selftest-references.mjs [--pretty]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, '..');
const read = (rel) => fs.readFileSync(path.join(skill, rel), 'utf8').replace(/\r\n/g, '\n');
const refs = fs.readdirSync(path.join(skill, 'references')).filter((f) => f.endsWith('.md'));
const cases = [];
const fail = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

// the block index: tag → files (a row may name several files, "a.md · b.md")
function blockIndex() {
  const text = read('SKILL.md');
  const body = text.slice(text.indexOf('## Block index'));
  const map = new Map();
  for (const line of body.split('\n').slice(1)) {
    if (/^## /.test(line)) break;
    if (!/^\|\s*`</.test(line)) continue;
    const [blocks, files] = cells(line);
    const names = [...files.matchAll(/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
    for (const m of blocks.matchAll(/`<([a-z_]+)>`/g)) map.set(m[1], names);
  }
  return map;
}

/* 1 — Heal Log columns are cited by name and agree with automation-rules.md §5 */
{
  const p = [];
  const rules = read('references/automation-rules.md');
  const s5start = rules.indexOf('## 5.');
  const s5end = rules.indexOf('\n## ', s5start + 5);
  const s5 = s5start < 0 ? '' : rules.slice(s5start, s5end < 0 ? undefined : s5end);
  const columns = [...s5.matchAll(/^\|\s*(\d+)\s+([^|]+?)\s*\|/gm)].map((m) => ({ n: Number(m[1]), name: m[2].trim() }));
  if (columns.length !== 9 || columns.some((c, i) => c.n !== i + 1)) p.push('automation-rules.md §5 does not define columns 1-9 in order: ' + JSON.stringify(columns));
  const approved = columns.find((c) => /approved-requirement reference/i.test(c.name));
  if (!approved) p.push('§5 has no Approved-requirement reference column');
  // every Heal Log passage: the line that names it and the two after (a wrapped sentence)
  const files = ['SKILL.md', ...refs.map((f) => 'references/' + f), ...fs.readdirSync(path.join(skill, 'assets')).filter((f) => /\.(ts|html)$/.test(f)).map((f) => 'assets/' + f)];
  const passages = [];
  for (const f of files) {
    const lines = read(f).split('\n');
    lines.forEach((l, i) => { if (/heal[ _-]?log/i.test(l)) passages.push({ at: f + ':' + (i + 1), text: lines.slice(i, i + 3).join(' ') }); });
  }
  for (const x of passages) {
    for (const m of x.text.matchAll(/\bcolumn\s+(\d+)\b/gi)) p.push(x.at + ': cites Heal Log column ' + m[1] + ' by number — name it (' + ((columns[Number(m[1]) - 1] || {}).name || 'no such column') + ')');
    if (/approved-requirement reference[^.;|]*?\b(evidence|trace|screenshot)\b[^.;|]*?\bpath\b/i.test(x.text)) p.push(x.at + ': the Approved-requirement reference is given an evidence / trace / screenshot path');
    for (const m of x.text.matchAll(/\b([a-z]+)[- ]columns?\b/gi)) if (NUM[m[1].toLowerCase()] && NUM[m[1].toLowerCase()] !== columns.length) p.push(x.at + ': "' + m[0] + '" but §5 has ' + columns.length);
  }
  // the canonical example: the fixture report's Heal log header and its run file's heal_log keys, column by column
  const story = 'scripts/fixtures/run-report/automation/reports/US-1234-create-order/';
  const md = read(story + 'TEST-RUN-REPORT-create-order.md').split('\n');
  const at = md.findIndex((l) => /^### Heal log\s*$/i.test(l));
  const header = at >= 0 && /^\|/.test(md[at + 1] || '') ? cells(md[at + 1]) : [];
  if (header.length !== columns.length) p.push('fixture Heal log header has ' + header.length + ' columns, §5 has ' + columns.length);
  else header.forEach((h, i) => { if (!h.toLowerCase().startsWith(columns[i].name.toLowerCase())) p.push('fixture Heal log column ' + (i + 1) + ' "' + h + '" is not §5\'s "' + columns[i].name + '"'); });
  const run = JSON.parse(read(story + '.runs/phase-1.json'));
  const keys = Object.keys((run.heal_log || [])[0] || {});
  const KEYS = ['tc_id', 'files', 'category', 'previous', 'updated', 'reason', 'requirement_ref', 'verification', 'rerun_result'];
  if (JSON.stringify(keys) !== JSON.stringify(KEYS)) p.push('fixture run file heal_log keys ' + JSON.stringify(keys) + ' != ' + JSON.stringify(KEYS) + ' (§5 order)');
  check('1 Heal Log columns cited by name; the approved-requirement column never holds an evidence path; fixture header + run-file keys follow §5', p, { columns: columns.map((c) => c.n + ' ' + c.name), passages: passages.length });
}

/* 2 — the smoke-gate STOP finds every block it needs already loaded */
{
  const p = [];
  const skillMd = read('SKILL.md');
  const wf = skillMd.slice(skillMd.indexOf('## Workflow'));
  const rows = wf.split('\n').filter((l) => /^\|\s*\d+[a-z]?\s*\|/.test(l)).map(cells).map(([id, activity, step, what, load]) => ({ id, activity, step, what, load }));
  const filesOf = (load) => [...load.matchAll(/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
  const stopAt = rows.findIndex((r) => /smoke gate/i.test(r.what));
  if (stopAt < 0) p.push('no Workflow row runs the smoke gate');
  const loaded = new Set();
  for (const r of rows.slice(0, stopAt + 1)) {
    for (const f of filesOf(r.load)) loaded.add(f);
    for (const m of r.load.matchAll(/\brow (\d+[a-z]?)'s/gi)) { const t = rows.find((x) => x.id === m[1]); if (t) for (const f of filesOf(t.load)) loaded.add(f); else p.push('Load cell names row ' + m[1] + ', which is not a Workflow row'); }
  }
  const exec = read('references/execution.md').split('\n');
  const from = exec.findIndex((l) => /\*\*Majority `app_bug`\*\*/.test(l));
  let to = from + 1;
  while (to < exec.length && !/^\s{0,3}\d+\.\s/.test(exec[to]) && !/^<\/staged_execution>/.test(exec[to])) to++;
  const stop = from >= 0 ? exec.slice(from, to).join('\n') : '';
  if (!stop) p.push('execution.md has no smoke-gate STOP bullet (**Majority `app_bug`**)');
  const index = blockIndex();
  const needed = new Map(); // file → why
  for (const m of stop.matchAll(/<([a-z_]+)>/g)) {
    const fs_ = index.get(m[1]);
    if (!fs_) p.push('the STOP cites <' + m[1] + '>, which the block index does not list');
    else for (const f of fs_) needed.set(f, '<' + m[1] + '>');
  }
  for (const m of stop.matchAll(/([a-z0-9-]+\.md)/g)) needed.set(m[1], 'named');
  needed.delete('execution.md');
  for (const [f, why] of needed) if (!loaded.has(f)) p.push('the smoke-gate STOP needs ' + f + ' (' + why + ') but no Workflow row up to "' + (rows[stopAt] || {}).activity + '" loads it');
  if (!needed.has('run-report.md')) p.push('the STOP writes the phase section and the bug file but does not name their contract (run-report.md)');
  if (!/\bload\b/i.test(stop)) p.push('the STOP does not say to load what it needs');
  check('2 the smoke-gate STOP loads what it needs before it stops (block index → file, Workflow Load column)', p, { stopRow: rows[stopAt] && rows[stopAt].id, needed: [...needed.keys()], loaded: [...loaded] });
}

/* 3 — the block index and the blocks agree */
{
  const p = [];
  const index = blockIndex();
  for (const [tag, files] of index) {
    if (!files.length) { p.push('<' + tag + '> lists no file'); continue; }
    if (!files.some((f) => refs.includes(f) && new RegExp('^<' + tag + '>\\s*$', 'm').test(read('references/' + f)))) p.push('<' + tag + '> does not open in ' + files.join(' / '));
  }
  for (const f of refs) for (const m of read('references/' + f).matchAll(/^<([a-z_]+)>\s*$/gm)) if (!index.has(m[1])) p.push('references/' + f + ' opens <' + m[1] + '>, which the block index does not list');
  check('3 every block-index tag opens in its file; every opened block is indexed', p, { tags: index.size });
}

/* 4 — the rule registry: one home per rule, every pointer and enforcement id resolves, homes loaded before use */
{
  const p = [];
  let reg = '';
  try { reg = read('references/rule-registry.md'); } catch { p.push('references/rule-registry.md is missing'); }
  const rows = reg.split('\n').filter((l) => /^\|\s*R\d+\s*\|/.test(l)).map(cells).map(([id, rule, home, enforced, needed]) => ({ id, rule, home, enforced, needed }));
  if (reg && !rows.length) p.push('the registry has no rule rows');
  const seen = new Set();
  for (const r of rows) { if (seen.has(r.id)) p.push(r.id + ' appears twice'); seen.add(r.id); }
  const index = blockIndex();
  // the validator's rule ids, read from its source text (no import: this harness stays read-only and dependency-free)
  const vsrc = fs.readFileSync(path.join(here, 'validate-automation.mjs'), 'utf8');
  const vStart = vsrc.indexOf('export const RULES = {');
  const ruleIds = new Set([...vsrc.slice(vStart, vsrc.indexOf('\n};', vStart)).matchAll(/^\s{2}["']?([a-z][a-z0-9-]+)["']?\s*:\s*\{/gm)].map((m) => m[1]));
  const items = new Set([...read('references/compliance-checkpoints.md').matchAll(/^\|\s*(\d+[ab]?)\s*\|/gm)].map((m) => m[1]));
  const scripts = new Set(fs.readdirSync(here).filter((f) => f.endsWith('.mjs')));
  // the Workflow rows and what each has loaded by then (cumulative)
  const skillMd = read('SKILL.md');
  const wfRows = skillMd.slice(skillMd.indexOf('## Workflow')).split('\n').filter((l) => /^\|\s*\d+[a-z]?\s*\|/.test(l)).map(cells).map(([id, , , , load]) => ({ id, load }));
  const loadedBy = new Map();
  const acc = new Set();
  for (const w of wfRows) { for (const m of w.load.matchAll(/([a-z0-9-]+\.md)/g)) acc.add(m[1]); loadedBy.set(w.id, new Set(acc)); }
  const homes = new Set();
  for (const r of rows) {
    const files = [...r.home.matchAll(/`([A-Za-z0-9-]+\.md)`/g)].map((m) => m[1]);
    if (files.length !== 1) { p.push(r.id + ': ' + (files.length ? files.length + ' homes' : 'no home') + ' — every rule has exactly one'); continue; }
    const file = files[0];
    const rel = file === 'SKILL.md' ? 'SKILL.md' : 'references/' + file;
    let text = null;
    try { text = read(rel); } catch { p.push(r.id + ': home ' + rel + ' does not exist'); continue; }
    const tag = (r.home.match(/`<([a-z_]+)>`/) || [])[1];
    const sec = (r.home.match(/§\s*(\d+)/) || [])[1];
    if (tag) {
      if (!new RegExp('^<' + tag + '>\\s*$', 'm').test(text)) p.push(r.id + ': <' + tag + '> does not open in ' + rel);
      if (file !== 'SKILL.md' && !(index.get(tag) || []).includes(file)) p.push(r.id + ': <' + tag + '> is not in the block index under ' + file);
      homes.add(tag);
    } else if (sec && !new RegExp('^## ' + sec + '\\.', 'm').test(text)) p.push(r.id + ': ' + rel + ' has no section ' + sec);
    for (const m of r.enforced.matchAll(/`([a-z][a-z0-9-]*)`/g)) if (!ruleIds.has(m[1])) p.push(r.id + ': validator rule `' + m[1] + '` does not exist');
    for (const m of r.enforced.matchAll(/`([A-Za-z0-9-]+\.mjs)`/g)) if (!scripts.has(m[1])) p.push(r.id + ': script ' + m[1] + ' does not exist');
    for (const m of r.enforced.matchAll(/\bitem (\d+[ab]?)\b/g)) if (!items.has(m[1])) p.push(r.id + ': checklist item ' + m[1] + ' is not in compliance-checkpoints.md §2');
    const needed = r.needed.trim();
    if (needed === 'all') { if (file !== 'SKILL.md') p.push(r.id + ': needed by every activity, so its home must be SKILL.md, not ' + file); continue; }
    for (const at of needed.split(/[,\s]+/).filter(Boolean)) {
      if (!loadedBy.has(at)) { p.push(r.id + ': activity ' + at + ' is not a Workflow row'); continue; }
      if (file !== 'SKILL.md' && !loadedBy.get(at).has(file)) p.push(r.id + ': activity ' + at + ' needs ' + file + ' but no Workflow row up to it loads it');
    }
  }
  // every block the every-activity rules cite has a registry row
  const rulesSection = skillMd.slice(skillMd.indexOf('## Rules that hold in every activity'), skillMd.indexOf('## Workflow'));
  for (const m of rulesSection.matchAll(/`<([a-z_]+)>`/g)) if (!homes.has(m[1])) p.push('SKILL.md\'s every-activity rules cite <' + m[1] + '>, which is no registry row\'s home');
  check('4 rule registry: one home per rule, pointers and enforcement ids resolve, homes loaded before the activities that need them', p, { rules: rows.length });
}

const out = {
  tool: 'selftest-references',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'An instruction file cites something another file does not hold, or an activity needs a block it has not loaded.' : 'Every checked cross-reference resolves.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
