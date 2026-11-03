#!/usr/bin/env node
// lite.mjs — skill 5c (link-qc-5c-test-run-automation-lite): the ONE script of the lightweight automation workflow.
// Node >= 18, ESM, zero dependencies. It COMPOSES the engine's scripts — a vendored copy of the link-qc-5 3.2.0 runtime
// inside this skill, so Lite runs with no other skill installed:
//   FULL = ../engine/scripts   (override: QA_LITE_FULL_DIR = another engine / Full skill folder)
// and prints a COMPACT one-line JSON verdict; the full payload goes to {results_root}/artifacts/lite/ (--json prints it).
//
//   init-run      [--tc <TEST-CASES md | folder>] [--data] [--root] [--automation-root] [--environment <name>] [--env-url] [--env-class test|staging]
//                 [--report md|html] [--screenshots failed|all|none] [--max-workers N] [--project <config project>] [--tcs a,b]
//                 [--phase N] [--allow-data-changes all|TC,…|none] [--force]
//   consent       --run-file <f> --allow-data-changes all|TC,…|none [--env-class test|staging]
//   preflight     --run-file <.runs/phase-N.json> [--probe-url] [--env-id] [--cli] [--headless]
//   cache         --results-root <dir> --files a,b [--mark]
//   checkpoint-a  --results-root <dir> --phase N --files a,b [--root] [--tc] [--data] [--req a,b] [--coverage <judgements.json>]
//                 [--specs a,b] [--assertion-review <json>] [--tsc <fake tsc>] [--cli <playwright cli.js>]
//   stage         --run-file <f> --stage smoke|positive|negative [--run first|rerun] [--tcs a,b] [--spec a,b] [--max-workers N]
//                 [--burn-in a,b] [--headless] [--cli] [--env-id] [--replan]
//   teardown      --run-file <f> --spec <teardown spec> [--headless] [--cli]   (the run-level restore / reset, ONCE per run)
//   rerun-select  --run-file <f> [--spec a,b]
//   finalize      --results-root <dir> --phase N --files a,b [--root] [--feature] [--judgements <json>] [--tc] [--data] [--req a,b]
//
// Checkpoint A = FOUR checks (lite:tsc · lite:pom · lite:traceability · lite:assertions); Checkpoint B = THREE
// (lite:results-integrity · lite:tc-status-coverage · lite:failure-evidence). Both write the Full gate-record shape
// (skill5-gate/1, profile "lite") that publish / acceptance / the renderer read. PASS is recorded by the script — no
// review cycle. Exit codes: PASS / PUBLISHED / COMPLETED 0 · FAIL / STOPPED 1 · BLOCKED / REFUSED 2 · NOT_RUN 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LITE_SCHEMA = 'skill5c-lite/1';
export const LITE_VERSION = '1.5.1';
export const PROFILE = 'lite';
const here = path.dirname(fileURLToPath(import.meta.url));
export const FULL_DIR = process.env.QA_LITE_FULL_DIR ? path.resolve(process.env.QA_LITE_FULL_DIR) : path.resolve(here, '..', 'engine');
export const FULL = path.join(FULL_DIR, 'scripts');
const EXIT = { PASS: 0, PUBLISHED: 0, COMPLETED: 0, READY: 0, OK: 0, FAIL: 1, STOPPED: 1, BLOCKED: 2, REFUSED: 2, NOT_RUN: 3 };
const SMOKE_LIMIT = 30;
export const MAX_WORKERS = 5;
export const MIN_PARALLEL_WORKERS = 2;
/** The Lite worker policy: never above 5 (or a lower --max-workers); at least 2 when the readiness check proved ≥ 2 independent
 *  units (TCs that share no test data / state with each other); otherwise 1. run-stage's own Auto ceiling can only lower the result. */
export function pickWorkers({ cap, candidateConcurrency }) {
  const c = Math.min(MAX_WORKERS, Math.max(1, Math.floor(Number(cap)) || MAX_WORKERS));
  const k = Math.floor(Number(candidateConcurrency)) || 1;
  return k >= MIN_PARALLEL_WORKERS && c >= MIN_PARALLEL_WORKERS ? Math.min(c, Math.max(MIN_PARALLEL_WORKERS, k)) : 1;
}
const LITE_CHECKS_A = ['lite:tsc', 'lite:pom', 'lite:traceability', 'lite:assertions'];
const LITE_CHECKS_B = ['lite:results-integrity', 'lite:tc-status-coverage', 'lite:failure-evidence'];
// validator rules / Full check ids that feed each Lite check (the status logic stays Full's: RULE_TO_CHECK)
const POM_IDS = ['1', '2', '4', '5'];
const TRACE_IDS = ['29', '30'];
const ASSERT_IDS = ['8', '9'];
const SAFETY_IDS = ['20', '21', '24', '38', '42', '43'];
const B_INTEGRITY = ['16b', '18', '25b', '38', '48a', '48b', '53', '54'];
const B_COVERAGE = ['22', '23', '32', '33'];
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;

/* ---------------- small helpers ---------------- */

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { const t = fs.readFileSync(p, 'utf8'); return JSON.parse(t.charCodeAt(0) === 0xfeff ? t.slice(1) : t); } catch { return null; } };
const posix = (p) => String(p).replace(/\\/g, '/');
const uniq = (xs) => [...new Set(xs)];
const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileSha = (p) => { try { return sha(fs.readFileSync(p)); } catch { return null; } };
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const readdirSafe = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
function writeBytesAtomic(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}
const writeJsonAtomic = (file, obj) => writeBytesAtomic(file, Buffer.from(JSON.stringify(obj, null, 2) + '\n'));
const rel = (base, p) => posix(path.relative(base, p)) || '.';
const withheld = (s) => String(s || '').split(/\r?\n/).map((l) => (SECRET_LINE.test(l) ? '[withheld: looks like a credential]' : l)).join(' ');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const next = argv[i + 1]; if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true; }
    else out._.push(a);
  }
  return out;
}

export const fullMissing = () => (isFile(path.join(FULL, 'check.mjs')) && isFile(path.join(FULL, 'run-data.mjs')) ? null : 'the Lite engine is missing at ' + posix(FULL_DIR) + ' (engine/scripts/check.mjs, run-data.mjs) — reinstall link-qc-5c-test-run-automation-lite with its engine/ folder');
const load = (name) => import(pathToFileURL(path.join(FULL, name)).href);

/** Run a Full script CLI and parse its one JSON line. */
function spawnJson(script, argv, { cwd = process.cwd(), env = process.env, timeoutMs = 3600000 } = {}) {
  const r = spawnSync(process.execPath, [path.join(FULL, script), ...argv], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: timeoutMs, windowsHide: true });
  const text = String(r.stdout || '').trim();
  let json = null;
  try { json = JSON.parse(text.split(/\r?\n/).filter(Boolean).pop() || 'null'); } catch { json = null; }
  return { json, code: r.status, stderr: String(r.stderr || '').slice(0, 2000), error: r.error ? r.error.message : null };
}

/** Print the compact verdict, keep the full payload in artifacts/lite/; return the exit code. */
function finish(args, cmd, compact, full = null, rr = null) {
  const out = { tool: 'lite', schema: LITE_SCHEMA, cmd, ...compact };
  let file = null;
  if (full && rr && !args['no-artifact']) {
    try { file = path.join(rr, 'artifacts', 'lite', cmd + '-' + stamp() + '.json'); writeJsonAtomic(file, { ...out, ...full }); out.full = posix(path.relative(process.cwd(), file)); } catch { file = null; }
  }
  process.stdout.write(JSON.stringify(args.json && full ? { ...out, ...full } : out, null, args.pretty ? 2 : 0) + '\n');
  return EXIT[out.outcome] ?? 2;
}
const blocked = (args, cmd, reason, extra = {}) => finish(args, cmd, { outcome: 'BLOCKED', reason, ...extra });

/* ---------------- project facts ---------------- */

/** The automation root (relative to root): --automation-root → the one a results root sits in (…/reports/…) → the engine's
 *  resolver (manifest → constitution → the project's Playwright config → defaults). */
export async function automationRootOf(root, given, rr = null) {
  if (typeof given === 'string' && given) return given;
  if (rr) {
    const p = posix(path.relative(root, path.resolve(root, rr)));
    const i = ('/' + p).toLowerCase().lastIndexOf('/reports/');
    if (i >= 0 && !p.startsWith('..')) return p.slice(0, Math.max(0, i - 1)) || '.';
  }
  return (await load('project-env.mjs')).automationRootOf(root);
}

/** What the project documents about itself — every file optional, none ever written: the QA manifest, the learning file,
 *  the Spec Kit constitution (read-only), and where the automation root came from. */
export async function projectFacts(root) {
  const env = await load('project-env.mjs');
  const manifest = env.readManifest(root);
  const learnRel = (manifest && manifest.paths && typeof manifest.paths.learningFile === 'string' && manifest.paths.learningFile) || 'Testing/project-learning.md';
  const auto = env.discoverAutomationRoot(root, manifest);
  return {
    manifest: manifest ? 'Testing/qa-manifest.json' : null,
    learning: isFile(path.join(root, learnRel)) ? learnRel : null,
    constitution: isFile(path.join(root, env.CONSTITUTION)) ? env.CONSTITUTION : null,
    automationRoot: auto.path, automationRootSource: auto.source,
  };
}

const DOC_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', '.claude', '.agents', '.codex', '.cursor', '.windsurf', '.specify']);
/** TEST-CASES-*.md documents under a folder (depth-limited; dependency, generated and agent folders never searched; reports skipped). */
function findTcDocs(dir, depth = 6, out = []) {
  if (depth < 0) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!DOC_SKIP.has(e.name) && e.name !== 'reports') findTcDocs(full, depth - 1, out); }
    else if (/^TEST-CASES-.+\.md$/i.test(e.name)) out.push(full);
  }
  return out.sort();
}
/** The spec a TC document belongs to: spec.md beside it or in an ancestor folder (Spec Kit: specs/{feature}/spec.md). */
function specFor(root, tcPath) {
  for (let d = path.dirname(tcPath), i = 0; i < 4 && posix(path.relative(root, d)).indexOf('..') !== 0; i++) {
    if (isFile(path.join(d, 'spec.md'))) return path.join(d, 'spec.md');
    if (path.resolve(d) === path.resolve(root)) break;
    d = path.dirname(d);
  }
  return null;
}
const draftDir = (rr, n) => path.join(rr, 'artifacts', 'drafts', 'phase-' + n);
const liteDir = (rr) => path.join(rr, 'artifacts', 'lite');

/** Spec file paths (relative to root) from a file list. */
const isSpec = (f) => /\.spec\.[cm]?[jt]sx?$/.test(f);
/** A spec or a setup / teardown journey file (`*.setup.ts`, `*.teardown.ts`). */
const isTestFile = (f) => isSpec(f) || /\.(setup|teardown)\.[cm]?[jt]sx?$/.test(f);
/** Resolved tests → { TC: [files] } (journeys contribute nothing). */
function mappingOf(resolved, declared = []) {
  const map = {};
  for (const t of resolved) {
    if (declared.some((j) => j.file === t.file && j.line === t.line)) continue;
    for (const id of tcIdsOf(t.title)) { (map[id] = map[id] || []); if (!map[id].includes(t.file)) map[id].push(t.file); }
  }
  return map;
}

/* ---------------- init-run ---------------- */

/** The TC document location → { leaf: "SPEC-x/US-1-name" | "US-1-name", feature } (existing folder conventions). */
export function leafOf(tcDoc) {
  const p = posix(tcDoc);
  const m = p.match(/\/TestCases\/(.+)\/([^/]+)$/i);
  const folder = m ? m[1] : posix(path.dirname(p)).split('/').slice(-1)[0];
  const file = path.basename(p);
  const fm = file.match(/^TEST-CASES-(.+)\.md$/i);
  return { leaf: folder, feature: fm ? fm[1] : file.replace(/\.md$/i, '') };
}

