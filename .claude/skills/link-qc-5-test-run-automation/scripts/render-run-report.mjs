#!/usr/bin/env node
// render-run-report.mjs — deterministic renderer for skill 5's per-story run report page.
//   TEST-RUN-REPORT-{feature}.md (+ BUG-REPORT-{feature}.md, + .runs/phase-N.json)
//   (+ REVIEW-COMMENTS-{feature}.md, the reviewer's comments saved from the page)
//   → TEST-RUN-REPORT-{feature}.html, from assets/run-report.template.html (the body partial) inside
//   assets/report-shell.template.html (the one general report page, mirrored with skills 3, 3b and 3c).
//
// Node >= 18, ESM, zero dependencies. DEFAULT MODE IS DRY-RUN: parse, compute, validate, print
// the JSON payload, write nothing. Writing happens only behind --write, and the rendered HTML is
// never printed to stdout. The markdown and JSON sources are read-only in every mode.
//
// Standing rules (same as skill 3's review-page renderer, whose template engine and provenance
// scheme are copied here — never imported, because /sync-skills copies one skill folder at a time):
//   1. never invent a number — a value the documents cannot supply renders `—`, never `0`;
//   2. every number on the page is recomputed from the tables; a header line, run-history row,
//      stage total, run-file total or bug-report count that disagrees is reported in mismatches[]
//      and the computed value is rendered;
//   3. screenshots are linked by RELATIVE path (thumbnail + "View screenshot"), never embedded;
//   4. the bug report is a separate markdown file; the page combines both into one document with
//      separate Test Results and Bugs sections.
//
// Usage:
//   node render-run-report.mjs --report <TEST-RUN-REPORT-{feature}.md> [--bugs <BUG-REPORT-{feature}.md>]
//        [--runs <dir>] [--comments <path>] [--out <path>] [--write] [--force] [--strict] [--pretty]
// Exit: 0 always, unless --strict: PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, sha256, isFile } from './scan-lib.mjs';

export const SCHEMA_VERSION = '1.1';
export const TOOL = 'render-run-report';
export const RUN_SCHEMA = 'skill6-run/1';

const DASH = '—';
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');

/* ============================================================================================
 * Vocabulary — frozen. SKILL.md, references/run-report.md and the ADO close-out use the same words.
 * ========================================================================================== */
export const OUTCOMES = ['GREEN', 'FAILURES', 'INCOMPLETE', 'SMOKE GATE FAILED', 'ENVIRONMENT_BLOCKED', 'BLOCKED'];
export const EXECUTED_OUTCOMES = ['GREEN', 'FAILURES', 'INCOMPLETE', 'SMOKE GATE FAILED'];
// PARTIAL = the automated part ran and passed up to a `[HUMAN]` step; the Status cell reads
// `PARTIAL — human step pending`. It is never counted as passed and never lets a phase be GREEN.
export const RESULT_STATES = ['PASS', 'FAIL', 'INCOMPLETE', 'SKIP', 'NOT_RUN', 'PARTIAL'];
export const PARTIAL_REASON = 'human step pending';
export const CLASSIFICATIONS = ['app_bug', 'selector_failure', 'assertion_failure', 'environment_failure', 'data_missing', 'timeout_failure', 'evidence_failure', 'unverified_assumption'];
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
export const BUG_STATUSES = ['open', 'resolved', 'not-checked'];
// `partial` is an OPTIONAL column of the Stages / Run history tables and an optional ` · {n} partial`
// of the Latest results line — required only when a phase holds a PARTIAL row.
const COUNT_KEYS = ['passed', 'failed', 'incomplete', 'skipped', 'notrun', 'partial', 'total'];
const COUNT_LABEL = { passed: 'Passed', failed: 'Failed', incomplete: 'Incomplete', skipped: 'Skipped', notrun: 'Not run', partial: 'Partial', total: 'Total' };
const STATUS_BUCKET = { PASS: 'passed', FAIL: 'failed', INCOMPLETE: 'incomplete', SKIP: 'skipped', NOT_RUN: 'notrun', PARTIAL: 'partial' };
const SMOKE_RE = /^(passed|healed-then-passed|FAILED-STOPPED)\b/;
const SECRET_RE = /\b(password|passcode|secret|token|pat|api[- ]?key)\b\s*(?:[:=]|is)\s*["'`]?[^\s"'`]{3,}/i;
const LINK_RE = /!?\[([^\]]*)\]\(([^)\s]+)\)/g;

export const LIMITS = [
  'Text screen, not a judge: the renderer checks shape, vocabulary and arithmetic. It does not judge whether a result, a classification or a bug is right.',
  'The existence of an evidence file is checked relative to the markdown folder; its content is not. A missing file is a warning, never a block.',
  'Run-file enrichment is additive: the markdown stays the source of the counts; the run file adds variants, attempts and cross-checks.',
  'The bug report is optional to the renderer (warning when absent) but mandatory to the skill: without it the Bugs section is empty.',
  'Legacy artifacts (phase-N.json / .html, merged-results.json, run-plan.json, open-questions.json, data-readiness.json, stages/, coverage-previous.json, coverage-dashboard.html) are listed, never rendered.',
  'A password-shaped literal ("password: x", "token = y") anywhere in either document BLOCKs; a secret written any other way is not detected.',
  'Rendering is deterministic: same inputs → same bytes. Nothing in the page depends on the clock.',
  'Screenshots are linked by relative path and shown only while the report and the screenshots keep their relative positions; a data: URI BLOCKs.',
  'A PARTIAL row (`PARTIAL — human step pending`) counts in its own bucket, never as passed; a phase holding one is INCOMPLETE at best. Whether the human step was later performed is outside this page.',
  'Reviewer comments come from REVIEW-COMMENTS-{feature}.md beside the report (or --comments): each `## {item-id}` entry is attached to the bug card (BUG-n) or phase card (phase-N) with that id, "General" to the general box; an id not on the page is listed, never dropped (comment-unknown-id). The file belongs to the reviewer: the renderer only reads it. Typing in the page never changes the page file, so its self-hash stays valid.',
];

/* ============================================================================================
 * Markdown parsing (helpers copied from skill 3's renderer — same behaviour)
 * ========================================================================================== */
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const stripMd = (s) => String(s ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').trim();
const bare = (v) => { const s = stripMd(v); return s === '' || s === DASH || s === '-' ? '' : s; };
const numsIn = (s) => (s ? (String(s).match(/-?\d+(?:\.\d+)?/g) || []).map(Number) : []);
const toNum = (s) => { const t = stripMd(s).replace(/%$/, ''); return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : null; };
const isNone = (lines) => lines.map((l) => l.trim()).filter(Boolean).every((l) => /^(none|—|-|all ready|n\/a)\.?$/i.test(stripMd(l)));

function parseTables(lines, base) {
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = splitRow(lines[i]);
      const rows = []; const broken = [];
      let j = i + 2;
      for (; j < lines.length && isRow(lines[j]); j++) {
        const cells = splitRow(lines[j]);
        if (cells.length !== header.length) broken.push({ line: base + j + 1, cells: cells.length, expected: header.length });
        rows.push(cells);
      }
      tables.push({ header, rows, line: base + i + 1, broken });
      i = j - 1;
    }
  }
  return tables;
}
function col(table, re) { if (!table) return -1; return table.header.findIndex((h) => re.test(stripMd(h))); }
const cell = (row, idx) => (idx >= 0 && idx < row.length ? row[idx] : '');

function parseHeaderBlock(lines, titleRe) {
  const header = {}; const order = []; let title = null; let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) { end = i; break; }
    const t = l.match(titleRe);
    if (t) { title = t[1]; continue; }
    const m = l.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    if (m) { header[m[1].trim()] = m[2].trim(); order.push(m[1].trim()); }
  }
  return { header, order, title, end };
}
function sections(lines, level = 2) {
  const re = new RegExp('^#{' + level + '} +(.+?)\\s*$');
  const out = []; let cur = null; const pre = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) { cur = { title: stripMd(m[1]), rawTitle: m[1], start: i, lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(lines[i]); else pre.push(lines[i]);
  }
  return { sections: out, pre };
}
const findSection = (secs, re) => secs.find((s) => re.test(s.title));

/** `- **Field:** value` bullets with indented sub-lists / continuation lines. */
function parseFieldBullets(lines, base) {
  const fields = {}; const order = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^<!--/.test(l.trim())) { cur = null; continue; }
    const m = l.match(/^\s{0,1}[-*]\s+\*\*([^*]+?):\*\*\s*(.*)$/) || l.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    if (m) { cur = { name: m[1].trim(), value: m[2].trim(), items: [], line: base + i + 1 }; fields[cur.name] = cur; order.push(cur.name); continue; }
    if (!cur) continue;
    const li = l.match(/^\s{2,}(?:\d+[.)]|[-*])\s+(.*)$/);
    if (li) { cur.items.push(li[1].trim()); continue; }
    if (/^\s{2,}\S/.test(l)) { if (cur.items.length) cur.items[cur.items.length - 1] += ' ' + l.trim(); else cur.value = (cur.value + ' ' + l.trim()).trim(); continue; }
    if (l.trim() === '') continue;
    cur = null;
  }
  return { fields, order };
}
const fieldOf = (fields, name) => { const k = Object.keys(fields).find((x) => new RegExp('^' + name + '$', 'i').test(x)); return k ? fields[k] : null; };
const fieldValue = (fields, name) => { const f = fieldOf(fields, name); return f ? stripMd(f.value) : ''; };
const boldLine = (lines, name) => { for (const l of lines) { const m = l.match(new RegExp('^\\*\\*' + name + ':\\*\\*\\s*(.*)$', 'i')); if (m) return m[1].trim(); } return null; };
const bulletItems = (lines) => lines.map((l) => l.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/)).filter(Boolean).map((m) => stripMd(m[1]));

/** `### {ID} — {Title}` blocks. */
function parseIdBlocks(lines, base, idTest) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^###+\s+(\S+)\s*(?:[—–:-]\s*(.*?))?\s*$/);
    if (!m || !idTest(m[1])) continue;
    let j = i + 1;
    while (j < lines.length && !/^###+\s+\S/.test(lines[j]) && !/^## /.test(lines[j])) j++;
    blocks.push({ id: m[1], title: (m[2] || '').trim(), line: base + i + 1, lines: lines.slice(i + 1, j) });
    i = j - 1;
  }
  return blocks;
}
const genericTable = (t) => (t ? { header: t.header.map(stripMd), rows: t.rows.map((r) => r.map(stripMd)), line: t.line } : null);

