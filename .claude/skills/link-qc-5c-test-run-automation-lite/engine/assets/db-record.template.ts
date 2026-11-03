// @link-qc-5-template db-record 3.1.0
// helpers/db-record.ts — the RECORDED database client every db/ query object uses (skill 5 3.0, code-craft.md §17 / §19).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/db-record.ts — ALWAYS installed. A fixture
// wraps the project's client (helpers/db.ts → an Adapter) once per test:
//
//   db: async ({}, use, testInfo) => { const d = await attachDbRecord(dbClientFromEnv(), testInfo); await use(d.db); await d.report(testInfo); },
//   ordersDb: async ({ db }, use) => { await use(new OrdersDb(db)); },
//
// READS: db.read(name, sql, params, { keepColumns, keepParams }) — a statement that writes is refused; the query, its
// masked parameters and a sample of the asserted columns go into the record.
// WRITES — only these three, never write SQL text (validator db-write-freeform):
//   db.insert({ table, values })         the key is PRE-ALLOCATED before the statement (a sequence value, a client UUID, or
//                                        the TC's natural key carrying the run token) — an INSERT whose identity cannot be
//                                        fixed before commit is refused
//   db.update({ table, key, set })       `key` = the table's FULL primary key, of a record THIS run created
//   db.delete({ table, key })
// and each runs, in this order, fail-closed:
//   1. the data-changes gate: the running TC is in PW_DATA_CHANGES_TCS (never set for a production / unverified target),
//      the connected database's identity was verified against PW_DB_EXPECTED_IDENTITY, it matches no production marker;
//   2. ownership: every key is in this run's ledger (helpers/data-ledger.ts) — else PreexistingRecordWriteError;
//   3. scope, BEFORE anything is sent: the full cascade closure over the foreign keys (every level: CASCADE / SET NULL /
//      SET DEFAULT on delete and update) — every predicted row must be ledger-owned (CascadeScopeError); a cycle, a
//      closure deeper than MAX_DEPTH, a view, a rule or a cross-schema key is refused; triggers on the target and on every
//      closure table — allowed only when readable and INSERT-only, anything else refused WHATEVER the consent
//      (TriggerScopeError);
//   4. the intent line (fsynced) with the target identity;
//   5. one transaction (serializable where the engine supports it; an engine without transactions gets no write):
//      lock the target rows, re-check ownership, count / checksum every closure table, run the statement the helper BUILT
//      (WHERE {pk} = $n with ledger values), check rowCount === keys, count / checksum again — any difference from the
//      prediction → rollback, DataWriteScopeError;
//   6. commit, `committed`, then the read-back (the intended values / the absence) → `verified`, else
//      DbReadBackMismatchError.
// In-doubt intents (a crash after commit, before `committed`) of this run are resolved on attach by a READ-ONLY lookup
// of their target identity: exact intended state → `recovered`, prior state → `rolled_back`, anything else stays
// in-doubt (reported; never owned, never cleaned).
import type { TestInfo } from '@playwright/test';
import { TIMEOUTS } from '../timeouts';
import { appendLedger, keyOf, newWriteId, owns, runLines, type LedgerLine } from './data-ledger';
import { pushEntry, registerSecret } from './record';
import { redactParams, redactRows, redactSql } from './redact';
import { currentStep, tcIdsOf } from './steps';

