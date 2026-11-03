// helpers/db.ts — the ONE place a database driver is reached (skill 5 3.0, references/code-craft.md §17).
//
// Copied by link-qc-5-test-run-automation into {automation_root}/helpers/db.ts when the TC document carries [DB] lines
// and the project has no DB helper of its own (an existing project client is wrapped into the Adapter shape instead).
// The connection string comes ONLY from the QC-named environment variable — QA_DB_URL, QA_DB_{NAME}_URL, or the name in
// PW_DB_ENV_VAR (skill 5 profile key db_access: env:{VAR}) — and is never logged, printed or written; a value missing
// is DbUnavailableError (the TC is NOT_RUN `not started: db unavailable`). The driver package (pg · mssql · mysql2) is
// loaded on first use; a project without it gets the same DbUnavailableError — skill 5 asks ONCE to add the devDependency.
//
// The Adapter (helpers/db-record.ts) exposes the queries the recorded client needs to bound a write: the primary key,
// the foreign keys referencing a table with their delete / update rules, the triggers with their bodies, the rewrites
// (views, rules, INSTEAD OF, non-transactional storage), a key fixed before an INSERT, a count + checksum of a table, a
// row lock — per engine, from the catalogue. What an engine cannot answer is reported so the write is REFUSED, never
// guessed (a trigger body that cannot be read, a checksum that cannot be computed is `null` and only the count is used).
import type { Adapter } from './db-record';

export class DbUnavailableError extends Error { constructor(m: string) { super('db unavailable: ' + m); this.name = 'DbUnavailableError'; } }

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const id = (x: string): string => { if (!IDENT.test(x)) throw new Error('not an identifier: ' + x); return x; };

function connectionString(name?: string): string {
  const v = process.env.PW_DB_ENV_VAR || (name ? 'QA_DB_' + name.toUpperCase() + '_URL' : 'QA_DB_URL');
  const s = process.env[v];
  if (!s) throw new DbUnavailableError('the connection variable ' + v + ' is not set in this process (it is named by the QC — db_access: env:{VAR})');
  return s;
}
const hostOf = (cs: string): string => { try { return new URL(cs).hostname; } catch { const m = /(?:server|host|data source)\s*=\s*([^;,]+)/i.exec(cs); return m ? m[1].trim() : 'unknown'; } };
async function load<T>(pkg: string): Promise<T> {
  try { return (await import(pkg)) as T; } catch { throw new DbUnavailableError('the driver package "' + pkg + '" is not installed in the automation project (add it as a devDependency — skill 5 asks once)'); }
}
const where = (cols: string[], n: number, ph: (i: number) => string): string => '(' + Array.from({ length: n }, (_, r) => '(' + cols.map((c, j) => id(c) + ' = ' + ph(r * cols.length + j + 1)).join(' AND ') + ')').join(' OR ') + ')';

