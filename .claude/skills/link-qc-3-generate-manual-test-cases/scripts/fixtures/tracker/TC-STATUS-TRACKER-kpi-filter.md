# TC Status Tracker — kpi-filter

**User Story:** US-1234 — KPI filter
**Last updated:** 2026-10-14 16:20
**Azure DevOps:** https://devops.example.com/ExampleCollection/ExampleProject
**Sources:** TEST-CASES-kpi-filter.md · ADO-MAP.md · ADO-BUG-MAP.md

## Summary

| Measure | Count |
|---|---|
| Test cases | 5 |
| Covered | 4 |
| Pass | 2 |
| Fail | 1 |
| Skipped | 1 |
| Not tested | 1 |
| Open bugs | 1 |

## Test cases

| TC-ID | Title | Covered | Reason not covered | State | Related bug(s) | Bug Azure state | Next action |
|---|---|---|---|---|---|---|---|
| TC-KPI-01 | Filter the KPI grid by year | Yes | — | Pass | — | — | — |
| TC-KPI-01b | Filter the KPI grid by year (Arabic) | Yes | — | Pass | — | — | — |
| TC-KPI-02 | Clear the filter restores all rows | Yes | — | Fail | BUG-1 (#100231) | Active | Retest after the fix is deployed |
| TC-KPI-03 | Apply without a selected year is blocked | Yes | — | Skipped | — | — | Prepare data D3 and rerun |
| TC-KPI-04 | Export the filtered grid | No | Export is not implemented yet (AC-3) | Not tested | — | — | Wait for AC-3 |

## Bug index

| Bug | Azure ID | Title | Azure state | TCs |
|---|---|---|---|---|
| BUG-1 | 100231 | The system doesn't restore all rows when the filter is cleared | Active | TC-KPI-02 |
