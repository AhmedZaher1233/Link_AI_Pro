# Test Cases — orders
**Status:** APPROVED
**Scope:** Two test cases for the compliance-check harness (selftest-check.mjs).

## Test Cases

### TC-01 — Create an order and see it in the list
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-001
- **Stage:** @positive
- **Preconditions:**
  1. Logged in as Administrator [A1].
- **Steps:**
  1. Open the portal [E1] — the home page is visible.
  2. Open Orders and create the order "Alpha" — the list reloads.
- **Expected Result:** The list shows the order "Alpha".
- **Smoke:** YES
- **Automation Candidate:** YES
- **Data effect:** creates
- **Shared data:** —

### TC-02 — See the save confirmation
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-001
- **Stage:** @positive
- **Preconditions:**
  1. Logged in as Administrator [A1].
- **Steps:**
  1. Open the portal [E1] — the home page is visible.
  2. Open Orders and create the order "Beta" — the list reloads.
- **Expected Result:** The confirmation "Saved" is displayed.
- **Smoke:** NO
- **Automation Candidate:** YES
- **Data effect:** creates
- **Shared data:** —
