# The run report — `TEST-RUN-REPORT-{feature}.md` + `BUG-REPORT-{feature}.md` → one RENDERED page

Load at profile time (folder contract, phase numbering, run-file lifecycle) and at the finalization
step of PHASE 4 (append, update the bug file, render).

**Never hand-write the HTML. Run the script.** `scripts/render-run-report.mjs` turns the story's
`TEST-RUN-REPORT-{feature}.md` (test-case status, one section per phase) and
`BUG-REPORT-{feature}.md` (the defects) plus the machine data in `.runs/phase-N.json` and the
reviewer's `REVIEW-COMMENTS-{feature}.md` into `TEST-RUN-REPORT-{feature}.html`, from
`assets/run-report.template.html` (the body partial) inside `assets/report-shell.template.html`,
the one general report page shared byte-for-byte with skills 3, 3b and 3c. It recomputes every
number from the tables, refuses to invent one, marks what it cannot supply with `—`, links every
screenshot by relative path with a "View screenshot" viewer (never base64), and stamps the page
with a provenance comment (report / bugs / runs / comments sha256 + a self-hash) so a hand-edited page is
detected. Same inputs → same bytes, so a render is always safe to repeat.

## 1. Commands

```bash
# dry run — parse, compute, validate; prints the JSON payload, writes nothing
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report {run_report_md} --pretty
# render the page next to the markdown (TEST-RUN-REPORT-{feature}.html)
node … --report {run_report_md} --write --pretty [--out {path}]
# after a deliberate re-render over a page a human edited (the payload said refused.reason: hand-edited)
node … --report {run_report_md} --write --force
# the harness — run it before delivering any page the script rendered
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-report.mjs --pretty
```

`--bugs`, `--runs` and `--comments` override the defaults (`BUG-REPORT-{feature}.md` next to the
report, `.runs/` in the same folder and `REVIEW-COMMENTS-{feature}.md` next to the report). `--strict` maps the gate to an exit code for CI (PASS 0 · MISMATCH 1
· BLOCKED 2 · NOT_RUN 3); without it the script always exits 0 and the result is the payload.

Read the payload, never the HTML: `gate`, `gateReason`, `counts`, `mismatches[]`, `warnings[]`,
`errors[]`, `writes[]`, `document.phases[]`, `document.bugs`, `document.legacyFiles[]`, `comments`.

## 2. Gate — what each verdict means for the skill

| Gate | Cause | What you do |
|---|---|---|
| `PASS` | both documents consistent, vocabulary valid, every phase and bug cross-reference resolves | deliver the page (after `selftest-run-report.mjs` passes) |
| `MISMATCH` | a written value disagrees with the tables — the header block (`Latest phase`, `Status`, `Latest results`), a run-history row, a `### Stages` Total row, a declared `Outcome`, a run-file total, the bug file's `Bugs` count, a bug id a phase cites that the bug file lacks, a `Found in phase` that is not a phase (`mismatches[].source` says which) | the page IS written with a warning strip and the computed values. **Fix the markdown line named in `mismatches[]`** and re-render. Never edit the HTML |
| `BLOCKED` | something would make the page wrong: missing title / required header line / `## Run history` / `### Run` / `Outcome`; a `### Stages` or `### Results` missing for an executed outcome; an out-of-vocabulary Status / Outcome / result status / smoke-gate verdict / bug Status / bug Severity; a table row with the wrong cell count; a duplicate or descending phase; an unreadable run file; an image embedded as a `data:` URI; a password-shaped literal; a leftover template placeholder; a hand-edited page without `--force` | nothing is written. Fix the markdown (`errors[]` names the line) and re-render. Never bypass by writing HTML yourself |
| `NOT_RUN` | no `--report`, or the file does not exist | fix the path |

`readOnly: true` in the payload means nothing was written (dry run, or a refused write). A missing
bug file, a missing run file, a missing screenshot file or a legacy artifact in the folder is a
**warning**, never a block — the page renders and says so.

