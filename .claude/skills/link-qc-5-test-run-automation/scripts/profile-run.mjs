#!/usr/bin/env node
// profile-run.mjs — measures a skill-5 run for the performance baseline (Phase 0 of the optimisation
// plan): from a Claude Code session transcript, the API calls, the token classes (cache reads, cache
// writes, uncached input, output), the context per call and its segments (start size P0, growth g per
// call), full-prefix cache re-writes, tool calls by category, approval paths and their latency, and the
// time split (model / tool / background wait / waits for the user); from a story's
// {results_root}/artifacts/progress folder, the Playwright time, executions, workers, hung and login
// steps and the run-stage telemetry. Node >= 18, zero dependencies.
//
// READ-ONLY. It prints AGGREGATES ONLY: no transcript text, no command, no file path, no step title and
// no heartbeat note ever reaches the output — a transcript can hold anything the session saw.
//
// Definitions (stated in the payload):
// - active time = wall span of the window minus the waits for the user's input (typed prompts, /compact);
// - a context segment starts at a window's first call and wherever the context drops below half of the
//   previous call's (a compaction); input volume of a segment = N·P0 + Σ growth;
// - a full-prefix write is a call whose cache write exceeds max(50 000, 25 % of its context).
//
// Usage:
//   node profile-run.mjs [--transcript <session.jsonl>] [--windows <fromISO>..<toISO>[=label],…]
//        [--progress <results_root>/artifacts/progress] [--hang-ms 600000] [--max-gap-ms 3600000]
//        [--login-pattern <regex>] [--pretty]
// Heartbeat records of never-run tests (worker -1, e.g. skips) count as test starts, never as executions.
// Exit code 0 (the result is in the payload); a missing input is reported in `errors`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, read, isFile, isDir } from './scan-lib.mjs';

export const SCHEMA_VERSION = 'skill5-profile/1';
export const FULL_PREFIX_MIN = 50000;
export const FULL_PREFIX_SHARE = 0.25;
export const COMPACTION_DROP = 0.5;
export const HANG_MS_DEFAULT = 600000;
export const MAX_GAP_MS_DEFAULT = 3600000;
export const LOGIN_PATTERN_DEFAULT = '\\b(log ?in|sign ?in)\\b';

const round = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const mins = (ms) => round(ms / 60000, 1);
const secs = (ms) => round(ms / 1000, 1);

// nearest-rank quantile (ceil(p·n) − 1) — the convention the plan's medians and p90s use
export function quantile(values, p) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))];
}

function parseJsonl(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped */ }
  }
  return out;
}

// "from..to=label,from..to" → [{from, to, label}]
export function parseWindows(spec) {
  const out = [];
  const errors = [];
  for (const part of String(spec || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\.\.(.+?)(?:=(.+))?$/);
    const from = m ? Date.parse(m[1]) : NaN;
    const to = m ? Date.parse(m[2]) : NaN;
    if (!m || Number.isNaN(from) || Number.isNaN(to) || to <= from) { errors.push('bad window "' + part + '" (fromISO..toISO[=label])'); continue; }
    out.push({ from, to, label: m[3] || 'window' });
  }
  return { windows: out, errors };
}

/* ---------------- transcript ---------------- */

const textOf = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join(' ') : '');
const hasToolResult = (content) => Array.isArray(content) && content.some((c) => c && c.type === 'tool_result');

// the kind of a user record: what the interval that ENDS at it was spent on
export function userKind(rec) {
  const c = rec.message && rec.message.content;
  if (hasToolResult(c)) return 'tool';
  const t = textOf(c);
  if (/<task-notification>/.test(t)) return 'background';
  if (/This session is being continued from a previous conversation/.test(t)) return 'other';
  return 'user';
}

