#!/usr/bin/env node
// parallel-plan.mjs — the Parallel Execution Readiness Check of skill 5 (optimisation plan Revision 3 §3.1-§3.3, §3.7,
// §3.9; Revision 3.1 §3.4-§3.5). Node >= 18, zero dependencies. READ-ONLY: it writes one file only behind --out.
//
// For every TC of a story it derives CLAIMS — what the TC reads, writes, aggregates over, which account / session state
// and background effects it touches — from the approved TC document (Data effect, Shared data, Data Oracle, Steps, the
// [A{n}] / [D{n}] tokens), TEST-DATA (account notes: single session, lockout, preferences), the learning file and the
// run files (learned interference, honoured even after a TC changed: `revalidate`), and the CODE of its execution unit
// (setup / teardown hooks, worker- and test-scoped fixtures, fixed-literal record creation, global setup). Unique record
// names prove only that two tests do not write the same record; they never remove a setup, teardown, aggregate, account
// or background claim. Whatever cannot be bounded gets an exclusive run-alone claim (fail safe).
//
// Execution units (Revision 3.1 §3.4) — never split:
//   U1 a single test · U2 a serial chain (describe.serial / mode: 'serial' / an order dependency, merged into one unit) ·
//   U3 a shared-hook group (a describe or file whose beforeAll / afterAll, or a worker-scoped fixture, creates or modifies
//   shared state) · U4 an unsupported structure — global setup / setup projects with side effects, a fixture or beforeAll
//   that breaks the admission contract (helpers/admission.ts present: every side-effecting worker fixture depends on
//   `workerAdmission`, every side-effecting test fixture on `unitAdmission`, every side-effecting beforeAll takes
//   `workerAdmission`), dynamic test generation, third-party test fixtures: admitted only at child spawn, one unit per child.
//
// Classes (Revision 3 §3.3): parallel-ready · restricted (named conflicts on named keys) · ordered (inside a chain) ·
// barrier (exclusive global effect) · run-alone (unknown / unbounded) · not-scheduled (no automated test, not a
// candidate, or a readiness skip). The free POOL is every U1 unit that conflicts with no other unit of the stage.
//
// MODES: by default (mode 'readiness') the payload is what the dispatcher needs — claims, classes, units, conflicts,
// pool, readiness counts, unlock suggestions and `inputs.fingerprint` (readinessFingerprint: what the verdict depends
// on); run-stage.mjs (default scheduler auto) reads `units` / `pool` / `conflicts`, re-plans in-process when the
// fingerprint changed and runs SERIALLY on a BLOCKED, missing or unrefreshable payload. The SHADOW experiment (--compare, mode 'shadow') adds `candidatePlan.groups[]` in today's
// run_plan group shape and a `comparison` with the hand plan — opt-in, run only when a shadow experiment is deliberately
// collected; the hand-written run plan stays the plan of record either way. Conflict rules come from dispatch.mjs — the
// dispatcher and this check never disagree.
//
// Usage:
//   node parallel-plan.mjs --root <automation root> [--spec <file,…>] [--tc <TEST-CASES md>] [--data <TEST-DATA md>]
//        [--learning <Testing/project-learning.md>] [--run-file <.runs/phase-N.json>] [--progress <artifacts/progress>]
//        [--env-id <id>] [--stage smoke|positive|negative] [--ceiling <N>] [--compare] [--out <file>] [--strict] [--pretty]
// Exit code 0 by default; --strict maps OK 0 · BLOCKED 2.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, read, isFile, isDir, posix, rel, stripSource, matchDelim, splitArgs, findBlocks, testIdentifiers, importMap, walk, isCodeFile, sha256 } from './scan-lib.mjs';
import { parseTcDocument, parseTestData, tcHash, tcLayer } from './tc-hash.mjs';
import { closureOf, fingerprintTests } from './impact.mjs';
import { unitsConflict, isGlobal, createScheduler, parseKey, GLOBAL_KEY } from './dispatch.mjs';

export const SCHEMA_VERSION = 'skill5-parallel-plan/1';
export const CLASSES = ['parallel-ready', 'restricted', 'ordered', 'barrier', 'run-alone', 'not-scheduled'];
const STAGES = ['smoke', 'positive', 'negative'];
const CLASS_RANK = { 'not-scheduled': 0, 'parallel-ready': 1, restricted: 2, ordered: 3, barrier: 4, 'run-alone': 5 };

