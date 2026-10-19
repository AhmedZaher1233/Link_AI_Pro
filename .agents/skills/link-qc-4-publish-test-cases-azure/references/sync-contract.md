# Azure DevOps sync contract — tags, automation status, test data, read-back, ADO-MAP.md

Loaded by `SKILL.md` PHASE 2. The rules here are implemented once in
`scripts/ado-sync-plan.mjs`; the skill never re-derives them by hand. **MCP does every read and
write; the script decides; the read-back proves.** Nothing in this file names a project.

## 1. The three script calls of one publish

```bash
# 0 — the canonical hash of every TC (what published_tc_sha256 / automated_tc_sha256 hold)
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/ado-sync-plan.mjs hash --tc {source_tc_doc} --data {test_data_doc} --pretty

# 1 — the plan: document facts + convention tags + previous map + what MCP read → what to write
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/ado-sync-plan.mjs plan \
  --tc {source_tc_doc} --data {test_data_doc} --beautified {beautified_tc_doc} \
  --map {ado_map} --remote {run_dir}/remote.json --feature {feature} [--convention-tags a,b] \
  --story {US id} --project {ado_project} --hosting {ado_hosting} --out {run_dir}/plan.json --pretty --strict

# 2 — the verdict: plan + read-back → per-TC verdicts, the outcome line, the NEW ADO-MAP.md
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/ado-sync-plan.mjs verify \
  --plan {run_dir}/plan.json --readback {run_dir}/readback.json --snapshot attached|comment|NOT_RUN \
  [--attempt 2] [--suite {suiteId}] --write-map {ado_map} --pretty --strict
```

`--tc` is always the **approved** document (skill 5 hashes the same file, so the two hash columns of
`ADO-MAP.md` are comparable); the beautified document is what MCP publishes, and its TC-ID set must
equal the approved one (else the plan is BLOCKED). `{run_dir}` is a scratch folder outside the
story folder (nothing there is a deliverable). `--strict` exit codes: VERIFIED 0 · MISMATCHES 1 ·
NOT VERIFIED 2 · INCOMPLETE 3 · BLOCKED / NOT_RUN 4 (plan / hash: PASS 0, else 4). Before the first
call of a run: `node …/scripts/selftest-ado-sync.mjs` must exit 0, otherwise BLOCKED "decision
script self-test failed — {case}".

## 2. `remote.json` — what you read before writing (per TC-ID)

One entry per TC of the document, fetched through MCP (`wit_get_work_item` / `get_work_item` with
the fields below, or the story's Tested-By list matched on the `[TC-ID]` title prefix):

```json
{ "TC-…": { "id": 123,
            "tags": ["a", "b"],                       // or the raw "a; b" string — both accepted
            "automationStatus": "Planned" | "Automated" | "Not Automated" | null,
            "descriptionHasTestData": { "ids": ["A1", "D1"], "sha": "…" } | null },
  "TC-…": null }                                      // no work item yet → create
```

`descriptionHasTestData` is what you parse out of the current description: the `[A|E|D]` ids listed in
its "Test data" block and the sha256 it names (`null` when there is no block). Fields:
`System.Tags`, `Microsoft.VSTS.TCM.AutomationStatus`, `System.Description`.

## 3. Automation status — the mapping (never assumed)

| Document `Automation Candidate` | Intended `AutomationStatus` | Plan action |
|---|---|---|
| `YES` | `Planned` | `write` (or `keep` when already `Planned`) |
| `NO` | `Not Automated` | `write` (or `keep`) |
| field absent (legacy document) | — | `unknown` — nothing written, row `unknown (no candidacy field)` |
| any, and the work item already says `Automated` | `Automated` kept | `keep` **only** when the previous map's `automated_tc_sha256` equals `canonical(current TC)` |
| any, `Automated` without that provenance or with a different hash | untouched | `conflict` — `CONFLICT — automation may not cover the current TC; re-run skill 5` (row flagged, status not written) |

Skill 5 alone writes `Automated`, `Custom.TestAutomated` and `automated_tc_sha256`. A template
that rejects a value (400 on `Not Automated`, for instance) is recorded once as a per-project
`[type: env]` fact ("AutomationStatus values the template accepts: …") — the value is then
reported `not written (template rejects {value})` and counted under **not written**.

## 4. Tags — intended set, ownership, add / remove / preserve

**Intended set per TC** = `{feature}` · `smoke` (when `Smoke: YES`) · `automation` (candidate YES) or
`manual` (candidate NO; neither when the field is absent) · `human-step` (any `[HUMAN]` step) · the
TC's `Tags:` values (`—` = none) · convention tags (a `[type: env]` "tag convention" line of the
learning file or the task input — an INPUT, never invented).

