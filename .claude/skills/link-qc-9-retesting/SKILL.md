---
name: link-qc-9-retesting
description: >
  Link (QC) skill 9. Retest previously logged bugs in the RUNNING application — never through the Playwright MCP: a bug whose test case is automated is re-run from skill 5's Playwright automation code (run-stage.mjs, every variant, isolation check included); every other bug (no automated TC, a UI-audit bug, a manual-run phase) is retested through playwright-cli — the full test case when it has a row in the latest run, otherwise the bug's own reproduction steps. Positively observes the Expected result, captures evidence, then updates the LATEST phase of the run report in place (TC status, stage totals, outcome, pass rate, run file) and the bug report (resolved (phase N) only after an actual pass; open + History on a fail), re-renders the run report page, applies skill 8's md → Azure push inline (verified close, or reopen with [Reopened] + tag + first assignee + mention) and AFTER the state change uploads the retest evidence through the azure-devops-attachments MCP (verified by read-back), plus skill 7's outcome push for the related test case. Incidental new defects are logged in the producer format and created in Azure through skill 8's recipe. Candidates come from skill 8's Azure → md pull (Azure Resolved) or explicit bug IDs. Trigger on: "retest the bug", "re-verify BUG-3", "check whether the developers fixed it", "retest the Azure candidates", "reopen the bug if it still fails", "rerun the automation for the fixed bugs", "update the pass rate after the fix". Runs after skill 8 (azure-to-md) or on explicit bug IDs; not a gate.
argument-hint: "[BUG-n,… | BUG-REPORT-*.md | UI-Visual-QA-*.md | story ID | --awaiting-retest] [--locales en,ar] [--headless]"
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(node *run-stage.mjs*), Bash(node *impact.mjs*), Bash(node *render-run-report.mjs*), Bash(node *capacity.mjs*), Bash(playwright-cli *), Bash(npx --no-install playwright-cli *), mcp__azure-devops, mcp__azure-devops-attachments__create_work_item_attachment, mcp__azure-devops-attachments__delete_work_item_attachment
disable-model-invocation: true
---

# Link (QC) skill 9 — retesting

You are the QA retest operator, beside the story chain. A bug is resolved only when you watched its
Expected result happen — through the automation that covers it when its TC is automated, through
playwright-cli otherwise. The Playwright MCP is never used.

