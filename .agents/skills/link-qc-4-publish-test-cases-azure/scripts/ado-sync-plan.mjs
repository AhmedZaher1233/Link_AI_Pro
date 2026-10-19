#!/usr/bin/env node
// ado-sync-plan.mjs — the DECISION script of skill 4's Azure DevOps publish.
// Node >= 18, zero dependencies, read-only by default; writes ONE file (the new ADO-MAP.md), only
// behind --write-map <path>. Imports ./tc-hash.mjs (the canonical TC hash — never modified here).
//
// The skill does every read and write through the Azure DevOps MCP server and never decides by
// itself: it dumps what it read to JSON, runs this script, applies the plan through MCP, reads the
// work items back, dumps that to JSON and runs `verify`. Three modes:
//
//   hash    --tc <TEST-CASES-*.md> [--data <TEST-DATA-*.md>] [--ids a,b] [--canonical]
//           → canonical hash per TC (tc-hash.mjs, unchanged).
//
//   plan    --tc <APPROVED TEST-CASES-*.md> [--data <TEST-DATA-*.md>] [--map <previous ADO-MAP.md>]
//           --remote <json> --feature <name> [--convention-tags a,b] [--beautified <*-beautified.md>]
//           [--story <id>] [--project <name>] [--hosting cloud|self-hosted]
//           → per TC: work item id (or "create"), tagsAdd / tagsRemove / tagsPreserve, the status
//             decision (write | keep | unknown | conflict + reason), the "Test data" description
//             block, published_tc_sha256 and changes[] (create | content | tags | status | test data;
//             an empty list = `current`: nothing to write unless --republish, the pre-write read is
//             the TC's read-back). `--tc` is the APPROVED document: skill 5 hashes the same file, so
//             the two hashes of ADO-MAP.md are comparable. The beautified document is what MCP
//             publishes; when given, its TC-ID set must equal the approved one.
//
//             remote JSON (what MCP read, per TC-ID; null = no work item yet):
//               { "TC-…": { "id": 123, "tags": ["a","b"] | "a; b",
//                           "automationStatus": "Planned" | "Automated" | "Not Automated" | null,
//                           "descriptionHasTestData": { "ids": ["A1","D1"], "sha": "…" } | null } }
//
//   verify  --plan <plan.json> --readback <json> [--snapshot attached|comment|NOT_RUN] [--attempt n]
//           [--published-on <ISO>] [--suite <value>] [--write-map <ADO-MAP.md>]
//           → per TC: verified | MISMATCH (field, intended, actual) | CONFLICT | NOT_RUN | NOT_WRITTEN,
//             the outcome line with counts, and the text of the NEW ADO-MAP.md (dry-run unless
//             --write-map). readback JSON = the remote shape after the writes, per TC-ID; null = the
//             read-back was unavailable (NOT_RUN); { "writeError": "…" } = the write itself failed.
//             Optionally wrapped: { "items": {…}, "snapshot": "attached" }.
//
// Rules encoded (plan Issue 5):
//   AutomationStatus  Automation Candidate: YES → Planned · NO → Not Automated · field absent →
//                     unknown (nothing written) · an existing "Automated" is kept only when the
//                     previous map's automated_tc_sha256 equals the current canonical hash, else
//                     CONFLICT (status untouched, row flagged). Skill 5 alone writes Automated.
//   Tags              intended = {feature} + smoke + automation|manual + human-step + the TC's Tags:
//                     values + convention tags. add = intended − current; remove = previously
//                     introduced − intended; every other tag is preserved. A tag already on the work
//                     item never becomes owned.
//   Ownership         Tags (introduced) after verify = (previously introduced ∩ still intended ∩ read
//                     back present) ∪ (added this run ∩ read back present). A confirmed removal leaves
//                     the record; a failed / NOT_RUN addition is not recorded (retried next run, listed
//                     under unverified). Legacy map without the column → ownership unknown: nothing is
//                     removed, the column is initialised from this run's verified adds.
//   Test data block   every referenced [A|E|D] row (id, role / plain name, username or value — never a
//                     password) + the TEST-DATA file name and sha256. Read-back must show every id and
//                     the current sha, else MISMATCH (test data).
//   Outcome           BLOCKED > PUBLICATION INCOMPLETE > PUBLISHED WITH MISMATCHES > PUBLISHED, NOT
//                     VERIFIED > PUBLISHED AND VERIFIED — the line always carries the counts.
//
// Exit code is 0 by default (the outcome lives in the payload); --strict maps VERIFIED 0 ·
// MISMATCHES 1 · NOT VERIFIED 2 · INCOMPLETE 3 · BLOCKED / NOT_RUN 4 (plan / hash: PASS 0, else 4).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, print, parseTcDocument, parseTestData, tcHash, hashDocument, HASH_VERSION } from './tc-hash.mjs';

