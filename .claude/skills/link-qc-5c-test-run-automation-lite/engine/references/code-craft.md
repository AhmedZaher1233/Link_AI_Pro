# Code craft - page objects, locators, specs, the shared config, timeouts and diagnostics

[M] = mandatory (Checkpoint item + validator rule where one exists); [R] = recommended. Detail per section: references/maintainers/code-craft.md (same §).

## 1. Page-object authoring [M]

Standard POM: readonly locators named for the element, one intent-named method per action, navigation returns the next page object. One shared readiness wait on a base class (`BasePage.waitForLoaderHidden()`, `gotoAppPath(path)`), observable, never a timer. `expectX()` assertions live on the page object (§15). One class per logical screen; match the project's style first. One page class per screen across the WHOLE root, never a twin: created only from an `<automation_inventory>` `create` row whose candidates are all rejected (validator `pom-duplicate-page`, run with `--inventory`).

## 2. Component objects [M]

A reusable widget is a component under `pages/components/`; its constructor takes a scoping `Locator`, not `Page`. Document-root overlays resolve at page level by role.

## 3. Locator strategy [M]

In order, scoped to a container when one exists: 1 source-confirmed `data-testid` (`<selector_resolution>`) · 2 role + accessible name · 3 label / placeholder · 4 visible text, static only · 5 stable CSS with the reason on the line above. Never `_ngcontent-*` / `ng-reflect-*`, Material class chains, `nth-child`, positional XPath. Translated text goes through the locale constant table.

## 4. Positional selectors [M, validator `positional-unscoped`]

`first()` / `last()` / `nth(i)` only on a scoped chain (`filter({ hasText | has })` or a named container narrowed further), or with a comment on the line above saying why the POSITION is the requirement (a `qa-allow` pragma also counts).

## 5. Spec structure [M]

- One `step()` per manual TC step, titled with the step's wording, from `helpers/steps.ts`; new / updated specs are validated with `--require-steps`.
- Arrange, Act, `await captureEvidence(page, testInfo)`, Assert, teardown. The evidence call is a TOP-LEVEL statement right before the Assert step, never inside a `step()` callback, never after cleanup. The helper is the skill's `assets/evidence.template.ts`, installed as `helpers/evidence.ts` by `config-inventory.mjs reconcile --apply` like `steps.ts`, never written by hand: it captures at the assertion point and writes `attempt-{a}.png`, `attempt-{a}-failed.png`, exactly ONE `evidence` heartbeat per attempt (the failure image writes none) and `variants.json`. A project's own helper must meet the same contract (validator `evidence-helper-contract`).
- Tags via the details object (`{ tag: ['@positive', '@run:parallel'] }`). The title starts with the TC id(s) in brackets and carries its variant in a fixed, machine-readable form: `[lang: ar]` / `[role: manager]` / `[variation: …]` (or the existing `— variation …` suffix); `impact.mjs select` reads these to decide branch-level impact (`impact_level: branch`).
- `expect.soft` only for INDEPENDENT checks; the Assert step ends with a hard `expect`. No helpers in specs; suites carry the requirement ID.

## 6. Fixtures and `prerequest/` [R; M once a fixture layer exists]

`prerequest/*PreRequest.ts` = provisioning functions (API, idempotent, no UI). `fixtures/test.ts` (`test.extend`) MAY wrap them for guaranteed teardown or per-worker scope (delete after the evidence image); such a spec imports `test` / `expect` from `../../fixtures/test`. No teardown needed: `prerequest` call in `beforeAll`; otherwise a fixture; never both. Record the choice under `automation.layers.fixtures` in `Testing/qa-manifest.json`.

Admission contract [M once `helpers/admission.ts` exists, validator `admission-contract`]: `helpers/admission.ts` holds the automatic fixtures `workerAdmission` (worker scope) and `unitAdmission` (test scope). The project's `test.extend` module extends its `test`; every side-effecting worker fixture lists `workerAdmission`; every side-effecting test fixture lists `unitAdmission`; every side-effecting `beforeAll` takes `workerAdmission` as a parameter. A refused worker's tests are `NOT_RUN — not started: admission timeout (…)`, never FAIL. A unit breaking the contract runs as one indivisible unit (U4).

