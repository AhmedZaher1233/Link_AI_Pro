# Test Cases — kpi-filter
**Status:** PENDING HUMAN REVIEW
**Scope:** Filtering the KPI details grid by display type and year.
**Generated:** 2026-09-20
**Review page language:** English — see TC-REVIEW-kpi-filter.html
**Entry case:** fresh design
**Implementation status:** Partially implemented — entry point seen live on staging; AC-3 (export) absent
**Requirement IDs covered:** REQ-1234-01, REQ-1234-02, REQ-1234-03
**Total test cases:** 5 (2/1/2, per locale)
**Run-stage mapping:** happy-path + edge-case → @positive · rejection/guard assertions → @negative
**Patterns applied / skipped:** P1 reveal first, P2 async wait, P3 explicit trigger; P4 skipped (no tab state)
**MCP validation:** 1 validated / 0 enhanced / 1 inferred / 1 discrepancy / 1 not-implemented / 1 draft — by 3b on 2026-09-25, env staging, scope full
**App validation progress:** 2/5 TCs observed live (40%)
**Smoke TCs:** 1
**Automation candidates:** 4
**Requirement coverage (weighted):** 66.7% — Full 1 / Partial 2 / None 0 of 3 acceptance criteria
**Manual-only scenarios:** 1 (High 1 · Medium 0 · Low 0)
**Tag convention:** —

## Summary
| ID | Type | Locale | Requirement | Stage | Smoke | Automation Candidate | Data effect | Shared data | Tags | Validation | Description |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-KPI-01 | happy-path | en | REQ-1234-01 | @positive | YES | YES | read-only | — | uat, regression | validated | Filter the KPI grid by year |
| TC-KPI-01b | happy-path | ar | REQ-1234-01 | @positive | NO | YES | read-only | — | — | inferred | Filter the KPI grid by year (Arabic) |
| TC-KPI-02 | edge-case | en | REQ-1234-02 | @positive | NO | YES | read-only | — | — | discrepancy | Clear the filter restores all rows |
| TC-KPI-03 | negative | en | REQ-1234-02 | @negative | NO | YES | read-only | — | — | draft — not app-validated | Apply without a selected year is blocked |
| TC-KPI-04 | happy-path | en | REQ-1234-03 | @positive | NO | NO | creates | KPI export file | — | not-implemented — pending implementation | Export the filtered grid |

## Test Cases

### TC-KPI-01 — Filter the KPI grid by year
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-1234-01
- **Stage:** @positive
- **Preconditions:**
  1. Logged in as Administrator [A1] on the portal [E1]; page language English.
  2. Strategy "Growth 2026" exists with KPI "Revenue" holding 12 monthly values.
- **Steps:**
  1. Open Strategies — the Strategies list is visible.
  2. Open the strategy "Growth 2026" — the strategy header shows its name.
  3. Open KPI Details for "Revenue" — the KPI grid loads; loading indicator on the grid appears then clears.
  4. Open the Filter panel — the panel expands and shows "Display Type" and "Year".
  5. Set Display Type to "Year" and select 2026.
  6. Click Apply — loading appears on the grid, then clears.
- **Expected Result:** The grid shows exactly 12 rows for 2026 and the Year chip reads "2026".
- **Data Oracle:** KPI "Revenue" 2026 [D1] — expected count: 12, identifiers: Jan…Dec
- **Smoke:** YES
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** uat, regression
- **Validation:** validated
<!-- tc-evidence
validated-on: 2026-09-25
env: staging
build: 4.12.0
scope: full-tail
content-sha256: 3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855a
req-sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
open-questions: —
checked-in-run: 2026-09-25
-->

### TC-KPI-01b — Filter the KPI grid by year (Arabic)
- **Type:** happy-path
- **Locale:** ar
- **Requirement:** REQ-1234-01
- **Stage:** @positive
- **Preconditions:**
  1. Logged in as Administrator [A1] on the portal [E1]; page language Arabic, direction right-to-left.
- **Steps:**
  1. Confirm the page is Arabic and right-to-left.
  2. Open الاستراتيجيات — the list is visible.
  3. Open the strategy "Growth 2026" and then تفاصيل المؤشر for "Revenue".
  4. Open the filter panel (تصفية) — it opens from the opposite side.
  5. Set نوع العرض to "سنة" and select 2026, then click تطبيق.
- **Expected Result:** The grid shows 12 rows for 2026 with Arabic month names.
- **Data Oracle:** KPI "Revenue" 2026 [D1] — expected count: 12
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** inferred
<!-- tc-evidence
validated-on: 2026-09-25
env: staging
build: 4.12.0
scope: prefix-only
content-sha256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
req-sha256: 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae
open-questions: —
checked-in-run: 2026-09-25
-->

### TC-KPI-02 — Clear the filter restores all rows
- **Type:** edge-case
- **Locale:** en
- **Requirement:** REQ-1234-02
- **Stage:** @positive
- **Preconditions:**
  1. TC-KPI-01 state: the grid is filtered to 2026.
- **Steps:**
  1. Click Clear in the Filter panel — the Year chip disappears.
  2. Click Apply — loading appears on the grid, then clears.