export const SCHEMA_VERSION = 'ado-sync/1';
export const MAP_COLUMNS = ['TC-ID', 'ADO Work Item ID', 'published_tc_sha256', 'automated_tc_sha256', 'Automation candidate', 'AutomationStatus', 'Tags (introduced)', 'Suite'];
export const OUTCOMES = {
  BLOCKED: 'BLOCKED',
  INCOMPLETE: 'PUBLICATION INCOMPLETE',
  MISMATCHES: 'PUBLISHED WITH MISMATCHES',
  NOT_VERIFIED: 'PUBLISHED, NOT VERIFIED',
  VERIFIED: 'PUBLISHED AND VERIFIED',
};
export const STATUS_FOR_CANDIDACY = { YES: 'Planned', NO: 'Not Automated' };
export const CONFLICT_REASON = 'CONFLICT — automation may not cover the current TC; re-run skill 5';
export const UNKNOWN_REASON = 'unknown (no candidacy field)';
export const REMOVED_ROW_NOTE = 'removed from document — work item left in place';
const SNAPSHOT_VALUES = new Set(['attached', 'comment', 'NOT_RUN']);
const STRICT_EXIT = { [OUTCOMES.VERIFIED]: 0, [OUTCOMES.MISMATCHES]: 1, [OUTCOMES.NOT_VERIFIED]: 2, [OUTCOMES.INCOMPLETE]: 3, [OUTCOMES.BLOCKED]: 4, NOT_RUN: 4, PASS: 0 };
const SECRET_RE = /\b(pass(?:word|wd|phrase)?|secret|token|api[-_ ]?key)\b\s*[:=]/i;

/* ---------------- small helpers ---------------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const str = (v) => (typeof v === 'string' ? v : null);
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readBytes = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const undash = (v) => (v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '—' ? null : String(v).trim());
const normTag = (t) => String(t).trim().toLowerCase();
const uniq = (arr) => { const seen = new Set(); const out = []; for (const t of arr) { const k = normTag(t); if (!k || seen.has(k)) continue; seen.add(k); out.push(String(t).trim()); } return out; };
const has = (list, tag) => list.some((t) => normTag(t) === normTag(tag));
const minus = (a, b) => a.filter((t) => !has(b, t));
const intersect = (a, b) => a.filter((t) => has(b, t));
const sortTags = (a) => [...a].sort((x, y) => normTag(x).localeCompare(normTag(y)));
export function splitTags(v) {
  if (Array.isArray(v)) return uniq(v.map(String));
  const s = undash(v); if (!s) return [];
  return uniq(s.split(/[;,·]/));
}
function field(tc, name) {
  const k = Object.keys(tc.fields).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? tc.fields[k] : null;
}
function fieldValue(tc, name) { const f = field(tc, name); return f ? f.value : null; }
function fieldLines(tc, name) { const f = field(tc, name); if (!f) return []; return [f.value, ...f.items].filter((x) => x && x.trim()); }

/* ---------------- ADO-MAP.md parser (columns by name, never by position) ---------------- */
export function parseMap(text) {
  const out = { present: false, header: {}, sourceSha256: null, columns: [], ownershipKnown: false, hashesKnown: false, rows: {}, order: [] };
  if (!text) return out;
  out.present = true;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const l of lines) {
    const s = l.match(/^<!--\s*source_sha256:\s*(\S+)\s*-->/);
    if (s) { out.sourceSha256 = s[1]; continue; }
    const c = l.match(/^<!--\s*(.*?)\s*-->/);
    if (c && !/^ado-sync:/.test(c[1])) {
      for (const part of c[1].split('·')) { const kv = part.match(/^\s*([\w-]+):\s*(.*?)\s*$/); if (kv) out.header[kv[1]] = kv[2]; }
    }
  }
  const tableLines = lines.filter((l) => /^\|/.test(l.trim()));
  if (!tableLines.length) return out;
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  out.columns = cells(tableLines[0]);
  const idx = (name) => out.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  const iId = idx('TC-ID'); const iWi = idx('ADO Work Item ID'); const iPub = idx('published_tc_sha256'); const iAuto = idx('automated_tc_sha256');
  const iCand = idx('Automation candidate'); const iStat = idx('AutomationStatus'); const iTags = idx('Tags (introduced)'); const iSuite = idx('Suite');
  out.ownershipKnown = iTags >= 0; out.hashesKnown = iPub >= 0 && iAuto >= 0;
  for (const l of tableLines.slice(1)) {
    const c = cells(l);
    if (c.every((x) => /^:?-+:?$/.test(x))) continue;
    const id = iId >= 0 ? c[iId] : c[0]; if (!id) continue;
    const at = (i) => (i >= 0 ? undash(c[i]) : null);
    out.rows[id] = {
      workItemId: at(iWi), publishedSha256: at(iPub), automatedSha256: at(iAuto), candidate: at(iCand), status: at(iStat),
      introduced: iTags >= 0 ? splitTags(c[iTags]) : null, suite: at(iSuite),
    };
    out.order.push(id);
  }
  return out;
}

