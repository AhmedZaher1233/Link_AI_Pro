#!/usr/bin/env node
// selftest-run-report.mjs — regression harness for render-run-report.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a test harness, not one of the
// read-only reporting scripts, so the "always exit 0" convention does not apply here. A failing
// self-test means the renderer's pages cannot be trusted: do not deliver a page rendered by it
// until the harness passes again (the markdown reports are still delivered — they are the source).
//
// Every case works on a temporary copy of scripts/fixtures/run-report/automation/ so the fixture
// and the relative screenshot links stay untouched. Run: node selftest-run-report.mjs [--pretty]
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { render, renderHtml, parseReport, parseBugReport, buildModel, pageState, selfHash, escapeHtml, TEMPLATE_PATH, SHELL_PATH } from './render-run-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (...p) => path.join(here, 'fixtures', 'run-report', ...p);
const norm = (s) => s.replace(/\r\n?/g, '\n');
const read = (p) => norm(fs.readFileSync(p, 'utf8'));
const SCRIPT = path.join(here, 'render-run-report.mjs');
const STORY = path.join('reports', 'US-1234-create-order');
const REPORT = fx('automation', STORY, 'TEST-RUN-REPORT-create-order.md');
const BUGS = fx('automation', STORY, 'BUG-REPORT-create-order.md');
const GOLDEN = fx('golden', 'TEST-RUN-REPORT-create-order.html');
const TRACKER = fx('tracker', 'TC-STATUS-TRACKER-create-order.md');
const TRACKER_MISMATCH = fx('tracker', 'TC-STATUS-TRACKER-create-order.mismatch.md');
const GOLDEN_TRACKER = fx('golden', 'TEST-RUN-REPORT-create-order.tracker.html');

/** The two skill folders that own a byte-identical copy of the run-report renderer, this harness, scan-lib, both templates and fixtures/run-report/. */
const RUN_REPORT_SKILLS = ['link-qc-5-test-run-automation', 'link-qc-5b-test-run-manual-cli'];
const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
/** A temporary copy of the whole automation tree, so `../../screenshots/…` links resolve exactly as in a project. */
function tmpCopy(mutate = (s) => s, mutateBugs = (s) => s) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-report-'));
  fs.cpSync(fx('automation'), dir, { recursive: true });
  const report = path.join(dir, STORY, 'TEST-RUN-REPORT-create-order.md');
  const bugs = path.join(dir, STORY, 'BUG-REPORT-create-order.md');
  fs.writeFileSync(report, mutate(read(REPORT)));
  fs.writeFileSync(bugs, mutateBugs(read(BUGS)));
  const story = path.join(dir, STORY);
  return { dir, story, report, bugs, runs: path.join(story, '.runs'), out: path.join(story, 'TEST-RUN-REPORT-create-order.html'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const kinds = (r) => r.payload.errors.map((e) => e.kind).sort();
const wkinds = (r) => r.payload.warnings.map((w) => w.kind);
const mm = (r, source) => r.payload.mismatches.filter((m) => m.source === source);
function listFiles(dir) { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } }; if (fs.existsSync(dir)) walk(dir); return out.sort(); }

/* 1 — golden: byte-for-byte, PASS, no warning but tracker-missing (this fixture has no tracker; case 30 renders one). */
{
  const r = render({ reportPath: REPORT, root: here });
  const p = [];
  if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' != PASS: ' + r.payload.gateReason);
  if (wkinds(r).join(',') !== 'tracker-missing') p.push('warnings on the fixture: ' + wkinds(r).join(','));
  if (!fs.existsSync(GOLDEN)) p.push('golden page missing — render it with the command in fixtures/run-report/README.md');
  else if (norm(r.html || '') !== read(GOLDEN)) p.push('page differs from golden');
  check('1 golden page', p, { bytes: (r.html || '').length });
}

/* 2 — derived numbers come from the tables, per phase. */
{
  const r = render({ reportPath: REPORT, root: here });
  const d = r.payload.document; const p = [];
  const c1 = JSON.stringify(d.phases[0].counts); const c2 = JSON.stringify(d.phases[1].counts);
  if (c1 !== JSON.stringify({ passed: 2, failed: 1, incomplete: 0, skipped: 1, notrun: 0, partial: 0, total: 4 })) p.push('phase 1 counts ' + c1);
  if (c2 !== JSON.stringify({ passed: 2, failed: 0, incomplete: 1, skipped: 1, notrun: 0, partial: 1, total: 5 })) p.push('phase 2 counts ' + c2);
  if (d.phases[0].outcome !== 'FAILURES' || d.phases[1].outcome !== 'INCOMPLETE' || d.status !== 'INCOMPLETE') p.push('outcomes ' + d.phases.map((x) => x.outcome).join('/') + ' status ' + d.status);
  if (d.phases[1].coverage.total.join('|') !== 'Total|5|3|2|0|80') p.push('phase 2 coverage total row ' + d.phases[1].coverage.total.join('|'));
  if (d.bugs.total !== 2 || d.bugs.open !== 1 || d.bugs.resolved !== 1) p.push('bug counts ' + JSON.stringify(d.bugs));
  if (d.phases[0].assumptions !== 1 || d.phases[0].heals !== 1 || d.phases[1].heals !== 0) p.push('assumptions/heals ' + d.phases.map((x) => x.assumptions + '/' + x.heals).join(' '));
  if (!/<b>80%<\/b><span>Static coverage · PASS<\/span>/.test(r.html || '')) p.push('coverage tile or verdict wrong');
  if (!/<b>2<\/b><span>Passed<\/span>/.test(r.html || '') || !/<b>1<\/b><span>Incomplete<\/span>/.test(r.html || '')) p.push('tiles do not show the latest counts');
  check('2 derived numbers', p, { latest: d.phases[1].counts, bugs: d.bugs.total });
}

/* 3 — header mismatch: computed values rendered, warning strip, gate MISMATCH. */
{
  const t = tmpCopy((s) => s.replace('**Latest phase:** 2', '**Latest phase:** 3').replace('**Latest results:** 2 passed · 0 failed · 1 incomplete', '**Latest results:** 3 passed · 0 failed · 0 incomplete').replace('**Status:** INCOMPLETE', '**Status:** GREEN'));
  try {
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'MISMATCH') p.push('gate ' + r.payload.gate + ' != MISMATCH');
    const fields = mm(r, 'header').map((m) => m.field).sort().join(',');
    if (fields !== 'Latest phase,Latest results,Status') p.push('header mismatch fields: ' + fields);
    if (!/class="warn-strip"/.test(r.html || '')) p.push('warn strip missing');
    if (!/<b>1<\/b><span>Incomplete<\/span>/.test(r.html || '') || !/badge s-incomplete">INCOMPLETE<\/span><\/span>/.test(r.html || '')) p.push('computed values not rendered');
    if (r.html === null) p.push('MISMATCH must still render the page');
    check('3 header mismatch is reported and the computed value wins', p, { fields });
  } finally { t.cleanup(); }
}

/* 4 — run-history row mismatch (counts and outcome) and a declared Outcome that disagrees with the Results table. */
{
  const t = tmpCopy((s) => s.replace('| 1 | 2026-09-20 | FAILURES | 2 | 1 | 0 | 1 | 0 | 0 | 4 |', '| 1 | 2026-09-20 | GREEN | 3 | 0 | 0 | 1 | 0 | 0 | 4 |').replace('- **Outcome:** INCOMPLETE', '- **Outcome:** GREEN'));
  try {
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'MISMATCH') p.push('gate ' + r.payload.gate);
    const h = mm(r, 'run-history'); if (!h.some((m) => m.phase === 1 && m.field === 'Outcome') || !h.some((m) => m.phase === 1 && m.field === 'Passed')) p.push('run-history mismatches: ' + JSON.stringify(h));
    const ph = mm(r, 'phase'); if (!ph.some((m) => m.phase === 2 && m.field === 'Outcome' && m.computed === 'INCOMPLETE')) p.push('phase Outcome mismatch not reported: ' + JSON.stringify(ph));
    check('4 run-history and declared-outcome mismatches', p, { count: r.payload.mismatches.length });
  } finally { t.cleanup(); }
}

