# Writing the automation code - PHASE 2

Detail: references/maintainers/code-generation.md (same blocks).

## PHASE 2 - GENERATE AUTOMATION CODE

Source: the ORIGINAL approved `{source_tc_doc}`, never the beautified file. Candidacy: respect an `Automation Candidate` field, else derive it (every step maps deterministically to an action and an assertion); record decision + reason per TC; non-candidates are `manual — not automated`.

`[HUMAN]` steps bound execution, not candidacy: generate up to the first `[HUMAN]` step; coverage `partial (human step: n)`, outcome `PARTIAL — human step pending`; never `PASS`, never `Automated` in ADO, no `automated_tc_sha256`.

First-draft card: spec = test cases only; every locator in a page object decided by its inventory row; `captureEvidence` top-level before Assert; every timeout a `TIMEOUTS.*` key; `afterEach`: `guard.report()` first, then `net.report()`; both guards attached in `beforeEach`; no empty catch without its comment; data via `uniqueName()`; side-effecting fixtures / `beforeAll` depend on `workerAdmission` / `unitAdmission` (code-craft §6); a TC expecting a refusal annotates `expects-refusal`. An ambiguous TC is PARKED as an open question for PHASE 2.4, never a stop, never silently resolved.

<source_of_truth>
Only an approved requirement or an explicitly approved clarification defines an expected result. Code, observed behaviour, learning-file lines and skill 11's unapproved rules are evidence, never authority. A TC / requirement conflict goes to `### Deviations` and the TC is parked; an unanswered question is tagged `@unverified-assumption` and counted *Assumed*. Rules: `references/automation-rules.md` §1-§2.
</source_of_truth>

<hierarchy_verification>
Runs at the START of EVERY invocation.

1. Verify the skeleton at `{automation_root}`: `tests/{Area}_Tests/` · `pages/` · `prerequest/` · `helpers/` (every helper from `assets/*.template.ts` via `config-inventory.mjs reconcile --apply`, `evidence.ts` included, never hand-written) · with `[API]` / `[DB]` lines: `api/`, `db/`, `tests/_cleanup/` · `utils/env` · the ONE `playwright.config.ts` IN the automation root + `timeouts.ts` · `.gitignore` (code-craft §12) · `reports/`, `screenshots/`, `automation-logs/`, each `/{spec_level}{user_story_name}/`.
2. First run: CREATE the missing hierarchy per the project convention BEFORE writing any file.
3. Every later run: FIX drift first (folder, `NN-` number, `testMatch` registration, inlined locators).
4. Emit a Placement Manifest every run: `| File | Path | Registered in config | Status (created / verified / moved / fixed) |`.
</hierarchy_verification>

<automation_inventory>
No page object is written before the inventory exists; a twin page class is a Checkpoint A failure.

1. Scan the WHOLE `{automation_root}` ONCE: `node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root . --page-scan [--inventory {reports_folder}/automation-inventory.md]`.
2. Match each screen by normalized name, then route literal, then two or more identical locators. A match is evidence, never the decision.
3. Write `{reports_folder}/automation-inventory.md` (rewritten each run), one row per screen: `| Screen | Decision | Class | Candidates considered | Reason |`; Decision `reuse {class}` / `extend {class} (+{methods})` / `create {class}`; every candidate `accepted` / `rejected` with the reason. An unaddressed candidate or a pair with no row is a Checkpoint A failure; a row covers a pair only when it names BOTH classes.
4. Every validator run passes `--inventory {reports_folder}/automation-inventory.md`: a covered pair is `pom-duplicate-page-decided`; an uncovered one stays `pom-duplicate-page` and keeps the scanner gate BLOCKED.
5. Record each decision in the learning file `## Automation Tricks` as one `[type: trick]` line.
6. API / DB (3.0): the inventory also holds the API / DB mapping table (`api-db.md` `<backend_layers>` §3); `api/` / `db/` classes are decided like page objects (code-craft §16-19).
</automation_inventory>

