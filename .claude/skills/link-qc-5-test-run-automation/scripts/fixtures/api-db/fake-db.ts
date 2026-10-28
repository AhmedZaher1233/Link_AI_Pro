// A file-backed fake database for selftest-api-db.mjs — implements helpers/db-record.ts's Adapter (engine 'pg', $n
// placeholders) for exactly the statements the recorded client builds, with real foreign-key rules (CASCADE / SET NULL)
// and per-TC misbehaviour (FAKE_DB_SCENARIOS): a lying row count, an unpredicted side effect, a crash after commit, a
// read-back that disagrees, triggers, a cycle, no transactions, another identity. Never used outside the harness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from '@playwright/test';
import type { Adapter } from './helpers/db-record';

type Row = Record<string, unknown>;
type State = Record<string, Row[]>;
type FK = { child: string; childColumns: string[]; parentColumns: string[]; onDelete: string; onUpdate: string; schema?: string };
const FILE = (): string => process.env.FAKE_DB_FILE as string;
const load = (): State => (existsSync(FILE()) ? JSON.parse(readFileSync(FILE(), 'utf8')) : {});
const save = (s: State): void => writeFileSync(FILE(), JSON.stringify(s, null, 1));
const tcOf = (): string => { try { return (/\[(TC-[^\]]+)\]/.exec(test.info().title) || [])[1] || ''; } catch { return ''; } };
type Scenario = { spawn?: { onInsertInto: string; table: string; column: string }[]; rowCountLie?: boolean; extraSideEffect?: boolean; crashAfterCommit?: boolean; readBackLie?: boolean; transactional?: boolean; identity?: { database: string; server: string }; triggers?: Record<string, { name: string; events: string[]; body: string | null }[]>; rewrites?: Record<string, string[]>; fks?: Record<string, FK[]>; noKey?: boolean };
const scenario = (): Scenario => { try { return (JSON.parse(process.env.FAKE_DB_SCENARIOS || '{}') as Record<string, Scenario>)[tcOf()] || {}; } catch { return {}; } };

