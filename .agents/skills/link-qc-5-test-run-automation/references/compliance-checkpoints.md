# Compliance checkpoints — the two mandatory gates

Loaded by `SKILL.md` at **Validating Automation Code** for `<checkpoint_a>` (§3a, before execution)
and kept for **Running Final Verification** — `<checkpoint_b>` (§4a, on the final code). The two
procedure blocks are the checkpoints of record; §2-§5 are their reusable checklist, the derived
procedure and the recording rules. Both gates must reach **PASS for the final delivered scope** before you may claim automation
compliance. They are separate from execution status: compliant tests can expose application defects,
and passing tests can still violate these rules.

---

## 1. The three-state model

Every applicable check ends in exactly one state. Record the state, never a bare tick.

| State | Meaning |
|---|---|
| `verified-mechanical` | The validator decided it: a rule ran over this file and produced a result. |
| `verified-semantic` | A reviewer decided it: say what was read (`file:line`) and what the reasoning was. |
| `unresolved` | The check **applies** and was not completed. Say why. **Never PASS, and never `N/A`.** It holds the gate BLOCKED. |
| `N/A` | The check **does not apply to this scope at all**, with the reason stated. |

### `N/A` is not a way to close an applicable check

`N/A` means *this rule has nothing to act on here* — there is no Azure DevOps linkage so the
close-out checks do not apply; no test in scope uses a modifier so the modifier-reason check has
no subject; the project has no API fixtures so the teardown-for-`api_setup` check has no subject.
The reason must name **why the rule has no subject**, not why you did not get to it.

It is **never** correct to record `N/A` because:

- the validator could not analyse a file (that is `unresolved` — the check applies, the tool
  failed: see *When the scanner cannot read valid code* below);
- a rule landed in the validator's `notRun[]` (those are applicable checks that did not execute —
  for example an ID rule with no `--tc-ids` list supplied);
- a `review[]` item was left open;
- time ran short, the scope was large, or the item looked low-risk.

Each of those is `unresolved`, and **each holds its gate BLOCKED until it is verified.** If you
are unsure which of the two applies, it is `unresolved`.

**A clean scan is not a clean checkpoint.** `validate-automation.mjs` returns a *scanner* gate. Its
`review[]` and `notRun[]` arrays are open items that only semantic review can close. A checkpoint is
`PASS` only when:

1. there are no confirmed violations in scope, **and**
2. every `review[]` and `notRun[]` item is closed as `verified-mechanical` or `verified-semantic`.

Anything still `unresolved` → the checkpoint is **BLOCKED for those items**, named one by one.
Continue every piece of work that does not depend on them; do not stop the whole run.

### When the scanner cannot read valid code

A file the scanner cannot strip, or a scope it cannot reach, is a limitation of the scanner — not a
defect in the code, and never a violation against it. The scanner's own `gate` (`BLOCKED` /
`NOT_RUN`) is **recorded verbatim and never rewritten**. The checkpoint may still reach `PASS` when
every affected check is closed another way:

- the project's own tooling — ESLint (with `eslint-plugin-playwright` when present), `tsc`, an
  existing `npm run lint` — run it first wherever it exists, and record the command and its output;
- or documented semantic review naming the files covered and the outcome.

Either route must be carried out **against the same `scopeDigest`** the scanner reported. A digest
mismatch voids it. This route never covers a confirmed violation and never closes an item nobody
actually checked.

---

## 2. The reusable checklist

Derived from every rule `SKILL.md` and its references encode, not only from the validator's rule list. For each item:
`M` = the validator can decide it, `S` = semantic review decides it, `A`/`B` = which checkpoint.
Items marked `M+S` need both — a clean grep does not prove compliance.

### Page Object Model and layer ownership