/* 5 — missing screenshot file: PASS, warning, badge instead of the thumbnail, no viewer link for it. */
{
  const t = tmpCopy();
  try {
    fs.rmSync(path.join(t.dir, 'screenshots', 'US-1234-create-order', 'phase-2', 'TC-001', 'chromium--none--r0', 'attempt-1.png'));
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' — a missing file must not block');
    const w = r.payload.warnings.filter((x) => x.kind === 'evidence-file-missing');
    if (w.length !== 2) p.push('expected 2 evidence-file-missing warnings (results row + run-file attempt), got ' + w.length);
    if (!/badge missing">file not found · attempt-1\.png/.test(r.html || '')) p.push('missing badge not rendered');
    if (/<img src="\.\.\/\.\.\/screenshots\/US-1234-create-order\/phase-2\/TC-001\//.test(r.html || '')) p.push('an <img> was rendered for the missing file');
    if (r.payload.counts.evidenceMissing !== 2) p.push('counts.evidenceMissing ' + r.payload.counts.evidenceMissing);
    check('5 missing screenshot warns and badges, never blocks', p, {});
  } finally { t.cleanup(); }
}

/* 6 — absolute path → warning + plain link; data: URI → BLOCKED. */
{
  const a = tmpCopy((s) => s.replace('[attempt-1.png](../../screenshots/US-1234-create-order/phase-2/TC-001/chromium--none--r0/attempt-1.png)', '[attempt-1.png](C:/evidence/attempt-1.png)'));
  const b = tmpCopy((s) => s.replace('[attempt-1.png](../../screenshots/US-1234-create-order/phase-2/TC-001/chromium--none--r0/attempt-1.png)', '[attempt-1.png](data:image/png;base64,iVBORw0KGgo=)'));
  try {
    const p = [];
    const ra = render({ reportPath: a.report, root: a.dir });
    if (ra.payload.gate !== 'PASS' || !wkinds(ra).includes('evidence-path-not-relative')) p.push('absolute path: ' + ra.payload.gate + ' ' + wkinds(ra).join(','));
    if (!/<a href="C:\/evidence\/attempt-1\.png">attempt-1\.png<\/a><span class="lbl">not a relative path/.test(ra.html || '')) p.push('absolute path not rendered as a plain link');
    const rb = render({ reportPath: b.report, root: b.dir });
    if (rb.payload.gate !== 'BLOCKED' || !kinds(rb).includes('evidence-inline-data')) p.push('data: URI not BLOCKED: ' + rb.payload.gate + ' ' + kinds(rb));
    if (rb.html !== null) p.push('BLOCKED run still produced HTML');
    check('6 absolute path warns, data URI blocks', p, {});
  } finally { a.cleanup(); b.cleanup(); }
}

/* 7 — unknown enum / broken row / duplicate phase / missing Run → BLOCKED with the right error ids. */
{
  const mk = [
    ['unknown-enum', (s) => s.replace('| PASS | parallel | 00:00:39 |', '| PASSED | parallel | 00:00:39 |')],
    ['unknown-enum', (s) => s.replace('**Status:** INCOMPLETE', '**Status:** DONE')],
    ['unknown-enum', (s) => s.replace('**Smoke gate:** passed — fail% 0% — no action needed\n\n### Run plan\n| Group | Mode | Workers | TCs | Reason |\n|---|---|---|---|---|\n| parallel | parallel | 4 |', '**Smoke gate:** maybe\n\n### Run plan\n| Group | Mode | Workers | TCs | Reason |\n|---|---|---|---|---|\n| parallel | parallel | 4 |')],
    ['broken-row', (s) => s.replace('| TC-001 | REQ-01 | Create an order with valid data | PASS | parallel | 00:00:39 |', '| TC-001 | REQ-01 | Create an order with valid data | PASS | parallel |')],
    ['phase-duplicate', (s) => s.replace('## Phase 2 — 2026-09-21', '## Phase 1 — 2026-09-21')],
    ['section-missing', (s) => s.replace('## Phase 2 — 2026-09-21\n\n### Run\n', '## Phase 2 — 2026-09-21\n\n### Facts\n')],
    ['section-missing', (s) => s.replace(/### Results\n\| TC-ID \| REQ \| Name \| Status \| Group \| Duration \| Classification \| Evidence \|\n\|---\|---\|---\|---\|---\|---\|---\|---\|\n\| TC-001 \| REQ-01 \| Create an order with valid data \| PASS \| parallel \| 00:00:39 \|[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n/, '')],
    ['header-missing', (s) => s.replace('**Latest results:** 2 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run · 1 partial of 5 TCs\n', '')],
    ['title-missing', (s) => s.replace('# Test Run Report — create-order', '# Run report')],
  ];
  const p = [];
  for (const [kind, mut] of mk) {
    const t = tmpCopy(mut);
    try { const r = render({ reportPath: t.report, root: t.dir }); if (r.payload.gate !== 'BLOCKED' || !kinds(r).includes(kind)) p.push(kind + ' not BLOCKED: ' + r.payload.gate + ' [' + kinds(r).join(',') + ']'); if (r.html !== null) p.push(kind + ': BLOCKED run produced HTML'); } finally { t.cleanup(); }
  }
  check('7 shape and vocabulary errors BLOCK', p, { cases: mk.length });
}

/* 8 — phase order: descending sections, or run history after a phase → BLOCKED phase-order. */
{
  const a = tmpCopy((s) => s.replace('## Phase 1 — 2026-09-20', '## Phase 5 — 2026-09-20'));
  const b = tmpCopy((s) => { const i = s.indexOf('## Run history'); const j = s.indexOf('## Phase 1'); return s.slice(0, i) + s.slice(j) + '\n' + s.slice(i, j); });
  try {
    const p = [];
    const ra = render({ reportPath: a.report, root: a.dir }); if (ra.payload.gate !== 'BLOCKED' || !kinds(ra).includes('phase-order')) p.push('descending phases not BLOCKED: ' + kinds(ra));
    const rb = render({ reportPath: b.report, root: b.dir }); if (!kinds(rb).includes('phase-order')) p.push('run history after a phase not flagged: ' + kinds(rb));
    check('8 phase order is enforced', p, {});
  } finally { a.cleanup(); b.cleanup(); }
}

/* 9 — run-file enrichment: attempt sub-rows; mutated totals → MISMATCH run-file; deleted → warning; truncated → BLOCKED; wrong schema → warning, no sub-rows. */
{
  const t = tmpCopy();
  try {
    const p = [];
    const r0 = render({ reportPath: t.report, root: t.dir });
    if (!/Variants and attempts of TC-007 \(from the run file\)<\/span>/.test(r0.html || '')) p.push('attempt sub-rows for TC-007 missing');
    if ((r0.html || '').match(/<td>chromium--variation-a--r0<\/td><td>[12]<\/td><td>positive<\/td>/g)?.length !== 3) p.push('expected 3 attempt rows for TC-007 across both phases');
    if (!/missing required variants: chromium--variation-b--r0/.test(r0.html || '')) p.push('missing variants note not rendered');
    if (!/Variants and attempts of TC-001/.test(r0.html || '') === false) p.push('single-attempt TC rendered an attempts row');
    const f1 = path.join(t.runs, 'phase-1.json'); const raw = read(f1); const data = JSON.parse(raw);
    data.totals.passed = 3; fs.writeFileSync(f1, JSON.stringify(data));
    const r1 = render({ reportPath: t.report, root: t.dir });
    if (r1.payload.gate !== 'MISMATCH' || !mm(r1, 'run-file').some((m) => m.phase === 1 && m.field === 'Passed')) p.push('run-file total mismatch not reported: ' + r1.payload.gate);
    fs.rmSync(f1);
    const r2 = render({ reportPath: t.report, root: t.dir });
    if (r2.payload.gate !== 'PASS' || !r2.payload.warnings.some((w) => w.kind === 'run-file-missing' && w.phase === 1)) p.push('missing run file must warn, not block: ' + r2.payload.gate + ' ' + wkinds(r2));
    if (r2.payload.hashes.runs === r0.payload.hashes.runs) p.push('runs hash did not change when a run file disappeared');
    fs.writeFileSync(f1, raw.slice(0, 200));
    const r3 = render({ reportPath: t.report, root: t.dir });
    if (r3.payload.gate !== 'BLOCKED' || !kinds(r3).includes('run-file-unreadable')) p.push('truncated run file not BLOCKED: ' + r3.payload.gate);
    data.totals.passed = 2; data.schema = 'skill6-merged/1'; fs.writeFileSync(f1, JSON.stringify(data));
    const r4 = render({ reportPath: t.report, root: t.dir });
    if (r4.payload.gate !== 'PASS' || !r4.payload.warnings.some((w) => w.kind === 'run-file-schema')) p.push('wrong schema must warn: ' + r4.payload.gate + ' ' + wkinds(r4));
    if (/Variants and attempts of TC-007 \(from the run file\)<\/span>\s*<table>\s*<thead>[\s\S]*?<td>1<\/td><td>positive<\/td><td><span class="badge s-fail">FAIL/.test(r4.html || '')) p.push('sub-rows rendered from a run file with the wrong schema');
    check('9 run-file enrichment and cross-checks', p, {});
  } finally { t.cleanup(); }
}

/* 10 — legacy files are listed, never rendered; the warning appears only when the header does not name them. */
{
  const t = tmpCopy();
  try {
    fs.writeFileSync(path.join(t.story, 'phase-3.json'), '{"phase":3,"passed":99}');
    fs.writeFileSync(path.join(t.story, 'phase-3.html'), '<html>old</html>');
    fs.writeFileSync(path.join(t.story, 'merged-results.json'), '{}');
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate);
    if (r.payload.document.legacyFiles.join(',') !== 'merged-results.json,phase-3.html,phase-3.json') p.push('legacyFiles ' + r.payload.document.legacyFiles.join(','));
    if (!wkinds(r).includes('legacy-phase-files-unlisted')) p.push('legacy-phase-files-unlisted warning missing');
    if (r.payload.document.phases.length !== 2 || /passed":99|>99<|phase-3">Phase 3/.test(r.html || '')) p.push('legacy data leaked into the page');
    if (!/Legacy files in this folder \(read-only history, not rendered\): merged-results\.json, phase-3\.html, phase-3\.json/.test(r.html || '')) p.push('legacy list not rendered');
    fs.writeFileSync(t.report, read(t.report).replace('**Earlier phases:** —', '**Earlier phases:** phase-3 in this folder (legacy, read-only)'));
    const r2 = render({ reportPath: t.report, root: t.dir });
    if (wkinds(r2).includes('legacy-phase-files-unlisted')) p.push('warning raised although the header names the legacy phases');
    if (!/phase-3 in this folder \(legacy, read-only\)/.test(r2.html || '')) p.push('Earlier phases line not rendered');
    check('10 legacy files listed, never rendered', p, { legacy: r.payload.document.legacyFiles });
  } finally { t.cleanup(); }
}

/* 11 — dry run writes nothing; --write writes exactly the page; provenance verifies; hand-edited page refused without --force; no-provenance page replaced. */
{
  const t = tmpCopy();
  try {
    const call = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: t.dir });
    const p = [];
    const before = listFiles(t.dir);
    const dry = call(['--report', t.report]);
    if (dry.status !== 0) p.push('dry run exit ' + dry.status + ' ' + dry.stderr);
    let payload; try { payload = JSON.parse(dry.stdout); } catch { p.push('stdout is not a single JSON object'); }
    if (payload && payload.readOnly !== true) p.push('dry run not marked readOnly');
    if (listFiles(t.dir).join('|') !== before.join('|')) p.push('dry run wrote a file');
    if (/<!DOCTYPE html>/.test(dry.stdout)) p.push('dry run printed the HTML');
    const w = JSON.parse(call(['--report', t.report, '--write']).stdout);
    if (!fs.existsSync(t.out)) p.push('--write did not create the page');
    if (w.readOnly !== false || !w.writes.some((x) => x.kind === 'html')) p.push('--write payload does not record the write');
    const html = read(t.out); const st = pageState(html);
    if (!st.provenance || st.handEdited) p.push('freshly written page fails its own provenance check');
    if (st.recorded.bugs === 'none' || st.recorded.runs === 'none') p.push('provenance does not record the bug file / run files');
    const w2 = JSON.parse(call(['--report', t.report, '--write']).stdout);
    if (w2.gate !== 'PASS' || w2.writes.length !== 1) p.push('re-render of an untouched page was refused');
    fs.writeFileSync(t.out, html.replace('Sources of truth:', 'Sources of truth (reviewed):'));
    const w3 = JSON.parse(call(['--report', t.report, '--write']).stdout);
    if (w3.gate !== 'BLOCKED' || !w3.refused || w3.refused.reason !== 'hand-edited') p.push('hand-edited page was not refused: ' + w3.gate);
    if (!read(t.out).includes('(reviewed)')) p.push('refused write still overwrote the page');
    const w4 = JSON.parse(call(['--report', t.report, '--write', '--force']).stdout);
    if (w4.gate !== 'PASS' || read(t.out).includes('(reviewed)')) p.push('--force did not overwrite the hand-edited page');
    fs.writeFileSync(t.out, '<!DOCTYPE html>\n<html><body>old hand-written phase report</body></html>\n');
    const w5 = JSON.parse(call(['--report', t.report, '--write']).stdout);
    if (w5.gate !== 'PASS' || !w5.warnings.some((x) => x.kind === 'legacy-page-replaced')) p.push('legacy page without provenance was not replaced with a warning');
    const w6 = JSON.parse(call(['--report', t.report, '--write', '--out', t.report]).stdout);
    if (w6.gate !== 'BLOCKED' || !w6.errors.some((e) => e.kind === 'output-path')) p.push('--out pointing at the markdown was not refused');
    check('11 dry-run writes nothing; hand-edited page refused without --force', p, {});
  } finally { t.cleanup(); }
}

/* 12 — --strict exit codes: PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3; default always 0. */
{
  const a = tmpCopy((s) => s.replace('**Latest phase:** 2', '**Latest phase:** 7'));
  const b = tmpCopy((s) => s.replace('| PASS | parallel | 00:00:39 |', '| PASSED | parallel | 00:00:39 |'));
  try {
    const call = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd });
    const p = [];
    const pass = call(['--report', REPORT, '--strict'], here); if (pass.status !== 0) p.push('PASS exit ' + pass.status);
    const mis = call(['--report', a.report, '--strict'], a.dir); if (mis.status !== 1) p.push('MISMATCH exit ' + mis.status);
    const bl = call(['--report', b.report, '--strict'], b.dir); if (bl.status !== 2) p.push('BLOCKED exit ' + bl.status);
    const nr = call(['--strict'], here); if (nr.status !== 3) p.push('NOT_RUN exit ' + nr.status);
    const nrPlain = call(['--report', 'does-not-exist.md'], here); if (nrPlain.status !== 0) p.push('default exit for a missing file ' + nrPlain.status + ' != 0');
    const blPlain = call(['--report', b.report], b.dir); if (blPlain.status !== 0) p.push('default exit for BLOCKED ' + blPlain.status + ' != 0');
    check('12 strict exit codes', p, {});
  } finally { a.cleanup(); b.cleanup(); }
}

/* 13 — determinism + self-hash: same inputs → same bytes; provenance on line 2; no timestamp leaks. */
{
  const a = render({ reportPath: REPORT, root: here }).html; const b = render({ reportPath: REPORT, root: here }).html;
  const p = [];
  if (a !== b) p.push('two renders of the same inputs differ');
  if (!/^<!DOCTYPE html>\n<!-- render-run-report v/.test(a)) p.push('provenance comment is not line 2');
  const m = a.match(/page=([0-9a-f]{64})/); if (!m || selfHash(a) !== m[1]) p.push('self-hash does not verify');
  if (/generatedOn|\d{4}-\d{2}-\d{2}T\d{2}:/.test(a)) p.push('a timestamp leaked into the page');
  check('13 deterministic output with a verifiable self-hash', p, {});
}

