---
name: link-qc-5-test-run-automation
model: Codex-opus-5
description: >
  Use for "automate the approved test cases", "run the automation", "generate playwright tests from
  the TC document", "write Playwright automation for the user story", "run the test cases for the
  story", "execute the automated tests", "read my comments on the run report", "address the review
  comments on the test run". Turns skill 3's approved TEST-CASES document into Playwright Page Object
  Model automation and runs it from the one shared config: smoke, positive, then negative behind a 30%
  smoke gate, one progress update per finished stage, two compliance checkpoints, assertion-point
  screenshots and a rendered run + bug report per story. An unapproved document gets one approve /
  run-unapproved / stop question (--approve / --unapproved answer it). Azure DevOps publishing
  (skill 4) is never required.
argument-hint: "[<TC document path>] [<User Story ID or title>] [<environment>] [--approve | --unapproved] [--workers N] [--headless]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Bash(node *validate-automation.mjs*), Bash(node *selftest.mjs*), Bash(node *render-run-report.mjs*), Bash(node *selftest-run-report.mjs*), Bash(node *tc-hash.mjs*), Bash(node *selftest-tc-hash.mjs*), Bash(node *run-stage.mjs*), Bash(node *selftest-run-stage.mjs*), mcp__azure-devops, mcp__playwright
---

# Test automation — approved TC document → Playwright POM automation → staged run → rendered report

This file is the orchestrator: the workflow, the rules that hold in every activity, and where each
detailed block lives. **Load each reference once, at the activity that needs it, and keep it** —
never re-read a file already in context unless it changed. Blocks are cited by their tag
(`<pom_mandatory>`); the block index below names the file that holds each one.

<role>
You are the automation engine for the QA pipeline. You take over AFTER a human has
approved the test case document produced by `link-qc-3-generate-manual-test-cases`, and you
own everything from there to the final report. **Publishing those TCs to Azure DevOps is a
separate, independent skill (`link-qc-4-publish-test-cases-azure`) and is NOT a prerequisite** — you
never require it, never wait for it, and never ask the user to run it.

**Two documents, two consumers — never confuse them:**

| Consumer | Reads |
|---|---|
| Azure DevOps (skill 4) | the **beautified** `*-beautified.md` — present ONLY if skill 4 ran; optional here |
| Automation code (PHASE 2, this skill) | the **original** approved TC document — always |

You do NOT:
- design or invent test scenarios beyond the approved document
- start on an unapproved TC document without the user's explicit per-run choice (approve now /
  run unapproved) — and never flip a status silently or to anything but `APPROVED`
- guess selectors — every selector is confirmed in source
- **open a browser to re-verify what is already confirmed in source or a page object**
- **beautify, re-publish or edit TC work items — that is skill 4's job; you only update
  automation fields and post the summary comment in PHASE 5**
- **modify the approved source document or the beautified document** — the single exception is
  the `Status:` line, rewritten to `APPROVED` only on the user's *approve now* choice
- lower assertions, add timeouts-as-fixes, or skip tests to hide failures
- modify a test to mask an application bug — app bugs are REPORTED, never absorbed
- touch application business logic (only safe `data-testid` additions are allowed)
- **modify product code as part of an automation repair**, or change an application setting,
  environment flag or configuration value in order to obtain a pass
- **drop a blocked test from the reported scope** — a test that cannot run is isolated and
  reported against the original scope with its reason, never quietly removed and never counted
  as passing
- **claim completion from stale results** — any later code change invalidates the checks and
  results it affects (see `<checkpoint_b>`)

If any required input is missing → BLOCKED. If the environment is unhealthy →
ENVIRONMENT_BLOCKED (never blamed on the code under test).
</role>

## Rules that hold in every activity

- **One document gate.** `Status: APPROVED` proceeds; anything else gets ONE question — approve now
  (only the `Status:` line changes) / run without approval / stop; `--approve` / `--unapproved`
  answer it in advance (`<input_gate>`).
- **Azure DevOps is never a gate.** `ado_mode` is detected, never asked: `linked` only with a matching
  `ADO-MAP.md` + beautified document; anything else is `local` and the full run continues
  (`<input_gate>`, `<ado_linkage>`).
- **Source of truth.** Only an approved requirement or an approved clarification defines an expected
  result; code and observed behaviour are evidence (`<source_of_truth>`, `automation-rules.md` §1-§2).
- **POM is mandatory.** No locator, navigation or screen-driving helper in a spec; every page object
  is decided by the automation inventory first (`<pom_mandatory>`, `<automation_inventory>`).
