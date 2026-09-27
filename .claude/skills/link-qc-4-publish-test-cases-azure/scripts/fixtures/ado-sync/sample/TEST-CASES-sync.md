# Test Cases — sync
**Status:** APPROVED
**Scope:** Products list — search, add and the order notification.
**Generated:** 2026-09-27
**Review page language:** English — see TC-REVIEW-sync.html
**Entry case:** fresh design
**Implementation status:** Implemented
**Requirement IDs covered:** REQ-4321-01, REQ-4321-02, REQ-4321-03
**Total test cases:** 4 (4/0/0, per locale)
**Run-stage mapping:** happy-path + edge-case → @positive · rejection/guard assertions → @negative
**Smoke TCs:** 1
**Automation candidates:** 2
**Requirement coverage (weighted):** 100% — Full 3 / Partial 0 / None 0 of 3 acceptance criteria
**Manual-only scenarios:** 1 (High 0 · Medium 1 · Low 0)
**Tag convention:** —

## Summary
| ID | Type | Locale | Requirement | Stage | Smoke | Automation Candidate | Data effect | Shared data | Tags | Validation | Description |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TC-SYNC-01 | happy-path | en | REQ-4321-01 | @positive | YES | YES | read-only | — | — | draft — not app-validated | Search the product list by name |
| TC-SYNC-02 | negative | en | REQ-4321-02 | @negative | NO | NO | read-only | Product list with 3 items [D2] | regression | draft — not app-validated | A Viewer cannot add a product |
| TC-SYNC-03 | happy-path | en | REQ-4321-03 | @positive | NO | YES | creates | — | — | draft — not app-validated (human step pending) | Placing an order sends the confirmation SMS |
| TC-SYNC-04 | edge-case | en | REQ-4321-01 | @positive | NO | — | read-only | — | — | draft — not app-validated | Search with a name that matches nothing |

## Test Cases

### TC-SYNC-01 — Search the product list by name
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-4321-01
- **Stage:** @positive
- **Preconditions:**
  1. Login as Administrator [A1] on the portal [E1]; page language English.
  2. Product "Sample" [D1] exists.
- **Steps:**
  1. Open Products — the Products list is visible.
  2. Enter "Sample" in the "Search" field.
  3. Click "Search" — the list reloads.
- **Expected Result:** The list shows exactly 1 row and the name cell reads "Sample".
- **Data Oracle:** Product "Sample" [D1] — expected count: 1
- **Smoke:** YES
- **Automation Candidate:** YES
- **Data effect:** read-only
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated

### TC-SYNC-02 — A Viewer cannot add a product
- **Type:** negative
- **Locale:** en
- **Requirement:** REQ-4321-02
- **Stage:** @negative
- **Preconditions:**
  1. Login as Viewer [A2] on the portal [E1].
  2. Product list with 3 items [D2] exists.
- **Steps:**
  1. Open Products — the Products list shows 3 rows.
  2. Click "Add product".
- **Expected Result:** The message "You do not have permission to add products" appears and no form opens.
- **Data Oracle:** Product list with 3 items [D2] — expected count: 3
- **Smoke:** NO
- **Automation Candidate:** NO
- **Data effect:** read-only
- **Shared data:** Product list with 3 items [D2]
- **Tags:** regression
- **Validation:** draft — not app-validated

### TC-SYNC-03 — Placing an order sends the confirmation SMS
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-4321-03
- **Stage:** @positive
- **Preconditions:**
  1. Login as Administrator [A1] on the portal [E1].
  2. Product "Sample" [D1] exists.
- **Steps:**
  1. Open Products and open the product "Sample".
  2. Click "Order now" — the confirmation page appears.
  3. Open the mail sandbox [E2] — the order confirmation mail is listed.
  4. [HUMAN] Read the confirmation SMS on the test phone of the Administrator [A1] and compare the order number with the confirmation page.
- **Expected Result:** The confirmation page, the mail and the SMS carry the same order number.
- **Data Oracle:** —
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** creates
- **Shared data:** —
- **Tags:** —
- **Validation:** draft — not app-validated (human step pending)

### TC-SYNC-04 — Search with a name that matches nothing
- **Type:** edge-case
- **Locale:** en
- **Requirement:** REQ-4321-01
- **Stage:** @positive
- **Preconditions:**
  1. Login as Administrator [A1] on the portal [E1].
  2. Product "Sample" [D1] exists.
- **Steps:**
  1. Open Products.
  2. Enter "zzz-no-such-product" in the "Search" field and click "Search".
- **Expected Result:** The list is empty and the text "No products found" is shown.
- **Data Oracle:** —
- **Smoke:** NO
- **Data effect:** read-only
- **Shared data:** —
- **Validation:** draft — not app-validated
