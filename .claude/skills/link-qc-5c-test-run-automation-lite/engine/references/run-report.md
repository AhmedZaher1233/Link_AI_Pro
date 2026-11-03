# The run report - `TEST-RUN-REPORT-{feature}.md` + `BUG-REPORT-{feature}.md` as one RENDERED page

Detail: references/maintainers/run-report.md (same §).

The report set (run file, both markdown files, the CSVs) is written by `run-data.mjs` (`finalize`) and the page by `render-run-report.mjs`; the model never hand-writes the HTML and never hand-edits a number. The renderer recomputes every number from the tables.

## 1. Commands

```bash
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report {run_report_md} [--write [--out {path}]] [--force]
node .claude/skills/link-qc-5-test-run-automation/scripts/check.mjs harness --name selftest-run-report.mjs   # before delivering any page
```

Without `--write` it is a dry run; `--force` re-renders over a hand-edited page deliberately. `--base {story folder}` resolves links against that folder (a DRAFT under `artifacts/drafts/phase-{N}/`). `--gate {.runs/phase-N.checkpoint-B.json}` adds the gate record; `run-data.mjs publish` passes it. `--strict` maps the gate to the exit code (PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3). Read the payload, never the HTML: `gate`, `gateReason`, `mismatches[]`, `warnings[]`, `errors[]`.

## 2. Gate

`PASS`: deliver the page (after the harness passes). `MISMATCH`: a written value disagrees with the tables (`mismatches[].source`); the page IS written with a warning strip; fix the markdown line named and re-render, never the HTML. `BLOCKED`: a missing required line / section, an out-of-vocabulary value, a broken row, an unreadable run file, a `data:` image, a password-shaped literal, a hand-edited page without `--force`; nothing is written; fix the markdown (`errors[]`). `NOT_RUN`: no `--report`. A missing bug file, run file or screenshot is a warning.

## 3. Folder contract

```text
{automation_root}/reports/[SPEC-{spec-name}/]{user_story_name}/   <- results_root, same leaf as the TC folder
  TEST-RUN-REPORT-{feature}.md · BUG-REPORT-{feature}.md · TEST-RUN-REPORT-{feature}.html · REVIEW-COMMENTS-{feature}.md (reviewer's)
  automation-inventory.md · coverage/ (three CSVs) · .runs/phase-{N}.json · .runs/phase-{N}.checkpoint-{A|B}.json (gate records)
  artifacts/   drafts/phase-{N}/ (the report set before Checkpoint B) · checks/ · reconcile/ · progress/ · stages/ · diagnostics/ · test-output/
{automation_root}/automation-logs/[SPEC-{spec-name}/]{user_story_name}/run-summary-{stamp}.log · run-progress-{stamp}.log
{automation_root}/screenshots/[SPEC-{spec-name}/]{user_story_name}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png
```

- `{feature}` = the stem of `TEST-CASES-{feature}.md`; `{user_story_name}` = the TC folder's exact leaf. Top-level whitelist: exactly the tree above; nothing else, ever. Every command inside a phase takes the next free `-attempt{n}`.
- Return links: `run-summary-{stamp}.log` (the fixed-format human summary) first, `run-progress-{stamp}.log` second.
- 5b (the manual CLI twin) shares this folder and phase counter; its phase is an ordinary earlier phase here; `BUG-{n}` numbering continues across both.
- Retest updates the latest phase in place: `link-qc-9-retesting` re-runs an automated TC (`run-stage.mjs --run rerun`) and updates that LATEST phase only (the changed Results rows, a `{Stage} (retest — skill 9)` Stages row and the Total, the Outcome, `### Bugs`, one `- **Retest:**` bullet under `### Run`, `### Deviations`, the header, the run-history row, the run file with append-only `retests[]`); its bug resolution is `resolved (phase N)`. Earlier phases stay immutable for every skill.
- Legacy = read-only history: pre-layout files (`reports/US-{id}/`, top-level `phase-N.json` / `phase-N.html` …) are never moved, renamed, deleted or rewritten; they count for phase numbering and are named on `Earlier phases`, never read as run data.

## 4. `TEST-RUN-REPORT-{feature}.md` - parsed by heading and field name, never by position