| # | Check | How | Gate |
|---|---|---|---|
| 1 | No raw locator, navigation, evaluate, or keyboard/mouse driving in a spec | M (`pom-*`) + S | A, B |
| 2 | Nothing chained off an exposed page-object locator — returning a `Locator` must not let a spec bypass the rule | M (`pom-chained-locator`) + S | A, B |
| 3 | Composite UI flows live in the layer this project actually uses (page object / fixture / its own equivalent) — **not moved into an arbitrary helper just to make a grep clean** | S | A, B |
| 4 | No spec-local function drives the screen; the one-line delegating fixture alias is allowed | M (`pom-spec-helper`) + S | A, B |
| 5 | Existing page objects reused or extended rather than duplicated: the WHOLE automation root was scanned before writing (`<automation_inventory>`), `{reports_folder}/automation-inventory.md` holds one decision row per screen (`reuse` / `extend` / `create`) naming every candidate with the reason, the validator ran with `--inventory` and reports **no open `pom-duplicate-page`** (every candidate pair is `pom-duplicate-page-decided`); a `create` row with an unaddressed candidate, or a candidate pair with no row, is a **failure of this checkpoint**; new files in the Placement Manifest | M (`pom-duplicate-page`) + S | A, B |
| 6 | Constants have one source of truth; no tolerance/timeout/threshold redeclared in a spec | S | A, B |

### Assertions and expected behaviour

| # | Check | How | Gate |
|---|---|---|---|
| 7 | Every test verifies its required outcome — not merely that something rendered | S | A, B |
| 8 | No placeholder assertion (literal vs literal, empty body, nothing asserted) | M + S | A, B |
| 9 | Assertions inside approved helpers or page objects are recognised, not rejected | M (`*-call-found`) + S | A, B |
| 10 | Visibility-only checks used only where visibility or access **is** the requirement | S | A, B |
| 11 | Expected values trace to an approved requirement or an explicitly approved clarification — never to observed behaviour alone | S | A, B |
| 12 | Conflicts between an approved TC and its requirement are reported, not silently resolved | S | A, B |
| 13 | Weak assertions repaired **regardless** of whether aggregate coverage already meets its target | S | A, B |

### Evidence and reporting

| # | Check | How | Gate |
|---|---|---|---|
| 14 | Every test captures assertion-point evidence — **directly or through a method it calls**. Never report it missing from a direct-call search alone | M + S | A |
| 15 | Evidence is never captured from `afterEach`/`afterAll`; exactly one per test | M | A |
| 16 | The call sits at the assertion point and before teardown | S (the scanner cannot prove placement) | A |
| 17 | Evidence helper, screenshot config and output roots exist and are writable | S | A |
| 18 | The images, the run file (`.runs/phase-N.json`), the report's phase section, the bug file entries and the rendered HTML were **actually produced**, associated with the right TC, and correspond to the final tested code | S | **B only** |
| 19 | No PASS whose image shows a cleaned-up screen | S | **B only** |

At Checkpoint A only the *implementation and configuration* of evidence and reporting are verified.
Runtime artifacts do not exist yet: record them as `scheduled for Checkpoint B`, **never PASS**.

### Execution control

| # | Check | How | Gate |
|---|---|---|---|
| 20 | No focused execution (`only`, `fit`, `describe.only`), including aliased imports | M | A, B |
| 21 | Every `skip` / `fixme` / `fail` / `slow` — conditional and suite-level — carries a reason traceable to a readiness decision, an approved requirement, or an honoured exception | M + S | A, B |
| 22 | Expected failures (`fail`) are distinguished from ordinary passes, and extended timeouts (`slow`) from skipped execution, in the report | S | B |
| 23 | Missing prerequisites stay visible as `SKIP`/`BLOCKED` in the status model — never silently absent | S | A, B |
| 24 | Waits prefer observable conditions and bounded polling across specs, page objects, fixtures and helpers; justified backoff or an explicit timing requirement is fine; no timeout raised to hide an unexplained failure | M (warning) + S | A, B |

### Isolation, data and errors

| # | Check | How | Gate |
|---|---|---|---|
| 25 | Each test runs alone; no shared mutable state; the run plan's serial groups are honoured | S | A, B |
| 26 | Every `api_setup` precondition has a matching teardown, and teardown runs after the evidence image | S | A, B |
| 27 | Async operations awaited; no floating promises in specs or page objects | S | A, B |
| 28 | Errors surfaced, never swallowed to obtain a pass | S | A, B |

### Traceability and coverage

