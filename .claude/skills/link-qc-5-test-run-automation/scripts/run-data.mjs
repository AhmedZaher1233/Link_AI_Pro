#!/usr/bin/env node
// run-data.mjs — the deterministic half of "Preparing Final Report" (skill 5): the run-file blocks, the report numbers,
// the readiness table, the handoff view, the runtime-evidence checks of Checkpoint B, the run-level acceptance and the
// draft → publish step. Node >= 18, ESM, zero dependencies.
//
// The model still owns every judgement — classification, root cause, severity, assumptions, the Heal Log, Deviations,
// bugs, the resolution of a concurrency finding; this script owns the arithmetic and never overwrites those fields.
//
//   merge       stage summaries + stage JSONs + heartbeats → {run_file}.merged, results[], stages, totals,
//               variant_totals, parallel_checks, rate_limit, watchdog_events, timeouts.events, concurrency, smoke_gate
//               (references/final-run.md <second_run> steps 2-3). Dry run unless --write.
//   report      the markdown fragments of the phase: header lines, run-history row, Stages table + smoke-gate line,
//               Results table, the one-line Run bullets (Re-run · Isolation checks · Rate limits · Acceptance).
//   readiness   the `### Test-data readiness` block from {run_file}.data_readiness.
//   handoff     a compact structured view of the phase for a fresh session or a subagent.
//   verify      the runtime-evidence checks of Checkpoint B (16b 18 22 23 25b 31-34 37 38 43 45 46b 48a 48b 50 +
//               results freshness); with --snapshot one protocol record per check is appended to
//               artifacts/checks/{snapshot}/results.jsonl (executor S, unit phase).
//   acceptance  the run-level acceptance (Revision 3.1 §3.8): ACCEPTED / NOT ACCEPTED with reasons; pre-gate (no gate
//               record B yet — conditional on Checkpoint B PASS) or final; --write stores it in the run file.
//   draft-init  artifacts/drafts/phase-N/ seeded with the published report, bug file and run files.
//   publish     after Checkpoint B PASS: every frozen draft promoted byte-identical, the page rendered from the promoted
//               files + the gate record, and a dry re-render that must reproduce the page byte for byte.
//
// Usage:
//   node run-data.mjs merge|report|readiness|handoff|verify|acceptance --run-file <.runs/phase-N.json | artifacts/drafts/phase-N/.runs/phase-N.json>
//        [--results-root <dir>] [--automation-root <dir>] [--write] [--snapshot <id>] [--learning <project-learning.md>]
//        [--report <TEST-RUN-REPORT md>] [--published] [--pretty] [--strict]
//   node run-data.mjs draft-init --results-root <dir> --phase <N> [--feature <f>] [--force] [--pretty]
//   node run-data.mjs publish --results-root <dir> --phase <N> [--feature <f>] [--force] [--pretty] [--strict]
// Exit 0 unless --strict: merge OK 0 · BLOCKED 2 | verify PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3 |
// acceptance ACCEPTED 0 · NOT ACCEPTED 1 · BLOCKED 2 | publish PUBLISHED 0 · REFUSED 1 · FAILED 2 · NOT_RUN 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, print, posix, read, isFile, isDir } from './scan-lib.mjs';
import { render, pageState } from './render-run-report.mjs';
import { checkRecordFile, scanForSecrets } from './redact.mjs';
import { parseTcDocument } from './tc-hash.mjs';
import { coverageFragment } from './coverage.mjs';

export const SCHEMA = 'skill5-run-data/1';
export const RUN_SCHEMA = 'skill6-run/1';
export const GATE_SCHEMA = 'skill5-gate/1';
const STAGE_ORDER = ['smoke', 'positive', 'negative'];
const STAGE_TITLE = { smoke: 'Smoke', positive: 'Positive', negative: 'Negative' };
const DASH = '—';
// a credential written with its value — the renderer's rule plus the words run-stage.mjs withholds; never printed back
const SECRET_RE = /\b(password|passcode|passwd|pwd|secret|token|pat|api[-_ ]?key|authorization)\b\s*(?:[:=]|is)\s*["'`]?(?!\[redacted\]|<)[^\s"'`]{3,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:[^\s@/'"]+@/i;
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;
// classification values this script writes itself — recomputed on every merge; anything else is the model's and kept
const MECHANICAL_CLASS = /^(?:incomplete|interrupted|not started|out of tool):|^rate_limited$|^human step:|^(?:data_write_refused|data_write_failed|data_in_doubt|read_back_mismatch|redirect_refused|auth_failure|evidence_invalid|cleanup_incomplete)\b/i;
// NOT_RUN / INCOMPLETE reasons that make a run NOT ACCEPTED (Revision 3.1 §3.8)
const CAPACITY_REASON = /^(?:not started:\s*(?:admission timeout|host pressure|deferred until|environment lease|no safe coordination)|interrupted:\s*wait budget exhausted)/i;
// 3.0 — a required API / DB TC that never started for a reason the run must fix (never the tester's own "no")
const BACKEND_REASON = /^(?:not started:\s*(?:mapping unresolved|db unavailable|config missing|layer unknown)|data_in_doubt|evidence_invalid)/i;
const CONSENT_REASON = /^not started:\s*data changes not permitted/i;

/* ---------------- test layers (3.0) — run_plan.layers {TC: ui|hybrid|api|db|api+db}, from tc-hash tcLayer ---------------- */
export const layerOfTc = (run, tc) => ((run && run.run_plan && run.run_plan.layers) || {})[tc] || 'ui';
export const needsImageLayer = (l) => l === 'ui' || l === 'hybrid' || l === 'unknown';
export const needsRecordLayer = (l) => l === 'api' || l === 'db' || l === 'api+db' || l === 'hybrid';
const isBackendLayer = (l) => l === 'api' || l === 'db' || l === 'api+db';
/** The Playwright project a TC runs in: the backend project for api / db / api+db, else the (first) browser project. */
export function defaultProjectFor(run, tc) {
  const projects = (run && run.run_plan && run.run_plan.projects) || [];
  const backend = (run && run.run_plan && run.run_plan.backend_project) || 'backend';
  if (isBackendLayer(layerOfTc(run, tc))) return backend;
  return projects.find((p) => p !== backend) || 'chromium';
}
const isRecordPath = (p) => /\.record\.json$/i.test(String(p || ''));

/* ---------------- delivery (3.1) — the run's two intake choices, {run_file}.delivery { report, screenshots, source } ----------------
   report: html (the markdown + the rendered page — the default) · md (markdown only: the renderer still checks the drafts, no
   page is written). screenshots: all (assertion-point image for every executed attempt — the default) · failed (images only
   for a failing attempt) · none (no image; API / DB records are not screenshots and are always written). Absent → the
   defaults, so a run file written before 3.1 reads exactly as before. */
export const REPORT_FORMATS = ['html', 'md'];
export const SCREENSHOT_POLICIES = ['all', 'failed', 'none'];
export function deliveryOf(run) {
  const d = (run && run.delivery) || {};
  return { report: REPORT_FORMATS.includes(d.report) ? d.report : 'html', screenshots: SCREENSHOT_POLICIES.includes(d.screenshots) ? d.screenshots : 'all', source: d.source || 'default' };
}
/** Is an assertion-point image owed for an attempt with this status under the run's screenshot choice? */
export function imageOwed(policy, status) {
  if (policy === 'none') return false;
  if (policy === 'failed') return status === 'FAIL';
  return ['PASS', 'FAIL', 'PARTIAL'].includes(status);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const uniq = (xs) => [...new Set(xs)];
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const ms = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };
const readdirSafe = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const shaBytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const shaFile = (p) => shaBytes(fs.readFileSync(p));
const shaTextLf = (p) => shaBytes(Buffer.from(fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n'), 'utf8'));
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
// 3.0 — `environment` may be an object { name, class, api_hosts, … } (API / DB runs); the report shows its name
const envName = (e) => (e && typeof e === 'object' ? (e.name ?? null) : e);
const cellOf = (v) => (v === null || v === undefined || v === '' ? DASH : String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
const filterLine = (line) => (SECRET_LINE.test(line) ? '[line withheld: it looks like a credential]' : line);
const isAbs = (p) => /^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(String(p));

export function hhmmss(msVal) {
  if (msVal === null || msVal === undefined || Number.isNaN(Number(msVal))) return DASH;
  const s = Math.max(0, Math.round(Number(msVal) / 1000));
  const two = (n) => String(n).padStart(2, '0');
  return two(Math.floor(s / 3600)) + ':' + two(Math.floor((s % 3600) / 60)) + ':' + two(s % 60);
}

function readJson(file) {
  const text = read(file);
  if (text === null) return { data: null, error: 'not found: ' + file };
  try { return { data: JSON.parse(text), error: null, text }; } catch (e) { return { data: null, error: 'not valid JSON: ' + e.message, text }; }
}
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}
function writeBytesAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}
function jsonl(file) {
  const out = [];
  for (const line of (read(file) || '').split(/\r?\n/)) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line never decides anything here */ } }
  return out;
}

/* ---------------- paths — references/schemas/paths-and-evidence.md ---------------- */

/**
 * The canonical stored form of a run-file path: POSIX, relative to the automation root, no `./`, no trailing slash.
 * Accepts the canonical form, a project-relative one (`Testing/Automation/screenshots/…` — its leading segments are the
 * automation root's own trailing segments) and an absolute one. run-stage.mjs keeps an inline copy ("keep in step").
 */
export function canonicalPath(value, automationRoot) {
  if (value === null || value === undefined || value === '') return value ?? null;
  const s = posix(String(value)).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (isAbs(s)) return posix(path.relative(automationRoot, s)) || '.';
  if (fs.existsSync(path.join(automationRoot, s))) return s;
  const segs = s.split('/');
  const ar = posix(path.resolve(automationRoot)).toLowerCase();
  for (let k = segs.length - 1; k >= 1; k--) if (ar.endsWith('/' + segs.slice(0, k).join('/').toLowerCase())) return segs.slice(k).join('/');
  return s;
}
const PATH_KEYS = ['results_root', 'screenshots_root', 'logs_root', 'progress_log'];
/** The run file's path fields in their canonical form, with a note per value that was not. */
export function canonicalRunPaths(run, automationRoot) {
  const notes = [];
  const out = {};
  for (const k of PATH_KEYS) {
    if (run[k] === undefined || run[k] === null || run[k] === '') continue;
    const c = canonicalPath(run[k], automationRoot);
    const was = posix(String(run[k])).replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (c !== was) notes.push({ kind: 'paths-normalized', field: k, detail: k + ' "' + run[k] + '" stored as "' + c + '" (relative to the automation root)' });
    out[k] = c;
  }
  return { paths: out, notes };
}

/* ---------------- locating the phase ---------------- */

// {rr}/.runs/phase-N.json or {rr}/artifacts/drafts/phase-N/.runs/phase-N.json → {rr}
function resultsRootOf(runFile) {
  const d1 = path.dirname(runFile);
  if (path.basename(d1) !== '.runs') return null;
  const d2 = path.dirname(d1);
  if (/^phase-\d+$/.test(path.basename(d2)) && path.basename(path.dirname(d2)) === 'drafts' && path.basename(path.dirname(path.dirname(d2))) === 'artifacts') return path.dirname(path.dirname(path.dirname(d2)));
  return d2;
}
export function locate({ runFile, resultsRoot = null, automationRoot = null }) {
  const errors = [];
  const rf = runFile ? path.resolve(runFile) : null;
  if (!rf || !isFile(rf)) return { errors: ['--run-file must name the phase run file (.runs/phase-N.json or its draft)'] };
  const { data: run, error } = readJson(rf);
  if (!run) return { errors: ['run file unreadable: ' + error] };
  if (run.schema !== RUN_SCHEMA) errors.push('run file schema "' + run.schema + '", expected ' + RUN_SCHEMA);
  const rr = resultsRoot ? path.resolve(resultsRoot) : resultsRootOf(rf);
  if (!rr) return { errors: ['cannot derive the results root from ' + rf + ' — pass --results-root'] };
  // the automation root: explicit → the folder results_root is relative to, when it holds the project's Playwright config
  // (results_root may have been stored project-relative — then that folder is the PROJECT root, not the automation root)
  // → the folder above the `reports/` segment → two levels up
  let ar = automationRoot ? path.resolve(automationRoot) : null;
  const rel = posix(String(run.results_root || '')).replace(/^\.\/+/, '').replace(/\/+$/, '');
  const hasConfig = (d) => ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].some((x) => isFile(path.join(d, 'playwright.config.' + x)));
  const viaRel = rel && !isAbs(rel) && posix(rr).toLowerCase().endsWith('/' + rel.toLowerCase()) ? rr.slice(0, rr.length - rel.length - 1) : null;
  const viaReports = (() => { const p = posix(rr); const i = p.toLowerCase().lastIndexOf('/reports/'); return i > 0 ? rr.slice(0, i) : null; })();
  if (!ar && viaRel && hasConfig(viaRel)) ar = viaRel;
  if (!ar && viaReports) ar = viaReports;
  if (!ar && viaRel) ar = viaRel;
  if (!ar) ar = path.resolve(rr, '..', '..');
  const rrRel = posix(path.relative(ar, rr));
  if (rel && rel !== rrRel) errors.push('results_root "' + run.results_root + '" is not the canonical "' + rrRel + '" (relative to the automation root ' + posix(ar) + ') — merge --write stores the canonical form');
  const phase = Number(run.phase) || Number((path.basename(rf).match(/phase-(\d+)/) || [])[1]) || null;
  return { errors, runFile: rf, run, resultsRoot: rr, automationRoot: ar, rrRel, phase, isDraft: /[\\/]artifacts[\\/]drafts[\\/]phase-\d+[\\/]\.runs[\\/]/.test(rf) };
}

export function loadSummaries(resultsRoot) {
  const dir = path.join(resultsRoot, 'artifacts', 'progress');
  const out = [];
  for (const f of readdirSafe(dir).filter((x) => /^(first|rerun)-[a-z]+-\d+\.summary\.json$/.test(x))) {
    const { data } = readJson(path.join(dir, f));
    if (data) out.push({ ...data, _file: f });
  }
  return out.sort((a, b) => (ms(a.startedAt) || 0) - (ms(b.startedAt) || 0) || (a.seq || 0) - (b.seq || 0));
}

/* ---------------- the raw Playwright JSON (mirrors run-stage.mjs collectTests / markFollowers — keep in step) ---------------- */

export function tcIdsOf(text) {
  const ids = [];
  for (const m of String(text || '').matchAll(/\[([^\]]+)\]/g)) for (const part of m[1].split(',')) { const t = part.trim(); if (/^TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(t) && !ids.includes(t)) ids.push(t); }
  return ids;
}
export function collectRows(report) {
  const out = [];
  const walk = (suite, titles) => {
    const t = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      const seen = new Map();
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1] || null;
        let status;
        if (!last) status = 'NOT_RUN';
        else if (last.status === 'interrupted') status = 'INCOMPLETE';
        else if (last.status === 'skipped') status = 'SKIP';
        else if (test.expectedStatus === 'failed') status = last.status === 'passed' ? 'FAIL' : 'XFAIL';
        else status = last.status === 'passed' ? 'PASS' : 'FAIL';
        const rawErr = last && ((last.error && last.error.message) || ((last.errors || [])[0] && last.errors[0].message)) || null;
        const project = test.projectName || null;
        const repeat = seen.get(project) || 0;
        seen.set(project, repeat + 1);
        const tags = (spec.tags || []).map((x) => (String(x).startsWith('@') ? String(x) : '@' + x));
        const annotations = [...(test.annotations || []), ...((last && last.annotations) || [])].filter((x) => x && x.type).map((x) => ({ type: String(x.type), description: x.description ?? null }));
        out.push({
          // the execution identity of this result: project + repeat (order within the spec) + retry + worker slot + start
          startTime: (last && last.startTime) || null, parallelIndex: last && typeof last.parallelIndex === 'number' ? last.parallelIndex : null, retry: last && typeof last.retry === 'number' ? last.retry : null,
          title: spec.title, file: spec.file || suite.file || null, suite: t.join(' > '), project, repeat, status, tags, annotations,
          duration_ms: results.reduce((a, r) => a + (r.duration || 0), 0), tcs: tcIdsOf(spec.title), expectedFailure: test.expectedStatus === 'failed',
          unverifiedAssumption: tags.includes('@unverified-assumption') || /@unverified-assumption/.test(spec.title),
          error: rawErr ? filterLine(String(rawErr).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((l) => l.trim()) || '').slice(0, 200) : null,
        });
      }
    }
    for (const s of suite.suites || []) walk(s, t);
  };
  for (const s of (report && report.suites) || []) walk(s, []);
  // a serial-chain follower Playwright skipped after a failed test of the same describe is NOT_RUN, never SKIP
  const firstFail = new Map();
  for (const r of out) {
    if (r.status === 'FAIL' && !firstFail.has(r.suite)) firstFail.set(r.suite, r.tcs[0] || r.title);
    else if (r.status === 'SKIP' && firstFail.has(r.suite) && !r.annotations.some((a) => /^(skip|fixme)$/i.test(a.type))) { r.status = 'NOT_RUN'; r.follower = firstFail.get(r.suite); }
  }
  return out;
}

// the run plan after the append-only run_plan_adjustments[] (mirrors run-stage.mjs applyAdjustments); `until` limits
// the adjustments to those recorded at or before that time (entries without `at` always apply)
export function planAt(plan, adjustments, until = null) {
  const p = JSON.parse(JSON.stringify(plan || { groups: [] }));
  if (!Array.isArray(p.groups)) p.groups = [];
  for (const a of adjustments || []) {
    if (!a || typeof a !== 'object') continue;
    if (until !== null && a.at && ms(a.at) !== null && ms(a.at) > until) continue;
    if (a.kind === 'move' && a.tc && a.to) {
      for (const g of p.groups) g.tcs = (g.tcs || []).filter((x) => x !== a.tc);
      let to = p.groups.find((g) => g.name === a.to);
      if (!to) { to = { name: a.to, mode: 'serial', workers: 1, tcs: [], reason: a.reason || 'moved by an adjustment' }; p.groups.push(to); }
      to.tcs.push(a.tc);
    } else if (a.kind === 'workers' && a.group && Number(a.to) > 0) {
      const g = p.groups.find((x) => x.name === a.group);
      if (g) g.workers = Number(a.to);
    }
  }
  return p;
}
const groupOf = (plan, tc) => (plan.groups || []).find((g) => (g.tcs || []).includes(tc)) || null;
const plannedWorkers = (plan, g) => (g ? (g.workers || (g.mode === 'parallel' ? (plan.workers_parallel || 2) : 1)) : null);

/* ---------------- heartbeats ---------------- */

// test spans per worker (test-start … test-end) with the records inside them
export function heartbeatSpans(file) {
  const spans = [];
  const open = new Map();
  let teardowns = 0; let consoleReports = 0; let evidence = 0;
  for (const r of jsonl(file)) {
    const at = ms(r.at);
    if (at === null || typeof r.worker !== 'number') continue;
    const tc = typeof r.tc === 'string' ? r.tc : Array.isArray(r.tc) ? r.tc.join(',') : '';
    if (r.event === 'teardown') teardowns++;
    if (r.event === 'console-report') consoleReports++;
    if (r.event === 'evidence') evidence++;
    // the execution identity a span carries (newer progress reporters): project, retry, repeat — null when not recorded
    if (r.event === 'test-start') { const s = { id: spans.length, worker: r.worker, tc, tcs: tc.split(',').map((x) => x.trim()).filter(Boolean), start: at, end: null, status: null, project: r.project ?? null, retry: typeof r.retry === 'number' ? r.retry : null, repeat: typeof r.repeat === 'number' ? r.repeat : null, events: [] }; open.set(r.worker, s); spans.push(s); continue; }
    const s = open.get(r.worker);
    if (!s) continue;
    if (r.event === 'test-end') { s.end = at; s.status = r.status || null; open.delete(r.worker); continue; }
    s.events.push({ ...r, _at: at });
  }
  return { spans, teardowns, consoleReports, evidence };
}
// a heartbeat / evidence path in its canonical form (absolute, automation-relative or project-relative accepted)
const normPath = (p, automationRoot) => (p ? canonicalPath(p, automationRoot) : null);

/* ---------------- executions of the phase ---------------- */

const kebab = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function variationSlug(title) {
  const t = String(title || '').replace(/\s@[\w:-]+/g, '');
  const m = t.match(/\s[—–]\s*(variation\b[^[\]]*)$/i);
  return m ? kebab(m[1]) : 'none';
}
const nameOf = (title) => String(title || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s@[\w:-]+/g, ' ').replace(/\s[—–]\s*variation\b.*$/i, '').replace(/\s+/g, ' ').trim() || null;
export function stageText(cmd) {
  const parts = [cmd.stage];
  if (cmd.command === 'isolation') parts.push('isolation');
  else if (cmd.command === 'burn-in') parts.push('burn-in');
  else if (cmd.run === 'rerun') parts.push('re-run');
  if (cmd.label && !/^re-?run$/i.test(cmd.label)) parts.push(cmd.label);
  return parts.join(' · ');
}