/** What helpers/db.ts hands over — one implementation per engine (pg / mssql / mysql2), or the project's own. */
export type Adapter = {
  engine: string;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
  begin(): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>;
  /** false → no write is ever attempted (non-transactional storage) */
  transactional: boolean;
  identity(): Promise<{ database: string; server: string }>;
  primaryKey(table: string): Promise<string[]>;
  /** foreign keys REFERENCING `table`: rules as information_schema spells them (CASCADE, SET NULL, SET DEFAULT, NO ACTION, RESTRICT) */
  referencing(table: string): Promise<{ child: string; childColumns: string[]; parentColumns: string[]; onDelete: string; onUpdate: string; schema?: string | null }[]>;
  /** triggers ON `table`; body null = definition not readable */
  triggers(table: string): Promise<{ name: string; events: string[]; body: string | null }[]>;
  /** views / rewrite rules / INSTEAD OF — anything that turns one statement into another */
  rewrites(table: string): Promise<string[]>;
  /** a key value fixed BEFORE the insert (a sequence's next value, a client UUID), or null */
  nextKey(table: string, column: string): Promise<unknown | null>;
  /** count + checksum of the rows of a table matching a predicate (null = whole table); checksum may be null */
  measure(table: string, where: { columns: string[]; values: unknown[][] } | null, invert?: boolean): Promise<{ count: number; checksum: string | null }>;
  lock(table: string, pk: string[], keys: unknown[][]): Promise<number>;
  close?(): Promise<void>;
};

export class DataChangesRefusedError extends Error { constructor(m: string) { super('data changes not permitted: ' + m); this.name = 'DataChangesRefusedError'; } }
export class PreexistingRecordWriteError extends Error { constructor(m: string) { super('data write refused (ownership): ' + m); this.name = 'PreexistingRecordWriteError'; } }
export class CascadeScopeError extends Error { constructor(m: string) { super('data write refused (cascade): ' + m); this.name = 'CascadeScopeError'; } }
export class TriggerScopeError extends Error { constructor(m: string) { super('data write refused (trigger): ' + m); this.name = 'TriggerScopeError'; } }
export class DataWriteScopeError extends Error { constructor(m: string) { super('data write refused (row-count): ' + m); this.name = 'DataWriteScopeError'; } }
export class DbReadBackMismatchError extends Error { constructor(m: string) { super('read-back mismatch: ' + m); this.name = 'DbReadBackMismatchError'; } }
export class InsertIdentityError extends Error { constructor(m: string) { super('data write refused (identity): ' + m); this.name = 'InsertIdentityError'; } }
export class DataWriteFailedError extends Error { constructor(m: string) { super('data write failed: ' + m); this.name = 'DataWriteFailedError'; } }
const OWN_ERRORS = new Set(['DataChangesRefusedError', 'PreexistingRecordWriteError', 'CascadeScopeError', 'TriggerScopeError', 'DataWriteScopeError', 'DbReadBackMismatchError', 'InsertIdentityError', 'DataWriteFailedError']);

export const MAX_DEPTH = 5;
const OPTIONAL = TIMEOUTS as unknown as { db?: { query?: number } };
const QUERY_MS: number = Number(OPTIONAL.db?.query) > 0 ? Number(OPTIONAL.db?.query) : 30_000;
const WRITE_SQL = /^\s*(?:insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|call|exec(?:ute)?)\b/i;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const csv = (v: string | undefined): string[] => (v || '').split(',').map((x) => x.trim()).filter(Boolean);
const q = (id: string): string => { if (!IDENT.test(id)) throw new DataWriteScopeError('not an identifier: ' + id); return id; };
const ph = (engine: string, i: number): string => (/^(pg|postgres)/i.test(engine) ? '$' + i : /mssql|sqlserver/i.test(engine) ? '@p' + i : '?');
const bounded = <T>(p: Promise<T>, what: string): Promise<T> => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(what + ' exceeded TIMEOUTS.db.query')), QUERY_MS);   // deliberate timer: the bounded query budget
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

type WriteSpec = { table: string; key?: Record<string, unknown>; values?: Record<string, unknown>; set?: Record<string, unknown>; purpose?: 'test' | 'setup' | 'teardown' };
export type RecordedDb = {
  read(name: string, sql: string, params?: unknown[], o?: { keepColumns?: string[]; keepParams?: number[] }): Promise<Record<string, unknown>[]>;
  insert(spec: WriteSpec): Promise<Record<string, unknown>>;
  update(spec: WriteSpec): Promise<void>;
  delete(spec: WriteSpec): Promise<void>;
  lastEntry(): string | null;
};

