#!/usr/bin/env node
// MIRROR — byte-identical copies live in the sibling skill folders
// (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli,
// each under scripts/). Edit all three; selftest.mjs case 0 sha256-compares every mirrored file.
//
// render-tc-review.mjs — deterministic renderer for the human review page.
//   TEST-CASES-{feature}.md (+ TEST-DATA-{feature}.md, + TC-REVIEW-STRINGS-{feature}.ar.json)
//   (+ REVIEW-COMMENTS-{feature}.md, the reviewer's comments saved from the page)
//   → TC-REVIEW-{feature}.html, from assets/tc-review.template.html (the body partial) inside
//   assets/report-shell.template.html (the one general report page, shared with skill 5).
//
// Node >= 18, ESM, zero dependencies. DEFAULT MODE IS DRY-RUN: parse, compute, validate, print
// the JSON payload, write nothing. Writing happens only behind --write / --write-skeleton, and
// the rendered HTML is never printed to stdout (printing it would cost the tokens this script
// exists to save). The markdown sources are read-only in every mode.
//
// Two standing rules:
//   1. never silently drop a TC — the page renders the union of summary rows and `###` sections
//      and marks orphans;
//   2. never invent a number — a value the document cannot supply renders `—`, never `0`.
// Every number on the page is recomputed from the tables; a header line that disagrees is
// reported in mismatches[] and the computed value is rendered.
//
// Usage:
//   node render-tc-review.mjs --tc <TEST-CASES-{feature}.md> [--data <TEST-DATA-{feature}.md>]
//        [--out <path>] [--lang en|ar] [--strings <path>] [--comments <path>] [--write] [--write-skeleton]
//        [--emit-keys] [--force] [--strict] [--pretty]
// Exit: 0 always, unless --strict: PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = '1.1';
export const TOOL = 'render-tc-review';

// ---- copied verbatim from link-qc-1-generate-update-testing-structure/scripts/lib.mjs — must stay behaviourally identical ----
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[k] = next; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
export function print(obj, args) {
  process.stdout.write(JSON.stringify(obj, null, args.pretty ? 2 : 0) + '\n');
}
// ---- end verbatim copy ----

export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
const DASH = '—';

/* ============================================================================================
 * Vocabulary — frozen. Skills 4 and 5 parse the same words.
 * ========================================================================================== */
export const VALIDATION_STATES = ['validated', 'enhanced', 'inferred', 'discrepancy', 'not-implemented', 'draft'];
export const OBSERVED_STATES = ['validated', 'enhanced', 'discrepancy'];
export const TC_TYPES = ['happy-path', 'edge-case', 'negative'];
export const DATA_STATUSES = ['READY', 'MISSING', 'IMPOSSIBLE', 'UNKNOWN'];
export const ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9.]+)+$/;

export const LIMITS = [
  'Text screen, not a judge: the renderer checks shape and vocabulary. It does not judge whether a step is testable or a coverage row is right.',
  'A password-shaped literal ("password: x", "token = y") in a step BLOCKs; a secret written any other way is not detected.',
  'Configuration literals are matched against TEST-DATA only: an Environment row value or host, or an Accounts row username, found in a TC text (outside quotes) is a data-literal WARNING (never a block). A configuration value TEST-DATA does not list is not detected; a duplicated dataset is left to self-review; a typed test input or an exact expected output is never flagged; a line ending "(intentional input)" is skipped.',
  'A [E{n}] / [A{n}] / [D{n}] token with no TEST-DATA row is a data-ref-unresolved WARNING; without a TEST-DATA file the tokens are not checked.',
  'Narrative language is a per-TC script ratio (Arabic letters over Arabic + Latin letters, outside quoted strings) on an English page; quoted application labels never count. It reports narrative-not-english as a WARNING and cannot judge translation quality.',
  'A [HUMAN] step is counted and badged; whether the step really needs a person is the designer\'s call (tc-design.md), not the renderer\'s.',
  'Legacy documents (missing Scope / Generated / Stage / App validation progress / frozen anchors / Potential Bugs / evidence stamps) render with compatibility[] findings. Only a renamed or missing frozen field inside a TC blocks.',
  'An Arabic page with any missing or stale key is a PREVIEW (arabicComplete: false, gate MISMATCH) — never the finished Arabic deliverable.',
  'A page without a provenance comment (hand-written by an older skill run) is overwritten with a warning; a page whose self-hash no longer matches its provenance was edited by hand and is refused without --force.',
  'Rendering is deterministic: same inputs → same bytes. Nothing in the page depends on the clock.',
  'Run metadata is parsed, never rendered: the evidence-stamp keys tool / outcome-check, the pb-meta key screenshot and the header stamp tail ", tool cli" reach the payload (document.stamp, document.potentialBugs) only.',
  'Reviewer comments come from REVIEW-COMMENTS-{feature}.md beside the source (or --comments): each `## {item-id}` entry is attached to the TC / PB / Q card with that id, "General" to the general box; an id not on the page is listed, never dropped (comment-unknown-id). The file is the reviewer\'s: the renderer only reads it. Comment text is never translated, never a sidecar key and never counted as narrative. Typing in the page never changes the page file, so its self-hash stays valid.',
];

/* ============================================================================================
 * Fixed chrome strings — both languages ship inside the script.
 * ========================================================================================== */
