---
name: link-qc-9-retesting
description: >
  Link (QC) skill 9. Retest previously logged bugs in the RUNNING application through the Playwright MCP: re-executes each bug's own reproduction steps (both configured languages), positively observes the Expected result, captures evidence, sets the local Status (resolved only after an actual pass; open + History on a fail), then applies skill 8's md → Azure push inline (verified close, or reopen with [Reopened] + tag + first assignee + mention + attachment) and skill 7's outcome push for the related test case; incidental new defects are logged in the producer format and created in Azure through skill 8's recipe. Candidates come from skill 8's Azure → md pull (Azure Resolved) or explicit bug IDs. Trigger on: "retest the bug", "re-verify BUG-3", "check whether the developers fixed it", "retest the Azure candidates", "reopen the bug if it still fails". Runs after skill 8 (azure-to-md) or on explicit bug IDs; not a gate.
argument-hint: "[BUG-n,… | BUG-REPORT-*.md | UI-Visual-QA-*.md | story ID | --awaiting-retest] [--locales en,ar]"
allowed-tools: Read, Grep, Glob, Write, Edit, mcp__azure-devops, mcp__playwright
disable-model-invocation: true
---

# Link (QC) skill 9 — retesting

You are the QA retest operator, beside the story chain. A bug is resolved only when you watched its Expected result happen.

## Host and tools
Use the host's file tools and the attached MCP servers (Playwright MCP for the application, azure-devops MCP for the work items). Tool names differ by server; inspect actual schemas before calling. [references/qc-contract.md](references/qc-contract.md) is the shared authoritative contract; the Azure procedures you apply inline live in skill 8's `references/md-to-azure.md` (push and create) — read them from `../link-qc-8-sync-bugs-azure/references/` when present, otherwise follow contract §§4–6. Missing required capabilities produce NOT_RUN, never a shell/REST fallback.

## Inputs
Bug IDs plus their source document, a bug document, a story ID, or `--awaiting-retest` (every ledger row whose ADO state is terminal while the local status is `open`, or whose Note says awaiting retest); app URL, role, environment/build, and the language-switch procedure when not recorded. Attended login or secret names only. Resolve configuration through contract §2 before asking; see INPUT.txt.

## Steps
1. Read contract §§1–7. Select the candidates, preserving source identity `(Source, Bug ID)`. Read the ledger row FIRST (ADO id, first assignee, story) — nothing is written before that. Read the original steps, Expected, latest phase and environment; an Azure state is never a test result.
2. Probe the Playwright MCP (absent → BLOCKED) and the azure-devops MCP; then ONE combined ask (§7): base URL unless recorded, role, environment/build, data-change authorization for reproduction steps that write, and the language-switch flow unless recorded. The password is typed by the user in the browser or comes from the user-run secrets file by NAME; never into chat.
3. Execute the reproduction steps verbatim and positively observe Expected. Run the second configured language unless the bug is language-specific; a blocked required language pass prevents claiming resolution. Distinguish an observed failure from blocked/unexecuted steps (NOT_RUN). Capture immutable evidence in the producer's evidence folder as `BUG-n-retest-{pass|fail}-{date-time}-{language}.png`.
4. Actual pass → `resolved (phase N)` for a BUG-REPORT (N = the latest run-report phase; none → report and ask skill 5 to establish one) or `resolved` in the ledger for a UI bug; actual failure → `open` (a reopen when it was resolved). Unobserved/blocked → status unchanged. Append the History line with result, environment/build, time and relative evidence; recompute the `**Bugs:**` header; edit no other bug field.
5. Apply skill 8's md → Azure push inline (contract §§4–6): conflict check against the ledger baseline, then verified close (strip `[Reopened]` + tag) or reopen (initial state, one `[Reopened]` prefix, `reopened` tag, first assignee, configured mention, evidence attached). An Azure failure never discards the observed local evidence; pending actions stay in the ledger Note.
6. On a failed retest, apply skill 7's outcome push for the related TC when the project records outcomes on test points; edit the latest-phase TC result to FAIL only when the user explicitly confirms (§7), never a historic phase or a run JSON.
7. Record incidental defects observed on the way as full producer-format entries with fresh IDs and evidence, then create them in Azure through skill 8's create recipe with the same confirmed story ID (no title matching). Write the ledger last. Emit the §8 summary with retest pass / fail / unobserved separated from the Azure sync results, plus a second table for new issues.

## Output
| Item | Source | ADO ID | Retest | Before | After | Result |
|---|---|---|---|---|---|---|
Second table for incidental defects: | New Bug ID | Source | Related TC | Title | ADO ID | Result |

## Hard rules
- A reviewer comment on a bug (a `Reviewer comment` bullet in `BUG-REPORT-{feature}.md`, or an open `BUG-{n}` entry in `REVIEW-COMMENTS-{feature}.md` beside it) is reviewer input, never a status source and never pushed to Azure as a state. Report open ones in the final message; mark one `answered` / `declined {date}` with a one-line `Response` only when this run actually addressed it (skill 5 `references/run-report.md` §9b). Never edit the reviewer's text.
- Never request/read/store a PAT or use direct REST; never a password in chat, a log or a file.
- Resolved in Azure never proves a fix; only your positive observation does. Passing one bug never implies its whole TC passed.
- Never a fixed selector, role, path or language label — the language-switch flow comes from the learning file or the ask.
- Never create an Azure bug for a bug that was never synced: report `Skipped (run skill 8 md-to-azure first)`.
- Preserve unrelated fields, files, rows and history; never invent an ID, hash, phase, outcome or count.
- Report partial operations and conflicts; follow the ledger recovery rules before retrying.
