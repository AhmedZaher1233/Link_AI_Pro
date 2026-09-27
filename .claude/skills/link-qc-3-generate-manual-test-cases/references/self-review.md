# Built-in self-review — load at the self-review (workflow step 9)

You are your own first reviewer. Run every check below, FIX your own findings in place, and
include the completed tables in the deliverable. There is no separate reviewer agent — the next
gate is the human.

1. **Traceability matrix** — every acceptance criterion ↔ REQ-ID ↔ covering TC-IDs. Any AC with
   no TC → coverage gap: fix it (add the TC) before delivering. Every TC must cite a REQ-ID that
   exists verbatim in the requirements source.
2. **Negative coverage table** — all L1 §4 categories present or justified N/A. An N/A is
   justified only by the requirement (it defines no such outcome or input) — never by what a
   browser tool can observe: an email, SMS / OTP, notification, download or background-job
   outcome the requirement defines is a TC, with a `[HUMAN]` step where no authorized interface
   exists (`tc-design.md` "Out-of-browser outcomes"), not an N/A row.
3. **Standards alignment** — map the set against the functional checklist in the L2 standards
   document (`{qa_standards}` → `steering.L2`): COVERED / GAP / N/A per item, with TC-IDs.
4. **Requirement coverage score** — the traceability matrix is binary (an AC has a TC or not);
   this score shows the *depth* it hides. Classify every acceptance criterion:

   | Status | Weight | The AC is… |
   |---|---|---|
   | **Fully Covered** | 1.0 | ≥1 happy-path TC **and** every L1 §4 negative category that applies to it **and** every `required_locales` variant present — all with observable expected results and, where data is asserted, a Data Oracle |
   | **Partially Covered** | 0.5 | Has TCs, but misses one of: a negative category that applies, a locale variant, a required Data Oracle |
   | **Not Covered** | 0.0 | No TC cites the AC (item 1 already forces a fix before delivering; the score only makes a reviewer-waived gap visible) |

   `weighted % = (full × 1.0 + partial × 0.5) / total ACs × 100` (one decimal). Report a per-AC
   table (AC · REQ-ID · TC-IDs · status · what is missing) and the overall number with Full /
   Partial / None counts. The score never replaces item 1 — every AC at 0.0 is still fixed
   first; Partial rows are fixed where you can and otherwise listed under Open Findings with the
   missing piece named.

   **Coverage is requirement-based.** Validation states never affect this score: a `draft — not
   app-validated` or `not-implemented — pending implementation` TC counts exactly like any other
   designed TC. Rule, verbatim in both skills: *"Validation alone does not change design coverage;
   discovering a genuine coverage gap or updating cases may change it."* Live observation is
   reported separately as **App validation progress** (`0/N` from this skill).
5. **Manual-only scenarios** — every TC with `Automation Candidate = NO` (plus `not-implemented`
   TCs the reviewer will run by hand once the story ships) gets one row (this table belongs to
   the design; 3b never rewrites it):
   `Category · TC-ID · Scenario · Why manual · Priority`. Categories: `Permission /
   Unauthorized`, `Empty State`, `System / Background-Job Triggered`, `Display / Field
   Presence`, `Cross-Role Specific`, `Per-Row Enumeration & Identity`, `Visual / UX judgement`,
   `Data setup not reproducible`, `Human-observed step`, `Pending implementation`. Priority:
   **High** = security / permission, empty state, pending implementation; **Medium** =
   background jobs, field display, cross-role, human-observed step; **Low** = redundant per-row
   enumeration. A `Human-observed step` row also lists every `Automation Candidate = YES` TC
   that carries a `[HUMAN]` step ("partially automatable — human step(s) {n}"), naming the
   human part. This is the list skill 5 later confirms against the real specs — keep the
   wording plain English.
6. **Independence** — every TC runnable in isolation; all preconditions explicit; no TC assumes
   state from another TC.
7. **Redundancy** — merge or remove TCs that cover identical scenarios under different names.
8. **Observability** — every expected result maps to an observable outcome (visible / text /
   count / url). "Works correctly" is not assertable: rewrite.
