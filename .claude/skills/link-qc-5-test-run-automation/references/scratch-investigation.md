# Scratch investigation — a live look without a stage (`<scratch_investigation>`)

<scratch_investigation>
**What it is.** `scripts/scratch.mjs` runs ONE temporary probe with the project's own Playwright, the shared
config (through a generated overlay), its page objects and its env layer. It answers a question; it never
produces a result. Load this file only when the step below needs a live look.

**When — only after source and evidence cannot decide:**
- `<selector_resolution>` left a selector AMBIGUOUS and one look at the screen would pick the element (before the
  safe `data-testid` fix or the open question);
- a heal (`<first_run>` step 3) where the retained trace, the error line and the source do not explain the
  failure: does this page-object locator resolve, what state is the page in after login, where does this
  navigation land.

Never to settle an expected result (`automation-rules.md` §1 — observed behaviour is evidence, not authority),
never to re-check what source or a page object already confirms, never while a `run-stage.mjs` call is in flight.

**How.**
1. Write the probe directly in `{automation_root}/test-results/qa-scratch/{short-name}.spec.ts` — never under
   `tests/` and never anywhere else. Put every question of this investigation in ONE probe (one login, one
   browser). Skeleton (names are the project's — `{login_page_object}`, its env / test-data layer):
   ```ts
   import { test, expect } from '@playwright/test';
   import { LoginPage } from '../../pages/LoginPage';           // the project's page objects, relative
   import { account } from '../../helpers/test-data';           // credentials only through the env layer
   test('probe › save button resolves after login', async ({ page }) => {
     const dashboard = await new LoginPage(page).loginAs(account('A1'));
     console.log('save visible:', await dashboard.saveButton.isVisible());
   });
   ```
2. `node scripts/scratch.mjs run --root {automation_root} --spec {that file} --results-root {results_root}
   [--project {browser project}] [--headless] [--timeout ms]` — foreground; one worker, no retries, trace +
   screenshot on, the project's `globalSetup` and stage variables off.
3. Read `outcome`: `observed` (the probe ran — a failed probe test is an observation, not a FAIL of anything) ·
   `refused` (fix what `refused[]` names; no browser started — `capacity`: the machine is at its Playwright worker
   ceiling, another run is using it, retry later; `no-coordination`: the coordination directory cannot be used —
   the probe holds one slot under the same ceiling as the stages, released only when a process table confirms the probe
   and its browser ended — `capacity.released: false` means it is still held) · `timeout` · `error` (read `output[]`) ·
   `violation` (a file was written outside `test-results/` — delete it, say so, and fix the probe). Traces and
   screenshots are listed in `artifacts[]` (`npx playwright show-trace <file>`).
4. `node scripts/scratch.mjs clean --root {automation_root}` when the investigation is over, and in any case
   before Checkpoint B (`removed` / `absent`).

**Hard limits.**
- A probe is never a TC result, a re-run, an isolation check, a burn-in or freshness proof. The verdict of a TC
  still comes only from `run-stage.mjs`. In the Heal Log a probe may be cited only as the diagnosis
  (`scratch: {what was observed}`), never as the verification.
- Its output never enters `.runs/`, the report, `screenshots/` or the progress log, and is never shown as
  evidence.
- The script refuses a probe that captures official evidence, takes its own screenshot, uses `storageState`,
  writes files, reads `process.env`, prints a credential property or names a TC — and refuses to start while a
  stage's progress file is fresh.
- No new code reaches the repository from a probe: a locator the probe confirmed goes into the page object
  through the normal heal, then the official re-run proves it.
</scratch_investigation>