| # | Check | How | Gate |
|---|---|---|---|
| 29 | Every test title carries its `[TC-ID]`; every suite title carries its requirement ID | M | A, B |
| 30 | Referenced IDs validated against the resolved sources; **no requirement ID invented here** — upstream owns ID assignment | M (`trace-unknown-*`) | A, B |
| 31 | Requirement ID(s) present in the coverage artifacts and in the run JSON | S | A, B |
| 32 | Requirement → TC → automated test → execution result is mappable end to end | S | B |
| 33 | Requirement outcome coverage, TC automation coverage and execution pass rate reported **separately** | S | A (first two), B (all three) |
| 34 | Missing, partial, blocked and unexecuted coverage stay visible | S | A, B |

### Architecture, paths and hygiene

| # | Check | How | Gate |
|---|---|---|---|
| 35 | Imports resolve; no spec imports another spec | S | A, B |
| 36 | Files at the paths the Placement Manifest states; spec registered in the project | S | A, B |
| 37 | Results, logs and screenshots under the resolved roots with the story's `SPEC-*` parent | S | A, B |
| 38 | No credential, token or connection string in code, config, logs or the learning file | M (warning) + S | A, B |
| 39 | Every exception honoured by the scanner has had its **source opened and its substance recorded** | S | A, B |

### Code craft, configuration and timeouts (`references/code-craft.md` [M] items)

