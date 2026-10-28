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
//   checkpoint the whole checkpoint in ONE command (3.1): B preconditions (a valid, applicable PASS of A; the freshness
//             check written to the draft run file before the freeze) → snapshot → mechanical (reused only when complete)
//             → B runtime verify → AWAITING_REVIEW with an empty template, or (--review) the validated batch → gate.
//
// It never edits code, a report or a draft — the one exception is `checkpoint --checkpoint B`, which writes the
// deterministic impact.final_check into the DRAFT run file before freezing it. Writes: artifacts/checks/**, the gate
// records, the harness cache. Exit 0 by default for the legacy subcommands (--strict maps run / gate: PASS 0 · FAIL 1 ·
// BLOCKED 2 · NOT_RUN 3); `checkpoint` always exits PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3 · AWAITING_REVIEW 4.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, print, isFile, isDir, read, posix, sha256, loadStripped, resolveModule, isSpecFile } from './scan-lib.mjs';
import * as V from './validate-automation.mjs';
import { inventory, reconcile } from './config-inventory.mjs';
import { hashDocument, parseTcDocument, tcLayer } from './tc-hash.mjs';
import { resolveBin } from './project-env.mjs';

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

function writeTextAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw e; }
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
// naAtB: the check's predicate is decided by the script alone (`no-browser-tests`), so its N/A holds at Checkpoint B too —
// a never-N/A item of a phase with no browser test has no subject; a model can never claim it (3.0).
const K = (id, short, kind, A, B, executor, cls, extra = {}) => Object.freeze({
  id, short, kind, A, B, executor, cls, tools: [], na: null, naPart: null, naAtB: false, ...extra, rules: rulesMappedTo(id), neverNA: NEVER_NA_AT_B.includes(id) && !extra.naAtB,
});
const NO_BROWSER = { na: 'no-browser-tests', naAtB: true };

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
  K('14', 'Every test captures assertion-point evidence, directly or through a method', 'Src', 'MS', 'MS', 'V + SB-E', 2, NO_BROWSER),
  K('15', 'No evidence from after-hooks; exactly one per test', 'Src', 'M', 'M', 'V', 1, NO_BROWSER),
  K('16a', 'Evidence call at the assertion point, before teardown (code)', 'Src', 'MS', 'MS', 'V + SB-E', 2, NO_BROWSER),
  K('16b', "This phase's heartbeats show each captured image before teardown started", 'Rt', '', 'R', 'S', 4),
  K('17', 'Evidence helper, screenshot config and output roots exist and are writable', 'Src', 'S', 'S', 'S', 1),
  K('18', 'Images, run file, report section, bug entries and page actually produced, right TC, final code', 'Rt', '', 'RS', 'S + SB-E', 4),
  K('19', 'No PASS image of a cleaned-up screen', 'Rt', '', 'RS', 'S + SB-E', 4, NO_BROWSER),
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
  K('46a', 'Console guard attached in beforeEach and reported in afterEach (code)', 'Src', 'M', 'M', 'V (B8)', 1, NO_BROWSER),
  K('46b', 'Console reports produced for every executed browser test; unexpected entries under Deviations', 'Rt', '', 'R', 'S', 4, NO_BROWSER),
  K('47', 'Page-object / component / locator / fixture craft; .gitignore lines', 'Src', 'MS', 'MS', 'SB-P (+ S)', 1),
  K('48a', 'Stops only on FROZEN verdicts or the documented ceiling stop', 'Rt', '', 'R', 'S', 4),
  K('48b', 'Every watchdog / stall / admission-wait / timeout event of the phase classified', 'Rt', '', 'R', 'S', 4),
  K('49', 'Network guard attached beside the console guard; rateLimitSlot() placement', 'Src', 'MS', 'MS', 'V (B8) + SB-H', 1, { naPart: 'rate-limit-step', ...NO_BROWSER }),
  K('50', 'No scratch probe in the delivered scope; scratch.mjs clean done', 'Rt', 'S', 'R', 'S', 4),
  // 3.0 — [API] / [DB] lines (skill 3's layer gate)
  K('51', 'API lines run through api/ endpoint clients over the recorded request: effect declared from the mapping, redirects validated, no raw request, no secret literal', 'Src', 'MS', 'MS', 'V + SB-P', 2, { na: 'api-tests' }),
  K('52', 'DB lines run through db/ query objects over the recorded client: no SQL or driver in a spec, connection only from the QC variable, the identity verified', 'Src', 'MS', 'MS', 'V + SB-P', 2, { na: 'db-tests' }),
  K('53', 'Data changes: the per-TC data-changes consent, structured writes on run-owned records only (cascades / triggers / row count verified), every write read back, torn down or retained, never production, nothing in doubt', 'Src+Rt', 'MS', 'MSR', 'V + SB-D', 1, { na: 'data-changes' }),
  K('54', 'A valid redacted record for every API / DB attempt — one per test at its assertion point, traceable to its TC, step, assertion and attempt', 'Src+Rt', 'MS', 'MSR', 'V + SB-E', 2, { na: 'api-db-tests' }),
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