// a tool call's category from its name and, for shell tools, its command — the command itself is never kept
export function toolCategory(name, input) {
  if (name !== 'Bash' && name !== 'PowerShell') return name || 'unknown';
  const c = String((input && input.command) || '');
  if (/run-stage\.mjs|playwright test|npx playwright(?! --version)/.test(c)) return 'shell:playwright';
  if (/validate-automation\.mjs/.test(c)) return 'shell:validator';
  if (/render-run-report\.mjs|render-tc-review\.mjs/.test(c)) return 'shell:render';
  if (/selftest[\w-]*\.mjs/.test(c)) return 'shell:selftest';
  if (/\btsc\b|\beslint\b/.test(c)) return 'shell:typecheck-lint';
  if (/\bnode\b/.test(c)) return 'shell:node-other';
  if (/(^|[;&|]\s*|\s)(ls|grep|rg|find|cat|head|tail|sed|wc|awk)\b/.test(c)) return 'shell:inspect';
  return 'shell:other';
}

function emptyTokens() { return { calls: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 }; }
function addUsage(t, u) {
  t.calls++;
  t.uncached += u.input_tokens || 0;
  t.cacheRead += u.cache_read_input_tokens || 0;
  t.cacheWrite += u.cache_creation_input_tokens || 0;
  t.output += u.output_tokens || 0;
  t.total = t.uncached + t.cacheRead + t.cacheWrite + t.output;
}
const contextOf = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

export function segmentsOf(contexts) {
  const segs = [];
  let cur = null;
  for (const c of contexts) {
    if (!cur || c < cur.last * COMPACTION_DROP) { cur = { values: [], last: c }; segs.push(cur); }
    cur.values.push(c);
    cur.last = c;
  }
  return segs.map((s) => {
    const N = s.values.length;
    const P0 = s.values[0];
    const end = s.values[N - 1];
    return { calls: N, startContext: P0, endContext: end, growthPerCall: N > 1 ? Math.round((end - P0) / (N - 1)) : 0,
      fixedTerm: N * P0, growthTerm: s.values.reduce((a, v) => a + (v - P0), 0) };
  });
}

