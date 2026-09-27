# Direction Azure → md (pull developer states)

Loaded by SKILL.md step 2. Contract sections: §§1–5. Read scope only for this direction; this direction never creates a work item and never changes a document Status.

1. Read the ledger `ADO-BUG-MAP.md` (missing → BLOCKED "nothing was synced for this story yet — run this skill with --direction md-to-azure first"). `--only` restricts the rows.
2. Batch-get every mapped work item (state, assigned-to, changed-by, changed-date, revision). A missing or deleted ID is `Failed`; never drop or remap the row. Story children that are not in the ledger are reported as `untracked`, never created locally; never derive a bug ID from the story ID.
3. Compare each item with the stored Azure baseline (`ADO state`, `rev`):
   - Unchanged → `Current`; do not append duplicate History on repeated pulls.
   - Changed to a terminal state (Resolved / Closed / Done / Removed) while the local status is `open` → append one dated History line in the producer's format (`- {date} — Azure DevOps: {old} → {new} ({actor}) — awaiting retest (skill 8)`), keep Status `open`, and list the bug as a retest candidate. Closed/Removed without a retest gets the same treatment plus an explicit note; it never closes locally.
   - Changed to a non-terminal state (New / Active / …) while the local status is `resolved` → the developer reopened it: set Status `open`, append `- {date} — reopened in Azure DevOps ({new}, {actor}) (skill 8)`, recompute the report's `**Bugs:**` header line. UI reports have no Status field: record the reopen in the ledger `Local status` and Note.
   - Any other change → History line only.
4. Recompute the `**Bugs:** {open} open · {resolved} resolved · {n} not checked this run of {total}` header of a BUG-REPORT whenever a Status changed; skill 5's renderer compares it with the entries.
5. Update the ledger: `ADO state`, `rev`, `Last sync {ISO-8601} ado→md`, source hash after the edits; preserve `Local status` and `local_history_sha256` so an unsent local transition is not consumed.
6. Report per contract §8 (`Direction: ado→md`, columns Before = previous local status / After = new local status) and the explicit retest-candidate list `(Source, Bug ID, ADO ID)` for skill 9.

Never touch: bug titles, steps, expected/actual, severity, evidence links, other rows, `ADO-MAP.md`, anything in the reports folder except the Status / History / header of the bug document.
