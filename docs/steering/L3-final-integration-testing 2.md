# L3 — Final Integration Testing

---

| Field                  | Value                                                      |
|------------------------|------------------------------------------------------------|
| **Authority**          | L3 — Project-specific                                      |
| **Parent Documents**   | L1 — Testing Foundation v1.0 · L2 — QA Standards v2.0     |
| **Project Name**       | [Project Name]                                             |
| **System / Product**   | [System or product name]                                   |
| **Release**            | [Release name or version — e.g. R1.0 / Sprint 5 / v2.3]   |
| **Owner**              | [QCL Name]                                                 |
| **Version**            | 1.0                                                        |
| **Last Updated**       | [Date]                                                     |
| **Status**             | [ Draft / Active / Archived ]                              |

---

## Purpose

This document defines all project-specific configuration, thresholds, scope, and exit criteria for the **Final Integration Testing** phase of **[Project Name]**. It extends L1 and L2 where those documents explicitly delegate decisions to the project level.

Final Integration Testing is the last structured quality gate before a release is promoted to a client-facing or production environment. It covers all quality dimensions simultaneously — functional, non-functional, localization, accessibility, and security — not as separate passes but as one coordinated phase.

This document also serves as the **`/project-config.md`** required by L2 §0. All L2 checklist items that reference `/project-config.md` keys are resolved in Section 1. No test execution may begin until Section 1 is fully populated and approved.

---

## How to Use This Document

**Before the phase begins** — the QCL fills in every `[placeholder]` in Sections 1–5. Incomplete configuration blocks execution of all dependent L2 checklist items (L2 §17.8).

**During the phase** — Sections 6–11 are the active execution reference. Checklist results are recorded in VSTS, not in this document. This document defines scope and thresholds; VSTS holds execution results.

**At phase exit** — Section 12 (Go/No-Go) is completed by the QCL and submitted to the PM as the formal release readiness declaration.

> Delete guidance blocks before publishing the active version of this document.

---

## 1. Project Configuration Contract
*(Fulfils L2 §0 — required before any L2 checklist can be executed)*

> **Guidance:** Every key must be populated before test execution begins. Values marked `N/A` must include a reason. A missing or blank value blocks execution of all L2 checklist items that reference that key — treat it as a FAIL.

### 1.1 Application and Domain

| Key | Value |
|-----|-------|
| `DOMAIN_CONTEXT` | [Short description of the system and its users — e.g. "Citizen services portal allowing users to submit and track government service requests online"] |
| **Technology profile** | [ Web portal / Mobile application / Backend API / Desktop application / Data pipeline / Other ] |
| **User-facing** | [ Yes / No ] |
| **Release scope summary** | [One sentence — e.g. "First release of the registration and service request submission modules"] |

### 1.2 Language and Locale

| Key | Value |
|-----|-------|
| `LANGUAGES` | [All supported languages with directionality — e.g. `[{code: "en", dir: "ltr"}, {code: "ar", dir: "rtl"}]` — single-language: `[{code: "en", dir: "ltr"}]`] |
| `DEFAULT_LANGUAGE` | [Primary language code — e.g. `en`] |
| `DATE_FORMAT` | [Display format — e.g. `DD/MM/YYYY`] |
| `PHONE_FORMAT` | [Number pattern — e.g. `+971 5X XXX XXXX`] |
| `NATIONAL_ID_FORMAT` | [Government ID pattern — e.g. `784-YYYY-XXXXXXX-X` — write `N/A` if not applicable] |
| `CURRENCY` | [Currency codes and formatting rules — e.g. `AED`, `USD` — write `N/A` if not applicable] |
| **RTL layout required** | [ Yes / No ] |

### 1.3 Performance SLA Targets
*(Fulfils L1 §10 and L2 §6.3)*

> **Guidance:** Agree these values with the PM before the phase begins. Testing without defined targets produces data without meaning. Write `PENDING — [owner] by [date]` for any unconfirmed value and escalate before execution starts.

