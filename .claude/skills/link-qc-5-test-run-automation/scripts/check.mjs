#!/usr/bin/env node
// check.mjs — the deterministic half of skill 5's two compliance checkpoints (references/compliance-checkpoints.md).
// Node >= 18, zero dependencies.
//
//   run       ONE call for the mechanical checks (A4): the project's own type check, the validator, the config
//             inventory, a spec-imports-spec scan and — with --lint — the project's own ESLint. Tool processes run
//             side by side but never more than the compliance limit at once (A14: the capacity ledger's `compliance`
//             class when ./capacity.mjs is present, else 2 in this process). It also reports the timeout policy
//             (A15): unlimited / missing actionTimeout / navigationTimeout, budgets of 0, deadlines of 10 min or more
//             — evidence for the smart-timeout decision, never a gate. Stdout is compact (A3); the full output is
//             written under {results-root}/artifacts/checks/{snapshot}/. With --snapshot it runs on the FROZEN scope
//             and records one mechanical result per (check, tool) for that snapshot.
//   snapshot  freezes a checkpoint (Revision 3.1 §6.2): scoped files, the TC document (per-TC tc-hash), requirement
//             texts, TEST-DATA, run plan, readiness, validator exceptions, configs, timeouts, lint config and tool
//             versions — at B also the evidence manifest, the run artifacts (summaries, heartbeats, dispatcher /
//             admission / lease / watchdog records), gate record A and the drafts.
//   record    appends ONE result {checkId, unit, snapshotId, status, reason, evidenceRef, executor} (§6.3); with
//             --batch <results.json> a whole set in ONE call — every entry validated first (the single-record rules,
//             plus: no stale snapshot id, no second (check, unit) in the batch or already recorded, the snapshot still
//             re-hashes to itself); any invalid entry rejects the batch and nothing is written; otherwise every line
//             is written in one atomic replace of the results file.
//   gate      decides the checkpoint from the snapshot's own results: missing, stale, contradictory and duplicate
//             results are rejected (never merged), N/A only with a true applicability predicate and its evidence,
//             runtime items at A are `scheduled-for-B`, the snapshot is re-hashed at the end (any change voids the
//             checkpoint), B also needs results freshness `stale: []` — then writes the SEPARATE gate record
//             {results-root}/.runs/phase-{N}.checkpoint-{A|B}.json. Drafts never carry a verdict.
//   carry     Incremental Checkpoint B (B7) in SHADOW ONLY: which semantic results of an earlier snapshot could be
//             carried as linked current-snapshot results. It never writes a result and never affects a gate.
//   harness   B20: a harness pass is reused only on an exact cache-key match (implementation, harness, fixtures,
//             goldens, assets, lockfiles, Node, platform, arch, locale / timezone, QA_* / PW_* settings, version).
//
// It never edits code, a report, a run file or a draft. Writes: artifacts/checks/**, the gate records and the harness
// cache — nothing else. Exit 0 by default; --strict maps run / gate: PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, print, isFile, isDir, read, posix, sha256, loadStripped, resolveModule, isSpecFile } from './scan-lib.mjs';
import * as V from './validate-automation.mjs';
import { inventory, reconcile } from './config-inventory.mjs';
import { hashDocument } from './tc-hash.mjs';

export const SCHEMA = 'skill5-check/1';
export const SNAPSHOT_SCHEMA = 'skill5-snapshot/1';
export const GATE_SCHEMA = 'skill5-gate/1';
export const CARRY_SCHEMA = 'skill5-carry/1';
export const HARNESS_SCHEMA = 'skill5-harness-cache/1';
export const RESULT_STATUSES = ['verified-mechanical', 'verified-semantic', 'unresolved', 'N/A', 'scheduled-for-B', 'FAIL'];
export const EXECUTORS = ['V', 'S', 'M', 'SB-P', 'SB-Q', 'SB-E', 'SB-D', 'SB-H'];
export const NEVER_NA_AT_B = ['16b', '18', '19', '25b', '46b', '48a', '48b'];
export const DEFAULT_LIMIT = 2;
export const LONG_DEADLINE_MS = 600000;
const SECRET_LINE = /(password|passwd|pwd|secret|token|authorization|api[-_]?key|connection ?string)\s*[:=]/i;
const STRICT_EXIT = { PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3 };
const MB = 1024 * 1024;
const { analyze, RULES } = V;
const here = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(here, '..');

/* ---------------- small helpers ---------------- */

const csv = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const str = (v) => (typeof v === 'string' && v.length ? v : null);
const uniq = (xs) => [...new Set(xs)];
const readdirSafe = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const relTo = (base, p) => posix(path.relative(base, p)) || posix(path.basename(p));
const filtered = (text) => String(text || '').split(/\r?\n/).map((l) => (SECRET_LINE.test(l) ? '[line withheld: it looks like a credential]' : l)).join('\n');

/** Stable JSON: object keys sorted at every level, undefined dropped — the input of every hash here. */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => canon(x === undefined ? null : x)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const shaOf = (v) => sha256(canon(v));

/** sha256 of a file's BYTES (images, traces, text alike); null when unreadable. */
export function fileSha(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; }
}

/** Every file under a folder (sorted, `.git` skipped); `recurse: false` lists the top level only. */
export function listFiles(dir, recurse = true, acc = [], depth = 24) {
  if (depth < 0 || !isDir(dir)) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (recurse) listFiles(full, true, acc, depth - 1); }
    else if (e.isFile()) acc.push(full);
  }
  return acc;
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

/** `metadata.version` of a SKILL.md front matter, or null. */
export function skillVersionOf(skillDir = SKILL_DIR) {
  const text = read(path.join(skillDir, 'SKILL.md')) || '';
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const m = fm && fm[1].match(/^metadata:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+version:\s*["']?([^"'\r\n]+?)["']?\s*$/m);
  return m ? m[1].trim() : null;
}

/* ---------------- validator rule → checklist item ----------------
   The validator's own RULE_CHECKS is the one source when it exports it; this table is the fallback for an older
   validator. A rule no table maps falls to check 47 (craft) so no finding is ever lost. */
const FALLBACK_RULE_CHECKS = {
  'focus-only': ['20'], 'modifier-no-reason': ['21'], 'modifier-declared': ['21'],
  'placeholder-assertion': ['8'], 'empty-test-body': ['8'], 'no-assertions': ['8'],
  'assertions-call-found': ['9'], 'assertions-conditional': ['9'], 'assertions-unresolved': ['9'],
  'evidence-missing': ['14'], 'evidence-call-found': ['14'], 'evidence-conditional': ['14'], 'evidence-unresolved': ['14'],
  'evidence-in-hook': ['15'], 'evidence-duplicate': ['15'], 'evidence-placement-unproven': ['16a'],
  'trace-title-missing-tcid': ['29'], 'trace-describe-missing-reqid': ['29'], 'trace-title-dynamic': ['29'],
  'trace-unknown-tcid': ['30'], 'trace-unknown-reqid': ['30'], 'trace-uncovered-id': ['34'], 'outcome-coverage-unassessed': ['33', '34'],
  'hardcoded-credential': ['38'],
  'exception-not-permitted': ['39'], 'exception-malformed': ['39'], 'exception-expired': ['39'], 'exception-unused': ['39'], 'exception-unverified': ['39'],
  'pom-raw-locator': ['1'], 'pom-navigation': ['1'], 'pom-evaluate': ['1'], 'pom-keyboard': ['1'], 'pom-architecture-unknown': ['1'],
  'pom-chained-locator': ['2'], 'pom-spec-helper': ['4'],
  'pom-duplicate-page': ['5'], 'pom-duplicate-page-decided': ['5'], 'pom-inventory-unreadable': ['5'],
  'wait-for-timeout': ['24'], 'bare-set-timeout': ['24'], 'wait-network-idle': ['42'], 'positional-unscoped': ['41'], 'step-missing': ['40'],
  'absolute-url': ['47'], 'manifest-unreadable': ['36'],
  'constant-redeclared': ['6'], 'empty-catch': ['28'], 'timeout-literal': ['43'],
  'console-guard-missing': ['46a'], 'network-guard-missing': ['49'], 'admission-contract': ['25a', '47'],
};

/** Validator rule id → the checks it feeds. */
export const RULE_TO_CHECK = (() => {
  const src = V.RULE_CHECKS && typeof V.RULE_CHECKS === 'object' ? V.RULE_CHECKS : FALLBACK_RULE_CHECKS;
  const out = {};
  for (const [r, ids] of Object.entries(src)) out[r] = (Array.isArray(ids) ? ids : [ids]).map(String);
  for (const r of Object.keys(RULES)) if (!out[r] || !out[r].length) out[r] = ['47'];
  return out;
})();
const rulesMappedTo = (id) => Object.keys(RULE_TO_CHECK).filter((r) => RULE_TO_CHECK[r].includes(id)).sort();

/* ---------------- the check catalogue (compliance-checkpoints.md §2 + Revision 3 §6.1 + Revision 3.1 rows) ----------------
   A / B = the units a check needs at that checkpoint ('' = not at this checkpoint):
     M  one mechanical result per tool — `tool:tsc`, `tool:scan`, `tool:configs`; a check with M and no tool falls
        back to S.
     S  one semantic result for the whole checkpoint scope (`scope`), recorded with `check.mjs record`.
     R  one runtime result for the phase (`phase`) — at A it is an automatic `scheduled-for-B` record.
     L  check 27 only: `tool:lint` when the project's lint makes floating promises deterministic, else S.
   Wherever a check applies and a validator rule maps to it (RULE_TO_CHECK), it also needs `tool:validator`.
   Mechanical results are recorded by `check.mjs run --snapshot`. A mechanical `unresolved` (open review / notRun items,
   a tool that did not run) is closed only by a `verified-semantic` scope result of the same check; a mechanical FAIL
   is never closed — it is repaired, and the repair is a new snapshot. */
const K = (id, short, kind, A, B, executor, cls, extra = {}) => Object.freeze({
  id, short, kind, A, B, executor, cls, tools: [], na: null, naPart: null, ...extra, rules: rulesMappedTo(id), neverNA: NEVER_NA_AT_B.includes(id),
});