| # | Check | How | Gate |
|---|---|---|---|
| 40 | Every generated / updated test wraps each manual step in `step()` (validator run with `--require-steps`); `captureEvidence` is a top-level statement before the Assert step, never inside a step | M (`step-missing`) + S | A, B |
| 41 | Positional selectors (`first` / `last` / `nth`) are scoped by `filter({ has \| hasText })` or a named container, or justified on the line above | M (`positional-unscoped`) + S | A, B |
| 42 | No `networkidle` readiness in any layer; waits are bounded by the step deadline | M (`wait-network-idle`) + S | A, B |
| 43 | Every timeout value comes from `timeouts.ts` (none inline); initial values and `playwright_version` recorded; calibration changes carry `{key, from, to, reason, evidence}`; no retry added to absorb a timeout | S | A (initial), B (calibration) |
| 44 | ONE shared `playwright.config.ts` to the §8 contract; extra configs merged only when reproducible, references rewritten, deleted only after `config-inventory.mjs` listed them deletable; unmergeable ones reported; reporters additive (`line`, `json`, `progress-reporter` beside the project's own) | S (+ `config-inventory.mjs`) | A, B |
| 45 | Created test data named by `uniqueName()` / cleaned by `runPrefix()`; teardown timeouts flagged `cleanup_incomplete` and swept | S | A, B |
| 46 | Console guard attached in `beforeEach` and reported in `afterEach`; unexpected entries listed under Deviations, never a TC failure by themselves | S | A, B |
| 47 | Page objects, component objects and locator chains follow `code-craft.md` §1-3 (readonly locators, intent-named methods, scoping `Locator` for components, testid → role → label → text → stable CSS, no build-generated attributes); fixtures (when present) wrap `prerequest/` functions; `.gitignore` lines present | S | A, B |
| 48 | Watchdog stops are taken only on `FROZEN` verdicts from `watchdog.mjs`; completed results preserved, interrupted and not-started TCs named, the event classified `timeout_failure`; the consumer-project probe recorded PASS or NOT_RUN with the reason | S | **B only** |

---

## 3. Checkpoint A — before execution

Runs after generation and before anything is executed. It is the first gate in
`<environment_gate>`, ahead of the coverage and readiness gates.

1. **Review the full scope** — every test created, modified or selected for this run, plus the page
   objects, fixtures, helpers, the shared configuration, `timeouts.ts` and evidence/reporting code
   they touch.
2. **Run the mechanical checks.** `validate-automation.mjs` over the in-scope files — specs AND the
   page objects / helpers they touch, with `--require-steps` for generated or updated specs and
   `--inventory {reports_folder}/automation-inventory.md` so every page-class candidate pair is
   checked against a decision row — plus `config-inventory.mjs` and the project's own
   lint/typecheck where it exists. Report `gate`, `counts`, `review[]`, `notRun[]`, `exceptions[]`
   and `pageScan` together — never just "clean".
3. **Run the semantic review** for every `S` item above. A clean grep proves nothing about items 3,
   5, 7, 10, 11, 16, 39, 43, 44 or 47 — for item 5 the scanner only surfaces candidates; the
   inventory row's reason is what the review judges.
4. **Fix confirmed automation-code violations immediately.** They are repairs, not recommendations:
   do not defer them, do not list them for the user to approve, do not ask anyone to say "fix 1".
   Routine repairs need no approval. Only an unresolved *business* decision — one that changes what
   the expected behaviour is — goes to the user.
5. **Repeat the affected checks** after every repair. A repair invalidates the checks it touched.
6. **Proceed with the compliant scope only.** Tests whose applicable pre-run checks pass may run.
   Tests that remain blocked are isolated and reported against the original scope — never quietly
   dropped from it, and never counted as passing.
7. **Record the gate** per §5.

## 3a. Checkpoint A — the procedure of record (`<checkpoint_a>`)

<checkpoint_a>
**CHECKPOINT A — MANDATORY PRE-RUN COMPLIANCE GATE.** Runs after generation and BEFORE anything
executes; it is the first gate in `<environment_gate>`. Load
`references/compliance-checkpoints.md` and work its checklist — it is derived from every rule in
SKILL.md and its references, not only the items repeated below.

**Scope:** every test created, modified or selected for this run, **plus** the page objects,
fixtures, helpers, configuration and evidence/reporting code they touch.

**Procedure:**

1. **Mechanical checks.** Run the project's own tooling first where it exists (ESLint with
   `eslint-plugin-playwright`, `tsc`, an existing lint script), then:
   ```bash
   node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs \
     --root . --pretty --files <in-scope specs + the page objects, components, fixtures and helpers they touch> \
     --tc-ids <approved TC doc> --req-ids <REQ file> --require-steps \
     --inventory {reports_folder}/automation-inventory.md
   ```
   `--files` carries the page objects and helpers too: the wait, positional-selector and
   `networkidle` rules apply in every layer, and a file the scanner never sees is never checked.
   `--inventory` is the `<automation_inventory>` decision table: the page-class pass walks the
   whole automation root on its own, and a candidate pair no row covers is `pom-duplicate-page`
   (review) that keeps the scanner gate BLOCKED — an unaddressed candidate fails this checkpoint.
   `--require-steps` is passed for the specs this run generated or updated (legacy specs may
   omit it; say so). Report `gate`, `counts`, `review[]`, `notRun[]` and `exceptions[]` together
   — never just "clean". A `gate: PASS` means no banned pattern was found and **nothing more**.
   If the script cannot run, report it **unavailable**, never passed.
   Then: `node …/scripts/config-inventory.mjs --root . --pretty` must report `verdict: single`
   (or `multiple` with every extra config listed under `Configurations not merged` with its
   blocking setting — never an unexplained per-story file); and `playwright_version` is recorded
   with the feature gates it implies (`references/code-craft.md` §14).
2. **Semantic review** of every judgement the scanner cannot make: correct layer ownership,
   whether each assertion verifies its required outcome, whether evidence sits at the assertion
   point, and whether each honoured exception's cited source actually justifies it.
   **A clean grep does not prove compliance.**
3. **Fix confirmed automation-code violations immediately.** They are repairs, not
   recommendations — never defer them, never list them for the user to approve, never ask anyone
   to say "fix 1". Only an unresolved **business** decision (one that changes what the expected
   behaviour is) goes to the user.
4. **Repeat the affected checks after every repair** — a repair invalidates what it touched.
5. **Proceed with the compliant scope only.** Tests still blocked are isolated and reported
   against the original scope; the run continues for everything independent of them.
6. **Record the gate** (`PASS` / `FAIL` / `BLOCKED`) per `compliance-checkpoints.md` §5, with the
   `scopeDigest` from the validator's `fingerprint`.

**Gate result.** `PASS` only when there are no confirmed violations in scope **and** every
`review[]` / `notRun[]` item is closed — by the scanner, by other project tooling, or by
documented semantic review against the same `scopeDigest`. Anything still unresolved →
**BLOCKED for those items**, named one by one, while independent work continues.