| Key | Value |
|-----|-------|
| `PEAK_CONCURRENT_USERS` | [Target concurrent users — e.g. `500`] |
| `READ_SLA_MS` | [Max response time for GET endpoints in ms — e.g. `2000`] |
| `WRITE_SLA_MS` | [Max response time for POST/PUT/PATCH in ms — e.g. `3000`] |
| `UPLOAD_SLA_MS` | [Max response time for file uploads in ms — e.g. `5000`] |
| `AUTH_SLA_MS` | [Max response time for authentication endpoints in ms — e.g. `1000`] |
| `SEARCH_SLA_MS` | [Max response time for search/filter endpoints in ms — e.g. `2000`] |

### 1.4 Frontend Performance Targets *(user-facing systems only)*

> Projects may only set targets at or above the L2 defaults shown. They may not go below.

| Metric | L2 Default | This Project |
|--------|------------|--------------|
| LCP (Largest Contentful Paint) | < 2.5s | [ ] |
| FID / INP | < 100ms | [ ] |
| CLS (Cumulative Layout Shift) | < 0.1 | [ ] |
| TTFB (Time to First Byte) | < 800ms | [ ] |
| FCP (First Contentful Paint) | < 1.8s | [ ] |
| Lighthouse Performance score | ≥ 85 | [ ] |
| Lighthouse Accessibility score | ≥ 90 | [ ] |
| Lighthouse Best Practices score | ≥ 90 | [ ] |
| Lighthouse SEO score | ≥ 80 | [ ] |

### 1.5 Security Configuration
*(Fulfils L1 §11 and L2 §4)*

| Key | Value |
|-----|-------|
| `MFA_REQUIRED` | [ `true` / `false` ] |
| `SESSION_TIMEOUT_MIN` | [Inactivity timeout in minutes — e.g. `30`] |
| **Compliance requirements** | [Regulatory or compliance frameworks in scope — e.g. "Local data protection regulation", "PCI DSS for payment flows" — write `None` if not applicable] |
| **DAST authorization** | [ Authorized by [Name] on [Date] / Pending ] |

### 1.6 File Handling

| Key | Value |
|-----|-------|
| `FILE_TYPES_ALLOWED` | [Permitted upload MIME types — e.g. `[pdf, jpg, png]` — write `N/A` if no file uploads] |
| `MAX_FILE_SIZE_MB` | [Maximum upload size in MB — e.g. `10` — write `N/A` if no file uploads] |

### 1.7 Browsers and Devices
*(Fulfils L2 §11 and §12)*

| Key | Value |
|-----|-------|
| `SUPPORTED_BROWSERS` | [Browsers and minimum versions — e.g. `Chrome 120+, Firefox 120+, Safari 17+, Edge 120+`] |
| `SUPPORTED_DEVICES` | [Device categories — e.g. `Desktop, Tablet, Mobile`] |
| `BREAKPOINTS_PX` | [Responsive breakpoints in pixels — e.g. `[320, 375, 768, 1024, 1280]`] |

---

## 2. Scope

### 2.1 System Under Test

| Property | Value |
|----------|-------|
| **Environment** | [ Staging / Pre-prod / UAT server ] |
| **Environment URL** | [URL] |
| **Build / version under test** | [Build number or release tag] |
| **VSTS Test Plan** | [Test Plan name or ID] |
| **RSD version** | [Signed-off RSD version used as test basis] |
| **External integrations — active** | [Integrations live in this environment — e.g. "Identity provider sandbox, Payment gateway sandbox"] |
| **External integrations — stubbed** | [Integrations replaced with stubs and reason] |

### 2.2 Staging-to-Production Parity
*(L1 §9)*

**Staging matches Production in all configuration that affects test validity:** [ Yes / Partial / No ]

| Known Difference from Production | Impact on Test Reliability |
|----------------------------------|---------------------------|
| [ e.g. Smaller data volume ] | [ Low — volume tests scoped separately ] |
| [ Add rows as needed ] | |

