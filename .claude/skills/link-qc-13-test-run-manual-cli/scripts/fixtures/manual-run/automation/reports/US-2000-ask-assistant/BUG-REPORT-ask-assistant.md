# Bug Report — ask-assistant

**User Story:** US-2000 — Ask the assistant about returns
**Feature:** ask-assistant
**Spec:** —
**Source document:** ../../../Manual_Test/TestCases/US-2000-ask-assistant/TEST-CASES-ask-assistant.md
**Latest phase:** 2
**Bugs:** 1 open · 1 resolved · 0 not checked this run of 2
**Run report:** TEST-RUN-REPORT-ask-assistant.md

## Bugs

### BUG-1 — The system doesn't clear the conversation when the user confirms Clear
- **TC-ID:** TC-002
- **Requirement:** REQ-02
- **Severity:** Medium
- **Environment:** UAT
- **Browser:** chromium
- **Language:** en
- **Build:** 2.3.0
- **Found in phase:** 1
- **Status:** resolved (phase 2)
- **Root cause:** —
- **Steps to reproduce:**
  1. Log in as Administrator [A1].
  2. Open the assistant panel.
  3. Send any message and wait for the reply.
  4. Click Clear and confirm.
- **Expected:** The conversation is empty and the greeting is shown again.
- **Actual:** The previous messages stay in the panel.
- **Screenshot:** [attempt-1-failed.png](../../screenshots/US-2000-ask-assistant/phase-1/TC-002/chromium--none--r0/attempt-1-failed.png)
- **Evidence:** expect(messages).toHaveCount(0) — received 2
- **History:**
  - phase 1 — FAIL: first seen on build 2.3.0
  - phase 2 — PASS: retest passed on build 2.3.1 (manual run)

### BUG-2 — The assistant doesn't state the receipt condition when asked about the return window
- **TC-ID:** TC-AI-01
- **Requirement:** REQ-03
- **Severity:** High
- **Environment:** UAT
- **Browser:** Chromium (playwright-cli)
- **Language:** en
- **Build:** 2.3.1
- **Found in phase:** 2
- **Status:** open
- **Root cause:** —
- **Steps to reproduce:**
  1. Log in as Administrator [A1].
  2. Open the assistant panel and start a new conversation.
  3. Type "What is the return window for an online order?" and send it.
- **Expected:** The reply states the 14-day window and that the receipt is required (return policy [D1]).
- **Actual:** In 1 of 2 repeats the reply says "no receipt needed", contradicting the policy.
- **Screenshot:** [attempt-1-failed.png](../../screenshots/US-2000-ask-assistant/phase-2/TC-AI-01/manual-cli--none--r1/attempt-1-failed.png)
- **Evidence:** [reply.md](../../screenshots/US-2000-ask-assistant/phase-2/TC-AI-01/manual-cli--none--r1/reply.md) — Grounded: not met; Consistency across repeats: not met
- **History:**
  - phase 2 — FAIL: 1/2 repeats passed on build 2.3.1
