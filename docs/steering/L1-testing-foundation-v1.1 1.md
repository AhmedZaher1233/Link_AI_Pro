# L1 — Testing Foundation

---

| Field            | Value                                    |
|------------------|------------------------------------------|
| **Authority**    | L1 — Organization-wide (highest)        |
| **Owner**        | Engineering Lead / QA Chapter Lead      |
| **Version**      | 1.1                                      |
| **Review Cycle** | Every 6 months or on major process change|
| **Status**       | Active                                   |

---

## Purpose

This document defines the organization-wide principles, standards, and minimum requirements for software testing. It applies to all software projects, all teams, and all technology stacks across the organization.

---

## Scope

This document governs all source code, test activities, CI/CD pipelines, and environments across the organization.

It does **not** govern:
- Stack-specific tooling choices — defined at L2
- Project-specific SLAs, coverage overrides, or enforcement thresholds — defined at L3
- Individual agent responsibilities — defined in agent definition documents

---

## Document Hierarchy

| Level | Name        | Authority           | Defines                                                          |
|-------|-------------|---------------------|------------------------------------------------------------------|
| **L1**| Foundation  | Organization-wide   | Principles, standards, and minimum requirements (this document) |
| **L2**| Stack       | Technology-specific | Language, framework, and tool-specific implementation guidance   |
| **L3**| Project     | Project-specific    | Project overrides, SLA targets, enforcement thresholds, exemptions|

**Resolution order:** L3 overrides L2 which overrides L1, but only in the direction of stricter requirements. Any L3 exemption from an L1 requirement must be documented and reviewed by the Engineering Lead.

---

## Glossary

| Term                      | Definition                                                                                       |
|---------------------------|--------------------------------------------------------------------------------------------------|
| **AAA Pattern**           | Arrange-Act-Assert: the three-phase structure every test must follow                             |
| **Acceptance Criterion**  | A condition that a feature must satisfy to be accepted by QA and the business                   |
| **Branch Coverage**       | The percentage of decision branches (if/else, switch) exercised by tests                        |
| **CI/CD**                 | Continuous Integration / Continuous Delivery — the automated pipeline from commit to deployment |
| **Component Test**        | A test that validates a single UI or backend component in isolation                             |
| **DAST**                  | Dynamic Application Security Testing — testing a running application for vulnerabilities        |
| **E2E Test**              | End-to-end test — a test that exercises a full user journey through the complete stack           |
| **Ice Cream Cone**        | An anti-pattern where tests are dominated by slow E2E tests with few fast unit tests            |
| **Integration Test**      | A test that validates the interaction between two or more components or services                |
| **Line Coverage**         | The percentage of source code lines executed by tests                                           |
| **Regression Suite**      | A curated set of tests that validates previously verified functionality has not been broken      |
| **SAST**                  | Static Application Security Testing — analyzing source code for vulnerabilities                 |
| **Smoke Test**            | A fast, minimal test run immediately after deployment to confirm the system is operational       |
| **Test Pyramid**          | The recommended distribution of tests: many unit, some integration, few E2E                     |
| **Traceability Matrix**   | A document mapping every test to its corresponding requirement or acceptance criterion           |
| **Unit Test**             | A test that validates a single function, method, or class in complete isolation                 |
| **Visual Regression Test**| A test that detects unintended visual changes by comparing screenshots between builds           |

---

## 1. Test Strategy

### 1.1 The Test Pyramid

All projects must maintain a test distribution that follows the test pyramid model:

| Test Type   | Target Distribution | Characteristics                                    |
|-------------|---------------------|----------------------------------------------------|
| Unit        | ~70%                | Fast, isolated, no external dependencies           |
| Component   | Included in unit %  | Single UI or backend component in isolation        |
| Integration | ~20%                | Cross-component and cross-service interactions     |
| End-to-End  | ~10%                | Critical user journeys through the full stack      |

The exact distribution may be adjusted at L3 to reflect the nature of the system. The principle — most tests must be fast and isolated — does not change.

### 1.2 Anti-Patterns — Prohibited

**Ice cream cone:** A suite dominated by slow E2E tests with minimal unit coverage. This is the most common testing failure mode and must be corrected.

**Coverage without assertions:** Tests that execute code but assert nothing meaningful inflate coverage metrics while providing zero safety. Every test must assert a specific, verifiable outcome.

**Testing implementation details:** Tests that assert on private methods or internal state rather than observable behavior. Tests must verify behavior through public interfaces.