### 2.3 Test Types Active in This Phase

> Each type marked Yes must be fully executed and produce a pass result before the release decision. N/A must include a justification — silence is not exclusion.

| Test Type | Active | Notes |
|-----------|--------|-------|
| Functional regression | Yes | Full regression suite against all signed-off criteria |
| End-to-end (E2E) | Yes | Critical user journeys — see Section 6.1 |
| API testing | [ Yes / No ] | Required if release includes API changes |
| Form validation | [ Yes / No ] | Required for every form in scope |
| Localization | [ Yes / N/A ] | Required if `LANGUAGES` includes more than one entry |
| RTL layout | [ Yes / N/A ] | Required if any language in `LANGUAGES` has `dir: rtl` |
| Responsive design | [ Yes / No ] | Required for all user-facing systems |
| Cross-browser | [ Yes / No ] | Required for all user-facing systems |
| Performance | Yes | Load and baseline — see Section 7 |
| Security | Yes | Full scope — see Section 8 |
| Accessibility | [ Yes / N/A ] | Required for all user-facing systems — see Section 9 |
| Usability | [ Yes / No ] | L2 §8 checklist |
| Logging and monitoring | [ Yes / No ] | L2 §14 checklist |
| Visual regression | [ Mandatory / Recommended / N/A ] | See Section 10 |

### 2.4 What Is Explicitly Out of Scope

> Name everything deliberately excluded. Unnamed exclusions do not count.

- [ e.g. "Third-party identity provider internal behavior — tested by provider" ]
- [ e.g. "Legacy reporting module — no changes in this release" ]
- [ Add as needed ]

---

## 3. Coverage Configuration
*(Fulfils L1 §4.3 — §2.4)*

### 3.1 Coverage Enforcement Mechanism

**Decision:** [ Hard block — pipeline fails, merge is prevented / Soft block — pipeline warns, Engineering Lead must approve override / Report-only — coverage tracked and reported, no merge block ]

**Rationale:** [One sentence]

### 3.2 Coverage Exclusions

| Excluded Category | Justification |
|-------------------|---------------|
| [ e.g. ORM migration files ] | [ Auto-generated, no project logic ] |
| [ Add rows as needed ] | |

> If no exclusions: *No exclusions declared. All code is subject to coverage measurement.*

### 3.3 Coverage Targets for This Release

> Must meet or exceed L1 minimums. Projects may set stricter targets only.

| Layer | L1 Minimum | This Project |
|-------|------------|--------------|
| Domain logic / business rules | 90% | [ ≥ 90% ] |
| Service layer | 80% | [ ≥ 80% ] |
| API layer | 70% | [ ≥ 70% ] |
| Frontend components | 70% | [ ≥ 70% ] |
| Utility / shared libraries | 90% | [ ≥ 90% ] |
| Infrastructure / adapters | 60% | [ ≥ 60% ] |

---

## 4. Entry Criteria

> The QCL verifies every item before authorizing the phase to start. A failing criterion blocks the phase. The QCL must document the blocker and communicate it to the PM and Engineering Lead.

*(Derived from L1 §2 Definition of Ready, L2 §1.3)*

### 4.1 Build and Story Readiness

- [ ] All stories in this release are in "Done" status on VSTS
- [ ] No open Severity 1 or 2 bugs from story-level testing
- [ ] No open Priority 1 or 2 bugs from story-level testing
- [ ] All story-level smoke tests have passed on the target environment
- [ ] Developer unit tests pass with no failures on the build being promoted
- [ ] Developer has validated positive test cases on the target environment for each story

### 4.2 Test Artifact Readiness
*(L2 §1.3)*

- [ ] All test cases created in VSTS, linked to user stories via "Tested by", and reviewed by QCL
- [ ] Test cases cover all scenario types: Positive, Negative, Boundary, Permissions (L1 §7)
- [ ] Traceability matrix is up to date — every acceptance criterion has at least one linked test case
- [ ] Test data files prepared for all in-scope forms, covering all configured languages (Section 1.2)
- [ ] API contracts documented in `/tech-spec.md` with linked test cases

