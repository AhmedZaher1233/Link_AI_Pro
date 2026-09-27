#!/usr/bin/env node
// selftest-ado-sync.mjs — regression harness for ado-sync-plan.mjs (+ the tc-hash.mjs it imports).
//
// THIS SCRIPT EXITS NON-ZERO ON MISMATCH, ON PURPOSE. It is a harness, not a reporting script.
// A failing self-test means the tag / status / ownership decisions cannot be trusted: the skill
// must then stop before any Azure DevOps write and report BLOCKED with the failing case.
//
// Every case is mocked: the "remote" and "read-back" JSON stand in for what the Azure DevOps MCP
// server would have returned. Nothing here talks to Azure DevOps. Goldens (fixtures/ado-sync/golden/)
// hash LF-normalised text so they do not depend on git's line-ending conversion; regenerate them
// only for a deliberate change: node selftest-ado-sync.mjs --regen
//
// GOLDEN_TC_HASH is the canonical hash of TC-SYNC-01 in fixtures/ado-sync/sample/ (TEST-CASES-sync.md
// + TEST-DATA-sync.md). Skill 5's harness asserts the same literal against its copy of tc-hash.mjs —
// a drift between the two copies shows up as a different hash.
//
// Run: node selftest-ado-sync.mjs [--pretty] [--regen]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { planFromInputs, verifyFromInputs, parseMap, OUTCOMES, MAP_COLUMNS, CONFLICT_REASON, UNKNOWN_REASON, REMOVED_ROW_NOTE, run } from './ado-sync-plan.mjs';
import { hashDocument, HASH_VERSION } from './tc-hash.mjs';

export const GOLDEN_TC_HASH = 'd50801ac8fade8ed1f138f8dd3d460372d18c19a2a320ee2ba5752e989daf863';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (...p) => path.join(here, 'fixtures', 'ado-sync', ...p);
const lf = (s) => s.replace(/\r\n?/g, '\n');
const readLf = (p) => lf(fs.readFileSync(p, 'utf8'));
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const regen = process.argv.includes('--regen');

const TC = readLf(fx('sample', 'TEST-CASES-sync.md'));
const DATA = readLf(fx('sample', 'TEST-DATA-sync.md'));
const LEGACY_MAP = readLf(fx('maps', 'legacy.ADO-MAP.md'));
const REMOTE = JSON.parse(fs.readFileSync(fx('remote', 'base.json'), 'utf8'));
const DATA_SHA = sha256(DATA);
const TC_SHA = sha256(TC);
const PUBLISHED_ON = '2026-09-27T10:00:00Z';
const hashOf = (id, tcText = TC, dataText = DATA) => hashDocument(tcText, dataText, [id])[id].hash;

