#!/usr/bin/env node
// scratch.mjs — runs ONE temporary investigation spec with the consumer project's OWN Playwright, shared config,
// page objects and env layer, so a heal or a selector question can be answered live without a stage. Node >= 18,
// zero dependencies. Contract: references/scratch-investigation.md (<scratch_investigation>).
//
// An investigation is NOT a run: it never produces a TC result, evidence, coverage, a burn-in, an isolation check
// or a freshness proof — only run-stage.mjs does. Everything it touches lives in
// {automation_root}/test-results/qa-scratch/ (git-ignored; skipped by validate-automation.mjs, impact.mjs and
// config-inventory.mjs, outside the shared config's testDir):
//   <name>.spec.ts      the probe the model wrote
//   scratch.config.ts   a generated overlay over the shared config (1 worker, no retries, list + json reporter,
//                       trace + screenshot on, no globalSetup / globalTeardown, one browser project) — rewritten
//                       on every run; deliberately not named playwright*.config.*
//   out/                Playwright's output (traces, screenshots); report.json the json reporter
// The run-stage variables (PW_STAGE_JSON, PW_PROGRESS_FILE, PW_PHASE, PW_STAGE_ATTEMPT, PW_RATE_LIMIT_*) are
// removed, so the project's heartbeat / progress / rate-limit helpers stay silent.
//
// Refused (no browser starts): a spec outside the scratch folder; a spec that captures official evidence, takes its
// own screenshot, uses storageState, writes files, reads process.env, prints a credential property or names a TC; a
// stage that looks in flight (--results-root: a progress file written in the last 120 s).
// After the run: every output line passes run-stage.mjs's credential filter plus exact redaction of credential-named
// environment values; any file written outside test-results/ under --root / --results-root = outcome `violation`.
//
// Usage:
//   node scratch.mjs run   --root <automation root> --spec <root>/test-results/qa-scratch/<name>.spec.ts
//        [--config <shared playwright config>] [--project <browser project>] [--grep <text>]
//        [--timeout 120000 (max 600000)] [--headless] [--results-root <dir>] [--cli <playwright cli.js>] [--pretty]
//   node scratch.mjs clean --root <automation root> [--pretty]
// Exit code always 0 — the outcome is in the payload: observed · error · timeout · refused · violation (run);
// removed · absent (clean).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, posix, isFile, isDir, read, stripSource } from './scan-lib.mjs';
import { filterLine, killTree } from './run-stage.mjs';

export const SCHEMA = 'skill5-scratch/1';
export const SCRATCH_REL = 'test-results/qa-scratch';
export const OVERLAY = 'scratch.config.ts';
export const NOTICE = 'Investigation only — never a TC result, evidence, coverage, burn-in, isolation check or freshness proof; the official result of a TC comes only from run-stage.mjs.';
const DEFAULT_TIMEOUT = 120000, MAX_TIMEOUT = 600000, KILL_MARGIN = 15000, BUSY_WINDOW = 120000, KEEP_LINES = 80;
const RUN_ENV = /^(PW_STAGE_JSON|PW_PROGRESS_FILE|PW_PHASE|PW_STAGE_ATTEMPT|PW_RATE_LIMIT_FILE|PW_RATE_LIMIT_STATE|PW_RATE_LIMITS|PW_GLOBAL_TIMEOUT|PW_WORKERS|PW_OUTPUT_DIR|PW_HEADLESS|PW_SCRATCH_JSON)$/;
const SECRET_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|CONNECTION_?STRING)/i;
const CONFIGS = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs'];
const SKIP_WALK = new Set(['node_modules', '.git', 'test-results']);