### 4.3 Environment Readiness
*(L1 §9, L2 §1.7)*

- [ ] Target environment is stable — all services healthy and responding
- [ ] Test data is seeded in the expected state
- [ ] All active external integrations are reachable and responding
- [ ] Build version matches the version tagged for this release candidate
- [ ] Performance SLA targets (Section 1.3) confirmed with the PM
- [ ] Security scope and DAST authorization confirmed (Section 1.5)
- [ ] All Section 1 configuration values are fully populated and approved (L2 §17.8)

---

## 5. Defect Thresholds and Release Blocking Policy
*(Fulfils L1 §13, L2 §15 and §16)*

### 5.1 Severity and Priority Definitions

*(L1 §13.1, L2 §15)*

| Severity | Definition |
|----------|------------|
| **1 — Critical** | System crash, data loss, security breach, authentication failure, or complete blockage of a core business flow |
| **2 — High** | Major feature broken with no acceptable workaround; incorrect business logic; data integrity failure; broken localization rendering content inaccessible in a configured language |
| **3 — Medium** | Feature partially broken; incorrect validation; missing error messages; workaround exists |
| **4 — Cosmetic** | Minor visual or UX issue with no functional impact |

| Priority | Definition |
|----------|------------|
| **P1 — Urgent** | Must be fixed before any further testing or delivery activity |
| **P2 — High** | Must be fixed before release |
| **P3 — Medium** | Should be fixed within the current release cycle |
| **P4 — Low** | Can be scheduled for a future release |

### 5.2 Story-Level Gate

A story is not Done while any of the following are open against it (L1 §2, L2 §1.4):

- Any bug of Severity 1 or 2
- Any bug of Priority 1 or 2
- Any L2 checklist item in FAIL state without an approved, time-bounded waiver in `/tech-debt-backlog.md`

### 5.3 Release Gate

| Condition | Required State |
|-----------|----------------|
| Severity 1 (Critical) bugs | Zero open |
| Severity 2 (High) bugs | Zero open |
| P1 and P2 bugs | Zero open |
| Severity 3 (Medium) bugs | [ Zero open / Open with approved deferral plan — project decision ] |
| Security findings — Critical or High | Zero open — no exceptions (L1 §11) |
| Accessibility violations — Critical or Serious | [ Zero / List acceptable exceptions ] |
| Performance SLA targets | All met — or exceptions documented per Section 13 |
| L2 checklist items in FAIL state | Zero without approved waiver (L2 §17.3) |

### 5.4 Conditional Release

If the team agrees to release with open Medium or Low defects, the following are required before release is approved:

- List of open bugs with severity, priority, and deferral justification
- Resolution owner and target iteration for each deferred item
- PM and QCL sign-off

---

## 6. Test Execution Plan

> This section defines what must be tested in this phase. Execution results are recorded in VSTS. This document defines scope only.

### 6.1 Critical E2E User Journeys

> List the mandatory end-to-end journeys for this release. All must pass before release. Be specific — describe from the user's starting point to the final expected outcome.

| ID | Journey Description | Priority | Locale(s) |
|----|---------------------|----------|-----------|
| E2E-001 | [ e.g. "User registers, verifies identity, submits a service request, and receives a confirmation with a reference number" ] | Critical | [ EN / AR / Both ] |
| E2E-002 | [ e.g. "Admin reviews a submitted request, assigns it, and marks it resolved — applicant receives a notification" ] | Critical | [ EN / AR / Both ] |
| E2E-003 | [ e.g. "User switches language mid-session and completes a form without data loss or display errors" ] | High | Both |
| [ Add rows ] | | | |

### 6.2 Regression Scope
*(L1 §3.2, L2 §13)*

- Scope: full regression suite — all acceptance criteria signed off in this and all previous releases
- Execution location: VSTS Test Plan — [Test Plan name or ID]
- New test cases added for this release: [Count], linked and reviewed by QCL
- L2 Regression Checklist (§13) must be fully executed

