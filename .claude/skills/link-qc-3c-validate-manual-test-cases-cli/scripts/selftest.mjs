#!/usr/bin/env node
// MIRROR — byte-identical copies live in the sibling skill folders
// (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli,
// each under scripts/). Edit all three; case 0 checks every sibling that is present.
//
// selftest.mjs — regression harness for render-tc-review.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a test harness, not one of the
// read-only reporting scripts, so the "always exit 0" convention does not apply here. A failing
// self-test means the renderer's pages cannot be trusted: do not deliver a page rendered by it
// until the harness passes again.
//
// Run: node selftest.mjs [--pretty]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { render, renderHtml, parseTcDocument, parseTestData, buildModel, deriveKeys, mergeSkeleton, pageState, selfHash, escapeHtml } from './render-tc-review.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, '..');
const fx = (...p) => path.join(here, 'fixtures', ...p);
const norm = (s) => s.replace(/\r\n?/g, '\n');
const read = (p) => norm(fs.readFileSync(p, 'utf8'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const SAMPLE = fx('sample', 'TEST-CASES-kpi-filter.md');
const SAMPLE_DATA = fx('sample', 'TEST-DATA-kpi-filter.md');
const SAMPLE_STRINGS = fx('sample', 'TC-REVIEW-STRINGS-kpi-filter.ar.json');
const LEGACY = fx('legacy', 'TEST-CASES-legacy-login.md');
const SCRIPT = path.join(here, 'render-tc-review.mjs');

/** Mirrored paths — identical in every mirror skill folder. Keep in step with CLAUDE.md "Mirrored files". */
export const MIRRORED = ['references/learning-file.md', 'references/html-page.md', 'references/validation-states.md', 'references/open-questions.md', 'assets/tc-review.template.html', 'scripts/render-tc-review.mjs', 'scripts/selftest.mjs', 'scripts/fixtures'];
/** The skill folders that carry the mirrored files. `/sync-skills` copies one folder at a time, so any subset may be installed. */
export const MIRROR_SKILLS = ['link-qc-3-generate-manual-test-cases', 'link-qc-3b-validate-manual-test-cases', 'link-qc-3c-validate-manual-test-cases-cli'];

const cases = []; const fail = [];
function check(name, problems, detail) { cases.push({ case: name, ok: problems.length === 0, problems, detail }); if (problems.length) fail.push({ case: name, problems }); }
function tmpCopy(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-render-'));
  const tc = path.join(dir, 'TEST-CASES-kpi-filter.md');
  fs.writeFileSync(tc, mutate(read(SAMPLE)));
  fs.copyFileSync(SAMPLE_DATA, path.join(dir, 'TEST-DATA-kpi-filter.md'));
  return { dir, tc, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const kinds = (r) => r.payload.errors.map((e) => e.kind).sort();
function listFiles(dir) { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } }; if (fs.existsSync(dir)) walk(dir); return out.sort(); }

/* 0 — MIRROR: every mirrored file is byte-identical in every sibling skill folder that is present. No sibling → skipped. */
{
  const name = path.basename(skillDir);
  const siblings = MIRROR_SKILLS.filter((s) => s !== name).map((s) => path.join(skillDir, '..', s)).filter((d) => fs.existsSync(d));
  if (!siblings.length) cases.push({ case: '0 mirror', ok: true, skipped: true, problems: [], detail: 'no sibling skill folder present (' + MIRROR_SKILLS.filter((s) => s !== name).join(', ') + ') — nothing to compare' });
  else {
    const p = [];
    for (const sibling of siblings) {
      const sib = path.basename(sibling);
      for (const rel of MIRRORED) {
        const a = path.join(skillDir, rel); const b = path.join(sibling, rel);
        if (fs.existsSync(a) && fs.statSync(a).isDirectory()) {
          const fa = listFiles(a).map((f) => path.relative(a, f)); const fb = listFiles(b).map((f) => path.relative(b, f));
          if (fa.join('|') !== fb.join('|')) p.push(sib + ': ' + rel + ': file lists differ');
          for (const f of fa) if (fs.existsSync(path.join(b, f)) && sha(fs.readFileSync(path.join(a, f))) !== sha(fs.readFileSync(path.join(b, f)))) p.push(sib + ': ' + rel + '/' + f + ': content differs');
          continue;
        }
        if (!fs.existsSync(a) || !fs.existsSync(b)) { p.push(sib + ': ' + rel + ': missing in ' + (!fs.existsSync(a) ? name : sib)); continue; }
        if (sha(fs.readFileSync(a)) !== sha(fs.readFileSync(b))) p.push(sib + ': ' + rel + ': content differs');
      }
    }
    check('0 mirror', p, { siblings: siblings.map((d) => path.basename(d)), files: MIRRORED.length });
  }
}

/* 1 — golden EN: byte-for-byte. */
{
  const r = render({ tcPath: SAMPLE, root: here });
  const p = [];
  if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' != PASS: ' + r.payload.gateReason);
  if (norm(r.html || '') !== read(fx('golden', 'TC-REVIEW-kpi-filter.en.html'))) p.push('EN page differs from golden');
  if (r.payload.compatibility.length) p.push('new-shape document raised compatibility findings: ' + r.payload.compatibility.map((c) => c.what).join(','));
  check('1 golden EN page', p, { bytes: (r.html || '').length });
}

/* 2 — golden AR: complete translation, byte-for-byte, no untranslated marker. */
{
  const r = render({ tcPath: SAMPLE, lang: 'ar', root: here });
  const p = [];
  if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' != PASS: ' + r.payload.gateReason);
  if (r.payload.arabicComplete !== true) p.push('arabicComplete ' + r.payload.arabicComplete);
  if (norm(r.html || '') !== read(fx('golden', 'TC-REVIEW-kpi-filter.ar.html'))) p.push('AR page differs from golden');
  if (/class="untranslated"/.test(r.html || '')) p.push('a complete translation still renders an untranslated marker');
  if (!/<html lang="ar" dir="rtl">/.test(r.html || '')) p.push('AR page is not lang=ar dir=rtl');
  check('2 golden AR page', p, { keys: r.payload.strings.keys });
}

