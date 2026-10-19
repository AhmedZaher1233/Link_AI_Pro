# Test Cases — legacy-login
**Status:** APPROVED
**Review page language:** English — see TC-REVIEW-legacy-login.html
**Entry case:** fresh design
**Implementation status:** Implemented — entry point reachable
**Requirement IDs covered:** REQ-77-01
**Total test cases:** 2 (1/0/1, per locale)
**Run-stage mapping:** happy-path + edge-case → @positive · rejection/guard assertions → @negative
**Patterns applied / skipped:** P5 page-load precondition
**MCP validation:** 1 validated / 0 enhanced / 0 inferred / 0 discrepancy / 0 not-implemented / 1 draft
**Smoke TCs:** 1
**Automation candidates:** 2
**Requirement coverage (weighted):** 100% — Full 1 / Partial 0 / None 0 of 1 acceptance criteria
**Manual-only scenarios:** 0 (High 0 · Medium 0 · Low 0)

## Summary table
| ID | Type | Locale | Requirement | Smoke | Automation Candidate | Data effect | Shared data | Validation | Description |
|---|---|---|---|---|---|---|---|---|---|
| LOGIN-01 | happy-path | en | REQ-77-01 | YES | YES | | | validated | Login with a valid account |
| LOGIN-02 | negative | en | REQ-77-01 | NO | YES | | | draft — not app-validated | Login with a wrong password is rejected |

## Test case details

### LOGIN-01: Login with a valid account
- **Type:** happy-path
- **Locale:** en
- **Requirement:** REQ-77-01
- **Preconditions:**
  - The login page is fully loaded; no spinner.
- **Steps:**
  1. Type the username qa.user in Username.
  2. Type the password in Password.
  3. Click Sign in — loading appears on the button, then clears.
- **Expected Result:** The Home dashboard is visible and the header shows "qa.user".
- **Data Oracle:** account qa.user — exists in staging
- **Smoke:** YES
- **Automation Candidate:** YES
- **Validation:** validated

### LOGIN-02: Login with a wrong password is rejected
- **Type:** negative
- **Locale:** en
- **Requirement:** REQ-77-01
- **Preconditions:**
  - The login page is fully loaded; no spinner.
- **Steps:**
  1. Type the username qa.user in Username.
  2. Type a wrong password in Password.
  3. Click Sign in.
- **Expected Result:** The message "Invalid username or password" is shown and the page stays on Login.
- **Smoke:** NO
- **Automation Candidate:** YES
- **Validation:** draft — not app-validated

## Enhancement log
| TC-ID | Validation | What changed | Why (what the app showed) |
|---|---|---|---|
| LOGIN-01 | validated | none | matched the draft |

## Self-review

### Traceability matrix
| AC | REQ-ID | TC-IDs | Status | Missing |
|---|---|---|---|---|
| AC-1 Sign in | REQ-77-01 | LOGIN-01, LOGIN-02 | Fully Covered | — |

### Requirement coverage score
| AC | REQ-ID | TC-IDs | Status | What is missing |
|---|---|---|---|---|
| AC-1 Sign in | REQ-77-01 | LOGIN-01, LOGIN-02 | Fully Covered | — |

### Manual-only scenarios
| Category | TC-ID | Scenario | Why manual | Priority |
|---|---|---|---|---|

## Open Findings for the Human Reviewer
### Requirement / coverage gaps
- None
### Application defects (discrepancies)
- None
### Pending implementation
- None
