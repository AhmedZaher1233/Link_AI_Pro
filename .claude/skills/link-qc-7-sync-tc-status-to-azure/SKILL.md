---
name: link-qc-7-sync-tc-status-to-azure
description: >
  Link (QC) skill 7. Publish the latest test-case outcomes (skill 5's TEST-RUN-REPORT-{feature}.md latest phase, or an explicit TC-ID=PASS|FAIL list) to the Azure Test Plan points of the published test cases (ADO-MAP.md) as ONE test run through the azure-devops MCP; the attached server must expose test-point / run / result tools, otherwise the step is NOT_RUN. Trigger on: "sync TC results to the Test Plan", "update Test Plan outcomes", "record the run in Azure Test Plans", "push test case results to DevOps". Runs after skill 5 (automation), 3b or 3c with explicit results, or skill 9; not a gate.
argument-hint: "[TEST-RUN-REPORT-*.md | story ID] [--phase N] [--outcomes TC-x=PASS,TC-y=FAIL] [plan/suite URL or IDs]"
allowed-tools: Read, Grep, Glob, Write, Edit, mcp__azure-devops
disable-model-invocation: true
---

# Link (QC) skill 7 — sync-tc-status-to-azure

You are the QA Azure sync operator for test-case outcomes, beside the story chain.

## Host and tools
Use the host's file tools and the attached MCP servers. Tool names differ by server; inspect actual schemas before calling. [references/qc-contract.md](references/qc-contract.md) is the shared authoritative contract. Missing required capabilities produce NOT_RUN, never a shell/REST fallback.

## Inputs
Latest `TEST-RUN-REPORT-{feature}.md` (or `--phase N`) or an explicit `TC-ID=PASS|FAIL|INCOMPLETE` list; `ADO-MAP.md` (skill 4's, with its `Suite` column); plan/suite IDs or URL when the points are ambiguous. Validation states written by 3b / 3c are not execution outcomes. Resolve configuration through contract §2 before asking; see INPUT.txt.

## Steps
1. Read contract §§1–3 and §8; resolve plan/suite, input results and ADO-MAP. Probe point-list, run-create, result-list/update and run-complete capabilities before any write; any one missing → every outcome is `NOT_RUN (server has no test-plan tools)` and nothing is created.
2. Select only the latest numeric phase's Results table (or `--phase N`, or the explicit list). Map PASS → Passed, FAIL → Failed, INCOMPLETE → Blocked; SKIP / NOT_RUN → Skipped (no observed result); unknown or contradictory duplicate outcomes need correction before any write. An `@unverified-assumption` result is never Passed.
3. Map each TC through ADO-MAP to a test point in the selected suite. Unmapped → `Skipped (no ADO-MAP row — run skill 4)`; no point → `Skipped (no suite point — run skill 4 --suite-only)`; several configurations/testers → resolve the intended point(s) explicitly, never update all by assumption.
4. Create one test run for all eligible points of this invocation (`Outcome sync — {feature} phase {N} — {date}`); none eligible → no empty run. Retain the run ID. List its result IDs, map them by point, set each outcome with the evidence path in the comment, read back.
5. Complete the run only after every intended outcome is verified; failures leave the run incomplete and reported with its ID for recovery. Resume that run after an uncertain write, never blindly create a second one. Report run completion separately from individual outcomes.
6. Emit the §8 summary with `Outcome` and run ID columns. `AutomationStatus` / custom automation fields remain skill 5's linked-mode responsibility; this skill writes no local file.

## Output
| Item | Source | ADO ID | Outcome | Before | After | Result |
|---|---|---|---|---|---|---|
Plus: run ID, completion state, metrics.

## Hard rules
- Never request/read/store a PAT or use direct REST; a 401 means "fully quit VS Code and relaunch" (contract §3).
- Never invent a point, a run, an outcome or a count; never set AutomationStatus / TestAutomated (skills 4 and 5 own them).
- Preserve unrelated fields, files, rows and history.
- Confirm ambiguous points/configuration once; never turn an unanswered question into a default.
- Report partial operations and conflicts; follow the run-recovery rule before retrying.