// every command of every non-setup stage summary, in command start order, with its executions
export function phaseCommands(ctx) {
  const { summaries, resultsRoot, automationRoot } = ctx;
  const cmds = [];
  for (const s of summaries) {
    if (s.stage === 'setup') continue;
    (s.groups || []).forEach((g, i) => {
      cmds.push({
        summary: s, run: s.run, stage: s.stage, label: s.label || null, seq: s.seq || 0, index: i, group: g.name, command: g.command || 'normal', mode: g.mode || null,
        workers: g.workers ?? null, attempt: g.attempt ?? null, startedAt: ms(g.startedAt) ?? ms(s.startedAt) ?? 0, finishedAt: ms(g.finishedAt), source: g.source || null,
        freshness: g.freshness ? g.freshness.gate : null, stop: g.stop || null, tcs: g.tcs || [],
        stageJson: g.stageJson ? path.resolve(resultsRoot, g.stageJson) : null, progressFile: g.progressFile ? path.resolve(resultsRoot, g.progressFile) : null,
        watchdogFile: g.watchdogFile ? path.resolve(resultsRoot, g.watchdogFile) : null,
      });
    });
  }
  cmds.sort((a, b) => a.startedAt - b.startedAt || (ms(a.summary.startedAt) || 0) - (ms(b.summary.startedAt) || 0) || a.index - b.index);
  for (const c of cmds) {
    // every command gets its rows AND its heartbeats before anything can skip it — a freshness-failed command has no
    // results of record, but its (empty) heartbeat view is still read by verify / handoff (the `hb` crash of 3.0)
    c.rows = [];
    c.hb = { spans: [], teardowns: 0, consoleReports: 0, evidence: 0 };
    if (c.freshness === 'FAIL') { c.excluded = 'freshness gate FAIL — its stage JSON is not a result of this command'; continue; }
    if (c.source === 'json' && c.stageJson && isFile(c.stageJson)) { const { data } = readJson(c.stageJson); if (data) c.rows = collectRows(data); }
    else if (c.source === 'incremental+watchdog' && c.watchdogFile && isFile(c.watchdogFile)) {
      const { data } = readJson(c.watchdogFile);
      for (const x of (data && data.completed) || []) c.rows.push({ title: x.title || x.tc, file: null, suite: '', project: x.project || null, repeat: typeof x.repeat === 'number' ? x.repeat : 0, status: x.status, tags: [], annotations: [], duration_ms: x.duration_ms || 0, tcs: [x.tc], expectedFailure: false, unverifiedAssumption: false, error: null, startTime: x.started_at || x.start || null, parallelIndex: typeof x.worker === 'number' ? x.worker : null, retry: null });
    }
    if (c.progressFile && isFile(c.progressFile)) c.hb = heartbeatSpans(c.progressFile);
  }
  return cmds;
}

/**
 * The heartbeat span of ONE execution, matched by its identity first — the command (c), the TC, the project, the repeat,
 * the retry and the worker slot (parallelIndex) — then, only WITHIN that identity: the span nearest the result's
 * startTime (uniquely, within 5 s); else the span whose evidence sits in this identity's own folder
 * ({tc}/{project}--{variation}--r{repeat}/); else — in a single-worker command, where executions of one identity run one
 * after another — the earliest span not yet paired. Never a span of another test, retry, repeat or command.
 * → { span, by } | { ambiguous: n } | {}.
 */
export function pairSpan(c, row, tc, taken = new Set(), { actual = null, automationRoot = null } = {}) {
  let cands = c.hb.spans.filter((s) => s.tcs.includes(tc) && !taken.has(s.id + '|' + tc));
  if (row.project) cands = cands.filter((s) => !s.project || s.project === row.project);
  if (typeof row.repeat === 'number') cands = cands.filter((s) => s.repeat === null || s.repeat === undefined || s.repeat === row.repeat);
  if (typeof row.retry === 'number') cands = cands.filter((s) => s.retry === null || s.retry === undefined || s.retry === row.retry);
  if (typeof row.parallelIndex === 'number') cands = cands.filter((s) => s.worker === row.parallelIndex);
  if (cands.length <= 1) return cands.length ? { span: cands[0], by: 'identity' } : {};
  const t = ms(row.startTime);
  if (t !== null) {
    const near = cands.map((s) => ({ s, d: Math.abs(s.start - t) })).filter((x) => x.d <= 5000).sort((a, b) => a.d - b.d);
    if (near.length === 1 || (near.length > 1 && near[1].d - near[0].d >= 1000)) return { span: near[0].s, by: 'identity + start time' };
    if (near.length > 1) return { ambiguous: near.length };
  }
  if (actual && automationRoot) {
    const folder = '/' + tc + '/' + actual + '/';
    const inFolder = cands.filter((s) => s.events.some((e) => e.event === 'evidence' && e.path && normPath(e.path, automationRoot).includes(folder)));
    if (inFolder.length >= 1 && (inFolder.length === 1 || c.workers === 1)) return { span: inFolder.sort((a, b) => a.start - b.start)[0], by: 'identity + evidence folder' };
  }
  if (c.workers === 1) return { span: [...cands].sort((a, b) => a.start - b.start)[0], by: 'identity + order (one worker)' };
  return { ambiguous: cands.length };
}

export function buildExecutions(ctx) {
  const { run, automationRoot, phase } = ctx;
  const shotsRoot = canonicalPath(String(run.screenshots_root || ''), automationRoot) || '';
  const required = (run.run_plan && run.run_plan.required_variants) || {};
  const counter = new Map(); // (tc|actual slug) → executions so far (the evidence helper numbers attempt-{a}.png per variant folder)
  const execs = [];
  ctx.evidenceNotes = ctx.evidenceNotes || [];
  const note = (kind, detail) => ctx.evidenceNotes.push({ kind, detail });
  for (const c of ctx.cmds) {
    const taken = new Set();
    const hasEvidenceBeats = c.hb.evidence > 0;
    for (const r of c.rows) {
      for (const tc of r.tcs) {
        const project = r.project || defaultProjectFor(run, tc);
        const variation = variationSlug(r.title);
        const actual = project + '--' + variation + '--r' + (r.repeat || 0);
        const req = required[tc] || [];
        const slug = req.includes(actual) ? actual : project + '--' + variation + '--r0';
        const status = r.status === 'XFAIL' ? 'PASS' : r.status; const reason = r.follower ? 'not started: depends on ' + r.follower + ' (failed)' : null;
        const ran = status !== 'SKIP' && status !== 'NOT_RUN';
        let evidence = null; let failure = null; let record = null; let failureRecord = null; let evidenceIssue = null;
        if (ran) {
          const key = tc + '|' + actual;
          const k = (counter.get(key) || 0) + 1; counter.set(key, k);
          const at = tc + ' ' + stageText(c) + ' ' + c.group + ' attempt ' + c.attempt + ' (' + actual + ')';
          // 1. the execution's own heartbeat span — its evidence events, whatever folder the helper wrote to
          const pick = pairSpan(c, r, tc, taken, { actual, automationRoot });
          if (pick.span) {
            taken.add(pick.span.id + '|' + tc);
            const evs = pick.span.events.filter((e) => e.event === 'evidence' && e.path).map((e) => ({ ...e, p: normPath(e.path, automationRoot) }));
            const choose = (list, label) => {
              const mine = list.filter((e) => e.p.includes('/' + tc + '/'));
              const pool = mine.length ? mine : pick.span.tcs.length === 1 ? list : [];
              if (pool.length === 1) return pool[0].p;
              if (pool.length > 1) { evidenceIssue = pool.length + ' ' + label + ' events in one test span — which one proves this attempt is ambiguous'; note('evidence-ambiguous', at + ': ' + evidenceIssue); }
              return null;
            };
            evidence = choose(evs.filter((e) => !(e.kind === 'record' || isRecordPath(e.p))), 'image');
            record = choose(evs.filter((e) => e.kind === 'record' || isRecordPath(e.p)), 'record');
          } else if (pick.ambiguous) {
            evidenceIssue = pick.ambiguous + ' test spans match this execution (same TC, project, repeat, retry and worker) — unresolved, never guessed';
            note('evidence-ambiguous', at + ': ' + evidenceIssue);
          }
          // 2. no evidence heartbeats in this command at all (helpers older than the evidence heartbeat): the folder of the
          //    SAME identity — {tc}/{project}--{variation}--r{repeat}/attempt-{n}.png, n = this identity's execution order
          if (!pick.span && !pick.ambiguous && !hasEvidenceBeats && shotsRoot) {
            const dirOf = shotsRoot + '/phase-' + phase + '/' + tc + '/' + actual + '/';
            const guess = dirOf + 'attempt-' + k + '.png';
            if (isFile(path.join(automationRoot, guess))) evidence = guess;
            const rguess = dirOf + 'attempt-' + k + '.record.json';
            if (isFile(path.join(automationRoot, rguess))) record = rguess;
          }
          // an image the run's screenshot choice does not owe (a passing attempt under `failed`, any under `none`) is no issue
          if (!evidence && !evidenceIssue && pick.span && hasEvidenceBeats && (!needsImageLayer(layerOfTc(run, tc)) || imageOwed(deliveryOf(run).screenshots, status))) evidenceIssue = 'no evidence event inside the test span';
          if (evidence && (status === 'FAIL' || status === 'INCOMPLETE')) { const f = evidence.replace(/\.png$/i, '-failed.png'); if (f !== evidence && isFile(path.join(automationRoot, f))) failure = f; }
          if (record && (status === 'FAIL' || status === 'INCOMPLETE')) { const f = record.replace(/\.record\.json$/i, '-failed.record.json'); if (isFile(path.join(automationRoot, f))) failureRecord = f; }
        }
        const fp = c.summary.code && c.summary.code.tcs && c.summary.code.tcs[tc] ? (c.summary.code.tcs[tc].fingerprint ?? null) : null;
        execs.push({
          tc, cmd: c, row: r, slug, actual, project, status, rawStatus: r.status, reason, ran, evidence, failure, record, failureRecord, evidenceIssue,
          variant_key: (r.file || '') + ' › ' + (r.suite ? r.suite + ' › ' : '') + r.title + ' [' + project + '] r' + (r.repeat || 0),
          stage: stageText(c), run: c.run, command: c.command, group: c.group, attempt: c.attempt, code_fingerprint: fp, duration_ms: r.duration_ms, error: r.error,
          modifiers: uniq(r.annotations.map((a) => a.type).filter((t) => t === 'fail' || t === 'slow')), expectedFailure: r.status === 'XFAIL',
          unverifiedAssumption: r.unverifiedAssumption, startedAt: c.startedAt,
        });
      }
    }
  }
  // the mechanical reclassification run-stage.mjs applied to a call's LATEST result of a TC (a refusal still refused alone →
  // INCOMPLETE rate_limited, a wait budget exhausted, a deferral, an admission timeout) — earlier attempts keep their result
  const last = new Map();
  execs.forEach((e, i) => last.set(ctx.summaries.indexOf(e.cmd.summary) + '|' + e.tc, i));
  for (const i of last.values()) {
    const e = execs[i]; const s = e.cmd.summary;
    const sst = s.tcs ? s.tcs[e.tc] : null; const srs = s.reasons ? s.reasons[e.tc] : null;
    if (srs && sst === 'INCOMPLETE' && e.status === 'FAIL') { e.status = 'INCOMPLETE'; e.reason = srs; }
    else if (srs && sst === 'NOT_RUN' && (e.status === 'SKIP' || e.status === 'NOT_RUN')) { e.status = 'NOT_RUN'; e.reason = srs; }
  }
  return execs;
}

/* ---------------- requirement ids ---------------- */

const REQ_ID_RE = /\b(?:REQ|US|AC|FR|NFR|BR|UC)-[A-Za-z0-9_.-]*[A-Za-z0-9]/g;
/** TC → Set(requirement ids) from the approved TC document's `Requirement` field (parsed once per context). */
export function requirementIdsFromDoc(ctx) {
  if (ctx._docReq) return ctx._docReq;
  const map = new Map();
  const v = ctx.run && ctx.run.source_tc_doc;
  if (!v) return (ctx._docReq = { map, error: null });
  const cands = [];
  if (isAbs(String(v))) cands.push(String(v));
  else for (let d = path.resolve(ctx.automationRoot), i = 0; i < 6; i++) { cands.push(path.join(d, String(v))); const up = path.dirname(d); if (up === d) break; d = up; }
  const doc = cands.find(isFile);
  if (!doc) return (ctx._docReq = { map, error: 'source_tc_doc ' + v + ' not found from the automation root — requirement ids come from the run file and the coverage snapshot only' });
  for (const tc of parseTcDocument(fs.readFileSync(doc, 'utf8'))) {
    const f = tc.fields && tc.fields.Requirement;
    const text = f ? [f.value, ...(f.items || [])].join(' ') : '';
    const ids = new Set(text.match(REQ_ID_RE) || []);
    if (ids.size) map.set(tc.id, ids);
  }
  return (ctx._docReq = { map, error: null, doc: posix(path.relative(ctx.automationRoot, doc)) });
}
/** req_id from the run file, the coverage snapshot and the TC document: their common ids, or a conflict — never a pick. */
export function resolveReqId(prev, cov, doc) {
  const split = (x) => new Set(String(x).split(/[,;]\s*/).map((s) => s.trim()).filter(Boolean));
  const sources = [];
  if (prev && prev !== DASH) sources.push(['run file', split(prev)]);
  if (cov && cov.size) sources.push(['coverage snapshot', cov]);
  if (doc && doc.size) sources.push(['TC document', doc]);
  if (!sources.length) return { value: null };
  let agreed = new Set(sources[0][1]);
  for (const [, s] of sources.slice(1)) agreed = new Set([...agreed].filter((x) => s.has(x)));
  if (agreed.size) {
    if (sources[0][0] === 'run file' && [...sources[0][1]].every((x) => agreed.has(x))) return { value: prev };
    return { value: [...agreed].sort(natural).join(', ') };
  }
  return { value: prev && prev !== DASH ? prev : null, conflict: sources.map(([n, s]) => n + ' ' + [...s].sort(natural).join(', ')).join(' · ') };
}

/* ---------------- merge ---------------- */

function stageOfTc(ctx, tc) {
  for (const s of ctx.summaries) if (s.stage !== 'setup' && s.run === 'first' && ((s.plannedTcs || []).includes(tc) || (s.tcs && tc in s.tcs))) return s.stage;
  for (const s of ctx.summaries) if (s.stage !== 'setup' && ((s.plannedTcs || []).includes(tc) || (s.tcs && tc in s.tcs))) return s.stage;
  return null;
}
const emptyCounts = () => ({ total: 0, passed: 0, failed: 0, incomplete: 0, skipped: 0, not_run: 0, partial: 0 });
const BUCKET = { PASS: 'passed', FAIL: 'failed', INCOMPLETE: 'incomplete', SKIP: 'skipped', NOT_RUN: 'not_run', PARTIAL: 'partial' };
const dropZeroPartial = (c) => { const o = { ...c }; if (!o.partial) delete o.partial; return o; };

export function mergePhase(ctx) {
  const { run, phase } = ctx;
  const warnings = [];
  const plan = planAt(run.run_plan, run.run_plan_adjustments);
  const required = (run.run_plan && run.run_plan.required_variants) || {};
  ctx.cmds = ctx.cmds || phaseCommands(ctx);
  const execs = ctx.execs || (ctx.execs = buildExecutions(ctx));
  const prevRows = new Map((run.results || []).map((r) => [r.tc_id, r]));
  // scope: the plan, the required variants, the summaries and the existing rows — an execution of a TC outside them is a warning
  const scope = new Set([...Object.keys(required), ...(plan.groups || []).flatMap((g) => g.tcs || []), ...prevRows.keys()]);
  for (const s of ctx.summaries) if (s.stage !== 'setup') { for (const tc of s.plannedTcs || []) scope.add(tc); for (const tc of Object.keys(s.tcs || {})) scope.add(tc); }
  for (const tc of uniq(execs.map((e) => e.tc))) if (!scope.has(tc)) warnings.push({ kind: 'unplanned-tc', tc, detail: tc + ' executed but is in no plan group, required-variant list, summary or results row — ignored' });
  // requirement ids per TC from every source — the run file, the coverage snapshot, the approved TC document — compared,
  // never "first source wins": sources that disagree leave req_id_conflict on the row (check 31 unresolved)
  const covReq = new Map();
  for (const r of ((run.coverage_snapshot && run.coverage_snapshot.requirements) || [])) for (const tc of r.assertedBy || []) { if (!covReq.has(tc)) covReq.set(tc, new Set()); covReq.get(tc).add(String(r.id)); }
  const docReq = requirementIdsFromDoc(ctx);   // an unreadable document only narrows the sources (check 31 names a missing id)
  for (const n of ctx.evidenceNotes || []) warnings.push(n);
  const selections = (run.impact && Array.isArray(run.impact.selections)) ? run.impact.selections : [];
  const results = []; const mergedTcs = []; const mergedVariants = [];
  const variantTotals = { passed: 0, failed: 0, skipped: 0, not_run: 0, partial: 0, incomplete: 0 };
  for (const tc of [...scope].sort(natural)) {
    const prev = prevRows.get(tc) || {};
    const mine = execs.filter((e) => e.tc === tc).sort((a, b) => a.startedAt - b.startedAt);
    const req = required[tc] && required[tc].length ? required[tc] : [defaultProjectFor(run, tc) + '--none--r0'];
    const bySlug = new Map();
    for (const e of mine) { if (!bySlug.has(e.slug)) bySlug.set(e.slug, []); bySlug.get(e.slug).push(e); }
    const variants = []; const skippedVariants = []; const finals = new Map();
    for (const [slug, list] of bySlug) {
      const ran = list.filter((e) => e.ran);
      if (!ran.length) { skippedVariants.push(slug); finals.set(slug, { status: list.some((e) => e.status === 'SKIP') ? 'SKIP' : 'NOT_RUN', reason: list[list.length - 1].reason }); continue; }
      ran.forEach((e, i) => { e.attemptNo = i + 1; });
      const last = ran[ran.length - 1];
      let final = last.status;
      if (last.command === 'burn-in') { const same = ran.filter((e) => e.cmd === last.cmd); if (same.some((e) => e.status === 'FAIL')) final = 'FAIL'; }
      finals.set(slug, { status: final, reason: last.reason, last });
      const attempts = ran.map((e) => ({ attempt: e.attemptNo, stage: e.stage, run: e.run, command: e.command, group: e.group, code_fingerprint: e.code_fingerprint, status: e.status, ...(e.reason ? { reason: e.reason } : {}), evidence_screenshot: e.evidence, failure_screenshot: e.failure, ...(e.record ? { evidence_record: e.record } : {}), ...(e.failureRecord ? { failure_record: e.failureRecord } : {}), ...(e.evidenceIssue ? { evidence_issue: e.evidenceIssue } : {}) }));
      variants.push({ variant_slug: slug, project: last.project, final_status: final, duration_ms: last.duration_ms, attempts });
      mergedVariants.push({ variant_key: last.variant_key, variant_slug: slug, tc_ids: [tc], project: last.project, attempts, final_status: final });
    }
    // status of record — complete coverage of the required variants (final-run.md <second_run> step 2)
    const humanStep = prev.human_step ?? (run.run_plan && run.run_plan.human_steps ? run.run_plan.human_steps[tc] : null) ?? null;
    const rf = req.map((slug) => ({ slug, ...(finals.get(slug) || { status: 'MISSING', reason: null }) }));
    const notExecuted = rf.filter((x) => ['SKIP', 'NOT_RUN', 'MISSING'].includes(x.status)).map((x) => x.slug);
    let status; let mech = null;
    if (rf.some((x) => x.status === 'FAIL')) status = 'FAIL';
    else if (rf.every((x) => x.status === 'PASS')) status = humanStep ? 'PARTIAL' : 'PASS';
    else if (rf.some((x) => x.status === 'PASS')) {
      // a required variant passed and another did not run (or has no verdict) → never PASS
      status = 'INCOMPLETE';
      const inc = rf.find((x) => x.status === 'INCOMPLETE');
      mech = notExecuted.length ? 'incomplete: ' + notExecuted.join(', ') : (inc && inc.reason) || 'interrupted: no verdict';
    } else if (rf.some((x) => x.status === 'INCOMPLETE')) { status = 'INCOMPLETE'; mech = rf.find((x) => x.status === 'INCOMPLETE').reason || 'interrupted: no verdict'; }
    else if (rf.some((x) => x.status === 'SKIP')) status = 'SKIP';
    else {
      status = 'NOT_RUN';
      mech = (rf.find((x) => x.reason) || {}).reason || null;
      if (!mine.length) { // nothing executed at all: the latest summary that names the TC gives its status and reason
        for (const s of [...ctx.summaries].reverse()) if (s.stage !== 'setup' && s.tcs && s.tcs[tc]) { if (['NOT_RUN', 'INCOMPLETE', 'SKIP'].includes(s.tcs[tc])) status = s.tcs[tc]; mech = (s.reasons && s.reasons[tc]) || mech; break; }
      }
    }
    if (status === 'PARTIAL') mech = 'human step: ' + humanStep;
    if (status === 'INCOMPLETE' && /^rate_limited/.test(mech || '')) mech = 'rate_limited';
    const missingVariants = status === 'SKIP' || status === 'NOT_RUN' ? [] : notExecuted;
    // the attempt of record: the latest attempt among the required variants (the failing one for a FAIL)
    const lasts = req.map((slug) => finals.get(slug)).filter((f) => f && f.last).map((f) => f.last).sort((a, b) => a.startedAt - b.startedAt);
    const fails = lasts.filter((e) => e.status === 'FAIL');
    const rec = status === 'FAIL' ? fails[fails.length - 1] || lasts[lasts.length - 1] : lasts[lasts.length - 1] || null;
    const g = groupOf(plan, tc);
    let rerun = null;
    if (rec && rec.run === 'rerun') {
      let hit = null;
      for (const sel of selections) { for (const x of sel.rerun_set || []) if (x.tc === tc) hit = { reason: x.reason || null, changed: x.changed || [] }; for (const x of sel.added || []) if (x.tc === tc) hit = { reason: 'added', changed: [] }; }
      rerun = hit || prev.rerun || { reason: null, changed: [] };
      if (!hit && !prev.rerun) warnings.push({ kind: 'rerun-reason-unknown', tc, detail: tc + ' ran in the re-run but impact.selections[] does not name it — record the reason' });
    }
    const keepClass = typeof prev.classification === 'string' && prev.classification && prev.classification !== 'N/A' && !MECHANICAL_CLASS.test(prev.classification);
    const modifiers = uniq(mine.flatMap((e) => e.modifiers));
    const rq = resolveReqId(prev.req_id, covReq.get(tc), docReq.map.get(tc));
    if (rq.conflict) warnings.push({ kind: 'req-id-conflict', tc, detail: tc + ': requirement ids disagree — ' + rq.conflict + ' (check 31 stays unresolved until the sources agree)' });
    const row = {
      tc_id: tc, req_id: rq.value, ...(rq.conflict ? { req_id_conflict: rq.conflict } : {}), test_name: prev.test_name ?? (mine.length ? nameOf(mine[0].row.title) : null),
      status, duration_ms: status === 'SKIP' || status === 'NOT_RUN' ? 0 : lasts.reduce((a, e) => a + (e.duration_ms || 0), 0),
      classification: keepClass ? prev.classification : (mech || 'N/A'),
      // the mechanical reason of a result without a verdict — recomputed every merge, read by acceptance whatever the classification says
      status_reason: ['INCOMPLETE', 'NOT_RUN'].includes(status) ? (mech || null) : null,
      unverified_assumption: !!(prev.unverified_assumption || mine.some((e) => e.unverifiedAssumption)), assumption: prev.assumption ?? null,
      error_message: status === 'FAIL' && rec ? rec.error : (prev.error_message ?? null), root_cause: prev.root_cause ?? null,
      run_group: g ? g.name : (prev.run_group ?? null), run_mode: g ? (g.mode || (plannedWorkers(plan, g) > 1 ? 'parallel' : 'serial')) : (prev.run_mode ?? null),
      evidence_screenshot: status === 'SKIP' || status === 'NOT_RUN' ? null : (rec ? rec.evidence : null), failure_screenshot: status === 'FAIL' && rec ? rec.failure : null,
      ...(status !== 'SKIP' && status !== 'NOT_RUN' && rec && rec.record ? { evidence_record: rec.record } : {}), ...(status === 'FAIL' && rec && rec.failureRecord ? { failure_record: rec.failureRecord } : {}),
      severity: prev.severity ?? 'N/A', healed_in_first_run: prev.healed_in_first_run ?? false,
      attempts: variants.reduce((a, v) => a + v.attempts.length, 0), missing_variants: missingVariants,
      ...(humanStep ? { human_step: humanStep } : {}), ...(mine.some((e) => e.expectedFailure) ? { expected_failure: true } : {}), ...(modifiers.length ? { modifiers } : {}),
      rerun, variants,
    };
    results.push(row);
    mergedTcs.push({ tc_id: tc, required_variants: req, variant_slugs: uniq([...variants.map((v) => v.variant_slug), ...skippedVariants]), status, missing_variants: missingVariants, skipped_variants: skippedVariants });
    for (const slug of req) {
      const f = finals.get(slug);
      const st = f ? f.status : 'MISSING';
      if (status === 'PARTIAL' && st === 'PASS') variantTotals.partial++;
      else if (st === 'PASS') variantTotals.passed++; else if (st === 'FAIL') variantTotals.failed++; else if (st === 'SKIP') variantTotals.skipped++; else if (st === 'INCOMPLETE') variantTotals.incomplete++; else variantTotals.not_run++;
    }
  }
  // counts — one per TC, by the stage of its first run
  const totals = emptyCounts(); const stages = {};
  for (const r of results) {
    totals.total++; totals[BUCKET[r.status]]++;
    const st = stageOfTc(ctx, r.tc_id);
    if (!st) continue;
    const c = (stages[st] = stages[st] || emptyCounts()); c.total++; c[BUCKET[r.status]]++;
  }
  const merged = {
    stages: ctx.summaries.filter((s) => s.stage !== 'setup').flatMap((s) => (s.merged_stages || []).map((m) => ({ ...m, run: s.run, json_path: m.json_path ? posix(ctx.rrRel + '/' + m.json_path) : null, ...(m.watchdog_path ? { watchdog_path: posix(ctx.rrRel + '/' + m.watchdog_path) } : {}) })))
      .sort((a, b) => (ms(a.started_at) || 0) - (ms(b.started_at) || 0)),
    executions: execs.map((e) => ({ variant_key: e.variant_key, variant_slug: e.slug, tc_ids: [e.tc], title: e.row.title, file: e.row.file, project: e.project, stage: e.stage, group: e.group, attempt: e.attempt, run: e.run, command: e.command, code_fingerprint: e.code_fingerprint, status: e.status, ...(e.reason ? { reason: e.reason } : {}), duration_ms: e.duration_ms, error: e.error, attachments: [e.evidence, e.failure].filter(Boolean) })),
    variants: mergedVariants, tcs: mergedTcs,
  };
  const vt = { ...variantTotals }; if (!vt.partial) delete vt.partial; if (!vt.incomplete) delete vt.incomplete;
  return {
    warnings, plan, results, merged, totals: dropZeroPartial(totals), stages: Object.fromEntries(STAGE_ORDER.filter((s) => stages[s]).map((s) => [s, dropZeroPartial(stages[s])])), variant_totals: vt,
    parallel_checks: parallelChecks(ctx, plan), rate_limit: rateLimitBlock(ctx), watchdog_events: watchdogEvents(ctx), timeouts: timeoutsBlock(ctx), concurrency: concurrencyBlock(ctx), smoke_gate: smokeGateBlock(ctx),
  };
}

