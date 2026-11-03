# Stage 4 — Lightweight Checkpoint B & Report

## 1 · Judgements — ONE file
Write `{results_root}/artifacts/judgements-phase-{N}.json` (validated whole by Full's `judge`; one bad entry rejects all — nothing is written):
```json
{ "results": { "TC-07": { "classification": "app_bug", "root_cause": "The order list shows 'Draft'; REQ-04 / TC-07 expect 'Submitted'", "severity": "High" },
               "TC-12": { "classification": "automation_failure", "root_cause": "the sign-out menu opens late", "severity": "N/A" } },
  "parallel_checks": [ { "tc": "TC-02", "cause": "test_data_conflict", "resolution": "test-side: the status filter is session state (learned conflict)" } ],
  "heal_log": [ { "tc_id": "TC-12", "files": ["pages/TopBar.ts"], "category": "wait", "previous": "…", "updated": "…", "reason": "…", "requirement_ref": "REQ-04", "verification": "re-run PASS ×3", "rerun_result": "PASS", "cause_class": "timing" } ],
  "deviations": [ "…" ], "skips": [ { "tc_id": "TC-19", "status": "SKIP", "reason": "the payment sandbox is not available on this environment" } ],
  "unverified_assumptions": [ { "tc_id": "TC-06", "wording": "…", "interpretation": "…", "evidence": "…", "result": "PASS" } ],
  "bugs": [ { "id": "BUG-1", "title": "…", "tc_id": "TC-07", "severity": "High", "status": "open" } ] }
```
**Superseded attempts** (a fix made an attempt's evidence obsolete, e.g. mislabelled ledger lines): `"superseded_attempts": [ { "attempt": "positive-parallel-attempt3",
"superseded_by": "positive-parallel-attempt4", "reason": "…", "finding": "L12", "fix_snapshot": "{Checkpoint A PASS snapshot id of the fix}" } ]` (attempt id = the
progress file name without `.jsonl`). `judge` refuses the set unless the newer attempt ran the same stage and **every** TC of the older one, passed its freshness gate,
is not itself superseded, and started after that Checkpoint A PASS, which itself came after the older attempt. 48b / 53 then skip the older attempt's events and ledger
labels (consent, environment, read-back, clean-up and doubt still count); nothing on disk changes; the report lists it under `### Superseded attempts`.
**Stall events** of the other attempts (`next` / 48b name them) go in `"events"`: `{ "kind": "stall", "tc": "…", "attempt": 2, "classification": "explained-progress-gap",
"reason": "…", "refs": ["tests/…spec.ts:41"] }` — the only class that passes. `real-hang`, an unclassified stall or `superseded` without a record fail B: heal, re-run, supersede.
Only what exists: omit empty keys. Every FAIL needs a classification from stage 3's list; a bug's `tc_id` must have a result row. Mechanical classes
(`rate_limited`, `interrupted: …`, `not started: …`) are the script's and are never overwritten.

## 2 · Bug narratives (only when `bugs[]` is not empty)
Create `{results_root}/artifacts/drafts/phase-{N}/BUG-REPORT-{feature}.md` exactly in this shape (the renderer gate reads it; the script refreshes the
`**Latest phase:**` / `**Bugs:**` lines and checks every `bugs[]` id has its block):
```md
# Bug Report — {feature}
**User Story:** {US-id} {story name}
**Latest phase:** {N}
**Bugs:** {open} open · 0 resolved · 0 not checked this run of {total}

## Bugs

### BUG-1 — The system does not show X when Y
- **TC-ID:** TC-07 (also TC-07b)
- **Requirement:** REQ-04
- **Severity:** High
- **Environment:** staging (https://shop.example.test)
- **Browser:** Google Chrome (Playwright project chrome)
- **Language:** English
- **Build:** unknown
- **Found in phase:** 1
- **Status:** open
- **Root cause:** One plain sentence.
- **Steps to reproduce:**
  1. Sign in as the reviewer.
  2. Open the request and verify the status.
- **Expected:** Quoted from the approved TC.
- **Actual:** One plain sentence.
- **Screenshot:** [attempt-1-failed.png](../../../screenshots/{leaf}/phase-1/TC-07/{project}--none--r0/attempt-1-failed.png)
- **Evidence:** `expect(locator).toHaveText(expected) failed` (pages/RequestPage.ts status)
- **History:**
  - phase 1 — FAIL: first run and re-run.
```
One field per bullet (the renderer reads them so); Severity Critical / High / Medium / Low. Title = the user-visible symptom, never an assertion,
locator or TC-ID; `screenshots: none` ⇒ `Screenshot:` reads `none captured (screenshots: none this run)`. No bug ⇒ no file (finalize writes `none`).

