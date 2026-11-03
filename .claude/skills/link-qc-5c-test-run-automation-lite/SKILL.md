---
name: link-qc-5c-test-run-automation-lite
metadata:
  version: "1.5.1"
description: >
  Lightweight, self-contained twin of link-qc-5-test-run-automation — "automate the approved test cases fast", "lite automation run",
  "run the automation with fewer tokens", "quick Playwright automation for the user story". Same job (an APPROVED
  TEST-CASES document → Playwright Page Object Model automation → smoke / positive / negative behind the 30 % smoke gate →
  report), four stages instead of eight activities, one script (`lite.mjs`) that returns compact verdicts, no subagents, a
  four-check Checkpoint A (tsc · POM · TC traceability · assertions) and a three-check Checkpoint B (results integrity · TC
  status & coverage · failure evidence) recorded by script, workers 1 unless TCs are proven independent, then 2-5, impacted re-runs
  only, markdown report and failure-only screenshots by default. Standalone: ships its own engine (engine/), no other skill needed.
argument-hint: "[<TC document path>] [<User Story ID or title>] [<environment>] [--approve | --unapproved] [--report html|md] [--screenshots all|failed|none] [--max-workers N] [--allow-data-changes all|<TC,…>|none] [--headless] [--ado]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(node *lite.mjs*), Bash(node *selftest-lite.mjs*), Bash(node *config-inventory.mjs*), Bash(node *validate-automation.mjs*), Bash(node *run-stage.mjs activity*), Bash(node *run-data.mjs handoff*), Bash(node *capacity.mjs*), Bash(node *tc-hash.mjs*)
---

# Test automation Lite — approved TC document → Playwright POM automation → compact staged run → report

**Standalone:** the engine is vendored in `engine/` (link-qc-5 3.2.0); "Full" below means that copy — Full `x.md` =
`engine/references/x.md`, Full scripts = `node .claude/skills/link-qc-5c-test-run-automation-lite/engine/scripts/<name>.mjs` — never the
link-qc-5 folder. Choose the link-qc-5 skill for its 58-item review, subagents or open-question parking.
**Any project:** `lite init-run` resolves every input once into `sources` (TC document, TEST-DATA, spec, Spec Kit constitution, QA
manifest, learning file, automation root + its source); only the TC document is required — a missing manifest or learning file never blocks.

**Always loaded:** this file + `references/lite-rules.md`. **Load one stage reference at its stage, nothing else up front.**
Script arguments come from `references/schemas.md` or `lite.mjs --help` — **the model never reads a script's source.**
**No subagents:** one context does everything (the Agent tool is not in `allowed-tools`); delegate only when one concrete task is
demonstrably too large for the context, and say why. Every script prints ONE compact JSON line; the full payload is in
`{results_root}/artifacts/lite/` — read it only to diagnose a problem. Never paste logs, file contents or long explanations into chat.

<role>
You are the automation engine after a human approved skill 3's document. You automate from the **original** approved document (never
skill 4's beautified copy), own everything to the report, and keep the QC rules in `lite-rules.md`. You do NOT design scenarios beyond
the document, guess selectors, weaken an assertion, mask a failure, touch product logic (a safe `data-testid` only), write to a
record this run did not create, or write to an environment whose class is not `test` / `staging`. An unresolved assumption never
becomes an approved expected result silently.
</role>

## Workflow — four stages

| # | Stage | What happens | Load | Scripts |
|---|---|---|---|---|
| 1 | **Prepare & Generate** | approval gate (the `Status:` line only) · `init-run` · learning-file grep once · `preflight` · `reconcile --apply` once · **auth strategy once** (`lite auth`) · reuse inventory · POM specs with source-confirmed selectors · **every data change through the data ledger** · declared journeys (`lite journey`) | `references/stage-1-prepare.md` | `lite init-run`, `lite preflight`, `lite auth`, `lite journey`, `lite cache`, `config-inventory.mjs`, `validate-automation.mjs --page-scan` |
| 2 | **Checkpoint A & Test Data** | `checkpoint-a` (tsc + side-effect-free spec load · pom · traceability on resolved titles · assertions; ledger / sign-in warnings · ledger ownership) → fix → repeat · coverage judgements once · test data: reuse, consent per TC for changes (`lite consent`) | `references/stage-2-checkpoint-a.md` | `lite checkpoint-a`, `lite consent` |
| 3 | **Execute, Analyze & Heal** | smoke → (30 % gate) → positive → negative · classify failures from the stage payload · collect the heals of the stage, heal test code ≤ 2 · burn-in the timing heals, then ONE widened re-run · `teardown` once | `references/stage-3-execute.md` | `lite stage`, `lite rerun-select`, `lite checkpoint-a`, `lite teardown` |
| 4 | **Checkpoint B & Report** | judgements file · bug narratives (template in the stage file) · `lite finalize` (A refresh if needed → drafts → merge → freshness → report → B → publish with status lines from the gate record → acceptance → `.auth/` removed) · optional ADO · learning write-back · lease release · return | `references/stage-4-finalize.md` | `lite finalize`, `capacity.mjs`, `tc-hash.mjs` |

Script calls: `node .claude/skills/link-qc-5c-test-run-automation-lite/scripts/lite.mjs <cmd> …` from the project root — no `cd`, pipe or
environment prefix. Exit codes: PASS / PUBLISHED / COMPLETED 0 · FAIL / STOPPED 1 · BLOCKED 2 · NOT_RUN 3. A non-zero exit is a verdict to act on, not an error to retry.

## Flags

`--approve` / `--unapproved` answer the one approval question in advance (a pipeline run on an unapproved document with neither is BLOCKED).
`--report md|html` (default **md**; HTML only through Full's renderer) · `--screenshots failed|all|none` (default **failed**) ·
`--max-workers N` (default and hard maximum 5; **2-5 workers when the readiness check proves 2+ TCs share no test data / state, otherwise 1**; no host-memory gate — low free memory means fewer workers or serial, never a wait or a question) · `--allow-data-changes all|TC,…|none` (default none) ·
`--headless` · `--ado` (Azure DevOps close-out through the existing integration; off by default, only when `ADO-MAP.md` exists).
Delivery is never asked unless the user wants something other than the defaults. Interactive: questions wait. Pipeline: documented defaults apply.

## Messages

One message per finished stage, nothing on a timer: `Stage · PASS|FAIL|BLOCKED · counts · workers · actionable problems · next action`.
Questions only for genuine blockers: approval, missing environment URL / class, a config outside the automation root, a TC needing data
changes, one batch of blocking requirement ambiguities.

## Returns

`## AUTOMATION COMPLETE` only when Checkpoint A and B are recorded PASS for the final scope, `lite finalize` returned PUBLISHED, and
the acceptance is `ACCEPTED`. Otherwise `## BLOCKED` (reason, the failing gate or acceptance reasons, what is NOT_RUN, links, what is
needed from the user) or `## ENVIRONMENT_BLOCKED` (reason, environment, action). Each return: status line, counts, ≤ 5 findings, links
(report, bug file, summary log), actions, and `**Learning file:** read … · updated …`. Format details: Full `references/structured-returns.md`
(`<quality_checklist>`) — load it only if this is not enough.
