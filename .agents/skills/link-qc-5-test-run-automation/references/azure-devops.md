# Azure DevOps — linkage detection and the close-out (only when the story is published)

Loaded by `SKILL.md` only when `{tc_output_folder}/ADO-MAP.md` exists: at **Reviewing Requirements &
Test Cases** for the linkage check, and at **Preparing Final Report** for the close-out under
`ado_mode = linked`. Under `local` nothing here applies and the file is never loaded.

## PHASE 1 — AZURE DEVOPS LINKAGE (optional, detection only)

<ado_linkage>
Beautifying and publishing the TCs is **not part of this skill** — it is
`link-qc-4-publish-test-cases-azure`, a **separate and optional** skill. **It is not a prerequisite:
this phase DETECTS whether it happened, it does not require it.** Never block here, never ask
the user to publish or upload, never tell them to run skill 4.

Detect `ado_mode` — all three must hold for `linked`:

1. `{beautified_tc_doc}` exists and its frontmatter `source_sha256` equals
   `sha256({source_tc_doc})`.
2. `{ado_map}` exists, its `source_sha256` comment equals the same hash, and every TC-ID
   of the approved document has a row with a work item ID.
3. Spot-check one row: fetch the work item, confirm the title starts `[TC-ID]` and it is
   Tested-By linked to the User Story.

All three pass → **`ado_mode = linked`**: PHASE 5 will close the loop in DevOps, and
`Needs human review` notes in the beautified document are carried into the coverage table as
`manual — unconfirmed step` unless the original approved document resolves them.