## 3. Folder contract

```text
{automation_root}/reports/[SPEC-{spec-name}/]{user_story_name}/      ← results_root, same leaf as the TC folder
  TEST-RUN-REPORT-{feature}.md      test-case status: header block + ## Run history + one ## Phase N section per run (appended)
  BUG-REPORT-{feature}.md           bugs: header block + one ### BUG-n entry per defect; History appended, never replaced
  TEST-RUN-REPORT-{feature}.html    rendered from BOTH markdown files after every run — never hand-written
  REVIEW-COMMENTS-{feature}.md      optional — the reviewer's comments, saved from the page (§9b); the skill only updates Status / Response
  automation-inventory.md           page-object decision table (SKILL.md <automation_inventory>): one row per screen — reuse / extend / create — rewritten each run, read by validate-automation.mjs --inventory
  coverage/                         coverage-summary.csv · coverage-detail.csv · manual-scenarios.csv (replaced each run)
  .runs/phase-{N}.json              ALL machine data of phase N (schema skill6-run/1); immutable once its status is final
  artifacts/stages/{stage}-{group}[-attempt{n}].json   raw Playwright JSON per stage command (emptied at run start)
  artifacts/progress/{stage}-{group}[-attempt{n}].jsonl          heartbeat per stage command (helpers/steps.ts + helpers/progress-reporter.ts)
  artifacts/progress/{stage}-{group}[-attempt{n}].results.jsonl  incremental per-test results (survive a killed command)
  artifacts/progress/{stage}-{group}[-attempt{n}].watchdog.json  written by scripts/watchdog.mjs --write ONLY when that command was stopped as frozen
  artifacts/test-output/            Playwright outputDir (PW_OUTPUT_DIR) — Playwright WIPES it before every command, so stages/ and progress/ are siblings, never inside it
{automation_root}/automation-logs/[SPEC-{spec-name}/]{user_story_name}/run-progress-{stamp}.log
{automation_root}/screenshots/[SPEC-{spec-name}/]{user_story_name}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png
```

- `{feature}` = the stem of `TEST-CASES-{feature}.md`; `{user_story_name}` = the exact leaf of the
  TC folder (`US-{id}-{name}`); `{spec_level}` = its `SPEC-*` parent when it has one.
- **Top-level whitelist.** The story folder holds exactly `TEST-RUN-REPORT-{feature}.md`,
  `BUG-REPORT-{feature}.md`, `TEST-RUN-REPORT-{feature}.html`, `automation-inventory.md`,
  `coverage/`, `.runs/`, `artifacts/`, plus the reviewer's optional `REVIEW-COMMENTS-{feature}.md`
  (the reviewer creates it; no skill does). Nothing else is ever created there — not a checkpoint
  record, a fixture cache, a status file, a backup folder, a retest folder or an extra results
  JSON. The renderer neither reads nor lists `automation-inventory.md`; the validator does. Machine data of a run goes into
  `.runs/phase-{N}.json`; scratch goes under `artifacts/` (replaced each run, safe to gitignore).
- **Legacy = read-only history.** `reports/US-{id}/`, `reports/{spec_level}US-{id}/`, and any
  `phase-N.json` / `phase-N.html`, `merged-results.json`, `run-plan.json`, `open-questions.json`,
  `data-readiness.json`, `stages/`, `coverage/coverage-dashboard.html`, `coverage-previous.json`
  found at the top of `{results_root}` come from runs before this layout. The skill never moves,
  renames, deletes or rewrites them, and no script does. They count for phase numbering, they are
  named on the header's `Earlier phases` line, and the renderer lists them (`document.legacyFiles[]`,
  a `legacy-phase-files-unlisted` warning when the header does not name them) — it never reads them
  as run data.

## 4. `TEST-RUN-REPORT-{feature}.md` — parsed by heading and field name, never by position

