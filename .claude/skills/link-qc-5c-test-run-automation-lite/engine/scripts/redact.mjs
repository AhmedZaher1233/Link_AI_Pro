#!/usr/bin/env node
// redact.mjs — the redaction core of the API / DB evidence records (skill5-record/1) and their validation.
// Node >= 18, zero dependencies, read-only.
//
// The block between `BEGIN redact-core` and `END redact-core` is copied BYTE FOR BYTE into
// assets/redact.template.ts (the helper the consumer project runs); selftest-redact.mjs checks the two copies and runs
// the leak tests on the core, so what the project redacts is exactly what is tested here. Edit it here, copy it there.
//
// Deny by default, fail closed:
//   headers   an allowlist keeps the value (content-type, content-length, retry-after, rate-limit headers, request /
//             correlation ids, the location PATH); every other header keeps its name, its value becomes [redacted]
//   urls      the path is kept; every query value is [redacted] unless the client declared the key safe
//   json      only values at an asserted / captured path are kept (and even they are hashed when they look sensitive);
//             every other leaf becomes `<type:len>`, so the shape stays visible — arrays and nesting included
//   sql       string literals inside the statement are masked; parameters are masked unless their position is asserted;
//             result samples keep only asserted columns, at most 5 rows
//   patterns  Bearer / Basic / JWT values, key=value secrets, URL credentials, private keys, cloud keys, e-mail
//             addresses, phone numbers, IBANs and card numbers (Luhn) are masked wherever they survive
//   known     the run's actual secret values (passwords, connection strings, tokens a login returned) in raw,
//             URL-encoded and base64 forms: if any is still in the serialised record, the record is BLOCKED — never
//             written — and the attempt can never PASS (evidence_invalid: redaction).
//
// CLI (diagnostics only): node redact.mjs --record <file.record.json> [--pretty]  → validateRecord + a secret scan.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ==== BEGIN redact-core ====================================================================================
export const RECORD_SCHEMA = 'skill5-record/1';
export const REDACTED = '[redacted]';
export const MAX_SAMPLE_ROWS = 5;
export const MAX_TEXT = 65536;
const SAFE_HEADERS = /^(?:content-type|content-length|content-encoding|retry-after|ratelimit(?:-[a-z]+)?|x-ratelimit-[a-z-]+|x-rate-limit-[a-z-]+|x-request-id|x-correlation-id|request-id|traceparent|location|date|etag|cache-control)$/i;
const SENSITIVE_KEY = /(?:^|[_\-.])(?:pass(?:word|wd|phrase)?|pwd|secret|token|api[-_]?key|apikey|auth(?:ori[sz]ation)?|credential|cookie|session|ssn|cvv|cvc|card(?:number)?|iban|pin|otp|private[-_]?key)(?:$|[_\-.])|^(?:password|secret|token|authorization|cookie|session|pin|otp|ssn)$/i;
const PATTERNS = [
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['bearer', /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g],
  ['url-credential', /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/'"]+:[^\s@/'"]+@/gi],
  ['key-value-secret', /\b(?:password|passwd|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|client[-_]?secret)\s*[:=]\s*["']?(?!\[redacted\]|<[a-z-]+(?::\d+)?>|sha256:)[^\s"';,&]{3,}/gi],
  ['cloud-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
  ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['iban', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g],
  ['card', /\b(?:\d[ -]?){13,19}\b/g],
  ['phone', /(?:\+|\b00)\d[\d\s().-]{7,}\d\b/g],
];
const luhn = (digits) => { let sum = 0; let alt = false; for (let i = digits.length - 1; i >= 0; i--) { let d = Number(digits[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return digits.length >= 13 && sum % 10 === 0; };
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const shapeOf = (v) => { const t = typeOf(v); if (t === 'string') return '<string:' + v.length + '>'; if (t === 'array') return '<array:' + v.length + '>'; if (t === 'object') return '<object:' + Object.keys(v).length + '>'; return '<' + t + '>'; };
export const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/** Mask every sensitive pattern in a text → { text, hits: [kind…] }. */
export function maskText(input) {
  let text = String(input ?? '');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '…[truncated]';
  const hits = [];
  for (const [kind, re] of PATTERNS) {
    text = text.replace(re, (m, g1) => {
      if (kind === 'card' && !luhn(m.replace(/\D/g, ''))) return m;
      if (kind === 'phone' && m.replace(/\D/g, '').length < 9) return m;
      hits.push(kind);
      return kind === 'url-credential' ? g1 + '<credential>@' : '<' + kind + '>';
    });
  }
  return { text, hits };
}

/** Allowlisted header values are kept (location: its path only); every other value is [redacted]. */
export function redactHeaders(headers, stats = null) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (SAFE_HEADERS.test(k) && !SENSITIVE_KEY.test(k)) {
      let val = String(v);
      if (/^location$/i.test(k)) { try { const u = new URL(val, 'http://x.invalid'); val = u.pathname; } catch { val = REDACTED; } }
      const m = maskText(val);
      if (m.hits.length && stats) stats.patterns += m.hits.length;
      out[k] = m.text;
    } else { out[k] = REDACTED; if (stats) stats.headers++; }
  }
  return out;
}

/** The path is kept; query values are [redacted] unless their key is declared safe. */
export function redactUrl(url, safeParams, stats = null) {
  const safe = new Set((safeParams || []).map((x) => String(x).toLowerCase()));
  let u;
  try { u = new URL(String(url), 'http://x.invalid'); } catch { if (stats) stats.values++; return REDACTED; }
  const q = [];
  for (const [k, v] of u.searchParams) {
    if (safe.has(k.toLowerCase()) && !SENSITIVE_KEY.test(k)) { const m = maskText(v); if (m.hits.length && stats) stats.patterns += m.hits.length; q.push(k + '=' + m.text); }
    else { q.push(k + '=' + REDACTED); if (stats) stats.values++; }
  }
  return maskText(u.pathname).text + (q.length ? '?' + q.join('&') : '');
}

/**
 * JSON of any depth: a leaf whose path is in `keep` (e.g. "body.items[0].status" → keep "items[0].status" or "items[].status")
 * keeps its value — hashed when it looks sensitive or sits under a sensitive key; every other leaf becomes `<type:len>`.
 */
export function redactJson(value, keep, stats = null, at = '') {
  const keepSet = keep instanceof Set ? keep : new Set(keep || []);
  const generic = at.replace(/\[\d+\]/g, '[]');
  const t = typeOf(value);
  if (t === 'array') return value.slice(0, 50).map((v, i) => redactJson(v, keepSet, stats, at + '[' + i + ']'));
  if (t === 'object') { const o = {}; for (const [k, v] of Object.entries(value)) o[k] = redactJson(v, keepSet, stats, at ? at + '.' + k : k); return o; }
  const key = at.split(/[.[\]]+/).filter(Boolean).pop() || '';
  const kept = keepSet.has(at) || keepSet.has(generic);
  if (!kept) { if (stats) stats.values++; return shapeOf(value); }
  if (t === 'string') {
    const m = maskText(value);
    if (SENSITIVE_KEY.test(key) || m.hits.length) { if (stats) stats.patterns++; return 'sha256:' + sha256Hex(value).slice(0, 16) + ' ' + shapeOf(value); }
    return m.text;
  }
  if (SENSITIVE_KEY.test(key)) { if (stats) stats.patterns++; return 'sha256:' + sha256Hex(String(value)).slice(0, 16) + ' ' + shapeOf(value); }
  return value;
}

/** A body that is not JSON keeps only its type, size and hash. */
export function redactBody(body, contentType, keep, stats = null) {
  if (body === undefined || body === null || body === '') return body ?? null;
  if (typeof body === 'object' && !(body instanceof Uint8Array)) return redactJson(body, keep, stats);
  const text = typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
  if (/json/i.test(String(contentType || '')) || /^\s*[[{]/.test(text)) { try { return redactJson(JSON.parse(text), keep, stats); } catch { /* not JSON after all — fall through to the summary */ } }
  if (stats) stats.values++;
  return { 'content-type': String(contentType || 'unknown'), bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Hex(text) };
}

/** String literals inside a statement are masked ('?'); identifiers, keywords and placeholders stay. */
export function redactSql(sql, stats = null) {
  let n = 0;
  const out = String(sql ?? '').replace(/'(?:[^']|'')*'/g, () => { n++; return "'?'"; });
  if (stats) stats.values += n;
  return maskText(out).text;
}

/** Parameters are masked unless their position is asserted (keepIdx); a kept value is still pattern-masked. */
export function redactParams(params, keepIdx, stats = null) {
  const keepSet = keepIdx instanceof Set ? keepIdx : new Set(keepIdx || []);
  return (params || []).map((v, i) => {
    if (!keepSet.has(i)) { if (stats) stats.values++; return shapeOf(v); }
    if (typeof v === 'string') { const m = maskText(v); if (m.hits.length) { if (stats) stats.patterns++; return 'sha256:' + sha256Hex(v).slice(0, 16) + ' ' + shapeOf(v); } return m.text; }
    return v;
  });
}

/** At most MAX_SAMPLE_ROWS rows, only the asserted columns; every other column `<type:len>`. */
export function redactRows(rows, keepColumns, stats = null) {
  const keep = new Set((keepColumns || []).map((c) => String(c).toLowerCase()));
  return (rows || []).slice(0, MAX_SAMPLE_ROWS).map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r || {})) {
      if (keep.has(k.toLowerCase()) && !SENSITIVE_KEY.test(k)) { o[k] = typeof v === 'string' ? maskText(v).text : v; }
      else { o[k] = shapeOf(v); if (stats) stats.values++; }
    }
    return o;
  });
}

/** Every form a known secret can take in a serialised record. */
export function secretForms(value) {
  const s = String(value ?? '');
  if (s.length < 4) return [];
  const forms = new Set([s, encodeURIComponent(s), Buffer.from(s, 'utf8').toString('base64'), JSON.stringify(s).slice(1, -1)]);
  return [...forms].filter((x) => x.length >= 4);
}

/** Hits in a serialised record: surviving patterns (never the placeholders the masking wrote) and known secret values. */
export function scanForSecrets(serialised, knownSecrets) {
  const text = String(serialised ?? '');
  const hits = [];
  for (const [kind, re] of PATTERNS) {
    if (kind === 'email' || kind === 'phone' || kind === 'iban' || kind === 'card') continue;   // personal data is masked, never a block on its own
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push({ kind, at: m.index });
  }
  for (const secret of knownSecrets || []) for (const f of secretForms(secret)) { const at = text.indexOf(f); if (at >= 0) hits.push({ kind: 'known-secret', at }); }
  return hits;
}

/** The final gate before a record is written: the serialised record must carry no secret → { ok, text, hits }. */
export function sealRecord(record, knownSecrets) {
  const body = { ...record, sha256: undefined };
  const text = JSON.stringify(body, null, 2);
  const hits = scanForSecrets(text, knownSecrets);
  if (hits.length) return { ok: false, text: null, hits: hits.map((h) => h.kind) };
  return { ok: true, text: JSON.stringify({ ...body, sha256: sha256Hex(text) }, null, 2) + '\n', hits: [] };
}
// ==== END redact-core ======================================================================================

/* ---------------- record validation (run-stage validateRecords, run-data check 54, the run-report renderer) ---------------- */

const ENTRY_CHANNELS = new Set(['api', 'db']);
const PURPOSES = new Set(['test', 'setup', 'teardown']);
const OUTCOMES = new Set(['pass', 'fail']);

/**
 * Problems of one record against the attempt it claims to document (empty = valid).
 *   expect: { tc, attempt, status ('PASS' | 'FAIL' | …), backendLines: ['ER1', …] (the TC's [API] / [DB] Expected lines) }
 */
export function validateRecord(record, expect = {}, knownSecrets = []) {
  const p = [];
  if (!record || typeof record !== 'object') return ['not a JSON object'];
  if (record.schema !== RECORD_SCHEMA) p.push('schema ' + JSON.stringify(record.schema) + ' is not ' + RECORD_SCHEMA);
  if (expect.tc && record.tc !== expect.tc && !(Array.isArray(record.tcs) && record.tcs.includes(expect.tc))) p.push('tc ' + JSON.stringify(record.tc) + ' is not ' + expect.tc);
  if (expect.attempt !== undefined && Number(record.attempt) !== Number(expect.attempt)) p.push('attempt ' + record.attempt + ' is not ' + expect.attempt);
  if (!Array.isArray(record.entries)) p.push('no entries[]');
  if (!Array.isArray(record.assertions)) p.push('no assertions[]');
  const ids = new Set();
  for (const e of record.entries || []) {
    if (!e || !e.id || ids.has(e.id)) { p.push('entry without a unique id'); continue; }
    ids.add(e.id);
    if (!ENTRY_CHANNELS.has(e.channel)) p.push('entry ' + e.id + ': channel ' + JSON.stringify(e.channel));
    if (!PURPOSES.has(e.purpose)) p.push('entry ' + e.id + ': purpose ' + JSON.stringify(e.purpose));
  }
  for (const a of record.assertions || []) {
    if (!a || !OUTCOMES.has(a.outcome)) p.push('assertion ' + (a && a.id) + ': outcome ' + JSON.stringify(a && a.outcome));
    if (a && a.entry_ref && !ids.has(a.entry_ref)) p.push('assertion ' + a.id + ' refers to unknown entry ' + a.entry_ref);
  }
  if (expect.status === 'PASS') {
    if ((record.assertions || []).some((a) => a && a.outcome === 'fail')) p.push('a PASS whose record holds a failed assertion');
    for (const line of expect.backendLines || []) if (!(record.assertions || []).some((a) => a && a.tc_line === line && a.outcome === 'pass')) p.push('a PASS without a passing assertion for ' + line);
  }
  if (record.sha256) {
    const text = JSON.stringify({ ...record, sha256: undefined }, null, 2);
    if (sha256Hex(text) !== record.sha256) p.push('sha256 does not match the record (edited after it was sealed)');
  } else p.push('not sealed (no sha256)');
  const hits = scanForSecrets(JSON.stringify(record), knownSecrets);
  if (hits.length) p.push('secret-shaped content survived redaction: ' + [...new Set(hits.map((h) => h.kind))].join(', '));
  return p;
}

/** Read + parse + validate a record file → { ok, problems, record }. */
export function checkRecordFile(file, expect = {}, knownSecrets = []) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, problems: ['record file missing or unreadable'], record: null }; }
  let record;
  try { record = JSON.parse(text); } catch { return { ok: false, problems: ['record file is not valid JSON'], record: null }; }
  const problems = validateRecord(record, expect, knownSecrets);
  return { ok: !problems.length, problems, record };
}

/* ---------------- CLI ---------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const i = process.argv.indexOf('--record');
  const file = i > 0 ? process.argv[i + 1] : null;
  const pretty = process.argv.includes('--pretty');
  const out = file ? { tool: 'redact', file, ...checkRecordFile(file) } : { tool: 'redact', gate: 'NOT_RUN', reason: '--record <file.record.json> is required' };
  if (out.record) delete out.record;
  process.stdout.write(JSON.stringify(out, null, pretty ? 2 : 0) + '\n');
}
