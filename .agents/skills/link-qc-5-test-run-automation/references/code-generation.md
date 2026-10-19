# Writing the automation code — PHASE 2

Loaded by `SKILL.md` at **Writing Automation Code**, together with `run-plan-and-config.md`,
`code-craft.md` and `automation-rules.md`. Every block keeps its tag.

## PHASE 2 — GENERATE AUTOMATION CODE

**Source document: the ORIGINAL approved `{source_tc_doc}` — never the beautified file.**
The beautified document exists for Azure DevOps readers and may not exist at all
(`ado_mode = local`); the automation contract always stays with the approved source. Reading
the beautified file here would make the tests depend on an optional generated artifact.

Legacy documents have no `Automation Candidate` field. Where the field exists (new
`generate-manual-test-cases` output) respect it; otherwise **derive** candidacy: a TC is
automatable when every step maps deterministically to an action and an assertion (see
`<normalization>`). Record the decision and the reason per TC — that record is what PHASE 5
publishes as the template's automation flag. TCs that cannot be automated deterministically appear in
the coverage table as `manual — not automated`, with the reason stated.

**`[HUMAN]` steps do not change candidacy — they bound the execution.** A candidate TC whose
steps carry the `[HUMAN] ` marker (skill 3 writes it only where no authorized test interface
exists for an out-of-browser outcome — an SMS code read on a test phone, a letter on a desk) is
**generated up to the first human step**: every step before it becomes automation with its
assertions and the evidence image, the human step and everything after it are not written into
the spec. Its coverage-table status is `partial (human step: n)` (`n` = the step number) and its run
outcome word is **`PARTIAL — human step pending`** (`references/run-report.md` §4 — Classification
`human step: n`). A partial TC **never** reports `PASS`, never counts as passed anywhere, never
becomes `Automated` in Azure DevOps and never gets an `automated_tc_sha256` (PHASE 5). The four
axes stay separate: design coverage (the TC exists in full — skill 3), automation candidacy (YES
/ NO — the document), execution coverage (`full` / `partial (human step: n)` / `manual — not
automated` — this skill) and validation status (3b / 3c).

**Generate first, ask second.** An approved document can still read ambiguously in places. Such
a TC is **NOT a failure and NOT a block** — this phase writes every TC it can and **parks** the
rest as open questions for `PHASE 2.4`, which asks the user with concrete options and then
generates them. Parking is the normal path; never stop the phase over an ambiguity and never
resolve one silently here.

<source_of_truth>
**Only an approved requirement or an explicitly approved clarification may define an expected
result.** Everything else is evidence about the implementation, not authority over it: application
code and observed behaviour (use them to *form* a question or to confirm a selector — never to settle
what a test should expect), `Testing/project-learning.md` lines (weighed by source, approval and
relevance — never outranking an approved requirement), skill 11's discovered rules (proposals until
the PO decision block is filled and skill 11 re-ran with `--apply-approved`; before that they may
inform a PHASE 2.4 question, never an assertion). Conflicts between an approved TC and its
requirement are reported under `### Deviations` and the TC parked, never resolved silently; an
unanswered question never turns current behaviour into an approved expectation — such a check is
tagged `@unverified-assumption`, excluded from confirmed requirement coverage and counted *Assumed*.

Full rules, including assertion quality: `references/automation-rules.md` §1-§2.
</source_of_truth>

<hierarchy_verification>
**Runs at the START of EVERY invocation — placement is a first-class concern.**

1. Verify the automation project skeleton at `{automation_root}` (for a NEW project,
   the `generate-testing-structure` layout under `Testing/Automation/`):
   `tests/{Area}_Tests/` folders · `pages/` (+ `pages/components/`) · `prerequest/`
   · `helpers/` (the evidence hook `helpers/evidence.ts`, see `<result_organization>`; `steps.ts`,
   `progress-reporter.ts`, `console-guard.ts`, `test-data.ts` — copied from `assets/*.template.ts`
   when absent) · the env layer (`utils/env`) · the ONE `playwright.config.ts` + `timeouts.ts`
   (no `playwright.us-*.config.ts` may remain — see `<shared_config>`) · `.gitignore` per
   `references/code-craft.md` §12 · `reports/{spec_level}{user_story_name}/` ·
   `screenshots/{spec_level}{user_story_name}/` · `automation-logs/{spec_level}{user_story_name}/`.
