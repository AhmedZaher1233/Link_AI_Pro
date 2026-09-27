# Automation rules — expected results, assertions, modifiers, waits, repairs, coverage

Loaded by `SKILL.md` from `<source_of_truth>`, `<test_modifiers>`, `<wait_policy>`, `<first_run>`
and `<coverage_measurement>`.

---

## 1. Where an expected result may come from

Automation encodes expectations. Only two things may define one:

1. **Approved requirements** — the REQ/AC statements the approved TC document traces to.
2. **Explicitly approved clarifications** — a `PHASE 2.4` answer the user actually gave, or a
   decision already recorded in `Testing/project-learning.md` from such an answer.

Everything else is evidence, not authority:

| Source | What it is | What it is not |
|---|---|---|
| Application code | how the feature is implemented today | proof that behaviour is correct |
| Observed behaviour (a live run, a Playwright MCP pass) | what the app currently does | an approved expectation |
| `project-learning.md` entries | accumulated knowledge, of varying provenance | an override of an approved requirement |
| Skill 11's discovered business rules | rules the code enforces | requirements, until the PO approves them |

**Weigh a learning-file entry, do not rank it.** Judge each by its source (was it a user answer, an
observation, or a guess?), its approval (did a human confirm it?), and its relevance (same module,
page, element, locale?). A line that merely records what the app did never outranks an approved
requirement. When a learning line contradicts a requirement, the requirement wins and the
contradiction is reported.

**Skill 11 findings need approval.** A rule exported by `link-qc-11-discover-business-rules` is a proposal
marked `PENDING PO APPROVAL`. It may be used as an expected result only after the decision block is
filled and skill 11 has been re-run with `--apply-approved`. Until then it may inform a *question*,
never an assertion.

**Conflicts are reported, not resolved.** Where an approved TC and its requirement disagree, say so
in `### Deviations` with both wordings, automate the requirement-consistent reading only if the user
confirms it, and otherwise park the TC as an open question.

**An unanswered question never becomes an approved expectation.** Current application behaviour is
not promoted to "correct" by the absence of an answer. Exploratory checks may still be automated on
the best-evidenced reading — tagged `@unverified-assumption`, with the assumption stated in the spec
and the report — but they are **excluded from confirmed requirement coverage** and counted as
*Assumed*. They are never filed as application bugs and never published as Passed.

---

## 2. Assertion quality

Every test must verify the outcome its test case requires.

- **Reject obvious placeholders:** an assertion comparing literals (`expect(true).toBe(true)`), an
  empty test body, a test that asserts nothing at all.
- **Never ban a matcher by name.** `toBeTruthy()`, `toBeDefined()` and friends are legitimate on a
  real subject. What makes an assertion a placeholder is that it cannot fail for any state of the
  application — not the matcher it uses.
- **Visibility-only is sufficient only when visibility or access IS the requirement.** "The Export
  button is hidden for a Viewer" is fully verified by a visibility assertion. "The total is
  recalculated after an edit" is not.
- **Requirements about values, calculations, permissions or state changes need assertions that
  verify those outcomes** — the computed number, the persisted change, the refusal, the new state.
- **Recognise valid assertions in approved helpers and page objects.** An assertion inside an
  invoked page-object method counts. Never report a test as assertion-free from a direct-call search
  of the spec alone.
- **Repair a weak assertion whenever you find one**, even if the weighted coverage number already
  meets its target. Coverage is an aggregate; this is a defect in one test.

---

## 3. Modifier policy — `only`, `skip`, `fixme`, `fail`, `slow`

Applies to every form: bare (`test.skip()`), conditional (`test.skip(cond, 'reason')`) and
suite-level (`test.describe.skip(...)`).

| Modifier | Policy |
|---|---|
| `only` (and `fit`, `describe.only`) | **Never committed.** It silences every other test in the run, so a green result would be meaningless. This is not exemptible. |
| `skip` | Allowed with a reason that traces to a PHASE 2.6 readiness decision, an approved requirement, or an honoured exception. Counts as `SKIP`, never as a pass. |
| `fixme` | Allowed with a reason. A known-broken test that must not be read as a pass. |
| `fail` | Allowed with a reason. An **expected failure**: reported in its own row, never merged into the pass count, and it fails the run if it unexpectedly passes. |
| `slow` | Allowed with a reason. It **extends the timeout**; it does not skip anything. Never report a `slow` test as skipped, and never use it to paper over an unexplained slowdown. |

**Targeted runs are preserved** — that is what the runner's own filters are for:
`--grep` / `--grep-invert`, `--project`, `--last-failed`, `--repeat-each`, `--workers` — on the one
shared config. Use those. Never edit a test file to focus a run, and never reach for `--config`.

**A missing prerequisite must stay visible.** A skipped or blocked test is reported against the
original scope with its reason, in the run file, the report's phase section and the chat summary. It is never
removed from the scope, never counted as a pass, and never allowed to disappear from the totals.

---

## 4. Wait policy — specs, page objects, fixtures and helpers alike

- **Prefer an observable condition**: a web-first assertion (`expect(locator).toBeVisible()`),
  `waitForURL`, `waitForResponse`, a state the page object exposes.
