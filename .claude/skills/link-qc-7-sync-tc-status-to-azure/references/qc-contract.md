<!-- MIRROR: references/qc-contract.md is byte-identical in link-qc-7-sync-tc-status-to-azure, link-qc-8-sync-bugs-azure and link-qc-9-retesting. Canonical: link-qc-8-sync-bugs-azure. Edit all three together. -->
# QC Azure sync contract (skills 7 to 9)

## 1. Documents and paths
Read Testing/qa-manifest.json first; use its paths and recorded deviations, then detect existing paths. Never create a second testing tree.
- Approved source: Testing/Manual_Test/TestCases/[SPEC-*/]US-*/TEST-CASES-{feature}.md.
- TC identity: ADO-MAP.md beside that source; skill 4 (link-qc-4-publish-test-cases-azure) owns its schema, its source_sha256 provenance and its Suite column.
- Automation bugs: Testing/Automation/reports/[SPEC-*/]US-*/BUG-REPORT-{feature}.md; parse ### BUG-n headings and bold bullet fields per skill 5 references/run-report.md §5.
- Outcomes: TEST-RUN-REPORT-{feature}.md in the same report folder; read the latest numeric ## Phase N and its ### Results table, never an earlier phase as a fallback for missing latest results.
- UI bugs: Testing/UI-Testing/Reports/UI-Visual-QA-<page>.md; parse ### Bug #NN — title and bold-line fields per skill 6 references/report-template.md. Normalize #NN to BUG-NN for the map while preserving the original heading.
- Evidence: report-relative links, automation story artifacts/ or the UI report's existing evidence/<page>_<lang>/ folder. Never put maps at the report root (skill 5 whitelist).
Read the relevant producer reference when a document differs; unsupported or ambiguous shapes are Skipped with a reason, never guessed.

## 2. Configuration and learning
Resolve task input → Testing/project-learning.md section ### Azure Sync Model (skills 7 to 9), [type: env] lines → detection → one bundled question for unresolved required values.
Keys: ado_org, ado_project, test_plan_id, test_suite_id (or plan URL), bug_story_filter_tags, flaky_story_title, default_assignee (optional; absent leaves unassigned), custom_fields (Testing Type / Bug Trigger / Impact / Classification to discovered reference names), language_switch (procedure), reopen_mention_text (optional).
Detect organization/project from non-secret .mcp.json azure-devops configuration or git remote; story from ADO-MAP.md header or bug document User Story. Never read environment secret values. Discover Bug fields, requiredness, picklists and type states through MCP. Never assume custom field names or values.
For title-based story lookup only when no ID exists, apply configured tags; ambiguous matches require a confirmed ID. Flaky defects require the configured flaky story, never an invented catch-all story.
Read learning Index and relevant tags before asking. Persist confirmed answers only as tagged plain-English lines with (confirmed by user {date}); maintain Index. No credentials, unconfirmed defaults or tokens. Configuration absence is not a zero value. The direction answer of skill 8 is per run and is never persisted.

## 3. MCP and failures
Use mcp__azure-devops exclusively for ADO. Inspect attached tool schemas and perform one cheap read before writes. Never REST, curl, shell HTTP, a PAT read, a token prompt or a token stored in a document. Skill 4's optional REST suite fallback does not apply to this family.
401 or "anonymous access" (TF400813): stop Azure operations; the server holds a rejected or stale token — ask the user to fully quit VS Code (all windows) and relaunch; an expired PAT is renewed by the user with set-azure-devops-pat.ps1 (or .sh) before that relaunch. Never ask for the token in chat. 403: report the missing scope; do not retry with another credential.
Test-plan capabilities exist on the cloud @azure-devops/mcp server only; inspect actual testplan_* names and schemas rather than fabricating calls. Missing suite, point, run-create, result-update or run-complete capability → NOT_RUN (server has no required test-plan tools), no fallback. Check all required capabilities before creating any work item/run for that operation.
Re-read before a write; use a revision precondition when the tool supports it. Otherwise re-read immediately, report concurrent changes, and never claim atomic conflict protection. After an uncertain write, query by identity before retrying; never blindly recreate a bug, case or run. Continue independent items after an item failure; total auth failure stops Azure work. Local retest observations survive an Azure failure.

## 4. Local status and Azure state
| Local status | Azure target / interpretation |
|---|---|
| open | New/Active is open; unchanged open is no push |
| resolved (phase N) | Closed only with an actual successful retest recorded in History |
| resolved (UI report only) | Closed only with successful retest History |
| not-checked-this-run | no push |
| any local status + Azure Resolved | developer says fixed; retest candidate, never local resolution |
Asymmetric truth rule (skill 8, both directions): Azure DevOps is the truth for open — a reopen on the developer side is mirrored at once; a local retest is the only source of resolved — an Azure Resolved/Closed is recorded as awaiting retest, never as a local resolution.
Read the Bug type states. Reopen uses New when available, otherwise the type's explicitly identified initial state; never pick arbitrary alphabetic order. If no initial state is exposed, ask once. Closed missing → ask for the process's verified-close state; no guessed equivalent.
On failed retest/reopen, add exactly one [Reopened] title prefix and reopened tag; preserve all other title text/tags. Set assignee to the first nonempty assignee in chronological revisions; no history → leave unchanged and report. On verified close remove only that prefix and tag; assignee stays untouched. Mention only the resolved assignee identity using supported MCP comment/mention capability and configured text; unavailable → report NOT_RUN, never invent a mention identity.
The Azure → md direction changes no document Status, including on Azure Closed/Removed. Append dated History recording old/new ADO state and actor; Resolved adds retest candidate. Preserve producer History format: automation sub-list under **History:**, UI appended **History:** lines. Skill 9 changes Status only after observation and appends evidence/environment/build/phase details. Never overwrite old History or add ADO IDs to bug entries.