<pom_mandatory>
Page Object Model is MANDATORY: every screen interaction goes through a page-object method. REUSE / EXTEND / CREATE exactly as the `<automation_inventory>` row says. A locator inline in a spec is a self-check FAILURE: move it before running anything.

Banned in a spec, each belonging in a page-object method: `page.locator` / `getByTestId` / `getByRole`; chaining `.locator()`, `.evaluate()`, `.count()` or `.innerText()` off an exposed locator; `page.goto` / `reload` / `waitForSelector` / `addInitScript` / `keyboard`; an inline login flow (a `static openX()` factory instead); `expect(po.someLocator).toBeVisible()` (`expectXVisible()`).

A spec contains TEST CASES ONLY: no UI helper function; flows are page-object methods. Owning layers: screen interaction in `pages/`; seeding / teardown via API in `prerequest/`; domain calculations in `utils/`. Scan the owning layer BEFORE writing a helper. The project's own layout wins; record it under `automation.layers` in `Testing/qa-manifest.json`.

Only these may appear in a spec: `test.describe` / `test` blocks; a serial describe around a true chain only; `step(title, body, { deadline?, expects? })` from `helpers/steps.ts`; `beforeAll` / `afterAll` that just call a `prerequest` fixture; `beforeEach` / `afterEach` reporting hooks (the evidence hook only copies the failure attachment to `attempt-{a}-failed.png`); the one-line `await captureEvidence(page, testInfo)` at the assertion point as a TOP-LEVEL statement (`helpers/evidence.ts`, installed from `assets/evidence.template.ts`, never hand-written); `uniqueName()` / `runPrefix()`; locale constant tables; `import { test, expect } from '…/fixtures/test'`; a one-line alias to a `prerequest` fixture. Never redeclare a tolerance, timeout or threshold the owning layer defines. Page objects and specs: `references/code-craft.md` §1-7.

Self-check, run BOTH before Phase 3:
```bash
grep -nE "\.locator\(|getByTestId\(|getByRole\(|\.evaluate\(|page\.(goto|reload|waitForSelector|addInitScript|keyboard)\(|new [A-Za-z_]*(Login|Auth)[A-Za-z_]*\(" <spec-file>
grep -nE "^(async )?function |^const [a-zA-Z_]+ = (async )?\(" <spec-file>
```
Any hit from (1) outside a hook and any hit from (2) beyond a one-line `prerequest` alias is moved to its layer first; report `POM self-check: clean` or what you moved.

Type check + validator run together: `scripts/check.mjs checkpoint --checkpoint A` (no TypeScript: `notRun`, never clean). "Cannot find name 'process'" / "Cannot find module 'node:fs'" from `helpers/*.ts` means `@types/node` / `typescript` are missing: ask ONCE to run `npm install --save-dev @types/node typescript` (no `// @ts-ignore`); a `tsconfig.json` with its own `types` list must name `"node"`. Prove the checker catches a throwaway type error first; if not, use a dedicated `tsconfig.check.json`. Never report "typecheck clean" unconfirmed.
</pom_mandatory>

<normalization>
Per approved TC:

- One step = one action; every TC has at least one assertion. A step or Expected Result that cannot map deterministically: PARK the TC as an open question (source `A`) with the exact wording; never BLOCK, never interpret silently.
- Data mapping: every sentence of `Preconditions`, `Data Oracle`, `Shared data` and every role becomes one plain-English requirement (`role user exists`, `record of type X in state Y exists (count N)`, `empty state for Z`) for PHASE 2.6; none: `read-only, no data need`.
- Reference tokens resolve per ID: `[E{n}]`, `[A{n}]` (by account ID, never by role), `[D{n}]` map to `environment('E1')`, `account('A1')`, `dataItem('D1')` from `helpers/test-data.ts` (`E1_URL`, `A1_USER` / `A1_PASSWORD`); no default, no literal.
- A `[HUMAN]` step stays text. A `- **Reviewer comment:**` bullet is never normalized, generated or hashed; one asking for a TC change is reported once ("route to skill 3 `--revision`").
</normalization>

