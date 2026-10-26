#!/usr/bin/env node
// coverage.mjs — the arithmetic and the files of the static coverage measurement (skill 5, references/coverage.md
// <coverage_measurement> steps 3-6). Node >= 18, ESM, zero dependencies.
//
// The JUDGEMENTS stay semantic: per TC the model decides Fully / Partially / Not Covered (and the category, scenario
// and reason of every manual gap) and per requirement the outcome (Full / Partial / Missing / Assumed); it writes them
// to a judgements JSON. This script only computes from it — the weighted percentages overall and per stage, the gate
// verdict against the target, the delta against the newest earlier phase that carries a snapshot, the manual
// priorities — and produces the three CSVs, the run file's coverage_snapshot and the report's `### Coverage` block.
//
//   judgements JSON: { user_story, target?, targetSource?, mechanism?,
//                      tcs: [{ tc, title, type, stage: smoke|positive|negative, smoke, candidate: YES|NO, requirements[],
//                              status: Fully Covered|Partially Covered|Not Covered, mappedTests[], note?, category?,
//                              scenario?, whyManual?, priority?, implementation? }],     ← document order
//                      requirements: [{ id, short, outcome: Full|Partial|Missing|Assumed, assertedBy[] }] }
//
// Usage:
//   node coverage.mjs --judgements <json> [--run-file <.runs/phase-N.json>] [--results-root <dir>] [--runs <dir>] [--phase <N>]
//        [--tc-doc <TEST-CASES md>] [--target <pct>] [--target-source L3|default] [--mechanism "soft block"|"hard block"|report-only]
//        [--override] [--now <ISO>] [--csv] [--write] [--pretty] [--strict]
// Dry run unless --write: then the three CSVs replace {results_root}/coverage/*.csv and, with --run-file, the run file's
// coverage_snapshot is set. Exit 0 unless --strict: PASS / report-only / user override 0 · BELOW TARGET 1 · BLOCKED 2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, read, isFile } from './scan-lib.mjs';
import { tcDocIds } from './render-run-report.mjs';