/* 14 — template round trip: a leftover placeholder BLOCKs; an unclosed block throws. */
{
  const model = buildModel(parseReport(read(REPORT)), parseBugReport(read(BUGS)), { mdDir: path.dirname(REPORT), runsDir: path.join(path.dirname(REPORT), '.runs') });
  const p = [];
  const r1 = renderHtml(model, { template: '<p>{{feature}} {{no_such_key}}</p>' });
  if (r1.leftovers.join() !== '{{no_such_key}}') p.push('unknown placeholder not reported as leftover: ' + r1.leftovers.join());
  if (!/create-order/.test(r1.html)) p.push('known placeholder not filled');
  let threw = false; try { renderHtml(model, { template: '<!-- {{#each phases}} -->x' }); } catch { threw = true; }
  if (!threw) p.push('unclosed block did not throw');
  const r2 = render({ reportPath: REPORT, root: here, template: '<!DOCTYPE html>\n<p>{{feature}} {{no_such_key}}</p>' });
  if (r2.payload.gate !== 'BLOCKED' || !kinds(r2).includes('placeholder-left')) p.push('leftover placeholder did not BLOCK the pipeline: ' + r2.payload.gate);
  const r3 = render({ reportPath: REPORT, root: here, template: '<!DOCTYPE html>\n<!-- {{#if phases}} -->x' });
  if (r3.payload.gate !== 'BLOCKED' || !kinds(r3).includes('template-error')) p.push('unclosed block did not BLOCK the pipeline: ' + r3.payload.gate);
  const tpl = read(SHELL_PATH); if (!/<dialog class="viewer"/.test(tpl) || !/data-act="fit"/.test(tpl)) p.push("report shell lost the viewer dialog");
  check('14 template placeholders round-trip; leftovers BLOCK', p, {});
}

/* 15 — escaping: markup in a TC name, a run-file error and a bug title is rendered inert. */
{
  const t = tmpCopy((s) => s.replace('Create an order with valid data | PASS | parallel | 00:00:39', 'Create <b>an</b> order & <script>alert(1)</script> | PASS | parallel | 00:00:39'), (s) => s.replace('### BUG-2 — The system', '### BUG-2 — <img src=x onerror=alert(2)> The system'));
  try {
    const f = path.join(t.runs, 'phase-2.json'); const d = JSON.parse(read(f)); d.results[0].error_message = '<script>alert(3)</script>'; d.results[0].variants[0].attempts.push({ attempt: 2, stage: 'smoke', status: 'PASS', evidence_screenshot: null, failure_screenshot: null, error_message: '<script>alert(3)</script>' }); fs.writeFileSync(f, JSON.stringify(d));
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (/<script>alert/.test(r.html || '') || /<img src=x/.test(r.html || '')) p.push('markup survived unescaped');
    if (!/&lt;b&gt;an&lt;\/b&gt; order &amp; &lt;script&gt;/.test(r.html || '')) p.push('TC name was not escaped as expected');
    if (!/&lt;script&gt;alert\(3\)&lt;\/script&gt;/.test(r.html || '')) p.push('run-file error was not escaped');
    if (escapeHtml('<"\'&>') !== '&lt;&quot;&#39;&amp;&gt;') p.push('escapeHtml wrong');
    check('15 content is HTML-escaped', p, {});
  } finally { t.cleanup(); }
}

/* 16 — secret screen: a password-shaped literal in the bug file, in the run report or in a run file BLOCKs. */
{
  const a = tmpCopy((s) => s, (s) => s.replace('1. Log in as the sales user.\n  2. Open an order that has two lines.', '1. Log in with password: Sup3rSecret! as the sales user.\n  2. Open an order that has two lines.'));
  const b = tmpCopy((s) => s.replace('- **Run command:** cd Testing/Automation', '- **Run command:** TOKEN=abcdef123 cd Testing/Automation'));
  const c = tmpCopy();
  try {
    const p = [];
    const ra = render({ reportPath: a.report, root: a.dir }); if (ra.payload.gate !== 'BLOCKED' || !kinds(ra).includes('secret-literal')) p.push('secret in the bug file not BLOCKED: ' + ra.payload.gate + ' ' + kinds(ra));
    if (ra.html !== null) p.push('HTML produced despite a secret');
    const rb = render({ reportPath: b.report, root: b.dir }); if (rb.payload.gate !== 'BLOCKED' || !kinds(rb).includes('secret-literal')) p.push('secret in the run report not BLOCKED: ' + rb.payload.gate);
    const f = path.join(c.runs, 'phase-2.json'); fs.writeFileSync(f, read(f).replace('"deviations": [', '"deviations": ["api key = 0123456789abcdef",'));
    const rc = render({ reportPath: c.report, root: c.dir }); if (rc.payload.gate !== 'BLOCKED' || !kinds(rc).includes('secret-literal')) p.push('secret in a run file not BLOCKED: ' + rc.payload.gate);
    check('16 password-shaped literal BLOCKs', p, {});
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); }
}

/* 17 — a BLOCKED-outcome phase with no Results table: PASS, tiles fall back to the last phase with results, no `0` invented for the blocked phase. */
{
  const t = tmpCopy((s) => s
    .replace('**Latest phase:** 2', '**Latest phase:** 3').replace('**Status:** INCOMPLETE', '**Status:** BLOCKED').replace('**Latest results:** 2 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run · 1 partial of 5 TCs', '**Latest results:** —')
    .replace('| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 1 | 5 | 00:05:12 | BUG-1, BUG-2 |', '| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 1 | 5 | 00:05:12 | BUG-1, BUG-2 |\n| 3 | 2026-09-22 | BLOCKED | — | — | — | — | — | — | — | — | — |')
    + '\n## Phase 3 — 2026-09-22\n\n### Run\n- **Outcome:** BLOCKED — test-data readiness: the QC chose to stop until the customer fixture exists\n- **Environment:** UAT\n- **Run file:** .runs/phase-3.json\n', (s) => s.replace('**Latest phase:** 2', '**Latest phase:** 3'));
  try {
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ': ' + r.payload.gateReason + ' ' + JSON.stringify(r.payload.mismatches));
    const ph3 = r.payload.document.phases[2];
    if (!ph3 || ph3.outcome !== 'BLOCKED' || ph3.counts !== null) p.push('phase 3 not accepted as declared BLOCKED with null counts: ' + JSON.stringify(ph3));
    if (!wkinds(r).includes('run-file-missing')) p.push('missing .runs/phase-3.json should warn');
    if (!/<a href="#phase-3">Phase 3<\/a><\/td><td>2026-09-22<\/td><td><span class="badge s-blocked">BLOCKED<\/span><\/td><td>—<\/td><td>—<\/td>/.test(r.html || '')) p.push('run-history row for the blocked phase does not show —');
    if (!/class="banner env-blocked"><b>BLOCKED<\/b>/.test(r.html || '') || !/the QC chose to stop/.test(r.html || '')) p.push('blocked banner with the reason not rendered');
    if (!/<b>2<\/b><span>Passed<\/span>/.test(r.html || '')) p.push('tiles did not fall back to the last phase with results');
    if (!/<details class="card phase" id="phase-3" data-toc-label="[^"]*" open>/.test(r.html || '') || /<details class="card phase" id="phase-2"[^>]* open>/.test(r.html || '')) p.push('only the latest phase should be open');
    check('17 blocked outcome renders — for its counts, never 0', p, {});
  } finally { t.cleanup(); }
}