/* ---------------- document facts per TC ---------------- */
const REF_RE = /\[([AED])(\d+)\]/g;
export function tcFacts(tc) {
  const cand = (fieldValue(tc, 'Automation Candidate') || '').trim().toUpperCase();
  const candidacy = /^YES\b/.test(cand) ? 'YES' : /^NO\b/.test(cand) ? 'NO' : null;
  const smoke = /^YES\b/i.test((fieldValue(tc, 'Smoke') || '').trim());
  const humanLines = ['Preconditions', 'Steps', 'Expected Result'].flatMap((f) => fieldLines(tc, f)).filter((l) => /^\s*\[HUMAN\]/.test(l));
  const refs = new Set();
  for (const [name, f] of Object.entries(tc.fields)) {
    if (name.toLowerCase() === 'validation') continue;
    for (const s of [f.value, ...f.items]) for (const m of String(s || '').matchAll(REF_RE)) refs.add(m[1] + m[2]);
  }
  return { candidacy, smoke, humanSteps: humanLines.length, docTags: splitTags(fieldValue(tc, 'Tags')), refs: [...refs].sort() };
}

/** The "Test data" block text for one TC — referenced rows only, never a password. */
export function descriptionBlock(refs, data, dataFile, dataSha) {
  const rows = []; const unresolved = [];
  for (const id of refs) {
    const kind = id[0];
    if (kind === 'A') { const a = data.accounts[id]; if (a) rows.push('[' + id + '] ' + a.role + ' — username: ' + dash(a.username) + (a.note ? ' — ' + a.note : '')); else unresolved.push(id); }
    else if (kind === 'E') { const e = data.env[id]; if (e) rows.push('[' + id + '] ' + e.what + ' — ' + dash(e.value)); else unresolved.push(id); }
    else { const d = data.items[id]; if (d) rows.push('[' + id + '] ' + d.name + ' — must look like: ' + dash(d.mustLookLike)); else unresolved.push(id); }
  }
  for (const id of unresolved) rows.push('[' + id + '] — not found in the TEST-DATA file (unresolved reference)');
  const lines = ['Test data — ' + (dataFile || 'no TEST-DATA file') + (dataSha ? ' (sha256 ' + dataSha + ')' : ''), ...rows.map((r) => '- ' + r), 'Each reference resolves to its own row of that file; passwords are never listed here.'];
  return { file: dataFile || null, sha: dataSha || null, ids: refs.slice(), unresolved, text: lines.join('\n') };
}

/* ---------------- status decision ---------------- */
export function decideStatus({ candidacy, remoteStatus, previousAutomatedSha, hash }) {
  const current = remoteStatus ?? null;
  const intended = candidacy ? STATUS_FOR_CANDIDACY[candidacy] : null;
  if (current === 'Automated') {
    if (previousAutomatedSha && previousAutomatedSha === hash) return { current, intended: 'Automated', action: 'keep', reason: 'Automated kept — automated_tc_sha256 equals the canonical hash of the current TC (skill 5 evidence)' };
    return { current, intended: current, action: 'conflict', reason: CONFLICT_REASON + (previousAutomatedSha ? ' (automated_tc_sha256 differs from the current TC)' : ' (no automated_tc_sha256 provenance in the previous map)') };
  }
  if (!intended) return { current, intended: null, action: 'unknown', reason: UNKNOWN_REASON };
  if (current === intended) return { current, intended, action: 'keep', reason: 'already ' + intended };
  return { current, intended, action: 'write', reason: 'Automation Candidate: ' + candidacy + ' → ' + intended };
}