/* 3 — legacy document renders with compatibility findings and an untouched source. */
{
  const before = fs.readFileSync(LEGACY);
  const r = render({ tcPath: LEGACY, root: here });
  const p = [];
  if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ' != PASS: ' + r.payload.gateReason);
  for (const w of ['summary-anchor-missing', 'summary-stage-missing', 'test-cases-anchor-missing', 'header-generated-missing', 'potential-bugs-missing', 'test-data-missing']) if (!r.payload.compatibility.some((c) => c.what === w)) p.push('missing compatibility finding ' + w);
  if (r.payload.counts.total !== 2) p.push('total ' + r.payload.counts.total + ' != 2');
  if (!/Approved/.test(r.html || '')) p.push('APPROVED document did not render the approved banner');
  if (norm(r.html || '') !== read(fx('golden', 'TC-REVIEW-legacy-login.en.html'))) p.push('legacy page differs from golden');
  if (!before.equals(fs.readFileSync(LEGACY))) p.push('legacy source file was modified by rendering');
  if (!(r.html || '').includes('<b>—</b><span>Test data items')) p.push('missing test-data file did not render — (never 0)');
  check('3 legacy document renders with compatibility findings', p, { compatibility: r.payload.compatibility.map((c) => c.what) });
}

/* 4 — derived numbers come from the tables. */
{
  const r = render({ tcPath: SAMPLE, root: here });
  const c = r.payload.counts; const p = [];
  const exp = { total: 5, smoke: 1, auto: 4, observed: 2, progressPct: 40 };
  for (const [k, v] of Object.entries(exp)) if (c[k] !== v) p.push(k + ' ' + c[k] + ' != ' + v);
  if (JSON.stringify(c.byState) !== JSON.stringify({ validated: 1, enhanced: 0, inferred: 1, discrepancy: 1, 'not-implemented': 1, draft: 1 })) p.push('byState ' + JSON.stringify(c.byState));
  if (c.coverage.weighted !== 66.7 || c.coverage.full !== 1 || c.coverage.partial !== 2) p.push('coverage ' + JSON.stringify([c.coverage.weighted, c.coverage.full, c.coverage.partial]));
  if (c.testData.ready !== 2 || c.testData.unknown !== 1) p.push('testData ' + JSON.stringify(c.testData));
  if (c.bugs.open !== 1 || c.bugs.current !== 1) p.push('bugs ' + JSON.stringify(c.bugs));
  check('4 derived numbers', p, c.byState);
}

