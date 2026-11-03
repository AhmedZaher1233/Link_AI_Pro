# Automation rules — expected results, assertions, modifiers, waits, repairs, coverage

Loaded at **Writing Automation Code** and kept for the run. `<source_of_truth>`, `<test_modifiers>` and `<wait_policy>` (`code-generation.md`) are the short forms of §1-§4; `<coverage_measurement>` relies on §6, `<first_run>` on §5.

## 1. Where an expected result may come from

Only two sources define an expectation: **approved requirements** (the REQ/AC the approved TC document traces to) and **explicitly approved clarifications** (a PHASE 2.4 answer the user gave, or a decision recorded in `Testing/project-learning.md` from one). Application code, observed behaviour (a live run, an MCP pass), learning-file lines and skill 11's rules are evidence — they form a question or confirm a selector, never settle an expectation.

- Weigh a learning-file entry by its source, approval and relevance; it never outranks an approved requirement. On a contradiction the requirement wins and the contradiction is reported.
- A skill 11 rule is `PENDING PO APPROVAL` until its decision block is filled and skill 11 is re-run with `--apply-approved`; until then it informs a question, never an assertion.
- An approved TC and its requirement disagree → both wordings under `### Deviations`; automate the requirement-consistent reading only on the user's confirmation, else park the TC as an open question.
- An unanswered question never becomes an expectation. A best-evidenced reading may be automated tagged `@unverified-assumption` (assumption stated in the spec and the report), counted *Assumed*, excluded from confirmed coverage, never filed as a bug, never published as Passed.

Detail: references/maintainers/automation-rules.md §1

## 2. Assertion quality

- Placeholders are rejected: an assertion comparing literals, an empty body, a test asserting nothing. No matcher is banned by name — a placeholder is an assertion that cannot fail for any application state.
- Visibility-only suffices only when visibility or access IS the requirement; values, calculations, permissions and state changes need assertions on those outcomes.
- An assertion inside an invoked page-object method counts; never call a test assertion-free from a direct-call search of the spec alone.
- Repair a weak assertion whenever found, whatever the coverage number says.

## 3. Modifier policy — `only`, `skip`, `fixme`, `fail`, `slow`

Every form: bare, conditional (`test.skip(cond, 'reason')`) and suite-level (`test.describe.skip(...)`).

| Modifier | Policy |
|---|---|
| `only` (`fit`, `describe.only`) | never committed, never exemptible |
| `skip` | a reason tracing to a PHASE 2.6 readiness decision, an approved requirement or an honoured exception; counts `SKIP`, never a pass |
| `fixme` | a reason; known-broken, never read as a pass |
| `fail` | a reason; an expected failure in its own row, never in the pass count |
| `slow` | a reason; never reported skipped, never papers over an unexplained slowdown |

Targeted runs use `run-stage.mjs` filters on the one shared config — never an edited test file, never `--config`. A skipped or blocked test stays visible in the run file, the phase section and the chat summary, against the original scope with its reason — never removed, never a pass, never out of the totals.

## 4. Wait policy — specs, page objects, fixtures and helpers alike

- Prefer an observable condition (a web-first assertion, a URL / response wait, a state the page object exposes); bounded polling is fine.
- A timer needs its reason on the line above or in a `qa-allow` (a justified backoff, a real debounce, an explicit timing requirement).
- Never raise a timeout to conceal an unexplained failure: a known reason is said, an unknown one investigated.
- A `waitForTimeout` moved from a spec into a page object is the same fixed wait.
- `networkidle` is not readiness (validator warning `wait-network-idle`; an exception is stated on the line above) — wait for the application's own signal (code-craft §10).
- Every wait is bounded by the step deadline (`helpers/steps.ts`, values from `timeouts.ts`); a loader that outlives it IS the timeout the step reports, observed as "loader still visible".
- No inline timeout value: budget, step, action, navigation, expect and hook values come from `timeouts.ts`; a known long operation is a named `operations.*` key with its reason beside it (code-craft §9).