/** The identity check: the CONNECTED database must be the one TEST-DATA names; a production marker makes it unverified. */
async function verifyIdentity(adapter: Adapter): Promise<{ verified: boolean; text: string; why: string }> {
  try {
    const id = await bounded(adapter.identity(), 'identity query');
    const text = id.database + ' @ ' + id.server + ' (' + adapter.engine + ')';
    const want = (process.env.PW_DB_EXPECTED_IDENTITY || '').toLowerCase();
    const markers = csv(process.env.PW_DB_PRODUCTION_MARKERS || 'prod,production,live');
    if (markers.some((m) => (id.database + ' ' + id.server).toLowerCase().includes(m.toLowerCase()))) return { verified: false, text, why: 'the connected database matches a production marker' };
    if (!want) return { verified: false, text, why: 'no expected identity (TEST-DATA Database row → PW_DB_EXPECTED_IDENTITY)' };
    const [wdb, rest] = want.split('@').map((x) => x.trim());
    const wserver = (rest || '').replace(/\(.*\)\s*$/, '').trim();
    const ok = !!wdb && wdb === id.database.toLowerCase() && (!wserver || id.server.toLowerCase().includes(wserver) || wserver.includes(id.server.toLowerCase()));
    return { verified: ok, text, why: ok ? 'verified' : 'connected to ' + text + ', TEST-DATA names ' + process.env.PW_DB_EXPECTED_IDENTITY };
  } catch (e) { return { verified: false, text: 'unknown', why: 'identity could not be queried: ' + String((e as Error).message || e).slice(0, 120) }; }
}

/** Resolve this run's in-doubt intents by a READ-ONLY lookup of their target identity. */
async function resolveInDoubt(adapter: Adapter): Promise<number> {
  const byWrite = new Map<string, LedgerLine[]>();
  for (const l of runLines()) if (l.channel === 'db') byWrite.set(l.write_id, [...(byWrite.get(l.write_id) || []), l]);
  let left = 0;
  for (const [writeId, lines] of byWrite) {
    const intent = lines.find((l) => l.state === 'intent');
    if (!intent || lines.some((l) => l.state !== 'intent' && l.state !== 'teardown-intent')) continue;
    const key = intent.key && typeof intent.key === 'object' ? intent.key as Record<string, unknown> : null;
    if (!key || !intent.table) { left++; continue; }
    const cols = Object.keys(key);
    const r = await adapter.query('SELECT * FROM ' + q(intent.table) + ' WHERE ' + cols.map((c, i) => q(c) + ' = ' + ph(adapter.engine, i + 1)).join(' AND '), cols.map((c) => key[c]));
    const row = r.rows[0];
    let state: 'recovered' | 'rolled_back' | null = null;
    if (intent.op === 'insert') state = row && Object.entries(intent.intended || {}).every(([k, v]) => String(row[k]) === String(v)) ? 'recovered' : !row ? 'rolled_back' : null;
    else if (intent.op === 'delete') state = !row ? 'recovered' : 'rolled_back';
    else if (intent.op === 'update') state = row && Object.entries(intent.intended || {}).every(([k, v]) => String(row[k]) === String(v)) ? 'recovered' : null;
    if (state) appendLedger({ ...intent, state, note: 'in-doubt intent resolved by a read-only lookup' } as LedgerLine);
    else left++;
  }
  return left;
}

