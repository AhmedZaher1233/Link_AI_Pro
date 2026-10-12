# Bug Report — create-order

**User Story:** US-1234 — Create order
**Feature:** create-order
**Spec:** —
**Source document:** ../../../Manual_Test/TestCases/US-1234-create-order/TEST-CASES-create-order.md
**Latest phase:** 2
**Bugs:** 1 open · 1 resolved · 0 not checked this run of 2
**Run report:** TEST-RUN-REPORT-create-order.md

## Bugs

### BUG-1 — The system doesn't remove a draft order when the user confirms Delete
- **TC-ID:** TC-010
- **Requirement:** REQ-03
- **Severity:** High
- **Environment:** UAT
- **Browser:** chromium
- **Language:** en
- **Build:** 4.12.0
- **Found in phase:** 1
- **Status:** resolved (phase 2)
- **Root cause:** DELETE /orders/{id} answers 200 but the grid keeps the row until a manual refresh
- **Steps to reproduce:**
  1. Log in as the sales user.
  2. Open Orders and create a draft order.
  3. Click Delete on that row and confirm the dialog.
- **Expected:** The row disappears and the toast "Order deleted" is shown.
- **Actual:** The row stays in the list and no toast is shown.
- **Screenshot:** [attempt-1-failed.png](../../screenshots/US-1234-create-order/phase-1/TC-010/chromium--none--r0/attempt-1-failed.png)
- **Evidence:** expect(orderRow).toHaveCount(0) — received 1
- **History:**
  - phase 1 — FAIL: first seen on build 4.12.0
  - phase 2 — PASS: retest passed on build 4.12.1

### BUG-2 — The system doesn't recalculate the order total when the user edits the quantity of variation B
- **TC-ID:** TC-007
- **Requirement:** REQ-02
- **Severity:** Medium
- **Environment:** UAT
- **Browser:** chromium
- **Language:** en
- **Build:** 4.12.1
- **Found in phase:** 2
- **Status:** open
- **Root cause:** not yet known — the recalculation request is not sent for the second line
- **Steps to reproduce:**
  1. Log in as the sales user.
  2. Open an order that has two lines.
  3. Change the quantity of the second line and leave the field.
- **Expected:** The total updates to the sum of both line totals.
- **Actual:** The total keeps the previous value.
- **Screenshot:** none captured
- **Evidence:** observed manually while investigating the INCOMPLETE variant — not asserted by automation yet
- **History:**
  - phase 2 — FAIL: first seen while variation B was being investigated
