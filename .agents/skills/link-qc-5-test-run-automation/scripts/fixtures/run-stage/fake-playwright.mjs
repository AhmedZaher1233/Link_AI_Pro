#!/usr/bin/env node
// fake-playwright.mjs — stands in for `playwright test`, used ONLY by selftest-run-stage.mjs.
// It filters suite.json with the REAL --grep / --grep-invert regexes run-stage.mjs builds (title path +
// tags, as Playwright matches them) and writes what the real project writes: the heartbeat
// (helpers/steps.ts + helpers/progress-reporter.ts shapes), the incremental results, the JSON
// reporter's file and line-reporter output. FAKE_PW_SCENARIO = {"<group slug>": "<scenario>"} makes
// one group misbehave on purpose: freeze · quiet-long · malformed · hang-between · no-json ·
// stale-json · no-tests · secret · dll-crash (default: pass). Every call records its argv and the PW_*
// variables it received under {artifacts}/fake-argv/ so the harness can check the command shape.
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
const grep = flags.grep ? new RegExp(flags.grep, 'i') : null;
const invert = flags['grep-invert'] ? new RegExp(flags['grep-invert'], 'i') : null;
const slug = ((flags.grep || '').match(/@run:([A-Za-z0-9-]+)/) || [])[1] || 'none';
const scenarios = JSON.parse(env.FAKE_PW_SCENARIO || '{}');
const scenario = scenarios[slug] || scenarios['*'] || 'pass';
const artifacts = path.dirname(env.PW_OUTPUT_DIR || path.join(here, 'artifacts', 'test-output'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

fs.mkdirSync(path.join(artifacts, 'fake-argv'), { recursive: true });
const pw = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith('PW_')));
fs.writeFileSync(path.join(artifacts, 'fake-argv', slug + '-' + (env.PW_STAGE_ATTEMPT || '1') + '.json'), JSON.stringify({ argv, specs, flags, env: pw, scenario }, null, 2));

const suite = JSON.parse(fs.readFileSync(path.join(here, 'suite.json'), 'utf8')).tests;
const matched = suite.filter((t) => {
  const s = [t.file, ...(t.describe || []), t.title].join(' ') + ' ' + t.tags.join(' ');
  return (!grep || grep.test(s)) && !(invert && invert.test(s)) && (!specs.length || specs.includes(t.file));
});
const progressFile = env.PW_PROGRESS_FILE;
const resultsFile = progressFile ? progressFile.replace(/\.jsonl$/, '') + '.results.jsonl' : null;
const hb = (rec) => { if (progressFile) { fs.mkdirSync(path.dirname(progressFile), { recursive: true }); fs.appendFileSync(progressFile, JSON.stringify({ at: now(), ...rec }) + '\n'); } };
const res = (rec) => { if (resultsFile) fs.appendFileSync(resultsFile, JSON.stringify({ at: now(), ...rec }) + '\n'); };
const tcIds = (title) => [...title.matchAll(/\[([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter((s) => /^TC-/.test(s));
const done = [];

async function runTest(t, n, opts = {}) {
  const worker = n % workers;
  const tcs = tcIds(t.title);
  const tc = tcs.join(',') || t.title;
  const started = Date.now();
  hb({ worker, tc, event: 'test-start', retry: 0, project });
  hb({ worker, tc, step: 'perform the steps', event: 'start', deadline_ms: opts.deadline || 30000, note: 'the expected result is shown' });
  await sleep(opts.ms || 25);
  hb({ worker, tc, step: 'perform the steps', event: 'end', outcome: t.outcome === 'failed' ? 'error' : 'ok', elapsed_ms: Date.now() - started });
  const duration = Date.now() - started;
  res({ worker, tc: tcs.length ? tcs : [t.title], title: t.title, status: t.outcome, duration_ms: duration, retry: 0, project });
  hb({ worker, tc, event: 'test-end', status: t.outcome });
  const sym = { passed: '✓', failed: '✘', skipped: '-' }[t.outcome] || '?';
  console.log('  ' + sym + '  ' + (n + 1) + ' [' + project + '] › ' + t.file + ' › ' + t.title + ' (' + duration + 'ms)');
  done.push({ t, status: t.outcome, duration });
}

function writeJson(extra = []) {
  if (!env.PW_STAGE_JSON) return;
  const byFile = new Map();
  for (const d of [...done, ...extra]) {
    if (!byFile.has(d.t.file)) byFile.set(d.t.file, []);
    const failed = d.status === 'failed';
    byFile.get(d.t.file).push({
      title: d.t.title, tags: d.t.tags.map((x) => x.replace(/^@/, '')), file: d.t.file, line: 1,
      tests: [{ projectName: project, expectedStatus: 'passed', status: d.status === 'passed' ? 'expected' : d.status === 'skipped' ? 'skipped' : 'unexpected',
        results: d.status === 'not-run' ? [] : [{ status: d.status, duration: d.duration || 0, retry: 0,
          ...(failed ? { error: { message: d.t.error || 'assertion failed' } } : {}),
          attachments: failed ? [{ name: 'screenshot', contentType: 'image/png', path: path.join(env.PW_OUTPUT_DIR || artifacts, 'test-failed-1.png') }] : [] }] }],
    });
  }
  const report = { config: {}, suites: [...byFile].map(([file, specsOf]) => ({ title: file, file, specs: specsOf, suites: [] })), errors: [],
    stats: { startTime: now(), duration: done.reduce((a, d) => a + d.duration, 0) } };
  fs.mkdirSync(path.dirname(env.PW_STAGE_JSON), { recursive: true });
  fs.writeFileSync(env.PW_STAGE_JSON, JSON.stringify(report, null, 2));
}

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
    await runTest(t, i, scenario === 'quiet-long' && i === 0 ? { deadline: 3000, ms: 900 } : {});
  }
  if (scenario !== 'no-json') writeJson();
  if (scenario === 'stale-json') { const past = new Date(Date.now() - 3600_000); fs.utimesSync(env.PW_STAGE_JSON, past, past); }
  console.log('  ' + done.length + ' passed or ran');
  process.exit(done.some((d) => d.status === 'failed') ? 1 : 0);
}

main();
