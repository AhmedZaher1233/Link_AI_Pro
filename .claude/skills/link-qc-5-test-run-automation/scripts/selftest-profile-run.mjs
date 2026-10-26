#!/usr/bin/env node
// selftest-profile-run.mjs — regression harness for profile-run.mjs.
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// Every expectation below is worked out by hand from fixtures/profile-run/ (a synthetic Claude Code
// transcript and a story's artifacts/progress folder): token classes and their de-duplication per
// message, context segments (fixed + growth = input volume), full-prefix cache writes, tool categories,
// approval paths with nearest-rank quantiles, the time split and active time, window filtering, ignored
// records (meta, attachments, torn lines, sidechains counted apart), Playwright time, executions,
// workers, hung / login steps, run-stage telemetry peaks — and that NO fixture text reaches the output.
//
// Run: node selftest-profile-run.mjs [--pretty]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { profileTranscript, profileProgress, parseWindows, quantile, segmentsOf, toolCategory } from './profile-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(here, 'profile-run.mjs');
const FX = path.join(here, 'fixtures', 'profile-run');
const SESSION = path.join(FX, 'session.jsonl');
const PROGRESS = path.join(FX, 'progress');
const WINDOWS = '2026-01-01T10:00:00Z..2026-01-01T10:10:00Z=s5,2026-01-01T11:00:00Z..2026-01-01T11:05:00Z=side';
const r1 = (ms) => Math.round((ms / 60000) * 10) / 10;

const cases = [];
const fail = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
const eq = (p, what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) p.push(what + ': ' + JSON.stringify(got) + ' != ' + JSON.stringify(want)); };

const { windows } = parseWindows(WINDOWS);
const prof = profileTranscript(fs.readFileSync(SESSION, 'utf8'), windows);
const s5 = prof.byLabel.s5;
const side = prof.byLabel.side;
const total = prof.total;

/* 1 — token classes per label and in total; a message logged on two lines counts once; the window filter drops the call outside it. */
{
  const p = [];
  eq(p, 's5 tokens', s5.tokens, { calls: 6, uncached: 12, cacheRead: 717000, cacheWrite: 166000, output: 3500, total: 886512 });
  eq(p, 'side tokens', side.tokens, { calls: 2, uncached: 4, cacheRead: 401000, cacheWrite: 1500, output: 400, total: 402904 });
  eq(p, 'total tokens', total.tokens, { calls: 8, uncached: 16, cacheRead: 1118000, cacheWrite: 167500, output: 3900, total: 1289416 });
  eq(p, 'subagent (sidechain) tokens', total.subagent, { calls: 1, uncached: 1, cacheRead: 10000, cacheWrite: 5000, output: 100, total: 15101 });
  eq(p, 'windows', prof.windows, [{ label: 's5', calls: 6, toolCalls: 5, tokens: 886512, wallSpanMin: 6 }, { label: 'side', calls: 2, toolCalls: 1, tokens: 402904, wallSpanMin: r1(25000) }]);
  check('1 token classes, per-message de-duplication, window filter, sidechain apart', p, { s5: s5.tokens, total: total.tokens });
}

/* 2 — context per call and segments: a drop below half the previous context starts a new segment; fixed + growth = input volume. */
{
  const p = [];
  eq(p, 's5 context', s5.context, { average: 147169, peak: 166002 });
  eq(p, 'total context', total.context, { average: 160690, peak: 201502 });
  eq(p, 's5 segments', s5.segments, [
    { calls: 4, startContext: 160002, endContext: 166002, growthPerCall: 2000, fixedTerm: 640008, growthTerm: 13000 },
    { calls: 2, startContext: 80002, endContext: 150002, growthPerCall: 70000, fixedTerm: 160004, growthTerm: 70000 },
  ]);
  eq(p, 's5 input volume', s5.inputVolume, { fixedTerm: 800012, growthTerm: 83000 });
  const inputs = s5.tokens.uncached + s5.tokens.cacheRead + s5.tokens.cacheWrite;
  if (s5.inputVolume.fixedTerm + s5.inputVolume.growthTerm !== inputs) p.push('fixed + growth (' + (s5.inputVolume.fixedTerm + s5.inputVolume.growthTerm) + ') != input tokens (' + inputs + ')');
  eq(p, 'segmentsOf([10,20,4,6])', segmentsOf([10, 20, 4, 6]).map((s) => s.calls), [2, 2]);
  check('2 context per call, compaction segments, fixed + growth = input volume', p, { segments: s5.segments });
}