**Over-mocking:** Replacing so many dependencies with mocks that the test no longer validates anything real.

### 1.3 Test-First Principle

All new features and bug fixes must be accompanied by tests written before or alongside the code. Tests are a first-class deliverable of every change — not an afterthought.

### 1.4 Test Types Overview

| Test Type           | Required                | Authority Level for Specifics  |
|---------------------|-------------------------|--------------------------------|
| Unit                | Yes                     | L1 principles, L2 tooling      |
| Component           | Yes                     | L1 principles, L2 tooling      |
| Integration         | Yes                     | L1 principles, L2 tooling      |
| End-to-End          | Yes                     | L1 principles, L2 tooling      |
| Smoke               | Yes                     | L1 principles, L2 tooling      |
| Regression          | Yes                     | L1 principles, L2 tooling      |
| Performance         | Yes                     | L1 principles, L2 tooling      |
| Security            | Yes                     | L1 principles, L2 tooling      |
| Accessibility       | Yes                     | L1 principles, L2 specifics    |
| Localization / i18n | Yes (bilingual systems) | L1 principles, L2 specifics    |
| Visual Regression   | Recommended             | L3 enforcement decision        |

---

## 2. Coverage Requirements

### 2.1 Minimum Coverage Targets

Coverage must be measured using **both line coverage and branch coverage**. Meeting only one is insufficient.

| Layer                          | Minimum Coverage | Target Coverage |
|--------------------------------|------------------|-----------------|
| Domain logic / business rules  | 90%              | 95%             |
| Service layer                  | 80%              | 90%             |
| API layer                      | 70%              | 80%             |
| Frontend components            | 70%              | 80%             |
| Utility / shared libraries     | 90%              | 95%             |
| Infrastructure / adapters      | 60%              | 70%             |

**Minimum** is the floor that must not be breached. **Target** is the expected steady-state for a mature codebase.

### 2.2 Coverage Quality Principle

High coverage does not guarantee test quality. A suite can achieve 95% line coverage while making no meaningful assertions. Coverage is necessary but not sufficient — tests must assert correct outcomes, not just execute code.

### 2.3 Coverage Exclusions

The following may be excluded from coverage measurement at L3 discretion, with documented justification:
- Auto-generated code (ORM migrations, generated clients)
- Configuration and environment bootstrapping
- Test files themselves

Exclusion rules must be declared in the L3 document and enforced in CI — not applied silently.

### 2.4 Coverage Enforcement

Coverage enforcement mechanism (hard block, soft block, or report-only) is defined at L3. Every project must declare its mechanism. Coverage results must be published on every CI run and visible to the team.

---

## 3. Test Structure and Quality Standards

### 3.1 The AAA Pattern

All tests must follow the **Arrange-Act-Assert** (AAA) pattern:

- **Arrange** — set up all test data, dependencies, and preconditions
- **Act** — execute exactly one behavior under test
- **Assert** — verify the expected outcome with specific, meaningful assertions

Each test must focus on a single behavior. If a test needs to verify two distinct behaviors, split it into two tests. Language-specific examples are defined at L2.

### 3.2 Test Naming

Test names must describe the behavior being verified — not the implementation. A well-named test is understandable without opening the test body.

Required elements in a test name: the subject, the condition or input scenario, and the expected outcome. Test names must use domain language — not technical implementation terms.

### 3.3 Test Readability

A test must be readable without context. Every test is documentation — it captures a behavioral contract between the system and its requirements. Treat test code with the same readability standard as production code.

### 3.4 Test Review Requirements

Tests are subject to the same code review process as production code. Reviewers must verify:
- The test covers the behavior described in the acceptance criterion
- The test would fail if the described behavior were absent or broken
- The test follows the AAA structure and naming standards
- The test does not exhibit any prohibited anti-patterns

A change that adds production code without corresponding tests must not be approved without documented justification.

---

## 4. Negative Testing

All test suites must include negative test cases. For every feature, tests must also cover:

- Invalid inputs — values that violate type, format, length, or business rules
- Boundary conditions — values at the exact edge of valid ranges (min, max, min-1, max+1)
- Missing required inputs — empty, null, or whitespace-only values for mandatory fields
- Unauthorized access — operations attempted by roles that should not be permitted
- Error recovery — correct system behavior when a failure occurs

The principle: if a behavior is defined — including error behavior — it must be tested.

---

## 5. Test Isolation