### 6.3 API Testing Scope
*(L2 §3)*

> List the API modules in scope. All L2 §3 checklist items apply to each.

| Module / Endpoint Group | In Scope | Notes |
|-------------------------|----------|-------|
| [ e.g. Authentication endpoints ] | [ Yes / No ] | |
| [ e.g. Service request CRUD ] | [ Yes / No ] | |
| [ e.g. Notification service ] | [ Yes / No ] | |
| [ Add rows as needed ] | | |

### 6.4 Form Validation Scope
*(L2 §5)*

> List every form in scope. L2 §5 checklist must be executed for each.

| Form Name | In Scope | Test Data File |
|-----------|----------|----------------|
| [ e.g. User registration form ] | [ Yes / No ] | `/tests/data/registration.data.ts` |
| [ e.g. Service request form ] | [ Yes / No ] | `/tests/data/service-request.data.ts` |
| [ Add rows as needed ] | | |

### 6.5 Localization and RTL Scope
*(L1 §6, L2 §10)*

> Complete only if localization is active in Section 2.3.

| Check Area | Languages in Scope | L2 Reference |
|------------|-------------------|--------------|
| Translation completeness — no untranslated strings | All configured languages | L2 §10 |
| RTL layout — element order, alignment, and flow | RTL languages only | L2 §10 |
| Locale-specific formats — dates, numbers, currency, phone | All configured languages | L2 §10 |
| Input acceptance — script and character set | All configured languages | L2 §10 |
| Language switch — no session or state loss | All configured languages | L2 §10 |
| Dynamic content — error messages, notifications, status labels | All configured languages | L2 §10 |

### 6.6 Responsive and Cross-Browser Scope
*(L2 §11 and §12)*

**Viewports** (from `BREAKPOINTS_PX` in Section 1.7):

| Viewport (px) | Device Category | Required |
|---------------|-----------------|----------|
| 320 | Mobile small | [ Yes / No ] |
| 375 | Mobile standard | [ Yes / No ] |
| 768 | Tablet | [ Yes / No ] |
| 1024 | Laptop | [ Yes / No ] |
| 1280 | Desktop | [ Yes / No ] |
| [ Add per BREAKPOINTS_PX ] | | |

**Browsers** (from `SUPPORTED_BROWSERS` in Section 1.7):

| Browser | Desktop | Mobile |
|---------|---------|--------|
| Chrome | [ Required / N/A ] | [ Required / N/A ] |
| Firefox | [ Required / N/A ] | [ Required / N/A ] |
| Safari | [ Required / N/A ] | [ Required / N/A ] |
| Edge | [ Required / N/A ] | [ Required / N/A ] |

### 6.7 Usability Scope
*(L2 §8)*

Execute the L2 §8 Usability Checklist for all user-facing flows in scope. Project-specific requirements for this release:

- [ e.g. "All destructive actions must require a confirmation dialog displaying the record identifier" ]
- [ e.g. "Session timeout must warn the user 2 minutes before expiry with an option to extend" ]
- [ Add as needed ]

### 6.8 Logging and Monitoring Scope
*(L2 §14)*

Execute the L2 §14 Logging and Monitoring Checklist. Project-specific requirements:

- [ e.g. "All service request state transitions must be logged with user ID, timestamp, and old/new state" ]
- [ e.g. "Failed payment attempts must trigger an alert to the operations team within 60 seconds" ]
- [ Add as needed ]

---

## 7. Performance Testing Scope
*(Fulfils L1 §10, L2 §6)*

> SLA values come from Section 1.3. All L2 §6 checklist items apply. Execution on Staging only — never on Production.

### 7.1 Test Types Required for This Release