- **Expected Result:** The grid shows all 36 rows across 2024-2026.
- **Data Oracle:** KPI "Revenue" all years [D2] — expected count: 36
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** discrepancy
<!-- tc-evidence
validated-on: 2026-09-25
env: staging
build: 4.12.0
scope: full-tail
content-sha256: 5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9
req-sha256: 6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b
open-questions: —
checked-in-run: 2026-09-25
-->

### TC-KPI-03 — Apply without a selected year is blocked
- **Type:** negative
- **Locale:** en
- **Requirement:** REQ-1234-02
- **Stage:** @negative
- **Preconditions:**
  1. Logged in as Administrator [A1]; KPI Details open for "Revenue".
- **Steps:**
  1. Open the Filter panel and set Display Type to "Year" without selecting a year.
  2. Click Apply.
- **Expected Result:** A validation message "Select a year" appears under the Year field and the grid does not reload.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-KPI-04 — Export the filtered grid
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-1234-03
- **Stage:** @positive
- **Preconditions:**
  1. TC-KPI-01 state: the grid is filtered to 2026.
- **Steps:**
  1. Click Export — a file download starts.
  2. [HUMAN] Open the downloaded file in a spreadsheet application and confirm it holds the 12 monthly rows [D1].
- **Expected Result:** An Excel file with 12 rows is downloaded.
- **Data Oracle:** KPI "Revenue" 2026 [D1] — expected count: 12
- **Smoke:** NO
- **Automation Candidate:** NO
- **Data effect:** creates
- **Shared data:** KPI export file
- **Tags:** —
- **Validation:** not-implemented — pending implementation

## Enhancement Log
| TC-ID | Validation | What changed | Why (what the app showed) | Run |
|---|---|---|---|---|
| TC-KPI-01 | validated | Step 4 label "Filters" → "Filter panel" | The panel header reads "Filter panel" | 2026-09-25 |
| TC-KPI-02 | discrepancy | none — finding recorded as PB-1 | Clear left the Year chip in place | 2026-09-25 |

## Traceability Matrix
| Acceptance criterion | REQ-ID | TC-IDs | Status | Missing |
|---|---|---|---|---|
| AC-1 Filter by year | REQ-1234-01 | TC-KPI-01, TC-KPI-01b | Fully Covered | — |
| AC-2 Clear and guard | REQ-1234-02 | TC-KPI-02, TC-KPI-03 | Partially Covered | Arabic variant |
| AC-3 Export | REQ-1234-03 | TC-KPI-04 | Partially Covered | negative case, Arabic variant |

## Negative Coverage
| L1 §4 category | Covered by | Status |
|---|---|---|
| Missing required inputs | TC-KPI-03 | COVERED |
| Unauthorized access | — | N/A — no role guard on this screen |

## Standards Alignment
| L2 item | Status | TC-IDs |
|---|---|---|
| Loading indicator asserted in two steps | COVERED | TC-KPI-01 |

## Requirement Coverage Score
| AC | REQ-ID | TC-IDs | Status | What is missing |
|---|---|---|---|---|
| AC-1 Filter by year | REQ-1234-01 | TC-KPI-01, TC-KPI-01b | Fully Covered | — |
| AC-2 Clear and guard | REQ-1234-02 | TC-KPI-02, TC-KPI-03 | Partially Covered | Arabic variant |
| AC-3 Export | REQ-1234-03 | TC-KPI-04 | Partially Covered | negative case, Arabic variant |

## Manual-Only Scenarios
| Category | TC-ID | Scenario | Why manual | Priority |
|---|---|---|---|---|
| Pending implementation | TC-KPI-04 | Export the filtered grid | Feature not built yet | High |

## Potential Bugs

### PB-1 — Clear does not remove the Year chip
- **Test case:** TC-KPI-02
- **Steps to reproduce:**
  1. Filter the KPI grid to 2026 (TC-KPI-01).
  2. Click Clear in the Filter panel.
  3. Click Apply.
- **Expected result:** The grid shows all 36 rows across 2024-2026.
- **Actual result:** The Year chip "2026" stays and the grid still shows 12 rows.
<!-- pb-meta: first-seen: 2026-09-25; last-checked: 2026-09-25; env: staging; build: 4.12.0; status: open -->

## Open Questions

### Q-1 — Which roles may export?
- **Affected TCs:** TC-KPI-04
- **Gap:** The requirement does not say which roles see the Export button.
- **Why it matters:** Decides whether a permission negative case is needed.
- **Evidence:** REQ-1234-03 names no role; learning file has no entry for export permissions.
- **Recommended:** Administrator only — matches the other KPI actions (similar module: Objectives export).
- **Alternatives:** All roles with read access.
- **Pending:** TC-KPI-04 stays not-implemented; no permission TC designed until answered.
- **Status:** open

## Open Findings for the Human Reviewer
### Requirement / coverage gaps
- AC-2 has no Arabic variant — add TC-KPI-02b / TC-KPI-03b via skill 3 --revision.
### Application defects (discrepancies)
- TC-KPI-02 — see PB-1.
### Pending implementation
- TC-KPI-04 — Export is not built yet on staging (AC-3).
### Environment blockers
- None
### Unclear requirements
- Q-1 — export permissions.