export async function initRun(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'init-run', miss);
  const root = path.resolve(args.root || process.cwd());
  // --tc: the document, a folder holding exactly one TEST-CASES-*.md, or absent (the project's one TEST-CASES-*.md)
  let tcPath = typeof args.tc === 'string' ? path.resolve(root, args.tc) : null;
  if (!tcPath || isDir(tcPath)) {
    const found = findTcDocs(tcPath || root);
    if (found.length !== 1) return blocked(args, 'init-run', (found.length ? found.length + ' TEST-CASES-*.md documents found' : 'no TEST-CASES-*.md document found') + ' under ' + (rel(root, tcPath || root) || '.') + ' — name one with --tc', { candidates: found.slice(0, 10).map((f) => rel(root, f)) });
    tcPath = found[0];
  }
  const text = read(tcPath);
  if (text === null) return blocked(args, 'init-run', 'TC document not found: ' + args.tc);
  const facts = await projectFacts(root);
  const dataGuess = path.join(path.dirname(tcPath), path.basename(tcPath).replace(/^TEST-CASES-/i, 'TEST-DATA-'));
  const dataPath = typeof args.data === 'string' ? path.resolve(root, args.data) : isFile(dataGuess) && dataGuess !== tcPath ? dataGuess : null;
  const specPath = specFor(root, tcPath);
  const status = (text.match(/^\*{0,2}Status:?\*{0,2}\s*:?\s*\*{0,2}\s*([A-Za-z -]+)/m) || [])[1];
  const hash = await load('tc-hash.mjs');
  const tcs = hash.parseTcDocument(text);
  if (!tcs.length) return blocked(args, 'init-run', 'no test cases (### TC-… headings) in ' + rel(root, tcPath));
  const autoRel = await automationRootOf(root, args['automation-root']);
  const autoSource = typeof args['automation-root'] === 'string' ? 'flag' : facts.automationRootSource;
  const ar = path.resolve(root, autoRel);
  const { leaf, feature } = leafOf(rel(root, tcPath));
  const specLevel = /^(SPEC-[^/]+)\//i.test(leaf) ? leaf.match(/^(SPEC-[^/]+)\//i)[1] + '/' : '';
  const storyName = leaf.split('/').pop();
  // a US-… folder names the story; a Spec Kit feature folder (001-name) is the story itself
  const storyId = (storyName.match(/^(US-[A-Za-z0-9]+)/i) || [])[1] || storyName;
  const resultsRel = 'reports/' + leaf;
  const rr = path.join(ar, resultsRel);
  const maxN = Math.max(0, ...readdirSafe(path.join(rr, '.runs')).map((f) => Number((f.match(/^phase-(\d+)\.json$/) || [])[1] || 0)), ...readdirSafe(path.join(rr, 'artifacts', 'drafts')).map((f) => Number((f.match(/^phase-(\d+)$/) || [])[1] || 0)));
  const phase = Number(args.phase) > 0 ? Number(args.phase) : args.force && maxN > 0 ? maxN : maxN + 1; // --force redoes the latest phase
  const field = (tc, name) => { const f = tc.fields[name]; return f ? String(f.value || '').trim() : ''; };
  const want = csv(args.tcs);
  const inScope = tcs.filter((tc) => (want.length ? want.includes(tc.id) : !/^no\b/i.test(field(tc, 'Automation Candidate'))));
  const stages = { smoke: [], positive: [], negative: [] };
  const layers = {};
  for (const tc of inScope) {
    const smoke = /^y/i.test(field(tc, 'Smoke'));
    const neg = /negative/i.test(field(tc, 'Stage') + ' ' + field(tc, 'Type'));
    stages[smoke ? 'smoke' : neg ? 'negative' : 'positive'].push(tc.id);
    layers[tc.id] = hash.tcLayer(tc).layer;
  }
  const maxWorkers = Math.min(MAX_WORKERS, Math.max(1, Math.floor(Number(args['max-workers'])) || MAX_WORKERS)); // default and hard maximum 5; a project / environment limit only lowers it
  const backend = Object.values(layers).some((l) => /api|db/.test(l));
  // the browser project: --project, else the shared config's first non-backend project, else chromium
  const cfgProjects = configProjects(ar);
  const browser = typeof args.project === 'string' ? args.project : (cfgProjects.find((p) => p !== 'backend') || 'chromium');
  if (cfgProjects.length && !cfgProjects.includes(browser)) return blocked(args, 'init-run', '--project ' + browser + ' is not a project of the shared config (' + cfgProjects.join(', ') + ')');
  const project = browser + (backend ? ',backend' : '');
  const runId = sha(posix(path.join(rr, '.runs', 'phase-' + phase + '.json')) + stamp()).slice(0, 16);
  const stampLog = stamp().slice(0, 16);
  const envClass = typeof args['env-class'] === 'string' ? args['env-class'] : null;
  const run = {
    schema: 'skill6-run/1', phase, status: 'planning', run_id: runId,
    user_story_id: storyId, user_story: storyName, user_story_name: storyName, feature, spec_level: specLevel || null,
    source_tc_doc: rel(root, tcPath), source_sha256: fileSha(tcPath), tc_status: status ? status.trim() : null,
    environment: { name: args.environment || 'local', url: typeof args['env-url'] === 'string' ? args['env-url'] : null, class: envClass },
    results_root: resultsRel, screenshots_root: 'screenshots/' + leaf, logs_root: 'automation-logs/' + leaf,
    delivery: { report: args.report === 'html' ? 'html' : 'md', screenshots: ['all', 'failed', 'none'].includes(args.screenshots) ? args.screenshots : 'failed', source: 'lite' },
    run_plan: { workers_parallel: maxWorkers, groups: [{ name: 'parallel', mode: 'parallel', workers: 1, tcs: inScope.map((t) => t.id) }], rate_limits: [], layers, backend_project: 'backend', projects: backend ? [browser, 'backend'] : [browser] },
    data_readiness: { verdict: 'READY', gaps: [], predicted_skips: [] },
    lite: {
      version: LITE_VERSION, project, stages, max_workers: maxWorkers, specs: [], log: 'automation-logs/' + leaf + '/run-progress-' + stampLog + '.log',
      // where every input came from — read once here, so no later step searches again; each file is optional except the TC document
      sources: { tc: rel(root, tcPath), data: dataPath ? rel(root, dataPath) : null, spec: specPath ? rel(root, specPath) : null, constitution: facts.constitution, manifest: facts.manifest, learning: facts.learning, automation_root: autoRel, automation_root_source: autoSource },
    },
  };
  // the run plan merge reads: one required variant per TC (the Full run plan's shape) — without it every TC rolls to NOT_RUN
  const rd = await load('run-data.mjs');
  run.run_plan.required_variants = Object.fromEntries(inScope.map((tc) => [tc.id, [rd.defaultProjectFor(run, tc.id) + '--none--r0']]));
  if (typeof args['allow-data-changes'] === 'string') {
    const dc = dataChangesRecord(args['allow-data-changes'], { scope: inScope.map((t) => t.id), envClass });
    if (dc.error) return blocked(args, 'init-run', dc.error);
    run.data_changes = dc.record;
  }
  const runFile = path.join(rr, '.runs', 'phase-' + phase + '.json');
  if (isFile(runFile)) {
    if (!args.force) return blocked(args, 'init-run', 'phase ' + phase + ' already has a run file — pass --force to rewrite it while no stage has run, or --phase ' + (phase + 1) + ' for a new one', { runFile: rel(process.cwd(), runFile) });
    const ran = phaseExecuted(rr, phase);
    if (ran) return blocked(args, 'init-run', 'phase ' + phase + ' already executed (' + ran + ') — a phase with results is never rewritten; pass --phase ' + (phase + 1), { runFile: rel(process.cwd(), runFile) });
    const old = readJson(runFile) || {};
    if (old.lite && Array.isArray(old.lite.specs)) run.lite.specs = old.lite.specs; // what Checkpoint A recorded stays
    if (old.lite && old.lite.checkpoint_a) run.lite.checkpoint_a = old.lite.checkpoint_a;
    if (!run.data_changes && old.data_changes) run.data_changes = old.data_changes;
  }
  writeJsonAtomic(runFile, run);
  const ok = !status || /approved/i.test(status);
  return finish(args, 'init-run', {
    outcome: 'OK', phase, runFile: rel(process.cwd(), runFile), resultsRoot: rel(process.cwd(), rr), automationRoot: rel(process.cwd(), ar) + ' (' + autoSource + ')', feature, tcs: inScope.length,
    sources: { tc: run.lite.sources.tc, data: run.lite.sources.data, spec: run.lite.sources.spec, constitution: facts.constitution, manifest: facts.manifest, learning: facts.learning },
    stages: { smoke: stages.smoke.length, positive: stages.positive.length, negative: stages.negative.length }, layers: uniq(Object.values(layers)), project,
    delivery: run.delivery, dataChanges: run.data_changes ? (run.data_changes.consent === 'yes' ? run.data_changes.tcs.length + ' TC(s)' : 'none') : 'not asked',
    document: status ? status.trim() : 'no Status line', next: ok ? 'preflight' : 'document is not APPROVED — approve / run unapproved / stop (one question)',
  }, null, null);
}