- Tests must be **independent** — the outcome of one test must not affect any other, regardless of execution order.
- Tests must be **stateless** — no shared mutable state between test cases.
- Tests must be **repeatable** — the same test must always produce the same result.
- Tests must be **self-contained** — all preconditions are established within the Arrange phase, not assumed from prior tests.
- External dependencies must be mocked or stubbed in unit tests. Integration and E2E tests may use real or containerized dependencies.

---

## 6. Test Data Management

### 6.1 Test Data Creation

- Use factory methods or builder patterns for all test data. Raw object construction in test bodies is prohibited.
- Test data must be realistic and domain-meaningful — not generic placeholders like `"test"` or `123`.
- Test data must never contain production PII. Use anonymized or synthetically generated data.

### 6.2 Bilingual Test Data

For bilingual systems, test data must cover all supported locales explicitly — including valid and invalid inputs per locale and locale-specific formats (dates, numbers, phone numbers).

### 6.3 Test Data Cleanup

Every test must clean up the state it creates. The cleanup strategy must be defined at L2 per test type: transaction rollback, dataset truncation, or test-scoped seed reset for integration tests; known clean state after each E2E run.

---

## 7. Test Environments

### 7.1 Environment Definitions

| Environment | Purpose                               | Test Types Permitted                         |
|-------------|---------------------------------------|----------------------------------------------|
| Dev         | Individual developer verification     | Unit, component, integration (local)         |
| QA          | Full test suite execution by QA       | All types except load/stress tests           |
| Staging     | Pre-release validation                | All types including performance and security |
| Production  | Live system — minimal intervention    | Smoke tests only                             |

### 7.2 Environment Parity

Staging must match Production in all configuration that affects test validity: infrastructure, environment variables, third-party integrations, and representative data volumes. Discrepancies must be documented.

### 7.3 Environment Stability Gate

No test run may begin against an unstable environment. Confirm all required services are healthy, test data is seeded, and API dependencies are reachable before execution starts. Environment failures must be reported as environment issues — not attributed to the code under test.

### 7.4 Production Policy

The following are prohibited in Production without explicit, documented authorization:
- Load tests, stress tests, or any artificial traffic generation
- Active security scanning (DAST)
- Data mutation tests

Smoke tests after deployment are permitted and required.

---

## 8. Smoke Testing

### 8.1 Smoke Test Requirement

A smoke test suite must be defined for every system. Smoke tests are a fast, minimal run executed immediately after each deployment to confirm the system is operational.

Smoke tests must validate:
- The application starts and responds to requests
- Core authentication flows complete successfully
- At least one critical user journey completes end-to-end

### 8.2 Smoke Test Execution

Smoke tests must run automatically as the final step of every deployment pipeline. A failed smoke test blocks the deployment from being considered successful and triggers an immediate rollback or alert.

---

## 9. Regression Testing

### 9.1 Regression Suite Requirement

Every project must maintain a regression suite that verifies all previously confirmed functionality continues to work correctly. It must:
- Cover all signed-off acceptance criteria
- Be executable in CI without manual setup
- Produce a clear pass/fail result

### 9.2 Regression Execution Triggers

The full regression suite must run:
- After every significant change merged to the main branch
- After every hotfix or dependency update
- Before every release candidate is promoted to Staging

### 9.3 Regression Failure Policy

Any regression failure is a **blocking event**. It must be immediately triaged, treated as a high-severity defect, and resolved before the build proceeds. Regression failures must never be silently bypassed.

---

## 10. Security Testing

### 10.1 Requirement

Security testing is mandatory for all systems. It is not deferred until after release.

### 10.2 Required Security Test Categories

| Category                        | Description                                                              | When Required           |
|---------------------------------|--------------------------------------------------------------------------|-------------------------|
| **Static Analysis (SAST)**      | Automated scanning of source code for known vulnerability patterns       | Every pull request      |
| **Dependency Scanning**         | Scanning third-party packages for known CVEs                             | Every pull request      |
| **Secret Detection**            | Scanning commits and code for hardcoded credentials, tokens, and keys    | Every commit            |
| **Dynamic Analysis (DAST)**     | Active scanning of a running application for exploitable vulnerabilities | Pre-release on Staging  |
| **Authentication & Authorization** | Access controls correctly enforced server-side                        | Every release cycle     |
| **Input Validation**            | Injection vulnerabilities, boundary violations, and malformed input      | Every release cycle     |

### 10.3 Vulnerability Resolution Policy

| Severity | Resolution Required Within                          |
|----------|-----------------------------------------------------|
| Critical | Before the next merge to main — no exceptions      |
| High     | Before the next release candidate is promoted      |
| Medium   | Within the next two iterations                     |
| Low      | Within the next four iterations or accepted as tech debt|

