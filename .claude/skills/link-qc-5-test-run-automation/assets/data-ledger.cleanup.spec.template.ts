// tests/_cleanup/data-ledger.cleanup.api.spec.ts — the post-run clean-up of the records this run created and kept
// (skill 5 3.0, references/code-craft.md §19). A SETUP JOURNEY of its own (no TC-ID): run ONLY after the tester's
// clean-up answer, as the run plan's setup group `data-cleanup` — `run-stage.mjs --stage setup --groups data-cleanup
// --project backend` — with data_changes.cleanup recorded in the run file (PW_DATA_CLEANUP=allowed, PW_RUN_ID = the run);
// workers 1, under the run's environment lease.
//
// It reads every ledger file of the run, takes each created record whose last state is committed / verified /
// recovered / retained — never an in-doubt intent, never a key the run did not create — and removes it through the SAME
// guarded path a test uses: db-record's delete (ownership, cascade closure, triggers, row count, read-back of the
// absence) with purpose 'teardown', or the api/ client's cleanup registered in ./registry.ts (resource → delete).
// A row it cannot remove stays listed as `teardown-failed` / retained; nothing else is ever touched.
import { test, expect } from '@playwright/test';
import { attachDbRecord } from '../../helpers/db-record';
import { attachApiRecord } from '../../helpers/api-record';
import { dbClientFromEnv } from '../../helpers/db';
import { runLines, keyOf } from '../../helpers/data-ledger';
import { reportRecord } from '../../helpers/record';
import { registry } from './registry';

test('remove the records this run created @setup @run:data-cleanup', async ({ request }, testInfo) => {
  test.skip(process.env.PW_DATA_CLEANUP !== 'allowed', 'no clean-up answer from the tester — the records stay retained');
  const last = new Map<string, { channel: string; table?: string; resource?: string; key: unknown; state: string }>();
  for (const l of runLines()) {
    if (l.op !== 'insert' && l.op !== 'create' && l.state !== 'teardown-done') continue;
    const k = (l.table || l.resource || '') + '|' + keyOf(l.key);
    last.set(k, { channel: l.channel, table: l.table, resource: l.resource, key: l.key, state: l.state });
  }
  const todo = [...last.values()].filter((x) => ['committed', 'verified', 'recovered', 'retained'].includes(x.state));
  const failures: string[] = [];
  const dbRows = todo.filter((x) => x.channel === 'db');
  if (dbRows.length) {
    const d = await attachDbRecord(await dbClientFromEnv(), testInfo);
    // children first: a row another created row references is removed after it (reverse creation order)
    for (const x of dbRows.reverse()) { try { await d.db.delete({ table: x.table as string, key: x.key as Record<string, unknown>, purpose: 'teardown' }); } catch (e) { failures.push(x.table + ' ' + keyOf(x.key) + ': ' + String((e as Error).message).slice(0, 120)); } }
    await d.report(testInfo);
  }
  const apiRows = todo.filter((x) => x.channel === 'api');
  if (apiRows.length) {
    const a = attachApiRecord(request, testInfo);
    for (const x of apiRows.reverse()) {
      const remove = registry[x.resource as string];
      if (!remove) { failures.push(x.resource + ' ' + keyOf(x.key) + ': no clean-up registered'); continue; }
      try { await remove(a.request, String(x.key)); } catch (e) { failures.push(x.resource + ' ' + keyOf(x.key) + ': ' + String((e as Error).message).slice(0, 120)); }
    }
  }
  await reportRecord(testInfo);
  expect(failures, 'records this run could not remove (they stay listed as retained)').toEqual([]);
});