/* 5 — header mismatch: computed value rendered, warning strip shown, gate MISMATCH. */
{
  const t = tmpCopy((s) => s.replace('**Total test cases:** 5', '**Total test cases:** 9').replace('**Smoke TCs:** 1', '**Smoke TCs:** 3'));
  const p = []; let fields = [];
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    if (r.payload.gate !== 'MISMATCH') p.push('gate ' + r.payload.gate + ' != MISMATCH');
    fields = r.payload.mismatches.map((m) => m.field).sort();
    if (fields.join(',') !== 'Smoke TCs,Total test cases') p.push('mismatch fields ' + fields.join(','));
    if (!/<b>5<\/b><span>Test cases/.test(r.html || '')) p.push('computed total (5) not rendered');
    if (!/class="warn-strip"/.test(r.html || '')) p.push('warning strip missing');
    if (r.html === null) p.push('MISMATCH must still render the page (with the warning strip)');
  } finally { t.cleanup(); }
  check('5 header mismatch is reported and the computed value wins', p, { fields });
}

/* 6 — FALSE PASS GUARD: orphan TCs are never dropped (summary-only and section-only). */
{
  const t = tmpCopy((s) => s
    .replace('| TC-KPI-04 | happy-path | en | REQ-1234-03 | @positive | NO | NO | creates | KPI export file | not-implemented — pending implementation | Export the filtered grid |\n', '')
    .replace('## Summary\n', '## Summary\n')
    .replace('| TC-KPI-03 | negative |', '| TC-KPI-09 | negative | en | REQ-1234-02 | @negative | NO | YES | read-only | — | draft — not app-validated | Ghost row |\n| TC-KPI-03 | negative |'));
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    const p = [];
    if (r.payload.counts.total !== 6) p.push('total ' + r.payload.counts.total + ' != 6 (5 sections + 1 summary-only row)');
    if (r.payload.counts.orphans !== 2) p.push('orphans ' + r.payload.counts.orphans + ' != 2');
    const ids = r.payload.warnings.filter((w) => w.kind === 'orphan-tc').map((w) => w.id).sort();
    if (ids.join(',') !== 'TC-KPI-04,TC-KPI-09') p.push('orphan ids ' + ids.join(','));
    if (!/id="TC-KPI-09"/.test(r.html || '') || !/id="TC-KPI-04"/.test(r.html || '')) p.push('an orphan TC is missing from the page');
    if (!/badge orphan/.test(r.html || '')) p.push('orphan badge not rendered');
    check('6 orphan TCs are rendered and marked, never dropped', p, { ids });
  } finally { t.cleanup(); }
}

/* 7 — unknown enum values BLOCK (Type, Validation, test-data status). */
{
  const a = tmpCopy((s) => s.replace('- **Type:** edge-case', '- **Type:** positive'));
  const b = tmpCopy((s) => s.replace('- **Validation:** inferred', '- **Validation:** probably fine'));
  const c = tmpCopy((s) => s);
  fs.writeFileSync(path.join(c.dir, 'TEST-DATA-kpi-filter.md'), read(SAMPLE_DATA).replace('| READY | — |\n| D2', '| MAYBE | — |\n| D2'));
  try {
    const p = [];
    const ra = render({ tcPath: a.tc, root: a.dir }); if (ra.payload.gate !== 'BLOCKED' || !kinds(ra).includes('unknown-enum')) p.push('unknown Type not BLOCKED: ' + ra.payload.gate + ' ' + kinds(ra));
    const rb = render({ tcPath: b.tc, root: b.dir }); if (rb.payload.gate !== 'BLOCKED' || !kinds(rb).includes('unknown-enum')) p.push('unknown Validation not BLOCKED: ' + rb.payload.gate);
    const rc = render({ tcPath: c.tc, root: c.dir }); if (rc.payload.gate !== 'BLOCKED' || !kinds(rc).includes('unknown-enum')) p.push('unknown test-data status not BLOCKED: ' + rc.payload.gate);
    if (ra.html !== null) p.push('BLOCKED run still produced HTML');
    check('7 out-of-vocabulary enum values BLOCK', p, {});
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); }
}