export async function attachDbRecord(adapter: Adapter, testInfo: TestInfo): Promise<{ db: RecordedDb; report(info: TestInfo): Promise<void> }> {
  const tcs = tcIdsOf(testInfo.title);
  const tc = tcs[0] || 'untraced';
  for (const [k, v] of Object.entries(process.env)) if (v && /^QA_DB(?:_[A-Z0-9]+)*_URL$/.test(k)) registerSecret(v);
  const identity = await verifyIdentity(adapter);
  const g = globalThis as unknown as { __linkQcRuntime?: Record<string, unknown> };
  if (!g.__linkQcRuntime) g.__linkQcRuntime = {};
  g.__linkQcRuntime.dbIdentity = { text: identity.text, verified: identity.verified };   // the record names the target it ran against
  let inDoubt = 0;
  if (identity.verified && adapter.transactional) { try { inDoubt = await resolveInDoubt(adapter); } catch { /* a failed lookup leaves them in doubt — reported by run-stage */ } }
  const created: { table: string; key: Record<string, unknown> }[] = [];
  let last: string | null = null;

  const gate = (spec: WriteSpec, op: string) => {
    const purpose = spec.purpose ?? 'test';
    if (!adapter.transactional) throw new DataChangesRefusedError('the ' + adapter.engine + ' storage is not transactional — no write can be verified before it commits');
    if (!identity.verified) throw new DataChangesRefusedError('target unverified — ' + identity.why);
    if (purpose === 'teardown') { if (process.env.PW_DATA_CLEANUP !== 'allowed') throw new DataChangesRefusedError('clean-up of ' + spec.table + ' without the tester\'s clean-up answer'); return; }
    if (purpose === 'setup' ? process.env.PW_DATA_CHANGES_SETUP !== 'allowed' : !csv(process.env.PW_DATA_CHANGES_TCS).some((x) => tcs.includes(x))) throw new DataChangesRefusedError(op + ' ' + spec.table + ' — ' + tc + ' is not in this run\'s data-changes consent');
  };
  const keyArray = (pk: string[], key: Record<string, unknown>): unknown[] => pk.map((c) => key[c]);

  /** The full side-effect closure: every row a delete / key update of `keys` would reach, level by level. */
  const closure = async (table: string, pk: string[], keys: unknown[][], op: 'delete' | 'update', setCols: string[] = [], depth = 0, seen = new Set<string>()): Promise<{ table: string; columns: string[]; values: unknown[][]; rule: string }[]> => {
    if (depth > MAX_DEPTH) throw new CascadeScopeError('the cascade closure of ' + table + ' is deeper than ' + MAX_DEPTH);
    if (seen.has(table)) throw new CascadeScopeError('a cascade cycle reaches ' + table + ' again');
    const next = new Set(seen); next.add(table);
    const out: { table: string; columns: string[]; values: unknown[][]; rule: string }[] = [];
    for (const fk of await adapter.referencing(table)) {
      if (fk.schema && fk.schema !== 'same') throw new CascadeScopeError('a cross-schema foreign key (' + fk.child + ') — its side effect cannot be verified');
      const rule = (op === 'delete' ? fk.onDelete : fk.onUpdate).toUpperCase();
      if (!/^(CASCADE|SET NULL|SET DEFAULT)$/.test(rule)) continue;   // NO ACTION / RESTRICT: the statement fails on its own, nothing is changed
      if (op === 'update' && !fk.parentColumns.some((c) => setCols.includes(c))) continue;   // an ON UPDATE rule fires only when a referenced column changes
      const parentVals = keys.map((k) => fk.parentColumns.map((pc) => k[pk.indexOf(pc)]));
      const cpk = await adapter.primaryKey(fk.child);
      if (!cpk.length) throw new CascadeScopeError(fk.child + ' has no primary key — its rows cannot be proven run-owned');
      const r = await adapter.query('SELECT ' + cpk.map(q).join(', ') + ' FROM ' + q(fk.child) + ' WHERE ' + parentVals.map((_, i) => '(' + fk.childColumns.map((c, j) => q(c) + ' = ' + ph(adapter.engine, i * fk.childColumns.length + j + 1)).join(' AND ') + ')').join(' OR '), parentVals.flat());
      const childKeys = r.rows.map((row) => cpk.map((c) => row[c]));
      for (const ck of childKeys) if (!owns({ table: fk.child }, Object.fromEntries(cpk.map((c, i) => [c, ck[i]])))) throw new CascadeScopeError(op + ' on ' + table + ' would ' + rule.toLowerCase() + ' ' + fk.child + ' ' + JSON.stringify(Object.fromEntries(cpk.map((c, i) => [c, ck[i]]))) + ', a row this run did not create');
      out.push({ table: fk.child, columns: cpk, values: childKeys, rule });
      if (childKeys.length && rule === 'CASCADE') out.push(...await closure(fk.child, cpk, childKeys, op, op === 'update' ? fk.childColumns : [], depth + 1, next));
    }
    return out;
  };
  /** The cascade GRAPH from the catalogue alone, rows or not: a cycle or a path deeper than MAX_DEPTH is refused. */
  const graph = async (table: string, op: 'delete' | 'update', path: string[] = []): Promise<void> => {
    if (path.includes(table)) throw new CascadeScopeError('a cascade cycle: ' + [...path, table].join(' → '));
    if (path.length > MAX_DEPTH) throw new CascadeScopeError('the cascade graph of ' + path[0] + ' is deeper than ' + MAX_DEPTH);
    for (const fk of await adapter.referencing(table)) if (/^CASCADE$/i.test(op === 'delete' ? fk.onDelete : fk.onUpdate)) await graph(fk.child, op, [...path, table]);
  };
  /** Triggers: readable and INSERT-only, or the write is refused — consent never overrides this. */
  const checkTriggers = async (tables: string[]) => {
    for (const t of tables) {
      const rw = await adapter.rewrites(t);
      if (rw.length) throw new TriggerScopeError(t + ' is rewritten (' + rw.join(', ') + ') — one statement could become another');
      for (const tr of await adapter.triggers(t)) {
        if (tr.body === null) throw new TriggerScopeError('trigger ' + tr.name + ' on ' + t + ' cannot be read — its side effect cannot be verified');
        const body = tr.body.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
        if (/\b(update|delete|merge|truncate|exec(?:ute)?|call|perform|sp_executesql|dynamic|format\s*\()/i.test(body.replace(/\binsert\s+into\b/gi, ' '))) throw new TriggerScopeError('trigger ' + tr.name + ' on ' + t + ' does more than INSERT new rows — refused even with consent');
      }
    }
  };
  const measureAll = async (target: string, scope: { table: string; columns: string[]; values: unknown[][] }[]) => {
    const m: Record<string, { count: number; checksum: string | null }> = {};
    for (const t of [target, ...scope.map((s) => s.table)]) if (!m[t]) m[t] = await adapter.measure(t, null);
    return m;
  };

  const write = async (op: 'insert' | 'update' | 'delete', spec: WriteSpec): Promise<Record<string, unknown>> => {
    gate(spec, op);
    const table = q(spec.table);
    const pk = await bounded(adapter.primaryKey(table), 'primary key');
    if (!pk.length) throw new DataWriteScopeError(table + ' has no primary key — a write cannot be bounded to one row');
    let key: Record<string, unknown>;
    let values: Record<string, unknown> = {};
    if (op === 'insert') {
      values = { ...(spec.values || {}) };
      for (const c of pk) if (values[c] === undefined) {
        const v = await adapter.nextKey(table, c);
        if (v !== null && v !== undefined) values[c] = v;
      }
      if (pk.some((c) => values[c] === undefined)) {
        const token = process.env.PW_RUN_ID || '';
        if (!token || !Object.values(values).some((v) => typeof v === 'string' && v.includes(token))) throw new InsertIdentityError(table + ': the key cannot be fixed before commit (no sequence, no client key) and no value carries the run token "' + token + '" — refused');
      }
      key = Object.fromEntries(pk.map((c) => [c, values[c] ?? null]));
    } else {
      key = spec.key || {};
      if (Object.keys(key).sort().join(',') !== [...pk].sort().join(',')) throw new DataWriteScopeError(op + ' ' + table + ' — `key` must be exactly the primary key (' + pk.join(', ') + ')');
      if (!owns({ table }, key) && !created.some((c) => c.table === table && keyOf(c.key) === keyOf(key))) throw new PreexistingRecordWriteError(op + ' ' + table + ' ' + JSON.stringify(key) + ' — not a record this run created');
    }
    const keyVals = [keyArray(pk, key)];
    if (op !== 'insert') await graph(table, op === 'delete' ? 'delete' : 'update');
    const scope = op === 'insert' ? [] : await closure(table, pk, keyVals, op === 'delete' ? 'delete' : 'update', Object.keys(spec.set || {}));
    await checkTriggers([table, ...scope.map((s) => s.table)]);
    const writeId = newWriteId(tc);
    const intended = op === 'insert' ? values : op === 'update' ? (spec.set || {}) : null;
    appendLedger({ channel: 'db', state: 'intent', write_id: writeId, tc, attempt: testInfo.retry + 1, purpose: spec.purpose ?? 'test', op, table, key, intended, identity: identity.text, step: currentStep()?.title ?? null });
    let sql: string; let params: unknown[];
    if (op === 'insert') { const cols = Object.keys(values).map(q); sql = 'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + cols.map((_, i) => ph(adapter.engine, i + 1)).join(', ') + ')'; params = Object.values(values); }
    else if (op === 'update') { const set = Object.keys(spec.set || {}).map(q); if (!set.length) throw new DataWriteScopeError('update ' + table + ' with nothing to set'); sql = 'UPDATE ' + table + ' SET ' + set.map((c, i) => c + ' = ' + ph(adapter.engine, i + 1)).join(', ') + ' WHERE ' + pk.map((c, i) => q(c) + ' = ' + ph(adapter.engine, set.length + i + 1)).join(' AND '); params = [...Object.values(spec.set || {}), ...keyArray(pk, key)]; }
    else { sql = 'DELETE FROM ' + table + ' WHERE ' + pk.map((c, i) => q(c) + ' = ' + ph(adapter.engine, i + 1)).join(' AND '); params = keyArray(pk, key); }
    let committed = false;
    try {
      await adapter.begin();
      if (op !== 'insert') {
        const locked = await bounded(adapter.lock(table, pk, keyVals), 'row lock');
        if (locked !== 1) throw new DataWriteScopeError(op + ' ' + table + ' ' + JSON.stringify(key) + ' — ' + locked + ' row(s) found for the key, expected 1');
      }
      const before = await measureAll(table, scope);
      const r = await bounded(adapter.query(sql, params), op);
      if (r.rowCount !== 1) throw new DataWriteScopeError(op + ' ' + table + ' changed ' + r.rowCount + ' row(s), expected exactly 1');
      const after = await measureAll(table, scope);
      // the predicted delta, table by table: the target ±1 (delete / insert) or 0 (update); cascaded deletes −n; SET NULL / DEFAULT 0
      const expectDelta: Record<string, number> = { [table]: op === 'insert' ? 1 : op === 'delete' ? -1 : 0 };
      for (const s of scope) expectDelta[s.table] = (expectDelta[s.table] ?? 0) + (s.rule === 'CASCADE' && op === 'delete' ? -s.values.length : 0);
      for (const t of Object.keys(before)) {
        const d = after[t].count - before[t].count;
        if (d !== (expectDelta[t] ?? 0)) throw new DataWriteScopeError(op + ' ' + table + ' changed the row count of ' + t + ' by ' + d + ', predicted ' + (expectDelta[t] ?? 0) + ' — a side effect the closure did not predict');
        // a table where nothing should change but its rows: any checksum difference outside the predicted rows is refused
        if ((expectDelta[t] ?? 0) === 0 && t !== table && !scope.some((s) => s.table === t) && before[t].checksum !== null && after[t].checksum !== before[t].checksum) throw new DataWriteScopeError(op + ' ' + table + ' changed rows of ' + t + ' it did not predict');
      }
      await adapter.commit();
      committed = true;
    } catch (e) {
      if (!committed) { try { await adapter.rollback(); } catch { /* the intent stays: resolved on the next attach */ } appendLedger({ channel: 'db', state: 'rolled_back', write_id: writeId, tc, op, table, key, note: String((e as Error).message || e).slice(0, 160) }); }
      // a database error of the statement itself is no product verdict either: data_write_failed (rolled back)
      if (e instanceof Error && OWN_ERRORS.has(e.name)) throw e;
      throw new DataWriteFailedError(op + ' ' + table + ' — ' + String((e as Error)?.message || e).slice(0, 160) + ' (rolled back)');
    }
    appendLedger({ channel: 'db', state: 'committed', write_id: writeId, tc, op, table, key, intended, purpose: spec.purpose ?? 'test' });
    // the read-back: the intended values, or the absence
    const cols = Object.keys(key);
    const rb = await bounded(adapter.query('SELECT * FROM ' + table + ' WHERE ' + cols.map((c, i) => q(c) + ' = ' + ph(adapter.engine, i + 1)).join(' AND '), cols.map((c) => key[c])), 'read-back');
    const row = rb.rows[0];
    const okBack = op === 'delete' ? !row : !!row && Object.entries(intended || {}).every(([k, v]) => String(row[k]) === String(v));
    last = pushEntry({ channel: 'db', purpose: spec.purpose ?? 'test', op, table, sql: redactSql(sql), params: redactParams(params, []), row_count: 1, read_back: okBack ? 'ok' : 'mismatch', identity: identity.text });
    if (!okBack) throw new DbReadBackMismatchError(op + ' ' + table + ' ' + JSON.stringify(key) + ' — the row read back does not show the intended state');
    appendLedger({ channel: 'db', state: 'verified', write_id: writeId, tc, op, table, key, purpose: spec.purpose ?? 'test' });
    if (op === 'insert') created.push({ table, key });
    if (op === 'delete') appendLedger({ channel: 'db', state: 'teardown-done', write_id: writeId, tc, table, key, note: 'removed by the test itself' });
    return key;
  };

  const db: RecordedDb = {
    async read(name, sql, params = [], o = {}) {
      if (WRITE_SQL.test(sql)) throw new DataWriteScopeError('read("' + name + '") carries a writing statement — writes go through insert / update / delete only');
      const started = Date.now();
      const r = await bounded(adapter.query(sql, params), 'query ' + name);
      last = pushEntry({ channel: 'db', purpose: 'test', op: 'read', name, sql: redactSql(sql), params: redactParams(params, o.keepParams || []), row_count: r.rows.length, sample: redactRows(r.rows, o.keepColumns || []), latency_ms: Date.now() - started, identity: identity.text, identity_verified: identity.verified });
      return r.rows;
    },
    insert: (s) => write('insert', s),
    update: async (s) => { await write('update', s); },
    delete: async (s) => { await write('delete', s); },
    lastEntry: () => last,
  };
  return {
    db,
    async report(info: TestInfo) {
      if (inDoubt) info.annotations.push({ type: 'data-in-doubt', description: inDoubt + ' write(s) of this run remain in doubt after a read-only lookup — never owned, never cleaned' });
      for (const c of created) { try { appendLedger({ channel: 'db', state: 'retained', write_id: newWriteId(tc), tc, op: 'insert', table: c.table, key: c.key, note: 'kept until the cleanup question' }); } catch { /* reported by run-stage from the ledger */ } }
      try { await adapter.close?.(); } catch { /* closing never fails a test */ }
    },
  };
}