Header: `# Test Run Report — {feature}` then `**Key:** value` lines before the first `##`.

| Line | Required | Compared with |
|---|---|---|
| `**User Story:** US-{id} — {title}` | yes | — |
| `**Latest phase:** {N}` | yes | the highest `## Phase N` section |
| `**Status:** GREEN \| FAILURES \| INCOMPLETE \| SMOKE GATE FAILED \| ENVIRONMENT_BLOCKED \| BLOCKED` | yes | the latest phase's computed outcome |
| `**Latest results:** {p} passed · {f} failed · {i} incomplete · {s} skipped · {n} not run[ · {x} partial] of {t} TCs` (read by label, not by position; ` · {x} partial` required exactly when the phase holds a `PARTIAL` row; or `—` when the latest phase has no Results table) | yes | the latest phase's Results table |
| `Feature`, `Spec`, `Source document`, `Source revision`, `Environment`, `Latest run`, `Compliance` (`Checkpoint A … · Checkpoint B …`), `Azure DevOps`, `Bug report`, `Run file`, `Screenshots`, `Progress log`, `Earlier phases` | optional (`—` when empty) | rendered as written |

Frozen `##` anchors, in order: `## Run history` (one table, one row per phase, oldest first:
`Phase · Date · Outcome · Passed · Failed · Incomplete · Skipped · Not run · [Partial ·] Total · Duration · Bugs`
— the `Partial` column is found by name and is required only once any phase holds a `PARTIAL` row;
a table without it while a phase has one is a mismatch, written `—`)
then `## Phase N — YYYY-MM-DD` sections, ascending. Sub-sections per phase (`###`):

| Sub-section | Shape | Required |
|---|---|---|
| `Run` | bullets `- **Field:** value`: **Outcome** (mandatory, Status vocabulary, optional ` — reason`), Environment, Build, Run command, Headed / workers, Timeouts (`test 90 s · step 30 s · action 15 s · navigation 30 s · expect 10 s — {n} calibrated · {n} watchdog events`), Started, Duration (`hh:mm:ss (planned ~… · serial-only ~…)`), Run file, Progress log, Screenshots, Compliance, Azure DevOps, Previous phase | yes |
| `Stages` | table `Stage · Total · Passed · Failed · Incomplete · Skipped · Not run[ · Partial]` (Smoke / Positive / Negative / **Total**; the `Partial` column required exactly when the phase holds a `PARTIAL` row) + `**Smoke gate:** passed \| healed-then-passed ({n} cycles) \| FAILED-STOPPED — fail% {x}% — {action}` | when Outcome is executed (GREEN / FAILURES / INCOMPLETE / SMOKE GATE FAILED) |
| `Run plan` | table `Group · Mode · Workers · TCs · Reason` + `**Decisions:** {n} field · {n} inferred · {n} fail-safe` | optional |
| `Coverage` | table `Stage · Total TCs · Fully · Partially · Not · Weighted %` (+ **Total**) + `**Target:** {t}% ({L3 \| default}, {mechanism}) — **{PASS \| user override \| report-only \| BLOCKED}** · **Δ vs phase {N-1}:** {±d pts — improved … · regressed … \| no prior measurement}` + optional table `Requirement · Outcome · Asserted by` (Full / Partial / Missing / Assumed) | optional |
| `Results` | table `TC-ID · REQ · Name · Status · Group · Duration · Classification · Evidence`, one row per TC. Status ∈ `PASS \| FAIL \| INCOMPLETE \| SKIP \| NOT_RUN \| PARTIAL — human step pending`. **`PARTIAL — human step pending`** is the one status that carries a reason (the frozen wording; a bare `PARTIAL` or another reason warns, a reason on any other status BLOCKs): the candidate TC has `[HUMAN]` steps, the automation ran and passed up to the first one, and its Classification names the pending step as `human step: {n}`; it counts in its own `partial` bucket — **never as passed** — and a phase holding one is `INCOMPLETE` at best. Classification otherwise from the `<first_run>` catalogue or `—`; an INCOMPLETE row writes `incomplete: {missing slugs}`, or `interrupted: watchdog at step "…" after N s` / `interrupted: collateral (…)` / `cleanup_incomplete` (reason strings on the existing statuses — no new status); a NOT_RUN row may write `not started: watchdog stop`. Evidence = ` · `-separated markdown links **relative to this folder** (`[attempt-2.png](../../screenshots/…/attempt-2.png) · [failed](…/attempt-1-failed.png)`) or `—`; a PARTIAL row links the image of its last automated step | same rule as Stages |
| `Unverified assumptions` | table `TC-ID · Ambiguity · Interpretation encoded · Evidence · Result`, or `none` | optional |
| `Bugs` | cross-reference table `Bug · TC-ID · Severity · Status` — one row per bug this phase found or retested, ids from `BUG-REPORT-{feature}.md`; or `none`. **Details never live here** | optional |
| `Heal log` | the nine-column table of `<first_run>` step 5, or `First run fully green` | optional |
| `Skips and residual failures` | table `TC-ID · Status · Reason`, or `none` | optional |
| `Open questions` | table `# · Source · Ambiguity · TCs · Decision · By`, or `none` | optional |
| `Test-data readiness` | `**Verdict:** …` + table `Gap · TCs · Decision · Source · Provisioning · Cleanup`, or `all ready` | optional |
| `Deviations` | bullets, or `- none` | optional |