const BASE_FKS: Record<string, FK[]> = {
  orders: [
    { child: 'order_lines', childColumns: ['order_id'], parentColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
    { child: 'assignments', childColumns: ['order_id'], parentColumns: ['id'], onDelete: 'SET NULL', onUpdate: 'NO ACTION' },
  ],
  order_lines: [{ child: 'line_notes', childColumns: ['line_id'], parentColumns: ['id'], onDelete: 'CASCADE', onUpdate: 'NO ACTION' }],
};
const fks = (t: string): FK[] => (scenario().fks || {})[t] ?? BASE_FKS[t] ?? [];
const PK: Record<string, string[]> = { orders: ['id'], order_lines: ['id'], line_notes: ['id'], assignments: ['id'], audit: ['id'], cyc_a: ['id'], cyc_b: ['id'], nokey: ['code'] };

function matches(row: Row, cond: string, params: unknown[]): boolean {
  // "(a = $1 AND b = $2) OR (a = $3 …)" or "a = $1 AND b = $2"
  return cond.split(/\s+OR\s+/i).some((alt) => alt.replace(/^\(|\)$/g, '').split(/\s+AND\s+/i).every((eq) => {
    const m = /^\(?\s*([A-Za-z_][\w.]*)\s*=\s*\$(\d+)\s*\)?$/.exec(eq.trim());
    return !!m && String(row[m[1]]) === String(params[Number(m[2]) - 1]);
  }));
}
function cascadeDelete(s: State, table: string, rows: Row[]): void {
  for (const fk of fks(table)) {
    const kids = (s[fk.child] || []).filter((k) => rows.some((r) => fk.parentColumns.every((pc, i) => String(k[fk.childColumns[i]]) === String(r[pc]))));
    if (!kids.length) continue;
    if (/CASCADE/i.test(fk.onDelete)) { s[fk.child] = (s[fk.child] || []).filter((k) => !kids.includes(k)); cascadeDelete(s, fk.child, kids); }
    else if (/SET NULL/i.test(fk.onDelete)) for (const k of kids) for (const c of fk.childColumns) k[c] = null;
  }
}

export function fakeDb(): Adapter {
  let tx: State | null = null;
  const sc = scenario();
  const st = (): State => (tx ?? load());
  const commitState = (s: State) => { if (tx) tx = s; else save(s); };
  const query = async (sql: string, params: unknown[] = []) => {
    const s = JSON.parse(JSON.stringify(st())) as State;
    let m: RegExpExecArray | null;
    if ((m = /^SELECT\s+(.+?)\s+FROM\s+([\w.]+)(?:\s+WHERE\s+(.+?))?(?:\s+FOR UPDATE)?$/i.exec(sql.trim()))) {
      const rows = (s[m[2]] || []).filter((r) => !m![3] || matches(r, m![3], params));
      let out = rows.map((r) => (m![1].trim() === '*' ? { ...r } : Object.fromEntries(m![1].split(',').map((c) => [c.trim(), r[c.trim()]]))));
      if (sc.readBackLie && m[1].trim() === '*' && out.length) out = out.map((r) => ({ ...r, status: 'TAMPERED', name: 'TAMPERED' }));
      return { rows: out, rowCount: out.length };
    }
    if ((m = /^INSERT INTO\s+([\w.]+)\s+\(([^)]+)\)\s+VALUES\s+\(([^)]+)\)$/i.exec(sql.trim()))) {
      const cols = m[2].split(',').map((c) => c.trim());
      const row: Row = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
      (s[m[1]] = s[m[1]] || []).push(row);
      // the application (not this run) creates a row referencing the new one — never in the run's ledger
      for (const sp of sc.spawn || []) if (sp.onInsertInto === m[1]) (s[sp.table] = s[sp.table] || []).push({ id: 'foreign-' + sp.table + '-' + Date.now() + Math.floor(Math.random() * 1e6), [sp.column]: row.id });
      for (const tr of (sc.triggers || {})[m[1]] || []) if (/insert\s+into\s+audit/i.test(tr.body || '')) (s.audit = s.audit || []).push({ id: 'audit-' + Date.now() + '-' + Math.random(), ref: row.id });
      commitState(s);
      return { rows: [], rowCount: sc.rowCountLie ? 2 : 1 };
    }
    if ((m = /^UPDATE\s+([\w.]+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/i.exec(sql.trim()))) {
      const sets = m[2].split(',').map((x) => { const p = /([\w.]+)\s*=\s*\$(\d+)/.exec(x.trim()); return p ? [p[1], params[Number(p[2]) - 1]] as const : null; }).filter(Boolean) as [string, unknown][];
      const rows = (s[m[1]] || []).filter((r) => matches(r, m![3], params));
      for (const r of rows) for (const [c, v] of sets) r[c] = v;
      commitState(s);
      return { rows: [], rowCount: sc.rowCountLie ? rows.length + 1 : rows.length };
    }
    if ((m = /^DELETE FROM\s+([\w.]+)\s+WHERE\s+(.+)$/i.exec(sql.trim()))) {
      const rows = (s[m[1]] || []).filter((r) => matches(r, m![2], params));
      s[m[1]] = (s[m[1]] || []).filter((r) => !rows.includes(r));
      cascadeDelete(s, m[1], rows);
      if (sc.extraSideEffect) { const other = (s.orders || []).find((r) => String(r.id).startsWith('pre-')); if (other) s.orders = s.orders.filter((r) => r !== other); }
      commitState(s);
      return { rows: [], rowCount: sc.rowCountLie ? rows.length + 1 : rows.length };
    }
    throw new Error('fake-db: unsupported statement ' + sql);
  };
  return {
    engine: 'pg', transactional: sc.transactional !== false, query,
    begin: async () => { tx = load(); },
    commit: async () => { if (tx) save(tx); tx = null; if (sc.crashAfterCommit) process.exit(137); },
    rollback: async () => { tx = null; },
    identity: async () => sc.identity || { database: 'orders_test', server: 'db-test' },
    primaryKey: async (t: string) => PK[t] || [],
    referencing: async (t: string) => fks(t),
    triggers: async (t: string) => (sc.triggers || {})[t] || [],
    rewrites: async (t: string) => (sc.rewrites || {})[t] || [],
    nextKey: async (t: string, c: string) => (sc.noKey || t === 'nokey' ? null : t + '-' + c + '-' + Date.now().toString(36) + Math.floor(Math.random() * 1e6)),
    measure: async (t: string) => { const rows = st()[t] || []; return { count: rows.length, checksum: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }; },
    lock: async (t: string, pk: string[], keys: unknown[][]) => (st()[t] || []).filter((r) => keys.some((k) => pk.every((c, i) => String(r[c]) === String(k[i])))).length,
  };
}
