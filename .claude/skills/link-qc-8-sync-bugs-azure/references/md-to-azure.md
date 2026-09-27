# Direction md → Azure (create new bugs, then push local status changes)

Loaded by SKILL.md step 3. Contract sections: §§1–6. Two sub-steps in this order; the ledger is written last by SKILL.md step 4.

## A. Create the bugs Azure does not have yet
1. Parse both producer formats (contract §1). Candidates: BUG-REPORT entries with Status `open` and no ledger row; UI-report bugs with no ledger row. A `resolved` or `not-checked-this-run` entry that was never synced is reported `Skipped (never open in Azure)`, not created. Historical UI entries are not evidence of a fresh retest.
2. Validate required fields (Title, Steps, Expected, Actual, Severity, and the custom fields the Bug type declares required: Testing Type / Bug Trigger / Impact / Classification when they exist). Batch every gap into ONE question, suggesting the closed lists of skill 6 `references/bug-metadata.md` subject to the actual picklists. Answers go to the Azure item and the ledger Note — never into a BUG-REPORT entry (its shape is skill 5's).
3. Story: the explicit ID first (`ADO-MAP.md` header, bug-report `**User Story:**`, task input). Title matching with the configured `bug_story_filter_tags` only when no ID exists; an ambiguous match asks for a confirmed ID. A flaky defect goes to the configured `flaky_story_title` story or is Skipped — never to an invented catch-all.
4. Before creating, search the story/project for `[BUG-n]` plus the exact source identity in the description (lost-map recovery). One exact match repairs the ledger; an ambiguous match is Skipped and asks. Never deduplicate across reports by prefix alone.
5. Create the Bug through the MCP (contract §6): title verbatim; repro steps → `Microsoft.VSTS.TCM.ReproSteps` when present, else Description; Description carries Expected / Actual / Root cause / Evidence / Environment / Browser / Language / Build / TC-ID / Requirement (UI: System Info rows, Source, Suggested fix) plus `source path + Bug ID`; Severity mapped to the type's values; Priority only when the source has one; `default_assignee` only when configured; tags `{feature}` + configured tags (+ `ui-visual-qa` for UI bugs). Persist the returned ID immediately.
6. Attach the evidence screenshot by relative path (missing file → reported, never fabricated); link Parent → story with `System.LinkTypes.Hierarchy-Reverse` (or the tool-native Parent). Attachment/link failure stays pending in Note and is retried without recreating the item.
7. Re-read the created item (state, revision, assignee); the first non-empty assignee becomes the reopen target recorded in Note (`first_assignee=`).

## B. Push local status changes for mapped bugs
1. For every ledger row (or `--only` subset): compare current local status/History with the ledger baseline, and current Azure state/revision with the ledger baseline (contract §5).
   - Local unchanged, nothing pending → `Current`.
   - Local `not-checked-this-run` → `Skipped (no push)`.
   - Local and Azure both changed → `Skipped (conflict — run --direction azure-to-md or both first)`; a missing baseline needs a pull and explicit reconciliation.
   - Unrecognised local state → `Skipped (unknown state)`, never guessed.
2. Local `resolved` → the type's verified-close state (`bug_state_closed`, discovered from the type; ask once when absent) ONLY when History carries an actual successful retest for the recorded environment/phase (written by skill 9 or a human with evidence). A bare manual edit → `Skipped (missing retest evidence)`. Strip a `[Reopened]` prefix and the `reopened` tag if a previous run added them; assignee untouched.
3. Local `open` while Azure is terminal (developer said fixed, retest failed) → reopen: the type's initial state (New, else the explicitly identified initial state), exactly one `[Reopened]` title prefix, the `reopened` tag merged into the existing tags, assignee = first non-empty assignee from the revision history (no history → unchanged + reported), comment with the configured `reopen_mention_text` mentioning that assignee when the MCP supports mentions (otherwise NOT_RUN for the mention, never an invented identity). A failed retest recorded in History triggers this even when the local status was already `open`; an unchanged `open` with no new failed retest does not.
4. Retry pending attachments/comments from Note separately from state transitions; read back each write; avoid duplicate attachments/comments by evidence identity.
5. Acknowledge the local baseline (`Local status`, `local_history_sha256`) and the read-back Azure revision only for a confirmed state sync; keep pending ancillary failures explicit.

Report per contract §8 with `Direction: md→ado` (Before = previous Azure state / After = new Azure state, `Created` for sub-step A).