/* ---- TEST-RUN-REPORT-{feature}.md ---- */
export function parseReport(text) {
  const lines = text.split('\n');
  const errors = []; const warnings = [];
  const { header, title, end } = parseHeaderBlock(lines, /^#\s+Test Run Report\s*[—–-]\s*(.+?)\s*$/i);
  if (!title) errors.push({ kind: 'title-missing', line: 1, detail: 'first line must be `# Test Run Report — {feature}`' });
  for (const k of ['User Story', 'Latest phase', 'Status', 'Latest results']) if (!(k in header)) errors.push({ kind: 'header-missing', line: 1, detail: 'required header line `**' + k + ':**` is missing' });
  const body = lines.slice(end);
  const { sections: secs } = sections(body);
  const abs = (s) => ({ ...s, start: s.start + end });
  const hist = findSection(secs, /^run history$/i);
  let history = null;
  if (!hist) errors.push({ kind: 'section-missing', line: end + 1, detail: 'no `## Run history` section' });
  else { const h = abs(hist); const t = parseTables(h.lines, h.start + 1)[0]; if (!t) errors.push({ kind: 'section-missing', line: h.start + 1, detail: '`## Run history` has no table' }); else { history = t; for (const b of t.broken) errors.push({ kind: 'broken-row', line: b.line, detail: 'run-history row has ' + b.cells + ' cells, header has ' + b.expected }); } }
  const phases = []; const seen = new Set(); let prev = 0; let firstPhaseIdx = -1;
  secs.forEach((s, idx) => {
    const m = s.title.match(/^Phase\s+(\d+)\s*[—–-]\s*(\S.*)$/i);
    if (!m) { if (!/^run history$/i.test(s.title)) warnings.push({ kind: 'unknown-section', line: s.start + end + 1, detail: 'ignored `## ' + s.title + '`' }); return; }
    if (firstPhaseIdx < 0) firstPhaseIdx = idx;
    const n = Number(m[1]); const S = abs(s);
    if (seen.has(n)) errors.push({ kind: 'phase-duplicate', line: S.start + 1, detail: '`## Phase ' + n + '` appears twice' });
    if (n <= prev) errors.push({ kind: 'phase-order', line: S.start + 1, detail: '`## Phase ' + n + '` follows phase ' + prev + ' — phases must ascend' });
    seen.add(n); prev = Math.max(prev, n);
    const { sections: subs, pre } = sections(S.lines, 3);
    const sub = (re) => { const x = subs.find((z) => re.test(z.title)); return x ? { ...x, start: S.start + 1 + x.start } : null; };
    const tablesOf = (x) => (x ? parseTables(x.lines, x.start + 1) : []);
    const brokenOf = (x, what) => { for (const t of tablesOf(x)) for (const b of t.broken) errors.push({ kind: 'broken-row', line: b.line, detail: what + ' row has ' + b.cells + ' cells, header has ' + b.expected + ' (phase ' + n + ')' }); };
    const run = sub(/^run$/i);
    if (!run) errors.push({ kind: 'section-missing', line: S.start + 1, detail: 'phase ' + n + ' has no `### Run` sub-section' });
    const runFields = run ? parseFieldBullets(run.lines, run.start + 1) : { fields: {}, order: [] };
    const outcomeRaw = fieldValue(runFields.fields, 'Outcome');
    if (run && !outcomeRaw) errors.push({ kind: 'section-missing', line: run.start + 1, detail: 'phase ' + n + ' `### Run` has no `- **Outcome:**` bullet' });
    const om = outcomeRaw.match(/^(GREEN|FAILURES|INCOMPLETE|SMOKE GATE FAILED|ENVIRONMENT_BLOCKED|BLOCKED)\b\s*(?:[—–-]\s*(.*))?$/);
    if (outcomeRaw && !om) errors.push({ kind: 'unknown-enum', line: run.start + 1, detail: 'phase ' + n + ' Outcome "' + outcomeRaw + '" is not one of ' + OUTCOMES.join(' / ') });
    const declared = om ? om[1] : null; const reason = om && om[2] ? om[2].trim() : '';
    for (const [k, x] of [['stages', sub(/^stages$/i)], ['run plan', sub(/^run plan$/i)], ['coverage', sub(/^coverage$/i)], ['results', sub(/^results$/i)], ['unverified assumptions', sub(/^unverified assumptions$/i)], ['bugs', sub(/^bugs$/i)], ['heal log', sub(/^heal log$/i)], ['skips', sub(/^skips/i)], ['open questions', sub(/^open questions$/i)], ['readiness', sub(/^test-data readiness$/i)]]) brokenOf(x, k);
    const stagesSec = sub(/^stages$/i); const resultsSec = sub(/^results$/i);
    const stages = genericTable(tablesOf(stagesSec)[0]);
    const smokeGate = stagesSec ? boldLine(stagesSec.lines, 'Smoke gate') : null;
    if (stagesSec && !smokeGate) errors.push({ kind: 'section-missing', line: stagesSec.start + 1, detail: 'phase ' + n + ' `### Stages` has no `**Smoke gate:**` line' });
    if (smokeGate && !SMOKE_RE.test(smokeGate)) errors.push({ kind: 'unknown-enum', line: stagesSec.start + 1, detail: 'phase ' + n + ' smoke gate "' + smokeGate + '" must start with passed / healed-then-passed / FAILED-STOPPED' });
    const rt = tablesOf(resultsSec)[0];
    if (declared && EXECUTED_OUTCOMES.includes(declared)) { if (!stagesSec) errors.push({ kind: 'section-missing', line: S.start + 1, detail: 'phase ' + n + ' outcome ' + declared + ' needs a `### Stages` sub-section' }); if (!rt) errors.push({ kind: 'section-missing', line: S.start + 1, detail: 'phase ' + n + ' outcome ' + declared + ' needs a `### Results` table' }); }
    const results = [];
    if (rt) {
      const ci = { tc: col(rt, /^tc-?id$/i), req: col(rt, /^req/i), name: col(rt, /^name$/i), status: col(rt, /^status$/i), group: col(rt, /^group$/i), duration: col(rt, /^duration$/i), cls: col(rt, /^classification$/i), ev: col(rt, /^evidence$/i) };
      for (const k of ['tc', 'status']) if (ci[k] < 0) errors.push({ kind: 'section-missing', line: rt.line, detail: 'phase ' + n + ' Results table has no `' + (k === 'tc' ? 'TC-ID' : 'Status') + '` column' });
      const ids = new Set();
      for (const r of rt.rows) {
        const tc = stripMd(cell(r, ci.tc)); if (!tc) continue;
        if (ids.has(tc)) errors.push({ kind: 'broken-row', line: rt.line, detail: 'phase ' + n + ' lists ' + tc + ' twice — one row per TC' });
        ids.add(tc);
        const statusRaw = stripMd(cell(r, ci.status));
        // `PARTIAL — human step pending` is the one status that carries a reason; every other cell is the bare state.
        const sm = statusRaw.match(/^([A-Za-z_]+)\s*(?:[—–-]\s*(.*))?$/);
        const status = (sm ? sm[1] : statusRaw).toUpperCase();
        const statusReason = sm && sm[2] ? sm[2].trim() : '';
        if (!RESULT_STATES.includes(status) || (statusReason && status !== 'PARTIAL')) errors.push({ kind: 'unknown-enum', line: rt.line, detail: 'phase ' + n + ' ' + tc + ' Status "' + statusRaw + '" is not one of ' + RESULT_STATES.join(' / ') + ' (only PARTIAL carries a reason: `PARTIAL — ' + PARTIAL_REASON + '`)' });
        if (status === 'PARTIAL' && !new RegExp('^' + PARTIAL_REASON + '$', 'i').test(statusReason)) warnings.push({ kind: 'partial-without-reason', phase: n, id: tc, detail: 'PARTIAL row should read `PARTIAL — ' + PARTIAL_REASON + '`' + (statusReason ? ' (found "' + statusReason + '")' : '') });
        const cls = stripMd(cell(r, ci.cls));
        if (cls && cls !== DASH && !/^incomplete:/i.test(cls) && !/^human step/i.test(cls) && !CLASSIFICATIONS.includes(cls)) warnings.push({ kind: 'unknown-classification', phase: n, id: tc, detail: 'classification "' + cls + '" is not in the catalogue' });
        if (status === 'INCOMPLETE' && !/^incomplete:\s*\S/i.test(cls)) warnings.push({ kind: 'incomplete-without-variants', phase: n, id: tc, detail: 'INCOMPLETE row should name the missing variants as `incomplete: {slugs}`' });
        if (status === 'PARTIAL' && !/^human step:\s*\S/i.test(cls)) warnings.push({ kind: 'partial-without-step', phase: n, id: tc, detail: 'PARTIAL row should name the pending step in Classification as `human step: {n}`' });
        results.push({ tc, req: stripMd(cell(r, ci.req)) || DASH, name: stripMd(cell(r, ci.name)), status, statusReason, group: stripMd(cell(r, ci.group)) || DASH, duration: stripMd(cell(r, ci.duration)) || DASH, classification: cls || DASH, evidenceRaw: cell(r, ci.ev), line: rt.line });
      }
    }
    const covSec = sub(/^coverage$/i); const covTables = tablesOf(covSec);
    const covStages = genericTable(covTables.find((t) => col(t, /^stage$/i) >= 0));
    const covReqs = genericTable(covTables.find((t) => col(t, /^requirement$/i) >= 0));
    const covTarget = covSec ? boldLine(covSec.lines, 'Target') : null;
    const planSec = sub(/^run plan$/i);
    const bugsSec = sub(/^bugs$/i); const bugsT = tablesOf(bugsSec)[0];
    const bugRefs = [];
    if (bugsT) { const ci = { id: col(bugsT, /^bug$/i), tc: col(bugsT, /^tc-?id$/i), sev: col(bugsT, /^severity$/i), st: col(bugsT, /^status$/i) }; for (const r of bugsT.rows) { const id = stripMd(cell(r, ci.id)); if (id) bugRefs.push({ id, tc: stripMd(cell(r, ci.tc)) || DASH, severity: stripMd(cell(r, ci.sev)) || DASH, status: stripMd(cell(r, ci.st)) || DASH }); } }
    const healSec = sub(/^heal log$/i); const healT = tablesOf(healSec)[0];
    const readySec = sub(/^test-data readiness$/i);
    const devSec = sub(/^deviations$/i);
    const assumeSec = sub(/^unverified assumptions$/i);
    const skipsSec = sub(/^skips/i);
    const qSec = sub(/^open questions$/i);
    for (const z of subs) if (!/^(run|stages|run plan|coverage|results|unverified assumptions|bugs|heal log|skips.*|open questions|test-data readiness|deviations)$/i.test(z.title)) warnings.push({ kind: 'unknown-subsection', phase: n, detail: 'ignored `### ' + z.title + '`' });
    if (pre.some((l) => l.trim() && !/^<!--/.test(l.trim()))) warnings.push({ kind: 'text-outside-subsection', phase: n, detail: 'text before the first `###` of phase ' + n + ' is not rendered' });
    phases.push({
      n, date: m[2].trim(), line: S.start + 1, declared, reason, runFields, stages, smokeGate, results, hasResultsTable: !!rt,
      plan: genericTable(tablesOf(planSec)[0]), planDecisions: planSec ? boldLine(planSec.lines, 'Decisions') : null,
      covStages, covReqs, covTarget,
      assumptions: assumeSec && !isNone(assumeSec.lines) ? genericTable(tablesOf(assumeSec)[0]) : null,
      bugRefs, heals: healT ? genericTable(healT) : null, healText: healSec && !healT ? healSec.lines.map((l) => l.trim()).filter(Boolean).map(stripMd).join(' ') : '',
      skips: skipsSec && !isNone(skipsSec.lines) ? genericTable(tablesOf(skipsSec)[0]) : null,
      questions: qSec && !isNone(qSec.lines) ? genericTable(tablesOf(qSec)[0]) : null,
      readinessVerdict: readySec ? boldLine(readySec.lines, 'Verdict') : null, readiness: readySec ? genericTable(tablesOf(readySec)[0]) : null,
      deviations: devSec ? bulletItems(devSec.lines).filter((x) => !/^(none|—|-)\.?$/i.test(x)) : [],
      subsectionTitles: subs.map((z) => z.title),
    });
  });
  if (hist && firstPhaseIdx >= 0 && secs.indexOf(hist) > firstPhaseIdx) errors.push({ kind: 'phase-order', line: abs(hist).start + 1, detail: '`## Run history` must precede the first `## Phase` section' });
  if (!phases.length) errors.push({ kind: 'section-missing', line: end + 1, detail: 'no `## Phase N — date` section' });
  return { feature: title, header, history, phases, errors, warnings };
}

/* ---- BUG-REPORT-{feature}.md ---- */
export function parseBugReport(text) {
  const lines = text.split('\n');
  const errors = []; const warnings = [];
  const { header, title, end } = parseHeaderBlock(lines, /^#\s+Bug Report\s*[—–-]\s*(.+?)\s*$/i);
  if (!title) errors.push({ kind: 'bug-title-missing', line: 1, detail: 'first line must be `# Bug Report — {feature}`' });
  if (!('User Story' in header)) errors.push({ kind: 'bug-header-missing', line: 1, detail: 'required header line `**User Story:**` is missing' });
  const { sections: secs } = sections(lines.slice(end));
  const sec = findSection(secs, /^bugs$/i);
  const entries = [];
  if (!sec) errors.push({ kind: 'bug-section-missing', line: end + 1, detail: 'no `## Bugs` section' });
  else {
    const base = end + sec.start + 1;
    for (const b of parseIdBlocks(sec.lines, base, (id) => /^BUG-\d+$/.test(id))) {
      const { fields } = parseFieldBullets(b.lines, b.line);
      const v = (n) => fieldValue(fields, n);
      for (const req of ['TC-ID', 'Status', 'Steps to reproduce', 'Expected', 'Actual']) if (!fieldOf(fields, req)) errors.push({ kind: 'bug-field-missing', line: b.line, detail: b.id + ' has no `' + req + '` field' });
      const st = v('Status'); let status = null; let resolvedPhase = null;
      if (/^open$/i.test(st)) status = 'open';
      else if (/^resolved(\s*\(phase\s*(\d+)\))?$/i.test(st)) { status = 'resolved'; const mm = st.match(/phase\s*(\d+)/i); resolvedPhase = mm ? Number(mm[1]) : null; }
      else if (/^not[- ]checked([- ]this[- ]run)?$/i.test(st)) status = 'not-checked';
      else if (st) errors.push({ kind: 'bug-unknown-enum', line: b.line, detail: b.id + ' Status "' + st + '" is not open / resolved (phase N) / not-checked-this-run' });
      const sev = v('Severity');
      if (sev && !SEVERITIES.some((s) => s.toLowerCase() === sev.toLowerCase())) errors.push({ kind: 'bug-unknown-enum', line: b.line, detail: b.id + ' Severity "' + sev + '" is not Critical / High / Medium / Low' });
      const stepsF = fieldOf(fields, 'Steps to reproduce');
      const steps = stepsF ? (stepsF.items.length ? stepsF.items : stepsF.value.split(/\s(?=\d+[.)]\s)/).map((s) => s.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean)) : [];
      const histF = fieldOf(fields, 'History');
      const found = toNum(v('Found in phase'));
      entries.push({ id: b.id, title: b.title, line: b.line, tc: v('TC-ID') || DASH, req: v('Requirement') || DASH, severity: sev || DASH, environment: v('Environment') || DASH, browser: v('Browser') || DASH, language: v('Language') || DASH, build: v('Build') || DASH, foundIn: found, foundInRaw: v('Found in phase') || DASH, status, statusRaw: st, resolvedPhase, rootCause: v('Root cause') || DASH, steps, expected: v('Expected') || DASH, actual: v('Actual') || DASH, screenshotRaw: fieldOf(fields, 'Screenshot') ? fieldOf(fields, 'Screenshot').value : '', evidence: v('Evidence') || DASH, history: histF ? histF.items.map(stripMd) : [], note: bare(v('Reviewer comment')) });
    }
    if (!entries.length && !isNone(sec.lines.filter((l) => !/^###/.test(l)))) warnings.push({ kind: 'bug-section-unparsed', detail: '`## Bugs` has content but no `### BUG-n — title` entry was recognised' });
  }
  return { feature: title, header, entries, errors, warnings };
}

/* ============================================================================================
 * Model — recompute, compare, enrich
 * ========================================================================================== */
const outcomeClass = (o) => 's-' + String(o || 'notrun').toLowerCase().replace(/[^a-z]+/g, '-');
const resultClass = (s) => ({ PASS: 's-pass', FAIL: 's-fail', INCOMPLETE: 's-incomplete', SKIP: 's-skip', NOT_RUN: 's-notrun', PARTIAL: 's-partial' }[s] || 's-notrun');
const statusText = (status, reason) => (status === 'PARTIAL' ? 'PARTIAL — ' + (reason || PARTIAL_REASON) : status);
/** `{p} passed · {f} failed · {i} incomplete · {s} skipped · {n} not run[ · {x} partial] of {t} TCs` — read by label, never by position. */
const formatLatest = (c) => c.passed + ' passed · ' + c.failed + ' failed · ' + c.incomplete + ' incomplete · ' + c.skipped + ' skipped · ' + c.notrun + ' not run' + (c.partial ? ' · ' + c.partial + ' partial' : '') + ' of ' + c.total + ' TCs';
function latestMatches(line, c) {
  const pick = (re) => { const m = String(line).match(re); return m ? Number(m[1]) : null; };
  const got = { passed: pick(/(\d+)\s*passed/i), failed: pick(/(\d+)\s*failed/i), incomplete: pick(/(\d+)\s*incomplete/i), skipped: pick(/(\d+)\s*skipped/i), notrun: pick(/(\d+)\s*not run/i), partial: pick(/(\d+)\s*partial/i) ?? 0, total: pick(/of\s*(\d+)/i) };
  return COUNT_KEYS.every((k) => got[k] === c[k]);
}
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? DASH : String(v));
const isAbsolute = (p) => /^(?:[a-zA-Z]:[\\/]|\/|\\|[a-z][a-z0-9+.-]*:)/i.test(p);

function parseLinks(raw, ctx, model, opts) {
  const out = []; const text = String(raw ?? '');
  if (!text || bare(text) === '') return out;
  let any = false;
  for (const m of text.matchAll(LINK_RE)) {
    any = true; const label = m[1] || path.posix.basename(m[2]); const href = m[2];
    if (/^data:/i.test(href)) { model.errors.push({ kind: 'evidence-inline-data', ...ctx, detail: 'an image is embedded as a data: URI — link the file by relative path instead' }); continue; }
    if (/^(javascript|vbscript):/i.test(href) || /[\u0000-\u001f]/.test(href)) { model.errors.push({ kind: 'evidence-inline-data', ...ctx, detail: 'unsafe link scheme in an evidence cell' }); continue; }
    const title = (ctx.id ? ctx.id + ' · ' : '') + label + (ctx.phase ? ' · phase ' + ctx.phase : '');
    if (isAbsolute(href)) { model.warnings.push({ kind: 'evidence-path-not-relative', ...ctx, path: href, detail: 'evidence link is not relative to the report folder — rendered as a plain link' }); out.push({ label, href, title, ok: false, missing: false, plain: true, group: opts.group }); continue; }
    let decoded = href; try { decoded = decodeURIComponent(href.split(/[?#]/)[0]); } catch { /* keep */ }
    if (!isFile(path.resolve(opts.mdDir, decoded))) { model.warnings.push({ kind: 'evidence-file-missing', ...ctx, path: href, detail: 'evidence file not found relative to the report folder' }); out.push({ label, href, title, ok: false, missing: true, plain: false, group: opts.group }); continue; }
    out.push({ label, href, title, ok: true, missing: false, plain: false, group: opts.group });
  }
  if (!any && bare(text) && !/^none captured$/i.test(bare(text))) model.warnings.push({ kind: 'evidence-not-a-link', ...ctx, detail: 'evidence cell "' + bare(text) + '" is not a markdown link' });
  return out;
}

export function buildModel(doc, bugDoc, opts) {
  const { mdDir, runsDir } = opts;
  const model = { errors: [...doc.errors], warnings: [...doc.warnings], mismatches: [], legacyFiles: [], runFiles: [] };
  const mm = (o) => model.mismatches.push(o);
  const h = doc.header;

  // ---- phases: counts, outcome, evidence, stage totals
  const phases = doc.phases.map((p) => {
    const counts = p.hasResultsTable ? { passed: 0, failed: 0, incomplete: 0, skipped: 0, notrun: 0, partial: 0, total: 0 } : null;
    for (const r of p.results) { if (!counts) break; counts.total++; const k = STATUS_BUCKET[r.status]; if (k) counts[k]++; }
    let outcome = p.declared;
    if (counts) {
      // a PARTIAL row (human step pending) never lets the phase be GREEN
      const derived = /^FAILED-STOPPED/.test(p.smokeGate || '') ? 'SMOKE GATE FAILED' : counts.failed ? 'FAILURES' : (counts.incomplete || counts.partial) ? 'INCOMPLETE' : 'GREEN';
      if (p.declared && p.declared !== derived) mm({ kind: 'outcome', phase: p.n, field: 'Outcome', written: p.declared, computed: derived, source: 'phase' });
      outcome = derived;
    }
    for (const r of p.results) r.evidence = parseLinks(r.evidenceRaw, { phase: p.n, id: r.tc }, model, { mdDir, group: 'phase-' + p.n });
    if (p.stages && counts) {
      const ci = { stage: col(p.stages, /^stage$/i) };
      const tot = p.stages.rows.find((r) => /^total$/i.test(stripMd(cell(r, ci.stage))));
      if (!tot) model.warnings.push({ kind: 'stages-total-missing', phase: p.n, detail: '`### Stages` has no Total row — nothing to cross-check' });
      else for (const k of COUNT_KEYS) { const idx = col(p.stages, new RegExp('^' + COUNT_LABEL[k] + '$', 'i')); if (idx < 0) { if (k === 'partial' && counts.partial) mm({ kind: 'stages', phase: p.n, field: COUNT_LABEL[k], written: DASH, computed: counts[k], source: 'stages' }); continue; } const w = toNum(cell(tot, idx)); if (w !== null && w !== counts[k]) mm({ kind: 'stages', phase: p.n, field: COUNT_LABEL[k], written: w, computed: counts[k], source: 'stages' }); }
    }
    // secret screen over every cell and bullet of the phase
    const scan = [];
    for (const t of [p.stages, p.plan, p.covStages, p.covReqs, p.assumptions, p.heals, p.skips, p.questions, p.readiness]) if (t) for (const r of t.rows) scan.push(...r);
    for (const r of p.results) scan.push(r.name, r.classification);
    for (const f of Object.values(p.runFields.fields)) scan.push(f.value, ...f.items);
    scan.push(...p.deviations, p.healText || '');
    if (scan.some((s) => SECRET_RE.test(String(s)))) model.errors.push({ kind: 'secret-literal', line: p.line, detail: 'phase ' + p.n + ' contains a password-shaped literal' });
    return { ...p, counts, outcome };
  });

  // ---- run history
  if (doc.history) {
    const t = doc.history;
    const ci = { phase: col(t, /^phase$/i), date: col(t, /^date$/i), outcome: col(t, /^outcome$/i), duration: col(t, /^duration$/i), bugs: col(t, /^bugs$/i) };
    const rows = t.rows.map((r) => ({ phase: toNum(cell(r, ci.phase).replace(/phase/i, '')), date: stripMd(cell(r, ci.date)), outcome: stripMd(cell(r, ci.outcome)), duration: stripMd(cell(r, ci.duration)) || DASH, bugs: stripMd(cell(r, ci.bugs)) || DASH, cells: r }));
    for (const p of phases) {
      const row = rows.find((r) => r.phase === p.n);
      if (!row) { mm({ kind: 'run-history', phase: p.n, field: 'row', written: DASH, computed: 'phase ' + p.n, source: 'run-history' }); continue; }
      if (row.outcome !== p.outcome) mm({ kind: 'run-history', phase: p.n, field: 'Outcome', written: row.outcome, computed: p.outcome, source: 'run-history' });
      if (row.date && row.date !== p.date) mm({ kind: 'run-history', phase: p.n, field: 'Date', written: row.date, computed: p.date, source: 'run-history' });
      for (const k of COUNT_KEYS) { const idx = col(t, new RegExp('^' + COUNT_LABEL[k] + '$', 'i')); if (idx < 0) { if (k === 'partial' && p.counts && p.counts.partial) mm({ kind: 'run-history', phase: p.n, field: COUNT_LABEL[k], written: DASH, computed: p.counts[k], source: 'run-history' }); continue; } const w = toNum(cell(row.cells, idx)); const c = p.counts ? p.counts[k] : null; if ((w === null) !== (c === null) || (w !== null && w !== c)) mm({ kind: 'run-history', phase: p.n, field: COUNT_LABEL[k], written: w === null ? stripMd(cell(row.cells, idx)) || DASH : w, computed: c === null ? DASH : c, source: 'run-history' }); }
    }
    for (const r of rows) if (r.phase !== null && !phases.some((p) => p.n === r.phase)) mm({ kind: 'run-history', phase: r.phase, field: 'row', written: 'phase ' + r.phase, computed: 'no `## Phase ' + r.phase + '` section', source: 'run-history' });
    model.history = rows;
  } else model.history = [];

  // ---- run files
  const runsPresent = runsDir && fs.existsSync(runsDir) && fs.statSync(runsDir).isDirectory();
  for (const p of phases) {
    p.run = null; p.runFile = runsDir ? path.join(runsDir, 'phase-' + p.n + '.json') : null;
    if (!p.runFile || !isFile(p.runFile)) { model.warnings.push({ kind: 'run-file-missing', phase: p.n, detail: (runsPresent ? '' : 'no .runs/ folder — ') + '.runs/phase-' + p.n + '.json not found; variants and attempts are not shown' }); continue; }
    let raw; let data;
    try { raw = readText(p.runFile); data = JSON.parse(raw); } catch (e) { model.errors.push({ kind: 'run-file-unreadable', phase: p.n, detail: '.runs/phase-' + p.n + '.json: ' + e.message }); continue; }
    model.runFiles.push({ phase: p.n, sha256: sha256(raw) });
    if (!data || data.schema !== RUN_SCHEMA) { model.warnings.push({ kind: 'run-file-schema', phase: p.n, detail: '.runs/phase-' + p.n + '.json has schema "' + (data && data.schema) + '", expected ' + RUN_SCHEMA + ' — ignored' }); continue; }
    if (SECRET_RE.test(raw)) model.errors.push({ kind: 'secret-literal', phase: p.n, detail: '.runs/phase-' + p.n + '.json contains a password-shaped literal' });
    if (Number(data.phase) !== p.n) model.warnings.push({ kind: 'run-file-phase', phase: p.n, detail: '.runs/phase-' + p.n + '.json says phase ' + data.phase });
    p.run = data;
    if (p.counts && data.totals) for (const k of COUNT_KEYS) { const key = k === 'notrun' ? 'not_run' : k; if (data.totals[key] !== undefined && Number(data.totals[key]) !== p.counts[k]) mm({ kind: 'run-file', phase: p.n, field: COUNT_LABEL[k], written: data.totals[key], computed: p.counts[k], source: 'run-file' }); }
    const rel = (x) => { if (!x) return null; const s = String(x).replace(/\\/g, '/'); const root = String(data.results_root || '').replace(/\\/g, '/').replace(/\/+$/, ''); return root ? path.posix.relative(root, s) : s; };
    for (const r of p.results) {
      const x = (data.results || []).find((y) => y.tc_id === r.tc);
      if (!x) { model.warnings.push({ kind: 'run-file-tc-missing', phase: p.n, id: r.tc, detail: r.tc + ' is not in .runs/phase-' + p.n + '.json results[]' }); continue; }
      if (x.status && String(x.status).toUpperCase() !== r.status) mm({ kind: 'run-file', phase: p.n, field: r.tc + ' status', written: x.status, computed: r.status, source: 'run-file' });
      r.error = x.error_message || '';
      r.missingVariants = Array.isArray(x.missing_variants) ? x.missing_variants : [];
      r.attempts = [];
      for (const v of x.variants || []) for (const a of v.attempts || []) {
        const ev = []; const ctx = { phase: p.n, id: r.tc + ' · ' + (v.variant_slug || '') + ' · attempt ' + a.attempt };
        if (a.evidence_screenshot) ev.push(...parseLinks('[attempt-' + a.attempt + '.png](' + rel(a.evidence_screenshot) + ')', ctx, model, { mdDir, group: 'phase-' + p.n }));
        if (a.failure_screenshot) ev.push(...parseLinks('[failed](' + rel(a.failure_screenshot) + ')', ctx, model, { mdDir, group: 'phase-' + p.n }));
        r.attempts.push({ variant: v.variant_slug || DASH, attempt: num(a.attempt), stage: a.stage || DASH, status: String(a.status || DASH).toUpperCase(), evidence: ev, error: a.error_message || a.error || '' });
      }
    }
    for (const x of data.results || []) if (!p.results.some((r) => r.tc === x.tc_id)) mm({ kind: 'run-file', phase: p.n, field: x.tc_id, written: 'in run file', computed: 'not in the Results table', source: 'run-file' });
  }

  // ---- header comparison
  const latest = phases.length ? phases[phases.length - 1] : null;
  if (latest) {
    const lp = toNum(h['Latest phase']); if (lp !== null && lp !== latest.n) mm({ kind: 'header', phase: latest.n, field: 'Latest phase', written: lp, computed: latest.n, source: 'header' });
    const st = stripMd(h['Status'] || '');
    if (st && !OUTCOMES.includes(st)) model.errors.push({ kind: 'unknown-enum', line: 1, detail: 'header Status "' + st + '" is not one of ' + OUTCOMES.join(' / ') });
    else if (st && st !== latest.outcome) mm({ kind: 'header', phase: latest.n, field: 'Status', written: st, computed: latest.outcome, source: 'header' });
    const lr = h['Latest results'];
    if (lr !== undefined) {
      const c = latest.counts;
      const computed = c ? formatLatest(c) : DASH;
      const same = c ? latestMatches(lr, c) : bare(lr) === '';
      if (!same) mm({ kind: 'header', phase: latest.n, field: 'Latest results', written: lr, computed, source: 'header' });
    }
  }

  // ---- bug report
  let bugs = null;
  if (bugDoc) {
    model.errors.push(...bugDoc.errors); model.warnings.push(...bugDoc.warnings);
    const entries = bugDoc.entries.map((b) => {
      const screenshot = parseLinks(b.screenshotRaw, { phase: b.foundIn || undefined, id: b.id }, model, { mdDir, group: 'bugs' });
      if (b.foundIn !== null && !phases.some((p) => p.n === b.foundIn)) mm({ kind: 'bug-phase-unknown', phase: b.foundIn, field: b.id + ' Found in phase', written: b.foundIn, computed: 'no such phase in the run report', source: 'bug-report' });
      if (b.resolvedPhase !== null && !phases.some((p) => p.n === b.resolvedPhase)) mm({ kind: 'bug-phase-unknown', phase: b.resolvedPhase, field: b.id + ' resolved (phase)', written: b.resolvedPhase, computed: 'no such phase in the run report', source: 'bug-report' });
      const foundPhase = phases.find((p) => p.n === b.foundIn);
      if (foundPhase && b.tc !== DASH && !foundPhase.results.some((r) => r.tc === b.tc)) model.warnings.push({ kind: 'bug-unknown-tc', id: b.id, detail: b.id + ' references ' + b.tc + ', which is not in phase ' + b.foundIn + '\'s Results table' });
      const texts = [b.title, b.rootCause, ...b.steps, b.expected, b.actual, b.evidence, ...b.history];
      if (texts.some((s) => SECRET_RE.test(String(s)))) model.errors.push({ kind: 'secret-literal', line: b.line, detail: b.id + ' contains a password-shaped literal' });
      return { ...b, screenshot };
    });
    const counts = { open: entries.filter((b) => b.status === 'open').length, resolved: entries.filter((b) => b.status === 'resolved').length, notChecked: entries.filter((b) => b.status === 'not-checked').length, total: entries.length };
    const hb = bugDoc.header['Bugs'];
    if (hb !== undefined) { const ns = numsIn(hb); const want = [counts.open, counts.resolved, counts.notChecked, counts.total]; if (!(ns.length >= 4 && want.every((x, i) => ns[i] === x))) mm({ kind: 'bug-count', phase: null, field: 'Bugs', written: hb, computed: counts.open + ' open · ' + counts.resolved + ' resolved · ' + counts.notChecked + ' not checked this run of ' + counts.total, source: 'bug-report' }); }
    else model.warnings.push({ kind: 'bug-header-missing', detail: 'bug report has no `**Bugs:**` count line' });
    const blp = toNum(bugDoc.header['Latest phase']); if (latest && blp !== null && blp !== latest.n) mm({ kind: 'bug-count', phase: latest.n, field: 'Bug report · Latest phase', written: blp, computed: latest.n, source: 'bug-report' });
    for (const p of phases) for (const ref of p.bugRefs) if (!entries.some((b) => b.id === ref.id)) mm({ kind: 'bug-ref-missing', phase: p.n, field: ref.id, written: ref.id, computed: 'not in BUG-REPORT', source: 'bug-report' });
    bugs = { entries, counts, header: bugDoc.header, feature: bugDoc.feature };
  }

  // ---- legacy files in the story folder
  try {
    for (const f of fs.readdirSync(mdDir)) if (/^phase-\d+\.(json|html)$/i.test(f) || ['merged-results.json', 'run-plan.json', 'open-questions.json', 'data-readiness.json', 'stages', 'coverage-previous.json'].includes(f)) model.legacyFiles.push(f);
    for (const f of ['coverage/coverage-dashboard.html', 'coverage/coverage-previous.json']) if (isFile(path.join(mdDir, f))) model.legacyFiles.push(f);
  } catch { /* folder unreadable — nothing to list */ }
  model.legacyFiles.sort();
  if (model.legacyFiles.length && !bare(h['Earlier phases'] || '')) model.warnings.push({ kind: 'legacy-phase-files-unlisted', detail: 'legacy artifacts found in the story folder (' + model.legacyFiles.join(', ') + ') but the header has no `**Earlier phases:**` line naming them' });

  return { ...model, feature: doc.feature, header: h, phases, latest, bugs };
}

/* ============================================================================================
 * Template engine — copied verbatim from skill 3's render-tc-review.mjs (behaviour must stay identical)
 * ========================================================================================== */
export const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const BLOCK_RE = /<!--\s*\{\{([#/])(each|if|unless)(?:\s+([\w.@-]+))?\}\}\s*-->\n?/g;

function compile(tpl) {
  const tokens = []; let last = 0;
  for (const m of tpl.matchAll(BLOCK_RE)) {
    if (m.index > last) tokens.push({ text: tpl.slice(last, m.index) });
    tokens.push({ tag: m[1] === '#' ? 'open' : 'close', kind: m[2], name: m[3] });
    last = m.index + m[0].length;
  }
  if (last < tpl.length) tokens.push({ text: tpl.slice(last) });
  let i = 0;
  const parse = (closeKind) => {
    const nodes = [];
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t.text !== undefined) { nodes.push(t); continue; }
      if (t.tag === 'close') { if (t.kind !== closeKind) throw new Error('template: unexpected {{/' + t.kind + '}}'); return nodes; }
      nodes.push({ kind: t.kind, name: t.name, children: parse(t.kind) });
    }
    if (closeKind) throw new Error('template: unclosed {{#' + closeKind + '}}');
    return nodes;
  };
  return parse(null);
}
function lookup(ctxs, name) {
  const [head, ...rest] = name.split('.');
  for (let i = ctxs.length - 1; i >= 0; i--) {
    const c = ctxs[i];
    if (c && typeof c === 'object' && head in c) { let v = c[head]; for (const k of rest) v = v && typeof v === 'object' ? v[k] : undefined; return v; }
  }
  return undefined;
}
function renderNodes(nodes, ctxs) {
  let out = '';
  for (const nd of nodes) {
    if (nd.text !== undefined) {
      out += nd.text.replace(/\{\{\{([\w.@-]+)\}\}\}|\{\{([\w.@-]+)\}\}/g, (m, raw, esc) => {
        const v = lookup(ctxs, raw || esc);
        if (v === undefined) return m; // left in place → the placeholder check BLOCKs
        return raw ? String(v) : escapeHtml(v);
      });
      continue;
    }
    const v = lookup(ctxs, nd.name);
    if (nd.kind === 'if') { if (v && !(Array.isArray(v) && !v.length)) out += renderNodes(nd.children, ctxs); continue; }
    if (nd.kind === 'unless') { if (!v || (Array.isArray(v) && !v.length)) out += renderNodes(nd.children, ctxs); continue; }
    if (nd.kind === 'each') { if (Array.isArray(v)) v.forEach((item, idx) => { out += renderNodes(nd.children, [...ctxs, { ...(typeof item === 'object' && item !== null ? item : { value: item }), '@index1': idx + 1, '@first': idx === 0 }]); }); }
  }
  return out;
}

/* ==== report-shell kit — BEGIN ==============================================================
 * Copied verbatim between scripts/render-tc-review.mjs (skills 3 / 3b / 3c) and
 * scripts/render-run-report.mjs (skill 5): /sync-skills copies one skill folder at a time, so neither
 * imports the other. Both harnesses compare this block between BEGIN and END against every sibling
 * present. Relies on escapeHtml, compile, renderNodes, sha256 and SECRET_RE, defined identically in
 * both scripts. It feeds assets/report-shell.template.html (the one general page) and owns the
 * reviewer-comments file REVIEW-COMMENTS-{feature}.md: parse, attach to page items, render the boxes.
 * ========================================================================================== */
export const COMMENT_STATUSES = ['open', 'applied', 'answered', 'declined'];
export const SHELL_STRINGS = {
  en: {
    c_toolbar: 'Reviewer comments', c_reviewer: 'Reviewer', c_save: 'Save comments', c_copy: 'Copy for chat', c_theme: 'Theme',
    c_general_title: 'Reviewer comments', c_general_note: 'type in any comment box on this page, then Save comments (the file goes beside this page) or Copy for chat — then tell the chat "read my comments"',
    c_title: 'Reviewer comment', c_note: 'Reviewer comment (in the markdown):', c_open: 'open comment', c_stale: 'written on an earlier revision',
    c_response: 'Response:', c_orphans: 'Comments on items no longer on this page', c_placeholder: 'Type a comment for the QA skill…',
    cm_open: 'open', cm_applied: 'applied', cm_answered: 'answered', cm_declined: 'declined',
    c_viewer: 'Screenshot viewer', c_prev: 'Previous screenshot', c_next: 'Next screenshot', c_zoom_in: 'Zoom in', c_zoom_out: 'Zoom out',
    c_actual: 'Actual size', c_fit: 'Fit to width', c_open_original: 'Open original in new tab', c_close: 'Close viewer',
    js: {
      theme: 'Theme', theme_auto: 'auto', theme_light: 'light', theme_dark: 'dark', viewer: 'Screenshot',
      drafts: '{n} unsaved comment(s)', saved: 'Saved — {n} open comment(s). Tell the chat: "read my comments".',
      downloaded: 'Downloaded — {n} open comment(s). Move the file from Downloads beside this page, then tell the chat: "read my comments".',
      copied: 'Copied — paste it into the chat.', copy_failed: 'Copy failed — use Save comments instead.',
      no_storage: 'This browser does not keep drafts for local files — save before closing the page.', file_title: 'Review comments',
    },
  },
  ar: {
    c_toolbar: 'تعليقات المراجع', c_reviewer: 'المراجع', c_save: 'حفظ التعليقات', c_copy: 'نسخ للمحادثة', c_theme: 'المظهر',
    c_general_title: 'تعليقات المراجع', c_general_note: 'اكتب في أي مربع تعليق في هذه الصفحة ثم اضغط حفظ التعليقات (يُحفظ الملف بجوار الصفحة) أو نسخ للمحادثة — ثم اكتب في المحادثة "read my comments"',
    c_title: 'تعليق المراجع', c_note: 'تعليق المراجع (في ملف الماركداون):', c_open: 'تعليق مفتوح', c_stale: 'كُتب على نسخة سابقة',
    c_response: 'الرد:', c_orphans: 'تعليقات على عناصر لم تعد في هذه الصفحة', c_placeholder: 'اكتب تعليقًا لمهارة الجودة…',
    cm_open: 'مفتوح', cm_applied: 'طُبِّق', cm_answered: 'أُجيب', cm_declined: 'رُفض',
    c_viewer: 'عارض لقطات الشاشة', c_prev: 'اللقطة السابقة', c_next: 'اللقطة التالية', c_zoom_in: 'تكبير', c_zoom_out: 'تصغير',
    c_actual: 'الحجم الفعلي', c_fit: 'ملاءمة العرض', c_open_original: 'فتح الأصل في علامة تبويب جديدة', c_close: 'إغلاق العارض',
    js: {
      theme: 'المظهر', theme_auto: 'تلقائي', theme_light: 'فاتح', theme_dark: 'داكن', viewer: 'لقطة شاشة',
      drafts: '{n} تعليق غير محفوظ', saved: 'تم الحفظ — {n} تعليق مفتوح. اكتب في المحادثة: "read my comments".',
      downloaded: 'تم التنزيل — {n} تعليق مفتوح. انقل الملف من مجلد التنزيلات بجوار هذه الصفحة ثم اكتب في المحادثة: "read my comments".',
      copied: 'تم النسخ — الصقه في المحادثة.', copy_failed: 'فشل النسخ — استخدم حفظ التعليقات.',
      no_storage: 'هذا المتصفح لا يحتفظ بالمسودات للملفات المحلية — احفظ قبل إغلاق الصفحة.', file_title: 'Review comments',
    },
  },
};
/** Reviewer text is escaped and its braces neutralised, so a comment can never look like a template placeholder. */
const escText = (s) => escapeHtml(s).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

/** REVIEW-COMMENTS-{feature}.md → { header, entries[{ key, id, seq, text, status, statusDate, response, tail, line }], warnings }. */
export function parseReviewComments(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const header = {}; const raw = []; const warnings = [];
  let i = 0;
  for (; i < lines.length; i++) { if (/^## /.test(lines[i])) break; const m = lines[i].match(/^\*\*([^*]+?):\*\*\s*(.*)$/); if (m) header[m[1].trim().toLowerCase()] = m[2].trim(); }
  let cur = null;
  for (; i < lines.length; i++) {
    const l = lines[i]; const h = l.match(/^## +(.+?)\s*$/);
    if (h) { cur = { key: h[1].trim(), line: i + 1, text: [], tail: [], inTail: false }; raw.push(cur); continue; }
    if (!cur) continue;
    if (!cur.inTail && /^- \*\*Status:\*\*/i.test(l)) cur.inTail = true;
    (cur.inTail ? cur.tail : cur.text).push(l);
  }
  const entries = raw.map((e) => {
    const km = e.key.match(/^(.+?)(?:\s+\((\d+)\))?$/);
    const text = e.text.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    const tail = e.tail.join('\n').replace(/\s+$/, '');
    const sm = tail.match(/^- \*\*Status:\*\*\s*(\S+)(?:\s+(\d{4}-\d{2}-\d{2}))?/i);
    let status = sm ? sm[1].toLowerCase() : 'open';
    if (!COMMENT_STATUSES.includes(status)) { warnings.push({ kind: 'comment-status-unknown', id: e.key, detail: 'comment "' + e.key + '" has Status "' + (sm ? sm[1] : '') + '" — treated as open' }); status = 'open'; }
    const tl = tail.split('\n'); const ri = tl.findIndex((x) => /^- \*\*Response:\*\*/i.test(x)); let response = '';
    if (ri >= 0) { const parts = [tl[ri].replace(/^- \*\*Response:\*\*\s*/i, '')]; for (let j = ri + 1; j < tl.length && !/^- \*\*/.test(tl[j]); j++) parts.push(tl[j].trim()); response = parts.join('\n').trim(); }
    return { key: e.key, id: km[1].trim(), seq: km[2] ? Number(km[2]) : 1, text: text === '—' ? '' : text, status, statusDate: sm && sm[2] ? sm[2] : '', response, tail: tail || '- **Status:** open', line: e.line };
  });
  return { header, entries, warnings };
}

/**
 * Attach the comments file to the page's items.
 * opts: { text (file content or null), file (relative path for the payload), page (this page's file name),
 *         sourceRev (first 12 of the source sha256), known (Map id → kind; 'General' is always known) }.
 */
export function commentsModel({ text, file, page, sourceRev, known }) {
  const out = { file: text === null || text === undefined ? null : file, fileRev: text ? sha256(text).slice(0, 12) : 'none', page: null, sourceRev: null, reviewer: '', stale: false, ignored: false, entries: [], byId: new Map(), orphans: [], open: 0, handled: 0, warnings: [], errors: [] };
  if (text === null || text === undefined) return out;
  const p = parseReviewComments(text);
  out.warnings.push(...p.warnings);
  out.page = p.header.page || null; out.sourceRev = p.header['source revision'] || null; out.reviewer = p.header.reviewer || '';
  if (out.page && out.page !== page) { out.ignored = true; out.warnings.push({ kind: 'comments-page-mismatch', detail: file + ' was saved from ' + out.page + ', not from ' + page + ' — its comments are not shown on this page' }); return out; }
  out.stale = !!(out.sourceRev && sourceRev && out.sourceRev !== sourceRev);
  if (out.stale) out.warnings.push({ kind: 'comments-stale-revision', detail: file + ' was written on source revision ' + out.sourceRev + '; the source is now ' + sourceRev + ' — the comments are shown marked "written on an earlier revision"' });
  for (const en of p.entries) {
    if (SECRET_RE.test(en.text) || SECRET_RE.test(en.response)) { out.errors.push({ kind: 'secret-literal', line: en.line, detail: 'comment "' + en.key + '" contains a password-shaped literal — remove it from ' + file }); continue; }
    if (en.id === 'General' && !en.text && en.status === 'open') continue; // the always-present empty General section
    out.entries.push(en);
    if (en.status === 'open') out.open++; else out.handled++;
    if (en.id !== 'General' && !known.has(en.id)) { out.orphans.push(en); out.warnings.push({ kind: 'comment-unknown-id', id: en.id, detail: 'comment "' + en.key + '" names ' + en.id + ', which is not on this page — shown under "' + SHELL_STRINGS.en.c_orphans + '"' }); continue; }
    if (!out.byId.has(en.id)) out.byId.set(en.id, []);
    out.byId.get(en.id).push(en);
  }
  const hc = (p.header.comments || '').match(/(\d+)\s*open\s*·\s*(\d+)\s*handled\s*of\s*(\d+)/i);
  if (p.header.comments && (!hc || Number(hc[1]) !== out.open || Number(hc[2]) !== out.handled || Number(hc[3]) !== out.open + out.handled)) out.warnings.push({ kind: 'comments-header-count', detail: file + ' header says "' + p.header.comments + '" but the file holds ' + out.open + ' open · ' + out.handled + ' handled — the page counts the entries' });
  return out;
}

/** One comment box: markdown note, handled history, then a textarea per open entry (or one empty textarea). */
export function commentBoxHtml(id, kind, cm, lang, note) {
  const S = SHELL_STRINGS[lang] || SHELL_STRINGS.en;
  const list = cm.byId.get(id) || [];
  const open = list.filter((e) => e.status === 'open'); const done = list.filter((e) => e.status !== 'open');
  const attrs = ' data-comment-id="' + escapeHtml(id) + '"';
  let h = '<div class="comment-box"' + attrs + ' data-comment-kind="' + escapeHtml(kind) + '">\n';
  h += '  <p class="comment-label">' + escapeHtml(S.c_title) + (open.length ? ' <span class="badge cm-open">' + escapeHtml(S.c_open) + '</span>' : '') + (list.length && cm.stale ? ' <span class="badge cm-stale">' + escapeHtml(S.c_stale) + '</span>' : '') + '</p>\n';
  const noteText = String(note || '').trim();
  if (noteText && noteText !== '—' && !list.some((e) => e.text.trim() === noteText)) h += '  <p class="comment-note"><b>' + escapeHtml(S.c_note) + '</b> ' + escText(noteText) + '</p>\n';
  for (const e of done) h += '  <div class="comment-entry cm-' + e.status + '"><p class="comment-text">' + escText(e.text || '—') + '</p><p class="comment-meta"><span class="badge cm-' + e.status + '">' + escapeHtml(S['cm_' + e.status]) + (e.statusDate ? ' <span class="ltr">' + escapeHtml(e.statusDate) + '</span>' : '') + '</span>' + (e.response ? ' <span class="resp"><b>' + escapeHtml(S.c_response) + '</b> ' + escText(e.response) + '</span>' : '') + '</p></div>\n';
  const ta = (entryKey, value) => '  <textarea class="comment-input" data-comment-input' + attrs + (entryKey ? ' data-entry="' + escapeHtml(entryKey) + '"' : '') + ' rows="2" aria-label="' + escapeHtml(S.c_title + ' · ' + id) + '" placeholder="' + escapeHtml(S.c_placeholder) + '">' + escText(value) + '</textarea>\n';
  if (open.length) for (const e of open) h += ta(e.key, e.text); else h += ta(null, '');
  return h + '</div>';
}

/** Entries whose item is no longer on the page — shown read-only, never dropped (Save keeps them). */
export function orphansHtml(cm, lang) {
  if (!cm.orphans.length) return '';
  const S = SHELL_STRINGS[lang] || SHELL_STRINGS.en;
  let h = '<div class="comments-orphans">\n  <h3 class="sub-head">' + escapeHtml(S.c_orphans) + '</h3>\n';
  for (const e of cm.orphans) h += '  <div class="comment-entry cm-' + e.status + '"><p class="comment-meta"><span class="badge"><span class="ltr">' + escapeHtml(e.key) + '</span></span> <span class="badge cm-' + e.status + '">' + escapeHtml(S['cm_' + e.status]) + '</span></p><p class="comment-text">' + escText(e.text || '—') + '</p></div>\n';
  return h + '</div>';
}

/** JSON island for the shell script: page identity, strings, and the saved entries verbatim (Save re-emits them). */
export function reportJson({ pageKind, feature, page, source, sourceRev, commentsFile, cm, lang }) {
  const S = SHELL_STRINGS[lang] || SHELL_STRINGS.en;
  const data = { pageKind, feature, page, source, sourceRev, commentsFile, strings: S.js,
    comments: { fileRev: cm.fileRev, reviewer: cm.reviewer, entries: cm.ignored ? [] : cm.entries.map((e) => ({ key: e.key, id: e.id, seq: e.seq, text: e.text, status: e.status, tail: e.tail })) } };
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\{\{/g, '{\\u007b');
}

/**
 * Second pass: the shell around the rendered body. d: { lang, dir, pageKind, pageTitle, eyebrow, title, sub (HTML | ''),
 * meta [{label, html}], banners [{cls, html}], tiles [{value, label_html, cls}], body, footer (HTML), cm, feature, page, source, sourceRev, commentsFile }.
 */
export function renderShell(shellTpl, d) {
  const S = SHELL_STRINGS[d.lang] || SHELL_STRINGS.en;
  const { js, ...labels } = S;
  const vm = {
    ...labels, lang: d.lang, dir: d.dir, page_kind: d.pageKind, page_title: d.pageTitle, eyebrow: d.eyebrow, title: d.title,
    has_sub: !!d.sub, sub: d.sub || '', meta_items: d.meta, banners: d.banners, has_tiles: d.tiles.length > 0, tiles: d.tiles,
    body: d.body, footer: d.footer, general_box: commentBoxHtml('General', 'general', d.cm, d.lang, ''), orphans_html: orphansHtml(d.cm, d.lang),
    report_json: reportJson({ pageKind: d.pageKind, feature: d.feature, page: d.page, source: d.source, sourceRev: d.sourceRev, commentsFile: d.commentsFile, cm: d.cm, lang: d.lang }),
  };
  return renderNodes(compile(shellTpl), [vm]);
}
/* ==== report-shell kit — END ==== */

/* ============================================================================================
 * View model
 * ========================================================================================== */
const table = (t) => (t ? { header: t.header.map((x) => ({ text: x || DASH })), rows: t.rows.map((r) => ({ cells: r.map((c) => ({ text: bare(c) || DASH })) })) } : null);
function covView(p) {
  const out = { has_coverage: false, cov_stages: [], cov_target: '', has_cov_reqs: false, cov_reqs: [] };
  if (!p || !p.covStages) return out;
  const t = p.covStages;
  const ci = { stage: col(t, /^stage$/i), total: col(t, /^total/i), full: col(t, /^fully/i), partial: col(t, /^partially/i), none: col(t, /^not/i), pct: col(t, /^weighted/i) };
  out.has_coverage = true;
  out.cov_stages = t.rows.map((r) => {
    const total = toNum(cell(r, ci.total)); const full = toNum(cell(r, ci.full)); const partial = toNum(cell(r, ci.partial)); const none = toNum(cell(r, ci.none));
    const w = (x) => (total && x !== null ? Math.round((x / total) * 100) : 0);
    const pct = toNum(cell(r, ci.pct));
    return { name: stripMd(cell(r, ci.stage)), total: num(total), full: num(full), partial: num(partial), none: num(none), w_full: w(full), w_partial: w(partial), w_none: w(none), pct: pct === null ? DASH : pct + '%' };
  });
  out.cov_target = p.covTarget ? stripMd(p.covTarget) : DASH;
  if (p.covReqs) {
    const c2 = { id: col(p.covReqs, /^requirement$/i), outcome: col(p.covReqs, /^outcome$/i), by: col(p.covReqs, /^asserted/i) };
    out.has_cov_reqs = p.covReqs.rows.length > 0;
    out.cov_reqs = p.covReqs.rows.map((r) => { const o = stripMd(cell(r, c2.outcome)); return { id: stripMd(cell(r, c2.id)) || DASH, outcome: o || DASH, outcome_class: 'c-' + (o || 'missing').toLowerCase(), asserted: bare(cell(r, c2.by)) || DASH }; });
  }
  return out;
}

function viewModel(model, files, cm) {
  const latest = model.latest; const c = latest ? latest.counts : null; const h = model.header;
  const hv = (k) => bare(h[k] || '') || DASH;
  const countsLine = (x) => (x ? x.passed + ' / ' + x.failed + ' / ' + x.incomplete + ' / ' + x.skipped + ' / ' + x.notrun + ' / ' + x.partial + ' of ' + x.total : DASH);
  const lastWithResults = [...model.phases].reverse().find((p) => p.counts) || null;
  const tilesFrom = lastWithResults && (!latest || !latest.counts) ? lastWithResults : latest;
  const tc = tilesFrom ? tilesFrom.counts : null;
  const run = tilesFrom ? tilesFrom.run : null;
  const vt = run && run.variant_totals ? run.variant_totals : null;
  const durationOf = (p) => (p ? bare(fieldValue(p.runFields.fields, 'Duration')) : '');
  const dur = tilesFrom ? durationOf(tilesFrom) : '';
  const durMain = dur ? dur.replace(/\s*\(.*$/, '') : DASH;
  const durRest = dur && /\(/.test(dur) ? dur.replace(/^[^(]*\(/, '').replace(/\)\s*$/, '') : (run && run.run_plan && run.run_plan.estimate ? 'planned ~' + num(run.run_plan.estimate.planned_s) + 's · serial-only ~' + num(run.run_plan.estimate.serial_only_s) + 's' : 'planned vs actual unknown');
  const cov = covView(tilesFrom);
  const covTotal = cov.cov_stages.find((s) => /^total$/i.test(s.name));
  const covTile = covTotal ? covTotal.pct : (run && run.coverage_snapshot && run.coverage_snapshot.weightedPct !== undefined ? num(run.coverage_snapshot.weightedPct) + '%' : DASH);
  // `**Target:** 80% (default, soft block) — **PASS** · **Δ vs phase 1:** …` → the verdict is the text between the first ` — ` and the first ` · `
  const covVerdict = tilesFrom && tilesFrom.covTarget ? ((stripMd(tilesFrom.covTarget).match(/[—–-]\s*([^·]+?)\s*(?:·|$)/) || [])[1] || DASH) : (run && run.coverage_snapshot ? run.coverage_snapshot.verdict || DASH : DASH);
  const bugs = model.bugs;
  const phases = model.phases.map((p) => {
    const runFields = p.runFields.order.filter((k) => !/^(outcome|reviewer comment)$/i.test(k)).map((k) => ({ name: k, value: bare(p.runFields.fields[k].value) || DASH }));
    const stages = p.stages ? (() => { const t = p.stages; const ci = { stage: col(t, /^stage$/i) }; const get = (r, k) => { const i = col(t, new RegExp('^' + COUNT_LABEL[k] + '$', 'i')); return i < 0 ? DASH : bare(cell(r, i)) || DASH; }; return t.rows.map((r) => { const name = stripMd(cell(r, ci.stage)); return { name, total: get(r, 'total'), passed: get(r, 'passed'), failed: get(r, 'failed'), incomplete: get(r, 'incomplete'), skipped: get(r, 'skipped'), notrun: get(r, 'notrun'), partial: get(r, 'partial'), row_class: /^total$/i.test(name) ? 'is-total' : '' }; }); })() : [];
    const sg = p.smokeGate ? stripMd(p.smokeGate) : '';
    const sgm = sg.match(/^(passed|healed-then-passed(?:\s*\([^)]*\))?|FAILED-STOPPED)\s*(.*)$/);
    const results = p.results.map((r) => ({
      tc: r.tc, anchor: 'tc-' + p.n + '-' + r.tc, req: r.req, name: r.name || DASH, status: statusText(r.status, r.statusReason), status_class: resultClass(r.status), row_class: r.status === 'FAIL' ? 'gap' : '',
      group: r.group, duration: r.duration, classification: r.classification, evidence: r.evidence || [], has_evidence: (r.evidence || []).length > 0,
      has_attempts: !!(r.attempts && (r.attempts.length > 1 || (r.missingVariants && r.missingVariants.length))), attempts: (r.attempts || []).map((a) => ({ ...a, status_class: resultClass(a.status), error: a.error || DASH })),
      missing_note: r.missingVariants && r.missingVariants.length ? ' · missing required variants: ' + r.missingVariants.join(', ') : '',
    }));
    const cv = covView(p);
    return {
      n: p.n, date: p.date, outcome: p.outcome || DASH, outcome_class: outcomeClass(p.outcome), is_latest: latest && p.n === latest.n, open_attr: latest && p.n === latest.n ? ' open' : '',
      summary_counts: p.counts ? 'passed / failed / incomplete / skipped / not run / partial · ' + countsLine(p.counts) : 'no results table', reason: p.reason, has_reason: !!p.reason,
      run_fields: runFields, has_stages: stages.length > 0, stages, has_smoke: !!sg, smoke_verdict: sgm ? sgm[1] : sg, smoke_rest: sgm ? sgm[2] : '', smoke_class: /^FAILED/.test(sg) ? 's-fail' : /^healed/.test(sg) ? 's-incomplete' : 's-pass',
      has_plan: !!p.plan, plan: table(p.plan), has_plan_decisions: !!p.planDecisions, plan_decisions: p.planDecisions ? 'Decisions: ' + stripMd(p.planDecisions) : '',
      ...cv,
      has_results: p.hasResultsTable, results,
      has_assumptions: !!(p.assumptions && p.assumptions.rows.length), assumptions: table(p.assumptions),
      has_bugrefs: p.bugRefs.length > 0, bugrefs: p.bugRefs.map((b) => { const st = b.status.toLowerCase(); return { ...b, anchor: b.id, status_class: /^resolved/.test(st) ? 'b-resolved' : /not/.test(st) ? 'b-not-checked' : 'b-open' }; }),
      has_heals: !!(p.heals && p.heals.rows.length), heals: table(p.heals), has_heal_text: !p.heals && !!p.healText, heal_text: p.healText,
      has_skips: !!(p.skips && p.skips.rows.length), skips: table(p.skips),
      has_questions: !!(p.questions && p.questions.rows.length), questions: table(p.questions),
      has_readiness: !!(p.readinessVerdict || p.readiness), readiness_verdict: p.readinessVerdict ? 'Verdict: ' + stripMd(p.readinessVerdict) : DASH, has_readiness_rows: !!(p.readiness && p.readiness.rows.length), readiness: table(p.readiness),
      has_deviations: p.deviations.length > 0, deviations: p.deviations.map((d) => ({ text: d })),
      comment_box: commentBoxHtml('phase-' + p.n, 'phase', cm, 'en', bare(fieldValue(p.runFields.fields, 'Reviewer comment'))),
    };
  });
  const bugCards = bugs ? bugs.entries.map((b) => {
    const foundPhase = model.phases.find((p) => p.n === b.foundIn);
    const hasAnchor = !!(foundPhase && foundPhase.results.some((r) => r.tc === b.tc));
    return {
      id: b.id, anchor: b.id, title: b.title || DASH, tc: b.tc, tc_anchor: hasAnchor ? 'tc-' + b.foundIn + '-' + b.tc : '', has_tc_anchor: hasAnchor, req: b.req,
      severity: b.severity, sev_class: 'sev-' + b.severity.toLowerCase(), status: b.status || 'open', status_class: 'b-' + (b.status || 'open'), status_word: b.status === 'resolved' ? 'resolved' + (b.resolvedPhase ? ' · phase ' + b.resolvedPhase : '') : b.status === 'not-checked' ? 'not checked this run' : 'open',
      environment: b.environment, browser: b.browser, language: b.language, build: b.build, found_in: b.foundInRaw, root_cause: b.rootCause,
      steps: b.steps.map((s) => ({ text: s })), expected: b.expected, actual: b.actual,
      screenshot: b.screenshot, has_screenshot: b.screenshot.length > 0, screenshot_text: bare(b.screenshotRaw) || 'none captured',
      evidence_text: b.evidence, history: b.history.map((x) => ({ text: x })), has_history: b.history.length > 0,
      comment_box: commentBoxHtml(b.id, 'bug', cm, 'en', b.note),
    };
  }) : [];
  const vm = {
    feature: model.feature || DASH, user_story: hv('User Story'), source_doc: hv('Source document'), source_rev: hv('Source revision'), spec: hv('Spec'), environment: hv('Environment'),
    latest_phase: latest ? String(latest.n) : DASH, latest_run: hv('Latest run'), status: latest ? latest.outcome || DASH : DASH, status_class: outcomeClass(latest ? latest.outcome : ''),
    compliance: hv('Compliance'), ado_mode: hv('Azure DevOps'), run_file: hv('Run file'), screenshots_dir: hv('Screenshots'), progress_log: hv('Progress log'), earlier_phases: hv('Earlier phases'),
    bug_file: files.bugs || 'BUG-REPORT-' + (model.feature || '') + '.md', report_file: files.report,
    has_legacy: model.legacyFiles.length > 0, legacy_list: model.legacyFiles.join(', '),
    has_mismatch: model.mismatches.length > 0, mismatch_count: String(model.mismatches.length),
    gate_failed: !!latest && latest.outcome === 'SMOKE GATE FAILED', env_blocked: !!latest && (latest.outcome === 'ENVIRONMENT_BLOCKED' || latest.outcome === 'BLOCKED'), blocked_reason: latest && latest.reason ? ' — ' + latest.reason : '',
    n_passed: tc ? String(tc.passed) : DASH, n_failed: tc ? String(tc.failed) : DASH, n_incomplete: tc ? String(tc.incomplete) : DASH, n_skipped: tc ? String(tc.skipped) : DASH, n_notrun: tc ? String(tc.notrun) : DASH, n_partial: tc ? String(tc.partial) : DASH, n_total: tc ? String(tc.total) : DASH,
    variants_tile: vt ? num(vt.passed) + ' / ' + num(vt.failed) + ' / ' + num(vt.skipped) + ' / ' + num(vt.not_run) : DASH,
    duration_tile: durMain, planned_tile: durRest, coverage_tile: covTile, coverage_verdict: covVerdict || DASH,
    bugs_tile: bugs ? bugs.counts.open + ' / ' + bugs.counts.resolved + ' / ' + bugs.counts.notChecked : DASH,
    n_assumptions: tilesFrom && tilesFrom.assumptions ? String(tilesFrom.assumptions.rows.length) : (tilesFrom ? '0' : DASH),
    history: model.phases.map((p) => { const row = model.history.find((r) => r.phase === p.n); return { phase: String(p.n), date: p.date, outcome: p.outcome || DASH, outcome_class: outcomeClass(p.outcome), passed: p.counts ? String(p.counts.passed) : DASH, failed: p.counts ? String(p.counts.failed) : DASH, incomplete: p.counts ? String(p.counts.incomplete) : DASH, skipped: p.counts ? String(p.counts.skipped) : DASH, notrun: p.counts ? String(p.counts.notrun) : DASH, partial: p.counts ? String(p.counts.partial) : DASH, total: p.counts ? String(p.counts.total) : DASH, duration: durationOf(p).replace(/\s*\(.*$/, '') || (row ? row.duration : DASH), bugs: row ? row.bugs : DASH }; }),
    ...cov,
    phases,
    bugs_present: !!bugs, has_bug_entries: bugCards.length > 0, bugs: bugCards,
    bug_open: bugs ? String(bugs.counts.open) : DASH, bug_resolved: bugs ? String(bugs.counts.resolved) : DASH, bug_notchecked: bugs ? String(bugs.counts.notChecked) : DASH, bug_total: bugs ? String(bugs.counts.total) : DASH,
  };
  return vm;
}

/** The shell's generic header data for this page — meta line, banners, tiles, footer — built from the body view model. */
function shellParts(vm) {
  const e = escapeHtml; const code = (x) => '<code>' + e(x) + '</code>';
  const meta = [
    ['Spec', e(vm.spec)], ['Environment', e(vm.environment)], ['Latest phase', e(vm.latest_phase) + ' (' + e(vm.latest_run) + ')'],
    ['Status', '<span class="badge ' + e(vm.status_class) + '">' + e(vm.status) + '</span>'], ['Compliance', e(vm.compliance)], ['Azure DevOps', e(vm.ado_mode)],
    ['Run file', e(vm.run_file)], ['Screenshots', e(vm.screenshots_dir)], ['Progress log', e(vm.progress_log)], ['Bug report', e(vm.bug_file)], ['Earlier phases', e(vm.earlier_phases)],
  ].map(([label, html]) => ({ label, html }));
  const banners = [];
  if (vm.has_legacy) banners.push({ cls: 'legacy', html: 'Legacy files in this folder (read-only history, not rendered): ' + e(vm.legacy_list) });
  if (vm.has_mismatch) banners.push({ cls: 'warn-strip', html: e(vm.mismatch_count) + ' value(s) written in the markdown disagree with what the tables say — this page shows the values computed from the tables. Fix the header, run-history or bug-report lines and re-render.' });
  if (vm.gate_failed) banners.push({ cls: 'banner gate-failed', html: '<b>Smoke gate failed</b><br>The latest run stopped at the smoke gate because of application errors. Positive and negative test cases did not run; every one of them is listed as NOT_RUN below.' });
  if (vm.env_blocked) banners.push({ cls: 'banner env-blocked', html: '<b>' + e(vm.status) + '</b><br>The latest invocation did not execute the test cases' + e(vm.blocked_reason) + '. The counts below belong to the last phase that has results, if any.' });
  const tiles = [
    [vm.n_passed, 'Passed', 't-pass'], [vm.n_failed, 'Failed', 't-fail'], [vm.n_incomplete, 'Incomplete', 't-incomplete'], [vm.n_partial, 'Partial · human step pending', 't-partial'],
    [vm.n_skipped, 'Skipped', ''], [vm.n_notrun, 'Not run', ''], [vm.n_total, 'Test cases · phase ' + vm.latest_phase, ''], [vm.variants_tile, 'Variants · passed / failed / skipped / not run', ''],
    [vm.duration_tile, 'Duration · ' + vm.planned_tile, ''], [vm.coverage_tile, 'Static coverage · ' + vm.coverage_verdict, ''], [vm.bugs_tile, 'Bugs · open / resolved / not checked', ''], [vm.n_assumptions, 'Unverified assumptions', ''],
  ].map(([value, label, cls]) => ({ value, label_html: e(label), cls }));
  const footer = 'Sources of truth: ' + code(vm.report_file) + ' and ' + code(vm.bug_file) + ' — this page is rendered from them by ' + code('scripts/render-run-report.mjs') + ' and adds nothing. To change it, edit the markdown and re-render. Screenshots are linked by relative path into the screenshots folder; the page shows them only while both keep their relative positions.';
  const sub = '<span class="lbl">Feature</span> <b>' + e(vm.feature) + '</b> · source <b>' + e(vm.source_doc) + '</b> · revision <b>' + e(vm.source_rev) + '</b>';
  return { meta, banners, tiles, footer, sub };
}

/* ============================================================================================
 * Provenance + self-hash
 * ========================================================================================== */
// v1.1 adds `comments=`; the group is optional so a v1.0 page still verifies and is re-rendered without --force.
const PROV_RE = /<!-- render-run-report v[^ ]+ · report=([0-9a-f]{64}) · bugs=([0-9a-f]{64}|none) · runs=([0-9a-f]{64}|none)(?: · comments=([0-9a-f]{64}|none))? · page=([0-9a-f]{64}) -->/;
const BLANK = '0'.repeat(64);
export function selfHash(html) { return sha256(html.replace(PROV_RE, (m) => m.replace(/page=[0-9a-f]{64}/, 'page=' + BLANK))); }
function stampProvenance(html, hashes) {
  const line = '<!-- render-run-report v' + SCHEMA_VERSION + ' · report=' + hashes.report + ' · bugs=' + hashes.bugs + ' · runs=' + hashes.runs + ' · comments=' + hashes.comments + ' · page=' + BLANK + ' -->';
  const withBlank = html.replace(/^(<!DOCTYPE html>\n)/, '$1' + line + '\n');
  return withBlank.replace('page=' + BLANK, 'page=' + selfHash(withBlank));
}
export function pageState(existingHtml) {
  const m = existingHtml.match(PROV_RE);
  if (!m) return { provenance: false, handEdited: false };
  return { provenance: true, handEdited: selfHash(existingHtml) !== m[5], recorded: { report: m[1], bugs: m[2], runs: m[3], comments: m[4] || null } };
}

/* ============================================================================================
 * Pipeline
 * ========================================================================================== */
const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = path.join(here, '..', 'assets', 'run-report.template.html');

export const SHELL_PATH = path.join(here, '..', 'assets', 'report-shell.template.html');
const NO_COMMENTS = () => commentsModel({ text: null, known: new Map() });

/** Two passes: the page's body partial, then the shared report shell around it. */
export function renderHtml(model, { template, shell, files = {}, cm = NO_COMMENTS(), sourceRev = '' } = {}) {
  const tpl = template ?? readText(TEMPLATE_PATH);
  const shellTpl = shell ?? readText(SHELL_PATH);
  const feature = model.feature || '';
  const vm = viewModel(model, { report: files.report || 'TEST-RUN-REPORT-' + feature + '.md', bugs: files.bugs || null }, cm);
  const body = renderNodes(compile(tpl), [vm]).replace(/\n+$/, '');
  const html = renderShell(shellTpl, { lang: 'en', dir: 'ltr', pageKind: 'run-report', pageTitle: 'Test Run Report — ' + (model.feature || DASH), eyebrow: 'Test run report · automation evidence', title: vm.user_story, ...shellParts(vm), body, cm,
    feature, page: 'TEST-RUN-REPORT-' + feature + '.html', source: files.report || 'TEST-RUN-REPORT-' + feature + '.md', sourceRev, commentsFile: 'REVIEW-COMMENTS-' + feature + '.md' });
  const leftovers = [...new Set((html.match(/\{\{[^}]*\}\}/g) || []))];
  return { html, leftovers };
}

export function render({ reportPath, bugsPath = null, runsDir = null, commentsPath = null, template, shell, root = process.cwd() }) {
  if (!reportPath || !isFile(reportPath)) return { payload: base({ gate: 'NOT_RUN', gateReason: reportPath ? 'run report not found: ' + reportPath : 'no --report given', input: { report: reportPath || null } }), html: null, model: null };
  const text = readText(reportPath);
  const doc = parseReport(text);
  const feature = doc.feature || (path.basename(reportPath).match(/^TEST-RUN-REPORT-(.+)\.md$/i) || [])[1] || path.basename(reportPath, '.md');
  const dir = path.dirname(reportPath);
  const bp = bugsPath || path.join(dir, 'BUG-REPORT-' + feature + '.md');
  const bugText = isFile(bp) ? readText(bp) : null;
  const bugDoc = bugText !== null ? parseBugReport(bugText) : null;
  const rd = runsDir || path.join(dir, '.runs');
  const model = buildModel(doc, bugDoc, { mdDir: dir, runsDir: rd });
  if (bugText === null) model.warnings.push({ kind: 'bug-report-missing', detail: 'no bug report at ' + path.relative(root, bp) + ' — the Bugs section is empty' });
  // Reviewer comments — REVIEW-COMMENTS-{feature}.md beside the report, or --comments. Absent is normal and silent.
  const cp = commentsPath || path.join(dir, 'REVIEW-COMMENTS-' + feature + '.md');
  const commentsText = isFile(cp) ? readText(cp) : null;
  if (commentsPath && commentsText === null) model.warnings.push({ kind: 'comments-file-missing', detail: 'comments file not found: ' + path.relative(root, commentsPath) });
  const sourceRev = sha256(text).slice(0, 12);
  const known = new Map([...(model.bugs ? model.bugs.entries.map((b) => [b.id, 'bug']) : []), ...model.phases.map((p) => ['phase-' + p.n, 'phase'])]);
  const cm = commentsModel({ text: commentsText, file: path.relative(root, cp), page: 'TEST-RUN-REPORT-' + feature + '.html', sourceRev, known });
  model.errors.push(...cm.errors); model.warnings.push(...cm.warnings);
  const notes = [...(model.bugs ? model.bugs.entries.map((b) => ({ id: b.id, text: b.note, line: b.line })) : []), ...model.phases.map((p) => ({ id: 'phase-' + p.n, text: bare(fieldValue(p.runFields.fields, 'Reviewer comment')), line: p.line }))].filter((x) => x.text);
  for (const x of notes) if (SECRET_RE.test(x.text)) model.errors.push({ kind: 'secret-literal', line: x.line, detail: x.id + ' has a password-shaped literal in its Reviewer comment field' });
  let html = null; let leftovers = [];
  try { const r = renderHtml(model, { template, shell, cm, sourceRev, files: { report: path.basename(reportPath), bugs: path.basename(bp) } }); html = r.html; leftovers = r.leftovers; } catch (e) { model.errors.push({ kind: 'template-error', detail: e.message }); }
  if (leftovers.length) model.errors.push({ kind: 'placeholder-left', detail: leftovers.slice(0, 10).join(' ') });

  let gate; let gateReason;
  if (model.errors.length) { gate = 'BLOCKED'; gateReason = model.errors.length + ' error(s) would make the page wrong: ' + [...new Set(model.errors.map((e) => e.kind))].join(', '); }
  else if (model.mismatches.length) { gate = 'MISMATCH'; gateReason = model.mismatches.length + ' written value(s) disagree with the tables (' + [...new Set(model.mismatches.map((m) => m.source))].join(', ') + ')'; }
  else { gate = 'PASS'; gateReason = model.phases.length + ' phase(s), ' + (model.bugs ? model.bugs.counts.total + ' bug(s), ' : 'no bug report, ') + 'header consistent'; }
  if (gate === 'BLOCKED') html = null;

  const runsHash = model.runFiles.length ? sha256(model.runFiles.map((r) => r.phase + ':' + r.sha256).join('\n')) : 'none';
  const hashes = { report: sha256(text), bugs: bugText !== null ? sha256(bugText) : 'none', runs: runsHash, comments: commentsText !== null ? sha256(commentsText) : 'none' };
  if (html) html = stampProvenance(html, hashes);
  const latest = model.latest;
  const evidenceLinks = model.phases.reduce((n, p) => n + p.results.reduce((m, r) => m + (r.evidence || []).length + (r.attempts || []).reduce((k, a) => k + a.evidence.length, 0), 0), 0) + (model.bugs ? model.bugs.entries.reduce((n, b) => n + b.screenshot.length, 0) : 0);
  const payload = base({
    gate, gateReason,
    input: { report: path.relative(root, reportPath) || reportPath, bugs: bugText !== null ? path.relative(root, bp) : null, runs: fs.existsSync(rd) ? path.relative(root, rd) : null, comments: commentsText !== null ? path.relative(root, cp) : null, feature, template: path.relative(root, TEMPLATE_PATH), shell: path.relative(root, SHELL_PATH) },
    hashes,
    comments: { file: cm.file, page: cm.page, sourceRev: cm.sourceRev, stale: cm.stale, ignored: cm.ignored, open: cm.open, handled: cm.handled,
      items: cm.entries.map((x) => ({ key: x.key, id: x.id, kind: x.id === 'General' ? 'general' : known.get(x.id) || null, status: x.status, statusDate: x.statusDate || null })),
      unknownIds: [...new Set(cm.orphans.map((x) => x.id))], notes: notes.map((x) => ({ id: x.id, text: x.text })) },
    document: {
      feature, userStory: bare(model.header['User Story'] || '') || null, spec: bare(model.header['Spec'] || '') || null, latestPhase: latest ? latest.n : null, status: latest ? latest.outcome : null,
      compliance: bare(model.header['Compliance'] || '') || null, adoMode: bare(model.header['Azure DevOps'] || '') || null, earlierPhases: bare(model.header['Earlier phases'] || '') || null, legacyFiles: model.legacyFiles,
      phases: model.phases.map((p) => ({ phase: p.n, date: p.date, outcome: p.outcome, declared: p.declared, counts: p.counts, smokeGate: p.smokeGate ? stripMd(p.smokeGate) : null, coverage: p.covStages ? { target: p.covTarget ? stripMd(p.covTarget) : null, total: (p.covStages.rows.find((r) => /^total$/i.test(stripMd(r[0]))) || []).map(stripMd) } : null, bugRefs: p.bugRefs.map((b) => b.id), assumptions: p.assumptions ? p.assumptions.rows.length : 0, heals: p.heals ? p.heals.rows.length : 0, runFile: p.run ? { present: true, status: p.run.status || null, schema: p.run.schema } : { present: false, status: null, schema: null } })),
      bugs: model.bugs ? { present: true, ...model.bugs.counts, entries: model.bugs.entries.map((b) => ({ id: b.id, tcId: b.tc, severity: b.severity, status: b.status, foundInPhase: b.foundIn, historyLength: b.history.length, screenshot: b.screenshot.map((s) => s.href) })) } : { present: false, total: null, open: null, resolved: null, notChecked: null, entries: [] },
    },
    counts: { phases: model.phases.length, latest: latest ? latest.counts : null, evidenceLinks, evidenceMissing: model.warnings.filter((w) => w.kind === 'evidence-file-missing').length, bugs: model.bugs ? model.bugs.counts.total : null, comments: { open: cm.open, handled: cm.handled }, assumptions: latest && latest.assumptions ? latest.assumptions.rows.length : 0 },
    mismatches: model.mismatches, warnings: model.warnings, errors: model.errors,
  });
  return { payload, html, model, feature, dir };
}

function base(extra) {
  return { tool: TOOL, schemaVersion: SCHEMA_VERSION, readOnly: true, generatedOn: new Date().toISOString(), gate: 'NOT_RUN', gateReason: '', input: {}, hashes: {}, document: null, counts: {}, mismatches: [], warnings: [], errors: [], writes: [], ...extra, limits: LIMITS };
}

/* ============================================================================================
 * CLI
 * ========================================================================================== */
export function main(argv) {
  const args = parseArgs(argv);
  const root = process.cwd();
  const reportPath = typeof args.report === 'string' ? path.resolve(root, args.report) : null;
  const r = render({ reportPath, bugsPath: typeof args.bugs === 'string' ? path.resolve(root, args.bugs) : null, runsDir: typeof args.runs === 'string' ? path.resolve(root, args.runs) : null, commentsPath: typeof args.comments === 'string' ? path.resolve(root, args.comments) : null, root });
  const p = r.payload;
  p.writes = [];
  if (args.write && r.html && p.gate !== 'BLOCKED') {
    const out = typeof args.out === 'string' ? path.resolve(root, args.out) : path.join(r.dir, 'TEST-RUN-REPORT-' + r.feature + '.html');
    if (out === reportPath || /\.(md|json)$/i.test(out)) { p.gate = 'BLOCKED'; p.gateReason = '--out must be an .html path, never a source file'; p.errors.push({ kind: 'output-path', detail: out }); }
    else if (isFile(out)) {
      const st = pageState(readText(out));
      if (st.provenance && st.handEdited && !args.force) { p.gate = 'BLOCKED'; p.gateReason = 'existing page ' + path.relative(root, out) + ' was edited by hand after it was rendered (self-hash mismatch) — re-run with --force to overwrite it'; p.refused = { file: path.relative(root, out), reason: 'hand-edited' }; }
      else if (!st.provenance) p.warnings.push({ kind: 'legacy-page-replaced', detail: path.relative(root, out) + ' had no provenance comment (hand-written by an older skill run) — replaced' });
    }
    if (p.gate !== 'BLOCKED') { fs.writeFileSync(out, r.html, 'utf8'); p.readOnly = false; p.writes.push({ file: path.relative(root, out), kind: 'html', bytes: Buffer.byteLength(r.html, 'utf8') }); }
  } else if (args.write && p.gate === 'BLOCKED') p.writes.push({ file: null, kind: 'html', skipped: 'gate BLOCKED — nothing written' });
  print(p, args);
  return exitFor(p.gate, args);
}
function exitFor(gate, args) { if (!args.strict) return 0; return { PASS: 0, MISMATCH: 1, BLOCKED: 2, NOT_RUN: 3 }[gate] ?? 3; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