/* ---------------- PostgreSQL (pg) ---------------- */
async function pgAdapter(cs: string): Promise<Adapter> {
  const pg = await load<{ Client: new (o: object) => { connect(): Promise<void>; query(s: string, p?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>; end(): Promise<void> } }>('pg');
  const Client = (pg as unknown as { default?: typeof pg }).default?.Client ?? pg.Client;
  const client = new Client({ connectionString: cs });
  await client.connect();
  const query: Q = async (sql, params = []) => { const r = await client.query(sql, params); return { rows: r.rows, rowCount: r.rowCount ?? 0 }; };
  const ph = (i: number) => '$' + i;
  const RULE: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
  return {
    engine: 'pg', transactional: true, query,
    begin: async () => { await query('BEGIN ISOLATION LEVEL SERIALIZABLE'); }, commit: async () => { await query('COMMIT'); }, rollback: async () => { await query('ROLLBACK'); },
    identity: async () => ({ database: String((await query('SELECT current_database() AS d')).rows[0].d), server: hostOf(cs) }),
    primaryKey: async (t) => (await query('SELECT a.attname AS c FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)', [t])).rows.map((r) => String(r.c)),
    referencing: async (t) => (await query("SELECT c.conrelid::regclass::text AS child, c.confdeltype AS del, c.confupdtype AS upd, (SELECT array_agg(a.attname ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(a, n) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.a) AS cc, (SELECT array_agg(a.attname ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(a, n) JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.a) AS pc, (SELECT n1.nspname = n2.nspname FROM pg_class r1 JOIN pg_namespace n1 ON n1.oid = r1.relnamespace, pg_class r2 JOIN pg_namespace n2 ON n2.oid = r2.relnamespace WHERE r1.oid = c.conrelid AND r2.oid = c.confrelid) AS same FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = $1::regclass", [t])).rows
      .map((r) => ({ child: String(r.child), childColumns: r.cc as string[], parentColumns: r.pc as string[], onDelete: RULE[String(r.del)] || 'NO ACTION', onUpdate: RULE[String(r.upd)] || 'NO ACTION', schema: r.same ? 'same' : 'other' })),
    triggers: async (t) => (await query('SELECT t.tgname AS name, pg_get_triggerdef(t.oid) AS def, p.prosrc AS body FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal', [t])).rows
      .map((r) => ({ name: String(r.name), events: (/(INSERT|UPDATE|DELETE|TRUNCATE)/gi.exec(String(r.def)) || []).map(String), body: r.body === null || r.body === undefined ? null : String(r.body) })),
    rewrites: async (t) => {
      const out: string[] = [];
      const k = (await query('SELECT relkind FROM pg_class WHERE oid = $1::regclass', [t])).rows[0];
      if (k && /[vmf]/.test(String(k.relkind))) out.push('view / foreign table');
      for (const r of (await query("SELECT rulename FROM pg_rules WHERE tablename = split_part($1, '.', -1)", [t])).rows) out.push('rule ' + r.rulename);
      return out;
    },
    nextKey: async (t, c) => {
      const s = (await query('SELECT pg_get_serial_sequence($1, $2) AS s', [t, c])).rows[0];
      if (s && s.s) return (await query('SELECT nextval($1::regclass) AS v', [s.s])).rows[0].v;
      const ty = (await query("SELECT data_type FROM information_schema.columns WHERE table_name = split_part($1, '.', -1) AND column_name = $2", [t, c])).rows[0];
      return ty && /uuid/i.test(String(ty.data_type)) ? (await query('SELECT gen_random_uuid()::text AS v')).rows[0].v : null;
    },
    measure: async (t, w) => { const r = (await query('SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, \'|\' ORDER BY x::text), \'\')) AS h FROM ' + id(t) + ' x' + (w ? ' WHERE ' + where(w.columns, w.values.length, ph) : ''), w ? w.values.flat() : [])).rows[0]; return { count: Number(r.n), checksum: r.h ? String(r.h) : null }; },
    lock: async (t, pk, keys) => (await query('SELECT 1 FROM ' + id(t) + ' WHERE ' + where(pk, keys.length, ph) + ' FOR UPDATE', keys.flat())).rowCount,
    close: async () => { await client.end(); },
  };
}

/* ---------------- SQL Server (mssql) ---------------- */
async function mssqlAdapter(cs: string): Promise<Adapter> {
  type Req = { input(n: string, v: unknown): Req; query(s: string): Promise<{ recordset?: Record<string, unknown>[]; rowsAffected: number[] }> };
  type Pool = { request(): Req; close(): Promise<void> };
  type Tx = { begin(level?: unknown): Promise<void>; commit(): Promise<void>; rollback(): Promise<void>; request(): Req };
  const sql = await load<{ connect(cs: string): Promise<Pool>; Transaction: new (p: Pool) => Tx; ISOLATION_LEVEL: { SERIALIZABLE: unknown } }>('mssql');
  const m = (sql as unknown as { default?: typeof sql }).default ?? sql;
  const pool = await m.connect(cs);
  let tx: Tx | null = null;
  const query: Q = async (s, params = []) => {
    let req = (tx ?? pool).request();
    params.forEach((v, i) => { req = req.input('p' + (i + 1), v); });
    const r = await req.query(s);
    return { rows: r.recordset || [], rowCount: (r.rowsAffected || []).reduce((a, b) => a + b, 0) };
  };
  const ph = (i: number) => '@p' + i;
  const rule = (x: unknown) => String(x || 'NO_ACTION').replace(/_/g, ' ');
  return {
    engine: 'mssql', transactional: true, query,
    begin: async () => { tx = new m.Transaction(pool); await tx.begin(m.ISOLATION_LEVEL.SERIALIZABLE); },
    commit: async () => { if (tx) await tx.commit(); tx = null; }, rollback: async () => { if (tx) await tx.rollback(); tx = null; },
    identity: async () => { const r = (await query('SELECT DB_NAME() AS d, @@SERVERNAME AS s')).rows[0]; return { database: String(r.d), server: String(r.s || hostOf(cs)) }; },
    primaryKey: async (t) => (await query('SELECT c.name AS c FROM sys.indexes i JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@p1) ORDER BY ic.key_ordinal', [t])).rows.map((r) => String(r.c)),
    referencing: async (t) => {
      const rows = (await query('SELECT fk.name AS fk, OBJECT_SCHEMA_NAME(fk.parent_object_id) + \'.\' + OBJECT_NAME(fk.parent_object_id) AS child, cc.name AS cc, pc.name AS pc, fk.delete_referential_action_desc AS del, fk.update_referential_action_desc AS upd, CASE WHEN OBJECT_SCHEMA_NAME(fk.parent_object_id) = OBJECT_SCHEMA_NAME(fk.referenced_object_id) THEN 1 ELSE 0 END AS same FROM sys.foreign_keys fk JOIN sys.foreign_key_columns k ON k.constraint_object_id = fk.object_id JOIN sys.columns cc ON cc.object_id = k.parent_object_id AND cc.column_id = k.parent_column_id JOIN sys.columns pc ON pc.object_id = k.referenced_object_id AND pc.column_id = k.referenced_column_id WHERE fk.referenced_object_id = OBJECT_ID(@p1) ORDER BY fk.name, k.constraint_column_id', [t])).rows;
      const by = new Map<string, { child: string; childColumns: string[]; parentColumns: string[]; onDelete: string; onUpdate: string; schema: string }>();
      for (const r of rows) { const e = by.get(String(r.fk)) || { child: String(r.child), childColumns: [], parentColumns: [], onDelete: rule(r.del), onUpdate: rule(r.upd), schema: r.same ? 'same' : 'other' }; e.childColumns.push(String(r.cc)); e.parentColumns.push(String(r.pc)); by.set(String(r.fk), e); }
      return [...by.values()];
    },
    triggers: async (t) => (await query('SELECT t.name AS name, OBJECT_DEFINITION(t.object_id) AS body FROM sys.triggers t WHERE t.parent_id = OBJECT_ID(@p1)', [t])).rows.map((r) => ({ name: String(r.name), events: [], body: r.body === null || r.body === undefined ? null : String(r.body) })),
    rewrites: async (t) => {
      const out: string[] = [];
      if ((await query("SELECT OBJECTPROPERTY(OBJECT_ID(@p1), 'IsView') AS v", [t])).rows[0]?.v === 1) out.push('view');
      for (const r of (await query('SELECT name FROM sys.triggers WHERE parent_id = OBJECT_ID(@p1) AND is_instead_of_trigger = 1', [t])).rows) out.push('INSTEAD OF trigger ' + r.name);
      return out;
    },
    nextKey: async () => null,
    measure: async (t, w) => { const r = (await query('SELECT COUNT(*) AS n, CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS h FROM ' + id(t) + (w ? ' WHERE ' + where(w.columns, w.values.length, ph) : ''), w ? w.values.flat() : [])).rows[0]; return { count: Number(r.n), checksum: r.h === null || r.h === undefined ? null : String(r.h) }; },
    lock: async (t, pk, keys) => (await query('SELECT 1 AS x FROM ' + id(t) + ' WITH (UPDLOCK, HOLDLOCK) WHERE ' + where(pk, keys.length, ph), keys.flat())).rows.length,
    close: async () => { await pool.close(); },
  };
}

/* ---------------- MySQL / MariaDB (mysql2) ---------------- */
async function mysqlAdapter(cs: string): Promise<Adapter> {
  type Conn = { query(s: string, p?: unknown[]): Promise<[unknown, unknown]>; end(): Promise<void> };
  const mysql = await load<{ createConnection(cs: string): Promise<Conn> }>('mysql2/promise');
  const m = (mysql as unknown as { default?: typeof mysql }).default ?? mysql;
  const conn = await m.createConnection(cs);
  const query: Q = async (s, params = []) => {
    const [res] = await conn.query(s, params);
    if (Array.isArray(res)) return { rows: res as Record<string, unknown>[], rowCount: (res as unknown[]).length };
    return { rows: [], rowCount: Number((res as { affectedRows?: number }).affectedRows || 0) };
  };
  const ph = () => '?';
  return {
    engine: 'mysql', transactional: true, query,
    begin: async () => { await query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'); await query('START TRANSACTION'); }, commit: async () => { await query('COMMIT'); }, rollback: async () => { await query('ROLLBACK'); },
    identity: async () => { const r = (await query('SELECT DATABASE() AS d, @@hostname AS s')).rows[0]; return { database: String(r.d), server: String(r.s || hostOf(cs)) }; },
    primaryKey: async (t) => (await query("SELECT column_name AS c FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = 'PRIMARY' ORDER BY ordinal_position", [t])).rows.map((r) => String(r.c ?? r.C ?? r.COLUMN_NAME)),
    referencing: async (t) => {
      const rows = (await query('SELECT k.constraint_name AS fk, k.table_name AS child, k.column_name AS cc, k.referenced_column_name AS pc, r.delete_rule AS del, r.update_rule AS upd, (k.table_schema = k.referenced_table_schema) AS same FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_name = k.constraint_name AND r.constraint_schema = k.constraint_schema WHERE k.referenced_table_schema = DATABASE() AND k.referenced_table_name = ? ORDER BY k.constraint_name, k.ordinal_position', [t])).rows;
      const by = new Map<string, { child: string; childColumns: string[]; parentColumns: string[]; onDelete: string; onUpdate: string; schema: string }>();
      for (const r of rows) { const e = by.get(String(r.fk)) || { child: String(r.child), childColumns: [], parentColumns: [], onDelete: String(r.del), onUpdate: String(r.upd), schema: Number(r.same) ? 'same' : 'other' }; e.childColumns.push(String(r.cc)); e.parentColumns.push(String(r.pc)); by.set(String(r.fk), e); }
      return [...by.values()];
    },
    triggers: async (t) => (await query('SELECT trigger_name AS name, event_manipulation AS ev, action_statement AS body FROM information_schema.triggers WHERE event_object_schema = DATABASE() AND event_object_table = ?', [t])).rows.map((r) => ({ name: String(r.name), events: [String(r.ev)], body: r.body === null || r.body === undefined ? null : String(r.body) })),
    rewrites: async (t) => {
      const out: string[] = [];
      if ((await query('SELECT 1 AS v FROM information_schema.views WHERE table_schema = DATABASE() AND table_name = ?', [t])).rows.length) out.push('view');
      const e = (await query('SELECT engine AS e FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [t])).rows[0];
      if (e && !/innodb/i.test(String(e.e))) out.push('non-transactional storage ' + e.e);
      return out;
    },
    nextKey: async () => null,
    measure: async (t, w) => { const r = (await query('SELECT COUNT(*) AS n FROM ' + id(t) + (w ? ' WHERE ' + where(w.columns, w.values.length, ph) : ''), w ? w.values.flat() : [])).rows[0]; return { count: Number(r.n), checksum: null }; },
    lock: async (t, pk, keys) => (await query('SELECT 1 AS x FROM ' + id(t) + ' WHERE ' + where(pk, keys.length, ph) + ' FOR UPDATE', keys.flat())).rows.length,
    close: async () => { await conn.end(); },
  };
}

/** The adapter for the QC-named connection — the engine from the connection string's scheme. */
export async function dbClientFromEnv(name?: string): Promise<Adapter> {
  const cs = connectionString(name);
  const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(cs) || [])[1]?.toLowerCase() || (/server\s*=|data source\s*=/i.test(cs) ? 'mssql' : '');
  if (/^postgres(ql)?$/.test(scheme)) return pgAdapter(cs);
  if (/^(mssql|sqlserver)$/.test(scheme)) return mssqlAdapter(cs);
  if (/^(mysql|mariadb)$/.test(scheme)) return mysqlAdapter(cs);
  throw new DbUnavailableError('no adapter for the "' + (scheme || 'unknown') + '" connection — wrap the project\'s client into the Adapter shape (helpers/db-record.ts)');
}
