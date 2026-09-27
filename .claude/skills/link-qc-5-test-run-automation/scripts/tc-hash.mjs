#!/usr/bin/env node
// MIRROR — byte-identical copies live in link-qc-4-publish-test-cases-azure/scripts/ (canonical)
// and link-qc-5-test-run-automation/scripts/. /sync-skills copies one skill folder at a time, so
// neither skill imports the other's copy. Edit both; each skill's harness asserts the same golden
// hash for the same fixture, which catches drift.
//
// Canonical test-case hash — SEMANTIC, not textual.
//
//   hash = sha256( behaviour fields of the TC  +  fingerprint of the data rows it references )
//
// Behaviour fields: Locale, Requirement, Preconditions, Steps, Expected Result, Data Oracle,
// Data effect, Shared data. Everything else (Validation, the evidence stamp, Smoke, Automation
// Candidate, Tags, Description, the heading) is excluded — it never changes what the TC does.
//
// Normalisation touches ONLY text outside literal inputs / outputs. A quoted segment ("…", “…”,
// «…», `…`) is a typed value or an exact expected message and is kept byte-for-byte, whitespace
// included. Outside quotes: markdown emphasis (** __ * _) is stripped, whitespace runs collapse
// to one space, list numbering is dropped (the parser already yields item text), tokens such as
// [HUMAN], [A1], [E2], [D3] are kept.
//
// Fingerprint of referenced data (from TEST-DATA-{feature}.md): [A{n}] → the account's role and
// note; [D{n}] → the item's plain name and "Must look like"; [E{n}] → the row's "What" (the kind
// of service). Usernames, passwords (never in the file), environment URL values, statuses,
// "Where I checked" and dates are EXCLUDED — changing them is routine and never invalidates an
// automation match. A referenced ID with no row is fingerprinted as "?" so the gap is visible.
//
// Zero dependencies, read-only, Node >= 18. CLI:
//   node tc-hash.mjs --tc <TEST-CASES-*.md> [--data <TEST-DATA-*.md>] [--ids a,b] [--canonical] --pretty
// Always exits 0; the result is the JSON payload.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const HASH_VERSION = 'tc-hash/1';

/* ---------------- small helpers ---------------- */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n !== undefined && !n.startsWith('--')) { out[k] = n; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}
export function print(payload, pretty) { process.stdout.write((pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload)) + '\n'); }
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* ---------------- TC document parser (fields by name, never by position) ---------------- */
function parseFieldBullets(lines) {
  const fields = {}; let cur = null;
  for (const l of lines) {
    if (/^<!--/.test(l.trim())) { cur = null; continue; }
    const m = l.match(/^\s{0,1}[-*]\s+\*\*([^*]+?):\*\*\s*(.*)$/) || l.match(/^\*\*([^*]+?):\*\*\s*(.*)$/);
    if (m) { cur = { name: m[1].trim(), value: m[2].trim(), items: [] }; fields[cur.name] = cur; continue; }
    if (!cur) continue;
    const li = l.match(/^\s{2,}(?:\d+[.)]|[-*])\s+(.*)$/);
    if (li) { cur.items.push(li[1].trim()); continue; }
    if (/^\s{2,}\S/.test(l)) { if (cur.items.length) cur.items[cur.items.length - 1] += ' ' + l.trim(); else cur.value = (cur.value + ' ' + l.trim()).trim(); continue; }
    if (l.trim() === '') continue;
    cur = null;
  }
  return fields;
}