function analyseWindow(records, w) {
  const main = records.filter((x) => !x.r.isSidechain);
  const side = records.filter((x) => x.r.isSidechain);
  const tokens = emptyTokens();
  const subagent = emptyTokens();
  const contexts = [];
  const seen = new Set();
  const seenSide = new Set();
  let fullPrefix = { events: 0, tokens: 0 };
  const toolUse = new Map();
  let toolInputChars = 0;
  for (const { r, t } of main) {
    if (r.type !== 'assistant' || !r.message) continue;
    const u = r.message.usage;
    if (u && r.message.id && !seen.has(r.message.id)) {
      seen.add(r.message.id);
      addUsage(tokens, u);
      const ctx = contextOf(u);
      contexts.push(ctx);
      const cw = u.cache_creation_input_tokens || 0;
      if (cw > Math.max(FULL_PREFIX_MIN, FULL_PREFIX_SHARE * ctx)) { fullPrefix.events++; fullPrefix.tokens += cw; }
    }
    for (const c of r.message.content || []) {
      if (!c || c.type !== 'tool_use' || toolUse.has(c.id)) continue;
      toolUse.set(c.id, { at: t, category: toolCategory(c.name, c.input), background: !!(c.input && c.input.run_in_background) });
      toolInputChars += JSON.stringify(c.input || {}).length;
    }
  }
  for (const { r } of side) {
    if (r.type !== 'assistant' || !r.message || !r.message.usage || !r.message.id || seenSide.has(r.message.id)) continue;
    seenSide.add(r.message.id);
    addUsage(subagent, r.message.usage);
  }
  // tool results: latency and approval path
  const byPath = {};
  for (const { r, t } of main) {
    if (r.type !== 'user' || !r.message || !Array.isArray(r.message.content)) continue;
    for (const c of r.message.content) {
      if (!c || c.type !== 'tool_result' || !toolUse.has(c.tool_use_id)) continue;
      const tu = toolUse.get(c.tool_use_id);
      if (tu.latencyMs !== undefined) continue;
      tu.latencyMs = t - tu.at;
      const d = r.permissionDecision || {};
      const key = d.reasonType || d.source || 'unrecorded';
      (byPath[key] = byPath[key] || []).push(tu.latencyMs);
    }
  }
  const categories = {};
  for (const tu of toolUse.values()) {
    const k = categories[tu.category] = categories[tu.category] || { calls: 0, latencySumS: 0 };
    k.calls++;
    if (tu.latencyMs !== undefined) k.latencySumS = round(k.latencySumS + tu.latencyMs / 1000, 1);
  }
  const approvals = Object.fromEntries(Object.entries(byPath).sort().map(([k, v]) => [k, { calls: v.length, p50S: secs(quantile(v, 0.5)), p90S: secs(quantile(v, 0.9)), sumS: secs(v.reduce((a, b) => a + b, 0)) }]));
  // time split: each interval between consecutive main records belongs to what ENDS it
  const timeline = main.filter((x) => x.r.type === 'assistant' || x.r.type === 'user').sort((a, b) => a.t - b.t);
  const time = { modelMs: 0, toolMs: 0, backgroundWaitMs: 0, userWaitMs: 0, otherMs: 0 };
  for (let i = 1; i < timeline.length; i++) {
    const d = timeline[i].t - timeline[i - 1].t;
    const r = timeline[i].r;
    if (r.type === 'assistant') time.modelMs += d;
    else {
      const k = userKind(r);
      if (k === 'tool') time.toolMs += d;
      else if (k === 'background') time.backgroundWaitMs += d;
      else if (k === 'user') time.userWaitMs += d;
      else time.otherMs += d;
    }
  }
  const spanMs = timeline.length ? timeline[timeline.length - 1].t - timeline[0].t : 0;
  return {
    label: w.label,
    tokens, subagent,
    context: { average: contexts.length ? Math.round(contexts.reduce((a, b) => a + b, 0) / contexts.length) : null, peak: contexts.length ? Math.max(...contexts) : null, first: contexts.length ? contexts[0] : null },
    segments: segmentsOf(contexts),
    cacheWrites: { fullPrefix, incremental: tokens.cacheWrite - fullPrefix.tokens },
    toolCalls: { total: toolUse.size, background: [...toolUse.values()].filter((x) => x.background).length, inputChars: toolInputChars, byCategory: Object.fromEntries(Object.entries(categories).sort()) },
    approvals,
    time: { wallSpanMin: mins(spanMs), activeMin: mins(spanMs - time.userWaitMs), modelMin: mins(time.modelMs), toolMin: mins(time.toolMs), backgroundWaitMin: mins(time.backgroundWaitMs), userWaitMin: mins(time.userWaitMs), otherMin: mins(time.otherMs),
      outputTokensPerModelSecond: time.modelMs > 0 ? round(tokens.output / (time.modelMs / 1000), 1) : null },
    _raw: { spanMs, time, contexts, toolUse: [...toolUse.values()], byPath },
  };
}

