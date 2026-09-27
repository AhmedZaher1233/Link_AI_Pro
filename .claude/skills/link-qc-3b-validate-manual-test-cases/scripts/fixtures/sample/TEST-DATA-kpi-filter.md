# Test Data — kpi-filter
**Story:** US-1234 · **TC document:** TEST-CASES-kpi-filter.md (2026-09-20) · **Environment:** staging checked 2026-09-25
**Data items:** 3 — ready 2 · missing 0 · impossible 0 · unknown 1
**Accounts needed:** 1 roles — 1 confirmed · 0 unknown
**Environment items:** 1 — ready 1 · unknown 0

## 0. Environment
| ID | What | Value | Status |
|---|---|---|---|
| E1 | application base URL (portal) | https://portal.example.test | READY |

## 1. Accounts
| ID | Role | Username | Status | Used by TCs | Note |
|---|---|---|---|---|---|
| A1 | Administrator | admin.user | READY | TC-KPI-01, TC-KPI-01b, TC-KPI-02, TC-KPI-03, TC-KPI-04 | used for login in every TC |

## 2. Test data at a glance
| # | Data item (plain name) | Must look like | Used by TCs | Status | Best way to get it |
|---|---|---|---|---|---|
| D1 | KPI "Revenue" with 12 monthly values for 2026 | 12 rows, Jan…Dec, strategy "Growth 2026" | TC-KPI-01, TC-KPI-01b, TC-KPI-04 | READY | — |
| D2 | KPI "Revenue" values for 2024-2026 | 36 rows | TC-KPI-02 | READY | — |
| D3 | An exported KPI file | Excel, 12 rows | TC-KPI-04 | UNKNOWN | to check — pending implementation |

## 3. Data item details
### D1 — KPI "Revenue" with 12 monthly values for 2026
- **What it is:** the KPI the filter TCs read.
- **Exact values needed:** 12 monthly values, 2026.
- **Used by:** TC-KPI-01, TC-KPI-01b, TC-KPI-04
- **Where I checked:** listing screen "KPI Details" seen live
- **Status:** READY — seen on staging 2026-09-25
- **Shared with other TCs:** yes — TC-KPI-01 and TC-KPI-01b use the same data item

## 4. Problems — data that cannot be created or is unclear
| # | Data item | Problem | Why | What the QC / PO must decide |
|---|---|---|---|---|
| 1 | D3 | Export is not built yet | AC-3 pending implementation | accept UNKNOWN until the story ships |

## 5. How to prepare the missing data
(none — no MISSING items)

## 6. Open questions for the QC / PO
1. None