export const CHECKS = Object.freeze([
  K('1', 'No raw locator, navigation, evaluate or keyboard / mouse driving in a spec', 'Src', 'MS', 'MS', 'V + SB-P', 2),
  K('2', 'Nothing chained off an exposed page-object locator', 'Src', 'MS', 'MS', 'V + SB-P', 2),
  K('3', 'Composite UI flows live in the layer the project uses', 'Src', 'S', 'S', 'SB-P', 1),
  K('4', 'No spec-local function drives the screen', 'Src', 'MS', 'MS', 'V + SB-P', 2),
  K('5', 'Page objects reused / extended, never duplicated — an inventory decision per screen', 'Src', 'MS', 'MS', 'V + SB-P', 3),
  K('6', 'Constants single-sourced; no tolerance / timeout / threshold redeclared in a spec', 'Src', 'MS', 'MS', 'V (B8) + SB-H', 1),
  K('7', 'Every test verifies its required outcome', 'Src', 'S', 'S', 'SB-Q', 1),
  K('8', 'No placeholder assertion', 'Src', 'MS', 'MS', 'V + SB-Q', 2),
  K('9', 'Assertions inside approved helpers / page objects recognised', 'Src', 'MS', 'MS', 'V + SB-Q', 2),
  K('10', 'Visibility-only checks only where visibility is the requirement', 'Src', 'S', 'S', 'SB-Q', 1),
  K('11', 'Expected values trace to an approved requirement', 'Src', 'S', 'S', 'SB-Q', 1),
  K('12', 'TC ↔ requirement conflicts reported, not silently resolved', 'Src', 'S', 'S', 'SB-Q', 1),
  K('13', 'Weak assertions repaired regardless of aggregate coverage', 'Src', 'S', 'S', 'SB-Q', 3),
  K('14', 'Every test captures assertion-point evidence, directly or through a method', 'Src', 'MS', 'MS', 'V + SB-E', 2),
  K('15', 'No evidence from after-hooks; exactly one per test', 'Src', 'M', 'M', 'V', 1),
  K('16a', 'Evidence call at the assertion point, before teardown (code)', 'Src', 'MS', 'MS', 'V + SB-E', 2),
  K('16b', "This phase's heartbeats show each captured image before teardown started", 'Rt', '', 'R', 'S', 4),
  K('17', 'Evidence helper, screenshot config and output roots exist and are writable', 'Src', 'S', 'S', 'S', 1),
  K('18', 'Images, run file, report section, bug entries and page actually produced, right TC, final code', 'Rt', '', 'RS', 'S + SB-E', 4),
  K('19', 'No PASS image of a cleaned-up screen', 'Rt', '', 'RS', 'S + SB-E', 4),
  K('20', 'No focused execution', 'Src', 'M', 'M', 'V', 1),
  K('21', 'Every skip / fixme / fail / slow carries a traceable reason', 'Src', 'MS', 'MS', 'V + SB-E', 2),
  K('22', 'Expected failures and extended timeouts shown distinctly in the report', 'Rt', '', 'R', 'S', 4, { na: 'fail-slow' }),
  K('23', 'Missing prerequisites stay visible as SKIP / BLOCKED', 'Src+Rt', 'S', 'SR', 'S', 2),
  K('24', 'Waits observable and bounded', 'Src', 'MS', 'MS', 'V + SB-H', 2),
  K('25a', 'Unit / @run: tags consistent with the run plan (code)', 'Src', 'MS', 'MS', 'S (with B1)', 3),
  K('25b', 'Execution honoured the plan: planned mode / workers, no conflicting units overlapped, isolation moves applied', 'Rt', '', 'R', 'S', 4),
  K('26', 'Every api_setup precondition has a teardown that runs after the evidence', 'Src', 'S', 'S', 'SB-D', 1, { na: 'api-setup' }),
  K('27', 'Async operations awaited — no floating promises', 'Src', 'L', 'L', 'S (lint) else SB-D', 1),
  K('28', 'Errors surfaced, never swallowed', 'Src', 'MS', 'MS', 'V (B8) + SB-D', 1),
  K('29', '[TC-ID] in every test title, requirement ID in every suite title', 'Src', 'M', 'M', 'V', 1),
  K('30', 'Referenced IDs validated against the resolved sources', 'Src', 'M', 'M', 'V', 1),
  K('31', 'Requirement IDs in the coverage artifacts and the run JSON', 'Rt', 'S', 'R', 'S', 4),
  K('32', 'Requirement → TC → automated test → result mappable end to end', 'Rt', '', 'R', 'S', 4),
  K('33', 'Three coverage figures reported separately', 'Rt', 'S', 'R', 'S', 4),
  K('34', 'Missing / partial / blocked / unexecuted coverage visible', 'Rt', 'S', 'R', 'S', 3),
  K('35', 'Imports resolve (the project type check); no spec imports another spec', 'Src', 'M', 'M', 'S', 1, { tools: ['tsc', 'scan'] }),
  K('36', 'Files at the Placement Manifest paths; spec registered', 'Src', 'MS', 'MS', 'S', 1),
  K('37', 'Results, logs and screenshots under the resolved roots', 'Src/Rt', 'S', 'R', 'S', 1),
  K('38', 'No credential, token or connection string in code, config, logs or the learning file', 'Src+Rt', 'MS', 'MSR', 'V + SB-H', 1),
  K('39', "Every honoured exception's source opened and its substance recorded", 'Src', 'MS', 'MS', 'SB-H', 3, { na: 'exceptions' }),
  K('40', 'One step() per manual step; evidence outside steps', 'Src', 'MS', 'MS', 'V + SB-E', 2),
  K('41', 'Positional selectors scoped or justified', 'Src', 'MS', 'MS', 'V + SB-P', 2),
  K('42', 'No networkidle; every wait bounded by its deadline', 'Src', 'MS', 'MS', 'V + SB-H', 2),
  K('43', 'Timeouts only from timeouts.ts; initial values and calibration records; the run protections active (reconcile)', 'Src/Rt', 'MS', 'MSR', 'V (B8) + S + SB-H', 1, { tools: ['protections'] }),
  K('44', 'ONE shared playwright.config.ts; extra configs consolidated or reported', 'Src', 'MS', 'MS', 'S + SB-H', 1, { tools: ['configs'] }),
  K('45', 'Created data named by uniqueName() / swept by runPrefix(); cleanup flags', 'Src+Rt', 'S', 'SR', 'SB-D', 1),
  K('46a', 'Console guard attached in beforeEach and reported in afterEach (code)', 'Src', 'M', 'M', 'V (B8)', 1),
  K('46b', 'Console reports produced for every executed test; unexpected entries under Deviations', 'Rt', '', 'R', 'S', 4),
  K('47', 'Page-object / component / locator / fixture craft; .gitignore lines', 'Src', 'MS', 'MS', 'SB-P (+ S)', 1),
  K('48a', 'Stops only on FROZEN verdicts or the documented ceiling stop', 'Rt', '', 'R', 'S', 4),
  K('48b', 'Every watchdog / stall / admission-wait / timeout event of the phase classified', 'Rt', '', 'R', 'S', 4),
  K('49', 'Network guard attached beside the console guard; rateLimitSlot() placement', 'Src', 'MS', 'MS', 'V (B8) + SB-H', 1, { naPart: 'rate-limit-step' }),
  K('50', 'No scratch probe in the delivered scope; scratch.mjs clean done', 'Rt', 'S', 'R', 'S', 4),
]);

const CHECK_BY_ID = new Map(CHECKS.map((c) => [c.id, c]));

/** The unit names a check needs at a checkpoint, from the snapshot's facts (deterministic). */
export function unitsFor(check, checkpoint, facts = {}) {
  const spec = check[checkpoint] || '';
  if (!spec) return [];
  if (spec.includes('L')) return [facts.lintFloatingPromises ? 'tool:lint' : 'scope'];
  const ruleIds = new Set(facts.validatorRuleIds || Object.keys(RULES));
  const out = [];
  if (check.rules.some((r) => ruleIds.has(r))) out.push('tool:validator');
  if (spec.includes('M')) for (const t of check.tools) out.push('tool:' + t);
  if (spec.includes('M') && !out.length) out.push('scope');
  if (spec.includes('S') && !out.includes('scope')) out.push('scope');
  if (spec.includes('R')) out.push('phase');
  return out;
}

/** Every (check, unit) a complete checkpoint needs before any closure rule — the harness builds full sets from it. */
export function requiredUnits(checkpoint, facts = {}) {
  const out = [];
  for (const c of CHECKS) {
    const pred = c.na ? (facts.predicates || {})[c.na] : null;
    const neverNA = checkpoint === 'B' && c.neverNA;
    if (pred && pred.noSubject && !neverNA) continue;
    for (const u of unitsFor(c, checkpoint, facts)) out.push({ checkId: c.id, unit: u });
  }
  return out;
}

/* ---------------- scope inputs ---------------- */