function parallelChecks(ctx, plan) {
  const prev = (ctx.run.parallel_checks || []);
  const out = [];
  const adjMoves = (ctx.run.run_plan_adjustments || []).filter((a) => a && a.kind === 'move');
  const find = (tc, pa) => prev.find((x) => x.tc === tc && (x.parallel_attempt === pa || x.parallel_attempt === undefined || x.parallel_attempt === null)) || {};
  for (const s of ctx.summaries) {
    const iso = s.isolation || {};
    const inter = s.interference || [];
    const cmdOf = (name, kind, attempt) => (s.groups || []).find((g) => g.name === name && (g.command || 'normal') === kind && (attempt === undefined || g.attempt === attempt));
    const done = new Set();
    for (const e of inter) {
      const pa = e.parallel_attempt ?? null;
      const p = find(e.tc, pa);
      const par = e.group ? cmdOf(e.group, 'normal', pa ?? undefined) : null;
      const move = [...adjMoves].reverse().find((a) => a.tc === e.tc);
      const outcome = e.kind === 'passed-beside-failed-alone' ? 'confirmed' : 'interference';
      out.push({
        tc: e.tc, stage: s.stage, group: e.group || null, workers: par ? par.workers : null, parallel_attempt: pa, alone_attempt: e.isolated_attempt ?? null, outcome, kind: e.kind || null,
        overlapped: e.overlapped || [], overlap_rerun: (e.overlapped || []).filter((tc) => (iso.overlap_rerun || []).includes(tc)).map((tc) => ({ tc, status: (s.tcs || {})[tc] || null })),
        moved_to: move ? move.to : null, learning_line: p.learning_line ?? null, cause: p.cause ?? e.cause ?? null, cause_evidence: p.cause_evidence ?? e.cause_evidence ?? [], resolution: p.resolution ?? null,
      });
      done.add(e.tc);
    }
    for (const tc of iso.failed_alone || []) if (!done.has(tc)) { const p = find(tc, null); out.push({ tc, stage: s.stage, group: null, workers: null, parallel_attempt: null, alone_attempt: null, outcome: 'confirmed', kind: 'failed-beside-failed-alone', overlapped: [], overlap_rerun: [], moved_to: null, learning_line: p.learning_line ?? null, cause: p.cause ?? null, cause_evidence: p.cause_evidence ?? [], resolution: p.resolution ?? null }); done.add(tc); }
    for (const tc of iso.rate_limited || []) if (!done.has(tc)) { const p = find(tc, null); out.push({ tc, stage: s.stage, group: null, workers: null, parallel_attempt: null, alone_attempt: null, outcome: 'rate_limited', kind: 'refused', overlapped: [], overlap_rerun: [], moved_to: null, learning_line: p.learning_line ?? null, cause: p.cause ?? null, cause_evidence: p.cause_evidence ?? [], resolution: p.resolution ?? null }); done.add(tc); }
  }
  void plan;
  return out;
}

function rateLimitBlock(ctx) {
  const prev = ctx.run.rate_limit || {};
  const services = new Map(); const policies = new Map(); const cooldowns = []; const adjustments = []; const scopes = []; let refused = 0;
  for (const s of ctx.summaries) {
    const r = s.rateLimit || {};
    refused += Number(r.refused) || 0;
    for (const x of r.services || []) { const cur = services.get(x.match) || { match: x.match, count: 0, retry_after_max_s: null, tcs: [] }; cur.count += x.count || 0; if (typeof x.retry_after_max_s === 'number') cur.retry_after_max_s = Math.max(cur.retry_after_max_s ?? 0, x.retry_after_max_s); cur.tcs = uniq([...cur.tcs, ...(x.tcs || [])]); services.set(x.match, cur); }
    for (const p of r.policies || []) if (!policies.has(p.match)) policies.set(p.match, p);
    cooldowns.push(...(r.cooldowns_ms || [])); adjustments.push(...(r.adjustments || []).map((a) => ({ stage: s.stage, run: s.run, ...a }))); scopes.push(...(r.scopes || []).map((x) => ({ stage: s.stage, ...x })));
  }
  return { planned: (ctx.run.run_plan && ctx.run.run_plan.rate_limits) || [], refused, services: [...services.values()], policies: [...policies.values()], cooldowns_ms: cooldowns, adjustments, ...(scopes.length ? { scopes } : {}), learned: prev.learned || [] };
}

const evKey = (e) => [e.stage || '', e.group || '', e.tc || '', e.step || '', e.action || e.kind || ''].join('|');
function watchdogEvents(ctx) {
  const prev = new Map((ctx.run.watchdog_events || []).map((e) => [evKey(e), e]));
  const out = [];
  for (const s of ctx.summaries) for (const e of s.watchdog_events || []) { const p = prev.get(evKey(e)); out.push({ ...e, ...(p && p.classification ? { classification: p.classification } : {}) }); }
  for (const [k, p] of prev) if (!out.some((e) => evKey(e) === k)) out.push(p);
  return out;
}
function timeoutsBlock(ctx) {
  const prev = ctx.run.timeouts || {};
  const key = (e) => [e.kind || '', e.tc || '', e.step || '', e.evidence || ''].join('|');
  const events = [...(prev.events || [])];
  const have = new Set(events.map(key));
  const add = (e) => { if (!have.has(key(e))) { have.add(key(e)); events.push({ ...e, classification: e.classification ?? null }); } };
  for (const s of ctx.summaries) {
    for (const e of s.timeout_events || []) add({ tc: e.tc ?? null, step: e.step ?? null, elapsed_ms: e.elapsed_ms ?? null, deadline_ms: e.deadline_ms ?? null, expected: e.expected ?? null, kind: e.kind || 'watchdog', evidence: e.evidence ? posix(ctx.rrRel + '/' + e.evidence) : null });
    const ts = s.timeouts_shadow || {};
    for (const x of ts.stalls || []) add({ tc: x.tc ?? null, step: x.step ?? null, elapsed_ms: x.silence_ms ?? x.elapsed_ms ?? null, deadline_ms: x.deadline_ms ?? null, expected: x.expected ?? null, kind: 'stall', evidence: x.diagnostics || x.evidence || null, stall_classification: x.classification || null });
    const ad = s.admission || {};
    for (const x of ad.timeouts || []) { const o = typeof x === 'string' ? { tc: x } : x; add({ tc: o.tc ?? null, step: null, elapsed_ms: o.waited_ms ?? null, deadline_ms: o.max_wait_ms ?? null, expected: null, kind: 'admission', evidence: o.reason || null }); }
  }
  return { ...prev, events };
}

function concurrencyBlock(ctx) {
  const cmds = ctx.cmds || [];
  let maxWorkers = 0; let wsum = 0; let dsum = 0; let peakCpu = null; let minAvail = null; let blocked = 0; const ramp = []; const pressure = []; const timeline = [];
  for (const c of cmds) { const d = c.finishedAt && c.startedAt ? c.finishedAt - c.startedAt : 0; if (d > 0 && c.workers) { wsum += c.workers * d; dsum += d; } maxWorkers = Math.max(maxWorkers, c.workers || 0); }
  for (const s of ctx.summaries) {
    // the ledger sampler's own minima / peaks (`host`, every summary) — the opt-in telemetry only when it ran
    const t = s.telemetry || {};
    const h = s.host || {};
    const cpuPeak = typeof h.peakCpuPct === 'number' ? h.peakCpuPct : t.cpu && typeof t.cpu.peakPct === 'number' ? t.cpu.peakPct : null;
    const availMin = typeof h.minAvailableMb === 'number' ? h.minAvailableMb : t.memory && typeof t.memory.availableMinMb === 'number' ? t.memory.availableMinMb : null;
    if (cpuPeak !== null) peakCpu = peakCpu === null ? cpuPeak : Math.max(peakCpu, cpuPeak);
    if (availMin !== null) minAvail = minAvail === null ? availMin : Math.min(minAvail, availMin);
    if (s.pressure) { blocked += Number(s.pressure.blockedAdmissions) || 0; pressure.push(...(s.pressure.episodes || []).map((e) => ({ stage: s.stage, ...e }))); }
    if (s.dispatch) { ramp.push(...(s.dispatch.ramp || []).map((r) => ({ stage: s.stage, ...r }))); timeline.push(...(s.dispatch.timeline || []).map((x) => ({ stage: s.stage, ...x }))); }
  }
  // dispatch timeline: the most units running at once
  if (timeline.length) {
    const pts = timeline.flatMap((x) => [{ t: ms(x.start), d: x.workers || 1 }, { t: ms(x.end), d: -(x.workers || 1) }]).filter((p) => p.t !== null).sort((a, b) => a.t - b.t || a.d - b.d);
    let cur = 0; for (const p of pts) { cur += p.d; maxWorkers = Math.max(maxWorkers, cur); }
  }
  const planned = ctx.run.run_plan && ctx.run.run_plan.estimate ? ctx.run.run_plan.estimate.planned_s ?? null : null;
  const actualMs = ctx.summaries.reduce((a, s) => a + (Number(s.durationMs) || 0), 0);
  return {
    max_concurrent_workers: maxWorkers || null, average_workers: dsum ? Math.round((wsum / dsum) * 100) / 100 : null, peak_cpu_pct: peakCpu, min_available_mb: minAvail,
    admissions_blocked: blocked, pressure_episodes: pressure, worker_adjustments: [...ramp, ...ctx.summaries.flatMap((s) => ((s.rateLimit && s.rateLimit.adjustments) || []).map((a) => ({ stage: s.stage, kind: 'rate-limit', ...a })))],
    isolation_outcomes: ctx.summaries.reduce((a, s) => a + ((s.isolation && s.isolation.ran) || []).length, 0), planned_s: planned, actual_s: actualMs ? Math.round(actualMs / 1000) : null,
    scheduler: ctx.summaries.some((s) => s.dispatch && s.dispatch.scheduler === 'dispatch') ? 'dispatch' : ctx.summaries.some((s) => s.scheduler && s.scheduler.used === 'serial') ? 'serial' : 'groups',
  };
}

function smokeGateBlock(ctx) {
  const prev = ctx.run.smoke_gate || {};
  const smoke = ctx.summaries.filter((s) => s.stage === 'smoke');
  if (!smoke.length) return Object.keys(prev).length ? prev : null;
  const last = smoke[smoke.length - 1];
  const g = last.smokeGate || {};
  const sc = last.cumulative && last.cumulative.stages ? last.cumulative.stages.smoke : null;
  const eligible = g.eligible ?? (sc ? (sc.passed || 0) + (sc.failed || 0) : null);
  const noVerdict = g.decision === 'no_verdict' || g.verdict === 'NO VERDICT' || eligible === 0;
  const cycles = smoke.filter((s) => s.run === 'first' && (/smoke retry/i.test(s.label || '') || (s.seq || 1) > 1)).length;
  const verdict = noVerdict ? 'NO VERDICT' : ctx.run.status === 'stopped-smoke-gate' ? 'FAILED-STOPPED' : g.decision === 'continue' || g.verdict === 'PASS' || (g.failPct !== null && g.failPct !== undefined && g.failPct <= (g.limit ?? 30)) ? (cycles ? 'healed-then-passed' : 'passed') : (prev.verdict || 'ABOVE_LIMIT');
  return { ...prev, fail_pct: noVerdict ? null : g.failPct ?? prev.fail_pct ?? null, eligible, verdict, cycles, excluded_unverified_assumption: prev.excluded_unverified_assumption ?? 0, action_taken: prev.action_taken ?? null };
}

/** merge → the run file object with every mechanical block replaced and every model-owned field kept. */
export function applyMerge(run, m, { automationRoot = null } = {}) {
  const out = { ...run };
  // path fields in their ONE canonical form (relative to the automation root) — references/schemas/paths-and-evidence.md
  if (automationRoot) Object.assign(out, canonicalRunPaths(run, automationRoot).paths);
  out.results = m.results; out.merged = m.merged; out.stages = m.stages; out.totals = m.totals; out.variant_totals = m.variant_totals;
  out.parallel_checks = m.parallel_checks; out.rate_limit = m.rate_limit; out.watchdog_events = m.watchdog_events; out.timeouts = m.timeouts; out.concurrency = m.concurrency;
  if (m.smoke_gate) out.smoke_gate = m.smoke_gate;
  return out;
}

/* ---------------- report fragments ---------------- */

export function phaseOutcome(totals, smokeVerdict, runStatus) {
  if (runStatus === 'environment-blocked') return 'ENVIRONMENT_BLOCKED';
  if (runStatus === 'blocked' && !totals.total) return 'BLOCKED';
  if (smokeVerdict === 'FAILED-STOPPED') return 'SMOKE GATE FAILED';
  if (totals.failed) return 'FAILURES';
  if (totals.incomplete || totals.partial || smokeVerdict === 'NO VERDICT') return 'INCOMPLETE';
  return 'GREEN';
}
const latestLine = (t) => t.passed + ' passed · ' + t.failed + ' failed · ' + t.incomplete + ' incomplete · ' + t.skipped + ' skipped · ' + t.not_run + ' not run' + (t.partial ? ' · ' + t.partial + ' partial' : '') + ' of ' + t.total + ' TCs';
const countRow = (name, c, withPartial) => '| ' + name + ' | ' + c.total + ' | ' + c.passed + ' | ' + c.failed + ' | ' + c.incomplete + ' | ' + c.skipped + ' | ' + c.not_run + (withPartial ? ' | ' + (c.partial || 0) : '') + ' |';
const dateOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : DASH);
const dateTimeOf = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(0, 10) + ' ' + iso.slice(11, 16) : DASH);