Empty optional value = `—`. **Earlier phase sections are immutable**: each run appends one section
and updates only the header block and one run-history row. An invocation that stops before
execution (ENVIRONMENT_BLOCKED / BLOCKED) still appends a short section — `### Run` with the
Outcome and its reason, no Stages / Results — and a run-history row of `—`.

## 5. `BUG-REPORT-{feature}.md` — parsed by heading and field name

Header: `# Bug Report — {feature}` then `**User Story:**` (required), `Feature`, `Spec`, `Source
document`, `**Latest phase:**` (compared with the run report), `**Bugs:** {open} open · {resolved}
resolved · {n} not checked this run of {total}` (compared with the entries), `Run report`.

One frozen anchor `## Bugs`, then one `### BUG-{n} — {title}` per defect (`n` never reused; the
title in the `<bug_report_format>` voice, "The system doesn't … when …"), each with one
`- **Field:** value` bullet per field:

| Field | Value | Required |
|---|---|---|
| `TC-ID` | the TC that found it | yes |
| `Requirement` | REQ id | |
| `Severity` | `Critical \| High \| Medium \| Low` | |
| `Environment`, `Browser`, `Language`, `Build` | where it was seen | |
| `Found in phase` | the phase number (must be a `## Phase` of the run report) | |
| `Status` | `open` · `resolved (phase {M})` · `not-checked-this-run` | yes |
| `Root cause` | plain English | |
| `Steps to reproduce` | ordered sub-list | yes |
| `Expected`, `Actual` | plain English | yes |
| `Screenshot` | one relative link into `{screenshots_root}` (the failure image), or `none captured` | |
| `Evidence` | the raw assertion text | |
| `History` | sub-list `- phase {N} — {FAIL \| PASS \| not run}: {note}` — appended every phase that touches the bug, never replaced | |
| `Reviewer comment` | written by the reviewer only; shown in the bug's comment box, never a status source (§9b). A phase's `### Run` may carry the same bullet; it is shown in that phase's box, never as a fact | |

Rules (the same ones skill 3 applies to potential bugs): a bug is `resolved` **only after an actual
successful retest** in a later phase (Status names that phase, History gets the line); a bug whose
TC did not run this phase becomes `not-checked-this-run`; an existing entry is never rewritten —
only Status and History change; a bug seen again stays one entry. No bugs yet → the file still
exists with `## Bugs` and `none`. The renderer BLOCKs on a missing required field or an unknown
Status / Severity, and reports `bug-ref-missing` / `bug-phase-unknown` / `bug-count` mismatches
when the two files disagree.