## Host and tools
- [references/qc-contract.md](references/qc-contract.md) is the shared authoritative contract (§7 is
  this skill's). The Azure procedures you apply inline are skill 8's `references/md-to-azure.md`
  (push and create) — read them from `../link-qc-8-sync-bugs-azure/references/` when present,
  otherwise follow contract §§4–6.
- **Automation route** — skill 5's scripts, called by path, never copied or edited: `impact.mjs`
  (is the TC automated, which spec), `run-stage.mjs` (the only way a Playwright command runs),
  `render-run-report.mjs` (the only way the page is made). Detail: [references/automation-rerun.md](references/automation-rerun.md).
- **playwright-cli route** — [references/browser-cli.md](references/browser-cli.md).
- **Coordination** — skill 5's `capacity.mjs` (called by path): this run's environment lease (no retest beside a
  skill 5 run or another retest on the same environment) and one session hold per playwright-cli browser (the
  machine's worker ceiling) — [references/coordination.md](references/coordination.md). Skill 5 absent → BLOCKED.
- **Report update** — [references/report-update.md](references/report-update.md).
- **Azure** — `mcp__azure-devops` for every read and write; attachments through the contract §3
  ladder: an upload tool that takes a file path on the attached `azure-devops` server, else the
  optional `azure-devops-attachments` server (cloud projects; added by skill 1 with its launcher)
  for attachment upload / delete ONLY, else the attachment stays pending with the manual
  instruction. Missing capabilities are NOT_RUN, never a shell / REST fallback.

## Inputs
Bug IDs plus their source document, a bug document, a story ID, or `--awaiting-retest` (every ledger
row whose ADO state is terminal while the local status is `open`, or whose Note says awaiting
retest). Resolve configuration through contract §2 before asking; see INPUT.txt.

## Route per bug (one route per bug, never switched mid-bug)

| Bug | Route |
|---|---|
| BUG-REPORT bug whose TC is carried by a test of skill 5's automation AND held by the latest phase's run plan (automation-rerun.md §1) | **automation re-run** — `run-stage.mjs --run rerun` against `.runs/phase-N.json` |
| BUG-REPORT bug otherwise — not automated, the latest phase is a skill 5b manual run, or in no run-plan group | **playwright-cli** — the full TC when it has a row in the latest phase, else the bug's own steps (browser-cli.md §1) — **unless the reproduction needs an `[API]` / `[DB]` line** (the bug's own steps or, for the full TC, any backend line before the failing step): then **NOT_RUN** `api/db step — automation only (skill 5)`, never improvised; a bug whose own steps are UI-only keeps this route |
| UI bug (skill 6 report) | **playwright-cli** — the bug's own steps; ledger only |

Automation that cannot start leaves its bugs unobserved (`NOT_RUN` + reason) — never retested
another way in the same run.

## Steps
1. Read contract §§1–7. Select the candidates, preserving source identity `(Source, Bug ID)`. Read the
   ledger row FIRST (ADO id, first assignee, story) — nothing is written before that. Read the
   original steps, Expected, Evidence, the latest phase N of the story's run report and its run file
   (not final → BLOCKED, a run is in progress); an Azure state is never a test result.
2. Route every bug (table above; automation-rerun.md §1, `impact.mjs fingerprint`).
3. Probe only what the routes need: the automation runner (automation-rerun.md §2; missing → those
   bugs NOT_RUN), playwright-cli (browser-cli.md §2; missing → those bugs NOT_RUN with the
   `/sync-skills --tools` hint), the azure-devops MCP (one cheap read). Then ONE combined ask
   (contract §7): environment / build (and confirmation when it differs from phase N's), the
   data-change authorization, and — for playwright-cli bugs only — the base URL unless recorded, the
   username and login method per role (attended in a headed browser, or secret NAMES from the
   user-run secrets file; a password never in chat) and the language-switch flow unless recorded.
   Then, before anything touches the environment, this run's **environment lease** (coordination.md §§1-2):
   held by another run → BLOCKED naming it, nothing executed.
4. **Automation route** — one background `run-stage.mjs --run rerun --env-id {envId}` call per stage holding retest
   TCs, one message per finished stage, then the verdict per bug from the summary
   (automation-rerun.md §§3–5). A test-code, environment or rate-limit failure is no verdict.
5. **playwright-cli route** — a session hold per browser before its `open` (coordination.md §4), then
   execute (browser-cli.md §§1, 3–7), positively observe Expected, assertion-point image before any cleanup, second language per `language_switch`; close every
   session and remove the run's snapshot files.
6. **Update the reports in place** (report-update.md): phase N's changed Results rows, Stages,
   Outcome, Bugs, Retest bullet, Deviations, header and Run history row; `.runs/phase-N.json` to
   match; the bug Status (`resolved (phase N)` after an actual pass, `open` after a fail, unchanged
   when unobserved) + History line + `**Bugs:**` header; incidental bugs as new entries. Render: dry
   run until `gate: PASS` with no mismatch, then `--write`. UI bugs: ledger only.
7. **Azure, per bug** (contract §§4–6, skill 8's push inline): conflict check against the ledger
   baseline; the state transition — verified close (strip `[Reopened]` + tag) or reopen (initial
   state, one `[Reopened]` prefix, `reopened` tag, first assignee, configured mention) — read back;
   **then** the retest evidence upload (§6b identity check → §3 ladder with the file's absolute path,
   name `BUG-{n}-{TC-ID}-phase-{N}-retest-{variant}-{file}` (UI bug: its own file name), comment
   `BUG-{n} evidence - {TC-ID}, retest phase {N}, {date}`, no duplicate name, read back `AttachedFile`
   name + `resourceSize` = local byte size); not verified → `pending: attach …` in the ledger Note.
   An Azure failure never discards the observed local result. Then skill 7's outcome push for every
   TC whose row changed, when the project records outcomes on test points (otherwise NOT_RUN).
8. Incidental defects observed on the way: full producer-format entries with fresh IDs and evidence
   (step 6), then created in Azure through skill 8's create recipe with the same confirmed story ID
   (no title matching), evidence included (§6b, §6 upload and read-back).
9. Write the ledger last; release every hold and the lease (coordination.md §5 — also on any stop after
   step 3). Emit the §8 summary: retest pass / fail / unobserved separated from the Azure results, the pass-rate line, the page path and gate, pending actions, plus a second table
   for new issues.

## Output
| Item | Source | Route | ADO ID | Retest | TC row (before → after) | Azure (before → after) | Evidence | Result |
|---|---|---|---|---|---|---|---|---|

`Pass rate (phase N): {p} of {t} TCs ({x}%) → {p'} of {t} ({x'}%)` · `Run report page: {path} — gate {PASS | …}`
· `Coordination: lease {envId} held {from} – {to} · {n} session hold(s) · released`.
Second table for incidental defects: | New Bug ID | Source | Related TC | Title | ADO ID | Result |

## Hard rules
- Never the Playwright MCP — not as a route, a fallback or a single step.
- Never touch the environment without this run's lease, never open a playwright-cli browser without its session
  hold, never change the machine's capacity settings to make a retest start (coordination.md §6).
- Never edit automation code (spec, page object, helper, `timeouts.ts`, config) — not to make a retest
  run, not to make it pass; a test-code failure is reported for skill 5 and changes no row and no bug.
- Only the LATEST phase is updated in place, only the rows of TCs re-run in full with a product
  verdict; an earlier phase, its run file, screenshots and logs never change; a row is never added or
  removed; the page is rendered, never hand-written, and delivered only at gate PASS.
- A reviewer comment on a bug (a `Reviewer comment` bullet in `BUG-REPORT-{feature}.md`, or an open
  `BUG-{n}` entry in `REVIEW-COMMENTS-{feature}.md` beside it) is reviewer input, never a status
  source and never pushed to Azure as a state. Report open ones in the final message; mark one
  `answered` / `declined {date}` with a one-line `Response` only when this run actually addressed it
  (skill 5 `references/run-report.md` §9b). Never edit the reviewer's text.
- Never request/read/store a PAT or use direct REST (contract §3); never a password in chat, a log, a
  file or on a command line. **Azure MCP failure (`CONNECT_TIMEOUT`, `TF400813`, 401, 403):** stop
  Azure calls, run the diagnostic in [references/azure-mcp-troubleshooting.md](references/azure-mcp-troubleshooting.md),
  and give the user the ONE fix for the matching row as the first line of the reply; when the fix is
  "Set or replace the PAT", list its 7 steps with the command filled in with this project's path.
  Local retest observations and report updates survive; Azure outcomes stay `NOT_RUN`; never ask for
  the token; never use REST as a fallback.
- Attachments go only through an upload-capable MCP tool that reads the file from disk, only after the
  state transition they document, and count only after read-back (`AttachedFile` name +
  `resourceSize`); never REST, never an inline base64 upload; evidence identity (sha256) is checked
  first (contract §6b); no upload-capable server → `NOT_RUN`, pending in the ledger Note with the
  manual instruction.
- Resolved in Azure never proves a fix; only your positive observation does. Passing a bug's
  reproduction steps never implies its whole TC passed.
- Never a fixed selector, role, path or language label — the language-switch flow comes from the
  learning file or the ask.
- Never create an Azure bug for a bug that was never synced: report `Skipped (run skill 8 md-to-azure first)`.
- Preserve unrelated fields, files, rows and history; never invent an ID, hash, phase, outcome or count.
- Report partial operations and conflicts; follow the ledger recovery rules before retrying.
