# L2-Testing — QA Standards & Checklists

> **Steering Layer:** L2 — Cross-Project Standards
> **Authority:** This document governs all testing activities on every software project in the organization.
> **Supersedes:** Any project-level testing instructions that conflict with this document.
> **Version:** 2.0
> **Last Updated:** 2026
> **Change Summary (v2.0):** Generalized all project-specific locale, language, browser, SLA, and format assumptions. Added Project Configuration Contract (§0). Introduced `/project-config.md` as the authoritative source for all project-variable values. Restructured Section 10 to support N languages. Gated all RTL checks behind a project configuration flag. Removed live "Actual" columns from the performance standards tables.

---

## Purpose

This document defines the organization's mandatory quality assurance standards, testing process, and execution checklists for all software projects. It is consumed by the Test Agent and all QA engineers as the authoritative reference for what must be tested, how it must be tested, and what constitutes a passing quality gate.

All agents operating under `/L2-qc/` must execute every applicable checklist and report results. A feature or release is not complete until all applicable checklists are passed.

---

## ⚠️ Execution Rule Summary

> This callout applies from §3 onward. Full rules are in §17.
>
> - Every checklist item must record: **`PASS`**, **`FAIL`**, or **`N/A — [justification]`**. No items may be left blank.
> - A checklist section is only fully N/A if the project has no relevance to that domain. This must be documented in the Test Plan.
> - **FAIL items block the Definition of Done.** See §17 for waiver process.
> - Checklist items referencing `/project-config.md` values are only executable once that file is populated per §0.

---

## Table of Contents