export const CHROME = {
  en: {
    eyebrow: 'Manual test cases · human review', l_status: 'Status', l_generated: 'Generated', l_language: 'Language', l_entry: 'Entry case',
    l_reqids: 'REQ-IDs', l_source: 'Source of truth', l_source_note: '(English)', l_validation: 'Validation', l_impl: 'Implementation status',
    lang_en: 'English', lang_ar: 'Arabic',
    banner_pending_title: 'Pending human review', banner_pending_text: 'Adjust Automation Candidate / Smoke / Data effect / Shared data in the markdown, then set Status: APPROVED. Approval unlocks skill 4 (publish to Azure DevOps) and skill 5 (automation) independently; live validation (skill 3b) is optional.',
    banner_approved_title: 'Approved', banner_approved_text: 'This document is human-approved. Changing it creates a new source revision.',
    banner_impl_title: 'Implementation status', warn_strip: 'Header counts in the markdown disagree with the tables below — the page shows the values computed from the tables. Fix the header lines.',
    preview_banner: 'PREVIEW — Arabic translation incomplete. Untranslated strings are shown in English and marked. This page is not the Arabic deliverable until every string is translated.',
    t_tcs: 'Test cases', t_types: 'Happy / edge / negative', t_locale: 'Per locale', t_smoke: 'Smoke', t_auto: 'Automation candidates',
    t_validation: 'Validated / enhanced / inferred / discrepancy / not-impl / draft', t_data: 'Test data items · ready / missing / impossible / unknown',
    t_progress: 'App validation progress · observed live', t_bugs: 'Potential bugs · open / not checked / resolved',
    gauge_label: 'Requirement coverage', gauge_caption: 'Requirement coverage is computed from the acceptance criteria and the designed test cases. It is independent of live validation.',
    chip_full: 'Fully covered', chip_partial: 'Partially covered', chip_none: 'Not covered',
    s_depth: 'Coverage depth per acceptance criterion', s_depth_note: 'segment widths = share of that AC\'s checks present',
    seg_happy: 'happy', seg_neg: 'negative', seg_loc: 'locales', seg_missing: 'missing',
    s_trace: 'Traceability matrix', s_trace_note: 'gaps highlighted', h_ac: 'Acceptance criterion', h_req: 'REQ-ID', h_tcs: 'Test cases', h_status: 'Status', h_missing: 'Missing',
    s_manual: 'What stays manual', h_category: 'Category', h_tcid: 'TC-ID', h_scenario: 'Scenario', h_why_manual: 'Why manual', h_priority: 'Priority',
    s_data: 'Test data', s_data_note: 'details in', h_num: '#', h_item: 'Data item', h_look: 'Must look like', h_used: 'Used by TCs', h_way: 'Best way to get it',
    h_problem: 'Problem', h_why: 'Why', h_decision: 'What the QC / PO must decide',
    s_existing: 'Existing-TC analysis', h_original: 'Original TC', h_disposition: 'Disposition', h_reason: 'Reason',
    s_selfreview: 'Self-review tables', s_negative: 'Negative coverage', s_standards: 'Standards alignment',
    s_tcs: 'Test cases', s_tcs_note: 'tile numbers above match these cards', b_smoke: 'Smoke', b_auto_yes: 'Auto: yes', b_auto_no: 'Auto: no', b_orphan: 'orphan', b_stale: 'stale', b_human: 'human step',
    t_human: 'Human steps · TCs with a step a person must perform or observe', cap_human: 'human step — a step marked [HUMAN] must be performed or observed by a person; no tool validates it and the automated part alone never counts as a full pass',
    tc_requirement: 'Requirement', tc_pre: 'Preconditions', tc_steps: 'Steps', tc_expected: 'Expected result', tc_oracle: 'Data oracle', tc_run: 'Run behaviour', tc_infer: 'let automation infer', tc_tags: 'Tags',
    tc_evidence: 'Evidence', ev_on: 'seen on', ev_env: 'environment', ev_build: 'build', ev_scope: 'scope',
    cap_inferred: 'inferred — confirmed from prior knowledge, not directly observed: review with extra care', cap_discrepancy: 'discrepancy — the application contradicts the requirement; see Potential bugs',
    cap_notimpl: 'Pending implementation — requirement-based; the feature is not built yet. Not a defect.', cap_draft: 'not app-validated — designed from the requirement; not yet seen in the application', cap_stale: 'stale — earlier validation evidence no longer applies; re-validation queued',
    cap_orphan_summary: 'Listed in the summary table but has no detail section — fix the markdown.', cap_orphan_section: 'Has a detail section but no summary row — fix the markdown.',
    s_log: 'Enhancement log', s_log_note: 'what the live app changed (empty until skill 3b runs)', h_validation: 'Validation', h_changed: 'What changed', h_observed: 'Why (what the app showed)', h_run: 'Run',
    s_bugs: 'Potential bugs', s_bugs_note: 'observed behaviour that contradicts the requirement', pb_tc: 'Test case', pb_steps: 'Steps to reproduce', pb_expected: 'Expected result', pb_actual: 'Actual result',
    pb_open: 'open', pb_resolved: 'resolved', pb_notchecked: 'not checked in this run', pb_first: 'first seen', pb_last: 'last checked',
    s_questions: 'Open questions', s_questions_note: 'nothing below was acted on without an answer', q_tcs: 'Affected TCs', q_gap: 'Gap', q_why: 'Why it matters', q_evidence: 'Evidence', q_recommended: 'Recommended', q_alternatives: 'Alternatives', q_pending: 'Pending until answered', q_status: 'Status',
    s_findings: 'Open findings for the human reviewer', s_findings_note: 'never collapsed',
    f_gaps: 'Requirement / coverage gaps', f_defects: 'Application defects (discrepancies)', f_pending: 'Pending implementation', f_env: 'Environment blockers', f_unclear: 'Unclear requirements',
    footer_1: 'Source of truth:', footer_1b: '(always English) — this page is generated from it by the renderer script and adds nothing; when the page is Arabic it is a faithful translation.',
    footer_2: 'Test data:', footer_2b: '— what each TC needs, whether it exists, and how to create what is missing.',
    footer_3: 'To approve: adjust Automation Candidate / Smoke / Data effect / Shared data in the markdown, then set', footer_3b: 'Approval unlocks', footer_3c: 'and', footer_3d: 'independently (publishing is optional).',
    footer_4: 'To request changes, reply with corrections by TC-ID and re-run', footer_4b: 'To validate the test cases live, run the optional', footer_4c: '(needs Playwright MCP, the app URL and credentials).',
    val_none: 'not app-validated — optional: run link-qc-3b-validate-manual-test-cases', val_by: 'validated by 3b on', val_by_cli: 'validated by 3c on', val_scope: 'scope',
    none: 'none', na: DASH,
  },
  ar: {
    eyebrow: 'حالات الاختبار اليدوية · مراجعة بشرية', l_status: 'الحالة', l_generated: 'تاريخ الإنشاء', l_language: 'اللغة', l_entry: 'نقطة البدء',
    l_reqids: 'معرّفات المتطلبات', l_source: 'المصدر المعتمد', l_source_note: '(بالإنجليزية)', l_validation: 'التحقق', l_impl: 'حالة التنفيذ',
    lang_en: 'الإنجليزية', lang_ar: 'العربية',
    banner_pending_title: 'بانتظار المراجعة البشرية', banner_pending_text: 'عدّل حقول Automation Candidate / Smoke / Data effect / Shared data في ملف الماركداون ثم اضبط Status: APPROVED. الاعتماد يفتح المهارة 5 (النشر إلى Azure DevOps) والمهارة 6 (الأتمتة) كلًّا على حدة؛ التحقق الحي (المهارة 3b) اختياري.',
    banner_approved_title: 'معتمد', banner_approved_text: 'هذه الوثيقة معتمدة بشريًا. أي تغيير عليها ينشئ نسخة مصدر جديدة.',
    banner_impl_title: 'حالة التنفيذ', warn_strip: 'أرقام الترويسة في ملف الماركداون لا تطابق الجداول أدناه — الصفحة تعرض القيم المحسوبة من الجداول. صحّح أسطر الترويسة.',
    preview_banner: 'معاينة — الترجمة العربية غير مكتملة. النصوص غير المترجمة تظهر بالإنجليزية ومعلَّمة. هذه الصفحة ليست النسخة العربية النهائية حتى تُترجم كل النصوص.',
    t_tcs: 'حالات الاختبار', t_types: 'المسار السعيد / الحدّي / السلبي', t_locale: 'لكل لغة', t_smoke: 'اختبارات الدخان', t_auto: 'مرشّحة للأتمتة',
    t_validation: 'متحقَّق / محسَّن / مستنتَج / تعارض / غير منفَّذ / مسودة', t_data: 'عناصر بيانات الاختبار · جاهزة / مفقودة / مستحيلة / غير معروفة',
    t_progress: 'تقدّم التحقق من التطبيق · شوهد حيًا', t_bugs: 'أخطاء محتملة · مفتوحة / لم تُفحص / محلولة',
    gauge_label: 'تغطية المتطلبات', gauge_caption: 'تغطية المتطلبات محسوبة من معايير القبول وحالات الاختبار المصمَّمة. وهي مستقلة عن التحقق الحي.',
    chip_full: 'مغطّى بالكامل', chip_partial: 'مغطّى جزئيًا', chip_none: 'غير مغطّى',
    s_depth: 'عمق التغطية لكل معيار قبول', s_depth_note: 'عرض كل جزء = نسبة الفحوص المتوفرة لهذا المعيار',
    seg_happy: 'سعيد', seg_neg: 'سلبي', seg_loc: 'لغات', seg_missing: 'مفقود',
    s_trace: 'مصفوفة التتبّع', s_trace_note: 'الفجوات مظلّلة', h_ac: 'معيار القبول', h_req: 'معرّف المتطلب', h_tcs: 'حالات الاختبار', h_status: 'الحالة', h_missing: 'المفقود',
    s_manual: 'ما يبقى يدويًا', h_category: 'الفئة', h_tcid: 'معرّف الحالة', h_scenario: 'السيناريو', h_why_manual: 'لماذا يدوي', h_priority: 'الأولوية',
    s_data: 'بيانات الاختبار', s_data_note: 'التفاصيل في', h_num: '#', h_item: 'عنصر البيانات', h_look: 'يجب أن يبدو كـ', h_used: 'تستخدمه الحالات', h_way: 'أفضل طريقة للحصول عليه',
    h_problem: 'المشكلة', h_why: 'السبب', h_decision: 'ما يجب أن يقرره QC / PO',
    s_existing: 'تحليل الحالات الموجودة', h_original: 'الحالة الأصلية', h_disposition: 'القرار', h_reason: 'السبب',
    s_selfreview: 'جداول المراجعة الذاتية', s_negative: 'التغطية السلبية', s_standards: 'المواءمة مع المعايير',
    s_tcs: 'حالات الاختبار', s_tcs_note: 'أرقام البلاطات أعلاه تطابق هذه البطاقات', b_smoke: 'دخان', b_auto_yes: 'أتمتة: نعم', b_auto_no: 'أتمتة: لا', b_orphan: 'يتيم', b_stale: 'قديم', b_human: 'خطوة بشرية',
    t_human: 'خطوات بشرية · حالات فيها خطوة يجب أن ينفذها أو يلاحظها شخص', cap_human: 'خطوة بشرية — الخطوة المعلَّمة [HUMAN] يجب أن ينفذها أو يلاحظها شخص؛ لا تتحقق منها أي أداة، والجزء المؤتمت وحده لا يُعدّ نجاحًا كاملًا',
    tc_requirement: 'المتطلب', tc_pre: 'الشروط المسبقة', tc_steps: 'الخطوات', tc_expected: 'النتيجة المتوقعة', tc_oracle: 'مرجع البيانات', tc_run: 'سلوك التشغيل', tc_infer: 'تُستنتج بواسطة الأتمتة', tc_tags: 'الوسوم',
    tc_evidence: 'الدليل', ev_on: 'شوهد في', ev_env: 'البيئة', ev_build: 'الإصدار', ev_scope: 'النطاق',
    cap_inferred: 'مستنتَج — أُكِّد من معرفة سابقة ولم يُشاهَد مباشرة: راجعه بعناية إضافية', cap_discrepancy: 'تعارض — التطبيق يخالف المتطلب؛ انظر الأخطاء المحتملة',
    cap_notimpl: 'بانتظار التنفيذ — مبني على المتطلب؛ الميزة غير مبنية بعد. ليس عيبًا.', cap_draft: 'غير متحقَّق من التطبيق — صُمِّم من المتطلب ولم يُشاهَد في التطبيق بعد', cap_stale: 'قديم — دليل التحقق السابق لم يعد ساريًا؛ أُدرج لإعادة التحقق',
    cap_orphan_summary: 'مذكور في جدول الملخص بلا قسم تفاصيل — صحّح ملف الماركداون.', cap_orphan_section: 'له قسم تفاصيل بلا صف في الملخص — صحّح ملف الماركداون.',
    s_log: 'سجل التحسينات', s_log_note: 'ما غيّره التطبيق الحي (فارغ حتى تعمل المهارة 3b)', h_validation: 'التحقق', h_changed: 'ما تغيّر', h_observed: 'السبب (ما أظهره التطبيق)', h_run: 'التشغيل',
    s_bugs: 'أخطاء محتملة', s_bugs_note: 'سلوك مُشاهَد يخالف المتطلب', pb_tc: 'حالة الاختبار', pb_steps: 'خطوات إعادة الإنتاج', pb_expected: 'النتيجة المتوقعة', pb_actual: 'النتيجة الفعلية',
    pb_open: 'مفتوح', pb_resolved: 'محلول', pb_notchecked: 'لم يُفحص في هذا التشغيل', pb_first: 'أول ظهور', pb_last: 'آخر فحص',
    s_questions: 'أسئلة مفتوحة', s_questions_note: 'لم يُتخذ أي إجراء أدناه دون إجابة', q_tcs: 'الحالات المتأثرة', q_gap: 'الفجوة', q_why: 'لماذا يهم', q_evidence: 'الدليل', q_recommended: 'الموصى به', q_alternatives: 'البدائل', q_pending: 'معلّق حتى الإجابة', q_status: 'الحالة',
    s_findings: 'ملاحظات مفتوحة للمراجع البشري', s_findings_note: 'لا تُطوى أبدًا',
    f_gaps: 'فجوات المتطلبات / التغطية', f_defects: 'عيوب التطبيق (تعارضات)', f_pending: 'بانتظار التنفيذ', f_env: 'معوّقات البيئة', f_unclear: 'متطلبات غير واضحة',
    footer_1: 'المصدر المعتمد:', footer_1b: '(بالإنجليزية دائمًا) — هذه الصفحة مولَّدة منه بواسطة سكربت العرض ولا تضيف شيئًا؛ وعندما تكون بالعربية فهي ترجمة أمينة.',
    footer_2: 'بيانات الاختبار:', footer_2b: '— ما تحتاجه كل حالة، وهل هو موجود، وكيف يُنشأ المفقود.',
    footer_3: 'للاعتماد: عدّل Automation Candidate / Smoke / Data effect / Shared data في الماركداون ثم اضبط', footer_3b: 'الاعتماد يفتح', footer_3c: 'و', footer_3d: 'كلًّا على حدة (النشر اختياري).',
    footer_4: 'لطلب تعديلات، أرسل التصحيحات بمعرّف الحالة وأعد تشغيل', footer_4b: 'للتحقق الحي من حالات الاختبار، شغّل المهارة الاختيارية', footer_4c: '(تحتاج Playwright MCP وعنوان التطبيق وبيانات الدخول).',
    val_none: 'غير متحقَّق من التطبيق — اختياري: شغّل link-qc-3b-validate-manual-test-cases', val_by: 'تحقّقت منه المهارة 3b في', val_by_cli: 'تحقّقت منه المهارة 3c في', val_scope: 'النطاق',
    none: 'لا شيء', na: DASH,
  },
};

/* ============================================================================================
 * Markdown parsing
 * ========================================================================================== */
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
const isRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const stripMd = (s) => String(s ?? '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').trim();
const bare = (v) => { const s = stripMd(v); return s === '' || s === DASH || s === '-' ? '' : s; };

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

function col(table, re) {
  if (!table) return -1;
  return table.header.findIndex((h) => re.test(stripMd(h)));
}
const cell = (row, idx) => (idx >= 0 && idx < row.length ? row[idx] : '');

function parseHeaderBlock(lines) {
  const header = {}; const order = []; let feature = null; let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^## /.test(l)) { end = i; break; }
    const t = l.match(/^#\s+Test Cases\s*[—–-]\s*(.+?)\s*$/i);
    if (t) { feature = t[1]; continue; }
    const m = l.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    if (m) { header[m[1].trim()] = m[2].trim(); order.push(m[1].trim()); }
  }
  return { header, order, feature, end };
}

/** Split the body into level-2 sections: [{ title, start, lines }]. */
function sections(lines) {
  const out = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## +(.+?)\s*$/);
    if (m) { cur = { title: stripMd(m[1]), start: i, lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(lines[i]);
  }
  return out;
}
const findSection = (secs, re) => secs.find((s) => re.test(s.title));
/** Level-2 AND level-3 headings, flat — the fallback for legacy documents that nest tables under `###`. */
function subsections(lines) {
  const out = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##{1,2} +(.+?)s*$/);
    if (m) { cur = { title: stripMd(m[1]), start: i, lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(lines[i]);
  }
  return out;
}

/** Parse `- **Field:** value` bullets with indented sub-lists / continuation lines. */
function parseFieldBullets(lines, base) {
  const fields = {}; const order = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^<!--/.test(l.trim())) { cur = null; continue; }
    const m = l.match(/^\s{0,1}[-*]\s+\*\*([^*]+?):\*\*\s*(.*)$/) || l.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    if (m) {
      cur = { name: m[1].trim(), value: m[2].trim(), items: [], line: base + i + 1 };
      fields[cur.name] = cur; order.push(cur.name); continue;
    }
    if (!cur) continue;
    const li = l.match(/^\s{2,}(?:\d+[.)]|[-*])\s+(.*)$/);
    if (li) { cur.items.push(li[1].trim()); continue; }
    if (/^\s{2,}\S/.test(l)) { if (cur.items.length) cur.items[cur.items.length - 1] += ' ' + l.trim(); else cur.value = (cur.value + ' ' + l.trim()).trim(); continue; }
    if (l.trim() === '') continue;
    cur = null;
  }
  return { fields, order };
}

/** `<!-- tc-evidence ... -->` and `<!-- pb-meta: ... -->` blocks → { key: value }. */
function parseMetaComment(text, tag) {
  const re = new RegExp('<!--\\s*' + tag + '\\b:?\\s*([\\s\\S]*?)-->', 'i');
  const m = text.match(re);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(/\n|;/)) {
    const kv = part.match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2];
  }
  return out;
}