## 7. Unique test data [M]

Every created record carries `uniqueName(prefix)` from `helpers/test-data.ts` (`{prefix}-p{phase}-w{parallelIndex}-r{retry}[-e{repeat}]-{4 random}`, plus `-l{lane}` under `PW_LANE`); cleanup selects by `runPrefix(prefix)`. A fixed literal only for data the TC READS and PHASE 2.6 provisioned. A teardown timeout gives `cleanup_incomplete`.

## 8. The shared configuration [M]

One `playwright.config.ts` for every story, living IN `{automation_root}` (`<shared_config>` owns the consolidation). `testDir`, `outputDir`, every reporter output path and `PW_SCREENSHOTS_ROOT` resolve under the automation root; `run-stage.mjs preflight` BLOCKS with `config location` when any resolves outside it; the fix is `config-inventory.mjs reconcile --root {project} --results-root {results_root} --apply --move-config` (one question, before any code). `run-stage.mjs` passes the config to Playwright (`--config`); the model never writes a `--config`, `--cwd` or `cd`.

Contract (the template holds it; reconcile enforces it): project `chromium`, `channel: 'chrome'`, project NAME stable · `headless: false` unless `PW_HEADLESS=1` · `workers` from `PW_WORKERS` · `fullyParallel: true` · `retries: 0` · timeouts from `timeouts.ts` (§9) · `outputDir` from `PW_OUTPUT_DIR` · reporters additive (`['line']`, json on `PW_STAGE_JSON`, `./helpers/progress-reporter.ts`), never `--reporter` on the CLI · `trace: 'retain-on-failure'` · a `backend` project only with `[API]` / `[DB]` lines. Per-run values reach the config only through the `PW_*` env vars `run-stage.mjs` sets; nothing is rewritten per story.

## 9. Timeout policy [M]

TC budget (Playwright `timeout`) and per-step deadline (`step()`) are separate; `timeouts.ts` asserts `test.default >= 2 x step.default`. Initial values (`timeouts.ts`, from `assets/timeouts.template.ts`): `test.default` 90 s / `test.long` 180 s · `expect` 10 s · `action` 15 s · `navigation` 30 s · `hook` 60 s · `step.default` 30 s / `step.long` 120 s · `operations.*` = THE exception: a named KNOWN long operation (`step(title, body, { operation: 'name' })`) · `watchdog_grace` 60 s · `stall.silence` 55 s · `diagnostics` 30 s · `admission.max_wait` 600 s. Values are recommended; importing them from `timeouts.ts` (never inline) and recording them in `{run_file}.timeouts` is mandatory.

Rules: `actionTimeout` / `navigationTimeout` FINITE everywhere (`0` = unlimited; reconcile item 43 FAILs it); a step without meaningful progress is stopped within 120 s; the deadline is FIXED from the step's start; only a rising counter or a new milestone (`report('rows', { done, total })`) resets the silence clock; the watchdog's silence rule is ACTIVE. Exceptions: a named `operations` entry with its reason, or a calibration record `{key, reason, evidence, progress reporting}` in `{run_file}.timeouts.adjusted[]`; never a raised default, an automatic extension or a retry (calibration: `<first_run>` step 2b). Existing projects are RECONCILED, never replaced. Rate-limit waits never hold a step open: the start-of-test reservation runs before any step; a mid-test `rateLimitSlot()` wait is bounded by `in_step_wait`. No other pacing sleep exists.

## 10. Waits [M, validator `wait-network-idle`]

Policy: `automation-rules.md` §4. Never `networkidle`; wait for the application's own signal. A visible loader never extends a deadline.

## 11. Diagnostics [M capture · R fail]

- `helpers/console-guard.ts`: attached in `beforeEach`, reported in `afterEach`; an unexpected entry never fails the TC by itself; it goes under Deviations.
- `helpers/network-guard.ts`, same hooks (`attachNetworkGuard(page, testInfo)` / `net.report(testInfo)`): records refusals, reserves the start-of-test slots; never fails a test. A TC whose expected result IS a refusal carries `expects-refusal`.
- `guard.report()` is the FIRST statement of `afterEach`: it writes the `teardown` heartbeat (the assertion-point image must precede it, item 16b) and a `console-report` heartbeat (item 46b).