/* 8 — a broken table row BLOCKs; a missing frozen field BLOCKs; a stale-state TC is counted as draft and marked. */
{
  const a = tmpCopy((s) => s.replace('| TC-KPI-02 | edge-case | en | REQ-1234-02 |', '| TC-KPI-02 | edge-case | en |'));
  const b = tmpCopy((s) => s.replace('- **Expected Result:** The grid shows all 36 rows across 2024-2026.\n', ''));
  const c = tmpCopy((s) => s.replace('- **Validation:** draft — not app-validated\n', '- **Validation:** draft — not app-validated (stale — content changed)\n').replace('| draft — not app-validated | Apply', '| draft — not app-validated (stale — content changed) | Apply'));
  try {
    const p = [];
    const ra = render({ tcPath: a.tc, root: a.dir }); if (ra.payload.gate !== 'BLOCKED' || !kinds(ra).includes('broken-row')) p.push('broken row not BLOCKED: ' + ra.payload.gate + ' ' + kinds(ra));
    const rb = render({ tcPath: b.tc, root: b.dir }); if (rb.payload.gate !== 'BLOCKED' || !kinds(rb).includes('frozen-field-missing')) p.push('missing frozen field not BLOCKED: ' + rb.payload.gate + ' ' + kinds(rb));
    const rc = render({ tcPath: c.tc, root: c.dir });
    if (rc.payload.gate !== 'PASS') p.push('stale state should still render: ' + rc.payload.gate + ' ' + rc.payload.gateReason);
    if (rc.payload.counts.stale !== 1 || rc.payload.counts.byState.draft !== 1) p.push('stale TC not counted as draft+stale: ' + JSON.stringify(rc.payload.counts.byState) + ' stale=' + rc.payload.counts.stale);
    if (!/badge stale/.test(rc.html || '') || !/caption stale/.test(rc.html || '')) p.push('stale badge/caption not rendered');
    check('8 broken row / missing frozen field BLOCK; stale state renders as draft + stale', p, {});
  } finally { a.cleanup(); b.cleanup(); c.cleanup(); }
}