/* 18 — viewer markup: every rendered evidence image has a thumbnail + "View screenshot" with the same relative href, one dialog, an "open original" anchor, no data: / drive-letter hrefs, no viewer link for a missing file. */
{
  const r = render({ reportPath: REPORT, root: here }); const html = r.html || ''; const p = [];
  const thumbs = [...html.matchAll(/<a class="view" href="([^"]+)" data-viewer data-group="([^"]+)" data-title="[^"]*"><img src="([^"]+)" loading="lazy"/g)];
  const links = [...html.matchAll(/<a class="view-link" href="([^"]+)" data-viewer data-group="([^"]+)"[^>]*>View screenshot<\/a>/g)];
  if (!thumbs.length || thumbs.length !== links.length) p.push('thumbnails ' + thumbs.length + ' != view links ' + links.length);
  thumbs.forEach((m, i) => { if (m[1] !== m[3] || !links[i] || links[i][1] !== m[1]) p.push('href mismatch at evidence ' + i); if (!/^\.\.\//.test(m[1]) || /^data:|^[a-zA-Z]:/.test(m[1])) p.push('non-relative href ' + m[1]); });
  if (thumbs.length !== r.payload.counts.evidenceLinks - 6) p.push('rendered thumbnails ' + thumbs.length + ' vs evidence links ' + r.payload.counts.evidenceLinks + ' (single-attempt attempts are not rendered twice)');
  if ((html.match(/<dialog class="viewer"/g) || []).length !== 1) p.push('exactly one viewer dialog expected');
  if (!/<a class="open-original" id="viewer-original" href="#" target="_blank" rel="noopener">Open original in new tab<\/a>/.test(html)) p.push('open-original anchor missing');
  if (!thumbs.some((m) => m[2] === 'bugs') || !thumbs.some((m) => m[2] === 'phase-1')) p.push('viewer groups for bugs / phases missing');
  if (/base64/.test(html)) p.push('base64 found in the page');
  const t = tmpCopy();
  try {
    fs.rmSync(path.join(t.dir, 'screenshots', 'US-1234-create-order', 'phase-1', 'TC-010', 'chromium--none--r0', 'attempt-1-failed.png'));
    const r2 = render({ reportPath: t.report, root: t.dir });
    if (/data-viewer[^>]*attempt-1-failed\.png[^>]*data-group="bugs"/.test(r2.html || '')) p.push('a viewer link was rendered for a missing bug screenshot');
    if (!/badge missing">file not found · attempt-1-failed\.png/.test(r2.html || '')) p.push('missing badge not rendered in the bug card');
  } finally { t.cleanup(); }
  check('18 viewer markup', p, { thumbnails: thumbs.length });
}

/* 19 — bug file parsed: cards in file order, counts, status badges, TC anchors, phase cross-references, two separate sections. */
{
  const r = render({ reportPath: REPORT, root: here }); const html = r.html || ''; const p = [];
  const ids = [...html.matchAll(/<article class="item-card bug ([a-z-]+)" id="(BUG-\d+)"/g)].map((m) => m[2] + ':' + m[1]);
  if (ids.join(',') !== 'BUG-1:resolved,BUG-2:open') p.push('bug cards ' + ids.join(','));
  if (!/<a href="#tc-1-TC-010">TC-010<\/a> · found in phase 1/.test(html)) p.push('BUG-1 does not link to TC-010 in phase 1');
  if (!/<a href="#BUG-1">BUG-1<\/a><\/td><td>TC-010<\/td><td>High<\/td><td><span class="badge b-resolved">resolved \(phase 2\)/.test(html)) p.push('phase-2 bug cross-reference row not linked to the card');
  if (!/<b>1 \/ 1 \/ 0<\/b><span>Bugs · open \/ resolved \/ not checked<\/span>/.test(html)) p.push('bugs tile != 1 / 1 / 0');
  const iRes = html.indexOf('<section class="part" id="results">'); const iBugs = html.indexOf('<section class="part" id="bugs">');
  if (iRes < 0 || iBugs < 0 || iBugs < iRes) p.push('results / bugs sections missing or in the wrong order');
  if (!/<span class="badge sev-high">High<\/span>/.test(html) || !/<span class="badge b-open">open<\/span>/.test(html)) p.push('severity / status badges missing');
  if (r.payload.document.bugs.entries[0].screenshot[0] !== '../../screenshots/US-1234-create-order/phase-1/TC-010/chromium--none--r0/attempt-1-failed.png') p.push('bug screenshot path not surfaced in the payload');
  check('19 bug file renders as cards with cross-references', p, { ids });
}

/* 20 — no bug file: PASS with a warning, Bugs section shows the note, page still written. */
{
  const t = tmpCopy();
  try {
    fs.rmSync(t.bugs);
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'PASS' || !wkinds(r).includes('bug-report-missing')) p.push('missing bug file: ' + r.payload.gate + ' ' + wkinds(r).join(','));
    if (!/No bug report file was found next to the run report/.test(r.html || '')) p.push('missing-bug-file note not rendered');
    if (r.payload.document.bugs.present !== false || !/<b>—<\/b><span>Bugs · open/.test(r.html || '')) p.push('bugs tile must render — without a bug file');
    if (r.payload.hashes.bugs !== 'none') p.push('bugs hash must be none');
    if (r.payload.mismatches.some((m) => m.kind === 'bug-ref-missing')) p.push('phase bug references must not mismatch when there is no bug file at all');
    check('20 missing bug file warns, never blocks', p, {});
  } finally { t.cleanup(); }
}

/* 21 — bug cross-checks: header counts, an unknown bug id in a phase table, an unknown phase in an entry → MISMATCH from source bug-report. */
{
  const t = tmpCopy((s) => s.replace('| BUG-2 | TC-007 | Medium | open |', '| BUG-2 | TC-007 | Medium | open |\n| BUG-9 | TC-001 | Low | open |'), (s) => s.replace('**Bugs:** 1 open · 1 resolved · 0 not checked this run of 2', '**Bugs:** 2 open · 0 resolved · 0 not checked this run of 2').replace('- **Found in phase:** 2', '- **Found in phase:** 7'));
  try {
    const r = render({ reportPath: t.report, root: t.dir }); const p = [];
    if (r.payload.gate !== 'MISMATCH') p.push('gate ' + r.payload.gate);
    const b = mm(r, 'bug-report');
    if (!b.some((m) => m.kind === 'bug-count' && m.field === 'Bugs')) p.push('bug count mismatch not reported');
    if (!b.some((m) => m.kind === 'bug-ref-missing' && m.written === 'BUG-9' && m.phase === 2)) p.push('bug-ref-missing not reported');
    if (!b.some((m) => m.kind === 'bug-phase-unknown' && m.written === 7)) p.push('bug-phase-unknown not reported');
    if (!/<b>1 \/ 1 \/ 0<\/b><span>Bugs/.test(r.html || '')) p.push('computed bug counts not rendered');
    check('21 bug cross-checks mismatch, never silently pass', p, { mismatches: b.map((m) => m.kind) });
  } finally { t.cleanup(); }
}

/* 22 — bug shape errors BLOCK; editing the bug file changes the provenance and a re-render is PASS. */
{
  const a = tmpCopy((s) => s, (s) => s.replace('- **Steps to reproduce:**\n  1. Log in as the sales user.\n  2. Open an order that has two lines.\n  3. Change the quantity of the second line and leave the field.\n', ''));
  const b = tmpCopy((s) => s, (s) => s.replace('- **Status:** open', '- **Status:** fixed'));
  const c = tmpCopy((s) => s, (s) => s.replace('- **Severity:** Medium', '- **Severity:** Blocker'));
  const d = tmpCopy((s) => s, (s) => s.replace('## Bugs', '## Defects'));
  const e = tmpCopy();
  try {
    const p = [];
    for (const [t, kind] of [[a, 'bug-field-missing'], [b, 'bug-unknown-enum'], [c, 'bug-unknown-enum'], [d, 'bug-section-missing']]) { const r = render({ reportPath: t.report, root: t.dir }); if (r.payload.gate !== 'BLOCKED' || !kinds(r).includes(kind)) p.push(kind + ': ' + r.payload.gate + ' [' + kinds(r).join(',') + ']'); }
    const call = (args) => JSON.parse(spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: e.dir }).stdout);
    const w1 = call(['--report', e.report, '--write']); const st1 = pageState(read(e.out));
    fs.writeFileSync(e.bugs, read(e.bugs).replace('- **Root cause:** not yet known', '- **Root cause:** the change event is not wired for the second line'));
    const w2 = call(['--report', e.report, '--write']); const st2 = pageState(read(e.out));
    if (w1.gate !== 'PASS' || w2.gate !== 'PASS') p.push('re-render after a bug-file edit not PASS: ' + w1.gate + '/' + w2.gate);
    if (st1.recorded.bugs === st2.recorded.bugs || st1.recorded.report !== st2.recorded.report) p.push('provenance bugs hash did not change (or report hash changed) after editing the bug file');
    if (!/the change event is not wired/.test(read(e.out))) p.push('re-rendered page does not carry the edited bug text');
    check('22 bug shape errors BLOCK; bug-file edits re-render cleanly', p, {});
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); d.cleanup(); e.cleanup(); }
}

/* 23 — PARTIAL (human step pending): its own bucket, never passed; distinct badge; the phase is never GREEN; a header that counts it as passed is a MISMATCH; a bare PARTIAL warns; an unknown reason BLOCKs. */
{
  const r = render({ reportPath: REPORT, root: here }); const html = r.html || ''; const p = [];
  const ph2 = r.payload.document.phases[1];
  if (!ph2 || ph2.counts.partial !== 1 || ph2.counts.passed !== 2 || ph2.counts.total !== 5) p.push('phase 2 counts must hold partial=1, passed=2, total=5: ' + JSON.stringify(ph2 && ph2.counts));
  if (r.payload.counts.latest.partial !== 1) p.push('counts.latest.partial != 1');
  if (!/<span class="badge s-partial">PARTIAL — human step pending<\/span>/.test(html)) p.push('PARTIAL badge with the frozen wording not rendered');
  if (!/<td class="nowrap">TC-030<\/td><td>REQ-05<\/td>[^\n]*human step: 4<\/td>/.test(html)) p.push('TC-030 row / classification not rendered');
  if (!/<div class="tile t-partial"><b>1<\/b><span>Partial · human step pending<\/span>/.test(html)) p.push('partial tile missing');
  if (!/<b>2<\/b><span>Passed<\/span>/.test(html)) p.push('the partial TC leaked into the Passed tile');
  if (!/<th data-sort="number">Not run<\/th><th data-sort="number">Partial<\/th><th data-sort="number">Total<\/th>/.test(html) || !/<td>0<\/td><td>1<\/td><td>5<\/td><td>00:05:12<\/td>/.test(html)) p.push('run-history Partial column not rendered');
  if (!/passed \/ failed \/ incomplete \/ skipped \/ not run \/ partial · 2 \/ 0 \/ 1 \/ 1 \/ 0 \/ 1 of 5/.test(html)) p.push('phase summary counts do not carry the partial bucket');
  // (a) a phase whose only non-PASS row is PARTIAL is INCOMPLETE, never GREEN
  const a = tmpCopy((s) => s.replace('| TC-007 | REQ-02 | Order total recalculates | INCOMPLETE | parallel | 00:00:58 | incomplete: chromium--variation-b--r0 |', '| TC-007 | REQ-02 | Order total recalculates | PASS | parallel | 00:00:58 | — |'));
  try {
    const ra = render({ reportPath: a.report, root: a.dir });
    if (ra.payload.document.phases[1].outcome !== 'INCOMPLETE') p.push('a phase holding a PARTIAL row derived ' + ra.payload.document.phases[1].outcome + ' instead of INCOMPLETE');
    if (ra.payload.document.status !== 'INCOMPLETE') p.push('header status with a PARTIAL row: ' + ra.payload.document.status);
  } finally { a.cleanup(); }
  // (b) the header counting the partial TC as passed → MISMATCH on Latest results; the stage Total row too
  const b = tmpCopy((s) => s.replace('**Latest results:** 2 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run · 1 partial of 5 TCs', '**Latest results:** 3 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run of 5 TCs').replace('| **Total** | 5 | 2 | 0 | 1 | 1 | 0 | 1 |', '| **Total** | 5 | 3 | 0 | 1 | 1 | 0 | 0 |'));
  try {
    const rb = render({ reportPath: b.report, root: b.dir });
    if (rb.payload.gate !== 'MISMATCH') p.push('counting a PARTIAL TC as passed was not a MISMATCH: ' + rb.payload.gate);
    if (!mm(rb, 'header').some((m) => m.field === 'Latest results' && /1 partial of 5/.test(m.computed))) p.push('Latest results mismatch must state the computed partial count: ' + JSON.stringify(mm(rb, 'header')));
    const st = mm(rb, 'stages').map((m) => m.field).sort().join(',');
    if (st !== 'Partial,Passed') p.push('stage Total mismatches ' + st + ' != Partial,Passed');
    if (!/<b>2<\/b><span>Passed<\/span>/.test(rb.html || '')) p.push('the computed passed count (2) must win over the written 3');
  } finally { b.cleanup(); }
  // (c) a Stages / Run history table WITHOUT a Partial column while a PARTIAL row exists → MISMATCH (written —)
  const c = tmpCopy((s) => s.replace('| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run | Partial | Total | Duration | Bugs |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-09-20 | FAILURES | 2 | 1 | 0 | 1 | 0 | 0 | 4 | 00:06:41 | BUG-1 |\n| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 1 | 5 | 00:05:12 | BUG-1, BUG-2 |', '| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run | Total | Duration | Bugs |\n|---|---|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-09-20 | FAILURES | 2 | 1 | 0 | 1 | 0 | 4 | 00:06:41 | BUG-1 |\n| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 5 | 00:05:12 | BUG-1, BUG-2 |'));
  try {
    const rc = render({ reportPath: c.report, root: c.dir });
    const h = mm(rc, 'run-history');
    if (rc.payload.gate !== 'MISMATCH' || !h.some((m) => m.phase === 2 && m.field === 'Partial' && m.written === '—' && m.computed === 1)) p.push('a run-history table without a Partial column must mismatch for the phase that holds one: ' + JSON.stringify(h));
    if (h.some((m) => m.phase === 1 && m.field === 'Partial')) p.push('phase 1 (no PARTIAL row) must not require the column');
  } finally { c.cleanup(); }
  // (d) a bare `PARTIAL` warns (partial-without-reason) and still renders the frozen wording; `PARTIAL — something else` warns too; `PASS — reason` BLOCKs
  const d = tmpCopy((s) => s.replace('| PARTIAL — human step pending |', '| PARTIAL |'));
  const e = tmpCopy((s) => s.replace('| PARTIAL — human step pending |', '| PARTIAL — waiting |').replace('| human step: 4 |', '| — |'));
  const f = tmpCopy((s) => s.replace('| TC-001 | REQ-01 | Create an order with valid data | PASS | parallel | 00:00:39 |', '| TC-001 | REQ-01 | Create an order with valid data | PASS — human step pending | parallel | 00:00:39 |'));
  try {
    const rd = render({ reportPath: d.report, root: d.dir });
    if (rd.payload.gate !== 'PASS' || !wkinds(rd).includes('partial-without-reason')) p.push('bare PARTIAL: ' + rd.payload.gate + ' ' + wkinds(rd).join(','));
    if (!/<span class="badge s-partial">PARTIAL — human step pending<\/span>/.test(rd.html || '')) p.push('bare PARTIAL must still render the frozen wording');
    if (rd.payload.document.phases[1].counts.partial !== 1) p.push('bare PARTIAL not counted as partial');
    const re = render({ reportPath: e.report, root: e.dir });
    if (!wkinds(re).includes('partial-without-reason') || !wkinds(re).includes('partial-without-step')) p.push('another reason / no step must warn: ' + wkinds(re).join(','));
    const rf = render({ reportPath: f.report, root: f.dir });
    if (rf.payload.gate !== 'BLOCKED' || !kinds(rf).includes('unknown-enum')) p.push('a reason on a non-PARTIAL status must BLOCK: ' + rf.payload.gate + ' ' + kinds(rf).join(','));
  } finally { d.cleanup(); e.cleanup(); f.cleanup(); }
  // (e) the run file's PARTIAL status and totals cross-check; a run file that calls it PASS mismatches
  const g = tmpCopy();
  try {
    const rfPath = path.join(g.runs, 'phase-2.json'); const data = JSON.parse(read(rfPath));
    const tc = data.results.find((x) => x.tc_id === 'TC-030'); tc.status = 'PASS'; data.totals.passed = 3; data.totals.partial = 0;
    fs.writeFileSync(rfPath, JSON.stringify(data));
    const rg = render({ reportPath: g.report, root: g.dir });
    const rfm = mm(rg, 'run-file').map((m) => m.field).sort().join(',');
    if (rg.payload.gate !== 'MISMATCH' || rfm !== 'Partial,Passed,TC-030 status') p.push('run-file PASS for a PARTIAL TC must mismatch on Passed, Partial and the TC status: ' + rfm);
  } finally { g.cleanup(); }
  check('23 PARTIAL — human step pending is its own bucket, never passed, never GREEN', p, { latest: r.payload.counts.latest });
}

/* 24 — reviewer comments: REVIEW-COMMENTS-{feature}.md beside the report pre-fills bug / phase / general boxes, shows handled ones as history,
      lists unknown ids, feeds provenance + payload; missing is silent; a comment from another page is ignored; the inline `Reviewer comment`
      field of a bug and of a phase `### Run` is shown in the box, never as a phase fact. */
{
  const p = [];
  const t = tmpCopy(
    (s) => s.replace(/(## Phase 2 — [^\n]*\n\n### Run\n)/, '$1- **Reviewer comment:** Re-run TC-007 after the data fix.\n'),
    (s) => s.replace('- **Severity:** High', '- **Severity:** High\n- **Reviewer comment:** Confirmed with the developer.'));
  try {
    const r0 = render({ reportPath: t.report, root: t.dir }); const h0 = r0.html || '';
    if (r0.payload.gate !== 'PASS') p.push('inline comments changed the gate: ' + r0.payload.gate + ' ' + r0.payload.gateReason);
    if (r0.payload.hashes.comments !== 'none' || r0.payload.comments.file !== null || wkinds(r0).some((k) => /^comment/.test(k))) p.push('absent comments file is not silent');
    if (!/ · comments=none · tracker=none · page=/.test(h0)) p.push('provenance lacks comments=none');
    if (!/<p class="comment-note"><b>Reviewer comment \(in the markdown\):<\/b> Confirmed with the developer\.<\/p>/.test(h0)) p.push('bug inline comment not shown');
    if (!/<p class="comment-note"><b>Reviewer comment \(in the markdown\):<\/b> Re-run TC-007 after the data fix\.<\/p>/.test(h0)) p.push('phase inline comment not shown');
    if (/<dt>Reviewer comment<\/dt>/.test(h0)) p.push('phase Reviewer comment rendered as a fact');
    const rev = crypto.createHash('sha256').update(read(t.report), 'utf8').digest('hex').slice(0, 12);
    const cf = path.join(t.story, 'REVIEW-COMMENTS-create-order.md');
    const C = ['# Review comments — create-order', '**Page:** TEST-RUN-REPORT-create-order.html', '**Source:** TEST-RUN-REPORT-create-order.md', '**Source revision:** ' + rev, '**Reviewer:** —', '**Saved:** 2026-09-27 12:46', '**Comments:** 3 open · 1 handled of 4', '',
      '## General', 'Please add the Arabic run next time.', '- **Status:** open', '', '## BUG-2', 'Not a bug — the spec allows it.', '- **Status:** declined 2026-09-27', '- **Response:** The spec (AC-4) requires the toast; kept open.', '',
      '## phase-2', 'Why is TC-007 incomplete?', '- **Status:** open', '', '## BUG-9', 'Old bug.', '- **Status:** open', ''].join('\n');
    fs.writeFileSync(cf, C);
    const r = render({ reportPath: t.report, root: t.dir }); const html = r.html || '';
    if (r.payload.gate !== 'PASS') p.push('gate with comments ' + r.payload.gate + ' ' + r.payload.gateReason);
    if (r.payload.comments.open !== 3 || r.payload.comments.handled !== 1) p.push('counts ' + r.payload.comments.open + '/' + r.payload.comments.handled);
    if (r.payload.comments.unknownIds.join(',') !== 'BUG-9' || !wkinds(r).includes('comment-unknown-id')) p.push('unknown bug id not reported');
    if (!/ · comments=[0-9a-f]{64} · tracker=none · page=/.test(html) || r.payload.hashes.comments === 'none') p.push('comments hash missing');
    if (!/data-comment-id="phase-2"[^>]*data-entry="phase-2"[^>]*>Why is TC-007 incomplete\?<\/textarea>/.test(html)) p.push('phase-2 comment not pre-filled');
    if (!/<div class="comment-entry cm-declined"><p class="comment-text">Not a bug — the spec allows it\.<\/p>/.test(html) || /data-entry="BUG-2"/.test(html)) p.push('declined BUG-2 comment not rendered as history');
    if (!/data-comment-id="General"[^>]*data-entry="General"[^>]*>Please add the Arabic run next time\.<\/textarea>/.test(html)) p.push('general comment not pre-filled');
    if (!/<div class="comments-orphans">[\s\S]*BUG-9/.test(html)) p.push('orphan BUG-9 not listed');
    const island = (html.match(/<script type="application\/json" id="report-data">([^<]*)<\/script>/) || [])[1];
    let data = null; try { data = JSON.parse(island); } catch { p.push('JSON island does not parse'); }
    if (data && (data.pageKind !== 'run-report' || data.page !== 'TEST-RUN-REPORT-create-order.html' || data.comments.entries.length !== 4 || data.sourceRev !== rev)) p.push('JSON island identity / entries wrong');
    fs.writeFileSync(cf, C.replace('**Page:** TEST-RUN-REPORT-create-order.html', '**Page:** TC-REVIEW-create-order.html'));
    const rp = render({ reportPath: t.report, root: t.dir });
    if (!wkinds(rp).includes('comments-page-mismatch') || /data-entry=/.test(rp.html || '')) p.push('comments from the TC page were attached to the run page');
  } finally { t.cleanup(); }
  check('24 reviewer comments: file pre-fills, history, orphans, provenance; inline field in the box, never a fact', p, {});
}

/* 25 — one shell per page: one stylesheet, one script + JSON island, one viewer, one toolbar; one comment box per bug / phase + the general box; no chrome in the body partial. */
{
  const p = [];
  const r = render({ reportPath: REPORT, root: here }); const html = r.html || '';
  const count = (re) => (html.match(re) || []).length;
  if (count(/<style>/g) !== 1 || count(/<script>/g) !== 1 || count(/<script type="application\/json" id="report-data">/g) !== 1) p.push('style / script / island count');
  if (count(/data-theme-toggle/g) !== 1 || count(/id="comments-save"/g) !== 1 || count(/class="filter-bar"/g) !== 1) p.push('toolbar / filter bar not exactly once');
  const want = r.model.phases.length + (r.model.bugs ? r.model.bugs.entries.length : 0) + 1;
  if (count(/data-comment-kind="/g) !== want) p.push('comment boxes ' + count(/data-comment-kind="/g) + ' != ' + want);
  const body = read(TEMPLATE_PATH);
  if (/<html|<head|<style|<script|<dialog|<footer/i.test(body)) p.push('body partial carries document chrome');
  if (!/<body data-page-kind="run-report">/.test(html)) p.push('page kind missing');
  const rb = render({ reportPath: REPORT, root: here, shell: '<!DOCTYPE html>\n{{{body}}}{{no_such_shell_key}}' });
  if (rb.payload.gate !== 'BLOCKED' || !kinds(rb).includes('placeholder-left')) p.push('a shell leftover did not BLOCK');
  check('25 one shell per page: one style, one script, one viewer, one comment box per item', p, { boxes: want });
}

/* 26 — MIRROR: assets/report-shell.template.html and the renderer kit are byte-identical with skills 3 / 3b / 3c (and the other run-report folder, 5 ↔ 5b) where installed. */
{
  const skillDir = path.resolve(here, '..');
  const sibs = ['link-qc-3-generate-manual-test-cases', 'link-qc-3b-validate-manual-test-cases', 'link-qc-3c-validate-manual-test-cases-cli', ...RUN_REPORT_SKILLS].filter((s) => s !== path.basename(skillDir)).map((s) => path.join(skillDir, '..', s)).filter((d) => fs.existsSync(d));
  if (!sibs.length) cases.push({ case: '26 shell mirror with skills 3 / 3b / 3c', ok: true, skipped: true, problems: [], detail: 'no sibling installed — nothing to compare' });
  else {
    const p = [];
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const kit = (f) => { const s = read(f); const i = s.indexOf('/* ==== report-shell kit — BEGIN'); const j = s.indexOf('/* ==== report-shell kit — END ==== */'); return i >= 0 && j > i ? s.slice(i, j) : null; };
    const mine = kit(SCRIPT); if (!mine) p.push('report-shell kit markers missing in render-run-report.mjs');
    for (const d of sibs) {
      const n = path.basename(d); const b = path.join(d, 'assets', 'report-shell.template.html');
      if (!fs.existsSync(b)) p.push(n + ': no assets/report-shell.template.html'); else if (sha(b) !== sha(SHELL_PATH)) p.push(n + ': report shell differs');
      const rf = fs.existsSync(path.join(d, 'scripts', 'render-tc-review.mjs')) ? 'render-tc-review.mjs' : 'render-run-report.mjs';
      const k = kit(path.join(d, 'scripts', rf)); if (mine && k !== mine) p.push(n + ': renderer kit differs');
    }
    check('26 shell mirror with skills 3 / 3b / 3c', p, { siblings: sibs.map((d) => path.basename(d)) });
  }
}

/* 27 — classification catalogue: `ai_rubric_failure` (written only by the manual CLI run, skill 5b) is in the catalogue; a misspelt one still warns, never BLOCKs. */
{
  const ROW = '| TC-010 | REQ-03 | Delete a draft order | PASS | serial:orders | 00:00:50 | — |';
  const base = render({ reportPath: REPORT, root: here });
  const swap = (cls) => (s) => { const i = s.lastIndexOf(ROW); if (i < 0) throw new Error('fixture row moved'); return s.slice(0, i) + ROW.replace('| PASS | serial:orders | 00:00:50 | — |', '| FAIL | serial:orders | 00:00:50 | ' + cls + ' |') + s.slice(i + ROW.length); };
  const t1 = tmpCopy(swap('ai_rubric_failure')); const t2 = tmpCopy(swap('ai_rubric'));
  const r1 = render({ reportPath: t1.report, root: here }); const r2 = render({ reportPath: t2.report, root: here });
  const p = [];
  if (wkinds(base).includes('unknown-classification')) p.push('fixture warns on classification');
  if (wkinds(r1).includes('unknown-classification')) p.push('ai_rubric_failure is reported as unknown');
  if (!wkinds(r2).includes('unknown-classification')) p.push('a misspelt classification does not warn');
  if (kinds(r2).includes('unknown-classification')) p.push('a classification must never BLOCK');
  t1.cleanup(); t2.cleanup();
  check('27 ai_rubric_failure classification', p, { w1: wkinds(r1), w2: wkinds(r2) });
}

/* 28 — MIRROR 5 ↔ 5b: the renderer, this harness, scan-lib, both templates and every file under fixtures/run-report/ are byte-identical in the other run-report skill folder when it is installed. */
{
  const skillDir = path.resolve(here, '..'); const me = path.basename(skillDir);
  const others = RUN_REPORT_SKILLS.filter((s) => s !== me).map((s) => path.join(skillDir, '..', s)).filter((d) => fs.existsSync(d));
  if (!others.length) cases.push({ case: '28 run-report mirror 5 ↔ 5b', ok: true, skipped: true, problems: [], detail: 'the other run-report skill folder is not installed — nothing to compare' });
  else {
    const p = [];
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    const fixed = ['scripts/render-run-report.mjs', 'scripts/selftest-run-report.mjs', 'scripts/scan-lib.mjs', 'assets/run-report.template.html', 'assets/report-shell.template.html'];
    const rel = listFiles(path.join(here, 'fixtures', 'run-report')).map((f) => path.relative(skillDir, f).split(path.sep).join('/'));
    for (const d of others) {
      const n = path.basename(d);
      for (const f of [...fixed, ...rel]) { const a = path.join(skillDir, f); const b = path.join(d, f); if (!fs.existsSync(b)) p.push(n + ': missing ' + f); else if (sha(a) !== sha(b)) p.push(n + ': differs ' + f); }
      for (const f of listFiles(path.join(d, 'scripts', 'fixtures', 'run-report')).map((f) => path.relative(d, f).split(path.sep).join('/'))) if (!rel.includes(f)) p.push(n + ': extra fixture file ' + f);
    }
    check('28 run-report mirror 5 ↔ 5b', p, { siblings: others.map((d) => path.basename(d)), files: fixed.length + rel.length });
  }
}

/* 29 — test-data readiness decisions (skills 5 and 5b): READY / prepared (api|ui|db) / skip — data_missing / skip — not creatable / skip — QC declined are counted per phase and shown under the verdict; the legacy bare words still parse; another word warns, never BLOCKs; a bare `all ready` body renders as the verdict. */
{
  const p = [];
  const base = render({ reportPath: REPORT, root: here });
  const r1 = base.payload.document.phases[0].readiness; const r2 = base.payload.document.phases[1].readiness;
  if (!r1 || r1.skipped.qc_declined !== 1 || r1.rows !== 1) p.push('phase 1 readiness counts ' + JSON.stringify(r1));
  if (!r2 || r2.prepared.api !== 1 || r2.prepared.total !== 1 || r2.skipped.qc_declined !== 1 || r2.rows !== 2) p.push('phase 2 readiness counts ' + JSON.stringify(r2));
  if (!/Decisions: ready 0 · prepared 1 \(api 1 · ui 0 · db 0\) · skipped 1 \(data_missing 0 · not creatable 0 · QC declined 1\)/.test(base.html || '')) p.push('the Decisions line is not rendered for phase 2');
  if (wkinds(base).includes('unknown-readiness-decision')) p.push('fixture warns on a readiness decision');
  const ROW = '| customer without orders | TC-020 | skip — QC declined | qc | — | — | — | — | — |';
  const swap = (dec) => (s) => { if (!s.includes(ROW)) throw new Error('fixture readiness row moved'); return s.replace(ROW, ROW.replace('skip — QC declined', dec)); };
  const t1 = tmpCopy(swap('skip')); const t2 = tmpCopy(swap('skip — not creatable (approvals need an active approver)')); const t3 = tmpCopy(swap('maybe later'));
  const t4 = tmpCopy((s) => { const i = s.indexOf('### Test-data readiness'); const j = s.indexOf('### Deviations', i); return s.slice(0, i) + '### Test-data readiness\nall ready\n\n' + s.slice(j); });
  try {
    const x1 = render({ reportPath: t1.report, root: here }); const x2 = render({ reportPath: t2.report, root: here }); const x3 = render({ reportPath: t3.report, root: here }); const x4 = render({ reportPath: t4.report, root: here });
    if (x1.payload.document.phases[0].readiness.skipped.unspecified !== 1 || wkinds(x1).includes('unknown-readiness-decision')) p.push('legacy bare skip not accepted');
    if (x2.payload.document.phases[0].readiness.skipped.not_creatable !== 1) p.push('skip — not creatable with evidence not counted');
    if (!wkinds(x3).includes('unknown-readiness-decision')) p.push('an unknown decision does not warn');
    if (kinds(x3).includes('unknown-readiness-decision') || x3.payload.gate === 'BLOCKED') p.push('an unknown decision must never BLOCK');
    if (x4.payload.document.phases[0].readiness !== null || !/Verdict: all ready/.test(x4.html || '')) p.push('a bare `all ready` body is not rendered as the verdict: ' + JSON.stringify(x4.payload.document.phases[0].readiness));
  } finally { t1.cleanup(); t2.cleanup(); t3.cleanup(); t4.cleanup(); }
  check('29 test-data readiness decisions counted and rendered', p, { phase1: r1, phase2: r2 });
}

/* 30 — tracker: TC-STATUS-TRACKER-{feature}.md merged into every Results table by TC-ID (golden); tracker TCs with no Results row are listed
      under "Not automated / not run" so every TC is visible; Summary and Bug index shown as written; Azure IDs linked, BUG-n to its card;
      absent → one tracker-missing warning and the page without tracker markup; found beside the Source document; checked against the
      source TC document in both directions, or — without it — only the run TCs; Azure base from the project .mcp.json; a secret BLOCKs;
      a missing or mismatched tracker never changes the gate. */
{
  const p = [];
  const r = render({ reportPath: REPORT, trackerPath: TRACKER, root: here }); const html = r.html || '';
  if (r.payload.gate !== 'PASS' || r.payload.warnings.length) p.push('with the tracker: ' + r.payload.gate + ' ' + wkinds(r).join(','));
  if (!fs.existsSync(GOLDEN_TRACKER)) p.push('tracker golden missing — render it with the command in fixtures/run-report/README.md'); else if (norm(html) !== read(GOLDEN_TRACKER)) p.push('tracker page differs from golden');
  const t = r.payload.tracker;
  if (!t.present || !t.columns || t.tcs !== 7 || t.ranTcs !== 5 || t.notRun !== 2 || t.adoSource !== 'tracker' || t.lastUpdated !== '2026-09-22 09:30') p.push('payload ' + JSON.stringify(t));
  if ((html.match(/<th data-sort="none">Evidence<\/th><th data-sort="text">Covered<\/th>/g) || []).length !== 2) p.push('both phases\' Results tables should carry the tracker columns');
  if (!/<td colspan="14">/.test(html) || /<td colspan="8">/.test(html)) p.push('attempt rows must span the 14 columns');
  const tc007 = (html.match(/id="tc-2-TC-007">[\s\S]*?<\/tr>/) || [''])[0];
  if (!/<td data-sort="fail"><span class="badge st-fail">Fail<\/span><\/td><td><span class="ltr"><a href="#BUG-2">BUG-2<\/a> \(<a class="ado" href="https:\/\/devops\.example\.com\/ExampleCollection\/ExampleProject\/_workitems\/edit\/100512" target="_blank" rel="noopener">#100512<\/a>\)<\/span><\/td><td><span class="ltr">Active<\/span><\/td><td>Retest variation B after the fix is deployed<\/td>/.test(tc007)) p.push('TC-007 tracker cells / links');
  const nr = (html.match(/<section id="sec-not-run">[\s\S]*?<\/section>/) || [''])[0];
  if (!/2 tracker TC\(s\) with no Results row in any phase · 7 in the tracker · 5 in the run/.test(nr) || !/<tr id="nr-TC-040">/.test(nr) || !/<tr id="nr-TC-041">/.test(nr) || /nr-TC-001/.test(nr)) p.push('not-automated table');
  if (!/<td>Print the order confirmation<\/td><td>No<\/td><td>The print dialog is outside the browser<\/td>/.test(nr)) p.push('title / covered / reason on a not-automated row');
  if (!/<section id="sec-tracker">[\s\S]*?Tracker last updated:<\/b> <span class="ltr">2026-09-22 09:30<\/span>/.test(html) || !/<b>Tracker last updated<\/b> 2026-09-22 09:30/.test(html)) p.push('tracker section / meta line');
  if (!/<section id="sec-bug-index">[\s\S]*?<a href="#BUG-1">BUG-1<\/a>[\s\S]*?edit\/100511/.test(html)) p.push('bug index links');
  if (!/ · tracker=[0-9a-f]{64} · page=/.test(html) || r.payload.hashes.tracker === 'none') p.push('tracker hash missing from provenance');
  const n0 = render({ reportPath: REPORT, root: here });
  if (n0.payload.gate !== 'PASS' || wkinds(n0).filter((k) => k === 'tracker-missing').length !== 1) p.push('no tracker → expected PASS + one tracker-missing');
  if (/sec-tracker|sec-not-run|sec-bug-index|>Covered<|badge st-/.test(n0.html || '') || !/<td colspan="8">/.test(n0.html || '')) p.push('tracker markup rendered without a tracker');
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-tracker-'));
  try {
    const auto = path.join(proj, 'Testing', 'Automation'); fs.cpSync(fx('automation'), auto, { recursive: true });
    const story = path.join(proj, 'Testing', 'Manual_Test', 'TestCases', 'US-1234-create-order'); fs.mkdirSync(story, { recursive: true });
    fs.copyFileSync(fx('tracker', 'TEST-CASES-create-order.md'), path.join(story, 'TEST-CASES-create-order.md'));
    fs.copyFileSync(TRACKER_MISMATCH, path.join(story, 'TC-STATUS-TRACKER-create-order.md'));
    const rep = path.join(auto, STORY, 'TEST-RUN-REPORT-create-order.md');
    const r1 = render({ reportPath: rep, root: proj });
    const w = r1.payload.warnings.find((x) => x.kind === 'tracker-tc-mismatch');
    if (r1.payload.gate !== 'PASS' || !w || w.onlyInTracker.join() !== 'TC-099' || w.onlyInSource.join() !== 'TC-020,TC-040,TC-041') p.push('mismatch against the source document ' + JSON.stringify(w));
    if (!r1.payload.input.sourceDocument || !r1.payload.input.tracker) p.push('tracker / source document not found via the Source document header line');
    if (!r1.payload.warnings.some((x) => x.kind === 'tracker-ado-url-missing') || /class="ado"/.test(r1.html || '')) p.push('no URL → plain IDs + tracker-ado-url-missing');
    fs.writeFileSync(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { 'azure-devops': { command: 'npx', args: ['-y', '@azure-devops/mcp', 'exampleorg', '--authentication', 'pat'], env: { PERSONAL_ACCESS_TOKEN: '${AZURE_DEVOPS_PAT_B64}' } }, 'azure-devops-attachments': { command: 'node', args: ['.claude/mcp-launchers/azure-devops-attachments.cjs'], env: { AZURE_DEVOPS_ORG_URL: 'https://dev.azure.com/exampleorg', AZURE_DEVOPS_AUTH_METHOD: 'pat', AZURE_DEVOPS_DEFAULT_PROJECT: 'Example Project' } } } }));
    const r2 = render({ reportPath: rep, root: proj });
    if (r2.payload.tracker.adoSource !== '.mcp.json' || !/href="https:\/\/dev\.azure\.com\/exampleorg\/Example%20Project\/_workitems\/edit\/100512"/.test(r2.html || '')) p.push('cloud .mcp.json not used ' + JSON.stringify(r2.payload.tracker));
    fs.rmSync(path.join(story, 'TEST-CASES-create-order.md'));
    const r3 = render({ reportPath: rep, root: proj });
    const w3 = r3.payload.warnings.find((x) => x.kind === 'tracker-tc-mismatch');
    if (!w3 || w3.onlyInSource.join() !== 'TC-020' || w3.onlyInTracker.length || r3.payload.gate !== 'PASS') p.push('without the source document only the run TCs are checked ' + JSON.stringify(w3));
    fs.writeFileSync(path.join(story, 'TC-STATUS-TRACKER-create-order.md'), read(TRACKER).replace('Run by hand on the next regression cycle', 'token = abc12345'));
    const r4 = render({ reportPath: rep, root: proj });
    if (r4.payload.gate !== 'BLOCKED' || !kinds(r4).includes('secret-literal')) p.push('a password-shaped literal in the tracker did not BLOCK');
  } finally { fs.rmSync(proj, { recursive: true, force: true }); }
  check('30 tracker: merged into Results (golden), not-automated table, links, missing → warning, mismatch → warning, .mcp.json, secret BLOCKs', p, { tracker: t });
}

/* 31 — navigation markup: every section has an id and every phase card a contents label; Results / run-history headers name their sort
      types (Evidence none); the shell carries the contents panel, back-to-top link and script; no external request. */
{
  const p = [];
  const r = render({ reportPath: REPORT, trackerPath: TRACKER, root: here }); const html = r.html || '';
  if (/<section>/.test(html)) p.push('a section without an id');
  for (const id of ['sec-run-history', 'sec-static-coverage', 'sec-tracker', 'results', 'sec-not-run', 'bugs', 'sec-bug-index', 'reviewer-comments']) if ((html.match(new RegExp('<section[^>]* id="' + id + '"', 'g')) || []).length !== 1) p.push('section id ' + id + ' not exactly once');
  if (!/<details class="card phase" id="phase-1" data-toc-label="Phase 1 · FAILURES">/.test(html) || !/<details class="card phase" id="phase-2" data-toc-label="Phase 2 · INCOMPLETE" open>/.test(html)) p.push('phase cards lack their contents label');
  if (!/<th data-sort="natural">TC-ID<\/th><th data-sort="natural">REQ<\/th><th data-sort="text">Name<\/th><th data-sort="rank" data-sort-order="fail\|incomplete\|partial\|skip\|not_run,not run\|pass">Status<\/th><th data-sort="text">Group<\/th><th data-sort="duration">Duration<\/th><th data-sort="rank" data-sort-order="app_bug[^"]*">Classification<\/th><th data-sort="none">Evidence<\/th>/.test(html)) p.push('typed Results headers');
  if (!/<th data-sort="date">Date<\/th>/.test(html) || !/<th data-sort="duration">Duration<\/th><th data-sort="natural">Bugs<\/th>/.test(html)) p.push('typed run-history headers');
  if (!/<nav class="toc" id="toc" aria-label="Contents" hidden>/.test(html) || !/IntersectionObserver/.test(html) || !/<a class="to-top" id="to-top" href="#top" hidden>/.test(html)) p.push('contents panel / script / back-to-top');
  if (/<script[^>]+src=|<link[^>]+href=|@import|url\(http/i.test(html)) p.push('an external request');
  check('31 navigation: section ids, phase labels, typed headers, contents panel, no external request', p, {});
}

/* 32 — rate_limited and the documented reason forms (references/run-report.md §4): an INCOMPLETE row classified `rate_limited`,
      `interrupted: {reason}` or `cleanup_incomplete` and a NOT_RUN row `not started: {reason}` raise neither unknown-classification
      nor incomplete-without-variants and never BLOCK; the phase derives INCOMPLETE; `rate_limited` is shown in the phase card; a
      misspelt `rate_limit` still warns. */
{
  const p = [];
  const ROW7 = '| TC-007 | REQ-02 | Order total recalculates | INCOMPLETE | parallel | 00:00:58 | incomplete: chromium--variation-b--r0 |';
  const LAST = '| TC-030 | REQ-05 | Confirm the order by the code sent by SMS |';
  const EXTRA = ['| TC-040 | REQ-01 | Print the order confirmation | INCOMPLETE | parallel | 00:00:21 | interrupted: watchdog stop | — |',
    '| TC-041 | REQ-02 | Reorder from the order history | NOT_RUN | serial:orders | — | not started: depends on TC-001 (failed) | — |',
    '| TC-042 | REQ-03 | Archive a confirmed order | INCOMPLETE | serial:orders | 00:00:33 | cleanup_incomplete | — |'];
  const mut = (cls7) => (s) => {
    if (!s.includes(ROW7)) throw new Error('fixture TC-007 row moved');
    s = s.replace(ROW7, ROW7.replace('| incomplete: chromium--variation-b--r0 |', '| ' + cls7 + ' |'));
    const i = s.indexOf(LAST, s.indexOf('## Phase 2')); if (i < 0) throw new Error('fixture TC-030 row moved');
    const j = s.indexOf('\n', i); return s.slice(0, j + 1) + EXTRA.join('\n') + '\n' + s.slice(j + 1);
  };
  const t1 = tmpCopy(mut('rate_limited')); const t2 = tmpCopy(mut('rate_limit'));
  try {
    const r1 = render({ reportPath: t1.report, root: here }); const r2 = render({ reportPath: t2.report, root: here });
    const mine = ['TC-007', 'TC-040', 'TC-041', 'TC-042'];
    const bad = r1.payload.warnings.filter((w) => mine.includes(w.id) && (w.kind === 'unknown-classification' || w.kind === 'incomplete-without-variants'));
    if (bad.length) p.push('documented forms warn: ' + bad.map((w) => w.id + ' ' + w.kind).join(', '));
    if (r1.payload.gate === 'BLOCKED' || r1.payload.errors.length) p.push('gate ' + r1.payload.gate + ' errors ' + kinds(r1).join(','));
    const ph = r1.payload.document.phases[1];
    if (ph.outcome !== 'INCOMPLETE' || ph.counts.incomplete !== 3 || ph.counts.notrun !== 1) p.push('phase 2 derived ' + ph.outcome + ' ' + JSON.stringify(ph.counts));
    const card = ((r1.html || '').match(/<details class="card phase" id="phase-2"[\s\S]*?<\/details>/) || [''])[0];
    if (!/>rate_limited</.test(card)) p.push('rate_limited is not rendered in the phase 2 card');
    if (!/data-sort-order="[^"]*\|environment_failure\|rate_limited\|data_missing\|/.test(r1.html || '')) p.push('rate_limited missing from the Classification sort order');
    if (!r2.payload.warnings.some((w) => w.kind === 'unknown-classification' && w.id === 'TC-007')) p.push('a misspelt rate_limit does not warn');
    if (kinds(r2).includes('unknown-classification') || r2.payload.gate === 'BLOCKED') p.push('a misspelt classification must never BLOCK');
  } finally { t1.cleanup(); t2.cleanup(); }
  check('32 rate_limited and documented reason forms (interrupted: / not started: / cleanup_incomplete) accepted', p, {});
}

/* 33 — --base: a DRAFT report under artifacts/drafts/phase-N/ rendered for the story folder gives the published page byte for byte —
      evidence links and the legacy listing resolve against the story folder; without --base the draft's links do not resolve. */
{
  const t = tmpCopy();
  try {
    const p = [];
    const drafts = path.join(t.story, 'artifacts', 'drafts', 'phase-2');
    fs.mkdirSync(path.join(drafts, '.runs'), { recursive: true });
    fs.copyFileSync(t.report, path.join(drafts, 'TEST-RUN-REPORT-create-order.md'));
    fs.copyFileSync(t.bugs, path.join(drafts, 'BUG-REPORT-create-order.md'));
    for (const f of fs.readdirSync(t.runs)) fs.copyFileSync(path.join(t.runs, f), path.join(drafts, '.runs', f));
    fs.writeFileSync(path.join(t.story, 'merged-results.json'), '{}\n'); // a legacy artifact of the story folder
    const draftReport = path.join(drafts, 'TEST-RUN-REPORT-create-order.md');
    const pub = render({ reportPath: t.report, root: t.dir });
    const noBase = render({ reportPath: draftReport, root: t.dir });
    const draft = render({ reportPath: draftReport, base: t.story, root: t.dir });
    if (pub.payload.gate !== 'PASS' || draft.payload.gate !== 'PASS') p.push('gates ' + pub.payload.gate + ' / ' + draft.payload.gate);
    if (!draft.html || draft.html !== pub.html) p.push('the draft page rendered with --base differs from the page of the published files');
    if (!wkinds(noBase).includes('evidence-file-missing')) p.push('without --base the draft\'s ../../screenshots links should not resolve');
    if (wkinds(draft).includes('evidence-file-missing')) p.push('with --base the draft\'s links must resolve');
    if (draft.payload.document.legacyFiles.join() !== 'merged-results.json' || noBase.payload.document.legacyFiles.length) p.push('legacy listing: --base ' + draft.payload.document.legacyFiles.join() + ' / none ' + noBase.payload.document.legacyFiles.join());
    if (draft.payload.input.base !== path.relative(t.dir, t.story)) p.push('payload input.base ' + draft.payload.input.base);
    if (pub.payload.input.base !== undefined) p.push('input.base present without --base');
    const call = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: t.dir });
    const w = JSON.parse(call(['--report', draftReport, '--base', t.story, '--write']).stdout);
    const draftPage = path.join(drafts, 'TEST-RUN-REPORT-create-order.html');
    if (w.gate !== 'PASS' || !fs.existsSync(draftPage) || read(draftPage) !== norm(pub.html || '')) p.push('CLI --base --write: ' + w.gate + ' — the draft page must be written beside the draft and equal the published page');
    if (fs.existsSync(t.out)) p.push('CLI --base --write wrote into the story folder');
    check('33 --base: a draft rendered for the story folder equals the published page; links and legacy files resolve there', p, {});
  } finally { t.cleanup(); }
}

/* 34 — --gate: the gate record's sha256 joins the provenance (` · gate=… · page=`), its verdict the meta line; a page without --gate is
      unchanged and both verify; a missing gate record BLOCKs; re-rendering over a gated page is never refused as hand-edited. */
{
  const t = tmpCopy();
  try {
    const p = [];
    const gateFile = path.join(t.runs, 'phase-2.checkpoint-B.json');
    const gateText = JSON.stringify({ schema: 'skill5-gate/1', checkpoint: 'B', phase: 2, verdict: 'PASS', snapshotId: 'b7c8d9e0', decidedAt: '2026-09-21T14:05:00Z', results: [], rejected: [], na: [] }, null, 2) + '\n';
    fs.writeFileSync(gateFile, gateText);
    const gsha = crypto.createHash('sha256').update(gateText, 'utf8').digest('hex');
    const plain = render({ reportPath: t.report, root: t.dir });
    const gated = render({ reportPath: t.report, gatePath: gateFile, root: t.dir });
    if (gated.payload.gate !== 'PASS') p.push('gated render ' + gated.payload.gate + ' ' + gated.payload.gateReason);
    if (!(gated.html || '').includes(' · tracker=none · gate=' + gsha + ' · page=')) p.push('the gate hash is not in the provenance line');
    if (/ · gate=/.test(plain.html || '')) p.push('a page rendered without --gate carries gate=');
    const st = pageState(gated.html || ''); const st0 = pageState(plain.html || '');
    if (!st.provenance || st.handEdited || st.recorded.gate !== gsha) p.push('gated page provenance ' + JSON.stringify(st));
    if (!st0.provenance || st0.handEdited || st0.recorded.gate !== null) p.push('plain page provenance ' + JSON.stringify(st0));
    const m = (gated.html || '').match(/page=([0-9a-f]{64})/); if (!m || selfHash(gated.html) !== m[1]) p.push('gated page self-hash does not verify');
    if (!/<span><b>Gate record<\/b> Checkpoint B PASS · phase 2 · snapshot b7c8d9e0 · 2026-09-21<\/span>/.test(gated.html || '')) p.push('gate record meta line missing');
    if (/Gate record/.test(plain.html || '')) p.push('gate meta shown without --gate');
    if (gated.payload.hashes.gate !== gsha || plain.payload.hashes.gate !== undefined || !gated.payload.document.gate || gated.payload.document.gate.verdict !== 'PASS') p.push('payload hashes.gate / document.gate');
    const miss = render({ reportPath: t.report, gatePath: path.join(t.runs, 'phase-2.checkpoint-X.json'), root: t.dir });
    if (miss.payload.gate !== 'BLOCKED' || !kinds(miss).includes('gate-file-missing') || miss.html !== null) p.push('missing gate record: ' + miss.payload.gate);
    const call = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: t.dir });
    const w = JSON.parse(call(['--report', t.report, '--gate', gateFile, '--write']).stdout);
    const st2 = pageState(read(t.out));
    if (w.gate !== 'PASS' || st2.handEdited || st2.recorded.gate !== gsha) p.push('CLI --gate --write: ' + w.gate + ' ' + JSON.stringify(st2));
    const w2 = JSON.parse(call(['--report', t.report, '--write']).stdout);
    if (w2.gate !== 'PASS' || pageState(read(t.out)).recorded.gate !== null) p.push('re-render without --gate over a gated page: ' + w2.gate);
    check('34 --gate: gate hash in the provenance and the meta line, verified both ways; missing record BLOCKs', p, { gate: gsha.slice(0, 12) });
  } finally { t.cleanup(); }
}