function filesArg(v, root) {
  if (!str(v)) return [];
  if (v.startsWith('@')) return (read(path.resolve(root, v.slice(1))) || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  return csv(v);
}

function automationRootOf(root, given) {
  if (str(given)) return given;
  const m = readJson(path.join(root, 'Testing', 'qa-manifest.json'));
  return (m && m.paths && m.paths.automationRoot) || 'Testing/Automation';
}

const REQ_ID_RE = /\b(?:REQ|US|AC|FR)-[A-Za-z0-9_.-]*[A-Za-z0-9]/g;
function reqIdSet(root, reqs) {
  if (!reqs || !reqs.length) return null;
  const ids = new Set();
  for (const r of reqs) for (const id of (read(path.resolve(root, r)) || '').match(REQ_ID_RE) || []) ids.add(id);
  return ids.size ? ids : null;
}

/** The validator, in-process, on exactly the frozen inputs. */
export function runValidator(inputs) {
  const reqIds = reqIdSet(inputs.root, inputs.req);
  return analyze({
    root: inputs.root,
    files: inputs.files,
    args: { 'automation-root': inputs.automationRoot, ...(inputs.tc ? { 'tc-ids': path.resolve(inputs.root, inputs.tc) } : {}), ...(inputs.inventory ? { inventory: path.resolve(inputs.root, inputs.inventory) } : {}), ...(inputs.requireSteps ? { 'require-steps': true } : {}) },
    ...(reqIds ? { reqIds, reqIdSource: (inputs.req || []).join(', ') } : {}),
  });
}

/* ---------------- spec-imports-spec scan (check 35, tool:scan) ---------------- */

const IMPORT_RE = /\b(?:import\s+[^;'"`]*?\s*from\s*|export\s+[^;'"`]*?\s*from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)(['"`])/g;
export function specImportScan(root, files) {
  const hits = [];
  const unreadable = [];
  const cache = new Map();
  let specs = 0;
  for (const f of files) {
    const abs = path.resolve(root, f);
    if (!isSpecFile(abs)) continue;
    specs++;
    const s = loadStripped(abs, cache);
    if (!s || s.parseError) { unreadable.push(relTo(root, abs)); continue; }
    for (const m of s.code.matchAll(IMPORT_RE)) {
      const quoteAt = m.index + m[0].length - 1;
      const lit = s.strings.find((t) => t.start === quoteAt);
      if (!lit) continue;
      const target = resolveModule(path.dirname(abs), lit.value);
      if (target && isSpecFile(target)) hits.push({ file: relTo(root, abs), line: lit.line, imports: relTo(root, target) });
    }
  }
  return { specs, hits, unreadable };
}

/* ---------------- lint facts (check 27) and the timeout report (A15) ---------------- */

const LINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml'];

/** Check 27 is deterministic ONLY when the project's lint enables no-floating-promises with type-aware parser options. */
export function lintFacts(dirs) {
  const files = {};
  let enabled = false;
  let typeAware = false;
  for (const d of uniq(dirs.filter(Boolean))) for (const n of LINT_CONFIGS) {
    const p = path.join(d, n);
    const t = read(p);
    if (t === null) continue;
    files[p] = fileSha(p);
    const clean = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/^\s*#[^\n]*/gm, '');
    if (/@typescript-eslint\/no-floating-promises['"]?\s*[:=,]\s*\[?\s*(['"]?(error|warn)['"]?|[12]\b)/.test(clean)) enabled = true;
    if (/\b(project|projectService)['"]?\s*:\s*(?!false\b)(?!null\b)\S/.test(clean)) typeAware = true;
  }
  return { files, enabled, typeAware, floatingPromises: enabled && typeAware };
}

/** TIMEOUTS = { … } of a timeouts.ts → { 'test.default': 90000, 'step.long': 120000, … } (comments ignored). */
export function parseTimeoutValues(text) {
  const out = {};
  const src = String(text || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const start = src.search(/TIMEOUTS\s*=\s*\{/);
  if (start < 0) return out;
  const body = src.slice(src.indexOf('{', start) + 1);
  const stack = [];
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(\{|[\d_]+(?:\.\d+)?)|(\})/g)) {
    if (m[3]) { if (!stack.length) break; stack.pop(); continue; }
    if (m[2] === '{') { stack.push(m[1]); continue; }
    out[[...stack, m[1]].join('.')] = Number(m[2].replace(/_/g, ''));
  }
  return out;
}

function resolveTimeoutExpr(expr, values) {
  const e = String(expr).trim().replace(/[,;]$/, '');
  if (/^Infinity$/.test(e)) return Infinity;
  if (/^[\d_]+(\.\d+)?$/.test(e)) return Number(e.replace(/_/g, ''));
  const m = e.match(/^TIMEOUTS\.([\w.$]+)$/);
  if (m && m[1] in values) return values[m[1]];
  return null;
}

function findTimeoutsFile(autoDir) {
  for (const n of ['timeouts.ts', 'timeouts.js', 'timeouts.mjs']) if (isFile(path.join(autoDir, n))) return path.join(autoDir, n);
  for (const d of readdirSafe(autoDir)) {
    const p = path.join(autoDir, d, 'timeouts.ts');
    if (d !== 'node_modules' && isFile(p)) return p;
  }
  return null;
}

/** A15 — observe only: what the smart-timeout decision (B9) will need. Never a gate. */
export function timeoutReport({ root, automationRoot, configFiles }) {
  const autoDir = path.resolve(root, automationRoot);
  const tFile = findTimeoutsFile(autoDir);
  const values = tFile ? parseTimeoutValues(read(tFile)) : {};
  const unlimited = [];
  const long = [];
  for (const c of configFiles) {
    const text = (read(path.resolve(root, c)) || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const key of ['actionTimeout', 'navigationTimeout']) {
      const m = text.match(new RegExp('\\b' + key + '\\s*:\\s*([^,\\n}]+)'));
      if (!m) { unlimited.push({ file: c, setting: key, value: 'missing', reason: 'not set — Playwright\'s default is 0, no limit' }); continue; }
      const ms = resolveTimeoutExpr(m[1], values);
      if (ms === 0 || ms === Infinity) unlimited.push({ file: c, setting: key, value: m[1].trim(), reason: 'no limit' });
      else if (ms !== null && ms >= LONG_DEADLINE_MS) long.push({ key: c + ' ' + key, ms });
    }
    for (const m of text.matchAll(/(^|[\s,{])timeout\s*:\s*([^,\n}]+)/g)) {
      if (resolveTimeoutExpr(m[2], values) === 0) unlimited.push({ file: c, setting: 'timeout', value: m[2].trim(), reason: 'a budget of 0 is no limit' });
    }
  }
  for (const [k, v] of Object.entries(values)) if (v >= LONG_DEADLINE_MS) long.push({ key: 'TIMEOUTS.' + k, ms: v });
  return { timeoutsFile: tFile ? relTo(root, tFile) : null, values, unlimited, long, note: 'observe only (A15) — evidence for the smart-timeout decision, never a gate' };
}

/* ---------------- predicates (N/A only when the rule has no subject — §6.3) ---------------- */

function gapsOf(runJson) {
  const dr = runJson && runJson.data_readiness;
  return Array.isArray(dr && dr.gaps) ? dr.gaps : [];
}

export function predicatesOf({ root, files, runJson, validator }) {
  const texts = files.map((f) => ({ f, t: read(path.resolve(root, f)) || '' }));
  const apiText = texts.filter((x) => /\bapi_setup\b/.test(x.t)).map((x) => x.f);
  const prereq = texts.filter((x) => /\bfrom\s*['"][^'"]*prerequest\/|require\(\s*['"][^'"]*prerequest\//.test(x.t)).map((x) => x.f);
  const apiGaps = gapsOf(runJson).filter((g) => /prepared\s*\(api\)|^\s*api\s*$/i.test(String(g.decision || '')) || /^\s*api\b/i.test(String(g.provisioning || ''))).map((g) => g.gap || '?');
  const failSlow = texts.flatMap((x) => [...x.t.matchAll(/\b(?:test|describe)\s*(?:\.\s*describe\s*)?\.\s*(fail|slow)\s*\(/g)].map((m) => x.f + ' ' + m[1]));
  const exceptions = validator && Array.isArray(validator.exceptions) ? validator.exceptions.length : null;
  const limits = (runJson && runJson.run_plan && Array.isArray(runJson.run_plan.rate_limits)) ? runJson.run_plan.rate_limits : [];
  const stepLimits = limits.filter((l) => l && l.at === 'step').map((l) => l.service || '?');
  const slotCalls = texts.filter((x) => /\brateLimitSlot\s*\(/.test(x.t)).map((x) => x.f);
  return {
    'api-setup': { noSubject: !apiText.length && !prereq.length && !apiGaps.length, evidence: apiText.length + ' scoped file(s) mention api_setup · ' + prereq.length + ' import a prerequest/ function · ' + apiGaps.length + ' readiness gap(s) prepared through the API' },
    'fail-slow': { noSubject: !failSlow.length, evidence: failSlow.length ? failSlow.slice(0, 10).join('; ') : 'no test.fail / test.slow / describe.fail / describe.slow in ' + files.length + ' scoped file(s)' },
    exceptions: { noSubject: exceptions === 0, evidence: exceptions === null ? 'validator exceptions unknown' : exceptions + ' exception(s) honoured by the validator' },
    'rate-limit-step': { noSubject: !stepLimits.length && !slotCalls.length, evidence: stepLimits.length + ' run-plan rate limit(s) at: step · ' + slotCalls.length + ' scoped file(s) call rateLimitSlot()' },
  };
}

/* ---------------- snapshot (Revision 3.1 §6.2) ---------------- */

function hashMap(paths, base) {
  const out = {};
  for (const p of paths) out[relTo(base, p)] = fileSha(p);
  return out;
}

function toolsFacts(skillDir = SKILL_DIR) {
  const scripts = {};
  for (const f of readdirSafe(path.join(skillDir, 'scripts')).sort()) if (/\.mjs$/.test(f) && !/^selftest/.test(f)) scripts[f] = fileSha(path.join(skillDir, 'scripts', f));
  return { skillVersion: skillVersionOf(skillDir), scripts, validatorRules: shaOf(RULES) };
}

/** The hashed body of a snapshot, recomputed from its inputs (used to take it AND to re-hash it). */
export function snapshotBody(inputs, { skillDir = SKILL_DIR } = {}) {
  const warnings = [];
  const root = inputs.root;
  const autoDir = path.resolve(root, inputs.automationRoot);
  const files = {};
  for (const f of inputs.files) files[posix(f)] = fileSha(path.resolve(root, f));
  const runJson = inputs.runFile ? readJson(path.resolve(root, inputs.runFile)) : null;
  if (inputs.runFile && !runJson) warnings.push('run file unreadable: ' + inputs.runFile);
  let tc = null;
  if (inputs.tc) {
    const tcText = read(path.resolve(root, inputs.tc));
    const dataText = inputs.data ? read(path.resolve(root, inputs.data)) : '';
    if (tcText === null) warnings.push('TC document unreadable: ' + inputs.tc);
    else {
      const per = {};
      for (const [id, v] of Object.entries(hashDocument(tcText, dataText || '', null))) per[id] = v.hash;
      tc = { doc: posix(inputs.tc), sha256: fileSha(path.resolve(root, inputs.tc)), perTc: per };
    }
  }
  let validator = null;
  try { validator = runValidator(inputs); } catch (e) { warnings.push('validator could not run for the snapshot: ' + e.message); }
  let inv = null;
  try { inv = inventory({ root, automationRoot: inputs.automationRoot }); } catch (e) { warnings.push('config inventory failed: ' + e.message); }
  const configFiles = inv ? inv.configs.map((c) => c.file) : [];
  const configs = {};
  for (const c of configFiles) configs[c] = fileSha(path.resolve(root, c));
  for (const p of [path.join(autoDir, 'tsconfig.json'), path.join(autoDir, 'package.json'), path.join(root, 'Testing', 'qa-manifest.json'), path.join(root, 'Testing', 'qa-allow.json')]) if (isFile(p)) configs[relTo(root, p)] = fileSha(p);
  const tFile = findTimeoutsFile(autoDir);
  const lint = lintFacts([autoDir, root]);
  const body = {
    schema: SNAPSHOT_SCHEMA,
    checkpoint: inputs.checkpoint,
    phase: inputs.phase,
    files,
    tc,
    requirements: Object.fromEntries((inputs.req || []).map((r) => [posix(r), fileSha(path.resolve(root, r))])),
    testData: inputs.data ? { doc: posix(inputs.data), sha256: fileSha(path.resolve(root, inputs.data)) } : null,
    runPlan: runJson ? shaOf({ run_plan: runJson.run_plan || null, run_plan_adjustments: runJson.run_plan_adjustments || [] }) : null,
    readiness: runJson ? shaOf(runJson.data_readiness || null) : null,
    exceptions: validator ? shaOf((validator.exceptions || []).map((x) => ({ ruleId: x.ruleId, file: x.file, line: x.line, kind: x.kind, reason: x.reason, source: x.source }))) : null,
    scopeDigest: validator && validator.fingerprint ? validator.fingerprint.scopeDigest : null,
    inventory: inputs.inventory ? { [posix(inputs.inventory)]: fileSha(path.resolve(root, inputs.inventory)) } : null,
    configs,
    timeouts: tFile ? { [relTo(root, tFile)]: fileSha(tFile) } : null,
    lint: { files: Object.fromEntries(Object.entries(lint.files).map(([p, h]) => [relTo(root, p), h])), floatingPromises: lint.floatingPromises },
    tools: toolsFacts(skillDir),
    facts: {
      validatorRuleIds: Object.keys(RULES).sort(),
      lintFloatingPromises: lint.floatingPromises,
      predicates: predicatesOf({ root, files: inputs.files, runJson, validator }),
    },
  };
  if (inputs.checkpoint === 'B') {
    const rr = inputs.resultsRoot;
    const evidence = {};
    if (inputs.screenshotsDir) Object.assign(evidence, hashMap(listFiles(path.resolve(root, inputs.screenshotsDir)), root));
    const artifacts = {};
    for (const sub of ['progress', 'stages', path.join('test-output', 'phase-' + inputs.phase), path.join('diagnostics', 'phase-' + inputs.phase)]) {
      Object.assign(artifacts, hashMap(listFiles(path.join(rr, 'artifacts', sub)), root));
    }
    body.evidence = evidence;
    body.artifacts = artifacts;
    const gA = path.join(rr, '.runs', 'phase-' + inputs.phase + '.checkpoint-A.json');
    const recA = readJson(gA);
    body.gateA = isFile(gA) ? { file: relTo(root, gA), sha256: fileSha(gA), verdict: recA ? recA.verdict || null : null, snapshotId: recA ? recA.snapshotId || null : null } : null;
    const draftsDir = inputs.draftsDir ? path.resolve(root, inputs.draftsDir) : null;
    body.drafts = draftsDir && isDir(draftsDir) ? hashMap(listFiles(draftsDir), draftsDir) : null;
    if (!body.drafts) warnings.push('no drafts under ' + (inputs.draftsDir || '(none given)') + ' — Checkpoint B freezes the draft run file, report, bug file and page');
  }
  return { body, warnings, validator };
}

const snapshotIdOf = (body) => sha256(canon(body)).slice(0, 16);
export const checksDir = (resultsRoot, id) => path.join(resultsRoot, 'artifacts', 'checks', id);

/** Take (freeze) a checkpoint snapshot; the id is content-addressed, so the same content gives the same id. */
export function takeSnapshot(o) {
  const root = path.resolve(o.root || process.cwd());
  const resultsRoot = path.resolve(root, o.resultsRoot);
  const checkpoint = o.checkpoint;
  const phase = Number(o.phase);
  const runsDir = path.join(resultsRoot, '.runs');
  const draftsDefault = path.join(resultsRoot, 'artifacts', 'drafts', 'phase-' + phase);
  const draftsDir = checkpoint === 'B' ? (o.draftsDir ? path.resolve(root, o.draftsDir) : draftsDefault) : null;
  let runFile = o.runFile ? path.resolve(root, o.runFile) : null;
  if (!runFile) {
    const draftRun = draftsDir ? path.join(draftsDir, '.runs', 'phase-' + phase + '.json') : null;
    runFile = draftRun && isFile(draftRun) ? draftRun : path.join(runsDir, 'phase-' + phase + '.json');
  }
  const runJson = readJson(runFile);
  let screenshotsDir = o.screenshotsDir ? path.resolve(root, o.screenshotsDir) : null;
  const automationRoot = automationRootOf(root, o.automationRoot);
  if (!screenshotsDir && checkpoint === 'B' && runJson && typeof runJson.screenshots_root === 'string') screenshotsDir = path.resolve(root, automationRoot, runJson.screenshots_root, 'phase-' + phase);
  const inputs = {
    checkpoint, phase, root, automationRoot, resultsRoot,
    files: uniq(o.files.map((f) => relTo(root, path.resolve(root, f)))),
    tc: o.tc ? relTo(root, path.resolve(root, o.tc)) : null,
    data: o.data ? relTo(root, path.resolve(root, o.data)) : null,
    req: (o.req || []).map((r) => relTo(root, path.resolve(root, r))),
    runFile: isFile(runFile) ? relTo(root, runFile) : null,
    inventory: o.inventory ? relTo(root, path.resolve(root, o.inventory)) : null,
    requireSteps: !!o.requireSteps,
    draftsDir: draftsDir ? relTo(root, draftsDir) : null,
    screenshotsDir: screenshotsDir ? relTo(root, screenshotsDir) : null,
    tsconfig: o.tsconfig ? relTo(root, path.resolve(root, o.tsconfig)) : null,
  };
  const { body, warnings } = snapshotBody(inputs, { skillDir: o.skillDir || SKILL_DIR });
  const snapshotId = snapshotIdOf(body);
  const dir = checksDir(resultsRoot, snapshotId);
  const file = path.join(dir, 'snapshot.json');
  const existing = readJson(file);
  const reused = !!(existing && existing.snapshotId === snapshotId);
  const snapshot = reused ? existing : { schema: SNAPSHOT_SCHEMA, snapshotId, createdAt: (o.now ? new Date(o.now) : new Date()).toISOString(), inputs, body };
  if (!reused && o.write !== false) writeJsonAtomic(file, snapshot);
  return { snapshotId, file, snapshot, warnings, reused };
}

export function loadSnapshot(resultsRoot, id) {
  const s = readJson(path.join(checksDir(resultsRoot, id), 'snapshot.json'));
  return s && s.snapshotId === id ? s : null;
}

function diffSection(name, a, b, out) {
  if (canon(a) === canon(b)) return;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    for (const k of uniq([...Object.keys(a), ...Object.keys(b)])) {
      if (canon(a[k]) === canon(b[k])) continue;
      if (a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(a[k]) && Object.keys(a[k]).length + Object.keys(b[k]).length <= 400) diffSection(name + '.' + k, a[k], b[k], out);
      else out.push({ section: name, key: k, was: k in a ? (typeof a[k] === 'string' ? a[k] : 'changed') : 'absent', now: k in b ? (typeof b[k] === 'string' ? b[k] : 'changed') : 'absent' });
    }
  } else out.push({ section: name, key: null, was: 'changed', now: 'changed' });
}

/** Recompute the snapshot from its own inputs; any difference voids the checkpoint (no edits during a checkpoint). */
export function rehash(snapshot, { skillDir = SKILL_DIR } = {}) {
  const { body } = snapshotBody(snapshot.inputs, { skillDir });
  const differences = [];
  for (const k of uniq([...Object.keys(snapshot.body), ...Object.keys(body)])) diffSection(k, snapshot.body[k], body[k], differences);
  return { matched: differences.length === 0, differences };
}

/* ---------------- results (§6.3) ---------------- */

export const resultsFile = (resultsRoot, id) => path.join(checksDir(resultsRoot, id), 'results.jsonl');
const UNIT_RE = /^(scope|phase|tool:[a-z][\w-]*|file:.+)$/;

/** Every line of a results file — a torn or non-object line is kept as a protocol error. */
export function readResults(file) {
  const out = [];
  const text = read(file);
  if (text === null) return out;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    try { const o = JSON.parse(line); out.push(o && typeof o === 'object' && !Array.isArray(o) ? { ...o, _line: i + 1 } : { _line: i + 1, _invalid: 'not an object' }); }
    catch { out.push({ _line: i + 1, _invalid: 'not valid JSON' }); }
  });
  return out;
}

/** The rules one result must meet before it is written — shared by record and record --batch. */
function validateResult({ snapshotId, checkId, unit, status, reason, evidence = [], executor = null, at = null }) {
  const errors = [];
  const warnings = [];
  const check = CHECK_BY_ID.get(String(checkId));
  if (!check) errors.push('unknown check "' + checkId + '" — ids: ' + CHECKS.map((c) => c.id).join(', '));
  if (!UNIT_RE.test(String(unit || ''))) errors.push('unit must be scope | phase | tool:{name} | file:{path}');
  if (!RESULT_STATUSES.includes(status)) errors.push('status must be one of ' + RESULT_STATUSES.join(' | '));
  const ex = executor || (String(unit).startsWith('tool:') ? 'V' : unit === 'phase' ? 'S' : 'M');
  if (!EXECUTORS.includes(ex)) errors.push('executor must be one of ' + EXECUTORS.join(' | '));
  const why = String(reason || '').trim();
  if (status !== 'verified-mechanical' && status !== 'scheduled-for-B' && why.length < 8) errors.push('a ' + status + ' result needs a reason (what was read and why)');
  const refs = Array.isArray(evidence) ? evidence.filter(Boolean) : csv(evidence);
  if (status === 'verified-semantic' && !refs.length) errors.push('verified-semantic needs --evidence file:line of what was read');
  if (SECRET_LINE.test(why) || refs.some((r) => SECRET_LINE.test(r))) errors.push('the reason or evidence looks like it carries a credential — never record one');
  if (String(unit).startsWith('tool:')) warnings.push('tool:* units are written by check.mjs run --snapshot; a hand-written one usually duplicates it');
  if (errors.length) return { ok: false, errors, warnings };
  const record = { checkId: String(checkId), unit, snapshotId, status, reason: why || (status === 'scheduled-for-B' ? 'runtime evidence exists only after execution' : 'verified'), evidenceRef: refs, executor: ex, at: at || new Date().toISOString() };
  return { ok: true, errors, warnings, record };
}

/** Validate and append ONE result. A duplicate is warned about, never refused — the gate rejects it. */
export function recordResult({ resultsRoot, snapshotId, checkId, unit, status, reason, evidence = [], executor = null, at = null }) {
  const snap = loadSnapshot(resultsRoot, snapshotId);
  const v = validateResult({ snapshotId, checkId, unit, status, reason, evidence, executor, at });
  if (!snap) v.errors.unshift('no snapshot ' + snapshotId + ' under ' + posix(checksDir(resultsRoot, snapshotId)) + ' — take the snapshot first');
  if (v.errors.length) return { ok: false, errors: v.errors, warnings: v.warnings };
  const { record, warnings } = v;
  const file = resultsFile(resultsRoot, snapshotId);
  const existing = readResults(file).filter((r) => String(r.checkId) === String(checkId) && r.unit === unit && r.snapshotId === snapshotId);
  if (existing.length) warnings.push('a result for (' + checkId + ', ' + unit + ') already exists — the gate rejects both as ' + (existing.some((r) => r.status !== status) ? 'contradictory' : 'duplicate') + ' until one line is removed');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
  return { ok: true, record, file, warnings };
}

/** The entries of a --batch file: a JSON array, or { snapshot | snapshotId, results: [...] }. */
export function parseBatch(text) {
  let data;
  try { data = JSON.parse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { entries: null, snapshotId: null, error: 'the batch file is not valid JSON (' + e.message + ')' }; }
  if (Array.isArray(data)) return { entries: data, snapshotId: null, error: null };
  if (data && typeof data === 'object' && Array.isArray(data.results)) return { entries: data.results, snapshotId: data.snapshotId ?? data.snapshot ?? null, error: null };
  return { entries: null, snapshotId: null, error: 'the batch file must be a JSON array of results or { "snapshot": "<id>", "results": [ … ] }' };
}

/**
 * Validate a whole set of results and write it in ONE atomic replace — or nothing. Each entry is
 * { check | checkId, unit (default scope), status, reason, evidence | evidenceRef, executor?, snapshot | snapshotId? }.
 * Rejected (the batch writes nothing) when ANY entry breaks a single-record rule, names another snapshot (stale), repeats
 * a (check, unit) of the batch, or meets one already recorded for the snapshot (duplicate / contradictory — the gate
 * would reject both); and when the snapshot no longer re-hashes to itself (its scope changed after the freeze) or the
 * results file changed while the batch was being checked. `rehashFn` is injectable for the harness.
 */
export function recordBatch({ resultsRoot, snapshotId, entries, batchSnapshotId = null, at = null, skillDir = SKILL_DIR, rehashFn = rehash }) {
  const errors = [];
  const warnings = [];
  const fail = () => ({ ok: false, written: 0, count: Array.isArray(entries) ? entries.length : 0, errors, warnings });
  const snap = loadSnapshot(resultsRoot, snapshotId);
  if (!snap) errors.push({ index: null, error: 'no snapshot ' + snapshotId + ' under ' + posix(checksDir(resultsRoot, snapshotId)) + ' — take the snapshot first' });
  if (batchSnapshotId !== null && batchSnapshotId !== undefined && String(batchSnapshotId) !== String(snapshotId)) errors.push({ index: null, error: 'stale: the batch names snapshot ' + batchSnapshotId + ', not ' + snapshotId });
  if (!Array.isArray(entries) || !entries.length) errors.push({ index: null, error: 'the batch holds no result' });
  if (errors.length) return fail();
  const stamp = at || new Date().toISOString();
  const records = [];
  const entryOf = [];
  const seen = new Map();
  entries.forEach((e, index) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push({ index, error: 'not an object' }); return; }
    const checkId = e.checkId ?? e.check;
    const unit = e.unit === undefined || e.unit === null || e.unit === '' ? 'scope' : String(e.unit);
    const tag = { index, check: checkId === undefined ? null : String(checkId), unit };
    const own = e.snapshotId ?? e.snapshot;
    if (own !== undefined && own !== null && String(own) !== String(snapshotId)) { errors.push({ ...tag, error: 'stale: snapshot ' + own + ' ≠ ' + snapshotId }); return; }
    const evidence = Array.isArray(e.evidence) ? e.evidence : Array.isArray(e.evidenceRef) ? e.evidenceRef : csv(e.evidence ?? e.evidenceRef);
    const v = validateResult({ snapshotId, checkId, unit, status: e.status, reason: e.reason, evidence, executor: e.executor ?? null, at: stamp });
    for (const w of v.warnings) warnings.push('entry ' + index + ': ' + w);
    if (!v.ok) { for (const err of v.errors) errors.push({ ...tag, error: err }); return; }
    const k = v.record.checkId + '|' + unit;
    if (seen.has(k)) {
      const first = records[seen.get(k)];
      errors.push({ ...tag, error: (first.status === v.record.status ? 'duplicate' : 'contradictory') + ': entry ' + seen.get(k) + ' already gives (' + v.record.checkId + ', ' + unit + ')' });
      return;
    }
    seen.set(k, records.length);
    records.push(v.record);
    entryOf.push(index);
  });
  const file = resultsFile(resultsRoot, snapshotId);
  const before = read(file);
  for (const r of readResults(file)) {
    if (r._invalid || r.snapshotId !== snapshotId) continue;
    const k = String(r.checkId) + '|' + r.unit;
    if (!seen.has(k)) continue;
    const i = seen.get(k);
    errors.push({ index: entryOf[i], check: String(r.checkId), unit: r.unit,
      error: (r.status === records[i].status ? 'duplicate' : 'contradictory') + ': results.jsonl line ' + r._line + ' already gives (' + r.checkId + ', ' + r.unit + ') for this snapshot' });
  }
  if (errors.length) return fail();
  let rh;
  try { rh = rehashFn(snap, { skillDir }); } catch (e) { rh = { matched: false, differences: [{ section: 'rehash', key: null, was: 'error', now: e.message }] }; }
  if (!rh.matched) {
    errors.push({ index: null, error: 'stale: the snapshot no longer matches its scope (' + rh.differences.length + ' difference(s), first ' + [rh.differences[0].section, rh.differences[0].key].filter(Boolean).join('.') + ') — take a new snapshot; nothing was recorded' });
    return fail();
  }
  if (read(file) !== before) { errors.push({ index: null, error: 'results.jsonl changed while the batch was checked — run the batch again' }); return fail(); }
  const text = (before === null ? '' : before.endsWith('\n') || before === '' ? before : before + '\n') + records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } errors.push({ index: null, error: 'could not write ' + posix(file) + ': ' + e.message }); return fail(); }
  return { ok: true, written: records.length, count: entries.length, file, errors: [], warnings, records };
}

/* ---------------- mechanical results (check.mjs run --snapshot) ---------------- */

function fromValidator(check, v, ruleIds) {
  if (!v) return { status: 'unresolved', reason: 'the validator did not run on this snapshot', evidence: [] };
  if (v.error) return { status: 'unresolved', reason: 'the validator failed: ' + v.error, evidence: [] };
  if (v.gate === 'NOT_RUN') return { status: 'unresolved', reason: 'validator NOT_RUN — ' + v.gateReason, evidence: [] };
  const rules = new Set(check.rules.filter((r) => ruleIds.has(r)));
  const mine = (v.findings || []).filter((f) => rules.has(f.ruleId));
  const violations = mine.filter((f) => f.severity === 'violation');
  const open = mine.filter((f) => f.severity === 'review' || f.severity === 'warning');
  const notRun = (v.notRun || []).filter((n) => rules.has(n.ruleId));
  const gaps = ((v.scope && v.scope.unreadable) || []).length + ((v.scope && v.scope.parseFailures) || []).length;
  const ref = (f) => f.file + ':' + f.line + ' ' + f.ruleId;
  if (violations.length) return { status: 'FAIL', reason: violations.length + ' violation(s) of ' + uniq(violations.map((f) => f.ruleId)).join(', '), evidence: violations.slice(0, 20).map(ref) };
  if (gaps) return { status: 'unresolved', reason: gaps + ' scoped file(s) could not be scanned — the rules never ran over them (close with project tooling or documented review)', evidence: [...((v.scope.unreadable || []).map((u) => u.file)), ...((v.scope.parseFailures || []).map((u) => u.file))].slice(0, 20) };
  if (open.length || notRun.length) return { status: 'unresolved', reason: open.length + ' open review / warning item(s) and ' + notRun.length + ' applicable rule(s) not run — closed only by a verified-semantic scope result', evidence: [...open.slice(0, 15).map(ref), ...notRun.slice(0, 5).map((n) => n.ruleId + ' not run: ' + n.reason)] };
  return { status: 'verified-mechanical', reason: 'no finding of ' + ([...rules].join(', ') || '—') + ' in ' + ((v.counts && v.counts.files) || 0) + ' scanned file(s)', evidence: [] };
}

function fromTool(unit, c) {
  if (unit === 'tool:tsc') {
    const t = c.tsc;
    if (!t || t.status === 'notRun') return { status: 'unresolved', reason: 'the type check did not run: ' + (t ? t.reason : 'no result'), evidence: [] };
    if (t.status === 'FAIL') return { status: 'FAIL', reason: t.errors.length + ' type-check error(s)', evidence: t.errors.slice(0, 20).map((e) => (e.file ? e.file + ':' + e.line + ' ' : '') + e.code) };
    return { status: 'verified-mechanical', reason: 'the project type check passed (imports resolve)', evidence: [] };
  }
  if (unit === 'tool:scan') {
    const s = c.scan;
    if (!s) return { status: 'unresolved', reason: 'the spec-imports-spec scan did not run', evidence: [] };
    if (s.hits.length) return { status: 'FAIL', reason: s.hits.length + ' spec file(s) import another spec', evidence: s.hits.slice(0, 20).map((h) => h.file + ':' + h.line + ' imports ' + h.imports) };
    if (s.unreadable.length) return { status: 'unresolved', reason: s.unreadable.length + ' spec file(s) could not be scanned', evidence: s.unreadable.slice(0, 20) };
    return { status: 'verified-mechanical', reason: 'no spec imports another spec (' + s.specs + ' spec file(s))', evidence: [] };
  }
  if (unit === 'tool:configs') {
    const i = c.configs;
    if (!i || i.error) return { status: 'unresolved', reason: 'the config inventory did not run' + (i && i.error ? ': ' + i.error : ''), evidence: [] };
    if (i.verdict === 'none') return { status: 'FAIL', reason: 'no playwright*.config.* found — the one shared configuration is missing', evidence: [] };
    if (i.verdict === 'multiple') return { status: 'unresolved', reason: (i.configs.length - 1) + ' extra configuration(s) — each must be consolidated or listed under "Configurations not merged" with its blocking setting', evidence: i.configs.filter((x) => x.file !== i.shared).slice(0, 20).map((x) => x.file + ' ' + x.mergeable) };
    return { status: 'verified-mechanical', reason: 'one shared configuration: ' + i.shared, evidence: [] };
  }
  if (unit === 'tool:protections') {
    // config-inventory.mjs reconcile (dry-run): an unbounded operation, a disabled protection or a value above its target
    // without an approved exception is a FAIL — repaired (reconcile --apply or by hand), never closed by review
    const r = c.protections;
    if (!r || r.error) return { status: 'unresolved', reason: 'the protections check did not run' + (r && r.error ? ': ' + r.error : ''), evidence: [] };
    if (r.outcome === 'BLOCKED') return { status: 'unresolved', reason: r.reason || 'reconcile BLOCKED', evidence: [] };
    if ((r.blocking || []).length) return { status: 'FAIL', reason: r.blocking.length + ' run protection(s) not active (unbounded operation / disabled protection / above target without an exception)', evidence: r.blocking.slice(0, 20) };
    return { status: 'verified-mechanical', reason: 'every run protection active: ' + (r.settings || []).length + ' effective setting(s) checked (finite budgets, stall keys, helpers, retries 0, visible local browsers)', evidence: [] };
  }
  if (unit === 'tool:lint') {
    const l = c.lint;
    if (!l || l.status === 'notRun') return { status: 'unresolved', reason: 'the project lint did not run' + (l && l.reason ? ': ' + l.reason : ' (pass --lint)'), evidence: [] };
    if (l.floating.length) return { status: 'FAIL', reason: l.floating.length + ' floating promise(s) reported by @typescript-eslint/no-floating-promises', evidence: l.floating.slice(0, 20).map((m) => m.file + ':' + m.line) };
    return { status: 'verified-mechanical', reason: 'no floating promise reported by the project lint (type-aware no-floating-promises enabled)', evidence: [] };
  }
  return { status: 'unresolved', reason: 'unknown tool unit ' + unit, evidence: [] };
}

/** One mechanical record per (check, tool unit) the checkpoint needs. */
export function mechanicalRecords({ checkpoint, facts, snapshotId, components, at }) {
  const ruleIds = new Set(facts.validatorRuleIds || Object.keys(RULES));
  const preds = facts.predicates || {};
  const out = [];
  for (const c of CHECKS) {
    if (c.na && preds[c.na] && preds[c.na].noSubject && !(checkpoint === 'B' && c.neverNA)) continue; // no subject: N/A, nothing to record
    for (const u of unitsFor(c, checkpoint, facts)) {
      if (!u.startsWith('tool:')) continue;
      const r = u === 'tool:validator' ? fromValidator(c, components.validator, ruleIds) : fromTool(u, components);
      out.push({ checkId: c.id, unit: u, snapshotId, status: r.status, reason: r.reason, evidenceRef: r.evidence, executor: u === 'tool:validator' ? 'V' : 'S', at });
    }
  }
  return out;
}

/* ---------------- tool processes and the compliance limit (A4 / A14) ---------------- */

/** Run jobs with at most `limit` at once; `acquire` may wait (the ledger), `release` frees the slot. */
export async function runPool(jobs, limit, { acquire = async () => null, release = async () => {} } = {}) {
  const results = new Array(jobs.length);
  let next = 0;
  let active = 0;
  let maxActive = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      let token = null;
      try { token = await acquire(jobs[i]); }
      catch (e) { results[i] = { status: 'notRun', reason: 'no compliance slot: ' + e.message }; continue; }
      active++;
      maxActive = Math.max(maxActive, active);
      try { results[i] = await jobs[i].run(token); }
      catch (e) { results[i] = { status: 'notRun', reason: e.message }; }
      finally { active--; try { await release(token, jobs[i]); } catch { /* the ledger sweep resolves it */ } }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length || 1)) }, worker));
  return { results, maxActive };
}

function spawnCollect(cmd, args, { cwd, timeoutMs = 600000, onSpawn = null } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: null, signal: null, stdout: '', stderr: '', error: e.message, timedOut: false }); return; }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* gone */ } }, timeoutMs);
    timer.unref();
    if (onSpawn && child.pid) Promise.resolve(onSpawn(child.pid)).catch(() => {});
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { if (stdout.length < 8 * MB) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < MB) stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr, error: e.message, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, error: null, timedOut }); });
  });
}

export function parseTscErrors(text, cwd, root) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m = line.match(/^(.*?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/);
    if (m) { out.push({ file: relTo(root, path.resolve(cwd, m[1])), line: Number(m[2]), code: m[4], message: filtered(m[5]).slice(0, 200) }); continue; }
    m = line.match(/^error\s+(TS\d+):\s+(.*)$/);
    if (m) out.push({ file: null, line: null, code: m[1], message: filtered(m[2]).slice(0, 200) });
  }
  return out;
}

async function runTsc({ tscPath, tsconfig, cwd, root, timeoutMs, onSpawn }) {
  if (!tscPath) return { status: 'notRun', reason: 'TypeScript not found (node_modules/typescript/bin/tsc under the automation root or the project root, or --tsc) — the type check did not run; never recorded PASS' };
  if (!tsconfig) return { status: 'notRun', reason: 'no tsconfig.json under the automation root or the project root (--tsconfig)' };
  const r = await spawnCollect(process.execPath, [tscPath, '--noEmit', '-p', tsconfig, '--pretty', 'false'], { cwd, timeoutMs, onSpawn });
  const raw = filtered((r.stdout || '') + (r.stderr ? '\n' + r.stderr : ''));
  if (r.error) return { status: 'notRun', reason: 'the type check could not start: ' + r.error, raw };
  if (r.timedOut) return { status: 'notRun', reason: 'the type check exceeded ' + Math.round(timeoutMs / 1000) + ' s and was stopped', raw };
  const errors = parseTscErrors(r.stdout + '\n' + r.stderr, cwd, root);
  if (r.code === 0) return { status: 'PASS', errors: [], exit: 0, raw };
  if (!errors.length) return { status: 'notRun', reason: 'the type check exited ' + r.code + ' without a diagnostic', exit: r.code, raw };
  return { status: 'FAIL', errors, exit: r.code, raw };
}

async function runLint({ eslintPath, files, cwd, root, timeoutMs, onSpawn }) {
  if (!eslintPath) return { status: 'notRun', reason: 'ESLint not found (node_modules/eslint/bin/eslint.js, or --eslint)', floating: [], problems: 0 };
  const r = await spawnCollect(process.execPath, [eslintPath, '--format', 'json', '--no-error-on-unmatched-pattern', ...files.map((f) => path.resolve(root, f))], { cwd, timeoutMs, onSpawn });
  if (r.error) return { status: 'notRun', reason: 'ESLint could not start: ' + r.error, floating: [], problems: 0 };
  if (r.timedOut) return { status: 'notRun', reason: 'ESLint exceeded ' + Math.round(timeoutMs / 1000) + ' s and was stopped', floating: [], problems: 0 };
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* below */ }
  if (!Array.isArray(report)) return { status: 'notRun', reason: 'ESLint exited ' + r.code + ' without a JSON report', floating: [], problems: 0, raw: filtered(r.stderr).slice(0, 2000) };
  const messages = report.flatMap((f) => (f.messages || []).map((m) => ({ file: relTo(root, path.resolve(cwd, f.filePath || '')), line: m.line || null, ruleId: m.ruleId || null, severity: m.severity, message: filtered(m.message).slice(0, 200) })));
  const errors = messages.filter((m) => m.severity === 2);
  return { status: errors.length ? 'FAIL' : 'PASS', problems: messages.length, errors: errors.length, floating: messages.filter((m) => m.ruleId === '@typescript-eslint/no-floating-promises'), first: errors.slice(0, 5) };
}

function cpuIdleCores(sampleMs = 200) {
  const t = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq }), { idle: 0, total: 0 });
  const a = t();
  const until = Date.now() + sampleMs;
  while (Date.now() < until) { /* a short busy sample, once per call */ }
  const b = t();
  const dt = b.total - a.total;
  return dt > 0 ? os.cpus().length * ((b.idle - a.idle) / dt) : os.cpus().length;
}

/** The compliance limit: the capacity ledger's `compliance` class when ./capacity.mjs works, else `limit` here. */
export async function complianceSlots({ limit = null, runId = null, runFile = null, noLedger = false, warnings = [] } = {}) {
  const local = (n) => ({ mode: 'local', limit: n, selfHeld: true, acquire: async () => null, release: async () => {}, activate: async () => {}, close: async () => {} });
  const want = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT;
  if (noLedger) return local(want);
  let cap;
  try { cap = await import(pathToFileURL(path.join(here, 'capacity.mjs')).href); }
  catch (e) { warnings.push('capacity ledger unavailable (' + e.message + ') — compliance limit ' + want + ' applied in this process only'); return local(want); }
  try {
    const dir = cap.resolveCapacityDir();
    const cfg = cap.readConfig(dir) || {};
    const classLimit = Math.max(1, Math.min(want, Number(cfg.classes && cfg.classes.compliance) || DEFAULT_LIMIT));
    const owner = { runId: runId || 'check-' + process.pid, runFile: runFile || null };
    const demand = (cap.BOOTSTRAP_DEMAND && cap.BOOTSTRAP_DEMAND.compliance) || null;
    const idle = cpuIdleCores();
    const admission = typeof cap.admissionCheck === 'function' ? (ledger) => cap.admissionCheck({
      availableMb: os.freemem() / MB, idleCores: idle,
      committed: typeof cap.committedOutstanding === 'function' ? cap.committedOutstanding((ledger && ledger.entries) || [], {}, Date.now()) : { memMb: 0, cpu: 0 },
      demand: demand || { memMb: 0, cpu: 0 }, reserves: cap.reservesFor({ totalMemMb: os.totalmem() / MB, cpus: os.cpus().length }), pressure: false, leaseValid: true,
    }) : null;
    // a tool process (type check, lint) brings its projected memory and passes the memory / CPU admission (§6.4);
    // this process itself (validator, inventory — in-process, light) only takes a class slot
    const reserveOne = async (tool) => {
      const r = await cap.reserve({ dir, cls: 'compliance', units: 1, limit: classLimit, demand: tool ? demand : null, owner, admission: tool ? admission : null, waitMs: tool ? 300000 : 600000 });
      if (!r || !r.ok) throw new Error((r && r.reason) || 'not granted');
      return r.token;
    };
    const self = classLimit >= 2 ? await reserveOne(false) : null;
    return {
      mode: 'ledger', limit: classLimit, selfHeld: !!self,
      acquire: async () => reserveOne(true),
      activate: async (token, pid) => { if (token && typeof cap.activate === 'function') await cap.activate({ dir, token, pid }); },
      // the tool process has exited (its close event) before the release: nothing recorded is alive any more
      release: async (token) => { if (token) await cap.release({ dir, token, rows: [] }); },
      close: async () => { if (self) await cap.release({ dir, token: self, rows: [] }); },
    };
  } catch (e) {
    warnings.push('capacity ledger not used (' + e.message + ') — compliance limit ' + want + ' applied in this process only');
    return local(want);
  }
}

function firstFile(list) { return list.find((p) => p && isFile(p)) || null; }

function worstGate(components, lintAsked) {
  const v = components.validator;
  if ((components.tsc && components.tsc.status === 'FAIL') || (v && v.gate === 'FAIL') || (lintAsked && components.lint && components.lint.status === 'FAIL') || (components.scan && components.scan.hits.length)) return 'FAIL';
  if (!v || v.error || v.gate === 'BLOCKED' || (components.tsc && components.tsc.status === 'notRun') || (lintAsked && components.lint && components.lint.status === 'notRun') || (components.configs && components.configs.error)) return 'BLOCKED';
  if (v.gate === 'NOT_RUN') return 'NOT_RUN';
  return 'PASS';
}

/** A4 + A14 + A15: every mechanical check in ONE call; records per (check, tool) when a snapshot is given.
 *  Returns { compact, full } — the compact form is what the model reads (A3), the full one goes to disk. */
export async function runChecks(o) {
  const warnings = [];
  const at = (o.now ? new Date(o.now) : new Date()).toISOString();
  const base = { tool: 'check', schema: SCHEMA, cmd: 'run' };
  const early = (obj) => ({ compact: obj, full: obj });
  let inputs;
  let snapshot = null;
  const resultsRoot = o.resultsRoot ? path.resolve(o.root || process.cwd(), o.resultsRoot) : null;
  if (o.snapshotId) {
    if (!resultsRoot) return early({ ...base, gate: 'BLOCKED', reason: '--snapshot needs --results-root', warnings });
    snapshot = loadSnapshot(resultsRoot, o.snapshotId);
    if (!snapshot) return early({ ...base, gate: 'BLOCKED', reason: 'snapshot ' + o.snapshotId + ' not found under ' + posix(path.join(resultsRoot, 'artifacts', 'checks')), warnings });
    inputs = { ...snapshot.inputs };
    const rh = rehash(snapshot, { skillDir: o.skillDir || SKILL_DIR });
    if (!rh.matched) return early({ ...base, gate: 'BLOCKED', void: true, snapshotId: o.snapshotId, reason: 'the scope changed after snapshot ' + o.snapshotId + ' — take a new snapshot (no edits during a checkpoint)', differences: rh.differences.slice(0, 20), warnings });
  } else {
    const root = path.resolve(o.root || process.cwd());
    inputs = { root, automationRoot: automationRootOf(root, o.automationRoot), files: uniq((o.files || []).map((f) => relTo(root, path.resolve(root, f)))), tc: o.tc || null, data: o.data || null, req: o.req || [], inventory: o.inventory || null, requireSteps: !!o.requireSteps, tsconfig: o.tsconfig || null, runFile: o.runFile || null, checkpoint: null };
  }
  if (!inputs.files.length) return early({ ...base, gate: 'NOT_RUN', reason: 'no --files: name the in-scope specs and the page objects, fixtures and helpers they touch', warnings });
  const root = inputs.root;
  const autoDir = path.resolve(root, inputs.automationRoot);
  const tscPath = o.tsc ? path.resolve(root, o.tsc) : firstFile([path.join(autoDir, 'node_modules', 'typescript', 'bin', 'tsc'), path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')]);
  const tsconfig = inputs.tsconfig ? path.resolve(root, inputs.tsconfig) : firstFile([path.join(autoDir, 'tsconfig.json'), path.join(root, 'tsconfig.json')]);
  const lintAsked = !!o.lint;
  const eslintPath = lintAsked ? (o.eslint ? path.resolve(root, o.eslint) : firstFile([path.join(autoDir, 'node_modules', 'eslint', 'bin', 'eslint.js'), path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js')])) : null;
  const timeoutMs = Number(o.toolTimeoutMs) > 0 ? Number(o.toolTimeoutMs) : 600000;
  const slots = o.slots || await complianceSlots({ limit: o.limit, runId: o.runId, runFile: inputs.runFile, noLedger: o.noLedger, warnings });
  const spawnLimit = Math.max(1, slots.limit - (slots.selfHeld && slots.limit >= 2 ? 1 : 0));
  const spawnJobs = [{ name: 'tsc', run: (token) => (o.runTool ? o.runTool('tsc', token) : runTsc({ tscPath, tsconfig, cwd: autoDir, root, timeoutMs, onSpawn: (pid) => slots.activate(token, pid) })) }];
  if (lintAsked) spawnJobs.push({ name: 'lint', run: (token) => (o.runTool ? o.runTool('lint', token) : runLint({ eslintPath, files: inputs.files, cwd: autoDir, root, timeoutMs, onSpawn: (pid) => slots.activate(token, pid) })) });
  const pool = runPool(spawnJobs, spawnLimit, { acquire: slots.acquire, release: slots.release });
  // in-process checks run while the tool processes work
  const components = {};
  try { components.validator = runValidator(inputs); } catch (e) { components.validator = { error: e.message }; }
  try { components.configs = inventory({ root, automationRoot: inputs.automationRoot }); } catch (e) { components.configs = { error: e.message, configs: [] }; }
  components.scan = specImportScan(root, inputs.files);
  components.timeouts = timeoutReport({ root, automationRoot: inputs.automationRoot, configFiles: (components.configs.configs || []).map((c) => c.file) });
  try { components.protections = reconcile({ root, automationRoot: inputs.automationRoot, runFile: inputs.runFile }); } catch (e) { components.protections = { error: e.message }; }
  const lf = lintFacts([autoDir, root]);
  const { results, maxActive } = await pool;
  try { await slots.close(); } catch { /* the ledger sweep resolves it */ }
  components.tsc = results[0];
  components.lint = lintAsked ? results[1] : null;
  if (components.lint) components.lint.deterministicFloatingPromises = lf.floatingPromises;
  const gate = worstGate(components, lintAsked);

  // mechanical results for the frozen snapshot
  let recorded = null;
  let recordNote = null;
  if (snapshot) {
    const file = resultsFile(resultsRoot, snapshot.snapshotId);
    const already = readResults(file).some((r) => String(r.unit || '').startsWith('tool:') && r.snapshotId === snapshot.snapshotId && r.executor !== 'M');
    if (already) { recorded = 0; recordNote = 'mechanical results for this snapshot already exist — not recorded twice (a second set would be duplicates the gate rejects)'; }
    else {
      const recs = mechanicalRecords({ checkpoint: snapshot.body.checkpoint, facts: snapshot.body.facts, snapshotId: snapshot.snapshotId, components, at });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''));
      recorded = recs.length;
    }
  }

  const v = components.validator || {};
  const open = [
    ...((v.findings || []).filter((f) => f.severity === 'violation' || f.severity === 'review' || f.severity === 'warning').map((f) => f.ruleId + ' ' + f.file + ':' + f.line)),
    ...((v.notRun || []).map((n) => n.ruleId + ' not run')),
  ];
  const full = {
    ...base, gate, at, snapshotId: snapshot ? snapshot.snapshotId : null, root: posix(root), automationRoot: inputs.automationRoot, files: inputs.files,
    slots: { mode: slots.mode, limit: slots.limit, spawnLimit, maxActive },
    components: {
      tsc: components.tsc, lint: components.lint,
      validator: v.error ? { error: v.error } : { gate: v.gate, gateReason: v.gateReason, counts: v.counts, findings: v.findings, review: v.review, notRun: v.notRun, exceptions: v.exceptions, fingerprint: v.fingerprint, scope: v.scope, pageScan: v.pageScan },
      configs: components.configs.error ? { error: components.configs.error } : { verdict: components.configs.verdict, shared: components.configs.shared, configs: (components.configs.configs || []).map((c) => ({ file: c.file, mergeable: c.mergeable, blocking: c.blocking })), deletable: components.configs.deletable },
      scan: components.scan, timeouts: components.timeouts, protections: components.protections, lintFacts: { enabled: lf.enabled, typeAware: lf.typeAware, floatingPromises: lf.floatingPromises },
    },
    recorded, recordNote, warnings,
  };
  let fullPath = null;
  if (resultsRoot) {
    const dir = checksDir(resultsRoot, snapshot ? snapshot.snapshotId : 'adhoc');
    fullPath = path.join(dir, 'run-' + at.replace(/[:.]/g, '-') + '.json');
    writeJsonAtomic(fullPath, full);
    if (components.tsc && components.tsc.raw) fs.writeFileSync(path.join(dir, 'tsc-' + at.replace(/[:.]/g, '-') + '.txt'), components.tsc.raw);
  } else warnings.push('no --results-root: the full output was not written to disk (compact payload only)');
  const compact = {
    ...base, gate, snapshotId: full.snapshotId,
    components: {
      tsc: { status: components.tsc.status, errors: (components.tsc.errors || []).length, first: (components.tsc.errors || []).slice(0, 5).map((e) => (e.file ? e.file + ':' + e.line + ' ' : '') + e.code + ' ' + e.message.slice(0, 100)), reason: components.tsc.reason || undefined },
      validator: v.error ? { error: v.error } : { gate: v.gate, counts: { files: v.counts.files, tests: v.counts.tests, violation: v.counts.violation, warning: v.counts.warning, review: v.counts.review, notRun: v.counts.notRun, exceptions: v.counts.exceptions }, open: open.slice(0, 10), more: Math.max(0, open.length - 10) },
      configs: components.configs.error ? { error: components.configs.error } : { verdict: components.configs.verdict, configs: (components.configs.configs || []).length },
      lint: components.lint ? { status: components.lint.status, problems: components.lint.problems, floating: (components.lint.floating || []).length, deterministic: lf.floatingPromises, reason: components.lint.reason || undefined } : null,
      scan: { specImportsSpec: components.scan.hits.length },
      timeouts: { unlimited: components.timeouts.unlimited.length, long: components.timeouts.long.length, items: [...components.timeouts.unlimited.map((u) => u.file + ' ' + u.setting + ' ' + u.value), ...components.timeouts.long.map((l) => l.key + ' ' + l.ms + ' ms')].slice(0, 10) },
      protections: components.protections && !components.protections.error ? { outcome: components.protections.outcome, blocking: (components.protections.blocking || []).slice(0, 10), conflicts: (components.protections.conflicts || []).length } : { error: components.protections && components.protections.error },
    },
    slots: full.slots, recorded, recordNote: recordNote || undefined, full: fullPath ? posix(fullPath) : null, warnings,
  };
  return { compact, full };
}

/* ---------------- the gate (B18) ---------------- */

/** Results freshness for B: an impact.mjs select payload, else the run file's impact.final_check. */
export function freshnessOf({ impactJson = null, runJson = null }) {
  const pick = (x) => (Array.isArray(x) ? x.map((s) => (typeof s === 'string' ? s : (s && (s.tc || s.id)) || '?')) : null);
  if (impactJson && pick(impactJson.stale)) return { known: true, stale: pick(impactJson.stale), source: 'impact.mjs select payload' };
  const fc = runJson && runJson.impact && runJson.impact.final_check;
  if (fc && pick(fc.stale)) return { known: true, stale: pick(fc.stale), source: 'run file impact.final_check' };
  return { known: false, stale: [], source: null };
}

const sortKey = (r) => { const i = CHECKS.findIndex((c) => c.id === String(r.checkId)); return String(i < 0 ? 999 : i).padStart(3, '0') + '|' + r.unit; };

/** Decide a checkpoint from the snapshot's results — the result protocol of Revision 3.1 §6.3. */
export function decideGate({ checkpoint, snapshot, records, rehashResult = { matched: true, differences: [] }, freshness = null, now = null }) {
  const sid = snapshot.snapshotId;
  const facts = snapshot.body.facts || {};
  const rejected = [];
  const na = [];
  const accepted = new Map();
  const byKey = new Map();
  for (const r of records) {
    if (r._invalid) { rejected.push({ checkId: '?', unit: '?', why: 'invalid-record', detail: 'line ' + r._line + ': ' + r._invalid }); continue; }
    const id = String(r.checkId);
    const base = { checkId: id, unit: r.unit || '?' };
    if (!CHECK_BY_ID.has(id)) { rejected.push({ ...base, why: 'unknown-check', detail: 'line ' + r._line }); continue; }
    if (!UNIT_RE.test(String(r.unit || ''))) { rejected.push({ ...base, why: 'invalid-unit', detail: 'line ' + r._line }); continue; }
    if (!RESULT_STATUSES.includes(r.status)) { rejected.push({ ...base, why: 'invalid-status', detail: 'line ' + r._line + ': ' + r.status }); continue; }
    if (r.snapshotId !== sid) { rejected.push({ ...base, why: 'stale', detail: 'line ' + r._line + ': snapshot ' + r.snapshotId + ' ≠ ' + sid }); continue; }
    const k = id + '|' + r.unit;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  for (const [k, list] of byKey) {
    if (list.length > 1) {
      const [checkId, unit] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      rejected.push({ checkId, unit, why: uniq(list.map((x) => x.status)).length > 1 ? 'contradictory' : 'duplicate', detail: 'lines ' + list.map((x) => x._line).join(', ') + ' — fix the protocol error; results are never merged' });
      continue;
    }
    accepted.set(k, list[0]);
  }
  // per-result rules: runtime at A is scheduled-for-B; nothing is scheduled at B; N/A only with a true predicate
  for (const [k, r] of [...accepted]) {
    const c = CHECK_BY_ID.get(String(r.checkId));
    if (checkpoint === 'A' && r.unit === 'phase' && r.status !== 'scheduled-for-B') { rejected.push({ checkId: c.id, unit: r.unit, why: 'scheduled-at-B', detail: 'a runtime item at Checkpoint A is scheduled-for-B — neither PASS nor N/A' }); accepted.delete(k); continue; }
    if (checkpoint === 'B' && r.status === 'scheduled-for-B') { rejected.push({ checkId: c.id, unit: r.unit, why: 'scheduled-at-B', detail: 'nothing can be scheduled for Checkpoint B at Checkpoint B' }); accepted.delete(k); continue; }
    if (r.status === 'N/A') {
      const pred = c.na ? (facts.predicates || {})[c.na] : null;
      if ((checkpoint === 'B' && c.neverNA) || !pred || !pred.noSubject) { rejected.push({ checkId: c.id, unit: r.unit, why: 'na-not-allowed', detail: c.neverNA && checkpoint === 'B' ? 'never N/A at Checkpoint B' : pred ? 'its predicate (' + c.na + ') says the rule has a subject: ' + pred.evidence : 'this check has no applicability predicate' }); accepted.delete(k); continue; }
      na.push({ checkId: c.id, unit: r.unit, predicate: c.na, evidence: pred.evidence, recorded: true });
    }
  }
  // the required set
  const required = [];
  const auto = [];
  for (const c of CHECKS) {
    const units = unitsFor(c, checkpoint, facts);
    const runtimeHalfAtA = checkpoint === 'A' && c.B.includes('R');
    if (!units.length && !runtimeHalfAtA) continue;
    const pred = c.na ? (facts.predicates || {})[c.na] : null;
    const neverNA = checkpoint === 'B' && c.neverNA;
    if (pred && pred.noSubject && !neverNA) {
      if (!na.some((x) => x.checkId === c.id)) na.push({ checkId: c.id, unit: null, predicate: c.na, evidence: pred.evidence, recorded: false });
      continue;
    }
    if (c.naPart && (facts.predicates || {})[c.naPart] && facts.predicates[c.naPart].noSubject) na.push({ checkId: c.id, part: 'slot', unit: null, predicate: c.naPart, evidence: facts.predicates[c.naPart].evidence, recorded: false });
    if (runtimeHalfAtA && !accepted.has(c.id + '|phase') && !rejected.some((x) => x.checkId === c.id && x.unit === 'phase')) {
      const rec = { checkId: c.id, unit: 'phase', snapshotId: sid, status: 'scheduled-for-B', reason: 'runtime evidence exists only after execution — scheduled for Checkpoint B', evidenceRef: [], executor: 'S', at: (now ? new Date(now) : new Date()).toISOString(), auto: true };
      accepted.set(c.id + '|phase', rec);
      auto.push({ checkId: c.id, unit: 'phase' });
    }
    for (const u of units) required.push({ checkId: c.id, unit: u });
  }
  // a mechanical `unresolved` needs the semantic scope result that closes it
  for (const r of accepted.values()) {
    if (/^(tool|file):/.test(String(r.unit)) && r.status === 'unresolved' && !required.some((x) => x.checkId === String(r.checkId) && x.unit === 'scope')) required.push({ checkId: String(r.checkId), unit: 'scope', closure: true });
  }
  for (const q of required) {
    if (accepted.has(q.checkId + '|' + q.unit)) continue;
    if (rejected.some((x) => x.checkId === q.checkId && x.unit === q.unit)) continue;
    rejected.push({ checkId: q.checkId, unit: q.unit, why: 'missing', detail: q.closure ? 'a verified-semantic scope result must close the open mechanical items' : 'no current result for an applicable check' });
  }
  // statuses
  const fail = [];
  const open = [];
  const closed = [];
  for (const r of accepted.values()) {
    const id = String(r.checkId);
    if (r.status === 'FAIL') fail.push({ checkId: id, unit: r.unit, reason: r.reason });
    else if (r.status === 'unresolved') {
      const scope = accepted.get(id + '|scope');
      if (String(r.unit).startsWith('tool:') || String(r.unit).startsWith('file:')) {
        if (scope && scope.status === 'verified-semantic') { closed.push({ checkId: id, unit: r.unit, closedBy: 'scope' }); continue; }
      }
      open.push({ checkId: id, unit: r.unit, reason: r.reason });
    }
  }
  // Checkpoint B: results freshness and the Checkpoint A record
  let fresh;
  if (checkpoint === 'B') {
    fresh = freshness || { known: false, stale: [], source: null };
    if (!fresh.known) rejected.push({ checkId: 'freshness', unit: 'phase', why: 'missing', detail: 'no results-freshness check (impact.mjs select on the final code) — pass --impact or record impact.final_check' });
    else if (fresh.stale.length) open.push({ checkId: 'freshness', unit: 'phase', reason: 'stale results: ' + fresh.stale.join(', ') });
    if (!snapshot.body.gateA) rejected.push({ checkId: 'checkpoint-A', unit: 'record', why: 'missing', detail: 'no Checkpoint A gate record for this phase' });
    if (!snapshot.body.drafts || !Object.keys(snapshot.body.drafts).length) rejected.push({ checkId: 'drafts', unit: 'snapshot', why: 'missing', detail: 'Checkpoint B freezes the drafts (run file, report, bug file, page) — none were found under the drafts folder' });
  }
  if (!rehashResult.matched) rejected.push({ checkId: '*', unit: 'snapshot', why: 'void', detail: rehashResult.differences.length + ' difference(s) after the snapshot — no edits during a checkpoint; take a new snapshot' });
  const verdict = rejected.length ? 'BLOCKED' : fail.length ? 'FAIL' : open.length ? 'BLOCKED' : 'PASS';
  const results = [...accepted.values()].map(({ _line, ...r }) => r).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  return {
    schema: GATE_SCHEMA, checkpoint, phase: snapshot.body.phase, verdict, snapshotId: sid, snapshotFile: null,
    decidedAt: (now ? new Date(now) : new Date()).toISOString(),
    rehash: { matched: rehashResult.matched, differences: rehashResult.differences.slice(0, 50) },
    results, rejected, na, closed, open, fail, auto,
    ...(checkpoint === 'B' ? { freshness: { stale: fresh.stale, source: fresh.source, known: fresh.known }, frozen: { drafts: snapshot.body.drafts || {} }, gateA: snapshot.body.gateA } : {}),
    tools: snapshot.body.tools, executors: uniq(results.map((r) => r.executor).filter(Boolean)).sort(), scopeDigest: snapshot.body.scopeDigest || null,
    counts: { required: required.length, accepted: results.length, rejected: rejected.length, fail: fail.length, open: open.length, closed: closed.length, na: na.length, auto: auto.length },
  };
}

export const gateRecordPath = (resultsRoot, phase, checkpoint) => path.join(resultsRoot, '.runs', 'phase-' + phase + '.checkpoint-' + checkpoint + '.json');

/** gate CLI body: load, re-hash, decide, write the separate record (unless dryRun). */
export function runGate({ resultsRoot, snapshotId, checkpoint, phase = null, impact = null, dryRun = false, skillDir = SKILL_DIR, now = null }) {
  const snapshot = loadSnapshot(resultsRoot, snapshotId);
  if (!snapshot) return { error: 'snapshot ' + snapshotId + ' not found under ' + posix(path.join(resultsRoot, 'artifacts', 'checks')) };
  if (snapshot.body.checkpoint !== checkpoint) return { error: 'snapshot ' + snapshotId + ' was taken for Checkpoint ' + snapshot.body.checkpoint + ', not ' + checkpoint };
  if (phase !== null && Number(phase) !== Number(snapshot.body.phase)) return { error: 'snapshot ' + snapshotId + ' belongs to phase ' + snapshot.body.phase };
  const records = readResults(resultsFile(resultsRoot, snapshotId));
  const rehashResult = rehash(snapshot, { skillDir });
  let fresh = null;
  if (checkpoint === 'B') {
    const runJson = snapshot.inputs.runFile ? readJson(path.resolve(snapshot.inputs.root, snapshot.inputs.runFile)) : null;
    fresh = freshnessOf({ impactJson: impact ? readJson(impact) : null, runJson });
  }
  const rec = decideGate({ checkpoint, snapshot, records, rehashResult, freshness: fresh, now });
  rec.snapshotFile = posix(path.relative(resultsRoot, path.join(checksDir(resultsRoot, snapshotId), 'snapshot.json')));
  let written = null;
  if (!dryRun) {
    written = gateRecordPath(resultsRoot, snapshot.body.phase, checkpoint);
    writeJsonAtomic(written, rec);
    writeJsonAtomic(path.join(checksDir(resultsRoot, snapshotId), 'gate-' + checkpoint + '.json'), rec);
  }
  return { record: rec, written };
}

/* ---------------- carry (B7) — SHADOW ONLY ---------------- */

// Revision 3 §7 dependency table, mapped onto snapshot sections. Runtime checks are never carried. Without a per-test
// closure every source check depends on every scoped file, so the shadow over-invalidates — safe by design.
const DEPENDS = {
  default: ['files'],
  '5': ['files', 'inventory'], '6': ['files', 'timeouts', 'configs'], '24': ['files', 'timeouts', 'configs'], '42': ['files', 'timeouts', 'configs'], '43': ['files', 'timeouts', 'configs'],
  '7': ['files', 'tc', 'requirements', 'testData'], '10': ['files', 'tc', 'requirements', 'testData'], '11': ['files', 'tc', 'requirements', 'testData'], '12': ['files', 'tc', 'requirements', 'testData'], '13': ['files', 'tc', 'requirements', 'testData'],
  '21': ['files', 'readiness', 'tc'], '23': ['files', 'readiness', 'tc'], '25a': ['files', 'runPlan', 'readiness'],
  '27': ['files', 'lint'], '28': ['files', 'lint'], '30': ['files', 'tc', 'requirements'], '35': ['files', 'configs'], '36': ['files', 'configs'],
  '39': ['files', 'exceptions', 'configs'], '44': ['configs'], '3': ['files', 'configs'], '17': ['files', 'configs'], '37': ['files', 'configs'],
};

/** Which semantic results of `from` could be carried into `to` — written as linked current-snapshot results, never used. */
export function carryShadow({ fromSnapshot, toSnapshot, fromRecords }) {
  const a = fromSnapshot.body;
  const b = toSnapshot.body;
  const toolsChanged = canon(a.tools) !== canon(b.tools);
  const changedFiles = Object.keys({ ...a.files, ...b.files }).filter((k) => (a.files || {})[k] !== (b.files || {})[k]);
  const share = Object.keys(b.files || {}).length ? changedFiles.length / Object.keys(b.files).length : 1;
  const fallback = toolsChanged || share > 0.5;
  const carriable = [];
  const invalidated = [];
  const notCarried = [];
  const seen = new Map();
  for (const r of fromRecords) {
    if (r._invalid || r.snapshotId !== fromSnapshot.snapshotId) continue;
    const k = String(r.checkId) + '|' + r.unit;
    seen.set(k, seen.has(k) ? null : r); // a duplicated / contradictory pair is never carried
  }
  for (const [k, r] of seen) {
    const c = CHECK_BY_ID.get(String(r && r.checkId));
    if (!r || !c) { notCarried.push({ key: k, why: 'protocol error in the earlier snapshot' }); continue; }
    if (r.unit !== 'scope' || !/^verified-/.test(r.status)) continue;
    if (c.kind !== 'Src') { notCarried.push({ checkId: c.id, why: 'runtime checks always run on the current phase\'s evidence' }); continue; }
    if (toolsChanged) { notCarried.push({ checkId: c.id, why: 'skill version, a script or the validator RULES changed — nothing is carried' }); continue; }
    const deps = DEPENDS[c.id] || DEPENDS.default;
    const proof = {};
    const changed = [];
    for (const d of deps) { const was = shaOf(a[d] === undefined ? null : a[d]); const now = shaOf(b[d] === undefined ? null : b[d]); proof[d] = { old: was, current: now }; if (was !== now) changed.push(d); }
    if (changed.length) { invalidated.push({ checkId: c.id, sections: changed }); continue; }
    if (fallback) { notCarried.push({ checkId: c.id, why: 'full-review fallback (more than 50 % of the scoped files changed)' }); continue; }
    carriable.push({ checkId: c.id, unit: r.unit, snapshotId: toSnapshot.snapshotId, status: r.status, reason: r.reason, evidenceRef: r.evidenceRef || [], executor: r.executor,
      carriedFrom: { resultId: sha256(canon({ ...r, _line: undefined })).slice(0, 16), snapshotId: fromSnapshot.snapshotId }, proof });
  }
  return { schema: CARRY_SCHEMA, mode: 'shadow', note: 'shadow only — Checkpoint B keeps its full review until B7 is separately activated; nothing here is a result', from: fromSnapshot.snapshotId, to: toSnapshot.snapshotId, toolsChanged, changedFiles: changedFiles.length, fallback, carriable, invalidated, notCarried };
}

/* ---------------- harness cache (B20) ---------------- */

export function harnessCacheDir(env = process.env) {
  return env.QA_HARNESS_CACHE_DIR ? path.resolve(env.QA_HARNESS_CACHE_DIR) : path.join(os.homedir(), '.link-ai-pro', 'harness-cache');
}

/** The exact cache key of one harness: any change of an input → a different key → the harness runs. */
export function harnessKey({ skillDir = SKILL_DIR, name, env = process.env, runtime = null }) {
  const scriptsDir = path.join(skillDir, 'scripts');
  const parts = [];
  const add = (label, p) => parts.push(label + '=' + (fileSha(p) || 'missing'));
  add('harness:' + name, path.join(scriptsDir, name));
  for (const f of listFiles(scriptsDir, false)) if (/\.mjs$/.test(f)) add('script:' + relTo(skillDir, f), f);
  for (const f of listFiles(path.join(scriptsDir, 'fixtures'))) add('fixture:' + relTo(skillDir, f), f);
  for (const f of listFiles(path.join(skillDir, 'assets'))) add('asset:' + relTo(skillDir, f), f);
  for (const d of [skillDir, scriptsDir]) for (const lock of ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']) if (isFile(path.join(d, lock))) add('lock:' + relTo(skillDir, path.join(d, lock)), path.join(d, lock));
  const rt = runtime || { node: process.version, platform: process.platform, arch: process.arch, tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
  parts.push('node=' + rt.node, 'platform=' + rt.platform, 'arch=' + rt.arch, 'tz=' + rt.tz);
  for (const k of ['LANG', 'LC_ALL', 'TZ', 'CI']) parts.push('env:' + k + '=' + (env[k] ?? ''));
  for (const k of Object.keys(env).filter((x) => /^(QA_|PW_)/.test(x) && x !== 'QA_HARNESS_CACHE_DIR').sort()) parts.push('env:' + k + '=' + sha256(String(env[k])));
  parts.push('version=' + (skillVersionOf(skillDir) || 'none'));
  parts.sort();
  return { key: sha256(parts.join('\n')), inputs: parts.length };
}

/** B20: reuse a pass only on an exact key match; otherwise run the harness (at the skill's runtime) and cache a pass. */
export async function harnessRun({ name, force = false, dryRun = false, skillDir = SKILL_DIR, env = process.env, cacheDir = null, runtime = null }) {
  if (!/^selftest[\w.-]*\.mjs$/.test(String(name || '')) || !isFile(path.join(skillDir, 'scripts', name))) return { ok: false, error: '--name must be a selftest*.mjs file in scripts/' };
  const { key, inputs } = harnessKey({ skillDir, name, env, runtime });
  const dir = cacheDir || harnessCacheDir(env);
  const file = path.join(dir, 'link-qc-5-' + name.replace(/\.mjs$/, '') + '.json');
  const cached = readJson(file);
  if (!force && cached && cached.key === key) return { ok: true, cached: true, name, key, inputs, passedAt: cached.passedAt, cacheFile: posix(file) };
  if (dryRun) return { ok: null, cached: false, wouldRun: true, name, key, inputs, cacheFile: posix(file) };
  const r = await spawnCollect(process.execPath, [path.join(skillDir, 'scripts', name)], { cwd: skillDir, timeoutMs: 1200000 });
  let summary = null;
  try { const o = JSON.parse(r.stdout); summary = { ran: o.ran ?? (o.cases ? o.cases.length : null), ok: o.ok ?? null }; } catch { summary = { output: filtered(r.stdout || r.stderr).slice(0, 400) }; }
  if (r.code === 0) {
    writeJsonAtomic(file, { schema: HARNESS_SCHEMA, name, key, passedAt: new Date().toISOString() });
    return { ok: true, cached: false, name, key, inputs, exit: 0, summary, cacheFile: posix(file) };
  }
  try { fs.rmSync(file, { force: true }); } catch { /* nothing cached */ }
  return { ok: false, cached: false, name, key, exit: r.code, error: r.error || null, summary };
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'check', schema: SCHEMA,
  usage: [
    'node check.mjs run --root <project> --files <a,b|@list> [--automation-root <dir>] [--tc <TEST-CASES md>] [--req <REQ files,…>] [--inventory <automation-inventory.md>] [--require-steps] [--tsconfig <file>] [--tsc <tsc js>] [--lint] [--eslint <eslint.js>] [--limit 2] [--no-ledger] [--run-file <.runs/phase-N.json>] [--results-root <dir>] [--snapshot <id>] [--full] [--strict] [--pretty]',
    'node check.mjs snapshot --checkpoint A|B --root <project> --results-root <dir> --phase N --files <a,b|@list> [--automation-root <dir>] [--tc <md>] [--data <TEST-DATA md>] [--req <files>] [--run-file <json>] [--inventory <md>] [--require-steps] [--drafts <dir>] [--screenshots <dir>] [--pretty]',
    'node check.mjs record --results-root <dir> --snapshot <id> (--batch <results.json> | --check <id> --unit scope|phase|file:<path> --status <status> --reason "<what was read and why>" [--evidence <file:line,…>] [--executor M|SB-P|SB-Q|SB-E|SB-D|SB-H|V|S]) [--strict]',
    'node check.mjs gate --checkpoint A|B --results-root <dir> --snapshot <id> [--phase N] [--impact <impact select payload json>] [--dry-run] [--strict] [--pretty]',
    'node check.mjs carry --results-root <dir> --from <earlier snapshot id> --to <current snapshot id> [--pretty]',
    'node check.mjs harness --name <selftest-*.mjs> [--force] [--dry-run] [--pretty]',
  ],
  notes: [
    'Order per checkpoint: snapshot (freeze) → run --snapshot (mechanical results) → record (one semantic result per check, unit scope; runtime results unit phase at B) → gate (writes .runs/phase-N.checkpoint-{A|B}.json).',
    'record --batch <results.json>: every semantic result of the checkpoint in ONE call — a JSON array of { check, unit, status, reason, evidence: [file:line,…], executor } (or { snapshot, results: [...] }); validated as a whole first: an invalid, stale, duplicate or contradictory entry, or a snapshot whose scope changed, rejects the batch and nothing is written.',
    'Result statuses: ' + RESULT_STATUSES.join(' · ') + '. Missing, stale, contradictory and duplicate results BLOCK the gate; they are never merged.',
    'N/A only when the check\'s predicate says it has no subject (26 api_setup · 22 fail / slow · 39 exceptions · 49 slot part); never N/A at B: ' + NEVER_NA_AT_B.join(', ') + '.',
    'Any edit after the snapshot voids the checkpoint (it is re-hashed at gate time). A tool that did not run is never PASS.',
    'carry is SHADOW ONLY (B7 inactive): it lists what could be carried and never writes a result. harness reuses a pass only on an exact key.',
  ],
};

function printOut(obj, args) { print(obj, args); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || null;
  if (args.help || !cmd) { printOut(HELP, args); return 0; }
  const root = path.resolve(str(args.root) || process.cwd());
  const rr = str(args['results-root']) ? path.resolve(root, args['results-root']) : null;
  if (cmd === 'run') {
    const { compact, full } = await runChecks({
      root, automationRoot: str(args['automation-root']), files: filesArg(args.files, root), tc: str(args.tc), data: str(args.data), req: csv(args.req),
      inventory: str(args.inventory), requireSteps: !!args['require-steps'], tsconfig: str(args.tsconfig), tsc: str(args.tsc), lint: !!args.lint, eslint: str(args.eslint),
      limit: Number(args.limit) || null, noLedger: !!args['no-ledger'], resultsRoot: rr, snapshotId: str(args.snapshot), runFile: str(args['run-file']),
    });
    printOut(args.full ? full : compact, args);
    return args.strict ? (STRICT_EXIT[compact.gate] ?? 0) : 0;
  }
  if (cmd === 'snapshot') {
    const checkpoint = String(args.checkpoint || '').toUpperCase();
    const phase = Number(args.phase);
    const errs = [];
    if (!['A', 'B'].includes(checkpoint)) errs.push('--checkpoint A|B');
    if (!rr) errs.push('--results-root <dir>');
    if (!(phase > 0)) errs.push('--phase N');
    const files = filesArg(args.files, root);
    if (!files.length) errs.push('--files <in-scope files>');
    if (errs.length) { printOut({ tool: 'check', schema: SCHEMA, cmd, error: 'required: ' + errs.join(', ') }, args); return args.strict ? 2 : 0; }
    const s = takeSnapshot({ root, automationRoot: str(args['automation-root']), resultsRoot: rr, checkpoint, phase, files, tc: str(args.tc), data: str(args.data), req: csv(args.req), runFile: str(args['run-file']), inventory: str(args.inventory), requireSteps: !!args['require-steps'], draftsDir: str(args.drafts), screenshotsDir: str(args.screenshots), tsconfig: str(args.tsconfig) });
    const b = s.snapshot.body;
    printOut({ tool: 'check', schema: SCHEMA, cmd, checkpoint, phase, snapshotId: s.snapshotId, reused: s.reused, file: posix(s.file),
      counts: { files: Object.keys(b.files).length, tcs: b.tc ? Object.keys(b.tc.perTc).length : 0, requirements: Object.keys(b.requirements).length, configs: Object.keys(b.configs).length, evidence: b.evidence ? Object.keys(b.evidence).length : null, artifacts: b.artifacts ? Object.keys(b.artifacts).length : null, drafts: b.drafts ? Object.keys(b.drafts).length : null },
      required: requiredUnits(checkpoint, b.facts).length, predicates: Object.fromEntries(Object.entries(b.facts.predicates).map(([k, v]) => [k, v.noSubject ? 'no subject' : 'applies'])), warnings: s.warnings }, args);
    return 0;
  }
  if (cmd === 'record') {
    if (!rr || !str(args.snapshot)) { printOut({ tool: 'check', schema: SCHEMA, cmd, ok: false, errors: ['--results-root and --snapshot are required'] }, args); return args.strict ? 2 : 0; }
    if (args.batch !== undefined) {
      const bf = str(args.batch) ? path.resolve(root, args.batch) : null;
      const text = bf ? read(bf) : null;
      const parsed = text === null ? { entries: null, snapshotId: null, error: '--batch <results.json>: file not found' + (bf ? ' (' + posix(bf) + ')' : '') } : parseBatch(text);
      const r = parsed.error ? { ok: false, written: 0, count: 0, errors: [{ index: null, error: parsed.error }], warnings: [] }
        : recordBatch({ resultsRoot: rr, snapshotId: str(args.snapshot), entries: parsed.entries, batchSnapshotId: parsed.snapshotId });
      printOut({ tool: 'check', schema: SCHEMA, cmd, batch: true, ok: r.ok, count: r.count, written: r.written, errors: r.errors.slice(0, 20), moreErrors: Math.max(0, r.errors.length - 20), warnings: r.warnings.slice(0, 10),
        file: r.ok ? posix(r.file) : undefined, note: r.ok ? undefined : 'nothing was recorded — fix the entries named and run the whole batch again' }, args);
      return args.strict && !r.ok ? 2 : 0;
    }
    const r = recordResult({ resultsRoot: rr, snapshotId: args.snapshot, checkId: args.check, unit: str(args.unit) || 'scope', status: str(args.status), reason: str(args.reason) || '', evidence: csv(args.evidence), executor: str(args.executor) });
    printOut({ tool: 'check', schema: SCHEMA, cmd, ok: r.ok, errors: r.errors, warnings: r.warnings, record: r.ok ? { checkId: r.record.checkId, unit: r.record.unit, status: r.record.status } : undefined }, args);
    return args.strict && !r.ok ? 2 : 0;
  }
  if (cmd === 'gate') {
    const checkpoint = String(args.checkpoint || '').toUpperCase();
    if (!['A', 'B'].includes(checkpoint) || !rr || !str(args.snapshot)) { printOut({ tool: 'check', schema: SCHEMA, cmd, verdict: 'BLOCKED', error: 'required: --checkpoint A|B --results-root <dir> --snapshot <id>' }, args); return args.strict ? 2 : 0; }
    const g = runGate({ resultsRoot: rr, snapshotId: args.snapshot, checkpoint, phase: args.phase !== undefined ? Number(args.phase) : null, impact: str(args.impact) ? path.resolve(root, args.impact) : null, dryRun: !!args['dry-run'] });
    if (g.error) { printOut({ tool: 'check', schema: SCHEMA, cmd, verdict: 'BLOCKED', error: g.error }, args); return args.strict ? 2 : 0; }
    const r = g.record;
    const openList = [...r.rejected.map((x) => x.checkId + ' ' + x.unit + ' ' + x.why), ...r.fail.map((x) => x.checkId + ' ' + x.unit + ' FAIL'), ...r.open.map((x) => x.checkId + ' ' + x.unit + ' unresolved')];
    printOut({ tool: 'check', schema: SCHEMA, cmd, checkpoint, phase: r.phase, verdict: r.verdict, snapshotId: r.snapshotId, counts: r.counts, rehash: { matched: r.rehash.matched, differences: r.rehash.differences.length },
      freshness: r.freshness ? { known: r.freshness.known, stale: r.freshness.stale.length } : undefined, open: openList.slice(0, 10), more: Math.max(0, openList.length - 10),
      record: g.written ? posix(g.written) : null, dryRun: !!args['dry-run'] }, args);
    return args.strict ? (STRICT_EXIT[r.verdict] ?? 0) : 0;
  }
  if (cmd === 'carry') {
    if (!rr || !str(args.from) || !str(args.to)) { printOut({ tool: 'check', schema: SCHEMA, cmd, error: 'required: --results-root <dir> --from <id> --to <id>' }, args); return 0; }
    const from = loadSnapshot(rr, args.from);
    const to = loadSnapshot(rr, args.to);
    if (!from || !to) { printOut({ tool: 'check', schema: SCHEMA, cmd, error: 'snapshot not found: ' + (!from ? args.from : args.to) }, args); return 0; }
    const c = carryShadow({ fromSnapshot: from, toSnapshot: to, fromRecords: readResults(resultsFile(rr, args.from)) });
    const file = path.join(checksDir(rr, args.to), 'carry-shadow.json');
    writeJsonAtomic(file, c);
    printOut({ tool: 'check', schema: SCHEMA, cmd, mode: 'shadow', from: c.from, to: c.to, toolsChanged: c.toolsChanged, fallback: c.fallback, carriable: c.carriable.length, invalidated: c.invalidated.length, notCarried: c.notCarried.length, file: posix(file) }, args);
    return 0;
  }
  if (cmd === 'harness') {
    const r = await harnessRun({ name: str(args.name), force: !!args.force, dryRun: !!args['dry-run'] });
    printOut({ tool: 'check', schema: SCHEMA, cmd, ...r }, args);
    return args.strict && r.ok === false ? 1 : 0;
  }
  printOut({ ...HELP, error: 'unknown subcommand "' + cmd + '"' }, args);
  return args.strict ? 2 : 0;
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  main().then((code) => process.exit(code), (e) => {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'check', schema: SCHEMA, verdict: 'BLOCKED', gate: 'BLOCKED', error: 'internal error: ' + e.message }, args);
    process.exit(args.strict ? 2 : 0);
  });
}