/* 9 — zero ACs: gauge renders —, never 0%. */
{
  const t = tmpCopy((s) => s.replace(/## Requirement Coverage Score[\s\S]*?(?=## Manual-Only)/, '').replace(/## Traceability Matrix[\s\S]*?(?=## Negative Coverage)/, ''));
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    const p = [];
    if (r.payload.gate === 'BLOCKED') p.push('missing coverage table must not block: ' + r.payload.gateReason);
    if (!/<b>—<\/b><span>Requirement coverage/.test(r.html || '')) p.push('gauge did not render —');
    if (/<b>0%<\/b>/.test(r.html || '')) p.push('an invented 0% appeared');
    if (!r.payload.compatibility.some((c) => c.what === 'coverage-table-missing')) p.push('coverage-table-missing not reported');
    check('9 zero ACs render — not 0%', p, {});
  } finally { t.cleanup(); }
}

/* 10 — Arabic: stale + missing strings → preview, marker, MISMATCH; no strings file → preview. */
{
  const t = tmpCopy((s) => s);
  try {
    const strings = JSON.parse(read(SAMPLE_STRINGS));
    strings.keys['tc.TC-KPI-01.step.1'].stale = true;
    delete strings.keys['tc.TC-KPI-02.expected'];
    fs.writeFileSync(path.join(t.dir, 'TC-REVIEW-STRINGS-kpi-filter.ar.json'), JSON.stringify(strings));
    const r = render({ tcPath: t.tc, lang: 'ar', root: t.dir });
    const p = [];
    if (r.payload.gate !== 'MISMATCH') p.push('gate ' + r.payload.gate + ' != MISMATCH');
    if (r.payload.arabicComplete !== false) p.push('arabicComplete ' + r.payload.arabicComplete);
    const miss = r.payload.strings.missing.slice().sort();
    if (miss.join(',') !== 'tc.TC-KPI-01.step.1,tc.TC-KPI-02.expected') p.push('missing keys ' + miss.join(','));
    if (!/class="preview-banner"/.test(r.html || '')) p.push('preview banner missing');
    if ((r.html || '').match(/class="untranslated"/g)?.length !== 2) p.push('untranslated markers != 2');
    if (!/<span class="untranslated">Open Strategies/.test(r.html || '')) p.push('stale key did not fall back to English with a marker');
    fs.rmSync(path.join(t.dir, 'TC-REVIEW-STRINGS-kpi-filter.ar.json'));
    const r2 = render({ tcPath: t.tc, lang: 'ar', root: t.dir });
    if (r2.payload.arabicComplete !== false || !r2.payload.warnings.some((w) => w.kind === 'strings-file-missing')) p.push('missing strings file did not produce a preview with a warning');
    if (r2.payload.strings.missing.length !== r2.payload.strings.keys) p.push('with no strings file every key must be missing');
    check('10 incomplete Arabic is a marked preview, never a deliverable', p, { missing: miss });
  } finally { t.cleanup(); }
}

/* 11 — --write-skeleton merges: unchanged kept, new null, changed stale with old ar, removed orphan; nothing reset. */
{
  const prev = JSON.parse(read(SAMPLE_STRINGS));
  const keys = { ...deriveKeys(buildModel(parseTcDocument(read(SAMPLE)), parseTestData(read(SAMPLE_DATA)), { feature: 'kpi-filter' })) };
  keys['tc.TC-KPI-01.step.1'] = 'Open Strategies — the Strategies list is visible and sorted.'; // changed English
  keys['tc.TC-KPI-09.step.1'] = 'Brand new step.'; // new key
  delete keys['tc.TC-KPI-03.step.2']; // removed key
  const { sidecar, report } = mergeSkeleton(prev, keys, 'kpi-filter');
  const p = [];
  const k1 = sidecar.keys['tc.TC-KPI-01.step.1'];
  if (!k1 || !k1.stale || k1.ar !== prev.keys['tc.TC-KPI-01.step.1'].ar || k1.en_previous !== prev.keys['tc.TC-KPI-01.step.1'].en) p.push('changed key not marked stale with the old ar + previous en kept: ' + JSON.stringify(k1));
  if (sidecar.keys['tc.TC-KPI-09.step.1']?.ar !== null) p.push('new key not added with ar: null');
  if (!sidecar.keys['tc.TC-KPI-03.step.2']?.orphan || sidecar.keys['tc.TC-KPI-03.step.2'].ar !== prev.keys['tc.TC-KPI-03.step.2'].ar) p.push('removed key was deleted or lost its translation instead of being marked orphan');
  if (sidecar.keys['tc.TC-KPI-02.expected'].ar !== prev.keys['tc.TC-KPI-02.expected'].ar || sidecar.keys['tc.TC-KPI-02.expected'].stale) p.push('unchanged translation was not kept intact');
  if (report.kept.length !== Object.keys(prev.keys).length - 2) p.push('kept ' + report.kept.length + ' != ' + (Object.keys(prev.keys).length - 2));
  if (report.added.length !== 1 || report.stale.length !== 1 || report.orphans.length !== 1) p.push('report ' + JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length]))));
  check('11 skeleton merge never resets a translation', p, Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])));
}