/* 3 — cache writes: full-prefix (> max(50 000, 25 % of context)) vs incremental. */
{
  const p = [];
  eq(p, 's5 cache writes', s5.cacheWrites, { fullPrefix: { events: 2, tokens: 130000 }, incremental: 36000 });
  eq(p, 'side cache writes', side.cacheWrites, { fullPrefix: { events: 0, tokens: 0 }, incremental: 1500 });
  eq(p, 'total cache writes', total.cacheWrites, { fullPrefix: { events: 2, tokens: 130000 }, incremental: 37500 });
  check('3 full-prefix vs incremental cache writes', p, {});
}

/* 4 — tool calls: categories (never the command), background launches, input size, approval paths with nearest-rank p50 / p90. */
{
  const p = [];
  eq(p, 'total by category', total.toolCalls.byCategory, {
    Edit: { calls: 1, latencySumS: 10 }, Grep: { calls: 1, latencySumS: 10 }, Read: { calls: 1, latencySumS: 5 },
    'shell:inspect': { calls: 1, latencySumS: 10 }, 'shell:playwright': { calls: 1, latencySumS: 10 }, 'shell:validator': { calls: 1, latencySumS: 6 },
  });
  eq(p, 'tool totals', [total.toolCalls.total, total.toolCalls.background], [6, 1]);
  // input size = the JSON of every in-window main tool input
  let chars = 0;
  for (const line of fs.readFileSync(SESSION, 'utf8').split(/\r?\n/)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'assistant' || r.isSidechain) continue;
    for (const c of (r.message && r.message.content) || []) if (c.type === 'tool_use') chars += JSON.stringify(c.input).length;
  }
  eq(p, 'input chars', total.toolCalls.inputChars, chars);
  eq(p, 'approvals', total.approvals, {
    classifier: { calls: 3, p50S: 10, p90S: 10, sumS: 30 },
    mode: { calls: 1, p50S: 5, p90S: 5, sumS: 5 },
    rule: { calls: 2, p50S: 6, p90S: 10, sumS: 16 },
  });
  eq(p, 'quantile nearest-rank', [quantile([6, 10], 0.5), quantile([6, 10], 0.9), quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), quantile([], 0.5)], [6, 10, 9, null]);
  eq(p, 'categories', [toolCategory('Bash', { command: 'cat a | grep b' }), toolCategory('Bash', { command: 'npx playwright --version' }), toolCategory('PowerShell', { command: 'npx tsc --noEmit' }), toolCategory('Bash', { command: 'echo hi' })],
    ['shell:inspect', 'shell:other', 'shell:typecheck-lint', 'shell:other']);
  check('4 tool categories, background launches, approval paths, quantiles', p, { approvals: total.approvals });
}

/* 5 — time split: model / tool / background wait / waits for the user; active = wall span − user waits; meta and attachment records ignored. */
{
  const p = [];
  eq(p, 's5 time', s5.time, { wallSpanMin: r1(360000), activeMin: r1(335000), modelMin: r1(35000), toolMin: r1(41000), backgroundWaitMin: r1(259000), userWaitMin: r1(25000), otherMin: 0, outputTokensPerModelSecond: 100 });
  eq(p, 'side time', side.time, { wallSpanMin: r1(25000), activeMin: r1(25000), modelMin: r1(15000), toolMin: r1(10000), backgroundWaitMin: 0, userWaitMin: 0, otherMin: 0, outputTokensPerModelSecond: 26.7 });
  eq(p, 'total time', total.time, { wallSpanMin: r1(385000), activeMin: r1(360000), modelMin: r1(50000), toolMin: r1(51000), backgroundWaitMin: r1(259000), userWaitMin: r1(25000), otherMin: 0, outputTokensPerModelSecond: 78 });
  check('5 time split, active time, ignored meta / attachment records', p, { total: total.time });
}