- **Bounded polling is fine** — `expect.poll`, `toPass({ timeout })`, an explicit retry with a limit.
- **Timers are not banned.** A justified retry backoff, a debounce the UI genuinely has, or an
  explicit timing requirement from the spec is legitimate. State the reason on the line above, or in
  a `qa-allow`, so it is visible in the report rather than looking like a lazy sleep.
- **Never raise a timeout to conceal an unexplained failure.** If a test needs more time, the reason
  is either known (say it) or unknown (investigate it, don't pad it).
- These rules apply in every layer. A `waitForTimeout` moved from a spec into a page object is the
  same fixed wait in a different file.
- **`networkidle` is not a readiness signal** (`waitForLoadState('networkidle')`, `waitUntil:
  'networkidle'`): it never settles on pages that poll or stream and settles too early on lazy
  pages. Wait for the loader to hide, for the response that carries the data, or for a web-first
  assertion on the element the step needs (validator warning `wait-network-idle`; a justified
  exception is stated on the line above).
- **Every wait is bounded by the step's deadline** (`helpers/steps.ts`, values from `timeouts.ts`).
  A visible loader never extends it: a loader that outlives the deadline IS the timeout the step
  reports, with "loader still visible" as the observed condition.
- **Timeout values are never inline.** Test budget, step deadline, action, navigation, expect and
  hook values come from `timeouts.ts`; a known long operation is a named `operations.*` key with
  its reason beside it. `references/code-craft.md` §9 holds the policy and the calibration rule.

---

## 5. Repair records

Every repair is recorded in the Heal Log with all nine columns. No column is optional; `n/a` with a
reason is an acceptable value, a blank is not.

| Column | Content |
|---|---|
| 1 TC-ID | the test case this repair affects |
| 2 Affected test / files | the test title and every file changed, as `file:line` |
| 3 Defect category | `selector_failure` · `assertion_failure` · `evidence_failure` · `timeout_failure` |
| 4 Previous value | the exact old locator, assertion or expected value |
| 5 Updated value | the exact new one |
| 6 Reason | why the new value is correct |
| 7 Approved-requirement reference | REQ/AC/TC id or the approved clarification. **Required** for any assertion or expected-value change; `n/a` for a pure locator repair |
| 8 Verification performed | which checks were re-run (validator rules, project lint, semantic re-review) |
| 9 Rerun result | the tests re-executed and their outcome, or `not re-run — reason` |

Rules:

- **Locator repairs must preserve the intended element and behaviour.** Re-confirm the new selector
  against the source before changing it; a locator that matches a *different* element is a new
  defect, not a fix.
- **Assertion and expected-value changes need requirement evidence.** Column 7 is how that evidence
  is shown. No evidence → the issue is recorded **unresolved**; never invent a repair.
- **A genuine requirement change is an explicit test update**, described as such — not a silent heal.
- **Never** weaken an assertion, delete required coverage, suppress an error, add an unjustified
  skip, change an application setting, or edit product code to obtain a pass. Application defects are
  reported, never absorbed.

---

## 6. Traceability, coverage and execution — three different numbers

Report all three separately. Never let one stand in for another.

| Figure | What it answers | Where |
|---|---|---|
| **Requirement outcome coverage** | Are each requirement's required outcomes actually asserted? `Full` / `Partial` / `Missing` / `Assumed` | `### Coverage`, with the requirement ID on every row |
| **TC automation coverage** | How much of the approved TC document is automated? The existing weighted % | The PHASE 2.5 gate — target, source and override path unchanged |
| **Execution pass rate** | Of what ran, how much passed? | `### Second Run — Results` |

**Traceability is not coverage.** A requirement linked to one test is *traceable*; whether that test
asserts the requirement's outcomes is a separate judgement (checklist item 7). A link plus a
visibility assertion on a calculation requirement is `Partial`, not `Full`.

**IDs come from upstream.** Validate every referenced requirement ID against the resolved sources
(the REQ file, the approved TC document, `ADO-MAP.md`). Report an ID you cannot resolve. **Never
invent, derive or renumber a requirement ID during automation** — skill 2 owns REQ IDs, skill 3 owns
TC IDs.

**Requirement IDs belong in the artifacts.** `coverage-summary.csv`, `coverage-detail.csv`,
`manual-scenarios.csv`, the Coverage section and `.runs/phase-{N}.json` each carry the requirement ID(s)
for every row, so Requirement → TC → automated test → execution result is mappable end to end.

**Keep the gaps visible.** Missing, partial, blocked and unexecuted coverage each keep their own
count. Extend the existing reports; do not replace them.

### Carrying forward the document's TC validation states

The approved document marks each TC `validated` / `enhanced` / `inferred` / `discrepancy` /
`not-implemented` / `draft`. Every state but `draft` comes from the optional
`link-qc-3b-validate-manual-test-cases` or `link-qc-3c-validate-manual-test-cases-cli`; a document that never went through either is all `draft`, which is
normal and never a reason to ask for it. Those labels were true when they were written and **may
now be stale**.

- **Re-verify readiness where you can.** An `inferred` or `draft` TC whose screen you can now reach
  is worth re-checking before you trust its label.
- **Genuinely unavailable implementation** → the TC is `pending / not covered for this run`, not a
  failure and not an application defect.
- **Investigate a draft or unvalidated TC before classifying its failure.** A draft TC failing does
  not by itself prove an application defect — the TC may simply be wrong. It may, however, reveal a
  real defect once verified. Verify first, classify second.