const cases = [];
const fail = [];
function check(name, problems, detail) {
  cases.push({ case: name, ok: problems.length === 0, problems, detail });
  if (problems.length) fail.push({ case: name, problems });
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- helpers ---------- */
function mkPlan(o = {}) {
  return planFromInputs({
    tcText: TC, dataText: DATA, dataFile: 'TEST-DATA-sync.md', dataSha: DATA_SHA, mapText: null, remote: REMOTE, feature: 'sync',
    conventionTags: null, sourceSha256: TC_SHA, story: '4321', project: 'Sample Project', hosting: 'cloud', ...o,
  });
}
/** A read-back in which every TC is exactly what the plan intended (created items get id 1000 + index). */
function okReadback(plan, tweak) {
  const rb = {};
  plan.tcs.forEach((p, i) => {
    rb[p.tcId] = {
      id: p.workItemId === 'create' ? 1000 + i : p.workItemId,
      tags: [...p.tagsPreserve, ...p.tagsAdd],
      automationStatus: p.status.action === 'unknown' || p.status.action === 'conflict' ? p.status.current : p.status.intended,
      descriptionHasTestData: { ids: p.descriptionBlock.ids.slice(), sha: p.descriptionBlock.sha },
    };
  });
  if (tweak) tweak(rb);
  return rb;
}
const verify = (plan, readback, o = {}) => verifyFromInputs({ plan, readback, snapshot: 'attached', publishedOn: PUBLISHED_ON, ...o });
const tcOf = (payload, id) => payload.tcs.find((t) => t.tcId === id);
const resOf = (payload, id) => payload.results.find((r) => r.tcId === id);
/** An owned ADO-MAP.md (all 8 columns) built from short row specs. */
function ownedMap(rows) {
  const lines = [
    '<!-- source_sha256: ' + TC_SHA + ' -->',
    '<!-- published_on: 2026-09-20T09:00:00Z · story: 4321 · project: Sample Project · hosting: cloud -->',
    '| ' + MAP_COLUMNS.join(' | ') + ' |', '|' + MAP_COLUMNS.map(() => '---').join('|') + '|',
  ];
  for (const r of rows) lines.push('| ' + [r.id, r.wi ?? '—', r.pub ?? '—', r.auto ?? '—', r.cand ?? '—', r.status ?? '—', r.introduced ?? '—', r.suite ?? 'skipped'].join(' | ') + ' |');
  return lines.join('\n') + '\n';
}
const setField = (text, tcId, field, value) => {
  const start = text.indexOf('### ' + tcId + ' ');
  const end = text.indexOf('\n### ', start + 1);
  const block = text.slice(start, end < 0 ? undefined : end);
  const re = new RegExp('(- \\*\\*' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\*\\* ).*');
  if (!re.test(block)) throw new Error('fixture has no field ' + field + ' in ' + tcId);
  const next = block.replace(re, '$1' + value);
  return text.slice(0, start) + next + (end < 0 ? '' : text.slice(end));
};
const remoteWith = (patch) => { const r = clone(REMOTE); for (const [k, v] of Object.entries(patch)) r[k] = v; return r; };

const AUTOMATED_REMOTE = remoteWith({ 'TC-SYNC-04': { id: 104, tags: ['sync'], automationStatus: 'Automated', descriptionHasTestData: null } });

/* 1 — unrelated pre-existing tags preserved; intended set = feature + smoke + automation|manual + human-step + Tags: + convention. */
{
  const plan = mkPlan({ conventionTags: 'qa-team' });
  const p = [];
  const t1 = tcOf(plan, 'TC-SYNC-01');
  if (plan.gate !== 'PASS') p.push('gate ' + plan.gate);
  if (!t1.tagsPreserve.includes('manual-review')) p.push('pre-existing manual-review not preserved');
  if (t1.tagsAdd.includes('manual-review') || t1.tagsRemove.length) p.push('unrelated tag touched: ' + JSON.stringify({ add: t1.tagsAdd, remove: t1.tagsRemove }));
  if (!eq(t1.intendedTags, ['automation', 'qa-team', 'smoke', 'sync'])) p.push('TC-01 intended ' + JSON.stringify(t1.intendedTags));
  const t2 = tcOf(plan, 'TC-SYNC-02');
  if (!eq(t2.intendedTags, ['manual', 'qa-team', 'regression', 'sync'])) p.push('TC-02 intended ' + JSON.stringify(t2.intendedTags));
  const t3 = tcOf(plan, 'TC-SYNC-03');
  if (!t3.intendedTags.includes('human-step') || t3.humanSteps !== 1) p.push('[HUMAN] step did not yield the human-step tag');
  if (t3.workItemId !== 'create') p.push('TC-03 (no work item) should be "create"');
  const v = verify(plan, okReadback(plan));
  if (v.outcome !== OUTCOMES.VERIFIED) p.push('outcome ' + v.outcome);
  const r1 = resOf(v, 'TC-SYNC-01');
  if (r1.introduced.includes('manual-review') || r1.introduced.includes('sync')) p.push('a tag already on the work item became owned: ' + JSON.stringify(r1.introduced));
  if (!eq(r1.introduced, ['automation', 'qa-team', 'smoke'])) p.push('TC-01 introduced ' + JSON.stringify(r1.introduced));
  check('1 unrelated pre-existing tags preserved; intended set complete (feature, smoke, automation/manual, human-step, Tags:, convention)', p, { add: t1.tagsAdd, preserve: t1.tagsPreserve });
}

/* 2 — a document tag already in Azure is never marked introduced. */
{
  const plan = mkPlan();
  const p = [];
  const t2 = tcOf(plan, 'TC-SYNC-02');
  if (t2.tagsAdd.includes('regression')) p.push('regression (already on the work item) was planned as an add');
  const v = verify(plan, okReadback(plan));
  const r2 = resOf(v, 'TC-SYNC-02');
  if (!eq(r2.introduced, ['manual'])) p.push('TC-02 introduced ' + JSON.stringify(r2.introduced) + ' != ["manual"]');
  check('2 a document tag already in Azure is not marked introduced', p, {});
}

/* 3 — obsolete introduced tag removed when candidacy flips YES → NO. */
{
  const doc = setField(TC, 'TC-SYNC-01', 'Automation Candidate', 'NO');
  const map = ownedMap([{ id: 'TC-SYNC-01', wi: 101, pub: hashOf('TC-SYNC-01'), cand: 'YES', status: 'Planned', introduced: 'automation, smoke, sync' }]);
  const remote = remoteWith({ 'TC-SYNC-01': { id: 101, tags: ['manual-review', 'sync', 'automation', 'smoke'], automationStatus: 'Planned', descriptionHasTestData: null } });
  const plan = mkPlan({ tcText: doc, mapText: map, remote });
  const p = [];
  const t1 = tcOf(plan, 'TC-SYNC-01');
  if (!eq(t1.tagsRemove, ['automation'])) p.push('remove ' + JSON.stringify(t1.tagsRemove) + ' != ["automation"]');
  if (!eq(t1.tagsAdd, ['manual'])) p.push('add ' + JSON.stringify(t1.tagsAdd) + ' != ["manual"]');
  if (t1.tagsRemove.includes('manual-review') || !t1.tagsPreserve.includes('manual-review')) p.push('manual-review touched');
  if (t1.status.action !== 'write' || t1.status.intended !== 'Not Automated') p.push('status ' + JSON.stringify(t1.status));
  const v = verify(plan, okReadback(plan));
  const r1 = resOf(v, 'TC-SYNC-01');
  if (v.outcome !== OUTCOMES.VERIFIED) p.push('outcome ' + v.outcome);
  if (!eq(r1.introduced, ['manual', 'smoke', 'sync'])) p.push('introduced after removal ' + JSON.stringify(r1.introduced));
  if (!eq(r1.confirmedRemovals, ['automation'])) p.push('confirmedRemovals ' + JSON.stringify(r1.confirmedRemovals));
  check('3 obsolete introduced tag removed when candidacy flips (automation → manual, Planned → Not Automated)', p, { status: t1.status });
}

/* 4 — multi-run ownership: run 1 introduces {feature}; run 2 introduces uat; run 3 keeps it; run 4 drops it; manual-review untouched throughout. */
{
  const p = [];
  const docUat = setField(TC, 'TC-SYNC-01', 'Tags', 'uat');
  let remote = remoteWith({ 'TC-SYNC-01': { id: 101, tags: ['manual-review'], automationStatus: 'Planned', descriptionHasTestData: null } });
  // run 1
  const plan1 = mkPlan({ remote });
  const t1 = tcOf(plan1, 'TC-SYNC-01');
  if (!eq(t1.tagsAdd, ['automation', 'smoke', 'sync'])) p.push('run 1 add ' + JSON.stringify(t1.tagsAdd));
  const rb1 = okReadback(plan1); const v1 = verify(plan1, rb1);
  if (!eq(resOf(v1, 'TC-SYNC-01').introduced, ['automation', 'smoke', 'sync'])) p.push('run 1 introduced ' + JSON.stringify(resOf(v1, 'TC-SYNC-01').introduced));
  // run 2 — the document gained Tags: uat
  remote = rb1;
  const plan2 = mkPlan({ tcText: docUat, mapText: v1.map.text, remote });
  const t2 = tcOf(plan2, 'TC-SYNC-01');
  if (t2.ownership !== 'known') p.push('run 2 ownership ' + t2.ownership);
  if (!eq(t2.tagsAdd, ['uat']) || t2.tagsRemove.length) p.push('run 2 add/remove ' + JSON.stringify([t2.tagsAdd, t2.tagsRemove]));
  const rb2 = okReadback(plan2); const v2 = verify(plan2, rb2);
  if (!eq(resOf(v2, 'TC-SYNC-01').introduced, ['automation', 'smoke', 'sync', 'uat'])) p.push('run 2 introduced ' + JSON.stringify(resOf(v2, 'TC-SYNC-01').introduced));
  const mapRow2 = parseMap(v2.map.text).rows['TC-SYNC-01'];
  if (!eq(mapRow2.introduced, ['automation', 'smoke', 'sync', 'uat'])) p.push('run 2 map column ' + JSON.stringify(mapRow2.introduced));
  // run 3 — nothing changed
  remote = rb2;
  const plan3 = mkPlan({ tcText: docUat, mapText: v2.map.text, remote });
  const t3 = tcOf(plan3, 'TC-SYNC-01');
  if (t3.tagsAdd.length || t3.tagsRemove.length) p.push('run 3 should add / remove nothing: ' + JSON.stringify([t3.tagsAdd, t3.tagsRemove]));
  if (!t3.unchanged || t3.changes.length) p.push('run 3 TC-01 should be current (no change): ' + JSON.stringify(t3.changes));
  if (!tcOf(plan1, 'TC-SYNC-01').changes.includes('content') || tcOf(plan1, 'TC-SYNC-03').changes[0] !== 'create') p.push('run 1 changes wrong: ' + JSON.stringify([tcOf(plan1, 'TC-SYNC-01').changes, tcOf(plan1, 'TC-SYNC-03').changes]));
  const rb3 = okReadback(plan3); const v3 = verify(plan3, rb3);
  if (!eq(resOf(v3, 'TC-SYNC-01').introduced, ['automation', 'smoke', 'sync', 'uat'])) p.push('run 3 introduced ' + JSON.stringify(resOf(v3, 'TC-SYNC-01').introduced));
  if (lf(v3.map.text) !== lf(v2.map.text)) p.push('run 3 map differs from run 2 map although nothing changed');
  // run 4 — the document dropped uat
  remote = rb3;
  const plan4 = mkPlan({ mapText: v3.map.text, remote });
  const t4 = tcOf(plan4, 'TC-SYNC-01');
  if (!eq(t4.tagsRemove, ['uat']) || t4.tagsAdd.length) p.push('run 4 add/remove ' + JSON.stringify([t4.tagsAdd, t4.tagsRemove]));
  const rb4 = okReadback(plan4); const v4 = verify(plan4, rb4);
  const r4 = resOf(v4, 'TC-SYNC-01');
  if (!eq(r4.introduced, ['automation', 'smoke', 'sync'])) p.push('run 4 introduced ' + JSON.stringify(r4.introduced));
  if (rb4['TC-SYNC-01'].tags.includes('uat')) p.push('run 4 read-back still carries uat');
  for (const [i, rb] of [rb1, rb2, rb3, rb4].entries()) if (!rb['TC-SYNC-01'].tags.includes('manual-review')) p.push('run ' + (i + 1) + ' lost the pre-existing manual tag');
  for (const [i, t] of [t1, t2, t3, t4].entries()) if (t.tagsRemove.includes('manual-review') || t.tagsAdd.includes('manual-review')) p.push('run ' + (i + 1) + ' touched manual-review');
  for (const [i, v] of [v1, v2, v3, v4].entries()) if (resOf(v, 'TC-SYNC-01').introduced.includes('manual-review')) p.push('run ' + (i + 1) + ' recorded manual-review as introduced');
  check('4 multi-run ownership: run 1 {feature}+…, run 2 +uat, run 3 unchanged, run 4 −uat; pre-existing manual tag untouched', p, {});
}

/* 5 — a failed addition is not recorded as owned and is retried next run. */
{
  const p = [];
  const docUat = setField(TC, 'TC-SYNC-01', 'Tags', 'uat');
  const map = ownedMap([{ id: 'TC-SYNC-01', wi: 101, pub: hashOf('TC-SYNC-01'), cand: 'YES', status: 'Planned', introduced: 'automation, smoke, sync' }]);
  const remote = remoteWith({ 'TC-SYNC-01': { id: 101, tags: ['manual-review', 'automation', 'smoke', 'sync'], automationStatus: 'Planned', descriptionHasTestData: null } });
  const plan = mkPlan({ tcText: docUat, mapText: map, remote });
  const rb = okReadback(plan, (r) => { r['TC-SYNC-01'].tags = r['TC-SYNC-01'].tags.filter((t) => t !== 'uat'); });
  const v = verify(plan, rb);
  const r1 = resOf(v, 'TC-SYNC-01');
  if (r1.verdict !== 'MISMATCH' || !r1.mismatches.some((m) => m.field === 'tags' && eq(m.missing, ['uat']))) p.push('missing uat not reported as a tags MISMATCH: ' + JSON.stringify(r1.mismatches));
  if (r1.introduced.includes('uat')) p.push('failed addition recorded as owned');
  if (!eq(r1.unverifiedAdds, ['uat'])) p.push('unverifiedAdds ' + JSON.stringify(r1.unverifiedAdds));
  if (v.outcome !== OUTCOMES.MISMATCHES) p.push('outcome ' + v.outcome);
  const next = mkPlan({ tcText: docUat, mapText: v.map.text, remote: rb });
  if (!eq(tcOf(next, 'TC-SYNC-01').tagsAdd, ['uat'])) p.push('next run does not retry the add: ' + JSON.stringify(tcOf(next, 'TC-SYNC-01').tagsAdd));
  check('5 failed addition → tags MISMATCH, not owned, retried next run', p, {});
}

/* 6 — an addition whose read-back is NOT_RUN is not recorded and is listed unverified. */
{
  const p = [];
  const docUat = setField(TC, 'TC-SYNC-01', 'Tags', 'uat');
  const map = ownedMap([{ id: 'TC-SYNC-01', wi: 101, pub: hashOf('TC-SYNC-01'), cand: 'YES', status: 'Planned', introduced: 'automation, smoke, sync' }]);
  const remote = remoteWith({ 'TC-SYNC-01': { id: 101, tags: ['manual-review', 'automation', 'smoke', 'sync'], automationStatus: 'Planned', descriptionHasTestData: null } });
  const plan = mkPlan({ tcText: docUat, mapText: map, remote });
  const v = verify(plan, okReadback(plan, (r) => { r['TC-SYNC-01'] = null; }));
  const r1 = resOf(v, 'TC-SYNC-01');
  if (r1.verdict !== 'NOT_RUN') p.push('verdict ' + r1.verdict);
  if (r1.introduced.includes('uat') || !eq(r1.introduced, ['automation', 'smoke', 'sync'])) p.push('introduced ' + JSON.stringify(r1.introduced) + ' — previous record must survive, the add must not be recorded');
  if (!v.unverified.some((u) => u.tcId === 'TC-SYNC-01' && eq(u.unverifiedAdds, ['uat']))) p.push('TC-01 / uat not listed under unverified');
  if (v.outcome !== OUTCOMES.NOT_VERIFIED) p.push('outcome ' + v.outcome);
  if (!/1 not verified/.test(v.line)) p.push('line lacks the not-verified count: ' + v.line);
  check('6 NOT_RUN read-back: addition not recorded, listed unverified, outcome PUBLISHED, NOT VERIFIED', p, { line: v.line });
}

/* 7 — a confirmed removal leaves the ownership record. */
{
  const p = [];
  const map = ownedMap([{ id: 'TC-SYNC-01', wi: 101, pub: hashOf('TC-SYNC-01'), cand: 'YES', status: 'Planned', introduced: 'automation, smoke, sync, uat' }]);
  const remote = remoteWith({ 'TC-SYNC-01': { id: 101, tags: ['manual-review', 'automation', 'smoke', 'sync', 'uat'], automationStatus: 'Planned', descriptionHasTestData: null } });
  const plan = mkPlan({ mapText: map, remote });
  const t1 = tcOf(plan, 'TC-SYNC-01');
  if (!eq(t1.tagsRemove, ['uat'])) p.push('remove ' + JSON.stringify(t1.tagsRemove));
  const v = verify(plan, okReadback(plan));
  const r1 = resOf(v, 'TC-SYNC-01');
  if (r1.introduced.includes('uat')) p.push('removed tag still owned');
  if (!eq(r1.confirmedRemovals, ['uat'])) p.push('confirmedRemovals ' + JSON.stringify(r1.confirmedRemovals));
  if (!eq(parseMap(v.map.text).rows['TC-SYNC-01'].introduced, ['automation', 'smoke', 'sync'])) p.push('map column still holds uat');
  check('7 confirmed removal drops the ownership record', p, {});
}

/* 8 — Automated kept on equal automated_tc_sha256. */
{
  const p = [];
  const map = ownedMap([{ id: 'TC-SYNC-04', wi: 104, pub: hashOf('TC-SYNC-04'), auto: hashOf('TC-SYNC-04'), cand: '—', status: 'Automated', introduced: 'sync' }]);
  const plan = mkPlan({ mapText: map, remote: AUTOMATED_REMOTE });
  const t4 = tcOf(plan, 'TC-SYNC-04');
  if (t4.status.action !== 'keep' || t4.status.intended !== 'Automated') p.push('status ' + JSON.stringify(t4.status));
  const v = verify(plan, okReadback(plan));
  const row = parseMap(v.map.text).rows['TC-SYNC-04'];
  if (resOf(v, 'TC-SYNC-04').verdict !== 'verified') p.push('verdict ' + resOf(v, 'TC-SYNC-04').verdict);
  if (row.status !== 'Automated' || row.automatedSha256 !== hashOf('TC-SYNC-04')) p.push('map row ' + JSON.stringify(row) + ' — Automated / automated_tc_sha256 must be carried through untouched');
  check('8 Automated kept when automated_tc_sha256 equals the current canonical hash', p, {});
}

/* 9 — Automated + different hash → CONFLICT (status untouched, row flagged). */
{
  const p = [];
  const stale = 'f'.repeat(64);
  const map = ownedMap([{ id: 'TC-SYNC-04', wi: 104, pub: hashOf('TC-SYNC-04'), auto: stale, cand: '—', status: 'Automated', introduced: 'sync' }]);
  const plan = mkPlan({ mapText: map, remote: AUTOMATED_REMOTE });
  const t4 = tcOf(plan, 'TC-SYNC-04');
  if (t4.status.action !== 'conflict' || !t4.status.reason.startsWith(CONFLICT_REASON)) p.push('status ' + JSON.stringify(t4.status));
  if (t4.status.intended !== 'Automated') p.push('a conflict must leave the status untouched (intended = current)');
  const v = verify(plan, okReadback(plan));
  if (resOf(v, 'TC-SYNC-04').verdict !== 'CONFLICT') p.push('verdict ' + resOf(v, 'TC-SYNC-04').verdict);
  if (v.outcome !== OUTCOMES.MISMATCHES || !/1 conflict/.test(v.line)) p.push('outcome / line ' + v.line);
  const row = parseMap(v.map.text).rows['TC-SYNC-04'];
  if (!row.status.includes('CONFLICT') || row.automatedSha256 !== stale) p.push('map row not flagged / provenance not copied through: ' + JSON.stringify(row));
  check('9 Automated + different hash → CONFLICT, outcome PUBLISHED WITH MISMATCHES', p, { line: v.line });
}

/* 10 — Automated + no provenance (legacy map, or no map) → CONFLICT. */
{
  const p = [];
  for (const [label, mapText] of [['legacy map', LEGACY_MAP], ['no map', null]]) {
    const plan = mkPlan({ mapText, remote: AUTOMATED_REMOTE });
    const t4 = tcOf(plan, 'TC-SYNC-04');
    if (t4.status.action !== 'conflict' || !/no automated_tc_sha256 provenance/.test(t4.status.reason)) p.push(label + ': status ' + JSON.stringify(t4.status));
  }
  check('10 Automated without automated_tc_sha256 provenance → CONFLICT', p, {});
}

/* 11 — missing candidacy field → unknown, nothing written, no automation / manual tag. */
{
  const p = [];
  const plan = mkPlan();
  const t4 = tcOf(plan, 'TC-SYNC-04');
  if (t4.candidacy !== null || t4.status.action !== 'unknown' || t4.status.reason !== UNKNOWN_REASON || t4.status.intended !== null) p.push('status ' + JSON.stringify(t4.status));
  if (t4.intendedTags.includes('automation') || t4.intendedTags.includes('manual')) p.push('candidacy tag derived without a candidacy field');
  const v = verify(plan, okReadback(plan));
  if (resOf(v, 'TC-SYNC-04').verdict !== 'verified') p.push('an unknown status must not fail verification: ' + resOf(v, 'TC-SYNC-04').verdict);
  const row = parseMap(v.map.text).rows['TC-SYNC-04'];
  if (!row.status.startsWith(UNKNOWN_REASON) || row.candidate !== null) p.push('map row ' + JSON.stringify(row));
  check('11 missing candidacy → unknown (no candidacy field); nothing written', p, {});
}

/* 12 — mismatch after write (status read back differs from the plan). */
let planFor13 = null; let rbFor13 = null;
{
  const p = [];
  const plan = mkPlan();
  const rb = okReadback(plan, (r) => { r['TC-SYNC-02'].automationStatus = 'Planned'; });
  const v = verify(plan, rb);
  const r2 = resOf(v, 'TC-SYNC-02');
  if (r2.verdict !== 'MISMATCH' || !r2.mismatches.some((m) => m.field === 'automationStatus' && m.intended === 'Not Automated' && m.actual === 'Planned')) p.push('MISMATCH (automationStatus, Not Automated, Planned) not reported: ' + JSON.stringify(r2.mismatches));
  if (v.outcome !== OUTCOMES.MISMATCHES) p.push('outcome ' + v.outcome);
  if (!v.retry.needed || !v.retry.tcs.some((t) => t.tcId === 'TC-SYNC-02' && eq(t.fields, ['automationStatus']))) p.push('retry list wrong: ' + JSON.stringify(v.retry));
  if (!/MISMATCH — intended Not Automated/.test(parseMap(v.map.text).rows['TC-SYNC-02'].status)) p.push('map row not flagged');
  planFor13 = plan; rbFor13 = rb;
  check('12 mismatch after write → MISMATCH (field, intended, actual), retry named', p, { line: v.line });
}

/* 13 — the retry passes on the second read-back. */
{
  const p = [];
  const rb2 = clone(rbFor13); rb2['TC-SYNC-02'].automationStatus = 'Not Automated';
  const v = verify(planFor13, rb2, { attempt: 2 });
  if (v.outcome !== OUTCOMES.VERIFIED || v.attempt !== 2) p.push('outcome ' + v.outcome + ' attempt ' + v.attempt);
  if (v.retry.needed) p.push('retry still needed');
  check('13 retry passes on the second read-back (attempt 2 → PUBLISHED AND VERIFIED)', p, { line: v.line });
}

/* 14 — read-back unavailable for every TC → PUBLISHED, NOT VERIFIED; a snapshot NOT_RUN is reported, never blocking. */
{
  const p = [];
  const plan = mkPlan();
  const rb = {}; for (const t of plan.tcs) rb[t.tcId] = null;
  const v = verifyFromInputs({ plan, readback: rb, publishedOn: PUBLISHED_ON });
  if (v.outcome !== OUTCOMES.NOT_VERIFIED) p.push('outcome ' + v.outcome);
  if (v.results.some((r) => r.verdict !== 'NOT_RUN')) p.push('every verdict must be NOT_RUN');
  if (v.snapshot !== 'NOT_RUN' || !/snapshot NOT_RUN/.test(v.line) || !/4 not verified/.test(v.line)) p.push('line ' + v.line);
  const rows = parseMap(v.map.text).rows;
  if (rows['TC-SYNC-01'].introduced !== null && rows['TC-SYNC-01'].introduced.length) p.push('ownership recorded without a read-back');
  if (!/\(not verified\)$/.test(rows['TC-SYNC-02'].status)) p.push('map status not marked as unverified: ' + rows['TC-SYNC-02'].status);
  const ok = verify(plan, okReadback(plan), { snapshot: 'NOT_RUN' });
  if (ok.outcome !== OUTCOMES.VERIFIED || !/snapshot NOT_RUN/.test(ok.line)) p.push('a supplementary snapshot NOT_RUN must not prevent PUBLISHED AND VERIFIED: ' + ok.line);
  check('14 read-back unavailable → PUBLISHED, NOT VERIFIED; snapshot NOT_RUN reported, not blocking', p, { line: v.line });
}

/* 15 — legacy map without ownership / hash columns: nothing removed, ownership unknown, column initialised from verified adds, removed-row kept. */
{
  const p = [];
  const plan = mkPlan({ mapText: LEGACY_MAP });
  if (plan.previousMap.ownershipKnown || plan.previousMap.hashesKnown) p.push('legacy map reported as having the new columns');
  if (!plan.warnings.some((w) => /ownership is unknown/.test(w))) p.push('no ownership warning');
  const t2 = tcOf(plan, 'TC-SYNC-02');
  if (t2.ownership !== 'unknown' || t2.tagsRemove.length) p.push('legacy map must remove nothing: ' + JSON.stringify(t2));
  if (!t2.tagsPreserve.includes('automation')) p.push('automation (unowned under a legacy map) not preserved');
  if (!plan.previousMap.rowsNotInDocument.some((r) => r.tcId === 'TC-SYNC-09' && r.note === REMOVED_ROW_NOTE)) p.push('TC-SYNC-09 (in the map, not in the document) not carried');
  const v = verify(plan, okReadback(plan));
  const map = parseMap(v.map.text);
  if (!eq(map.columns, MAP_COLUMNS)) p.push('new map columns ' + JSON.stringify(map.columns));
  if (!map.ownershipKnown || !map.hashesKnown) p.push('new map lacks the ownership / hash columns');
  if (!eq(map.rows['TC-SYNC-01'].introduced, ['automation', 'smoke'])) p.push('column not initialised from verified adds: ' + JSON.stringify(map.rows['TC-SYNC-01'].introduced));
  if (!eq(map.rows['TC-SYNC-02'].introduced, ['manual'])) p.push('TC-02 column ' + JSON.stringify(map.rows['TC-SYNC-02'].introduced));
  if (map.rows['TC-SYNC-01'].publishedSha256 !== hashOf('TC-SYNC-01')) p.push('published_tc_sha256 not filled');
  if (map.rows['TC-SYNC-01'].automatedSha256 !== null) p.push('automated_tc_sha256 invented');
  const r9 = map.rows['TC-SYNC-09'];
  if (!r9 || r9.candidate !== REMOVED_ROW_NOTE || r9.workItemId !== '109') p.push('TC-SYNC-09 row not kept as removed-from-document: ' + JSON.stringify(r9));
  if (!/^<!-- source_sha256: /.test(v.map.text) || !new RegExp('story: 4321 · project: Sample Project · hosting: cloud').test(v.map.text)) p.push('header lines wrong');
  check('15 legacy map without ownership / hash columns: nothing removed, column initialised from verified adds, removed row kept', p, {});
}

/* 16 — the canonical-hash test set + the golden constant (asserted by skill 5's harness too). */
{
  const p = [];
  const h = (tcText, dataText = DATA, id = 'TC-SYNC-01') => hashOf(id, tcText, dataText);
  const base = h(TC);
  if (base !== GOLDEN_TC_HASH) p.push('GOLDEN_TC_HASH ' + GOLDEN_TC_HASH + ' != computed ' + base + ' (' + HASH_VERSION + ')');
  // formatting-only edit → same: bold, extra spaces, renumbered steps outside quotes
  const formatted = TC.replace('  1. Open Products — the Products list is visible.\n  2. Enter "Sample" in the "Search" field.\n  3. Click "Search" — the list reloads.', '  7. **Open**   Products —   the Products list is visible.\n  8. Enter "Sample" in the   "Search" field.\n  9. Click "Search" —  the list reloads.');
  if (formatted === TC) p.push('fixture edit for the formatting case did not apply');
  if (h(formatted) !== base) p.push('formatting-only edit changed the hash');
  // whitespace INSIDE quotes → different
  const quoted = TC.replace('Enter "Sample" in the "Search" field.', 'Enter "Sam  ple" in the "Search" field.');
  if (h(quoted) === base) p.push('"a  b" vs "a b" inside quotes did not change the hash');
  // expected message changed inside quotes → different
  const msg = TC.replace('the name cell reads "Sample".', 'the name cell reads "Sample product".');
  if (h(msg) === base) p.push('changed expected message inside quotes did not change the hash');
  // D-row Must look like → different
  const dRow = DATA.replace('| D1 | Product "Sample" | active, price 10.00 |', '| D1 | Product "Sample" | active, price 12.00 |');
  if (dRow === DATA || h(TC, dRow) === base) p.push('D-row Must-look-like change did not change the hash');
  // A-row role → different
  const aRole = DATA.replace('| A1 | Administrator | admin.user |', '| A1 | Supervisor | admin.user |');
  if (aRole === DATA || h(TC, aRole) === base) p.push('A-row role change did not change the hash');
  // A-row username → same
  const aUser = DATA.replace('| A1 | Administrator | admin.user |', '| A1 | Administrator | other.admin |');
  if (aUser === DATA || h(TC, aUser) !== base) p.push('A-row username change changed the hash');
  // E-row URL → same
  const eUrl = DATA.replace('https://portal.example.com', 'https://portal-2.example.com');
  if (eUrl === DATA || h(TC, eUrl) !== base) p.push('E-row URL change changed the hash');
  // Shared data → different
  const shared = setField(TC, 'TC-SYNC-01', 'Shared data', 'Product list with 3 items [D2]');
  if (h(shared) === base) p.push('Shared data change did not change the hash');
  // Validation / evidence stamp / Tags → same
  let meta = setField(TC, 'TC-SYNC-01', 'Validation', 'validated');
  meta = setField(meta, 'TC-SYNC-01', 'Tags', 'uat, regression');
  meta = meta.replace('- **Tags:** uat, regression\n- **Validation:** validated', '- **Tags:** uat, regression\n- **Validation:** validated\n<!-- tc-evidence\nvalidated-on: 2026-09-27\nenv: staging\ntool: mcp\n-->');
  if (h(meta) !== base) p.push('Validation / evidence stamp / Tags change changed the hash');
  check('16 canonical hash: formatting-only same; quoted whitespace, expected message, D-row shape, A-row role, Shared data different; username, E-row URL, Validation / stamp / Tags same; golden constant', p, { golden: GOLDEN_TC_HASH });
}

/* 17 — test-data block missing a referenced ID, or a stale file hash → MISMATCH (test data). */
{
  const p = [];
  const plan = mkPlan();
  const v = verify(plan, okReadback(plan, (r) => { r['TC-SYNC-01'].descriptionHasTestData.ids = ['A1', 'E1']; r['TC-SYNC-02'].descriptionHasTestData.sha = 'stale'; r['TC-SYNC-03'].descriptionHasTestData = null; }));
  const r1 = resOf(v, 'TC-SYNC-01'); const r2 = resOf(v, 'TC-SYNC-02'); const r3 = resOf(v, 'TC-SYNC-03');
  if (r1.verdict !== 'MISMATCH' || !r1.mismatches.some((m) => m.field === 'test data' && eq(m.missingIds, ['D1']))) p.push('missing D1 not reported: ' + JSON.stringify(r1.mismatches));
  if (r2.verdict !== 'MISMATCH' || !r2.mismatches.some((m) => m.field === 'test data' && m.shaCurrent === false)) p.push('stale sha not reported: ' + JSON.stringify(r2.mismatches));
  if (r3.verdict !== 'MISMATCH' || !r3.mismatches.some((m) => m.field === 'test data' && m.actual === 'block not found in the description')) p.push('missing block not reported: ' + JSON.stringify(r3.mismatches));
  if (v.outcome !== OUTCOMES.MISMATCHES || !/3 mismatch/.test(v.line)) p.push('line ' + v.line);
  const t1 = tcOf(plan, 'TC-SYNC-01');
  if (!/\[A1\] Administrator — username: admin\.user/.test(t1.descriptionBlock.text) || !/TEST-DATA-sync\.md \(sha256 /.test(t1.descriptionBlock.text) || /password/i.test(t1.descriptionBlock.text.replace(/passwords are never listed here/, ''))) p.push('description block text wrong: ' + t1.descriptionBlock.text);
  check('17 test-data block missing a referenced ID / stale sha / absent → MISMATCH (test data)', p, { line: v.line });
}

/* 18 — one write failure → PUBLICATION INCOMPLETE, listed with the error; the other TCs still verified. */
{
  const p = [];
  const plan = mkPlan();
  const v = verify(plan, okReadback(plan, (r) => { r['TC-SYNC-03'] = { writeError: 'TF401320: rule violation on field AutomationStatus' }; }));
  const r3 = resOf(v, 'TC-SYNC-03');
  if (r3.verdict !== 'NOT_WRITTEN' || !/TF401320/.test(r3.reason)) p.push('write failure not reported: ' + JSON.stringify(r3));
  if (v.outcome !== OUTCOMES.INCOMPLETE || !/1 not written/.test(v.line) || !/3 of 4 verified/.test(v.line)) p.push('line ' + v.line);
  if (!v.unverified.some((u) => u.tcId === 'TC-SYNC-03' && u.verdict === 'NOT_WRITTEN')) p.push('not listed under unverified');
  const row = parseMap(v.map.text).rows['TC-SYNC-03'];
  if (!row || row.publishedSha256 !== null || !/^not written/.test(row.status)) p.push('map row must not claim a publish: ' + JSON.stringify(row));
  if (resOf(v, 'TC-SYNC-01').verdict !== 'verified') p.push('the other TCs must still verify');
  check('18 one write failure → PUBLICATION INCOMPLETE with the error; no hash claimed for the unwritten TC', p, { line: v.line });
}

/* 19 — password-shaped row → plan BLOCKED; beautified TC-ID set mismatch → BLOCKED; TEST-DATA absent → warning, block without rows. */
{
  const p = [];
  const leaky = DATA.replace('| used for login in every TC |', '| password: Sample123 |');
  const b = mkPlan({ dataText: leaky });
  if (b.gate !== 'BLOCKED' || !/password-shaped/.test(b.reason)) p.push('password-shaped row not blocked: ' + b.gate + ' ' + b.reason);
  const trimmed = TC.slice(0, TC.indexOf('### TC-SYNC-04'));
  const mm = mkPlan({ beautifiedText: trimmed });
  if (mm.gate !== 'BLOCKED' || !/TC-ID set differs/.test(mm.reason)) p.push('beautified TC-ID drift not blocked');
  const nodata = mkPlan({ dataText: '', dataFile: null, dataSha: null });
  if (nodata.gate !== 'PASS' || !nodata.warnings.some((w) => /no TEST-DATA file/.test(w))) p.push('missing TEST-DATA must warn, not block');
  if (!tcOf(nodata, 'TC-SYNC-01').descriptionBlock.unresolved.includes('A1')) p.push('unresolved refs not listed without a TEST-DATA file');
  check('19 gates: password-shaped row → BLOCKED; beautified TC-ID drift → BLOCKED; no TEST-DATA → warning', p, {});
}

/* 20 — goldens (plan.json, ADO-MAP.md), --write-map vs dry-run, and --strict exit codes through the CLI. */
{
  const p = [];
  const plan = mkPlan({ mapText: LEGACY_MAP });
  const readback = okReadback(plan);
  const v = verify(plan, readback);
  const goldenPlan = fx('golden', 'plan.json'); const goldenMap = fx('golden', 'ADO-MAP.md'); const rbFile = fx('readback', 'base.json');
  if (regen) {
    fs.writeFileSync(goldenPlan, JSON.stringify(plan, null, 2) + '\n');
    fs.writeFileSync(goldenMap, v.map.text);
    fs.writeFileSync(rbFile, JSON.stringify(readback, null, 2) + '\n');
  }
  if (!fs.existsSync(goldenPlan) || !fs.existsSync(goldenMap) || !fs.existsSync(rbFile)) p.push('goldens missing — run with --regen once, deliberately');
  else {
    if (lf(JSON.stringify(plan, null, 2) + '\n') !== readLf(goldenPlan)) p.push('plan payload differs from golden/plan.json — regenerate only for a deliberate change');
    if (lf(v.map.text) !== readLf(goldenMap)) p.push('ADO-MAP.md differs from golden/ADO-MAP.md — regenerate only for a deliberate change');
    if (v.outcome !== OUTCOMES.VERIFIED) p.push('golden scenario outcome ' + v.outcome);
  }
  const script = path.join(here, 'ado-sync-plan.mjs');
  const call = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ado-sync-'));
  try {
    const planFile = path.join(tmp, 'plan.json');
    const planned = call(['plan', '--tc', fx('sample', 'TEST-CASES-sync.md'), '--map', fx('maps', 'legacy.ADO-MAP.md'), '--remote', fx('remote', 'base.json'), '--feature', 'sync', '--story', '4321', '--project', 'Sample Project', '--hosting', 'cloud', '--out', planFile, '--strict']);
    if (planned.status !== 0) p.push('plan --strict exit ' + planned.status + ' != 0: ' + planned.stderr);
    let cliPlan = null; try { cliPlan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch { p.push('--out did not write a readable plan'); }
    if (cliPlan && cliPlan.tcs.find((t) => t.tcId === 'TC-SYNC-01').hash !== GOLDEN_TC_HASH) p.push('CLI plan hash differs from the golden constant');
    // the CLI read-back must carry the CLI plan's data sha (raw bytes may differ from the LF-normalised golden)
    const cliRb = okReadback(cliPlan); const rbCli = path.join(tmp, 'readback.json'); fs.writeFileSync(rbCli, JSON.stringify(cliRb));
    const dry = call(['verify', '--plan', planFile, '--readback', rbCli, '--snapshot', 'attached', '--published-on', PUBLISHED_ON]);
    let dryOut = null; try { dryOut = JSON.parse(dry.stdout); } catch { p.push('verify stdout is not a single JSON object'); }
    if (dry.status !== 0) p.push('default exit ' + dry.status + ' != 0');
    if (dryOut && (dryOut.readOnly !== true || dryOut.writes.length)) p.push('a dry run wrote something');
    const mapOut = path.join(tmp, 'ADO-MAP.md');
    const wrote = call(['verify', '--plan', planFile, '--readback', rbCli, '--snapshot', 'attached', '--published-on', PUBLISHED_ON, '--write-map', mapOut, '--strict']);
    if (wrote.status !== 0) p.push('VERIFIED exit ' + wrote.status + ' != 0');
    if (!fs.existsSync(mapOut) || lf(fs.readFileSync(mapOut, 'utf8')) !== lf(dryOut ? dryOut.map.text : '')) p.push('--write-map did not write the payload\'s map text');
    const mmRb = clone(cliRb); mmRb['TC-SYNC-02'].automationStatus = 'Planned'; fs.writeFileSync(path.join(tmp, 'mm.json'), JSON.stringify(mmRb));
    if (call(['verify', '--plan', planFile, '--readback', path.join(tmp, 'mm.json'), '--strict']).status !== 1) p.push('MISMATCHES exit != 1');
    const nrRb = clone(cliRb); nrRb['TC-SYNC-01'] = null; fs.writeFileSync(path.join(tmp, 'nr.json'), JSON.stringify(nrRb));
    if (call(['verify', '--plan', planFile, '--readback', path.join(tmp, 'nr.json'), '--strict']).status !== 2) p.push('NOT VERIFIED exit != 2');
    const incRb = clone(cliRb); incRb['TC-SYNC-03'] = { writeError: 'boom' }; fs.writeFileSync(path.join(tmp, 'inc.json'), JSON.stringify(incRb));
    if (call(['verify', '--plan', planFile, '--readback', path.join(tmp, 'inc.json'), '--strict']).status !== 3) p.push('INCOMPLETE exit != 3');
    if (call(['verify', '--plan', path.join(tmp, 'missing.json'), '--readback', rbCli, '--strict']).status !== 4) p.push('BLOCKED exit != 4');
    if (call(['--strict']).status !== 4) p.push('no mode → NOT_RUN exit != 4');
    const h = call(['hash', '--tc', fx('sample', 'TEST-CASES-sync.md'), '--ids', 'TC-SYNC-01']);
    let hOut = null; try { hOut = JSON.parse(h.stdout); } catch { p.push('hash stdout is not JSON'); }
    if (hOut && hOut.hashes['TC-SYNC-01'] !== GOLDEN_TC_HASH) p.push('hash mode differs from the golden constant');
    const rNoMode = run({ _: [] }); if (rNoMode.gate !== 'NOT_RUN') p.push('run() without a mode should be NOT_RUN');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('20 goldens match; --write-map writes, dry-run does not; strict exit codes VERIFIED 0 · MISMATCHES 1 · NOT VERIFIED 2 · INCOMPLETE 3 · BLOCKED / NOT_RUN 4', p, {});
}

/* 21 — SHARED FIXTURE + MIRROR: fixtures/tc-hash/ is the pair skill 5's selftest-tc-hash.mjs hashes; both harnesses assert the same golden, and skill 5's tc-hash.mjs must be byte-identical to this canonical copy (skipped when the sibling is absent). */
export const GOLDEN_SHARED_TC_HASH = '935858124e72e0dd04faac4bdcc7870cd70171fbb00cdf851033120ad7c79bb8';
{
  const p = []; let skipped = false;
  const shared = (f) => path.join(here, 'fixtures', 'tc-hash', f);
  const h = hashDocument(readLf(shared('TEST-CASES-hash-sample.md')), readLf(shared('TEST-DATA-hash-sample.md')), ['TC-HASH-01']);
  if (!h['TC-HASH-01'] || h['TC-HASH-01'].hash !== GOLDEN_SHARED_TC_HASH) p.push('shared fixture hash ' + (h['TC-HASH-01'] ? h['TC-HASH-01'].hash : 'missing') + ' != GOLDEN_SHARED_TC_HASH (skill 5 asserts the same value)');
  const sib = path.resolve(here, '..', '..', 'link-qc-5-test-run-automation', 'scripts');
  if (!fs.existsSync(path.join(sib, 'tc-hash.mjs'))) skipped = true;
  else {
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (sha(path.join(here, 'tc-hash.mjs')) !== sha(path.join(sib, 'tc-hash.mjs'))) p.push('skill 5\'s tc-hash.mjs differs from this canonical copy — copy it byte for byte');
    for (const f of ['TEST-CASES-hash-sample.md', 'TEST-DATA-hash-sample.md']) { const o = path.join(sib, 'fixtures', 'tc-hash', f); if (fs.existsSync(o) && readLf(o) !== readLf(shared(f))) p.push('fixture ' + f + ' differs from skill 5\'s copy'); }
  }
  check('21 shared tc-hash fixture matches the golden both harnesses assert; skill 5 copy byte-identical', p, { skipped, golden: GOLDEN_SHARED_TC_HASH });
}

const out = {
  tool: 'selftest-ado-sync',
  ran: cases.length,
  ok: fail.length === 0,
  goldenTcHash: GOLDEN_TC_HASH,
  cases,
  mismatches: fail,
  note: fail.length ? 'ado-sync-plan.mjs disagrees with its own fixtures. Do not publish on its decisions; report BLOCKED with the failing case.' : 'All fixtures behave as documented.',
};
process.stdout.write(JSON.stringify(out, null, process.argv.includes('--pretty') ? 2 : 0) + '\n');
process.exit(fail.length ? 1 : 0);
