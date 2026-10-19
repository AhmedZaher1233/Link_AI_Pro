# Fixtures for `selftest-ado-sync.mjs`

Every case is mocked — nothing here talks to Azure DevOps. Names are neutral on purpose
(Administrator / admin.user / Products / `example.com`); never put a project's real host,
collection, project or account here.

| Path | What it is |
|---|---|
| `sample/TEST-CASES-sync.md` | an APPROVED document with the current contract: `Tags:` field, `[A1]` / `[E1]` / `[D1]` reference tokens, one `[HUMAN]` step (TC-SYNC-03), one legacy TC without `Automation Candidate` (TC-SYNC-04) |
| `sample/TEST-DATA-sync.md` | its TEST-DATA file: `## 0. Environment` (E1, E2), `## 1. Accounts` with `ID` (A1, A2), `## 2. Test data at a glance` (D1, D2); never a password |
| `maps/legacy.ADO-MAP.md` | a previous map WITHOUT the hash / ownership columns (five columns) and one row for a TC no longer in the document |
| `remote/base.json` | what the skill read from Azure DevOps before writing (per TC-ID; `null` = no work item yet) |
| `readback/base.json` | the read-back after applying the golden plan (generated) |
| `golden/plan.json` | `plan` payload for sample + legacy map + base remote (generated) |
| `golden/ADO-MAP.md` | the new map `verify` renders for that plan and read-back (generated) |

`GOLDEN_TC_HASH` in the harness is the canonical hash (`tc-hash/1`) of TC-SYNC-01 with
`TEST-DATA-sync.md`. Skill 5's harness asserts the same literal against its byte-identical copy of
`tc-hash.mjs`; change one and the other must change with it.

The goldens hash LF-normalised text, so they do not depend on git's line-ending conversion.
Regenerate them only for a deliberate change:

```bash
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/selftest-ado-sync.mjs --regen
```