| Test Type | Required | Notes |
|-----------|----------|-------|
| Baseline benchmark | Yes | Run before any changes to capture reference point |
| Load test | Yes | Validate at `PEAK_CONCURRENT_USERS` |
| Stress test | [ Yes / No ] | Required for major releases and infrastructure changes |
| Spike test | [ Yes / No ] | Required for features with unpredictable traffic patterns |
| Soak / endurance test | [ Yes / No ] | Required for long-running services and background jobs |
| Frontend Lighthouse audit | Yes | All pages in scope — all configured languages |
| Core Web Vitals validation | Yes | All user-facing pages |
| Frontend optimization checks | Yes | L2 §6.6 checklist items |

### 7.2 Pages and Endpoints in Performance Scope

| Resource | Type | SLA Key |
|----------|------|---------|
| [ e.g. Home / landing page ] | Frontend page | LCP, CLS targets (Section 1.4) |
| [ e.g. Service request form ] | Frontend page | LCP, CLS targets (Section 1.4) |
| [ e.g. GET /api/requests ] | API endpoint | `READ_SLA_MS` |
| [ e.g. POST /api/requests ] | API endpoint | `WRITE_SLA_MS` |
| [ e.g. POST /api/documents/upload ] | API endpoint | `UPLOAD_SLA_MS` |
| [ Add rows as needed ] | | |

### 7.3 Resource Utilization Thresholds

| Resource | Warning | Critical |
|----------|---------|----------|
| CPU | [ e.g. > 70% ] | [ e.g. > 90% ] |
| Memory | [ e.g. > 75% ] | [ e.g. > 90% ] |

---

## 8. Security Testing Scope
*(Fulfils L1 §11, L2 §4)*

> All L2 §4 checklist sections apply by default. Confirm active scope and note any project-specific constraints per category.

| L2 Checklist Section | Category | Active | Project-Specific Notes |
|----------------------|----------|--------|------------------------|
| L2 §4.1 | Authentication | Yes | [ e.g. "Test all login failure scenarios. MFA per `MFA_REQUIRED` in Section 1.5" ] |
| L2 §4.2 | Authorization | Yes | [ e.g. "All roles defined in the RSD must be tested for access boundary enforcement" ] |
| L2 §4.3 | Input validation and injection | Yes | [ e.g. "All forms and API endpoints with user-supplied input" ] |
| L2 §4.4 | CSRF and CORS | Yes | [ e.g. "All state-changing operations in scope" ] |
| L2 §4.5 | Sensitive data exposure | Yes | [ e.g. "Verify no PII in logs, URLs, or error responses" ] |
| L2 §4.6 | File upload security | [ Yes / N/A ] | [ e.g. "Types per `FILE_TYPES_ALLOWED`, size per `MAX_FILE_SIZE_MB` in Section 1.6" ] |
| L2 §4.7 | Transport and security headers | Yes | [ e.g. "All application endpoints" ] |
| L2 §4.8 | Session management | Yes | [ e.g. "Session timeout per `SESSION_TIMEOUT_MIN` in Section 1.5" ] |
| DAST scan | Dynamic analysis on Staging | Yes | [ e.g. "Authenticated flows only. Admin endpoints excluded — separate authorization required" ] |

Security testing is also repeated on **Live** after production deployment (L1 §11).

---

## 9. Accessibility Testing Scope
*(Fulfils L1 §12, L2 §7)*

> Complete only if accessibility is active in Section 2.3.

**Conformance target:** [ WCAG 2.1 AA — L2 default / Other: _____ ]

**Minimum pass condition:** Zero Critical and zero Serious violations from automated scans — L2 §7.1 items 1 and 2.

| L2 Checklist Section | Scope |
|----------------------|-------|
| L2 §7.1 — Automated scan | All pages listed below |
| L2 §7.2 — Keyboard navigation | All interactive flows |
| L2 §7.3 — Screen reader compatibility | All pages and forms |
| L2 §7.4 — Visual design and contrast | All pages |
| L2 §7.5 — Dynamic content and ARIA | All pages with dynamic content |

**Pages in accessibility scope:**