function mergeLabel(list) {
  const tokens = emptyTokens();
  const subagent = emptyTokens();
  const time = { spanMs: 0, modelMs: 0, toolMs: 0, backgroundWaitMs: 0, userWaitMs: 0, otherMs: 0 };
  const contexts = [];
  const segments = [];
  const fullPrefix = { events: 0, tokens: 0 };
  const categories = {};
  const byPath = {};
  let tools = 0, background = 0, inputChars = 0;
  for (const w of list) {
    for (const k of ['calls', 'uncached', 'cacheRead', 'cacheWrite', 'output']) { tokens[k] += w.tokens[k]; subagent[k] += w.subagent[k]; }
    time.spanMs += w._raw.spanMs;
    for (const k of ['modelMs', 'toolMs', 'backgroundWaitMs', 'userWaitMs', 'otherMs']) time[k] += w._raw.time[k];
    contexts.push(...w._raw.contexts);
    segments.push(...w.segments);
    fullPrefix.events += w.cacheWrites.fullPrefix.events; fullPrefix.tokens += w.cacheWrites.fullPrefix.tokens;
    for (const [k, v] of Object.entries(w.toolCalls.byCategory)) { const c = categories[k] = categories[k] || { calls: 0, latencySumS: 0 }; c.calls += v.calls; c.latencySumS = round(c.latencySumS + v.latencySumS, 1); }
    for (const [k, v] of Object.entries(w._raw.byPath)) (byPath[k] = byPath[k] || []).push(...v);
    tools += w.toolCalls.total; background += w.toolCalls.background; inputChars += w.toolCalls.inputChars;
  }
  tokens.total = tokens.uncached + tokens.cacheRead + tokens.cacheWrite + tokens.output;
  subagent.total = subagent.uncached + subagent.cacheRead + subagent.cacheWrite + subagent.output;
  return {
    windows: list.length, tokens, subagent,
    context: { average: contexts.length ? Math.round(contexts.reduce((a, b) => a + b, 0) / contexts.length) : null, peak: contexts.length ? Math.max(...contexts) : null },
    segments,
    inputVolume: { fixedTerm: segments.reduce((a, s) => a + s.fixedTerm, 0), growthTerm: segments.reduce((a, s) => a + s.growthTerm, 0) },
    cacheWrites: { fullPrefix, incremental: tokens.cacheWrite - fullPrefix.tokens },
    toolCalls: { total: tools, background, inputChars, byCategory: Object.fromEntries(Object.entries(categories).sort()) },
    approvals: Object.fromEntries(Object.entries(byPath).sort().map(([k, v]) => [k, { calls: v.length, p50S: secs(quantile(v, 0.5)), p90S: secs(quantile(v, 0.9)), sumS: secs(v.reduce((a, b) => a + b, 0)) }])),
    time: { wallSpanMin: mins(time.spanMs), activeMin: mins(time.spanMs - time.userWaitMs), modelMin: mins(time.modelMs), toolMin: mins(time.toolMs), backgroundWaitMin: mins(time.backgroundWaitMs), userWaitMin: mins(time.userWaitMs), otherMin: mins(time.otherMs),
      outputTokensPerModelSecond: time.modelMs > 0 ? round(tokens.output / (time.modelMs / 1000), 1) : null },
  };
}

export function profileTranscript(text, windows) {
  const records = parseJsonl(text).map((r) => ({ r, t: Date.parse(r && r.timestamp) })).filter((x) => x.r && !Number.isNaN(x.t) && !x.r.isMeta);
  const wins = windows && windows.length ? windows : [{ from: -Infinity, to: Infinity, label: 'all' }];
  const perWindow = wins.map((w) => analyseWindow(records.filter((x) => x.t >= w.from && x.t < w.to), w));
  const labels = [...new Set(perWindow.map((w) => w.label))];
  const byLabel = Object.fromEntries(labels.map((l) => [l, mergeLabel(perWindow.filter((w) => w.label === l))]));
  const total = mergeLabel(perWindow);
  return { total, byLabel, windows: perWindow.map((w) => ({ label: w.label, calls: w.tokens.calls, toolCalls: w.toolCalls.total, tokens: w.tokens.total, wallSpanMin: w.time.wallSpanMin })) };
}

/* ---------------- story artifacts (heartbeats, summaries) ---------------- */

const isHeartbeatFile = (f) => f.endsWith('.jsonl') && !/\.(results|ratelimit)\.jsonl$/.test(f);

// a heartbeat record from a real worker (Playwright reports never-run tests, e.g. skips, with parallelIndex -1)
const realWorker = (w) => typeof w === 'number' && w >= 0;