Any check failing, or the files simply not being there → **`ado_mode = local`**. State the
reason ONCE in the chat as a Deviation (e.g. "not published to Azure DevOps — running
locally", "ADO-MAP.md is older than the approved document — running locally") and **continue
the full run**. PHASE 5 is then skipped silently. Never regenerate the beautified file and
never create or edit Test Case work items here.

Everything after this phase reads the **original approved document** (PHASE 2); `ADO-MAP.md`
is read in PHASE 5 only under `linked`.
</ado_linkage>

---

## PHASE 5 — CLOSE THE LOOP IN DEVOPS (only under `ado_mode = linked`)

<ado_closeout>
**Under `ado_mode = local` skip this entire phase silently.** Record it in the structured
return as `not applicable — story not published to Azure DevOps` and move on. Do NOT suggest
running `link-qc-4-publish-test-cases-azure`, do NOT ask the user to publish or upload, and do NOT
treat the skipped phase as a failure — the run is complete without it.

Under `ado_mode = linked`, using `{tc_output_folder}/ADO-MAP.md` — columns
`| TC-ID | ADO Work Item ID | published_tc_sha256 | automated_tc_sha256 | Automation candidate |
AutomationStatus | Tags (introduced) | Suite |`. **This skill owns exactly two of them**:
`automated_tc_sha256` and `AutomationStatus` (the `Automated` value only). `published_tc_sha256`
and `Tags (introduced)` are skill 4's, `Suite` is skill 4's `--suite-only`; none of them is ever
touched here, and a legacy map without the hash columns gets them added, never rewritten:

0. **Compute the canonical hash of every TC that earned `Automated`** — ran `full` coverage (no
   `[HUMAN]` step), `PASS` on every required variant in run 2, **after Checkpoint B PASS**:
   ```bash
   node .claude/skills/link-qc-5-test-run-automation/scripts/tc-hash.mjs --tc {source_tc_doc} --data {tc_output_folder}/TEST-DATA-{feature}.md --ids TC-01,TC-02 --pretty
   ```
   and write each `hashes[TC-ID]` into that TC's `automated_tc_sha256`. The hash is semantic
   (behaviour fields + the role / data shape the TC references — `references/run-report.md` names
   the script; the contract is the file's header): skill 4 keeps `Automated` on a later publish
   only while it still equals `canonical(current TC)`, so a changed step or data shape flips the
   Azure status to a conflict instead of overstating it. **A `PARTIAL` TC never gets a hash and
   never `Automated`** (nor does a FAIL, INCOMPLETE, SKIP, NOT_RUN or `@unverified-assumption`
   TC); its cell stays `—`. `tc-hash.mjs` is a byte-identical copy of skill 4's (MIRROR banner) —
   run `node …/scripts/selftest-tc-hash.mjs` once per run before writing a hash; a failing harness
   means no hash is written and the column is reported `NOT_RUN`.
1. For every TC whose automation now exists and executed in run 2:
   - **Resolve the template's automation flag ONCE per project** (`automation_flag`):
     learning file `[type: env]` line → skill 4's `tc_template_quirks` → inspect the
     Test Case work item type's fields (`_apis/wit/workitemtypes/Test Case/fields` — on the
     self-hosted server there is no MCP tool for that: one REST `GET` through the shell with
     `Authorization: Basic` from `$env:AZURE_DEVOPS_PAT_B64` read by name, never printed; or
     skip the probe and try `update_work_item` with the candidate field, reading the 400).
     Preference order: (a) a boolean custom field whose name means "automated"
     (e.g. `Custom.TestAutomated`) → set it `true`; (b) otherwise
     `Microsoft.VSTS.TCM.AutomationStatus` = `Automated`. Leave the flag unset / `false`
     only where automation was deliberately never written. Record the resolved field and its
     accepted values in the learning file as one `[type: env]` line so no later run re-probes.
   - Set automated-test metadata
     (`Microsoft.VSTS.TCM.AutomatedTestName` = the spec test title,
     `Microsoft.VSTS.TCM.AutomatedTestStorage` = the spec file path). Both verified writable.
   - `Microsoft.VSTS.TCM.AutomationStatus`: **⚠️ some process templates accept ONLY
     `Not Automated` and `Planned` and REJECT `Automated`** with
     `400 The field 'Automation status' contains the value 'Automated' that is not in the
     list of supported values`. On that error: keep `Planned`, rely on the custom flag +
     the metadata fields to express automation, never write `Automated` into `ADO-MAP.md`
     (that records a status ADO refused), and record the restriction in the learning file.
   - Keep `Planned` for candidates that ended up skip-guarded (note why in the map), for any
     TC whose PHASE 2.5 status is Partially / Not Covered — copy the reason from
     `coverage-detail.csv` — for any TC skipped by a PHASE 2.6 decision — copy the gap
     text from `{run_file}.data_readiness` — **for every `PARTIAL — human step pending` TC**
     (note `partial (human step: n)` in the map; its test outcome is `Inconclusive`, its
     `automated_tc_sha256` stays `—`) and for any TC tagged `@unverified-assumption`, copying
     the assumption from `{run_file}.open_questions`, so the ADO status never overstates the coverage.
   - **Test outcome per TC** (where the project records outcomes on test points / results —
     the self-hosted server has no test-plan tools, so there the outcome is recorded as
     `skipped — no test-plan tools on the self-hosted server` in the map and the summary
     comment, never claimed):
     `PASS` → `Passed`; `FAIL` → `Failed`; **`INCOMPLETE` → `Inconclusive`** (or the project's
     configured non-pass outcome — never `Passed`), with the missing variants and every
     variant's result in the result comment; **`PARTIAL` → `Inconclusive`** with `human step
     pending: step {n}` in the result comment; `SKIP` → `Not Applicable` / the project's skip
     outcome; `NOT_RUN` → left not executed. A TC with one required variant passed and another
     skipped or not run is therefore never reported as Passed anywhere in ADO.
     **A TC tagged `@unverified-assumption` is never `Passed` either** — `Inconclusive` with the
     assumption quoted in the result comment, whatever the test did.
2. Post ONE summary comment on the User Story: **run number** (report section `## Phase {N}`), final-run counts
   (pass/fail/incomplete/skip/not-run — TC counts, plus variant totals), smoke-gate verdict,
   number of app bugs found (with TC-IDs), and the `TEST-RUN-REPORT-{feature}.md`
   (`## Phase {N}` section), `BUG-REPORT-{feature}.md`, `.html` and `.runs/phase-{N}.json` paths
   (under `reports/{spec_level}{user_story_name}/`).
3. Update `ADO-MAP.md`: the `AutomationStatus` column (the value Azure DevOps actually accepted,
   never `Automated` when the template refused it) and the `automated_tc_sha256` column from
   step 0 — the other columns byte-identical.

ADO failures here degrade gracefully: report what could not be updated — never
fake a status.
</ado_closeout>