// What a probe may not contain — checked with comments removed (string literals kept: titles and imports count).
export const FORBIDDEN = [
  { id: 'official-evidence', re: /\bcaptureEvidence\b/, why: 'official evidence is captured only inside a run-stage.mjs run' },
  { id: 'own-screenshot', re: /\.screenshot\s*\(/, why: 'the overlay captures screenshots into out/; an explicit screenshot can write anywhere' },
  { id: 'storage-state', re: /\bstorageState\b/, why: 'no saved login state — log in through the login page object (code-craft §15)' },
  { id: 'file-write', re: /from\s+['"](node:)?fs(\/promises)?['"]|require\(\s*['"](node:)?fs|\b(writeFile|appendFile|createWriteStream|mkdir)(Sync)?\s*\(/, why: 'a probe writes no file' },
  { id: 'env-read', re: /\bprocess\.env\b/, why: 'URLs and credentials come only through the project env / test-data layer' },
  { id: 'credential-print', re: /console\.\w+\s*\([^;]*(\.(password|passwd|secret|token|apiKey|api_key)\b(?!\s*[.(\w])|\baccount\s*\()/i, why: 'a credential is never printed' },
  { id: 'tc-id', re: /\bTC-[A-Za-z0-9]/, why: 'a probe names no TC, so it can never be read as a TC result' },
];

export function scanSpec(src) {
  const { comments } = stripSource(src);
  const buf = src.split('');
  for (const c of comments) for (let k = c.start; k < c.end; k++) if (buf[k] !== '\n') buf[k] = ' ';
  const code = buf.join('');
  return FORBIDDEN.filter((f) => f.re.test(code)).map((f) => ({ reason: f.id, detail: f.why }));
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function buildOverlay({ baseConfigRel, specName, project = '', timeoutMs }) {
  return `// GENERATED by link-qc-5 scripts/scratch.mjs — an investigation overlay, never a test run.
// Rewritten on every scratch run and removed by \`scratch.mjs clean\`. Not a configuration of the project.
import base from '${baseConfigRel}';

const cfg: any = (base as any)?.default ?? base;
const wanted = ${JSON.stringify(project)};
const probe = { trace: 'on', screenshot: 'on', video: 'off' };
const projects = (cfg.projects ?? [])
  .filter((p: any) => (wanted ? p.name === wanted : !/setup|teardown/i.test(p.name ?? '')))
  .slice(0, 1)
  .map(({ dependencies, teardown, testDir, testMatch, testIgnore, ...p }: any) => ({ ...p, use: { ...(p.use ?? {}), ...probe } }));

export default {
  ...cfg,
  testDir: '.',
  testMatch: /${reEscape(specName)}$/,
  testIgnore: [],
  outputDir: './out',
  reporter: [['list'], ['json', { outputFile: process.env.PW_SCRATCH_JSON }]],
  workers: 1,
  retries: 0,
  repeatEach: 1,
  fullyParallel: false,
  globalTimeout: ${Number(timeoutMs)},
  globalSetup: undefined,
  globalTeardown: undefined,
  use: { ...(cfg.use ?? {}), ...probe },
  projects: projects.length ? projects : undefined,
};
`;
}

export function findCli(root, explicit) {
  if (typeof explicit === 'string') { const p = path.resolve(root, explicit); return isFile(p) ? p : null; }
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    for (const c of [['@playwright', 'test', 'cli.js'], ['playwright', 'cli.js']]) { const p = path.join(dir, 'node_modules', ...c); if (isFile(p)) return p; }
    if (path.dirname(dir) === dir) return null;
  }
}

const inside = (dir, p) => { const r = path.relative(dir, p); return Boolean(r) && !r.startsWith('..') && !path.isAbsolute(r); };

// path → mtime of every file under the watched folders (node_modules, .git and test-results skipped)
function snapshot(dirs, acc = new Map(), cap = 50000) {
  const walk = (dir) => {
    if (!isDir(dir) || acc.size >= cap) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_WALK.has(e.name)) walk(full); }
      else if (e.isFile()) { try { acc.set(full, fs.statSync(full).mtimeMs); } catch { /* vanished */ } }
    }
  };
  for (const d of dirs) walk(d);
  return acc;
}

function stageInFlight(resultsRoot, now) {
  const dir = path.join(resultsRoot, 'artifacts', 'progress');
  if (!isDir(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    try { const age = now - fs.statSync(path.join(dir, f)).mtimeMs; if (age < BUSY_WINDOW) return posix(f); } catch { /* vanished */ }
  }
  return null;
}

function collectTests(report, scratchDir) {
  const tests = [], artifacts = new Set();
  const visit = (suite, trail) => {
    const here = suite.title && !/\.(spec|test)\.[cm]?[jt]s$/.test(suite.title) ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) for (const t of spec.tests || []) {
      const last = (t.results || [])[t.results.length - 1] || {};
      const error = (last.error?.message || last.errors?.[0]?.message || '').split(/\r?\n/).find((l) => l.trim()) || null;
      for (const a of last.attachments || []) if (a.path && inside(scratchDir, path.resolve(a.path))) artifacts.add(posix(path.relative(scratchDir, path.resolve(a.path))));
      tests.push({ title: [...here, spec.title].join(' › '), project: t.projectName || null, status: last.status || t.status || 'unknown', durationMs: last.duration ?? null, error });
    }
    for (const s of suite.suites || []) visit(s, here);
  };
  for (const s of report.suites || []) visit(s, []);
  return { tests, artifacts: [...artifacts] };
}

export async function runScratch(a) {
  const root = typeof a.root === 'string' ? path.resolve(a.root) : null;
  const base = { tool: 'scratch', schema: SCHEMA, kind: 'investigation', officialResult: false, notice: NOTICE };
  const refuse = (refused, extra = {}) => ({ ...base, outcome: 'refused', refused, ...extra });
  if (!root || !isDir(root)) return refuse([{ reason: 'no-root', detail: '--root <automation root> is required and must exist' }]);
  const scratchDir = path.join(root, ...SCRATCH_REL.split('/'));
  const spec = typeof a.spec === 'string' ? path.resolve(a.spec) : null;
  if (!spec || !isFile(spec)) return refuse([{ reason: 'no-spec', detail: `--spec must name an existing file under ${SCRATCH_REL}/` }], { scratchDir: posix(scratchDir) });
  if (!inside(scratchDir, spec) || path.dirname(spec) !== scratchDir || !/\.(spec|test)\.[cm]?[jt]s$/.test(spec)) {
    return refuse([{ reason: 'outside-scratch', detail: `the probe must be a *.spec.ts directly in ${SCRATCH_REL}/ — never in tests/ or anywhere the project, the validator or impact.mjs reads` }], { spec: posix(spec) });
  }
  const timeoutMs = Math.min(Math.max(Number(a.timeout) || DEFAULT_TIMEOUT, 1000), MAX_TIMEOUT);
  const killMargin = Math.max(Number(a['kill-margin']) || KILL_MARGIN, 200); // --kill-margin: the harness only
  const config = typeof a.config === 'string' ? path.resolve(root, a.config) : CONFIGS.map((c) => path.join(root, c)).find(isFile);
  const cli = findCli(root, a.cli);
  const refused = scanSpec(read(spec) || '');
  if (!config || !isFile(config)) refused.push({ reason: 'no-config', detail: 'no shared playwright.config.* in --root — pass --config <the shared config>' });
  if (!cli) refused.push({ reason: 'no-playwright', detail: 'the project\'s @playwright/test was not found from --root upwards — pass --cli' });
  const resultsRoot = typeof a['results-root'] === 'string' ? path.resolve(a['results-root']) : null;
  const busy = resultsRoot ? stageInFlight(resultsRoot, Date.now()) : null;
  if (busy) refused.push({ reason: 'stage-in-flight', detail: `artifacts/progress/${busy} was written in the last ${BUSY_WINDOW / 1000} s — wait for the run-stage call to finish` });
  if (refused.length) return refuse(refused, { spec: posix(path.relative(root, spec)) });

  const specName = path.basename(spec);
  const overlay = path.join(scratchDir, OVERLAY);
  const reportFile = path.join(scratchDir, 'report.json');
  let baseRel = posix(path.relative(scratchDir, config)).replace(/\.[cm]?[jt]s$/, '');
  if (!baseRel.startsWith('.')) baseRel = './' + baseRel;
  fs.writeFileSync(overlay, buildOverlay({ baseConfigRel: baseRel, specName, project: typeof a.project === 'string' ? a.project : '', timeoutMs }));
  try { fs.rmSync(reportFile, { force: true }); } catch { /* none */ }

  const secrets = Object.entries(process.env).filter(([k, v]) => SECRET_NAME.test(k) && v && v.length >= 4).map(([, v]) => v);
  const clean = (line) => { let l = line; for (const s of secrets) l = l.split(s).join('[redacted]'); return filterLine(l); };
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !RUN_ENV.test(k)));
  Object.assign(env, { PW_OUTPUT_DIR: path.join(scratchDir, 'out'), PW_SCRATCH_JSON: reportFile, PW_GLOBAL_TIMEOUT: String(timeoutMs), PW_WORKERS: '1' });
  if (a.headless) env.PW_HEADLESS = '1';
  const pwArgs = ['test', specName, '--config', overlay];
  if (typeof a.grep === 'string') pwArgs.push('--grep', a.grep);

  const watched = [...new Set([root, ...(resultsRoot ? [resultsRoot] : [])])];
  const before = snapshot(watched);
  const started = Date.now();
  const output = [];
  let killed = false, spawnError = null, exitCode = null;
  await new Promise((resolve) => {
    let child;
    try { child = spawn(process.execPath, [cli, ...pwArgs], { cwd: root, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { spawnError = e.message; resolve(); return; }
    const timer = setTimeout(() => { killed = true; killTree(child); }, timeoutMs + killMargin);
    let pending = '';
    const take = (chunk) => {
      const parts = (pending + chunk.toString()).split(/\r?\n/);
      pending = parts.pop();
      for (const l of parts) if (l.trim()) { output.push(clean(l)); if (output.length > KEEP_LINES) output.shift(); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => { spawnError = e.message; });
    child.on('close', (code) => { clearTimeout(timer); if (pending.trim()) output.push(clean(pending)); exitCode = code; resolve(); });
  });

  let tests = [], artifacts = [];
  const report = read(reportFile);
  if (report) { try { ({ tests, artifacts } = collectTests(JSON.parse(report), scratchDir)); } catch { /* reported below */ } }
  for (const t of tests) if (t.error) t.error = clean(t.error);
  const writesOutside = [...snapshot(watched)].filter(([f, m]) => before.get(f) !== m).map(([f]) => posix(path.relative(root, f)));
  const outcome = writesOutside.length ? 'violation' : killed ? 'timeout' : spawnError || !report ? 'error' : 'observed';
  return {
    ...base, outcome, spec: posix(path.relative(root, spec)), config: posix(path.relative(root, config)),
    project: typeof a.project === 'string' ? a.project : null, durationMs: Date.now() - started, exitCode,
    tests, artifacts: artifacts.map((p) => posix(path.join(SCRATCH_REL, p))), writesOutside,
    error: spawnError || (killed ? `killed after ${timeoutMs + killMargin} ms` : !report ? 'no json report — read output[]' : null),
    output,
  };
}

export function cleanScratch(a) {
  const root = typeof a.root === 'string' ? path.resolve(a.root) : null;
  const base = { tool: 'scratch', schema: SCHEMA, kind: 'investigation' };
  if (!root || !isDir(root)) return { ...base, outcome: 'refused', refused: [{ reason: 'no-root', detail: '--root <automation root> is required and must exist' }] };
  const dir = path.join(root, ...SCRATCH_REL.split('/'));
  if (!isDir(dir)) return { ...base, outcome: 'absent', scratchDir: SCRATCH_REL };
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...base, outcome: isDir(dir) ? 'error' : 'removed', scratchDir: SCRATCH_REL };
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const payload = cmd === 'run' ? await runScratch(args) : cmd === 'clean' ? cleanScratch(args)
    : { tool: 'scratch', schema: SCHEMA, outcome: 'refused', refused: [{ reason: 'usage', detail: 'scratch.mjs run --root <dir> --spec <file> [...] | scratch.mjs clean --root <dir>' }] };
  print(payload, args);
}