**At this checkpoint you verify evidence and reporting IMPLEMENTATION AND CONFIGURATION ONLY.**
The actual images, the completed run file and the report markdown / HTML do not exist yet: record them `scheduled for Checkpoint B`.
Claiming they exist, or marking their runtime verification passed, is a false claim.

Checklist (all of these, plus `references/compliance-checkpoints.md` §2):

- [ ] Placement Manifest complete; spec + page objects at correct paths; spec registered
- [ ] **Automation inventory written before any page object** (`<automation_inventory>`): the
      whole automation root scanned, one decision row per screen in
      `{reports_folder}/automation-inventory.md`, every candidate named with its reason, the
      validator run with `--inventory` and **no open `pom-duplicate-page`** (every candidate pair
      `pom-duplicate-page-decided`); a `create` row with an unaddressed candidate = FAIL
- [ ] Zero inline locators in specs — all interaction through page objects
- [ ] **POM self-check grep run and reported clean** (see `<pom_mandatory>`)
- [ ] No spec-local function takes `page` or a page object and drives the screen
- [ ] No `.locator()` / `.evaluate()` / `.count()` chained off a page object's exposed locator
- [ ] Every automation-candidate TC-ID implemented or skip-guarded with a precise reason; a
      candidate with `[HUMAN]` steps implemented up to the first one and listed
      `partial (human step: n)` — never as full coverage
- [ ] **Every `[E{n}]` / `[A{n}]` / `[D{n}]` reference resolved through its own ID-keyed entry**
      (`environment('E1')`, `account('A1')`, `dataItem('D1')`) — no role-to-account, no
      "first E row", no literal URL or username in code
- [ ] Coverage table matches the approved document exactly (no invented scenarios)
- [ ] No banned patterns (waitForTimeout / test.only / hardcoded creds or URLs)
- [ ] AAA identifiable in every test; every test has ≥1 assertion
- [ ] **Evidence at the assertion point: every test captures evidence exactly once, at its Assert
      step and BEFORE any teardown / cleanup / delete call, and no `afterEach` contains it**
      (see `<result_organization>`). **The capture may be DIRECT in the spec or INDIRECT inside a
      page-object / helper method the test calls** — both are compliant. A direct-call search
      (`grep -n "captureEvidence" <spec-file>`) is a starting point, never the verdict: never
      report evidence missing on a direct-call search alone. `validate-automation.mjs` follows the
      methods each test actually invokes and reports `evidence-call-found` (found on a
      straight-line path), `evidence-conditional` / `evidence-unresolved` (undetermined → review),
      or `evidence-missing` (every hop followed, genuinely absent). Placement relative to teardown
      is **always** a semantic-review item — a call site is not proof of when it runs.
- [ ] Isolation: each test runnable alone; teardown for every api_setup
- [ ] Traceability header present; describe has REQ-ID; titles have [TC-ID] + polarity tag
      (+ `@smoke` where the document marks it)
- [ ] Open questions resolved (PHASE 2.4): every parked TC generated from a user decision, a
      learning-file reuse, or a tagged `@unverified-assumption`; every answer already written
      back to the learning file as a generic rule
- [ ] Static coverage measured (PHASE 2.5) and the gate verdict recorded before any run
- [ ] Test-data readiness resolved (PHASE 2.6): every `MISSING` gap was searched for a way
      (learning file, automation helpers through the manifest paths and by search, the
      application's source code, UI journeys, a DB helper) and prepared when one existed; every
      remaining skip is `data_missing` (no way found), `not creatable` (evidence) or `QC declined`,
      never a default; every skip guard in the specs traces to one of them
- [ ] **Every assertion verifies the outcome its TC requires** — a visibility check only where
      visibility or access IS the requirement; values, calculations, permissions and state changes
      assert those outcomes (`references/automation-rules.md` §2)
- [ ] **Every expected value traces to an approved requirement or an approved clarification** —
      never to observed behaviour alone (`<source_of_truth>`)
- [ ] **Modifier policy honoured** (`<test_modifiers>`): no focused execution anywhere; every
      `skip`/`fixme`/`fail`/`slow` carries a traceable reason and stays visible in the status model
- [ ] **Wait policy honoured across specs, page objects, fixtures and helpers** (`<wait_policy>`)
- [ ] **Validator run and its full result reported** — `gate`, `counts`, `review[]`, `notRun[]`,
      `exceptions[]`; every open item closed by documented semantic review, or the gate is BLOCKED
      for those items
- [ ] **Every honoured exception's cited source opened and its substance recorded** (justified /
      rejected) — a well-formed `qa-allow` is not yet a justified one