/* 35 — `NO VERDICT` smoke gate (no smoke TC produced a PASS or FAIL): accepted, never GREEN — a phase whose rows are only SKIP /
      NOT_RUN derives INCOMPLETE, and a header that says GREEN is a MISMATCH. */
{
  const p = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-run-report-nv-'));
  try {
    const doc = (outcome) => ['# Test Run Report — nv', '', '**User Story:** US-1 — No verdict', '**Latest phase:** 1', '**Status:** ' + outcome,
      '**Latest results:** 0 passed · 0 failed · 0 incomplete · 1 skipped · 1 not run of 2 TCs', '', '## Run history', '',
      '| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run | Total | Duration | Bugs |', '|---|---|---|---|---|---|---|---|---|---|---|',
      '| 1 | 2026-10-01 | ' + outcome + ' | 0 | 0 | 0 | 1 | 1 | 2 | 00:01:00 | — |', '', '## Phase 1 — 2026-10-01', '', '### Run', '- **Outcome:** ' + outcome, '',
      '### Stages', '| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run |', '|---|---|---|---|---|---|---|', '| Smoke | 1 | 0 | 0 | 0 | 1 | 0 |', '| Positive | 1 | 0 | 0 | 0 | 0 | 1 |', '| **Total** | 2 | 0 | 0 | 0 | 1 | 1 |', '',
      '**Smoke gate:** NO VERDICT — fail% — — no smoke TC produced a PASS or FAIL; positive and negative not started', '',
      '### Results', '| TC-ID | REQ | Name | Status | Group | Duration | Classification | Evidence |', '|---|---|---|---|---|---|---|---|',
      '| TC-1 | REQ-1 | Smoke check | SKIP | parallel | — | data_missing | — |', '| TC-2 | REQ-1 | Positive check | NOT_RUN | parallel | — | not started: smoke gate NO VERDICT | — |', ''].join('\n');
    const f = path.join(dir, 'TEST-RUN-REPORT-nv.md');
    fs.writeFileSync(f, doc('INCOMPLETE'));
    const r = render({ reportPath: f, root: dir });
    if (r.payload.gate !== 'PASS' || r.payload.errors.length) p.push('NO VERDICT line: ' + r.payload.gate + ' ' + kinds(r).join(','));
    if (r.payload.document.phases[0].outcome !== 'INCOMPLETE' || r.payload.document.phases[0].smokeGate.indexOf('NO VERDICT') !== 0) p.push('derived ' + r.payload.document.phases[0].outcome);
    fs.writeFileSync(f, doc('GREEN'));
    const g = render({ reportPath: f, root: dir });
    if (g.payload.gate !== 'MISMATCH' || g.payload.document.phases[0].outcome !== 'INCOMPLETE' || !mm(g, 'phase').some((x) => x.field === 'Outcome' && x.computed === 'INCOMPLETE')) p.push('GREEN over NO VERDICT: ' + g.payload.gate + ' ' + JSON.stringify(g.payload.mismatches));
    fs.writeFileSync(f, doc('INCOMPLETE').replace('**Smoke gate:** NO VERDICT', '**Smoke gate:** UNDECIDED'));
    const u = render({ reportPath: f, root: dir });
    if (u.payload.gate !== 'BLOCKED' || !kinds(u).includes('unknown-enum')) p.push('an unknown smoke word must still BLOCK: ' + u.payload.gate);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  check('35 NO VERDICT smoke gate accepted and never GREEN', p, {});
}

/* 36 — skill 9's in-place retest of the LATEST phase (link-qc-9-retesting references/report-update.md): BUG-2 / TC-007 retested
      through the automation, INCOMPLETE → PASS, on the fixture's 1.x run file AND on a 2.0 run file (an `Acceptance` bullet,
      `acceptance` in the run file, gate records A / B beside it). Both render PASS with no mismatch and none of the warnings
      the edit could cause; the page is rendered WITHOUT --gate (the B record certifies the phase as published before the
      retest — skill 9 never edits it and never hashes it into the amended page); the gate records stay byte-identical. */
{
  const p = [];
  const V = '../../screenshots/US-1234-create-order/phase-2/TC-007/';
  const retestReport = (s) => {
    const at = s.indexOf('## Phase 2');
    const head = s.slice(0, at).replace('**Latest results:** 2 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run · 1 partial of 5 TCs', '**Latest results:** 3 passed · 0 failed · 0 incomplete · 1 skipped · 0 not run · 1 partial of 5 TCs')
      .replace('| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 1 | 5 | 00:05:12 | BUG-1, BUG-2 |', '| 2 | 2026-09-21 | INCOMPLETE | 3 | 0 | 0 | 1 | 0 | 1 | 5 | 00:05:12 | BUG-1, BUG-2 |');
    const ph = s.slice(at)
      .replace('- **Previous phase:** .runs/phase-1.json\n', '- **Previous phase:** .runs/phase-1.json\n- **Retest:** 2026-09-22 — skill 9 · 1 automation re-run · 0 playwright-cli · 1 passed · 0 failed · 0 unobserved · BUG-2 resolved\n')
      .replace('| Negative | 1 | 0 | 0 | 0 | 1 | 0 | 0 |\n| **Total** | 5 | 2 | 0 | 1 | 1 | 0 | 1 |', '| Negative | 1 | 0 | 0 | 0 | 1 | 0 | 0 |\n| Positive (retest — skill 9) | 1 | 1 | 0 | 0 | 0 | 0 | 0 |\n| **Total** | 5 | 3 | 0 | 0 | 1 | 0 | 1 |')
      .replace('| TC-007 | REQ-02 | Order total recalculates | INCOMPLETE | parallel | 00:00:58 | incomplete: chromium--variation-b--r0 | [attempt-1.png](' + V + 'chromium--variation-a--r0/attempt-1.png) |',
        '| TC-007 | REQ-02 | Order total recalculates | PASS | parallel | 00:01:02 | — | [attempt-2.png](' + V + 'chromium--variation-a--r0/attempt-2.png) · [attempt-1.png](' + V + 'chromium--variation-b--r0/attempt-1.png) · [attempt-1.png](' + V + 'chromium--variation-a--r0/attempt-1.png) |')
      .replace('OrderTotal.ts line 42 sums lineTotal only | INCOMPLETE |', 'OrderTotal.ts line 42 sums lineTotal only | PASS |')
      .replace('| BUG-2 | TC-007 | Medium | open |', '| BUG-2 | TC-007 | Medium | resolved (phase 2) |')
      .replace(/\s*$/, '\n- TC-007 INCOMPLETE → PASS — skill 9 retest 2026-09-22 (automation re-run, attempt 2, BUG-2); phase 2 updated in place\n');
    return head + ph;
  };
  const retestBugs = (s) => s.replace('**Bugs:** 1 open · 1 resolved · 0 not checked this run of 2', '**Bugs:** 0 open · 2 resolved · 0 not checked this run of 2')
    .replace('- **Status:** open', '- **Status:** resolved (phase 2)')
    .replace('  - phase 2 — FAIL: first seen while variation B was being investigated', '  - phase 2 — FAIL: first seen while variation B was being investigated\n  - phase 2 — PASS: retest by skill 9 on 2026-09-22 (automation re-run, attempt 2) on UAT, build 4.12.2 — [attempt-2.png](' + V + 'chromium--variation-a--r0/attempt-2.png)');
  const retestRun = (j) => {
    const r = j.results.find((x) => x.tc_id === 'TC-007');
    const ev = (v, a) => 'screenshots/US-1234-create-order/phase-2/TC-007/' + v + '/attempt-' + a + '.png';
    Object.assign(r, { status: 'PASS', classification: 'N/A', duration_ms: 62000, evidence_screenshot: ev('chromium--variation-a--r0', 2), attempts: 3, missing_variants: [], retest: { at: '2026-09-22T10:00:00Z', bug: 'BUG-2', before: 'INCOMPLETE', after: 'PASS', way: 'automation' } });
    const a = r.variants.find((v) => v.variant_slug === 'chromium--variation-a--r0');
    a.attempts.push({ attempt: 2, stage: 'positive · retest (skill 9)', status: 'PASS', evidence_screenshot: ev('chromium--variation-a--r0', 2), failure_screenshot: null, run: 'retest', started_at: '2026-09-22T10:00:00Z' });
    r.variants.push({ variant_slug: 'chromium--variation-b--r0', project: 'chromium', final_status: 'PASS', duration_ms: 61000, attempts: [{ attempt: 1, stage: 'positive · retest (skill 9)', status: 'PASS', evidence_screenshot: ev('chromium--variation-b--r0', 1), failure_screenshot: null, run: 'retest', started_at: '2026-09-22T10:01:00Z' }] });
    const t = j.merged.tcs.find((x) => x.tc_id === 'TC-007');
    Object.assign(t, { status: 'PASS', variant_slugs: t.required_variants.slice(), missing_variants: [] });
    Object.assign(j.totals, { passed: 3, incomplete: 0 });
    Object.assign(j.stages.positive, { passed: 2, incomplete: 0 });
    if (j.variant_totals) Object.assign(j.variant_totals, { passed: 4, not_run: 0 });
    j.bugs.find((b) => b.id === 'BUG-2').status = 'resolved (phase 2)';
    j.deviations.push('TC-007 INCOMPLETE → PASS — skill 9 retest 2026-09-22 (automation re-run, attempt 2, BUG-2); phase 2 updated in place');
    j.retests = (j.retests || []).concat([{ at: '2026-09-22T10:00:00Z', skill: 'link-qc-9-retesting', bug: 'BUG-2', source: 'BUG-REPORT-create-order.md', tc: 'TC-007', way: 'automation', environment: 'UAT', build: '4.12.2', before: 'INCOMPLETE', after: 'PASS', evidence: [ev('chromium--variation-a--r0', 2), ev('chromium--variation-b--r0', 1)], summary: 'reports/US-1234-create-order/artifacts/progress/rerun-positive-1.summary.json' }]);
    return j;
  };
  const caused = ['unknown-classification', 'evidence-file-missing', 'evidence-path-not-relative'];
  for (const variant of ['1.x run file', '2.0 run file']) {
    const v2 = variant.startsWith('2.0');
    const t = tmpCopy((s) => retestReport(v2 ? s.replace('- **Previous phase:** .runs/phase-1.json\n', '- **Previous phase:** .runs/phase-1.json\n- **Acceptance:** ACCEPTED\n') : s), retestBugs);
    try {
      const shots = path.join(t.dir, 'screenshots', 'US-1234-create-order', 'phase-2', 'TC-007');
      fs.copyFileSync(path.join(shots, 'chromium--variation-a--r0', 'attempt-1.png'), path.join(shots, 'chromium--variation-a--r0', 'attempt-2.png'));
      fs.mkdirSync(path.join(shots, 'chromium--variation-b--r0'), { recursive: true });
      fs.copyFileSync(path.join(shots, 'chromium--variation-a--r0', 'attempt-1.png'), path.join(shots, 'chromium--variation-b--r0', 'attempt-1.png'));
      const runFile = path.join(t.runs, 'phase-2.json');
      const j = retestRun(JSON.parse(read(runFile)));
      const gates = {};
      if (v2) {
        j.acceptance = { verdict: 'ACCEPTED', reasons: [], decided: 'final', at: '2026-09-21T14:05:00Z' };
        for (const cp of ['A', 'B']) {
          const f = path.join(t.runs, 'phase-2.checkpoint-' + cp + '.json');
          gates[f] = JSON.stringify({ schema: 'skill5-gate/1', checkpoint: cp, phase: 2, verdict: 'PASS', snapshotId: 'b7c8d9e0', decidedAt: '2026-09-21T14:0' + (cp === 'A' ? '0' : '5') + ':00Z', results: [], rejected: [], na: [] }, null, 2) + '\n';
          fs.writeFileSync(f, gates[f]);
        }
      }
      fs.writeFileSync(runFile, JSON.stringify(j, null, 2) + '\n');
      const r = render({ reportPath: t.report, root: t.dir });
      const d = r.payload.document || { phases: [] };
      if (r.payload.gate !== 'PASS' || r.payload.mismatches.length) p.push(variant + ': gate ' + r.payload.gate + ' ' + JSON.stringify(r.payload.mismatches) + ' ' + kinds(r).join(','));
      const bad = wkinds(r).filter((k) => caused.includes(k));
      if (bad.length) p.push(variant + ': warnings the retest edit caused: ' + bad.join(','));
      const ph2 = d.phases[1] || {};
      if (JSON.stringify(ph2.counts) !== JSON.stringify({ passed: 3, failed: 0, incomplete: 0, skipped: 1, notrun: 0, partial: 1, total: 5 })) p.push(variant + ': phase 2 counts ' + JSON.stringify(ph2.counts));
      if (!d.bugs || d.bugs.open !== 0 || d.bugs.resolved !== 2) p.push(variant + ': bug counts ' + JSON.stringify(d.bugs));
      if (!(r.html || '').includes('retest — skill 9')) p.push(variant + ': the retest stage row is not rendered');
      if (/ · gate=/.test(r.html || '') || /Gate record/.test(r.html || '')) p.push(variant + ': the amended page claims the gate record');
      for (const [f, text] of Object.entries(gates)) if (read(f) !== text) p.push(variant + ': a gate record changed: ' + path.basename(f));
    } finally { t.cleanup(); }
  }
  check('36 skill 9 retest update of the latest phase: 1.x and 2.0 run files render PASS, no gate claim, gate records untouched', p, {});
}

const out = {
  tool: 'selftest-render-run-report',
  skill: path.basename(path.resolve(here, '..')),
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'The renderer disagrees with its own fixtures. Do not deliver a page it renders until this passes; the markdown reports remain the deliverable.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