2. **First run** (any skeleton piece or this feature's area folder missing) →
   CREATE the missing hierarchy following the existing project convention BEFORE
   writing any file. Never scatter files outside the convention.
3. **Every subsequent run** → re-verify this feature's files are where they belong
   and correctly registered:
   - spec in the correct `{Area}_Tests` folder with the correct `NN-` sequence number
   - page objects under `pages/` (components under `pages/components/`)
   - UI spec registered in the `{browser_project}` `testMatch` regex (and excluded
     from the non-browser project's scope where the config requires it)
   - FIX any drift found (wrong folder, unregistered spec, locators inlined in a
     spec) before proceeding.
4. Emit a **Placement Manifest** in the output EVERY run:

   | File | Path | Registered in config | Status (created / verified / moved / fixed) |
   |------|------|----------------------|---------------------------------------------|
</hierarchy_verification>

<automation_inventory>
**Mandatory pre-write scan — no page object is written before the inventory exists.** A twin page
class (a second `OrderPage`, a `4-ListingPage.ts` beside `ListingPage.ts`, a new class on a route
another class already opens) is a Checkpoint A failure, whatever folder or agent wrote the original.

1. **Scan the WHOLE `{automation_root}`** — every folder, not only `pages/` and
   `pages/components/`: every class that takes a `Page` in its constructor or extends a base page,
   with its file, class name, route / URL literal and exported locator names. Run
   `node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root . --pretty`
   once for its `pageScan` section (the same walk, machine-made) and read the classes yourself.
2. **Match each screen the TCs touch against the classes** — by normalized name (case, a trailing
   `s` / `Page`, a numeric file prefix ignored), then by route literal, then by two or more identical
   locators. A match is **evidence for a decision, never the decision**: a different class name on
   the same route is a reuse candidate; a legitimately shared route or a common loader locator is
   closed by the reason you write.
3. **Write `{reports_folder}/automation-inventory.md`** (`{results_root}`, beside the run report —
   in the whitelist, rewritten each run) with the decision table, **one row per screen**:

   | Screen | Decision | Class | Candidates considered | Reason |
   |---|---|---|---|---|
   | {screen} | `reuse {class}` \| `extend {class} (+{methods})` \| `create {class}` | `{Class} ({path})` | `{Class} — accepted \| rejected`, every candidate the matching surfaced | why each candidate was accepted or rejected — the same-route / shared-locator justification lives here |

   A `create` row with a candidate that is not addressed with a reason is a Checkpoint A failure;
   a candidate pair with no row is one too.
4. **Validate with the inventory** — every validator run of this story passes
   `--inventory {reports_folder}/automation-inventory.md`: a candidate pair a row covers is
   `pom-duplicate-page-decided` (info); an uncovered pair stays `pom-duplicate-page` (review) and
   keeps the scanner gate BLOCKED (`references/validator.md`).
5. **Record every decision in the learning file** `## Automation Tricks`, one plain-English
   `[type: trick]` line per screen (`- [module: Orders] [page: Order list] [type: trick] Page object
   OrderListPage covers the orders list; OrdersOverview was rejected as a duplicate on the same
   route.`) so the next run reuses the decision instead of re-deriving it.
</automation_inventory>

<pom_mandatory>
**Page Object Model is MANDATORY — no direct locators in spec files.**

- Every screen interaction in a spec goes through a page-object method.
- REUSE an existing page object when it fits — decided by the `<automation_inventory>` row for
  that screen (the scan covers the WHOLE automation root, not only `pages/*.ts` and
  `pages/components/*.ts`, and matches by normalized name, then route, then locators). Never
  report "no POM exists" without the inventory.
- EXTEND the relevant page object with new methods when it partially fits —
  match the file's existing style (`extend {class} (+methods)` row).
- CREATE a new page-object class (matching the conventions of the existing
  `pages/` files) only from a `create` row whose candidates were all rejected with a reason.
- New/updated page files are part of the deliverable and MUST appear in the
  Placement Manifest and in `automation-inventory.md`.
- A locator inline in a spec file is a self-check FAILURE — move it into a page
  object before running anything.

**BANNED IN SPEC FILES — each of these is a self-check FAILURE, fix before running.**
This list exists because a previous run shipped every one of them:

| Banned in a spec | Belongs in the page object as |
|---|---|
| `page.locator(...)` · `page.getByTestId(...)` · `page.getByRole(...)` | a named locator or an `expectX()` / `getX()` method |
| `somePageObject.someLocator.locator('option:not([disabled])')` — drilling *through* an exposed locator | `getXOptions()` / `expectXOptionsLoaded()` / `expectXOptionsEmpty()` |
| `locator.evaluate((el: HTMLSelectElement) => …)` | a `getSelectedX()` / `isXOpen()` method |
| `page.goto(\`${env.baseURL}/…\`)` + `waitForLoadState` + loader wait | `gotoAppPath(path)` or a `static openX()` factory |
| `page.reload()` + loader wait | `reload()` |
| `page.waitForSelector('#loader', …)` | `waitForLoaderHidden()` |
| `page.addInitScript(…)` seeding browser state | a named seeding method, e.g. `seedCorruptedFilterState()` |
| `page.keyboard.press(...)` aimed at a specific control | `activateXByKeyboard()` returning the observable result |
| `new LoginPage(page)` + `login()` + `new XPage()` + `goto()` | a `static openX(page, fixture, lang)` factory |
| `expect(pageObject.someLocator).toBeVisible()` | `expectXVisible()` on the page object |

**Locator exposure rule.** A page object MAY expose `readonly` locators, but a spec may
only pass them to a page-object method — never chain `.locator()`, `.evaluate()`,
`.count()`, or `.innerText()` off them. Chaining off an exposed locator is the same
violation as writing the selector inline; it just hides it one level deeper.

**No UI helper functions in spec files.** A spec must not declare a function that takes
`page`/a page object and drives the screen (`async function openRecord(page, …)`,
`applyFilter(list, …)`, `readSelectedValue(list)`). Those are page-object methods that
were written in the wrong file. Compose multi-step flows as page-object methods
(`applyFilterMode(mode, value?)`), not as spec-local helpers.

**A spec file contains TEST CASES ONLY.** Not "mostly test cases" — a spec declaring any
named helper is a layering failure. Route every helper to its owning layer:

| Helper kind | Owning layer | Example |
|---|---|---|
| Screen interaction, waits, composite UI flows | `pages/XPage.ts` | `applyFilterMode()`, `openFilter()` |
| Oracle key resolution, DB lookups, tolerance assertions | `pages/XPage.ts`, beside the existing DB-oracle helpers | `resolveRecordId()`, `expectMatchesOracle()` |
| Fixture seeding / teardown via API | `prerequest/*PreRequest.ts` | `setupRecordFixture()` |
| Reusable domain calculations | `utils/*` | `computeExpectedTotal()` |

Scan the owning layer BEFORE writing a helper — these files already exist and already
contain siblings of what you are about to write.

**Only these may appear in a spec:** `test.describe` / `test` blocks,
`test.describe.configure({ mode: 'serial' | 'parallel' })` lines that apply the `<run_plan>`
groups, `step(title, body, { deadline?, expects? })` blocks from `helpers/steps.ts` (one per
manual step — `references/code-craft.md` §5, §9), `beforeAll`/`afterAll` wiring that just *calls*
a `prerequest` fixture, `beforeEach`/`afterEach` reporting hooks (the `afterEach` evidence hook
only copies Playwright's failure attachment to `attempt-{a}-failed.png` — it never takes the
assertion-point evidence image; the console guard's `attachConsoleGuard(page)` / `guard.report()`
pair lives in the same hooks), the one-line `await captureEvidence(page, testInfo)` call placed at
the assertion point of every test body as a TOP-LEVEL statement (see `<result_organization>`),
`uniqueName()` / `runPrefix()` calls from `helpers/test-data.ts`, locale/label constant tables,
an `import { test, expect } from '…/fixtures/test'` when the project has a fixture layer, and a
one-line delegating alias to a `prerequest` fixture.

**How a page object, a component object, a locator chain and a spec are WRITTEN** — authoring
conventions, the locator order (source-confirmed `data-testid` → role → label → text → stable
CSS), Angular Material / CDK overlays, positional selectors, fixtures beside `prerequest/`, unique
test data — is `references/code-craft.md` §1-7. Load it before writing or extending any page
object. Its `[M]` sections are Checkpoint A / B items; its `[R]` sections are noted, never blocking.

**Constants must have one source of truth.** Do not redeclare a tolerance, timeout, or
threshold in a spec when the owning layer defines it — import or alias it. And never merge
two constants that happen to share a name (different documents may specify different
tolerances — conflating them silently weakens assertions).

**Simplicity.** Prefer the smallest readable spec: one page-object call per step, the
assertion message carrying the requirement. If a test body reads like DOM plumbing rather
than the approved TC's steps, the abstraction is in the wrong place — move it.

**Self-check commands — run BOTH before Phase 3 and paste the results in your output:**
```bash
# 1. No element access or raw page driving in the spec
grep -nE "\.locator\(|getByTestId\(|getByRole\(|\.evaluate\(|page\.(goto|reload|waitForSelector|addInitScript|keyboard)\(|new [A-Za-z_]*(Login|Auth)[A-Za-z_]*\(" <spec-file>

# 2. No helper declarations in the spec (only a one-line prerequest alias is allowed)
grep -nE "^(async )?function |^const [a-zA-Z_]+ = (async )?\(" <spec-file>
```
Any hit from (1) outside a `beforeEach`/`afterEach` evidence hook (the `captureEvidence()` call
itself is not a hit — it takes `page`, not a locator), and any hit from (2) that
is not a single-line delegation to a `prerequest` fixture, must be moved to its owning layer
before you execute anything. Report both as `POM self-check: clean` or list what you moved.

**The greps are a starting point, not the verdict.** `scripts/validate-automation.mjs` runs the
same checks over comment- and string-stripped source (so nothing inside a comment or a string can
trigger them) and adds the chained-locator and spec-helper rules. **A clean grep does not prove
compliance** — Checkpoint A pairs both with semantic review, because no text scan can tell whether
a composite flow ended up in the layer this project actually owns it in. Moving a helper into an
arbitrary file purely to silence a grep is itself the violation.

**Layer ownership follows THIS project's architecture.** The routing table above is the default
when the project has no convention of its own. Where it does — a different fixtures folder, a
`components/` layer, an existing helpers module — match it, and record it under
`automation.layers` in `Testing/qa-manifest.json` so the validator checks the same boundaries
instead of assuming these names.

**Verify your typecheck actually runs.** Some automation projects' `tsconfig.json` makes
`npx tsc --noEmit -p tsconfig.json` report **zero errors even for a deliberate type error**
— for example `moduleResolution: "bundler"` combined with `module: "commonjs"` makes tsc
abort with `TS5095` before checking anything. A clean run there proves nothing. Prove the
checker works by injecting a throwaway type error first; if it is not caught, typecheck with
a dedicated config (e.g. `tsconfig.check.json` with `moduleResolution: "node"`) and record
that in the learning file. Never report "typecheck clean" from a run you have not confirmed
is actually checking.
</pom_mandatory>

<normalization>
Internal step (no JSON handoff files) — normalize each approved TC:

- One step = one action; split compound steps.
- Action mapping: navigate / click / select / type / wait.
- Assertion mapping: "is displayed" → visible · "text equals" → text ·
  "contains N rows" → count · "redirects to" → url.
- Every TC ≥ 1 assertion. A step or Expected Result that cannot map deterministically →
  **PARK that TC as an open question** (source `A`) carrying the exact wording that is
  ambiguous, and continue with the other TCs. `PHASE 2.4 <open_questions>` asks the user about
  it with evidence-backed options and then generates it. **Never BLOCK the run over it, and
  never interpret a vague expected result silently** — an interpretation is either chosen by
  the user, reused from the learning file, or carried as an explicitly tagged assumption.
- **Precondition / data mapping:** every sentence in `Preconditions`, `Data Oracle`,
  `Shared data` and every role named in the steps → one plain-English requirement
  (`role user exists`, `record of type X in state Y exists (count N)`, `empty state for Z`,
  `configuration / feature flag`, `external system or background job`). These feed
  PHASE 2.6 `<data_readiness>`; a TC with none is `read-only, no data need`.
- **Reference tokens resolve per ID, never by shortcut.** A TC names its configuration as
  `Open the portal [E1]`, `Login as Administrator [A1]`, `price list "Sample" [D1]`
  (`TEST-DATA-{feature}.md` §0 / §1 / §2). `[E{n}]` maps to **its own** environment entry keyed by
  the E-ID (E1 is not "the" URL — E2 may be the mail sandbox); `[A{n}]` maps to **that** account
  keyed by the A-ID, credentials looked up by account ID and never by role (a role may own several
  accounts); `[D{n}]` maps to that data item. In code this is `environment('E1')`, `account('A1')`,
  `dataItem('D1')` from `helpers/test-data.ts` (`assets/test-data.template.ts`) reading the env
  vars named after the ID (`E1_URL`, `A1_USER` / `A1_PASSWORD`) — no default, no literal, no
  "first E row" or "any Administrator" anywhere. A `[HUMAN]` step is kept as text and bounds the
  generated part (PHASE 2 candidacy). A `- **Reviewer comment:**` bullet is the reviewer's note to
  the QA skills: it is never normalized, never generated into code, never part of the TC hash; an
  open one that asks for a TC change is reported once ("route to skill 3 `--revision`"), and the
  approved text is automated as written.
</normalization>

<selector_resolution>
Selectors come from SOURCE ONLY — never from memory, never guessed:

0. Grep `Testing/project-learning.md` for this feature's `[module: …]` / `[page: …]`
   `[type: trick]` lines (and its `[similar: …]` pages): known identification patterns and
   `data-testid` values recorded by earlier runs or by skill 3/10 are verified against source
   once, not rediscovered. After resolution, record every newly confirmed pattern and value
   there in words (`- [module: Orders] [page: Order Details] [element: Save button] [type: trick] Identified by test id order-save-button; enabled only after all required fields are filled.`).
1. Scan the implementation files for the feature (Angular templates `*.html`,
   components `*.ts`, TSX/JSX) and build a `data-testid` index.
2. Classify each logical target: RESOLVED (one certain match) · AMBIGUOUS ·
   NOT_FOUND · DYNAMIC (computed testid) · OUT_OF_SCOPE (vendor component).
3. Safe-fix rules for AMBIGUOUS / NOT_FOUND:
   - MAY add a missing `data-testid` to an interactive element — naming
     `{feature}-{element}-{type}`, kebab-case, unique per page; shared components
     receive the feature prefix from the call site, never hardcoded inside the
     shared component.
   - RENAME an existing testid only after a **full-repository impact check**:
     search every usage; usage found in any non-test file → do NOT rename (report
     it), fall back to a source-confirmed stable selector with a documented reason
     inside the page object.
   - Never change element structure, classes, styles, handlers, or business logic.
4. AMBIGUOUS / NOT_FOUND / DYNAMIC / OUT_OF_SCOPE targets that no safe fix resolves →
   **raise as an open question** (source `B`) for `PHASE 2.4 <open_questions>`: the candidate
   options are the source-confirmed fallback selectors actually found (each with the file and
   what it shows), so the user picks the right element instead of the skill guessing. Document
   the outcome in Deviations. Only when PHASE 2.4 yields no evidence-backed candidate does the
   TC fall back to a `// TODO` note on a stable fallback selector or a skip-guard carrying the
   precise blocker.
</selector_resolution>

<spec_writing>
Write the spec against `{automation_root}` following the project conventions:

- **File:** correct `tests/{Area}_Tests` folder, `NN-{kebab-feature}.spec.ts` with the
  next free sequence number (list the folder to confirm). One spec per feature
  slice — split only for unrelated surfaces or incompatible setup, and document why.
- **Traceability header** (mandatory):
  Feature · Requirement(s) · Change Type · Regression Risk · Target Test Type ·
  Generated by: test-automation skill · Steering versions · Source TC document path.
- **Auth:** through `{login_page_object}` with credentials from the env layer
  (`env.username` / `env.password` / `env.baseURL`). NEVER hardcode credentials or
  URLs; NEVER invent env-var names; no raw inline login flow; no storageState
  unless the project actually uses it.
- **Registration:** add the new UI spec filename to the `{browser_project}`
  `testMatch` regex in `playwright.config.ts` (and the non-browser project's
  ignore list where applicable). An unregistered UI spec runs under the wrong
  harness and fails — this is part of Phase 2, not a follow-up.
- **Structure:** `test.describe('{REQ-IDs}: {requirement description}')`;
  every test title starts with `[TC-ID]` and carries exactly one of
  `@positive` / `@negative`; TCs marked `Smoke: YES` in the approved TC document
  ALSO carry `@smoke` (additive — the polarity tag stays). `@smoke` derives ONLY
  from the TC document's `Smoke:` field — never from this skill's own judgment.
  Every title ALSO carries its `<run_plan>` tag — `@run:parallel` or
  `@run:serial-{group}` — and serial groups sit in their own describe block with
  `test.describe.configure({ mode: 'serial' })`. Every test calls
  `await captureEvidence(page, testInfo)` **at its assertion point** — the line right
  before (or, for multi-assert TCs, right before the LAST) `expect(...)` of the Assert
  step, while the screen still shows the state the TC verifies — so the per-variant /
  per-attempt evidence image is written per `<result_organization>`. The call is NEVER placed
  in `afterEach`, after a
  cleanup/delete/reset call, or after navigation away from the verified screen.
  AAA structure; fixtures/seeding reused from
  `prerequest/` + `helpers/` (this is the data oracle); every api_setup precondition
  gets a matching `afterEach`/`afterAll` teardown — teardown always runs AFTER the
  evidence image is on disk, so a cleaned-up screen can never be what the image shows. Data a spec needs but the environment
  lacks is NOT the spec author's problem to guess — it is a PHASE 2.6 requirement the QC
  decides on (`<data_readiness>`).
- **Banned:** `test.only` (see `<test_modifiers>`) · CSS/class/nth-child/text
  selectors when a data-testid exists · shared mutable state between tests ·
  commented-out test bodies · a placeholder assertion that cannot fail for any state of the
  application. Waits follow `<wait_policy>` — prefer web-first assertions
  (`expect(locator).toBeVisible()`, `page.waitForURL()`, …).
- **Steps:** every manual TC step is one `await step('{manual step wording}', async (report) => {…},
  { deadline?, expects? })` from `helpers/steps.ts` — the wrapper owns the deadline
  (`references/code-craft.md` §9); a known long operation names its `TIMEOUTS.operations.*` key;
  `report('…')` inside a long operation keeps the watchdog informed. `captureEvidence` stays a
  top-level statement before the Assert step, never inside a step callback.
- **Tags** via the details object on Playwright ≥ 1.42 (`{ tag: ['@positive', '@smoke',
  '@run:parallel'] }`), in the title below that; the `[TC-ID]` prefix stays in the title always.
- **`expect.soft`** only for independent checks of ONE expected result, never across steps; the
  last assertion of the Assert step is a hard `expect`.
- **Test data a TC creates** is named by `uniqueName(prefix)` / cleaned by `runPrefix(prefix)`
  from `helpers/test-data.ts` — never a fixed literal (`references/code-craft.md` §7).
- **Console guard** attached in `beforeEach`, reported in `afterEach` (`helpers/console-guard.ts`,
  allow-list from `Testing/qa-manifest.json` `automation.consoleAllowList`); an unexpected browser
  error is a Deviation for the human, never a TC failure by itself.
- **Fixtures** (`fixtures/test.ts`, `test.extend`) may wrap `prerequest/` functions for guaranteed
  teardown; the spec then imports `test` / `expect` from there (`references/code-craft.md` §6).
- **Skip guards** are written ONLY from a PHASE 2.6 outcome — a QC `skip` decision, the
  pipeline default for an undecided gap, or an `IMPOSSIBLE` requirement — with the gap's
  exact wording as the one-line reason. Never invented by the spec author, never to avoid a
  real failure, never `test.skip(!data)` "just in case".
</spec_writing>

<test_modifiers>
**`only` · `skip` · `fixme` · `fail` · `slow` — every form: bare, conditional
(`test.skip(cond, 'reason')`) and suite-level (`test.describe.skip(…)`).** `only` is never committed
and never exemptible; `skip` (counts `SKIP`, never a pass), `fixme`, `fail` (an expected failure
in its own row; a failure of the run if it unexpectedly passes) and `slow` (extends the timeout, never
a skip) each need a reason that traces to a PHASE 2.6 readiness decision, an approved requirement or
an honoured exception. A subset runs through the runner's own filters (`--grep`, `--project`,
`--last-failed`, `--repeat-each`, `--workers` — through `run-stage.mjs`), never a focused modifier;
a missing prerequisite stays visible in the run file, the report's phase section and the chat summary,
against the original scope, with its reason.

Detail: `references/automation-rules.md` §3.
</test_modifiers>

<wait_policy>
**Applies to specs, page objects, fixtures and helpers alike** — a fixed wait moved out of a spec into
a page object is the same fixed wait. Prefer an observable condition (a web-first assertion,
`waitForURL`, `waitForResponse`, a state the page object exposes); bounded polling is fine; a timer
needs its stated reason; never raise a timeout to hide an unexplained failure; never `networkidle` as
readiness (validator rule `wait-network-idle`); every wait is bounded by the step deadline and every
timeout value comes from `timeouts.ts`, never inline.

Detail: `references/automation-rules.md` §4 and `references/code-craft.md` §9-10.
</wait_policy>
