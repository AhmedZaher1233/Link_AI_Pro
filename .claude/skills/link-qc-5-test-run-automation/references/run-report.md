# The run report — `TEST-RUN-REPORT-{feature}.md` + `BUG-REPORT-{feature}.md` → one RENDERED page

Loaded by `SKILL.md` at **Preparing Final Report** (append, update the bug file, render) and for
"read my comments". What the earlier activities need — the roots, the phase number, the folder
whitelist, the evidence rules — is restated in `references/results-and-evidence.md`.

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
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report {run_report_md}
# render the page next to the markdown (TEST-RUN-REPORT-{feature}.html)
node … --report {run_report_md} --write [--out {path}]
# after a deliberate re-render over a page a human edited (the payload said refused.reason: hand-edited)
node … --report {run_report_md} --write --force
# the harness — before delivering any page the script rendered (a pass is reused only on an exact cache key, B20)
node .claude/skills/link-qc-5-test-run-automation/scripts/check.mjs harness --name selftest-run-report.mjs
```

`--bugs`, `--runs` and `--comments` override the defaults (`BUG-REPORT-{feature}.md` next to the
report, `.runs/` in the same folder and `REVIEW-COMMENTS-{feature}.md` next to the report). `--base {story
folder}` resolves the evidence links, the legacy listing, the comments and the tracker against that folder —
how a DRAFT report under `artifacts/drafts/phase-{N}/` renders exactly what the published one will. `--gate
{.runs/phase-N.checkpoint-B.json}` adds the gate record's hash to the provenance and its verdict to the page's
meta line; `run-data.mjs publish` passes it (`final-run.md` `<publication>`) — a page published after
Checkpoint B is rendered only that way. `--tracker`
overrides where the tracker is looked for and `--ado-url {org-or-collection URL}/{project}` sets the
Azure DevOps project its bug IDs link to (§5b). `--strict` maps the gate to an exit code for CI (PASS 0 · MISMATCH 1
· BLOCKED 2 · NOT_RUN 3); without it the script always exits 0 and the result is the payload.

Read the payload, never the HTML: `gate`, `gateReason`, `counts`, `mismatches[]`, `warnings[]`,
`errors[]`, `writes[]`, `document.phases[]`, `document.bugs`, `document.legacyFiles[]`, `comments`, `tracker`.

## 2. Gate — what each verdict means for the skill

| Gate | Cause | What you do |
|---|---|---|
| `PASS` | both documents consistent, vocabulary valid, every phase and bug cross-reference resolves | deliver the page (after `selftest-run-report.mjs` passes) |
| `MISMATCH` | a written value disagrees with the tables (header line, run-history row, Stages Total, declared Outcome, run-file total, bug count or a bug cross-reference — `mismatches[].source` says which) | the page IS written with a warning strip and the computed values. **Fix the markdown line named in `mismatches[]`** and re-render. Never edit the HTML |
| `BLOCKED` | something would make the page wrong — a missing required line or section, an out-of-vocabulary value, a broken row, a duplicate or descending phase, an unreadable run file, a `data:` image, a password-shaped literal, a leftover placeholder, a hand-edited page without `--force` | nothing is written. Fix the markdown (`errors[]` names the line) and re-render. Never bypass by writing HTML yourself |
| `NOT_RUN` | no `--report`, or the file does not exist | fix the path |

`readOnly: true` in the payload means nothing was written (dry run, or a refused write). A missing
bug file, a missing run file, a missing screenshot file or a legacy artifact in the folder is a
**warning**, never a block — the page renders and says so. The same holds for every tracker warning
(§5b); only a password-shaped literal in it BLOCKs.

## 3. Folder contract

```text
{automation_root}/reports/[SPEC-{spec-name}/]{user_story_name}/      ← results_root, same leaf as the TC folder
  TEST-RUN-REPORT-{feature}.md      test-case status: header block + ## Run history + one ## Phase N section per run (appended)
  BUG-REPORT-{feature}.md           bugs: header block + one ### BUG-n entry per defect; History appended, never replaced
  TEST-RUN-REPORT-{feature}.html    rendered from BOTH markdown files after every run — never hand-written
  REVIEW-COMMENTS-{feature}.md      optional — the reviewer's comments, saved from the page (§9b); the skill only updates Status / Response
  automation-inventory.md           page-object decision table (SKILL.md <automation_inventory>): one row per screen — reuse / extend / create — rewritten each run, read by validate-automation.mjs --inventory
  coverage/                         coverage-summary.csv · coverage-detail.csv · manual-scenarios.csv (replaced each run)
  .runs/phase-{N}.json              ALL machine data of phase N (schema skill6-run/1); immutable once its status is final (skill 9's retest of the latest phase excepted, §3)
  .runs/phase-{N}.checkpoint-A.json · .runs/phase-{N}.checkpoint-B.json   the gate records (skill5-gate/1) written by scripts/check.mjs gate — the record of each checkpoint; never edited by hand
  artifacts/drafts/phase-{N}/       TEST-RUN-REPORT-{feature}.md · BUG-REPORT-{feature}.md · .runs/phase-{N}.json · TEST-RUN-REPORT-{feature}.html — the phase's report set BEFORE Checkpoint B; promoted byte-identical by run-data.mjs publish
  artifacts/checks/{snapshotId}/    snapshot.json · results.jsonl · run-*.json (full tool output) · gate-{A|B}.json (copy) · carry-shadow.json — one folder per checkpoint snapshot
  artifacts/parallel-plan.json      the parallel readiness payload (parallel-plan.mjs --out; every run — the stages' --units file, re-planned in place by run-stage.mjs when its inputs fingerprint changed)
  artifacts/reconcile/{stamp}/      config-inventory.mjs reconcile --apply: the originals of every file it changed (same relative paths) + summary.md (before → after, conflicts)
  artifacts/progress/status.json    the live worker view (run-stage.mjs): Auto ceiling, active workers, the TCs each runs — rewritten only when it changes
  artifacts/progress/admission.json the stage's admission state (written only by run-stage.mjs; PW_ADMISSION_FILE) · artifacts/progress/cancel.flag (a stop: helper waits end at once)
  artifacts/diagnostics/phase-{N}/{command}/   stall diagnostics of the step helper (PW_DIAGNOSTICS_DIR) + playwright-output.log (3.1: the command's FULL Playwright output, credential-filtered; the live progress log stays concise)
  artifacts/stages/{stage}-{group}[-attempt{n}].json   raw Playwright JSON per stage command (emptied at run start)
  artifacts/progress/{stage}-{group}[-attempt{n}].jsonl          heartbeat per stage command (helpers/steps.ts + helpers/progress-reporter.ts)
  artifacts/progress/{stage}-{group}[-attempt{n}].results.jsonl  incremental per-test results (survive a killed command)
  artifacts/progress/{stage}-{group}[-attempt{n}].watchdog.json  written by scripts/watchdog.mjs --write (through run-stage.mjs) ONLY when that command was stopped — frozen, or past its outer ceiling
  artifacts/progress/{stage}-{group}[-attempt{n}].plan.json      the stage-filtered run-plan group run-stage.mjs hands the watchdog (this stage's TCs of that group)
  artifacts/progress/{stage}-{group}[-attempt{n}].ratelimit.jsonl  the network guard's record per command (PW_RATE_LIMIT_FILE): 429 / 503 + Retry-After responses and policy headers, origin + pathname only
  artifacts/progress/rate-limit.state.json                       the phase-wide rate-limit slot book (PW_RATE_LIMIT_STATE) helpers/rate-limit.ts shares across workers — only when the run holds no environment lease; with one, the book is the environment group's shared rate-limits/{bookId}.json in the coordination directory
  artifacts/progress/{stage}-{group}[-attempt{n}].data-ledger.jsonl  3.0 — the ownership ledger per command (PW_DATA_LEDGER_FILE): one fsynced line per data-change state, keys only (code-craft §19)
  artifacts/progress/{run}-{stage}-{seq}.summary.json            one per run-stage.mjs call ({run} = first | rerun): statuses, phase-wide counts, executed, code fingerprints, failures (latest attempt), isolation, interference, rateLimit, merged_stages, watchdog / timeout events, scheduler, host (the sampler's minima / peaks), opt-in telemetry, the stage message
  artifacts/test-output/phase-{N}/{stage}-{group}[-attempt{n}]/  ONE command's Playwright outputDir (PW_OUTPUT_DIR) — Playwright wipes it as that command starts, so stages/ and progress/ stay outside it; no later command touches it; earlier phases pruned by run-stage.mjs
{automation_root}/automation-logs/[SPEC-{spec-name}/]{user_story_name}/run-progress-{stamp}.log
{automation_root}/screenshots/[SPEC-{spec-name}/]{user_story_name}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png
{QA_CAPACITY_DIR | ~/.link-ai-pro/capacity}/config.json · ledger.json · demand.json · rate-limits/{bookId}.json   the machine-wide coordination directory (capacity.mjs) — OUTSIDE every story folder, shared by every run of this user
```

- `{feature}` = the stem of `TEST-CASES-{feature}.md`; `{user_story_name}` = the exact leaf of the
  TC folder (`US-{id}-{name}`); `{spec_level}` = its `SPEC-*` parent when it has one.
- **Top-level whitelist.** The story folder holds exactly `TEST-RUN-REPORT-{feature}.md`,
  `BUG-REPORT-{feature}.md`, `TEST-RUN-REPORT-{feature}.html`, `automation-inventory.md`,
  `coverage/`, `.runs/`, `artifacts/`, plus the reviewer's optional `REVIEW-COMMENTS-{feature}.md`
  (the reviewer creates it; no skill does). Nothing else is ever created there — not a fixture cache, a
  status file, a backup folder, a retest folder or an extra results JSON; the checkpoint gate records live
  INSIDE `.runs/` and the drafts, snapshots and check outputs INSIDE `artifacts/`. The renderer neither reads nor lists `automation-inventory.md`; the validator does. Machine data of a run goes into
  `.runs/phase-{N}.json`; scratch goes under `artifacts/` (replaced each run, safe to gitignore).
  `artifacts/stages/` and `artifacts/progress/` are emptied at the start of a phase; inside it, every
  command — normal, isolation, burn-in, smoke retry, re-queue, re-run — takes the next free
  `-attempt{n}` of its stage / group and `PW_STAGE_ATTEMPT={n}` — no file is ever reused.
- **Shared with the manual CLI run.** `link-qc-5b-test-run-manual-cli` (the manual twin of this skill) writes
  the SAME three files, `.runs/phase-{N}.json` and the screenshot tree with the same phase counter: a
  phase it wrote is an ordinary earlier phase here (it counts for `N`, is named by `Previous phase`, is
  never rewritten) and is recognisable by its `Run command` bullet (`manual run — playwright-cli …
  (skill 5b)`), `Compliance: — (manual run)` and the run file's `framework: "manual-cli"`; its variants
  are `manual-cli--none--r{repeat}` and an AI TC's verbatim reply lives beside the screenshot as
  `reply.md` in that variant folder. `BUG-{n}` numbering continues across both skills; a passing retest
  by either skill may set `resolved (phase N)`. `ai_rubric_failure` is written only by 5b.
- **Updated in place by the retest skill.** `link-qc-9-retesting` re-runs an automated TC through
  `run-stage.mjs --run rerun` against the latest phase's run file (playwright-cli for the rest) and
  then updates that LATEST phase in place — the changed Results rows, a `{Stage} (retest — skill 9)`
  Stages row and the Total, the Outcome, the `### Bugs` table, one `- **Retest:**` bullet under
  `### Run`, `### Deviations` lines, the header and the phase's run-history row, and the run file to
  match (`results[]`, `totals`, `stages`, `bugs[]`, appended attempts with the stage text `{stage} ·
  retest (skill 9)`, an append-only `retests[]`). Its playwright-cli evidence uses the variant
  `retest-cli--{lang}--r1`. Its bug resolution is `resolved (phase N)` for that latest phase. User
  decision 2026-10-19; the procedure is skill 9's `references/report-update.md`. Earlier phases stay
  immutable for every skill.
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
| `Run` | bullets `- **Field:** value`: **Outcome** (mandatory, Status vocabulary, optional ` — reason`), Environment, Build, Run command, Headed / workers, Timeouts (`test 90 s · step 30 s · action 15 s · navigation 30 s · expect 10 s — {n} calibrated · {n} watchdog events`), Started, Duration (`hh:mm:ss (planned ~… · serial-only ~…)`), Run file, Progress log, Screenshots, Compliance, Azure DevOps, Previous phase, and three one-line bullets — `- **Re-run:** {n} TCs ({i} impacted · {v} no verdict · {a} added), {b} burn-in, {k} heal iteration(s) — or not needed — no code changed after the first run and every TC has a verdict`, `- **Isolation checks:** {n} failed beside others → {p} passed alone (interference) · {c} confirmed · {r} rate_limited — or none needed`, `- **Rate limits:** {services paced} · {n} refusals · cool-downs {s} · workers {from → to} — or none seen`, and `- **Acceptance:** ACCEPTED | ACCEPTED pending Checkpoint B — see gate record | NOT ACCEPTED — {reasons}` (`structured-returns.md` `<run_acceptance>`; `run-data.mjs report` writes all four). **Sub-bullets are not rendered** — every value stays on its one line | yes |
| `Stages` | table `Stage · Total · Passed · Failed · Incomplete · Skipped · Not run[ · Partial]` (Smoke / Positive / Negative, a `{Stage} (re-run)` row per re-run stage counting only the re-run subset, then **Total** = the results of record — one per TC, the latest attempt over the phase, **never the sum of the rows**; the `Partial` column required exactly when the phase holds a `PARTIAL` row) + `**Smoke gate:** passed \| healed-then-passed ({n} cycles) \| FAILED-STOPPED \| NO VERDICT — fail% {x}% — {action}` (fail% over the PASS + FAIL smoke TCs; `NO VERDICT` = none had one — the phase is `INCOMPLETE`, never GREEN) | when Outcome is executed (GREEN / FAILURES / INCOMPLETE / SMOKE GATE FAILED) |
| `Run plan` | table `Group · Mode · Workers · TCs · Reason` + `**Decisions:** {n} field · {n} inferred · {n} fail-safe`; an `account:{A-ID}` lane is a row of this table like any other group, and a TC the isolation check moved shows in its new group with the move in the Reason | optional |
| `Coverage` | table `Stage · Total TCs · Fully · Partially · Not · Weighted %` (+ **Total**) + `**Target:** {t}% ({L3 \| default}, {mechanism}) — **{PASS \| user override \| report-only \| BLOCKED}** · **Δ vs phase {N-1}:** {±d pts — improved … · regressed … \| no prior measurement}` + optional table `Requirement · Outcome · Asserted by` (Full / Partial / Missing / Assumed) | optional |
| `Results` | table `TC-ID · REQ · Name · Status · Group · Duration · Classification · Evidence`, one row per TC. Status ∈ `PASS \| FAIL \| INCOMPLETE \| SKIP \| NOT_RUN \| PARTIAL — human step pending`. **`PARTIAL — human step pending`** is the one status that carries a reason (the frozen wording; a bare `PARTIAL` or another reason warns, a reason on any other status BLOCKs): the candidate TC has `[HUMAN]` steps, the automation ran and passed up to the first one, and its Classification names the pending step as `human step: {n}`; it counts in its own `partial` bucket — **never as passed** — and a phase holding one is `INCOMPLETE` at best. Classification otherwise from the `<first_run>` catalogue or `—`; an INCOMPLETE row writes `incomplete: {missing slugs}`, `rate_limited` (the failing step's own request throttled, refused again alone after the server's deadline — no verdict), or `interrupted: watchdog at step "…" after N s` / `interrupted: collateral (…)` / `interrupted: outer ceiling stop after N s` / `interrupted: wait budget exhausted (server deadline {T})` / `cleanup_incomplete` (reason strings on the existing statuses — no new status); a NOT_RUN row may write `not started: watchdog stop`, `not started: outer ceiling stop after N s`, `not started: depends on {TC} (failed)` (a chain follower), `not started: smoke gate failed (re-run)`, `not started: code changed after its run`, `not started: deferred until {T}`, `not started: admission timeout ({reason})`, `not started: host pressure` or `not started: environment lease ({reason})` (the last four make the run NOT ACCEPTED). **3.0 (API / DB, `api-db.md` `<backend_results>` §5):** `PARTIAL — api/db step pending` (with `out of tool: api/db step {n}` — 5b only) is the second PARTIAL reason; FAIL classifications `api_contract_failure` / `db_assertion_failure`; INCOMPLETE reasons `data_write_refused ({ownership | cascade | trigger | row-count | identity})`, `data_write_failed`, `read_back_mismatch`, `redirect_refused`, `auth_failure`, `data_in_doubt`, `evidence_invalid ({reason})`; NOT_RUN `not started: data changes not permitted (…)` / `db unavailable (…)` / `mapping unresolved (…)` / `config missing (…)` / `layer unknown` — a consented TC left unstarted, an in-doubt write or an invalid record makes the run NOT ACCEPTED. Each row is the TC's result of record; its attempt sub-rows (the run file) name the pass in their stage text (`positive · re-run`, `smoke · isolation`, `positive · burn-in`). Evidence = ` · `-separated markdown links **relative to this folder** (`[attempt-2.png](../../screenshots/…/attempt-2.png) · [failed](…/attempt-1-failed.png)`) or `—`; a PARTIAL row links the image of its last automated step | same rule as Stages |
| `Unverified assumptions` | table `TC-ID · Ambiguity · Interpretation encoded · Evidence · Result`, or `none` | optional |
| `Bugs` | cross-reference table `Bug · TC-ID · Severity · Status` — one row per bug this phase found or retested, ids from `BUG-REPORT-{feature}.md`; or `none`. **Details never live here** | optional |
| `Heal log` | the nine-column table of `<first_run>` step 5, or `First run fully green` | optional |
| `Skips and residual failures` | table `TC-ID · Status · Reason`, or `none` | optional |
| `Open questions` | table `# · Source · Ambiguity · TCs · Decision · By`, or `none` | optional |
| `Test-data readiness` | `**Verdict:** …` + table `Gap · TCs · Decision · Source · Provisioning · Identifiers / names · Effective stamped values · Verified on · Cleanup`, or `all ready` (rendered as the verdict). `Decision` ∈ `READY` · `prepared (api\|ui\|db)` · `skip — data_missing` · `skip — not creatable` · `skip — QC declined` (the legacy bare `skip` / `api` / `ui` / `db` / `manual` still parse); the renderer counts them per phase (`document.phases[].readiness`, a `Decisions:` line under the verdict) and warns `unknown-readiness-decision` for any other word | optional |
| `Deviations` | bullets, or `- none` — parallel interference (one bullet per TC: passed alone, moved to `{group}`, shared data or a possible application concurrency defect for the human to judge), rate-limit refusals and adjustments, `outside_scope[]` specs not re-run | optional |

**3.0 sub-sections:** `### Retained test records` and `### In-doubt test records` — table `Resource · Key · TC · Reason`
(in doubt: `Resource · Target identity · TC · Since`), written only when the run kept or could not resolve a data
change, copied from `run-data.mjs report`'s `retainedTable` / `inDoubtTable` fragments; resource and key only, nothing sensitive (a credential-shaped cell BLOCKs).

**Never introduce any other `###` sub-section** — the renderer ignores unknown ones. The re-run, the
isolation checks and the rate limits are carried only by the structures above: the one-line `### Run`
bullets, the `{Stage} (re-run)` rows, `### Run plan` rows and `### Deviations` bullets.

Empty optional value = `—`. **Earlier phase sections are immutable**: each run appends one section
and updates only the header block and one run-history row. The one exception is skill 9's retest,
which updates the LATEST phase in place (§3 "Updated in place by the retest skill") — never an
earlier one. An invocation that stops before
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
| `Screenshot` | one relative link into `{screenshots_root}` (the failure image), or `none captured` (under the run's `screenshots: none` choice: `none captured (screenshots: none this run)`) | |
| `Evidence` | the raw assertion text | |
| `History` | sub-list `- phase {N} — {FAIL \| PASS \| not run}: {note}` — appended every phase that touches the bug, never replaced | |
| `Reviewer comment` | written by the reviewer only; shown in the bug's comment box, never a status source (§9b). A phase's `### Run` may carry the same bullet; it is shown in that phase's box, never as a fact | |

Rules (the same ones skill 3 applies to potential bugs): a bug is `resolved` **only after an actual
successful retest** in a later phase, or in skill 9's retest of the latest phase (Status names that
phase, History gets the line); a bug whose
TC did not run this phase becomes `not-checked-this-run`; an existing entry is never rewritten —
only Status and History change; a bug seen again stays one entry. No bugs yet → the file still
exists with `## Bugs` and `none`. The renderer BLOCKs on a missing required field or an unknown
Status / Severity, and reports `bug-ref-missing` / `bug-phase-unknown` / `bug-count` mismatches
when the two files disagree.

## 5b. The tracker — `TC-STATUS-TRACKER-{feature}.md` (read-only data source)

The tracker lives beside `ADO-BUG-MAP.md` in the story's **TestCases** folder, never in the reports
folder (the §3 whitelist is unchanged). The renderer finds it (`--tracker`, else beside the header's
`Source document`, else the TestCases folder mirroring the report's leaf), only reads it, and adds its
columns, a "Not automated / not run" list, a Tracker section and a Bug index to the page; work items
link through `--ado-url`, the tracker header or the project's `.mcp.json` — never a built-in host. Shape
and link rule: skill 3's `references/html-page.md` §3b. Every tracker problem is a warning
(`tracker-*`); no tracker → the page renders without its markup.

## 6. Derived numbers — the page shows these, never the written ones

The renderer recomputes every number from the tables (counts per phase from `### Results`, one row per
TC-ID; bug counts from the entries, never the header; variants / attempts from the run file, `—` when
absent) and reports a written value that disagrees as a mismatch. The one rule you apply when writing
`**Status:**` / `Outcome`: `SMOKE GATE FAILED` when the smoke-gate line says `FAILED-STOPPED`, else
`FAILURES` if any FAIL, else `INCOMPLETE` if any INCOMPLETE **or any PARTIAL** or the smoke gate says `NO VERDICT`, else `GREEN`; a declared
`ENVIRONMENT_BLOCKED` / `BLOCKED` with no Results table is accepted as declared.

## 7. `.runs/phase-N.json` — schema `skill6-run/1` and its lifecycle

One file per phase, POSIX paths relative to `{automation_root}` — the stored form and what is accepted on input:
`references/schemas/paths-and-evidence.md` §1 (as `results_root` /
`evidence_screenshot` are today; the renderer converts them to report-relative links with
`path.posix.relative(results_root, p)`). Top level:

`schema` · `phase` · `status` (`planning | ready | running | complete | stopped-smoke-gate |
environment-blocked | blocked`) · `run_id` · `user_story_id` · `user_story` · `user_story_name` ·
`feature` · `spec_level` · `source_tc_doc` · `source_sha256` · `environment` · `build` · `framework`
· `file_or_suite` · `ado_mode` · `headed` · `workers_parallel` · `started_at` · `finished_at` ·
`total_duration_ms` · `results_root` · `screenshots_root` · `logs_root` · `progress_log` ·
`delivery { report: html | md, screenshots: all | failed | none, source: asked | flag | default, decided_at }` (3.1,
the intake question — `intake.md` item 4; absent = html + all: `md` → no page is written, the renderer's gate still
checks the markdown; `screenshots` → which attempts owe an image in verify 16b / 18; read by `run-stage.mjs` for
`PW_SCREENSHOTS`) ·
`previous_phase { phase, file, location: nested | legacy | null }` ·
`compliance { checkpoint_a { gate, scopeDigest, recorded_at, unresolved[] }, checkpoint_b {…} }` ·
`run_plan` (the `<run_plan>` shape) · `open_questions` (the `<open_questions>` shape, without a
`file` key) · `data_readiness` (the `<data_readiness>` shape: `verdict`, `gaps[] { gap, tcs,
decision, source, provisioning, identifiers, stamped_values, verified_on, cleanup }`,
`predicted_skips`; the same rows as the phase's `### Test-data readiness` table) ·
`coverage_snapshot { measuredAt, weightedPct, target, targetSource, mechanism, verdict, byStage
{smoke|positive|negative: {total, full, partial, none, weightedPct}}, tcs {TC-ID: status},
requirements [{id, short, outcome, assertedBy[]}], manual {total, high, medium, low}, delta
{against, pctChange, improved[], regressed[], added[], removed[]} }` ·
`stages {smoke|positive|negative: {total, passed, failed, incomplete, skipped, not_run[, partial]}}` ·
`smoke_gate { fail_pct, verdict, action_taken, excluded_unverified_assumption, cycles }` ·
`totals { total, passed, failed, incomplete, skipped, not_run[, partial] }` (`partial` present whenever
a `PARTIAL` result exists; a `results[]` row of a PARTIAL TC carries `status: "PARTIAL"`,
`classification: "human step: {n}"` and `human_step: {n}`) · `variant_totals` ·
`merged { stages[], executions[], variants[], tcs[] }` (the `<second_run>` merge of every attempt of
the phase, minus its own schema / story / phase keys; each `stages[]` entry carries `source: 'json' |
'incremental+watchdog'` and, for the latter, `watchdog_path`, plus `run: first | rerun`, `command:
normal | isolation | burn-in` and `started_at` — the order attempts are merged in; every execution
and attempt carries `run`, `command`, `code_fingerprint` and a `stage` text naming the pass) ·
`results[]` (the per-TC rows of `<second_run>` step 3 — the results of record — each with an optional `req_id_conflict`
when the requirement sources disagree and, per attempt, an optional `evidence_issue` when its evidence could not be
paired — `references/schemas/paths-and-evidence.md` §5-§6; and each with `rerun
{ reason: impacted | no-verdict | added, changed[] } | null`) · `unverified_assumptions[]` · `bugs[]
{ id, title, tc_id, req_id, severity, status }` · `heal_log[]` · `skips[]` · `deviations[]` ·
`parallel_checks[] { tc, stage, group, workers, parallel_attempt, alone_attempt, outcome:
interference | confirmed | rate_limited, overlapped[], overlap_rerun[] { tc, status }, moved_to,
learning_line, cause?: test_data_conflict | possible_product_concurrency_defect | environment | unexplained,
cause_evidence?[], resolution?: "test-side: {evidence}" | "bug: BUG-{n}" | null }` · `rate_limit { planned[] (the
run plan's rate_limits[]), refused, services[], policies[], cooldowns_ms[], adjustments[], learned[], scopes?[] }`
(from the stage summaries' `rateLimit`) · optional, additive: `environment_lease { env_id, members[], run_id,
acquired_at, released_at? }` · `parallel_readiness { counts, units, conflicts, differences[], unlock_suggestions[] }`
(every run; `differences[]` only with `--compare`) · `concurrency { scheduler (dispatch | serial | groups), max_workers, avg_active, peak_cpu_pct, min_available_mb (from the summaries' `host`, the opt-in telemetry otherwise), pressure_episodes,
blocked_admissions, lowered[], timeline[] }` · `acceptance { verdict: ACCEPTED | NOT ACCEPTED, reasons[], mode:
pre-gate | final, conditional_on[], computed_at }` · `smoke_gate.eligible` (and `verdict: NO VERDICT`) ·
`results[].status_reason` · `cleanup { sweeps[] { tcs } }` ·
`impact { selections[] { at, iteration, rerun_set[] { tc, reason, changed[] }, added[] { tc, reason },
outside_scope[] }, final_check { at, stale[], fresh_by_member_only[] { tc, review }, unknown[] } }` ·
`run_plan_adjustments[] { at, stage, kind: move | rate-limit | workers, tc | service | group, from,
to, reason, evidence }` (append-only, `<run_plan>`) ·
`timeouts { playwright_version, feature_gates { tags_object, last_failed, native_step_timeout },
initial { test_default_ms, test_long_ms, expect_ms, action_ms, navigation_ms, hook_ms,
step_default_ms, step_long_ms, operations {name: ms}, watchdog_grace_ms, rate_limit {
max_start_wait_ms, in_step_wait_ms, cooldown_ms, cooldown_max_ms } }, events[] { tc, step,
elapsed_ms, deadline_ms, expected, kind: step | test | ceiling | watchdog, evidence },
adjusted[] { key, from_ms, to_ms, reason, evidence }, probe: PASS | NOT_RUN, calibration:
done | NOT_RUN }` (optional; the renderer ignores it — the `### Run` `Timeouts` bullet and the return's
`Timeouts:` line carry the human-readable form) · `watchdog_events[] { stage, group, worker, tc, step,
elapsed_ms, deadline_ms, action: stopped | ceiling-stop }` (optional) · 3.0, optional and written only when the
document has `[API]` / `[DB]` lines (a UI-only run file keeps the 2.x shape): `run_plan.layers {TC: ui | api | db |
api+db | hybrid}`, `run_plan.backend_project`, `run_plan.backend_lines {TC: [ER{n}]}` · `data_changes { consent, tcs[],
setup, cleanup, teardown, asked_at }` · `environment` as an object `{ name, class, api_hosts[], db_identity,
production_markers[], db_env_var }` (a plain string stays valid; the report shows `name`) · `evidence_record` /
`failure_record` on every attempt and on `results[]` beside the image paths. What the run kept or left in doubt is
never copied into the run file — the ledgers (`artifacts/progress/*.data-ledger.jsonl`) are its only source.
`merged.stages[]`,
`watchdog_events[]` and `timeouts.events[]` entries come ready-made from the stage summaries of
`run-stage.mjs` (`artifacts/progress/{run}-{stage}-{seq}.summary.json`).

A run file written by `link-qc-5b-test-run-manual-cli` carries the generic keys only (`framework:
"manual-cli"`, `file_or_suite: "—"`, no `compliance` / `run_plan` / `coverage_snapshot` / `merged` /
`heal_log` / `timeouts` / `watchdog_events` / `parallel_checks` / `rate_limit` / `impact` /
`run_plan_adjustments`); the coverage delta therefore skips it.

**Lifecycle.** `N` is assigned once at profile time: 1 + the highest phase found across
`.runs/phase-*.json`, legacy `phase-*.json|html` at the top of `{results_root}`, and every legacy
root. The file is created with `status: planning` and updated at PHASE 2.4 (`open_questions`), 2.5
(`coverage_snapshot`), 2.6 (`data_readiness`, `run_plan`), Checkpoint A, during the run
(`run_plan_adjustments[]`, appended), after the re-run (`merged`, `results`, `stages`, `totals`,
`parallel_checks`, `rate_limit`, `impact`), Checkpoint B (the freshness check in `impact`) and
finalization. Once its status is final the file is
immutable — except that skill 9's retest updates the LATEST phase's file in place (§3), never an
earlier one; a skill 5 / 5b run in progress (`planning`, `ready`, `running`) blocks that retest. An invocation that stops early leaves its final status and the short phase section of
§4; the next invocation takes N+1. The coverage delta reads the newest earlier `.runs/phase-*.json`
that carries a `coverage_snapshot`, else a legacy `coverage-previous.json` (read-only), else "no
prior measurement" — and says which.

## 8. Evidence links and the viewer

Evidence and Screenshot cells hold markdown links RELATIVE to the report folder; the page shows each as a
thumbnail with its own viewer. A missing file warns (`evidence-file-missing`), an absolute path warns, a
`data:` URI **blocks** — and nothing under `screenshots/` is ever moved, or the links break. A `.record.json` link (3.0)
is shown as "View record" with its channel (`API`, `DB`, `DB + API`), never as an image; an unreadable record warns
(`record-unreadable` — item 54 has already failed it) and a record that still carries a credential-shaped value
**blocks** the page (`secret-literal`).

## 9. Provenance and hand edits

Line 2 of every page is a provenance comment (the sha256 of each input and a self-hash of the page; a page
published after Checkpoint B also carries ` · gate={sha256}` of its gate record — pages without it still
verify). On
`--write` a self-hash mismatch means a human edited the HTML: the write is refused (`refused.reason:
hand-edited`) until `--force` — tell the user what will be lost first. Typing a comment in the page never
changes the page file.

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

## 9c. Navigation, sorting and filtering — built in the browser, display only

The shell's contents panel, sortable headers and filter boxes (skill 3's `html-page.md` §7c) change the
display order only — never a value.

## 10. Templates — the body partial and the report shell

Maintainers only. Two passes: `assets/run-report.template.html` (the body partial) inside
`assets/report-shell.template.html` — the one general page, byte-identical with skills 3, 3b, 3c and 5b
together with the renderer's "report-shell kit" block. A placeholder left unfilled BLOCKs the render.
After any template or renderer change run `node scripts/selftest-run-report.mjs --pretty` and regenerate
the goldens only for a deliberate change (`scripts/fixtures/run-report/README.md`); a shell change is
copied to every sibling.

## 11. Migration — projects set up before this layout

Legacy folders and files stay where they are as read-only history (§3, `results-and-evidence.md`). The
first run under this layout says so once in the chat (where the earlier phases are, which number the new
one takes), creates the two markdown files, lists the legacy locations on `Earlier phases` and renders.
Nothing is migrated, merged or deleted.
