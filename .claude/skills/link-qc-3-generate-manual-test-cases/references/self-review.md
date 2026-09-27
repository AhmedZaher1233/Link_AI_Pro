# Built-in self-review — load at the self-review (workflow step 9)

You are your own first reviewer. Run every check below, FIX your own findings in place, and
include the completed tables in the deliverable. There is no separate reviewer agent — the next
gate is the human.

1. **Traceability matrix** — every acceptance criterion ↔ REQ-ID ↔ covering TC-IDs. Any AC with
   no TC → coverage gap: fix it (add the TC) before delivering. Every TC must cite a REQ-ID that
   exists verbatim in the requirements source.
2. **Negative coverage table** — all L1 §4 categories present or justified N/A.
3. **Standards alignment** — map the set against the functional checklist in the L2 standards
   document (`{qa_standards}` → `steering.L2`): COVERED / GAP / N/A per item, with TC-IDs.
4. **Requirement coverage score** — the traceability matrix is binary (an AC has a TC or not);
   this score shows the *depth* it hides. Classify every acceptance criterion:

   | Status | Weight | The AC is… |
   |---|---|---|
   | **Fully Covered** | 1.0 | ≥1 happy-path TC **and** every L1 §4 negative category that applies to it **and** every `required_locales` variant present — all with observable expected results and, where data is asserted, a Data Oracle |
   | **Partially Covered** | 0.5 | Has TCs, but misses one of: a negative category that applies, a locale variant, a required Data Oracle — or its only TCs are `not-implemented — pending implementation` / `draft — not app-validated` |
   | **Not Covered** | 0.0 | No TC cites the AC (item 1 already forces a fix before delivering; the score only makes a reviewer-waived gap visible) |

   `weighted % = (full × 1.0 + partial × 0.5) / total ACs × 100` (one decimal). Report a per-AC
   table (AC · REQ-ID · TC-IDs · status · what is missing) and the overall number with Full /
   Partial / None counts. The score never replaces item 1 — every AC at 0.0 is still fixed
   first; Partial rows are fixed where you can and otherwise listed under Open Findings with the
   missing piece named.
5. **Manual-only scenarios** — every TC with `Automation Candidate = NO` (plus `not-implemented`
   TCs the reviewer will run by hand once the story ships) gets one row:
   `Category · TC-ID · Scenario · Why manual · Priority`. Categories: `Permission /
   Unauthorized`, `Empty State`, `System / Background-Job Triggered`, `Display / Field
   Presence`, `Cross-Role Specific`, `Per-Row Enumeration & Identity`, `Visual / UX judgement`,
   `Data setup not reproducible`, `Pending implementation`. Priority: **High** = security /
   permission, empty state, pending implementation; **Medium** = background jobs, field display,
   cross-role; **Low** = redundant per-row enumeration. This is the list skill 6 later confirms
   against the real specs — keep the wording plain English.
6. **Independence** — every TC runnable in isolation; all preconditions explicit; no TC assumes
   state from another TC.
7. **Redundancy** — merge or remove TCs that cover identical scenarios under different names.
8. **Observability** — every expected result maps to an observable outcome (visible / text /
   count / url). "Works correctly" is not assertable: rewrite.
9. **Step quality** — every step carries the 4 handoff fields; loading-indicator assertions are
   two steps; no generic steps; every TC reads as a complete user journey (no "apply the required
   filter"-style vagueness).
10. **Validation honesty** — no TC marked `validated` whose unique tail was not observed; every
    `inferred` TC names what prior knowledge it relied on; no not-implemented functionality
    marked as validated or as a defect.
11. **Gap-vs-defect separation** — requirement/coverage gaps, application defects
    (discrepancies), and pending-implementation items appear in three distinct lists — never
    mixed.
12. **Secrets and code** — no password, token, selector, attribute name, code snippet or file
    identifier anywhere in any deliverable (TC document, test-data file, HTML page). Usernames
    and role names only.
13. **Case 1 only** — the Existing-TC Analysis table accounts for every original TC exactly once
    (kept / updated / merged / removed).
14. **Test-data consistency** (`TEST-DATA-{feature}.md`, `deliverables.md` §2b) — every
    `Preconditions` / `Data Oracle` / `Shared data` sentence and every role used maps to a data
    item, and every data item maps back to real TC-IDs; every `MISSING` / `IMPOSSIBLE` item has
    at least one **available** way or a row in the Problems table; no item is `MISSING` without
    a recorded check (unchecked = `UNKNOWN`); no `api` / `db` way is shown as available without
    confirmation from the learning file or the user; the header counts equal the table rows;
    "shared" means the TCs use the same data item, with execution order stated only for a real
    dependency; no locator, endpoint path, table / column name, code identifier or secret
    anywhere in the file.

Anything you cannot fix yourself (spec ambiguity, missing fixture, discrepancy) is listed under
**Open Findings for the Human Reviewer** — never silently resolved.