9. **Step quality** — every step carries the 4 handoff fields; loading-indicator assertions are
   two steps; no generic steps; every TC reads as a complete user journey (no "apply the required
   filter"-style vagueness).
10. **Validation honesty** — every TC this skill wrote or changed carries exactly
    `draft — not app-validated` (or `not-implemented — pending implementation` per
    `entry-cases.md` §4, or `draft — not app-validated (stale — revised)` on a revised TC); no
    other state was written here; on `--revision` the TCs not touched keep the state and
    evidence stamp 3b gave them.
11. **Gap-vs-defect separation** — requirement/coverage gaps, application defects
    (discrepancies — "none — not app-validated" from this skill), pending-implementation items,
    environment blockers and unclear requirements appear in five distinct buckets — never mixed.
12. **Secrets, code and references** — no password, token, selector, attribute name, code
    snippet or file identifier anywhere in any deliverable (TC document, test-data file, HTML
    page). Externalized values — environment URLs / hosts / endpoints, account usernames,
    shared datasets — appear in the TC document **only as references** (`[E{n}]` / `[A{n}]` /
    `[D{n}]`, name + token) and every reference resolves to a row of `TEST-DATA-{feature}.md`;
    the username itself lives only in `TEST-DATA` §1. Intentional inputs and expected outputs
    stay inline; a deliberate collision carries `(intentional input)`. The renderer's dry run
    reports no `data-literal`, `data-ref-unresolved` or `narrative-not-english` warning — each
    must be cleared before delivery.
13. **Case 1 only** — the Existing-TC Analysis table accounts for every original TC exactly once
    (kept / updated / merged / removed).
14. **Test-data consistency** (`TEST-DATA-{feature}.md`, `deliverables.md` §2b) — every
    `Preconditions` / `Data Oracle` / `Shared data` sentence and every role used maps to a data
    item, and every data item maps back to real TC-IDs; every `## 0. Environment` (`E{n}`) and
    `## 1. Accounts` (`A{n}`) row is referenced by ≥ 1 TC and `E1` is the application base URL;
    every `MISSING` / `IMPOSSIBLE` item has
    at least one **available** way or a row in the Problems table; no item is `MISSING` without
    a recorded check (unchecked = `UNKNOWN`); no `api` / `db` way is shown as available without
    confirmation from the learning file or the user; the header counts equal the table rows;
    "shared" means the TCs use the same data item, with execution order stated only for a real
    dependency; no locator, endpoint path, table / column name, code identifier or secret
    anywhere in the file.
15. **Open questions** (`open-questions.md`) — every unresolved gap has a `Q-{n}` entry in the
    required shape (affected TCs, gap, why, evidence, recommendation + reason, alternatives,
    pending, status); no recommendation was acted on before its answer; the TCs that depend on an
    open question are listed under Unclear requirements against the `Q-{n}`; the same questions
    appear in the final message.
16. **Technique coverage** (`tc-design.md` "Test-design techniques") — every spec-stated input
    with valid / invalid classes has one TC per relevant Equivalence Partition (valid and
    invalid); every spec-stated numeric / length / date / count limit has its BVA set (below / at
    / above each stated boundary, including maximum-only and minimum-only limits, a side omitted
    only with the reason) or a `Q-{n}`; every multi-condition rule has one TC per decision-table
    rule or a justified N/A; every status lifecycle has all valid transitions and ≥ 1 invalid
    attempt per guarded state; every boundary used is traceable to the spec, steering or the
    learning file — derived neighbour values are fine, a boundary nobody stated is not.
17. **Error guessing** (`tc-design.md` "Error-guessing checklist") — every E1–E6 item that
    **applies** to a flow is either a requirement-backed TC or a `Q-{n}` — never skipped.
    "Skipped" in `Patterns applied / skipped` is reserved for items that are not applicable (the
    flow has no such trigger) or explicitly excluded from scope by the user / spec, each with its
    reason; a missing expected behaviour produces a question, not a skip. No E-item TC asserts a
    behaviour (disabled button, redirect, preserved data, retry, request count) the requirement
    does not state; E1 TCs assert the business outcome, not a request count.
18. **Out-of-browser outcomes** (`tc-design.md` "Out-of-browser outcomes") — every
    requirement-defined outcome that leaves the browser (email, SMS / OTP, push, notification
    centre, download, background job) has a complete TC; for each channel the interface was
    resolved task input → learning file `[type: env]` / other `TEST-DATA` files → one question
    (its answer written back as `[type: env]`, "none available" included); an available
    interface is an Environment row the step references, and `[HUMAN]` prefixes only the steps
    no authorized interface can perform; no TC was dropped, marked N/A or forced to
    `Automation Candidate: NO` because of a tool limit; every `[HUMAN]` TC has its
    `Human-observed step` row.

Anything you cannot fix yourself (spec ambiguity, missing fixture, unclear requirement) is listed
under **Open Findings for the Human Reviewer** — never silently resolved. Header counts you
write must equal the tables: the renderer (`html-page.md`) recomputes them and reports a
`MISMATCH` otherwise.