/* ---------------- plan ---------------- */
export function planFromInputs({ tcText, dataText, dataFile, dataSha, mapText, remote, feature, conventionTags, sourceSha256, beautifiedText, beautifiedSha256, story, project, hosting }) {
  const warnings = []; const errors = [];
  const base = { tool: 'ado-sync-plan', schema: SCHEMA_VERSION, hash: HASH_VERSION, mode: 'plan', readOnly: true };
  const tcs = parseTcDocument(tcText || '');
  if (!tcs.length) return { ...base, gate: 'BLOCKED', reason: 'no test case found in the document (expected "### TC-… — …" headings)', warnings, errors };
  const featureName = str(feature) || ((tcText.match(/^#\s+Test Cases\s*[—-]\s*(.+?)\s*$/m) || [])[1]) || ((tcText.match(/^feature:\s*(.+?)\s*$/m) || [])[1]) || null;
  if (!featureName) return { ...base, gate: 'BLOCKED', reason: '--feature is required (the document title names none)', warnings, errors };
  if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) return { ...base, gate: 'BLOCKED', reason: '--remote must be a JSON object keyed by TC-ID (what MCP read; null per TC that has no work item yet)', warnings, errors };
  if (beautifiedText !== undefined && beautifiedText !== null) {
    const b = parseTcDocument(beautifiedText).map((t) => t.id).sort().join(','); const a = tcs.map((t) => t.id).sort().join(',');
    if (a !== b) return { ...base, gate: 'BLOCKED', reason: 'the beautified document\'s TC-ID set differs from the approved document\'s — the meaning-preservation gate must pass before a plan', warnings, errors, approvedIds: a.split(','), beautifiedIds: b.split(',') };
  }
  const data = parseTestData(dataText || '');
  if (!dataText) warnings.push('no TEST-DATA file — every description block lists no rows and every [A|E|D] reference is unresolved');
  const map = parseMap(mapText || '');
  if (map.present && !map.ownershipKnown) warnings.push('previous ADO-MAP.md has no "Tags (introduced)" column — tag ownership is unknown: nothing is removed this run; the column is initialised from this run\'s verified adds');
  if (map.present && !map.hashesKnown) warnings.push('previous ADO-MAP.md has no published_tc_sha256 / automated_tc_sha256 columns — an existing "Automated" has no provenance and is reported as a conflict');
  const convention = splitTags(conventionTags || '');
  const docIds = new Set(tcs.map((t) => t.id));
  const rows = [];
  for (const tc of tcs) {
    const facts = tcFacts(tc);
    const hash = tcHash(tc, data);
    const r = remote[tc.id] ?? null;
    const remoteTags = r ? splitTags(r.tags ?? []) : [];
    const remoteStatus = r ? (r.automationStatus ?? null) : null;
    const prev = map.rows[tc.id] || null;
    const intended = uniq([
      featureName,
      ...(facts.smoke ? ['smoke'] : []),
      ...(facts.candidacy === 'YES' ? ['automation'] : facts.candidacy === 'NO' ? ['manual'] : []),
      ...(facts.humanSteps ? ['human-step'] : []),
      ...facts.docTags,
      ...convention,
    ]);
    const previouslyIntroduced = map.ownershipKnown && prev ? prev.introduced : null;
    const tagsAdd = minus(intended, remoteTags);
    const tagsRemove = previouslyIntroduced ? intersect(minus(previouslyIntroduced, intended), remoteTags) : [];
    const tagsPreserve = minus(remoteTags, tagsRemove);
    const status = decideStatus({ candidacy: facts.candidacy, remoteStatus, previousAutomatedSha: prev ? prev.automatedSha256 : null, hash });
    const block = descriptionBlock(facts.refs, data, dataFile, dataSha);
    if (SECRET_RE.test(block.text)) errors.push({ tc: tc.id, reason: 'the description block contains a password-shaped line — never published' });
    if (block.unresolved.length) warnings.push(tc.id + ': unresolved reference(s) ' + block.unresolved.join(', ') + ' — no row in the TEST-DATA file');
    // what this run has to write — an empty list means the work item is `current` (no write; the pre-write read is its read-back) unless --republish
    const rd = r && r.descriptionHasTestData && typeof r.descriptionHasTestData === 'object' ? r.descriptionHasTestData : null;
    const rdIds = rd && Array.isArray(rd.ids) ? rd.ids.map((x) => String(x).toUpperCase()) : [];
    const blockCurrent = !!rd && (rd.sha ?? null) === (block.sha ?? null) && block.ids.every((id) => rdIds.includes(id));
    const contentCurrent = !!prev && prev.publishedSha256 === hash;
    const changes = [];
    if (!r) changes.push('create');
    else {
      if (!contentCurrent) changes.push('content');
      if (tagsAdd.length || tagsRemove.length) changes.push('tags');
      if (status.action === 'write') changes.push('status');
      if (!blockCurrent) changes.push('test data');
    }
    rows.push({
      tcId: tc.id, title: tc.title, workItemId: r && r.id != null ? r.id : 'create', hash,
      candidacy: facts.candidacy, smoke: facts.smoke, humanSteps: facts.humanSteps, docTags: facts.docTags, refs: facts.refs,
      intendedTags: sortTags(intended), currentTags: sortTags(remoteTags), tagsAdd: sortTags(tagsAdd), tagsRemove: sortTags(tagsRemove), tagsPreserve: sortTags(tagsPreserve),
      previouslyIntroduced: previouslyIntroduced ? sortTags(previouslyIntroduced) : null,
      ownership: previouslyIntroduced ? 'known' : 'unknown',
      status, descriptionBlock: block, changes, unchanged: changes.length === 0,
      previous: prev ? { workItemId: prev.workItemId, publishedSha256: prev.publishedSha256, automatedSha256: prev.automatedSha256, suite: prev.suite, status: prev.status } : null,
    });
  }
  const rowsNotInDocument = map.order.filter((id) => !docIds.has(id)).map((id) => ({ tcId: id, ...map.rows[id], note: REMOVED_ROW_NOTE }));
  const remoteNotInDocument = Object.keys(remote).filter((id) => !docIds.has(id));
  if (remoteNotInDocument.length) warnings.push('remote work items not in the document (left in place): ' + remoteNotInDocument.join(', '));
  const counts = {
    tcs: rows.length, create: rows.filter((r) => r.workItemId === 'create').length, update: rows.filter((r) => r.workItemId !== 'create').length,
    tagsAdd: rows.reduce((n, r) => n + r.tagsAdd.length, 0), tagsRemove: rows.reduce((n, r) => n + r.tagsRemove.length, 0),
    statusWrite: rows.filter((r) => r.status.action === 'write').length, statusKeep: rows.filter((r) => r.status.action === 'keep').length,
    statusUnknown: rows.filter((r) => r.status.action === 'unknown').length, statusConflict: rows.filter((r) => r.status.action === 'conflict').length,
    current: rows.filter((r) => r.unchanged).length,
    humanStep: rows.filter((r) => r.humanSteps > 0).length, unresolvedRefs: rows.reduce((n, r) => n + r.descriptionBlock.unresolved.length, 0),
  };
  const gate = errors.length ? 'BLOCKED' : 'PASS';
  return {
    ...base, gate, reason: errors.length ? errors.map((e) => e.tc + ': ' + e.reason).join('; ') : 'plan computed — apply it through MCP, then read back and run verify',
    feature: featureName, conventionTags: convention,
    source: { sha256: sourceSha256 || null, beautifiedSha256: beautifiedSha256 || null, dataFile: dataFile || null, dataSha256: dataSha || null },
    header: { story: str(story) || map.header.story || null, project: str(project) || map.header.project || null, hosting: str(hosting) || map.header.hosting || null },
    previousMap: { present: map.present, ownershipKnown: map.ownershipKnown, hashesKnown: map.hashesKnown, sourceSha256: map.sourceSha256, rowsNotInDocument },
    tcs: rows, counts, warnings, errors,
  };
}

/* ---------------- verify ---------------- */
function verifyTc(p, rb) {
  const prevIntroduced = p.previouslyIntroduced || [];
  const base = { tcId: p.tcId, workItemId: p.workItemId, mismatches: [], unverifiedAdds: [], confirmedRemovals: [] };
  if (rb === undefined || rb === null) {
    return { ...base, verdict: 'NOT_RUN', reason: 'read-back unavailable — the write was reported, the result was not observed', introduced: sortTags(prevIntroduced), unverifiedAdds: p.tagsAdd.slice(), readBack: null };
  }
  if (typeof rb !== 'object') return { ...base, verdict: 'NOT_RUN', reason: 'read-back entry is not an object', introduced: sortTags(prevIntroduced), unverifiedAdds: p.tagsAdd.slice(), readBack: null };
  if (rb.writeError || rb.written === false) {
    return { ...base, verdict: 'NOT_WRITTEN', reason: String(rb.writeError || 'write failed'), introduced: sortTags(prevIntroduced), unverifiedAdds: p.tagsAdd.slice(), readBack: null };
  }
  const mm = base.mismatches;
  const actualId = rb.id ?? null;
  if (p.workItemId !== 'create' && actualId != null && String(actualId) !== String(p.workItemId)) mm.push({ field: 'id', intended: p.workItemId, actual: actualId });
  if (actualId == null) mm.push({ field: 'id', intended: p.workItemId === 'create' ? 'the id of the created work item' : p.workItemId, actual: 'none read back' });
  const actualTags = splitTags(rb.tags ?? []);
  const expectedTags = uniq([...p.tagsPreserve, ...p.tagsAdd]);
  const missing = minus(expectedTags, actualTags); const unexpected = minus(actualTags, expectedTags);
  if (missing.length || unexpected.length) mm.push({ field: 'tags', intended: sortTags(expectedTags), actual: sortTags(actualTags), missing: sortTags(missing), unexpected: sortTags(unexpected) });
  const actualStatus = rb.automationStatus ?? null;
  if (p.status.action === 'write' || p.status.action === 'keep') { if (actualStatus !== p.status.intended) mm.push({ field: 'automationStatus', intended: p.status.intended, actual: actualStatus }); }
  else if (p.status.action === 'conflict') { if (actualStatus !== p.status.current) mm.push({ field: 'automationStatus (untouched)', intended: p.status.current, actual: actualStatus }); }
  const d = rb.descriptionHasTestData;
  const block = p.descriptionBlock;
  if (!d || typeof d !== 'object') mm.push({ field: 'test data', intended: { ids: block.ids, sha: block.sha }, actual: 'block not found in the description' });
  else {
    const ids = Array.isArray(d.ids) ? d.ids.map((x) => String(x).toUpperCase()) : [];
    const missingIds = block.ids.filter((id) => !ids.includes(id));
    const shaOk = (d.sha ?? null) === (block.sha ?? null);
    if (missingIds.length || !shaOk) mm.push({ field: 'test data', intended: { ids: block.ids, sha: block.sha }, actual: { ids, sha: d.sha ?? null }, missingIds, shaCurrent: shaOk });
  }
  const confirmedAdds = intersect(p.tagsAdd, actualTags);
  const introduced = uniq([...intersect(intersect(prevIntroduced, p.intendedTags), actualTags), ...confirmedAdds]);
  const verdict = mm.length ? 'MISMATCH' : p.status.action === 'conflict' ? 'CONFLICT' : 'verified';
  return {
    ...base, verdict, reason: mm.length ? mm.map((m) => m.field).join(', ') + ' differ from the plan' : p.status.action === 'conflict' ? p.status.reason : 'read back equal to the plan',
    introduced: sortTags(introduced), unverifiedAdds: sortTags(minus(p.tagsAdd, actualTags)), confirmedRemovals: sortTags(minus(p.tagsRemove, actualTags)),
    readBack: { id: actualId, tags: sortTags(actualTags), automationStatus: actualStatus, testData: d && typeof d === 'object' ? { ids: Array.isArray(d.ids) ? d.ids : [], sha: d.sha ?? null } : null },
  };
}

export function outcomeLine(outcome, counts, snapshot) {
  const parts = [];
  if (counts.mismatch) parts.push(counts.mismatch + ' mismatch');
  if (counts.conflict) parts.push(counts.conflict + ' conflict');
  if (counts.notVerified) parts.push(counts.notVerified + ' not verified');
  if (counts.notWritten) parts.push(counts.notWritten + ' not written');
  parts.push(counts.verified + ' of ' + counts.tcs + ' verified');
  parts.push('snapshot ' + snapshot);
  return outcome + ' (' + parts.join(' · ') + ')';
}

function mapCell(v) { return dash(v).replace(/\|/g, '/'); }
export function renderMap({ plan, results, publishedOn, suite, line }) {
  const h = plan.header || {};
  const out = [
    '<!-- source_sha256: ' + dash(plan.source && plan.source.sha256) + ' -->',
    '<!-- published_on: ' + publishedOn + ' · story: ' + dash(h.story) + ' · project: ' + dash(h.project) + ' · hosting: ' + dash(h.hosting) + ' -->',
    '<!-- ado-sync: ' + line + ' · schema ' + SCHEMA_VERSION + ' · hash ' + HASH_VERSION + ' -->',
    '| ' + MAP_COLUMNS.join(' | ') + ' |',
    '|' + MAP_COLUMNS.map(() => '---').join('|') + '|',
  ];
  for (const p of plan.tcs) {
    const v = results.find((r) => r.tcId === p.tcId);
    const prev = p.previous || {};
    const written = v.verdict !== 'NOT_WRITTEN';
    const id = v.readBack && v.readBack.id != null ? v.readBack.id : (p.workItemId !== 'create' ? p.workItemId : (prev.workItemId || null));
    let status;
    if (v.verdict === 'NOT_WRITTEN') status = 'not written' + (prev.status ? ' (was ' + prev.status + ')' : '');
    else if (p.status.action === 'conflict') status = dash(p.status.current) + ' (' + CONFLICT_REASON + ')';
    else if (p.status.action === 'unknown') status = UNKNOWN_REASON + (v.readBack && v.readBack.automationStatus ? ' — read back ' + v.readBack.automationStatus : '');
    else if (v.verdict === 'NOT_RUN') status = dash(p.status.intended) + ' (not verified)';
    else if (v.readBack) status = dash(v.readBack.automationStatus) + (v.verdict === 'MISMATCH' && v.mismatches.some((m) => m.field === 'automationStatus') ? ' (MISMATCH — intended ' + dash(p.status.intended) + ')' : '');
    else status = dash(p.status.intended);
    out.push('| ' + [
      p.tcId, mapCell(id), mapCell(written ? p.hash : prev.publishedSha256), mapCell(prev.automatedSha256), mapCell(p.candidacy), mapCell(status),
      mapCell(v.introduced.length ? v.introduced.join(', ') : null), mapCell(suite || prev.suite || 'skipped'),
    ].join(' | ') + ' |');
  }
  for (const r of (plan.previousMap && plan.previousMap.rowsNotInDocument) || []) {
    out.push('| ' + [r.tcId, mapCell(r.workItemId), mapCell(r.publishedSha256), mapCell(r.automatedSha256), REMOVED_ROW_NOTE, mapCell(r.status), mapCell(r.introduced && r.introduced.length ? r.introduced.join(', ') : null), mapCell(r.suite || 'skipped')].join(' | ') + ' |');
  }
  return out.join('\n') + '\n';
}

export function verifyFromInputs({ plan, readback, snapshot, attempt, publishedOn, suite }) {
  const warnings = []; const errors = [];
  const base = { tool: 'ado-sync-plan', schema: SCHEMA_VERSION, hash: HASH_VERSION, mode: 'verify', readOnly: true, attempt: Number(attempt) || 1 };
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.tcs)) return { ...base, outcome: OUTCOMES.BLOCKED, line: OUTCOMES.BLOCKED + ' (plan is not an ado-sync plan)', reason: '--plan must be the JSON payload of a `plan` run', warnings, errors };
  if (plan.gate !== 'PASS') return { ...base, outcome: OUTCOMES.BLOCKED, line: OUTCOMES.BLOCKED + ' (plan gate ' + plan.gate + ')', reason: 'the plan was ' + plan.gate + ': ' + plan.reason, warnings, errors };
  let items = readback; let snap = str(snapshot);
  if (readback && typeof readback === 'object' && !Array.isArray(readback) && readback.items && typeof readback.items === 'object') { items = readback.items; if (!snap && readback.snapshot) snap = String(readback.snapshot); }
  if (items === null || typeof items !== 'object' || Array.isArray(items)) return { ...base, outcome: OUTCOMES.BLOCKED, line: OUTCOMES.BLOCKED + ' (read-back is not a JSON object)', reason: '--readback must be a JSON object keyed by TC-ID (null per TC whose read-back was unavailable)', warnings, errors };
  if (!snap) snap = 'NOT_RUN';
  if (!SNAPSHOT_VALUES.has(snap)) { warnings.push('snapshot value "' + snap + '" is not attached | comment | NOT_RUN — reported as NOT_RUN'); snap = 'NOT_RUN'; }
  const results = plan.tcs.map((p) => verifyTc(p, items[p.tcId]));
  const counts = {
    tcs: results.length,
    verified: results.filter((r) => r.verdict === 'verified').length,
    mismatch: results.filter((r) => r.verdict === 'MISMATCH').length,
    conflict: results.filter((r) => r.verdict !== 'NOT_WRITTEN' && plan.tcs.find((p) => p.tcId === r.tcId).status.action === 'conflict').length,
    notVerified: results.filter((r) => r.verdict === 'NOT_RUN').length,
    notWritten: results.filter((r) => r.verdict === 'NOT_WRITTEN').length,
    unknownStatus: plan.tcs.filter((p) => p.status.action === 'unknown').length,
    unverifiedAdds: results.reduce((n, r) => n + r.unverifiedAdds.length, 0),
  };
  const outcome = counts.notWritten ? OUTCOMES.INCOMPLETE : (counts.mismatch || counts.conflict) ? OUTCOMES.MISMATCHES : counts.notVerified ? OUTCOMES.NOT_VERIFIED : OUTCOMES.VERIFIED;
  const line = outcomeLine(outcome, counts, snap);
  const mapText = renderMap({ plan, results, publishedOn: publishedOn || new Date().toISOString(), suite: str(suite), line });
  const retry = results.filter((r) => r.verdict === 'MISMATCH').map((r) => ({ tcId: r.tcId, fields: r.mismatches.map((m) => m.field) }));
  return {
    ...base, outcome, line, snapshot: snap, results, counts,
    retry: { needed: retry.length > 0, tcs: retry, note: retry.length ? 'rewrite exactly these fields through MCP, read back again and run verify with --attempt ' + (base.attempt + 1) : 'nothing to retry' },
    unverified: results.filter((r) => r.verdict === 'NOT_RUN' || r.verdict === 'NOT_WRITTEN' || r.unverifiedAdds.length).map((r) => ({ tcId: r.tcId, verdict: r.verdict, unverifiedAdds: r.unverifiedAdds, reason: r.reason })),
    map: { text: mapText, columns: MAP_COLUMNS, note: 'automated_tc_sha256 is copied through from the previous map — skill 5 owns it' },
    warnings, errors, writes: [],
  };
}