1. [Project Configuration Contract](#0-project-configuration-contract)
2. [Organization QA Process — Agile Projects](#1-organization-qa-process--agile-projects)
3. [Testing Phase Overview](#2-testing-phase-overview)
4. [API Testing Checklist](#3-api-testing-checklist)
5. [Security Testing Checklist](#4-security-testing-checklist)
6. [Form Validation Checklist](#5-form-validation-checklist)
7. [Performance Testing Checklist](#6-performance-testing-checklist)
8. [Screen Reader & Accessibility Checklist](#7-screen-reader--accessibility-checklist)
9. [Usability Checklist](#8-usability-checklist)
10. [Functional Testing Checklist](#9-functional-testing-checklist)
11. [Localization & Multilingual Checklist](#10-localization--multilingual-checklist)
12. [Responsive Design Checklist](#11-responsive-design-checklist)
13. [Cross-Browser & Cross-Platform Checklist](#12-cross-browser--cross-platform-checklist)
14. [Regression Testing Checklist](#13-regression-testing-checklist)
15. [Logging & Monitoring Checklist](#14-logging--monitoring-checklist)
16. [Bug Reporting Standards](#15-bug-reporting-standards)
17. [Release Readiness — Go/No-Go Criteria](#16-release-readiness--gono-go-criteria)
18. [Checklist Execution Rules](#17-checklist-execution-rules)

---

## 0. Project Configuration Contract

> **Purpose:** Before executing any checklist in this document, each project must define a `/project-config.md` file supplying the values listed below. Checklist items that reference these keys are only executable once this file exists and is populated.
>
> **Owner:** Project Lead / QA Lead — defined at project kick-off, reviewed at each major release.
>
> **Rule:** Where a project-config value is absent or undefined, the corresponding checklist item must be marked `N/A — [reason: not applicable to this project]` or `BLOCKED — [reason: config not yet defined]`. A BLOCKED item follows the same rules as a FAIL item under §17.

| Key | Description | Example Value |
|-----|-------------|---------------|
| `LANGUAGES` | All supported language codes and their text directionality | `[{code: "en", dir: "ltr"}, {code: "ar", dir: "rtl"}]` |
| `DEFAULT_LANGUAGE` | Primary language of the application | `en` |
| `DATE_FORMAT` | Display date format used across the application | `DD/MM/YYYY` |
| `PHONE_FORMAT` | Phone number format with description or regex | `+971 5X XXX XXXX` |
| `NATIONAL_ID_FORMAT` | Government or national ID format, if applicable | `784-YYYY-XXXXXXX-X` |
| `CURRENCY` | Currency symbol(s) and locale formatting rules | `AED`, `USD` |
| `PEAK_CONCURRENT_USERS` | Target concurrent user count for load testing | `500` |
| `READ_SLA_MS` | Maximum acceptable response time for GET endpoints (ms) | `2000` |
| `WRITE_SLA_MS` | Maximum acceptable response time for POST/PUT/PATCH (ms) | `3000` |
| `UPLOAD_SLA_MS` | Maximum acceptable response time for file upload endpoints (ms) | `5000` |
| `AUTH_SLA_MS` | Maximum acceptable response time for authentication endpoints (ms) | `1000` |
| `SEARCH_SLA_MS` | Maximum acceptable response time for search/filter endpoints (ms) | `2000` |
| `SUPPORTED_BROWSERS` | List of browsers and minimum versions to test | `Chrome 120+, Firefox 120+, Safari 17+, Edge 120+` |
| `SUPPORTED_DEVICES` | Target device categories | `Desktop, Tablet, Mobile` |
| `BREAKPOINTS_PX` | Responsive breakpoints to validate (in pixels) | `[320, 375, 425, 768, 1024, 1280, 1440]` |
| `FILE_TYPES_ALLOWED` | Permitted upload MIME types | `[pdf, jpg, png]` |
| `MAX_FILE_SIZE_MB` | Maximum upload file size in megabytes | `10` |
| `SESSION_TIMEOUT_MIN` | Inactivity session timeout in minutes | `30` |
| `MFA_REQUIRED` | Whether multi-factor authentication is enforced | `true / false` |
| `DOMAIN_CONTEXT` | Short description of the application domain (for terminology and tone validation) | `Government service portal` |

---

## 1. Organization QA Process — Agile Projects

### 1.1 QA Role in the Agile Lifecycle

Quality is a shared responsibility across the entire team. The QA engineer is embedded within each sprint and participates in every phase of the development lifecycle.

### 1.2 Sprint-Level QA Activities

| Sprint Phase          | QA Activities                                                                 |
|-----------------------|-------------------------------------------------------------------------------|
| Sprint Planning       | Review user stories, raise testability concerns, define acceptance criteria   |
| Backlog Refinement    | Validate that all stories have clear, testable acceptance criteria            |
| Phase 5 — Test Design | Define test scenarios, create test data, prepare test environments            |
| Phase 6 — Dev         | Review unit tests, validate test coverage plan, prepare automation scripts    |
| Phase 9 — Validation  | Execute all checklists, run automation, report results, validate release gate |
| Sprint Review         | Demonstrate tested features, present quality metrics                         |
| Sprint Retrospective  | Identify QA process improvements, update checklists if needed                |

### 1.3 Definition of Ready (Story Entry Criteria)

A user story is ready for development only when:

- [ ] Acceptance criteria are defined, clear, and testable
- [ ] All dependencies are identified
- [ ] Test scenarios are defined by QA (Phase 5 complete)
- [ ] Test data requirements are identified
- [ ] UI designs / wireframes are approved (if applicable)
- [ ] API contracts are documented in `/tech-spec.md`

### 1.4 Definition of Done (Story Exit Criteria)

A user story is done only when:

- [ ] All acceptance criteria are implemented
- [ ] All unit tests pass (Phase 6 complete)
- [ ] All applicable checklists in this document are executed and passed
- [ ] All automated tests pass in CI/CD
- [ ] No open Critical or High severity defects
- [ ] Test results are documented in the Test Report
- [ ] Traceability matrix is updated
- [ ] Code reviewed and approved

### 1.5 QA Phases

```
Phase 1 — Requirements Review
  └─ QA reviews specs for completeness and testability

Phase 2 — Architecture Review
  └─ QA reviews architecture for testability and risk

Phase 3 — Design Review
  └─ QA reviews technical design for contract clarity

Phase 4 — Environment Setup
  └─ QA validates test environment readiness

Phase 5 — Test Design
  └─ QA defines test scenarios, test data, and automation strategy

Phase 6 — Implementation
  └─ QA reviews unit tests; Test Agent generates test code

Phase 7 — System Testing
  └─ QA executes all functional and non-functional tests

Phase 8 — UAT Support
  └─ QA supports user acceptance testing

Phase 9 — Integration & Validation
  └─ Test Agent runs integration, E2E, and Playwright tests

Phase 10 — Release
  └─ QA validates Go/No-Go; signs off on release readiness
```

### 1.6 Defect Lifecycle

```
New → Assigned → In Progress → Fixed → Ready for Retest → Retest
  └─ Retest Passed → Closed
  └─ Retest Failed → Reopened → Assigned → ...
```

### 1.7 Testing Environments

| Environment | Purpose                                              | Who Executes                    |
|-------------|------------------------------------------------------|---------------------------------|
| Dev         | Developer unit verification                          | Developer + Test Agent          |
| QA          | Full test execution against all checklists           | QA Engineer + Test Agent        |
| Staging     | Pre-release end-to-end validation                    | QA Engineer + Test Agent        |
| Production  | Smoke tests only post-deployment                     | QA Engineer                     |

> **Rule:** Never execute destructive or load tests against Production.
> **Rule:** Confirm environment stability before beginning test execution. Log environment issues separately from code defects.

---

## 2. Testing Phase Overview

### 2.1 Test Types by Phase

| Test Type                  | Phase 6 | Phase 9 | Tool                        |
|----------------------------|---------|---------|-----------------------------|
| Unit tests                 | ✓       |         | Jest / JUnit / xUnit        |
| Component tests            | ✓       |         | Jest / Testing Library      |
| API contract tests         | ✓       | ✓       | Postman / Newman / Pact     |
| Integration tests          |         | ✓       | Playwright / Supertest      |
| End-to-end tests           |         | ✓       | Playwright (TypeScript)     |
| Functional UI tests        |         | ✓       | Playwright (TypeScript)     |
| Accessibility tests        |         | ✓       | axe-core/playwright         |
| Performance tests          |         | ✓       | Lighthouse / k6             |
| Security tests             |         | ✓       | OWASP ZAP / manual          |
| Localization tests         |         | ✓       | Playwright (TypeScript)     |
| Responsive tests           |         | ✓       | Playwright (TypeScript)     |
| Cross-browser tests        |         | ✓       | Playwright multi-project    |
| Regression tests           |         | ✓       | Playwright (TypeScript)     |

### 2.2 Test File Organization

> **Note:** The structure below is the recommended default for TypeScript/Node projects. Projects using different technology stacks must define an equivalent structure in their `/tech-spec.md` that maps each test type to a discoverable location. The test type categories (unit, integration, e2e, etc.) are mandatory; the directory layout is a reference template.

```
/tests
  /unit              ← Aggregates, value objects, domain services
  /integration       ← Cross-context, repositories, app services
  /contract          ← API request/response schema tests
  /e2e               ← Full workflow end-to-end tests
  /functional        ← Feature-level acceptance criteria tests
  /accessibility     ← axe-core scans per page/component
  /performance       ← Lighthouse and Core Web Vitals
  /security          ← Auth, injection, header validation
  /localization      ← Per-language and RTL tests (if applicable per /project-config.md)
  /responsive        ← Viewport and layout tests
  /regression        ← Full regression suite
  /data              ← Test data files per form, per configured language
```

---

## 3. API Testing Checklist

> **Reference File:** `API Testing Checklist.xlsx`
> **Applies to:** All backend API endpoints defined in `/tech-spec.md`
> **Executor:** Test Agent (Phase 6 contract tests, Phase 9 integration tests)

### 3.1 Request Validation

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | Endpoint URL matches the tech-spec definition exactly                      | [ ]    |
| 2 | HTTP method is correct (GET/POST/PUT/PATCH/DELETE)                         | [ ]    |
| 3 | Required headers are present (Content-Type, Authorization, Accept)         | [ ]    |
| 4 | Request body schema matches the tech-spec contract                         | [ ]    |
| 5 | All mandatory request fields are enforced — missing fields return 400      | [ ]    |
| 6 | Optional fields behave correctly when omitted                              | [ ]    |
| 7 | Field data types are validated (string, integer, boolean, array, object)   | [ ]    |
| 8 | Field length limits are enforced                                           | [ ]    |
| 9 | Enum fields only accept defined values                                     | [ ]    |
| 10| Date and time fields enforce correct format (ISO 8601 unless specified)    | [ ]    |
| 11| Numeric boundary values are enforced (min, max)                            | [ ]    |
| 12| Array fields enforce min/max item counts where defined                     | [ ]    |

### 3.2 Response Validation

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 13| Response status code matches the tech-spec for each scenario               | [ ]    |
| 14| Response body schema matches the tech-spec contract                        | [ ]    |
| 15| Response Content-Type header is correct (application/json)                 | [ ]    |
| 16| Successful response (200/201) contains all required fields                 | [ ]    |
| 17| Response does not include undocumented fields                              | [ ]    |
| 18| Pagination response includes: total, page, pageSize, data array            | [ ]    |
| 19| Empty results return 200 with empty array — not 404                        | [ ]    |
| 20| Response time is within the SLA defined in `/project-config.md` (`READ_SLA_MS` for GET, `WRITE_SLA_MS` for write operations) | [ ] |

### 3.3 Error Response Validation

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 21| 400 Bad Request returned for invalid input with field-level error detail   | [ ]    |
| 22| 401 Unauthorized returned when no or invalid token is provided             | [ ]    |
| 23| 403 Forbidden returned when authenticated user lacks permission            | [ ]    |
| 24| 404 Not Found returned for non-existent resource IDs                       | [ ]    |
| 25| 409 Conflict returned for duplicate resource creation attempts             | [ ]    |
| 26| 422 Unprocessable Entity returned for semantic validation failures         | [ ]    |
| 27| 500 Internal Server Error does NOT expose stack traces or internal details | [ ]    |
| 28| Error response body follows the standard error schema (code, message, details) | [ ] |
| 29| Error messages are descriptive and actionable — not generic                | [ ]    |

### 3.4 Authentication & Authorization

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 30| Endpoint is inaccessible without a valid authentication token              | [ ]    |
| 31| Expired tokens are rejected with 401                                       | [ ]    |
| 32| Tokens from a different environment are rejected                           | [ ]    |
| 33| Each role can only access endpoints permitted by its authorization level   | [ ]    |
| 34| Cross-user data access is blocked (user A cannot access user B's resources)| [ ]    |

### 3.5 Data Integrity

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 35| Created resource is persisted and retrievable via GET after POST           | [ ]    |
| 36| Updated resource reflects changes accurately after PUT/PATCH               | [ ]    |
| 37| Deleted resource returns 404 on subsequent GET                             | [ ]    |
| 38| Concurrent writes to the same resource are handled without data corruption | [ ]    |
| 39| Transactions are atomic — partial failures roll back completely            | [ ]    |

### 3.6 Integration-Specific

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 40| External API unavailability returns a graceful error — no 500 crash       | [ ]    |
| 41| Timeout from downstream service is handled and surfaced correctly          | [ ]    |
| 42| Retry logic is triggered on transient failures as specified               | [ ]    |
| 43| Webhook/callback payloads match the defined schema                        | [ ]    |

---

## 4. Security Testing Checklist

> **Reference File:** `Basic_Security testing checklist of QC_2020.xlsx`
> **Applies to:** All application layers — frontend, backend API, file handling, and authentication
> **Executor:** Test Agent (Phase 9) + Security review

### 4.1 Authentication

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | Login fails with invalid credentials — correct error message returned      | [ ]    |
| 2 | Login fails with empty credentials — form validation prevents submission   | [ ]    |
| 3 | Account lockout occurs after defined failed login attempts                 | [ ]    |
| 4 | Session token is issued only after successful authentication               | [ ]    |
| 5 | Session token expires after defined inactivity period                      | [ ]    |
| 6 | User is redirected to login on session expiry                              | [ ]    |
| 7 | "Remember me" tokens have a defined and enforced expiry                    | [ ]    |
| 8 | Password fields do not autofill on sensitive forms                         | [ ]    |
| 9 | Passwords are never stored or transmitted in plaintext                     | [ ]    |
| 10| Multi-factor authentication is enforced where `MFA_REQUIRED: true` in `/project-config.md` | [ ]    |

### 4.2 Authorization

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 11| Unauthenticated users cannot access protected routes                       | [ ]    |
| 12| Role-based access is enforced server-side — not only client-side           | [ ]    |
| 13| Privilege escalation is not possible via URL manipulation                  | [ ]    |
| 14| User A cannot view, edit, or delete User B's data                          | [ ]    |
| 15| Admin-only endpoints return 403 for non-admin roles                        | [ ]    |

### 4.3 Input Validation & Injection Prevention

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 16| All user inputs are sanitized before processing or storage                 | [ ]    |
| 17| XSS — `<script>alert(1)</script>` is not executed when rendered           | [ ]    |
| 18| XSS — HTML entities are escaped in all output fields                      | [ ]    |
| 19| SQL Injection — `' OR 1=1 --` returns no data and logs an alert           | [ ]    |
| 20| NoSQL Injection — `{$gt: ""}` operators are blocked in JSON inputs        | [ ]    |
| 21| Command injection — shell metacharacters are blocked in all inputs        | [ ]    |
| 22| Path traversal — `../../../etc/passwd` is blocked in file path inputs     | [ ]    |
| 23| LDAP injection attempts are blocked where applicable                      | [ ]    |

### 4.4 CSRF & CORS

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 24| CSRF tokens are validated on all state-changing operations (POST/PUT/DELETE)| [ ]   |
| 25| CORS policy only allows defined trusted origins                            | [ ]    |
| 26| Cross-origin requests from untrusted origins are blocked                  | [ ]    |

### 4.5 Sensitive Data Exposure

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 27| No sensitive data (passwords, tokens, national IDs, PII) appears in URLs  | [ ]    |
| 28| No sensitive data appears in browser console or client-side logs           | [ ]    |
| 29| No sensitive data appears in error response messages                       | [ ]    |
| 30| No sensitive data appears in page source or hidden form fields             | [ ]    |
| 31| API responses expose only the minimum required data fields                 | [ ]    |
| 32| PII fields are masked in logs (e.g., email shown as `a***@domain.com`)     | [ ]    |

### 4.6 File Upload Security

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 33| Only permitted file types are accepted (validated server-side per `FILE_TYPES_ALLOWED` in `/project-config.md`) | [ ]    |
| 34| Maximum file size is enforced server-side per `MAX_FILE_SIZE_MB` in `/project-config.md` | [ ]    |
| 35| Uploaded files are scanned for malware before storage                      | [ ]    |
| 36| Uploaded files are stored outside the web root                             | [ ]    |
| 37| File names are sanitized — no path separators or shell characters          | [ ]    |
| 38| Executable files are rejected regardless of MIME type                      | [ ]    |

### 4.7 Transport & Security Headers

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 39| All traffic is served over HTTPS — no HTTP endpoints                       | [ ]    |
| 40| `Content-Security-Policy` header is present and correctly configured       | [ ]    |
| 41| `X-Frame-Options: DENY` or `SAMEORIGIN` is set                             | [ ]    |
| 42| `X-Content-Type-Options: nosniff` is set                                   | [ ]    |
| 43| `Referrer-Policy` is set to a restrictive value                            | [ ]    |
| 44| `Permissions-Policy` restricts unnecessary browser features                | [ ]    |
| 45| HSTS header is set with a minimum max-age of 1 year                        | [ ]    |

### 4.8 Session Management

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 46| Session ID is regenerated after successful login (prevents fixation)       | [ ]    |
| 47| Session is fully invalidated on logout                                     | [ ]    |
| 48| Concurrent sessions from different devices are handled per policy          | [ ]    |
| 49| Session cookies have `HttpOnly`, `Secure`, and `SameSite` attributes set   | [ ]    |

---

## 5. Form Validation Checklist

> **Reference File:** `Form_Validation_Checklist_Form_QC v.3.xlsx`
> **Applies to:** Every form and input field in the application
> **Executor:** Test Agent using `/tests/data/[form-name].data.ts`

### 5.1 Mandatory Fields

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | Form cannot be submitted when any mandatory field is empty                 | [ ]    |
| 2 | Mandatory fields are visually marked (e.g., asterisk `*`)                 | [ ]    |
| 3 | Attempting to submit with empty mandatory field shows a specific error     | [ ]    |
| 4 | Error message identifies the specific field that is missing                | [ ]    |
| 5 | Fields pre-populated from the system cannot be cleared without warning     | [ ]    |

### 5.2 Data Format Validation

> **Note:** All format patterns (phone, national ID, date, postal code) are project-specific. Validate against the formats defined in `/project-config.md`. Test data files must include both valid and invalid examples for each configured format.

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 6 | Email fields validate RFC-compliant format (e.g., `user@domain.com`)      | [ ]    |
| 7 | Phone fields validate the format defined in `/project-config.md` (`PHONE_FORMAT`) | [ ]    |
| 8 | National/Government ID fields validate the format defined in `/project-config.md` (`NATIONAL_ID_FORMAT`) — mark N/A if no such field exists | [ ]    |
| 9 | Date fields validate the format defined in `/project-config.md` (`DATE_FORMAT`) and reject invalid dates | [ ]    |
| 10| Numeric fields reject non-numeric characters                               | [ ]    |
| 11| URL fields validate format including scheme (`https://`)                   | [ ]    |
| 12| Postal/ZIP code fields validate format per the locale defined in `/project-config.md` | [ ]    |

### 5.3 Length Constraints

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 13| Fields with minimum length reject input below minimum                      | [ ]    |
| 14| Fields with maximum length reject or truncate input above maximum          | [ ]    |
| 15| Boundary value test: exactly minimum length is accepted                    | [ ]    |
| 16| Boundary value test: exactly maximum length is accepted                    | [ ]    |
| 17| Boundary value test: minimum-1 characters is rejected                      | [ ]    |
| 18| Boundary value test: maximum+1 characters is rejected                      | [ ]    |

### 5.4 Special Input Handling

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 19| Whitespace-only input is rejected as empty for mandatory fields            | [ ]    |
| 20| Leading and trailing whitespace is trimmed before validation               | [ ]    |
| 21| Special characters are handled per the field's defined rules               | [ ]    |
| 22| HTML/script tags are stripped or escaped in text inputs                    | [ ]    |
| 23| SQL injection strings are rejected or safely handled                       | [ ]    |
| 24| Emoji input is handled without encoding errors                             | [ ]    |
| 25| Copy-paste input is validated identically to typed input                   | [ ]    |

### 5.5 File Upload Fields

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 26| Only permitted file types are accepted per `FILE_TYPES_ALLOWED` in `/project-config.md` | [ ]    |
| 27| Files exceeding `MAX_FILE_SIZE_MB` in `/project-config.md` are rejected with a specific error message | [ ]    |
| 28| Single-upload fields prevent multiple file selection                       | [ ]    |
| 29| A clear success indicator is shown after a valid file is selected          | [ ]    |
| 30| File name is displayed to the user after selection                         | [ ]    |
| 31| User can remove a selected file before submission                          | [ ]    |
| 32| Re-uploading replaces the previous file — no duplicates                   | [ ]    |

### 5.6 Dropdown & Select Fields

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 33| Dropdown shows a default placeholder (e.g., "Select an option")           | [ ]    |
| 34| Selecting the placeholder is treated as empty for mandatory fields         | [ ]    |
| 35| All defined options are present and correctly labeled                      | [ ]    |
| 36| Dependent dropdowns update correctly when the parent value changes         | [ ]    |
| 37| Dependent dropdown resets when parent value is cleared                     | [ ]    |

### 5.7 Form Submission Behavior

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 38| Submit button is disabled or shows loading state during active submission  | [ ]    |
| 39| Duplicate form submission is prevented                                     | [ ]    |
| 40| Successful submission displays a confirmation message with a reference ID  | [ ]    |
| 41| Failed submission preserves all previously entered valid data              | [ ]    |
| 42| All validation errors are surfaced simultaneously — not one at a time      | [ ]    |
| 43| Error messages appear adjacent to the relevant field                       | [ ]    |
| 44| Form resets or redirects correctly after successful submission             | [ ]    |

### 5.8 Multilingual Form Validation

> **Applicability:** Execute for each language defined in `/project-config.md` (`LANGUAGES`). Mark the full section N/A with justification for single-language projects.

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 45| Text input in each configured language is accepted without encoding errors | [ ]    |
| 46| Native-script name formats are accepted for each configured language       | [ ]    |
| 47| Validation error messages display in the currently active language         | [ ]    |
| 48| Field labels and placeholders display in the currently active language     | [ ]    |
| 49| Mixed-direction text (RTL script + numbers) renders correctly within fields — applicable only when RTL languages are defined in `/project-config.md` | [ ]    |

---

## 6. Performance Testing Checklist

> **Reference File:** `Performance Testing QCE version 0.8.xlsx`
> **Applies to:** All pages, API endpoints, and critical user journeys
> **Executor:** Test Agent using Lighthouse CLI and k6 or equivalent load testing tool
>
> **Note:** Pass thresholds in this section are organizational standards. Actual measured values are recorded in the Test Report, not in this document.

### 6.1 Core Web Vitals (Frontend)

| # | Metric                          | Pass Threshold |
|---|---------------------------------|----------------|
| 1 | Largest Contentful Paint (LCP)  | < 2.5s         |
| 2 | First Input Delay (FID)         | < 100ms        |
| 3 | Cumulative Layout Shift (CLS)   | < 0.1          |
| 4 | Time to First Byte (TTFB)       | < 800ms        |
| 5 | First Contentful Paint (FCP)    | < 1.8s         |
| 6 | Total Blocking Time (TBT)       | < 200ms        |

### 6.2 Lighthouse Scores

| # | Category        | Minimum Score |
|---|-----------------|---------------|
| 7 | Performance     | ≥ 85          |
| 8 | Accessibility   | ≥ 90          |
| 9 | Best Practices  | ≥ 90          |
| 10| SEO             | ≥ 80          |

### 6.3 API Response Times

> SLA targets are defined per project in `/project-config.md`. The keys referenced below must be populated before this section can be executed.

| # | Check Item                                                                              | SLA Key           | Result |
|---|-----------------------------------------------------------------------------------------|-------------------|--------|
| 11| Read endpoints (GET) respond within SLA under normal load                               | `READ_SLA_MS`     | [ ]    |
| 12| Write endpoints (POST/PUT/PATCH) respond within SLA under normal load                   | `WRITE_SLA_MS`    | [ ]    |
| 13| File upload endpoints respond within SLA                                                | `UPLOAD_SLA_MS`   | [ ]    |
| 14| Search/filter endpoints respond within SLA                                              | `SEARCH_SLA_MS`   | [ ]    |
| 15| Authentication endpoints respond within SLA                                             | `AUTH_SLA_MS`     | [ ]    |

### 6.4 Load Testing

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 16| System handles `PEAK_CONCURRENT_USERS` (per `/project-config.md`) without degradation | [ ]    |
| 17| Response times remain within SLA at 75% of peak load                      | [ ]    |
| 18| Response times remain within SLA at 100% of peak load                     | [ ]    |
| 19| Error rate remains below 1% under peak load                                | [ ]    |
| 20| No memory leaks detected during sustained load test (30-minute soak)      | [ ]    |

### 6.5 Stress Testing

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 21| System degrades gracefully beyond peak load — no hard crash                | [ ]    |
| 22| System recovers automatically after load is reduced                        | [ ]    |
| 23| No data corruption occurs under stress conditions                          | [ ]    |
| 24| Rate limiting engages and returns 429 before system overload               | [ ]    |

### 6.6 Frontend Performance Optimizations

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 25| All images are compressed and served in WebP or AVIF format                | [ ]    |
| 26| Images have explicit `width` and `height` attributes to prevent CLS        | [ ]    |
| 27| Off-screen images use lazy loading                                         | [ ]    |
| 28| No render-blocking scripts in `<head>`                                     | [ ]    |
| 29| CSS and JavaScript are minified and bundled                                | [ ]    |
| 30| Unused CSS and JavaScript are eliminated from the production bundle        | [ ]    |
| 31| API calls on search/filter inputs are debounced                            | [ ]    |
| 32| Long lists use pagination or virtual scrolling                             | [ ]    |
| 33| Event listeners are cleaned up on component unmount (no memory leaks)      | [ ]    |
| 34| Static assets are served with cache-control headers                        | [ ]    |
| 35| Third-party scripts are loaded asynchronously or deferred                  | [ ]    |

---

## 7. Screen Reader & Accessibility Checklist

> **Reference File:** `Screen reader checklist v2.0.xlsx`
> **Standard:** WCAG 2.1 Level AA
> **Tool:** `@axe-core/playwright`
> **Applies to:** All pages and interactive components
> **Executor:** Test Agent (Phase 9)

### 7.1 Automated Scan Results

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | axe-core reports zero **Critical** violations on every page                | [ ]    |
| 2 | axe-core reports zero **Serious** violations on every page                 | [ ]    |
| 3 | axe-core reports zero **Moderate** violations without documented exception | [ ]    |

### 7.2 Keyboard Navigation

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 4 | All interactive elements are reachable using the Tab key                   | [ ]    |
| 5 | Tab order follows a logical and predictable sequence                       | [ ]    |
| 6 | Focus indicator is clearly visible on all interactive elements             | [ ]    |
| 7 | Focus is never lost or trapped unexpectedly during navigation              | [ ]    |
| 8 | Modals and dialogs trap focus within themselves when open                  | [ ]    |
| 9 | Focus returns to the trigger element when a modal is closed                | [ ]    |
| 10| All actions achievable by mouse are also achievable by keyboard            | [ ]    |
| 11| Skip navigation link is provided to bypass repeated navigation blocks      | [ ]    |
| 12| Dropdown menus are navigable using arrow keys                              | [ ]    |
| 13| Forms are fully completable and submittable using keyboard only            | [ ]    |

### 7.3 Screen Reader Compatibility

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 14| All images have descriptive `alt` attributes                               | [ ]    |
| 15| Decorative images use `alt=""`                                             | [ ]    |
| 16| All form fields have associated `<label>` elements or `aria-label`         | [ ]    |
| 17| All buttons have descriptive text labels — no icon-only buttons without `aria-label` | [ ] |
| 18| Links have descriptive text — no "click here" or "read more" links         | [ ]    |
| 19| Error messages are linked to their fields via `aria-describedby`           | [ ]    |
| 20| Loading and status changes are announced via `aria-live` regions           | [ ]    |
| 21| Dynamic content updates (notifications, alerts) are announced to the reader| [ ]    |
| 22| Modal dialogs have `role="dialog"` and a descriptive `aria-label`          | [ ]    |
| 23| Expanded/collapsed state is communicated via `aria-expanded`               | [ ]    |
| 24| Required fields communicate required state via `aria-required="true"`      | [ ]    |
| 25| Invalid fields communicate invalid state via `aria-invalid="true"`         | [ ]    |

### 7.4 Page Structure & Semantics

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 26| Each page has exactly one `<h1>` element                                   | [ ]    |
| 27| Heading hierarchy is logical (h1 → h2 → h3 — no levels skipped)           | [ ]    |
| 28| ARIA landmark roles are used: `main`, `nav`, `header`, `footer`, `aside`  | [ ]    |
| 29| Tables used for tabular data have proper `<th>` elements with `scope`      | [ ]    |
| 30| Lists use semantic `<ul>`, `<ol>`, or `<dl>` elements                      | [ ]    |
| 31| Language is declared on the `<html>` element matching the active language (e.g., `lang="en"`, `lang="fr"`) | [ ]    |
| 32| Page `<title>` is descriptive and unique for each page                     | [ ]    |

### 7.5 Color & Visual

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 33| Text color contrast ratio is at least 4.5:1 against background             | [ ]    |
| 34| Large text (18px+ or 14px bold) contrast ratio is at least 3:1             | [ ]    |
| 35| UI component contrast ratio (borders, icons) is at least 3:1              | [ ]    |
| 36| No information is conveyed by color alone — shape, text, or pattern used  | [ ]    |
| 37| Focus indicator contrast ratio is at least 3:1                             | [ ]    |

### 7.6 Forms & Errors (Accessibility)

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 38| Validation errors are announced to screen readers immediately on submit    | [ ]    |
| 39| Error summary lists all errors with links to the affected fields           | [ ]    |
| 40| Success messages are announced via `role="alert"` or `aria-live`           | [ ]    |
| 41| File upload fields communicate accepted types and limits to assistive tech | [ ]    |

---

## 8. Usability Checklist

> **Reference File:** `Usability Checklist.xlsx`
> **Applies to:** All user-facing pages, forms, and workflows
> **Executor:** Test Agent (Phase 9) + QA Manual Review

### 8.1 Navigation & Information Architecture

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | User always knows where they are in the application (breadcrumbs/title)    | [ ]    |
| 2 | Back navigation returns user to a meaningful and expected previous state   | [ ]    |
| 3 | Main navigation is consistently placed across all pages                    | [ ]    |
| 4 | Active navigation item is visually distinguished                           | [ ]    |
| 5 | All internal links navigate to the correct destination                     | [ ]    |
| 6 | No broken links or 404 pages exist in the application                      | [ ]    |

### 8.2 Forms & User Input

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 7 | Form field labels are clearly associated with their inputs                 | [ ]    |
| 8 | Helpful placeholder text guides input where applicable                     | [ ]    |
| 9 | Users can recover from validation errors without losing previously entered data | [ ] |
| 10| Auto-complete and browser suggestions work correctly on appropriate fields  | [ ]    |
| 11| Mandatory fields are clearly identified before submission attempt          | [ ]    |
| 12| Multi-step forms show progress indicator and allow backward navigation     | [ ]    |

### 8.3 Feedback & System Status

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 13| Loading indicators are displayed for all async operations > 300ms         | [ ]    |
| 14| Success messages are specific and include a reference ID where applicable  | [ ]    |
| 15| Error messages are specific, non-technical, and guide the user to resolution| [ ]   |
| 16| Empty states display helpful guidance — not blank screens                  | [ ]    |
| 17| Destructive actions (delete, cancel, reject) require explicit confirmation | [ ]    |
| 18| Confirmation dialogs clearly state what will happen and cannot be misread  | [ ]    |
| 19| Session timeout warning is displayed before expiry with option to extend (`SESSION_TIMEOUT_MIN` per `/project-config.md`) | [ ]    |

### 8.4 Data Display & Formatting

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 20| Date and time values display in the user's local timezone                  | [ ]    |
| 21| Numbers and currency values display with correct locale formatting per `/project-config.md` | [ ]    |
| 22| Long text is truncated gracefully with a "show more" option if needed      | [ ]    |
| 23| Tables have clear column headers and sortable columns where applicable     | [ ]    |
| 24| Long lists are paginated or have infinite scroll — not infinite DOM growth | [ ]    |
| 25| Search results are clearly presented with the search term highlighted       | [ ]    |

### 8.5 Consistency

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 26| Button labels use consistent terminology throughout the application         | [ ]    |
| 27| Terminology matches the language defined in the project ubiquitous language| [ ]    |
| 28| Icons used for the same action are consistent across all pages             | [ ]    |
| 29| Color coding is consistent — same color always means the same thing        | [ ]    |
| 30| Spacing, typography, and layout patterns are consistent across pages       | [ ]    |

### 8.6 Error Prevention

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 31| Users are warned before navigating away from a form with unsaved changes   | [ ]    |
| 32| Irreversible actions display a second confirmation step                    | [ ]    |
| 33| Bulk actions display a summary of what will be affected before execution   | [ ]    |

---

## 9. Functional Testing Checklist

> **Applies to:** All features defined in `/specs/`
> **Executor:** Test Agent (Phase 6 and Phase 9)

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | All acceptance criteria scenarios are covered by automated tests           | [ ]    |
| 2 | Happy path (valid inputs, expected outcomes) tested for every feature      | [ ]    |
| 3 | Negative path (invalid inputs, rejected submissions) tested for every feature | [ ] |
| 4 | Edge cases (concurrent actions, boundary values, unexpected sequences) tested | [ ] |
| 5 | All defined system statuses are reachable and visually verified            | [ ]    |
| 6 | All status transitions occur correctly and trigger the correct side effects | [ ]    |
| 7 | All notification triggers fire correctly at the correct workflow stages    | [ ]    |
| 8 | All routing and redirection behaviors after actions are verified           | [ ]    |
| 9 | Role-based scenarios tested for every role defined in the specification    | [ ]    |
| 10| Unauthorized access attempts return correct blocked state                  | [ ]    |
| 11| All system-generated reference numbers/IDs are unique and correctly formed | [ ]    |
| 12| All confirmation messages contain the correct reference ID and action name | [ ]    |
| 13| All error messages are specific, actionable, and match the specification   | [ ]    |

---

## 10. Localization & Multilingual Checklist

> **Reference File:** `Localization_Checklist.xlsx`
> **Applies to:** All applications with two or more supported languages as defined in `/project-config.md` (`LANGUAGES`). Mark this entire section `N/A` with justification for confirmed single-language projects.
> **Executor:** Test Agent using parameterized Playwright tests
>
> **Execution Rule:** This checklist must be executed once per configured language. For each language beyond the primary, §10.2–§10.4 must be duplicated and labeled with that language's code. RTL checks (§10.4) apply **only** to languages where `dir: "rtl"` is defined in `/project-config.md` — mark all §10.4 items `N/A` with justification for LTR-only projects.

### 10.1 Language Switching

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | Language toggle is present and functional on all pages                     | [ ]    |
| 2 | Switching from the primary language to any secondary language does not lose form data or reset session state | [ ]    |
| 3 | Switching back to the primary language does not lose form data or reset session state | [ ]    |
| 4 | Selected language is persisted across page navigation                      | [ ]    |
| 5 | Selected language is persisted across browser refresh                      | [ ]    |

### 10.2 Primary Language Content

> Execute for the language defined as `DEFAULT_LANGUAGE` in `/project-config.md`.

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 6 | All static labels, headings, and button text are present in the primary language | [ ]    |
| 7 | All dynamic messages are present in the primary language (errors, confirmations, status) | [ ]    |
| 8 | No placeholder translation keys are visible (e.g., `btn.submit` instead of "Submit") | [ ]    |
| 9 | Spelling and grammar are correct throughout                                | [ ]    |
| 10| Terminology is consistent with the project ubiquitous language and domain context (`DOMAIN_CONTEXT` per `/project-config.md`) | [ ]    |

### 10.3 Secondary Language(s) Content

> Repeat this section independently for each additional language defined in `LANGUAGES` in `/project-config.md`. Label each repetition with the language code (e.g., "§10.3 — `ar`", "§10.3 — `fr`").

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 11| All static labels, headings, and button text are fully translated          | [ ]    |
| 12| All dynamic messages are translated (errors, confirmations, status changes)| [ ]    |
| 13| No primary language text is visible when the application is in this language mode | [ ]    |
| 14| No placeholder translation keys are visible in this language mode          | [ ]    |
| 15| Spelling is correct throughout                                             | [ ]    |
| 16| Terminology is appropriate for the target locale and domain context (`DOMAIN_CONTEXT` per `/project-config.md`) | [ ]    |

### 10.4 RTL Layout

> **Applicability Gate:** Apply only when the project defines one or more languages with `dir: "rtl"` in `/project-config.md`. Mark **all items in this section** `N/A — LTR-only project` for projects with no RTL languages defined. Execute once per RTL language configured.

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 17| Page direction switches to RTL (`dir="rtl"`) when an RTL language is active | [ ]    |
| 18| All form fields are right-aligned in RTL mode                              | [ ]    |
| 19| Dropdown chevrons and input icons appear on the correct side in RTL mode  | [ ]    |
| 20| File upload controls are RTL-compliant                                     | [ ]    |
| 21| Error messages remain adjacent to the correct field in RTL layout          | [ ]    |
| 22| Navigation menus and breadcrumbs render in RTL order                       | [ ]    |
| 23| Tables reverse column order correctly in RTL mode                          | [ ]    |
| 24| Icons and visual indicators are mirrored correctly for RTL                 | [ ]    |
| 25| No layout overflow or clipping is caused by the RTL switch                 | [ ]    |

### 10.5 Locale Formats

> All format values are sourced from `/project-config.md`. If a format key is not defined, mark the corresponding item `N/A — not applicable to this project`.

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 26| Dates display in the format defined in `/project-config.md` (`DATE_FORMAT`) | [ ]    |
| 27| Numbers display with correct locale separators as defined in `/project-config.md` | [ ]    |
| 28| Currency values display with the correct symbol and formatting defined in `/project-config.md` (`CURRENCY`) | [ ]    |
| 29| Phone numbers display in the format defined in `/project-config.md` (`PHONE_FORMAT`) | [ ]    |

### 10.6 Notifications

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 30| Notifications are delivered in the recipient's registered language preference | [ ]    |
| 31| All dynamic values within notifications render correctly in every configured language | [ ]    |
| 32| Notification layout and directionality match the recipient's language setting | [ ]    |

---

## 11. Responsive Design Checklist

> **Applies to:** All pages and components
> **Executor:** Test Agent using `page.setViewportSize()` in Playwright
>
> **Breakpoint Template:** The table below represents the recommended default breakpoints for projects that have not defined custom values. Projects must declare their breakpoints in `/project-config.md` (`BREAKPOINTS_PX`) and reproduce this table with their specific values. The recommended template is not a mandatory set — projects with a narrower device scope may omit breakpoints with documented justification.
>
> **RTL Applicability:** The RTL column applies only when RTL languages are defined in `/project-config.md`. Mark the RTL column `N/A` for LTR-only projects.

| Breakpoint    | Width  | No H-Scroll | No Overflow | Nav Usable | Forms Usable | Touch Targets | Legible Text | RTL Layout (if applicable) |
|---------------|--------|-------------|-------------|------------|--------------|---------------|--------------|----------------------------|
| Mobile S      | 320px  | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |
| Mobile M      | 375px  | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |
| Mobile L      | 425px  | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |
| Tablet        | 768px  | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |
| Laptop        | 1024px | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |
| Desktop       | 1280px | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |
| Large Desktop | 1440px | [ ]         | [ ]         | [ ]        | [ ]          | [ ]           | [ ]          | [ ]                        |

**Additional Checks:**

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | Touch targets are minimum 44×44px on all mobile viewports                  | [ ]    |
| 2 | Body font size is minimum 16px on mobile                                   | [ ]    |
| 3 | Images scale correctly without distortion at all viewports                 | [ ]    |
| 4 | Tables reflow or scroll horizontally gracefully on small screens           | [ ]    |
| 5 | Navigation collapses to a mobile-friendly pattern at defined breakpoints   | [ ]    |
| 6 | No fixed-width elements break the layout at any viewport                   | [ ]    |

---

## 12. Cross-Browser & Cross-Platform Checklist

> **Applies to:** All pages and critical user journeys
> **Executor:** Test Agent using Playwright multi-project configuration
>
> **Browser Matrix:** The columns in the table below must be populated with the browsers defined in `/project-config.md` (`SUPPORTED_BROWSERS`). Remove columns for browsers not in scope. The check items (rows) are mandatory for all included browsers.
>
> **RTL Applicability:** The RTL row applies only when RTL languages are defined in `/project-config.md`. Mark it `N/A` for LTR-only projects.

| Check                                     | ← Add browser columns from `SUPPORTED_BROWSERS` in `/project-config.md` → |
|-------------------------------------------|----------------------------------------------------------------------------|
| All functional tests pass                 |                                                                            |
| No layout breaks or overflow              |                                                                            |
| No JavaScript console errors              |                                                                            |
| No unsupported CSS causing visual breaks  |                                                                            |
| File upload works correctly               |                                                                            |
| Forms submit and validate correctly       |                                                                            |
| Notifications and alerts display correctly|                                                                            |
| Fonts render acceptably                   |                                                                            |
| RTL layout correct — applicable only when RTL languages are defined in `/project-config.md` | |

**Device / OS Matrix:** Reproduce the following table using the device categories defined in `SUPPORTED_DEVICES` in `/project-config.md`.

| Device / OS                         | Browsers to test (per `SUPPORTED_BROWSERS`) | Result |
|-------------------------------------|---------------------------------------------|--------|
| ← Add rows per `SUPPORTED_DEVICES` → |                                             |        |

---

## 13. Regression Testing Checklist

> **Applies to:** All releases, hotfixes, and dependency updates

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | Regression suite covers all previously verified acceptance criteria        | [ ]    |
| 2 | Regression suite is executed in full after every code change               | [ ]    |
| 3 | Regression suite is executed in full after every dependency update         | [ ]    |
| 4 | All tests that were passing before the change still pass after             | [ ]    |
| 5 | Any new regression failures are logged immediately as high-severity defects| [ ]    |
| 6 | Regression suite includes tests for all previously reported and fixed bugs | [ ]    |
| 7 | Regression suite is executed on all required browsers and viewports per `/project-config.md` | [ ]    |
| 8 | Regression suite is executed in all configured languages per `LANGUAGES` in `/project-config.md` — mark N/A for single-language projects | [ ]    |

---

## 14. Logging & Monitoring Checklist

> **Applies to:** All application layers (frontend, backend, integration)

| # | Check Item                                                                 | Result |
|---|----------------------------------------------------------------------------|--------|
| 1 | All significant events are logged (requests, actions, errors, state changes)| [ ]   |
| 2 | Log entries contain: timestamp, user ID, action, result, error message     | [ ]    |
| 3 | No PII is present in logs (emails, passwords, national IDs, tokens)        | [ ]    |
| 4 | PII fields are masked where logging is required (e.g., `a***@domain.com`)  | [ ]    |
| 5 | Log format is consistent and machine-parseable (JSON preferred)            | [ ]    |
| 6 | Logs are written at the correct severity level (DEBUG/INFO/WARN/ERROR)     | [ ]    |
| 7 | Critical errors trigger monitoring alerts as defined in the architecture   | [ ]    |
| 8 | SLA breach conditions trigger alerts automatically                         | [ ]    |
| 9 | Failed notification deliveries are logged and alertable                    | [ ]    |
| 10| Log retention policy is implemented per the defined requirement            | [ ]    |
| 11| Log access is restricted to authorized roles only                          | [ ]    |

---

## 15. Bug Reporting Standards

> **Standard:** VSTS Bug Management
> **Applies to:** All defects found during any testing phase

Every bug report must include all of the following fields:

| Field              | Required Content                                                             |
|--------------------|------------------------------------------------------------------------------|
| **Bug Title**      | Clear, concise summary: `[Page/Component] — [What is wrong]`                |
| **Steps to Reproduce** | Numbered, reproducible steps from precondition to failure               |
| **Preconditions**  | System state, user role, and data required before step 1                    |
| **Expected Result**| Exact behavior per the specification or acceptance criterion                |
| **Actual Result**  | Exact behavior observed during testing                                      |
| **Impact**         | Functional / UI / Performance / Security / Localization / Accessibility     |
| **Testing Type**   | Functional / Security / Performance / Accessibility / Localization / Regression |
| **Severity**       | Critical / High / Medium / Low (see severity definitions below)             |
| **Priority**       | P1 / P2 / P3 / P4                                                           |
| **Status**         | New / Assigned / In Progress / Fixed / Ready for Retest / Closed / Reopened |
| **Testing Environment** | Dev / QA / Staging / Production                                        |
| **Browser / Device** | Browser name + version, OS, device type                                  |
| **Language Mode**  | Active language at time of defect (per configured `LANGUAGES`)              |
| **Test Evidence**  | Screenshots, screen recordings, network traces, console logs               |
| **Spec Reference** | FR-XXX / AC-XXX from `/specs/`                                              |
| **Build / Version**| Application build or release version under test                            |

### Severity Definitions

| Severity | Definition                                                                  |
|----------|-----------------------------------------------------------------------------|
| Critical | System crash, data loss, security breach, authentication failure, complete feature blockage |
| High     | Major functionality broken, incorrect business logic, data integrity failure, incorrect status transitions, broken localization rendering content inaccessible in a configured language, broken accessibility rendering a feature unreachable by assistive technology users |
| Medium   | Feature partially broken, incorrect validation behavior, missing error messages, incorrect content |
| Low      | Minor UI inconsistency, cosmetic issue, non-critical text error, edge case with low impact |

---

## 16. Release Readiness — Go/No-Go Criteria

Every release must satisfy all of the following criteria before a Go decision is made:

| # | Criterion                          | Go Condition                                                      | Actual | Decision  |
|---|------------------------------------|-------------------------------------------------------------------|--------|-----------|
| 1 | Acceptance criteria coverage       | 100% of acceptance criteria have passing tests                    |        | GO/NO-GO  |
| 2 | Critical open defects              | Zero open Critical severity defects                               |        | GO/NO-GO  |
| 3 | High open defects                  | Zero open High severity defects without approved waiver           |        | GO/NO-GO  |
| 4 | Performance targets                | All Core Web Vitals and Lighthouse targets met                    |        | GO/NO-GO  |
| 5 | Security checklist                 | All security checklist items PASS                                 |        | GO/NO-GO  |
| 6 | Accessibility                      | Zero axe-core Critical or Serious violations                      |        | GO/NO-GO  |
| 7 | Regression suite                   | 100% of regression tests passing                                  |        | GO/NO-GO  |
| 8 | Primary language                   | All primary language content and functional checks passing        |        | GO/NO-GO  |
| 9 | Secondary language(s)              | All secondary language content, locale format, and input checks passing — one criterion per configured language — mark N/A for single-language projects |        | GO/NO-GO  |
| 10| RTL layout                         | All RTL layout checks passing — mark N/A if no RTL languages are configured | | GO/NO-GO  |
| 11| All L2 checklists                  | All checklist items PASS or documented N/A                        |        | GO/NO-GO  |
| 12| Environment stability              | Staging environment stable and representative                     |        | GO/NO-GO  |
| 13| Traceability matrix                | All acceptance criteria traced to passing tests                   |        | GO/NO-GO  |

### Overall Release Decision

```
[ ] GO       — All criteria met. Release approved by QA.
[ ] NO-GO    — One or more criteria not met. Blocking items listed below.
```

**Blocking items (if NO-GO):**
- [List each blocking criterion and its current state]

---

## 17. Checklist Execution Rules

1. **All applicable checklists must be executed** for every feature and release. A checklist is not applicable only if the feature explicitly has no relevance to that domain (e.g., a feature with no forms skips the Form Validation checklist). This must be documented as N/A with justification.

2. **Every checklist item must have a recorded result:** `PASS`, `FAIL`, or `N/A — [justification]`. No items may be left blank.

3. **FAIL items block the Definition of Done.** A story or release cannot be marked Done while any checklist item is in FAIL state without an approved, time-bounded waiver logged in `/tech-debt-backlog.md`.

4. **Checklists must be re-executed after any fix** that addresses a FAIL item. The re-execution result must be recorded separately.

5. **Checklist results must be included in the Test Report** using the format defined in the Test Agent Definition document.

6. **New checklist items may be proposed** by any team member via a pull request to this document. All additions must be reviewed and approved before they become mandatory.

7. **Checklists apply to all configured languages** wherever multilingual is applicable. A checklist item is only PASS if it passes in all languages defined in `/project-config.md`. Single-language projects mark multilingual items N/A with justification.

8. **The `/project-config.md` file is a prerequisite.** No test execution phase may begin without a complete and approved `/project-config.md` for the project. Incomplete configuration is a QA blocker equivalent to a FAIL on all dependent checklist items.

---

*This document is maintained by the QA Chapter. Proposals for changes should be submitted as pull requests to `/L2-Steering-Testing/`.*
