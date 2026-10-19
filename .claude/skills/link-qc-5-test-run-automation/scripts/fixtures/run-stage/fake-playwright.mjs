#!/usr/bin/env node
// fake-playwright.mjs — stands in for `playwright test`, used ONLY by selftest-run-stage.mjs.
// It filters suite.json with the REAL --grep / --grep-invert regexes run-stage.mjs builds (title path +
// tags, as Playwright matches them) and writes what the real project writes: the heartbeat
// (helpers/steps.ts + helpers/progress-reporter.ts shapes), the incremental results, the network
// guard's rate-limit records, the JSON reporter's file (describes nested, --repeat-each as repeated test
// entries) and line-reporter output. FAKE_PW_SCENARIO = {"<group slug>": "<scenario>"} makes one group
// misbehave on purpose: freeze · quiet-long · malformed · hang-between · no-json · stale-json · no-tests ·
// secret · dll-crash · interference (TC-002 fails only beside other tests) · false-pass (and TC-001
// fails alone) · mass-fail (everything fails beside others) · rate-limit (TC-002 refused + fails, always)
// · rate-limit-once (only on attempt 1) · refused-ok (TC-004 sees a 429 and passes) · chain (TC-030
// fails, its serial follower TC-031 is skipped by Playwright) · flaky-repeat (TC-004 fails on repeat 2)
// · all-pass (default: the outcomes in suite.json). Every call records its argv and the PW_* variables it
// received under {artifacts}/fake-argv/ so the harness can check the command shape. Like Playwright it reads
// {PW_OUTPUT_DIR}/.last-run.json for --last-failed (recorded as `lastRun`), then WIPES PW_OUTPUT_DIR, writes each
// failed test's test-failed-1.png + trace.zip into its own sub-folder and ends with a fresh .last-run.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = {};
const specs = [];
for (let i = 1; i < argv.length; i++) {
  const x = argv[i];
  if (x.startsWith('--')) {
    const eq = x.indexOf('=');
    if (eq > 0) flags[x.slice(2, eq)] = x.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[x.slice(2)] = argv[++i];
    else flags[x.slice(2)] = true;
  } else specs.push(x);
}
const env = process.env;
const project = flags.project || 'chromium';
const workers = Number(flags.workers) || 1;
const repeats = Number(flags['repeat-each']) || 1;
const grep = flags.grep ? new RegExp(flags.grep, 'i') : null;
const invert = flags['grep-invert'] ? new RegExp(flags['grep-invert'], 'i') : null;
const slug = ((flags.grep || '').match(/@run:([A-Za-z0-9-]+)/) || [])[1] || 'none';
const scenarios = JSON.parse(env.FAKE_PW_SCENARIO || '{}');
const scenario = scenarios[slug] || scenarios['*'] || 'pass';
const attempt = env.PW_STAGE_ATTEMPT || '1';
const artifacts = env.PW_STAGE_JSON ? path.dirname(path.dirname(env.PW_STAGE_JSON)) : path.join(here, 'artifacts');
const outDir = env.PW_OUTPUT_DIR || null;
let lastRun = null;
if (flags['last-failed'] && outDir) { try { lastRun = JSON.parse(fs.readFileSync(path.join(outDir, '.last-run.json'), 'utf8')); } catch { /* none: every test runs */ } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

fs.mkdirSync(path.join(artifacts, 'fake-argv'), { recursive: true });
const pw = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('PW_')));
fs.writeFileSync(path.join(artifacts, 'fake-argv', slug + '-' + attempt + '.json'), JSON.stringify({ argv, specs, flags, env: pw, scenario, lastRun }, null, 2));
if (outDir) { fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true }); } // Playwright's "clear output"