/* ---------------- CLI ---------------- */
const HELP = {
  tool: 'ado-sync-plan',
  usage: [
    'node ado-sync-plan.mjs hash --tc <TEST-CASES-*.md> [--data <TEST-DATA-*.md>] [--ids a,b] [--canonical] [--pretty]',
    'node ado-sync-plan.mjs plan --tc <approved TEST-CASES-*.md> [--data <TEST-DATA-*.md>] [--map <ADO-MAP.md>] --remote <json> --feature <name> [--convention-tags a,b] [--beautified <*-beautified.md>] [--story <id>] [--project <name>] [--hosting cloud|self-hosted] [--out <plan.json>] [--pretty] [--strict]',
    'node ado-sync-plan.mjs verify --plan <plan.json> --readback <json> [--snapshot attached|comment|NOT_RUN] [--attempt n] [--published-on <ISO>] [--suite <value>] [--write-map <ADO-MAP.md>] [--pretty] [--strict]',
  ],
  notes: [
    'Read-only unless --out (plan) / --write-map (verify). Default exit 0; --strict maps VERIFIED 0 · MISMATCHES 1 · NOT VERIFIED 2 · INCOMPLETE 3 · BLOCKED / NOT_RUN 4.',
    'MCP does every read and write; this script only decides. --tc is the APPROVED document (skill 5 hashes the same file).',
    'Tags (introduced) is persisted only after verified writes; automated_tc_sha256 is copied through untouched.',
  ],
};

