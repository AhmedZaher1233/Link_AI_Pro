// @link-qc-5-template data-ledger 3.1.0
// helpers/data-ledger.ts — the ownership ledger of every data change an [API] / [DB] test makes (skill 5 3.0,
// references/code-craft.md §19). ALWAYS installed; used only by helpers/api-record.ts and helpers/db-record.ts.
//
// One append-only JSON line per state change, fsynced before the call returns, in PW_DATA_LEDGER_FILE (one file per
// command, set by run-stage.mjs under artifacts/progress/). A write's life:
//
//   intent  →  committed  →  verified (read back)  →  teardown-intent → teardown-done | teardown-failed   ·   retained
//          ↘  rolled_back
//
// The `intent` line is written BEFORE the statement / request and carries the full target identity (the keys and the
// intended values of an UPDATE / DELETE, the PRE-ALLOCATED key of an INSERT, the resource of an API create): a crash
// between commit and the `committed` line leaves an intent the next run-stage call resolves by a read-only lookup — never
// assumed committed, rolled back or clean (`in-doubt` until proven). Ownership = keys of THIS run (PW_RUN_ID) in state
// committed / verified / recovered, across every ledger file of the run (PW_DATA_LEDGER_DIR) — including the records the
// run's test-data preparation created (purpose: setup). A key nobody in this run created is never owned.
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LedgerState = 'intent' | 'committed' | 'verified' | 'rolled_back' | 'teardown-intent' | 'teardown-done' | 'teardown-failed' | 'retained' | 'recovered';
export type LedgerLine = {
  at?: string; run_id?: string; channel: 'api' | 'db'; state: LedgerState; write_id: string;
  tc?: string; attempt?: number; step?: string | null; purpose?: 'test' | 'setup' | 'teardown';
  op?: 'insert' | 'update' | 'delete' | 'create' | 'modify' | 'remove';
  table?: string; resource?: string; key?: Record<string, unknown> | string | null;
  intended?: Record<string, unknown> | null; host?: string | null; identity?: string | null; note?: string;
};

const RUN_ID = (): string => process.env.PW_RUN_ID || 'local';
let seq = 0;
export const newWriteId = (tc: string): string => RUN_ID() + ':' + tc + ':' + process.pid + ':' + Date.now().toString(36) + ':' + (++seq);

/** Append + fsync: the line is on disk before the caller sends anything. Throws when the ledger cannot be written —
 *  a data change without its intent line on disk is refused, never sent. */
export function appendLedger(line: LedgerLine): void {
  const file = process.env.PW_DATA_LEDGER_FILE;
  if (!file) throw new Error('data ledger: PW_DATA_LEDGER_FILE is not set — no data change without its ledger (run it through run-stage.mjs)');
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  try { appendFileSync(fd, JSON.stringify({ at: new Date().toISOString(), run_id: RUN_ID(), ...line }) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}

/** Every ledger line of THIS run, from every ledger file of the run's progress folder. */
export function runLines(): LedgerLine[] {
  const dir = process.env.PW_DATA_LEDGER_DIR || (process.env.PW_DATA_LEDGER_FILE ? dirname(process.env.PW_DATA_LEDGER_FILE) : null);
  if (!dir || !existsSync(dir)) return [];
  const out: LedgerLine[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.data-ledger.jsonl'))) {
    for (const l of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
      if (!l.trim()) continue;
      try { const x = JSON.parse(l) as LedgerLine; if (x.run_id === RUN_ID()) out.push(x); } catch { /* a torn last line — the intent before it still counts */ }
    }
  }
  return out;
}

const keyOf = (k: unknown): string => (k === null || k === undefined ? '' : typeof k === 'string' ? k : JSON.stringify(Object.keys(k as object).sort().reduce((o, n) => ({ ...o, [n]: (k as Record<string, unknown>)[n] }), {})));

/** Keys this run OWNS for a table / resource: created (committed / verified / recovered) and not torn down. */
export function ownedKeys(where: { table?: string; resource?: string }): Set<string> {
  const last = new Map<string, LedgerLine>();
  for (const l of runLines()) {
    if ((where.table && l.table !== where.table) || (where.resource && l.resource !== where.resource)) continue;
    if (l.op !== 'insert' && l.op !== 'create' && l.state !== 'teardown-done') continue;
    last.set(keyOf(l.key), l);
  }
  const out = new Set<string>();
  for (const [k, l] of last) if (k && (l.state === 'committed' || l.state === 'verified' || l.state === 'recovered' || l.state === 'retained')) out.add(k);
  return out;
}
export const owns = (where: { table?: string; resource?: string }, key: unknown): boolean => ownedKeys(where).has(keyOf(key));
export { keyOf };