const natural = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
const sortU = (xs) => [...new Set(xs)].sort(natural);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normTitle = (t) => String(t || '').replace(/(^|\s)@[\w:.\-/]+/g, ' ').replace(/\s+/g, ' ').trim();   // = impact.mjs
const slug = (s) => String(s || '').toLowerCase().replace(/["“”«»`']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const median = (xs) => { const v = xs.filter((x) => typeof x === 'number' && x >= 0).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const readJson = (p) => { const t = read(p); if (t === null) return null; try { return JSON.parse(t); } catch { return undefined; } };
const TC_RE = /\bTC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g;

function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/* ---------------- vocabulary (generic — no project words) ---------------- */

const CREATE_VERBS = ['create', 'add', 'new', 'upload', 'import', 'submit'];
const MODIFY_VERBS = ['edit', 'update', 'save', 'approve', 'reject', 'assign', 'change'];
const DELETE_VERBS = ['delete', 'remove'];
const MUTATING = [...CREATE_VERBS, ...MODIFY_VERBS, ...DELETE_VERBS];
const KIND_OF = Object.fromEntries([...CREATE_VERBS.map((v) => [v, 'create']), ...MODIFY_VERBS.map((v) => [v, 'modify']), ...DELETE_VERBS.map((v) => [v, 'delete'])]);
const FILLERS = ['the', 'a', 'an', 'new', 'first', 'last', 'seeded', 'selected', 'existing', 'own', 'unique', 'pending', 'lifecycle', 'shared', 'another', 'second', 'this', 'that', 'its', 'their', 'one', 'same', 'other', 'next', 'previous', 'current', 'default', 'sample'];
const STOP_NOUNS = new Set(['status', 'value', 'quantity', 'name', 'field', 'form', 'button', 'page', 'screen', 'tab', 'filter', 'setting', 'settings',
  'date', 'format', 'label', 'message', 'confirmation', 'password', 'detail', 'details', 'list', 'menu', 'dialog', 'column', 'row', 'entry', 'item',
  'record', 'data', 'text', 'option', 'change', 'expected', 'result', 'click', 'link', 'icon', 'panel', 'view', 'section', 'table', 'grid', 'card',
  'modal', 'popup', 'search', 'number', 'count', 'total', 'sum', 'all', 'every', 'any', 'copy', 'version', 'title', 'description', 'comment', 'note',
  'type', 'mode', 'layout', 'language', 'locale', 'theme', 'error', 'warning', 'toast', 'banner', 'header', 'footer', 'home', 'dashboard', 'portal',
  'application', 'app', 'system', 'on', 'to', 'it', 'them', 'with', 'for', 'and', 'in', 'of', 'from', 'by', 'as', 'at', 'is', 'are', 'that', 'this',
  'latest', 'newest', 'oldest', 'recent', 'most', 'order-by', 'then', 'again', 'now', 'here', 'there']);
const AGG_VERBS = new Set(['check', 'verify', 'see', 'view', 'open', 'show', 'display', 'confirm', 'observe', 'read', 'compare', 'note']);
const AGG_ANY = /\b(count|counts|total|totals|sum|number of|latest|newest|oldest|most recent|empty state|no records|no results|sorted|sort by|sorts|pagination|next page|page 2|search|searches|export|exports)\b/;
const AGG_BEFORE = /\b([a-z][a-z-]{2,})\s+(?:count|counts|total|totals|sum)\b/g;
const AGG_AFTER = /\b(?:number of|list of|latest|newest|oldest|most recent|search for|search|searches|export|exports|sort|sorted)\b((?:\s+(?:the|a|an|all|every|latest|newest|oldest|first|last|most|recent|for))*)\s+([a-z][a-z-]{2,})/g;
const BG_EFFECTS = [
  ['audit', /\b(audit|activity log|history entr)/],
  ['notification', /\bnotification/],
  ['email', /\b(e-?mail|mailbox|inbox)\b/],
  ['recalculation', /\b(recalculat|roll(?:ed)?[- ]?up)/],
  ['index', /\b(search index|indexed|re-?index)/],
  ['job', /\b(scheduled job|nightly job|batch job|background job)\b/],
];
const GLOBAL_SETTINGS = /\b(system settings?|global settings?|application settings?|site settings?|admin(?:istration)? settings?|configuration screen|system configuration)\b/;
// a destructive reset of shared data, or the SERVER / global clock moved — never the browser's own clock
const GLOBAL_RESET_TEXT = /\b(?:reset|restore|wipe|purge|truncate|re-?seed|clear)\s+(?:the\s+|all\s+)?(?:test\s+)?(?:database|db|environment|tenant|backend|server data|all data|snapshot|seed data)\b|\bfactory[- ]reset\b/i;
const GLOBAL_CLOCK_TEXT = /\b(?:set|advance|freeze|change|move|shift)\s+(?:the\s+)?(?:system|server|application|backend|global)\s+(?:date|time|clock)\b|\btime[- ]travel\b/i;
const LANG_SWITCH = /\b(switch(?:es|ed)? (?:the )?(?:portal|application|app|ui|language) to|change (?:the )?language|language switch|switch to (?:arabic|english))\b/;
const WRONG_CRED = /\b(wrong|invalid|incorrect|expired) (password|credentials?|code|otp)\b|\block(?:ed)? out\b|\blockout\b/;
const NOTE_SINGLE = /\b(single[- ]session|one session|only one session|one active session)\b/i;
const NOTE_LOCK = /\block/i;
const NOTE_PREF = /\bpreference/i;
const INTERFERENCE = /\b(interfer\w*|must not run together|not run together|run (?:it |them )?alone|not in parallel|cannot run in parallel|conflict\w*)\b/i;

/** Lower-case plain text with every quoted literal removed (typed inputs and expected messages are not nouns). */
const plain = (s) => String(s || '').toLowerCase().replace(/"[^"]*"|“[^”]*”|«[^»]*»|`[^`]*`/g, ' ').replace(/\*\*|__/g, '');
const dTokens = (s) => sortU([...String(s || '').matchAll(/\[(D\d+)\]/g)].map((m) => m[1]));
const aTokens = (s) => sortU([...String(s || '').matchAll(/\[(A\d+)\]/g)].map((m) => m[1]));
const snippet = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > 90 ? t.slice(0, 87) + '…' : t; };

const TARGET_RE = new RegExp('\\b(' + MUTATING.join('|') + ')\\b((?:\\s+(?:' + FILLERS.join('|') + '))*)\\s+([a-z][a-z-]{2,})', 'g');

/** Mutating verbs of one step and the entity each one names (null when the object is a generic UI noun). */
function mutationTargets(text) {
  const t = plain(text);
  const out = [];
  for (const m of t.matchAll(TARGET_RE)) {
    const noun = singular(m[3]);
    out.push({ verb: m[1], kind: KIND_OF[m[1]], noun: STOP_NOUNS.has(noun) || KIND_OF[noun] ? null : noun, at: m.index });
  }
  for (const v of MUTATING) {
    if (v === 'new') continue;   // "new" is a verb only with an object ("New order")
    for (const m of t.matchAll(new RegExp('\\b' + v + '\\b', 'g'))) if (!out.some((o) => o.at === m.index)) out.push({ verb: v, kind: KIND_OF[v], noun: null, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Aggregate reads of one text item: the collections it counts / sorts / searches / exports and the data items in it. */
function aggregateTargets(text) {
  const t = plain(text);
  if (!AGG_ANY.test(t)) return null;
  const nouns = [];
  // a determiner or a verb before "total" ("Check the total") names no collection — the fail-safe col:* applies then
  const named = (n) => !STOP_NOUNS.has(n) && !FILLERS.includes(n) && !AGG_VERBS.has(n);
  for (const m of t.matchAll(AGG_BEFORE)) { const n = singular(m[1]); if (named(n)) nouns.push(n); }
  for (const m of t.matchAll(AGG_AFTER)) { const n = singular(m[2]); if (named(n)) nouns.push(n); }
  return { nouns: sortU(nouns), tokens: dTokens(text) };
}

/** Head noun of a Shared data value ("lifecycle order (depends on TC-10)" → order). */
function sharedNoun(value) {
  const words = plain(String(value || '').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ')).split(/[^a-z-]+/).filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) { const w = singular(words[i]); if (!STOP_NOUNS.has(w) && !FILLERS.includes(w) && w.length > 2) return w; }
  return null;
}

/* ---------------- the TC document ---------------- */

function fieldOf(tc, name) {
  const k = Object.keys(tc.fields || {}).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? tc.fields[k] : { value: '', items: [] };
}
const fieldText = (tc, name) => { const f = fieldOf(tc, name); return [f.value, ...f.items].filter((x) => x && !/^[—-]$/.test(x.trim())).join('\n'); };
const fieldItems = (tc, name) => { const f = fieldOf(tc, name); return (f.items.length ? f.items : [f.value]).filter((x) => x && !/^[—-]$/.test(x.trim())); };

function docStage(tc) {
  if (/^yes\b/i.test(fieldText(tc, 'Smoke'))) return 'smoke';
  const st = fieldText(tc, 'Stage');
  if (/@negative/i.test(st)) return 'negative';
  if (/@positive/i.test(st)) return 'positive';
  return /negative/i.test(fieldText(tc, 'Type')) ? 'negative' : 'positive';
}

/* ---------------- [API] / [DB] lines (3.0) ---------------- */
const API_LINE = /^\s*\[API\]\s+([A-Z]+)\s+(?:\[E\d+\]\s*)?(\/\S*)/;
const DB_WRITE = /^\s*\[DB\]\s+(create|insert|update|delete|remove)\b(?:\s+(?:the|a|an|own|new))*\s+([a-z][a-z_-]{2,})/i;
const DB_CHECK = /^\s*\[DB\]\s+check\b[^\n]*?\b(?:the\s+)?([a-z][a-z_-]{2,})\s+record/i;
const DB_DDL = /^\s*\[DB\][^\n]*\b(truncate|alter table|drop table|create table)\b/i;
const normApiPath = (p) => String(p || '').split('?')[0].replace(/\$[A-Za-z_]\w*|\[D\d+\]|\{[^}]*\}|:[A-Za-z_]\w*|\b\d+\b/g, '{}').replace(/\/+$/, '').toLowerCase();
/** The API / DB mapping table of the automation inventory: method + path → effect (read · mutation · auth · unknown). */
export function readMapping(file) {
  const text = file ? read(file) : null;
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.replace(/\*\*|`/g, '').trim());
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-+/.test(lines[i + 1])) continue;
    const h = cells(lines[i]).map((x) => x.toLowerCase());
    const ci = { m: h.findIndex((x) => /^method/.test(x)), p: h.findIndex((x) => /^(path|endpoint)/.test(x)), e: h.findIndex((x) => /^effect/.test(x)) };
    if (ci.m < 0 || ci.p < 0 || ci.e < 0) continue;
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) { const c = cells(lines[j]); rows.push({ method: (c[ci.m] || '').toUpperCase(), path: normApiPath(c[ci.p]), effect: (c[ci.e] || '').toLowerCase().split(/\s/)[0] }); }
    i += 1;
  }
  return rows;
}
const entityOfPath = (p) => { const segs = String(p).split('?')[0].split('/').filter((s) => s && !/^\$|^\[D\d+\]$|^\{|^:|^\d+$|^api$|^v\d+$/i.test(s)); return segs.length ? singular(segs[segs.length - 1].toLowerCase().replace(/[^a-z-]/g, '')) : null; };

/**
 * Claims of the [API] / [DB] lines of one TC. The effect of an [API] call comes from the inventory mapping (the verified
 * contract) — NEVER from the HTTP method; a call with no mapping row, or a line in business words, is `unknown` and runs
 * ALONE (a POST or an INSERT is never presumed independent). A create of the TC's own record is an own write on its
 * collection (it still conflicts with every aggregate reader of that collection); an update / delete of a token-named
 * record is a write on that record; DDL / TRUNCATE is a barrier.
 */
export function markerClaims(lines, mapping = [], expectedLines = []) {
  const claims = [];
  const add = (key, mode, evidence, extra = {}) => { if (!claims.some((c) => c.key === key && c.mode === mode && !!c.own === !!extra.own)) claims.push({ key, mode, ...extra, source: 'marker', evidence }); };
  const captured = new Set();
  // Expected lines are ASSERTIONS: an [API] one asserts the call's response (no claim of its own); a [DB] one reads
  for (const raw of expectedLines) {
    const c = DB_CHECK.exec(String(raw || ''));
    if (c) { const tokens = dTokens(raw); add('col:' + singular(c[1].toLowerCase()) + (tokens[0] ? '@' + tokens[0] : ''), /\bhas \d+ rows?\b|\bcount\b|does not exist/i.test(raw) ? 'aggregate-read' : 'read', '"' + snippet(raw) + '"'); }
  }
  for (const raw of lines) {
    const line = String(raw || '');
    for (const m of line.matchAll(/capture\b[^$]*?\bas\s+\$([A-Za-z_]\w*)/g)) captured.add(m[1]);
    if (!/^\s*\[(API|DB)\]/.test(line)) continue;
    const tokens = dTokens(line);
    if (DB_DDL.test(line)) { add(GLOBAL_KEY, 'exclusive', '"' + snippet(line) + '" — DDL / TRUNCATE: a barrier'); continue; }
    const api = API_LINE.exec(line);
    if (/^\s*\[API\]/.test(line)) {
      if (!api) { add(GLOBAL_KEY, 'exclusive', '"' + snippet(line) + '" — an API call in business words: its effect is unknown until the mapping names it'); continue; }
      const row = mapping.find((r) => r.method === api[1] && r.path === normApiPath(api[2]));
      const effect = row ? row.effect : 'unknown';
      const entity = entityOfPath(api[2]);
      if (effect === 'read' || effect === 'auth') { if (entity) add('col:' + entity + (tokens[0] ? '@' + tokens[0] : ''), 'read', '"' + snippet(line) + '" — mapped ' + effect); continue; }
      if (effect !== 'mutation' || !entity) { add(GLOBAL_KEY, 'exclusive', '"' + snippet(line) + '" — ' + (row ? 'mapped ' + effect : 'no mapping row') + ': the effect is not proven — runs alone'); continue; }
      const ownTarget = /\$([A-Za-z_]\w*)/.exec(api[2]);
      if (api[1] === 'POST' && !tokens.length) add('col:' + entity, 'write', '"' + snippet(line) + '" — creates its own ' + entity, { own: true });
      else if (ownTarget && captured.has(ownTarget[1])) add('col:' + entity, 'write', '"' + snippet(line) + '" — changes the ' + entity + ' it created ($' + ownTarget[1] + ')', { own: true });
      else if (tokens.length) { add('rec:' + tokens[0], 'write', '"' + snippet(line) + '" — changes [' + tokens[0] + ']'); add('col:' + entity + '@' + tokens[0], 'write', '"' + snippet(line) + '"'); }
      else add(GLOBAL_KEY, 'exclusive', '"' + snippet(line) + '" — changes an existing ' + entity + ' it does not name: runs alone');
      continue;
    }
    const w = DB_WRITE.exec(line);
    if (w) {
      const entity = singular(w[2].toLowerCase());
      const kind = w[1].toLowerCase();
      if (kind === 'create' || kind === 'insert') add('col:' + entity, 'write', '"' + snippet(line) + '" — inserts its own ' + entity, { own: true });
      else if (tokens.length) { add('rec:' + tokens[0], 'write', '"' + snippet(line) + '" — changes [' + tokens[0] + ']'); add('col:' + entity + '@' + tokens[0], 'write', '"' + snippet(line) + '"'); }
      else if (/\$([A-Za-z_]\w*)/.test(line) && [...line.matchAll(/\$([A-Za-z_]\w*)/g)].every((m) => captured.has(m[1]))) add('col:' + entity, 'write', '"' + snippet(line) + '" — changes the ' + entity + ' it created', { own: true });
      else add(GLOBAL_KEY, 'exclusive', '"' + snippet(line) + '" — a DB write on a record it does not name: runs alone');
      continue;
    }
    const c = DB_CHECK.exec(line);
    if (c) { const entity = singular(c[1].toLowerCase()); add('col:' + entity + (tokens[0] ? '@' + tokens[0] : ''), /\bhas \d+ rows?\b|\bcount\b|does not exist/i.test(line) ? 'aggregate-read' : 'read', '"' + snippet(line) + '"'); }
  }
  return claims;
}

/** Claims of one TC from its document fields and TEST-DATA (code and learned claims are added per unit). */
export function tcClaims(tc, data, mapping = []) {
  const claims = [];
  const add = (key, mode, source, evidence, extra = {}) => { if (!claims.some((c) => c.key === key && c.mode === mode && !!c.own === !!extra.own)) claims.push({ key, mode, ...extra, source, evidence }); };
  const steps = fieldItems(tc, 'Steps');
  const pre = fieldItems(tc, 'Preconditions');
  const expected = fieldText(tc, 'Expected Result');
  const oracle = fieldText(tc, 'Data Oracle');
  const effectRaw = fieldText(tc, 'Data effect');
  const shared = fieldText(tc, 'Shared data');
  const allText = [tc.title, ...pre, ...steps, expected, oracle].join('\n');
  const all = plain(allText);
  const entities = [];
  let barrier = false;
  // accounts — signing in creates a session; wrong credentials count toward a lockout; a single-session account or a
  // session-wide language switch is a write on the account's state
  const accounts = aTokens([...pre, ...steps, tc.title].join('\n'));
  const wrongCred = WRONG_CRED.test(all);
  const langSwitch = LANG_SWITCH.test(all);
  for (const a of accounts) {
    const note = (data.accounts[a] && data.accounts[a].note) || '';
    if (NOTE_SINGLE.test(note)) add('acct:' + a, 'write', 'field', 'TEST-DATA: [' + a + '] allows one session');
    else if (wrongCred) add('acct:' + a, 'write', 'inferred', 'submits wrong credentials for [' + a + '] — counts toward its lockout' + (NOTE_LOCK.test(note) ? ' (TEST-DATA: ' + snippet(note) + ')' : ''));
    else if (langSwitch) add('acct:' + a, 'write', 'inferred', 'switches the session language of [' + a + ']' + (NOTE_PREF.test(note) ? ' (a per-user preference)' : ''));
    else add('acct:' + a, 'read', 'field', 'signs in as [' + a + ']');
  }
  if (langSwitch && !accounts.length) add('global:locale', 'write', 'inferred', 'switches the application language');
  // shared data — TCs naming the same shared data run one after another; "depends on TC-x" is an order dependency
  let after = [];
  if (shared) {
    const base = shared.replace(/\(?\s*depends on[^)]*\)?/ig, ' ').trim();
    add('shared:' + slug(base), 'write', 'field', 'Shared data: ' + snippet(shared));
    after = sortU([...(shared.match(/depends on[^)]*/i) || [''])[0].matchAll(TC_RE)].map((m) => m[0]));
    const n = sharedNoun(shared);
    if (n) entities.push(n);
  }
  // data effect — the field decides; otherwise the steps' mutating verbs (inferred)
  const targets = steps.flatMap((s, i) => mutationTargets(s).map((t) => ({ ...t, step: i + 1, tokens: dTokens(s), text: s })));
  let mode = null, source = 'field';
  if (/read[- ]only/i.test(effectRaw)) mode = 'read-only';
  else if (/creat/i.test(effectRaw)) mode = 'creates';
  else if (/modif/i.test(effectRaw)) mode = 'modifies';
  else if (/delet/i.test(effectRaw)) mode = 'deletes';
  if (!mode) {
    source = 'inferred';
    if (!targets.length) mode = 'read-only';
    else if (targets.some((t) => t.kind === 'delete')) mode = 'deletes';
    else if (targets[0].kind === 'create') mode = 'creates';
    else mode = 'modifies';
  }
  // shared server state named in the TC text itself: a destructive reset or a server / global clock change → a barrier
  const resetText = GLOBAL_RESET_TEXT.exec(all);
  const clockText = GLOBAL_CLOCK_TEXT.exec(all);
  if (resetText) { barrier = true; add(GLOBAL_KEY, 'exclusive', 'inferred', '"' + snippet(resetText[0]) + '" — resets shared server state'); }
  if (clockText) { barrier = true; add(GLOBAL_KEY, 'exclusive', 'inferred', '"' + snippet(clockText[0]) + '" — changes the server clock'); }
  const firstCreate = targets.findIndex((t) => t.kind === 'create');
  const firstOther = targets.findIndex((t) => t.kind !== 'create');
  const own = mode === 'creates' || (firstCreate >= 0 && (firstOther < 0 || firstCreate < firstOther));
  if (mode !== 'read-only' && GLOBAL_SETTINGS.test(all)) {
    barrier = true;
    add(GLOBAL_KEY, 'exclusive', source, 'changes a global setting — every other test may read it');
  } else if (mode !== 'read-only') {
    const named = targets.filter((t) => t.noun);
    for (const t of named) {
      entities.push(t.noun);
      // a token names an EXISTING TEST-DATA record: changing it is never "its own record", and it is a write on that
      // record too — so a TC that only reads [D3] is kept apart from the one that edits [D3]
      const ownT = t.kind === 'create' ? own : own && !t.tokens.length;
      const key = 'col:' + t.noun + (t.tokens.length ? '@' + t.tokens[0] : '');
      add(key, 'write', source, 'step ' + t.step + ': "' + snippet(t.text) + '"' + (ownT ? ' — its own record' : ''), ownT ? { own: true } : {});
      if (!ownT && t.kind !== 'create' && t.tokens.length) add('rec:' + t.tokens[0], 'write', source, 'step ' + t.step + ': changes the data item [' + t.tokens[0] + ']');
    }
    if (!named.length) {
      const n = shared ? sharedNoun(shared) : null;
      if (n) add('col:' + n, 'write', source, 'Data effect ' + mode + ' on the shared ' + n, own ? { own: true } : {});
      else {
        const items = sortU(steps.flatMap(dTokens));
        if (items.length) for (const d of items) add('rec:' + d, 'write', source, 'Data effect ' + mode + ' on the data item [' + d + ']');
        else add(GLOBAL_KEY, 'exclusive', 'fail-safe', 'Data effect ' + mode + ' names no record it changes — unknown effects run alone');
      }
    }
  }
  // data items read
  for (const d of sortU([...pre, ...steps, oracle, expected].flatMap(dTokens))) if (!claims.some((c) => c.key === 'rec:' + d && c.mode === 'write')) add('rec:' + d, 'read', 'field', 'references [' + d + ']');
  // aggregates — counts, totals, latest, empty states, pagination, search, exports observe records other TCs add
  const aggs = [...steps, expected, oracle].map((s) => ({ s, a: aggregateTargets(s) })).filter((x) => x.a);
  for (const x of aggs) for (const n of x.a.nouns) entities.push(n);
  const tcEntities = sortU(entities);
  for (const x of aggs) {
    const nouns = x.a.nouns.length ? x.a.nouns : tcEntities;
    if (nouns.length) for (const n of nouns) add('col:' + n + (x.a.tokens.length ? '@' + x.a.tokens[0] : ''), 'aggregate-read', 'inferred', '"' + snippet(x.s) + '"');
    else add('col:*' + (x.a.tokens.length ? '@' + x.a.tokens[0] : ''), 'aggregate-read', 'fail-safe', '"' + snippet(x.s) + '" — the collection it aggregates over is not named');
  }
  // background effects it observes (writers are attached per unit once every reader is known)
  const observed = plain([...steps, expected, oracle].join('\n'));
  const bgReads = [];
  for (const [effect, re] of BG_EFFECTS) {
    if (!re.test(observed)) continue;
    for (const scope of tcEntities.length ? tcEntities : ['*']) { add('bg:' + effect + '@' + scope, 'aggregate-read', 'inferred', 'observes the ' + effect + ' effect'); bgReads.push('bg:' + effect + '@' + scope); }
  }
  // 3.0 — [API] / [DB] lines: their own claims, from the mapping; an unproven data change runs alone
  const backendLines = [...steps, ...fieldItems(tc, 'Expected Result')].filter((s) => /^\s*\[(API|DB)\]/.test(String(s || '')));
  const layer = backendLines.length ? tcLayer(tc).layer : 'ui';
  if (backendLines.length) for (const c of markerClaims(steps, mapping, fieldItems(tc, 'Expected Result'))) {
    if (!claims.some((x) => x.key === c.key && x.mode === c.mode && !!x.own === !!c.own)) claims.push(c);
    if (c.key === GLOBAL_KEY) barrier = barrier || /DDL/.test(c.evidence);
  }
  const runAlone = claims.some((c) => c.mode === 'exclusive' && (c.source === 'fail-safe' || c.source === 'marker'));
  return { claims, effect: { mode, source }, entities: tcEntities, after, lockout: wrongCred && accounts.length > 0, accounts, barrier, runAlone, bgReads, layer };
}

/* ---------------- learned conflicts ---------------- */

function learnedFromLearning(text, file, hashes) {
  const out = [];
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    if (!/^\s*[-*]\s/.test(line) || !/\[type:\s*env\]/i.test(line) || !INTERFERENCE.test(line)) return;
    const tcs = sortU([...line.matchAll(TC_RE)].map((m) => m[0]));
    if (!tcs.length) return;
    const stated = {};
    for (const m of line.matchAll(/\b(TC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\s*\(\s*(?:hash\s*)?([0-9a-fA-F]{8,64})\s*\)/g)) stated[m[1]] = m[2].toLowerCase();
    const changed = Object.entries(stated).filter(([tc, h]) => hashes[tc] && !hashes[tc].startsWith(h)).map(([tc]) => tc).sort(natural);
    out.push({ id: 'L' + (out.length + 1), source: 'learning', file, line: i + 1, tcs, stated, changed, status: changed.length ? 'revalidate' : 'honoured', text: snippet(line.trim()) });
  });
  return out;
}

function learnedFromRunFiles(runs, hashes) {
  const out = [];
  for (const r of runs) {
    for (const pc of (r.json && Array.isArray(r.json.parallel_checks) ? r.json.parallel_checks : [])) {
      if (!pc || pc.outcome !== 'interference' || !pc.tc) continue;
      const tcs = sortU([pc.tc, ...(pc.overlapped || []).map((x) => (typeof x === 'string' ? x : x && x.tc)).filter(Boolean)]);
      const stated = pc.tc_hashes && typeof pc.tc_hashes === 'object' ? pc.tc_hashes : {};
      const changed = Object.entries(stated).filter(([tc, h]) => hashes[tc] && !hashes[tc].startsWith(String(h).toLowerCase())).map(([tc]) => tc).sort(natural);
      out.push({ id: 'R' + (out.length + 1), source: 'run-file', file: r.name, phase: r.json.phase ?? null, tcs, stated, changed, status: changed.length ? 'revalidate' : 'honoured', cause: pc.cause || null });
    }
  }
  return out;
}

/* ---------------- code structure ---------------- */

const HOOK_KINDS = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);
const TEST_MODS = new Set(['only', 'skip', 'fixme', 'fail', 'slow']);
const READ_VERBS = new Set(['get', 'find', 'list', 'fetch', 'load', 'read', 'search', 'count', 'wait', 'exists', 'has', 'is', 'check', 'expect', 'verify', 'open', 'goto', 'navigate', 'build', 'make', 'to', 'from', 'parse', 'format']);
const WRITE_METHOD_RE = /([A-Za-z_$][\w$]*)\s*\.\s*(create|add|delete|remove|update|edit|save|submit|approve|reject|upload|import|assign|seed|reset|insert|provision|ensure)(\w*)\s*\(/g;
// bare collection-style verbs (Set.add, Map.delete, …) count only with a noun suffix (createOrder, deleteCatalog)
const BARE_AMBIGUOUS = new Set(['create', 'add', 'delete', 'remove', 'update', 'reset', 'insert', 'seed', 'ensure', 'provision']);
const API_WRITE_RE = /\b(request|api|apiContext|apiRequest|context|client|http)\s*\.\s*(post|put|patch|delete)\s*\(/g;
const LOGIN_RE = /\.\s*(login|logIn|signIn|signin|signInAs|loginAs)\s*\(/;
const BUILTIN_FIXTURES = new Set(['page', 'context', 'browser', 'browserName', 'request', 'playwright', 'baseURL', 'headless', 'viewport', 'channel', 'isMobile', 'hasTouch', 'locale', 'timezoneId', 'storageState', 'trace', 'video', 'screenshot', 'testIdAttribute', 'javaScriptEnabled', 'userAgent', 'colorScheme', 'deviceScaleFactor', 'extraHTTPHeaders', 'geolocation', 'httpCredentials', 'ignoreHTTPSErrors', 'offline', 'permissions', 'proxy', 'acceptDownloads', 'bypassCSP', 'launchOptions', 'contextOptions', 'connectOptions', 'actionTimeout', 'navigationTimeout', 'serviceWorkers']);
const ADMISSION_FIXTURES = new Set(['workerAdmission', 'unitAdmission']);

const skipWs = (code, i, end = code.length) => { while (i < end && /\s/.test(code[i])) i++; return i; };

/** createOrder → order · deleteOrdersByPrefix → order · seed → null. */
function entityOfName(name) {
  const words = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$]+/g, ' ').toLowerCase().split(/\s+/).filter(Boolean);
  const rest = [];
  for (const w of words.slice(1)) { if (/^(by|for|with|from|to|of|in|on|and|or|if|when|via|as)$/.test(w)) break; rest.push(w); }
  const n = rest.length ? singular(rest[rest.length - 1]) : null;
  return n && !STOP_NOUNS.has(n) ? n : null;
}

function entityOfUrl(u) {
  const segs = String(u || '').split(/[?#]/)[0].split('/').filter(Boolean).filter((x) => !/^(api|v\d+|\$\{.*\}|\{.*\}|:\w+|\d+|[0-9a-f-]{16,})$/i.test(x));
  const n = segs.length ? singular(segs[segs.length - 1].toLowerCase().replace(/[^a-z-]/g, '')) : null;
  return n && n.length > 2 && !STOP_NOUNS.has(n) ? n : null;
}

/** The first string literal among a call's top-level arguments. */
function stringArg(s, open) {
  const close = matchDelim(s.code, open);
  if (close < 0) return null;
  for (const [a, b] of splitArgs(s.code, open, close)) {
    const at = skipWs(s.code, a, b);
    const lit = s.strAt.get(at);
    if (lit && !lit.value.includes('${')) return lit.value;
  }
  return null;
}

/** Side effects of a code range: provisioning calls, API writes, mutating page-object methods, sign-ins. */
function sideEffects(s, start, end, imports) {
  const code = s.code.slice(start, end);
  const writes = [];
  const lineAt = (i) => s.lineOf(start + i);
  for (const [local, info] of imports) {
    if (!info || !/prerequest/i.test(info.spec)) continue;
    const re = new RegExp('(^|[^\\w$.])' + esc(local) + '\\s*\\(', 'g');
    for (const m of code.matchAll(re)) {
      const verb = local.replace(/([a-z0-9])([A-Z]).*/, '$1').toLowerCase();
      if (READ_VERBS.has(verb)) continue;
      const open = start + m.index + m[0].length - 1;
      writes.push({ entity: entityOfName(local), literal: stringArg(s, open), evidence: local + '() — ' + info.spec, line: lineAt(m.index) });
    }
  }
  for (const m of code.matchAll(API_WRITE_RE)) {
    const open = start + m.index + m[0].length - 1;
    const url = stringArg(s, open);
    writes.push({ entity: url ? entityOfUrl(url) : null, literal: null, evidence: m[1] + '.' + m[2] + '(' + (url ? "'" + url + "'" : '…') + ')', line: lineAt(m.index) });
  }
  if (/\bfetch\s*\(/.test(code) && /method\s*:\s*['"`](post|put|patch|delete)/i.test(s.src.slice(start, end))) writes.push({ entity: null, literal: null, evidence: 'fetch() with a writing method', line: lineAt(code.search(/\bfetch\s*\(/)) });
  for (const m of code.matchAll(WRITE_METHOD_RE)) {
    if (!m[3] && BARE_AMBIGUOUS.has(m[2])) continue;
    if (/^(request|api|apiContext|apiRequest|context|client|http)$/.test(m[1]) && /^(delete)$/.test(m[2]) && !m[3]) continue;
    const name = m[2] + m[3];
    const open = start + m.index + m[0].length - 1;
    if (writes.some((w) => w.line === lineAt(m.index) && w.evidence.startsWith(name))) continue;
    const receiver = singular(m[1].replace(/Page$|Po$|Api$|Client$/, '').toLowerCase());
    const entity = entityOfName(name) || (receiver.length > 2 && !STOP_NOUNS.has(receiver) && !['this', 'page', 'self'].includes(receiver) ? receiver : null);
    writes.push({ entity, literal: stringArg(s, open), evidence: m[1] + '.' + name + '()', line: lineAt(m.index) });
  }
  const login = LOGIN_RE.test(code);
  const own = /\b(uniqueName|runPrefix|uniqueCode)\s*\(/.test(code);
  // setup code (hooks, fixtures, global setup): a destructive reset or a server-clock change is shared server state; a reset
  // of a receiver that cannot be placed counts too (unresolved shared setup is never parallel-ready)
  const shared = sharedStateSites(s, start, end, { setup: true });
  return { has: writes.length > 0 || login || shared.length > 0, writes, login, own, shared, calls: [...callNames(code)] };
}

/* ---------------- shared server state: destructive resets and the server / global clock ----------------
   A test that resets the database / environment or moves the SERVER clock changes what every other test sees: it is a
   barrier (runs alone). Found by URL path in HTTP calls (request / api / fetch / axios — `/dev/reset`, `/dev/clock`, …),
   by reset / truncate / restore calls on a data receiver (db, api, client, …Api, …Db, …Repository) and by name
   (resetDatabase(), truncateAll()), in the test, its hooks and fixtures, global setup, and — through the import closure —
   inside helper / page-object functions the test calls. NOT shared: the browser's own clock (page.clock, context.clock,
   fake timers) and data the run owns (an argument built from runPrefix() / uniqueName()). */
const RESET_URL_RE = /\/(?:reset|reseed|re-seed|seed-reset|wipe|purge|truncate|restore|clear-all|clearall|factory-reset|reset-all|reset-db|reset-data|cleanup-all)(?:[/?#'"`]|$)/i;
const CLOCK_URL_RE = /\/(?:clock|time-travel|timetravel|system-time|systemtime|set-time|settime|freeze-time|fake-time|server-time|now)(?:[/?#'"`]|$)/i;
const HTTP_CALL_RE = /\b(request|api|apiContext|apiRequest|context|client|http|axios|server|admin|adminApi|testApi|devApi)\s*\.\s*(post|put|patch|delete|get|fetch)\s*\(|(^|[^\w$.])(fetch)\s*\(/g;
const RESET_CALL_RE = /([A-Za-z_$][\w$]*)\s*\.\s*(reset|truncate|wipe|purge|restore|clearAll|reseed|resetAll|resetDatabase|resetDb|resetData|restoreSnapshot|truncateAll|truncateTables)\s*\(/g;
const RESET_FN_RE = /(^|[^\w$.])(reset(?:Database|Db|Data|All|Environment|Env|Tenant|Server|Backend|State)|truncate(?:All|Tables|Database|Db)?|wipe(?:All|Data|Database|Db)?|purge(?:All|Data)?|restore(?:Database|Db|Snapshot)|reseed(?:All|Database|Db)?)\s*\(/g;
const CLOCK_CALL_RE = /([A-Za-z_$][\w$]*)\s*\.\s*(setSystemTime|setTime|advanceTime|travel|timeTravel|freezeTime|setClock|setDate|setNow|setServerTime)\s*\(/g;
const SQL_CALL_RE = /([A-Za-z_$][\w$]*)\s*\.\s*(query|execute|exec|raw|run|none|any|many)\s*\(/g;
const BROWSER_CLOCK_RECV = /^(page|context|clock|browserContext|sinon|jest|vi|fakeTimers|timers|fake)$/i;
const DATA_RECV = /^(db|database|api|apiClient|client|request|apiContext|apiRequest|http|backend|server|admin|adminApi|testApi|devApi|data|seeder|seed|tenant|sql|knex|prisma|pool|conn|connection|dataLedger)$|(Api|Client|Db|Database|Repository|Repo|Seeder|Store|Server|Backend)$/;
const OWN_ARG_RE = /\b(runPrefix|uniqueName|uniqueCode|ownedKeys|owns)\s*\(/;
const CALL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'await', 'typeof', 'new', 'super', 'import', 'require', 'expect', 'test', 'describe', 'step']);
function callNames(code) {
  const out = new Set();
  for (const m of String(code).matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) if (!CALL_KEYWORDS.has(m[1])) out.add(m[1]);
  return out;
}
/** Shared-state sites in a code range: [{ kind: reset | clock, scope: shared | unknown, evidence, line }]. */
export function sharedStateSites(s, start, end, { setup = false } = {}) {
  const code = s.code.slice(start, end);
  const out = [];
  const lineAt = (i) => s.lineOf(start + i);
  const argsOf = (relIndex, len) => { const open = start + relIndex + len - 1; const close = matchDelim(s.code, open); return close < 0 ? '' : s.src.slice(open, close + 1); };
  for (const m of code.matchAll(HTTP_CALL_RE)) {
    const arg = argsOf(m.index, m[0].length);
    if (OWN_ARG_RE.test(arg)) continue;
    const verb = m[2] || 'fetch';
    const what = (m[1] ? m[1] + '.' + m[2] : 'fetch') + '(' + ((arg.match(/['"`]([^'"`]*\/[^'"`]*)['"`]/) || [])[1] || '…').slice(0, 60) + ')';
    const writing = verb !== 'get' && (verb !== 'fetch' || /method\s*:\s*['"`](post|put|patch|delete)/i.test(arg) || m[4] !== 'fetch');
    if (RESET_URL_RE.test(arg)) out.push({ kind: 'reset', scope: 'shared', evidence: what + ' resets shared server state', line: lineAt(m.index) });
    else if (CLOCK_URL_RE.test(arg) && writing && (verb !== 'fetch' || /method\s*:\s*['"`](post|put|patch)/i.test(arg))) out.push({ kind: 'clock', scope: 'shared', evidence: what + ' changes the server clock', line: lineAt(m.index) });
  }
  for (const m of code.matchAll(RESET_CALL_RE)) {
    const arg = argsOf(m.index, m[0].length);
    if (OWN_ARG_RE.test(arg)) continue;
    if (DATA_RECV.test(m[1])) out.push({ kind: 'reset', scope: 'shared', evidence: m[1] + '.' + m[2] + '() resets shared data', line: lineAt(m.index) });
    else if (setup && !/^(form|filter|filters|search|page|this|locator|el|element|input|field|state|store|mock|stub|spy|timer|clock)$/i.test(m[1])) out.push({ kind: 'reset', scope: 'unknown', evidence: m[1] + '.' + m[2] + '() in setup code — a reset whose scope cannot be placed', line: lineAt(m.index) });
  }
  for (const m of code.matchAll(RESET_FN_RE)) {
    const arg = argsOf(m.index + m[1].length, m[0].length - m[1].length);
    if (OWN_ARG_RE.test(arg)) continue;
    out.push({ kind: 'reset', scope: 'shared', evidence: m[2] + '() resets shared data', line: lineAt(m.index + m[1].length) });
  }
  for (const m of code.matchAll(CLOCK_CALL_RE)) {
    if (BROWSER_CLOCK_RECV.test(m[1])) continue;   // the browser's / test runner's own clock: per test
    if (DATA_RECV.test(m[1])) out.push({ kind: 'clock', scope: 'shared', evidence: m[1] + '.' + m[2] + '() changes the server clock', line: lineAt(m.index) });
    else if (setup) out.push({ kind: 'clock', scope: 'unknown', evidence: m[1] + '.' + m[2] + '() in setup code — a clock whose owner cannot be placed', line: lineAt(m.index) });
  }
  for (const m of code.matchAll(SQL_CALL_RE)) {
    const arg = argsOf(m.index, m[0].length);
    if (OWN_ARG_RE.test(arg)) continue;
    if (/\b(truncate\s+(table\s+)?\w|drop\s+(table|schema|database)\b|delete\s+from\s+[\w."]+\s*(;|['"`]|\)))/i.test(arg)) out.push({ kind: 'reset', scope: 'shared', evidence: m[1] + '.' + m[2] + '(' + (arg.match(/\b(truncate|drop|delete\s+from)\b[^'"`]{0,40}/i) || [''])[0] + '…) clears shared data', line: lineAt(m.index) });
  }
  const seen = new Set();
  return out.filter((x) => { const k = x.kind + '|' + x.line + '|' + x.evidence; if (seen.has(k)) return false; seen.add(k); return true; });
}

const sharedFnCache = new Map();
/**
 * The functions of one module (helper, fixture, page object) whose body — directly or through another function of the same
 * module — changes shared server state, and the sites at module level (they run on import). → { fns: Map(name → site), topLevel[] }
 */
export function sharedStateFns(abs) {
  if (sharedFnCache.has(abs)) return sharedFnCache.get(abs);
  const res = { fns: new Map(), topLevel: [] };
  sharedFnCache.set(abs, res);
  const s = strippedFile(abs);
  if (!s || s.parseError) return res;
  const bodies = [];
  const heads = [
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*\*?\s*[A-Za-z_$]*\s*\(|\([^()]*\)\s*(?::\s*[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/g,
    /^[ \t]*(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\{/gm,
  ];
  for (const re of heads) for (const m of s.code.matchAll(re)) {
    if (CALL_KEYWORDS.has(m[1]) || /^(constructor|get|set)$/.test(m[1])) continue;
    const open = s.code.indexOf('{', m.index + m[0].length - 1);
    if (open < 0 || open - (m.index + m[0].length) > 400) continue;
    const close = matchDelim(s.code, open);
    if (close < 0) continue;
    bodies.push({ name: m[1], start: open, end: close });
  }
  for (const b of bodies) { const sites = sharedStateSites(s, b.start, b.end, { setup: false }); if (sites.length) res.fns.set(b.name, sites[0]); }
  // a function calling one that changes shared state changes it too (fixpoint, same module)
  for (let changed = true; changed;) {
    changed = false;
    for (const b of bodies) {
      if (res.fns.has(b.name)) continue;
      const calls = callNames(s.code.slice(b.start, b.end));
      for (const [n, site] of res.fns) if (calls.has(n)) { res.fns.set(b.name, { ...site, evidence: b.name + '() → ' + n + '(): ' + site.evidence }); changed = true; break; }
    }
  }
  // module level (outside every function body): runs on import
  const inside = (i) => bodies.some((b) => i > b.start && i < b.end);
  for (const site of sharedStateSites(s, 0, s.code.length, { setup: false })) {
    const idx = s.code.split('\n').slice(0, site.line - 1).join('\n').length + 1;
    if (!inside(idx)) res.topLevel.push(site);
  }
  return res;
}

/** Destructured parameter names of the first parameter of the function starting at `a` (async / function / arrow). */
function firstParamNames(code, a, b) {
  let k = skipWs(code, a, b);
  if (code.startsWith('async', k) && !/[\w$]/.test(code[k + 5] || '')) k = skipWs(code, k + 5, b);
  if (code.startsWith('function', k)) { k = skipWs(code, k + 8, b); while (k < b && /[\w$*]/.test(code[k])) k++; k = skipWs(code, k, b); }
  if (code[k] !== '(') return { names: [], open: -1 };
  const pc = matchDelim(code, k);
  if (pc < 0) return { names: [], open: k };
  const params = splitArgs(code, k, pc);
  if (!params.length) return { names: [], open: k, close: pc };
  const p0 = skipWs(code, params[0][0], params[0][1]);
  if (code[p0] !== '{') return { names: [], open: k, close: pc };
  const pe = matchDelim(code, p0);
  const names = [];
  for (const [x, y] of splitArgs(code, p0, pe)) {
    const seg = code.slice(x, y).trim();
    if (seg.startsWith('...')) continue;
    const m = /^([A-Za-z_$][\w$]*)/.exec(seg);
    if (m) names.push(m[1]);
  }
  return { names, open: k, close: pc };
}

/** Body range of the function expression in [a, b): an arrow with a block, or a function. */
function fnBody(code, a, b) {
  const arrow = code.indexOf('=>', a);
  if (arrow >= 0 && arrow < b) {
    const k = skipWs(code, arrow + 2, b);
    if (code[k] === '{') { const e = matchDelim(code, k); return e > 0 ? { start: k + 1, end: e } : null; }
    return { start: k, end: b };
  }
  const p = code.indexOf('(', a);
  const pc = p >= 0 ? matchDelim(code, p) : -1;
  const brace = pc > 0 ? code.indexOf('{', pc) : -1;
  if (brace >= 0 && brace < b) { const e = matchDelim(code, brace); return e > 0 ? { start: brace + 1, end: e } : null; }
  return null;
}

function strippedFile(abs) {
  const src = read(abs);
  if (src === null) return null;
  const s = stripSource(src);
  s.src = src;
  s.strAt = new Map(s.strings.map((t) => [t.start, t]));
  return s;
}

/** Every test.extend({...}) fixture of a code file: name, scope, auto, dependencies and side effects. */
function fixtureDefs(abs, root) {
  const s = strippedFile(abs);
  if (!s || s.parseError || !/\.\s*extend\b/.test(s.code)) return [];
  const imports = importMap(s, abs);
  const out = [];
  for (const m of s.code.matchAll(/\.\s*extend\s*/g)) {
    let i = m.index + m[0].length;
    if (s.code[i] === '<') {
      let depth = 0, k = i;
      for (; k < s.code.length; k++) {
        const c = s.code[k];
        if (c === '<') depth++;
        else if (c === '>' && s.code[k - 1] !== '=') { depth--; if (depth === 0) break; }
        else if (c === '{' || c === '(' || c === '[') { const e = matchDelim(s.code, k); if (e < 0) break; k = e; }
      }
      i = skipWs(s.code, k + 1);
    }
    if (s.code[i] !== '(') continue;
    const close = matchDelim(s.code, i);
    if (close < 0) continue;
    const args = splitArgs(s.code, i, close);
    if (!args.length) continue;
    const o = skipWs(s.code, args[0][0], args[0][1]);
    if (s.code[o] !== '{') continue;
    const oc = matchDelim(s.code, o);
    if (oc < 0) continue;
    for (const [pa0, pb] of splitArgs(s.code, o, oc)) {
      const pa = skipWs(s.code, pa0, pb);
      let name = null, valueAt = -1, method = false;
      const mm = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(s.code.slice(pa, pb));
      const pm = /^([A-Za-z_$][\w$]*)\s*:/.exec(s.code.slice(pa, pb));
      if (pm) { name = pm[1]; valueAt = skipWs(s.code, pa + pm[0].length, pb); }
      else if (s.strAt.get(pa)) { const lit = s.strAt.get(pa); name = lit.value; const colon = s.code.indexOf(':', lit.end); if (colon > 0 && colon < pb) valueAt = skipWs(s.code, colon + 1, pb); }
      else if (mm) { name = mm[1]; valueAt = pa + mm[0].length - 1; method = true; }   // method shorthand: valueAt = its '('
      if (!name || valueAt < 0) continue;
      let fnA = valueAt, fnB = pb, scope = 'test', auto = false;
      if (!method && s.code[valueAt] === '[') {
        const be = matchDelim(s.code, valueAt);
        const els = be > 0 ? splitArgs(s.code, valueAt, be) : [];
        if (els.length) { fnA = els[0][0]; fnB = els[0][1]; }
        if (els.length > 1) {
          const opt = s.src.slice(els[1][0], els[1][1]);
          if (/scope\s*:\s*['"]worker['"]/.test(opt)) scope = 'worker';
          if (/auto\s*:\s*true/.test(opt)) auto = true;
        }
      }
      const params = firstParamNames(s.code, fnA, fnB);
      let body = null;
      if (method) {
        const br = params.close > 0 ? s.code.indexOf('{', params.close) : -1;
        const e = br >= 0 && br < pb ? matchDelim(s.code, br) : -1;
        body = e > 0 ? { start: br + 1, end: e } : null;
      } else body = fnBody(s.code, fnA, fnB);
      const effects = body ? sideEffects(s, body.start, body.end, imports) : { has: false, writes: [], login: false, own: false };
      out.push({ file: rel(root, abs), name, scope, auto, deps: params.names, line: s.lineOf(pa), effects, admission: ADMISSION_FIXTURES.has(name) });
    }
  }
  return out;
}

/** Is the code position inside a loop (for / while / forEach / map) below `floor`? */
function insideLoop(code, at, floor) {
  let depth = 0;
  for (let p = at - 1; p >= floor; p--) {
    const c = code[p];
    if (c === '}' || c === ')' || c === ']') { depth++; continue; }
    if (c !== '{' && c !== '(' && c !== '[') continue;
    if (depth > 0) { depth--; continue; }
    const before = code.slice(Math.max(floor, p - 40), p);
    if (c === '(' && /\.\s*(forEach|map|flatMap)\s*$/.test(before)) return true;
    if (c === '{') {
      const q = before.replace(/\s+$/, '');
      if (q.endsWith(')')) {
        let d = 0, k = p - 1;
        while (k >= floor && /\s/.test(code[k])) k--;
        for (; k >= floor; k--) { if (code[k] === ')') d++; else if (code[k] === '(') { d--; if (d === 0) break; } }
        if (k >= floor && /\b(for|while)\s*$/.test(code.slice(Math.max(floor, k - 12), k))) return true;
      }
    }
  }
  return false;
}

/** Structure of one spec file: tests (with their describe chain, tags, dynamic flag), describes, hooks, serial marks. */
function scanSpec(abs, root) {
  const file = rel(root, abs);
  const s = strippedFile(abs);
  if (!s) return { file, parseError: 'unreadable', tests: [], describes: [], fileHooks: [], fileSerial: false, imports: new Map(), thirdParty: null };
  if (s.parseError) return { file, parseError: s.parseError, tests: [], describes: [], fileHooks: [], fileSerial: false, imports: new Map(), thirdParty: null };
  const imports = importMap(s, abs);
  const ids = testIdentifiers(s).ids;
  const blocks = findBlocks(s, ids);
  const titleOf = (b) => { if (!b.args.length) return null; const at = skipWs(s.code, b.args[0][0], b.args[0][1]); const lit = s.strAt.get(at); return lit ? { text: lit.value, template: lit.quote === '`' } : null; };
  const isDescribe = (b) => b.body && b.chain[0] === 'describe' && !b.chain.includes('configure');
  const isHook = (b) => b.body && HOOK_KINDS.has(b.chain[0]);
  const isTest = (b) => b.body && (b.chain.length === 0 || (b.chain.length === 1 && TEST_MODS.has(b.chain[0]))) && titleOf(b) !== null;
  const anc = (b) => { let p = b.parent; while (p && !isDescribe(p)) p = p.parent; return p; };
  const describes = blocks.filter(isDescribe).map((b) => ({ b, title: normTitle((titleOf(b) || {}).text) || '(anonymous)', serial: b.chain.includes('serial'), hooks: [], line: b.line }));
  const dOf = new Map(describes.map((d) => [d.b, d]));
  for (const d of describes) { const path = []; for (let p = d.b; p; p = anc(p)) path.unshift(dOf.get(p).title); d.path = path; d.pathKey = path.join(' > '); }
  let fileSerial = false;
  for (const m of s.code.matchAll(/\bdescribe\s*\.\s*configure\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchDelim(s.code, open);
    if (close < 0 || !/mode\s*:\s*['"]serial['"]/.test(s.src.slice(open, close))) continue;
    let owner = null;
    for (const d of describes) if (d.b.body.start <= m.index && m.index < d.b.body.end && (!owner || d.b.headStart > owner.b.headStart)) owner = d;
    if (owner) owner.serial = true; else fileSerial = true;
  }
  const fileHooks = [];
  for (const b of blocks.filter(isHook)) {
    const fnArg = b.args.find(([a, c]) => a <= b.body.start && b.body.start <= c) || b.args[b.args.length - 1];
    const params = firstParamNames(s.code, fnArg[0], fnArg[1]).names;
    const h = { kind: b.chain[0], line: b.line, params, effects: sideEffects(s, b.body.start, b.body.end, imports), file };
    const d = anc(b);
    if (d) dOf.get(d).hooks.push(h); else fileHooks.push(h);
  }
  const tests = [];
  for (const b of blocks.filter(isTest)) {
    const t = titleOf(b);
    const chain = [];
    for (let p = anc(b); p; p = anc(p)) chain.unshift(dOf.get(p));
    const head = s.src.slice(b.open, b.body.start);
    const tags = sortU([...head.matchAll(/@(smoke|positive|negative)\b/g)].map((m) => m[1]));
    const floor = chain.length ? chain[chain.length - 1].b.body.start : 0;
    const dynamic = t.template && t.text.includes('${') ? 'the title is built at run time' : insideLoop(s.code, b.headStart, floor) ? 'the test is declared inside a loop' : null;
    const literals = [];
    for (const m of s.code.slice(b.body.start, b.body.end).matchAll(/(^|[^\w$])(create|add|seed)(\w*)\s*\(/g)) {
      const open = b.body.start + m.index + m[0].length - 1;
      const lit = stringArg(s, open);
      if (lit) literals.push({ entity: entityOfName(m[2] + m[3]) || 'record', literal: lit, line: s.lineOf(open) });
    }
    tests.push({ file, title: normTitle(t.text), rawTitle: t.text, describe: chain.map((d) => d.title), chain, line: b.line, tags, dynamic, literals, start: b.headStart,
      // shared server state changed in the test body itself, and the functions it calls (matched against the closure)
      shared: sharedStateSites(s, b.body.start, b.body.end, { setup: false }), calls: [...callNames(s.code.slice(b.body.start, b.body.end))] });
  }
  const tb = imports.get('test');
  const thirdParty = tb && tb.bare && tb.spec !== '@playwright/test' ? tb.spec : null;
  return { file, parseError: null, tests, describes, fileHooks, fileSerial, imports, thirdParty };
}

/** Global setup / teardown and setup projects of the shared config(s): side effects every child repeats. */
function globalSetupOf(root) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(root).filter((e) => /^playwright.*\.config\.(ts|mts|cts|js|mjs|cjs)$/i.test(e)).sort(natural); } catch { /* no listing */ }
  for (const e of entries) {
    const abs = path.join(root, e);
    const s = strippedFile(abs);
    if (!s || s.parseError) continue;
    for (const m of s.code.matchAll(/\bglobal(Setup|Teardown)\s*:/g)) {
      const at = skipWs(s.code, m.index + m[0].length);
      let lit = s.strAt.get(at);
      if (!lit) { const rq = /^require\s*\.\s*resolve\s*\(\s*/.exec(s.code.slice(at, at + 40)); if (rq) lit = s.strAt.get(at + rq[0].length); }
      const target = lit ? [path.resolve(root, lit.value), ...['.ts', '.js', '.mjs', '.cjs', '.mts'].map((x) => path.resolve(root, lit.value + x))].find(isFile) : null;
      let effects = { has: true, writes: [{ entity: null, evidence: 'global' + m[1] + ' (file not resolved)' }], login: false, own: false };
      if (target) { const t = strippedFile(target); if (t && !t.parseError) effects = sideEffects(t, 0, t.code.length, importMap(t, target)); }
      out.push({ config: e, kind: 'global' + m[1], file: target ? rel(root, target) : (lit ? lit.value : null), effects });
    }
    if (/\bdependencies\s*:\s*\[/.test(s.code)) out.push({ config: e, kind: 'setup project', file: null, effects: { has: true, writes: [{ entity: null, evidence: 'a setup project other projects depend on' }], login: false, own: false } });
  }
  return out.filter((g) => g.effects.has);
}

/** Claims of code side effects (hooks, fixtures, global setup). */
function effectClaims(effects, where) {
  const out = [];
  for (const w of effects.writes || []) {
    if (w.entity) {
      out.push({ key: 'col:' + w.entity, mode: 'write', ...(effects.own ? { own: true } : {}), source: 'inferred', evidence: where + ': ' + w.evidence + (w.line ? ' (line ' + w.line + ')' : '') });
      if (w.literal && !effects.own) out.push({ key: 'rec:lit:' + w.entity + ':' + w.literal.toLowerCase(), mode: 'write', source: 'inferred', evidence: where + ': creates the fixed record "' + w.literal + '"' });
    } else out.push({ key: GLOBAL_KEY, mode: 'exclusive', source: 'fail-safe', evidence: where + ': ' + w.evidence + ' — what it changes cannot be bounded' });
  }
  // shared server state (a reset, the server clock): a barrier; a reset whose scope cannot be placed: run alone (fail safe)
  for (const sh of effects.shared || []) out.push({ key: GLOBAL_KEY, mode: 'exclusive', source: sh.scope === 'unknown' ? 'fail-safe' : 'inferred', evidence: where + ': ' + sh.evidence + (sh.line ? ' (line ' + sh.line + ')' : '') });
  return out;
}

const dedupeClaims = (claims) => {
  const seen = new Set();
  const out = [];
  for (const c of claims) { const k = c.key + '|' + c.mode + '|' + (c.own ? 1 : 0); if (seen.has(k)) continue; seen.add(k); out.push(c); }
  return out;
};

/* ---------------- the plan ---------------- */

function applyMoves(plan, adjustments) {
  const p = JSON.parse(JSON.stringify(plan));
  for (const a of adjustments || []) {
    if (!a || a.kind !== 'move' || !a.tc || !a.to) continue;
    for (const g of p.groups) g.tcs = (g.tcs || []).filter((x) => x !== a.tc);
    let to = p.groups.find((g) => g.name === a.to);
    if (!to) { to = { name: a.to, mode: 'serial', workers: 1, tcs: [] }; p.groups.push(to); }
    to.tcs.push(a.tc);
  }
  return p;
}

function groupNameOf(key) {
  const k = parseKey(key);
  if (k.kind === 'acct') return 'account:' + k.name;
  if (k.kind === 'col') return 'serial:' + slug(k.name === '*' ? 'aggregate' : k.name);
  if (k.kind === 'shared') return 'serial:' + k.name;
  if (k.kind === 'learned') return 'serial:learned';
  if (k.kind === 'bg') return 'serial:' + slug(k.name + '-' + (k.scope || 'all'));
  if (k.kind === 'rec') return 'serial:' + slug(k.name.startsWith('lit:') ? k.name.split(':')[1] : k.name);
  return 'serial:' + slug(key);
}

/**
 * What the readiness verdict depends on, part by part — run-stage.mjs recomputes it at every call and re-plans (or runs
 * serially) when any part differs. code: impact.mjs's per-test fingerprints of the scanned specs (the reached helpers,
 * page objects, fixtures, timeouts.ts, config, Playwright version and data files are their parts) · tcs: every TC's
 * tc-hash · data: the TEST-DATA file · learning: the learning file (learned interference) · runPlan: the run plan with
 * its adjustments · environment: the environment id of the lease. A part that cannot be computed is `error:…`, which
 * never equals anything (fail safe: stale).
 */
export function readinessFingerprint({ root, specs = [], tc = null, data = null, learning = null, runFile = null, environment = null } = {}) {
  const fileHash = (p) => { if (!p) return null; const t = read(path.resolve(String(p))); return t === null ? 'error:missing ' + posix(String(p)) : sha256(t); };
  let code;
  try {
    const fp = fingerprintTests({ root, specs });
    code = sha256(Object.keys(fp.tests).sort(natural).map((id) => id + '=' + fp.tests[id].fingerprint + (fp.tests[id].unknown.length ? '?' + fp.tests[id].unknown.join(',') : '')).join('\n'));
  } catch (e) { code = 'error:' + (e && e.message ? e.message : e); }
  let tcs = null;
  if (tc) {
    const text = read(path.resolve(String(tc)));
    if (text === null) tcs = 'error:missing ' + posix(String(tc));
    else { const td = parseTestData((data && read(path.resolve(String(data)))) || ''); tcs = sha256(parseTcDocument(text).map((t) => t.id + '=' + tcHash(t, td)).sort(natural).join('\n')); }
  }
  let runPlan = null;
  if (runFile) {
    const j = readJson(path.resolve(String(runFile)));
    runPlan = j && typeof j === 'object' ? sha256(JSON.stringify({ plan: j.run_plan || null, adjustments: j.run_plan_adjustments || [] })) : 'error:run file unreadable';
  }
  // helpers: the CONTENT of every module under {root}/helpers — the verdict depends on helpers no spec imports yet (an
  // installed admission helper switches the contract on) and on a helper a reconcile replaced; presence alone is not enough
  let helpers = null;
  try {
    const dir = path.join(path.resolve(String(root)), 'helpers');
    const files = isDir(dir) ? fs.readdirSync(dir).filter((f) => /\.(m?ts|m?js|cjs|cts)$/.test(f)).sort(natural) : [];
    helpers = sha256(files.map((f) => f + '=' + sha256(read(path.join(dir, f)) || '')).join('\n'));
  } catch (e) { helpers = 'error:' + (e && e.message ? e.message : e); }
  return { specs: sortU(specs.map(String)), code, tcs, data: fileHash(data), learning: fileHash(learning), runPlan, environment: environment || null, helpers };
}

/** The parts of two readiness fingerprints that differ (specs compared as sets; [] = fresh). */
export function fingerprintChanges(a, b) {
  if (!a || !b) return ['fingerprint'];
  const parts = ['specs', 'code', 'tcs', 'data', 'learning', 'runPlan', 'environment', 'helpers'];
  return parts.filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null) || String(a[k] ?? '').startsWith('error:'));
}

/**
 * The readiness check. Every input is optional except `root`; a missing TC document makes every TC run-alone (fail safe).
 */
export function planParallel({ root, specs = [], tc = null, data = null, learning = null, runFile = null, progress = null, stage = null, ceiling = null, compare = false, environment = null, inventory = null } = {}) {
  const base = { tool: 'parallel-plan', schema: SCHEMA_VERSION, mode: compare ? 'shadow' : 'readiness', stage: stage || null };
  const warnings = [];
  const review = [];
  if (!root) return { ...base, outcome: 'BLOCKED', reason: '--root <automation root> is required', warnings };
  const absRoot = path.resolve(String(root));
  if (!isDir(absRoot)) return { ...base, outcome: 'BLOCKED', reason: 'automation root not found: ' + root, warnings };
  if (stage && !STAGES.includes(stage)) return { ...base, outcome: 'BLOCKED', reason: '--stage must be smoke | positive | negative', warnings };
  // ---- inputs
  let tcText = null;
  if (tc) { tcText = read(path.resolve(String(tc))); if (tcText === null) return { ...base, outcome: 'BLOCKED', reason: 'TC document not found: ' + tc, warnings }; }
  else warnings.push('no TC document (--tc): every TC has unknown effects and runs alone (fail safe)');
  let dataPath = data ? path.resolve(String(data)) : null;
  if (!dataPath && tc) { const guess = path.join(path.dirname(path.resolve(String(tc))), path.basename(String(tc)).replace(/^TEST-CASES-/, 'TEST-DATA-')); if (isFile(guess)) dataPath = guess; }
  const dataText = dataPath ? read(dataPath) : null;
  if (data && dataText === null) warnings.push('TEST-DATA not found: ' + data + ' — account notes unknown');
  const testData = parseTestData(dataText || '');
  // 3.0 — the automation inventory's API / DB mapping decides the effect of an [API] call (never the HTTP method)
  const mapping = readMapping(inventory ? path.resolve(root || '.', inventory) : null);
  const docTcs = tcText ? parseTcDocument(tcText) : [];
  const hashes = Object.fromEntries(docTcs.map((t) => [t.id, tcHash(t, testData)]));
  let runJson = null;
  const runs = [];
  if (runFile) {
    const abs = path.resolve(String(runFile));
    runJson = readJson(abs);
    if (runJson === null) return { ...base, outcome: 'BLOCKED', reason: 'run file not found: ' + runFile, warnings };
    if (runJson === undefined) return { ...base, outcome: 'BLOCKED', reason: 'run file is not valid JSON: ' + runFile, warnings };
    let siblings = [];
    try { siblings = fs.readdirSync(path.dirname(abs)).filter((f) => /^phase-\d+\.json$/.test(f)).sort(natural); } catch { /* none */ }
    for (const f of siblings) { const j = path.join(path.dirname(abs), f) === abs ? runJson : readJson(path.join(path.dirname(abs), f)); if (j && typeof j === 'object') runs.push({ name: f, json: j }); }
  }
  const plan = runJson && (runJson.run_plan || (Array.isArray(runJson.groups) ? runJson : null));
  const runPlan = plan ? applyMoves({ groups: [], ...plan, groups: Array.isArray(plan.groups) ? plan.groups : [] }, runJson.run_plan_adjustments) : null;
  // durations — every phase file's results[] and the current progress folder's incremental results
  const durations = new Map();
  const addDur = (tcId, ms) => { if (typeof ms !== 'number' || !(ms >= 0)) return; if (!durations.has(tcId)) durations.set(tcId, []); durations.get(tcId).push(ms); };
  for (const r of runs) for (const row of Array.isArray(r.json.results) ? r.json.results : []) if (row && row.tc_id) addDur(row.tc_id, row.duration_ms);
  if (progress && isDir(path.resolve(String(progress)))) {
    const dir = path.resolve(String(progress));
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.results.jsonl')).sort(natural)) {
      for (const line of (read(path.join(dir, f)) || '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o && Array.isArray(o.tc) && o.status !== 'skipped') for (const t of o.tc) addDur(t, o.duration_ms);
      }
    }
  }
  const expectedOf = (tcId) => median(durations.get(tcId) || []);
  // readiness skips
  const skipped = new Map();
  for (const g of (runJson && runJson.data_readiness && Array.isArray(runJson.data_readiness.gaps) ? runJson.data_readiness.gaps : [])) {
    if (!g || !/^skip/i.test(String(g.decision || ''))) continue;
    const list = Array.isArray(g.tcs) ? g.tcs : String(g.tcs || '').split(/[,\s]+/);
    for (const t of list.map(String).filter((x) => /^TC-/.test(x))) skipped.set(t, 'readiness: ' + g.decision);
  }
  // ---- code
  let closure;
  try { closure = closureOf({ root: absRoot, specs, runPlan }); } catch (e) { return { ...base, outcome: 'BLOCKED', reason: 'impact.mjs could not read the automation root: ' + (e && e.message ? e.message : e), warnings }; }
  for (const w of closure.warnings) if (!warnings.includes(w)) warnings.push(w);
  const specFiles = sortU(Object.values(closure.tests).map((t) => t.file));
  const scans = new Map(specFiles.map((f) => [f, scanSpec(path.join(absRoot, f), absRoot)]));
  const defs = walk(absRoot, (p) => isCodeFile(p) && /\.\s*extend\b/.test(read(p) || '')).flatMap((f) => fixtureDefs(f, absRoot));
  const defByFileName = new Map(defs.map((d) => [d.file + '#' + d.name, d]));
  const defsByName = new Map();
  for (const d of defs) { if (!defsByName.has(d.name)) defsByName.set(d.name, []); defsByName.get(d.name).push(d); }
  const admissionPresent = ['helpers/admission.ts', 'helpers/admission.js', 'helpers/admission.mts'].some((f) => isFile(path.join(absRoot, f)));
  const globals = globalSetupOf(absRoot);
  for (const g of globals) review.push(g.kind + ' in ' + g.config + (g.file ? ' (' + g.file + ')' : '') + ' has side effects — every child repeats it, so every unit is U4 and units never overlap');
  /** transitive dependency on an admission fixture */
  const dependsOn = (d, target, seen = new Set()) => {
    if (!d || seen.has(d.file + '#' + d.name)) return false;
    seen.add(d.file + '#' + d.name);
    if (d.deps.includes(target)) return true;
    return d.deps.some((n) => (defsByName.get(n) || []).some((x) => dependsOn(x, target, seen)));
  };
  // ---- TCs
  const tcInfo = new Map();
  for (const t of docTcs) {
    const c = tcClaims(t, testData, mapping);
    tcInfo.set(t.id, { id: t.id, title: t.title, docStage: docStage(t), candidate: !/^no\b/i.test(fieldText(t, 'Automation Candidate')), hash: hashes[t.id], ...c });
  }
  // ---- tests (closure ids joined with the structural scan by file · describe path · title · occurrence)
  const tests = [];
  const seenKey = new Map();
  for (const f of specFiles) {
    const sc = scans.get(f);
    if (sc.parseError) warnings.push('spec could not be scanned (' + sc.parseError + '): ' + f + ' — its tests are U4');
    for (const st of sc.tests) {
      const k = f + '::' + st.describe.join(' > ') + '::' + st.title;
      const n = (seenKey.get(k) || 0) + 1;
      seenKey.set(k, n);
      const id = n > 1 ? k + ' #' + n : k;
      const ct = closure.tests[id];
      if (!ct) warnings.push('test not found in the closure (scanned only): ' + id);
      if (!ct || !ct.tcs.length) continue;
      const fixtures = sortU((ct.parts || []).filter((p) => p.startsWith('fixture:')).map((p) => p.slice('fixture:'.length)));
      tests.push({ id, file: f, title: st.title, tcs: ct.tcs, line: st.line, scan: st, spec: sc, fixtures, unknown: ct.unknown || [], files: ct.files || [] });
    }
    if (sc.parseError) for (const [id, ct] of Object.entries(closure.tests)) if (ct.file === f && ct.tcs.length) tests.push({ id, file: f, title: ct.title, tcs: ct.tcs, line: 0, scan: { tags: [], dynamic: 'the spec could not be scanned', chain: [], describe: ct.describe, literals: [] }, spec: sc, fixtures: [], unknown: ct.unknown || [] });
  }
  // TCs of the code that the document does not know
  for (const t of tests) for (const id of t.tcs) if (!tcInfo.has(id)) {
    tcInfo.set(id, { id, title: t.title, docStage: null, candidate: true, hash: null, claims: [{ key: GLOBAL_KEY, mode: 'exclusive', source: 'fail-safe', evidence: 'not in the TC document — its effects are unknown' }], effect: { mode: 'unknown', source: 'fail-safe' }, entities: [], after: [], lockout: false, accounts: [], barrier: false, runAlone: true, bgReads: [] });
    if (tcText) review.push(id + ' has automated tests but is not in the TC document — run alone until it is');
  }
  // stage of each test: its tags, else the document stage of its first TC
  for (const t of tests) {
    const tags = t.scan.tags;
    const fromTags = tags.includes('smoke') ? 'smoke' : tags.includes('negative') ? 'negative' : tags.includes('positive') ? 'positive' : null;
    const docSt = (tcInfo.get(t.tcs[0]) || {}).docStage || null;
    t.stage = fromTags || docSt || 'positive';
    if (fromTags && docSt && fromTags !== docSt) warnings.push(t.tcs.join(',') + ': the code tags say ' + fromTags + ', the TC document says ' + docSt + ' — run-stage selects by the code tags');
  }
  const inStage = stage ? tests.filter((t) => t.stage === stage) : tests;
  // ---- units
  const unitOfKey = new Map();
  const keyOf = (t) => {
    const sc = t.spec;
    if (sc.fileSerial) return { key: 'file:' + t.file, type: 'U2', chain: true, why: 'the whole file is one serial chain (describe.configure mode serial)', describe: null };
    for (const d of t.scan.chain) {
      if (d.serial) return { key: 'describe:' + t.file + '::' + d.pathKey, type: 'U2', chain: true, why: 'serial chain: describe "' + d.title + '"', describe: d.pathKey };
      const shared = d.hooks.filter((h) => (h.kind === 'beforeAll' || h.kind === 'afterAll') && h.effects.has);
      if (shared.length) {
        const chain = t.scan.chain.slice(t.scan.chain.indexOf(d)).some((x) => x.serial);
        return { key: 'describe:' + t.file + '::' + d.pathKey, type: chain ? 'U2' : 'U3', chain, why: 'shared hook: ' + shared.map((h) => h.kind + ' (line ' + h.line + ')').join(', ') + ' in describe "' + d.title + '"', describe: d.pathKey };
      }
    }
    const fileShared = sc.fileHooks.filter((h) => (h.kind === 'beforeAll' || h.kind === 'afterAll') && h.effects.has);
    if (fileShared.length) return { key: 'file:' + t.file, type: 'U3', chain: false, why: 'shared hook: ' + fileShared.map((h) => h.kind + ' (line ' + h.line + ')').join(', ') + ' at file level', describe: null };
    const wf = t.fixtures.map((f) => defByFileName.get(f)).filter((d) => d && d.scope === 'worker' && d.effects.has && !d.admission);
    if (wf.length) return { key: 'wfx:' + t.file, type: 'U3', chain: false, why: 'shared worker fixture: ' + sortU(wf.map((d) => d.name)).join(', '), describe: null, fixtureName: wf[0].name };
    return { key: 'test:' + t.id, type: 'U1', chain: false, why: null, describe: null };
  };
  for (const t of inStage) {
    const k = keyOf(t);
    t.unitKey = k.key;
    if (!unitOfKey.has(k.key)) unitOfKey.set(k.key, { key: k.key, type: k.type, chain: k.chain, describe: k.describe, fixtureName: k.fixtureName || null, tests: [], reasons: k.why ? [k.why] : [] });
    unitOfKey.get(k.key).tests.push(t);
  }
  // order dependencies across units → one chain unit (kept inside one execution unit)
  const parent = new Map([...unitOfKey.keys()].map((k) => [k, k]));
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const unitsOfTc = (id) => [...unitOfKey.values()].filter((u) => u.tests.some((t) => t.tcs.includes(id))).map((u) => u.key);
  const orderDependencies = [];
  for (const [id, info] of tcInfo) {
    for (const pre of info.after || []) {
      const a = unitsOfTc(pre), b = unitsOfTc(id);
      if (!a.length || !b.length) { if (b.length) warnings.push(id + ' depends on ' + pre + ', which has no automated test in this scope'); continue; }
      const dep = { from: pre, to: id, evidence: 'Shared data of ' + id + ': depends on ' + pre, merged: false };
      if (find(a[0]) !== find(b[0])) { for (const x of [...a, ...b]) parent.set(find(x), find(b[0])); dep.merged = true; }
      orderDependencies.push(dep);
    }
  }
  const merged = new Map();
  for (const u of unitOfKey.values()) {
    const r = find(u.key);
    if (!merged.has(r)) merged.set(r, { ...unitOfKey.get(r), tests: [], reasons: [], keys: [] });
    const m = merged.get(r);
    m.tests.push(...u.tests);
    m.reasons.push(...u.reasons);
    m.keys.push(u.key);
    if (u.key !== r) { m.type = 'U2'; m.chain = true; m.describe = null; }
  }
  for (const m of merged.values()) if (m.keys.length > 1) m.reasons.push('order dependency: ' + orderDependencies.filter((d) => d.merged && m.tests.some((t) => t.tcs.includes(d.to))).map((d) => d.from + ' → ' + d.to).join(', ') + ' — kept inside one unit');
  let units = [...merged.values()].map((m) => {
    const ts = m.tests.slice().sort((a, b) => natural(a.file, b.file) || a.line - b.line);
    return { m, ts };
  }).sort((x, y) => natural(x.ts[0].file, y.ts[0].file) || x.ts[0].line - y.ts[0].line).map(({ m, ts }, i) => {
    const tcs = sortU(ts.flatMap((t) => t.tcs));
    const reasons = sortU(m.reasons);
    let type = m.type;
    const u4 = [];
    for (const t of ts) if (t.scan.dynamic) u4.push('dynamic test generation: ' + t.scan.dynamic + ' (' + t.file + ':' + t.line + ')');
    for (const t of ts) if (t.spec.thirdParty) u4.push('third-party test fixtures from ' + t.spec.thirdParty + ' — their effects cannot be read');
    if (globals.length) u4.push('global setup with side effects (' + globals.map((g) => g.kind + ' in ' + g.config).join('; ') + ') — admitted at spawn only');
    if (admissionPresent) {
      const usedDefs = sortU(ts.flatMap((t) => t.fixtures)).map((k) => defByFileName.get(k)).filter(Boolean);
      for (const d of usedDefs) {
        if (d.admission || !d.effects.has) continue;
        const need = d.scope === 'worker' ? 'workerAdmission' : 'unitAdmission';
        if (!dependsOn(d, need)) u4.push('admission contract: ' + d.scope + '-scoped fixture ' + d.name + ' (' + d.file + ') has side effects and does not depend on ' + need);
      }
      const hooks = new Set();
      for (const t of ts) { for (const d of t.scan.chain) for (const h of d.hooks) hooks.add(h); for (const h of t.spec.fileHooks) hooks.add(h); }
      for (const h of hooks) if (h.kind === 'beforeAll' && h.effects.has && !h.params.includes('workerAdmission')) u4.push('admission contract: beforeAll (' + h.file + ':' + h.line + ') has side effects and does not take workerAdmission');
    }
    if (u4.length) type = 'U4';
    for (const x of u4) if (/^(admission contract|third-party)/.test(x)) review.push(tcs.join(', ') + ' → U4 (admitted at spawn only): ' + x);
    return {
      id: 'u' + (i + 1), type, chain: m.chain, stages: sortU(ts.map((t) => t.stage)), spec: ts[0].file, specs: sortU(ts.map((t) => t.file)),
      describePath: m.describe ? m.describe.split(' > ') : null,
      tests: ts.map((t) => ({ title: t.title, tcs: t.tcs, line: t.line, file: t.file })), tcs,
      claims: [], class: null, expectedMs: null,
      selector: { specs: sortU(ts.map((t) => t.file)), describe: m.describe || null, tcs },
      scopes: [], reasons: sortU([...reasons, ...u4]), after: [], _tests: ts, _fixtureName: m.fixtureName,
    };
  });
  // ---- claims per unit: TC claims, learned conflicts, hooks, fixtures, fixed literals, global setup
  const learningText = learning ? read(path.resolve(String(learning))) : null;
  if (learning && learningText === null) warnings.push('learning file not found: ' + learning);
  const learned = [...learnedFromLearning(learningText, learning ? posix(String(learning)) : null, hashes), ...learnedFromRunFiles(runs, hashes)];
  const learnedClaims = new Map();
  const pushL = (tcId, c) => { if (!learnedClaims.has(tcId)) learnedClaims.set(tcId, []); learnedClaims.get(tcId).push(c); };
  for (const l of learned) {
    const note = l.status === 'revalidate' ? ' — revalidate: ' + l.changed.join(', ') + ' changed since it was learned (still honoured)' : '';
    if (l.tcs.length === 1) pushL(l.tcs[0], { key: GLOBAL_KEY, mode: 'exclusive', source: 'learned', evidence: 'learned interference ' + l.id + ' names only this TC — it runs alone' + note });
    else for (const t of l.tcs) pushL(t, { key: 'learned:' + l.id, mode: 'write', source: 'learned', evidence: 'learned interference ' + l.id + ' (' + l.tcs.join(', ') + ')' + note });
    if (l.status === 'revalidate') review.push('learned conflict ' + l.id + ' (' + l.tcs.join(', ') + '): ' + l.changed.join(', ') + ' changed since it was learned — re-check it; it stays honoured');
  }
  const rateLimits = plan && Array.isArray(plan.rate_limits) ? plan.rate_limits.filter((r) => r && r.service) : [];
  for (const u of units) {
    const claims = [];
    for (const id of u.tcs) { const info = tcInfo.get(id); if (info) claims.push(...info.claims); claims.push(...(learnedClaims.get(id) || [])); }
    const hooks = new Set();
    for (const t of u._tests) { for (const d of t.scan.chain) for (const h of d.hooks) hooks.add(h); for (const h of t.spec.fileHooks) hooks.add(h); }
    for (const h of hooks) if (h.effects.has) claims.push(...effectClaims(h.effects, h.kind + ' ' + h.file + ':' + h.line));
    for (const k of sortU(u._tests.flatMap((t) => t.fixtures))) { const d = defByFileName.get(k); if (d && !d.admission && d.effects.has) claims.push(...effectClaims(d.effects, d.scope + ' fixture ' + d.name + ' (' + d.file + ')')); }
    for (const t of u._tests) for (const l of t.scan.literals) claims.push({ key: 'rec:lit:' + l.entity + ':' + l.literal.toLowerCase(), mode: 'write', source: 'inferred', evidence: t.file + ':' + l.line + ' creates the fixed record "' + l.literal + '"' });
    // shared server state: in the test body, and inside the helper / fixture / page-object functions it (or its hooks and
    // fixtures) call — found through its import closure; a module that changes it at load affects every importer
    for (const t of u._tests) {
      for (const sh of t.scan.shared || []) claims.push({ key: GLOBAL_KEY, mode: 'exclusive', source: 'inferred', evidence: t.file + ':' + sh.line + ': ' + sh.evidence });
      const called = new Set(t.scan.calls || []);
      for (const d of t.scan.chain) for (const h of d.hooks) for (const c of (h.effects.calls || [])) called.add(c);
      for (const h of t.spec.fileHooks) for (const c of (h.effects.calls || [])) called.add(c);
      for (const k of t.fixtures) { const d = defByFileName.get(k); if (d && d.effects) for (const c of d.effects.calls || []) called.add(c); }
      for (const f of t.files || []) {
        if (f === t.file || !isCodeFile(f)) continue;
        const sf = sharedStateFns(path.join(absRoot, f));
        for (const site of sf.topLevel) claims.push({ key: GLOBAL_KEY, mode: 'exclusive', source: 'inferred', evidence: f + ':' + site.line + ': ' + site.evidence + ' — at module load, for every importer' });
        for (const [name, site] of sf.fns) if (called.has(name)) claims.push({ key: GLOBAL_KEY, mode: 'exclusive', source: site.scope === 'unknown' ? 'fail-safe' : 'inferred', evidence: t.file + ' calls ' + name + '() → ' + f + ':' + site.line + ': ' + site.evidence });
      }
    }
    // code impact.mjs cannot follow (dynamic access, unresolved import) may hide side effects: fail safe
    for (const t of u._tests) if (t.unknown && t.unknown.length) claims.push({ key: GLOBAL_KEY, mode: 'exclusive', source: 'fail-safe', evidence: 'its code cannot be followed statically (' + t.unknown[0] + ') — unknown effects run alone' });
    for (const g of globals) claims.push({ key: 'global:setup', mode: 'write', source: 'inferred', evidence: g.kind + ' in ' + g.config + ' runs in every child' });
    u.claims = dedupeClaims(claims);
    // expected duration: every TC known → their sum
    const known = u.tcs.map(expectedOf);
    u.expectedMs = known.length && known.every((x) => typeof x === 'number') ? known.reduce((a, b) => a + b, 0) : null;
  }
  // background writers: every unit writing a collection a reader observes triggers that reader's effect
  const bgReaders = sortU(units.flatMap((u) => u.claims.filter((c) => c.mode === 'aggregate-read' && parseKey(c.key).kind === 'bg').map((c) => c.key)));
  for (const key of bgReaders) {
    const k = parseKey(key);
    const readersTc = sortU(units.filter((u) => u.claims.some((c) => c.key === key && c.mode === 'aggregate-read')).flatMap((u) => u.tcs));
    for (const u of units) {
      const writes = u.claims.some((c) => c.mode === 'write' && parseKey(c.key).kind === 'col' && (k.scope === '*' || parseKey(c.key).name === k.scope || parseKey(c.key).name === '*'));
      if (writes && !u.claims.some((c) => c.key === key && c.mode === 'write')) u.claims.push({ key, mode: 'write', own: true, source: 'inferred', evidence: 'its ' + k.scope + ' writes trigger the ' + k.name + ' effect ' + readersTc.join(', ') + ' observe' });
    }
  }
  // scopes for the admission state (cool-downs): accounts it signs in with, services it calls
  for (const u of units) {
    const sc = new Set();
    for (const c of u.claims) if (parseKey(c.key).kind === 'acct') sc.add('account:' + parseKey(c.key).name);
    for (const r of rateLimits) {
      const per = r.calls_per_tc;
      const all = r.at === 'start' || typeof per === 'number' || !per || (typeof per === 'object' && Number(per.default) > 0);
      if (all || (typeof per === 'object' && u.tcs.some((t) => Number(per[t]) > 0))) sc.add('service:' + r.service);
    }
    u.scopes = sortU([...sc]);
  }
  // ---- conflicts, classes, pool
  const conflicts = [];
  const degree = new Map(units.map((u) => [u.id, 0]));
  const edges = new Map(units.map((u) => [u.id, []]));
  const local = units.filter((u) => !isGlobal(u));
  for (let i = 0; i < local.length; i++) for (let j = i + 1; j < local.length; j++) {
    const a = local[i], b = local[j];
    const r = unitsConflict(a, b);
    if (!r.conflict) continue;
    const ev = [];
    for (const key of r.keys) {
      const ca = a.claims.find((c) => c.key === key || key.includes(c.key));
      const cb = b.claims.find((c) => c.key === key || key.includes(c.key));
      if (ca) ev.push(a.id + ': ' + ca.evidence);
      if (cb) ev.push(b.id + ': ' + cb.evidence);
    }
    conflicts.push({ a: a.id, b: b.id, keys: r.keys, kind: r.keys.includes('order') ? 'order' : 'resource', evidence: sortU(ev).slice(0, 4) });
    degree.set(a.id, degree.get(a.id) + 1); degree.set(b.id, degree.get(b.id) + 1);
    edges.get(a.id).push({ to: b.id, keys: r.keys }); edges.get(b.id).push({ to: a.id, keys: r.keys });
  }
  for (const u of units.filter(isGlobal)) conflicts.push({ a: u.id, b: GLOBAL_KEY, keys: [GLOBAL_KEY], kind: 'exclusive', evidence: u.claims.filter((c) => c.mode === 'exclusive' && c.key === GLOBAL_KEY).map((c) => u.id + ': ' + c.evidence).slice(0, 4) });
  for (const u of units) {
    u.degree = degree.get(u.id);
    const glob = u.claims.filter((c) => c.mode === 'exclusive' && c.key === GLOBAL_KEY);
    if (glob.length) u.class = glob.some((c) => c.source === 'fail-safe' || c.source === 'learned') ? 'run-alone' : 'barrier';
    else if (u.chain) u.class = 'ordered';
    else if (u.degree > 0) u.class = 'restricted';
    else u.class = 'parallel-ready';
  }
  const pool = units.filter((u) => u.type === 'U1' && u.class === 'parallel-ready').map((u) => u.id);
  // ---- TCs
  const tcsOut = {};
  const scopeTcs = stage ? sortU([...tcInfo.keys()].filter((id) => units.some((u) => u.tcs.includes(id)) || (!tests.some((t) => t.tcs.includes(id)) && (tcInfo.get(id).docStage === stage)))) : sortU([...tcInfo.keys()]);
  for (const id of scopeTcs) {
    const info = tcInfo.get(id);
    const us = units.filter((u) => u.tcs.includes(id));
    const reasons = [];
    let cls;
    if (skipped.has(id)) { cls = 'not-scheduled'; reasons.push(skipped.get(id)); }
    else if (!us.length) { cls = 'not-scheduled'; reasons.push(info.candidate ? 'no automated test in scope' : 'not an automation candidate'); }
    else {
      cls = us.map((u) => u.class).sort((a, b) => CLASS_RANK[b] - CLASS_RANK[a])[0];
      for (const u of us) {
        if (u.class === 'run-alone' || u.class === 'barrier') reasons.push(...u.claims.filter((c) => c.mode === 'exclusive' && c.key === GLOBAL_KEY).map((c) => c.evidence));
        if (u.chain) reasons.push(...u.reasons.filter((r) => /chain|order dependency/.test(r)));
        for (const e of edges.get(u.id)) reasons.push('conflicts with ' + units.find((x) => x.id === e.to).tcs.join(', ') + ' on ' + e.keys.join(', '));
      }
    }
    tcsOut[id] = { class: cls, claims: [...(info.claims || []), ...(learnedClaims.get(id) || [])], unit: us.length ? us[0].id : null, ...(us.length > 1 ? { units: us.map((u) => u.id) } : {}), stage: info.docStage, effect: info.effect, reasons: sortU(reasons) };
  }
  // ---- candidate plan (today's run_plan group shape) and the comparison with the hand plan
  const workersParallel = (plan && Number(plan.workers_parallel)) || 2;
  const scheduledTc = (id) => tcsOut[id] && tcsOut[id].class !== 'not-scheduled';
  const parallelUnits = units.filter((u) => u.class === 'parallel-ready' && !u.chain && u.type !== 'U3');
  const groups = [];
  const parallelTcs = sortU(parallelUnits.flatMap((u) => u.tcs)).filter(scheduledTc);
  if (parallelTcs.length) groups.push({ name: 'parallel', mode: 'parallel', workers: workersParallel, tcs: parallelTcs, reason: 'no conflict with any other unit of the stage' });
  const inGroup = new Set(parallelUnits.map((u) => u.id));
  const comp = [];
  for (const u of units) {
    if (inGroup.has(u.id) || isGlobal(u) || !edges.get(u.id).length) continue;
    const stack = [u.id];
    const ids = [];
    const keyCount = new Map();
    while (stack.length) {
      const x = stack.pop();
      if (inGroup.has(x)) continue;
      inGroup.add(x); ids.push(x);
      for (const e of edges.get(x)) { if (x < e.to) for (const k of e.keys) keyCount.set(k, (keyCount.get(k) || 0) + 1); if (!inGroup.has(e.to)) stack.push(e.to); }
    }
    const dominant = [...keyCount.entries()].sort((p, q) => q[1] - p[1] || natural(p[0], q[0]))[0];
    comp.push({ ids, key: dominant ? dominant[0] : 'conflict', keys: [...keyCount.keys()].sort(natural) });
  }
  const serialGroups = [];
  const accountGroups = [];
  const globalGroups = [];
  const used = new Set(groups.map((g) => g.name));
  const named = (n) => { let x = n, i = 2; while (used.has(x)) x = n + '-' + i++; used.add(x); return x; };
  for (const c of comp) {
    const tcs = sortU(units.filter((u) => c.ids.includes(u.id)).flatMap((u) => u.tcs)).filter(scheduledTc);
    if (!tcs.length) continue;
    const g = { name: named(groupNameOf(c.key.split(' ~ ')[0])), mode: 'serial', workers: 1, tcs, reason: 'conflicts on ' + c.keys.join(', ') };
    (parseKey(c.key).kind === 'acct' ? accountGroups : serialGroups).push(g);
  }
  for (const u of units) {
    if (inGroup.has(u.id)) continue;
    const tcs = u.tcs.filter(scheduledTc);
    if (!tcs.length) continue;
    if (isGlobal(u)) { globalGroups.push({ name: named('serial:' + (u.class === 'barrier' ? 'barrier' : 'alone') + '-' + slug(tcs[0])), mode: 'serial', workers: 1, tcs, reason: u.class + ': ' + u.claims.filter((c) => c.mode === 'exclusive' && c.key === GLOBAL_KEY).map((c) => c.evidence)[0] }); continue; }
    const nm = u._fixtureName ? u._fixtureName : u.describePath ? u.describePath[u.describePath.length - 1] : path.basename(u.spec).replace(/\.(spec|test)\.[a-z]+$/i, '');
    serialGroups.push({ name: named('serial:' + slug(nm)), mode: 'serial', workers: 1, tcs, reason: u.reasons.join('; ') || u.type + ' unit' });
    inGroup.add(u.id);
  }
  serialGroups.sort((a, b) => natural(a.tcs[0], b.tcs[0]));
  accountGroups.sort((a, b) => natural(a.tcs[0], b.tcs[0]));
  globalGroups.sort((a, b) => natural(a.tcs[0], b.tcs[0]));
  groups.push(...serialGroups, ...accountGroups, ...globalGroups);
  const decisions = [];
  for (const id of scopeTcs.filter(scheduledTc)) {
    const t = tcsOut[id];
    const mode = groups.find((g) => g.tcs.includes(id)) && groups.find((g) => g.tcs.includes(id)).mode === 'parallel' ? 'parallel' : 'serial';
    const decisive = t.claims.find((c) => c.mode === 'exclusive') || t.claims.find((c) => c.source === 'learned') || null;
    decisions.push({ tc: id, mode, class: t.class, source: decisive ? decisive.source : (t.effect && t.effect.source) || 'inferred', why: t.reasons[0] || (mode === 'parallel' ? 'no conflict found (' + ((t.effect && t.effect.mode) || 'read-only') + ')' : t.class) });
  }
  const candidatePlan = { workers_parallel: workersParallel, groups, decisions };
  const comparison = { handPlan: !!(runPlan && runPlan.groups.length), compared: 0, agree: 0, differences: [], onlyHand: [], onlyCandidate: [] };
  if (comparison.handPlan) {
    const hand = new Map();
    for (const g of runPlan.groups) for (const t of g.tcs || []) hand.set(t, { group: g.name, mode: g.mode || ((g.workers || 1) > 1 ? 'parallel' : 'serial') });
    const cand = new Map();
    for (const g of groups) for (const t of g.tcs) cand.set(t, { group: g.name, mode: g.mode });
    for (const id of sortU([...hand.keys(), ...cand.keys()])) {
      if (stage && !scopeTcs.includes(id)) continue;
      const h = hand.get(id), c = cand.get(id);
      if (!h) { comparison.onlyCandidate.push(id); continue; }
      if (!c) { comparison.onlyHand.push(id); continue; }
      comparison.compared++;
      if (h.mode === c.mode) { comparison.agree++; continue; }
      comparison.differences.push({ tc: id, hand: h, candidate: c, note: c.mode === 'serial' ? 'the readiness check serialises it: ' + (tcsOut[id].reasons[0] || tcsOut[id].class) : 'no conflict found — the hand plan serialises it without evidence (an unlock candidate)' });
    }
  }
  // ---- readiness report (Revision 3 §3.9) and unlock suggestions
  const classes = Object.fromEntries(CLASSES.map((c) => [c, scopeTcs.filter((id) => tcsOut[id].class === c).length]));
  const greedy = [];
  for (const u of units.filter((x) => !isGlobal(x))) if (greedy.every((g) => !unitsConflict(g, u).conflict)) greedy.push(u);
  const candidateConcurrency = greedy.length;
  const ceil = Number(ceiling) > 0 ? Math.floor(Number(ceiling)) : null;
  const recommendedInitialWorkers = Math.max(1, Math.min(2, ceil || 2, candidateConcurrency || 1));
  const knownMs = units.map((u) => u.expectedMs).filter((x) => typeof x === 'number');
  const serialOnlyMs = knownMs.reduce((a, b) => a + b, 0);
  const plannedMs = units.length ? simulate(units, pool, recommendedInitialWorkers) : 0;
  const unlockSuggestions = [];
  for (const id of scopeTcs) {
    const t = tcsOut[id];
    if (t.class === 'run-alone' && t.claims.some((c) => c.source === 'fail-safe')) unlockSuggestions.push({ key: GLOBAL_KEY, tcs: [id], suggestion: 'name what ' + id + ' changes — its Data effect and the record it creates or names (skill 3 --revision), or give it its own record (uniqueName); unknown effects run alone' });
  }
  for (const c of comp) {
    const k = parseKey(c.key);
    const tcs = sortU(units.filter((u) => c.ids.includes(u.id)).flatMap((u) => u.tcs));
    if (k.kind === 'acct') unlockSuggestions.push({ key: c.key, tcs, suggestion: 'a second account of the same role in TEST-DATA would let the TCs that sign in as ' + k.name + ' run apart' });
    else if (k.kind === 'shared') unlockSuggestions.push({ key: c.key, tcs, suggestion: 'a dedicated record per TC (prepared under the twelve principles, with consent) would remove the shared-data serialisation' });
    else if (k.kind === 'col') {
      const readers = sortU(units.filter((u) => c.ids.includes(u.id) && u.claims.some((x) => x.mode === 'aggregate-read' && parseKey(x.key).kind === 'col' && (parseKey(x.key).name === k.name || parseKey(x.key).name === '*'))).flatMap((u) => u.tcs));
      if (readers.length) unlockSuggestions.push({ key: c.key, tcs: readers, suggestion: 'the aggregate checks (count / latest / search / export) of ' + readers.join(', ') + ' observe records other TCs add — scope their oracle to their own records, or keep them serial' });
    }
  }
  for (const l of learned.filter((x) => x.status === 'revalidate')) unlockSuggestions.push({ key: 'learned:' + l.id, tcs: l.tcs, suggestion: 're-check the learned interference — ' + l.changed.join(', ') + ' changed since it was learned; it stays honoured until a deliberate clean overlap outside smoke' });
  const serialisations = scopeTcs.filter((id) => tcsOut[id].class !== 'parallel-ready').map((id) => ({ tc: id, class: tcsOut[id].class, reason: tcsOut[id].reasons[0] || tcsOut[id].class }));
  const readiness = {
    total: scopeTcs.length, classes,
    unknownEffects: scopeTcs.filter((id) => tcsOut[id].claims.some((c) => c.source === 'fail-safe')).length,
    units: { U1: units.filter((u) => u.type === 'U1').length, U2: units.filter((u) => u.type === 'U2').length, U3: units.filter((u) => u.type === 'U3').length, U4: units.filter((u) => u.type === 'U4').length, total: units.length },
    pool: pool.length, conflicts: conflicts.filter((c) => c.b !== GLOBAL_KEY).length, globalUnits: units.filter(isGlobal).length, orderDependencies: orderDependencies.length,
    candidateConcurrency, recommendedInitialWorkers, machineCeiling: ceil, additionalHostCapacity: null, environmentCapacity: null, validatedWorkers: null,
    rateLimits: rateLimits.map((r) => ({ service: r.service, scope: r.scope ?? null, limit: r.limit ?? null, window_s: r.window_s ?? null, pace: r.pace ?? null, at: r.at ?? null })),
    expectedDuration: { serialOnlyMs, knownUnits: knownMs.length, unknownUnits: units.length - knownMs.length, plannedMs },
    serialisations,
  };
  // the concrete conflicts in one line each (at most 5) — what the run-start message and the stage update quote
  const brief = [];
  const RANK = { inferred: 0, field: 1, marker: 2, learned: 3, 'fail-safe': 4 };
  for (const u of units.filter(isGlobal)) {
    const cs = u.claims.filter((x) => x.mode === 'exclusive' && x.key === GLOBAL_KEY).sort((a, b) => (RANK[a.source] ?? 5) - (RANK[b.source] ?? 5));
    if (cs.length) brief.push(u.tcs.join(', ') + ' run' + (u.tcs.length === 1 ? 's' : '') + ' alone — ' + cs.slice(0, 2).map((c) => c.evidence).join('; '));
  }
  for (const c of conflicts.filter((x) => x.b !== GLOBAL_KEY)) { const ua = units.find((x) => x.id === c.a); const ub = units.find((x) => x.id === c.b); if (ua && ub) brief.push(ua.tcs.join(', ') + ' ↔ ' + ub.tcs.join(', ') + ' kept apart — ' + (c.keys || []).join(', ')); }
  readiness.conflicts_brief = brief.slice(0, 5);
  if (brief.length > 5) readiness.conflicts_brief_more = brief.length - 5;
  const outUnits = units.map(({ _tests, _fixtureName, ...u }) => u);
  return {
    ...base, outcome: 'OK', root: posix(absRoot),
    inputs: { tc: tc ? posix(String(tc)) : null, data: dataPath ? posix(dataPath) : null, learning: learning ? posix(String(learning)) : null, runFile: runFile ? posix(String(runFile)) : null, progress: progress ? posix(String(progress)) : null, admissionContract: admissionPresent,
      fingerprint: readinessFingerprint({ root: absRoot, specs, tc, data: dataPath, learning, runFile, environment }) },
    tcs: tcsOut, units: outUnits, conflicts, pool, orderDependencies, learned, readiness,
    // the shadow experiment only (--compare): the candidate plan and its comparison with the hand plan
    ...(compare ? { candidatePlan, comparison } : {}),
    unlockSuggestions: unlockSuggestions.sort((a, b) => natural(a.key, b.key) || natural(a.tcs[0], b.tcs[0])),
    warnings: sortU(warnings), review: sortU(review), errors: [],
  };
}

/** Planned wall time at W workers: the pool child first (it reserves all W slots), then list scheduling of the rest. */
function simulate(units, pool, W) {
  const known = units.map((u) => u.expectedMs).filter((x) => typeof x === 'number');
  const fill = median(known) || 0;
  const exp = (u) => (typeof u.expectedMs === 'number' ? u.expectedMs : fill);
  const poolUnits = units.filter((u) => pool.includes(u.id));
  let t = poolUnits.length ? Math.ceil(poolUnits.reduce((a, u) => a + exp(u), 0) / Math.max(1, Math.min(W, poolUnits.length))) : 0;
  const sched = createScheduler({ units, pool, agingMs: Number.MAX_SAFE_INTEGER, startAt: t });
  let running = [];
  for (let guard = 0; guard < 10000; guard++) {
    const r = sched.next({ running: running.map((x) => x.id), poolPending: [], freeSlots: W - running.length, now: t });
    if (r.start) { running.push({ id: r.start.id, end: t + exp(r.start) }); continue; }
    if (!running.length) break;
    running.sort((a, b) => a.end - b.end);
    const first = running.shift();
    t = first.end;
    sched.done(first.id, { now: t });
  }
  return t;
}

/* ---------------- CLI ---------------- */

const HELP = {
  tool: 'parallel-plan', schema: SCHEMA_VERSION,
  usage: 'node parallel-plan.mjs --root <automation root> [--spec <file,…>] [--tc <TEST-CASES md>] [--data <TEST-DATA md>] [--learning <project-learning.md>] [--run-file <.runs/phase-N.json>] [--progress <artifacts/progress>] [--env-id <id>] [--stage smoke|positive|negative] [--ceiling <N>] [--compare] [--out <file>] [--strict] [--pretty]',
  notes: [
    'Read-only; --out writes the payload to that file (the only write; a BLOCKED payload too) — run-stage.mjs reads it as --units.',
    'Default (mode readiness): what the dispatcher needs — units, pool, conflicts, classes, readiness, unlock suggestions, and inputs.fingerprint (code, TCs, TEST-DATA, learning file, run plan, environment); run-stage re-plans or runs serially when any part changed. --compare (mode shadow, the opt-in experiment) adds candidatePlan.groups[] and comparison with the hand plan.',
    'Unknown effects are isolated (run-alone); learned conflicts stay honoured after a TC changes (revalidate).',
    'Exit code 0 by default; --strict maps OK 0 · BLOCKED 2.',
  ],
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, args); return 0; }
  const str = (k) => (typeof args[k] === 'string' ? args[k] : null);
  const specs = str('spec') ? str('spec').split(',').map((x) => x.trim()).filter(Boolean) : [];
  const payload = planParallel({ root: str('root'), specs, tc: str('tc'), data: str('data'), learning: str('learning'), runFile: str('run-file'), progress: str('progress'), stage: str('stage'), ceiling: str('ceiling'), compare: !!args.compare, environment: str('env-id'), inventory: str('inventory') });
  // a BLOCKED payload is written too: an earlier OK payload must never survive as if it were still valid
  if (str('out')) {
    const out = path.resolve(str('out'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
    payload.writes = [{ file: posix(out), bytes: fs.statSync(out).size }];
  }
  print(payload, args);
  return args.strict ? (payload.outcome === 'OK' ? 0 : 2) : 0;
}

const isMain = (() => { try { return fs.realpathSync.native(process.argv[1] || '') === fs.realpathSync.native(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  let code = 0;
  try { code = main(); } catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'parallel-plan', schema: SCHEMA_VERSION, outcome: 'BLOCKED', reason: 'internal error: ' + (e && e.message ? e.message : e), errors: [e && e.stack ? e.stack : String(e)] }, args);
    code = args.strict ? 2 : 0;
  }
  process.exit(code);
}
