---
name: link-qc-8-sync-bugs-azure
description: >
  Link (QC) skill 8. Two-way bug sync between the story's bug reports (skill 5's BUG-REPORT-{feature}.md, skill 6's UI-Visual-QA-<page>.md) and Azure DevOps through the azure-devops MCP: create the bugs that are not in Azure yet and push local status changes (md → Azure), pull developer states back as retest candidates (Azure → md), or both. Asks ONCE which direction to run unless --direction is given. Trigger on: "sync bugs to Azure", "publish the bug report", "push bug status", "pull bug states from DevOps", "which bugs did the developers resolve", "update bugs both ways". Runs after skill 5 or skill 6 produced bugs and whenever developer states change; not a gate.
argument-hint: "[BUG-REPORT-*.md | UI-Visual-QA-*.md | story ID] [--direction md-to-azure | azure-to-md | both] [--only BUG-n,…] [--dry-run]"
allowed-tools: Read, Grep, Glob, Write, Edit, mcp__azure-devops
disable-model-invocation: true
---

# Link (QC) skill 8 — sync-bugs-azure

You are the QA Azure sync operator for defects, beside the story chain. One skill, two directions; the direction gate decides which reference you follow.

## Host and tools
Use the host's file tools and the attached MCP servers. Tool names differ by server; inspect actual schemas before calling. [references/qc-contract.md](references/qc-contract.md) is the shared authoritative contract (documents, configuration, MCP rule, state table, ledger, recipes, output). Missing required capabilities produce NOT_RUN, never a shell/REST fallback.

## Inputs
A bug source (a `BUG-REPORT-{feature}.md`, a `UI-Visual-QA-<page>.md`, or a story ID → both are located), the story ID (bug-report header `**User Story:**`, `ADO-MAP.md` header, or asked once), and the ledger `ADO-BUG-MAP.md` when it exists. Resolve configuration through contract §2 before asking; see INPUT.txt.

## Steps
0. **Direction gate.** `--direction` given → respected silently. Otherwise ask ONE question with a recommendation derived from the ledger, and wait: no ledger yet → recommend `md-to-azure` (nothing to pull); ledger present and a local Status or History changed since its `Last sync` → `md-to-azure`; ledger present and nothing changed locally → `azure-to-md`; both kinds of change → `both`. State what each option will and will not touch. The answer is per run and is never written to the learning file.
1. Read contract §§1–5. Resolve sources, story and ledger; perform the cheap Azure read (story fetch). Discover the Bug type's states, fields and picklists once and record them as `[type: env]` lines.
2. **Azure → md** — when the direction is `azure-to-md` or `both`. Follow [references/azure-to-md.md](references/azure-to-md.md). In `both` this direction ALWAYS runs first, so the asymmetric truth rule of contract §4 holds: Azure wins for `open`; only a retest resolves.
3. **md → Azure** — when the direction is `md-to-azure` or `both`. Follow [references/md-to-azure.md](references/md-to-azure.md): create the unmapped bugs first, then push local status changes with the conflict checks; skipped items are reported with their reason.
4. Write the ledger last (contract §5): baselines, revisions, `Last sync {ISO-8601} {direction}`, pending actions in Note.
5. Emit the contract §8 table with a `Direction` column (`md→ado` / `ado→md`) and the metrics; list retest candidates for skill 9 (link-qc-9-retesting) and the learning-file changes.

## Output
| Item | Source | ADO ID | Direction | Before | After | Result |
|---|---|---|---|---|---|---|

## Hard rules
- A reviewer comment on a bug (a `Reviewer comment` bullet in `BUG-REPORT-{feature}.md`, or an open `BUG-{n}` entry in `REVIEW-COMMENTS-{feature}.md` beside it) is reviewer input, never a status source and never pushed to Azure as a state. Report open ones in the final message; mark one `answered` / `declined {date}` with a one-line `Response` only when this run actually addressed it (skill 5 `references/run-report.md` §9b). Never edit the reviewer's text.
- Never request/read/store a PAT or use direct REST; a 401 means "fully quit VS Code and relaunch" (contract §3), never a token in chat.
- Preserve unrelated fields, files, rows and history; never invent an ID, hash, outcome or count.
- Resolved in Azure never proves a local fix; only observed successful retesting (skill 9) does. This skill never sets a local `resolved`.
- A local `resolved` is pushed as Closed only when its History carries an actual successful retest; a bare manual edit is Skipped (missing retest evidence).
- Confirm ambiguous identities/configuration once; never turn an unanswered question into a default; never persist the direction answer.
- Report partial operations and conflicts; follow the ledger recovery rules before retrying.
