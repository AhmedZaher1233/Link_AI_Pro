# TC Status Tracker — create-order

**User Story:** US-1234 — Create order
**Last updated:** 2026-09-22 09:30
**Azure DevOps:** https://devops.example.com/ExampleCollection/ExampleProject
**Sources:** TEST-CASES-create-order.md · TEST-RUN-REPORT-create-order.md · ADO-BUG-MAP.md

## Summary

| Measure | Count |
|---|---|
| Test cases | 7 |
| Covered by automation | 5 |
| Pass | 2 |
| Fail | 1 |
| Skipped | 1 |
| Not tested | 3 |
| Open bugs | 1 |

## Test cases

| TC-ID | Title | Covered | Reason not covered | State | Related bug(s) | Bug Azure state | Next action |
|---|---|---|---|---|---|---|---|
| TC-001 | Create an order with valid data | Yes | — | Pass | — | — | — |
| TC-007 | Order total recalculates | Yes | — | Fail | BUG-2 (#100512) | Active | Retest variation B after the fix is deployed |
| TC-010 | Delete a draft order | Yes | — | Pass | BUG-1 (#100511) | Closed | — |
| TC-020 | Reject an order without a customer | Yes | — | Skipped | — | — | Create the customer fixture and rerun |
| TC-030 | Confirm the order by the code sent by SMS | Yes | — | Not tested | — | — | A person enters the SMS code (step 4) |
| TC-040 | Print the order confirmation | No | The print dialog is outside the browser | Not tested | — | — | Run by hand on the next regression cycle |
| TC-041 | Cancel an order after approval | No | Approval workflow not deployed on UAT | Not tested | — | — | Wait for the approval build |

## Bug index

| Bug | Azure ID | Title | Azure state | TCs |
|---|---|---|---|---|
| BUG-1 | 100511 | The system doesn't remove a draft order when the user confirms Delete | Closed | TC-010 |
| BUG-2 | 100512 | The system doesn't recalculate the order total when the user edits the quantity of variation B | Active | TC-007 |