function loadJson(p, what, errors) {
  const t = p ? read(p) : null;
  if (t === null) { errors.push(what + ' could not be read: ' + (p || 'none given')); return undefined; }
  try { return JSON.parse(t); } catch { errors.push(what + ' is not valid JSON: ' + p); return undefined; }
}

export function run(args) {
  const mode = str(args.mode) || args._[0] || null;
  const base = { tool: 'ado-sync-plan', schema: SCHEMA_VERSION, hash: HASH_VERSION, mode, readOnly: true };
  if (!mode || !['hash', 'plan', 'verify'].includes(mode)) return { ...base, gate: 'NOT_RUN', outcome: 'NOT_RUN', reason: 'mode must be hash | plan | verify', usage: HELP.usage };
  const tcPath = str(args.tc);
  if (mode === 'hash' || mode === 'plan') {
    if (!tcPath) return { ...base, gate: 'NOT_RUN', outcome: 'NOT_RUN', reason: '--tc <TEST-CASES-*.md> is required' };
    const tcBytes = readBytes(tcPath);
    if (!tcBytes) return { ...base, gate: 'NOT_RUN', outcome: 'NOT_RUN', reason: 'file not found: ' + tcPath };
    const tcText = tcBytes.toString('utf8');
    let dataPath = str(args.data);
    if (!dataPath) { const guess = path.join(path.dirname(tcPath), path.basename(tcPath).replace(/^TEST-CASES-/, 'TEST-DATA-').replace(/-beautified(\.md)$/, '$1')); if (fs.existsSync(guess)) dataPath = guess; }
    const dataBytes = dataPath ? readBytes(dataPath) : null;
    if (dataPath && !dataBytes) return { ...base, gate: 'BLOCKED', outcome: OUTCOMES.BLOCKED, reason: 'TEST-DATA file not found: ' + dataPath };
    const dataText = dataBytes ? dataBytes.toString('utf8') : '';
    if (mode === 'hash') {
      const ids = str(args.ids) ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : null;
      const all = hashDocument(tcText, dataText, ids);
      const payload = { ...base, gate: 'PASS', outcome: 'PASS', tc: tcPath, data: dataPath || null, count: Object.keys(all).length, hashes: {} };
      for (const [id, v] of Object.entries(all)) payload.hashes[id] = args.canonical ? v : v.hash;
      return payload;
    }
    const errors = [];
    const remote = loadJson(str(args.remote), '--remote', errors);
    if (errors.length) return { ...base, gate: 'BLOCKED', outcome: OUTCOMES.BLOCKED, reason: errors[0], errors };
    const mapPath = str(args.map);
    const mapText = mapPath ? read(mapPath) : null;
    const beautifiedPath = str(args.beautified);
    const beautifiedBytes = beautifiedPath ? readBytes(beautifiedPath) : null;
    if (beautifiedPath && !beautifiedBytes) return { ...base, gate: 'BLOCKED', outcome: OUTCOMES.BLOCKED, reason: 'beautified document not found: ' + beautifiedPath };
    const payload = planFromInputs({
      tcText, dataText, dataFile: dataPath ? path.basename(dataPath) : null, dataSha: dataBytes ? sha256(dataBytes) : null,
      mapText, remote, feature: str(args.feature), conventionTags: str(args['convention-tags']), sourceSha256: sha256(tcBytes),
      beautifiedText: beautifiedBytes ? beautifiedBytes.toString('utf8') : undefined, beautifiedSha256: beautifiedBytes ? sha256(beautifiedBytes) : null,
      story: str(args.story), project: str(args.project), hosting: str(args.hosting),
    });
    payload.outcome = payload.gate === 'PASS' ? 'PASS' : OUTCOMES.BLOCKED;
    payload.inputs = { tc: tcPath, data: dataPath || null, map: mapPath || null, remote: str(args.remote), beautified: beautifiedPath || null };
    payload.writes = [];
    if (mapPath && mapText === null) payload.warnings.push('--map given but not readable (' + mapPath + ') — treated as no previous map');
    const out = str(args.out);
    if (out && payload.gate === 'PASS') {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
      payload.readOnly = false; payload.writes.push({ file: out, kind: 'plan', bytes: fs.statSync(out).size });
    }
    return payload;
  }
  const errors = [];
  const plan = loadJson(str(args.plan), '--plan', errors);
  const readback = loadJson(str(args.readback), '--readback', errors);
  if (errors.length) return { ...base, outcome: OUTCOMES.BLOCKED, line: OUTCOMES.BLOCKED + ' (' + errors[0] + ')', reason: errors[0], errors };
  const payload = verifyFromInputs({ plan, readback, snapshot: str(args.snapshot), attempt: args.attempt, publishedOn: str(args['published-on']), suite: str(args.suite) });
  payload.inputs = { plan: str(args.plan), readback: str(args.readback), writeMap: str(args['write-map']) || null };
  const target = str(args['write-map']);
  if (target && payload.outcome !== OUTCOMES.BLOCKED) {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, payload.map.text);
    payload.readOnly = false; payload.writes.push({ file: target, kind: 'ado-map', bytes: fs.statSync(target).size });
  }
  return payload;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { print(HELP, !!args.pretty); return 0; }
  const payload = run(args);
  print(payload, !!args.pretty);
  if (!args.strict) return 0;
  const key = payload.mode === 'verify' ? payload.outcome : payload.gate;
  return STRICT_EXIT[key] ?? 4;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let code = 0;
  try { code = main(); }
  catch (e) {
    const args = parseArgs(process.argv.slice(2));
    print({ tool: 'ado-sync-plan', schema: SCHEMA_VERSION, gate: 'BLOCKED', outcome: OUTCOMES.BLOCKED, reason: 'internal error: ' + e.message }, !!args.pretty);
    code = args.strict ? 4 : 0;
  }
  process.exit(code);
}