/* 12 — potential bugs: resolved is not current; not-checked keeps its id and status; unknown TC reference warns. */
{
  const t = tmpCopy((s) => s.replace('## Open Questions', `### PB-2 — Old bug that was fixed
- **Test case:** TC-KPI-01
- **Steps to reproduce:** 1. Open the grid. 2. Apply.
- **Expected result:** Grid loads.
- **Actual result:** Grid loaded twice.
<!-- pb-meta: first-seen: 2026-09-01; last-checked: 2026-09-25; status: resolved 2026-09-25 -->

### PB-3 — Not retested this run
- **Test case:** TC-KPI-77
- **Steps to reproduce:** 1. Anything.
- **Expected result:** Something.
- **Actual result:** Something else.
<!-- pb-meta: first-seen: 2026-09-01; last-checked: 2026-09-10; status: not-checked-this-run -->

## Open Questions`));
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    const b = r.payload.counts.bugs; const p = [];
    if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ': ' + r.payload.gateReason);
    if (b.open !== 1 || b.notChecked !== 1 || b.resolved !== 1 || b.current !== 2) p.push('bug counts ' + JSON.stringify(b));
    if (!/pb-card resolved/.test(r.html || '') || !/pb-card not-checked/.test(r.html || '')) p.push('PB status classes not rendered');
    if (!/not checked in this run/.test(r.html || '')) p.push('not-checked status word missing');
    if (!r.payload.warnings.some((w) => w.kind === 'pb-unknown-tc' && w.id === 'PB-3')) p.push('PB pointing at an unknown TC did not warn');
    if (!/<b>1\/1\/1<\/b><span>Potential bugs/.test(r.html || '')) p.push('bugs tile != 1/1/1');
    check('12 potential-bug statuses round-trip; resolved is not current', p, b);
  } finally { t.cleanup(); }
}

/* 13 — evidence stamps render; a TC without one has no evidence line. */
{
  const r = render({ tcPath: SAMPLE, root: here });
  const p = [];
  const card = (id) => ((r.html || '').match(new RegExp('<details class="tc" id="' + id + '">[\\s\\S]*?</details>')) || [''])[0];
  if (!/class="evidence".*staging.*4\.12\.0.*full-tail/.test(card('TC-KPI-01'))) p.push('TC-KPI-01 evidence line missing or incomplete');
  if (/class="evidence"/.test(card('TC-KPI-03'))) p.push('TC-KPI-03 (never validated) shows an evidence line');
  if (!/validated by 3b on <span class="ltr">2026-09-25<\/span> · scope <span class="ltr">full<\/span>/.test(r.html || '')) p.push('header stamp not rendered');
  check('13 evidence stamps render only where present', p, {});
}

/* 14 — secret screen: a password-shaped literal BLOCKs. */
{
  const t = tmpCopy((s) => s.replace('2. Click Apply.', '2. Type password: Sup3rSecret! and click Apply.'));
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    const p = [];
    if (r.payload.gate !== 'BLOCKED' || !kinds(r).includes('secret-literal')) p.push('secret literal not BLOCKED: ' + r.payload.gate + ' ' + kinds(r));
    if (r.html !== null) p.push('HTML produced despite a secret');
    check('14 password-shaped literal BLOCKs', p, {});
  } finally { t.cleanup(); }
}

/* 15 — escaping: markup in content is rendered inert. */
{
  const t = tmpCopy((s) => s.replace('2. Click Apply.', '2. Click <b>Apply</b> & watch <script>alert(1)</script>.'));
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    const p = [];
    if (/<script>alert/.test(r.html || '')) p.push('script tag survived unescaped');
    if (!/&lt;b&gt;Apply&lt;\/b&gt; &amp; watch/.test(r.html || '')) p.push('content was not escaped as expected');
    if (escapeHtml('<"\'&>') !== '&lt;&quot;&#39;&amp;&gt;') p.push('escapeHtml wrong');
    check('15 content is HTML-escaped', p, {});
  } finally { t.cleanup(); }
}