| Page / Flow | Required |
|-------------|----------|
| [ e.g. Login and registration ] | Yes |
| [ e.g. Main service request form ] | Yes |
| [ e.g. User dashboard ] | Yes |
| [ Add rows as needed ] | |

---

## 10. Visual Regression Testing
*(Fulfils L1 §17.4)*

**Decision for this project:** [ Mandatory / Recommended — team's discretion / Not in scope ]

If Mandatory or Recommended:

| Configuration | Value |
|---------------|-------|
| **Baseline strategy** | [ e.g. "Snapshots captured at start of each release cycle against Staging before any changes" ] |
| **Pixel difference threshold** | [ e.g. "< 0.1% pixel difference accepted without designer review" ] |
| **Intentional change review** | [ e.g. "Designer approves updated baselines before they are committed" ] |
| **Scope** | Critical pages at all `BREAKPOINTS_PX` · Both locales if localization active · Core components at default, hover, error, and disabled states |

---

## 11. Defect Reporting Standard
*(L1 §13.4, L2 §15)*

All bugs found in this phase must be logged on VSTS with every field below. Incomplete reports are returned for completion before triage.

| Field | Required Content |
|-------|-----------------|
| **Bug Title** | `[Page / Component] — [What is wrong]` |
| **Steps to Reproduce** | Numbered, reproducible steps from precondition to failure |
| **Preconditions** | System state, user role, and test data required before step 1 |
| **Expected Result** | Exact behavior per the RSD or acceptance criterion |
| **Actual Result** | Exact behavior observed |
| **Spec Reference** | FR-XXX / AC-XXX from the signed-off RSD |
| **Impact** | Functional / UI / Performance / Security / Localization / Accessibility |
| **Testing Type** | Functional / Security / Performance / Accessibility / Localization / Regression |
| **Severity** | Critical / High / Medium / Cosmetic (per Section 5.1) |
| **Priority** | P1 / P2 / P3 / P4 (per Section 5.1) |
| **Status** | New / Assigned / In Progress / Fixed / Ready for Retest / Closed / Reopened |
| **Testing Environment** | Dev / QA / Staging / Production |
| **Browser / Device** | Browser name and version, OS, device type |
| **Language Mode** | Active language at time of defect (per `LANGUAGES` in Section 1.2) |
| **Test Evidence** | Screenshot, recording, network trace, or console log |
| **Build / Version** | Application build or release version under test |
| **Linked User Story** | VSTS link to the related US |

**Bug lifecycle:** New → Assigned → In Progress → Fixed → Ready for Retest → Retest → Closed or Reopened *(L1 §13.5, L2 §1.6)*

---

## 12. Go/No-Go Criteria and Release Decision
*(Fulfils L2 §16 — this is the formal release readiness declaration)*

> Complete the Actual column as execution concludes. The QCL signs off each Decision row. A single NO-GO blocks the overall release unless a formal exemption is approved per Section 13.

| # | Criterion | Go Condition | Source | Actual | Decision |
|---|-----------|-------------|--------|--------|----------|
| 1 | Acceptance criteria coverage | 100% of criteria have passing tests | L2 §16.1 | | GO / NO-GO |
| 2 | Critical defects | Zero open Severity 1 | L1 §13.3, L2 §16.2 | | GO / NO-GO |
| 3 | High defects | Zero open Severity 2 without approved waiver | L1 §13.3, L2 §16.3 | | GO / NO-GO |
| 4 | Core Web Vitals | All frontend metrics within targets (Section 1.4) | L1 §10, L2 §16.4 | | GO / NO-GO |
| 5 | API performance | All endpoints within SLA (Section 1.3) | L1 §10, L2 §6.3 | | GO / NO-GO |
| 6 | Security checklist | All L2 §4 items PASS | L1 §11, L2 §16.5 | | GO / NO-GO |
| 7 | Accessibility | Zero axe-core Critical or Serious violations | L1 §12, L2 §16.6 | | GO / NO-GO |
| 8 | Regression suite | 100% of regression tests passing | L1 §3.2, L2 §16.7 | | GO / NO-GO |
| 9 | Primary language | All primary language content and functional checks passing | L2 §16.8 | | GO / NO-GO |
| 10 | Secondary language(s) | All secondary language checks passing — N/A for single-language projects | L2 §16.9 | | GO / NO-GO |
| 11 | RTL layout | All RTL checks passing — N/A if no RTL languages configured | L2 §16.10 | | GO / NO-GO |
| 12 | All L2 checklists | All items PASS or N/A with justification | L2 §16.11 | | GO / NO-GO |
| 13 | Environment stability | Staging stable and representative of Production | L1 §9, L2 §16.12 | | GO / NO-GO |
| 14 | Traceability matrix | All acceptance criteria traced to passing tests | L1 §11, L2 §16.13 | | GO / NO-GO |
| 15 | UX design review | UX team reviewed portal against designs; raised bugs are closed | L1 §2 Release Done | | GO / NO-GO |
| 16 | Responsive testing | All viewports and browsers in scope pass | L1 §2 Release Done | | GO / NO-GO |
| 17 | UAT document | Exported from VSTS, reviewed by QCL, sent to PM | L1 §1 Phase 3 | | GO / NO-GO |

### Overall Release Decision

```
[ ] GO     — All criteria met. Release approved.
[ ] NO-GO  — One or more criteria not met. Blocking items listed below.
```

**Completed by:** [QCL Name] — **Date:** [Date]

**Blocking items (if NO-GO):**
- [ Criterion number — current state — owner responsible for resolution ]

---

## 13. Approved Exemptions

> Any deviation from an L1 or L2 requirement must be declared here. An exemption is a formal acknowledgment of accepted risk — not approval to lower quality. No exemption may reduce a requirement below the L1 or L2 floor. Engineering Lead approval is required for each item. If none: *None.*

| ID | Parent | Section | Description | Justification | Approved By | Expiry |
|----|--------|---------|-------------|---------------|-------------|--------|
| EX-001 | [ L1 / L2 ] | [ §X.X ] | [ e.g. "Soak testing deferred — no long-running background jobs in this release" ] | [ Reason ] | [ Engineering Lead ] | [ Next release / Date ] |
| [ Add rows ] | | | | | | |

---

## 14. Roles and Contacts

| Role | Name | VSTS Profile / Contact |
|------|------|------------------------|
| QC Lead (QCL) — phase owner | [ Name ] | [ Contact ] |
| QC Engineer (QCE) — execution | [ Name ] | [ Contact ] |
| Technical Lead (TL) | [ Name ] | [ Contact ] |
| System Analyst (SA) | [ Name ] | [ Contact ] |
| Project Manager (PM) | [ Name ] | [ Contact ] |
| Solution Developer (SD) | [ Name ] | [ Contact ] |
| Performance tester | [ Name / External team ] | [ Contact ] |
| Security tester | [ Name / External team ] | [ Contact ] |

---

## Appendix A — Document Change Log

| Version | Date | Author | Summary of Changes |
|---------|------|--------|--------------------|
| 1.0 | [Date] | [Author] | Initial release for [Release name] |

---

## Appendix B — Related Documents

| Document | Location | Relationship |
|----------|----------|--------------|
| L1 — Testing Foundation | `/steering/L1-foundations/testing-foundation.md` | Parent authority — organizational standards |
| L2 — QA Standards and Checklists | `/steering/L2-Testing/QA-Standards-v2.md` | Parent authority — checklists and process |
| VSTS Test Plan | [ VSTS URL ] | Active test plan and execution results for this release |
| Signed-off RSD | [ RSD location or version ] | Requirements used as test basis |
| Traceability Matrix | `/traceability-matrix.md` | Requirement-to-test mapping for this project |
| Technical Debt Backlog | `/tech-debt-backlog.md` | Coverage gaps and deferred items |
| UAT Document | [ Location / to be generated from VSTS ] | Client-facing document for UAT session |