**Before every write the current tags are read.** Per TC:

- `tagsAdd` = intended − current
- `tagsRemove` = previously introduced (the map's `Tags (introduced)` column) − intended, and present
- `tagsPreserve` = everything else on the work item — unrelated tags are never touched
- a tag already on the work item never becomes owned, even when the document also names it

**Ownership persists cumulatively and only after verified writes.** After `verify`:

```
Tags (introduced) = (previously introduced ∩ still intended ∩ read back present)
                  ∪ (added by this run ∩ read back present)
```

A removal confirmed by read-back leaves the record. An addition that failed or whose read-back was
`NOT_RUN` is **not** recorded (it is retried next run and listed under the unverified items).
Legacy map without the column → ownership `unknown`: nothing is removed this run, only adds, and the
column is initialised from this run's verified adds. Tag comparison ignores case.

## 5. Test data in Azure — the per-TC block is the executable unit

Steps keep the reference tokens verbatim: `Login with Administrator [A1]`, `Go to the portal
[E1]`, `Data Oracle: price list "Sample" [D2]`. Each Test Case description carries a **"Test data"
block** (the plan's `descriptionBlock.text`, written as-is under the REQ-IDs / locale /
preconditions / Data Oracle part):

```
Test data — TEST-DATA-{feature}.md (sha256 {sha})
- [A1] Administrator — username: admin.user — used for login in every TC
- [D2] price list "Sample" — must look like: 3 rows, active
- [E1] application base URL — https://{host}
Each reference resolves to its own row of that file; passwords are never listed here.
```

Every row the TC references (id, role / plain name, username or value — **never a password**; a
password-shaped row BLOCKs the plan) plus the file name and sha256. This block alone makes the TC
executable from Azure; it is REQUIRED for every TC. Read-back must show every referenced id and the
current sha, else `MISMATCH (test data)`.

The full-file **snapshot on the User Story** is supplementary: attachment tool
(`wit_add_work_item_attachment` or equivalent) → else a work-item comment `TEST-DATA snapshot {sha}`
with the file content → else `NOT_RUN`. `--snapshot attached | comment | NOT_RUN` tells `verify`
which happened; a snapshot `NOT_RUN` is reported in the outcome line and never prevents
`PUBLISHED AND VERIFIED`.

## 6. `readback.json` — what you read after writing (per TC-ID)

Same shape as §2, fetched again **after** the writes (a fresh read, never the values you sent):

```json
{ "TC-…": { "id": 123, "tags": [...], "automationStatus": "…", "descriptionHasTestData": { "ids": [...], "sha": "…" } },
  "TC-…": null,                                       // read-back unavailable → NOT_RUN
  "TC-…": { "writeError": "TF401320: …" } }           // the write itself failed → NOT_WRITTEN
```

Optionally wrapped: `{ "items": { … }, "snapshot": "attached" }`. A TC whose plan lists no change
(`changes: []`, `unchanged: true`) is `current` without `--republish`: nothing is written and its
`remote.json` entry is copied into `readback.json` as its read-back.

**Per-TC verdicts:** `verified` (id, tags, status and test-data block read back equal to the plan) ·
`MISMATCH (field, intended, actual)` · `CONFLICT` (status conflict of §3, everything else equal) ·
`NOT_RUN` (read-back unavailable) · `NOT_WRITTEN ({error})`.

**One retry.** On `MISMATCH`, rewrite exactly the fields `retry.tcs[]` names through MCP, read back
again and run `verify --attempt 2`. A mismatch that survives the retry stays a mismatch — never a
third silent attempt, never a "probably fine".

## 7. Outcome — precedence and the counts line

| Outcome (highest wins) | When |
|---|---|
| `BLOCKED` | gate / auth failure before or during publish; plan or read-back unreadable |
| `PUBLICATION INCOMPLETE` | ≥ 1 TC not created / updated / linked, or its description block not written — listed with the error |
| `PUBLISHED WITH MISMATCHES` | all written; ≥ 1 `MISMATCH` or `CONFLICT` after the one retry |
| `PUBLISHED, NOT VERIFIED` | all written; no mismatch known; ≥ 1 read-back `NOT_RUN` |
| `PUBLISHED AND VERIFIED` | all written; every TC read back equal to the plan, test-data block included |

The line always carries the counts, e.g. `PUBLISHED WITH MISMATCHES (2 mismatch · 1 conflict ·
1 not verified · 0 of 4 verified · snapshot NOT_RUN)`. Tested-By links are verified per TC on the
story's relations in the same read-back; a missing link is `PUBLICATION INCOMPLETE` for that TC.

## 8. `ADO-MAP.md` — columns and ownership of each

`verify --write-map {ado_map}` writes it (dry-run otherwise; the text is always in the payload):

```markdown
<!-- source_sha256: {sha256 of the approved document this publish reflects} -->
<!-- published_on: {ISO-8601} · story: {US id} · project: {ado_project} · hosting: {ado_hosting} -->
<!-- ado-sync: {outcome line} · schema ado-sync/1 · hash tc-hash/1 -->
| TC-ID | ADO Work Item ID | published_tc_sha256 | automated_tc_sha256 | Automation candidate | AutomationStatus | Tags (introduced) | Suite |
```

| Column | Written by | Value |
|---|---|---|
| `published_tc_sha256` | skill 4, every publish | `canonical(TC, TEST-DATA)` of the approved document at this publish; `—` for a TC not written |
| `automated_tc_sha256` | **skill 5 only** (after `full` coverage, `PASS`, Checkpoint B PASS — never for a `PARTIAL` TC) | copied through untouched by skill 4 |
| `Automation candidate` | skill 4 | `YES` / `NO` / `—`; `removed from document — work item left in place` for a row whose TC left the document |
| `AutomationStatus` | skill 4 (read back) / skill 5 (`Automated`) | the read-back value; `{value} (not verified)`, `unknown (no candidacy field)`, `… (CONFLICT — …)`, `not written` |
| `Tags (introduced)` | skill 4 after verify | §4 — the tags this skill owns on that work item |
| `Suite` | skill 4 (`--suite-only` later) | `{suiteId}` or `skipped`, never blank |

Rows are never dropped; a previous map without the new columns is read as-is and rewritten with
them. Skill 5 reads `source_sha256` to detect `linked`, and `published_tc_sha256` to compare with
its own hash — neither is skill 5's entry gate.

## 9. Canonical TC hash (`scripts/tc-hash.mjs`, `tc-hash/1`)

`sha256(behaviour fields + fingerprint of the referenced data rows)`. Behaviour fields: `Locale`,
`Requirement`, `Preconditions`, `Steps`, `Expected Result`, `Data Oracle`, `Data effect`,
`Shared data` — text inside quotes (`"…"`, `“…”`, `«…»`, backticks) byte-for-byte; outside quotes
emphasis stripped, whitespace collapsed, numbering dropped, `[HUMAN]` / `[A1]` / `[E2]` / `[D3]`
kept. Excluded: `Validation`, the evidence stamp, `Smoke`, `Automation Candidate`, `Tags`, the
heading. Fingerprint: `[A{n}]` → role + note; `[D{n}]` → plain name + Must look like; `[E{n}]` →
What. Usernames, URLs, statuses and dates never change the hash. A formatting-only edit ⇒ same
hash; a changed typed value, dataset shape, account role or `Shared data` ⇒ different hash. The
file is byte-identical in skill 5 (`MIRROR` banner); both harnesses assert one golden hash.