<selector_resolution>
Selectors come from SOURCE ONLY, never memory, never guessed.

0. Grep `Testing/project-learning.md` for this feature's `[type: trick]` lines: recorded `data-testid` values are verified against source once; record new ones there in words.
1. Scan the feature's implementation files and build a `data-testid` index.
2. Classify each target: RESOLVED · AMBIGUOUS · NOT_FOUND · DYNAMIC · OUT_OF_SCOPE.
3. An AMBIGUOUS target: one `<scratch_investigation>` probe may decide it. Safe fixes: MAY add a missing `data-testid` (`{feature}-{element}-{type}`, kebab-case, unique per page); RENAME an existing testid only after a full-repository impact check (any non-test usage: do NOT rename); never change structure or logic.
4. Unresolved targets: an open question (source `B`) for PHASE 2.4 whose options are the source-confirmed fallbacks actually found; only when none exists does the TC get a `// TODO` on a stable fallback or a skip-guard carrying the precise blocker.
</selector_resolution>

<spec_writing>
Against `{automation_root}`, following the project conventions:

- File: `tests/{Area}_Tests/NN-{kebab-feature}.spec.ts`, next free number; one spec per feature slice. Traceability header (mandatory): Feature · Requirement(s) · Change Type · Regression Risk · Target Test Type · Generated by: test-automation skill · Steering versions · Source TC document path.
- Auth: every test logs in through `{login_page_object}` with the env layer's credentials; never hardcoded credentials or URLs, no `storageState` unless the project already uses it (decision 2026-10-19).
- Registration: add the UI spec to the `{browser_project}` `testMatch` regex, part of PHASE 2.
- Structure: `test.describe('{REQ-IDs}: {requirement description}')`; every title starts with the TC id(s) in brackets (`[TC-ID]`) and carries exactly one of `@positive` / `@negative`, `@smoke` ONLY when the document says `Smoke: YES`, and its `<run_plan>` tag `@run:parallel` / `@run:serial-{group}`. The variant goes in the title in a fixed, machine-readable form, a bracketed tag `[lang: ar]` / `[role: manager]` / `[variation: …]` (or the existing `— variation …` suffix): `impact.mjs select` reads the TC ids and these tags to decide branch-level impact (`impact_level: branch`). Only a true chain sits in a serial describe. Every test calls `await captureEvidence(page, testInfo)` at its assertion point as a top-level statement, never in `afterEach`, after a cleanup or after navigating away; teardown runs AFTER the evidence image is on disk.
- Banned: `test.only` · CSS / text selectors when a data-testid exists · shared mutable state · commented-out bodies · an assertion that cannot fail. Waits: `<wait_policy>`.
- A limited mid-test call (`rate_limits[]` `at: step`) is paced by `await rateLimitSlot('{service}', { key? })` in the page-object method, never a sleep.
- Skip guards ONLY from a PHASE 2.6 outcome with the gap's wording as the reason; never `test.skip(!data)`.
</spec_writing>

<test_modifiers>
`only` · `skip` · `fixme` · `fail` · `slow`, every form: `only` is never committed and never exemptible; the others each need a reason tracing to a PHASE 2.6 readiness decision, an approved requirement or an honoured exception (`skip` counts `SKIP`, never a pass). A subset runs through `run-stage.mjs` filters, never a focused modifier; a missing prerequisite stays visible against the original scope. Detail: `references/automation-rules.md` §3.
</test_modifiers>

<wait_policy>
Specs, page objects, fixtures and helpers alike. Prefer an observable condition; bounded polling is fine; a timer needs its stated reason; never raise a timeout to hide an unexplained failure; never `networkidle` (validator `wait-network-idle`); every wait bounded by the step deadline, every value from `timeouts.ts`. Rate-limit pacing only through the start-of-test reservation and `rateLimitSlot()`. Detail: `references/automation-rules.md` §4, `references/code-craft.md` §9-10.
</wait_policy>