Header: `# Test Run Report — {feature}`, then `**Key:** value` lines. Required: `**User Story:** US-{id} — {title}` · `**Latest phase:** {N}` · `**Status:** GREEN | FAILURES | INCOMPLETE | SMOKE GATE FAILED | ENVIRONMENT_BLOCKED | BLOCKED` · `**Latest results:** {p} passed · {f} failed · {i} incomplete · {s} skipped · {n} not run[ · {x} partial] of {t} TCs`. Optional lines (`Feature` … `Earlier phases`, maintainers §4) are `—` when empty.

Anchors in order: `## Run history` (one row per phase, oldest first: `Phase · Date · Outcome · Passed · Failed · Incomplete · Skipped · Not run · [Partial ·] Total · Duration · Bugs`) then `## Phase N — YYYY-MM-DD` sections, ascending. Sub-sections (`###`), never any other:

- `Run` (required): bullets `- **Field:** value`: **Outcome** (Status vocabulary, optional ` — reason`), the run facts and the one-liners `run-data.mjs report` writes (`- **Re-run:**`, `- **Isolation checks:**`, `- **Rate limits:**`, `- **Acceptance:** ACCEPTED | ACCEPTED pending Checkpoint B — see gate record | NOT ACCEPTED — {reasons}`). Sub-bullets are not rendered.
- `Stages` (when executed): `Stage · Total · Passed · Failed · Incomplete · Skipped · Not run[ · Partial]`, a `{Stage} (re-run)` row per re-run stage, **Total** = the results of record (never the row sum); then `**Smoke gate:** passed | healed-then-passed ({n} cycles) | FAILED-STOPPED | NO VERDICT — fail% {x}% — {action}`.
- `Run plan`: `Group · Mode · Workers · TCs · Reason`.
- `Coverage`: `Stage · Total TCs · Fully · Partially · Not · Weighted %` + `**Target:** {t}% (…) — **{PASS | user override | report-only | BLOCKED}**` + optional `Requirement · Outcome · Asserted by`.
- `Results` (as Stages): `TC-ID · REQ · Name · Status · Group · Duration · Classification · Evidence`, one row per TC. Status is `PASS | FAIL | INCOMPLETE | SKIP | NOT_RUN | PARTIAL — human step pending` (the one status carrying a reason); a PARTIAL row (Classification `human step: {n}`) counts in `partial`, never as passed, and makes the phase `INCOMPLETE` at best. Classification from the `<first_run>` catalogue (backend: `api-db.md` `<backend_results>` §5). Evidence = links relative to this folder or `—`.
- `Unverified assumptions`: `TC-ID · Ambiguity · Interpretation encoded · Evidence · Result`, or `none`.
- `Bugs`: `Bug · TC-ID · Severity · Status`, ids from the bug file, or `none`; details never here.
- `Heal log`: the nine-column table of `automation-rules.md` §5, or `First run fully green`.
- `Skips and residual failures`: `TC-ID · Status · Reason`, or `none`. `Open questions`: `# · Source · Ambiguity · TCs · Decision · By`.
- `Test-data readiness`: `**Verdict:** …` + the gap table (maintainers §4), or `all ready`; Decision `READY` · `prepared (api|ui|db)` · `skip — data_missing` · `skip — not creatable` · `skip — QC declined`.
- `Deviations`: bullets or `- none`: parallel interference, rate-limit refusals and adjustments, `outside_scope[]` specs not re-run, and `evidence_relocated: {from, to, files}` when check 18 moved images that another config root had placed outside `{screenshots_root}`.
- 3.0: `Retained test records` / `In-doubt test records`, only when a data change was kept or is in doubt; keys only.