## 6. Derived numbers — the page shows these, never the written ones

| Number on the page | Computed from |
|---|---|
| Per-phase passed / failed / incomplete / skipped / not run / partial / total | the `### Results` table, one row per TC-ID (`PARTIAL` rows fill `partial` only) |
| Phase outcome | `SMOKE GATE FAILED` when the smoke-gate line says `FAILED-STOPPED`, else `FAILURES` if any FAIL, else `INCOMPLETE` if any INCOMPLETE **or any PARTIAL**, else `GREEN`; a declared `ENVIRONMENT_BLOCKED` / `BLOCKED` with no Results table is accepted as declared |
| Header tiles, Status, Latest phase | the latest phase; when the latest phase has no Results table the tiles fall back to the last phase that has one and the banner says why |
| Run history | the phase sections; the written rows are compared and a difference is a mismatch |
| Stage table, coverage bars, target / verdict / delta | the phase's own tables — bars are `full / partial / none` shares of that stage's total; zero total → `—`, never `0%` |
| Variants · attempts · missing variants · planned vs actual | `.runs/phase-N.json` (`results[].variants[].attempts[]`, `variant_totals`, `run_plan.estimate`) — additive; absent → `—` and a `run-file-missing` warning |
| Bugs open / resolved / not checked | the bug file's entries (Status), never its header |
| — (not on the page) | the run file's `open_questions`, `data_readiness`, `compliance`, `merged.executions[]` — machine data for the ADO close-out and the checklist |

## 7. `.runs/phase-N.json` — schema `skill6-run/1` and its lifecycle

One file per phase, POSIX paths relative to `{automation_root}` (as `results_root` /
`evidence_screenshot` are today; the renderer converts them to report-relative links with
`path.posix.relative(results_root, p)`). Top level:

`schema` · `phase` · `status` (`planning | ready | running | complete | stopped-smoke-gate |
environment-blocked | blocked`) · `run_id` · `user_story_id` · `user_story` · `user_story_name` ·
`feature` · `spec_level` · `source_tc_doc` · `source_sha256` · `environment` · `build` · `framework`
· `file_or_suite` · `ado_mode` · `headed` · `workers_parallel` · `started_at` · `finished_at` ·
`total_duration_ms` · `results_root` · `screenshots_root` · `logs_root` · `progress_log` ·
`previous_phase { phase, file, location: nested | legacy | null }` ·
`compliance { checkpoint_a { gate, scopeDigest, recorded_at, unresolved[] }, checkpoint_b {…} }` ·
`run_plan` (the `<run_plan>` shape) · `open_questions` (the `<open_questions>` shape, without a
`file` key) · `data_readiness` (the `<data_readiness>` shape) ·
`coverage_snapshot { measuredAt, weightedPct, target, targetSource, mechanism, verdict, byStage
{smoke|positive|negative: {total, full, partial, none, weightedPct}}, tcs {TC-ID: status},
requirements [{id, short, outcome, assertedBy[]}], manual {total, high, medium, low}, delta
{against, pctChange, improved[], regressed[], added[], removed[]} }` ·
`stages {smoke|positive|negative: {total, passed, failed, incomplete, skipped, not_run[, partial]}}` ·
`smoke_gate { fail_pct, verdict, action_taken, excluded_unverified_assumption, cycles }` ·
`totals { total, passed, failed, incomplete, skipped, not_run[, partial] }` (`partial` present whenever
a `PARTIAL` result exists; a `results[]` row of a PARTIAL TC carries `status: "PARTIAL"`,
`classification: "human step: {n}"` and `human_step: {n}`) · `variant_totals` ·
`merged { stages[], executions[], variants[], tcs[] }` (the `<second_run>` merge, minus its own
schema / story / phase keys; each `stages[]` entry carries `source: 'json' | 'incremental+watchdog'`
and, for the latter, `watchdog_path`) · `results[]` (the per-TC rows of `<second_run>` step 3,
unchanged) · `unverified_assumptions[]` · `bugs[] { id, title, tc_id, req_id, severity, status }` ·
`heal_log[]` · `skips[]` · `deviations[]` ·
`timeouts { playwright_version, feature_gates { tags_object, last_failed, native_step_timeout },
initial { test_default_ms, test_long_ms, expect_ms, action_ms, navigation_ms, hook_ms,
step_default_ms, step_long_ms, operations {name: ms}, watchdog_grace_ms }, events[] { tc, step,
elapsed_ms, deadline_ms, expected, kind: step | test | ceiling | watchdog, evidence },
adjusted[] { key, from_ms, to_ms, reason, evidence }, probe: PASS | NOT_RUN, calibration:
done | NOT_RUN }` (optional; the renderer ignores it — the Timeout policy section of the report
carries the human-readable form) · `watchdog_events[] { stage, group, worker, tc, step,
elapsed_ms, deadline_ms, action }` (optional).