/** `### {ID} — {Description}` blocks inside a set of lines. */
function parseIdBlocks(lines, base, idTest) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^###+\s+(\S+)\s*(?:[—–:-]\s*(.*?))?\s*$/);
    if (!m || !idTest(m[1])) continue;
    let j = i + 1;
    while (j < lines.length && !/^###+\s+\S/.test(lines[j]) && !/^## /.test(lines[j])) j++;
    blocks.push({ id: m[1], title: (m[2] || '').trim(), line: base + i + 1, lines: lines.slice(i + 1, j), raw: lines.slice(i + 1, j).join('\n') });
    i = j - 1;
  }
  return blocks;
}

export function parseTcDocument(text) {
  const lines = text.split('\n');
  const { header, order, feature, end } = parseHeaderBlock(lines);
  const body = lines.slice(end);
  const secs = sections(body).map((s) => ({ ...s, start: s.start + end }));
  const errors = []; const compatibility = []; const warnings = [];
  const allTables = parseTables(body, end);
  const compat = (what, detail) => compatibility.push({ what, detail });

  // Summary table — prefer the frozen anchor, else the first table with an ID column and a Type column.
  let summarySec = findSection(secs, /^summary$/i);
  let summary = summarySec ? parseTables(summarySec.lines, summarySec.start + 1)[0] : null;
  if (!summary) {
    summary = allTables.find((t) => col(t, /^id$/i) >= 0 && col(t, /^type$/i) >= 0) || null;
    if (summary) compat('summary-anchor-missing', 'No `## Summary` heading — the first table with ID + Type columns was used (line ' + summary.line + ').');
    else compat('summary-table-missing', 'No summary table found — the summary is derived from the TC sections.');
  }
  const summaryRows = [];
  if (summary) {
    const ci = { id: col(summary, /^id$/i), type: col(summary, /^type$/i), locale: col(summary, /^locale$/i), req: col(summary, /^requirement/i), smoke: col(summary, /^smoke$/i), auto: col(summary, /^automation/i), effect: col(summary, /^data effect$/i), shared: col(summary, /^shared data$/i), tags: col(summary, /^tags$/i), validation: col(summary, /^validation$/i), desc: col(summary, /^description$/i), stage: col(summary, /^stage$/i) };
    if (ci.stage < 0) compat('summary-stage-missing', 'Summary table has no `Stage` column — stages are derived from Type (negative → @negative, else @positive).');
    for (const r of summary.rows) {
      const id = stripMd(cell(r, ci.id));
      if (!id) continue;
      summaryRows.push({ id, line: summary.line, type: stripMd(cell(r, ci.type)), locale: stripMd(cell(r, ci.locale)), requirement: stripMd(cell(r, ci.req)), smoke: stripMd(cell(r, ci.smoke)), automation: stripMd(cell(r, ci.auto)), effect: stripMd(cell(r, ci.effect)), shared: stripMd(cell(r, ci.shared)), tags: ci.tags >= 0 ? stripMd(cell(r, ci.tags)) : null, validation: stripMd(cell(r, ci.validation)), description: stripMd(cell(r, ci.desc)), stage: stripMd(cell(r, ci.stage)) });
    }
    for (const b of summary.broken) errors.push({ kind: 'broken-row', line: b.line, detail: 'summary row has ' + b.cells + ' cells, header has ' + b.expected });
  }

  // TC sections — under `## Test Cases` when present, else any `###` block whose id looks like a TC id and that carries a Steps or Type field.
  const tcSec = findSection(secs, /^test cases$/i);
  if (!tcSec) compat('test-cases-anchor-missing', 'No `## Test Cases` heading — every `###` block that looks like a test case was used.');
  const scanLines = tcSec ? tcSec.lines : body;
  const scanBase = tcSec ? tcSec.start + 1 : end;
  const sumIds = new Set(summaryRows.map((r) => r.id));
  const blocks = parseIdBlocks(scanLines, scanBase, (id) => ID_RE.test(id) && !/^(PB|Q)-/.test(id));
  const tcBlocks = [];
  for (const b of blocks) {
    const { fields, order: fo } = parseFieldBullets(b.lines, b.line);
    const has = (n) => Object.keys(fields).some((k) => new RegExp('^' + n + '$', 'i').test(k));
    if (!has('Steps') && !has('Type') && !sumIds.has(b.id)) continue;
    const evidence = parseMetaComment(b.raw, 'tc-evidence');
    tcBlocks.push({ ...b, fields, fieldOrder: fo, evidence });
  }

  // Generic sections
  const subs = subsections(body).map((s) => ({ ...s, start: s.start + end }));
  const tableUnder = (re) => {
    const s = findSection(secs, re);
    if (s) return { section: s, tables: parseTables(s.lines, s.start + 1) };
    const s3 = findSection(subs, re);
    if (s3 && parseTables(s3.lines, s3.start + 1).length) { compat('anchor-nested', 'No level-2 heading matching ' + re.source + ' — a nested heading was used (line ' + (s3.start + 1) + ').'); return { section: s3, tables: parseTables(s3.lines, s3.start + 1) }; }
    return null;
  };
  const existing = tableUnder(/existing-tc analysis/i);
  const log = tableUnder(/enhancement log/i);
  const trace = tableUnder(/traceability/i);
  const negative = tableUnder(/negative coverage/i);
  const standards = tableUnder(/standards alignment/i);
  const coverage = tableUnder(/requirement coverage score|coverage score/i);
  const manual = tableUnder(/manual-only|stays manual/i);
  let coverageTable = coverage ? coverage.tables[0] : null;
  if (!coverageTable) {
    coverageTable = allTables.find((t) => col(t, /status/i) >= 0 && t.rows.some((r) => /fully|partially|not covered/i.test(cell(r, col(t, /status/i))))) || null;
    if (coverageTable) compat('coverage-anchor-missing', 'No `## Requirement Coverage Score` heading — a table with Fully / Partially / Not Covered statuses was used (line ' + coverageTable.line + ').');
    else compat('coverage-table-missing', 'No requirement-coverage table — the gauge renders `—`.');
  }
  let traceTable = trace ? trace.tables[0] : null;
  if (!traceTable) { traceTable = coverageTable; if (coverageTable) compat('traceability-anchor-missing', 'No `## Traceability Matrix` heading — the coverage table is shown as the traceability matrix.'); }
  for (const t of [existing, log, trace, negative, standards, coverage, manual]) if (t) for (const tb of t.tables) for (const b of tb.broken) errors.push({ kind: 'broken-row', line: b.line, detail: 'table row has ' + b.cells + ' cells, header has ' + b.expected + ' (' + t.section.title + ')' });
  if (!log) compat('enhancement-log-missing', 'No `## Enhancement Log` section — shown as empty.');
  if (!manual) compat('manual-only-missing', 'No `## Manual-Only Scenarios` section — shown as empty.');

  // Potential bugs
  const pbSec = findSection(secs, /potential bugs/i);
  const potentialBugs = [];
  if (pbSec) {
    for (const b of parseIdBlocks(pbSec.lines, pbSec.start + 1, (id) => /^PB-\d+$/.test(id))) {
      const { fields } = parseFieldBullets(b.lines, b.line);
      const f = (n) => { const k = Object.keys(fields).find((x) => new RegExp('^' + n, 'i').test(x)); return k ? fields[k] : null; };
      const meta = parseMetaComment(b.raw, 'pb-meta') || {};
      const stepsF = f('Steps to reproduce');
      let steps = stepsF ? (stepsF.items.length ? stepsF.items : stepsF.value.split(/\s(?=\d+[.)]\s)/).map((s) => s.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean)) : [];
      const st = (meta.status || 'open').trim();
      const status = /^resolved/i.test(st) ? 'resolved' : /not-checked|not checked/i.test(st) ? 'not-checked' : 'open';
      potentialBugs.push({ id: b.id, title: b.title, line: b.line, tc: f('Test case') ? stripMd(f('Test case').value) : '', steps, expected: f('Expected result') ? stripMd(f('Expected result').value) : '', actual: f('Actual result') ? stripMd(f('Actual result').value) : '', status, statusText: st, meta, note: f('Reviewer comment') ? bare(f('Reviewer comment').value) : '' });
    }
  } else compat('potential-bugs-missing', 'No `## Potential Bugs` section — shown as empty (a design-only document has none).');

  // Open questions
  const qSec = findSection(secs, /^open questions$/i);
  const openQuestions = [];
  if (qSec) {
    for (const b of parseIdBlocks(qSec.lines, qSec.start + 1, (id) => /^Q-\d+$/.test(id))) {
      const { fields } = parseFieldBullets(b.lines, b.line);
      const f = (n) => { const k = Object.keys(fields).find((x) => new RegExp('^' + n, 'i').test(x)); return k ? stripMd(fields[k].value) + (fields[k].items.length ? ' ' + fields[k].items.join(' · ') : '') : ''; };
      openQuestions.push({ id: b.id, title: b.title, line: b.line, tcs: f('Affected'), gap: f('Gap'), why: f('Why'), evidence: f('Evidence'), recommended: f('Recommended'), alternatives: f('Alternatives'), pending: f('Pending|What stays pending'), status: f('Status') || 'open', note: bare(f('Reviewer comment')) });
    }
  } else compat('open-questions-missing', 'No `## Open Questions` section — shown as empty.');

  // Open findings — `###` buckets → list items
  const findSec = findSection(secs, /open findings/i);
  const findings = { gaps: [], defects: [], pending: [], env: [], unclear: [], other: [] };
  if (findSec) {
    let bucket = 'other'; let bucketName = '';
    for (const l of findSec.lines) {
      const h = l.match(/^###+\s+(.+?)\s*$/);
      if (h) {
        bucketName = stripMd(h[1]);
        bucket = /gap/i.test(bucketName) ? 'gaps' : /defect|discrepanc/i.test(bucketName) ? 'defects' : /pending|implementation/i.test(bucketName) ? 'pending' : /environment|blocker/i.test(bucketName) ? 'env' : /unclear|question/i.test(bucketName) ? 'unclear' : 'other';
        continue;
      }
      const li = l.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/);
      if (li && !/^(none|—|-)\.?$/i.test(stripMd(li[1]))) findings[bucket].push(bucket === 'other' ? (bucketName ? bucketName + ': ' : '') + stripMd(li[1]) : stripMd(li[1]));
    }
  } else compat('open-findings-missing', 'No `## Open Findings for the Human Reviewer` section — shown as empty.');

  return { feature, header, headerOrder: order, summaryRows, tcBlocks, existing: existing ? existing.tables[0] : null, log: log ? log.tables[0] : null, traceTable, coverageTable, negative: negative ? negative.tables[0] : null, standards: standards ? standards.tables[0] : null, manual: manual ? manual.tables[0] : null, potentialBugs, openQuestions, findings, compatibility, warnings, errors, sectionTitles: secs.map((s) => s.title) };
}