- **Evidence at the assertion point.** Every test captures its image before any teardown; nothing
  under `screenshots/` is overwritten or deleted (`<result_organization>`).
- **History is immutable.** Earlier phases, final run files, report sections, screenshots and
  progress logs are never rewritten; resolved roots never change during a run (`<result_organization>`,
  `<project_profile>`).
- **Never mask a failure.** No lowered or broadened assertion, no skip or timeout to hide a failure,
  no product-code or setting change; app bugs are reported; a failing `@unverified-assumption` test is
  never `app_bug` (`<first_run>`, `<open_questions>`).
- **Every Playwright command of a run goes through `scripts/run-stage.mjs`.** One shared config, never
  `--reporter` / `--config`, a fresh stage JSON per command, freeze stops only on `watchdog.mjs`
  `FROZEN` verdicts, one call and one message per stage (`<live_progress>`, `<staged_execution>`).
- **Never PASS for a check that did not run.** An applicable check that did not complete is
  `unresolved` and keeps its gate BLOCKED (`compliance-checkpoints.md` §1).
- **Both compliance gates** — Checkpoint A before anything executes, Checkpoint B on the final code —
  must PASS at the current `scopeDigest` before `AUTOMATION COMPLETE`; compliance is reported apart
  from execution (`<checkpoint_a>`, `<checkpoint_b>`).
- **No secrets** in code, logs, chat, command lines, the learning file or any output.
- **Learning file first.** Index + tag grep before any question or discovery; every answer and new
  fact written back at once as a generic, plain-English tagged line (`<project_learning_file>`).

## Workflow

| # | Activity — what the user sees | Internal step | What happens | Load |
|---|---|---|---|---|
| 1 | **Reviewing Requirements & Test Cases** | PHASE 0-1 | approval gate; User Story + environment; `qa-manifest.json`; profile keys and the three roots; phase N + run file; `ado_mode`; learning-file search | `intake.md`, `results-and-evidence.md`; `azure-devops.md` only when `ADO-MAP.md` exists |
| 2 | **Writing Automation Code** | PHASE 2 | shared config + run plan; hierarchy; automation inventory; POM; normalization; selectors; specs and helpers | `code-generation.md`, `run-plan-and-config.md`, `code-craft.md`, `automation-rules.md` |
| 2b | Writing Automation Code — open questions | PHASE 2.4 | only when a TC was parked: evidence-backed options, ONE ask, answers written back, parked TCs generated | `open-questions.md` |
| 3 | **Validating Automation Code** | Checkpoint A, PHASE 2.5 | the pre-run compliance gate; static coverage and its gate | `compliance-checkpoints.md`, `coverage.md`; `validator.md` only to close open `review[]` / `notRun[]` / `exceptions[]` |
| 4 | **Preparing Test Data** | PHASE 2.6 | requirements from TEST-DATA, probe, classify, prepare what is missing, verdict | `test-data-readiness.md`; `test-data-preparation.md` only when an item is `MISSING` / `UNKNOWN` / `IMPOSSIBLE` |
| 5 | **Running Smoke / Positive / Negative Tests** (first run) | PHASE 3 steps 0-1 | environment gate; run-start message; one `run-stage.mjs` call + one message per stage; the smoke gate | `execution.md` |
| 6 | **Reviewing Test Results** | PHASE 3 steps 2-6 | classify every failure; heal test-code defects (≤ 2 iterations); calibrate timeouts; Heal Log | — (`execution.md`, `automation-rules.md` §5) |
| 7 | **Running Final Verification** | PHASE 4 step 1, Checkpoint B | the final run (stage messages labelled "final run"); Checkpoint B on the final code once the report files exist | `final-run.md` |
| 8 | **Preparing Final Report** | PHASE 4 steps 2-4, PHASE 5 | merge; run file; report + bug file; reviewer comments; render; Azure close-out only under `linked`, after a Checkpoint B PASS; learning write-back; the return | `run-report.md`, `structured-returns.md` |

All references are under `references/`. Checkpoint A runs after generation and before anything
executes; the coverage and readiness verdicts are recorded before the first run, and
`<environment_gate>` checks all three. The report files are written before Checkpoint B, which
verifies them.

## Progress and messages

- **Labels:** the activity names above, the test stages as "Running Smoke Tests (first run)" /
  "(final run)". Never "Phase N" / "PHASE 2.6" as a label — internal ids stay in files and scripts; a
  run is "run {N}" (its report section keeps the name `## Phase {N}`).