**Lifecycle.** `N` is assigned once at profile time: 1 + the highest phase found across
`.runs/phase-*.json`, legacy `phase-*.json|html` at the top of `{results_root}`, and every legacy
root. The file is created with `status: planning` and updated at PHASE 2.4 (`open_questions`), 2.5
(`coverage_snapshot`), 2.6 (`data_readiness`, `run_plan`), Checkpoint A, after the run (`merged`,
`results`, `stages`, `totals`), Checkpoint B and finalization. Once its status is final the file is
immutable. An invocation that stops early leaves its final status and the short phase section of
§4; the next invocation takes N+1. The coverage delta reads the newest earlier `.runs/phase-*.json`
that carries a `coverage_snapshot`, else a legacy `coverage-previous.json` (read-only), else "no
prior measurement" — and says which.

## 8. Evidence links and the viewer

Every markdown link in an Evidence or Screenshot cell renders as a thumbnail plus a
**"View screenshot"** link, both opening the page's own viewer (a `<dialog>` with fit / zoom /
scroll, previous / next inside the same phase or the Bugs section, Esc to close, and an
**"Open original in new tab"** link to the raw file). Paths stay relative to the report folder;
existence is checked at render time — a missing file renders a `file not found` badge and an
`evidence-file-missing` warning (never a block); an absolute path, drive letter or `file:` URL
renders a plain link with an `evidence-path-not-relative` warning; a `data:` URI **blocks**. The
page therefore shows images only while the report and `screenshots/` keep their relative positions
— one more reason nothing under `screenshots/` is ever moved.

## 9. Provenance and hand edits

Line 2 of every rendered page is `<!-- render-run-report v… · report=… · bugs=… · runs=… ·
comments=… · page=… -->` (sha256 of the run report, of the bug file or `none`, of the run files
read or `none`, of the comments file or `none`, and a self-hash of the page; a v1.0 line without
`comments=` still verifies). On `--write` the script recomputes the existing page's self-hash: a
mismatch means a human edited the HTML, and the write is refused (`gate: BLOCKED`,
`refused.reason: hand-edited`) until `--force` is given — tell the user what will be lost first. A
page with no provenance comment (a hand-written `phase-N.html` from an older skill run, saved under
the new name) is replaced with a `legacy-page-replaced` warning. Typing a comment in the page never
changes the page file, so the self-hash stays valid and a re-render needs no `--force`.

## 9b. Reviewer comments — `REVIEW-COMMENTS-{feature}.md`

Every bug card and phase card has a comment box, and the page has one general box. The reviewer
types, clicks **Save comments** (saved beside the page) or **Copy for chat**, then says "read my
comments". Entry ids are `General`, `BUG-{n}` and `phase-{N}`. The file shape, the page behaviour,
the renderer's warnings and the handling rules are the same as skill 3's review page
(`link-qc-3-generate-manual-test-cases/references/html-page.md` §7b, identical because the two pages share
the shell and the renderer kit):