/** Every `### {TC-ID} — {Description}` block (PB-n / Q-n headings are skipped). */
export function parseTcDocument(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tcs = [];
  let i = 0;
  while (i < lines.length) {
    const h = lines[i].match(/^###\s+([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+)\s*(?:—|-|:)?\s*(.*)$/);
    if (!h || /^###\s+(PB|Q)-\d+/.test(lines[i])) { i++; continue; }
    const id = h[1]; const title = h[2].trim();
    let j = i + 1;
    while (j < lines.length && !/^#{1,3}\s/.test(lines[j])) j++;
    const fields = parseFieldBullets(lines.slice(i + 1, j));
    tcs.push({ id, title, fields });
    i = j;
  }
  return tcs;
}

/* ---------------- TEST-DATA parser ---------------- */
function tableRows(sectionLines) {
  const rows = [];
  let header = null;
  for (const l of sectionLines) {
    if (!/^\|/.test(l.trim())) { if (header) break; continue; }
    const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!header) { header = cells.map((c) => c.toLowerCase()); continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const row = {}; header.forEach((k, idx) => { row[k] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}
function section(lines, re) {
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return [];
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  return lines.slice(start + 1, end);
}
/** { env: {E1:{what,value,status}}, accounts: {A1:{role,username,status,note}}, items: {D1:{name,mustLookLike,status}} } */
export function parseTestData(text) {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  const env = {}; const accounts = {}; const items = {};
  for (const r of tableRows(section(lines, /^##\s*0\.\s*Environment/i))) {
    const id = (r.id || '').toUpperCase(); if (!/^E\d+$/.test(id)) continue;
    env[id] = { what: r.what || '', value: r.value || '', status: r.status || '' };
  }
  for (const r of tableRows(section(lines, /^##\s*1\.\s*Accounts/i))) {
    const id = (r.id || '').toUpperCase(); if (!/^A\d+$/.test(id)) continue;
    accounts[id] = { role: r.role || '', username: r.username || '', status: r.status || '', note: r.note || '' };
  }
  for (const r of tableRows(section(lines, /^##\s*2\.\s*Test data at a glance/i))) {
    const id = (r['#'] || r.id || '').toUpperCase(); if (!/^D\d+$/.test(id)) continue;
    items[id] = { name: r['data item (plain name)'] || r['data item'] || '', mustLookLike: r['must look like'] || '', status: r.status || '', usedBy: r['used by tcs'] || '' };
  }
  return { env, accounts, items };
}

/* ---------------- canonical form ---------------- */
const QUOTE_PAIRS = [['"', '"'], ['“', '”'], ['«', '»'], ['`', '`']];
/** Split into [{q:true,text}|{q:false,text}] segments; an unclosed opener is plain text. */
export function splitQuoted(s) {
  const out = []; let i = 0; let plain = '';
  while (i < s.length) {
    const pair = QUOTE_PAIRS.find(([o]) => s[i] === o);
    if (pair) {
      const close = s.indexOf(pair[1], i + 1);
      if (close > i) {
        if (plain) { out.push({ q: false, text: plain }); plain = ''; }
        out.push({ q: true, text: s.slice(i, close + 1) });
        i = close + 1; continue;
      }
    }
    plain += s[i]; i++;
  }
  if (plain) out.push({ q: false, text: plain });
  return out;
}
const normPlain = (t) => t.replace(/\*\*|__/g, '').replace(/(^|[^\w])[*_](?=\S)/g, '$1').replace(/(\S)[*_](?=[^\w]|$)/g, '$1').replace(/\s+/g, ' ');
/** Quoted segments verbatim; plain segments emphasis-stripped and whitespace-collapsed. */
export function normText(s) {
  return splitQuoted(String(s ?? '')).map((seg) => (seg.q ? seg.text : normPlain(seg.text))).join('').trim();
}
const REF_RE = /\[([AED])(\d+)\]/g;

export const BEHAVIOUR_FIELDS = ['Locale', 'Requirement', 'Preconditions', 'Steps', 'Expected Result', 'Data Oracle', 'Data effect', 'Shared data'];

function fieldText(tc, name) {
  const k = Object.keys(tc.fields).find((x) => x.toLowerCase() === name.toLowerCase());
  if (!k) return { value: '', items: [] };
  return tc.fields[k];
}

/** The canonical string (what gets hashed). Deterministic; independent of the clock and the path. */
export function canonicalTc(tc, data) {
  const d = data || { env: {}, accounts: {}, items: {} };
  const parts = [HASH_VERSION, 'id=' + tc.id];
  const refs = new Set();
  const collect = (s) => { for (const m of String(s ?? '').matchAll(REF_RE)) refs.add(m[1] + m[2]); };
  for (const f of BEHAVIOUR_FIELDS) {
    const { value, items } = fieldText(tc, f);
    collect(value); items.forEach(collect);
    const body = items.length ? items.map((it) => normText(it)).join('\u001f') : normText(value);
    parts.push(f + '=' + body);
  }
  const fp = [...refs].sort().map((id) => {
    const kind = id[0];
    if (kind === 'A') { const a = d.accounts[id]; return id + '=' + (a ? [a.role, a.note].map(normText).join('|') : '?'); }
    if (kind === 'D') { const it = d.items[id]; return id + '=' + (it ? [it.name, it.mustLookLike].map(normText).join('|') : '?'); }
    const e = d.env[id]; return id + '=' + (e ? normText(e.what) : '?');
  });
  parts.push('data=' + fp.join(';'));
  return parts.join('\n');
}
export function tcHash(tc, data) { return sha256(canonicalTc(tc, data)); }

/** Hash every TC of a document (optionally a subset of ids). */
export function hashDocument(tcText, dataText, ids) {
  const data = parseTestData(dataText || '');
  const want = ids && ids.length ? new Set(ids) : null;
  const out = {};
  for (const tc of parseTcDocument(tcText)) if (!want || want.has(tc.id)) out[tc.id] = { hash: tcHash(tc, data), canonical: canonicalTc(tc, data) };
  return out;
}

/* ---------------- CLI ---------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const pretty = !!args.pretty;
  if (!args.tc || typeof args.tc !== 'string') { print({ gate: 'NOT_RUN', reason: '--tc <TEST-CASES-*.md> is required', version: HASH_VERSION }, pretty); process.exit(0); }
  if (!fs.existsSync(args.tc)) { print({ gate: 'NOT_RUN', reason: 'file not found: ' + args.tc, version: HASH_VERSION }, pretty); process.exit(0); }
  const tcText = fs.readFileSync(args.tc, 'utf8');
  let dataPath = typeof args.data === 'string' ? args.data : null;
  if (!dataPath) { const guess = path.join(path.dirname(args.tc), path.basename(args.tc).replace(/^TEST-CASES-/, 'TEST-DATA-')); if (fs.existsSync(guess)) dataPath = guess; }
  const dataText = dataPath && fs.existsSync(dataPath) ? fs.readFileSync(dataPath, 'utf8') : '';
  const ids = typeof args.ids === 'string' ? args.ids.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const all = hashDocument(tcText, dataText, ids);
  const payload = { gate: 'PASS', version: HASH_VERSION, tc: args.tc, data: dataPath || null, count: Object.keys(all).length, hashes: {} };
  for (const [id, v] of Object.entries(all)) payload.hashes[id] = args.canonical ? v : v.hash;
  print(payload, pretty);
}