Critical and High findings block release. A team may not defer a Critical security finding — it must be fixed.

### 10.4 Security Testing Scope

OWASP Top 10 coverage, penetration testing scope, compliance requirements, and CI integration are defined at L2 and L3.

---

## 11. Performance Testing

### 11.1 Requirement

Performance testing is mandatory for all systems with defined SLAs or public-facing interfaces. Systems not tested under realistic load must not be released to production.

### 11.2 Required Performance Test Categories

| Category            | Purpose                                                   | Required For                               |
|---------------------|-----------------------------------------------------------|--------------------------------------------|
| **Baseline**        | Establish performance reference before changes            | Start of every release cycle               |
| **Load Test**       | Validate behavior under expected concurrent user volume   | Every release candidate                    |
| **Stress Test**     | Identify system breaking point and failure behavior       | Major releases and infrastructure changes  |
| **Spike Test**      | Validate recovery from sudden traffic bursts              | Features with unpredictable usage patterns |
| **Soak / Endurance**| Detect memory leaks and degradation over extended runtime | Long-running services and background jobs  |

### 11.3 What Performance Tests Must Validate

- Response time under normal and peak load — measured at the 95th percentile
- Error rate — must remain within SLA thresholds under all load conditions
- Resource utilization — CPU, memory, and I/O within safe operational bounds
- Recovery — system returns to normal performance after a spike subsides

### 11.4 SLA Targets and Environment

SLA targets are defined at L3. Performance tests must only run against Staging — never against Production and not on every CI commit. Tooling is defined at L2.

---

## 12. Accessibility Testing

### 12.1 Requirement

Accessibility is required for all user-facing systems. Accessibility failures exclude users with disabilities and in many jurisdictions constitute a legal compliance failure.

### 12.2 Minimum Expectations

The following are non-negotiable for all user-facing systems:
- All interactive elements must be keyboard-navigable
- All images and non-text content must have meaningful text alternatives
- Color alone must not be used to convey meaning
- Text must meet minimum contrast ratios against its background
- Dynamic content changes must be announced to assistive technologies

Conformance target (WCAG 2.1 AA recommended), automated scanning tools, and CI integration are defined at L2.

---

## 13. Localization and Internationalization Testing

### 13.1 Requirement

For any system supporting multiple languages or locales, localization testing is a mandatory quality dimension equivalent in priority to functional testing. A feature that works in one locale but fails in another is a defect.

### 13.2 Required Coverage Areas

Localization testing must cover, at minimum:
- **Translation completeness** — no untranslated strings in any supported locale
- **Text directionality** — RTL layout validated where applicable; element order and flow must reflect the correct reading direction
- **Locale-specific formats** — dates, times, numbers, currencies, and phone numbers correct per locale
- **Input acceptance** — all text fields correctly accept, store, and display input in all supported scripts
- **Language switching** — toggling between locales must not lose user state, reset sessions, or produce errors
- **Dynamic content** — system-generated messages and notifications translated and contextually correct

Tooling, test case templates, and RTL validation standards are defined at L2.

---

## 14. Visual Regression Testing

### 14.1 Recommendation

Visual regression testing is recommended for projects with significant UI complexity, bilingual or RTL layout requirements, or frequent frontend changes. It detects layout breaks, style regressions, and RTL misalignments that functional tests do not catch.

It should be treated as mandatory at L3 discretion for projects with bilingual requirements, shared design system components, or documented UI consistency requirements.

Whether mandatory, recommended, or optional for a given project is defined at L3. Tooling standards are defined at L2.

---

## 15. Traceability

### 15.1 Traceability Requirement

Every test must be traceable to a requirement, acceptance criterion, or specification. Traceability enables verification that all requirements are tested before release, impact analysis when requirements change, and audit evidence.

### 15.2 Traceability Matrix

Every project must maintain a **Traceability Matrix** mapping each test to its corresponding specification requirement or acceptance criterion. The matrix must be updated with every code review that adds or modifies tests and reviewed before every release.

### 15.3 Coverage Gaps

Any acceptance criterion without a corresponding test must be logged in the technical debt backlog. Coverage gaps are not acceptable in production releases without documented risk acceptance.

---

## 16. Defect Management

### 16.1 Defect Severity Definitions