- the header lines `Page`, `Source`, `Source revision`, `Reviewer`, `Saved`, `Comments`, then one
  `## {id}` section per comment (`## {id} (2)` for a later one on the same item) holding the
  reviewer's text and `- **Status:** open`;
- a skill handles an entry by changing only its Status to `applied {date}`, `answered {date}` or
  `declined {date}`, adding `- **Response:** {one plain sentence}`, and recomputing the header —
  never editing, reordering or dropping the reviewer's text, never adding a comment of its own;
- the renderer pre-fills open entries, shows handled ones as history, lists ids not on the page,
  and warns `comment-unknown-id`, `comments-stale-revision`, `comments-page-mismatch`,
  `comment-status-unknown`, `comments-header-count` and `comments-file-missing`; a password-shaped
  literal in a comment BLOCKs.

A comment is reviewer input, never a status source: "not a bug" on `BUG-2` does not close it. Skill
5 answers it (`answered` / `declined` + Response); the Status of a bug changes only through the rules
of §5 (an actual successful retest), and skills 8 and 9 apply the same rule.

## 10. Templates — the body partial and the report shell

Two passes. `assets/run-report.template.html` is the **body partial** (run history, coverage,
phases, bugs). The renderer renders it, then renders `assets/report-shell.template.html`, the one
general report page, around it. The shell owns the document, the one stylesheet, the one script
(theme toggle, screenshot viewer, filter bars, reviewer comments), the header, meta line, banners,
tiles, the general comment box and the footer; the renderer feeds it data only. The shell and the
renderer's "report-shell kit" block (between its BEGIN / END markers) are byte-identical with skills
3, 3b and 3c; harness case 26 compares them with every sibling installed. Body partials use only the
shell's class vocabulary (`card`, `card-id`, `card-counts`, `card-body`, `item-card`, `item-head`,
`chip c-*`, `seg seg-*`, `shot`, `sub-head`, `filter-bar`, `comment-box`). Placeholders are
`{{snake_case_key}}` (HTML-escaped) and `{{{key}}}` only for values the renderer already escaped
(the `open` attribute, comment boxes), with comment block markers (`<!-- {{#each list}} -->` …
`<!-- {{/each}} -->`, `{{#if flag}}`, `{{#unless flag}}`). Never write placeholder syntax inside a
template's own comments. A placeholder the model cannot fill is left in the output and BLOCKs the
render, so a template edit is always caught. After any template or renderer change run
`node scripts/selftest-run-report.mjs --pretty` (golden page, derived numbers, mismatch and
false-PASS guards, evidence and viewer markup, bug cross-checks, provenance, exit codes,
determinism, case 23 — a `PARTIAL — human step pending` row is its own bucket, never passed,
never GREEN — case 24 reviewer comments, case 25 one shell per page, case 26 the shell mirror —
26 cases) and regenerate the golden only for a deliberate change
(`scripts/fixtures/run-report/README.md`). A shell change is copied to skills 3, 3b and 3c.

## 11. Migration — projects set up before this layout

Their `reports/[SPEC-*/]US-{id}/` folders, top-level `phase-N.json` / `phase-N.html`,
`merged-results.json`, `run-plan.json`, `open-questions.json`, `data-readiness.json`, `stages/`,
`coverage/coverage-dashboard.html` and `coverage-previous.json` stay exactly where they are as
read-only history. The first run under the new layout says so once in the chat ("earlier phases 1-4
found in reports/SPEC-x/US-1234/ — kept as legacy history, new phases start at 5 in
reports/SPEC-x/US-1234-create-order/"), creates the two markdown files with the header block, `##
Run history` and `## Bugs` / `none`, lists the legacy locations on the `Earlier phases` line, and
renders. Nothing is migrated, merged or deleted.
