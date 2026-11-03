// tests/{Area}_Tests/99-teardown-{feature}.spec.ts — Lite template: the run-level restore / reset, run ONCE per run by
// `lite teardown --run-file {rf} --spec tests/{Area}_Tests/99-teardown-{feature}.spec.ts` after the last stage or re-run and
// before finalize. Never in a stage's afterAll: a wait there (e.g. for a scheduled job) is paid by every stage command of every
// pass. It is a JOURNEY, never a result: the annotation `{ type: 'journey', description: 'teardown' }` declares it, `lite teardown`
// (or `lite journey`) lists it in the run file, and Checkpoint A then exempts it from the [TC-ID] rule only — so its title never
// carries a [TC-ID], and every other rule (POM, assertions, safety) still applies. Include it in checkpoint-a / finalize --files.
// It must match the shared config's testMatch for the project (see the config's projects[].testMatch).
import { test, expect } from '../../fixtures/test';
import { recordChange, SEED, CLOCK } from '../../prerequest/ledger';
import { SupportApi } from '../../prerequest/SupportApi'; // the project's own test-support client (rename to yours)

test.describe('teardown: restore the environment the run changed', () => {
  test('Restore the environment once', {
    tag: ['@setup', '@run:teardown'],
    annotation: { type: 'journey', description: 'teardown' },
  }, async ({ request }) => {
    const support = new SupportApi(request);
    // both targets are run-owned: the run's first change of each was ledgered `create` (createOrModify)
    await recordChange({ purpose: 'teardown', op: 'remove', ...CLOCK, note: 'restore the real server time' }, () => support.clearClock());
    // a one-off wait the environment needs belongs here — once per run, never per stage — inside a step() that report()s its
    // progress (`report('seconds waited', { done, total })`): a silent wait is a stall (48b)
    await recordChange({ purpose: 'teardown', op: 'modify', ...SEED, note: 'reset the run-created data set' }, () => support.resetSeed());
    expect(await support.clockOverride()).toBeNull(); // the restore is asserted, never assumed
  });
});