- [ ] **Gate recorded with the `scopeDigest`**, and no applicable check recorded as PASS without
      having run; evidence/report runtime artifacts recorded `scheduled for Checkpoint B`
</checkpoint_a>

## 4. Checkpoint B — after the final run

Runs after execution and after all debugging, before `AUTOMATION COMPLETE`.

1. **Repeat the FULL review on the final code** — including every file that passed Checkpoint A.
   Debugging changes code; A's results describe the code as it was then.
2. **Confirm debugging introduced no shortcuts:** no weakened assertion, no broken POM boundary, no
   removed evidence, no suppressed error, no new unjustified skip, no changed application setting,
   no product-code edit.
3. **Verify the artifacts exist.** Items 18, 19, 22, 32 and 33: the evidence images, the run file with its merged results, the `## Phase N` section of `TEST-RUN-REPORT-{feature}.md`, the `BUG-REPORT-{feature}.md` entries of this phase, the rendered HTML (renderer gate PASS, provenance verified) and the logs were actually written, are associated with the right TC, and
   correspond to the final tested code — compare the recorded `scopeDigest` with the current one.

Verify renderer PASS, provenance, no missing evidence and new root entries within the
run-report.md whitelist (legacy files untouched). These are semantic artifact checks.

### When Checkpoint B finds an automation defect

1. Repair it immediately.
2. Re-run the relevant static checks.
3. Re-run the affected tests.
4. If a **shared** component changed (page object, fixture, helper, config), include every consumer.
5. If the blast radius cannot be bounded reliably, run the full in-scope suite.
6. **Repeat the full Checkpoint B review** on the result.

**Any later code change invalidates the checks and results that change affects.** Refresh Checkpoint
A's applicable checks before rerunning, and repeat Checkpoint B afterwards. Never claim completion
from stale results — a recorded gate is only valid for the `scopeDigest` it names.

**Do not rerun to make a failure go away.** An unchanged application defect or an environment
failure is not fixed by repetition: preserve the evidence, classify it (`app_bug`,
`environment_failure`), and report it as an unresolved blocker.

## 4a. Checkpoint B — the procedure of record (`<checkpoint_b>`)

<checkpoint_b>
**CHECKPOINT B — MANDATORY POST-RUN COMPLIANCE GATE.** Runs after execution and after ALL
debugging, before `AUTOMATION COMPLETE`. Load `references/compliance-checkpoints.md` and work the
same checklist again.

1. **Repeat the FULL review on the FINAL code — including every file that passed Checkpoint A.**
   Debugging changes code; A's results describe the code as it was then, not as it is now.
   **Both halves again, not just the fast one:**
   - *mechanical* — re-run `validate-automation.mjs` and the project's own tooling over the final
     files, and record the new `scopeDigest`;
   - *semantic* — re-review every `S` item of `references/compliance-checkpoints.md` §2 against
     the final code: layer ownership, whether each assertion still verifies its required outcome,
     evidence placement, and each honoured exception's substance. A clean re-scan is not a
     repeated review.
2. **Confirm debugging introduced no shortcuts:** no weakened assertion, no broken POM boundary,
   no removed or relocated evidence, no suppressed error, no new unjustified skip or raised
   timeout, no changed application setting, no product-code edit — and **no page class written
   during debugging outside the inventory**: the re-run validator (with `--inventory`) reports no
   open `pom-duplicate-page`, and every class it lists under `pageScan` has its
   `automation-inventory.md` row.
