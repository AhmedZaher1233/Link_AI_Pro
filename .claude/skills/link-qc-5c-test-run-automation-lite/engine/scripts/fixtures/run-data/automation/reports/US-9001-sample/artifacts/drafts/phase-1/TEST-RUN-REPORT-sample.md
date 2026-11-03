# Test Run Report — sample

**User Story:** US-9001 — Sample orders
**Feature:** sample
**Spec:** —
**Source document:** ../../../Manual_Test/TestCases/US-9001-sample/TEST-CASES-sample.md
**Source revision:** 0a1b2c3d4e5f
**Environment:** QA
**Latest phase:** 1
**Latest run:** 2026-10-01 09:00
**Status:** INCOMPLETE
**Latest results:** 3 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run of 5 TCs
**Compliance:** Checkpoint A PASS (snap-a) · Checkpoint B pending — see gate record
**Azure DevOps:** local
**Bug report:** BUG-REPORT-sample.md
**Run file:** .runs/phase-1.json
**Screenshots:** ../../screenshots/US-9001-sample/phase-1/
**Progress log:** ../../automation-logs/US-9001-sample/run-progress-2026-10-01-0900.log
**Earlier phases:** —

## Run history

| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run | Total | Duration | Bugs |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-01 | INCOMPLETE | 3 | 0 | 1 | 1 | 0 | 5 | 00:22:00 | — |

## Phase 1 — 2026-10-01

### Run
- **Outcome:** INCOMPLETE
- **Environment:** QA
- **Build:** 1.0.0
- **Headed / workers:** yes / parallel ×2, serial ×1
- **Timeouts:** test 90 s · step 30 s · action 15 s · navigation 30 s · expect 10 s — 0 calibrated · 0 watchdog events
- **Started:** 2026-10-01 09:00
- **Duration:** 00:22:00 (planned ~00:03:20 · serial-only ~00:05:00)
- **Run file:** .runs/phase-1.json
- **Progress log:** ../../automation-logs/US-9001-sample/run-progress-2026-10-01-0900.log
- **Screenshots:** ../../screenshots/US-9001-sample/phase-1/
- **Compliance:** Checkpoint A PASS (snap-a) · Checkpoint B pending — see gate record
- **Azure DevOps:** local
- **Previous phase:** none
- **Re-run:** 1 TC (1 impacted · 0 no verdict · 0 added), 1 burn-in, 1 heal iteration(s)
- **Isolation checks:** 1 failed beside others → 1 passed alone (interference) · 0 confirmed · 0 rate_limited
- **Rate limits:** none seen
- **Acceptance:** NOT ACCEPTED — unexplained first-attempt regression: TC-002 (failed beside other tests, passed alone, no evidenced cause)

### Stages
| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run |
|---|---|---|---|---|---|---|
| Smoke | 1 | 1 | 0 | 0 | 0 | 0 |
| Positive | 3 | 2 | 0 | 1 | 0 | 0 |
| Negative | 1 | 0 | 0 | 0 | 1 | 0 |
| Positive (re-run) | 1 | 1 | 0 | 0 | 0 | 0 |
| **Total** | 5 | 3 | 0 | 1 | 1 | 0 |

**Smoke gate:** passed — fail% 0% — no action needed

### Results
| TC-ID | REQ | Name | Status | Group | Duration | Classification | Evidence |
|---|---|---|---|---|---|---|---|
| TC-001 | REQ-01 | Create an order with valid data | PASS | parallel | 00:00:15 | — | [attempt-1.png](../../screenshots/US-9001-sample/phase-1/TC-001/chromium--none--r0/attempt-1.png) |
| TC-002 | REQ-02 | Filter orders by status | PASS | serial:interference | 00:00:20 | — | [attempt-2.png](../../screenshots/US-9001-sample/phase-1/TC-002/chromium--none--r0/attempt-2.png) |
| TC-003 | REQ-03 | Edit the draft order | PASS | serial:orders | 00:00:12 | — | [attempt-1.png](../../screenshots/US-9001-sample/phase-1/TC-003/chromium--none--r2/attempt-1.png) |
| TC-004 | REQ-04 | Reject an order without a customer | SKIP | parallel | — | data_missing | — |
| TC-005 | REQ-02 | Order total recalculates | INCOMPLETE | parallel | 00:00:18 | incomplete: chromium--variation-b--r0 | [attempt-2.png](../../screenshots/US-9001-sample/phase-1/TC-005/chromium--variation-a--r0/attempt-2.png) |

### Heal log
| TC-ID | Affected test / files changed | Defect category | Previous value | Updated value | Reason the new value is correct | Approved-requirement reference | Verification performed | Rerun result |
|---|---|---|---|---|---|---|---|---|
| TC-003 | pages/OrderPage.ts | selector_failure | getByRole('button', { name: 'Save' }) | toolbar.getByRole('button', { name: 'Save' }) | the save button moved into the toolbar; same element, same behaviour | n/a (locator repair) | validator rules · semantic re-review | burn-in 3/3 PASS |

### Test-data readiness
**Verdict:** READY-WITH-SKIPS

| Gap | TCs | Decision | Source | Provisioning | Identifiers / names | Effective stamped values | Verified on | Cleanup |
|---|---|---|---|---|---|---|---|---|
| customer without orders | TC-004 | skip — QC declined | qc | — | — | — | — | — |

### Deviations
- TC-002 failed beside other tests and passed alone — moved to serial:interference
