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
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, posix, read, isFile, isDir } from './scan-lib.mjs';
import { render, pageState } from './render-run-report.mjs';

export const SCHEMA = 'skill5-run-data/1';
export const RUN_SCHEMA = 'skill6-run/1';
export const GATE_SCHEMA = 'skill5-gate/1';
const STAGE_ORDER = ['smoke', 'positive', 'negative'];
const STAGE_TITLE = { smoke: 'Smoke', positive: 'Positive', negative: 'Negative' };
const DASH = '—';
// a credential written with its value — the renderer's rule plus the words run-stage.mjs withholds; never printed back
const SECRET_RE = /\b(password|passcode|passwd|pwd|secret|token|pat|api[-_ ]?key|authorization)\b\s*(?:[:=]|is)\s*["'`]?[^\s"'`]{3,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i;
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;
// classification values this script writes itself — recomputed on every merge; anything else is the model's and kept
const MECHANICAL_CLASS = /^(?:incomplete|interrupted|not started):|^rate_limited$|^human step:/i;
// NOT_RUN / INCOMPLETE reasons that make a run NOT ACCEPTED (Revision 3.1 §3.8)
const CAPACITY_REASON = /^(?:not started:\s*(?:admission timeout|host pressure|deferred until|environment lease|no safe coordination)|interrupted:\s*wait budget exhausted)/i;

const here = path.dirname(fileURLToPath(import.meta.url));
const uniq = (xs) => [...new Set(xs)];
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const ms = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };
const readdirSafe = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const shaBytes = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const shaFile = (p) => shaBytes(fs.readFileSync(p));
const shaTextLf = (p) => shaBytes(Buffer.from(fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n'), 'utf8'));
const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
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
  let ar = automationRoot ? path.resolve(automationRoot) : null;
  const rel = posix(String(run.results_root || '')).replace(/^\.\/+/, '').replace(/\/+$/, '');
  if (!ar && rel && posix(rr).toLowerCase().endsWith('/' + rel.toLowerCase())) ar = rr.slice(0, rr.length - rel.length - 1);
  if (!ar) { const p = posix(rr); const i = p.toLowerCase().lastIndexOf('/reports/'); ar = i > 0 ? rr.slice(0, i) : path.resolve(rr, '..', '..'); }
  const rrRel = posix(path.relative(ar, rr));
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
    if (r.event === 'test-start') { const s = { worker: r.worker, tc, tcs: tc.split(',').map((x) => x.trim()).filter(Boolean), start: at, end: null, status: null, events: [] }; open.set(r.worker, s); spans.push(s); continue; }
    const s = open.get(r.worker);
    if (!s) continue;
    if (r.event === 'test-end') { s.end = at; s.status = r.status || null; open.delete(r.worker); continue; }
    s.events.push({ ...r, _at: at });
  }
  return { spans, teardowns, consoleReports, evidence };
}
const normPath = (p, automationRoot) => {
  if (!p) return null;
  const s = String(p);
  return isAbs(s) ? posix(path.relative(automationRoot, s)) : posix(s).replace(/^\.\/+/, '');
};

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
    c.rows = [];
    if (c.freshness === 'FAIL') continue;
    if (c.source === 'json' && c.stageJson && isFile(c.stageJson)) { const { data } = readJson(c.stageJson); if (data) c.rows = collectRows(data); }
    else if (c.source === 'incremental+watchdog' && c.watchdogFile && isFile(c.watchdogFile)) {
      const { data } = readJson(c.watchdogFile);
      for (const x of (data && data.completed) || []) c.rows.push({ title: x.title || x.tc, file: null, suite: '', project: x.project || null, repeat: 0, status: x.status, tags: [], annotations: [], duration_ms: x.duration_ms || 0, tcs: [x.tc], expectedFailure: false, unverifiedAssumption: false, error: null });
    }
    c.hb = c.progressFile && isFile(c.progressFile) ? heartbeatSpans(c.progressFile) : { spans: [], teardowns: 0, consoleReports: 0, evidence: 0 };
  }
  return cmds;
}

