# Static coverage measurement — the pre-run gate (PHASE 2.5)

Loaded by `SKILL.md` at **Validating Automation Code**.

## PHASE 2.5 — STATIC COVERAGE MEASUREMENT (pre-run gate)

<coverage_measurement>
**Runs after `<checkpoint_a>` and BEFORE PHASE 3 — nothing executes until this verdict exists.**
This is a static read of the spec source, not a pass/fail result: it answers "how much of
the approved document does the generated code *really* cover?" — and it is deliberately
skeptical, because a `test()` that exists is not a TC that is covered.

**Denominator = every TC in `{source_tc_doc}`** (the ORIGINAL approved document — never the
beautified file). Locale variants (`TC-01`, `TC-01b`) are separate TCs, as in the document.
`manual — not automated` TCs stay in the denominator; the number must be honest.

**Three different numbers — requirement outcome coverage, TC automation coverage (this phase's gate)
and the execution pass rate — are reported separately, never one standing in for another.**
Traceability is not coverage; requirement IDs are validated, never invented; the document's TC
validation states are carried forward and treated as possibly stale; missing, partial, blocked and
unexecuted coverage keep their own counts. All of it: `references/automation-rules.md` §6.

**1. Inventory the generated tests** — per spec file of this story, without reading every
line of logic:

```
grep -nE "test\.describe\(|[^.]test\(|test\.skip\(|\[TC-" <spec>
```

Capture per `test()`: `tcId` (from the `[TC-ID]` in the title), describe group, and:
- `alwaysSkipped` — a `test.skip(true, …)` (or an unconditional skip guard) gates the whole body
- `dataGated` — `test.skip(!data | !entity | !record, …)`: runs only when seeded data exists
- `accessOnly` — the body only asserts that an option/panel/screen is visible; no field value,
  count, identity or status assertion
- `roleLoop` — the test is parameterised over several roles (one `tcId`, many runs)
- `unverifiedAssumption` — tagged `@unverified-assumption` by PHASE 2.4: the expected result it
  asserts is an interpretation nobody confirmed

**2. Classify every TC of the document** against the inventory — match on TC-ID first, then on
action + role + screen where a TC-ID is missing from a title:

| Status | Weight | Assign when… |
|---|---|---|
| **Fully Covered** | 1.0 | A test asserts the TC's **expected result** end-to-end (the values, status, count or identity the document names) and it actually runs (not always-skipped). |
| **Partially Covered** | 0.5 | Automation exists but is weaker than the TC: always-skipped (role/config not available), data-gated with no empty-state assertion, access-only, **`unverifiedAssumption` — it asserts a PHASE 2.4 interpretation the user never confirmed (note: `partially covered — unverified assumption`)**, proves the scenario for a **different role or data variant**, checks **one row** where the TC says "every row", or asserts less than the document's expected result. |
| **Not Covered** | 0.0 | No test exercises the scenario — including every `Automation Candidate = NO` / `manual — not automated` TC. |

Heuristics that almost always land Partial or Not Covered — check them explicitly:
negative / permission / "cannot see" scenarios without a dedicated negative test · empty-state
/ no-data scenarios (data-gated specs skip instead of asserting emptiness) · system or
background-job records (auto-approve, auto-cancel, scheduled updates) · date-format /
field-present-vs-absent display · "every row" enumeration and "opens the correct record"
identity · a role the environment has no user for · a scenario proved via another role's data.

Record per TC: `coverageStatus`, `mappedTests` (or `-`), `manualRecommended` (Yes for every
Partial and Not Covered), `category` (see step 4) and a one-line `note`.

**3. Compute** — overall and per run stage (Smoke / Positive / Negative, the same split the
run uses):

```
weighted % = (full × 1.0 + partial × 0.5) / total × 100     (one decimal)
```

Also count distinct automated TC-IDs per spec (context only — role loops and data gates mean
it is not "tests that will execute").

**4. Gate** — compare the overall weighted % with `{coverage_target}` using `{coverage_mechanism}`
(both from L3; defaults 80 % / soft block — say which source was used):

- **≥ target → PASS.** Print the verdict and continue.
- **Below target, `soft block` (default):**
  1. List every Partial / Not Covered TC whose `Automation Candidate = YES` — these are the
     fixable ones. `manual — not automated` TCs are never a reason to block and are never
     "fixed" here.
  2. ONE repair pass on that list under the PHASE 2 rules (POM mandatory, no banned patterns,
     no lowered assertions): strengthen access-only assertions to the document's expected
     result, remove skip guards that hide a runnable scenario, add the missing negative /
     empty-state test where the document has the TC. Never invent scenarios.
  3. Re-measure (steps 1–3).
  4. Still below → print the gap table and **ask the user**: `run anyway` (recorded as a
     user override in the report) / `fix more` (another pass, then re-ask) / `stop` (BLOCKED
     with the gap table). Never silently proceed.
- **`hard block`** → same repair pass; still below → BLOCKED, no run.
- **`report-only`** → continue; the number and gaps still go everywhere below.

Progress-log line (activity **Validating Automation Code**, `<live_progress>`; in the chat only inside a
message this step already sends — the below-target question or the run-start message):
`Validating Automation Code — coverage: {x}% weighted (Full {n} · Partial {n} · None {n}) — target {t}% ({L3 | default}) — {PASS | BELOW TARGET → repairing | BELOW TARGET → user override | BLOCKED}`

**5. Write the coverage folder** — `{coverage_root}` = `{results_root}/coverage/`, **replaced every
run**; history lives in `{run_file}.coverage_snapshot` (per-TC statuses + delta) and in each
phase's `### Coverage` table of the run report.
Quote any CSV field containing a comma; use these exact headers.

- `coverage-summary.csv`
  ```
  User Story,Requirement ID(s),Stage,Total TCs,Fully Covered,Partially Covered,Not Covered,Weighted Coverage %,Distinct Automated TC-IDs
  ```
  One row per stage (Smoke / Positive / Negative), then a `TOTAL` row; a blank line; a `Legend`
  of the three statuses + weights; numbered `Notes` (weighting formula; target + source +
  mechanism; role-loop / data-gate caveat; the manual-gap categories present).
- `coverage-detail.csv`
  ```
  User Story,Requirement ID(s),TC-ID,Test Case Title,Type,Smoke,Automation Candidate,Coverage Status,Requirement Outcome Coverage,Mapped Test(s),Manual Testing Recommended,Notes / Recommendation
  ```
  One row per TC of the approved document, in document order.
- `manual-scenarios.csv`
  ```
  Category,User Story,TC-ID,Scenario,Why Manual,Priority
  ```
  Only `manualRecommended = Yes` rows, grouped by `Category`: `Not an automation candidate`,
  `Empty State (Negative)`, `Permission / Unauthorized (Negative)`, `System / Background-Job
  Triggered`, `Display / Field Presence`, `Cross-Role Specific`, `Per-Row Enumeration &
  Identity`, `Role Variant`, `Config-Skipped (coded, never runs)`, `Completeness`.
  Priority: **High** = security / permission, empty-state, coded-but-never-runs; **Medium** =
  background jobs, field display, cross-role; **Low** = redundant per-row enumeration.
- Store `coverage_snapshot` in `{run_file}` with target/source/mechanism, stage/TC/requirement
  counts, manual priorities and delta (run-report.md §7). Compare against the newest earlier
  `.runs/phase-*.json` that carries a snapshot, falling back to a read-only legacy
  `coverage-previous.json`, and state which one — no separate snapshot file, no dashboard HTML.
- Add `### Coverage` to the Markdown phase; retain the three CSVs above.

**6. Verify** — every approved TC appears in coverage-detail.csv; undecidable coverage stays
visible as an assumption. Render and inspect the report at finalization.

Recurring reasons a project lands Partial (e.g. "no Approver user exists in any
environment", "history screens have no empty-state fixture") are project knowledge: write them
as plain-English `[type: env]` / `[type: trick]` lines under `### Automation Model (skill 5) →
#### Knowledge` so the next story's design and measurement start from them.
</coverage_measurement>