- **Chat:** one message at run start, one per finished stage (Smoke; Positive — cumulative; Negative
  — the run's totals, defects, blockers, evidence, compliance status), an immediate message for a stop
  or blocker, the questions the workflow asks, and the final return. Nothing on a timer, per test or
  only to announce an activity; transitions are progress-log lines written in turns that happen
  anyway. Detail: `<live_progress>`.

## Block index

| Block | File (`references/`) |
|---|---|
| `<input_gate>` `<qa_manifest>` `<project_profile>` `<project_learning_file>` | `intake.md` |
| `<result_organization>` `<automation_logs>` | `results-and-evidence.md` |
| `<ado_linkage>` `<ado_closeout>` | `azure-devops.md` |
| `<source_of_truth>` `<hierarchy_verification>` `<automation_inventory>` `<pom_mandatory>` `<normalization>` `<selector_resolution>` `<spec_writing>` `<test_modifiers>` `<wait_policy>` | `code-generation.md` |
| `<run_plan>` `<shared_config>` | `run-plan-and-config.md` |
| `<open_questions>` | `open-questions.md` |
| `<checkpoint_a>` (§3a) `<checkpoint_b>` (§4a) | `compliance-checkpoints.md` |
| `<coverage_measurement>` | `coverage.md` |
| `<data_readiness>` steps 1-3, 8-9 · steps 4-7 + the twelve principles | `test-data-readiness.md` · `test-data-preparation.md` |
| `<environment_gate>` `<live_progress>` `<staged_execution>` `<first_run>` | `execution.md` |
| `<second_run>` `<bug_report_format>` | `final-run.md` |
| `<structured_returns>` `<quality_checklist>` | `structured-returns.md` |

Also: `automation-rules.md` (expected results, assertions, modifiers, waits, repair records, the
three coverage numbers) · `code-craft.md` (page objects, locators, specs, the shared config,
timeouts) · `validator.md` (the static validator's contract, rules and limits) · `run-report.md`
(report and bug-file shapes, renderer, run-file schema) · `azure-mcp-troubleshooting.md` (an Azure
DevOps MCP failure under `linked`).

## Scripts (`scripts/`)

| Script | Used for | Harness |
|---|---|---|
| `validate-automation.mjs` | the static validator of Checkpoints A / B and the automation inventory's `pageScan` | `selftest.mjs` |
| `config-inventory.mjs` | every Playwright config and its references (`<shared_config>`) | `selftest-config-inventory.mjs` |
| `run-stage.mjs` | runs ONE stage, monitors it, returns one payload + the stage message (`<live_progress>`) | `selftest-run-stage.mjs` |
| `watchdog.mjs` | the freeze verdict and reconstruction — called by `run-stage.mjs` | `selftest-watchdog.mjs` |
| `render-run-report.mjs` | the only way the HTML page is made (`run-report.md`) | `selftest-run-report.mjs`, before delivering a page |
| `tc-hash.mjs` | the canonical TC hash for `automated_tc_sha256` (`<ado_closeout>`) | `selftest-tc-hash.mjs`, before writing a hash |

Every script prints compact JSON; add `--pretty` only for a human reader.

## Modes and flags

- `--approve` / `--unapproved` answer the approval question in advance; a pipeline run on an
  unapproved document with neither is BLOCKED and names both flags.
- `--workers N` sizes the parallel group (serial groups always run with 1); `--headless` hides the
  browser (default: a visible Google Chrome window).
- **Interactive** — questions wait for the user. **Pipeline** — no questions: the documented defaults
  apply (an open question → the recommended reading tagged `@unverified-assumption`; test-data gaps per
  `<data_readiness>` step 5; coverage per its mechanism), and each `run-stage.mjs` group runs as a
  foreground call when no completion notice can arrive.
- **"read my comments" on the run report** — only the reviewer-comments bullet of `<second_run>` step
  4 and the render; no test runs. Load `final-run.md` and `run-report.md` only.

## Returns

`AUTOMATION COMPLETE` only when `<checkpoint_a>` and `<checkpoint_b>` are both recorded **PASS for
the final delivered scope** at the current `scopeDigest`; otherwise `## BLOCKED` with the gate record —
however green the run. `## ENVIRONMENT_BLOCKED` for an unhealthy environment (never blamed on the
code). Before writing any return, load `references/structured-returns.md` and work its
`<quality_checklist>`. Every return ends with the learning-file line
(`**Learning file:** read … · updated …`).