export function predicatesOf({ root, files, runJson, validator, tcText }) {
  const texts = files.map((f) => ({ f, t: read(path.resolve(root, f)) || '' }));
  const apiText = texts.filter((x) => /\bapi_setup\b/.test(x.t)).map((x) => x.f);
  const prereq = texts.filter((x) => /\bfrom\s*['"][^'"]*prerequest\/|require\(\s*['"][^'"]*prerequest\//.test(x.t)).map((x) => x.f);
  const apiGaps = gapsOf(runJson).filter((g) => /prepared\s*\(api\)|^\s*api\s*$/i.test(String(g.decision || '')) || /^\s*api\b/i.test(String(g.provisioning || ''))).map((g) => g.gap || '?');
  const failSlow = texts.flatMap((x) => [...x.t.matchAll(/\b(?:test|describe)\s*(?:\.\s*describe\s*)?\.\s*(fail|slow)\s*\(/g)].map((m) => x.f + ' ' + m[1]));
  const exceptions = validator && Array.isArray(validator.exceptions) ? validator.exceptions.length : null;
  const limits = (runJson && runJson.run_plan && Array.isArray(runJson.run_plan.rate_limits)) ? runJson.run_plan.rate_limits : [];
  const stepLimits = limits.filter((l) => l && l.at === 'step').map((l) => l.service || '?');
  const slotCalls = texts.filter((x) => /\brateLimitSlot\s*\(/.test(x.t)).map((x) => x.f);
  // 3.0 — test layers: the document (tc-hash tcLayer over the frozen TC document) and the code (the validator's layer counts).
  // A predicate has NO subject only when both sides are known and both show none — an unknown side keeps the check applicable.
  const docTcs = tcText ? parseTcDocument(tcText) : [];
  const docL = docTcs.map((t) => ({ id: t.id, ...tcLayer(t) }));
  const vl = validator && validator.counts && validator.counts.layers ? validator.counts.layers : null;
  const vu = validator && validator.counts && validator.counts.layerUse ? validator.counts.layerUse : null;
  const browserCode = vl ? vl.ui + vl.hybrid + vl.unresolved : null;
  const browserDoc = docTcs.length ? docL.filter((t) => /^(ui|hybrid|unknown)$/.test(t.layer)).length : null;
  const apiCode = vu ? vu.api : null; const dbCode = vu ? vu.db : null;
  const apiDoc = docL.filter((t) => t.apiSteps + t.apiExpected > 0).length;
  const dbDoc = docL.filter((t) => t.dbSteps + t.dbExpected > 0).length;
  const BACKEND_WRITE = /^\s*\[DB\]\s*(create|update|delete|insert|remove)\b|^\s*\[API\]\s*(post|put|patch|delete)\b/i;
  const writeDoc = docTcs.filter((t) => ['Steps', 'Expected Result'].some((name) => { const k = Object.keys(t.fields).find((x) => x.toLowerCase() === name.toLowerCase()); return k && [t.fields[k].value, ...t.fields[k].items].some((l) => BACKEND_WRITE.test(String(l || ''))); })).map((t) => t.id);
  const writeCode = validator && validator.counts ? validator.counts.mutationMembers || 0 : null;
  const dbGaps = gapsOf(runJson).filter((g) => /prepared\s*\(db\)|^\s*db\s*$/i.test(String(g.decision || ''))).map((g) => g.gap || '?');
  const ev = (code, doc) => (code === null ? 'code layers unknown' : code + ' test(s) in code') + ' · ' + (doc === null ? 'no TC document' : doc + ' TC(s) in the document');
  const none = (code, doc) => code === 0 && (doc === 0 || doc === null);
  return {
    'no-browser-tests': { noSubject: browserCode === 0 && browserDoc === 0, evidence: 'ui / hybrid / unresolved: ' + ev(browserCode, browserDoc) + ' — decided by the script, never claimed' },
    'api-tests': { noSubject: none(apiCode, docTcs.length ? apiDoc : null), evidence: 'API: ' + ev(apiCode, docTcs.length ? apiDoc : null) },
    'db-tests': { noSubject: none(dbCode, docTcs.length ? dbDoc : null), evidence: 'DB: ' + ev(dbCode, docTcs.length ? dbDoc : null) },
    'data-changes': { noSubject: writeCode === 0 && !writeDoc.length && !dbGaps.length, evidence: (writeCode === null ? 'code writes unknown' : writeCode + ' data-changing api/ · db/ call(s)') + ' · ' + writeDoc.length + ' TC(s) with an [API] mutation / [DB] write line' + (writeDoc.length ? ' (' + writeDoc.slice(0, 8).join(', ') + ')' : '') + ' · ' + dbGaps.length + ' readiness gap(s) prepared through the database' },
    'api-db-tests': { noSubject: none(apiCode, docTcs.length ? apiDoc : null) && none(dbCode, docTcs.length ? dbDoc : null), evidence: 'API / DB: ' + ev(apiCode === null || dbCode === null ? null : apiCode + dbCode, docTcs.length ? apiDoc + dbDoc : null) },

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
      predicates: predicatesOf({ root, files: inputs.files, runJson, validator, tcText: inputs.tc ? read(path.resolve(root, inputs.tc)) : null }),
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
    if (i.ambiguous && i.ambiguous.length) return { status: 'unresolved', reason: 'the shared configuration is ambiguous (' + i.ambiguous.length + ' equal candidates) — name it (--config / qa-manifest framework.configFile); never decided by order', evidence: i.ambiguous.slice(0, 20) };
    if (!i.shared) return { status: 'unresolved', reason: 'no shared configuration resolved from the project (' + (i.sharedError || 'no candidate passed the config check') + ')', evidence: (i.rejected || []).slice(0, 20).map((x) => x.file + ' — ' + x.reason) };
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
    // a setting whose effective value could not be established, or an outdated helper reconcile would not replace, is never
    // reported active: a verified-semantic scope result (what was read, file:line) closes it, or the repair does
    if ((r.unresolved || []).length) return { status: 'unresolved', reason: r.unresolved.length + ' run protection(s) not proven (an expression, a config package, an ambiguous config or an outdated helper kept as it is)', evidence: r.unresolved.slice(0, 20) };
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
  if (!tscPath) return { status: 'notRun', reason: 'TypeScript not found from the automation root (Node resolution, then every node_modules folder up to the drive root), or pass --tsc — the type check did not run; never recorded PASS' };
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
  if (!eslintPath) return { status: 'notRun', reason: 'ESLint not found from the automation root (Node resolution, then every node_modules folder upward), or pass --eslint', floating: [], problems: 0 };
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

/**
 * The compliance limit through the capacity ledger's `compliance` class — inside ONE end-to-end coordination budget
 * (`maxWaitMs`, default 120 s, capped at 240 s so a call always ends before an outer 300 s tool limit): every lock
 * acquisition and every reservation of this invocation shares the same deadline. Before reserving, one FRESH process
 * table lets the ledger sweep resolve entries a killed check.mjs left behind, and every retry re-judges holders on a
 * fresh table (`snapshot`). A timeout is a COORDINATION failure (BLOCKED, the holders named) — never an uncoordinated
 * fallback, never a forced release. --no-ledger / QA_LEDGER=off → the established exclusive reservation, bounded the same
 * way. No safe coordination (capacity.mjs missing, an unwritable coordination directory, an unreadable ledger) →
 * `mode: 'blocked'` and nothing starts. Returns the slots object runChecks uses; `diagnostics` collects every refusal.
 */
export const DEFAULT_MAX_WAIT_MS = 120000;
export const MAX_WAIT_CAP_MS = 240000;
export async function complianceSlots({ limit = null, runId = null, runFile = null, noLedger = false, warnings = [], maxWaitMs = DEFAULT_MAX_WAIT_MS, env = process.env, capModule = null } = {}) {
  const want = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT;
  const budget = Math.max(1000, Math.min(MAX_WAIT_CAP_MS, Number(maxWaitMs) > 0 ? Number(maxWaitMs) : DEFAULT_MAX_WAIT_MS));
  const t0 = Date.now();
  const deadline = t0 + budget;
  const diagnostics = { budgetMs: budget, waitedMs: 0, refusals: [], holders: [], outcome: 'OK' };
  const blocked = (reason, extra = {}) => ({ mode: 'blocked', limit: 1, selfHeld: false, reason, diagnostics: { ...diagnostics, outcome: 'NO_SAFE_COORDINATION', reason, ...extra },
    acquire: async () => { throw new Error(reason); }, release: async () => {}, activate: async () => {}, close: async () => {} });
  let cap;
  try { cap = capModule || await import(pathToFileURL(path.join(here, 'capacity.mjs')).href); }
  catch (e) { return blocked('no safe coordination — capacity.mjs could not be loaded (' + e.message + '); nothing was started (restore the skill folder with /sync-skills)'); }
  const exclusive = !!noLedger || String((env && env.QA_LEDGER) || '').trim().toLowerCase() === 'off';
  let dir;
  try {
    dir = cap.resolveCapacityDir(env);
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (e) { return blocked('no safe coordination — the coordination directory ' + (dir ? posix(dir) : '(unresolved)') + ' is not writable (' + (e.code || e.message) + '); nothing was started'); }
  const led0 = cap.readLedger(dir);
  if (led0.error) return blocked('no safe coordination — ' + led0.error);
  const remaining = () => Math.max(0, deadline - Date.now());
  // a FRESH process table on every use — liveness is never judged on an old listing
  const fresh = async () => {
    if (remaining() < 500) return null;
    try { const s = await cap.processSnapshot({ timeoutMs: Math.max(500, Math.min(10000, remaining())) }); return s && Array.isArray(s.rows) ? s.rows : null; } catch { return null; }
  };
  try { const rows0 = await fresh(); if (rows0 && typeof cap.sweep === 'function') await cap.sweep({ dir, rows: rows0 }); } catch (e) { warnings.push('ledger sweep skipped (' + e.message + ') — stale entries are re-judged while waiting'); }
  const cfg = cap.readConfig(dir) || {};
  const classLimit = exclusive ? 1 : Math.max(1, Math.min(want, Number(cfg.classes && cfg.classes.compliance) || DEFAULT_LIMIT));
  const owner = { runId: runId || 'check-' + process.pid, runFile: runFile || null };
  const demand = (cap.BOOTSTRAP_DEMAND && cap.BOOTSTRAP_DEMAND.compliance) || null;
  const admission = typeof cap.admissionCheck === 'function' ? (ledger) => cap.admissionCheck({
    availableMb: os.freemem() / MB, idleCores: cpuIdleCores(),
    committed: typeof cap.committedOutstanding === 'function' ? cap.committedOutstanding((ledger && ledger.entries) || [], {}, Date.now()) : { memMb: 0, cpu: 0 },
    demand: demand || { memMb: 0, cpu: 0 }, reserves: cap.reservesFor({ totalMemMb: os.totalmem() / MB, cpus: os.cpus().length }), pressure: false, leaseValid: true,
  }) : null;
  const held = new Set();
  const describe = (r, rows) => (r.holders || []).map((h) => ({ token: h.token ? String(h.token).slice(0, 8) : null, runId: h.runId ?? null, runFile: h.runFile ?? null, kind: h.kind || (h.lock ? 'lock' : null), state: h.state || null, since: h.since ?? null, pid: h.pid ?? null,
    alive: rows && h.pid ? rows.some((x) => Number(x.pid) === Number(h.pid)) : null }));
  const reserveOne = async (tool) => {
    if (remaining() <= 0) { diagnostics.outcome = 'TIMEOUT'; throw new Error('coordination budget of ' + Math.round(budget / 1000) + ' s used up before a compliance slot was free'); }
    let r;
    try {
      r = await cap.reserve({ dir, cls: 'compliance', units: 1, limit: classLimit, demand: tool ? demand : null, owner, admission: tool && !exclusive ? admission : null,
        exclusive, liveness: exclusive ? 'pid' : 'table', waitMs: remaining(), deadline, pollMs: 2000, snapshot: fresh });
    } catch (e) { r = { ok: false, code: e && e.code === 'ELOCKBUSY' ? 'lock-busy' : 'coordination', reason: e.message, holders: e && e.owner ? [{ lock: 'ledger', pid: e.owner.pid ?? null }] : [] }; }
    diagnostics.waitedMs = Date.now() - t0;
    if (!r || !r.ok) {
      const rows = await fresh();
      diagnostics.outcome = r && r.code === 'ledger-error' ? 'NO_SAFE_COORDINATION' : 'TIMEOUT';
      diagnostics.refusals.push({ code: (r && r.code) || 'refused', reason: filtered((r && r.reason) || 'not granted').slice(0, 400) });
      diagnostics.holders = describe(r || {}, rows);
      throw new Error((r && r.reason) || 'not granted');
    }
    held.add(r.token);
    return r.token;
  };
  const releaseOne = async (token) => { if (!token) return; held.delete(token); try { await cap.release({ dir, token, rows: [] }); } catch (e) { warnings.push('a compliance slot could not be released at once (' + e.message + ') — the next sweep frees it'); } };
  // this process itself (validator, inventory — in-process, light) takes one class slot when the limit leaves room for a tool;
  // exclusive mode: ONE exclusive reservation covers the whole call (tools run one after another under it)
  let self = null;
  if (exclusive || classLimit >= 2) {
    try { self = await reserveOne(false); }
    catch (e) { return { ...blocked('coordination: ' + e.message + ' — waited ' + Math.round((Date.now() - t0) / 1000) + ' s of the ' + Math.round(budget / 1000) + ' s budget'), diagnostics: { ...diagnostics, reason: e.message } }; }
  }
  return {
    mode: exclusive ? 'exclusive' : 'ledger', limit: exclusive ? 2 : classLimit, selfHeld: !!self, diagnostics, deadline,
    acquire: async () => (exclusive ? null : reserveOne(true)),
    activate: async (token, pid) => { if (token && typeof cap.activate === 'function') await cap.activate({ dir, token, pid }); },
    // the tool process has exited (its close event) before the release: nothing recorded is alive any more
    release: async (token) => releaseOne(token),
    // every reservation this call still holds — the self slot and any partial one — is released, also after a failure
    close: async () => { for (const t of [...held]) await releaseOne(t); },
  };
}

function firstFile(list) { return list.find((p) => p && isFile(p)) || null; }

/** The project's own TypeScript / ESLint (Node resolution from the automation root, then every node_modules upward) and
 *  the key of everything a mechanical result depends on besides the snapshot (tool paths and versions, Node, --lint). */
export function resolveTools({ root, autoDir, tsc = null, eslint = null, lint = false }) {
  const tscRes = tsc ? { file: path.resolve(root, tsc), version: null } : resolveBin(autoDir, 'typescript', 'bin/tsc', { binName: 'tsc' });
  const tscPath = tscRes.file && isFile(tscRes.file) ? tscRes.file : null;
  const eslintRes = lint ? (eslint ? { file: path.resolve(root, eslint), version: null } : resolveBin(autoDir, 'eslint', 'bin/eslint.js', { binName: 'eslint' })) : { file: null, version: null };
  const eslintPath = eslintRes.file && isFile(eslintRes.file) ? eslintRes.file : null;
  const toolKey = shaOf({ tsc: tscPath ? relTo(root, tscPath) : null, tscVersion: tscRes.version || null, tscSha: tscPath ? fileSha(tscPath) : null,
    eslint: eslintPath ? relTo(root, eslintPath) : null, eslintVersion: eslintRes.version || null, lint: !!lint, node: process.version });
  return { tscPath, tscVersion: tscRes.version || null, eslintPath, eslintVersion: eslintRes.version || null, lintAsked: !!lint, toolKey };
}

const mechanicalMarkerOf = (resultsRoot, snapshotId) => path.join(checksDir(resultsRoot, snapshotId), 'mechanical.json');
/** May the mechanical results already recorded for this snapshot be reused? Only when a COMPLETE run recorded them for
 *  the same snapshot and the same tool inputs (record existence alone is never enough). */
export function mechanicalReusable({ resultsRoot, snapshotId, toolKey }) {
  const m = readJson(mechanicalMarkerOf(resultsRoot, snapshotId));
  if (!m) return { reusable: false, why: 'no complete mechanical run recorded for this snapshot' };
  if (m.snapshotId !== snapshotId) return { reusable: false, why: 'the mechanical record belongs to another snapshot' };
  if (!m.complete) return { reusable: false, why: 'the earlier mechanical run did not complete' };
  if (m.toolKey !== toolKey) return { reusable: false, why: 'a tool, its version or --lint changed since the mechanical run' };
  const lines = readResults(resultsFile(resultsRoot, snapshotId)).filter((r) => !r._invalid && r.snapshotId === snapshotId && String(r.unit || '').startsWith('tool:') && r.executor !== 'M');
  if (lines.length !== m.units) return { reusable: false, why: 'the recorded mechanical results (' + lines.length + ') do not match the completed run (' + m.units + ')' };
  return { reusable: true, why: 'complete mechanical run of ' + m.at + ' (gate ' + m.gate + ')', gate: m.gate, at: m.at, full: m.full || null };
}

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
  const tools = resolveTools({ root, autoDir, tsc: o.tsc, eslint: o.eslint, lint: !!o.lint });
  const { tscPath, eslintPath, lintAsked, toolKey } = tools;
  const tsconfig = inputs.tsconfig ? path.resolve(root, inputs.tsconfig) : firstFile([path.join(autoDir, 'tsconfig.json'), path.join(root, 'tsconfig.json')]);
  const timeoutMs = Number(o.toolTimeoutMs) > 0 ? Number(o.toolTimeoutMs) : 600000;
  const slots = o.slots || await complianceSlots({ limit: o.limit, runId: o.runId, runFile: inputs.runFile, noLedger: o.noLedger, warnings, maxWaitMs: o.maxWaitMs, env: o.env || process.env });
  // no safe coordination, or no slot within the budget: nothing starts and nothing is recorded — a coordination failure,
  // never a code or test result (a later call on the same snapshot records the mechanical results afresh)
  if (slots.mode === 'blocked') return early({ ...base, gate: 'BLOCKED', snapshotId: snapshot ? snapshot.snapshotId : null, reason: slots.reason, coordination: slots.diagnostics, recorded: 0, warnings });
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
  let pooled;
  try { pooled = await pool; } finally { try { await slots.close(); } catch { /* the ledger sweep resolves it */ } }
  const { results, maxActive } = pooled;
  components.tsc = results[0];
  components.lint = lintAsked ? results[1] : null;
  if (components.lint) components.lint.deterministicFloatingPromises = lf.floatingPromises;
  const coordinationFailed = results.some((r) => r && r.status === 'notRun' && /^no compliance slot/.test(String(r.reason || '')));
  const gate = worstGate(components, lintAsked);

  // mechanical results for the frozen snapshot — recorded only by a COMPLETE run (a tool that never got a compliance slot
  // leaves nothing behind, so the retry records them); an incomplete or other-tool earlier set is replaced, never doubled
  let recorded = null;
  let recordNote = null;
  if (snapshot && coordinationFailed) { recorded = 0; recordNote = 'not recorded: a tool never got a compliance slot (coordination, not a code result) — run again on the same snapshot'; }
  else if (snapshot) {
    const sid = snapshot.snapshotId;
    const file = resultsFile(resultsRoot, sid);
    const reuse = mechanicalReusable({ resultsRoot, snapshotId: sid, toolKey });
    const isMech = (r) => !r._invalid && String(r.unit || '').startsWith('tool:') && r.snapshotId === sid && r.executor !== 'M';
    const existing = readResults(file).filter(isMech);
    if (existing.length && reuse.reusable) { recorded = 0; recordNote = 'mechanical results for this snapshot already exist (' + reuse.why + ') — not recorded twice (a second set would be duplicates the gate rejects)'; }
    else {
      const recs = mechanicalRecords({ checkpoint: snapshot.body.checkpoint, facts: snapshot.body.facts, snapshotId: sid, components, at });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (existing.length) {
        const keep = readResults(file).filter((r) => !isMech(r)).map(({ _line, ...r }) => r).filter((r) => !r._invalid);
        writeTextAtomic(file, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '') + recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''));
        recordNote = 'earlier mechanical results of this snapshot replaced (' + reuse.why + ')';
      } else fs.appendFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + (recs.length ? '\n' : ''));
      writeJsonAtomic(mechanicalMarkerOf(resultsRoot, sid), { snapshotId: sid, toolKey, complete: true, units: recs.length, gate, at });
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
    coordination: slots.diagnostics || null,
    tools: { tsc: tools.tscPath ? relTo(root, tools.tscPath) : null, tscVersion: tools.tscVersion, eslint: tools.eslintPath ? relTo(root, tools.eslintPath) : null, eslintVersion: tools.eslintVersion },
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
    slots: full.slots, ...(slots.diagnostics && (slots.diagnostics.outcome !== 'OK' || slots.diagnostics.waitedMs > 5000) ? { coordination: slots.diagnostics } : {}),
    recorded, recordNote: recordNote || undefined, full: fullPath ? posix(fullPath) : null, warnings,
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

/* ---------------- checkpoint — ONE orchestration command per checkpoint (deterministic steps only) ----------------
   snapshot → mechanical (reused only when complete for this snapshot and these tools) → (B) runtime verify → the
   semantic review handoff → record --batch → gate. It never writes a semantic verdict: without --review it stops at
   AWAITING_REVIEW with an EMPTY template of the results still missing; with --review the batch must name the frozen
   snapshot and is validated as a whole (recordBatch). B also needs a valid, applicable Checkpoint A PASS (every B-scope
   file covered by a PASS gate A at its current content) and the results-freshness check, written to the draft run file
   BEFORE the freeze. Every step stops the chain on failure. Exit codes (checkpoint / finalize — not --strict-only):
   PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3 · AWAITING_REVIEW 4. */
export const ORCHESTRATION_EXIT = Object.freeze({ PASS: 0, FAIL: 1, BLOCKED: 2, NOT_RUN: 3, AWAITING_REVIEW: 4 });

/** Every PASS gate A of the phase (one per snapshot folder) → file → the hashes those gates covered. */
export function checkpointACoverage(resultsRoot, phase) {
  const covered = new Map();
  const gates = [];
  for (const id of readdirSafe(path.join(resultsRoot, 'artifacts', 'checks'))) {
    const g = readJson(path.join(checksDir(resultsRoot, id), 'gate-A.json'));
    if (!g || g.checkpoint !== 'A' || Number(g.phase) !== Number(phase)) continue;
    gates.push({ snapshotId: g.snapshotId, verdict: g.verdict, decidedAt: g.decidedAt, rehash: !!(g.rehash && g.rehash.matched) });
    if (g.verdict !== 'PASS' || !(g.rehash && g.rehash.matched)) continue;
    const s = loadSnapshot(resultsRoot, g.snapshotId);
    if (!s) continue;
    for (const [f, h] of Object.entries(s.body.files || {})) { if (!covered.has(f)) covered.set(f, new Set()); covered.get(f).add(h); }
  }
  return { covered, gates };
}

/** Is gate A valid and applicable for this B scope? → { ok, reason, uncovered[] } */
export function checkpointAApplies({ root, resultsRoot, phase, files }) {
  const rec = readJson(gateRecordPath(resultsRoot, phase, 'A'));
  if (!rec) return { ok: false, reason: 'no Checkpoint A gate record for phase ' + phase + ' (.runs/phase-' + phase + '.checkpoint-A.json)', uncovered: [] };
  if (rec.checkpoint !== 'A' || Number(rec.phase) !== Number(phase)) return { ok: false, reason: 'the Checkpoint A record is not this phase\'s', uncovered: [] };
  if (rec.verdict !== 'PASS') return { ok: false, reason: 'the latest Checkpoint A of phase ' + phase + ' is ' + rec.verdict + ', not PASS', uncovered: [] };
  if (!(rec.rehash && rec.rehash.matched)) return { ok: false, reason: 'the latest Checkpoint A was void (its scope changed before its gate)', uncovered: [] };
  const { covered } = checkpointACoverage(resultsRoot, phase);
  const uncovered = [];
  for (const f of files) {
    const k = posix(f);
    const now = fileSha(path.resolve(root, f));
    if (!covered.has(k) || !covered.get(k).has(now)) uncovered.push(k);
  }
  return uncovered.length ? { ok: false, reason: uncovered.length + ' file(s) of the final scope are not covered by a PASS Checkpoint A at their current content — refresh Checkpoint A on them (check.mjs checkpoint --checkpoint A)', uncovered } : { ok: true, reason: null, uncovered };
}

/**
 * The results-freshness check (`<checkpoint_b>` step 4) on the final code, written to the DRAFT run file's
 * impact.final_check BEFORE the freeze — rewritten only when its content changed, so a repeated call never edits a
 * frozen draft. memberReviews {TC: "file:line … why the changed member is unreachable"} fill fresh_by_member_only[].review.
 */
export async function freshnessCheck({ root, automationRoot, files, resultsRoot, runFile, memberReviews = null, now = null, write = true }) {
  let impact;
  try { impact = await import(pathToFileURL(path.join(here, 'impact.mjs')).href); } catch (e) { return { ok: false, reason: 'impact.mjs could not be loaded: ' + e.message }; }
  const run = readJson(runFile);
  if (!run) return { ok: false, reason: 'the draft run file is unreadable: ' + posix(runFile) };
  const autoAbs = path.resolve(root, automationRoot);
  const specs = files.filter((f) => isSpecFile(f)).map((f) => path.resolve(root, f));
  let sel;
  try { sel = impact.selectStale({ root: autoAbs, specs, progressDir: path.join(resultsRoot, 'artifacts', 'progress'), runPlan: run.run_plan || null }); }
  catch (e) { return { ok: false, reason: 'the freshness selection failed: ' + e.message }; }
  const prev = (run.impact && run.impact.final_check) || {};
  const prevReview = new Map((prev.fresh_by_member_only || []).filter((x) => x && x.tc).map((x) => [x.tc, x.review || null]));
  const member = sel.fresh_by_member_only.map((tc) => ({ tc, review: (memberReviews && typeof memberReviews[tc] === 'string' && memberReviews[tc].trim().length >= 8 ? memberReviews[tc].trim() : null) || prevReview.get(tc) || null }));
  const body = { stale: sel.stale.map((s) => ({ tc: s.tc, changed: s.changed, reason: s.reason })), fresh_by_member_only: member, unknown: sel.unknown.map((u) => u.tc || u) };
  const same = canon({ stale: prev.stale || [], fresh_by_member_only: prev.fresh_by_member_only || [], unknown: prev.unknown || [] }) === canon(body);
  // read-only (a frozen draft): a different result is reported, never written — the freeze is not silently re-made
  if (!same && !write) return { ok: true, written: false, changedSinceFreeze: true, stale: body.stale, memberOnly: member, needsReview: [], unknown: body.unknown, warnings: [] };
  if (!same) writeJsonAtomic(runFile, { ...run, impact: { ...(run.impact || {}), final_check: { at: (now ? new Date(now) : new Date()).toISOString(), ...body } } });
  return { ok: true, written: !same, stale: body.stale, memberOnly: member, needsReview: member.filter((m) => !m.review).map((m) => m.tc), unknown: body.unknown, warnings: (sel.warnings || []).slice(0, 5) };
}

/** The semantic results the gate still misses for this snapshot — the EMPTY review template (never a verdict). */
export function reviewTemplate({ resultsRoot, snapshot, checkpoint }) {
  const records = readResults(resultsFile(resultsRoot, snapshot.snapshotId));
  const d = decideGate({ checkpoint, snapshot, records, rehashResult: { matched: true, differences: [] }, freshness: { known: true, stale: [], source: 'template' } });
  const openBy = new Map();
  for (const r of records) if (!r._invalid && r.snapshotId === snapshot.snapshotId && r.status === 'unresolved') openBy.set(String(r.checkId), [...(openBy.get(String(r.checkId)) || []), ...(r.evidenceRef || []).slice(0, 3)]);
  const items = d.rejected.filter((x) => x.why === 'missing' && CHECK_BY_ID.has(String(x.checkId))).map((x) => {
    const c = CHECK_BY_ID.get(String(x.checkId));
    return { check: c.id, unit: x.unit, status: null, reason: null, evidence: [], executor: null,
      question: c.short + (/semantic scope result must close/.test(x.detail || '') ? ' — closes the open mechanical items' + (openBy.get(c.id) ? ': ' + openBy.get(c.id).slice(0, 3).join('; ') : '') : '') };
  });
  return { snapshot: snapshot.snapshotId, checkpoint, instructions: 'fill status (verified-semantic | unresolved | FAIL | N/A only with its predicate), reason (what was read and decided) and evidence (file:line) for EVERY entry; never copy a status you did not decide', results: items };
}

export async function checkpointRun(o) {
  const root = path.resolve(o.root || process.cwd());
  const checkpoint = String(o.checkpoint || '').toUpperCase();
  const phase = Number(o.phase);
  const resultsRoot = o.resultsRoot ? path.resolve(root, o.resultsRoot) : null;
  const head = { tool: 'check', schema: SCHEMA, cmd: 'checkpoint', checkpoint, phase: phase || null };
  const steps = [];
  const stop = (outcome, step, reason, extra = {}) => ({ ...head, outcome, step, reason, steps, ...extra, exit: ORCHESTRATION_EXIT[outcome] ?? 2 });
  const errs = [];
  if (!['A', 'B'].includes(checkpoint)) errs.push('--checkpoint A|B');
  if (!resultsRoot) errs.push('--results-root <dir>');
  if (!(phase > 0)) errs.push('--phase N');
  if (!(o.files || []).length) errs.push('--files <in-scope files>');
  if (errs.length) return stop('BLOCKED', 'inputs', 'required: ' + errs.join(', '));
  const automationRoot = automationRootOf(root, o.automationRoot);
  const files = uniq(o.files.map((f) => relTo(root, path.resolve(root, f))));
  const draftsDir = checkpoint === 'B' ? (o.drafts ? path.resolve(root, o.drafts) : path.join(resultsRoot, 'artifacts', 'drafts', 'phase-' + phase)) : null;
  let runFile = o.runFile ? path.resolve(root, o.runFile) : null;
  if (checkpoint === 'B') {
    // 1. preconditions: a valid, applicable PASS of A; the drafts; freshness written before the freeze
    const a = checkpointAApplies({ root, resultsRoot, phase, files });
    steps.push({ step: 'checkpoint-A', ok: a.ok, ...(a.ok ? {} : { reason: a.reason }) });
    if (!a.ok) return stop('BLOCKED', 'checkpoint-A', a.reason, { uncovered: a.uncovered.slice(0, 20) });
    const draftRun = path.join(draftsDir, '.runs', 'phase-' + phase + '.json');
    if (!isFile(draftRun)) return stop('BLOCKED', 'drafts', 'no draft run file at ' + posix(path.relative(root, draftRun)) + ' — draft first (run-data.mjs finalize)');
    runFile = draftRun;
    const fr = await freshnessCheck({ root, automationRoot, files, resultsRoot, runFile, memberReviews: o.memberReviews || null, now: o.now, write: !o.readOnly });
    steps.push({ step: 'freshness', ok: fr.ok && !(fr.stale || []).length && !fr.changedSinceFreeze, stale: fr.ok ? fr.stale.length : null, memberOnly: fr.ok ? fr.memberOnly.length : null, written: fr.ok ? fr.written : null });
    if (!fr.ok) return stop('BLOCKED', 'freshness', fr.reason);
    if (fr.changedSinceFreeze) return stop('BLOCKED', 'freshness', 'the results freshness differs from the frozen draft (code or results changed after the freeze) — nothing recorded; freeze again (run-data.mjs finalize without --review)');
    if (fr.stale.length) return stop('BLOCKED', 'freshness', fr.stale.length + ' reported result(s) ran on older code — re-run them (impact.mjs select) before Checkpoint B', { stale: fr.stale.slice(0, 20).map((s) => s.tc + (s.changed.length ? ' (' + s.changed.slice(0, 3).join(', ') + ')' : '')) });
    if (fr.needsReview.length) return stop('AWAITING_REVIEW', 'member-review', 'fresh_by_member_only TCs need a semantic review BEFORE the freeze: pass --member-reviews <json> {"TC-…": "file:line — why the changed member is unreachable from it"} (else re-run them)', { memberOnly: fr.needsReview });
  }
  // 2. snapshot (freeze)
  let s;
  try { s = takeSnapshot({ root, automationRoot, resultsRoot, checkpoint, phase, files, tc: o.tc, data: o.data, req: o.req || [], runFile, inventory: o.inventory, requireSteps: !!o.requireSteps, draftsDir, screenshotsDir: o.screenshots, tsconfig: o.tsconfig, now: o.now }); }
  catch (e) { return stop('BLOCKED', 'snapshot', 'the snapshot failed: ' + e.message); }
  const sid = s.snapshotId;
  steps.push({ step: 'snapshot', ok: true, snapshotId: sid, reused: s.reused });
  if (checkpoint === 'B' && !s.snapshot.body.drafts) return stop('BLOCKED', 'snapshot', 'the drafts folder is empty — Checkpoint B freezes the drafts', { snapshotId: sid });
  // 3. mechanical — reused only when a COMPLETE run recorded it for this snapshot and these tool inputs
  const autoDir = path.resolve(root, automationRoot);
  const tools = resolveTools({ root, autoDir, tsc: o.tsc, eslint: o.eslint, lint: !!o.lint });
  const reuse = mechanicalReusable({ resultsRoot, snapshotId: sid, toolKey: tools.toolKey });
  let mech = null;
  if (reuse.reusable) { steps.push({ step: 'mechanical', ok: reuse.gate !== 'FAIL', reused: true, gate: reuse.gate, why: reuse.why }); mech = { gate: reuse.gate, reused: true }; }
  else {
    const { compact } = await runChecks({ root, resultsRoot, snapshotId: sid, tsc: o.tsc, eslint: o.eslint, lint: !!o.lint, limit: o.limit, noLedger: !!o.noLedger, maxWaitMs: o.maxWaitMs, runId: o.runId, env: o.env, slots: o.slots, runTool: o.runTool });
    mech = compact;
    steps.push({ step: 'mechanical', ok: compact.gate !== 'FAIL' && !compact.void && !(compact.coordination && compact.coordination.outcome !== 'OK'), gate: compact.gate, recorded: compact.recorded, full: compact.full || null });
    if (compact.void) return stop('BLOCKED', 'mechanical', compact.reason, { snapshotId: sid });
    if (compact.coordination && compact.coordination.outcome !== 'OK') return stop('BLOCKED', 'mechanical', 'coordination, not a code or test result: ' + (compact.reason || (compact.coordination.refusals[0] || {}).reason || 'no compliance slot within the budget'), { snapshotId: sid, coordination: compact.coordination });
    if (compact.gate === 'FAIL') {
      const c = compact.components || {};
      return stop('FAIL', 'mechanical', 'the mechanical checks found violations — repair them; the repair is a new snapshot', { snapshotId: sid, first: [...((c.tsc && c.tsc.first) || []), ...((c.validator && c.validator.open) || [])].slice(0, 10), full: compact.full || null });
    }
  }
  // 4. (B) runtime checks on this phase's own evidence
  if (checkpoint === 'B') {
    let rd;
    try { rd = await import(pathToFileURL(path.join(here, 'run-data.mjs')).href); } catch (e) { return stop('BLOCKED', 'runtime', 'run-data.mjs could not be loaded: ' + e.message, { snapshotId: sid }); }
    const v = rd.runData({ _: ['verify'], 'run-file': runFile, 'results-root': resultsRoot, snapshot: sid });
    const failing = Object.entries(v.checks || {}).filter(([, c]) => c.status === 'FAIL').map(([id, c]) => id + ': ' + c.evidence);
    steps.push({ step: 'runtime', ok: v.outcome === 'PASS' || (v.outcome !== 'FAIL' && v.outcome !== 'BLOCKED' && v.outcome !== 'NOT_RUN'), outcome: v.outcome, recorded: v.recorded ? v.recorded.written.length : 0 });
    if (!v.checks) return stop('BLOCKED', 'runtime', 'the runtime checks could not run: ' + (v.reason || v.outcome), { snapshotId: sid });
    if (failing.length) return stop('FAIL', 'runtime', failing.length + ' runtime check(s) failed on this phase\'s evidence', { snapshotId: sid, failing: failing.slice(0, 10) });
  }
  // 5. the semantic review: a handoff without --review, a validated whole batch with it
  if (!o.review) {
    const tpl = reviewTemplate({ resultsRoot, snapshot: s.snapshot, checkpoint });
    const file = path.join(checksDir(resultsRoot, sid), 'semantic-' + checkpoint + '.template.json');
    writeJsonAtomic(file, tpl);
    return stop('AWAITING_REVIEW', 'review', tpl.results.length + ' semantic result(s) needed for snapshot ' + sid + ' — fill a copy of the template (semantic-' + checkpoint + '.json beside it) and call again with --review', {
      snapshotId: sid, template: posix(path.relative(root, file)), needed: tpl.results.map((x) => x.check + ' ' + x.unit).slice(0, 60), mechanical: mech ? mech.gate : null });
  }
  const text = read(path.resolve(root, o.review));
  if (text === null) return stop('BLOCKED', 'review', '--review file not found: ' + o.review, { snapshotId: sid });
  const parsed = parseBatch(text);
  if (parsed.error) return stop('BLOCKED', 'review', parsed.error, { snapshotId: sid });
  if (!parsed.snapshotId || String(parsed.snapshotId) !== String(sid)) return stop('BLOCKED', 'review', 'the review names snapshot ' + (parsed.snapshotId || '(none)') + ', not the frozen ' + sid + ' — a review must be written for the frozen scope ({ "snapshot": "' + sid + '", "results": [ … ] })', { snapshotId: sid });
  const r = recordBatch({ resultsRoot, snapshotId: sid, entries: parsed.entries, batchSnapshotId: parsed.snapshotId });
  steps.push({ step: 'record', ok: r.ok, written: r.written, errors: r.ok ? 0 : r.errors.length });
  if (!r.ok) return stop('BLOCKED', 'record', 'the review batch was rejected as a whole — nothing recorded', { snapshotId: sid, errors: r.errors.slice(0, 20) });
  // 6. the gate
  const g = runGate({ resultsRoot, snapshotId: sid, checkpoint, phase });
  if (g.error) return stop('BLOCKED', 'gate', g.error, { snapshotId: sid });
  const rec = g.record;
  const openList = [...rec.rejected.map((x) => x.checkId + ' ' + x.unit + ' ' + x.why), ...rec.fail.map((x) => x.checkId + ' ' + x.unit + ' FAIL'), ...rec.open.map((x) => x.checkId + ' ' + x.unit + ' unresolved')];
  steps.push({ step: 'gate', ok: rec.verdict === 'PASS', verdict: rec.verdict });
  return stop(rec.verdict, 'gate', rec.verdict === 'PASS' ? 'Checkpoint ' + checkpoint + ' PASS on snapshot ' + sid : openList.length + ' open item(s)', { snapshotId: sid, counts: rec.counts, open: openList.slice(0, 10), more: Math.max(0, openList.length - 10), record: g.written ? posix(path.relative(root, g.written)) : null });
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
    'node check.mjs checkpoint --checkpoint A|B --root <project> --results-root <dir> --phase N --files <a,b|@list> [--tc <md>] [--data <TEST-DATA md>] [--req <files>] [--run-file <json>] [--inventory <md>] [--require-steps] [--lint] [--drafts <dir>] [--screenshots <dir>] [--max-wait <ms>] [--member-reviews <json>] [--review <semantic-{A|B}.json>] [--pretty]',
    'node check.mjs run --root <project> --files <a,b|@list> [--automation-root <dir>] [--tc <TEST-CASES md>] [--req <REQ files,…>] [--inventory <automation-inventory.md>] [--require-steps] [--tsconfig <file>] [--tsc <tsc js>] [--lint] [--eslint <eslint.js>] [--limit 2] [--no-ledger] [--max-wait <ms>] [--run-file <.runs/phase-N.json>] [--results-root <dir>] [--snapshot <id>] [--full] [--strict] [--pretty]',
    'node check.mjs snapshot --checkpoint A|B --root <project> --results-root <dir> --phase N --files <a,b|@list> [--automation-root <dir>] [--tc <md>] [--data <TEST-DATA md>] [--req <files>] [--run-file <json>] [--inventory <md>] [--require-steps] [--drafts <dir>] [--screenshots <dir>] [--pretty]',
    'node check.mjs record --results-root <dir> --snapshot <id> (--batch <results.json> | --check <id> --unit scope|phase|file:<path> --status <status> --reason "<what was read and why>" [--evidence <file:line,…>] [--executor M|SB-P|SB-Q|SB-E|SB-D|SB-H|V|S]) [--strict]',
    'node check.mjs gate --checkpoint A|B --results-root <dir> --snapshot <id> [--phase N] [--impact <impact select payload json>] [--dry-run] [--strict] [--pretty]',
    'node check.mjs carry --results-root <dir> --from <earlier snapshot id> --to <current snapshot id> [--pretty]',
    'node check.mjs harness --name <selftest-*.mjs> [--force] [--dry-run] [--pretty]',
  ],
  notes: [
    'checkpoint = the whole procedure in ONE command: (B: a valid, applicable PASS of Checkpoint A + the freshness check written to the draft run file) → snapshot → mechanical (reused only when complete for this snapshot and tools) → (B: runtime verify) → without --review it stops AWAITING_REVIEW with an EMPTY template of the semantic results still missing; with --review (a batch naming the frozen snapshot) → record --batch → gate. It never writes a semantic verdict. Exit (always, not only --strict): PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3 · AWAITING_REVIEW 4.',
    'Coordination: one --max-wait budget (default 120 s, capped 240 s) covers every ledger lock and compliance reservation of the call; a timeout is BLOCKED with the holders named — a coordination failure, never a code result, never a forced release, nothing recorded. --no-ledger / QA_LEDGER=off = an exclusive reservation, bounded the same way; no safe coordination → BLOCKED before any tool starts.',
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
      limit: Number(args.limit) || null, noLedger: !!args['no-ledger'], maxWaitMs: Number(args['max-wait']) || null, resultsRoot: rr, snapshotId: str(args.snapshot), runFile: str(args['run-file']),
    });
    printOut(args.full ? full : compact, args);
    return args.strict ? (STRICT_EXIT[compact.gate] ?? 0) : 0;
  }
  if (cmd === 'checkpoint') {
    let memberReviews = null;
    if (str(args['member-reviews'])) { try { memberReviews = JSON.parse((read(path.resolve(root, args['member-reviews'])) || '').replace(/^﻿/, '')); } catch (e) { printOut({ tool: 'check', schema: SCHEMA, cmd, outcome: 'BLOCKED', step: 'inputs', reason: '--member-reviews is not valid JSON: ' + e.message }, args); return ORCHESTRATION_EXIT.BLOCKED; } }
    const r = await checkpointRun({ root, checkpoint: args.checkpoint, phase: Number(args.phase), resultsRoot: str(args['results-root']), automationRoot: str(args['automation-root']), files: filesArg(args.files, root),
      tc: str(args.tc), data: str(args.data), req: csv(args.req), runFile: str(args['run-file']), inventory: str(args.inventory), requireSteps: !!args['require-steps'], drafts: str(args.drafts), screenshots: str(args.screenshots),
      tsconfig: str(args.tsconfig), tsc: str(args.tsc), eslint: str(args.eslint), lint: !!args.lint, limit: Number(args.limit) || null, noLedger: !!args['no-ledger'], maxWaitMs: Number(args['max-wait']) || null,
      review: str(args.review), memberReviews });
    printOut(r, args);
    return r.exit;
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
    print({ tool: 'check', schema: SCHEMA, verdict: 'BLOCKED', gate: 'BLOCKED', outcome: 'BLOCKED', error: 'internal error in ' + (args._[0] || 'check') + ': ' + e.message }, args);
    process.exit(args.strict || args._[0] === 'checkpoint' ? 2 : 0);
  });
}