export function reportFragments(ctx, merged, { acceptance = null, gates = null, historyHasPartial = null } = {}) {
  const run = ctx.run; const N = ctx.phase;
  const t = merged.totals; const withPartial = historyHasPartial === null ? !!t.partial : historyHasPartial || !!t.partial;
  const sg = merged.smoke_gate || null;
  const outcome = phaseOutcome({ ...emptyCounts(), ...t }, sg ? sg.verdict : null, run.status);
  // the re-run subset per stage: the TCs whose result of record is a re-run attempt
  const rerunRows = {};
  for (const r of merged.results) {
    const recRun = r.rerun ? 'rerun' : null;
    if (!recRun) continue;
    const st = stageOfTc(ctx, r.tc_id); if (!st) continue;
    const c = (rerunRows[st] = rerunRows[st] || emptyCounts()); c.total++; c[BUCKET[r.status]]++;
  }
  const stagesLines = ['| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run' + (withPartial ? ' | Partial' : '') + ' |', '|' + '---|'.repeat(withPartial ? 8 : 7)];
  for (const s of STAGE_ORDER) if (merged.stages[s]) stagesLines.push(countRow(STAGE_TITLE[s], merged.stages[s], withPartial));
  for (const s of STAGE_ORDER) if (rerunRows[s]) stagesLines.push(countRow(STAGE_TITLE[s] + ' (re-run)', rerunRows[s], withPartial));
  stagesLines.push(countRow('**Total**', { ...emptyCounts(), ...t }, withPartial));
  let smokeLine = null;
  if (sg) {
    const pct = sg.fail_pct === null || sg.fail_pct === undefined ? DASH : sg.fail_pct + '%';
    const verdictText = sg.verdict === 'healed-then-passed' ? 'healed-then-passed (' + plural(sg.cycles || 0, 'cycle') + ')' : sg.verdict;
    const action = sg.action_taken || (sg.verdict === 'passed' ? 'no action needed' : sg.verdict === 'healed-then-passed' ? 'the failed smoke TCs were healed and re-run' : sg.verdict === 'NO VERDICT' ? 'no smoke TC produced a PASS or FAIL — positive and negative not started' : sg.verdict === 'FAILED-STOPPED' ? 'run stopped — application errors' : 'classify every smoke failure');
    smokeLine = '**Smoke gate:** ' + verdictText + ' — fail% ' + pct + ' — ' + action;
  }
  const rel = (p) => (p ? path.posix.relative(ctx.rrRel, p) : null);
  const resultLines = ['| TC-ID | REQ | Name | Status | Group | Duration | Classification | Evidence |', '|---|---|---|---|---|---|---|---|'];
  for (const r of [...merged.results].sort((a, b) => natural(a.tc_id, b.tc_id))) {
    const ev = [];
    if (r.evidence_screenshot) ev.push('[' + path.posix.basename(r.evidence_screenshot) + '](' + rel(r.evidence_screenshot) + ')');
    if (r.failure_screenshot) ev.push('[failed](' + rel(r.failure_screenshot) + ')');
    const status = r.status === 'PARTIAL' ? 'PARTIAL — human step pending' : r.status;
    resultLines.push('| ' + [r.tc_id, cellOf(r.req_id), cellOf(r.test_name), status, cellOf(r.run_group), r.status === 'SKIP' || r.status === 'NOT_RUN' ? DASH : hhmmss(r.duration_ms), r.classification && r.classification !== 'N/A' ? cellOf(r.classification) : DASH, ev.length ? ev.join(' · ') : DASH].join(' | ') + ' |');
  }
  // the one-line Run bullets
  const sels = (run.impact && run.impact.selections) || [];
  const rerunTcs = merged.results.filter((r) => r.rerun);
  const iters = uniq(sels.map((x) => x.iteration ?? null).filter((x) => x !== null)).length || (rerunTcs.length ? 1 : 0);
  const burnIn = uniq(ctx.summaries.flatMap((s) => s.burnIn || []));
  const cycles = sg ? sg.cycles || 0 : 0;
  const rr = rerunTcs.length
    ? plural(rerunTcs.length, 'TC') + ' (' + rerunTcs.filter((r) => r.rerun.reason === 'impacted').length + ' impacted · ' + rerunTcs.filter((r) => r.rerun.reason === 'no-verdict').length + ' no verdict · ' + rerunTcs.filter((r) => r.rerun.reason === 'added').length + ' added), ' + burnIn.length + ' burn-in, ' + (iters + cycles) + ' heal iteration(s)'
    : 'not needed — no code changed after the first run and every TC has a verdict';
  const pc = merged.parallel_checks || [];
  const isoRan = ctx.summaries.reduce((a, s) => a + ((s.isolation && s.isolation.ran) || []).length, 0);
  const iso = isoRan ? isoRan + ' failed beside others → ' + pc.filter((x) => x.outcome === 'interference').length + ' passed alone (interference) · ' + pc.filter((x) => x.outcome === 'confirmed').length + ' confirmed · ' + pc.filter((x) => x.outcome === 'rate_limited').length + ' rate_limited' : 'none needed';
  const rl = merged.rate_limit || {};
  const adj = rl.adjustments || [];
  const rate = rl.refused || (rl.planned || []).length || adj.length
    ? [(rl.planned || []).length ? (rl.planned || []).map((x) => x.service + ' (' + (x.limit ?? DASH) + ' / ' + (x.window_s ?? DASH) + ' s, pace ' + (x.pace ?? DASH) + ')').join(', ') : 'no service paced', rl.refused + ' refusals', 'cool-downs ' + ((rl.cooldowns_ms || []).length ? (rl.cooldowns_ms || []).map((x) => Math.round(x / 1000) + ' s').join(', ') : 'none'), 'workers ' + (adj.length ? adj.filter((a) => a.workers_from !== undefined).map((a) => a.workers_from + ' → ' + a.workers_to).join(', ') || 'unchanged' : 'unchanged')].join(' · ')
    : 'none seen';
  const acc = acceptance || run.acceptance || null;
  const accText = !acc ? DASH : acc.verdict === 'ACCEPTED' ? (acc.mode === 'final' ? 'ACCEPTED' : 'ACCEPTED pending Checkpoint B — see gate record') : 'NOT ACCEPTED — ' + (acc.reasons || []).join('; ');
  const gA = gates && gates.A ? gates.A.data : null; const gB = gates && gates.B ? gates.B.data : null;
  const compliance = 'Checkpoint A ' + (gA ? gA.verdict + (gA.snapshotId ? ' (' + gA.snapshotId + ')' : '') : (run.compliance && run.compliance.checkpoint_a ? run.compliance.checkpoint_a.gate : 'pending')) + ' · Checkpoint B ' + (gB ? gB.verdict + (gB.snapshotId ? ' (' + gB.snapshotId + ')' : '') : 'pending — see gate record');
  const est = run.run_plan && run.run_plan.estimate ? run.run_plan.estimate : null;
  const durMs = run.total_duration_ms ?? (ms(run.finished_at) !== null && ms(run.started_at) !== null ? ms(run.finished_at) - ms(run.started_at) : ctx.summaries.reduce((a, s) => a + (Number(s.durationMs) || 0), 0));
  const duration = hhmmss(durMs) + (est ? ' (planned ~' + hhmmss((est.planned_s ?? 0) * 1000) + ' · serial-only ~' + hhmmss((est.serial_only_s ?? 0) * 1000) + ')' : '');
  const ti = run.timeouts && run.timeouts.initial ? run.timeouts.initial : null;
  const sec = (x) => (typeof x === 'number' ? Math.round(x / 1000) + ' s' : DASH);
  const timeoutsBullet = ti ? 'test ' + sec(ti.test_default_ms) + ' · step ' + sec(ti.step_default_ms) + ' · action ' + sec(ti.action_ms) + ' · navigation ' + sec(ti.navigation_ms) + ' · expect ' + sec(ti.expect_ms) + ' — ' + ((run.timeouts.adjusted || []).length) + ' calibrated · ' + (merged.watchdog_events || []).length + ' watchdog events' : null;
  // 3.1 — the run's delivery choices (only when the run file records them, so a pre-3.1 phase renders as before)
  const dl = deliveryOf(run);
  const deliveryBullet = run.delivery ? (dl.report === 'html' ? 'HTML page + markdown' : 'markdown only') + ' · screenshots ' + ({ all: 'every TC', failed: 'failed TCs only', none: 'none' })[dl.screenshots] + ' (' + (({ asked: 'chosen at intake', flag: 'from the task flags', default: 'default' })[dl.source] || dl.source) + ')' : null;
  const shotsLine = run.screenshots_root && dl.screenshots !== 'none';
  const runBullets = [
    '- **Outcome:** ' + outcome,
    '- **Environment:** ' + cellOf(envName(run.environment)), '- **Build:** ' + cellOf(run.build),
    '- **Headed / workers:** ' + (run.headed === false ? 'no' : 'yes') + ' / parallel ×' + (run.workers_parallel ?? (run.run_plan && run.run_plan.workers_parallel) ?? 2) + ', serial ×1',
    ...(timeoutsBullet ? ['- **Timeouts:** ' + timeoutsBullet] : []),
    '- **Started:** ' + dateTimeOf(run.started_at), '- **Duration:** ' + duration, '- **Run file:** .runs/phase-' + N + '.json',
    ...(run.progress_log ? ['- **Progress log:** ' + path.posix.relative(ctx.rrRel, posix(run.progress_log))] : []),
    ...(shotsLine ? ['- **Screenshots:** ' + path.posix.relative(ctx.rrRel, posix(String(run.screenshots_root)).replace(/\/+$/, '') + '/phase-' + N) + '/'] : []),
    ...(deliveryBullet ? ['- **Delivery:** ' + deliveryBullet] : []),
    '- **Compliance:** ' + compliance, '- **Azure DevOps:** ' + cellOf(run.ado_mode),
    '- **Previous phase:** ' + (run.previous_phase && run.previous_phase.file ? run.previous_phase.file : 'none'),
    '- **Re-run:** ' + rr, '- **Isolation checks:** ' + iso, '- **Rate limits:** ' + rate, '- **Acceptance:** ' + accText,
  ];
  const header = [
    '**Latest phase:** ' + N, '**Latest run:** ' + dateTimeOf(run.started_at), '**Status:** ' + outcome, '**Latest results:** ' + latestLine({ ...emptyCounts(), ...t }),
    '**Compliance:** ' + compliance, '**Run file:** .runs/phase-' + N + '.json',
    ...(shotsLine ? ['**Screenshots:** ' + path.posix.relative(ctx.rrRel, posix(String(run.screenshots_root)).replace(/\/+$/, '') + '/phase-' + N) + '/'] : []),
    ...(run.progress_log ? ['**Progress log:** ' + path.posix.relative(ctx.rrRel, posix(run.progress_log))] : []),
  ];
  const bugs = (run.bugs || []).map((b) => b.id).filter(Boolean);
  const historyHeader = '| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run' + (withPartial ? ' | Partial' : '') + ' | Total | Duration | Bugs |';
  const historyRow = '| ' + [N, dateOf(run.started_at), outcome, t.passed, t.failed, t.incomplete, t.skipped, t.not_run, ...(withPartial ? [t.partial || 0] : []), t.total, hhmmss(durMs), bugs.length ? bugs.join(', ') : DASH].join(' | ') + ' |';
  return {
    outcome, counts: { ...emptyCounts(), ...t }, phaseHeading: '## Phase ' + N + ' — ' + dateOf(run.started_at), header, historyHeader, historyRow,
    runBullets, stagesTable: stagesLines.join('\n'), smokeGateLine: smokeLine, resultsTable: resultLines.join('\n'),
    ...ledgerSections(ctx),
  };
}

// 3.0 — the `### Retained test records` / `### In-doubt test records` sub-sections, from the run's ledgers; present
// only when the run changed data (a UI-only phase gets neither key). Resource and key only — never a value of a record.
export function ledgerSections(ctx) {
  if (!ctx.resultsRoot || !ctx.run) return {};
  const L = dataLedger(ctx);
  if (!L.files || !L.writes.length) return {};
  const split = (k) => { const i = k.indexOf(' '); return i < 0 ? [k, DASH] : [k.slice(0, i), k.slice(i + 1)]; };
  const why = (st) => (st === 'retained' ? 'kept (clean-up answer)' : 'not torn down (' + st + ')');
  const out = {};
  if (L.kept.length) out.retainedTable = ['### Retained test records', '', '| Resource | Key | TC | Reason |', '|---|---|---|---|', ...L.kept.map((x) => '| ' + [...split(x.key), x.tc, why(x.state)].map(cellOf).join(' | ') + ' |')].join('\n');
  if (L.inDoubt.length) out.inDoubtTable = ['### In-doubt test records', '', '| Resource | Target identity | TC | Since |', '|---|---|---|---|', ...L.inDoubt.map((x) => '| ' + [...split(x.target), x.tc, x.at].map(cellOf).join(' | ') + ' |')].join('\n');
  return out;
}

/* ---------------- the readiness block ---------------- */

export function readinessTable(run) {
  const d = run.data_readiness || null;
  if (!d) return { markdown: null, reason: 'no data_readiness in the run file' };
  const gaps = Array.isArray(d.gaps) ? d.gaps : [];
  const prepared = gaps.filter((g) => /^prepared\b/i.test(String(g.decision || ''))).length;
  const verdict = '**Verdict:** ' + (d.verdict || DASH) + (prepared ? ' — ' + plural(prepared, 'gap') + ' prepared' : '');
  if (!gaps.length) return { markdown: d.verdict === 'READY' || !d.verdict ? 'all ready' : verdict, rows: 0 };
  const lines = [verdict, '', '| Gap | TCs | Decision | Source | Provisioning | Identifiers / names | Effective stamped values | Verified on | Cleanup |', '|---|---|---|---|---|---|---|---|---|'];
  for (const g of gaps) lines.push('| ' + [g.gap, Array.isArray(g.tcs) ? g.tcs.join(', ') : g.tcs, g.decision, g.source, g.provisioning, g.identifiers, g.stamped_values, g.verified_on, g.cleanup].map(cellOf).join(' | ') + ' |');
  return { markdown: lines.join('\n'), rows: gaps.length };
}

/* ---------------- gate records ---------------- */

export function gateRecords(resultsRoot, phase) {
  const out = {};
  for (const k of ['A', 'B']) {
    const f = path.join(resultsRoot, '.runs', 'phase-' + phase + '.checkpoint-' + k + '.json');
    if (!isFile(f)) { out[k] = null; continue; }
    const { data, error, text } = readJson(f);
    out[k] = { file: f, data, error, text };
  }
  return out;
}

/* ---------------- handoff ---------------- */

export function handoff(ctx, merged, gates) {
  const run = ctx.run;
  const results = merged.results;
  const cov = run.coverage_snapshot || {};
  const q = (run.open_questions && run.open_questions.questions) || [];
  const gate = (g) => (g && g.data ? { verdict: g.data.verdict, snapshotId: g.data.snapshotId || null, rejected: (g.data.rejected || []).length, unresolved: (g.data.results || []).filter((r) => r.status === 'unresolved').map((r) => r.checkId) } : null);
  const next = [];
  for (const p of merged.parallel_checks || []) if (!p.resolution && (p.cause === 'possible_product_concurrency_defect' || p.cause === 'unexplained' || !p.cause) && p.outcome === 'interference') next.push('resolve the ' + (p.cause || 'unexplained') + ' finding of ' + p.tc + ' (evidence → resolution)');
  if (!gates.A) next.push('Checkpoint A gate record missing'); if (!gates.B) next.push('Checkpoint B pending');
  for (const r of results) if (r.status === 'FAIL' && (!r.classification || r.classification === 'N/A')) next.push('classify the failure of ' + r.tc_id);
  return {
    schema: 'skill5-handoff/1', phase: ctx.phase, user_story: run.user_story || null, feature: run.feature || null, run_status: run.status || null, source_tc_doc: run.source_tc_doc || null, environment: run.environment || null,
    requirements: (cov.requirements || []).map((r) => ({ id: r.id, outcome: r.outcome, asserted_by: r.assertedBy || [] })),
    decisions: q.filter((x) => x && (x.decision || x.answer)).map((x) => ({ id: x.id ?? x['#'] ?? null, decision: x.decision || x.answer, by: x.by || null })),
    tc_scope: { total: results.length, by_stage: merged.stages, groups: ((ctx.run.run_plan && ctx.run.run_plan.groups) || []).map((g) => ({ name: g.name, mode: g.mode, tcs: (g.tcs || []).length })) },
    implementation: cov.tcs || null, readiness: run.data_readiness ? { verdict: run.data_readiness.verdict || null, predicted_skips: run.data_readiness.predicted_skips || [] } : null,
    failures: results.filter((r) => ['FAIL', 'INCOMPLETE', 'NOT_RUN'].includes(r.status)).map((r) => ({ tc: r.tc_id, status: r.status, classification: r.classification, error: r.error_message || null })),
    defects: (run.bugs || []).filter((b) => /^open$/i.test(String(b.status || ''))).map((b) => ({ id: b.id, tc: b.tc_id || null, severity: b.severity || null, title: b.title || null })),
    findings: (merged.parallel_checks || []).map((p) => ({ tc: p.tc, outcome: p.outcome, cause: p.cause || null, resolution: p.resolution || null })),
    evidence: { screenshots: run.screenshots_root ? posix(String(run.screenshots_root)).replace(/\/+$/, '') + '/phase-' + ctx.phase + '/' : null, images: results.filter((r) => r.evidence_screenshot).length },
    compliance: { A: gate(gates.A), B: gate(gates.B), freshness: run.impact && run.impact.final_check ? { stale: run.impact.final_check.stale || [] } : null },
    totals: merged.totals, acceptance: run.acceptance || null, learning_lines: run.learning_lines || [], next_actions: next,
  };
}

/* ---------------- verify — the runtime-evidence checks of Checkpoint B ---------------- */

const res = (status, evidence, details = []) => ({ status, evidence, details });
/**
 * The ownership ledgers of this run (3.0 — helpers/data-ledger.ts): artifacts/progress/*.data-ledger.jsonl, lines of
 * run_id = run.run_id (else every line of the phase's files). Grouped by write_id; the last state per created key.
 */
export function dataLedger(ctx) {
  const dir = path.join(ctx.resultsRoot, 'artifacts', 'progress');
  const files = readdirSafe(dir).filter((f) => f.endsWith('.data-ledger.jsonl'));
  const runId = ctx.run.run_id || null;
  let lines = files.flatMap((f) => jsonl(path.join(dir, f)));
  if (runId && lines.some((l) => l.run_id === runId)) lines = lines.filter((l) => l.run_id === runId);
  const keyOf = (l) => (l.table || l.resource || '?') + ' ' + (typeof l.key === 'string' ? l.key : JSON.stringify(l.key));
  const groups = new Map();
  for (const l of lines) { if (!l || !l.write_id) continue; if (!groups.has(l.write_id)) groups.set(l.write_id, []); groups.get(l.write_id).push(l); }
  const writes = [...groups.entries()].map(([id, ls]) => ({ id, lines: ls })).filter((w) => w.lines.some((l) => l.state === 'intent'));
  const lastByKey = new Map();
  for (const l of lines) if (l.op === 'insert' || l.op === 'create' || l.state === 'teardown-done') lastByKey.set(keyOf(l), l.state);
  const retained = [...lastByKey.entries()].filter(([, s]) => s === 'retained').map(([k]) => k);
  const removed = [...lastByKey.values()].filter((s) => s === 'teardown-done').length;
  const preparedKeys = new Set(lines.filter((l) => l.purpose === 'setup' && (l.op === 'insert' || l.op === 'create') && /^(committed|verified|recovered|retained)$/.test(l.state)).map(keyOf));
  const inDoubt = writes.filter((w) => !w.lines.some((l) => l.state !== 'intent')).map((w) => ({ tc: w.lines[0].tc, op: w.lines[0].op, target: keyOf(w.lines[0]), at: w.lines[0].at || null }));
  // kept or never torn down: created by the run, last state retained / committed / verified / recovered
  const tcByKey = new Map();
  for (const l of lines) if ((l.op === 'insert' || l.op === 'create') && l.tc && !tcByKey.has(keyOf(l))) tcByKey.set(keyOf(l), l.tc);
  const kept = [...lastByKey.entries()].filter(([, st]) => /^(retained|committed|verified|recovered)$/.test(st)).map(([k, st]) => ({ key: k, tc: tcByKey.get(k) || null, state: st }));
  return { files: files.length, lines, writes, lastByKey, retained, removed, preparedKeys, inDoubt, kept };
}