## 5. Repair records

Every repair is one Heal Log row with all nine columns; `n/a` with a reason is a value, a blank is not.

| Column | Content |
|---|---|
| 1 TC-ID | the test case this repair affects |
| 2 Affected test / files | the test title and every file changed, as `file:line` |
| 3 Defect category | `selector_failure` · `assertion_failure` · `evidence_failure` · `timeout_failure`; may name the cause class in words |
| 4 Previous value | the exact old locator, assertion or expected value |
| 5 Updated value | the exact new one |
| 6 Reason | why the new value is correct |
| 7 Approved-requirement reference | REQ/AC/TC id or the approved clarification — **required** for any assertion or expected-value change; `n/a` for a pure locator repair |
| 8 Verification performed | the checks re-run (validator rules, project lint, semantic re-review) and, when the cause class owes one, the burn-in that confirms the heal in the re-run (`--burn-in`, workers 1, `--repeat-each=3`) |
| 9 Rerun result | the tests the re-run executed (burn-in included) and their outcome — any failing burn-in repeat is FAIL — or `not re-run — reason` |

**`cause_class`** is a run-file key on each `{run_file}.heal_log[]` entry, not a table column: `deterministic` (wrong locator, wrong text, wrong branch, wrong wait target — the fix is certain) | `timing` | `flaky` | `race`. Burn-in (`--repeat-each=3`) is owed only for `timing` / `flaky` / `race`; a `deterministic` heal runs once in the re-run. `run-stage.mjs --burn-in auto` reads `{run_file}.heal_log[].cause_class` to decide.

Rules:
- A locator repair preserves the intended element and behaviour: re-confirm the new selector against the source; a locator matching a different element is a new defect, not a fix.
- An assertion or expected-value change needs requirement evidence in the Approved-requirement reference; none → recorded **unresolved**, never an invented repair.
- A genuine requirement change is an explicit test update, described as such — never a silent heal.
- Never weaken an assertion, delete required coverage, suppress an error, add an unjustified skip, change an application setting or edit product code to obtain a pass. Application defects are reported, never absorbed.

Detail: references/maintainers/automation-rules.md §5

## 6. Traceability, coverage and execution — three different numbers

| Figure | Answers | Where |
|---|---|---|
| Requirement outcome coverage | are each requirement's outcomes asserted? `Full` / `Partial` / `Missing` / `Assumed` | `### Coverage`, requirement ID on every row |
| TC automation coverage | how much of the approved document is automated? the weighted % | the PHASE 2.5 gate (target, source, repair pass, user override) |
| Execution pass rate | of what ran, how much passed? | `### Results` and the return's `Results of record` line — the latest attempt per TC, never mixed into the two above |

- Traceability is not coverage: a link plus a visibility assertion on a calculation requirement is `Partial`; `@unverified-assumption` tests are `Assumed`, never `Full`.
- IDs come from upstream (the REQ file, the approved TC document, `ADO-MAP.md`); report an unresolvable ID; never invent, derive or renumber one (skill 2 owns REQ IDs, skill 3 TC IDs). `validate-automation.mjs --req-ids <REQ file>` flags unknown ids; without the list that check is `notRun`, never a pass.
- `coverage-summary.csv`, `coverage-detail.csv`, `manual-scenarios.csv`, the Coverage section and `.runs/phase-{N}.json` carry the requirement ID(s) on every row.
- Missing, partial, blocked and unexecuted coverage keep separate counts; extend the existing reports, never replace them.

**The document's validation states** (`validated` / `enhanced` / `inferred` / `discrepancy` / `not-implemented` / `draft`; all but `draft` from 3b / 3c, stamp key `tool: mcp | cli`; an all-`draft` document is normal) may be stale: re-verify readiness where the screen is reachable; a genuinely unavailable implementation → `pending — not covered for this run` (not a failure, not a defect, still in the denominator); a failing draft TC is verified before its failure is classified.

Detail: references/maintainers/automation-rules.md §6