3. **Verify the artifacts were ACTUALLY produced** — this is the half Checkpoint A could not do:
   - every executed attempt has its assertion-point image at the path `{run_file}` records, and
     every failed attempt its failure image;
   - each image is associated with the right TC-ID and variant, and the **evidence sanity check**
     passes (no PASS image showing a cleaned-up screen);
   - `{run_file}` (status final), the `## Phase {N}` section of `{run_report_md}`,
     `{bug_report_md}` (one entry per `app_bug` of this phase, no bug marked resolved without a
     passing retest), `{run_report_html}` and the progress log exist, are internally consistent
     and **correspond to the final tested code** — compare the `scopeDigest` recorded for the run
     against the current one;
   - the renderer's last payload for this markdown says `gate: PASS`, its `writes[]` names the
     HTML, the page's provenance self-hash verifies (no hand edit), and `warnings[]` carries no
     `evidence-file-missing` / `bug-report-missing` / `run-file-missing`;
   - the story folder's top level holds nothing outside the whitelist (legacy files untouched);
   - expected failures (`fail`), extended timeouts (`slow`) and skips appear as themselves in the
     report, never folded into the pass count;
   - Requirement → TC → automated test → execution result is mappable end to end, and the three
     coverage figures are reported separately (`<coverage_measurement>`).

**If an automation defect is found here:** repair it immediately → re-run the relevant static
checks → **rerun the affected tests** → if a shared component changed (page object, fixture,
helper, config) include every consumer → if the blast radius cannot be bounded reliably, run the
full in-scope suite → then **repeat the full Checkpoint B review** on the result.

**Any later code change invalidates the checks and results it affects.** Refresh Checkpoint A's
applicable checks before rerunning and repeat B afterwards. A recorded gate is valid only for the
`scopeDigest` it names — **never claim completion from stale results.**

**Do not rerun to make a failure disappear.** An unchanged application defect or an environment
failure is not fixed by repetition: preserve the evidence, classify it (`app_bug`,
`environment_failure`, `unverified_assumption`), and report it as an unresolved blocker.

**Gate result.** `PASS` only when there are no confirmed violations in the final delivered scope
**and** every `review[]` / `notRun[]` item is closed — by the scanner, by other project tooling,
or by documented semantic review against the same `scopeDigest`. Otherwise `FAIL` or `BLOCKED`,
named item by item. Record it per `compliance-checkpoints.md` §5.

**Both gates must PASS for the final delivered scope before claiming automation compliance**, and
compliance status is reported separately from execution status: compliant tests can expose
application defects, passing tests can still violate these rules, and an environment blocker can
leave a gate BLOCKED with nothing wrong in the code.
</checkpoint_b>

---

## 5. Recording a gate

Both gates are recorded in the `### Compliance gates` section of the final report and in the run
progress log. Each record carries:

```
Checkpoint {A|B} — {PASS | FAIL | BLOCKED}
Scope:        {N tests, M page objects/fixtures/helpers, list or glob}
Code state:   scopeDigest {sha} · {N} files hashed · git {HEAD short} {clean|+K uncommitted} (context only)
Checks:       {validator gate + counts} · {project tooling run} · {semantic items reviewed}
Findings:     {ruleId} {file}:{line} — {one line}
Repairs:      {what changed} → {re-check run} → {result}
Open items:   {review/notRun item} — {verified-semantic: reasoning | unresolved: why}
Unresolved:   {check} — {why it could not be verified}   ← each one keeps this gate BLOCKED
N/A:          {check} — {why this rule has NO SUBJECT in this scope}
```

Rules for the record:

- **An applicable check that did not run is never PASS and never `N/A`.** It is `unresolved`, and
  the gate is **BLOCKED** until it is verified. `N/A` is reserved for a rule that has no subject in
  this scope, with the reason naming why it has none (§1).
- **Distinguish "scheduled for Checkpoint B" from "completed now."** At A, runtime artifacts are
  scheduled; saying they exist is a false claim.
- `git` state is context only. The identity of the tested code is the `scopeDigest`: content hashes
  of the in-scope code and configuration, **including untracked files**, excluding generated output
  (`reports/`, `screenshots/`, `automation-logs/`, `coverage/`) so a report cannot invalidate its own
  run.
- Compliance status and execution status are reported separately. A BLOCKED gate with a green suite
  is a real and reportable outcome, and so is a PASS gate with failing tests that found real bugs.