| Severity     | Definition                                                                                        |
|--------------|---------------------------------------------------------------------------------------------------|
| **Critical** | System is unusable, data is at risk, security is compromised, or a core business flow is blocked |
| **High**     | A significant feature is broken with no acceptable workaround                                    |
| **Medium**   | A feature has degraded behavior; a workaround exists                                             |
| **Low**      | Minor cosmetic issue, edge case behavior, or documentation inconsistency                         |

### 16.2 Defect Reporting Standard

All defects must be reported with:
- Clear title summarizing the defect
- Numbered, reproducible steps from precondition to failure
- Expected result (per specification) and actual result (observed behavior)
- Severity classification, testing environment, and build version
- Test evidence (screenshot, log output, or test failure output)

Defect tooling is defined at L2 or L3.

### 16.3 Release Blocking Defects

The following are release-blocking and must be resolved before any production deployment:
- Any open **Critical** severity defect
- Any open **High** severity defect without a documented, approved workaround

Medium and Low defects may be released with documentation in the release notes and a tracked remediation plan.

---

## 17. CI/CD Pipeline and Quality Gates

### 17.1 Pipeline Stage Requirements

| Stage                  | Trigger                             | Required Tests                                       |
|------------------------|-------------------------------------|------------------------------------------------------|
| **Commit gate**        | Every commit                        | Secret detection, SAST lint                          |
| **Pull request gate**  | Every pull request                  | Unit, component, integration, dependency scan        |
| **Merge gate**         | Merge to main                       | Full unit, integration, E2E, coverage report         |
| **Staging deployment** | Before promotion to Staging         | Full regression suite, smoke tests                   |
| **Pre-release gate**   | Release candidate promotion         | Full suite including performance (scheduled)         |
| **Post-deployment**    | After every deployment              | Smoke tests                                          |

### 17.2 Quality Gate Standards

- **Test failures block merge.** Exceptions require Engineering Lead approval and must not become routine.
- **Coverage must be reported on every CI run.** Coverage reporting may not be disabled.
- **Security scan failures block merge.** Critical and High SAST or dependency findings block merge just as test failures do.

### 17.3 Pipeline Test Reporting

All test results must be published in a standard, machine-readable format (JUnit XML or equivalent) to enable trend analysis and historical coverage comparison. Reporting format is defined at L2.

---

## 18. Roles and Responsibilities

| Role                        | Testing Responsibilities                                                                        |
|-----------------------------|-------------------------------------------------------------------------------------------------|
| **Developer**               | Write unit, component, and integration tests for all new code. Maintain test quality.          |
| **QA Engineer**             | Define test scenarios and acceptance criteria. Review coverage. Execute and sign off on validation phases. |
| **Engineering Lead**        | Own this document and enforce standards. Approve exceptions. Review quality trends.             |
| **Test Design Agent**       | Generate test cases from accepted requirements. Maintain coverage and traceability.             |
| **Test Automation Agent**   | Generate automation code from approved test cases. Maintain CI-ready test suite.               |
| **Test Execution Agent**    | Execute functional, integration, E2E, and accessibility test suites. Produce execution reports.|
| **Performance Testing Agent** | Own all performance test planning, execution, and reporting.                                |
| **Security Testing Agent**  | Own all security test planning, execution, and reporting.                                      |
| **Test Review Agent**       | Audit test artifacts for completeness, quality, and traceability.                              |

---

## Appendix A — Document Change Log

| Version | Date   | Author   | Summary of Changes                                  |
|---------|--------|----------|-----------------------------------------------------|
| 1.0     | [Date] | [Author] | Initial release                                     |
| 1.1     | [Date] | [Author] | Removed Flaky Tests and Contract Testing sections. Reordered sections. Trimmed to minimum requirements. |

---

## Appendix B — Related Documents

| Document                       | Location                     | Relationship                         |
|--------------------------------|------------------------------|--------------------------------------|
| L2 — Backend Testing Standards | `/steering/L2-backend/`      | Stack-specific tooling and patterns  |
| L2 — Frontend Testing Standards| `/steering/L2-frontend/`     | Stack-specific tooling and patterns  |
| L2 — Testing Checklists        | `/steering/L2-Testing/`      | Executable checklists per test type  |
| L3 — Project Testing Overrides | `/steering/L3-project/`      | Project SLAs, enforcement, exemptions|
| Traceability Matrix            | `/traceability-matrix.md`    | Per-project requirement-to-test map  |
| Technical Debt Backlog         | `/tech-debt-backlog.md`      | Per-project test coverage debt       |
| Agent Definition Documents     | `/agents/`                   | Specialist testing agent definitions |