export const SCHEMA = 'skill5-coverage/1';
export const WEIGHT = { 'Fully Covered': 1, 'Partially Covered': 0.5, 'Not Covered': 0 };
export const STAGES = ['smoke', 'positive', 'negative'];
const STAGE_TITLE = { smoke: 'Smoke', positive: 'Positive', negative: 'Negative' };
// manual-gap categories in coverage.md order, with their default priority
export const CATEGORIES = [
  ['Not an automation candidate', 'Medium'], ['Empty State (Negative)', 'High'], ['Permission / Unauthorized (Negative)', 'High'],
  ['System / Background-Job Triggered', 'Medium'], ['Display / Field Presence', 'Medium'], ['Cross-Role Specific', 'Medium'],
  ['Per-Row Enumeration & Identity', 'Low'], ['Role Variant', 'Medium'], ['Config-Skipped (coded, never runs)', 'High'], ['Completeness', 'Medium'],
];
const PRIORITY = Object.fromEntries(CATEGORIES);
const DASH = '—';
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const uniq = (xs) => [...new Set(xs)];
export const round1 = (x) => Math.round(x * 10) / 10;
const pctOf = (full, partial, total) => (total ? round1(((full + partial * 0.5) / total) * 100) : null);
export function csvField(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const csvLine = (cells) => cells.map(csvField).join(',');

function stageOf(t) {
  if (STAGES.includes(t.stage)) return t.stage;
  if (t.smoke === true || /^yes$/i.test(String(t.smoke || ''))) return 'smoke';
  return /^neg/i.test(String(t.type || '')) ? 'negative' : 'positive';
}
const isYes = (v) => v === true || /^(yes|y|true)$/i.test(String(v || ''));

/** the newest earlier phase's coverage_snapshot (.runs/phase-k.json, k < N), else a legacy coverage-previous.json */
export function previousSnapshot({ runsDir = null, phase = null, resultsRoot = null }) {
  if (runsDir && fs.existsSync(runsDir)) {
    const cands = fs.readdirSync(runsDir).map((f) => f.match(/^phase-(\d+)\.json$/)).filter(Boolean).map((m) => Number(m[1])).filter((k) => phase === null || k < phase).sort((a, b) => b - a);
    for (const k of cands) {
      let data = null; try { data = JSON.parse(fs.readFileSync(path.join(runsDir, 'phase-' + k + '.json'), 'utf8')); } catch { continue; }
      if (data && data.coverage_snapshot && data.coverage_snapshot.tcs) return { against: '.runs/phase-' + k + '.json', phase: k, snapshot: data.coverage_snapshot };
    }
  }
  for (const rel of ['coverage-previous.json', 'coverage/coverage-previous.json']) {
    const f = resultsRoot ? path.join(resultsRoot, rel) : null;
    if (!f || !isFile(f)) continue;
    let data = null; try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    const tcs = data && (data.tcs || (data.coverage_snapshot && data.coverage_snapshot.tcs));
    if (tcs) return { against: rel + ' (legacy, read-only)', phase: null, snapshot: { weightedPct: data.weightedPct ?? (data.coverage_snapshot && data.coverage_snapshot.weightedPct) ?? null, tcs } };
  }
  return null;
}

export function computeCoverage(j, { target = null, targetSource = null, mechanism = null, override = false, previous = null, now = null, docIds = null } = {}) {
  const errors = []; const warnings = [];
  const tcs = Array.isArray(j && j.tcs) ? j.tcs : [];
  const reqs = Array.isArray(j && j.requirements) ? j.requirements : [];
  if (!tcs.length) errors.push('judgements carry no tcs[]');
  const seen = new Set();
  for (const t of tcs) {
    if (!t.tc) errors.push('a judgement without a tc id');
    else if (seen.has(t.tc)) errors.push(t.tc + ' judged twice'); else seen.add(t.tc);
    if (!(t.status in WEIGHT)) errors.push((t.tc || '?') + ': status "' + t.status + '" is not Fully Covered / Partially Covered / Not Covered');
  }
  for (const r of reqs) if (!['Full', 'Partial', 'Missing', 'Assumed'].includes(r.outcome)) errors.push((r.id || '?') + ': outcome "' + r.outcome + '" is not Full / Partial / Missing / Assumed');
  const missing = docIds ? docIds.filter((id) => !seen.has(id)) : [];
  const extra = docIds ? [...seen].filter((id) => !docIds.includes(id)) : [];
  if (missing.length) errors.push('TCs of the approved document without a judgement: ' + missing.join(', '));
  if (extra.length) warnings.push('judged TCs not in the approved document: ' + extra.join(', '));
  const tgt = Number(target ?? j.target ?? 80); const src = targetSource || j.targetSource || 'default'; const mech = mechanism || j.mechanism || 'soft block';
  const count = (list) => { const c = { total: list.length, full: 0, partial: 0, none: 0 }; for (const t of list) { if (t.status === 'Fully Covered') c.full++; else if (t.status === 'Partially Covered') c.partial++; else c.none++; } return { ...c, weightedPct: pctOf(c.full, c.partial, c.total) }; };
  const byStage = {};
  for (const s of STAGES) { const list = tcs.filter((t) => stageOf(t) === s); if (list.length) byStage[s] = count(list); }
  const total = count(tcs);
  const pct = total.weightedPct;
  let verdict;
  if (mech === 'report-only') verdict = 'report-only';
  else if (pct !== null && pct >= tgt) verdict = 'PASS';
  else if (override) verdict = 'user override';
  else verdict = mech === 'hard block' ? 'BLOCKED' : 'BELOW TARGET';
  // manual gaps
  const manualRows = tcs.filter((t) => t.status !== 'Fully Covered').map((t) => {
    const category = t.category || (t.status === 'Not Covered' && !isYes(t.candidate) ? 'Not an automation candidate' : 'Completeness');
    if (!PRIORITY[category]) warnings.push((t.tc || '?') + ': category "' + category + '" is not one of the coverage.md categories');
    return { t, category, priority: t.priority || PRIORITY[category] || 'Medium' };
  });
  const manual = { total: manualRows.length, high: manualRows.filter((x) => x.priority === 'High').length, medium: manualRows.filter((x) => x.priority === 'Medium').length, low: manualRows.filter((x) => x.priority === 'Low').length };
  // delta against the previous snapshot
  let delta = { against: null, pctChange: null, improved: [], regressed: [], added: [], removed: [] };
  if (previous && previous.snapshot) {
    const prev = previous.snapshot.tcs || {};
    const cur = Object.fromEntries(tcs.map((t) => [t.tc, t.status]));
    const w = (s) => WEIGHT[s] ?? 0;
    delta = {
      against: previous.against, pctChange: previous.snapshot.weightedPct !== null && previous.snapshot.weightedPct !== undefined && pct !== null ? round1(pct - previous.snapshot.weightedPct) : null,
      improved: Object.keys(cur).filter((id) => id in prev && w(cur[id]) > w(prev[id])).sort(natural), regressed: Object.keys(cur).filter((id) => id in prev && w(cur[id]) < w(prev[id])).sort(natural),
      added: Object.keys(cur).filter((id) => !(id in prev)).sort(natural), removed: Object.keys(prev).filter((id) => !(id in cur)).sort(natural),
    };
  }
  const reqTotals = { total: reqs.length, full: reqs.filter((r) => r.outcome === 'Full').length, partial: reqs.filter((r) => r.outcome === 'Partial').length, missing: reqs.filter((r) => r.outcome === 'Missing').length, assumed: reqs.filter((r) => r.outcome === 'Assumed').length };
  const snapshot = {
    measuredAt: now || new Date().toISOString(), weightedPct: pct, target: tgt, targetSource: src, mechanism: mech, verdict,
    byStage, tcs: Object.fromEntries(tcs.map((t) => [t.tc, t.status])), requirements: reqs.map((r) => ({ id: r.id, short: r.short ?? null, outcome: r.outcome, assertedBy: r.assertedBy || [] })), manual, delta,
  };
  // the three CSVs (coverage.md step 5 — exact headers)
  const story = j.user_story || DASH;
  const reqIdsOf = (list) => uniq(list.flatMap((t) => t.requirements || [])).sort(natural).join(', ');
  const automated = (list) => list.filter((t) => t.status !== 'Not Covered' && (t.mappedTests || []).length).length;
  const fmtPct = (x) => (x === null ? '' : String(x));
  const presentCats = CATEGORIES.map(([c]) => c).filter((c) => manualRows.some((x) => x.category === c));
  const otherCats = uniq(manualRows.map((x) => x.category)).filter((c) => !PRIORITY[c]);
  const summary = [
    csvLine(['User Story', 'Requirement ID(s)', 'Stage', 'Total TCs', 'Fully Covered', 'Partially Covered', 'Not Covered', 'Weighted Coverage %', 'Distinct Automated TC-IDs']),
    ...STAGES.filter((s) => byStage[s]).map((s) => { const list = tcs.filter((t) => stageOf(t) === s); const c = byStage[s]; return csvLine([story, reqIdsOf(list), STAGE_TITLE[s], c.total, c.full, c.partial, c.none, fmtPct(c.weightedPct), automated(list)]); }),
    csvLine([story, reqIdsOf(tcs), 'TOTAL', total.total, total.full, total.partial, total.none, fmtPct(pct), automated(tcs)]),
    '', 'Legend',
    csvLine(['Fully Covered', '1.0', 'a test asserts the TC\'s expected result end-to-end and actually runs']),
    csvLine(['Partially Covered', '0.5', 'automation exists but is weaker than the TC']),
    csvLine(['Not Covered', '0.0', 'no test exercises the scenario (incl. manual — not automated)']),
    '', 'Notes',
    csvLine(['1', 'weighted % = (full × 1.0 + partial × 0.5) / total × 100 (one decimal)']),
    csvLine(['2', 'target ' + tgt + '% (' + src + ') — ' + mech]),
    csvLine(['3', 'role loops and data gates mean an automated TC-ID is not always a test that executes']),
    csvLine(['4', 'manual-gap categories present: ' + ([...presentCats, ...otherCats].join('; ') || 'none')]),
  ].join('\n') + '\n';
  const outcomeOf = (t) => { const ids = t.requirements || []; const os = ids.map((id) => [id, (reqs.find((r) => r.id === id) || {}).outcome || DASH]); return os.length === 1 ? os[0][1] : os.map(([id, o]) => id + ': ' + o).join('; ') || DASH; };
  const detail = [
    csvLine(['User Story', 'Requirement ID(s)', 'TC-ID', 'Test Case Title', 'Type', 'Smoke', 'Automation Candidate', 'Coverage Status', 'Requirement Outcome Coverage', 'Mapped Test(s)', 'Manual Testing Recommended', 'Notes / Recommendation']),
    ...tcs.map((t) => csvLine([story, (t.requirements || []).join(', '), t.tc, t.title || DASH, t.type || DASH, isYes(t.smoke) || stageOf(t) === 'smoke' ? 'Yes' : 'No', isYes(t.candidate) ? 'YES' : 'NO', t.status, outcomeOf(t), (t.mappedTests || []).join('; ') || '-', t.status === 'Fully Covered' ? 'No' : 'Yes', t.note || '-'])),
  ].join('\n') + '\n';
  const order = [...CATEGORIES.map(([c]) => c), ...otherCats];
  const manualCsv = [
    csvLine(['Category', 'User Story', 'TC-ID', 'Scenario', 'Why Manual', 'Priority']),
    ...order.flatMap((c) => manualRows.filter((x) => x.category === c).map((x) => csvLine([c, story, x.t.tc, x.t.scenario || x.t.title || DASH, x.t.whyManual || x.t.note || '-', x.priority]))),
  ].join('\n') + '\n';
  // the report's `### Coverage` block
  const row = (name, c) => '| ' + name + ' | ' + c.total + ' | ' + c.full + ' | ' + c.partial + ' | ' + c.none + ' | ' + (c.weightedPct === null ? DASH : c.weightedPct) + ' |';
  const sign = (x) => (x > 0 ? '+' + x : String(x));
  let deltaText;
  if (!delta.against) deltaText = '**Δ:** no prior measurement';
  else {
    const parts = [];
    if (delta.improved.length) parts.push('improved ' + delta.improved.join(', '));
    if (delta.regressed.length) parts.push('regressed ' + delta.regressed.join(', '));
    if (delta.added.length) parts.push('TCs added +' + delta.added.length + ' (' + delta.added.join(', ') + ')');
    if (delta.removed.length) parts.push('TCs removed -' + delta.removed.length + ' (' + delta.removed.join(', ') + ')');
    deltaText = '**Δ vs ' + (previous.phase ? 'phase ' + previous.phase : delta.against) + ':** ' + (delta.pctChange === null ? DASH : sign(delta.pctChange) + ' pts') + (parts.length ? ' — ' + parts.join(' · ') : ' — no TC changed');
  }
  const fragment = [
    '| Stage | Total TCs | Fully | Partially | Not | Weighted % |', '|---|---|---|---|---|---|',
    ...STAGES.filter((s) => byStage[s]).map((s) => row(STAGE_TITLE[s], byStage[s])), row('**Total**', total), '',
    '**Target:** ' + tgt + '% (' + src + ', ' + mech + ') — **' + verdict + '** · ' + deltaText, '',
    '| Requirement | Outcome | Asserted by |', '|---|---|---|',
    ...reqs.map((r) => '| ' + r.id + ' | ' + r.outcome + ' | ' + ((r.assertedBy || []).join(', ') || DASH) + ' |'),
  ].join('\n');
  const verdictLog = verdict === 'BELOW TARGET' ? 'BELOW TARGET → repairing' : verdict === 'user override' ? 'BELOW TARGET → user override' : verdict;
  const logLine = 'Validating Automation Code — coverage: ' + (pct === null ? DASH : pct) + '% weighted (Full ' + total.full + ' · Partial ' + total.partial + ' · None ' + total.none + ') — target ' + tgt + '% (' + src + ') — ' + verdictLog;
  return {
    outcome: errors.length ? 'BLOCKED' : 'OK', verdict, weightedPct: pct, target: tgt, targetSource: src, mechanism: mech, byStage, totals: total, requirements: reqTotals, manual, delta,
    gaps: tcs.filter((t) => t.status !== 'Fully Covered' && isYes(t.candidate)).map((t) => t.tc), missingTcs: missing, snapshot, fragment, logLine, csv: { summary, detail, manual: manualCsv }, errors, warnings,
  };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function coverage(args) {
  const head = { tool: 'coverage', schema: SCHEMA };
  const jf = typeof args.judgements === 'string' ? path.resolve(args.judgements) : null;
  if (!jf || !isFile(jf)) return { ...head, outcome: 'BLOCKED', verdict: null, reason: '--judgements must name the judgements JSON' };
  let j; try { j = JSON.parse(read(jf)); } catch (e) { return { ...head, outcome: 'BLOCKED', verdict: null, reason: 'judgements JSON unreadable: ' + e.message }; }
  const runFile = typeof args['run-file'] === 'string' ? path.resolve(args['run-file']) : null;
  let run = null; if (runFile && isFile(runFile)) { try { run = JSON.parse(read(runFile)); } catch { run = null; } }
  const rr = typeof args['results-root'] === 'string' ? path.resolve(args['results-root']) : runFile && path.basename(path.dirname(runFile)) === '.runs' ? path.dirname(path.dirname(runFile)) : null;
  const runsDir = typeof args.runs === 'string' ? path.resolve(args.runs) : runFile ? path.dirname(runFile) : rr ? path.join(rr, '.runs') : null;
  const phase = Number(args.phase) || (run && Number(run.phase)) || (runFile && Number((path.basename(runFile).match(/phase-(\d+)/) || [])[1])) || null;
  const docText = typeof args['tc-doc'] === 'string' ? read(path.resolve(args['tc-doc'])) : null;
  if (typeof args['tc-doc'] === 'string' && docText === null) return { ...head, outcome: 'BLOCKED', verdict: null, reason: '--tc-doc not found' };
  const previous = previousSnapshot({ runsDir, phase, resultsRoot: rr });
  const r = computeCoverage(j, { target: args.target !== undefined && args.target !== true ? Number(args.target) : null, targetSource: typeof args['target-source'] === 'string' ? args['target-source'] : null, mechanism: typeof args.mechanism === 'string' ? args.mechanism : null, override: !!args.override, previous, now: typeof args.now === 'string' ? args.now : null, docIds: docText ? tcDocIds(docText) : null });
  const out = { ...head, outcome: r.outcome, verdict: r.verdict, weightedPct: r.weightedPct, target: r.target, targetSource: r.targetSource, mechanism: r.mechanism, byStage: r.byStage, totals: r.totals, requirements: r.requirements, manual: r.manual, delta: r.delta, gaps: r.gaps, missingTcs: r.missingTcs,
    logLine: r.logLine, fragment: r.fragment, snapshot: r.snapshot, csvBytes: { summary: Buffer.byteLength(r.csv.summary), detail: Buffer.byteLength(r.csv.detail), manual: Buffer.byteLength(r.csv.manual) }, errors: r.errors, warnings: r.warnings, writes: [] };
  if (args.csv) out.csv = r.csv;
  if (args.write) {
    if (r.outcome !== 'OK') { out.writes.push({ file: null, skipped: 'BLOCKED — nothing written' }); return out; }
    if (!rr) { out.outcome = 'BLOCKED'; out.reason = '--write needs --results-root (or a --run-file under .runs/)'; return out; }
    for (const [name, text] of [['coverage-summary.csv', r.csv.summary], ['coverage-detail.csv', r.csv.detail], ['manual-scenarios.csv', r.csv.manual]]) { const f = path.join(rr, 'coverage', name); writeAtomic(f, text); out.writes.push({ file: path.relative(process.cwd(), f).split(path.sep).join('/'), bytes: Buffer.byteLength(text) }); }
    if (run && runFile) { writeAtomic(runFile, JSON.stringify({ ...run, coverage_snapshot: r.snapshot }, null, 2) + '\n'); out.writes.push({ file: path.relative(process.cwd(), runFile).split(path.sep).join('/'), field: 'coverage_snapshot' }); }
  }
  return out;
}

const HELP = {
  tool: 'coverage', schema: SCHEMA,
  usage: 'node coverage.mjs --judgements <json> [--run-file <.runs/phase-N.json>] [--results-root <dir>] [--runs <dir>] [--phase <N>] [--tc-doc <TEST-CASES md>] [--target <pct>] [--target-source L3|default] [--mechanism "soft block"|"hard block"|report-only] [--override] [--now <ISO>] [--csv] [--write] [--pretty] [--strict]',
  notes: ['Judgements stay semantic (the model writes them); this script computes, compares and writes.', 'Dry run unless --write.', '--strict: PASS / report-only / user override 0 · BELOW TARGET 1 · BLOCKED 2.'],
};
const STRICT = { PASS: 0, 'report-only': 0, 'user override': 0, 'BELOW TARGET': 1, BLOCKED: 2 };

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const payload = coverage(args);
  print(payload, args);
  return args.strict ? (payload.outcome !== 'OK' ? 2 : STRICT[payload.verdict] ?? 2) : 0;
}
const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  try { process.exit(main()); } catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'coverage', schema: SCHEMA, outcome: 'BLOCKED', reason: 'internal error: ' + e.message }, args);
    process.exit(args.strict ? 2 : 0);
  }
}
