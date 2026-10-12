# Test Run Report — ask-assistant

**User Story:** US-2000 — Ask the assistant about returns
**Feature:** ask-assistant
**Spec:** —
**Source document:** ../../../Manual_Test/TestCases/US-2000-ask-assistant/TEST-CASES-ask-assistant.md
**Source revision:** 7a9c2e41b0d3
**Environment:** UAT
**Latest phase:** 2
**Latest run:** 2026-10-10 11:20
**Status:** FAILURES
**Latest results:** 2 passed · 1 failed · 0 incomplete · 0 skipped · 0 not run · 1 partial of 4 TCs
**Compliance:** — (manual run)
**Azure DevOps:** local
**Bug report:** BUG-REPORT-ask-assistant.md
**Run file:** .runs/phase-2.json
**Screenshots:** ../../screenshots/US-2000-ask-assistant/phase-2/
**Progress log:** ../../automation-logs/US-2000-ask-assistant/run-progress-2026-10-10-1050.log
**Earlier phases:** —

## Run history

| Phase | Date | Outcome | Passed | Failed | Incomplete | Skipped | Not run | Partial | Total | Duration | Bugs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-08 | FAILURES | 1 | 1 | 0 | 1 | 0 | 0 | 3 | 00:03:10 | BUG-1 |
| 2 | 2026-10-10 | FAILURES | 2 | 1 | 0 | 0 | 0 | 1 | 4 | 00:28:40 | BUG-1, BUG-2 |

## Phase 1 — 2026-10-08

### Run
- **Outcome:** FAILURES
- **Environment:** UAT
- **Build:** 2.3.0
- **Run command:** cd Testing/Automation && npx playwright test --project=chromium
- **Headed / workers:** yes / parallel ×2
- **Started:** 2026-10-08 09:00
- **Duration:** 00:03:10 (planned ~00:04:00 · serial-only ~00:06:00)
- **Run file:** .runs/phase-1.json
- **Progress log:** ../../automation-logs/US-2000-ask-assistant/run-progress-2026-10-08-0900.log
- **Screenshots:** ../../screenshots/US-2000-ask-assistant/phase-1/
- **Compliance:** Checkpoint A PASS (c1d2e3f4) · Checkpoint B PASS (c1d2e3f4)
- **Azure DevOps:** local
- **Previous phase:** none

### Stages
| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run |
|---|---|---|---|---|---|---|
| Smoke | 1 | 1 | 0 | 0 | 0 | 0 |
| Positive | 2 | 0 | 1 | 0 | 1 | 0 |
| Negative | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | 3 | 1 | 1 | 0 | 1 | 0 |

**Smoke gate:** passed — fail% 0% — no action needed

### Results
| TC-ID | REQ | Name | Status | Group | Duration | Classification | Evidence |
|---|---|---|---|---|---|---|---|
| TC-001 | REQ-01 | Open the assistant panel | PASS | parallel | 00:00:21 | — | [attempt-1.png](../../screenshots/US-2000-ask-assistant/phase-1/TC-001/chromium--none--r0/attempt-1.png) |
| TC-002 | REQ-02 | Clear the conversation | FAIL | parallel | 00:00:34 | app_bug | [attempt-1.png](../../screenshots/US-2000-ask-assistant/phase-1/TC-002/chromium--none--r0/attempt-1.png) · [failed](../../screenshots/US-2000-ask-assistant/phase-1/TC-002/chromium--none--r0/attempt-1-failed.png) |
| TC-AI-01 | REQ-03 | Ask for the return window | SKIP | parallel | — | — | — |

### Bugs
| Bug | TC-ID | Severity | Status |
|---|---|---|---|
| BUG-1 | TC-002 | Medium | open |

### Skips and residual failures
| TC-ID | Status | Reason |
|---|---|---|
| TC-AI-01 | SKIP | Automation Candidate: NO — the reply differs every run; judged by the manual CLI run |

### Deviations
- none

## Phase 2 — 2026-10-10

### Run
- **Outcome:** FAILURES
- **Environment:** UAT
- **Build:** 2.3.1
- **Run command:** manual run — playwright-cli 0.9.2 (skill 5b)
- **Headed / workers:** headed · one session per account
- **Login method:** A1 attended
- **Started:** 2026-10-10 10:50
- **Duration:** 00:28:40 (manual run · one session per account)
- **Run file:** .runs/phase-2.json
- **Progress log:** ../../automation-logs/US-2000-ask-assistant/run-progress-2026-10-10-1050.log
- **Screenshots:** ../../screenshots/US-2000-ask-assistant/phase-2/
- **Compliance:** — (manual run)
- **Azure DevOps:** local
- **Data changes:** not authorized · 0 made · 0 cleaned up · 0 left
- **Previous phase:** .runs/phase-1.json (skill 5)

### Stages
| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run | Partial |
|---|---|---|---|---|---|---|---|
| Smoke | 1 | 1 | 0 | 0 | 0 | 0 | 0 |
| Positive | 2 | 1 | 1 | 0 | 0 | 0 | 0 |
| Negative | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| **Total** | 4 | 2 | 1 | 0 | 0 | 0 | 1 |

**Smoke gate:** passed — fail% 0% — no action needed

### Results
| TC-ID | REQ | Name | Status | Group | Duration | Classification | Evidence |
|---|---|---|---|---|---|---|---|
| TC-001 | REQ-01 | Open the assistant panel | PASS | smoke | 00:01:05 | — | [attempt-1.png](../../screenshots/US-2000-ask-assistant/phase-2/TC-001/manual-cli--none--r0/attempt-1.png) |
| TC-002 | REQ-02 | Clear the conversation | PASS | positive | 00:02:10 | — | [attempt-1.png](../../screenshots/US-2000-ask-assistant/phase-2/TC-002/manual-cli--none--r0/attempt-1.png) |
| TC-AI-01 | REQ-03 | Ask for the return window | FAIL | positive | 00:04:30 | ai_rubric_failure | [attempt-1.png](../../screenshots/US-2000-ask-assistant/phase-2/TC-AI-01/manual-cli--none--r1/attempt-1.png) · [failed](../../screenshots/US-2000-ask-assistant/phase-2/TC-AI-01/manual-cli--none--r1/attempt-1-failed.png) · [reply](../../screenshots/US-2000-ask-assistant/phase-2/TC-AI-01/manual-cli--none--r1/reply.md) |
| TC-030 | REQ-04 | Escalate to a human agent by phone call-back | PARTIAL — human step pending | negative | 00:03:15 | human step: 4 | [attempt-1.png](../../screenshots/US-2000-ask-assistant/phase-2/TC-030/manual-cli--none--r0/attempt-1.png) |

### Bugs
| Bug | TC-ID | Severity | Status |
|---|---|---|---|
| BUG-1 | TC-002 | Medium | resolved (phase 2) |
| BUG-2 | TC-AI-01 | High | open |

### Skips and residual failures
none

### Open questions
none

### Test-data readiness
all ready

### Deviations
- none