const suite = JSON.parse(fs.readFileSync(path.join(here, 'suite.json'), 'utf8')).tests;
const matched = suite.filter((t) => {
  const s = [t.file, ...(t.describe || []), t.title].join(' ') + ' ' + t.tags.join(' ');
  return (!grep || grep.test(s)) && !(invert && invert.test(s)) && (!specs.length || specs.includes(t.file));
}).filter((t) => !lastRun || (lastRun.failedTests || []).includes(t.title));
const progressFile = env.PW_PROGRESS_FILE;
const resultsFile = progressFile ? progressFile.replace(/\.jsonl$/, '') + '.results.jsonl' : null;
const hb = (rec) => { if (progressFile) { fs.mkdirSync(path.dirname(progressFile), { recursive: true }); fs.appendFileSync(progressFile, JSON.stringify({ at: now(), ...rec }) + '\n'); } };
const res = (rec) => { if (resultsFile) fs.appendFileSync(resultsFile, JSON.stringify({ at: now(), ...rec }) + '\n'); };
const rl = (rec) => { if (env.PW_RATE_LIMIT_FILE) { fs.mkdirSync(path.dirname(env.PW_RATE_LIMIT_FILE), { recursive: true }); fs.appendFileSync(env.PW_RATE_LIMIT_FILE, JSON.stringify({ at: now(), ...rec }) + '\n'); } };
const tcIds = (title) => [...title.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter((s) => /^TC-/.test(s));
const done = [];

// the outcome of one execution under the scenario (`repeat` = 0-based repeat index)
function outcomeOf(t, repeat) {
  const tcs = tcIds(t.title);
  const has = (id) => tcs.includes(id);
  switch (scenario) {
    case 'all-pass': return 'passed';
    case 'interference': return has('TC-002') && workers > 1 ? 'failed' : t.outcome;
    case 'false-pass': if (has('TC-002')) return workers > 1 ? 'failed' : 'passed'; if (has('TC-001')) return workers > 1 ? 'passed' : 'failed'; return t.outcome;
    case 'mass-fail': return workers > 1 ? 'failed' : t.outcome;
    case 'rate-limit': return has('TC-002') ? 'failed' : t.outcome;
    case 'rate-limit-once': return has('TC-002') ? (attempt === '1' ? 'failed' : 'passed') : t.outcome;
    case 'chain': if (has('TC-030')) return 'failed'; if (has('TC-031')) return 'follower'; return t.outcome;
    case 'flaky-repeat': return has('TC-004') && repeat === 1 ? 'failed' : t.outcome;
    default: return t.outcome;
  }
}
const refusedFor = (t) => {
  const tcs = tcIds(t.title);
  if ((scenario === 'rate-limit' || (scenario === 'rate-limit-once' && attempt === '1')) && tcs.includes('TC-002')) return true;
  if (scenario === 'refused-ok' && tcs.includes('TC-004')) return true;
  return false;
};

async function runTest(t, n, opts = {}) {
  const worker = opts.worker ?? n % workers;
  const tcs = tcIds(t.title);
  const tc = tcs.join(',') || t.title;
  const repeat = opts.repeat || 0;
  const outcome = outcomeOf(t, repeat);
  const started = Date.now();
  if (outcome === 'follower') { done.push({ t, status: 'skipped', duration: 0, repeat, follower: true }); return; }
  hb({ worker, tc, event: 'test-start', retry: 0, project });
  hb({ worker, tc, step: 'perform the steps', event: 'start', deadline_ms: opts.deadline || 30000, note: 'the expected result is shown' });
  if (refusedFor(t)) {
    await sleep(5);
    rl({ worker, tc: tcs, method: 'POST', url: 'https://app.example.test/api/session', status: 429, retry_after_s: 1, kind: 'refused' });
    if (scenario === 'refused-ok') rl({ worker, tc: tcs, method: 'POST', url: 'https://app.example.test/api/session', status: 200, kind: 'policy', limit: 5, remaining: 0, reset: 60, window_s: 60 });
  }
  await sleep(opts.ms || 25);
  hb({ worker, tc, step: 'perform the steps', event: 'end', outcome: outcome === 'failed' ? 'error' : 'ok', elapsed_ms: Date.now() - started });
  const duration = Date.now() - started;
  res({ worker, tc: tcs.length ? tcs : [t.title], title: t.title, status: outcome, duration_ms: duration, retry: 0, project });
  hb({ worker, tc, event: 'test-end', status: outcome });
  const sym = { passed: '✓', failed: '✘', skipped: '-' }[outcome] || '?';
  console.log('  ' + sym + '  ' + (n + 1) + ' [' + project + '] › ' + t.file + ' › ' + t.title + ' (' + duration + 'ms)');
  let shot = null;
  if (outcome === 'failed' && outDir) {
    const dir = path.join(outDir, t.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + project + (repeat ? '-repeat' + repeat : ''));
    fs.mkdirSync(dir, { recursive: true });
    shot = path.join(dir, 'test-failed-1.png');
    fs.writeFileSync(shot, 'png');
    fs.writeFileSync(path.join(dir, 'trace.zip'), 'trace');
  }
  done.push({ t, status: outcome, duration, repeat, shot });
}

function writeJson(extra = []) {
  if (!env.PW_STAGE_JSON) return;
  // file suite → describe suites → specs; one spec per title, one tests[] entry per repeat
  const files = new Map();
  const suiteOf = (file, describe) => {
    if (!files.has(file)) files.set(file, { title: file, file, specs: [], suites: [] });
    let s = files.get(file);
    for (const d of describe || []) {
      let c = s.suites.find((x) => x.title === d);
      if (!c) { c = { title: d, file, specs: [], suites: [] }; s.suites.push(c); }
      s = c;
    }
    return s;
  };
  for (const d of [...done, ...extra]) {
    const s = suiteOf(d.t.file, d.t.describe);
    let spec = s.specs.find((x) => x.title === d.t.title);
    if (!spec) { spec = { title: d.t.title, tags: d.t.tags.map((x) => x.replace(/^@/, '')), file: d.t.file, line: 1, tests: [] }; s.specs.push(spec); }
    const failed = d.status === 'failed';
    const genuineSkip = d.status === 'skipped' && !d.follower;
    spec.tests.push({ projectName: project, expectedStatus: 'passed', status: d.status === 'passed' ? 'expected' : d.status === 'skipped' ? 'skipped' : 'unexpected',
      annotations: genuineSkip ? [{ type: 'skip', description: 'precondition not met' }] : [],
      results: d.status === 'not-run' ? [] : [{ status: d.status, duration: d.duration || 0, retry: 0,
        ...(failed ? { error: { message: d.t.error || 'assertion failed' } } : {}),
        attachments: failed && d.shot ? [{ name: 'screenshot', contentType: 'image/png', path: d.shot }] : [] }] });
  }
  const report = { config: {}, suites: [...files.values()], errors: [], stats: { startTime: now(), duration: done.reduce((a, d) => a + d.duration, 0) } };
  fs.mkdirSync(path.dirname(env.PW_STAGE_JSON), { recursive: true });
  fs.writeFileSync(env.PW_STAGE_JSON, JSON.stringify(report, null, 2));
  const failedTests = [...new Set(done.filter((d) => d.status === 'failed').map((d) => d.t.title))];
  if (outDir) fs.writeFileSync(path.join(outDir, '.last-run.json'), JSON.stringify({ status: failedTests.length ? 'failed' : 'passed', failedTests }));
}

const CONCURRENT = new Set(['interference', 'false-pass', 'mass-fail', 'rate-limit', 'rate-limit-once', 'refused-ok']);

async function main() {
  if (scenario === 'no-tests' || !matched.length) { console.error('Error: No tests found'); process.exit(1); }
  if (scenario === 'secret') { console.log('login password=hunter2'); console.log('Authorization: Bearer abc123'); }
  if (scenario === 'malformed') {
    // a torn heartbeat line, then a step that would read as frozen if the line were readable
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.appendFileSync(progressFile, '{"at":"' + now() + '","worker":0,"tc":"TC-X","event":"sta\n');
    await runTest(matched[0], 0, { deadline: 50, ms: 900 });
    for (let i = 1; i < matched.length; i++) await runTest(matched[i], i);
    writeJson();
    process.exit(done.some((d) => d.status === 'failed') ? 1 : 0);
  }
  if (CONCURRENT.has(scenario) && workers > 1) {
    // side by side: batches of `workers` tests whose heartbeat intervals overlap
    for (let i = 0; i < matched.length; i += workers) await Promise.all(matched.slice(i, i + workers).map((t, k) => runTest(t, i + k, { worker: k, ms: 60 })));
    writeJson();
    console.log('  ' + done.length + ' passed or ran');
    process.exit(done.some((d) => d.status === 'failed') ? 1 : 0);
  }
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < matched.length; i++) {
      const t = matched[i];
      if (scenario === 'freeze' && i === 1) {
        const worker = i % workers;
        const tc = tcIds(t.title).join(',');
        hb({ worker, tc, event: 'test-start', retry: 0, project });
        hb({ worker, tc, step: 'save the order', event: 'start', deadline_ms: 300, note: 'the success toast is visible' });
        const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        fs.writeFileSync(path.join(artifacts, 'fake-grandchild.pid'), String(gc.pid));
        setInterval(() => {}, 1000);
        return;
      }
      if (scenario === 'hang-between' && i === 1) { setInterval(() => {}, 1000); return; }
      if (scenario === 'dll-crash' && i === 1) {
        console.error('Error: worker process exited unexpectedly (code=3221225794, signal=null)');
        writeJson(matched.slice(1).map((x) => ({ t: x, status: 'interrupted', duration: 0 })));
        process.exit(1);
      }
      await runTest(t, i, { repeat: r, ...(scenario === 'quiet-long' && i === 0 ? { deadline: 3000, ms: 900 } : {}) });
    }
  }
  if (scenario !== 'no-json') writeJson();
  if (scenario === 'stale-json') { const past = new Date(Date.now() - 3600_000); fs.utimesSync(env.PW_STAGE_JSON, past, past); }
  console.log('  ' + done.length + ' passed or ran');
  process.exit(done.some((d) => d.status === 'failed') ? 1 : 0);
}

main();
