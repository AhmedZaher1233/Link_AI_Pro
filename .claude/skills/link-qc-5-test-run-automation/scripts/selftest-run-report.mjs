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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { render, renderHtml, parseReport, parseBugReport, buildModel, pageState, selfHash, escapeHtml, TEMPLATE_PATH } from './render-run-report.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (...p) => path.join(here, 'fixtures', 'run-report', ...p);
const norm = (s) => s.replace(/\r\n?/g, '\n');
const read = (p) => norm(fs.readFileSync(p, 'utf8'));
const SCRIPT = path.join(here, 'render-run-report.mjs');
const STORY = path.join('reports', 'US-1234-create-order');
const REPORT = fx('automation', STORY, 'TEST-RUN-REPORT-create-order.md');
const BUGS = fx('automation', STORY, 'BUG-REPORT-create-order.md');
const GOLDEN = fx('golden', 'TEST-RUN-REPORT-create-order.html');

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

/* 1 — golden: byte-for-byte, PASS, no warnings. */
{
  const r = render({ reportPath: REPORT, root: here });
  const p = [];
  if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' != PASS: ' + r.payload.gateReason);
  if (r.payload.warnings.length) p.push('warnings on the fixture: ' + wkinds(r).join(','));
  if (!fs.existsSync(GOLDEN)) p.push('golden page missing — render it with the command in fixtures/run-report/README.md');
  else if (norm(r.html || '') !== read(GOLDEN)) p.push('page differs from golden');
  check('1 golden page', p, { bytes: (r.html || '').length });
}

/* 2 — derived numbers come from the tables, per phase. */
{
  const r = render({ reportPath: REPORT, root: here });
  const d = r.payload.document; const p = [];
  const c1 = JSON.stringify(d.phases[0].counts); const c2 = JSON.stringify(d.phases[1].counts);
  if (c1 !== JSON.stringify({ passed: 2, failed: 1, incomplete: 0, skipped: 1, notrun: 0, total: 4 })) p.push('phase 1 counts ' + c1);
  if (c2 !== JSON.stringify({ passed: 2, failed: 0, incomplete: 1, skipped: 1, notrun: 0, total: 4 })) p.push('phase 2 counts ' + c2);
  if (d.phases[0].outcome !== 'FAILURES' || d.phases[1].outcome !== 'INCOMPLETE' || d.status !== 'INCOMPLETE') p.push('outcomes ' + d.phases.map((x) => x.outcome).join('/') + ' status ' + d.status);
  if (d.phases[1].coverage.total.join('|') !== 'Total|4|3|1|0|87.5') p.push('phase 2 coverage total row ' + d.phases[1].coverage.total.join('|'));
  if (d.bugs.total !== 2 || d.bugs.open !== 1 || d.bugs.resolved !== 1) p.push('bug counts ' + JSON.stringify(d.bugs));
  if (d.phases[0].assumptions !== 1 || d.phases[0].heals !== 1 || d.phases[1].heals !== 0) p.push('assumptions/heals ' + d.phases.map((x) => x.assumptions + '/' + x.heals).join(' '));
  if (!/<b>87\.5%<\/b><span>Static coverage · PASS<\/span>/.test(r.html || '')) p.push('coverage tile or verdict wrong');
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
  const t = tmpCopy((s) => s.replace('| 1 | 2026-09-20 | FAILURES | 2 | 1 | 0 | 1 | 0 | 4 |', '| 1 | 2026-09-20 | GREEN | 3 | 0 | 0 | 1 | 0 | 4 |').replace('- **Outcome:** INCOMPLETE', '- **Outcome:** GREEN'));
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
    ['unknown-enum', (s) => s.replace('**Smoke gate:** passed — fail% 0% — no action needed\n\n### Run plan\n| Group | Mode | Workers | TCs | Reason |\n|---|---|---|---|---|\n| parallel | parallel | 3 | TC-001, TC-007, TC-020 | read-only or independent data |\n| serial:orders | serial | 1 | TC-010 | deletes the shared draft order |\n\n**Decisions:** 2 field · 1 inferred · 0 fail-safe\n\n### Coverage\n| Stage | Total TCs | Fully | Partially | Not | Weighted % |\n|---|---|---|---|---|---|\n| Smoke | 1 | 1 | 0 | 0 | 100 |\n| Positive | 2 | 2 |', '**Smoke gate:** maybe\n\n### Run plan\n| Group | Mode | Workers | TCs | Reason |\n|---|---|---|---|---|\n| parallel | parallel | 3 | TC-001, TC-007, TC-020 | read-only or independent data |\n| serial:orders | serial | 1 | TC-010 | deletes the shared draft order |\n\n**Decisions:** 2 field · 1 inferred · 0 fail-safe\n\n### Coverage\n| Stage | Total TCs | Fully | Partially | Not | Weighted % |\n|---|---|---|---|---|---|\n| Smoke | 1 | 1 | 0 | 0 | 100 |\n| Positive | 2 | 2 |')],
    ['broken-row', (s) => s.replace('| TC-001 | REQ-01 | Create an order with valid data | PASS | parallel | 00:00:39 |', '| TC-001 | REQ-01 | Create an order with valid data | PASS | parallel |')],
    ['phase-duplicate', (s) => s.replace('## Phase 2 — 2026-09-21', '## Phase 1 — 2026-09-21')],
    ['section-missing', (s) => s.replace('## Phase 2 — 2026-09-21\n\n### Run\n', '## Phase 2 — 2026-09-21\n\n### Facts\n')],
    ['section-missing', (s) => s.replace(/### Results\n\| TC-ID \| REQ \| Name \| Status \| Group \| Duration \| Classification \| Evidence \|\n\|---\|---\|---\|---\|---\|---\|---\|---\|\n\| TC-001 \| REQ-01 \| Create an order with valid data \| PASS \| parallel \| 00:00:39 \|[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n/, '')],
    ['header-missing', (s) => s.replace('**Latest results:** 2 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run of 4 TCs\n', '')],
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
  const tpl = read(TEMPLATE_PATH); if (!/<dialog class="viewer"/.test(tpl) || !/data-act="fit"/.test(tpl)) p.push('template lost the viewer dialog');
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
    .replace('**Latest phase:** 2', '**Latest phase:** 3').replace('**Status:** INCOMPLETE', '**Status:** BLOCKED').replace('**Latest results:** 2 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run of 4 TCs', '**Latest results:** —')
    .replace('| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 4 | 00:05:12 | BUG-1, BUG-2 |', '| 2 | 2026-09-21 | INCOMPLETE | 2 | 0 | 1 | 1 | 0 | 4 | 00:05:12 | BUG-1, BUG-2 |\n| 3 | 2026-09-22 | BLOCKED | — | — | — | — | — | — | — | — |')
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
    if (!/<details class="phase" id="phase-3" open>/.test(r.html || '') || /<details class="phase" id="phase-2" open>/.test(r.html || '')) p.push('only the latest phase should be open');
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
  if (thumbs.length !== r.payload.counts.evidenceLinks - 5) p.push('rendered thumbnails ' + thumbs.length + ' vs evidence links ' + r.payload.counts.evidenceLinks + ' (single-attempt attempts are not rendered twice)');
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
  const ids = [...html.matchAll(/<article class="bug-card ([a-z-]+)" id="(BUG-\d+)"/g)].map((m) => m[2] + ':' + m[1]);
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
