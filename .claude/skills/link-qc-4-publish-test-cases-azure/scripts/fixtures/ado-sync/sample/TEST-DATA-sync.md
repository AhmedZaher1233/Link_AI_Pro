# Test Data — sync
**Story:** US-4321 · **TC document:** TEST-CASES-sync.md (2026-09-27) · **Environment:** staging checked 2026-09-27
**Data items:** 2 — ready 2 · missing 0 · impossible 0 · unknown 0
**Accounts needed:** 2 roles — 2 confirmed · 0 unknown

## 0. Environment
| ID | What | Value | Status |
|---|---|---|---|
| E1 | application base URL | https://portal.example.com | READY |
| E2 | mail sandbox (reads OTP / notification mail) | https://mail.example.com | READY |

## 1. Accounts
| ID | Role | Username | Status | Used by TCs | Note |
|---|---|---|---|---|---|
| A1 | Administrator | admin.user | READY | TC-SYNC-01, TC-SYNC-02, TC-SYNC-03, TC-SYNC-04 | used for login in every TC |
| A2 | Viewer | viewer.user | READY | TC-SYNC-02 | read-only role |

## 2. Test data at a glance
| # | Data item (plain name) | Must look like | Used by TCs | Status | Best way to get it |
|---|---|---|---|---|---|
| D1 | Product "Sample" | active, price 10.00 | TC-SYNC-01, TC-SYNC-04 | READY | — |
| D2 | Product list with 3 items | 3 rows | TC-SYNC-02 | READY | — |

## 3. Data item details
### D1 — Product "Sample"
- **What it is:** the product the search TCs look for.
- **Exact values needed:** name "Sample", active, price 10.00.
- **Used by:** TC-SYNC-01, TC-SYNC-04
- **Where I checked:** listing screen "Products" seen live
- **Status:** READY — seen on staging 2026-09-27
- **Shared with other TCs:** yes — TC-SYNC-01 and TC-SYNC-04 use the same data item

## 4. Problems — data that cannot be created or is unclear
(none)

## 5. How to prepare the missing data
(none — no MISSING items)

## 6. Open questions for the QC / PO
1. None
