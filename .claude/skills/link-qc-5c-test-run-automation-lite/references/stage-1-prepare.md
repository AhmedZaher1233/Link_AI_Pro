# Stage 1 — Prepare & Generate

Goal: an approved document, a run file, a healthy environment, and POM specs that Checkpoint A can pass. Every step below is ONE call
or ONE read; do nothing the stage does not name. `lite` = `node .claude/skills/link-qc-5c-test-run-automation-lite/scripts/lite.mjs`.

## 1 · Approval and delivery (no reading of the document yet)
1. Grep `^\*{0,2}Status:` in {tc doc}, first match only — the `Status:` header line (an unanchored "Status" search can hit the title of a feature named "… status"). `APPROVED` → go. Anything else → ONE question: **approve now** (rewrite that
   one line to `APPROVED`, nothing else in the document) / **run without approval** (report it under Deviations) / **stop**. `--approve` /
   `--unapproved` answer it. Never edit the document otherwise; never use skill 4's beautified copy.
2. Delivery is **not asked**: markdown report + failure-only screenshots, unless the user already said otherwise (`--report`, `--screenshots`).

## 2 · Run file
`lite init-run [--tc {doc | folder}] [--environment {name} --env-url {url} --env-class test|staging] [--allow-data-changes all|TC,…|none] [--report …] [--screenshots …] [--max-workers N]`
→ `reports/{SPEC-x/}{US-…}/.runs/phase-N.json` with the stage lists (Smoke / Stage / Type), layers, defaults, the run plan (`projects`,
`required_variants`) and — with `--allow-data-changes` — the `data_changes` record. `--project` defaults to the shared config's first
project (never guess `chromium`); a wrong first call is redone with `--force` while no stage has run. Ask in ONE message
only what is missing and blocks: the environment URL, its class (`test` / `staging`; anything else ⇒ no data changes, stop if the TCs need
them), the TC document when init-run BLOCKS with `candidates[]` (none or several found), and the automation root only when it came from
`default` while the project already has test code elsewhere. A missing `Testing/qa-manifest.json` or learning file is never a question.
The output's `sources` (TC, data, spec, constitution, manifest, learning) are the inputs for the whole run — never search again. Role credentials are never asked in chat: use the secret NAMES the project already
uses (`{automation_root}/.env`, learning file `[type: env]`, the constitution). `phase N` > 1 after a BLOCKED phase ⇒ start in a fresh session
(`node .claude/skills/link-qc-5c-test-run-automation-lite/engine/scripts/run-data.mjs handoff --run-file …`), do not continue here.

## 3 · Project knowledge — once
- `sources.constitution` set ⇒ Read it once: its rules on test location, naming, tooling, languages and data apply to the code you write;
  a rule that would weaken a Lite gate loses to the gate (note it under Deviations). Never edit it.
- `sources.learning` set ⇒ Grep (case-insensitive, line numbers) `{module}|{page}|{element}|\[type: qa\]` in {learning} (index + tag lines only); absent ⇒ skip. An answered question is applied,
never re-asked; page tricks, selectors and `[type: env]` facts (auth, reset) already learned are reused. A line tagged
`[type: tooling] [skill: x.y.z]` from an older skill version is ignored (it worked around a defect since fixed).

## 4 · Environment and configuration — once
1. `lite preflight --run-file {rf} --probe-url {env-url} [--env-id {id}]` — if the reason starts `config location`, ask once, then
   `node .claude/skills/link-qc-5c-test-run-automation-lite/engine/scripts/config-inventory.mjs reconcile --root . --results-root {results_root} --apply --move-config`.
   `blocked` ⇒ `## ENVIRONMENT_BLOCKED` (never blame the code). Low memory is never a blocker or a question: preflight says `memory: low` and the run goes serial without the ledger. Lease: when `--env-id` is given run
   `capacity.mjs lease acquire --run-file {rf} --env-id {id}` (Full `execution.md` `<capacity_and_lease>`); release in stage 4.
2. `config-inventory.mjs reconcile --root . --results-root {results_root} --run-file {rf} --apply` — installs / refreshes the run
   protections and helpers (`helpers/evidence.ts`, `steps.ts`, guards, `timeouts.ts`). This is the only configuration step; Checkpoint A
   fails on inactive protections, so do it BEFORE generating.
3. **Auth strategy — once** (how the app keeps a session decides how tests sign in; never assumed from the story):
   - The learning file already says (cookie / token session, whether the environment reset ends sessions, whether the UI language follows
     the profile, the session or a cookie) ⇒ `lite auth --run-file {rf} --mechanism cookie|token|other --survives-reset true|false|no-reset
     --language-scope profile|session|cookie|none [--api-signin yes|no] --source learning`.
   - Otherwise copy `assets/templates/auth.setup.ts` + `auth.ts` (roles from TEST-DATA) and probe ONCE (test / staging only):
     `lite auth --run-file {rf} --probe-spec tests/auth.setup.ts [--api-signin yes|no]`; write the findings to the learning file as generic
     `[type: env]` facts so the next run skips the probe.
   - Strategy → code: `setup-project` = a setup project saves `.auth/{role}[-{lang}].json`, specs `test.use({ storageState: storageStateFor(role) })`;
     `api-helper` = `signInAs(context, request, role)` after each reset; `ui-fallback` only with `--fallback-reason`. UI sign-in stays in TCs
     whose subject IS sign-in (login, logout, lockout, post-login redirect / language).