export function verifyRuntime(ctx, merged, { learning = null, published = false } = {}) {
  const run = ctx.run; const N = ctx.phase; const ar = ctx.automationRoot; const rr = ctx.resultsRoot;
  const checks = {};
  const cmds = ctx.cmds || phaseCommands(ctx);
  const spans = cmds.flatMap((c) => c.hb.spans.map((s) => ({ ...s, cmd: c })));
  const anyTeardown = cmds.some((c) => c.hb.teardowns > 0); const anyConsole = cmds.some((c) => c.hb.consoleReports > 0);
  const label = (s) => s.tc + ' (' + stageText(s.cmd) + ', ' + s.cmd.group + ' attempt ' + s.cmd.attempt + ', worker ' + s.worker + ')';

  // 16b — each PASS test's evidence before its teardown, from this phase's heartbeats; the evidence a test owes follows
  // its layer (3.0): an image for ui / hybrid, a record for api / db / api+db / hybrid — EVERY one before teardown
  {
    // 3.1 — the run's screenshot choice decides whether a PASS owes an image (`failed` / `none`: no); records always owed
    const shots = deliveryOf(run).screenshots;
    const owes = (s) => { const l = layerOfTc(run, s.tcs[0]); return (needsImageLayer(l) && imageOwed(shots, 'PASS')) || needsRecordLayer(l); };
    const allPassed = spans.filter((s) => s.status === 'passed');
    const passed = allPassed.filter(owes);
    const bad = [];
    for (const s of passed) {
      const td = s.events.find((e) => e.event === 'teardown');
      const evs = s.events.filter((e) => e.event === 'evidence');
      const layer = layerOfTc(run, s.tcs[0]);
      const img = evs.find((e) => !(e.kind === 'record' || isRecordPath(e.path)));
      const rec = evs.find((e) => e.kind === 'record' || isRecordPath(e.path));
      if (!evs.length) bad.push(label(s) + ': no evidence record');
      else if (needsImageLayer(layer) && imageOwed(shots, 'PASS') && !img) bad.push(label(s) + ': no image evidence (a ' + layer + ' test)');
      else if (needsRecordLayer(layer) && !rec) bad.push(label(s) + ': no API / DB record (a ' + layer + ' test)');
      else if (!td) { if (anyTeardown) bad.push(label(s) + ': no teardown record'); }
      else { const late = evs.find((e) => e._at >= td._at); if (late) bad.push(label(s) + ': evidence at ' + new Date(late._at).toISOString() + ' is not before teardown at ' + new Date(td._at).toISOString()); }
    }
    if (!allPassed.length) checks['16b'] = res('PASS', 'no passing test in this phase — nothing to order');
    else if (!passed.length) checks['16b'] = res('PASS', allPassed.length + ' passing test(s), none owes evidence under the run\'s screenshot choice (`' + shots + '`) — nothing to order');
    else if (bad.length) checks['16b'] = res('FAIL', bad.length + ' of ' + passed.length + ' passing tests', bad);
    else if (!anyTeardown) checks['16b'] = res('unresolved', 'no `teardown` heartbeat in this phase — the guards are older than the templates; prove the order by reading the specs or update helpers/console-guard.ts');
    else checks['16b'] = res('PASS', passed.length + ' passing tests: evidence recorded before teardown');
  }
  // 18 — the artifacts were produced
  {
    const bad = [];
    let images = 0; let records = 0;
    // 3.1 — the run's delivery choices: images owed per the screenshot choice, the page only for `report: html`
    const dl = deliveryOf(run);
    for (const r of merged.results) {
      const layer = layerOfTc(run, r.tc_id);
      for (const v of r.variants || []) for (const a of v.attempts || []) {
        const at = r.tc_id + ' ' + v.variant_slug + ' attempt ' + a.attempt;
        if (needsImageLayer(layer) && dl.screenshots !== 'none') {
          if (imageOwed(dl.screenshots, a.status)) { images++; if (!a.evidence_screenshot || !isFile(path.join(ar, a.evidence_screenshot))) bad.push(at + ': ' + (dl.screenshots === 'failed' ? 'failure-time' : 'assertion-point') + ' image ' + (a.evidence_issue ? 'unresolved — ' + a.evidence_issue : 'missing') + (a.evidence_screenshot ? ' (' + a.evidence_screenshot + ')' : '')); }
          if (a.status === 'FAIL' && (!a.failure_screenshot || !isFile(path.join(ar, a.failure_screenshot)))) bad.push(at + ': failure image missing');
        }
        if (needsRecordLayer(layer)) {
          if (['PASS', 'FAIL', 'PARTIAL'].includes(a.status)) { records++; if (!a.evidence_record || !isFile(path.join(ar, a.evidence_record))) bad.push(at + ': API / DB record missing' + (a.evidence_record ? ' (' + a.evidence_record + ')' : '')); }
          if (a.status === 'FAIL' && (!a.failure_record || !isFile(path.join(ar, a.failure_record)))) bad.push(at + ': failure record missing');
        }
      }
    }
    const feature = run.feature || null;
    const dir = published ? rr : path.join(rr, 'artifacts', 'drafts', 'phase-' + N);
    const docs = feature ? [['TEST-RUN-REPORT-' + feature + '.md', (t) => new RegExp('^## Phase ' + N + '\\b', 'm').test(t)], ['BUG-REPORT-' + feature + '.md', null], ['.runs/phase-' + N + '.json', null], ...(dl.report === 'html' ? [['TEST-RUN-REPORT-' + feature + '.html', null]] : [])] : [];
    if (!feature) bad.push('run file has no `feature` — the report files cannot be named');
    for (const [f, test] of docs) { const p = path.join(dir, f); if (!isFile(p)) bad.push((published ? '' : 'draft ') + f + ' missing'); else if (test && !test(fs.readFileSync(p, 'utf8'))) bad.push(f + ' has no `## Phase ' + N + '` section'); }
    const shotsText = dl.screenshots === 'none' ? 'no images (screenshots: none)' : images + ' attempt images' + (dl.screenshots === 'failed' ? ' (screenshots: failed only)' : '');
    checks['18'] = bad.length ? res('FAIL', bad.length + ' artifact(s) missing', bad) : res('PASS', shotsText + (records ? ' and ' + records + ' API / DB records' : '') + ' on disk; ' + (published ? 'published' : 'draft') + ' report, bug file, run file' + (dl.report === 'html' ? ' and page' : ' (markdown only — no page by the run\'s choice)') + ' present');
  }
  // 22 — expected failures and slow tests shown distinctly
  {
    const execs = ctx.execs || buildExecutions(ctx);
    const bad = []; let n = 0;
    for (const e of execs) {
      const row = merged.results.find((r) => r.tc_id === e.tc);
      if (e.expectedFailure) { n++; if (!row || !row.expected_failure) bad.push(e.tc + ': expected failure (test.fail) not flagged in results[]'); }
      for (const mod of e.modifiers) { n++; if (!row || !(row.modifiers || []).includes(mod)) bad.push(e.tc + ': `' + mod + '` modifier not recorded in results[]'); }
    }
    checks['22'] = bad.length ? res('FAIL', bad.length + ' modifier(s) hidden', bad) : res('PASS', n ? n + ' fail / slow modifier(s) recorded distinctly' : 'no expected failure or slow test in this phase');
  }
  // 23 — missing prerequisites visible as SKIP / BLOCKED
  {
    const d = run.data_readiness || {}; const bad = [];
    const skips = (Array.isArray(d.gaps) ? d.gaps : []).filter((g) => /^skip\b/i.test(String(g.decision || ''))).flatMap((g) => (Array.isArray(g.tcs) ? g.tcs : String(g.tcs || '').split(',')).map((x) => String(x).trim()).filter(Boolean));
    for (const tc of uniq([...skips, ...(d.predicted_skips || [])])) { const r = merged.results.find((x) => x.tc_id === tc); if (!r) bad.push(tc + ': predicted skip has no results[] row'); else if (!['SKIP', 'NOT_RUN'].includes(r.status)) bad.push(tc + ': predicted skip reported ' + r.status); else if (!r.classification || r.classification === 'N/A') bad.push(tc + ': skip without a reason'); }
    checks['23'] = bad.length ? res('FAIL', bad.length + ' prerequisite(s) not visible', bad) : res('PASS', uniq(skips).length + ' readiness skip(s) visible as SKIP with a reason');
  }
  // 25b — execution honoured the plan
  {
    const bad = []; const plan0 = run.run_plan || {};
    const dispatch = ctx.summaries.filter((s) => s.dispatch && s.dispatch.scheduler === 'dispatch');
    for (const c of cmds) {
      // isolation and burn-in commands run alone under every scheduler
      if (c.command === 'isolation' || c.command === 'burn-in') { if (c.workers !== 1) bad.push(c.stage + ' ' + c.group + ' ' + c.command + ' attempt ' + c.attempt + ' ran with ' + c.workers + ' workers (must be 1)'); continue; }
      if (c.summary.dispatch && c.summary.dispatch.scheduler === 'dispatch') continue;
      // auto without proof of independence: every command must have run with ONE worker
      if (c.summary.scheduler && c.summary.scheduler.used === 'serial') { if (c.workers !== 1) bad.push(c.stage + ' ' + c.group + ': serial fallback (' + (c.summary.scheduler.fallback || 'no proof of independence') + ') but ran with ' + c.workers + ' workers'); continue; }
      const p = planAt(plan0, run.run_plan_adjustments, c.startedAt);
      const g = (p.groups || []).find((x) => x.name === c.group);
      if (!g) { bad.push(c.stage + ' ' + c.group + ': group not in the run plan'); continue; }
      const want = plannedWorkers(p, g);
      const serial = g.mode === 'serial';
      const lowered = ((c.summary.rateLimit && c.summary.rateLimit.adjustments) || []).some((a) => a.group === c.group && a.workers_to === c.workers)
        // never more workers than TCs; the machine ceiling / host capacity may lower (never raise) a group
        || (c.workers < want && (c.workers === Math.max(1, c.tcs.length) || ((c.summary.ledger && c.summary.ledger.lowered) || []).some((l) => l.group === c.group && l.to === c.workers)));
      const override = (c.summary.warnings || []).some((w) => /workers overridden to/i.test(String(w)));
      if (serial && c.workers !== 1) bad.push(c.stage + ' ' + c.group + ': serial group ran with ' + c.workers + ' workers');
      else if (c.workers !== want && !lowered && !override) bad.push(c.stage + ' ' + c.group + ': ran with ' + c.workers + ' workers, the plan says ' + want);
    }
    for (const s of dispatch) {
      const tl = (s.dispatch.timeline || []).map((x) => ({ ...x, s: ms(x.start), e: ms(x.end) }));
      const overlaps = (a, b) => a !== b && a.s !== null && b.s !== null && a.s < (b.e ?? Infinity) && b.s < (a.e ?? Infinity);
      for (const cf of s.dispatch.conflicts || []) {
        const as = tl.filter((x) => x.unit === cf.a); const bs = tl.filter((x) => x.unit === cf.b);
        for (const a of as) for (const b of bs) if (overlaps(a, b)) bad.push(s.stage + ': conflicting units ' + cf.a + ' and ' + cf.b + ' overlapped (' + (cf.keys || []).join(', ') + ')');
      }
      // a run-alone / barrier unit (an exclusive claim — unknown effects) must have overlapped NOTHING
      for (const a of tl.filter((x) => x.global && !x.notAdmitted)) for (const b of tl) if (!b.notAdmitted && overlaps(a, b)) bad.push(s.stage + ': run-alone unit ' + a.unit + ' overlapped ' + b.unit);
    }
    // 3.0 — every TC in the project its layer needs: api / db / api+db in the backend project, ui / hybrid in a browser one
    const backendProject = (run.run_plan && run.run_plan.backend_project) || 'backend';
    for (const e of ctx.execs || buildExecutions(ctx)) {
      if (!e.ran || !(run.run_plan && run.run_plan.layers && run.run_plan.layers[e.tc])) continue;
      const backend = isBackendLayer(layerOfTc(run, e.tc));
      if (backend && e.project !== backendProject) bad.push(e.tc + ': a ' + layerOfTc(run, e.tc) + ' TC ran in the ' + e.project + ' project (the backend project is ' + backendProject + ')');
      if (!backend && e.project === backendProject) bad.push(e.tc + ': a ' + layerOfTc(run, e.tc) + ' TC ran in the backend project — it needs a browser');
    }
    const moves = (run.run_plan_adjustments || []).filter((a) => a && a.kind === 'move');
    for (const s of ctx.summaries) for (const e of s.interference || []) if (e.kind === 'failed-beside-passed-alone' && !moves.some((m) => m.tc === e.tc)) bad.push(e.tc + ': parallel interference without its run_plan_adjustments move');
    checks['25b'] = bad.length ? res('FAIL', bad.length + ' departure(s) from the plan', bad) : res('PASS', cmds.length + ' command(s) ran in their planned mode and workers' + (dispatch.length ? '; no conflicting units overlapped' : '') + '; isolation moves applied');
  }
  // 31-34 — traceability and coverage
  {
    const cov = run.coverage_snapshot || null; const reqs = cov && Array.isArray(cov.requirements) ? cov.requirements : null;
    const conflicted = merged.results.filter((r) => r.req_id_conflict);
    const noReq = merged.results.filter((r) => !r.req_id_conflict && (!r.req_id || r.req_id === DASH)).map((r) => r.tc_id);
    checks['31'] = !reqs ? res('unresolved', 'run file has no coverage_snapshot.requirements')
      : !reqs.length || noReq.length ? res('FAIL', (reqs.length ? '' : 'no requirement in the coverage snapshot; ') + (noReq.length ? 'results without req_id (no source names one — run file, coverage snapshot, TC document): ' + noReq.join(', ') : '') + (conflicted.length ? '; ' + conflicted.length + ' with conflicting sources' : ''), [...noReq, ...conflicted.map((r) => r.tc_id + ': ' + r.req_id_conflict)])
      : conflicted.length ? res('unresolved', conflicted.length + ' result(s) whose requirement sources disagree — resolve the coverage judgement or the TC document, never by picking one', conflicted.map((r) => r.tc_id + ': ' + r.req_id_conflict))
      : res('PASS', reqs.length + ' requirement id(s) in the coverage snapshot; every result carries a req_id');
    const bad32 = [];
    for (const r of reqs || []) for (const tc of r.assertedBy || []) if (!merged.results.some((x) => x.tc_id === tc)) bad32.push(r.id + ' → ' + tc + ': no results[] row');
    for (const r of merged.results) if (['PASS', 'FAIL', 'INCOMPLETE', 'PARTIAL'].includes(r.status) && !(r.variants || []).length) bad32.push(r.tc_id + ': a result without an executed variant');
    checks['32'] = !reqs ? res('unresolved', 'run file has no coverage_snapshot') : bad32.length ? res('FAIL', bad32.length + ' break(s) in requirement → TC → test → result', bad32) : res('PASS', 'requirement → TC → test → result mappable for ' + merged.results.length + ' TC(s)');
    const three = cov && typeof cov.weightedPct === 'number' && reqs && merged.totals && typeof merged.totals.total === 'number';
    checks['33'] = three ? res('PASS', 'requirement outcome coverage (' + reqs.length + ' requirements), TC automation coverage (' + cov.weightedPct + '%) and the execution totals are recorded separately') : res(cov ? 'FAIL' : 'unresolved', 'a coverage figure is missing (requirements / weightedPct / totals)');
    const bad34 = [];
    for (const r of merged.results) if (['NOT_RUN', 'INCOMPLETE', 'SKIP'].includes(r.status) && (!r.classification || r.classification === 'N/A')) bad34.push(r.tc_id + ': ' + r.status + ' without a reason');
    for (const r of reqs || []) if (!r.outcome) bad34.push(r.id + ': requirement without an outcome');
    checks['34'] = !reqs ? res('unresolved', 'run file has no coverage_snapshot') : bad34.length ? res('FAIL', bad34.length + ' gap(s) hidden', bad34) : res('PASS', 'missing / partial / blocked / unexecuted coverage visible');
  }
  // 37 — outputs under the resolved roots
  {
    const bad = []; const shots = posix(String(run.screenshots_root || '')).replace(/\/+$/, '');
    if (!shots) bad.push('run file has no screenshots_root');
    for (const r of merged.results) for (const v of r.variants || []) for (const a of v.attempts || []) for (const p of [a.evidence_screenshot, a.failure_screenshot, a.evidence_record, a.failure_record]) if (p && shots && !posix(p).startsWith(shots + '/phase-' + N + '/')) bad.push(r.tc_id + ': ' + p + ' is outside ' + shots + '/phase-' + N + '/');
    if (run.results_root && posix(String(run.results_root)).replace(/\/+$/, '') !== ctx.rrRel) bad.push('run file results_root ' + run.results_root + ' is not ' + ctx.rrRel);
    const logs = posix(String(run.logs_root || '')).replace(/\/+$/, '');
    if (run.progress_log && logs && !posix(run.progress_log).startsWith(logs + '/')) bad.push('progress log ' + run.progress_log + ' is outside ' + logs);
    checks['37'] = bad.length ? res('FAIL', bad.length + ' output(s) outside the resolved roots', bad) : res('PASS', 'evidence, results and progress log under the resolved roots');
  }
  // 38 — no credential in the logs, the learning file, the run file or the report
  {
    const files = [];
    if (run.progress_log) files.push(path.join(ar, run.progress_log));
    if (learning) files.push(path.resolve(learning));
    files.push(ctx.runFile);
    const dd = path.join(rr, 'artifacts', 'drafts', 'phase-' + N);
    if (run.feature) for (const f of ['TEST-RUN-REPORT-' + run.feature + '.md', 'BUG-REPORT-' + run.feature + '.md']) files.push(path.join(published ? rr : dd, f));
    const bad = []; let scanned = 0;
    for (const f of uniq(files)) { const t = read(f); if (t === null) continue; scanned++; t.split(/\r?\n/).forEach((l, i) => { if (SECRET_RE.test(l)) bad.push(posix(path.relative(ar, f)) + ':' + (i + 1)); }); }
    // 3.0 — the API / DB records of this phase: no secret pattern may survive the redaction (helpers/redact.ts)
    for (const r of merged.results) for (const v of r.variants || []) for (const a of v.attempts || []) for (const p of [a.evidence_record, a.failure_record]) {
      if (!p) continue;
      const t = read(path.join(ar, p)); if (t === null) continue; scanned++;
      const hits = scanForSecrets(t, []);
      if (hits.length) bad.push(posix(p) + ' (' + uniq(hits.map((h) => h.kind)).join(', ') + ')');
    }
    checks['38'] = bad.length ? res('FAIL', bad.length + ' credential-shaped line(s) — value never printed', bad) : res('PASS', scanned + ' file(s) scanned, no credential-shaped value');
  }
  // 43 — calibration records complete
  {
    const t = run.timeouts || null; const bad = [];
    if (!t || !t.initial) bad.push('timeouts.initial not recorded');
    for (const a of (t && t.adjusted) || []) for (const k of ['key', 'from_ms', 'to_ms', 'reason', 'evidence']) if (a[k] === undefined || a[k] === null || a[k] === '') bad.push('adjustment ' + (a.key || '?') + ' lacks ' + k);
    checks['43'] = bad.length ? res('FAIL', bad.length + ' calibration gap(s)', bad) : res('PASS', 'initial values recorded; ' + ((t.adjusted || []).length ? (t.adjusted.length + ' adjustment(s) with key, from, to, reason and evidence') : 'no value adjusted'));
  }
  // 45 — cleanup flags swept
  {
    const flagged = merged.results.filter((r) => r.classification === 'cleanup_incomplete').map((r) => r.tc_id);
    const swept = new Set(((run.cleanup && run.cleanup.sweeps) || []).flatMap((s) => s.tcs || []));
    const bad = flagged.filter((tc) => !swept.has(tc)).map((tc) => tc + ': cleanup_incomplete without a sweep record (run file cleanup.sweeps[])');
    checks['45'] = bad.length ? res('FAIL', bad.length + ' unswept cleanup(s)', bad) : res('PASS', flagged.length ? flagged.length + ' cleanup_incomplete TC(s) swept' : 'no cleanup_incomplete TC');
  }
  // 46b — a console report for every executed BROWSER test (3.0: an api / db / api+db test has no page to watch)
  {
    const all = spans.filter((s) => s.status && s.status !== 'skipped');
    const executed = all.filter((s) => !isBackendLayer(layerOfTc(run, s.tcs[0])));
    const bad = executed.filter((s) => !s.events.some((e) => e.event === 'console-report')).map(label);
    if (!all.length) checks['46b'] = res('PASS', 'no executed test in this phase');
    // the check has a subject (no-browser-tests did not N/A it) yet no browser test ran: never a vacuous PASS
    else if (!executed.length) checks['46b'] = res('unresolved', 'no browser test executed in this phase although the check applies — 46b is N/A only through the script-decided no-browser-tests predicate');
    else if (!anyConsole) checks['46b'] = res('unresolved', 'no `console-report` heartbeat in this phase — helpers/console-guard.ts is older than the template; review the console-errors attachments by hand or update the guard');
    else checks['46b'] = bad.length ? res('FAIL', bad.length + ' of ' + executed.length + ' executed tests without a console report', bad) : res('PASS', executed.length + ' executed tests, each with its console report');
  }
  // 48a — stops only on FROZEN or the outer ceiling; 48b — every event classified (never N/A)
  {
    const stops = cmds.filter((c) => c.stop);
    const bad = stops.filter((c) => !(c.stop.kind === 'ceiling' || (c.stop.kind === 'watchdog' && c.stop.verdict === 'FROZEN'))).map((c) => c.stage + ' ' + c.group + ' attempt ' + c.attempt + ': stop "' + c.stop.kind + '" (' + (c.stop.verdict || '—') + ')');
    checks['48a'] = bad.length ? res('FAIL', bad.length + ' stop(s) not taken on FROZEN / the ceiling', bad) : res('PASS', stops.length ? stops.length + ' stop(s), each FROZEN or ceiling' : '0 stops in ' + cmds.length + ' command(s)');
    const events = [...(merged.watchdog_events || []).map((e) => ({ what: 'watchdog ' + (e.tc || e.group || ''), c: e.classification })), ...((merged.timeouts && merged.timeouts.events) || []).map((e) => ({ what: (e.kind || 'timeout') + ' ' + (e.tc || '') + (e.step ? ' "' + e.step + '"' : ''), c: e.classification }))];
    const open = events.filter((e) => !e.c).map((e) => e.what.trim() + ': not classified');
    checks['48b'] = open.length ? res('FAIL', open.length + ' of ' + events.length + ' event(s) unclassified', open) : res('PASS', events.length ? events.length + ' watchdog / stall / admission / timeout event(s), each classified' : '0 watchdog, stall, admission-wait or timeout events in this phase');
  }
  // 50 — no scratch probe left
  {
    const dir = path.join(ar, 'test-results', 'qa-scratch');
    const left = isDir(dir) ? readdirSafe(dir).filter((f) => /\.(spec|test)\.[cm]?[jt]sx?$/i.test(f) || f === 'scratch.config.ts') : [];
    checks['50'] = left.length ? res('FAIL', 'scratch probe(s) left in test-results/qa-scratch — run scratch.mjs clean', left) : res('PASS', 'no scratch probe under test-results/qa-scratch');
  }
  // 53 — data changes (3.0), from the ownership ledgers of this run: every write consented, never production, only on
  // run-created records, read back, torn down or retained — and nothing left in doubt
  {
    const L = dataLedger(ctx);
    const dc = run.data_changes || {};
    const consented = new Set(Array.isArray(dc.tcs) ? dc.tcs : []);
    const envClass = String((run.environment && run.environment.class) || '').toLowerCase();
    const bad = []; const doubt = [];
    // every key this run created, whatever the file order (an update in a later command's ledger is checked against all of them)
    const keyOfLine = (l) => (l.table || l.resource || '?') + ' ' + (typeof l.key === 'string' ? l.key : JSON.stringify(l.key));
    const created = new Set(L.writes.filter((w) => (w.lines[0].op === 'insert' || w.lines[0].op === 'create') && w.lines.some((l) => /^(committed|verified|recovered)$/.test(l.state))).map((w) => keyOfLine(w.lines.find((l) => l.key !== null && l.key !== undefined) || w.lines[0])));
    for (const w of L.writes) {
      const states = w.lines.map((l) => l.state);
      const first = w.lines[0];
      const k = (first.table || first.resource || '?') + ' ' + (typeof first.key === 'string' ? first.key : JSON.stringify(first.key));
      const done = states.some((s) => s === 'committed' || s === 'recovered' || s === 'teardown-done' || s === 'retained');
      const purpose = first.purpose || 'test';
      if (states.includes('intent') && !states.some((s) => s !== 'intent')) { doubt.push(first.tc + ' ' + first.op + ' ' + k + ': intent without an outcome (in doubt — resolve it by a lookup, never assume)'); continue; }
      if (!done) continue;   // rolled back: nothing changed
      if (purpose === 'test' && !consented.has(first.tc)) bad.push(first.tc + ': ' + first.op + ' ' + k + ' without the per-TC data-changes consent');
      if (purpose === 'setup' && dc.setup !== true && dc.setup !== 'yes') bad.push(first.tc + ': setup ' + first.op + ' ' + k + ' without the test-data preparation consent');
      if (purpose === 'teardown' && dc.cleanup !== true && dc.cleanup !== 'yes') bad.push(first.tc + ': clean-up ' + k + ' without the tester\'s clean-up answer');
      if (envClass === 'production' || envClass === 'unknown' || (!envClass && L.writes.length)) bad.push(first.tc + ': ' + first.op + ' ' + k + ' on an environment of class "' + (envClass || 'not recorded') + '" — data changes only on test / staging');
      if (first.op === 'insert' || first.op === 'create') { /* counted above */ }
      else if ((first.op === 'update' || first.op === 'delete' || first.op === 'modify' || first.op === 'remove') && !created.has(k) && !L.preparedKeys.has(k)) bad.push(first.tc + ': ' + first.op + ' ' + k + ' on a record this run did not create');
      if (first.channel === 'db' && (first.op === 'insert' || first.op === 'update') && states.includes('committed') && !states.includes('verified') && !states.includes('recovered')) bad.push(first.tc + ': ' + first.op + ' ' + k + ' committed without its read-back');
      if (states.includes('teardown-failed') && !states.includes('teardown-done')) bad.push(first.tc + ': clean-up of ' + k + ' failed');
    }
    const dataTcs = merged.results.filter((r) => consented.has(r.tc_id) && ['PASS', 'FAIL'].includes(r.status)).map((r) => r.tc_id);
    // a FAIL outranks a doubt (both are listed); a doubt alone keeps the check unresolved — never PASS
    if (bad.length) checks['53'] = res('FAIL', bad.length + ' data change(s) outside the rules' + (doubt.length ? ', ' + doubt.length + ' in doubt' : ''), [...bad, ...doubt]);
    else if (doubt.length) checks['53'] = res('unresolved', doubt.length + ' write(s) in doubt', doubt);
    else if (!L.files && dataTcs.length) checks['53'] = res('unresolved', 'data-changing TC(s) ran (' + dataTcs.join(', ') + ') but this phase has no data ledger — the changes cannot be proven owned, read back or cleaned');
    else checks['53'] = res('PASS', L.writes.length ? L.writes.length + ' data change(s): consented, run-owned, read back; ' + L.retained.length + ' retained, ' + L.removed + ' removed' : 'no data change in this phase');
  }
  // 54 — a valid, sealed, redacted record for every attempt of an API / DB test, traceable to its TC and attempt
  {
    const bad = []; let n = 0;
    const lines = (run.run_plan && run.run_plan.backend_lines) || {};
    for (const r of merged.results) {
      if (!needsRecordLayer(layerOfTc(run, r.tc_id))) continue;
      for (const v of r.variants || []) for (const a of v.attempts || []) {
        if (!['PASS', 'FAIL', 'PARTIAL'].includes(a.status)) continue;
        n++;
        const at = r.tc_id + ' ' + v.variant_slug + ' attempt ' + a.attempt;
        if (!a.evidence_record) { bad.push(at + ': no record'); continue; }
        const c = checkRecordFile(path.join(ar, a.evidence_record), { tc: r.tc_id, attempt: a.attempt, status: a.status, backendLines: a.status === 'PASS' ? lines[r.tc_id] || [] : [] });
        if (!c.ok) bad.push(at + ': ' + c.problems.join('; '));
      }
    }
    checks['54'] = bad.length ? res('FAIL', bad.length + ' API / DB attempt(s) without a valid record', bad) : res('PASS', n ? n + ' API / DB attempt(s), each with a valid sealed record' : 'no API / DB attempt in this phase');
  }
  // results freshness (payload only — Checkpoint B's gate reads it from impact.final_check)
  const fc = run.impact && run.impact.final_check ? run.impact.final_check : null;
  const freshness = !fc ? res('unresolved', 'impact.final_check missing — run impact.mjs select on the final code') : (fc.stale || []).length ? res('FAIL', 'stale: ' + fc.stale.map((x) => (typeof x === 'string' ? x : x.tc)).join(', ')) : res('PASS', 'stale: [] at ' + (fc.at || '—'));
  const all = [...Object.values(checks), freshness];
  const gate = all.some((c) => c.status === 'FAIL') ? 'FAIL' : all.some((c) => c.status === 'unresolved') ? 'BLOCKED' : 'PASS';
  return { gate, checks, freshness };
}