/* 16 — dry run writes nothing; --write writes exactly the page; hand-edited page refused without --force. */
{
  const t = tmpCopy((s) => s);
  try {
    const call = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: t.dir });
    const p = [];
    const before = listFiles(t.dir);
    const dry = call(['--tc', t.tc]);
    if (dry.status !== 0) p.push('dry run exit ' + dry.status);
    let payload; try { payload = JSON.parse(dry.stdout); } catch { p.push('stdout is not a single JSON object'); }
    if (payload && payload.readOnly !== true) p.push('dry run not marked readOnly');
    if (listFiles(t.dir).join('|') !== before.join('|')) p.push('dry run wrote a file');
    if (/<!DOCTYPE html>/.test(dry.stdout)) p.push('dry run printed the HTML');
    const w = call(['--tc', t.tc, '--write']);
    const out = path.join(t.dir, 'TC-REVIEW-kpi-filter.html');
    if (!fs.existsSync(out)) p.push('--write did not create the page');
    const wp = JSON.parse(w.stdout); if (wp.readOnly !== false || !wp.writes.some((x) => x.kind === 'html')) p.push('--write payload does not record the write');
    const html = read(out); const st = pageState(html);
    if (!st.provenance || st.handEdited) p.push('freshly written page fails its own provenance check');
    const w2 = JSON.parse(call(['--tc', t.tc, '--write']).stdout);
    if (w2.gate !== 'PASS' || w2.writes.length !== 1) p.push('re-render of an untouched page was refused');
    fs.writeFileSync(out, html.replace('Reviewer notes:', 'Reviewer notes: looks good'));
    const w3 = JSON.parse(call(['--tc', t.tc, '--write']).stdout);
    if (w3.gate !== 'BLOCKED' || !w3.refused || w3.refused.reason !== 'hand-edited') p.push('hand-edited page was not refused: ' + w3.gate);
    if (!read(out).includes('looks good')) p.push('refused write still overwrote the page');
    const w4 = JSON.parse(call(['--tc', t.tc, '--write', '--force']).stdout);
    if (w4.gate !== 'PASS' || read(out).includes('looks good')) p.push('--force did not overwrite the hand-edited page');
    fs.writeFileSync(out, '<!DOCTYPE html>\n<html><body>old hand-written page</body></html>\n');
    const w5 = JSON.parse(call(['--tc', t.tc, '--write']).stdout);
    if (w5.gate !== 'PASS' || !w5.warnings.some((x) => x.kind === 'legacy-page-replaced')) p.push('legacy page without provenance was not replaced with a warning');
    check('16 dry-run writes nothing; hand-edited page refused without --force', p, {});
  } finally { t.cleanup(); }
}

/* 17 — --strict exit codes: PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3; default always 0. */
{
  const a = tmpCopy((s) => s.replace('**Total test cases:** 5', '**Total test cases:** 8'));
  const b = tmpCopy((s) => s.replace('- **Type:** edge-case', '- **Type:** positive'));
  try {
    const call = (args, cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd });
    const p = [];
    const pass = call(['--tc', SAMPLE, '--strict'], here); if (pass.status !== 0) p.push('PASS exit ' + pass.status);
    const mm = call(['--tc', a.tc, '--strict'], a.dir); if (mm.status !== 1) p.push('MISMATCH exit ' + mm.status);
    const bl = call(['--tc', b.tc, '--strict'], b.dir); if (bl.status !== 2) p.push('BLOCKED exit ' + bl.status);
    const nr = call(['--strict'], here); if (nr.status !== 3) p.push('NOT_RUN exit ' + nr.status);
    const nrPlain = call(['--tc', 'does-not-exist.md'], here); if (nrPlain.status !== 0) p.push('default exit for a missing file ' + nrPlain.status + ' != 0');
    const blPlain = call(['--tc', b.tc], b.dir); if (blPlain.status !== 0) p.push('default exit for BLOCKED ' + blPlain.status + ' != 0');
    check('17 strict exit codes', p, {});
  } finally { a.cleanup(); b.cleanup(); }
}

/* 18 — template round trip: a placeholder the model cannot fill BLOCKs; block markers must balance. */
{
  const model = buildModel(parseTcDocument(read(SAMPLE)), null, { feature: 'kpi-filter' });
  const p = [];
  const r1 = renderHtml(model, { template: '<p>{{feature}} {{no_such_key}}</p>' });
  if (r1.leftovers.join() !== '{{no_such_key}}') p.push('unknown placeholder not reported as leftover: ' + r1.leftovers.join());
  if (!/kpi-filter/.test(r1.html)) p.push('known placeholder not filled');
  let threw = false; try { renderHtml(model, { template: '<!-- {{#each tcs}} -->x' }); } catch { threw = true; }
  if (!threw) p.push('unclosed block did not throw');
  const t = tmpCopy((s) => s);
  try {
    const tplDir = path.join(t.dir, 'assets'); fs.mkdirSync(tplDir);
    const r2 = render({ tcPath: t.tc, root: t.dir, template: '<!DOCTYPE html>\n<p>{{feature}} {{no_such_key}}</p>' });
    if (r2.payload.gate !== 'BLOCKED' || !kinds(r2).includes('placeholder-left')) p.push('leftover placeholder did not BLOCK the pipeline: ' + r2.payload.gate);
  } finally { t.cleanup(); }
  check('18 template placeholders round-trip; leftovers BLOCK', p, {});
}