/** The project names of the shared Playwright config in the automation root (`projects: [ { name: '…' } ]`), in order. */
export function configProjects(ar) {
  const cfg = ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'].map((f) => path.join(ar, f)).find(isFile);
  const text = cfg ? String(read(cfg) || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '') : '';
  const at = text.search(/\bprojects\s*:\s*\[/);
  if (at < 0) return [];
  let i = text.indexOf('[', at); let depth = 0; let end = text.length;
  for (; i < text.length; i++) { const c = text[i]; if (c === '[') depth++; else if (c === ']' && --depth === 0) { end = i; break; } }
  return uniq([...text.slice(at, end).matchAll(/\bname\s*:\s*(['"`])([^'"`\n]+)\1/g)].map((m) => m[2]));
}

/** The run file's `data_changes` record from the tester's answer (all | TC,… | none) — the shape run-stage and check 53 read. */
export function dataChangesRecord(answer, { scope, envClass, now }) {
  const a = String(answer).trim();
  const at = now || new Date().toISOString();
  if (/^none$/i.test(a)) return { record: { consent: 'no', tcs: [], setup: false, cleanup: false, asked_at: at, source: 'lite' } };
  const tcs = /^all$/i.test(a) ? scope.slice() : csv(a);
  const unknown = tcs.filter((t) => !scope.includes(t));
  if (!tcs.length) return { error: '--allow-data-changes needs all, none or a TC list' };
  if (unknown.length) return { error: '--allow-data-changes names TC(s) outside the run scope: ' + unknown.join(', ') };
  if (!['test', 'staging'].includes(envClass)) return { error: 'data changes need an environment class test or staging (--env-class); got ' + (envClass || 'none') };
  return { record: { consent: 'yes', tcs, setup: true, cleanup: true, asked_at: at, environment_class: envClass, source: 'lite' } };
}

/** A stage (or teardown) of this phase already ran → the reason, else null. */
function phaseExecuted(rr, phase) {
  const dir = path.join(rr, 'artifacts', 'progress');
  const mine = readdirSafe(dir).filter((f) => f.endsWith('.summary.json')).filter((f) => { const s = readJson(path.join(dir, f)); return !s || s.phase === undefined || Number(s.phase) === Number(phase); });
  if (mine.length) return mine.length + ' stage summary file(s)';
  if (isDir(draftDir(rr, phase))) return 'drafts exist';
  return null;
}

export async function consent(args) {
  if (typeof args['run-file'] !== 'string' || typeof args['allow-data-changes'] !== 'string') return blocked(args, 'consent', '--run-file and --allow-data-changes all|TC,…|none are required');
  const runFile = path.resolve(args['run-file']);
  const run = readJson(runFile);
  if (!run) return blocked(args, 'consent', 'run file unreadable: ' + args['run-file']);
  const envClass = typeof args['env-class'] === 'string' ? args['env-class'] : (run.environment && run.environment.class) || null;
  const scope = uniq(((run.run_plan && run.run_plan.groups) || []).flatMap((g) => g.tcs || []));
  const dc = dataChangesRecord(args['allow-data-changes'], { scope, envClass });
  if (dc.error) return blocked(args, 'consent', dc.error);
  writeJsonAtomic(runFile, { ...run, environment: { ...(run.environment || {}), class: envClass }, data_changes: dc.record });
  return finish(args, 'consent', { outcome: 'OK', consent: dc.record.consent, tcs: dc.record.tcs.length, environmentClass: envClass, next: 'every data change goes through the ledger (helpers/data-ledger.ts) — checkpoint-a warns on a consented TC without one' }, null, null);
}

/* ---------------- preflight ---------------- */

/** A host-memory / capacity reason from run-stage (preflight or stage) — Lite never gates on these. */
export const isMemoryReason = (s) => /^(insufficient capacity|free memory admits no)|\b(MB|cores?)\b.*\b(reserve|reserved|per worker)\b/i.test(String(s).trim());
/** Merge keys into the run file's `lite` block (the run file is the run's own state). */
function setLite(runFile, patch) {
  const run = readJson(runFile);
  if (run) writeJsonAtomic(runFile, { ...run, lite: { ...(run.lite || {}), ...patch } });
}

export async function preflight(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'preflight', miss);
  if (typeof args['run-file'] !== 'string') return blocked(args, 'preflight', '--run-file is required');
  const argv = ['preflight', '--run-file', path.resolve(args['run-file'])];
  for (const k of ['probe-url', 'env-id', 'cli', 'cwd', 'root', 'workers']) if (typeof args[k] === 'string') argv.push('--' + k, args[k]);
  // Lite runs from the project root: name it, so a project without Testing/qa-manifest.json is never mistaken for the folder above its automation root
  if (typeof args.root !== 'string') argv.push('--root', process.cwd());
  if (args.headless) argv.push('--headless');
  const r = spawnJson('run-stage.mjs', argv);
  const p = r.json;
  if (!p) return blocked(args, 'preflight', 'run-stage preflight gave no result' + (r.error ? ': ' + r.error : ''), { stderr: r.stderr });
  const cfgBlock = /^config location/i.test(String(p.reason || ''));
  const ver = (await load('check.mjs')).skillVersionOf(FULL_DIR);
  // Lite has NO host-memory gate: a memory reason never blocks or waits — the run switches to serial without the ledger instead
  const parts = String(p.reason || '').split('; ').filter(Boolean);
  const memParts = parts.filter(isMemoryReason);
  const rest = parts.filter((x) => !isMemoryReason(x));
  const runPath = path.resolve(args['run-file']);
  if (memParts.length) setLite(runPath, { no_ledger: true, no_ledger_reason: 'low host memory at preflight (Lite ignores the memory gate)' });
  const outcome = p.verdict === 'blocked' && rest.length ? 'BLOCKED' : 'READY'; // only a non-memory blocker blocks
  return finish(args, 'preflight', {
    outcome, verdict: p.verdict, reason: rest.join('; ') || null, memory: memParts.length ? 'low — ignored by Lite; stages run serially without the capacity ledger (1 worker)' : 'ok', environment: p.environment ? { url: p.environment.url, status: p.environment.status } : null,
    playwright: p.playwright ? (p.playwright.version || p.playwright.cli) : null, config: p.config ? p.config.shared : null,
    workers: { machineCeiling: p.workers ? p.workers.max : null, liteCap: Math.min(MAX_WORKERS, Number((readJson(path.resolve(args['run-file'])) || {}).lite?.max_workers) || MAX_WORKERS), start: 1 }, fullVersion: ver,
    next: cfgBlock ? 'ask once, then: node ' + posix(path.relative(process.cwd(), path.join(FULL, 'config-inventory.mjs'))) + ' reconcile --root . --results-root <results_root> --apply --move-config' : outcome === 'READY' ? 'generate automation (stage 1)' : 'fix the reason, run preflight again',
  }, p, path.dirname(path.dirname(path.resolve(args['run-file']))));
}

/* ---------------- cache ---------------- */

export function cache(args) {
  if (typeof args['results-root'] !== 'string') return blocked(args, 'cache', '--results-root is required');
  const rr = path.resolve(args['results-root']);
  const root = path.resolve(args.root || process.cwd());
  const file = path.join(liteDir(rr), 'read-cache.json');
  const prev = (readJson(file) || {}).files || {};
  const files = csv(args.files);
  if (!files.length) return blocked(args, 'cache', '--files a,b is required');
  const now = {}; const changed = []; const unchanged = []; const fresh = []; const missing = [];
  for (const f of files) {
    const p = path.resolve(root, f); const h = fileSha(p); const k = posix(path.relative(root, p));
    if (h === null) { missing.push(k); continue; }
    now[k] = h;
    if (!(k in prev)) fresh.push(k); else if (prev[k] !== h) changed.push(k); else unchanged.push(k);
  }
  if (args.mark) writeJsonAtomic(file, { schema: 'skill5c-read-cache/1', at: new Date().toISOString(), files: { ...prev, ...now } });
  return finish(args, 'cache', { outcome: 'OK', read: [...fresh, ...changed], new: fresh, changed, unchanged, missing, marked: !!args.mark }, null, null);
}

/* ---------------- Checkpoint A ---------------- */

const refOf = (f) => f.file + ':' + f.line + ' ' + f.ruleId;
/** `[TC-ID]` carried by test titles → { TC: [files] }. */
export function scanMapping(root, files) {
  const map = {};
  const titleRe = /\b(?:test|it)(?:\.[a-zA-Z]+)*\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (const f of files) {
    const text = read(path.resolve(root, f));
    if (text === null) continue;
    for (const m of text.matchAll(titleRe)) for (const g of m[2].matchAll(/\[([^\]]+)\]/g)) for (const part of g[1].split(',')) {
      const id = part.trim();
      if (/^TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(id)) { (map[id] = map[id] || []); if (!map[id].includes(posix(f))) map[id].push(posix(f)); }
    }
  }
  return map;
}

/* ---------------- journeys and sign-ins (static) ----------------
 * A journey is a setup / teardown test that is never a result (L10): declared by the annotation
 * `{ type: 'journey', description: 'setup' | 'teardown' }` on the test or its describe — the file name is only a hint. */
const JOURNEY_ANN = /\btype\s*:\s*(['"`])journey\1\s*,\s*description\s*:\s*(['"`])(setup|teardown)\2/g;
const testKind = (k) => k === 'test' || /^test\.(skip|fixme|fail|slow)$/.test(k);
function blocksOf(sl, file) {
  const src = read(file);
  if (src === null) return null;
  const s = sl.stripSource(src);
  if (s.parseError) return null;
  return { src, s, blocks: sl.findBlocks(s, sl.testIdentifiers(s).ids) };
}
/** Declared journeys of the given specs → [{ file, line, kind, title }] (root-relative file, the test's head line). */
export async function journeysOf(root, files) {
  const sl = await load('scan-lib.mjs');
  const out = [];
  for (const f of files) {
    const b = blocksOf(sl, path.resolve(root, f));
    if (!b) continue;
    for (const m of b.src.matchAll(JOURNEY_ANN)) {
      const owner = b.blocks.filter((x) => x.open < m.index && m.index < x.close && (testKind(x.kind) || x.kind.startsWith('describe'))).sort((x, y) => (x.close - x.open) - (y.close - y.open))[0];
      if (!owner) continue;
      const tests = testKind(owner.kind) ? [owner] : b.blocks.filter((x) => testKind(x.kind) && x.body && owner.body && x.headStart > owner.body.start && x.headStart < owner.body.end);
      for (const t of tests) if (!out.some((j) => j.file === posix(f) && j.line === t.line)) out.push({ file: posix(path.relative(root, path.resolve(root, f))), line: t.line, kind: m[3], title: t.title ? t.title.text : null });
    }
  }
  return out;
}
// UI sign-in: a sign-in method called on an object (a page object); an API / request / storage helper is not one
const UI_SIGNIN = /(?:\b([A-Za-z_$][\w$]*)|\))\s*\.\s*(?:login|logIn|signIn|signin|loginAs|logInAs|signInAs|loginWith\w*|signInWith\w*)\s*\(/g;
const NOT_UI = /(api|request|client|storage|session)$|^auth$/i;
const SIGNIN_SUBJECT = /\b(sign[- ]?in|log[- ]?in|login|sign[- ]?out|log[- ]?out|logout|lock[- ]?out|lockout|password|session|post-login|redirect)\b/i;
/** Tests that are not about sign-in itself yet drive the sign-in page more than once (their own body + the beforeEach hooks
 *  around them) → [{ file, line, title, count }] — a WARNING for P1 (sign in once per role: storageState or an API helper). */
export async function uiSignIns(root, files, journeys = []) {
  const sl = await load('scan-lib.mjs');
  const out = [];
  const jk = new Set(journeys.map((j) => j.file + ':' + j.line));
  for (const f of files) {
    const b = blocksOf(sl, path.resolve(root, f));
    if (!b) continue;
    const count = (x) => (x && x.body ? [...b.s.code.slice(x.body.start, x.body.end).matchAll(UI_SIGNIN)].filter((m) => !m[1] || !NOT_UI.test(m[1])).length : 0);
    const rf = posix(path.relative(root, path.resolve(root, f)));
    for (const t of b.blocks.filter((x) => testKind(x.kind) && x.body)) {
      if (jk.has(rf + ':' + t.line) || SIGNIN_SUBJECT.test(t.title ? t.title.text : '')) continue;
      let n = count(t);
      for (let p = t.parent; p; p = p.parent) n += b.blocks.filter((h) => h.kind === 'hook.beforeEach' && h.parent === p).reduce((a, h) => a + count(h), 0);
      n += b.blocks.filter((h) => h.kind === 'hook.beforeEach' && !h.parent).reduce((a, h) => a + count(h), 0);
      if (n > 1) out.push({ file: rf, line: t.line, title: t.title ? t.title.text : null, count: n });
    }
  }
  return out;
}

/** The four Lite checks of Checkpoint A from the mechanical components — pure, the selftest drives it directly. */
export function evaluateA({ components, ruleToCheck, mapping, coverage, docIds, review, snapshotId, now, resolved = null, journeys = null, variantOf = null }) {
  const at = now || new Date().toISOString();
  const v = components.validator || {};
  const rules = (ids) => new Set(Object.keys(ruleToCheck).filter((r) => (ruleToCheck[r] || []).some((c) => ids.includes(c))));
  const findings = Array.isArray(v.findings) ? v.findings : [];
  const mine = (ids) => { const rs = rules(ids); return findings.filter((f) => rs.has(f.ruleId)); };
  const rec = (checkId, status, reason, evidenceRef = [], sources = []) => ({ checkId, unit: 'scope', snapshotId, status, reason, evidenceRef: evidenceRef.slice(0, 20), executor: 'V', at, sources });
  const notes = [];
  // the whole scan must have covered the scope — never PASS a check that did not run
  const gaps = ((v.scope && v.scope.unreadable) || []).length + ((v.scope && v.scope.parseFailures) || []).length;
  let hard = null;
  if (!components.validator || v.error) hard = { outcome: 'BLOCKED', reason: 'the validator did not run' + (v.error ? ': ' + v.error : '') };
  else if (v.gate === 'NOT_RUN') hard = { outcome: 'NOT_RUN', reason: 'validator NOT_RUN — ' + (v.gateReason || 'no spec in scope') };
  else if (gaps) hard = { outcome: 'BLOCKED', reason: gaps + ' scoped file(s) could not be scanned — the rules never ran over them' };
  // 1 — tsc
  const t = components.tsc;
  const ls = components.list || null; // `playwright test --list`: the specs load in the configured project(s)
  const tsc = !t || t.status === 'notRun' ? rec('lite:tsc', 'unresolved', 'the type check did not run: ' + (t ? t.reason : 'no result'), [], ['35|tool:tsc'])
    : t.status === 'FAIL' ? rec('lite:tsc', 'FAIL', (t.errors || []).length + ' type-check error(s)', (t.errors || []).slice(0, 20).map((e) => (e.file ? e.file + ':' + e.line + ' ' : '') + e.code), ['35|tool:tsc'])
      : ls && ls.status === 'FAIL' ? rec('lite:tsc', 'FAIL', 'tsc passed but ' + ls.reason, (ls.errors || []).map((e) => 'list: ' + e), ['35|tool:tsc', 'tool:playwright-list'])
        : rec('lite:tsc', 'verified-mechanical', 'the project type check passed (imports resolve)' + (ls && ls.status === 'PASS' ? '; the specs load (' + (ls.tests ?? '?') + ' test(s) listed)' : ''), [], ['35|tool:tsc', ...(ls && ls.status === 'PASS' ? ['tool:playwright-list'] : [])]);  // 2 — POM compliance (+ spec-imports-spec)
  const pomF = mine(POM_IDS);
  const pomBad = pomF.filter((f) => f.severity === 'violation' || f.severity === 'review');
  const hits = (components.scan && components.scan.hits) || [];
  const pomEvid = [...pomBad.map(refOf), ...hits.map((h) => h.file + ':' + h.line + ' imports ' + h.imports)];
  const pom = pomEvid.length ? rec('lite:pom', 'FAIL', pomBad.length + ' page-object violation / undecided finding(s)' + (hits.length ? ' and ' + hits.length + ' spec-imports-spec' : '') + ' — fix the code (an approved exception goes in Testing/qa-allow.json)', pomEvid, ['1,2,4,5|tool:validator', '35|tool:scan'])
    : rec('lite:pom', 'verified-mechanical', 'no raw locator / driving / chained locator / spec helper / duplicate page object in ' + ((v.counts && v.counts.files) || 0) + ' file(s)', [], ['1,2,4,5|tool:validator', '35|tool:scan']);
  // 3 — TC coverage & traceability
  // declared journeys (L10): exempt from "no [TC-ID]" only when the run file lists them; never carry a TC-ID themselves
  const jr = journeys || { declared: [], listed: [] };
  const listed = new Set((jr.listed || []).map(posix));
  const jKey = new Set(jr.declared.filter((j) => listed.has(j.file)).map((j) => j.file + ':' + j.line));
  const trF = mine(TRACE_IDS).filter((f) => f.severity === 'violation' && !(f.ruleId === 'trace-title-missing-tcid' && jKey.has(posix(f.file) + ':' + f.line)));
  const problems = trF.map((f) => refOf(f) + (f.ruleId === 'trace-title-missing-tcid' && /setup|teardown/i.test(path.basename(String(f.file))) ? ' — a setup / teardown journey? declare it: annotation { type: \'journey\', description: \'teardown\' } + lite journey' : ''));
  for (const j of jr.declared) {
    if (tcIdsOf(j.title || '').length) problems.push(j.file + ':' + j.line + ' journey "' + j.title + '" carries a [TC-ID] — a journey is never a result: drop the ID, or make it a test case');
    if (!listed.has(j.file)) problems.push(j.file + ':' + j.line + ' declares a ' + j.kind + ' journey that the run file does not list — lite journey --run-file {rf} --spec ' + j.file);
  }
  // resolved titles (L16): what `playwright test --list` will run — a title built from a literal list is checked as it runs
  if (Array.isArray(resolved) && resolved.length) {
    const seen = new Map();
    for (const t of resolved) {
      if (jr.declared.some((j) => j.file === t.file && j.line === t.line)) continue;
      const ids = tcIdsOf(t.title);
      if (!ids.length) { problems.push(t.file + ':' + t.line + ' resolved title "' + t.title + '" carries no [TC-ID]'); continue; }
      if (ids.length > 1) { problems.push(t.file + ':' + t.line + ' resolved title "' + t.title + '" carries ' + ids.length + ' TC-IDs — exactly one per test'); continue; }
      const key = (t.project || '') + '|' + ids[0] + '|' + (variantOf ? variantOf(t.title) : t.title);
      if (seen.has(key)) problems.push(t.file + ':' + t.line + ' duplicate: "' + t.title + '" resolves to the same TC and variant as ' + seen.get(key) + (t.project ? ' in project ' + t.project : '') + ' — one test per TC variant');
      else seen.set(key, t.file + ':' + t.line);
    }
  }
  let coverageSummary = null;
  if (!coverage) problems.push('no coverage judgements (--coverage): every in-scope approved TC needs a status');
  else {
    const j = coverage.judgements || {};
    for (const e of coverage.errors || []) problems.push(e);
    for (const t2 of Array.isArray(j.tcs) ? j.tcs : []) {
      const files = mapping[t2.tc] || [];
      if (t2.status === 'Fully Covered' || t2.status === 'Partially Covered') { if (!files.length) problems.push(t2.tc + ': judged ' + t2.status + ' but no test title carries [' + t2.tc + ']'); }
      else if (!String(t2.note || t2.whyManual || t2.category || '').trim()) problems.push(t2.tc + ': Not Covered without a documented exclusion / blocker (note, whyManual or category)');
    }
    for (const [id, files] of Object.entries(mapping)) {
      if (docIds && !docIds.includes(id)) problems.push(id + ': a test title carries an ID that is not in the approved document (' + files[0] + ')');
      if (files.length > 1) problems.push(id + ': duplicate mapping — tests in ' + files.length + ' spec files (' + files.slice(0, 3).join(', ') + ')');
    }
    coverageSummary = coverage.summary || null;
  }
  const trace = problems.length ? rec('lite:traceability', 'FAIL', problems.length + ' traceability problem(s) — mapped coverage is not execution success', problems, ['29,30|tool:validator', 'coverage'])
    : rec('lite:traceability', 'verified-mechanical', 'every in-scope approved TC maps to a test or a documented exclusion; no duplicate / unknown mapping (mapping only — execution is judged at Checkpoint B)', [], ['29,30|tool:validator', 'coverage']);
  // 4 — assertions (static; review items closed only by a targeted review)
  const asF = mine(ASSERT_IDS);
  const asViol = asF.filter((f) => f.severity === 'violation');
  const asOpen = asF.filter((f) => f.severity === 'review');
  const items = (review && review.items && typeof review.items === 'object') ? review.items : {};
  const uncovered = asOpen.filter((f) => !(typeof items[refOf(f)] === 'string' && items[refOf(f)].trim().length >= 8));
  let assertions;
  if (asViol.length || uncovered.length) assertions = rec('lite:assertions', 'FAIL', asViol.length + ' missing / meaningless assertion(s)' + (uncovered.length ? ' and ' + uncovered.length + ' assertion path(s) static analysis could not establish — read only those lines and pass --assertion-review' : ''), [...asViol, ...uncovered].map(refOf), ['8,9|tool:validator']);
  else assertions = rec('lite:assertions', 'verified-mechanical', 'every test asserts' + (asOpen.length ? '; ' + asOpen.length + ' conditional / untraceable path(s) closed by a targeted review' : '') + ' (no placeholder, empty or assertion-free test)', asOpen.map(refOf), ['8,9|tool:validator']);
  for (const f of asOpen) { const why = items[refOf(f)]; if (why) notes.push(withheld(refOf(f) + ' — ' + why).slice(0, 200)); }
  // execution-safety checks (not a fifth check): provable violations fail, unprovable ones are reported
  const saf = mine(SAFETY_IDS);
  const safetyFail = saf.filter((f) => f.severity === 'violation').map(refOf);
  const prot = components.protections && !components.protections.error ? components.protections : null;
  if (prot && (prot.blocking || []).length) safetyFail.push(...prot.blocking.slice(0, 10).map((b) => 'run protection: ' + (typeof b === 'string' ? b : JSON.stringify(b)).slice(0, 160)));
  if (components.configs && components.configs.verdict === 'none') safetyFail.push('no playwright config found — the one shared configuration is missing');
  const own = components.ownership || null;   // ledger ownership (check 53 read statically): a provable mislabel FAILs now, not at B
  if (own) safetyFail.push(...own.fail.map((x) => 'ledger ownership: ' + x));
  const safetyWarn = [...saf.filter((f) => f.severity !== 'violation' && f.severity !== 'info').map(refOf), ...(prot && (prot.unresolved || []).length ? ['run protections not proven: ' + prot.unresolved.length] : []), ...(components.configs && components.configs.verdict === 'multiple' ? ['extra Playwright configs: ' + (components.configs.configs.length - 1)] : []), ...(ls && ls.status === 'notRun' ? ['spec load check not run (no Playwright CLI) — a load error shows only at smoke'] : []), ...(own ? own.warn.map((x) => 'ledger ownership: ' + x) : [])];
  const results = [tsc, pom, trace, assertions];
  let verdict = 'PASS';
  if (hard) verdict = hard.outcome;
  else if (results.some((r) => r.status === 'FAIL') || safetyFail.length) verdict = 'FAIL';
  else if (results.some((r) => r.status === 'unresolved')) verdict = 'BLOCKED';
  return { verdict, hard, results, safety: { fail: safetyFail, warnings: safetyWarn.slice(0, 20) }, notes, coverageSummary };
}

function gateRecordA({ snapshot, ev, rehashResult, tools, now }) {
  const at = now || new Date().toISOString();
  const fail = ev.results.filter((r) => r.status === 'FAIL').map((r) => ({ checkId: r.checkId, unit: r.unit, reason: r.reason }));
  const open = ev.results.filter((r) => r.status === 'unresolved').map((r) => ({ checkId: r.checkId, unit: r.unit, reason: r.reason }));
  return {
    schema: 'skill5-gate/1', checkpoint: 'A', phase: snapshot.body.phase, verdict: ev.verdict, profile: PROFILE, liteVersion: LITE_VERSION, snapshotId: snapshot.snapshotId,
    snapshotFile: 'artifacts/checks/' + snapshot.snapshotId + '/snapshot.json', decidedAt: at, rehash: { matched: rehashResult.matched, differences: rehashResult.differences.slice(0, 50) },
    results: ev.results, rejected: ev.hard ? [{ checkId: '*', unit: 'scope', why: ev.hard.outcome === 'NOT_RUN' ? 'not-run' : 'incomplete', detail: ev.hard.reason }] : [], na: [], closed: [], open, fail, auto: [],
    safety: ev.safety, assertionReview: ev.notes.slice(0, 20),
    counts: { required: 4, accepted: ev.results.length, rejected: ev.hard ? 1 : 0, fail: fail.length, open: open.length, closed: 0, na: 0, auto: 0 },
    tools: snapshot.body.tools, executors: ['V'], scopeDigest: snapshot.body.scopeDigest || null,
  };
}

/** Relative imports of a TS / JS module, resolved to files on disk (a `.js` specifier may name a `.ts` source). */
const IMPORT_RE = /\bfrom\s*(['"])(\.[^'"]*)\1|\bimport\s*\(\s*(['"])(\.[^'"]*)\3\s*\)|\bimport\s+(['"])(\.[^'"]*)\5/g;
function importsOf(file) {
  const text = read(file);
  if (text === null) return [];
  const out = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const base = path.resolve(path.dirname(file), m[2] || m[4] || m[6]);
    const hit = [base, base.replace(/\.[cm]?js$/, '.ts'), ...['.ts', '.tsx', '.mts', '.js', '.mjs'].map((e) => base + e), path.join(base, 'index.ts'), path.join(base, 'index.js')].find(isFile);
    if (hit) out.push(hit);
  }
  return out;
}
const LEDGER_USE = /data-ledger|\brecordChange\s*\(|\bappendLedger\s*\(/;
/** Consented data-changing TCs whose spec reaches no data-ledger call through its imports → [{ tc, spec }] (a WARN, never a FAIL). */
export function ledgerGaps({ root, mapping, dataTcs }) {
  const memo = new Map();
  const reaches = (spec) => {
    if (memo.has(spec)) return memo.get(spec);
    const seen = new Set(); const queue = [spec]; let hit = false;
    while (queue.length && !hit && seen.size < 400) {
      const f = queue.shift();
      if (seen.has(f)) continue;
      seen.add(f);
      if (LEDGER_USE.test(read(f) || '')) hit = true;
      else queue.push(...importsOf(f));
    }
    memo.set(spec, hit);
    return hit;
  };
  const gaps = [];
  for (const tc of dataTcs) for (const f of mapping[tc] || []) if (!reaches(path.resolve(root, f))) gaps.push({ tc, spec: posix(f) });
  return gaps;
}

/* ---------------- ledger ownership (static, Checkpoint A) ----------------
 * Check 53 accepts writes on run-owned records only: a `modify` / `remove` / `update` / `delete` needs a `create` / `insert`
 * of the same resource earlier in the run, and a `modify-external` is always refused. This scan reads the ledger labels in the
 * code the story specs reach (the Lite prerequest ledger, test-support clients, page objects) and FAILs what check 53 would
 * refuse at Checkpoint B — before a single test runs. Full's helper templates (`@link-qc-5-template`) are skipped: their
 * api-record / db-record writes enforce ownership at runtime. What it cannot read (a computed op or target) is a warning. */
const OWNED_WRITE = new Set(['modify', 'remove', 'update', 'delete']);
/** Comments blanked to spaces (line numbers kept); a `//` after `:` (a URL) or inside a quote is left alone. */
function blankComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}
/** The `{ … }` that encloses index i (brace-matched, bounded), or null. */
function enclosingObject(t, i) {
  let depth = 0; let s = -1;
  for (let j = i; j >= 0 && i - j < 2000; j--) { const c = t[j]; if (c === '}') depth++; else if (c === '{') { if (depth === 0) { s = j; break; } depth--; } }
  if (s < 0) return null;
  depth = 0;
  for (let j = s; j < t.length && j - s < 4000; j++) { const c = t[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return t.slice(s, j + 1); } }
  return null;
}
/** The expression of `op:` up to the next top-level `,` / `}` of its object. */
function opExpr(t, from) {
  let depth = 0; let q = null;
  for (let j = from; j < t.length && j - from < 400; j++) {
    const c = t[j];
    if (q) { if (c === q && t[j - 1] !== '\\') q = null; continue; }
    if (c === "'" || c === '"' || c === '`') q = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return t.slice(from, j); depth--; }
    else if ((c === ',' || c === ';' || c === '\n') && depth === 0) return t.slice(from, j);
  }
  return t.slice(from, from + 400);
}
const lineAt = (t, i) => t.slice(0, i).split('\n').length;
const IDENT = '[A-Za-z_$][\\w$]*';
/** The function (declaration or arrow const) whose body holds index i, with its first parameter — or null. */
function enclosingFunction(t, i) {
  const re = new RegExp('(?:function\\s+(' + IDENT + ')\\s*(?:<[^>]*>)?\\s*\\(\\s*(' + IDENT + ')|const\\s+(' + IDENT + ')\\s*=\\s*(?:async\\s*)?\\(\\s*(' + IDENT + '))', 'g');
  let hit = null;
  for (const m of t.slice(Math.max(0, i - 1500), i).matchAll(re)) hit = { name: m[1] || m[3], param: m[2] || m[4] };
  return hit;
}
export function ledgerOwnership({ root, files }) {
  const consts = new Map();    // NAME → { resource, key }
  const uses = [];             // one per `op:` that labels a write, or per call of a target-taking helper
  const helpers = new Map();   // NAME → { ops } — functions that build a Change around the target they receive
  const texts = [];
  for (const f of files) {
    const raw = read(f);
    if (raw === null || /@link-qc-5-template\s/.test(raw.split('\n').slice(0, 5).join('\n'))) continue;
    texts.push({ f, t: blankComments(raw) });
  }
  for (const { t } of texts) for (const m of t.matchAll(new RegExp('\\bconst\\s+(' + IDENT + ')\\s*=\\s*\\{([^{}]*)\\}', 'g'))) {
    const r = /\bresource\s*:\s*(['"])([^'"]+)\1/.exec(m[2]);
    if (r) { const k = /\bkey\s*:\s*(['"])([^'"]+)\1/.exec(m[2]); consts.set(m[1], { resource: r[2], key: k ? k[2] : null }); }
  }
  for (const { f, t } of texts) {
    for (const m of t.matchAll(/(?<![\w$?.])op\s*:\s*/g)) {
      const expr = opExpr(t, m.index + m[0].length).trim();
      if (/^(['"])[^'"]*\1(\s*\|\s*(['"])[^'"]*\3)+$/.test(expr) || /^NonNullable</.test(expr) || /^[A-Z]\w*\[['"]op['"]\]/.test(expr)) continue; // a type, not a write
      if (new RegExp('^' + IDENT + '\\.op$').test(expr)) continue;          // pass-through (recordChange copies change.op)
      const obj = enclosingObject(t, m.index) || '';
      const ops = [...expr.matchAll(/(['"])([a-z-]+)\1/g)].map((x) => x[2]);
      const creates = [...expr.matchAll(new RegExp('\\bcreateOrModify\\s*\\(\\s*(' + IDENT + ')\\s*\\)', 'g'))].map((x) => x[1]);
      const fn = enclosingFunction(t, m.index);
      // a helper that spreads the target it receives (inRunData(res, …)): checked at its call sites, not here
      if (fn && new RegExp('\\.\\.\\.\\s*' + fn.param + '\\b').test(obj)) { helpers.set(fn.name, { ops }); continue; }
      const res = /\bresource\s*:\s*(['"])([^'"]+)\1/.exec(obj);
      const key = /\bkey\s*:\s*(['"])([^'"]+)\1/.exec(obj);
      const spread = [...obj.matchAll(/\.\.\.\s*([A-Z_][\w$]*)\b/g)].map((x) => x[1]);
      uses.push({ file: posix(path.relative(root, f)), line: lineAt(t, m.index), ops, creates, res: res ? res[2] : null, key: key ? key[2] : null, keyComputed: !key && /\bkey\s*:\s*(?!null\b)[A-Za-z_$(\x60]/.test(obj), spread, dynamicOp: !ops.length && !creates.length, raw: expr.slice(0, 60) });
    }
  }
  for (const { f, t } of texts) for (const [name, h] of helpers) for (const m of t.matchAll(new RegExp('(?<![\\w$.])' + name.replace(/\$/g, '\\$') + '\\s*\\(\\s*(' + IDENT + ')', 'g'))) {
    if (/function\s*$/.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;   // the declaration itself
    uses.push({ file: posix(path.relative(root, f)), line: lineAt(t, m.index), ops: h.ops, creates: [], res: null, key: null, spread: [m[1]], dynamicOp: !h.ops.length, raw: name + '(' + m[1] + ', …)' });
  }
  const targetOf = (u) => {
    const sp = u.spread.map((n) => consts.get(n)).find(Boolean);
    return { resource: u.res || (sp && sp.resource) || null, key: u.key || (sp && sp.key) || null, unknownSpread: !u.res && u.spread.length && !sp ? u.spread[0] : null };
  };
  // the resources the code creates: a literal create / insert, or createOrModify(CONST) (create first, then modify)
  const created = new Map();   // resource → Set(key | '*')
  const addCreated = (resource, key) => { if (!resource) return; if (!created.has(resource)) created.set(resource, new Set()); created.get(resource).add(key || '*'); };
  for (const u of uses) {
    for (const n of u.creates) { const c = consts.get(n); if (c) addCreated(c.resource, c.key); }
    if (u.ops.some((o) => o === 'create' || o === 'insert')) { const tg = targetOf(u); addCreated(tg.resource, tg.key); }
  }
  const fail = []; const warn = [];
  const at = (u) => u.file + ':' + u.line;
  for (const u of uses) {
    const tg = targetOf(u);
    if (u.ops.includes('modify-external')) { fail.push(at(u) + ' modify-external of ' + JSON.stringify(tg.resource || '?') + ' — a change to data the run did not create; check 53 refuses it at Checkpoint B whatever the consent: create the data in the run (setup create) instead'); continue; }
    if (u.dynamicOp) { warn.push(at(u) + ' op `' + u.raw + '` is computed — its ownership cannot be checked statically'); continue; }
    const writes = u.ops.filter((o) => OWNED_WRITE.has(o));
    if (!writes.length || u.creates.length) continue;
    if (tg.unknownSpread) { warn.push(at(u) + ' ' + writes[0] + ' of ' + tg.unknownSpread + ' — the constant was not found in scope; ownership not checked'); continue; }
    if (!tg.resource) { warn.push(at(u) + ' ' + writes[0] + ' with a computed resource — ownership not checked'); continue; }
    const keys = created.get(tg.resource);
    if (!keys) fail.push(at(u) + ' ' + writes[0] + ' of ' + JSON.stringify(tg.resource) + ' — no ledger call in scope creates it, so the run does not own it and check 53 fails it at Checkpoint B: make the first change `create` (createOrModify), ledger it against the run-created resource it lands in (inRunData), or label it modify-external');
    else if (u.keyComputed) warn.push(at(u) + ' ' + writes[0] + ' of ' + JSON.stringify(tg.resource) + ' with a computed key — that this record is run-created is proven only at Checkpoint B (a pre-existing record fails check 53)');
    else if (tg.key && !keys.has(tg.key) && !keys.has('*')) fail.push(at(u) + ' ' + writes[0] + ' of ' + JSON.stringify(tg.resource) + ' key ' + JSON.stringify(tg.key) + ' — the run creates other keys of it, not this one');
  }
  return { scanned: texts.length, uses: uses.length, fail, warn };
}
/** The files the story specs reach through their relative imports (bounded), plus the explicit scope. */
function reachableFiles(root, specs, extra = []) {
  const seen = new Set(); const queue = [...specs.map((f) => path.resolve(root, f)), ...extra.map((f) => path.resolve(root, f))];
  while (queue.length && seen.size < 400) { const f = queue.shift(); if (seen.has(f) || !isFile(f)) continue; seen.add(f); queue.push(...importsOf(f)); }
  return [...seen].filter((f) => /\.[cm]?[jt]sx?$/.test(f));
}

/** `playwright test --list --reporter=list` output → the RESOLVED tests: { project, file (root-relative, mapped onto a scoped
 *  spec), line, title } — titles built in a loop over a literal list arrive here expanded, exactly as they will run. */
export function parseListTitles(text, { root, ar, specs = [] }) {
  const out = [];
  const scoped = specs.map((f) => posix(path.relative(root, path.resolve(root, f))));
  for (const l of String(text).split(/\r?\n/)) {
    const m = l.match(/^\s*(?:\[([^\]]+)\]\s*›\s*)?([^›]+?\.[cm]?[jt]sx?):(\d+):(\d+)\s*›\s*(.+?)\s*$/);
    if (!m) continue;
    const printed = posix(m[2].trim());
    const file = scoped.find((f) => f === printed || f.endsWith('/' + printed)) || posix(path.relative(root, path.resolve(ar, printed)));
    const titlePath = m[5].split(/\s+›\s+/);
    out.push({ project: m[1] || null, file, line: Number(m[3]), title: titlePath[titlePath.length - 1] });
  }
  return out;
}
const TC_TOKEN = /^TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
/** The `[TC-ID]` tokens of one title (a bracket may hold a comma list). */
export const tcIdsOf = (title) => [...String(title).matchAll(/\[([^\]]+)\]/g)].flatMap((g) => g[1].split(',').map((x) => x.trim())).filter((x) => TC_TOKEN.test(x));

/** `playwright test --list` over the story specs in the run's project(s): a spec that does not load (a tag without `@`, an
 *  import error, an unknown project, a spec the config's testMatch misses) FAILs here instead of at smoke. An inspection run has
 *  NO side effects (L11): the list reporter only — the config's JSON / HTML reporters never write —, a throw-away output folder
 *  under the OS temp dir and no stage variables, so nothing under the results, artifacts, reports, screenshots or logs roots
 *  changes and no earlier result goes stale. */
export async function listSpecs({ root, autoRel, specs, projects, cli }) {
  const ar = path.resolve(root, autoRel);
  const penv = await load('project-env.mjs');
  const pw = penv.resolvePlaywrightCli(ar, typeof cli === 'string' ? cli : null, { root });
  if (!pw.cli) return { status: 'notRun', reason: pw.error || 'the project\'s Playwright CLI was not found' };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-lite-list-'));
  const env = { ...process.env, PW_OUTPUT_DIR: scratch };
  for (const k of Object.keys(env)) if (/^PW_(STAGE_JSON|PROGRESS_FILE|PHASE|STAGE_ATTEMPT|SCRATCH_JSON|SCREENSHOTS)$/.test(k)) delete env[k];
  let r;
  try { r = spawnSync(process.execPath, [pw.cli, 'test', '--list', '--reporter=list', '--output=' + scratch, ...projects.map((p) => '--project=' + p), ...specs.map((f) => posix(path.relative(ar, path.resolve(root, f))))], { cwd: ar, env, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); }
  finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  if (r.error) return { status: 'notRun', reason: 'playwright test --list did not run: ' + r.error.message };
  const text = (String(r.stdout || '') + '\n' + String(r.stderr || '')).trim();
  if (r.status === 0) { const m = text.match(/Total:\s*(\d+)\s+tests?/); return { status: 'PASS', tests: m ? Number(m[1]) : null, titles: parseListTitles(text, { root, ar, specs }) }; }
  const lines = text.split(/\r?\n/).filter((l) => /error|not found|no tests|cannot|unexpected|must/i.test(l)).slice(0, 8);
  return { status: 'FAIL', reason: 'the specs do not load (playwright test --list exit ' + r.status + ')', errors: (lines.length ? lines : [text.slice(-400)]).map((l) => withheld(l).trim().slice(0, 200)) };
}

export async function checkpointA(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'checkpoint-a', miss);
  const root = path.resolve(args.root || process.cwd());
  if (typeof args['results-root'] !== 'string' || !(Number(args.phase) > 0)) return blocked(args, 'checkpoint-a', '--results-root and --phase are required');
  const rr = path.resolve(root, args['results-root']);
  const phase = Number(args.phase);
  const files = csv(args.files);
  if (!files.length) return finish(args, 'checkpoint-a', { outcome: 'NOT_RUN', reason: 'no --files: name the in-scope specs and the page objects / fixtures / helpers they touch' });
  const check = await load('check.mjs');
  const autoRel = await automationRootOf(root, args['automation-root'], rr);
  const runFile = path.join(rr, '.runs', 'phase-' + phase + '.json');
  const s = check.takeSnapshot({ root, resultsRoot: rr, checkpoint: 'A', phase, files, tc: args.tc, data: args.data, req: csv(args.req), automationRoot: autoRel });
  const sid = s.snapshotId;
  const tools = check.resolveTools({ root, autoDir: path.resolve(root, autoRel), tsc: args.tsc, eslint: undefined, lint: false });
  // mechanical components: reused for the same snapshot + tools (the delta rule), else one static run (no ledger slot)
  const mechFile = path.join(liteDir(rr), 'mech-' + sid + '.json');
  let mech = readJson(mechFile); let reused = false;
  if (mech && mech.toolKey === tools.toolKey) reused = true;
  else {
    const { full } = await check.runChecks({ root, resultsRoot: rr, snapshotId: sid, tsc: args.tsc, noLedger: true, ledger: false });
    if (full.gate === 'BLOCKED' && full.void) return finish(args, 'checkpoint-a', { outcome: 'BLOCKED', reason: full.reason, snapshotId: sid });
    if (full.coordination && full.coordination.outcome && full.coordination.outcome !== 'OK') return finish(args, 'checkpoint-a', { outcome: 'BLOCKED', reason: 'coordination, not a code result: ' + (full.reason || 'no slot'), snapshotId: sid });
    mech = { toolKey: tools.toolKey, at: full.at, components: full.components };
    writeJsonAtomic(mechFile, mech);
  }
  // traceability inputs
  const prevMap = readJson(path.join(liteDir(rr), 'mapping.json')) || { specs: [] };
  const specFiles = uniq([...(csv(args.specs).length ? csv(args.specs) : files.filter(isSpec)), ...prevMap.specs]).filter((f) => isFile(path.resolve(root, f)));
  const runNow = readJson(runFile);
  // the specs must load in the run's project(s) — one side-effect-free `playwright test --list` per snapshot, kept with the
  // mechanical run; its RESOLVED titles are what traceability reads (L16), the static scan is the fallback when it cannot run
  if ((!mech.list || (mech.list.status === 'PASS' && !mech.list.titles)) && specFiles.length) {
    const projects = csv(String((runNow && runNow.lite && runNow.lite.project) || ''));
    mech.list = await listSpecs({ root, autoRel, specs: specFiles, projects, cli: args.cli });
    writeJsonAtomic(mechFile, mech);
  }
  const resolved = mech.list && mech.list.status === 'PASS' && (mech.list.titles || []).length ? mech.list.titles : null;
  const testFiles = uniq([...specFiles, ...files.filter((f) => isTestFile(f) && isFile(path.resolve(root, f)))]);
  const declared = await journeysOf(root, testFiles);
  const autoAbsA = path.resolve(root, autoRel);
  const listedJ = ((runNow && runNow.lite && runNow.lite.journeys) || []).map((j) => posix(path.relative(root, path.resolve(autoAbsA, j.spec))));
  const mapping = resolved ? mappingOf(resolved, declared) : scanMapping(root, specFiles);
  const rdm = await load('run-data.mjs');
  // every consented data change must reach the data ledger (check 53 at Checkpoint B) — said now, not at finalize
  const dc = runNow && runNow.data_changes;
  const ledger = dc && dc.consent === 'yes' ? ledgerGaps({ root, mapping, dataTcs: dc.tcs || [] }) : [];
  // …and every ledger label must be one check 53 accepts: no modify / remove of what the run never created
  const ownership = ledgerOwnership({ root, files: reachableFiles(root, specFiles, files.filter((f) => /\.[cm]?[jt]sx?$/.test(f))) });
  let coverage = null; let docIds = null;
  const tcText = typeof args.tc === 'string' ? read(path.resolve(root, args.tc)) : null;
  if (tcText !== null) docIds = (await load('render-run-report.mjs')).tcDocIds(tcText);
  if (typeof args.coverage === 'string') {
    const j = readJson(path.resolve(root, args.coverage));
    if (!j) return finish(args, 'checkpoint-a', { outcome: 'BLOCKED', reason: '--coverage is not readable JSON: ' + args.coverage, snapshotId: sid });
    const cov = await load('coverage.mjs');
    const c = cov.computeCoverage(j, { mechanism: 'report-only', docIds });
    coverage = { judgements: j, errors: c.errors || [], summary: { weightedPct: c.weightedPct, totals: c.totals } };
  }
  let review = null;
  if (typeof args['assertion-review'] === 'string') {
    review = readJson(path.resolve(root, args['assertion-review']));
    if (!review) return finish(args, 'checkpoint-a', { outcome: 'BLOCKED', reason: '--assertion-review is not readable JSON', snapshotId: sid });
    if (String(review.snapshot) !== sid) review = null, args._staleReview = true;
  }
  const ev = evaluateA({ components: { ...mech.components, ...(mech.list ? { list: mech.list } : {}), ownership }, ruleToCheck: check.RULE_TO_CHECK, mapping, coverage, docIds, review, snapshotId: sid, resolved, journeys: { declared, listed: listedJ }, variantOf: rdm.variationSlug });
  // P1 — a test that is not about sign-in yet drives the sign-in page more than once: a warning (sign in once per role)
  const auth = runNow && runNow.auth;
  const signIns = await uiSignIns(root, specFiles, declared);
  if (signIns.length && !(auth && auth.strategy === 'ui-fallback')) ev.safety.warnings.unshift(...signIns.slice(0, 3).map((x) => 'ui sign-in ×' + x.count + ' in ' + x.file + ':' + x.line + ' — ' + (auth ? 'use the recorded auth strategy (' + auth.strategy + ')' : 'record the auth strategy (lite auth) and sign in once per role')));
  const rehashResult = check.rehash(s.snapshot);
  if (!rehashResult.matched) { ev.verdict = 'BLOCKED'; ev.hard = { outcome: 'BLOCKED', reason: 'the scope changed during the checkpoint (' + rehashResult.differences.length + ' difference(s)) — no edits during a checkpoint; run it again' }; }
  const rec = gateRecordA({ snapshot: s.snapshot, ev, rehashResult });
  if (ledger.length) rec.ledgerWarnings = ledger.slice(0, 50);
  rec.ledgerOwnership = { scanned: ownership.scanned, labels: ownership.uses, fail: ownership.fail.slice(0, 50), warn: ownership.warn.slice(0, 50) };
  rec.traceability = { source: resolved ? 'playwright --list (resolved titles)' : 'static titles', tests: resolved ? resolved.length : null, journeys: declared };
  if (signIns.length) rec.uiSignIns = signIns.slice(0, 50);
  const gateFile = check.gateRecordPath(rr, phase, 'A');
  writeJsonAtomic(gateFile, rec);
  writeJsonAtomic(path.join(check.checksDir(rr, sid), 'gate-A.json'), rec);
  if (ev.verdict === 'PASS') {
    writeJsonAtomic(path.join(liteDir(rr), 'mapping.json'), { schema: 'skill5c-mapping/1', specs: specFiles, tcs: mapping });
    const run = readJson(runFile);
    if (run) {
      const autoAbs = path.resolve(root, autoRel);
      // the inputs of this PASS, so finalize can refresh Checkpoint A on the final scope by itself
      const inRoot = (f) => (typeof f === 'string' ? posix(path.relative(root, path.resolve(root, f))) : null);
      const inputs = { tc: inRoot(args.tc), data: inRoot(args.data), req: csv(args.req).map(inRoot), coverage: inRoot(args.coverage), files: files.map(inRoot) };
      const next = { ...run, lite: { ...(run.lite || {}), specs: uniq(specFiles.map((f) => posix(path.relative(autoAbs, path.resolve(root, f))))), checkpoint_a: inputs } };
      writeJsonAtomic(runFile, next);
      if (coverage && coverage.errors.length === 0) {
        const cov = await load('coverage.mjs');
        cov.coverage({ judgements: path.resolve(root, args.coverage), 'run-file': runFile, 'results-root': rr, 'tc-doc': typeof args.tc === 'string' ? path.resolve(root, args.tc) : undefined, mechanism: 'report-only', write: true });
      }
    }
  }
  const problems = ev.results.filter((r) => r.status !== 'verified-mechanical');
  const actionable = [...ev.safety.fail.map((x) => 'safety: ' + x), ...problems.flatMap((r) => r.evidenceRef.map((e) => r.checkId.replace('lite:', '') + ': ' + e))].slice(0, 10);
  const more = Math.max(0, ev.safety.fail.length + problems.reduce((n, r) => n + r.evidenceRef.length, 0) - actionable.length);
  return finish(args, 'checkpoint-a', {
    outcome: ev.verdict, snapshotId: sid, reusedMechanical: reused, checks: Object.fromEntries(ev.results.map((r) => [r.checkId.replace('lite:', ''), r.status === 'verified-mechanical' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'OPEN'])),
    safety: ev.safety.fail.length ? 'FAIL (' + ev.safety.fail.length + ')' : 'ok',
    ...(ev.hard ? { reason: ev.hard.reason } : {}), problems: actionable, more, warnings: ev.safety.warnings.slice(0, 5), coverage: ev.coverageSummary, ...(args._staleReview ? { note: '--assertion-review names another snapshot — ignored' } : {}),
    ...(ownership.fail.length || ownership.warn.length ? { ownership: { fail: ownership.fail.length, warn: ownership.warn.length, fix: 'first change of a run-created resource = create (createOrModify), a change inside it = modify of that resource (inRunData), a change to pre-existing data = modify-external (check 53 refuses it) — assets/templates/prerequest-ledger.ts' } } : {}),
    ...(ledger.length ? { ledger: { warn: ledger.length, tcs: uniq(ledger.map((g) => g.tc)).slice(0, 10), fix: 'route each data change through helpers/data-ledger.ts (assets/templates/prerequest-ledger.ts) — else check 53 is unresolved at finalize' } } : {}),
    ...(signIns.length && !(auth && auth.strategy === 'ui-fallback') ? { signIns: { warn: signIns.length, fix: 'non-sign-in tests take a signed-in state (storageState per role, or the API helper after a reset) — assets/templates/auth.setup.ts / auth.ts' } } : {}),
    traceability: resolved ? 'resolved titles (' + resolved.length + ')' : 'static titles' + (mech.list && mech.list.status !== 'PASS' ? ' (--list ' + mech.list.status + ')' : ''), ...(declared.length ? { journeys: declared.length } : {}),
    gate: rel(process.cwd(), gateFile), next: ev.verdict === 'PASS' ? (ledger.length ? 'route those data changes through the ledger, run checkpoint-a again, then test data → stage smoke' : 'test data → stage smoke') : ev.verdict === 'FAIL' ? 'fix the listed code, run checkpoint-a again' : 'resolve the reason, run checkpoint-a again',
  }, { rec }, rr);
}

/* ---------------- stage ---------------- */

/** The 30% smoke gate over the phase's cumulative smoke results — the same arithmetic as run-stage (PASS + FAIL only). */
export async function smokeGate(progressDir) {
  const rs = await load('run-stage.mjs');
  const cum = rs.cumulativeOf(progressDir);
  const s = cum.stages && cum.stages.smoke;
  if (!s) return { present: false };
  return { present: true, ...rs.smokeGateOf(s) };
}

export async function stage(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'stage', miss);
  if (typeof args['run-file'] !== 'string') return blocked(args, 'stage', '--run-file is required');
  const stageName = args.stage; const runKind = args.run || 'first';
  if (!['smoke', 'positive', 'negative'].includes(stageName)) return blocked(args, 'stage', '--stage must be smoke | positive | negative');
  if (!['first', 'rerun'].includes(runKind)) return blocked(args, 'stage', '--run must be first | rerun');
  const runFile = path.resolve(args['run-file']);
  const run = readJson(runFile);
  if (!run) return blocked(args, 'stage', 'run file unreadable: ' + args['run-file']);
  const rr = path.dirname(path.dirname(runFile));
  const rs = await load('run-stage.mjs');
  const ar = rs.automationRootOf(runFile, run);
  const lite = run.lite || {};
  const stageTcs = csv(args['stage-tcs']).length ? csv(args['stage-tcs']) : ((lite.stages || {})[stageName] || []);
  if (!stageTcs.length) return finish(args, 'stage', { outcome: 'COMPLETED', stage: stageName, run: runKind, counts: { tcs: 0 }, reason: 'no TC of this stage in the approved scope', next: stageName === 'smoke' ? 'positive' : stageName === 'positive' ? 'negative' : 'stage 4' });
  const progress = path.join(rr, 'artifacts', 'progress');
  // the smoke gate: positive / negative never start on a failed (> 30 %) or empty smoke verdict — their TCs stay NOT_RUN
  if (runKind === 'first' && stageName !== 'smoke' && ((lite.stages || {}).smoke || []).length) {
    const g = await smokeGate(progress);
    if (!g.present) return finish(args, 'stage', { outcome: 'BLOCKED', stage: stageName, run: runKind, reason: 'run the smoke stage first (staged order smoke → positive → negative)', next: 'stage --stage smoke' });
    if (g.decision === 'no_verdict') return finish(args, 'stage', { outcome: 'STOPPED', stage: stageName, run: runKind, reason: 'smoke gate: NO VERDICT — no smoke TC produced a PASS or FAIL', smokeGate: g, next: 'fix the cause, retry smoke (stage --stage smoke), or finalize with the rest NOT_RUN' });
    if (Number(g.failPct) > SMOKE_LIMIT) return finish(args, 'stage', { outcome: 'STOPPED', stage: stageName, run: runKind, reason: 'smoke gate: ' + g.failPct + '% failed (limit ' + SMOKE_LIMIT + '%) — positive / negative do not start; their TCs stay NOT_RUN', smokeGate: { failPct: g.failPct, limit: SMOKE_LIMIT, eligible: g.eligible }, next: 'classify the smoke failures; heal test-code defects (≤ 2) and retry smoke, else finalize (NOT_RUN is reported, never PASS)' });
  }
  const maxWorkers = Math.min(MAX_WORKERS, Math.max(1, Math.floor(Number(args['max-workers']) || Number(lite.max_workers) || MAX_WORKERS)));
  const specs = csv(args.spec).length ? csv(args.spec) : (lite.specs || []);
  const planFile = path.join(rr, 'artifacts', 'parallel-plan.json');
  let plan = null; let planNote = null;
  if (maxWorkers >= 2) {
    const stale = !isFile(planFile) || args.replan;
    if (stale) {
      const argv = ['--root', ar, '--run-file', runFile, '--progress', progress, '--out', planFile];
      if (specs.length) argv.push('--spec', specs.join(','));
      const tc = run.source_tc_doc ? path.resolve(rs.projectRootOf(ar, args.root), run.source_tc_doc) : null; // source_tc_doc is project-relative
      if (tc && isFile(tc)) argv.push('--tc', tc);
      const r = spawnJson('parallel-plan.mjs', argv, { cwd: ar });
      planNote = r.json ? r.json.outcome : 'readiness check gave no result';
    }
    plan = readJson(planFile);
  }
  let noLedger = !!(args['no-ledger'] || lite.no_ledger);
  const cand = plan && plan.outcome === 'OK' ? Number((plan.readiness && plan.readiness.candidateConcurrency) || 1) : 1;
  let workers = noLedger ? 1 : pickWorkers({ cap: maxWorkers, candidateConcurrency: cand });
  let memNote = null;
  // NO host-memory gate in Lite: a serial stage never enters the capacity ledger (no admission waits); a parallel stage checks
  // free memory once, up front, and drops to fewer workers — or to serial without the ledger — instead of waiting for memory
  if (workers === 1) noLedger = true;
  else {
    const pfArgv = ['preflight', '--run-file', runFile];
    for (const k of ['cli', 'env-id']) if (typeof args[k] === 'string') pfArgv.push('--' + k, args[k]);
    if (args.headless) pfArgv.push('--headless');
    const pf = spawnJson('run-stage.mjs', pfArgv, { cwd: ar }).json;
    const adm = pf && pf.capacity && Number.isFinite(Number(pf.capacity.admissibleNow)) ? Number(pf.capacity.admissibleNow) : null;
    if (adm !== null && adm < workers) {
      if (adm >= MIN_PARALLEL_WORKERS) { memNote = 'free memory admits ' + adm + ' of ' + workers + ' workers now — running ' + adm; workers = adm; }
      else { memNote = 'free memory admits ' + Math.max(0, adm) + ' worker(s) now — serial without the ledger instead of waiting'; workers = 1; noLedger = true; }
    }
  }
  const log = path.resolve(ar, lite.log || path.join('automation-logs', path.basename(rr), 'run-progress-' + stamp().slice(0, 16) + '.log'));
  const argv = ['--run-file', runFile, '--stage', stageName, '--run', runKind, '--stage-tcs', stageTcs.join(','), '--ceilings', 'auto', '--log', log, '--project', lite.project || 'chromium', '--extra', 'workers=' + workers];
  if (specs.length) argv.push('--spec', specs.join(','));
  if (csv(args.tcs).length) argv.push('--tcs', csv(args.tcs).join(','));
  if (plan && plan.outcome === 'OK' && workers > 1) argv.push('--units', planFile);
  // burn-in: the heal log reaches the run file only at finalize, so the healed timing / flaky / race TCs are named here
  if (runKind === 'rerun') argv.push('--burn-in', csv(args['burn-in']).length ? csv(args['burn-in']).join(',') : 'auto');
  for (const k of ['cli', 'env-id', 'timeouts', 'cmd', 'capacity-dir']) if (typeof args[k] === 'string') argv.push('--' + k, args[k]);
  if (args.headless) argv.push('--headless');
  const withoutLedger = (xs) => [...xs.map((x) => (/^workers=\d+$/.test(x) ? 'workers=1' : x)).filter((x, i, a) => !(x === '--units' || a[i - 1] === '--units')), '--no-ledger'];
  let r = spawnJson('run-stage.mjs', noLedger ? withoutLedger(argv) : argv, { cwd: ar });
  let p = r.json;
  let memoryGate = memNote || (lite.no_ledger ? 'bypassed (low memory at preflight — serial, no ledger)' : null);
  // Lite has NO host-memory gate: Full's "insufficient capacity" (nothing started) is retried once serially without the ledger
  if (p && p.outcome === 'BLOCKED' && !noLedger && isMemoryReason(String(p.reason || ''))) {
    noLedger = true; workers = 1; memoryGate = 'bypassed after "' + String(p.reason).slice(0, 80) + '" (serial, no ledger)';
    setLite(runFile, { no_ledger: true, no_ledger_reason: 'low host memory at a stage (Lite ignores the memory gate)' });
    r = spawnJson('run-stage.mjs', withoutLedger(argv), { cwd: ar });
    p = r.json;
  }
  if (!p) return blocked(args, 'stage', 'run-stage gave no result' + (r.error ? ': ' + r.error : ''), { stderr: r.stderr });
  const used = Math.max(0, ...((p.groups || []).map((g) => Number(g.workers) || 0)));
  const outcome = p.outcome === 'COMPLETED' ? 'COMPLETED' : /^STOPPED/.test(p.outcome) ? 'STOPPED' : p.outcome === 'NOT_RUN' ? 'NOT_RUN' : 'BLOCKED';
  const failing = uniq((p.failures || []).flatMap((f) => f.tcs || [])).slice(0, 15);
  let next;
  if (outcome !== 'COMPLETED') next = 'fix: ' + (p.reason || p.outcome);
  else if (stageName === 'smoke' && p.smokeGate && Number(p.smokeGate.failPct) > SMOKE_LIMIT) next = 'smoke gate failed — classify, heal test code (≤ 2), retry smoke or finalize';
  else if (p.smokeGate && p.smokeGate.decision === 'no_verdict') next = 'smoke NO VERDICT — fix and retry smoke';
  else if (failing.length) next = 'classify ' + failing.length + ' failure(s) (artifacts/diagnostics only for those), heal test-code defects, then the next stage';
  else next = stageName === 'smoke' ? 'positive' : stageName === 'positive' ? 'negative' : 'rerun-select / stage 4';
  return finish(args, 'stage', {
    outcome, stage: stageName, run: runKind, stageOutcome: p.outcome, counts: p.counts || null, workers: used, workerCap: maxWorkers, scheduler: p.scheduler ? p.scheduler.used : null,
    ...(memoryGate ? { memoryGate } : {}),
    ...(p.scheduler && p.scheduler.fallback ? { serialBecause: p.scheduler.fallback } : {}), ...(planNote && planNote !== 'OK' ? { readiness: planNote } : {}),
    smokeGate: p.smokeGate ? { failPct: p.smokeGate.failPct, limit: p.smokeGate.limit, decision: p.smokeGate.decision } : undefined,
    failing, notRun: (p.notRun || []).length, ...(p.reason ? { reason: p.reason } : {}), summaryLog: p.summaryLog || null, next,
  }, { payload: p }, rr);
}

/* ---------------- teardown ---------------- */

/** One serial setup-stage group (no TC, no result row) through run-stage: the teardown journey, the auth probe. */
async function runSetupGroup(args, { runFile, group, spec, purpose, env = {} }) {
  const run = readJson(runFile) || {};
  const rr = path.dirname(path.dirname(runFile));
  const rs = await load('run-stage.mjs');
  const ar = rs.automationRootOf(runFile, run);
  const lite = run.lite || {};
  const plan = run.run_plan || {};
  writeJsonAtomic(runFile, { ...run, run_plan: { ...plan, setup_groups: [...(plan.setup_groups || []).filter((g) => g && g.name !== group), { name: group, mode: 'serial', workers: 1, spec, purpose }] } });
  const log = path.resolve(ar, lite.log || path.join('automation-logs', path.basename(rr), 'run-progress-' + stamp().slice(0, 16) + '.log'));
  const argv = ['--run-file', runFile, '--stage', 'setup', '--run', 'first', '--groups', group, '--ceilings', 'auto', '--log', log, '--project', String(lite.project || 'chromium').split(',')[0], '--no-ledger'];
  for (const k of ['cli', 'env-id', 'timeouts', 'cmd', 'capacity-dir']) if (typeof args[k] === 'string') argv.push('--' + k, args[k]);
  if (args.headless) argv.push('--headless');
  const r = spawnJson('run-stage.mjs', argv, { cwd: ar, env: { ...process.env, ...env } });
  return { p: r.json, error: r.error, stderr: r.stderr };
}

/** The run-level restore / reset (real server time, seed reset, outbox …) ONCE per run, after the last stage or re-run and
 *  before finalize — never in each stage command's afterAll. The journey is a spec tagged `@setup @run:teardown`; it runs as
 *  Full's setup stage (group `teardown`, serial, no TC), so merge, impact and the smoke gate never count it as a result. */
export async function teardown(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'teardown', miss);
  if (typeof args['run-file'] !== 'string') return blocked(args, 'teardown', '--run-file is required');
  const runFile = path.resolve(args['run-file']);
  const run = readJson(runFile);
  if (!run) return blocked(args, 'teardown', 'run file unreadable: ' + args['run-file']);
  const rr = path.dirname(path.dirname(runFile));
  const rs = await load('run-stage.mjs');
  const ar = rs.automationRootOf(runFile, run);
  const lite = run.lite || {};
  let spec = typeof args.spec === 'string' ? posix(args.spec) : (lite.teardown && lite.teardown.spec) || null;
  if (!spec) return blocked(args, 'teardown', '--spec <the teardown journey> is required (annotation { type: \'journey\', description: \'teardown\' }, tags @setup @run:teardown)');
  // automation-root relative or project relative (L15)
  const absSpec = [path.resolve(ar, spec), path.resolve(rs.projectRootOf(ar, args.root), spec), path.resolve(spec)].find(isFile);
  if (!absSpec) return blocked(args, 'teardown', 'teardown spec not found: ' + spec);
  spec = posix(path.relative(ar, absSpec));
  // the run file lists the journey (Checkpoint A exempts a LISTED, DECLARED journey from the [TC-ID] rule)
  const root = rs.projectRootOf(ar, args.root);
  const declared = (await journeysOf(root, [posix(path.relative(root, absSpec))])).filter((j) => j.kind === 'teardown');
  const journeys = [...(lite.journeys || []).filter((j) => j.spec !== spec), ...(declared.length ? [{ spec, kind: 'teardown', tests: declared.length }] : [])];
  writeJsonAtomic(runFile, { ...run, lite: { ...lite, teardown: { spec }, journeys } });
  const { p, error, stderr } = await runSetupGroup(args, { runFile, group: 'teardown', spec, purpose: 'teardown' });
  if (!p) return blocked(args, 'teardown', 'run-stage gave no result' + (error ? ': ' + error : ''), { stderr });
  const sumFile = typeof p.summaryFile === 'string' ? [path.resolve(ar, p.summaryFile), path.resolve(rr, p.summaryFile), path.resolve(p.summaryFile)].find(isFile) : null;
  const j = p.journeys || ((sumFile && readJson(sumFile)) || {}).journeys || {}; // the setup stage's journey counts live in its summary
  const outcome = p.outcome !== 'COMPLETED' ? (/^STOPPED/.test(p.outcome) ? 'STOPPED' : 'BLOCKED') : (Number(j.passed) > 0 && !Number(j.failed) && !Number(j.other) ? 'COMPLETED' : 'FAIL');
  return finish(args, 'teardown', {
    outcome, spec, journeys: { passed: j.passed ?? 0, failed: j.failed ?? 0, other: j.other ?? 0 }, ...(declared.length ? {} : { warning: 'the teardown spec declares no journey annotation — Checkpoint A will hold it to the [TC-ID] rule' }), ...(p.reason ? { reason: p.reason } : {}), summaryLog: p.summaryLog || null,
    next: outcome === 'COMPLETED' ? 'stage 4 — finalize' : 'the restore / reset did not complete — read the reason, fix the teardown journey (never a TC), run teardown again; report what stayed changed under Deviations',
  }, { payload: p }, rr);
}

/* ---------------- journey (L10) ---------------- */

/** Lists setup / teardown journeys in the run file (`lite.journeys`). Each file must DECLARE its journey (annotation
 *  `{ type: 'journey', description: 'setup' | 'teardown' }`) and no journey title may carry a [TC-ID] — the two signals together
 *  are what exempts a journey from "every title carries a [TC-ID]" at Checkpoint A; every other rule still applies. */
export async function journey(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'journey', miss);
  if (typeof args['run-file'] !== 'string' || !csv(args.spec).length) return blocked(args, 'journey', '--run-file and --spec a,b (automation-root or project relative) are required');
  const runFile = path.resolve(args['run-file']);
  const run = readJson(runFile);
  if (!run) return blocked(args, 'journey', 'run file unreadable: ' + args['run-file']);
  const rs = await load('run-stage.mjs');
  const ar = rs.automationRootOf(runFile, run);
  const root = rs.projectRootOf(ar, args.root);
  const out = [];
  for (const s of csv(args.spec)) {
    const abs = [path.resolve(ar, s), path.resolve(root, s), path.resolve(s)].find(isFile);
    if (!abs) return blocked(args, 'journey', 'journey spec not found: ' + s);
    const js = await journeysOf(root, [posix(path.relative(root, abs))]);
    if (!js.length) return blocked(args, 'journey', s + ' declares no journey — add annotation { type: \'journey\', description: \'setup\' | \'teardown\' } to the test or its describe');
    const bad = js.filter((j) => tcIdsOf(j.title || '').length);
    if (bad.length) return blocked(args, 'journey', s + ':' + bad[0].line + ' journey title carries a [TC-ID] — a journey is never a result');
    out.push({ spec: posix(path.relative(ar, abs)), kind: uniq(js.map((j) => j.kind)).join(','), tests: js.length });
  }
  const lite = run.lite || {};
  const keep = (lite.journeys || []).filter((j) => !out.some((o) => o.spec === j.spec));
  writeJsonAtomic(runFile, { ...run, lite: { ...lite, journeys: [...keep, ...out] } });
  return finish(args, 'journey', { outcome: 'OK', journeys: [...keep, ...out], next: 'include the journey files in checkpoint-a / finalize --files (traceability exempts them from the [TC-ID] rule only)' });
}

/* ---------------- auth (P1) ---------------- */

const AUTH_MECH = ['cookie', 'token', 'other'];
const AUTH_RESET = ['true', 'false', 'no-reset'];
const AUTH_LANG = ['profile', 'session', 'cookie', 'none'];
/** The sign-in strategy from what was probed (or learned) about THIS app — never from the story:
 *  sessions survive the environment reset (or there is none) → a setup project signs in once per role (× language when the
 *  language lives in the session / a cookie) and saves storageState; a reset ends sessions → an API sign-in helper after each
 *  reset; no API sign-in path → UI sign-in, recorded with its reason. */
export function authStrategy({ mechanism, survivesReset, languageScope = 'none', apiSignin = null, fallbackReason = null }) {
  const errors = [];
  if (!AUTH_MECH.includes(mechanism)) errors.push('--mechanism ' + AUTH_MECH.join('|'));
  if (!AUTH_RESET.includes(String(survivesReset))) errors.push('--survives-reset ' + AUTH_RESET.join('|'));
  if (!AUTH_LANG.includes(languageScope)) errors.push('--language-scope ' + AUTH_LANG.join('|'));
  if (errors.length) return { error: 'missing or invalid: ' + errors.join(', ') };
  const per = ['role', ...(languageScope === 'session' || languageScope === 'cookie' ? ['language'] : [])];
  if (String(survivesReset) !== 'false') return { strategy: 'setup-project', per, why: String(survivesReset) === 'no-reset' ? 'no environment reset — a session lives for the run' : 'sessions survive the environment reset' };
  if (apiSignin === 'yes') return { strategy: 'api-helper', per: ['role'], why: 'the reset ends sessions — sign in through the API after each reset' };
  if (apiSignin === 'no') return fallbackReason && String(fallbackReason).trim().length >= 8 ? { strategy: 'ui-fallback', per: ['role'], why: String(fallbackReason).trim() } : { error: 'no API sign-in path: UI sign-in is the fallback — give --fallback-reason "why no faster path exists" (≥ 8 chars)' };
  return { error: 'the reset ends sessions: say whether the app offers an API sign-in (--api-signin yes|no)' };
}
const authDir = (ar) => path.join(ar, '.auth');
/** Stored sessions (storageState) are live credentials: remove them at close-out; returns how many files went. */
export function clearAuthState(ar) {
  const d = authDir(ar);
  const n = readdirSafe(d).filter((f) => /\.json$/i.test(f)).length;
  fs.rmSync(d, { recursive: true, force: true });
  return n;
}
/** `.auth/` is git-ignored in the automation root (a session file never reaches a commit). */
function ignoreAuthDir(ar) {
  const gi = path.join(ar, '.gitignore');
  const text = read(gi) || '';
  if (/^\/?\.auth\/?\s*$/m.test(text)) return false;
  writeBytesAtomic(gi, Buffer.from(text + (text && !text.endsWith('\n') ? '\n' : '') + '# stored sessions (storageState) — live credentials, never committed\n.auth/\n', 'utf8'));
  return true;
}

export async function auth(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'auth', miss);
  if (typeof args['run-file'] !== 'string') return blocked(args, 'auth', '--run-file is required');
  const runFile = path.resolve(args['run-file']);
  const run = readJson(runFile);
  if (!run) return blocked(args, 'auth', 'run file unreadable: ' + args['run-file']);
  const rs = await load('run-stage.mjs');
  const ar = rs.automationRootOf(runFile, run);
  if (args.clear) return finish(args, 'auth', { outcome: 'OK', removed: clearAuthState(ar), dir: rel(process.cwd(), authDir(ar)) });
  // the facts: a probe file the auth setup journey wrote (names and booleans only — never a value), else the flags
  let facts = {}; let source = 'flags'; let probeRun = null;
  // --probe-spec: run the auth setup journey ONCE in probe mode (PW_AUTH_PROBE=1) as a setup stage; it writes .auth/probe.json
  if (typeof args['probe-spec'] === 'string') {
    const spec = posix(args['probe-spec']);
    if (!isFile(path.resolve(ar, spec))) return blocked(args, 'auth', 'probe spec not found under the automation root: ' + spec);
    const envClass = run.environment && run.environment.class;
    if (!['test', 'staging'].includes(envClass)) return blocked(args, 'auth', 'the probe signs in and may call the environment reset — only on a test / staging environment (class ' + (envClass || 'none') + '); record what the learning file or the user knows with --mechanism / --survives-reset / --language-scope instead');
    fs.rmSync(path.join(authDir(ar), 'probe.json'), { force: true });
    probeRun = await runSetupGroup(args, { runFile, group: 'auth-probe', spec, purpose: 'auth probe', env: { PW_AUTH_PROBE: '1' } });
    if (!probeRun.p) return blocked(args, 'auth', 'run-stage gave no result for the probe' + (probeRun.error ? ': ' + probeRun.error : ''));
    if (!isFile(path.join(authDir(ar), 'probe.json'))) return blocked(args, 'auth', 'the probe journey wrote no .auth/probe.json (' + (probeRun.p.reason || probeRun.p.outcome) + ') — fix the journey, or record what the learning file / the user knows with the flags');
    args.probe = '.auth/probe.json';
  }
  if (typeof args.probe === 'string') {
    const pf = [path.resolve(ar, args.probe), path.resolve(args.probe)].find(isFile);
    const pj = pf ? readJson(pf) : null;
    if (!pj) return blocked(args, 'auth', 'probe file unreadable: ' + args.probe);
    const extra = Object.keys(pj).filter((k) => !['mechanism', 'survives_reset', 'language_scope', 'cookie_names', 'storage_keys', 'checked_at', 'note'].includes(k));
    if (extra.length) return blocked(args, 'auth', 'the probe file may hold names and booleans only — unexpected key(s): ' + extra.join(', '));
    facts = { mechanism: pj.mechanism, survivesReset: pj.survives_reset === true ? 'true' : pj.survives_reset === false ? 'false' : pj.survives_reset, languageScope: pj.language_scope };
    source = 'probe';
  }
  const pick = (k, f) => (typeof args[k] === 'string' ? args[k] : f);
  const input = { mechanism: pick('mechanism', facts.mechanism), survivesReset: pick('survives-reset', facts.survivesReset), languageScope: pick('language-scope', facts.languageScope || 'none'), apiSignin: pick('api-signin', null), fallbackReason: pick('fallback-reason', null) };
  if (source === 'probe' && ['mechanism', 'survives-reset', 'language-scope'].some((k) => typeof args[k] === 'string')) source = 'probe+flags';
  if (typeof args.source === 'string' && ['learning', 'probe', 'flags'].includes(args.source)) source = args.source;
  const st = authStrategy(input);
  if (st.error) return blocked(args, 'auth', st.error);
  const record = { mechanism: input.mechanism, survives_reset: input.survivesReset === 'true' ? true : input.survivesReset === 'false' ? false : 'no-reset', language_scope: input.languageScope, api_signin: input.apiSignin, strategy: st.strategy, per: st.per, why: st.why, state_dir: '.auth', source, recorded_at: new Date().toISOString() };
  if (st.strategy === 'ui-fallback') record.fallback_reason = st.why;
  const ignored = st.strategy === 'setup-project' ? ignoreAuthDir(ar) : false;
  writeJsonAtomic(runFile, { ...run, auth: record });
  return finish(args, 'auth', {
    outcome: 'OK', strategy: st.strategy, per: st.per, why: st.why, source, ...(ignored ? { gitignore: '.auth/ added' } : {}),
    next: st.strategy === 'setup-project' ? 'assets/templates/auth.setup.ts → a setup project (dependency of the browser project) that saves .auth/{role}' + (st.per.includes('language') ? '-{language}' : '') + '.json; specs: test.use({ storageState: storageStateFor(role) }) — lite journey for the setup file'
      : st.strategy === 'api-helper' ? 'assets/templates/auth.ts signInAs(context, role) after each reset — UI sign-in only in TCs about sign-in itself'
        : 'UI sign-in stays (reason recorded) — once per role switch, never repeated inside a page object',
  });
}

/* ---------------- rerun-select ---------------- */

export async function rerunSelect(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'rerun-select', miss);
  if (typeof args['run-file'] !== 'string') return blocked(args, 'rerun-select', '--run-file is required');
  const runFile = path.resolve(args['run-file']);
  const run = readJson(runFile);
  if (!run) return blocked(args, 'rerun-select', 'run file unreadable');
  const rr = path.dirname(path.dirname(runFile));
  const rs = await load('run-stage.mjs');
  const ar = rs.automationRootOf(runFile, run);
  const impact = await load('impact.mjs');
  const specs = (csv(args.spec).length ? csv(args.spec) : ((run.lite || {}).specs || [])).map((f) => path.resolve(ar, f));
  if (!specs.length) return blocked(args, 'rerun-select', 'no specs: pass --spec or run checkpoint-a once (it records the spec list)');
  let sel;
  try { sel = impact.selectStale({ root: ar, specs, progressDir: path.join(rr, 'artifacts', 'progress'), runPlan: run.run_plan || null }); } catch (e) { return blocked(args, 'rerun-select', 'the selection failed: ' + e.message); }
  const tcOf = (x) => (typeof x === 'string' ? x : x && (x.tc || x.id));
  const stale = uniq((sel.stale || []).map(tcOf).filter(Boolean));
  const expanded = uniq((sel.expanded || []).map(tcOf).filter(Boolean));
  const noVerdict = uniq((sel.no_verdict || []).map(tcOf).filter(Boolean));
  const set = uniq([...stale, ...expanded, ...noVerdict]);
  const stages = (run.lite || {}).stages || {};
  const byStage = Object.fromEntries(['smoke', 'positive', 'negative'].map((s) => [s, set.filter((tc) => (stages[s] || []).includes(tc))]));
  return finish(args, 'rerun-select', {
    outcome: 'OK', rerun: set, byStage, impactLevel: sel.impact_level || null, stale, expanded, noVerdict,
    neverRun: (sel.never_run || []).map(tcOf).slice(0, 20), memberOnly: (sel.fresh_by_member_only || []).map(tcOf), outsideScope: (sel.outside_scope || []).length,
    next: set.length ? 'checkpoint-a on the changed files, then stage --run rerun --tcs <the set per stage>' : 'Re-run not needed — no code changed after the first run and every TC has a verdict',
  }, { selection: sel }, rr);
}

/* ---------------- Checkpoint B + finalize ---------------- */

const RESULT_STATES = ['PASS', 'FAIL', 'INCOMPLETE', 'SKIP', 'NOT_RUN', 'PARTIAL'];

/** The three Lite checks of Checkpoint B — pure over (the draft run file, the verify checks, the freshness). */
export function evaluateB({ run, verify, fresh, snapshotId, automationRoot, failClasses, isFileFn = isFile, now }) {
  const at = now || new Date().toISOString();
  const rec = (checkId, status, reason, evidenceRef = []) => ({ checkId, unit: 'phase', snapshotId, status, reason, evidenceRef: evidenceRef.slice(0, 20), executor: 'V', at });
  const checks = (verify && verify.checks) || {};
  const pick = (ids) => ids.filter((i) => checks[i]).map((i) => ({ id: i, ...checks[i] }));
  const bad = (list) => list.filter((c) => c.status === 'FAIL');
  const open = (list) => list.filter((c) => c.status === 'unresolved');
  const rows = Array.isArray(run.results) ? run.results : [];
  // 1 — results integrity: the Full runtime checks that bind results to THIS execution + the FAIL→PASS rule + freshness
  const ri = pick(B_INTEGRITY);
  const evI = [...bad(ri).map((c) => c.id + ': ' + String(c.evidence || '').slice(0, 160)), ...open(ri).map((c) => c.id + ' unresolved: ' + String(c.evidence || '').slice(0, 160))];
  for (const r of rows) {
    if (r.status !== 'PASS') continue;
    for (const v of r.variants || []) {
      const last = (v.attempts || [])[(v.attempts || []).length - 1];
      if (!last || last.status !== 'PASS') evI.push(r.tc_id + ': PASS without a passing final attempt in ' + (v.variant_slug || 'variant'));
    }
  }
  const stale = (fresh && fresh.stale) || [];
  if (stale.length) evI.push('stale results (ran on older code): ' + stale.map((s) => s.tc || s).join(', '));
  const integrityFail = evI.some((e) => !/unresolved:/.test(e) && !/^stale/.test(e)) ;
  const integrity = !evI.length ? rec('lite:results-integrity', 'verified-mechanical', 'results belong to this execution: heartbeats before teardown, artifacts on disk, plan honoured, data changes owned, no stale result; every PASS ends on a passing attempt')
    : rec('lite:results-integrity', integrityFail ? 'FAIL' : 'unresolved', evI.length + ' integrity problem(s)', evI);
  // 2 — final TC status & coverage
  const cv = pick(B_COVERAGE);
  const evC = [...bad(cv).map((c) => c.id + ': ' + String(c.evidence || '').slice(0, 160)), ...open(cv).map((c) => c.id + ' unresolved: ' + String(c.evidence || '').slice(0, 160))];
  const planned = uniq(((run.run_plan && run.run_plan.groups) || []).flatMap((g) => g.tcs || []));
  const seen = new Map();
  for (const r of rows) seen.set(r.tc_id, (seen.get(r.tc_id) || 0) + 1);
  for (const tc of planned) if (!seen.has(tc)) evC.push(tc + ': in scope but no results[] row (every in-scope TC needs a final status)');
  for (const [tc, n] of seen) if (n > 1) evC.push(tc + ': ' + n + ' conflicting result rows');
  for (const r of rows) if (!RESULT_STATES.includes(r.status)) evC.push(r.tc_id + ': status "' + r.status + '" is not one of ' + RESULT_STATES.join(' / '));
  for (const r of rows) if (['NOT_RUN', 'SKIP', 'INCOMPLETE'].includes(r.status) && (!r.classification || r.classification === 'N/A') && !r.status_reason) evC.push(r.tc_id + ': ' + r.status + ' without a reason (never silently excluded)');
  const covFail = evC.some((e) => !/unresolved:/.test(e));
  const coverage = !evC.length ? rec('lite:tc-status-coverage', 'verified-mechanical', rows.length + ' in-scope TC(s) each carry one final status (' + RESULT_STATES.join('/') + ' preserved); skips and prerequisites visible with a reason')
    : rec('lite:tc-status-coverage', covFail ? 'FAIL' : 'unresolved', evC.length + ' status / coverage problem(s)', evC);
  // 3 — failure evidence & defect classification
  const evF = [];
  const assumed = new Set((run.unverified_assumptions || []).map((a) => a.tc_id));
  const layerOf = (tc) => String((run.run_plan && run.run_plan.layers && run.run_plan.layers[tc]) || 'ui');
  const imgLayer = (l) => !/^(api|db|api\+db)$/.test(l);
  const recLayer = (l) => /api|db|hybrid/.test(l);
  const classes = failClasses || [];
  for (const r of rows) {
    if (r.status !== 'FAIL') continue;
    if (!r.classification || r.classification === 'N/A') { evF.push(r.tc_id + ': FAIL without a classification'); continue; }
    if (classes.length && !classes.includes(r.classification) && !/^(incomplete|interrupted|not started|out of tool):|^rate_limited$/.test(String(r.classification))) evF.push(r.tc_id + ': classification "' + r.classification + '" is outside the vocabulary');
    if (r.classification === 'app_bug' && (assumed.has(r.tc_id) || (r.variants || []).some((v) => (v.attempts || []).some((a) => a.unverified_assumption)))) evF.push(r.tc_id + ': an @unverified-assumption test is never app_bug');
    if (r.classification === 'app_bug' && !String(r.root_cause || r.assumption || '').trim()) evF.push(r.tc_id + ': app_bug without the original expected outcome / root cause on record');
    const failed = (r.variants || []).flatMap((v) => (v.attempts || []).filter((a) => a.status === 'FAIL'));
    if (!failed.length) evF.push(r.tc_id + ': FAIL row with no failing attempt in its history');
    const l = layerOf(r.tc_id);
    for (const a of failed) {
      if (imgLayer(l) && run.delivery && run.delivery.screenshots !== 'none') { if (!a.failure_screenshot || !isFileFn(path.join(automationRoot, a.failure_screenshot))) evF.push(r.tc_id + ' attempt ' + a.attempt + ': failure image missing'); }
      if (recLayer(l)) { if (!a.failure_record || !isFileFn(path.join(automationRoot, a.failure_record))) evF.push(r.tc_id + ' attempt ' + a.attempt + ': failure record missing'); }
    }
  }
  const failure = !evF.length ? rec('lite:failure-evidence', 'verified-mechanical', rows.filter((r) => r.status === 'FAIL').length + ' failure(s): classified (app bug / automation / environment / data), evidence on disk, original outcome kept')
    : rec('lite:failure-evidence', 'FAIL', evF.length + ' failure-evidence problem(s)', evF);
  const results = [integrity, coverage, failure];
  const verdict = results.some((r) => r.status === 'FAIL') ? 'FAIL' : results.some((r) => r.status === 'unresolved') ? 'BLOCKED' : 'PASS';
  const advisory = Object.entries(checks).filter(([id, c]) => !B_INTEGRITY.includes(id) && !B_COVERAGE.includes(id) && (c.status === 'FAIL')).map(([id, c]) => id + ': ' + String(c.evidence || '').slice(0, 120));
  return { verdict, results, advisory };
}

export async function finalize(args) {
  const miss = fullMissing(); if (miss) return blocked(args, 'finalize', miss);
  const root = path.resolve(args.root || process.cwd());
  if (typeof args['results-root'] !== 'string' || !(Number(args.phase) > 0)) return blocked(args, 'finalize', '--results-root and --phase are required');
  const rr = path.resolve(root, args['results-root']);
  const N = Number(args.phase);
  const files = csv(args.files);
  if (!files.length) return blocked(args, 'finalize', '--files (the final in-scope files) is required — Checkpoint B covers the final code');
  const check = await load('check.mjs');
  const rd = await load('run-data.mjs');
  const rend = await load('render-run-report.mjs');
  const lock = rd.acquireFinalizeLock(rr, N);
  if (!lock.ok) return blocked(args, 'finalize', lock.reason);
  const steps = [];
  const stop = (outcome, step, reason, extra = {}) => finish(args, 'finalize', { outcome, step, reason, steps: steps.map((s) => s.step + (s.ok === false ? ' ✗' : ' ✓')).join(' · '), ...extra }, { steps }, rr);
  try {
    const autoRel = await automationRootOf(root, args['automation-root'], rr);
    const autoAbs = path.resolve(root, autoRel);
    const dd = draftDir(rr, N);
    const draftRun = path.join(dd, '.runs', 'phase-' + N + '.json');
    const pub = readJson(path.join(rr, '.runs', 'phase-' + N + '.json'));
    const feature = args.feature || (pub && pub.feature) || null;
    // Checkpoint A must cover the final code at its current content (refresh it on healed files first)
    const scope = files.map((f) => posix(path.relative(root, path.resolve(root, f))));
    let a = check.checkpointAApplies({ root, resultsRoot: rr, phase: N, files: scope });
    // a Checkpoint A that does not cover the final code (a healed file, a narrower refresh) is refreshed HERE on the whole
    // final scope with the inputs of the last PASS — the same four checks, nothing bypassed; only a FAIL stops finalize
    const inputs = pub && pub.lite && pub.lite.checkpoint_a;
    if (!a.ok && inputs && isFile(check.gateRecordPath(rr, N, 'A'))) {
      const argv = ['checkpoint-a', '--root', root, '--automation-root', autoRel, '--results-root', rr, '--phase', String(N), '--files', scope.join(',')];
      const tc = args.tc || inputs.tc; const data = args.data || inputs.data; const req = csv(args.req).length ? csv(args.req) : (inputs.req || []);
      if (tc) argv.push('--tc', tc); if (data) argv.push('--data', data); if (req.length) argv.push('--req', req.join(','));
      if (inputs.coverage) argv.push('--coverage', inputs.coverage);
      for (const k of ['tsc', 'cli']) if (typeof args[k] === 'string') argv.push('--' + k, args[k]);
      const sp = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv], { cwd: root, encoding: 'utf8', env: process.env, timeout: 900000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      let ra = null; try { ra = JSON.parse(String(sp.stdout || '').trim().split(/\r?\n/).pop()); } catch { ra = null; }
      steps.push({ step: 'checkpoint-A refresh', ok: !!ra && ra.outcome === 'PASS' });
      if (!ra || ra.outcome !== 'PASS') return stop('BLOCKED', 'checkpoint-A', 'Checkpoint A refreshed on the final scope: ' + (ra ? ra.outcome : 'no result') + ' — fix what it names (an assertion review must name its new snapshot: run checkpoint-a with --assertion-review), then finalize again', { checkpointA: ra ? { snapshotId: ra.snapshotId, checks: ra.checks, problems: ra.problems, reason: ra.reason } : null });
      a = check.checkpointAApplies({ root, resultsRoot: rr, phase: N, files: scope });
    }
    steps.push({ step: 'checkpoint-A', ok: a.ok });
    if (!a.ok) return stop('BLOCKED', 'checkpoint-A', a.reason, { uncovered: a.uncovered.slice(0, 10) });
    if (!isFile(draftRun)) {
      if (!feature) return stop('BLOCKED', 'drafts', '--feature is required (the run file names none)');
      const d = rd.initDrafts({ resultsRoot: rr, phase: N, feature });
      steps.push({ step: 'draft-init', ok: d.outcome === 'CREATED' });
      if (!isFile(draftRun)) return stop('BLOCKED', 'draft-init', d.reason || 'the drafts could not be created');
    } else steps.push({ step: 'draft-init', ok: true });
    const m1 = rd.runData({ _: ['merge'], 'run-file': draftRun, write: true });
    steps.push({ step: 'merge', ok: m1.outcome === 'OK' });
    if (m1.outcome !== 'OK') return stop('BLOCKED', 'merge', m1.reason || 'merge failed');
    if (args.judgements) {
      const jg = rd.runData({ _: ['judge'], 'run-file': draftRun, judgements: path.resolve(root, args.judgements), write: true });
      steps.push({ step: 'judge', ok: jg.outcome === 'OK' });
      if (jg.outcome !== 'OK') return stop('BLOCKED', 'judge', 'the judgements were rejected as a whole — nothing written', { errors: (jg.errors || []).slice(0, 10), reason2: jg.reason });
    }
    const fr = await check.freshnessCheck({ root, automationRoot: autoRel, files: files.map((f) => posix(path.relative(root, path.resolve(root, f)))), resultsRoot: rr, runFile: draftRun });
    steps.push({ step: 'freshness', ok: fr.ok && !(fr.stale || []).length });
    if (!fr.ok) return stop('BLOCKED', 'freshness', fr.reason);
    if (fr.stale.length) return stop('BLOCKED', 'freshness', fr.stale.length + ' reported result(s) ran on older code — rerun-select, then stage --run rerun', { stale: fr.stale.slice(0, 15).map((s) => s.tc) });
    const ac = rd.runData({ _: ['acceptance'], 'run-file': draftRun, write: true });
    steps.push({ step: 'acceptance(pre)', ok: !!ac.acceptance });
    const f2 = feature || (readJson(draftRun) || {}).feature;
    const draftReport = path.join(dd, 'TEST-RUN-REPORT-' + f2 + '.md');
    const rp = rd.runData({ _: ['report'], 'run-file': draftRun, write: true, report: draftReport });
    steps.push({ step: 'report', ok: rp.outcome === 'OK' });
    if (rp.outcome !== 'OK') return stop('BLOCKED', 'report', rp.reason || 'the report could not be written');
    const draftBugs = path.join(dd, 'BUG-REPORT-' + f2 + '.md');
    const runNow = readJson(draftRun) || {};
    if (!isFile(draftBugs)) {
      if ((runNow.bugs || []).length) return stop('BLOCKED', 'bugs', (runNow.bugs || []).length + ' bug(s) in the run file but no draft bug file — write the `### BUG-n` entries into ' + posix(path.relative(root, draftBugs)) + ' (narratives are yours), then finalize again');
      writeBytesAtomic(draftBugs, Buffer.from(['# Bug Report — ' + f2, '', '**User Story:** ' + ([runNow.user_story_id, runNow.user_story].filter(Boolean).join(' — ') || '—'), '**Feature:** ' + f2, '**Latest phase:** ' + N, '**Bugs:** 0 open · 0 resolved · 0 not checked this run of 0', '**Run report:** TEST-RUN-REPORT-' + f2 + '.md', '', '## Bugs', '', 'none', ''].join('\n'), 'utf8'));
    } else {
      const bt = fs.readFileSync(draftBugs, 'utf8');
      const missing = (runNow.bugs || []).filter((b) => !new RegExp('^###\\s+' + b.id + '\\b', 'm').test(bt)).map((b) => b.id);
      if (missing.length) return stop('BLOCKED', 'bugs', 'the draft bug file has no entry for ' + missing.join(', ') + ' — write them, then finalize again');
      const next = rd.refreshBugHeader(bt, N);
      if (next !== bt) writeBytesAtomic(draftBugs, Buffer.from(next, 'utf8'));
    }
    const format = rd.deliveryOf(runNow).report;
    const pg = rend.render({ reportPath: draftReport, bugsPath: draftBugs, runsDir: path.join(dd, '.runs'), base: rr, root: rr });
    steps.push({ step: format === 'html' ? 'draft page' : 'renderer gate', ok: !!(pg.html && pg.payload.gate === 'PASS') });
    if (!pg.html || pg.payload.gate !== 'PASS') return stop('BLOCKED', 'draft page', 'the renderer gate on the drafts is ' + (pg.payload ? pg.payload.gate + ' (' + (pg.payload.gateReason || '') + ')' : 'unknown'), { mismatches: ((pg.payload && pg.payload.mismatches) || []).slice(0, 5) });
    if (format === 'html') writeBytesAtomic(path.join(dd, 'TEST-RUN-REPORT-' + f2 + '.html'), Buffer.from(pg.html, 'utf8'));
    else fs.rmSync(path.join(dd, 'TEST-RUN-REPORT-' + f2 + '.html'), { force: true });
    // ---- Lite Checkpoint B: freeze, three checks, gate record, publish ----
    const s = check.takeSnapshot({ root, resultsRoot: rr, checkpoint: 'B', phase: N, files, tc: args.tc, data: args.data, req: csv(args.req), automationRoot: autoRel, runFile: draftRun, draftsDir: dd });
    const sid = s.snapshotId;
    steps.push({ step: 'freeze', ok: !!s.snapshot.body.drafts });
    if (!s.snapshot.body.drafts) return stop('BLOCKED', 'freeze', 'the drafts folder is empty — Checkpoint B freezes the drafts', { snapshotId: sid });
    const verify = rd.runData({ _: ['verify'], 'run-file': draftRun, 'results-root': rr });
    steps.push({ step: 'verify', ok: !!verify.checks });
    if (!verify.checks) return stop('BLOCKED', 'verify', 'the runtime checks could not run: ' + (verify.reason || verify.outcome), { snapshotId: sid });
    const draftJson = readJson(draftRun) || {};
    const freshState = { stale: fr.stale, source: 'freshnessCheck', known: true };
    const ev = evaluateB({ run: draftJson, verify, fresh: freshState, snapshotId: sid, automationRoot: autoAbs, failClasses: rd.FAIL_CLASSES });
    const rehashResult = check.rehash(s.snapshot);
    let verdict = ev.verdict;
    if (!rehashResult.matched) verdict = 'BLOCKED';
    const fail = ev.results.filter((r) => r.status === 'FAIL').map((r) => ({ checkId: r.checkId, unit: r.unit, reason: r.reason }));
    const open = ev.results.filter((r) => r.status === 'unresolved').map((r) => ({ checkId: r.checkId, unit: r.unit, reason: r.reason }));
    const rec = {
      schema: 'skill5-gate/1', checkpoint: 'B', phase: N, verdict, profile: PROFILE, liteVersion: LITE_VERSION, snapshotId: sid, snapshotFile: 'artifacts/checks/' + sid + '/snapshot.json', decidedAt: new Date().toISOString(),
      rehash: { matched: rehashResult.matched, differences: rehashResult.differences.slice(0, 50) }, results: ev.results,
      rejected: rehashResult.matched ? [] : [{ checkId: '*', unit: 'snapshot', why: 'void', detail: rehashResult.differences.length + ' difference(s) after the freeze' }], na: [], closed: [], open, fail, auto: [], advisory: ev.advisory,
      freshness: freshState, frozen: { drafts: s.snapshot.body.drafts || {} }, gateA: s.snapshot.body.gateA,
      counts: { required: 3, accepted: ev.results.length, rejected: rehashResult.matched ? 0 : 1, fail: fail.length, open: open.length, closed: 0, na: 0, auto: 0 },
      tools: s.snapshot.body.tools, executors: ['V'], scopeDigest: s.snapshot.body.scopeDigest || null,
    };
    const gateFile = check.gateRecordPath(rr, N, 'B');
    writeJsonAtomic(gateFile, rec);
    writeJsonAtomic(path.join(check.checksDir(rr, sid), 'gate-B.json'), rec);
    steps.push({ step: 'gate-B', ok: verdict === 'PASS' });
    const checksView = Object.fromEntries(ev.results.map((r) => [r.checkId.replace('lite:', ''), r.status === 'verified-mechanical' ? 'PASS' : r.status === 'FAIL' ? 'FAIL' : 'OPEN']));
    if (verdict !== 'PASS') return stop(verdict, 'gate-B', 'Checkpoint B ' + verdict + ' — nothing is published', { snapshotId: sid, checks: checksView, problems: ev.results.filter((r) => r.status !== 'verified-mechanical').flatMap((r) => r.evidenceRef.map((e) => r.checkId.replace('lite:', '') + ': ' + e)).slice(0, 12), advisory: ev.advisory.slice(0, 5) });
    const p = rd.publishPhase({ resultsRoot: rr, phase: N, feature: f2, root: rr, expectSnapshotId: sid });
    steps.push({ step: 'publish', ok: p.outcome === 'PUBLISHED' });
    if (p.outcome !== 'PUBLISHED') return stop(p.outcome === 'NOT_RUN' ? 'NOT_RUN' : 'BLOCKED', 'publish', p.reason);
    const fin = rd.runData({ _: ['acceptance'], 'run-file': path.join(rr, '.runs', 'phase-' + N + '.json') });
    steps.push({ step: 'acceptance', ok: !!fin.acceptance });
    const accepted = fin.acceptance && fin.acceptance.verdict === 'ACCEPTED';
    // close-out: stored sessions are live credentials — never left behind a published run (P1)
    const authRemoved = clearAuthState(autoAbs);
    steps.push({ step: 'auth state removed (' + authRemoved + ')', ok: true });
    return stop('PUBLISHED', 'publish', p.reason, {
      statusLines: p.statusLines || null, ...(authRemoved ? { authStateRemoved: authRemoved } : {}),
      snapshotId: sid, checks: checksView, acceptance: fin.acceptance ? fin.acceptance.verdict : null, ...(accepted ? {} : { notAccepted: fin.acceptance ? fin.acceptance.reasons.slice(0, 5) : [] }),
      counts: draftJson.totals || null, report: rel(process.cwd(), path.join(rr, 'TEST-RUN-REPORT-' + f2 + '.md')), page: p.page || null, advisory: ev.advisory.slice(0, 5),
      next: accepted ? 'AUTOMATION COMPLETE: ADO close-out (only linked) → learning → lease release → return' : 'NOT ACCEPTED — return ## BLOCKED with these reasons',
    });
  } finally { lock.release(); }
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'lite', schema: LITE_SCHEMA, version: LITE_VERSION,
  usage: 'node lite.mjs init-run|consent|auth|preflight|cache|checkpoint-a|journey|stage|teardown|rerun-select|finalize [flags] [--json] [--pretty]',
  commands: {
    'init-run': '[--tc <TEST-CASES md | folder>; absent → the project\'s one TEST-CASES-*.md] [--data <TEST-DATA md>; default the sibling TEST-DATA-*.md] [--automation-root <dir>; default manifest → constitution → the project\'s Playwright config → tests/e2e (Spec Kit) / Testing/Automation] [--environment <name> --env-url <url> --env-class test|staging] [--report md|html] [--screenshots failed|all|none] [--max-workers N] [--project <config project; default the shared config\'s first>] [--tcs a,b] [--phase N] [--allow-data-changes all|TC,…|none] [--force] → the phase run file (stages, layers, run plan with projects + required variants, data-changes record); --force rewrites the latest phase while no stage has run',
    consent: '--run-file <f> --allow-data-changes all|TC,…|none [--env-class test|staging] → writes the data_changes record (consent, tcs, setup, cleanup, asked_at); never hand-written',
    teardown: '--run-file <f> --spec <teardown journey, automation-root or project relative; annotation journey/teardown> [--headless] [--cli] → the run-level restore / reset ONCE, after the last stage or re-run, before finalize; lists the journey in the run file',
    journey: '--run-file <f> --spec a,b → lists declared setup / teardown journeys (annotation { type: "journey", description }) in lite.journeys; a journey title never carries a [TC-ID]',
    auth: '--run-file <f> [--probe-spec <auth setup journey> | --probe <probe.json> | --mechanism cookie|token|other --survives-reset true|false|no-reset --language-scope profile|session|cookie|none] [--api-signin yes|no] [--fallback-reason "…"] [--source learning] | --clear → records run.auth (strategy setup-project | api-helper | ui-fallback); --clear removes .auth/',
    preflight: '--run-file <f> [--probe-url] [--env-id] [--cli] [--headless] → run-stage preflight, compact',
    cache: '--results-root <dir> --files a,b [--mark] → read / new / changed / unchanged by sha256 (re-read only read[])',
    'checkpoint-a': '--results-root <dir> --phase N --files a,b [--tc --data --req a,b --coverage <judgements.json> --specs a,b --assertion-review <json> --tsc <bin> --cli <playwright cli.js>] → tsc (+ a side-effect-free playwright test --list --reporter=list) · pom · traceability (resolved titles; declared + listed journeys exempt from [TC-ID]) · assertions, a ui sign-in warning, a ledger warning per consented TC without a ledger path, a ledger-ownership FAIL for a modify / remove of a resource no ledger call creates or any modify-external (check 53 read statically); writes .runs/phase-N.checkpoint-A.json',
    stage: '--run-file <f> --stage smoke|positive|negative [--run first|rerun] [--tcs a,b] [--spec a,b] [--max-workers N] [--burn-in <healed timing TCs>] [--headless] → one stage, smoke gate enforced, workers 1 unless proven independent, then 2-5; --burn-in runs those TCs ×3 in a re-run',
    'rerun-select': '--run-file <f> [--spec a,b] → the TCs a fix made stale (impact.mjs)',
    finalize: '--results-root <dir> --phase N --files a,b [--judgements <json> --feature <f> --tc --data --req] → Checkpoint A refresh on the final scope when needed, drafts, merge, judge, freshness, report, Checkpoint B (results-integrity · tc-status-coverage · failure-evidence), publish (status lines resolved from the gate record), acceptance, .auth/ removed',
  },
  exit: 'PASS / PUBLISHED / COMPLETED / READY / OK 0 · FAIL / STOPPED 1 · BLOCKED 2 · NOT_RUN 3',
};

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (args.help || !cmd) { process.stdout.write(JSON.stringify(HELP, null, args.pretty ? 2 : 0) + '\n'); return 0; }
  try {
    if (cmd === 'init-run') return await initRun(args);
    if (cmd === 'consent') return await consent(args);
    if (cmd === 'teardown') return await teardown(args);
    if (cmd === 'journey') return await journey(args);
    if (cmd === 'auth') return await auth(args);
    if (cmd === 'preflight') return await preflight(args);
    if (cmd === 'cache') return cache(args);
    if (cmd === 'checkpoint-a') return await checkpointA(args);
    if (cmd === 'stage') return await stage(args);
    if (cmd === 'rerun-select') return await rerunSelect(args);
    if (cmd === 'finalize') return await finalize(args);
    return blocked(args, cmd, 'unknown command — one of init-run, consent, auth, preflight, cache, checkpoint-a, journey, stage, teardown, rerun-select, finalize');
  } catch (e) {
    return blocked(args, cmd, 'internal error: ' + e.message, { stack: String(e.stack || '').split('\n').slice(0, 4).join(' | ') });
  }
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) main().then((code) => process.exit(code));