## 5 · Inventory and reads (delta)
- `validate-automation.mjs --root . --page-scan` — the existing page classes; **reuse** POMs, helpers, `api/` clients, `db/` objects, fixtures.
  A new page class only when no existing one owns the screen.
- Read the TC document ONCE (Read) and its TEST-DATA file; keep them. `lite cache --results-root {rr} --files {app source files} --mark`
  tells which app / POM files changed since you last read them — re-read only `read[]`.
- Selectors: confirm in app source or an existing POM (grep the component / route; `data-testid` first). Nothing is guessed. Only an
  AMBIGUOUS case justifies one live look (Full `scratch-investigation.md`, load it then). Safe `data-testid` additions to product code are the
  only product edit allowed.
- `[API]` / `[DB]` lines ⇒ load Full `api-db.md` once. `ADO-MAP.md` present ⇒ note `ado_mode linked` (Full `azure-devops.md` is loaded in stage 4 only with `--ado`).
- Greenfield project (no spec to copy the pattern from) ⇒ load Full `code-generation.md` `<spec_writing>` + `<pom_mandatory>` once; otherwise
  copy the shape of the project's own latest spec.

## 6 · Generate
Spec file card — specs contain test cases only; everything that drives or locates lives in a page object:
```ts
import { test, expect } from '../fixtures/test';              // the project's fixture file (guards attached in beforeEach, reported in afterEach)
import { OrdersPage } from '../pages/OrdersPage';
import { captureEvidence } from '../helpers/evidence';
test.describe('REQ-001: an order can be created and listed', () => {
  test('[TC-01] Validate that a new order appears in the list', { tag: ['@smoke', '@positive', '@run:parallel'] }, async ({ page }, testInfo) => {
    const orders = new OrdersPage(page);
    await step('Create the order Alpha', async () => { await orders.create('Alpha'); });   // one step() per manual step
    await captureEvidence(page, testInfo);                     // ONE, top level, before the assertion, never in a hook
    await expect(orders.nameCell('Alpha')).toHaveText('Alpha'); // the TC's Expected Result, from the approved document
  });
});
```
- Title `[TC-ID] Validate that …`; one of `@positive` / `@negative`; `@smoke` only for `Smoke: YES`; `@run:parallel` (the run file's group).
- **Variants** (languages, roles): a loop over a literal list, never unrolled; each resolved title carries exactly one `[TC-ID]`:
  ``for (const [id, lang] of [['TC-05', 'en'], ['TC-05b', 'fr']] as const) test(`[${id}] Validate that … [lang: ${lang}]`, …)``.
- **Page classes** extend `assets/templates/base-page.ts` (`pages/BasePage.ts`): readiness wait and shell live there once; a page holds its
  route, root locator and own members. Shared widgets (toast, dialog, header) are component classes — never copied per page.
- `test.skip(cond, REASON)` / `test.fixme(…)`: a string literal or a `const` string (this file or an import) — never a `let`, a call or `${}`.
- Timeouts only from `TIMEOUTS.*`; data names via `uniqueName()`; no `networkidle`, no `waitForTimeout`; no empty catch.
- A TC whose wording is ambiguous: code the recommended reading, tag `@unverified-assumption`, remember it for the judgements file; ONE
  batch of questions only if the ambiguity blocks the test (answer → write to the learning file at once).
- `[HUMAN]` steps: generate up to the first one; the TC ends `PARTIAL — human step pending`, never PASS.
- **Data ledger:** every data change goes through the ledger (`helpers/data-ledger.ts`) — `prerequest/` test-support calls (clock, reset,
  outbox) **and** data-changing page-object actions. Copy `assets/templates/prerequest-ledger.ts` to `prerequest/ledger.ts` once and wrap each
  change in `recordChange(…)`; `checkpoint-a` warns per consented TC whose spec reaches no ledger call (else check 53 fails at finalize).
  Label the owner (check 53 accepts run-owned records only): clock set / seed reset → `op: createOrModify(CLOCK | SEED)`; a change
  inside that data set (approve, language switch, outbox clear, job run) → `inRunData(SEED, …)`; a record the run submits → `create`
  with `keyAfter`; pre-existing data → `modify-external` (refused at B — create the data instead). `checkpoint-a` FAILs a mislabel.
- **Run-level clean-up ONCE:** restoring the server time / resetting the seed / anything that waits belongs in one teardown journey
  (`assets/templates/teardown.spec.ts` → `tests/{Area}_Tests/99-teardown-{feature}.spec.ts`, tags `@setup @run:teardown`), run by
  `lite teardown` in stage 3 — never in a stage's `afterAll` (a wait there is paid by every stage command of every pass). Per-TC resets stay in `beforeEach`.
  A learned wait before the reset applies to this journey only.
- **Journeys** (teardown, auth setup): `annotation: { type: 'journey', description: 'setup' | 'teardown' }`, no `[TC-ID]`; list each once with
  `lite journey --run-file {rf} --spec {file}`; keep them in every `checkpoint-a` / `finalize --files` (all other rules apply to them).
- Run `npx tsc --noEmit -p Testing/Automation` yourself only if `checkpoint-a` is not about to run — it does it for you.

Done when the specs exist. Next: stage 2 — `lite checkpoint-a`.