export function recordChecks(resultsRoot, snapshotId, checks) {
  const file = path.join(resultsRoot, 'artifacts', 'checks', snapshotId, 'results.jsonl');
  const existing = jsonl(file);
  const written = []; const skipped = [];
  const lines = [];
  for (const [id, c] of Object.entries(checks)) {
    if (existing.some((x) => x.checkId === id && x.unit === 'phase' && x.snapshotId === snapshotId && x.executor === 'S')) { skipped.push(id); continue; }
    lines.push(JSON.stringify({ checkId: id, unit: 'phase', snapshotId, status: c.status === 'PASS' ? 'verified-mechanical' : c.status === 'FAIL' ? 'FAIL' : 'unresolved', reason: c.evidence, evidenceRef: (c.details || []).slice(0, 20).join('; ') || null, executor: 'S', at: new Date().toISOString() }));
    written.push(id);
  }
  if (lines.length) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, lines.join('\n') + '\n'); }
  return { file, written, skipped };
}

/* ---------------- acceptance — Revision 3.1 §3.8 ---------------- */

export function computeAcceptance(ctx, merged, gates) {
  const run = ctx.run; const reasons = [];
  const final = !!gates.B;
  const A = gates.A && gates.A.data; const B = gates.B && gates.B.data;
  if (!gates.A) reasons.push('Checkpoint A gate record missing');
  else if (!A) reasons.push('Checkpoint A gate record unreadable');
  else if (A.verdict !== 'PASS') reasons.push('Checkpoint A not PASS (' + A.verdict + ')');
  if (final) {
    if (!B) reasons.push('Checkpoint B gate record unreadable');
    else {
      if (B.verdict !== 'PASS') reasons.push('Checkpoint B not PASS (' + B.verdict + ')');
      if (B.rehash && B.rehash.matched === false) reasons.push('Checkpoint B snapshot void (re-hash differs)');
      if (B.freshness && (B.freshness.stale || []).length) reasons.push('stale results: ' + B.freshness.stale.map((x) => (typeof x === 'string' ? x : x.tc)).join(', '));
    }
  }
  const fc = run.impact && run.impact.final_check;
  if (!fc) reasons.push('results freshness not checked (impact.final_check missing)');
  else if ((fc.stale || []).length && !(final && B && B.freshness)) reasons.push('stale results: ' + fc.stale.map((x) => (typeof x === 'string' ? x : x.tc)).join(', '));
  // concurrency findings — every interference in the summaries, with the resolution the model recorded in parallel_checks[]
  const pcs = merged.parallel_checks || [];
  for (const p of pcs) {
    if (p.outcome !== 'interference' || p.resolution) continue;
    if (p.cause === 'possible_product_concurrency_defect') reasons.push('possible product concurrency defect unresolved: ' + p.tc);
    else if (!p.cause || p.cause === 'unexplained') reasons.push('unexplained first-attempt regression: ' + p.tc + ' (failed beside other tests, passed alone, no evidenced cause)');
  }
  // required TCs left NOT_RUN / INCOMPLETE by admission, host pressure, a deferred wait or the environment lease
  const capacity = merged.results.filter((r) => ['NOT_RUN', 'INCOMPLETE'].includes(r.status) && (CAPACITY_REASON.test(String(r.status_reason || '')) || CAPACITY_REASON.test(String(r.classification || ''))));
  for (const r of capacity) reasons.push('required TC not run by admission / pressure / deferral / lease: ' + r.tc_id + ' (' + (CAPACITY_REASON.test(String(r.status_reason || '')) ? r.status_reason : r.classification) + ')');
  // 3.0 — an API / DB TC the run could not start or prove (mapping, client, config, layer, evidence, a write in doubt),
  // and a CONSENTED data-changing TC refused anyway (its target unverified) — never the tester's own "no"
  const consented = new Set(((run.data_changes && run.data_changes.tcs) || []));
  for (const r of merged.results) {
    const why = String(r.status_reason || r.classification || '');
    if (['NOT_RUN', 'INCOMPLETE'].includes(r.status) && BACKEND_REASON.test(why)) reasons.push('required API / DB TC without a verdict: ' + r.tc_id + ' (' + why + ')');
    else if (r.status === 'NOT_RUN' && CONSENT_REASON.test(why) && consented.has(r.tc_id)) reasons.push('consented data-changing TC refused: ' + r.tc_id + ' (' + why + ' — the target was not verified)');
  }
  const ledger = dataLedger(ctx);
  if (ledger.inDoubt.length) reasons.push(ledger.inDoubt.length + ' data change(s) in doubt after a crash: ' + ledger.inDoubt.map((d) => d.tc + ' ' + d.op + ' ' + d.target).join('; '));
  const sg = merged.smoke_gate;
  if (sg && sg.verdict === 'NO VERDICT') reasons.push('smoke gate: NO VERDICT');
  return { verdict: reasons.length ? 'NOT ACCEPTED' : 'ACCEPTED', reasons, mode: final ? 'final' : 'pre-gate', conditional_on: final ? [] : ['Checkpoint B PASS'], computed_at: new Date().toISOString() };
}

/* ---------------- drafts and publication — Revision 3.1 §6.3 ---------------- */

const draftDir = (rr, N) => path.join(rr, 'artifacts', 'drafts', 'phase-' + N);
export function initDrafts({ resultsRoot, phase, feature, force = false }) {
  const rr = path.resolve(resultsRoot); const dir = draftDir(rr, phase);
  const existing = isDir(dir) ? readdirSafe(dir).filter((f) => f !== '.runs') : [];
  if ((existing.length || readdirSafe(path.join(dir, '.runs')).length) && !force) return { outcome: 'REFUSED', reason: 'drafts already exist in ' + posix(path.relative(rr, dir)) + ' — pass --force to re-seed them', copied: [] };
  fs.mkdirSync(path.join(dir, '.runs'), { recursive: true });
  const copied = [];
  for (const f of ['TEST-RUN-REPORT-' + feature + '.md', 'BUG-REPORT-' + feature + '.md']) { const src = path.join(rr, f); if (isFile(src)) { fs.copyFileSync(src, path.join(dir, f)); copied.push(f); } }
  for (const f of readdirSafe(path.join(rr, '.runs')).filter((x) => /^phase-\d+\.json$/.test(x))) { fs.copyFileSync(path.join(rr, '.runs', f), path.join(dir, '.runs', f)); copied.push('.runs/' + f); }
  return { outcome: 'CREATED', dir: posix(path.relative(rr, dir)), copied };
}

// the frozen hash of a draft in the gate record: keys may be relative to the drafts folder, the results root or bare names
function frozenHashOf(frozen, relInDrafts) {
  const want = posix(relInDrafts);
  for (const [k, v] of Object.entries(frozen || {})) { const kk = posix(k).replace(/^\.\/+/, ''); if (kk === want || kk.endsWith('/' + want)) return v; }
  return null;
}
export function publishPhase({ resultsRoot, phase, feature = null, force = false, root = null, expectSnapshotId = null }) {
  const rr = path.resolve(resultsRoot); const N = Number(phase); const dir = draftDir(rr, N);
  const base = { outcome: 'REFUSED', reason: null, promoted: [], page: null, reproduced: null, writes: [] };
  const gateFile = path.join(rr, '.runs', 'phase-' + N + '.checkpoint-B.json');
  if (!isFile(gateFile)) return { ...base, outcome: 'NOT_RUN', reason: 'no Checkpoint B gate record (' + posix(path.relative(rr, gateFile)) + ')' };
  const { data: gate, error } = readJson(gateFile);
  if (!gate) return { ...base, reason: 'gate record unreadable: ' + error };
  if (gate.schema !== GATE_SCHEMA || gate.checkpoint !== 'B' || Number(gate.phase) !== N) return { ...base, reason: 'gate record is not the Checkpoint B record of phase ' + N + ' (schema ' + gate.schema + ', checkpoint ' + gate.checkpoint + ', phase ' + gate.phase + ')' };
  if (gate.verdict !== 'PASS') return { ...base, reason: 'Checkpoint B is ' + gate.verdict + ' — nothing is published' };
  if (gate.rehash && gate.rehash.matched === false) return { ...base, reason: 'Checkpoint B snapshot is void (re-hash differs) — nothing is published' };
  // finalize publishes ONLY the drafts its own freeze covered: the gate must be the one of that snapshot
  if (expectSnapshotId && gate.snapshotId !== expectSnapshotId) return { ...base, reason: 'the Checkpoint B gate record belongs to snapshot ' + gate.snapshotId + ', not the frozen ' + expectSnapshotId + ' — nothing is published' };
  const frozen = (gate.frozen && gate.frozen.drafts) || {};
  let feat = feature;
  if (!feat) { const m = readdirSafe(dir).map((f) => f.match(/^TEST-RUN-REPORT-(.+)\.md$/)).find(Boolean); feat = m ? m[1] : null; }
  if (!feat) return { ...base, reason: 'no draft report in ' + posix(path.relative(rr, dir)) };
  const names = { report: 'TEST-RUN-REPORT-' + feat + '.md', bugs: 'BUG-REPORT-' + feat + '.md', run: '.runs/phase-' + N + '.json' };
  const promote = [];
  for (const [kind, rel] of Object.entries(names)) {
    const src = path.join(dir, rel);
    const want = frozenHashOf(frozen, rel);
    if (!isFile(src)) { if (kind === 'bugs' && !want) continue; return { ...base, reason: 'draft ' + rel + ' missing' }; }
    if (!want) return { ...base, reason: 'draft ' + rel + ' is not frozen in the gate record (frozen.drafts)' };
    if (shaFile(src) !== want && shaTextLf(src) !== want) return { ...base, reason: 'draft ' + rel + ' changed after the freeze (sha256 differs from the gate record) — nothing is published' };
    promote.push({ kind, rel, src, dst: path.join(rr, rel) });
  }
  // earlier phases' run files copied for rendering must still be the published ones
  for (const f of readdirSafe(path.join(dir, '.runs')).filter((x) => /^phase-\d+\.json$/.test(x) && x !== 'phase-' + N + '.json')) {
    const pub = path.join(rr, '.runs', f);
    if (isFile(pub) && shaFile(pub) !== shaFile(path.join(dir, '.runs', f))) return { ...base, reason: 'draft copy of .runs/' + f + ' differs from the published one — an earlier phase is immutable' };
  }
  // the run's report choice (3.1): `md` → the renderer still checks the markdown (its gate), but no page is written
  const reportFormat = deliveryOf(readJson(path.join(dir, names.run)).data).report;
  // predicted page: the drafts rendered as if they stood in the story folder
  const pre = render({ reportPath: path.join(dir, names.report), bugsPath: isFile(path.join(dir, names.bugs)) ? path.join(dir, names.bugs) : null, runsDir: path.join(dir, '.runs'), base: rr, gatePath: gateFile, root: root || rr });
  if (!pre.html || pre.payload.gate !== 'PASS') return { ...base, reason: 'the renderer gate on the drafts is ' + pre.payload.gate + ' (' + pre.payload.gateReason + ') — fix the drafts, re-run Checkpoint B', rendererGate: pre.payload.gate };
  const pageFile = path.join(rr, 'TEST-RUN-REPORT-' + feat + '.html');
  if (reportFormat === 'html' && isFile(pageFile)) { const st = pageState(fs.readFileSync(pageFile, 'utf8')); if (st.provenance && st.handEdited && !force) return { ...base, reason: 'the published page was edited by hand after it was rendered — pass --force to replace it' }; }
  // promote byte-identical, keeping what was there for a rollback
  const backup = new Map();
  for (const f of [...promote.map((p) => p.dst), ...(reportFormat === 'html' ? [pageFile] : [])]) backup.set(f, isFile(f) ? fs.readFileSync(f) : null);
  const rollback = () => { for (const [f, buf] of backup) { try { if (buf === null) fs.rmSync(f, { force: true }); else writeBytesAtomic(f, buf); } catch { /* reported below */ } } };
  try {
    for (const p of promote) { writeBytesAtomic(p.dst, fs.readFileSync(p.src)); base.promoted.push(p.rel); base.writes.push({ file: posix(path.relative(rr, p.dst)), kind: p.kind, bytes: fs.statSync(p.dst).size }); }
    for (const p of promote) if (shaFile(p.dst) !== shaFile(p.src)) { rollback(); return { ...base, outcome: 'FAILED', reason: 'promoted ' + p.rel + ' is not byte-identical to its draft — rolled back', promoted: [] }; }
    const r = render({ reportPath: path.join(rr, names.report), gatePath: gateFile, root: root || rr });
    if (!r.html || r.payload.gate !== 'PASS') { rollback(); return { ...base, outcome: 'FAILED', reason: 'renderer gate on the promoted files is ' + r.payload.gate + ' — rolled back', promoted: [] }; }
    if (r.html !== pre.html) { rollback(); return { ...base, outcome: 'FAILED', reason: 'the page of the promoted files differs from the page of the drafts — rolled back', promoted: [] }; }
    // markdown only: the markdown is published and checked; an earlier phase's page (if any) is left exactly as it was
    if (reportFormat === 'md') return { ...base, outcome: 'PUBLISHED', reason: 'Checkpoint B PASS — ' + promote.length + ' draft(s) promoted byte-identical; markdown only by the run\'s choice (renderer gate PASS, no page written)', page: null, reproduced: null, reportFormat, gateSha256: shaTextLf(gateFile), ...(isFile(pageFile) ? { stalePage: posix(path.relative(rr, pageFile)) + ' — an earlier phase\'s page, untouched; it does not show phase ' + N } : {}) };
    writeBytesAtomic(pageFile, Buffer.from(r.html, 'utf8'));
    base.writes.push({ file: posix(path.relative(rr, pageFile)), kind: 'html', bytes: fs.statSync(pageFile).size });
    const again = render({ reportPath: path.join(rr, names.report), gatePath: gateFile, root: root || rr });
    const reproduced = again.html !== null && again.html === fs.readFileSync(pageFile, 'utf8');
    if (!reproduced) { rollback(); return { ...base, outcome: 'FAILED', reason: 'a dry re-render did not reproduce the published page byte for byte — rolled back', promoted: [], reproduced: false }; }
    return { ...base, outcome: 'PUBLISHED', reason: 'Checkpoint B PASS — ' + promote.length + ' draft(s) promoted byte-identical, page rendered from them and the gate record', page: posix(path.relative(rr, pageFile)), reproduced: true, gateSha256: shaTextLf(gateFile), pageProvenance: pageState(again.html).recorded };
  } catch (e) {
    rollback();
    return { ...base, outcome: 'FAILED', reason: 'publish failed (' + e.message + ') — rolled back', promoted: [] };
  }
}

/* ---------------- judge — the model's judgements, validated as a whole, into the model-owned fields ----------------
   The ONE supported way to record judgements in a (draft) run file — never a hand edit of the whole file, never an ad hoc
   script. Input (--judgements <json>):
     { "results": { "TC-01": { "classification", "root_cause", "severity", "assumption" } },
       "parallel_checks": [ { "tc", "parallel_attempt"?, "cause", "cause_evidence"?: [], "resolution" } ],
       "events": [ { "kind": "watchdog" | "timeout", "tc", "step"?, "stage"?, "group"?, "classification" } ],
       "heal_log": [ { tc_id, files, category, previous, updated, reason, requirement_ref, verification, rerun_result } ],
       "deviations": [ "…" ], "skips": [ { tc_id, status, reason } ],
       "unverified_assumptions": [ { tc_id, wording, interpretation, evidence, result } ],
       "bugs": [ { id: "BUG-n", title, tc_id, severity, status } ] }            (req_id filled from the result row)
   Arrays REPLACE the run file's arrays (the file is the complete list). Any invalid, unknown, duplicate or contradictory
   entry rejects the whole set — nothing is written. A mechanical classification (rate_limited, interrupted: …, not started:
   …) is the script's and is never overwritten. */
export const FAIL_CLASSES = Object.freeze(['selector_failure', 'assertion_failure', 'app_bug', 'api_contract_failure', 'db_assertion_failure', 'environment_failure', 'data_missing', 'timeout_failure', 'evidence_failure', 'unverified_assumption', 'automation_failure', 'ai_rubric_failure']);
export const SEVERITIES = Object.freeze(['Critical', 'High', 'Medium', 'Low', 'N/A']);
const CAUSES = ['test_data_conflict', 'possible_product_concurrency_defect', 'environment', 'unexplained'];
const BUG_STATUS_RE = /^(open|not-checked-this-run|resolved \(phase \d+\))$/;
const HEAL_KEYS = ['tc_id', 'files', 'category', 'previous', 'updated', 'reason', 'requirement_ref', 'verification', 'rerun_result'];
const JUDGE_KEYS = ['results', 'parallel_checks', 'events', 'heal_log', 'deviations', 'skips', 'unverified_assumptions', 'bugs'];

export function applyJudgements(run, j) {
  const errors = [];
  const changed = { results: 0, parallel_checks: 0, events: 0, replaced: [] };
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { errors: ['the judgements file must be a JSON object'], changed };
  for (const k of Object.keys(j)) if (!JUDGE_KEYS.includes(k)) errors.push('unknown key "' + k + '" — allowed: ' + JUDGE_KEYS.join(', '));
  const out = JSON.parse(JSON.stringify(run));
  const rows = new Map((out.results || []).map((r) => [r.tc_id, r]));
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  // results
  for (const [tc, v] of Object.entries(j.results || {})) {
    const r = rows.get(tc);
    if (!r) { errors.push('results.' + tc + ': no results[] row for this TC — run merge first'); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push('results.' + tc + ': must be an object'); continue; }
    for (const k of Object.keys(v)) if (!['classification', 'root_cause', 'severity', 'assumption'].includes(k)) errors.push('results.' + tc + '.' + k + ': not a judgement field (classification, root_cause, severity, assumption)');
    if (v.classification !== undefined) {
      const cur = String(r.classification || '');
      if (MECHANICAL_CLASS.test(cur) && v.classification !== cur) errors.push('results.' + tc + '.classification: "' + cur + '" is the script\'s mechanical classification — never overwritten');
      else if (r.status === 'FAIL' && !FAIL_CLASSES.includes(v.classification)) errors.push('results.' + tc + '.classification: a FAIL takes one of ' + FAIL_CLASSES.join(', ') + ' — got "' + v.classification + '"');
      else if (!str(v.classification)) errors.push('results.' + tc + '.classification: empty');
      else if (MECHANICAL_CLASS.test(v.classification) && v.classification !== cur) errors.push('results.' + tc + '.classification: "' + v.classification + '" is a mechanical class the merge sets, not a judgement');
    }
    if (v.severity !== undefined && !SEVERITIES.includes(v.severity)) errors.push('results.' + tc + '.severity: one of ' + SEVERITIES.join(', '));
    if (r.status === 'FAIL' && v.classification === 'app_bug' && v.severity !== undefined && v.severity === 'N/A') errors.push('results.' + tc + ': an app_bug needs a severity');
    if (!errors.some((e) => e.startsWith('results.' + tc))) {
      for (const k of ['classification', 'root_cause', 'severity', 'assumption']) if (v[k] !== undefined) r[k] = v[k];
      changed.results++;
    }
  }
  for (const r of out.results || []) if (r.status === 'FAIL' && (!r.classification || r.classification === 'N/A')) errors.push(r.tc_id + ': a FAIL without a classification — every failure is classified (' + FAIL_CLASSES.join(', ') + ')');
  // parallel checks — matched by TC (+ parallel attempt), never created here
  const seenPc = new Set();
  for (const [i, p] of (j.parallel_checks || []).entries()) {
    const tag = 'parallel_checks[' + i + ']';
    if (!p || !str(p.tc)) { errors.push(tag + ': needs tc'); continue; }
    const key = p.tc + '|' + (p.parallel_attempt ?? '*');
    if (seenPc.has(key)) { errors.push(tag + ': a second entry for ' + p.tc + (p.parallel_attempt !== undefined ? ' attempt ' + p.parallel_attempt : '')); continue; }
    seenPc.add(key);
    const hits = (out.parallel_checks || []).filter((x) => x.tc === p.tc && (p.parallel_attempt === undefined || x.parallel_attempt === p.parallel_attempt));
    if (hits.length !== 1) { errors.push(tag + ': ' + (hits.length ? hits.length + ' isolation outcomes of ' + p.tc + ' match — name parallel_attempt' : 'no isolation outcome of ' + p.tc + ' in parallel_checks[] — run merge first')); continue; }
    if (p.cause !== undefined && p.cause !== null && !CAUSES.includes(p.cause)) { errors.push(tag + '.cause: one of ' + CAUSES.join(', ')); continue; }
    if (p.resolution !== undefined && p.resolution !== null && !/^(test-side: .{8,}|bug: BUG-\d+)$/.test(String(p.resolution))) { errors.push(tag + '.resolution: "test-side: {evidence}" or "bug: BUG-{n}"'); continue; }
    for (const k of ['cause', 'cause_evidence', 'resolution']) if (p[k] !== undefined) hits[0][k] = p[k];
    changed.parallel_checks++;
  }
  // event classifications — watchdog_events[] and timeouts.events[], matched uniquely
  const seenEv = new Set();
  for (const [i, e] of (j.events || []).entries()) {
    const tag = 'events[' + i + ']';
    if (!e || !['watchdog', 'timeout'].includes(e.kind) || !str(e.classification)) { errors.push(tag + ': needs kind (watchdog | timeout) and a classification'); continue; }
    const key = e.kind + '|' + (e.tc || '') + '|' + (e.step || '') + '|' + (e.stage || '') + '|' + (e.group || '');
    if (seenEv.has(key)) { errors.push(tag + ': a second entry for the same event'); continue; }
    seenEv.add(key);
    const list = e.kind === 'watchdog' ? (out.watchdog_events || []) : ((out.timeouts && out.timeouts.events) || []);
    const hits = list.filter((x) => (!e.tc || x.tc === e.tc) && (!e.step || x.step === e.step) && (!e.stage || x.stage === e.stage) && (!e.group || x.group === e.group));
    if (hits.length !== 1) { errors.push(tag + ': ' + hits.length + ' ' + e.kind + ' events match — name tc / step / stage / group so exactly one does'); continue; }
    hits[0].classification = e.classification;
    changed.events++;
  }
  // the complete lists
  const arr = (k, check) => {
    if (j[k] === undefined) return;
    if (!Array.isArray(j[k])) { errors.push(k + ': must be an array'); return; }
    const errs = [];
    j[k].forEach((x, i) => { const m = check(x, i); if (m) errs.push(k + '[' + i + ']: ' + m); });
    if (errs.length) { errors.push(...errs); return; }
    out[k] = j[k];
    changed.replaced.push(k);
  };
  arr('heal_log', (x) => (!x || typeof x !== 'object' ? 'an object with ' + HEAL_KEYS.join(', ') : !rows.has(x.tc_id) ? 'tc_id ' + x.tc_id + ' has no results[] row' : HEAL_KEYS.filter((h) => x[h] === undefined).length ? 'missing ' + HEAL_KEYS.filter((h) => x[h] === undefined).join(', ') : null));
  arr('deviations', (x) => (str(x) ? null : 'a non-empty string'));
  arr('skips', (x) => (!x || !rows.has(x.tc_id) ? 'tc_id must name a results[] row' : !str(x.reason) ? 'needs a reason' : null));
  arr('unverified_assumptions', (x) => (!x || !rows.has(x.tc_id) ? 'tc_id must name a results[] row' : !str(x.interpretation) ? 'needs the interpretation encoded' : null));
  const seenBug = new Set();
  arr('bugs', (x) => {
    if (!x || !/^BUG-\d+$/.test(String(x.id))) return 'id BUG-{n}';
    if (seenBug.has(x.id)) return 'a second entry for ' + x.id;
    seenBug.add(x.id);
    if (!rows.has(x.tc_id)) return 'tc_id ' + x.tc_id + ' has no results[] row';
    if (!SEVERITIES.includes(x.severity) || x.severity === 'N/A') return 'severity Critical | High | Medium | Low';
    if (!BUG_STATUS_RE.test(String(x.status))) return 'status open | resolved (phase N) | not-checked-this-run';
    if (!str(x.title)) return 'needs a title';
    return null;
  });
  if (Array.isArray(out.bugs) && changed.replaced.includes('bugs')) out.bugs = out.bugs.map((b) => ({ ...b, req_id: b.req_id ?? (rows.get(b.tc_id) && rows.get(b.tc_id).req_id) ?? null }));
  return { errors, changed, run: errors.length ? null : out };
}