/* 19 — determinism + self-hash: same inputs → same bytes; the provenance self-hash verifies. */
{
  const a = render({ tcPath: SAMPLE, root: here }).html; const b = render({ tcPath: SAMPLE, root: here }).html;
  const p = [];
  if (a !== b) p.push('two renders of the same inputs differ');
  if (!/^<!DOCTYPE html>\n<!-- render-tc-review v/.test(a)) p.push('provenance comment is not line 2');
  const m = a.match(/page=([0-9a-f]{64})/); if (!m || selfHash(a) !== m[1]) p.push('self-hash does not verify');
  if (/generatedOn|\d{4}-\d{2}-\d{2}T\d{2}:/.test(a)) p.push('a timestamp leaked into the page');
  check('19 deterministic output with a verifiable self-hash', p, {});
}

/* 20 — run metadata: a 3c header stamp with ", tool cli", the tool / outcome-check stamp keys and the pb-meta screenshot key are parsed, never rendered; a 3b stamp without them parses as before. */
{
  const t = tmpCopy((s) => s
    .replace('— by 3b on 2026-09-25, env staging, scope full', '— by 3c on 2026-09-25, env staging, scope full, re-run 1, tool cli')
    .replace('scope: full-tail\n', 'scope: full-tail\ntool: cli\noutcome-check: banner "36 rows" seen after Apply\n')
    .replace('build: 4.12.0; status: open -->', 'build: 4.12.0; status: open; screenshot: evidence/PB-1-2026-09-25.png -->'));
  try {
    const r = render({ tcPath: t.tc, root: t.dir });
    const st = r.payload.document.stamp; const p = [];
    if (r.payload.gate !== 'PASS') p.push('gate ' + r.payload.gate + ': ' + r.payload.gateReason);
    if (!st || st.by !== '3c' || st.tool !== 'cli' || st.rerun !== 1 || st.scope !== 'full' || st.env !== 'staging') p.push('3c stamp not parsed: ' + JSON.stringify(st));
    if (!/validated by 3c on <span class="ltr">2026-09-25<\/span>/.test(r.html || '')) p.push('3c header stamp not rendered with the 3c chrome string');
    const ev = r.payload.document.evidence.find((e) => e.id === 'TC-KPI-01');
    if (!ev || ev.tool !== 'cli' || !/36 rows/.test(ev.outcomeCheck || '')) p.push('tool / outcome-check stamp keys not surfaced: ' + JSON.stringify(ev));
    const other = r.payload.document.evidence.find((e) => e.id === 'TC-KPI-01b');
    if (!other || other.tool !== null) p.push('a stamp without a tool key must surface tool: null (read as 3b): ' + JSON.stringify(other));
    const pb = r.payload.document.potentialBugs.find((b) => b.id === 'PB-1');
    if (!pb || pb.screenshot !== 'evidence/PB-1-2026-09-25.png') p.push('pb-meta screenshot key not surfaced: ' + JSON.stringify(pb));
    if (/outcome-check|seen after Apply|evidence\/PB-1|tool cli/.test(r.html || '')) p.push('run metadata leaked into the page');
    const base = render({ tcPath: SAMPLE, root: here }).payload.document.stamp;
    if (!base || base.by !== '3b' || base.tool !== '' || base.rerun !== 0 || base.scope !== 'full') p.push('3b stamp without tool no longer parses as before: ' + JSON.stringify(base));
    check('20 run metadata is parsed, surfaced in the payload and never rendered', p, { stamp: st });
  } finally { t.cleanup(); }
}

const out = {
  tool: 'selftest-render-tc-review',
  skill: path.basename(skillDir),
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'The renderer disagrees with its own fixtures. Do not deliver a page it renders until this passes; if case 0 failed, the mirror skill folders have drifted — copy the mirrored files so every present sibling is identical.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
