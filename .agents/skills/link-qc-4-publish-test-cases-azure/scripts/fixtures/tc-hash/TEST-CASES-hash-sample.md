# Test Cases — hash-sample
**Status:** APPROVED
**Scope:** One test case for the canonical-hash harness. Skills 4 and 5 assert the same golden hash on this pair of files.
**Generated:** 2026-09-27
**Review page language:** English — see TC-REVIEW-hash-sample.html
**Total test cases:** 1
**Smoke TCs:** 1
**Automation candidates:** 1
**Manual-only scenarios:** 0
**Tag convention:** regression

## Summary
| ID | Type | Locale | Requirement | Stage | Smoke | Automation Candidate | Data effect | Shared data | Tags | Validation | Description |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-HASH-01 | happy-path | en | REQ-9001-01 | @positive | YES | YES | read-only | — | regression | draft — not app-validated | Filter the product list by category |

## Test Cases

### TC-HASH-01 — Filter the product list by category
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-9001-01
- **Stage:** @positive
- **Preconditions:**
  1. Logged in as Administrator [A1]; page language English.
  2. Price list "Sample" [D1] exists with 12 products in the category "Hardware".
- **Steps:**
  1. Open the portal [E1] — the home page is visible.
  2. Open Products — the product list shows every product.
  3. Type "Hardware  2026" in the "Search" field and press Enter — the list reloads.
- **Expected Result:** The list shows exactly 12 rows and the message "12 products found" is displayed.
- **Data Oracle:** price list "Sample" [D1] — expected count: 12
- **Smoke:** YES
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** regression
- **Validation:** draft — not app-validated
<!-- tc-evidence
validated-on: —
env: —
build: —
scope: —
content-sha256: —
req-sha256: —
open-questions: —
checked-in-run: —
-->