/* ---------------- report --write — the mechanical markdown, written into the DRAFT report ----------------
   Header lines and ONE run-history row upserted; the `## Phase N` section rebuilt in the frozen §4 order from the merged
   run file: every table the scripts compute, and the model-owned sub-sections rendered from the run-file fields the model
   filled (`judge`) — an absent field keeps an existing sub-section as written. Unknown `### Run` bullets (Run command,
   Reviewer comment) are kept. Earlier phases are never touched. */
const PHASE_ORDER = ['Run', 'Stages', 'Run plan', 'Coverage', 'Results', 'Unverified assumptions', 'Bugs', 'Heal log', 'Skips and residual failures', 'Open questions', 'Test-data readiness', 'Retained test records', 'In-doubt test records', 'Deviations'];
const table = (head, rowsOf) => ['| ' + head.join(' | ') + ' |', '|' + '---|'.repeat(head.length), ...rowsOf.map((r) => '| ' + r.map(cellOf).join(' | ') + ' |')].join('\n');
const fieldOf = (line) => { const m = String(line).match(/^-\s+\*\*([^*]+?):\*\*/); return m ? m[1].trim() : null; };

function mergeRunBullets(generated, oldLines) {
  const gen = generated.map((l) => ({ f: fieldOf(l), l }));
  const genFields = new Set(gen.map((g) => g.f));
  const extras = [];
  let prev = null;
  for (const l of oldLines) { const f = fieldOf(l); if (!f) continue; if (!genFields.has(f)) extras.push({ after: prev, l }); else prev = f; }
  const out = [];
  for (const g of gen) { out.push(g.l); for (const x of extras.filter((e) => e.after === g.f)) out.push(x.l); }
  out.splice(Math.min(1, out.length), 0, ...extras.filter((e) => e.after === null || !genFields.has(e.after)).map((x) => x.l));
  return out;
}

