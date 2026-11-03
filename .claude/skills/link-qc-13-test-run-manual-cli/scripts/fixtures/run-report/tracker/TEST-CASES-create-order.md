# Test Cases — create-order
**Status:** APPROVED

## Summary
| ID | Type | Locale | Requirement | Stage | Smoke | Automation Candidate | Data effect | Shared data | Validation | Description |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-001 | happy-path | en | REQ-01 | @positive | YES | YES | creates | — | draft — not app-validated | Create an order with valid data |
| TC-007 | edge-case | en | REQ-02 | @positive | NO | YES | modifies | — | draft — not app-validated | Order total recalculates |
| TC-010 | happy-path | en | REQ-03 | @positive | NO | YES | deletes | orders | draft — not app-validated | Delete a draft order |
| TC-020 | negative | en | REQ-04 | @negative | NO | YES | read-only | — | draft — not app-validated | Reject an order without a customer |
| TC-030 | happy-path | en | REQ-05 | @positive | NO | YES | modifies | — | draft — not app-validated | Confirm the order by the code sent by SMS |
| TC-040 | happy-path | en | REQ-06 | @positive | NO | NO | read-only | — | draft — not app-validated | Print the order confirmation |
| TC-041 | edge-case | en | REQ-07 | @positive | NO | NO | modifies | — | draft — not app-validated | Cancel an order after approval |