## 12. `.gitignore` [M]

Contains `node_modules/`, `test-results/`, `playwright-report/`, `**/artifacts/`, `.auth/`, `.env`, `.env.*`, `!.env.example`; NEVER `reports/`, `screenshots/`, `automation-logs/` or `.runs/`.

## 13. Stability verification [M in the heal loop]

A healed test is confirmed by the re-run's burn-in when its `cause_class` owes one (`automation-rules.md` §5); a failure seen only with `workers >= 2` is caught by the isolation check: fix the data or the run plan, never the assertion. Order dependence: reproduce with `run-stage.mjs --tcs {the pair}`, fix the fixture / teardown.

## 14. Playwright version gate [M]

Read `@playwright/test` from `package.json`, confirm with `npx playwright --version`, record in `timeouts.playwright_version`. Below 1.42: BLOCKED before generation (`npm i -D @playwright/test@latest && npx playwright install chrome`) · 1.42-1.43: no `--last-failed` · 1.44-1.49: step deadlines by the `step()` timer only · 1.50+: native step timeout too. A lacking feature is named in Deviations.

## 15. Deliberate departures - keep them

`expectX()` on page objects · login per test through `{login_page_object}`, no `storageState` (decision 2026-10-19) · `data-testid` first, role second · one command per run-plan GROUP and stage · `retries: 0` · a pure API TC authenticates per test · `maxRedirects: 0`. Change one only on an explicit user instruction.

## 16. API endpoint clients (3.0) [M, validator `api-*`]

`api/{Area}Api.ts` holds the endpoint methods, their `expectX()` and `cleanup`; specs call client methods only. A fixture wraps `request` ONCE per test with `attachApiRecord(request, testInfo)`. Every call passes `effect` from the inventory mapping row; `purpose: 'setup'` only in `prerequest/` / fixtures; `maxRedirects: 0`; no auth literal; `expectX(…, 'ER1')` wraps its `expect` in `assertRecorded(target, { line: 'ER1' }, …)`; write ids only from this run's ledger.

## 17. DB query objects and the driver (3.0) [M, validator `db-*`]

`db/{Area}Db.ts`: named reads `db.read(name, sql, params, { keepColumns })` and structured writes `db.insert` / `db.update` / `db.delete`; no free-form write SQL; no raw SQL or driver import in a spec. `helpers/db.ts` is the ONE driver access: `dbClientFromEnv(name)` reads only `QA_DB_URL` / `QA_DB_{NAME}_URL` / `PW_DB_ENV_VAR`. `attachDbRecord(adapter, testInfo)` verifies the identity; a write passes gate, ownership, cascade closure, trigger rule, one guarded transaction, then the read-back.

## 18. The evidence record and redaction (3.0) [M, validator `record-*`]

An `api` / `db` / `api+db` / `hybrid` test calls `captureRecord(testInfo)` ONCE at the assertion point before teardown (a hybrid keeps its image too). The record (`skill5-record/1`, `attempt-{a}.record.json` beside the image path) carries entries, assertions with `ER{n}` and a seal. Redaction is deny-by-default, fail-closed; a record still carrying a secret is NOT written (`evidence_invalid (redaction)`). Never log a body or a row.

## 19. The ownership ledger and teardown (3.0) [M, validator `*-unledgered`]

`helpers/data-ledger.ts` appends one fsynced JSONL line per state (`intent`, `committed`, `verified`, then `teardown-done` | `teardown-failed` | `retained`, or `rolled_back`) to `PW_DATA_LEDGER_FILE`: the ONLY proof a record belongs to the run. `create` (incl. a first clock / seed reset) = run-owned; `modify-external` = refused (53). Teardown removes the test's own records through the same path; a failure gives `cleanup_incomplete`. Post-run clean-up: `tests/_cleanup/data-ledger.cleanup.api.spec.ts` (`<backend_results>` §6) with `tests/_cleanup/registry.ts` mapping each resource to its client's delete; an unmapped resource stays retained.
