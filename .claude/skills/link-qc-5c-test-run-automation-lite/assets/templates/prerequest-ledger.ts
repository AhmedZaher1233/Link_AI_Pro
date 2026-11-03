// prerequest/ledger.ts — Lite template (copy to {automation_root}/prerequest/ledger.ts, adapt the resource constants).
// Every data change a consented TC makes goes through recordChange(): the environment-level test-support calls (server clock,
// seed / database reset, outbox clear …) AND the data-changing page-object actions (submit, approve, delete …). Each change
// writes intent → committed | rolled_back to the run's ownership ledger (helpers/data-ledger.ts; PW_DATA_LEDGER_FILE is set
// per command by run-stage.mjs), so Checkpoint B check 53 can prove the change was consented, run-owned and cleaned up.
// Without it check 53 is `unresolved` for every data-changing TC and the run cannot be accepted.
//
// OWNERSHIP — the op says who owns the target (check 53 accepts writes on run-owned records only; Checkpoint A checks the
// labels statically and FAILs a `modify` / `remove` on a resource no ledger call in scope creates):
//   create           the run brings the target into being: a record it submits, AND the first clock override / seed reset of
//                    the run (that data set is the run's from then on) — use createOrModify(RES) for the set / reset calls
//   modify | remove  a later change to a target the run created (the next clock set, a reset, an approval inside the
//                    run-created data set — inRunData(RES, …)), or the run-level teardown of it
//   modify-external  a change to data the run did NOT create (a shared fixture, a pre-existing record). Label it honestly:
//                    check 53 refuses it at Checkpoint B whatever the consent — create the data in the run instead.
import { test } from '@playwright/test';
import { appendLedger, newWriteId, owns, type LedgerLine } from '../helpers/data-ledger';
import { tcIdsOf } from '../helpers/steps';

// One constant per resource the run changes — a stable name the ledger, the ownership check and the clean-up all use.
export const SEED = { resource: 'application database (seed data set)', key: 'seed' } as const;
export const CLOCK = { resource: 'server clock override', key: 'override' } as const;

type Res = { resource: string; key: string };

export type Change = {
  purpose: 'test' | 'setup' | 'teardown'; // test = the TC's own change · setup = a precondition · teardown = the run-level restore
  op: NonNullable<LedgerLine['op']>;      // create | modify | remove | modify-external (see OWNERSHIP above)
  resource: string;
  key: string | null;
  note: string;
};

function currentTc(): string | undefined {
  try { return tcIdsOf(test.info().title)[0]; } catch { return undefined; } // outside a test (a hook without a TC): none
}

/** The first change of a run-created resource is `create`, every later one `modify` of what the run now owns. */
export function createOrModify(res: Res): 'create' | 'modify' {
  return owns({ resource: res.resource }, res.key) ? 'modify' : 'create';
}

/** A change inside a resource the run created (e.g. an approval or a language switch inside the run's seed data set). */
export function inRunData(res: Res, purpose: Change['purpose'], what: string): Change {
  return { purpose, op: 'modify', ...res, note: what };
}

/**
 * intent → the action → committed (or rolled_back when it throws or `applied` says the server refused it).
 * A creation whose key is known only afterwards returns it through `keyAfter`.
 *
 *   await recordChange({ purpose: 'setup', op: createOrModify(CLOCK), ...CLOCK, note: 'server clock → the TC start time' }, () => support.setClock(t));
 *   await recordChange({ purpose: 'setup', op: createOrModify(SEED), ...SEED, note: 'reset to the seed data' }, () => support.resetSeed());
 *   await recordChange(inRunData(SEED, 'test', 'approve ORD-1'), () => details.approve());
 *   await recordChange({ purpose: 'test', op: 'create', resource: 'order', key: null, note: 'submit' },
 *     () => portal.submitLeave(data), { keyAfter: (r) => r.reference });
 */
export async function recordChange<T>(change: Change, action: () => Promise<T>, outcome: { applied?: (r: T) => boolean; keyAfter?: (r: T) => string } = {}): Promise<T> {
  const writeId = newWriteId(currentTc() ?? 'run');
  const base: Omit<LedgerLine, 'state'> = { channel: 'api', write_id: writeId, tc: currentTc(), purpose: change.purpose, op: change.op, resource: change.resource, key: change.key, note: change.note };
  appendLedger({ ...base, state: change.purpose === 'teardown' ? 'teardown-intent' : 'intent' });
  let result: T;
  try {
    result = await action();
  } catch (error) {
    appendLedger({ ...base, state: change.purpose === 'teardown' ? 'teardown-failed' : 'rolled_back', note: `${change.note} — failed: ${String(error).slice(0, 200)}` });
    throw error;
  }
  if (outcome.applied && !outcome.applied(result)) {
    appendLedger({ ...base, state: 'rolled_back', note: `${change.note} — refused by the server, nothing changed` });
    return result;
  }
  const key = outcome.keyAfter ? outcome.keyAfter(result) : change.key;
  appendLedger({ ...base, key, state: change.purpose === 'teardown' ? 'teardown-done' : 'committed' });
  return result;
}
