# Test Data — hash-sample
**Story:** US-9001 · **TC document:** TEST-CASES-hash-sample.md (2026-09-27) · **Environment:** staging
**Data items:** 1 — ready 1 · missing 0 · impossible 0 · unknown 0
**Accounts needed:** 1 roles — 1 confirmed · 0 unknown

## 0. Environment
| ID | What | Value | Status |
|---|---|---|---|
| E1 | application base URL | https://portal.example.test | READY |
| E2 | mail sandbox (reads notification mail) | https://mail.example.test | READY |

## 1. Accounts
| ID | Role | Username | Status | Used by TCs | Note |
|---|---|---|---|---|---|
| A1 | Administrator | admin.user | READY | TC-HASH-01 | used for login in every TC |

## 2. Test data at a glance
| # | Data item (plain name) | Must look like | Used by TCs | Status | Best way to get it |
|---|---|---|---|---|---|
| D1 | Price list "Sample" with 12 products | 12 rows, category "Hardware" | TC-HASH-01 | READY | — |

## 3. Data item details
### D1 — Price list "Sample" with 12 products
- **What it is:** the list the filter TC reads.
- **Exact values needed:** 12 products in the category "Hardware".
- **Used by:** TC-HASH-01
- **Where I checked:** listing screen "Products" seen live
- **Status:** READY — seen on staging 2026-09-27
- **Shared with other TCs:** no