export function phaseSections(ctx, merged, fragments, run, oldSections = new Map()) {
  const S = new Map();
  S.set('Run', mergeRunBullets(fragments.runBullets, oldSections.get('Run') || []).join('\n'));
  S.set('Stages', fragments.stagesTable + (fragments.smokeGateLine ? '\n\n' + fragments.smokeGateLine : ''));
  const plan = planAt(run.run_plan, run.run_plan_adjustments);
  if ((plan.groups || []).length) {
    const decisions = (oldSections.get('Run plan') || []).filter((l) => /^\*\*Decisions:\*\*/.test(l));
    S.set('Run plan', table(['Group', 'Mode', 'Workers', 'TCs', 'Reason'], plan.groups.map((g) => [g.name, g.mode || (plannedWorkers(plan, g) > 1 ? 'parallel' : 'serial'), plannedWorkers(plan, g), (g.tcs || []).join(', '), g.reason || DASH])) + (decisions.length ? '\n\n' + decisions.join('\n') : ''));
  } else if (oldSections.has('Run plan')) S.set('Run plan', oldSections.get('Run plan').join('\n'));
  if (run.coverage_snapshot && run.coverage_snapshot.byStage) S.set('Coverage', coverageFragment(run.coverage_snapshot));
  else if (oldSections.has('Coverage')) S.set('Coverage', oldSections.get('Coverage').join('\n'));
  S.set('Results', fragments.resultsTable);
  const model = (name, field, render) => { if (run[field] !== undefined && run[field] !== null) S.set(name, render(run[field])); else if (oldSections.has(name)) S.set(name, oldSections.get(name).join('\n')); };
  model('Unverified assumptions', 'unverified_assumptions', (xs) => (xs.length ? table(['TC-ID', 'Ambiguity', 'Interpretation encoded', 'Evidence', 'Result'], xs.map((x) => [x.tc_id, x.wording ?? x.ambiguity, x.interpretation, x.evidence, x.result ?? ((merged.results.find((r) => r.tc_id === x.tc_id) || {}).status)])) : 'none'));
  model('Bugs', 'bugs', (xs) => (xs.length ? table(['Bug', 'TC-ID', 'Severity', 'Status'], xs.map((b) => [b.id, b.tc_id, b.severity, b.status])) : 'none'));
  model('Heal log', 'heal_log', (xs) => (xs.length ? table(['TC-ID', 'Affected test / files changed', 'Defect category', 'Previous value', 'Updated value', 'Reason the new value is correct', 'Approved-requirement reference', 'Verification performed', 'Rerun result'], xs.map((h) => HEAL_KEYS.map((k) => h[k]))) : 'First run fully green'));
  model('Skips and residual failures', 'skips', (xs) => (xs.length ? table(['TC-ID', 'Status', 'Reason'], xs.map((x) => [x.tc_id, x.status, x.reason])) : 'none'));
  const qs = run.open_questions && Array.isArray(run.open_questions.questions) ? run.open_questions.questions : null;
  if (qs) S.set('Open questions', qs.length ? table(['#', 'Source', 'Ambiguity', 'TCs', 'Decision', 'By'], qs.map((q) => [q.id ?? q['#'], q.source, q.ambiguity, Array.isArray(q.tcs) ? q.tcs.join(', ') : q.tcs, q.decision ?? q.answer, q.by])) : 'none');
  else if (oldSections.has('Open questions')) S.set('Open questions', oldSections.get('Open questions').join('\n'));
  const rd = readinessTable(run);
  if (rd.markdown !== null) S.set('Test-data readiness', rd.markdown); else if (oldSections.has('Test-data readiness')) S.set('Test-data readiness', oldSections.get('Test-data readiness').join('\n'));
  if (fragments.retainedTable) S.set('Retained test records', fragments.retainedTable.replace(/^### Retained test records\n\n/, ''));
  if (fragments.inDoubtTable) S.set('In-doubt test records', fragments.inDoubtTable.replace(/^### In-doubt test records\n\n/, ''));
  model('Deviations', 'deviations', (xs) => (xs.length ? xs.map((d) => '- ' + String(d).replace(/\r?\n/g, ' ')).join('\n') : '- none'));
  if (!S.has('Deviations')) S.set('Deviations', '- none');
  return S;
}

function splitPhase(lines) {
  const out = new Map();
  const order = [];
  let cur = null;
  for (const l of lines) {
    const h = l.match(/^###\s+(.+?)\s*$/);
    if (h) { cur = h[1]; out.set(cur, []); order.push(cur); continue; }
    if (cur) out.get(cur).push(l);
  }
  for (const [k, v] of out) { while (v.length && !v[v.length - 1].trim()) v.pop(); while (v.length && !v[0].trim()) v.shift(); out.set(k, v); }
  return { sections: out, order };
}

/** Write the phase into the draft report. → { ok, written, sections[], error } — nothing written on any error. */
export function writeReport({ ctx, merged, fragments, run, reportPath }) {
  const N = ctx.phase;
  const feature = run.feature || null;
  if (!feature) return { ok: false, error: 'the run file has no `feature`' };
  let text = isFile(reportPath) ? fs.readFileSync(reportPath, 'utf8').replace(/\r\n?/g, '\n') : null;
  if (text === null) {
    const docRel = (() => { const d = requirementIdsFromDoc(ctx).doc; return d ? posix(path.relative(ctx.resultsRoot, path.join(ctx.automationRoot, d))) : (run.source_tc_doc || DASH); })();
    text = ['# Test Run Report — ' + feature, '',
      '**User Story:** ' + ([run.user_story_id, run.user_story].filter(Boolean).join(' — ') || DASH), '**Feature:** ' + feature, '**Spec:** ' + cellOf(run.spec_level ? String(run.spec_level).replace(/\/+$/, '') : null),
      '**Source document:** ' + docRel, '**Source revision:** ' + cellOf(run.source_sha256 ? String(run.source_sha256).slice(0, 12) : null), '**Environment:** ' + cellOf(envName(run.environment)),
      '**Azure DevOps:** ' + cellOf(run.ado_mode), '**Bug report:** BUG-REPORT-' + feature + '.md', '**Earlier phases:** —', '', '## Run history', '', fragments.historyHeader, '|' + '---|'.repeat(fragments.historyHeader.split('|').length - 2), ''].join('\n');
  }
  const lines = text.split('\n');
  const phaseHeads = lines.map((l, i) => [i, l.match(/^## Phase (\d+)\b/)]).filter(([, m]) => m).map(([i, m]) => ({ i, n: Number(m[1]) }));
  if (phaseHeads.filter((h) => h.n === N).length > 1) return { ok: false, error: 'the report holds `## Phase ' + N + '` more than once — fix the draft by hand' };
  if (phaseHeads.some((h) => h.n > N)) return { ok: false, error: 'the report already holds a later phase than ' + N + ' — earlier phases are never rewritten' };
  // header lines (before the first ##): upsert the computed ones, keep every other line as written
  const firstH2 = lines.findIndex((l) => /^##\s/.test(l));
  const head = lines.slice(0, firstH2 < 0 ? lines.length : firstH2);
  const body = firstH2 < 0 ? [] : lines.slice(firstH2);
  const upserts = [...fragments.header, '**Environment:** ' + cellOf(envName(run.environment)), '**Azure DevOps:** ' + cellOf(run.ado_mode)];
  for (const u of upserts) {
    const key = (u.match(/^\*\*([^*]+?):\*\*/) || [])[1];
    const at = head.findIndex((l) => l.startsWith('**' + key + ':**'));
    if (at >= 0) head[at] = u;
    else { let last = -1; head.forEach((l, i) => { if (/^\*\*[^*]+:\*\*/.test(l)) last = i; }); head.splice(last + 1, 0, u); }
  }
  // the run history: one row per phase; a Partial column added by name when this phase needs it
  const hStart = body.findIndex((l) => /^## Run history\s*$/.test(l));
  if (hStart < 0) return { ok: false, error: 'the report has no `## Run history` section' };
  let tStart = body.findIndex((l, i) => i > hStart && /^\|/.test(l));
  if (tStart < 0) { body.splice(hStart + 1, 0, '', fragments.historyHeader, '|' + '---|'.repeat(fragments.historyHeader.split('|').length - 2)); tStart = hStart + 2; }
  let tEnd = tStart; while (tEnd + 1 < body.length && /^\|/.test(body[tEnd + 1])) tEnd++;
  const wantsPartial = /\|\s*Partial\s*\|/.test(fragments.historyHeader);
  if (wantsPartial && !/\|\s*Partial\s*\|/.test(body[tStart])) {
    const cols = body[tStart].split('|').map((c) => c.trim());
    const at = cols.indexOf('Total');
    if (at < 0) return { ok: false, error: 'the run-history header has no Total column' };
    for (let i = tStart; i <= tEnd; i++) { const cells = body[i].split('|'); cells.splice(at, 0, i === tStart ? ' Partial ' : i === tStart + 1 ? '---' : ' 0 '); body[i] = cells.join('|'); }
  }
  const rowAt = body.findIndex((l, i) => i > tStart + 1 && i <= tEnd && new RegExp('^\\|\\s*' + N + '\\s*\\|').test(l));
  if (rowAt >= 0) body[rowAt] = fragments.historyRow; else { body.splice(tEnd + 1, 0, fragments.historyRow); }
  // the phase section
  const start = body.findIndex((l) => new RegExp('^## Phase ' + N + '\\b').test(l));
  let end = start < 0 ? -1 : body.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (start >= 0 && end < 0) end = body.length;
  const old = start >= 0 ? splitPhase(body.slice(start + 1, end)) : { sections: new Map(), order: [] };
  const S = phaseSections(ctx, merged, fragments, run, old.sections);
  const names = [...PHASE_ORDER.filter((n) => S.has(n)), ...old.order.filter((n) => !PHASE_ORDER.includes(n))];
  const section = [fragments.phaseHeading, ''];
  for (const n of names) section.push('### ' + n, ...(S.has(n) ? [S.get(n)] : old.sections.get(n)), '');
  if (start >= 0) body.splice(start, end - start, ...section);
  else { while (body.length && !body[body.length - 1].trim()) body.pop(); body.push('', ...section); }
  const out = [...head, ...body].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
  if (SECRET_RE.test(out.split('\n').filter((l) => !/^\*\*Source/.test(l)).join('\n'))) return { ok: false, error: 'the generated report holds a credential-shaped value — nothing written (check the run file\'s free-text fields)' };
  writeBytesAtomic(reportPath, Buffer.from(out, 'utf8'));
  return { ok: true, written: reportPath, sections: names };
}

/* ---------------- finalize — ONE report-finalization command: drafts → freeze → review → gate → publish ----------------
   Call 1 (no --review): draft-init when the drafts are absent → merge --write → judge --write (--judgements) → the freshness
   check written to the draft run file → pre-gate acceptance → report --write → the draft page → check.mjs checkpoint B
   (snapshot = the freeze, mechanical, runtime) → AWAITING_REVIEW (exit 4) with the empty review template.
   Call 2 (--review semantic-B.json): the FROZEN drafts only — nothing regenerated; a change since the freeze → BLOCKED →
   record the validated batch → gate B → only on PASS `publish` (the exact frozen artifacts, the gate's snapshot) → final
   acceptance. A lock (artifacts/checks/finalize-phase-N.lock, owner-judged, never broken while its owner lives) keeps two
   finalizers of one phase apart from the first write to the publication. */
/** `**Latest phase:**` and the recomputed `**Bugs:**` line of a bug file (counted from its entries' Status bullets). */
export function refreshBugHeader(text, phase) {
  const t = String(text).replace(/\r\n?/g, '\n');
  const statuses = [...t.matchAll(/^###\s+BUG-\d+[\s\S]*?(?=^###\s+BUG-|^##\s|(?![\s\S]))/gm)].map((m) => ((m[0].match(/^-\s+\*\*Status:\*\*\s*(.+)$/m) || [])[1] || '').trim());
  const open = statuses.filter((s) => /^open\b/i.test(s)).length;
  const resolved = statuses.filter((s) => /^resolved\b/i.test(s)).length;
  const notChecked = statuses.filter((s) => /^not-checked-this-run\b/i.test(s)).length;
  const line = '**Bugs:** ' + open + ' open · ' + resolved + ' resolved · ' + notChecked + ' not checked this run of ' + statuses.length;
  let out = /^\*\*Bugs:\*\*.*$/m.test(t) ? t.replace(/^\*\*Bugs:\*\*.*$/m, line) : t;
  out = /^\*\*Latest phase:\*\*.*$/m.test(out) ? out.replace(/^\*\*Latest phase:\*\*.*$/m, '**Latest phase:** ' + phase) : out;
  return out;
}

const FINALIZE_EXIT = { PUBLISHED: 0, PASS: 0, FAIL: 1, BLOCKED: 2, REFUSED: 2, FAILED: 2, NOT_RUN: 3, AWAITING_REVIEW: 4 };
const pidAlive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };
export function acquireFinalizeLock(resultsRoot, phase) {
  const dir = path.join(resultsRoot, 'artifacts', 'checks', 'finalize-phase-' + phase + '.lock');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }));
      return { ok: true, release: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* the next finalize judges it */ } } };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return { ok: false, reason: 'the finalize lock could not be created: ' + (e && e.message) };
      const { data: owner } = readJson(path.join(dir, 'owner.json'));
      let age = 0; try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch { /* vanished */ }
      const sameHost = !owner || !owner.host || owner.host === os.hostname();
      if (owner && sameHost && pidAlive(owner.pid)) return { ok: false, reason: 'another finalize of phase ' + phase + ' is running (pid ' + owner.pid + ', since ' + owner.at + ') — wait for it; this lock is never broken while its owner lives' };
      if (owner && !sameHost) return { ok: false, reason: 'the finalize lock of phase ' + phase + ' is held from another host (' + owner.host + ') — it cannot be judged here' };
      if (!owner && age < 30000) return { ok: false, reason: 'the finalize lock of phase ' + phase + ' is being created by another process — try again' };
      try { fs.renameSync(dir, dir + '.stale-' + process.pid + '-' + Date.now()); } catch { return { ok: false, reason: 'a stale finalize lock (owner ' + (owner ? owner.pid : 'unknown') + ' gone) could not be cleared' }; }
    }
  }
  return { ok: false, reason: 'the finalize lock could not be taken' };
}

export async function finalize(o) {
  const head = { tool: 'run-data', schema: SCHEMA, subcommand: 'finalize' };
  const steps = [];
  const stop = (outcome, step, reason, extra = {}) => ({ ...head, outcome, step, reason, steps, ...extra, exit: FINALIZE_EXIT[outcome] ?? 2 });
  const rr = o.resultsRoot ? path.resolve(o.resultsRoot) : null;
  const N = Number(o.phase);
  if (!rr || !(N > 0)) return stop('BLOCKED', 'inputs', '--results-root and --phase are required');
  if (!(o.files || []).length) return stop('BLOCKED', 'inputs', '--files (the final in-scope files) is required — Checkpoint B reviews the final code');
  const lock = acquireFinalizeLock(rr, N);
  if (!lock.ok) return stop('BLOCKED', 'lock', lock.reason);
  try {
    let check;
    try { check = await import(pathToFileURL(path.join(here, 'check.mjs')).href); } catch (e) { return stop('BLOCKED', 'inputs', 'check.mjs could not be loaded: ' + e.message); }
    const dd = draftDir(rr, N);
    const draftRun = path.join(dd, '.runs', 'phase-' + N + '.json');
    const statePath = path.join(rr, 'artifacts', 'checks', 'finalize-phase-' + N + '.json');
    const pub = readJson(path.join(rr, '.runs', 'phase-' + N + '.json')).data;
    let feature = o.feature || (pub && pub.feature) || null;
    const B = { root: o.root || process.cwd(), checkpoint: 'B', phase: N, resultsRoot: rr, automationRoot: o.automationRoot, files: o.files, tc: o.tc, data: o.data, req: o.req, inventory: o.inventory, requireSteps: o.requireSteps,
      lint: o.lint, tsc: o.tsc, eslint: o.eslint, drafts: dd, screenshots: o.screenshots, maxWaitMs: o.maxWaitMs, memberReviews: o.memberReviews || null, noLedger: o.noLedger };
    if (!o.review) {
      // ---- call 1: drafts, numbers, report, page, freeze ----
      if (!isFile(draftRun)) {
        if (!feature) return stop('BLOCKED', 'drafts', '--feature is required (the run file names none)');
        const d = initDrafts({ resultsRoot: rr, phase: N, feature });
        steps.push({ step: 'draft-init', ok: d.outcome === 'CREATED', copied: d.copied });
        if (d.outcome !== 'CREATED' && !isFile(draftRun)) return stop('BLOCKED', 'draft-init', d.reason || 'the drafts could not be created');
      } else steps.push({ step: 'draft-init', ok: true, reused: true });
      const m1 = runData({ _: ['merge'], 'run-file': draftRun, write: true });
      steps.push({ step: 'merge', ok: m1.outcome === 'OK', counts: m1.counts || null });
      if (m1.outcome !== 'OK') return stop('BLOCKED', 'merge', m1.reason || 'merge failed');
      if (o.judgements) {
        const jg = runData({ _: ['judge'], 'run-file': draftRun, judgements: o.judgements, write: true });
        steps.push({ step: 'judge', ok: jg.outcome === 'OK', changed: jg.changed || null });
        if (jg.outcome !== 'OK') return stop('BLOCKED', 'judge', 'the judgements were rejected as a whole — nothing written', { errors: (jg.errors || []).slice(0, 20) });
      }
      feature = feature || (readJson(draftRun).data || {}).feature;
      // ONE automation root for the freshness check and Checkpoint B: the explicit one, else the run file's own
      const autoRoot = locate({ runFile: draftRun }).automationRoot;
      if (!B.automationRoot) B.automationRoot = posix(path.relative(path.resolve(B.root), autoRoot)) || '.';
      const fr = await check.freshnessCheck({ root: path.resolve(B.root), automationRoot: B.automationRoot, files: o.files.map((f) => posix(path.relative(path.resolve(B.root), path.resolve(B.root, f)))), resultsRoot: rr, runFile: draftRun, memberReviews: o.memberReviews || null });
      steps.push({ step: 'freshness', ok: fr.ok && !(fr.stale || []).length, stale: fr.ok ? fr.stale.length : null });
      if (!fr.ok) return stop('BLOCKED', 'freshness', fr.reason);
      if (fr.stale.length) return stop('BLOCKED', 'freshness', fr.stale.length + ' reported result(s) ran on older code — re-run them before finalizing', { stale: fr.stale.slice(0, 20).map((s) => s.tc) });
      if (fr.needsReview.length) return stop('AWAITING_REVIEW', 'member-review', 'fresh_by_member_only TCs need a semantic review before the freeze — call again with --member-reviews <json> {"TC-…": "file:line — why the changed member is unreachable from it"} (else re-run them)', { memberOnly: fr.needsReview });
      const ac = runData({ _: ['acceptance'], 'run-file': draftRun, write: true });
      steps.push({ step: 'acceptance (pre-gate)', ok: !!ac.acceptance, verdict: ac.acceptance ? ac.acceptance.verdict : null });
      const draftReport = path.join(dd, 'TEST-RUN-REPORT-' + feature + '.md');
      const rp = runData({ _: ['report'], 'run-file': draftRun, write: true, report: draftReport });
      steps.push({ step: 'report', ok: rp.outcome === 'OK', sections: rp.written ? rp.written.sections.length : null });
      if (rp.outcome !== 'OK') return stop('BLOCKED', 'report', rp.reason || 'the report could not be written');
      const draftBugs = path.join(dd, 'BUG-REPORT-' + feature + '.md');
      const runNow = readJson(draftRun).data || {};
      if (!isFile(draftBugs)) {
        if ((runNow.bugs || []).length) return stop('BLOCKED', 'bugs', (runNow.bugs || []).length + ' bug(s) in the run file but no draft bug file — write the `### BUG-n` entries (their narratives are yours) into ' + posix(path.relative(rr, draftBugs)) + ', then finalize again');
        // no bug yet: the file still exists with `## Bugs` / `none` (run-report.md §5) — deterministic, so written here
        writeBytesAtomic(draftBugs, Buffer.from(['# Bug Report — ' + feature, '', '**User Story:** ' + ([runNow.user_story_id, runNow.user_story].filter(Boolean).join(' — ') || DASH), '**Feature:** ' + feature,
          '**Latest phase:** ' + N, '**Bugs:** 0 open · 0 resolved · 0 not checked this run of 0', '**Run report:** TEST-RUN-REPORT-' + feature + '.md', '', '## Bugs', '', 'none', ''].join('\n'), 'utf8'));
      } else {
        const bt = fs.readFileSync(draftBugs, 'utf8');
        const missing = (runNow.bugs || []).filter((b) => !new RegExp('^###\\s+' + b.id + '\\b', 'm').test(bt)).map((b) => b.id);
        if (missing.length) return stop('BLOCKED', 'bugs', 'the draft bug file has no entry for ' + missing.join(', ') + ' — write them (narratives are yours), then finalize again');
        // the two header lines that are arithmetic (§5): the latest phase and the recomputed `**Bugs:**` counts — nothing else
        const next = refreshBugHeader(bt, N);
        if (next !== bt) writeBytesAtomic(draftBugs, Buffer.from(next, 'utf8'));
      }
      // the renderer's gate checks the drafts whatever the report choice; the draft page is written only for `report: html`
      const reportFormat = deliveryOf(runNow).report;
      const pg = render({ reportPath: draftReport, bugsPath: draftBugs, runsDir: path.join(dd, '.runs'), base: rr, root: rr });
      steps.push({ step: reportFormat === 'html' ? 'draft page' : 'renderer gate (markdown only)', ok: !!(pg.html && pg.payload.gate === 'PASS'), gate: pg.payload ? pg.payload.gate : null });
      if (!pg.html || pg.payload.gate !== 'PASS') return stop('BLOCKED', 'draft page', 'the renderer gate on the drafts is ' + (pg.payload ? pg.payload.gate + ' (' + (pg.payload.gateReason || '') + ')' : 'unknown'), { mismatches: ((pg.payload && pg.payload.mismatches) || []).slice(0, 10) });
      if (reportFormat === 'html') writeBytesAtomic(path.join(dd, 'TEST-RUN-REPORT-' + feature + '.html'), Buffer.from(pg.html, 'utf8'));
      else fs.rmSync(path.join(dd, 'TEST-RUN-REPORT-' + feature + '.html'), { force: true }); // a page from an earlier finalize of this phase is not frozen
      const cb = await check.checkpointRun(B);
      steps.push(...(cb.steps || []).map((s) => ({ ...s, step: 'B ' + s.step })));
      if (cb.outcome === 'AWAITING_REVIEW' && cb.snapshotId) fs.writeFileSync(statePath, JSON.stringify({ phase: N, feature, snapshotId: cb.snapshotId, frozenAt: new Date().toISOString() }, null, 2) + '\n');
      return stop(cb.outcome, 'checkpoint B: ' + cb.step, cb.reason, { snapshotId: cb.snapshotId || null, template: cb.template || null, needed: cb.needed || undefined, coordination: cb.coordination || undefined, failing: cb.failing || cb.first || undefined, memberOnly: cb.memberOnly || undefined });
    }
    // ---- call 2: the frozen drafts — review → gate → publish ----
    const { data: state } = readJson(statePath);
    if (!state || !state.snapshotId) return stop('BLOCKED', 'state', 'no frozen drafts for phase ' + N + ' — run finalize without --review first');
    feature = feature || state.feature;
    if (!B.automationRoot && isFile(draftRun)) B.automationRoot = posix(path.relative(path.resolve(B.root), locate({ runFile: draftRun }).automationRoot)) || '.';
    const cb = await check.checkpointRun({ ...B, review: o.review, readOnly: true });
    steps.push(...(cb.steps || []).map((s) => ({ ...s, step: 'B ' + s.step })));
    if (cb.snapshotId && cb.snapshotId !== state.snapshotId) return stop('BLOCKED', 'freeze', 'the drafts or the scope changed after the freeze (snapshot ' + state.snapshotId + ' → ' + cb.snapshotId + ') — nothing published; run finalize without --review to re-freeze', { snapshotId: cb.snapshotId });
    if (cb.outcome !== 'PASS') return stop(cb.outcome, 'checkpoint B: ' + cb.step, cb.reason, { snapshotId: cb.snapshotId || null, open: cb.open || undefined, errors: cb.errors || undefined });
    const p = publishPhase({ resultsRoot: rr, phase: N, feature, expectSnapshotId: state.snapshotId });
    steps.push({ step: 'publish', ok: p.outcome === 'PUBLISHED', outcome: p.outcome });
    if (p.outcome !== 'PUBLISHED') return stop(p.outcome === 'NOT_RUN' ? 'NOT_RUN' : 'BLOCKED', 'publish', p.reason);
    const fin = runData({ _: ['acceptance'], 'run-file': path.join(rr, '.runs', 'phase-' + N + '.json') });
    steps.push({ step: 'acceptance (final)', ok: !!fin.acceptance, verdict: fin.acceptance ? fin.acceptance.verdict : null });
    try { fs.rmSync(statePath, { force: true }); } catch { /* informational */ }
    return stop('PUBLISHED', 'publish', p.reason, { page: p.page, ...(p.reportFormat ? { reportFormat: p.reportFormat } : {}), ...(p.stalePage ? { stalePage: p.stalePage } : {}), acceptance: fin.acceptance ? { verdict: fin.acceptance.verdict, reasons: fin.acceptance.reasons } : null, gate: cb.record || null });
  } finally { lock.release(); }
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'run-data', schema: SCHEMA,
  usage: [
    'node run-data.mjs merge|report|readiness|handoff|verify|acceptance --run-file <.runs/phase-N.json | artifacts/drafts/phase-N/.runs/phase-N.json> [--results-root <dir>] [--automation-root <dir>] [--write] [--snapshot <id>] [--learning <file>] [--report <md>] [--published] [--pretty] [--strict]',
    'node run-data.mjs draft-init --results-root <dir> --phase <N> [--feature <f>] [--force] [--pretty]',
    'node run-data.mjs publish --results-root <dir> --phase <N> [--feature <f>] [--force] [--pretty] [--strict]',
    'node run-data.mjs judge --run-file <draft run file> --judgements <json> [--write] [--pretty]',
    'node run-data.mjs report --run-file <draft run file> --write [--report <draft TEST-RUN-REPORT md>] [--pretty]',
    'node run-data.mjs finalize --results-root <dir> --phase <N> [--feature <f>] --root <project> --files <a,b|@list> [--automation-root <dir>] [--tc <md>] [--data <md>] [--req <files>] [--inventory <md>] [--require-steps] [--lint] [--screenshots <dir>] [--max-wait <ms>] [--judgements <json>] [--member-reviews <json>] [--review <semantic-B.json>] [--pretty]',
  ],
  notes: [
    'judge records the model\'s judgements (classification, root_cause, severity, assumption, isolation causes / resolutions, event classifications, heal_log, deviations, skips, unverified_assumptions, bugs) in a DRAFT run file — validated as a whole; any invalid, unknown, duplicate or contradictory entry rejects the set and nothing is written. Arrays replace the run file\'s arrays.',
    'report --write writes the mechanical markdown into the DRAFT report: header lines, the run-history row and the `## Phase N` section in the frozen order (computed tables + the model sub-sections rendered from the run file); earlier phases untouched.',
    'finalize = drafts → freeze → review → gate → publish in ONE command, called twice: without --review it drafts, merges, judges, checks freshness, writes the report and the draft page and freezes them in Checkpoint B, then stops AWAITING_REVIEW (exit 4) with an empty review template; with --review (a batch naming the frozen snapshot) it uses the frozen drafts only, records, gates and publishes on PASS. Exit (always): PUBLISHED 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3 · AWAITING_REVIEW 4. A per-phase lock keeps two finalizers apart.',
    'merge writes only the mechanical blocks (merged, results, stages, totals, variant_totals, parallel_checks, rate_limit, watchdog_events, timeouts.events, concurrency, smoke_gate) and keeps every model-owned field.',
    'verify --snapshot appends one protocol record per runtime check (executor S, unit phase); a check already recorded for that snapshot is not written twice.',
    'acceptance is pre-gate (conditional on Checkpoint B PASS) until .runs/phase-N.checkpoint-B.json exists, final afterwards.',
    'publish refuses unless the Checkpoint B gate record says PASS and every draft matches its frozen sha256; it rolls back on any later mismatch.',
    'delivery (3.1): the run file\'s `delivery { report: html|md, screenshots: all|failed|none, source }` (absent → html + all). `report: md` → finalize and publish still run the renderer\'s gate on the markdown but write no page; `screenshots` decides which attempts owe an image in verify 16b / 18 (`failed`: failing attempts only; `none`: none — API / DB records are always owed).',
  ],
};
const STRICT = {
  merge: { OK: 0, BLOCKED: 2 }, report: { OK: 0, BLOCKED: 2 }, readiness: { OK: 0, BLOCKED: 2 }, handoff: { OK: 0, BLOCKED: 2 }, judge: { OK: 0, REJECTED: 1, BLOCKED: 2 },
  verify: { PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3 }, acceptance: { ACCEPTED: 0, 'NOT ACCEPTED': 1, BLOCKED: 2 },
  'draft-init': { CREATED: 0, REFUSED: 1 }, publish: { PUBLISHED: 0, REFUSED: 1, FAILED: 2, NOT_RUN: 3 },
};

export function runData(args) {
  const sub = args._[0];
  const head = { tool: 'run-data', schema: SCHEMA, subcommand: sub || null };
  if (!sub || !STRICT[sub]) return { ...head, outcome: 'BLOCKED', reason: 'subcommand must be one of ' + Object.keys(STRICT).join(' | ') };
  if (sub === 'draft-init' || sub === 'publish') {
    if (typeof args['results-root'] !== 'string' || !(Number(args.phase) > 0)) return { ...head, outcome: sub === 'publish' ? 'NOT_RUN' : 'REFUSED', reason: '--results-root and --phase are required' };
    const rr = path.resolve(args['results-root']);
    let feature = typeof args.feature === 'string' ? args.feature : null;
    if (!feature) { const { data } = readJson(path.join(rr, '.runs', 'phase-' + Number(args.phase) + '.json')); feature = data && data.feature ? data.feature : null; }
    if (sub === 'draft-init') { if (!feature) return { ...head, outcome: 'REFUSED', reason: '--feature is required (the run file names none)' }; return { ...head, ...initDrafts({ resultsRoot: rr, phase: Number(args.phase), feature, force: !!args.force }) }; }
    return { ...head, ...publishPhase({ resultsRoot: rr, phase: Number(args.phase), feature, force: !!args.force }) };
  }
  const loc = locate({ runFile: typeof args['run-file'] === 'string' ? args['run-file'] : null, resultsRoot: typeof args['results-root'] === 'string' ? args['results-root'] : null, automationRoot: typeof args['automation-root'] === 'string' ? args['automation-root'] : null });
  if (!loc.run) return { ...head, outcome: sub === 'verify' ? 'NOT_RUN' : 'BLOCKED', reason: loc.errors[0], errors: loc.errors };
  const ctx = { ...loc, summaries: loadSummaries(loc.resultsRoot) };
  ctx.cmds = phaseCommands(ctx);
  ctx.execs = buildExecutions(ctx);
  const m = mergePhase(ctx);
  const mergedRun = applyMerge(loc.run, m, { automationRoot: loc.automationRoot });
  const mctx = { ...ctx, run: mergedRun };
  const gates = gateRecords(loc.resultsRoot, loc.phase);
  const where = { runFile: posix(path.relative(process.cwd(), loc.runFile)), resultsRoot: posix(path.relative(process.cwd(), loc.resultsRoot)) || '.', automationRoot: posix(path.relative(process.cwd(), loc.automationRoot)) || '.', phase: loc.phase, draft: loc.isDraft, summaries: ctx.summaries.length, commands: ctx.cmds.length, executions: ctx.execs.length };
  if (sub === 'merge') {
    const out = { ...head, outcome: 'OK', ...where, counts: m.totals, stages: m.stages, variant_totals: m.variant_totals, tcs: Object.fromEntries(m.results.map((r) => [r.tc_id, r.status + (r.classification && r.classification !== 'N/A' ? ' — ' + r.classification : '')])), parallel_checks: m.parallel_checks.map((p) => ({ tc: p.tc, outcome: p.outcome, cause: p.cause, resolution: p.resolution })), smoke_gate: m.smoke_gate, warnings: [...loc.errors, ...m.warnings], writes: [] };
    out.warnings.push(...canonicalRunPaths(loc.run, loc.automationRoot).notes);
    if (args.write) { writeJsonAtomic(loc.runFile, mergedRun); out.writes.push({ file: where.runFile, kind: 'run-file' }); }
    return out;
  }
  if (sub === 'judge') {
    const jf = typeof args.judgements === 'string' ? path.resolve(args.judgements) : null;
    const text = jf ? read(jf) : null;
    if (text === null) return { ...head, outcome: 'BLOCKED', reason: '--judgements must name the judgements JSON' + (jf ? ' (' + posix(jf) + ' not found)' : ''), ...where };
    let j;
    try { j = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (e) { return { ...head, outcome: 'REJECTED', reason: 'the judgements file is not valid JSON: ' + e.message, errors: [e.message], ...where }; }
    const r = applyJudgements(loc.run, j);
    const out = { ...head, outcome: r.errors.length ? 'REJECTED' : 'OK', ...where, changed: r.changed, errors: r.errors.slice(0, 40), moreErrors: Math.max(0, r.errors.length - 40), writes: [] };
    if (!r.errors.length && args.write) {
      if (!loc.isDraft) return { ...out, outcome: 'BLOCKED', reason: 'judge writes only a DRAFT run file (artifacts/drafts/phase-N/.runs/phase-N.json) — published run files are immutable' };
      writeJsonAtomic(loc.runFile, r.run); out.writes.push({ file: where.runFile, kind: 'run-file', fields: 'judgements' });
    }
    return out;
  }
  if (sub === 'report') {
    let historyHasPartial = null;
    if (typeof args.report === 'string') { const t = read(path.resolve(args.report)); if (t !== null) historyHasPartial = /^\|\s*Phase\s*\|.*\|\s*Partial\s*\|/mi.test(t); }
    // always the current acceptance — pre-gate while the drafts are written, final once gate record B exists
    const acceptance = computeAcceptance(mctx, m, gates);
    const fragments = reportFragments(mctx, m, { acceptance, gates, historyHasPartial });
    if (!args.write) return { ...head, outcome: 'OK', ...where, fragments, acceptance, warnings: m.warnings };
    // --write: the draft report, written by the script (no pasted fragments, no hand-built tables)
    if (!loc.isDraft) return { ...head, outcome: 'BLOCKED', reason: 'report --write writes only the DRAFT report of a draft run file — the published report changes only through publish', ...where };
    const feature = mergedRun.feature;
    const reportPath = typeof args.report === 'string' ? path.resolve(args.report) : path.join(path.dirname(path.dirname(loc.runFile)), 'TEST-RUN-REPORT-' + feature + '.md');
    let frags = fragments;
    if (typeof args.report !== 'string' && isFile(reportPath)) frags = reportFragments(mctx, m, { acceptance, gates, historyHasPartial: /^\|\s*Phase\s*\|.*\|\s*Partial\s*\|/mi.test(read(reportPath) || '') });
    const w = writeReport({ ctx: mctx, merged: m, fragments: frags, run: mergedRun, reportPath });
    return { ...head, outcome: w.ok ? 'OK' : 'BLOCKED', ...where, reason: w.ok ? null : w.error, written: w.ok ? { file: posix(path.relative(process.cwd(), w.written)), sections: w.sections } : null,
      phaseOutcome: frags.outcome, counts: frags.counts, acceptance: { verdict: acceptance.verdict, mode: acceptance.mode, reasons: acceptance.reasons }, warnings: m.warnings };
  }
  if (sub === 'readiness') { const r = readinessTable(mergedRun); return { ...head, outcome: r.markdown === null ? 'BLOCKED' : 'OK', reason: r.reason || null, ...where, markdown: r.markdown, rows: r.rows ?? 0 }; }
  if (sub === 'handoff') return { ...head, outcome: 'OK', ...where, handoff: handoff(mctx, m, gates) };
  if (sub === 'verify') {
    const v = verifyRuntime(mctx, m, { learning: typeof args.learning === 'string' ? args.learning : null, published: !!args.published });
    const out = { ...head, outcome: v.gate, ...where, checks: v.checks, freshness: v.freshness, writes: [] };
    if (typeof args.snapshot === 'string') { const r = recordChecks(loc.resultsRoot, args.snapshot, v.checks); out.recorded = { file: posix(path.relative(process.cwd(), r.file)), written: r.written, alreadyRecorded: r.skipped }; }
    return out;
  }
  // acceptance
  const a = computeAcceptance(mctx, m, gates);
  const out = { ...head, outcome: a.verdict, ...where, acceptance: a, writes: [] };
  if (args.write) { writeJsonAtomic(loc.runFile, { ...loc.run, acceptance: a }); out.writes.push({ file: where.runFile, kind: 'run-file', field: 'acceptance' }); }
  return out;
}

const listArg = (v) => {
  if (typeof v !== 'string' || !v) return [];
  if (v.startsWith('@')) return (read(path.resolve(v.slice(1))) || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  return v.split(',').map((s) => s.trim()).filter(Boolean);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  if (args._[0] === 'finalize') {
    let memberReviews = null;
    if (typeof args['member-reviews'] === 'string') {
      const t = read(path.resolve(args['member-reviews'])) || '';
      try { memberReviews = JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t); } catch (e) { print({ tool: 'run-data', schema: SCHEMA, subcommand: 'finalize', outcome: 'BLOCKED', step: 'inputs', reason: '--member-reviews is not readable JSON: ' + e.message }, args); return 2; }
    }
    const s = (k) => (typeof args[k] === 'string' ? args[k] : null);
    const r = await finalize({ resultsRoot: s('results-root'), phase: Number(args.phase), feature: s('feature'), root: s('root') || process.cwd(), automationRoot: s('automation-root'), files: listArg(args.files),
      tc: s('tc'), data: s('data'), req: listArg(args.req), inventory: s('inventory'), requireSteps: !!args['require-steps'], lint: !!args.lint, tsc: s('tsc'), eslint: s('eslint'), screenshots: s('screenshots'),
      maxWaitMs: Number(args['max-wait']) || null, judgements: s('judgements'), memberReviews, review: s('review'), noLedger: !!args['no-ledger'] });
    print(r, args);
    return r.exit;
  }
  const payload = runData(args);
  print(payload, args);
  const map = STRICT[payload.subcommand] || {};
  return args.strict ? (map[payload.outcome] ?? 2) : 0;
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  main().then((code) => process.exit(code), (e) => {
    // a crash names its subcommand, phase and run file — never a bare "internal error"
    const args = parseArgs(process.argv.slice(2));
    const where = [args._[0] || '(no subcommand)', args.phase ? 'phase ' + args.phase : null, typeof args['run-file'] === 'string' ? args['run-file'] : null].filter(Boolean).join(' · ');
    const at = String((e && e.stack) || '').split('\n').find((l) => /run-data\.mjs:\d+/.test(l)) || '';
    print({ tool: 'run-data', schema: SCHEMA, subcommand: args._[0] || null, outcome: 'BLOCKED', reason: 'internal error in ' + where + ': ' + (e && e.message) + (at ? ' (' + at.trim().replace(/^at\s+/, '') + ')' : '') }, args);
    process.exit(args.strict || args._[0] === 'finalize' ? 2 : 0);
  });
}
void here;