## 3 · Finalize — one call
```
lite finalize --results-root {results_root} --phase {N} --files {all final specs + shared files} --feature {feature} --judgements {judgements file}
   --tc {doc} --data {TEST-DATA} --req {REQ file(s)}
```
`--files` = ALL final specs + shared files + the journeys listed by `lite journey` / `lite teardown` (exempt from the `[TC-ID]` rule only). It runs: Checkpoint A coverage of the final code — when the last A does not cover it,
finalize refreshes A itself on that whole scope with the inputs of the last PASS (a FAIL there stops it; an `--assertion-review` must name the new snapshot) → drafts → merge of every attempt (first run + re-runs, history kept) → your judgements → freshness → pre-gate acceptance →
report → renderer gate → **freeze → Checkpoint B** → gate record → publish → final acceptance → `.auth/` removed (stored sessions). The draft can only say
"pending"; publish rewrites the status lines (header and phase `Compliance`, `Acceptance`) from the B record of the frozen snapshot and the renderer gate
refuses any line that disagrees — never edit them by hand. Output: `outcome`, `checks {results-integrity, tc-status-coverage, failure-evidence}`,
`problems`, `acceptance`, `counts`, `report`, `next`.
- **PUBLISHED + ACCEPTED** ⇒ continue. **FAIL / BLOCKED** ⇒ nothing is published: repair what `problems` names (a missing image ⇒ evidence; `PASS without a passing final attempt` ⇒ re-run;
  stale ⇒ `rerun-select`; Checkpoint A refresh FAIL ⇒ fix what it names), then run `finalize` again. Never patch the run file by hand: a missing run plan,
  consent record or reason is a script defect to report. **PUBLISHED but NOT ACCEPTED** (unresolved interference finding,
  required TC not run by admission / lease, data change in doubt, smoke NO VERDICT) ⇒ the return is `## BLOCKED` with those reasons; never `AUTOMATION COMPLETE`.
- The report is markdown by default (`TEST-RUN-REPORT-{feature}.md`, `BUG-REPORT-{feature}.md`). HTML exists only when the run file's `delivery.report` is `html` (Full's renderer — never
  another implementation). Reviewer comments on a report: Full `final-run.md` `<second_run>` step 4 + `run-report.md`.

## 4 · Close-out (each only if it applies)
- **Azure DevOps** (`--ado`, `ADO-MAP.md` present): Full `azure-devops.md` `<ado_closeout>` (automation fields via `tc-hash.mjs`, one story comment); skills 7 / 8 sync statuses / bugs afterwards. Never required.
- **Data:** keep or clean up what the run created — ask once only if records remain (Full `test-data-preparation.md` step 7).
- **Learning file** (only when `sources.learning` exists — never create it, never write the constitution; without one, new facts go in the return):
  write each new fact / answered question as one generic tagged line (`[module:] [page:] [type: trick|env|qa|data]`); no secrets, no run-specific values.
  Facts about the **application and environment** only (incl. the auth facts of stage 1 §4). A workaround for a skill / tooling defect goes under
  Deviations and in the return, never in the learning file; if one must be kept, tag it `[type: tooling] [skill: {version}]` (later versions ignore it).
- **Lease:** `capacity.mjs lease release --run-file {rf}` if one was acquired. Release browsers / env resources.
- **Summary log:** `{logs_root}/run-summary-{stamp}.log` is linked first in the return.

## 5 · Return
`## AUTOMATION COMPLETE` (both gates PASS for the final scope, PUBLISHED, ACCEPTED) or `## BLOCKED` / `## ENVIRONMENT_BLOCKED` — see SKILL.md *Returns*. Keep it short: status, counts
(PASS / FAIL / SKIP / NOT_RUN / manual), bugs with IDs and severity, what needs the user, links, and the learning-file line.