export function buildExecutions(ctx) {
  const { run, automationRoot, phase } = ctx;
  const shotsRoot = posix(String(run.screenshots_root || '')).replace(/\/+$/, '');
  const required = (run.run_plan && run.run_plan.required_variants) || {};
  const counter = new Map(); // (tc|actual slug) → executions so far (the evidence helper numbers attempt-{a}.png per variant folder)
  const execs = [];
  for (const c of ctx.cmds) {
    const evUsed = new Map();
    for (const r of c.rows) {
      const project = r.project || ((run.run_plan && run.run_plan.projects) || [])[0] || 'chromium';
      const variation = variationSlug(r.title);
      const actual = project + '--' + variation + '--r' + (r.repeat || 0);
      for (const tc of r.tcs) {
        const req = required[tc] || [];
        const slug = req.includes(actual) ? actual : project + '--' + variation + '--r0';
        const status = r.status === 'XFAIL' ? 'PASS' : r.status; const reason = r.follower ? 'not started: depends on ' + r.follower + ' (failed)' : null;
        const ran = status !== 'SKIP' && status !== 'NOT_RUN';
        let evidence = null; let failure = null;
        if (ran) {
          const key = tc + '|' + actual;
          const k = (counter.get(key) || 0) + 1; counter.set(key, k);
          const used = evUsed.get(key) || 0; evUsed.set(key, used + 1);
          const marks = [];
          for (const sp of c.hb.spans) if (sp.tcs.includes(tc)) for (const e of sp.events) if (e.event === 'evidence' && e.path) { const p = normPath(e.path, automationRoot); if (p.includes('/' + tc + '/' + actual + '/')) marks.push({ at: e._at, p }); }
          marks.sort((a, b) => a.at - b.at);
          if (marks[used]) evidence = marks[used].p;
          else if (shotsRoot) { const guess = shotsRoot + '/phase-' + phase + '/' + tc + '/' + actual + '/attempt-' + k + '.png'; if (isFile(path.join(automationRoot, guess))) evidence = guess; }
          if (evidence && (status === 'FAIL' || status === 'INCOMPLETE')) { const f = evidence.replace(/\.png$/i, '-failed.png'); if (f !== evidence && isFile(path.join(automationRoot, f))) failure = f; }
        }
        const fp = c.summary.code && c.summary.code.tcs && c.summary.code.tcs[tc] ? (c.summary.code.tcs[tc].fingerprint ?? null) : null;
        execs.push({
          tc, cmd: c, row: r, slug, actual, project, status, rawStatus: r.status, reason, ran, evidence, failure,
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
  const defaultProject = ((run.run_plan && run.run_plan.projects) || [])[0] || 'chromium';
  ctx.cmds = ctx.cmds || phaseCommands(ctx);
  const execs = ctx.execs || (ctx.execs = buildExecutions(ctx));
  const prevRows = new Map((run.results || []).map((r) => [r.tc_id, r]));
  // scope: the plan, the required variants, the summaries and the existing rows — an execution of a TC outside them is a warning
  const scope = new Set([...Object.keys(required), ...(plan.groups || []).flatMap((g) => g.tcs || []), ...prevRows.keys()]);
  for (const s of ctx.summaries) if (s.stage !== 'setup') { for (const tc of s.plannedTcs || []) scope.add(tc); for (const tc of Object.keys(s.tcs || {})) scope.add(tc); }
  for (const tc of uniq(execs.map((e) => e.tc))) if (!scope.has(tc)) warnings.push({ kind: 'unplanned-tc', tc, detail: tc + ' executed but is in no plan group, required-variant list, summary or results row — ignored' });
  const reqOf = new Map();
  for (const r of ((run.coverage_snapshot && run.coverage_snapshot.requirements) || [])) for (const tc of r.assertedBy || []) if (!reqOf.has(tc)) reqOf.set(tc, r.id);
  const selections = (run.impact && Array.isArray(run.impact.selections)) ? run.impact.selections : [];
  const results = []; const mergedTcs = []; const mergedVariants = [];
  const variantTotals = { passed: 0, failed: 0, skipped: 0, not_run: 0, partial: 0, incomplete: 0 };
  for (const tc of [...scope].sort(natural)) {
    const prev = prevRows.get(tc) || {};
    const mine = execs.filter((e) => e.tc === tc).sort((a, b) => a.startedAt - b.startedAt);
    const req = required[tc] && required[tc].length ? required[tc] : [defaultProject + '--none--r0'];
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
      const attempts = ran.map((e) => ({ attempt: e.attemptNo, stage: e.stage, run: e.run, command: e.command, group: e.group, code_fingerprint: e.code_fingerprint, status: e.status, ...(e.reason ? { reason: e.reason } : {}), evidence_screenshot: e.evidence, failure_screenshot: e.failure }));
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
    const row = {
      tc_id: tc, req_id: prev.req_id ?? reqOf.get(tc) ?? null, test_name: prev.test_name ?? (mine.length ? nameOf(mine[0].row.title) : null),
      status, duration_ms: status === 'SKIP' || status === 'NOT_RUN' ? 0 : lasts.reduce((a, e) => a + (e.duration_ms || 0), 0),
      classification: keepClass ? prev.classification : (mech || 'N/A'),
      // the mechanical reason of a result without a verdict — recomputed every merge, read by acceptance whatever the classification says
      status_reason: ['INCOMPLETE', 'NOT_RUN'].includes(status) ? (mech || null) : null,
      unverified_assumption: !!(prev.unverified_assumption || mine.some((e) => e.unverifiedAssumption)), assumption: prev.assumption ?? null,
      error_message: status === 'FAIL' && rec ? rec.error : (prev.error_message ?? null), root_cause: prev.root_cause ?? null,
      run_group: g ? g.name : (prev.run_group ?? null), run_mode: g ? (g.mode || (plannedWorkers(plan, g) > 1 ? 'parallel' : 'serial')) : (prev.run_mode ?? null),
      evidence_screenshot: status === 'SKIP' || status === 'NOT_RUN' ? null : (rec ? rec.evidence : null), failure_screenshot: status === 'FAIL' && rec ? rec.failure : null,
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
export function applyMerge(run, m) {
  const out = { ...run };
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
  const runBullets = [
    '- **Outcome:** ' + outcome,
    '- **Environment:** ' + cellOf(run.environment), '- **Build:** ' + cellOf(run.build),
    '- **Headed / workers:** ' + (run.headed === false ? 'no' : 'yes') + ' / parallel ×' + (run.workers_parallel ?? (run.run_plan && run.run_plan.workers_parallel) ?? 2) + ', serial ×1',
    ...(timeoutsBullet ? ['- **Timeouts:** ' + timeoutsBullet] : []),
    '- **Started:** ' + dateTimeOf(run.started_at), '- **Duration:** ' + duration, '- **Run file:** .runs/phase-' + N + '.json',
    ...(run.progress_log ? ['- **Progress log:** ' + path.posix.relative(ctx.rrRel, posix(run.progress_log))] : []),
    ...(run.screenshots_root ? ['- **Screenshots:** ' + path.posix.relative(ctx.rrRel, posix(String(run.screenshots_root)).replace(/\/+$/, '') + '/phase-' + N) + '/'] : []),
    '- **Compliance:** ' + compliance, '- **Azure DevOps:** ' + cellOf(run.ado_mode),
    '- **Previous phase:** ' + (run.previous_phase && run.previous_phase.file ? run.previous_phase.file : 'none'),
    '- **Re-run:** ' + rr, '- **Isolation checks:** ' + iso, '- **Rate limits:** ' + rate, '- **Acceptance:** ' + accText,
  ];
  const header = [
    '**Latest phase:** ' + N, '**Latest run:** ' + dateTimeOf(run.started_at), '**Status:** ' + outcome, '**Latest results:** ' + latestLine({ ...emptyCounts(), ...t }),
    '**Compliance:** ' + compliance, '**Run file:** .runs/phase-' + N + '.json',
    ...(run.screenshots_root ? ['**Screenshots:** ' + path.posix.relative(ctx.rrRel, posix(String(run.screenshots_root)).replace(/\/+$/, '') + '/phase-' + N) + '/'] : []),
    ...(run.progress_log ? ['**Progress log:** ' + path.posix.relative(ctx.rrRel, posix(run.progress_log))] : []),
  ];
  const bugs = (run.bugs || []).map((b) => b.id).filter(Boolean);
  const historyHeader = '| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run' + (withPartial ? ' | Partial' : '') + ' | Total | Duration | Bugs |';
  const historyRow = '| ' + [N, dateOf(run.started_at), outcome, t.passed, t.failed, t.incomplete, t.skipped, t.not_run, ...(withPartial ? [t.partial || 0] : []), t.total, hhmmss(durMs), bugs.length ? bugs.join(', ') : DASH].join(' | ') + ' |';
  return {
    outcome, counts: { ...emptyCounts(), ...t }, phaseHeading: '## Phase ' + N + ' — ' + dateOf(run.started_at), header, historyHeader, historyRow,
    runBullets, stagesTable: stagesLines.join('\n'), smokeGateLine: smokeLine, resultsTable: resultLines.join('\n'),
  };
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
export function verifyRuntime(ctx, merged, { learning = null, published = false } = {}) {
  const run = ctx.run; const N = ctx.phase; const ar = ctx.automationRoot; const rr = ctx.resultsRoot;
  const checks = {};
  const cmds = ctx.cmds || phaseCommands(ctx);
  const spans = cmds.flatMap((c) => c.hb.spans.map((s) => ({ ...s, cmd: c })));
  const anyTeardown = cmds.some((c) => c.hb.teardowns > 0); const anyConsole = cmds.some((c) => c.hb.consoleReports > 0);
  const label = (s) => s.tc + ' (' + stageText(s.cmd) + ', ' + s.cmd.group + ' attempt ' + s.cmd.attempt + ', worker ' + s.worker + ')';

  // 16b — each PASS test's evidence before its teardown, from this phase's heartbeats
  {
    const passed = spans.filter((s) => s.status === 'passed');
    const bad = [];
    for (const s of passed) {
      const td = s.events.find((e) => e.event === 'teardown');
      const ev = s.events.find((e) => e.event === 'evidence');
      if (!ev) bad.push(label(s) + ': no evidence record');
      else if (!td) { if (anyTeardown) bad.push(label(s) + ': no teardown record'); }
      else if (ev._at >= td._at) bad.push(label(s) + ': evidence at ' + new Date(ev._at).toISOString() + ' is not before teardown at ' + new Date(td._at).toISOString());
    }
    if (!passed.length) checks['16b'] = res('PASS', 'no passing test in this phase — nothing to order');
    else if (bad.length) checks['16b'] = res('FAIL', bad.length + ' of ' + passed.length + ' passing tests', bad);
    else if (!anyTeardown) checks['16b'] = res('unresolved', 'no `teardown` heartbeat in this phase — the guards are older than the templates; prove the order by reading the specs or update helpers/console-guard.ts');
    else checks['16b'] = res('PASS', passed.length + ' passing tests: evidence recorded before teardown');
  }
  // 18 — the artifacts were produced
  {
    const bad = [];
    let images = 0;
    for (const r of merged.results) for (const v of r.variants || []) for (const a of v.attempts || []) {
      if (['PASS', 'FAIL', 'PARTIAL'].includes(a.status)) { images++; if (!a.evidence_screenshot || !isFile(path.join(ar, a.evidence_screenshot))) bad.push(r.tc_id + ' ' + v.variant_slug + ' attempt ' + a.attempt + ': assertion-point image missing' + (a.evidence_screenshot ? ' (' + a.evidence_screenshot + ')' : '')); }
      if (a.status === 'FAIL' && (!a.failure_screenshot || !isFile(path.join(ar, a.failure_screenshot)))) bad.push(r.tc_id + ' ' + v.variant_slug + ' attempt ' + a.attempt + ': failure image missing');
    }
    const feature = run.feature || null;
    const dir = published ? rr : path.join(rr, 'artifacts', 'drafts', 'phase-' + N);
    const docs = feature ? [['TEST-RUN-REPORT-' + feature + '.md', (t) => new RegExp('^## Phase ' + N + '\\b', 'm').test(t)], ['BUG-REPORT-' + feature + '.md', null], ['.runs/phase-' + N + '.json', null], ['TEST-RUN-REPORT-' + feature + '.html', null]] : [];
    if (!feature) bad.push('run file has no `feature` — the report files cannot be named');
    for (const [f, test] of docs) { const p = path.join(dir, f); if (!isFile(p)) bad.push((published ? '' : 'draft ') + f + ' missing'); else if (test && !test(fs.readFileSync(p, 'utf8'))) bad.push(f + ' has no `## Phase ' + N + '` section'); }
    checks['18'] = bad.length ? res('FAIL', bad.length + ' artifact(s) missing', bad) : res('PASS', images + ' attempt images on disk; ' + (published ? 'published' : 'draft') + ' report, bug file, run file and page present');
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
    const moves = (run.run_plan_adjustments || []).filter((a) => a && a.kind === 'move');
    for (const s of ctx.summaries) for (const e of s.interference || []) if (e.kind === 'failed-beside-passed-alone' && !moves.some((m) => m.tc === e.tc)) bad.push(e.tc + ': parallel interference without its run_plan_adjustments move');
    checks['25b'] = bad.length ? res('FAIL', bad.length + ' departure(s) from the plan', bad) : res('PASS', cmds.length + ' command(s) ran in their planned mode and workers' + (dispatch.length ? '; no conflicting units overlapped' : '') + '; isolation moves applied');
  }
  // 31-34 — traceability and coverage
  {
    const cov = run.coverage_snapshot || null; const reqs = cov && Array.isArray(cov.requirements) ? cov.requirements : null;
    const noReq = merged.results.filter((r) => !r.req_id || r.req_id === DASH).map((r) => r.tc_id);
    checks['31'] = !reqs ? res('unresolved', 'run file has no coverage_snapshot.requirements') : reqs.length && !noReq.length ? res('PASS', reqs.length + ' requirement id(s) in the coverage snapshot; every result carries a req_id') : res('FAIL', (reqs.length ? '' : 'no requirement in the coverage snapshot; ') + (noReq.length ? 'results without req_id: ' + noReq.join(', ') : ''), noReq);
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
    for (const r of merged.results) for (const v of r.variants || []) for (const a of v.attempts || []) for (const p of [a.evidence_screenshot, a.failure_screenshot]) if (p && shots && !posix(p).startsWith(shots + '/phase-' + N + '/')) bad.push(r.tc_id + ': ' + p + ' is outside ' + shots + '/phase-' + N + '/');
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
  // 46b — a console report for every executed test
  {
    const executed = spans.filter((s) => s.status && s.status !== 'skipped');
    const bad = executed.filter((s) => !s.events.some((e) => e.event === 'console-report')).map(label);
    if (!executed.length) checks['46b'] = res('PASS', 'no executed test in this phase');
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
export function publishPhase({ resultsRoot, phase, feature = null, force = false, root = null }) {
  const rr = path.resolve(resultsRoot); const N = Number(phase); const dir = draftDir(rr, N);
  const base = { outcome: 'REFUSED', reason: null, promoted: [], page: null, reproduced: null, writes: [] };
  const gateFile = path.join(rr, '.runs', 'phase-' + N + '.checkpoint-B.json');
  if (!isFile(gateFile)) return { ...base, outcome: 'NOT_RUN', reason: 'no Checkpoint B gate record (' + posix(path.relative(rr, gateFile)) + ')' };
  const { data: gate, error } = readJson(gateFile);
  if (!gate) return { ...base, reason: 'gate record unreadable: ' + error };
  if (gate.schema !== GATE_SCHEMA || gate.checkpoint !== 'B' || Number(gate.phase) !== N) return { ...base, reason: 'gate record is not the Checkpoint B record of phase ' + N + ' (schema ' + gate.schema + ', checkpoint ' + gate.checkpoint + ', phase ' + gate.phase + ')' };
  if (gate.verdict !== 'PASS') return { ...base, reason: 'Checkpoint B is ' + gate.verdict + ' — nothing is published' };
  if (gate.rehash && gate.rehash.matched === false) return { ...base, reason: 'Checkpoint B snapshot is void (re-hash differs) — nothing is published' };
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
  // predicted page: the drafts rendered as if they stood in the story folder
  const pre = render({ reportPath: path.join(dir, names.report), bugsPath: isFile(path.join(dir, names.bugs)) ? path.join(dir, names.bugs) : null, runsDir: path.join(dir, '.runs'), base: rr, gatePath: gateFile, root: root || rr });
  if (!pre.html || pre.payload.gate !== 'PASS') return { ...base, reason: 'the renderer gate on the drafts is ' + pre.payload.gate + ' (' + pre.payload.gateReason + ') — fix the drafts, re-run Checkpoint B', rendererGate: pre.payload.gate };
  const pageFile = path.join(rr, 'TEST-RUN-REPORT-' + feat + '.html');
  if (isFile(pageFile)) { const st = pageState(fs.readFileSync(pageFile, 'utf8')); if (st.provenance && st.handEdited && !force) return { ...base, reason: 'the published page was edited by hand after it was rendered — pass --force to replace it' }; }
  // promote byte-identical, keeping what was there for a rollback
  const backup = new Map();
  for (const f of [...promote.map((p) => p.dst), pageFile]) backup.set(f, isFile(f) ? fs.readFileSync(f) : null);
  const rollback = () => { for (const [f, buf] of backup) { try { if (buf === null) fs.rmSync(f, { force: true }); else writeBytesAtomic(f, buf); } catch { /* reported below */ } } };
  try {
    for (const p of promote) { writeBytesAtomic(p.dst, fs.readFileSync(p.src)); base.promoted.push(p.rel); base.writes.push({ file: posix(path.relative(rr, p.dst)), kind: p.kind, bytes: fs.statSync(p.dst).size }); }
    for (const p of promote) if (shaFile(p.dst) !== shaFile(p.src)) { rollback(); return { ...base, outcome: 'FAILED', reason: 'promoted ' + p.rel + ' is not byte-identical to its draft — rolled back', promoted: [] }; }
    const r = render({ reportPath: path.join(rr, names.report), gatePath: gateFile, root: root || rr });
    if (!r.html || r.payload.gate !== 'PASS') { rollback(); return { ...base, outcome: 'FAILED', reason: 'renderer gate on the promoted files is ' + r.payload.gate + ' — rolled back', promoted: [] }; }
    if (r.html !== pre.html) { rollback(); return { ...base, outcome: 'FAILED', reason: 'the page of the promoted files differs from the page of the drafts — rolled back', promoted: [] }; }
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

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'run-data', schema: SCHEMA,
  usage: [
    'node run-data.mjs merge|report|readiness|handoff|verify|acceptance --run-file <.runs/phase-N.json | artifacts/drafts/phase-N/.runs/phase-N.json> [--results-root <dir>] [--automation-root <dir>] [--write] [--snapshot <id>] [--learning <file>] [--report <md>] [--published] [--pretty] [--strict]',
    'node run-data.mjs draft-init --results-root <dir> --phase <N> [--feature <f>] [--force] [--pretty]',
    'node run-data.mjs publish --results-root <dir> --phase <N> [--feature <f>] [--force] [--pretty] [--strict]',
  ],
  notes: [
    'merge writes only the mechanical blocks (merged, results, stages, totals, variant_totals, parallel_checks, rate_limit, watchdog_events, timeouts.events, concurrency, smoke_gate) and keeps every model-owned field.',
    'verify --snapshot appends one protocol record per runtime check (executor S, unit phase); a check already recorded for that snapshot is not written twice.',
    'acceptance is pre-gate (conditional on Checkpoint B PASS) until .runs/phase-N.checkpoint-B.json exists, final afterwards.',
    'publish refuses unless the Checkpoint B gate record says PASS and every draft matches its frozen sha256; it rolls back on any later mismatch.',
  ],
};
const STRICT = {
  merge: { OK: 0, BLOCKED: 2 }, report: { OK: 0, BLOCKED: 2 }, readiness: { OK: 0, BLOCKED: 2 }, handoff: { OK: 0, BLOCKED: 2 },
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
  const mergedRun = applyMerge(loc.run, m);
  const mctx = { ...ctx, run: mergedRun };
  const gates = gateRecords(loc.resultsRoot, loc.phase);
  const where = { runFile: posix(path.relative(process.cwd(), loc.runFile)), resultsRoot: posix(path.relative(process.cwd(), loc.resultsRoot)) || '.', automationRoot: posix(path.relative(process.cwd(), loc.automationRoot)) || '.', phase: loc.phase, draft: loc.isDraft, summaries: ctx.summaries.length, commands: ctx.cmds.length, executions: ctx.execs.length };
  if (sub === 'merge') {
    const out = { ...head, outcome: 'OK', ...where, counts: m.totals, stages: m.stages, variant_totals: m.variant_totals, tcs: Object.fromEntries(m.results.map((r) => [r.tc_id, r.status + (r.classification && r.classification !== 'N/A' ? ' — ' + r.classification : '')])), parallel_checks: m.parallel_checks.map((p) => ({ tc: p.tc, outcome: p.outcome, cause: p.cause, resolution: p.resolution })), smoke_gate: m.smoke_gate, warnings: [...loc.errors, ...m.warnings], writes: [] };
    if (args.write) { writeJsonAtomic(loc.runFile, mergedRun); out.writes.push({ file: where.runFile, kind: 'run-file' }); }
    return out;
  }
  if (sub === 'report') {
    let historyHasPartial = null;
    if (typeof args.report === 'string') { const t = read(path.resolve(args.report)); if (t !== null) historyHasPartial = /^\|\s*Phase\s*\|.*\|\s*Partial\s*\|/mi.test(t); }
    // always the current acceptance — pre-gate while the drafts are written, final once gate record B exists
    const acceptance = computeAcceptance(mctx, m, gates);
    return { ...head, outcome: 'OK', ...where, fragments: reportFragments(mctx, m, { acceptance, gates, historyHasPartial }), acceptance, warnings: m.warnings };
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const payload = runData(args);
  print(payload, args);
  const map = STRICT[payload.subcommand] || {};
  return args.strict ? (map[payload.outcome] ?? 2) : 0;
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  try { process.exit(main()); } catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'run-data', schema: SCHEMA, outcome: 'BLOCKED', reason: 'internal error: ' + e.message }, args);
    process.exit(args.strict ? 2 : 0);
  }
}
void here;