export function profileProgress(dir, { hangMs = HANG_MS_DEFAULT, loginPattern = LOGIN_PATTERN_DEFAULT, maxGapMs = MAX_GAP_MS_DEFAULT } = {}) {
  const loginRe = new RegExp(loginPattern, 'i');
  const files = fs.readdirSync(dir).filter(isHeartbeatFile).sort();
  const commands = [];
  const tests = [];
  const workers = {};
  const tcSet = new Set();
  let testStarts = 0, executions = 0, unassignedRecords = 0, loginMs = 0, hungSteps = 0, hungMs = 0, longDeadlineSteps = 0;
  const stepDurations = [];
  for (const f of files) {
    const recs = parseJsonl(read(path.join(dir, f))).filter((r) => r && r.at && r.event);
    if (!recs.length) continue;
    const ts = recs.map((r) => Date.parse(r.at)).filter((x) => !Number.isNaN(x));
    commands.push({ start: Math.min(...ts), end: Math.max(...ts) });
    const open = new Map();
    const lastSeen = new Map();
    for (const r of recs) {
      const at = Date.parse(r.at);
      const key = r.worker + '|' + r.tc;
      const real = realWorker(r.worker);
      if (real) workers[r.worker] = (workers[r.worker] || 0) + 1; else unassignedRecords++;
      if (r.event === 'test-start') testStarts++;
      if (!real) continue; // never-run tests: counted as starts, never as executions, workers or concurrency
      lastSeen.set(key, at);
      if (r.event === 'test-start') { executions++; for (const tc of String(r.tc || '').split(',').map((s) => s.trim()).filter(Boolean)) tcSet.add(tc); open.set(key, at); }
      else if (r.event === 'test-end' && open.has(key)) { tests.push({ start: open.get(key), end: at }); open.delete(key); }
      else if (r.event === 'start' && typeof r.deadline_ms === 'number' && r.deadline_ms >= hangMs) longDeadlineSteps++;
      else if (r.event === 'end' && typeof r.elapsed_ms === 'number') {
        stepDurations.push(r.elapsed_ms);
        if (r.step && loginRe.test(String(r.step))) loginMs += r.elapsed_ms;
        if (r.elapsed_ms >= hangMs && r.outcome && r.outcome !== 'ok') { hungSteps++; hungMs += r.elapsed_ms; }
      }
    }
    for (const [key, start] of open) tests.push({ start, end: lastSeen.get(key) || start });
  }
  commands.sort((a, b) => a.start - b.start);
  // a gap shorter than maxGapMs is time between commands of one sitting; a longer one is an idle period (overnight, a break)
  let gapMs = 0, idleCount = 0, idleMs = 0;
  let reach = -Infinity;
  for (const c of commands) {
    if (reach > -Infinity && c.start > reach) { const g = c.start - reach; if (g < maxGapMs) gapMs += g; else { idleCount++; idleMs += g; } }
    reach = Math.max(reach, c.end);
  }
  const playwrightMs = commands.reduce((a, c) => a + (c.end - c.start), 0);
  // time-weighted concurrency of tests: test time ÷ union of the time any test ran
  const testMs = tests.reduce((a, x) => a + (x.end - x.start), 0);
  const ivs = tests.map((x) => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
  let unionMs = 0, cs = null, ce = null;
  for (const [s, e] of ivs) { if (cs === null) { cs = s; ce = e; } else if (s <= ce) ce = Math.max(ce, e); else { unionMs += ce - cs; cs = s; ce = e; } }
  if (cs !== null) unionMs += ce - cs;
  const events = [];
  for (const x of tests) { events.push([x.start, 1]); events.push([x.end, -1]); }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0, maxConcurrent = 0;
  for (const [, d] of events) { cur += d; maxConcurrent = Math.max(maxConcurrent, cur); }
  // run-stage summaries: telemetry peaks (observe-only sampler)
  const summaries = fs.readdirSync(dir).filter((f) => f.endsWith('.summary.json')).sort();
  const tele = { summaries: summaries.length, withTelemetry: 0, availableMinMb: null, cpuPeakPct: null, treePeakRssMb: null, treePeakProcesses: null };
  const lower = (a, b) => (b === null || b === undefined ? a : a === null ? b : Math.min(a, b));
  const higher = (a, b) => (b === null || b === undefined ? a : a === null ? b : Math.max(a, b));
  for (const f of summaries) {
    let s = null; try { s = JSON.parse(read(path.join(dir, f))); } catch { continue; }
    const t = s && s.telemetry;
    if (!t || t.disabled) continue;
    tele.withTelemetry++;
    tele.availableMinMb = lower(tele.availableMinMb, t.memory && t.memory.availableMinMb);
    tele.cpuPeakPct = higher(tele.cpuPeakPct, t.cpu && t.cpu.peakPct);
    tele.treePeakRssMb = higher(tele.treePeakRssMb, t.tree && t.tree.peakRssMb);
    tele.treePeakProcesses = higher(tele.treePeakProcesses, t.tree && t.tree.peakProcesses);
  }
  return {
    commands: commands.length,
    playwrightMin: mins(playwrightMs),
    gapsBetweenCommandsMin: mins(gapMs),
    idlePeriods: { count: idleCount, minutes: mins(idleMs), thresholdMs: maxGapMs },
    testStarts,
    executions,
    distinctTcs: tcSet.size,
    executionsPerTc: tcSet.size ? round(executions / tcSet.size, 2) : null,
    workers: { ids: Object.keys(workers).sort(), recordsByWorker: Object.fromEntries(Object.entries(workers).sort()), unassignedRecords, averageActive: unionMs > 0 ? round(testMs / unionMs, 2) : null, maxConcurrent },
    steps: { ended: stepDurations.length, p50S: secs(quantile(stepDurations, 0.5)), p90S: secs(quantile(stepDurations, 0.9)), loginMin: mins(loginMs), hung: { count: hungSteps, minutes: mins(hungMs), thresholdMs: hangMs }, deadlineAtOrAboveThreshold: longDeadlineSteps },
    telemetry: tele,
  };
}

/* ---------------- CLI ---------------- */

export function profile(args) {
  const errors = [];
  const warnings = [];
  const out = { tool: 'profile-run', schema: SCHEMA_VERSION,
    definitions: {
      activeTime: 'wall span of each window minus the waits for the user\'s input (typed prompts, /compact)',
      segment: 'starts at a window\'s first call and wherever the context drops below ' + COMPACTION_DROP * 100 + ' % of the previous call\'s; input volume = Σ(N·P0) + Σ growth',
      fullPrefixWrite: 'a call whose cache write exceeds max(' + FULL_PREFIX_MIN + ', ' + FULL_PREFIX_SHARE * 100 + ' % of its context)',
      subagent: 'records marked isSidechain — counted apart from the main context',
      privacy: 'aggregates only: no transcript text, command, file path, step title or note is reported',
    },
    transcript: null, playwright: null, errors, warnings };
  const { windows, errors: wErr } = parseWindows(args.windows);
  errors.push(...wErr);
  if (typeof args.transcript === 'string') {
    if (!isFile(args.transcript)) errors.push('--transcript is not a file');
    else out.transcript = profileTranscript(read(args.transcript), windows);
  }
  if (typeof args.progress === 'string') {
    if (!isDir(args.progress)) errors.push('--progress is not a folder');
    else {
      const hangMs = Number(args['hang-ms']) > 0 ? Number(args['hang-ms']) : HANG_MS_DEFAULT;
      const maxGapMs = Number(args['max-gap-ms']) > 0 ? Number(args['max-gap-ms']) : MAX_GAP_MS_DEFAULT;
      let loginPattern = LOGIN_PATTERN_DEFAULT;
      if (typeof args['login-pattern'] === 'string') { try { new RegExp(args['login-pattern']); loginPattern = args['login-pattern']; } catch { errors.push('--login-pattern is not a valid regular expression'); } }
      out.playwright = profileProgress(args.progress, { hangMs, loginPattern, maxGapMs });
      if (!out.playwright.commands) warnings.push('no heartbeat file under --progress');
    }
  }
  if (!out.transcript && !out.playwright && !errors.length) errors.push('nothing to profile: pass --transcript and/or --progress');
  return out;
}

const HELP = {
  tool: 'profile-run',
  usage: 'node profile-run.mjs [--transcript <session.jsonl>] [--windows <fromISO>..<toISO>[=label],…] [--progress <results_root>/artifacts/progress] [--hang-ms 600000] [--max-gap-ms 3600000] [--login-pattern <regex>] [--pretty]',
  notes: [
    'Read-only. Aggregates only — never transcript text, commands, paths, step titles or notes.',
    'Windows with the same label are merged under transcript.byLabel (e.g. skill-5 work vs side work).',
    'Exit code 0; problems are listed in errors[].',
  ],
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  print(profile(args), args);
  return 0;
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exit(main());