export function parseTestData(text) {
  const lines = text.split('\n');
  const { header } = parseHeaderBlock(lines);
  const secs = sections(lines);
  const glance = findSection(secs, /at a glance/i);
  const problems = findSection(secs, /problems/i);
  const gt = glance ? parseTables(glance.lines, glance.start + 1)[0] : null;
  const pt = problems ? parseTables(problems.lines, problems.start + 1)[0] : null;
  const items = []; const errors = [];
  if (gt) {
    const ci = { num: col(gt, /^#$/), name: col(gt, /data item/i), look: col(gt, /must look like/i), used: col(gt, /used by/i), status: col(gt, /^status$/i), way: col(gt, /best way/i) };
    for (const r of gt.rows) {
      const status = stripMd(cell(r, ci.status)).toUpperCase();
      if (status && !DATA_STATUSES.includes(status)) errors.push({ kind: 'unknown-enum', line: gt.line, detail: 'test-data status "' + status + '" is not READY / MISSING / IMPOSSIBLE / UNKNOWN' });
      items.push({ num: stripMd(cell(r, ci.num)), name: stripMd(cell(r, ci.name)), look: stripMd(cell(r, ci.look)), used: stripMd(cell(r, ci.used)), status, way: stripMd(cell(r, ci.way)) });
    }
    for (const b of gt.broken) errors.push({ kind: 'broken-row', line: b.line, detail: 'test-data row has ' + b.cells + ' cells, header has ' + b.expected });
  }
  const problemRows = [];
  if (pt) {
    const ci = { num: col(pt, /^#$/), item: col(pt, /data item/i), problem: col(pt, /^problem$/i), why: col(pt, /^why$/i), decision: col(pt, /decide/i) };
    for (const r of pt.rows) problemRows.push({ num: stripMd(cell(r, ci.num)), item: stripMd(cell(r, ci.item)), problem: stripMd(cell(r, ci.problem)), why: stripMd(cell(r, ci.why)), decision: stripMd(cell(r, ci.decision)) });
  }
  // `## 0. Environment` (E{n}) and `## 1. Accounts` (A{n}) — the configuration the TCs reference by token.
  const env = []; const accounts = []; const compatibility = [];
  const envSec = findSection(secs, /^0\.\s*environment/i);
  const et = envSec ? parseTables(envSec.lines, envSec.start + 1)[0] : null;
  if (et) {
    const ci = { id: col(et, /^id$/i), what: col(et, /^what$/i), value: col(et, /^value$/i), status: col(et, /^status$/i) };
    for (const r of et.rows) { const id = stripMd(cell(r, ci.id)).toUpperCase(); if (/^E\d+$/.test(id)) env.push({ id, what: stripMd(cell(r, ci.what)), value: bare(cell(r, ci.value)), status: stripMd(cell(r, ci.status)).toUpperCase() }); }
  } else compatibility.push({ what: 'test-data-environment-missing', detail: 'TEST-DATA has no `## 0. Environment` table — [E{n}] references cannot be resolved and environment literals are not checked.' });
  const accSec = findSection(secs, /^1\.\s*accounts/i);
  const at = accSec ? parseTables(accSec.lines, accSec.start + 1)[0] : null;
  if (at) {
    const ci = { id: col(at, /^id$/i), role: col(at, /^role$/i), user: col(at, /^username$/i), status: col(at, /^status$/i), used: col(at, /used by/i), note: col(at, /^note$/i) };
    if (ci.id < 0) compatibility.push({ what: 'test-data-accounts-no-id', detail: 'TEST-DATA `## 1. Accounts` has no `ID` column — [A{n}] references cannot be resolved (usernames are still checked).' });
    for (const r of at.rows) { const id = ci.id >= 0 ? stripMd(cell(r, ci.id)).toUpperCase() : ''; accounts.push({ id: /^A\d+$/.test(id) ? id : null, role: stripMd(cell(r, ci.role)), username: bare(cell(r, ci.user)), status: stripMd(cell(r, ci.status)).toUpperCase(), used: stripMd(cell(r, ci.used)), note: stripMd(cell(r, ci.note)) }); }
  }
  return { header, items, problemRows, env, accounts, errors, compatibility, present: !!gt };
}

/* ============================================================================================
 * Data references + literals — configuration lives in TEST-DATA; a TC names it by token.
 * ========================================================================================== */
const REF_TOKEN_RE = /\[([AED])(\d+)\]/g;
const INTENTIONAL_RE = /\(intentional input\)\s*$/i;
const hostOf = (v) => { try { return new URL(v).host.toLowerCase(); } catch { return null; } };
/** Quoted segments ("…", “…”, «…», `…`) are application text or typed values — never narrative, never a literal. */
function stripQuoted(s) {
  return String(s ?? '').replace(/"[^"]*"|“[^”]*”|«[^»]*»|`[^`]*`/g, ' ');
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Configuration values a TC must reference, not repeat. */
function configurationIndex(data) {
  const idx = { hosts: [], values: [], usernames: [], known: new Set() };
  if (!data) return idx;
  for (const e of data.env || []) { idx.known.add(e.id); if (e.value && !/^unknown/i.test(e.value)) { idx.values.push({ id: e.id, value: e.value }); const h = hostOf(e.value); if (h) idx.hosts.push({ id: e.id, host: h }); } }
  for (const a of data.accounts || []) { if (a.id) idx.known.add(a.id); if (a.username && !/^unknown$/i.test(a.username)) idx.usernames.push({ id: a.id, username: a.username }); }
  for (const d of data.items || []) if (/^D\d+$/i.test(d.num)) idx.known.add(d.num.toUpperCase());
  return idx;
}
/** One TC's texts → { refs: Set, unresolved: [], literals: [] }. */
function scanDataUse(texts, idx) {
  const refs = new Set(); const literals = []; const unresolved = [];
  for (const raw of texts) {
    const s = String(raw ?? '');
    for (const m of s.matchAll(REF_TOKEN_RE)) refs.add(m[1] + m[2]);
    if (INTENTIONAL_RE.test(s)) continue;
    const plain = stripQuoted(s);
    for (const h of idx.hosts) if (plain.toLowerCase().includes(h.host)) literals.push({ kind: 'environment', id: h.id, value: h.host, text: s });
    for (const v of idx.values) if (!hostOf(v.value) && v.value.length >= 4 && plain.includes(v.value)) literals.push({ kind: 'environment', id: v.id, value: v.value, text: s });
    for (const u of idx.usernames) if (new RegExp('(^|[^\\w.@-])' + escapeRe(u.username) + '(?![\\w.@-])', 'i').test(plain)) literals.push({ kind: 'account', id: u.id, value: u.username, text: s });
  }
  for (const r of refs) if (!idx.known.has(r)) unresolved.push(r);
  return { refs, literals, unresolved };
}
/** Share of Arabic script in narrative text (quoted application text removed). null when there are no letters. */
export function arabicShare(texts) {
  let ar = 0; let latin = 0;
  for (const raw of texts) { const s = stripQuoted(raw); ar += (s.match(/[؀-ۿ]/g) || []).length; latin += (s.match(/[A-Za-z]/g) || []).length; }
  return ar + latin ? ar / (ar + latin) : null;
}
export const NARRATIVE_ARABIC_THRESHOLD = 0.6;

/* ============================================================================================
 * Model — derive every number from the tables; compare with the header.
 * ========================================================================================== */
const normState = (v) => {
  const s = stripMd(v).toLowerCase();
  if (!s) return { state: 'draft', stale: false, empty: true };
  if (s.startsWith('not-implemented') || s.startsWith('not implemented')) return { state: 'not-implemented', stale: false };
  if (s.startsWith('draft')) return { state: 'draft', stale: /stale/.test(s) };
  const hit = VALIDATION_STATES.find((x) => s === x || s.startsWith(x + ' ') || s.startsWith(x + ' —'));
  return hit ? { state: hit, stale: false } : { state: null, stale: false, raw: s };
};
const yesNo = (v) => { const s = stripMd(v).toUpperCase(); return s === 'YES' ? 'yes' : s === 'NO' || s === '' || s === DASH ? 'no' : 'unknown'; };
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : null);
const fmtPct = (p) => (p === null ? DASH : String(p));
const SECRET_RE = /\b(password|passcode|secret|token|pat|api[- ]?key)\b\s*(?:[:=]|is)\s*["'`]?[^\s"'`]{3,}/i;

export function buildModel(doc, data, opts = {}) {
  const errors = [...doc.errors]; const warnings = [...doc.warnings]; const compatibility = [...doc.compatibility]; const mismatches = [];
  const h = doc.header;
  const hv = (re) => { const k = Object.keys(h).find((x) => re.test(x)); return k ? h[k] : null; };

  // ---- configuration index (TEST-DATA) for the data-literal / data-ref checks
  const cfg = configurationIndex(data);
  const dataRefs = { total: 0, resolved: new Set(), unresolved: 0, literals: 0 };

  // ---- TC union
  const byId = new Map();
  for (const r of doc.summaryRows) byId.set(r.id, { id: r.id, row: r, block: null });
  for (const b of doc.tcBlocks) { const e = byId.get(b.id); if (e) e.block = b; else byId.set(b.id, { id: b.id, row: null, block: b }); }
  const tcs = [];
  for (const e of byId.values()) {
    const f = (n) => { if (!e.block) return null; const k = Object.keys(e.block.fields).find((x) => new RegExp('^' + n + '$', 'i').test(x)); return k ? e.block.fields[k] : null; };
    const fv = (n) => { const x = f(n); return x ? stripMd(x.value) : null; };
    const orphan = !e.block ? 'summary-only' : !e.row ? 'section-only' : null;
    if (orphan) warnings.push({ kind: 'orphan-tc', id: e.id, detail: orphan === 'summary-only' ? 'listed in the summary table but has no `### ' + e.id + '` section' : 'has a `### ' + e.id + '` section but no summary row' });
    if (e.block) for (const req of ['Type', 'Steps', 'Expected Result']) if (!f(req)) errors.push({ kind: 'frozen-field-missing', line: e.block.line, detail: e.id + ' has no `' + req + '` field' });
    const type = (fv('Type') || (e.row && e.row.type) || '').toLowerCase();
    if (type && !TC_TYPES.includes(type)) errors.push({ kind: 'unknown-enum', line: e.block ? e.block.line : (e.row && e.row.line), detail: e.id + ' Type "' + type + '" is not happy-path / edge-case / negative' });
    const vRaw = fv('Validation') ?? (e.row ? e.row.validation : '');
    const v = normState(vRaw);
    if (v.state === null) errors.push({ kind: 'unknown-enum', line: e.block ? e.block.line : (e.row && e.row.line), detail: e.id + ' Validation "' + v.raw + '" is not one of ' + VALIDATION_STATES.join(' / ') });
    if (v.empty) compatibility.push({ what: 'validation-empty', detail: e.id + ' has an empty Validation — treated as draft.' });
    const steps = f('Steps') ? f('Steps').items : [];
    const pre = f('Preconditions') ? (f('Preconditions').items.length ? f('Preconditions').items : (f('Preconditions').value ? [stripMd(f('Preconditions').value)] : [])) : [];
    for (const s of [...steps, ...pre]) if (SECRET_RE.test(s)) errors.push({ kind: 'secret-literal', line: e.block.line, detail: e.id + ' contains a password-shaped literal in a step or precondition' });
    const stageRaw = fv('Stage') || (e.row && e.row.stage) || '';
    const stage = stageRaw ? stageRaw.toLowerCase().replace(/^@?/, '@') : (type === 'negative' ? '@negative' : '@positive');
    const smoke = yesNo(fv('Smoke') ?? (e.row ? e.row.smoke : ''));
    const auto = yesNo(fv('Automation Candidate') ?? (e.row ? e.row.automation : ''));
    if (smoke === 'unknown') warnings.push({ kind: 'unknown-token', id: e.id, detail: 'Smoke is neither YES nor NO' });
    if (auto === 'unknown') warnings.push({ kind: 'unknown-token', id: e.id, detail: 'Automation Candidate is neither YES nor NO' });
    const ev = e.block && e.block.evidence ? e.block.evidence : null;
    const tagsRaw = fv('Tags') ?? (e.row && e.row.tags !== null && e.row.tags !== undefined ? e.row.tags : null);
    const tags = tagsRaw === null ? [] : bare(tagsRaw).split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    const expected = fv('Expected Result') || '';
    const isHuman = (s) => /^\s*\[HUMAN\]/i.test(String(s ?? ''));
    const humanSteps = steps.filter(isHuman).length + pre.filter(isHuman).length + (isHuman(expected) ? 1 : 0);
    const oracle = bare(fv('Data Oracle')); const shared = bare(fv('Shared data') ?? (e.row ? e.row.shared : ''));
    const use = scanDataUse([...pre, ...steps, expected, oracle, shared], cfg);
    if (data) {
      for (const l of use.literals) warnings.push({ kind: 'data-literal', id: e.id, detail: e.id + ' repeats ' + l.kind + ' value "' + l.value + '" (TEST-DATA ' + (l.id || 'row') + ') — reference it as [' + (l.id || '…') + '] or end the line with "(intentional input)"' });
      for (const r of use.unresolved) warnings.push({ kind: 'data-ref-unresolved', id: e.id, detail: e.id + ' references [' + r + '] but TEST-DATA has no such row' });
      dataRefs.total += use.refs.size; dataRefs.unresolved += use.unresolved.length; dataRefs.literals += use.literals.length; for (const r of use.refs) if (cfg.known.has(r)) dataRefs.resolved.add(r);
    }
    tcs.push({
      id: e.id, line: e.block ? e.block.line : (e.row ? e.row.line : null), orphan,
      description: (e.block && e.block.title) || (e.row && e.row.description) || fv('Description') || '',
      type, locale: fv('Locale') || (e.row && e.row.locale) || '', requirement: fv('Requirement') || (e.row && e.row.requirement) || '',
      preconditions: pre, steps, expected, oracle, smoke, auto, tags, humanSteps,
      effect: bare(fv('Data effect') ?? (e.row ? e.row.effect : '')), shared,
      validation: v.state || 'draft', validationRaw: vRaw || '', stale: v.stale, stage, evidence: ev, refs: [...use.refs].sort(),
      note: bare(fv('Reviewer comment')), // optional reviewer field — displayed, never translated, never a design field
    });
  }
  tcs.sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9));
  const humanTcs = tcs.filter((t) => t.humanSteps > 0).length;
  const humanStepsTotal = tcs.reduce((s, t) => s + t.humanSteps, 0);

  // ---- counts
  const n = tcs.length;
  const byType = { 'happy-path': 0, 'edge-case': 0, negative: 0 };
  for (const t of tcs) if (byType[t.type] !== undefined) byType[t.type]++;
  const locales = [...new Set(tcs.map((t) => t.locale).filter(Boolean))];
  const perLocale = {}; for (const t of tcs) if (t.locale) perLocale[t.locale] = (perLocale[t.locale] || 0) + 1;
  const smoke = tcs.filter((t) => t.smoke === 'yes').length;
  const auto = tcs.filter((t) => t.auto === 'yes').length;
  const byState = {}; for (const s of VALIDATION_STATES) byState[s] = 0;
  for (const t of tcs) byState[t.validation]++;
  const stale = tcs.filter((t) => t.stale).length;
  const observed = tcs.filter((t) => OBSERVED_STATES.includes(t.validation) && !t.stale).length;
  const progressPct = pct(observed, n);

  // ---- coverage (design) — from the coverage table only
  const cov = { full: 0, partial: 0, none: 0, acs: 0, weighted: null, rows: [] };
  const ct = doc.coverageTable;
  if (ct) {
    const ci = { ac: col(ct, /^ac|acceptance/i), req: col(ct, /req/i), tcs: col(ct, /tc/i), status: col(ct, /status/i), missing: col(ct, /missing/i) };
    for (const r of ct.rows) {
      const st = stripMd(cell(r, ci.status)).toLowerCase();
      const status = /fully/.test(st) ? 'full' : /partial/.test(st) ? 'partial' : /not/.test(st) ? 'none' : null;
      if (!status) { errors.push({ kind: 'unknown-enum', line: ct.line, detail: 'coverage status "' + st + '" is not Fully / Partially / Not Covered' }); continue; }
      cov[status]++; cov.acs++;
      const ids = stripMd(cell(r, ci.tcs)).split(/[,\s]+/).filter((x) => ID_RE.test(x));
      const linked = tcs.filter((t) => ids.includes(t.id));
      const happy = linked.filter((t) => t.type !== 'negative').length;
      const neg = linked.filter((t) => t.type === 'negative').length;
      const loc = new Set(linked.map((t) => t.locale).filter(Boolean)).size;
      cov.rows.push({ ac: stripMd(cell(r, ci.ac)), req: stripMd(cell(r, ci.req)), tcs: ids, status, missing: bare(cell(r, ci.missing)), happy, neg, loc });
    }
    cov.weighted = cov.acs ? Math.round(((cov.full + cov.partial * 0.5) / cov.acs) * 1000) / 10 : null;
  }

  // ---- traceability
  const trace = [];
  if (doc.traceTable) {
    const tt = doc.traceTable;
    const ci = { ac: col(tt, /^ac|acceptance/i), req: col(tt, /req/i), tcs: col(tt, /tc/i), status: col(tt, /status/i), missing: col(tt, /missing/i) };
    for (const r of tt.rows) { const st = stripMd(cell(r, ci.status)); trace.push({ ac: stripMd(cell(r, ci.ac)), req: stripMd(cell(r, ci.req)), tcs: stripMd(cell(r, ci.tcs)), status: st, missing: bare(cell(r, ci.missing)), gap: /not/i.test(st) }); }
  }

  // ---- manual-only
  const manual = [];
  if (doc.manual) {
    const mt = doc.manual;
    const ci = { cat: col(mt, /category/i), tc: col(mt, /tc/i), sc: col(mt, /scenario/i), why: col(mt, /why/i), pr: col(mt, /priority/i) };
    for (const r of mt.rows) { const pr = stripMd(cell(r, ci.pr)).toLowerCase(); manual.push({ category: stripMd(cell(r, ci.cat)), tc: stripMd(cell(r, ci.tc)), scenario: stripMd(cell(r, ci.sc)), why: stripMd(cell(r, ci.why)), priority: /high/.test(pr) ? 'high' : /medium/.test(pr) ? 'medium' : /low/.test(pr) ? 'low' : 'none', priorityText: stripMd(cell(r, ci.pr)) }); }
  }
  const manualCounts = { total: manual.length, high: manual.filter((m) => m.priority === 'high').length, medium: manual.filter((m) => m.priority === 'medium').length, low: manual.filter((m) => m.priority === 'low').length };

  // ---- enhancement log / existing analysis / generic tables
  const genericRows = (t) => (t ? t.rows.map((r) => r.map(stripMd)) : []);
  const logT = doc.log;
  const log = logT ? { header: logT.header.map(stripMd), rows: genericRows(logT) } : { header: [], rows: [] };
  const existing = doc.existing ? { header: doc.existing.header.map(stripMd), rows: genericRows(doc.existing) } : null;
  const negative = doc.negative ? { header: doc.negative.header.map(stripMd), rows: genericRows(doc.negative) } : null;
  const standards = doc.standards ? { header: doc.standards.header.map(stripMd), rows: genericRows(doc.standards) } : null;

  // ---- potential bugs
  const bugs = { open: doc.potentialBugs.filter((b) => b.status === 'open').length, notChecked: doc.potentialBugs.filter((b) => b.status === 'not-checked').length, resolved: doc.potentialBugs.filter((b) => b.status === 'resolved').length };
  bugs.current = bugs.open + bugs.notChecked;
  for (const b of doc.potentialBugs) if (b.tc && !byId.has(b.tc)) warnings.push({ kind: 'pb-unknown-tc', id: b.id, detail: b.id + ' references ' + b.tc + ', which is not a TC in this document' });

  // ---- test data
  const td = data && data.present ? { items: data.items, problems: data.problemRows, ready: data.items.filter((i) => i.status === 'READY').length, missing: data.items.filter((i) => i.status === 'MISSING').length, impossible: data.items.filter((i) => i.status === 'IMPOSSIBLE').length, unknown: data.items.filter((i) => i.status === 'UNKNOWN').length, present: true } : { items: [], problems: [], present: false };
  if (data) { errors.push(...data.errors); compatibility.push(...(data.compatibility || [])); }
  if (!data) compatibility.push({ what: 'test-data-missing', detail: 'No TEST-DATA file was supplied or found — the test-data tile renders `—`; [A/E/D] references and configuration literals are not checked.' });

  // ---- header comparison
  const declared = (re) => { const v = hv(re); return v === null ? null : v; };
  const numsIn = (s) => (s ? (s.match(/\d+(?:\.\d+)?/g) || []).map(Number) : []);
  const cmp = (field, re, computed, pick) => {
    const raw = declared(re); if (raw === null) { compatibility.push({ what: 'header-line-missing', detail: 'header line `' + field + '` missing — computed value rendered' }); return; }
    const d = pick(numsIn(raw), raw);
    if (d === null || d === undefined) return;
    const same = Array.isArray(d) ? d.length === computed.length && d.every((x, i) => x === computed[i]) : d === computed;
    if (!same) mismatches.push({ field, declared: raw, computed: Array.isArray(computed) ? computed.join('/') : computed });
  };
  cmp('Total test cases', /^total test cases$/i, n, (xs) => (xs.length ? xs[0] : null));
  cmp('Smoke TCs', /^smoke tcs$/i, smoke, (xs) => (xs.length ? xs[0] : null));
  cmp('Automation candidates', /^automation candidates$/i, auto, (xs) => (xs.length ? xs[0] : null));
  cmp('MCP validation', /^mcp validation$/i, VALIDATION_STATES.map((s) => byState[s]), (xs) => (xs.length >= 6 ? xs.slice(0, 6) : null));
  cmp('Manual-only scenarios', /^manual-only scenarios$/i, manualCounts.total, (xs) => (xs.length ? xs[0] : null));
  if (cov.weighted !== null) cmp('Requirement coverage (weighted)', /^requirement coverage/i, cov.weighted, (xs) => (xs.length ? xs[0] : null));
  if (n) cmp('App validation progress', /^app validation progress$/i, observed, (xs) => (xs.length ? xs[0] : null));

  const status = (declared(/^status$/i) || '').toUpperCase();
  const approved = /^APPROVED/.test(status);
  const implStatus = declared(/^implementation status$/i) || '';
  const implState = /^implemented/i.test(implStatus) ? 'implemented' : /partially/i.test(implStatus) ? 'partial' : /not implemented/i.test(implStatus) ? 'none' : /cannot/i.test(implStatus) ? 'cannot' : 'unknown';
  const mcpLine = declared(/^mcp validation$/i) || '';
  // Header stamp: "— by 3b on {date}[, env {name}][, scope {mode}][, re-run {n}][, tool {cli|mcp}]" (3c writes "by 3c").
  const stamp = mcpLine.match(/by (3b|3c) on (\d{4}-\d{2}-\d{2})(?:,\s*env ([^,]+))?(?:,\s*scope ([a-z-]+))?(?:,\s*re-run (\d+))?(?:,\s*tool ([a-z]+))?/i);
  const generated = declared(/^generated$/i) || declared(/^date$/i) || null;
  if (!declared(/^generated$/i)) compatibility.push({ what: 'header-generated-missing', detail: 'header line `Generated` missing — the page shows `—` for the date' });
  if (!declared(/^scope$/i)) compatibility.push({ what: 'header-scope-missing', detail: 'header line `Scope` missing — the page subtitle is empty' });
  const stampedTcs = tcs.filter((t) => t.evidence).length;
  if (observed && !stampedTcs) compatibility.push({ what: 'evidence-stamps-missing', detail: 'observed TCs carry no `<!-- tc-evidence -->` stamps (document validated by an older skill run)' });

  return {
    feature: doc.feature || opts.feature || DASH, header: h, status: status || DASH, approved, implStatus, implState, generated, scope: declared(/^scope$/i) || '', entry: declared(/^entry case$/i) || DASH,
    reqIds: declared(/^requirement ids covered$/i) || DASH, reviewLang: declared(/^review page language$/i) || '', stamp: stamp ? { by: stamp[1].toLowerCase(), date: stamp[2], env: (stamp[3] || '').trim(), scope: stamp[4] || '', rerun: stamp[5] ? Number(stamp[5]) : 0, tool: (stamp[6] || '').toLowerCase() } : null,
    tcs, counts: { total: n, byType, locales, perLocale, smoke, auto, byState, stale, observed, progressPct, coverage: cov, manual: manualCounts, bugs, testData: td.present ? { items: td.items.length, ready: td.ready, missing: td.missing, impossible: td.impossible, unknown: td.unknown, environment: (data.env || []).length, accounts: (data.accounts || []).length } : null, openQuestions: doc.openQuestions.length, orphans: tcs.filter((t) => t.orphan).length,
      humanSteps: humanStepsTotal, humanTcs, dataRefs: data ? { total: dataRefs.total, resolved: dataRefs.resolved.size, unresolved: dataRefs.unresolved, literals: dataRefs.literals } : null },
    trace, manual, log, existing, negative, standards, potentialBugs: doc.potentialBugs, openQuestions: doc.openQuestions, findings: doc.findings, testData: td,
    compatibility, mismatches, warnings, errors,
  };
}

/* ============================================================================================
 * Strings — per-story content keys for the Arabic sidecar
 * ========================================================================================== */
/** A value with no lowercase word (an ID, a date, a TC list, COVERED / N/A) stays Latin and is never a translation key. */
export const translatable = (s) => !!s && s !== DASH && /[a-z\u0600-\u06FF]{3}/.test(s);

export function deriveKeys(model) {
  const keys = {};
  const add = (k, v) => { const s = String(v ?? '').trim(); if (translatable(s)) keys[k] = s; };
  add('header.scope', model.scope); add('header.entry', model.entry); add('header.impl', model.implStatus);
  for (const t of model.tcs) {
    add('tc.' + t.id + '.description', t.description);
    t.preconditions.forEach((p, i) => add('tc.' + t.id + '.precondition.' + (i + 1), p));
    t.steps.forEach((s, i) => add('tc.' + t.id + '.step.' + (i + 1), s));
    add('tc.' + t.id + '.expected', t.expected); add('tc.' + t.id + '.oracle', t.oracle); add('tc.' + t.id + '.effect', t.effect); add('tc.' + t.id + '.shared', t.shared);
  }
  model.counts.coverage.rows.forEach((r, i) => { add('coverage.' + (i + 1) + '.ac', r.ac); add('coverage.' + (i + 1) + '.missing', r.missing); });
  model.trace.forEach((r, i) => { add('trace.' + (i + 1) + '.ac', r.ac); add('trace.' + (i + 1) + '.missing', r.missing); });
  model.manual.forEach((m, i) => { add('manual.' + (i + 1) + '.category', m.category); add('manual.' + (i + 1) + '.scenario', m.scenario); add('manual.' + (i + 1) + '.why', m.why); });
  model.testData.items.forEach((d, i) => { add('data.' + (d.num || i + 1) + '.name', d.name); add('data.' + (d.num || i + 1) + '.look', d.look); add('data.' + (d.num || i + 1) + '.way', d.way); });
  model.testData.problems.forEach((p, i) => { add('problem.' + (p.num || i + 1) + '.problem', p.problem); add('problem.' + (p.num || i + 1) + '.why', p.why); add('problem.' + (p.num || i + 1) + '.decision', p.decision); });
  if (model.existing) model.existing.rows.forEach((r, i) => r.forEach((c, j) => { if (j > 0) add('existing.' + (i + 1) + '.' + j, c); }));
  model.log.rows.forEach((r, i) => r.forEach((c, j) => { if (j >= 2) add('log.' + (i + 1) + '.' + j, c); }));
  for (const g of ['negative', 'standards']) if (model[g]) model[g].rows.forEach((r, i) => r.forEach((c, j) => add(g + '.' + (i + 1) + '.' + j, c)));
  for (const b of model.potentialBugs) { add('pb.' + b.id + '.title', b.title); b.steps.forEach((s, i) => add('pb.' + b.id + '.step.' + (i + 1), s)); add('pb.' + b.id + '.expected', b.expected); add('pb.' + b.id + '.actual', b.actual); }
  for (const q of model.openQuestions) for (const f of ['title', 'gap', 'why', 'evidence', 'recommended', 'alternatives', 'pending']) add('q.' + q.id + '.' + f, q[f]);
  for (const bucket of Object.keys(model.findings)) model.findings[bucket].forEach((f, i) => add('finding.' + bucket + '.' + (i + 1), f));
  return keys;
}

/** Merge derived keys into an existing sidecar. Never resets a translation. */
export function mergeSkeleton(existing, keys, feature) {
  const prev = existing && existing.keys ? existing.keys : {};
  const out = { feature, lang: 'ar', schemaVersion: SCHEMA_VERSION, keys: {} };
  const report = { added: [], kept: [], stale: [], orphans: [] };
  for (const [k, en] of Object.entries(keys)) {
    const p = prev[k];
    if (!p) { out.keys[k] = { en, ar: null }; report.added.push(k); continue; }
    if (p.en === en) { out.keys[k] = { en, ar: p.ar ?? null }; if (p.stale && p.ar !== null) out.keys[k].stale = true; report[p.stale && p.ar !== null ? 'stale' : 'kept'].push(k); continue; }
    out.keys[k] = { en, ar: p.ar ?? null, stale: p.ar !== null && p.ar !== undefined, en_previous: p.en }; if (p.ar === null || p.ar === undefined) delete out.keys[k].stale; report[out.keys[k].stale ? 'stale' : 'added'].push(k);
  }
  for (const [k, p] of Object.entries(prev)) if (!(k in keys)) { out.keys[k] = { ...p, orphan: true }; report.orphans.push(k); }
  return { sidecar: out, report };
}

function loadStrings(p) {
  if (!p || !isFile(p)) return null;
  try { return JSON.parse(readText(p)); } catch (e) { return { __error: String(e.message) }; }
}

/* ============================================================================================
 * Template engine — {{key}} (escaped), <!-- {{#each list}} --> … <!-- {{/each}} -->,
 * <!-- {{#if flag}} --> … <!-- {{/if}} -->, <!-- {{#unless flag}} --> … <!-- {{/unless}} -->.
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
 * View model — everything the template needs, already localized.
 * ========================================================================================== */
function viewModel(model, lang, strings, cm) {
  const C = CHROME[lang] || CHROME.en;
  const K = strings && strings.keys ? strings.keys : {};
  const outstanding = [];
  // t() returns HTML-escaped text; in Arabic a missing / stale key falls back to the English string wrapped in
  // the .untranslated marker. Template placeholders fed by t() therefore use raw triple braces.
  const t = (key, en) => {
    const s = String(en ?? '').trim();
    if (lang !== 'ar' || !translatable(s)) return escapeHtml(s);
    const e = K[key];
    if (e && e.ar && !e.stale && e.en === s) return escapeHtml(e.ar);
    outstanding.push(key);
    return '<span class="untranslated">' + escapeHtml(s) + '</span>';
  };
  const c = model.counts;
  const num = (v) => (v === null || v === undefined ? DASH : String(v));
  const st = (s) => ({ validated: 'v-validated', enhanced: 'v-enhanced', inferred: 'v-inferred', discrepancy: 'v-discrepancy', 'not-implemented': 'v-notimpl', draft: 'v-draft' }[s] || 'v-draft');
  const stateWord = (s) => ({ validated: lang === 'ar' ? 'متحقَّق' : 'validated', enhanced: lang === 'ar' ? 'محسَّن' : 'enhanced', inferred: lang === 'ar' ? 'مستنتَج' : 'inferred', discrepancy: lang === 'ar' ? 'تعارض' : 'discrepancy', 'not-implemented': lang === 'ar' ? 'غير منفَّذ' : 'not-implemented', draft: lang === 'ar' ? 'مسودة' : 'draft' }[s] || s);
  const cov = c.coverage;
  const tcs = model.tcs.map((x) => ({
    id: x.id, description: t('tc.' + x.id + '.description', x.description),
    type: x.type, locale: x.locale, requirement: x.requirement || DASH, smoke: x.smoke === 'yes', auto_yes: x.auto === 'yes', auto_no: x.auto !== 'yes',
    v_class: st(x.validation), v_word: stateWord(x.validation), stale: x.stale, orphan: !!x.orphan, orphan_summary: x.orphan === 'summary-only', orphan_section: x.orphan === 'section-only',
    is_inferred: x.validation === 'inferred' && !x.stale, is_discrepancy: x.validation === 'discrepancy', is_notimpl: x.validation === 'not-implemented', is_draft: x.validation === 'draft' && !x.stale,
    preconditions: x.preconditions.map((p, i) => ({ text: t('tc.' + x.id + '.precondition.' + (i + 1), p), cls: /^\s*\[HUMAN\]/i.test(p) ? ' class="human"' : '' })),
    steps: x.steps.map((s, i) => ({ text: t('tc.' + x.id + '.step.' + (i + 1), s), cls: /^\s*\[HUMAN\]/i.test(s) ? ' class="human"' : '' })),
    expected: t('tc.' + x.id + '.expected', x.expected),
    human: x.humanSteps > 0, n_human: String(x.humanSteps),
    has_tags: x.tags.length > 0, tags: x.tags.map((g) => ({ text: escapeHtml(g) })),
    oracle: t('tc.' + x.id + '.oracle', x.oracle), has_oracle: !!x.oracle,
    run: [x.effect ? t('tc.' + x.id + '.effect', x.effect) : '', x.shared ? t('tc.' + x.id + '.shared', x.shared) : ''].filter(Boolean).join(' · '), has_run: !!(x.effect || x.shared),
    has_evidence: !!x.evidence, evidence_on: x.evidence ? x.evidence['validated-on'] || DASH : '', evidence_env: x.evidence ? x.evidence.env || DASH : '', evidence_build: x.evidence ? x.evidence.build || DASH : '', evidence_scope: x.evidence ? x.evidence.scope || DASH : '',
    evidence_tool: x.evidence ? x.evidence.tool || '' : '', evidence_outcome: x.evidence ? x.evidence['outcome-check'] || '' : '', // metadata — not used by the template
    stage: x.stage, comment_box: commentBoxHtml(x.id, 'tc', cm, lang, x.note),
  }));
  const bugs = model.potentialBugs.map((b) => ({
    id: b.id, title: t('pb.' + b.id + '.title', b.title), tc: b.tc || DASH, steps: b.steps.map((s, i) => ({ text: t('pb.' + b.id + '.step.' + (i + 1), s) })),
    expected: t('pb.' + b.id + '.expected', b.expected), actual: t('pb.' + b.id + '.actual', b.actual),
    status: b.status, status_word: b.status === 'resolved' ? C.pb_resolved : b.status === 'not-checked' ? C.pb_notchecked : C.pb_open,
    first: b.meta['first-seen'] || DASH, last: b.meta['last-checked'] || DASH, resolved: b.status === 'resolved', comment_box: commentBoxHtml(b.id, 'pb', cm, lang, b.note),
  }));
  const questions = model.openQuestions.map((q) => ({ id: q.id, title: t('q.' + q.id + '.title', q.title), tcs: q.tcs || DASH, gap: t('q.' + q.id + '.gap', q.gap), why: t('q.' + q.id + '.why', q.why), evidence: t('q.' + q.id + '.evidence', q.evidence), recommended: t('q.' + q.id + '.recommended', q.recommended), alternatives: t('q.' + q.id + '.alternatives', q.alternatives), pending: t('q.' + q.id + '.pending', q.pending), status: q.status, comment_box: commentBoxHtml(q.id, 'q', cm, lang, q.note) }));
  const fb = (bucket) => model.findings[bucket].map((f, i) => ({ text: t('finding.' + bucket + '.' + (i + 1), f) }));
  const generic = (name, g) => (g ? { header: g.header.map((h) => ({ text: escapeHtml(h) })), rows: g.rows.map((r, i) => ({ cells: r.map((cc, j) => ({ text: t(name + '.' + (i + 1) + '.' + j, cc) })) })) } : null);
  const impl = model.implStatus;
  const vm = {
    ...C, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', is_ar: lang === 'ar', is_en: lang !== 'ar',
    feature: model.feature, scope: t('header.scope', model.scope), has_scope: !!model.scope, status: model.status, approved: model.approved, pending: !model.approved,
    generated: model.generated || DASH, lang_word: lang === 'ar' ? C.lang_ar : C.lang_en, entry: t('header.entry', model.entry), req_ids: model.reqIds,
    impl_text: t('header.impl', impl), show_impl: model.implState !== 'implemented' && !!impl,
    has_stamp: !!model.stamp, stamp_date: model.stamp ? model.stamp.date : '', stamp_scope: model.stamp ? model.stamp.scope : '', stamp_env: model.stamp ? model.stamp.env : '',
    val_by: model.stamp && model.stamp.by === '3c' ? C.val_by_cli : C.val_by,
    n_total: num(c.total), n_happy: num(c.byType['happy-path']), n_edge: num(c.byType['edge-case']), n_negative: num(c.byType.negative),
    n_per_locale: c.locales.length ? c.locales.map((l) => c.perLocale[l]).join('/') : DASH, locales: c.locales.length ? c.locales.join(', ') : DASH,
    n_smoke: num(c.smoke), n_auto: num(c.auto), v_breakdown: VALIDATION_STATES.map((s) => c.byState[s]).join('/'),
    data_tile: c.testData ? c.testData.items + ' · ' + c.testData.ready + '/' + c.testData.missing + '/' + c.testData.impossible + '/' + c.testData.unknown : DASH,
    progress_tile: c.total ? c.observed + '/' + c.total : DASH, progress_pct: c.progressPct === null ? DASH : c.progressPct + '%',
    bugs_tile: model.potentialBugs.length ? c.bugs.open + '/' + c.bugs.notChecked + '/' + c.bugs.resolved : DASH,
    has_coverage: cov.acs > 0, full_pct: cov.acs ? pct(cov.full, cov.acs) : 0, full_plus_partial_pct: cov.acs ? pct(cov.full + cov.partial, cov.acs) : 0,
    weighted_pct: cov.weighted === null ? DASH : cov.weighted + '%', n_full: num(cov.acs ? cov.full : null), n_partial: num(cov.acs ? cov.partial : null), n_none: num(cov.acs ? cov.none : null),
    acs: cov.rows.map((r, i) => { const tot = r.happy + r.neg + r.loc; const w = (x) => (tot ? Math.max(1, Math.round((x / tot) * 100)) : 0); return { ac: t('coverage.' + (i + 1) + '.ac', r.ac), req: r.req, status_word: r.status === 'full' ? C.chip_full : r.status === 'partial' ? C.chip_partial : C.chip_none, w1: w(r.happy), w2: w(r.neg), w3: w(r.loc), w4: r.status === 'full' ? 0 : Math.max(1, 100 - w(r.happy) - w(r.neg) - w(r.loc)), happy: r.happy, neg: r.neg, loc: r.loc, missing: t('coverage.' + (i + 1) + '.missing', r.missing), has_missing: r.status !== 'full' }; }),
    trace: model.trace.map((r, i) => ({ ac: t('trace.' + (i + 1) + '.ac', r.ac), req: r.req || DASH, tcs: r.tcs || DASH, status: r.status || DASH, missing: t('trace.' + (i + 1) + '.missing', r.missing || DASH), gap: r.gap })), has_trace: model.trace.length > 0,
    manual: model.manual.map((m, i) => ({ category: t('manual.' + (i + 1) + '.category', m.category), tc: m.tc, scenario: t('manual.' + (i + 1) + '.scenario', m.scenario), why: t('manual.' + (i + 1) + '.why', m.why), prio_class: 'prio-' + m.priority, priority: m.priorityText || DASH })),
    n_manual: num(c.manual.total), n_manual_high: num(c.manual.high), n_manual_medium: num(c.manual.medium), n_manual_low: num(c.manual.low),
    has_data: model.testData.present, data_items: model.testData.items.map((d, i) => ({ num: d.num || String(i + 1), name: t('data.' + (d.num || i + 1) + '.name', d.name), look: t('data.' + (d.num || i + 1) + '.look', d.look), used: d.used || DASH, status: d.status || DASH, d_class: 'd-' + (d.status || 'unknown').toLowerCase(), way: t('data.' + (d.num || i + 1) + '.way', d.way || DASH) })),
    n_data: c.testData ? String(c.testData.items) : DASH, n_ready: c.testData ? String(c.testData.ready) : DASH, n_missing: c.testData ? String(c.testData.missing) : DASH, n_impossible: c.testData ? String(c.testData.impossible) : DASH, n_unknown: c.testData ? String(c.testData.unknown) : DASH,
    problems: model.testData.problems.map((p, i) => ({ num: p.num || String(i + 1), item: p.item, problem: t('problem.' + (p.num || i + 1) + '.problem', p.problem), why: t('problem.' + (p.num || i + 1) + '.why', p.why), decision: t('problem.' + (p.num || i + 1) + '.decision', p.decision) })),
    has_existing: !!model.existing, existing: model.existing ? model.existing.rows.map((r, i) => ({ original: r[0] || DASH, disposition: t('existing.' + (i + 1) + '.1', r[1] || DASH), reason: t('existing.' + (i + 1) + '.2', r[2] || DASH) })) : [],
    tcs, has_log: model.log.rows.length > 0, log_header: model.log.header.map((h) => ({ text: escapeHtml(h) })), log_rows: model.log.rows.map((r, i) => ({ cells: r.map((cc, j) => ({ text: j >= 2 ? t('log.' + (i + 1) + '.' + j, cc) : cc })) })),
    negative: generic('negative', model.negative), standards: generic('standards', model.standards), has_selfreview: !!(model.negative || model.standards),
    has_bugs: bugs.length > 0, bugs, has_questions: questions.length > 0, questions,
    f_gaps_items: fb('gaps'), f_defects_items: fb('defects'), f_pending_items: fb('pending'), f_env_items: fb('env'), f_unclear_items: fb('unclear'), f_other_items: fb('other'),
    has_mismatch: model.mismatches.length > 0, mismatch_count: String(model.mismatches.length),
    has_orphans: c.orphans > 0,
    has_human: c.humanTcs > 0, n_human_tcs: num(c.humanTcs), n_human_steps: num(c.humanSteps),
  };
  vm.arabic_incomplete = lang === 'ar' && outstanding.length > 0;
  vm.outstanding_count = String(outstanding.length);
  return { vm, outstanding: [...new Set(outstanding)] };
}

/** The shell's generic header data for this page — meta line, banners, tiles, footer — built from the body view model. */
function shellParts(vm, C) {
  const e = escapeHtml; const ltr = (s) => '<span class="ltr">' + e(s) + '</span>'; const code = (s) => '<code>' + e(s) + '</code>';
  const meta = [
    { label: C.l_status, html: ltr(vm.status) }, { label: C.l_generated, html: ltr(vm.generated) }, { label: C.l_language, html: e(vm.lang_word) },
    { label: C.l_entry, html: vm.entry }, { label: C.l_reqids, html: ltr(vm.req_ids) },
    { label: C.l_source, html: ltr('TEST-CASES-' + vm.feature + '.md') + ' ' + e(C.l_source_note) },
    { label: C.l_validation, html: vm.has_stamp ? e(vm.val_by) + ' ' + ltr(vm.stamp_date) + ' · ' + e(C.val_scope) + ' ' + ltr(vm.stamp_scope) : e(C.val_none) },
  ];
  const banners = [];
  if (vm.arabic_incomplete) banners.push({ cls: 'preview-banner', html: e(C.preview_banner) + ' (' + ltr(vm.outstanding_count) + ')' });
  if (vm.has_mismatch) banners.push({ cls: 'warn-strip', html: '<b>!</b> ' + e(C.warn_strip) + ' (' + ltr(vm.mismatch_count) + ')' });
  if (vm.pending) banners.push({ cls: 'banner', html: '<b>' + e(C.banner_pending_title) + '</b> — ' + e(C.banner_pending_text) });
  if (vm.approved) banners.push({ cls: 'banner', html: '<b>' + e(C.banner_approved_title) + '</b> — ' + e(C.banner_approved_text) });
  if (vm.show_impl) banners.push({ cls: 'banner impl', html: '<b>' + e(C.banner_impl_title) + '</b> — ' + vm.impl_text });
  const tiles = [
    { value: vm.n_total, label_html: e(C.t_tcs), cls: '' }, { value: vm.n_happy + '/' + vm.n_edge + '/' + vm.n_negative, label_html: e(C.t_types), cls: '' },
    { value: vm.n_per_locale, label_html: e(C.t_locale) + ' (' + ltr(vm.locales) + ')', cls: '' }, { value: vm.n_smoke, label_html: e(C.t_smoke), cls: '' },
    { value: vm.n_auto, label_html: e(C.t_auto), cls: '' }, { value: vm.v_breakdown, label_html: e(C.t_validation), cls: '' },
    { value: vm.progress_tile, label_html: e(C.t_progress) + ' (' + e(vm.progress_pct) + ')', cls: '' }, { value: vm.data_tile, label_html: e(C.t_data), cls: '' },
    { value: vm.bugs_tile, label_html: e(C.t_bugs), cls: '' },
  ];
  if (vm.has_human) tiles.push({ value: vm.n_human_tcs, label_html: e(C.t_human) + ' (' + ltr(vm.n_human_steps) + ')', cls: 'human' });
  const footer = [
    e(C.footer_1) + ' ' + code('TEST-CASES-' + vm.feature + '.md') + ' ' + e(C.footer_1b),
    e(C.footer_2) + ' ' + code('TEST-DATA-' + vm.feature + '.md') + ' ' + e(C.footer_2b),
    e(C.footer_3) + ' ' + code('Status: APPROVED') + '. ' + e(C.footer_3b) + ' ' + code('link-qc-4-publish-test-cases-azure') + ' ' + e(C.footer_3c) + ' ' + code('link-qc-5-test-run-automation') + ' ' + e(C.footer_3d),
    e(C.footer_4) + ' ' + code('link-qc-3-generate-manual-test-cases --revision') + '. ' + e(C.footer_4b) + ' ' + code('link-qc-3b-validate-manual-test-cases') + ' ' + e(C.footer_4c),
  ].join('\n    ');
  return { meta, banners, tiles, footer, sub: vm.has_scope ? vm.scope : '' };
}

/* ============================================================================================
 * Provenance + self-hash
 * ========================================================================================== */
// v1.1 adds `comments=`; the group is optional so a v1.0 page still verifies and is re-rendered without --force.
const PROV_RE = /<!-- render-tc-review v[^ ]+ · source=([0-9a-f]{64}) · data=([0-9a-f]{64}|none) · strings=([0-9a-f]{64}|none)(?: · comments=([0-9a-f]{64}|none))? · lang=(\w+) · page=([0-9a-f]{64}) -->/;
const BLANK = '0'.repeat(64);
export function selfHash(html) { return sha256(html.replace(PROV_RE, (m) => m.replace(/page=[0-9a-f]{64}/, 'page=' + BLANK))); }
function stampProvenance(html, hashes) {
  const line = '<!-- render-tc-review v' + SCHEMA_VERSION + ' · source=' + hashes.source + ' · data=' + hashes.data + ' · strings=' + hashes.strings + ' · comments=' + hashes.comments + ' · lang=' + hashes.lang + ' · page=' + BLANK + ' -->';
  const withBlank = html.replace(/^(<!DOCTYPE html>\n)/, '$1' + line + '\n');
  return withBlank.replace('page=' + BLANK, 'page=' + selfHash(withBlank));
}
export function pageState(existingHtml) {
  const m = existingHtml.match(PROV_RE);
  if (!m) return { provenance: false, handEdited: false };
  return { provenance: true, handEdited: selfHash(existingHtml) !== m[6], recorded: { source: m[1], data: m[2], strings: m[3], comments: m[4] || null, lang: m[5] } };
}

/* ============================================================================================
 * Pipeline
 * ========================================================================================== */
const here = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PATH = path.join(here, '..', 'assets', 'tc-review.template.html');
export const SHELL_PATH = path.join(here, '..', 'assets', 'report-shell.template.html');
const NO_COMMENTS = () => commentsModel({ text: null, known: new Map() });

/** Two passes: the page's body partial, then the shared report shell around it. */
export function renderHtml(model, { lang = 'en', strings = null, template, shell, cm = NO_COMMENTS(), sourceRev = '' } = {}) {
  const tpl = template ?? readText(TEMPLATE_PATH);
  const shellTpl = shell ?? readText(SHELL_PATH);
  const C = CHROME[lang] || CHROME.en;
  const { vm, outstanding } = viewModel(model, lang, strings, cm);
  const body = renderNodes(compile(tpl), [vm]).replace(/\n+$/, '');
  const parts = shellParts(vm, C);
  const html = renderShell(shellTpl, { lang, dir: vm.dir, pageKind: 'tc-review', pageTitle: 'Test Cases — ' + model.feature, eyebrow: C.eyebrow, title: model.feature, ...parts, body, cm,
    feature: model.feature, page: 'TC-REVIEW-' + model.feature + '.html', source: 'TEST-CASES-' + model.feature + '.md', sourceRev, commentsFile: 'REVIEW-COMMENTS-' + model.feature + '.md' });
  const leftovers = [...new Set((html.match(/\{\{[^}]*\}\}/g) || []))];
  return { html, outstanding, leftovers };
}

export function render({ tcPath, dataPath = null, stringsPath = null, commentsPath = null, lang = 'en', template, shell, root = process.cwd(), langSource = 'default' }) {
  const compatibility = []; const warnings = []; const opts = { langSource };
  if (!tcPath || !isFile(tcPath)) return { payload: base({ root, gate: 'NOT_RUN', gateReason: tcPath ? 'TC document not found: ' + tcPath : 'no --tc given', input: { tc: tcPath || null } }), html: null, model: null };
  const tcText = readText(tcPath);
  const doc = parseTcDocument(tcText);
  const feature = doc.feature || (path.basename(tcPath).match(/^TEST-CASES-(.+)\.md$/i) || [])[1] || path.basename(tcPath, '.md');
  const dir = path.dirname(tcPath);
  const dp = dataPath || (isFile(path.join(dir, 'TEST-DATA-' + feature + '.md')) ? path.join(dir, 'TEST-DATA-' + feature + '.md') : null);
  const dataText = dp && isFile(dp) ? readText(dp) : null;
  if (dataPath && !dataText) warnings.push({ kind: 'data-file-missing', detail: 'TEST-DATA file not found: ' + dataPath });
  const data = dataText ? parseTestData(dataText) : null;
  const model = buildModel(doc, data, { feature });
  // Language: the flag decides; the document's `Review page language:` line is a record of an earlier render, never an input.
  const reviewLangHeader = model.reviewLang || null;
  const headerSays = reviewLangHeader ? (/arabic|عرب/i.test(reviewLangHeader) ? 'ar' : /english/i.test(reviewLangHeader) ? 'en' : null) : null;
  if (headerSays && headerSays !== lang) warnings.push({ kind: 'review-lang-header-stale', detail: 'header line `Review page language` says ' + (headerSays === 'ar' ? 'Arabic' : 'English') + ' but this run renders ' + (lang === 'ar' ? 'Arabic' : 'English') + ' — the line records what was rendered; the skill rewrites it' });
  if (lang === 'en') {
    const scopeShare = arabicShare([model.scope]);
    if (scopeShare !== null && scopeShare > NARRATIVE_ARABIC_THRESHOLD) warnings.push({ kind: 'narrative-not-english', id: 'header', detail: 'the Scope line is written in Arabic script — the narrative of an English page must be English (application labels may stay quoted in Arabic)' });
    for (const t of model.tcs) {
      const share = arabicShare([t.description, ...t.preconditions, ...t.steps, t.expected]);
      if (share !== null && share > NARRATIVE_ARABIC_THRESHOLD) warnings.push({ kind: 'narrative-not-english', id: t.id, detail: t.id + ' narrative is ' + Math.round(share * 100) + '% Arabic script outside quotes — write the narrative in English and keep application labels in quotes' });
    }
  }
  const sp = stringsPath || path.join(dir, 'TC-REVIEW-STRINGS-' + feature + '.ar.json');
  const stringsText = lang === 'ar' && isFile(sp) ? readText(sp) : null;
  let strings = null;
  if (lang === 'ar') { strings = stringsText ? (() => { try { return JSON.parse(stringsText); } catch (e) { model.errors.push({ kind: 'strings-unreadable', detail: sp + ': ' + e.message }); return null; } })() : null; if (!stringsText) warnings.push({ kind: 'strings-file-missing', detail: 'no Arabic strings file at ' + sp + ' — every per-story string is untranslated (preview)' }); }
  const keys = deriveKeys(model);
  // Reviewer comments — REVIEW-COMMENTS-{feature}.md beside the source, or --comments. Absent is normal and silent.
  const cp = commentsPath || path.join(dir, 'REVIEW-COMMENTS-' + feature + '.md');
  const commentsText = isFile(cp) ? readText(cp) : null;
  if (commentsPath && commentsText === null) warnings.push({ kind: 'comments-file-missing', detail: 'comments file not found: ' + path.relative(root, commentsPath) });
  const sourceRev = sha256(tcText).slice(0, 12);
  const known = new Map([...model.tcs.map((t) => [t.id, 'tc']), ...model.potentialBugs.map((b) => [b.id, 'pb']), ...model.openQuestions.map((q) => [q.id, 'q'])]);
  const cm = commentsModel({ text: commentsText, file: path.relative(root, cp), page: 'TC-REVIEW-' + model.feature + '.html', sourceRev, known });
  model.errors.push(...cm.errors); warnings.push(...cm.warnings);
  for (const x of [...model.tcs, ...model.potentialBugs, ...model.openQuestions]) if (x.note && SECRET_RE.test(x.note)) model.errors.push({ kind: 'secret-literal', line: x.line, detail: x.id + ' has a password-shaped literal in its Reviewer comment field' });
  let html = null; let outstanding = []; let leftovers = [];
  let rendered = null;
  try { rendered = renderHtml(model, { lang, strings, template, shell, cm, sourceRev }); html = rendered.html; outstanding = rendered.outstanding; leftovers = rendered.leftovers; } catch (e) { model.errors.push({ kind: 'template-error', detail: e.message }); }
  if (leftovers.length) model.errors.push({ kind: 'placeholder-left', detail: leftovers.slice(0, 10).join(' ') });
  const stale = strings && strings.keys ? Object.entries(strings.keys).filter(([k, v]) => k in keys && v.stale).map(([k]) => k) : [];
  const missing = lang === 'ar' ? outstanding : [];
  const arabicComplete = lang === 'ar' ? missing.length === 0 : null;

  let gate; let gateReason;
  if (model.errors.length) { gate = 'BLOCKED'; gateReason = model.errors.length + ' error(s) would make the page wrong: ' + [...new Set(model.errors.map((e) => e.kind))].join(', '); }
  else if (model.mismatches.length || arabicComplete === false) { gate = 'MISMATCH'; gateReason = [model.mismatches.length ? model.mismatches.length + ' header line(s) disagree with the tables' : '', arabicComplete === false ? missing.length + ' Arabic string(s) missing or stale — PREVIEW only' : ''].filter(Boolean).join('; '); }
  else { gate = 'PASS'; gateReason = model.counts.total + ' TC(s), header consistent' + (lang === 'ar' ? ', Arabic complete' : ''); }
  if (gate === 'BLOCKED') html = null;

  const hashes = { source: sha256(tcText), data: dataText ? sha256(dataText) : 'none', strings: stringsText ? sha256(stringsText) : 'none', comments: commentsText ? sha256(commentsText) : 'none', lang };
  if (html) html = stampProvenance(html, hashes);
  const payload = base({
    root, gate, gateReason,
    input: { tc: path.relative(root, tcPath) || tcPath, data: dp ? path.relative(root, dp) : null, strings: lang === 'ar' ? path.relative(root, sp) : null, comments: commentsText !== null ? path.relative(root, cp) : null, lang, feature, template: path.relative(root, TEMPLATE_PATH), shell: path.relative(root, SHELL_PATH) },
    hashes,
    counts: { ...model.counts, keys: Object.keys(keys).length, comments: { open: cm.open, handled: cm.handled } },
    comments: { file: cm.file, page: cm.page, sourceRev: cm.sourceRev, stale: cm.stale, ignored: cm.ignored, open: cm.open, handled: cm.handled,
      items: cm.entries.map((x) => ({ key: x.key, id: x.id, kind: x.id === 'General' ? 'general' : known.get(x.id) || null, status: x.status, statusDate: x.statusDate || null })),
      unknownIds: [...new Set(cm.orphans.map((x) => x.id))],
      notes: [...model.tcs, ...model.potentialBugs, ...model.openQuestions].filter((x) => x.note).map((x) => ({ id: x.id, text: x.note })) },
    document: { status: model.status, approved: model.approved, implementationStatus: model.implStatus, generated: model.generated, stamp: model.stamp, sections: doc.sectionTitles,
      reviewLangHeader, langSource: opts.langSource || 'default',
      tags: Object.fromEntries(model.tcs.filter((t) => t.tags.length).map((t) => [t.id, t.tags])), humanTcs: model.tcs.filter((t) => t.humanSteps > 0).map((t) => t.id),
      evidence: model.tcs.filter((t) => t.evidence).map((t) => ({ id: t.id, tool: t.evidence.tool || null, outcomeCheck: t.evidence['outcome-check'] || null })),
      potentialBugs: model.potentialBugs.map((b) => ({ id: b.id, tc: b.tc || null, status: b.status, screenshot: b.meta.screenshot || null })) },
    compatibility: [...compatibility, ...model.compatibility], mismatches: model.mismatches, warnings: [...warnings, ...model.warnings], errors: model.errors,
    strings: { file: lang === 'ar' ? sp : null, keys: Object.keys(keys).length, missing, stale, arabicComplete },
    arabicComplete,
  });
  return { payload, html, model, keys, feature, dir, stringsPath: sp };
}

function base(extra) {
  return { tool: TOOL, schemaVersion: SCHEMA_VERSION, readOnly: true, generatedOn: new Date().toISOString(), gate: 'NOT_RUN', gateReason: '', input: {}, counts: {}, compatibility: [], mismatches: [], warnings: [], errors: [], strings: null, arabicComplete: null, ...extra, limits: LIMITS };
}

/* ============================================================================================
 * CLI
 * ========================================================================================== */
export function main(argv) {
  const args = parseArgs(argv);
  const root = process.cwd();
  const lang = args.lang === 'ar' ? 'ar' : 'en';
  if (args.lang && args.lang !== 'ar' && args.lang !== 'en') { const p = base({ root, gate: 'NOT_RUN', gateReason: '--lang must be en or ar' }); print(p, args); return exitFor(p.gate, args); }
  const tcPath = typeof args.tc === 'string' ? path.resolve(root, args.tc) : null;
  const r = render({ tcPath, dataPath: typeof args.data === 'string' ? path.resolve(root, args.data) : null, stringsPath: typeof args.strings === 'string' ? path.resolve(root, args.strings) : null, commentsPath: typeof args.comments === 'string' ? path.resolve(root, args.comments) : null, lang, root, langSource: args.lang ? 'flag' : 'default' });
  const p = r.payload;
  p.writes = [];

  if (args['emit-keys'] && r.keys) p.keysList = Object.keys(r.keys);

  if (args['write-skeleton'] && r.keys) {
    const existing = loadStrings(r.stringsPath);
    if (existing && existing.__error) { p.errors.push({ kind: 'strings-unreadable', detail: r.stringsPath + ': ' + existing.__error }); p.gate = 'BLOCKED'; p.gateReason = 'existing strings file is not valid JSON — refusing to overwrite it'; }
    else {
      const { sidecar, report } = mergeSkeleton(existing, r.keys, r.feature);
      fs.writeFileSync(r.stringsPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf8');
      p.readOnly = false; p.writes.push({ file: path.relative(root, r.stringsPath), kind: 'strings-skeleton', ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) });
      p.skeleton = report;
    }
  }

  if (args.write && r.html && p.gate !== 'BLOCKED') {
    const out = typeof args.out === 'string' ? path.resolve(root, args.out) : path.join(r.dir, 'TC-REVIEW-' + r.feature + '.html');
    if (isFile(out)) {
      const st = pageState(readText(out));
      if (st.provenance && st.handEdited && !args.force) { p.gate = 'BLOCKED'; p.gateReason = 'existing page ' + path.relative(root, out) + ' was edited by hand after it was rendered (self-hash mismatch) — re-run with --force to overwrite it'; p.refused = { file: path.relative(root, out), reason: 'hand-edited' }; }
      else if (!st.provenance) p.warnings.push({ kind: 'legacy-page-replaced', detail: path.relative(root, out) + ' had no provenance comment (hand-written by an older skill run) — replaced' });
    }
    if (p.gate !== 'BLOCKED') { fs.writeFileSync(out, r.html, 'utf8'); p.readOnly = false; p.writes.push({ file: path.relative(root, out), kind: 'html', bytes: Buffer.byteLength(r.html, 'utf8'), preview: p.arabicComplete === false }); }
  } else if (args.write && p.gate === 'BLOCKED') p.writes.push({ file: null, kind: 'html', skipped: 'gate BLOCKED — nothing written' });

  print(p, args);
  return exitFor(p.gate, args);
}
function exitFor(gate, args) { if (!args.strict) return 0; return { PASS: 0, MISMATCH: 1, BLOCKED: 2, NOT_RUN: 3 }[gate] ?? 3; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