/* 6 — Playwright from heartbeats; results / rate-limit / plan files ignored; telemetry peaks from summaries (a disabled one skipped). */
{
  const p = [];
  const pw = profileProgress(PROGRESS);
  eq(p, 'commands / minutes / gaps', [pw.commands, pw.playwrightMin, pw.gapsBetweenCommandsMin], [2, r1(1630000), r1(20000)]);
  eq(p, 'idle periods', pw.idlePeriods, { count: 0, minutes: 0, thresholdMs: 3600000 });
  // the never-run test (worker -1, e.g. a skip) is a start, never an execution, a worker or concurrency
  eq(p, 'executions', [pw.testStarts, pw.executions, pw.distinctTcs, pw.executionsPerTc], [5, 4, 3, 1.33]);
  eq(p, 'workers', pw.workers, { ids: ['0', '1'], recordsByWorker: { 0: 12, 1: 4 }, unassignedRecords: 2, averageActive: 1.02, maxConcurrent: 2 });
  eq(p, 'steps', pw.steps, { ended: 4, p50S: 20, p90S: 1500, loginMin: r1(50000), hung: { count: 1, minutes: 25, thresholdMs: 600000 }, deadlineAtOrAboveThreshold: 1 });
  eq(p, 'telemetry', pw.telemetry, { summaries: 3, withTelemetry: 2, availableMinMb: 3500, cpuPeakPct: 70, treePeakRssMb: 1200, treePeakProcesses: 15 });
  const strict = profileProgress(PROGRESS, { hangMs: 3600000, loginPattern: 'open', maxGapMs: 10000 });
  eq(p, 'custom threshold / pattern', [strict.steps.hung.count, strict.steps.loginMin, strict.steps.deadlineAtOrAboveThreshold], [0, r1(10000), 0]);
  eq(p, 'a gap above --max-gap-ms is an idle period, not command time', [strict.gapsBetweenCommandsMin, strict.idlePeriods], [0, { count: 1, minutes: r1(20000), thresholdMs: 10000 }]);
  check('6 Playwright time, executions, workers, hung and login steps, telemetry peaks', p, { pw });
}

/* 7 — CLI: aggregates only (no fixture text in the output), errors reported in the payload with exit 0. */
{
  const p = [];
  const run = (args) => {
    const r = spawnSync(process.execPath, [PROFILE, ...args], { encoding: 'utf8' });
    let j = null; try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
    return { status: r.status, j, raw: r.stdout };
  };
  const ok = run(['--transcript', SESSION, '--windows', WINDOWS, '--progress', PROGRESS]);
  if (ok.status !== 0 || !ok.j || ok.j.errors.length) p.push('normal run: exit ' + ok.status + ' errors ' + JSON.stringify(ok.j && ok.j.errors));
  if (/SECRET-MARKER/.test(ok.raw)) p.push('fixture text leaked into the output: ' + (ok.raw.match(/SECRET-MARKER[\w-]*/g) || []).join(', '));
  if (/_raw/.test(ok.raw)) p.push('internal _raw data leaked into the output');
  if (ok.j && (ok.j.transcript.total.tokens.total !== 1289416 || ok.j.playwright.executions !== 4)) p.push('CLI totals differ from the module');
  const whole = run(['--transcript', SESSION]);
  if (!whole.j || whole.j.transcript.total.tokens.calls !== 9) p.push('no --windows must profile the whole transcript (9 main calls), got ' + (whole.j && whole.j.transcript.total.tokens.calls));
  const bad = run(['--transcript', path.join(FX, 'missing.jsonl'), '--windows', 'yesterday..today', '--progress', path.join(FX, 'nope')]);
  if (bad.status !== 0) p.push('errors must not change the exit code (got ' + bad.status + ')');
  const errs = (bad.j && bad.j.errors) || [];
  for (const want of [/bad window/, /--transcript is not a file/, /--progress is not a folder/]) if (!errs.some((e) => want.test(e))) p.push('missing error ' + want);
  const none = run([]);
  if (!none.j || !none.j.errors.some((e) => /nothing to profile/.test(e))) p.push('no input must report "nothing to profile"');
  const badRe = run(['--progress', PROGRESS, '--login-pattern', '(']);
  if (!badRe.j || !badRe.j.errors.some((e) => /login-pattern/.test(e))) p.push('an invalid --login-pattern must be reported');
  check('7 CLI: aggregates only, errors in the payload, exit 0', p, {});
}

const out = {
  tool: 'selftest-profile-run',
  ran: cases.length,
  ok: fail.length === 0,
  cases,
  mismatches: fail,
  note: fail.length ? 'profile-run.mjs disagrees with its fixtures. Do not use its numbers as a baseline until this passes.' : 'Every measurement matches the hand-computed fixture values.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