Empty optional value = `—`. Earlier phase sections are immutable: each run appends one section and updates only the header and one run-history row (skill 9's retest of the LATEST phase excepted, §3). A run that stops before execution still appends `### Run` with the Outcome and a run-history row of `—`.

## 5. `BUG-REPORT-{feature}.md` - parsed by heading and field name

Header: `# Bug Report — {feature}`, `**User Story:**` (required), `**Latest phase:**`, `**Bugs:** {open} open · {resolved} resolved · {n} not checked this run of {total}`. One anchor `## Bugs`, then one `### BUG-{n} — {title}` per defect (`n` never reused; "The system doesn't … when …"), bullets `- **Field:** value`: `TC-ID` (required) · `Requirement` · `Severity` `Critical | High | Medium | Low` · `Environment`, `Browser`, `Language`, `Build` · `Found in phase` · `Status` (required) `open` · `resolved (phase {M})` · `not-checked-this-run` · `Root cause` · `Steps to reproduce` (required) · `Expected`, `Actual` (required) · `Screenshot` (a relative link, or `none captured`) · `Evidence` · `History` (`- phase {N} — {FAIL | PASS | not run}: {note}`, appended) · `Reviewer comment` (never a status source).

`resolved` only after an actual successful retest; a bug whose TC did not run becomes `not-checked-this-run`; an entry is never rewritten, only Status and History change; no bugs: `## Bugs` + `none`.

## 5b. The tracker - `TC-STATUS-TRACKER-{feature}.md` (read-only)

Lives in the story's TestCases folder, never in the reports folder; the renderer only reads it (`--tracker`). Every tracker problem is a `tracker-*` warning.

## 6. Derived numbers

`**Status:**` / `Outcome`: `SMOKE GATE FAILED` when the smoke-gate line says `FAILED-STOPPED`, else `FAILURES` if any FAIL, else `INCOMPLETE` if any INCOMPLETE or PARTIAL or `NO VERDICT`, else `GREEN`; a declared `ENVIRONMENT_BLOCKED` / `BLOCKED` with no Results table is accepted as declared.

## 7. `.runs/phase-N.json` - schema `skill6-run/1` and its lifecycle

One file per phase, written by the scripts, never by hand; POSIX paths relative to `{automation_root}`. `status` is `planning | ready | running | complete | stopped-smoke-gate | environment-blocked | blocked`. Keys of note: `delivery { report: html | md, screenshots: all | failed | none }`, `results[]` (the results of record, each with `rerun { reason: impacted | no-verdict | added, changed[] } | null`), `heal_log[]` (the nine columns of `automation-rules.md` §5 + `cause_class`), `evidence_relocated { from, to, files }` (only when check 18 moved images), `acceptance { verdict, reasons[], mode }`, `impact { selections[], final_check }`. Full key list and shapes: maintainers §7.

Freshness: `{run_file}.impact.final_check = { outcome: FRESH | STALE, stale: [], fresh: N, checked_at }`, written by `finalize`, always present after it, never copied in by hand.

Lifecycle: `N` = 1 + the highest phase across `.runs/phase-*.json` and every legacy root, assigned once at profile time. Created `status: planning`; final means immutable, except skill 9's retest of the LATEST phase. An early stop leaves its final status; the next invocation takes N+1. The coverage delta reads the newest earlier `coverage_snapshot`, else "no prior measurement".

## 8. Evidence links and the viewer

Evidence / Screenshot cells are markdown links RELATIVE to the report folder. A missing file warns; a `data:` URI BLOCKs; nothing under `screenshots/` is ever moved. A `.record.json` carrying a credential-shaped value BLOCKs (`secret-literal`).

## 9. Provenance and hand edits

Line 2 of every page is the provenance comment (input sha256s, a self-hash, ` · gate={sha256}` after Checkpoint B). A self-hash mismatch on `--write` means a human edited the HTML: refused (`refused.reason: hand-edited`) until `--force`; say what will be lost first.

## 9b. Reviewer comments - `REVIEW-COMMENTS-{feature}.md`

Ids: `General`, `BUG-{n}`, `phase-{N}`; shape = skill 3's `html-page.md` §7b. A skill changes only Status (`applied {date}` / `answered {date}` / `declined {date}`), adds `- **Response:** {one plain sentence}` and recomputes the header; never edits the reviewer's text. A comment is never a status source: a bug's Status changes only per §5.

## 9c. Navigation, sorting and filtering

Display only, never a value.

## 10. Templates

Maintainers only: `assets/run-report.template.html` inside `assets/report-shell.template.html` (byte-identical with the sibling skills). After a change run `node scripts/selftest-run-report.mjs --pretty`.

## 11. Migration

Legacy files stay as read-only history (§3); the first run under this layout says so once in the chat. Nothing is migrated, merged or deleted.