## 5. ADO-BUG-MAP.md identity and reconciliation
Write beside ADO-MAP.md in the story's TestCases folder. If no TC map exists, resolve the story folder from manifest/story ID and create only ADO-BUG-MAP.md there. A UI report spanning stories may have rows in the corresponding story maps; never mix project identity silently.
Header (one source provenance comment per document):
<!-- source: {project-relative bug document path} · source_sha256: {hash} -->
<!-- project: {ado_project} · story: {US id} -->
| Bug ID | Source | ADO Work Item ID | Story ID | Local status | ADO state | Last sync | Note |
|---|---|---|---|---|---|---|---|
Identity is (normalized project-relative Source, Bug ID), never Bug ID alone. Preserve every row; missing source entry becomes removed from document — work item left in place. A row with a missing/deleted Azure item is Failed; never create a replacement silently.
Local status is the last acknowledged local baseline, ADO state is the last observed Azure baseline, Last sync is ISO-8601 plus the direction (md→ado, ado→md, retest) for that observation. Note records rev={revision}, local_history_sha256={last acknowledged local History hash}, verified_retest={date/evidence when known}, pending actions and failures. Hashes must be computed, never invented; if the host cannot calculate hashes with available tools, report NOT_RUN for provenance-dependent operations.
On an Azure → md pull update Azure state/revision/time and source hash after edits, but preserve Local status and local_history_sha256 so an unsent local transition is not consumed. Record any pending local change in Note. On a successful md → Azure push acknowledge local status/History and the read-back Azure revision. Failed or conflicting pushes preserve the local baseline and record pending work. A changed document hash alone is not a local status transition.
Before a push compare current local status/History to its baseline and current Azure revision/state to its baseline. Both changed → Skipped (conflict — pull first: run skill 8 with --direction azure-to-md or both); after a pull re-evaluate, never overwrite a newer local edit. A missing baseline needs a pull and explicit reconciliation; do not silently accept a local close without retest evidence.
Before creating an unmapped bug, search the confirmed story/project for [BUG-n] plus exact source identity stored in its description. One exact match repairs the map; ambiguous match is Skipped and asks for identity. Never deduplicate across reports by prefix alone. Persist each confirmed created ID immediately; attachment/link failure stays pending in Note and is retried without recreating the item.

## 6. Write recipes
Bug create (skill 8, md → Azure): validate Title, Steps, Expected, Actual, Severity and discovered required custom fields. Ask once for missing values, using skill 6 references/bug-metadata.md closed lists as suggestions subject to actual picklists. Description includes source path + Bug ID; use Microsoft.VSTS.TCM.ReproSteps when available. Attach existing relative-path evidence via MCP upload/attachment tools; missing screenshot is reported, not fabricated. Child bug → story Parent relation is System.LinkTypes.Hierarchy-Reverse (or tool-native Parent); verify direction in tool schema.
Status push (skill 8, md → Azure; skill 9 inline) retries pending attachments/comments separately from state transitions; read back success and avoid duplicate attachments/comments using existing relations/comments and evidence identity. Close/reopen title, tag, state and assignee updates should be one tool update where supported; report partial writes and keep pending actions explicitly.
Test cases are never created or placed in a suite by this family: skill 4 publishes them and its --suite-only mode adds already-published cases to a Test Plan suite.

## 7. Retest and results boundaries
Skill 9 uses Playwright MCP only. Ask once for URL, role, environment/build and unresolved language_switch; password is typed by the user in the browser or supplied through the user-run secrets-file mechanism by secret name, never read into chat. Respect the project's authorization for data-changing steps; an unanswered data-change request cannot be treated as consent.
Execute original reproduction steps and positively verify Expected; failed navigation/login, unavailable data or missing tools is NOT_RUN, not a failed product retest. For non-language-specific bugs run a second language only when language_switch is configured. A required but blocked language pass prevents claiming resolution.
Store BUG-n-retest-{pass|fail}-{date-time}-{language}.png without overwriting old evidence. Automation local resolution names the existing latest run-report phase N; if no phase exists, report the observation and ask skill 5 to establish a phase instead of inventing N. UI uses resolved. No run JSON or historical phase edits.
On a failed retest, change the associated TC result to FAIL in the latest phase only when the user explicitly confirms. Otherwise report the discrepancy for skill 5. Renderer-derived totals are not manually fabricated; ask skill 5 to reconcile/render the report after an authorized TC-result edit. Passing one bug never implies its entire TC passed.
Incidental new bugs are full producer-format entries with fresh IDs and evidence, then use §6 bug creation with the same confirmed story ID. They do not alter the existing bug's reproduction steps.

## 8. Shared output
| Item | Source | ADO ID | Before | After | Result |
|---|---|---|---|---|---|
Result is Created / Updated / Current / Skipped (reason) / Failed (error) / NOT_RUN (reason). Skill 8 adds a Direction column; skill 7 adds Outcome and run ID.
Metrics: scoped, created, updated, current, skipped, failed, not run; retest pass/fail/unobserved where applicable; run ID/completion for skill 7. Count confirmed observations only; unknown is —, never 0. Include map path, pending actions, conflicts, retest candidates and learning-file changes. Never call an unexecuted operation successful.
