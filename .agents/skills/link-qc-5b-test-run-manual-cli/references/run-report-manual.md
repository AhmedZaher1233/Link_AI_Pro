# The run report of a manual phase — what this skill writes into skill 5's report set (steps 7, 12)

This skill writes **exactly the files, shapes and vocabulary of skill 5's run-report contract**
(`link-qc-5-test-run-automation/references/run-report.md` — the owner of the contract; read it
when a detail is missing here). This file restates only what a **manual phase** fills in
differently. The renderer, its harness, `scan-lib.mjs`, both templates and the fixture under
`scripts/` are byte-identical mirrors of skill 5's (checked by harness case 28); the page is
produced by them and never by hand.

## 1. Commands (from the project root)

```bash
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/render-run-report.mjs --report {results_root}/TEST-RUN-REPORT-{feature}.md --pretty            # dry run: payload, gate, mismatches
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/render-run-report.mjs --report {results_root}/TEST-RUN-REPORT-{feature}.md --write --pretty    # writes TEST-RUN-REPORT-{feature}.html beside it
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-run-report.mjs --pretty      # the mirrored harness (29 cases) — must pass before delivery
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-manual-run.mjs --pretty      # the 5b-only harness (a manual phase after an automation phase) — must pass before delivery
```

`--force` only for a hand-edited page the user asked you to replace. The renderer never prints
the HTML; it reads `BUG-REPORT-{feature}.md`, `.runs/` and `REVIEW-COMMENTS-{feature}.md` beside
the report by itself.

## 2. Gate

`PASS` (page written) · `MISMATCH` (page written with a warning strip — fix the markdown, never
the page) · `BLOCKED` (nothing written — fix the markdown) · `NOT_RUN` (report missing). A
manual phase must leave `mismatches[]` empty and must not raise `evidence-file-missing`,
`run-file-missing`, `bug-report-missing` or `unknown-classification`.

## 3. Folder — skill 5's story folder, shared counters

```text
{automation_root}/reports/[SPEC-{spec-name}/]{user_story_name}/        ← {results_root}, the TC folder's exact leaf
  TEST-RUN-REPORT-{feature}.md      header + ## Run history + one ## Phase N per run — you APPEND one section
  BUG-REPORT-{feature}.md           one ### BUG-n per defect — you add entries and append History lines
  TEST-RUN-REPORT-{feature}.html    rendered after every phase
  REVIEW-COMMENTS-{feature}.md      the reviewer's (optional); you only set Status / Response of handled entries
  .runs/phase-{N}.json              this phase's machine data (§6); earlier files untouched
{automation_root}/screenshots/[SPEC-{spec-name}/]{user_story_name}/phase-{N}/{TC-ID}/manual-cli--none--r{k}/attempt-{a}.png [+ attempt-{a}-failed.png] [+ reply.md]
{automation_root}/automation-logs/[SPEC-{spec-name}/]{user_story_name}/run-progress-{stamp}.log
```

- **Phase `N`** = 1 + the highest phase found in `.runs/phase-*.json`, `## Phase N` headings and
  legacy `phase-N.*` files of `{results_root}` — phases written by skill 5 and by this skill both
  count. Resolved once at intake; a BLOCKED entry gate consumes no phase.
- **Whitelist** = skill 5's: nothing is created in the story folder beyond the files above
  (`automation-inventory.md` and `coverage/` are skill 5's; you never touch `artifacts/`, which
  skill 5 treats as scratch). Your reply files live beside the screenshots, in the immutable tree.
- **Immutability**: earlier phase sections, earlier run files and everything under
  `screenshots/` are never edited, renamed or deleted — by either skill.

## 4. `TEST-RUN-REPORT-{feature}.md` — the manual phase section

**Header** (rewritten for the latest phase, as skill 5 does): `Latest phase`, `Latest run`,
`Status`, `Latest results` (` · {x} partial` exactly when a PARTIAL row exists), `Compliance: —
(manual run)`, `Azure DevOps: local | linked` (linked only when an `ADO-MAP.md` exists at the
source revision — you never touch it), `Run file`, `Screenshots`, `Progress log`, `Earlier
phases` (kept). **Run history**: ONE new row; add the `Partial` column to the table the first
time any phase holds a PARTIAL row.

**`## Phase N — YYYY-MM-DD`** then:

`### Run` — `- **Field:** value` bullets, in this order:
`Outcome` (`GREEN | FAILURES | INCOMPLETE | SMOKE GATE FAILED[ — reason]`; `BLOCKED — reason`
only for a phase that stopped before execution, without Stages / Results) · `Environment` ·
`Build` (from the app or `unknown`) · `Run command: manual run — playwright-cli {version}
(skill 5b)` · `Headed / workers: headed · one session per account` · `Login method: A1 attended ·
A2 secrets file` (names only, never a value) · `Started` · `Duration: hh:mm:ss (manual run · one
session per account)` (the parentheses are deliberate — the renderer then shows this text instead
of a plan estimate) · `Run file` · `Progress log` · `Screenshots` · `Compliance: — (manual run)`
· `Azure DevOps` · `Data changes: {authorized | not authorized} · {n} made ({t} by TCs · {p}
preparations) · {n} cleaned up · {n} kept · {n} left` · `Data preparation: e2e {n} · api helper
{n} · api from source {n} (user yes) · db {n} (user yes) · kept {n} · cleaned up {n}` (only when
an item was prepared) · `Previous phase: .runs/phase-{N-1}.json (skill 5 | skill 5b) | none`.

`### Stages` — required for every executed outcome:
`| Stage | Total | Passed | Failed | Incomplete | Skipped | Not run[ | Partial] |` with the rows
`Smoke` (every `Smoke: YES` TC), `Positive` (`@positive`, not smoke), `Negative` (`@negative`,
not smoke) and `**Total**`; the `Partial` column exactly when the phase holds a PARTIAL row. Then
the mandatory line, whose first word is only ever `passed` or `FAILED-STOPPED`
(`run-plan.md` §4):
`**Smoke gate:** passed — fail% {x}% — {no action needed | continued: {n} environment_failure · {n} assertion_failure (no self-heal in a manual run)}`
`**Smoke gate:** FAILED-STOPPED — fail% {x}% — application-error majority ({n} app_bug of {m}); positive and negative stages not run`

`### Results` — `| TC-ID | REQ | Name | Status | Group | Duration | Classification | Evidence |`,
one row per TC of the document, document order:
- `Status` ∈ `PASS | FAIL | INCOMPLETE | SKIP | NOT_RUN | PARTIAL — human step pending`
  (PARTIAL is the only status carrying a reason).
- `Group` = the stage (`smoke` / `positive` / `negative`).
- `Duration` = `hh:mm:ss` of the TC (all repeats), `—` when not executed.
- `Classification` = `—` for PASS · `app_bug` / `assertion_failure` / `environment_failure` /
  `data_missing` / `timeout_failure` / `evidence_failure` / `ai_rubric_failure` for FAIL and SKIP
  rows per `execution-rules.md` §3 · `incomplete: rubric-ambiguous` / `incomplete: expectation
  ambiguous (Q-n)` / `interrupted: session lost at step {n}` / `interrupted: reply did not
  stabilise within {s} s` for INCOMPLETE · `human step: {n}` for PARTIAL · `—` for NOT_RUN and
  for SKIP rows whose reason lives in the Skips table (never `not started: …` — the renderer
  does not know it).
- `Evidence` = ` · `-separated markdown links relative to the report folder
  (`[attempt-1.png](../../screenshots/…/manual-cli--none--r0/attempt-1.png) · [failed](…/attempt-1-failed.png) · [reply](…/reply.md)`), or `—`.
  An AI TC links the deciding repeat; a PARTIAL row links the image of its last executed step.

Optional sub-sections you write: `### Bugs` (cross-reference `Bug · TC-ID · Severity · Status`,
ids only, or `none`) · `### Skips and residual failures` (`TC-ID · Status · Reason`, or `none`)
· `### Open questions` (`# · Source · Ambiguity · TCs · Decision · By`, or `none`) · `### Test-data
readiness` (`**Verdict:** READY | READY-WITH-SKIPS ({n} TCs)[ — {p} gaps prepared]` + one row per
`D{n}` item you looked at — `Gap · TCs · Decision · Source · Provisioning · Identifiers / names ·
Effective stamped values · Verified on · Cleanup`, `Decision` ∈ `READY` · `prepared (api|ui|db)` ·
`skip — data_missing` · `skip — not creatable` · `skip — QC declined` (`test-data-preparation.md`
§5; the renderer counts them and shows a `Decisions:` line) — or `all ready`) · `### Deviations`
(bullets routed to skill 3 `--revision`, incl. "repeats share one conversation", any 3b / 3c
state this run contradicts, every stamped-value substitution `D{n} "{item}": {field} — TC says
{literal}, the system stamped {value}; the observation used the stamped value — route to skill 3
--revision`, every record left behind, or `- none`). You never write `Run plan`, `Coverage`, `Unverified
assumptions` or `Heal log`.

## 5. `BUG-REPORT-{feature}.md`

Skill 5's §5 unchanged: `### BUG-n — {title}` entries (`n` continues from the highest existing id
whichever skill wrote it; never reused), fields `TC-ID` · `Requirement` · `Severity` ·
`Environment` · `Browser: Chromium (playwright-cli)` · `Language` · `Build` · `Found in phase` ·
`Status` (`open` · `resolved (phase N)` · `not-checked-this-run`) · `Root cause` (when observed,
else `—`) · `Steps to reproduce` (ordered, from login) · `Expected` · `Actual` · `Screenshot`
(one relative link or `none captured`) · `Evidence` (the observed text ≤ 2 lines; for an AI bug
the `reply.md` link + the failed check / criterion) · `History` (appended `- phase {N} — FAIL |
PASS | not run: {note}`). Title voice: "The system doesn't X when Y" / "The assistant doesn't X
when asked Y". The header's `**Bugs:**` line is recomputed from the entries. `resolved` only
after a passing retest in this phase; a bug whose TC did not run → `not-checked-this-run`.

## 6. `.runs/phase-N.json` — the generic subset of `skill6-run/1`

```json
{ "schema": "skill6-run/1", "phase": N, "status": "complete | stopped-smoke-gate | environment-blocked | blocked",
  "run_id": "US-{id}-phase-{N}-{date}", "user_story_id", "user_story", "user_story_name", "feature", "spec_level",
  "source_tc_doc", "source_sha256", "environment", "build",
  "framework": "manual-cli", "file_or_suite": "—", "ado_mode": "local | linked", "headed": true, "workers_parallel": 1,
  "started_at", "finished_at", "total_duration_ms",
  "results_root", "screenshots_root", "logs_root", "progress_log",
  "previous_phase": { "phase", "file", "location": "nested | legacy | null" },
  "stages": { "smoke|positive|negative": { "total", "passed", "failed", "incomplete", "skipped", "not_run"[, "partial"] } },
  "smoke_gate": { "fail_pct", "verdict": "passed | FAILED-STOPPED", "action_taken", "cycles": 0 },
  "totals": { "total", "passed", "failed", "incomplete", "skipped", "not_run"[, "partial"] },
  "variant_totals": { "passed", "failed", "skipped", "not_run"[, "partial"] },
  "results": [ { "tc_id", "req_id", "test_name", "status", "duration_ms", "classification", "error_message", "root_cause",
                 "run_group": "smoke | positive | negative", "run_mode": "serial", "evidence_screenshot", "failure_screenshot",
                 "severity", "attempts", "missing_variants": [], "outcome_check": "what was observed", "human_step"?,
                 "ai"?: { "repeats", "threshold", "passed_repeats", "replies": ["…/reply.md"] },
                 "variants": [ { "variant_slug": "manual-cli--none--r{k}", "project": "manual-cli", "final_status", "duration_ms",
                                 "attempts": [ { "attempt", "stage", "status", "evidence_screenshot", "failure_screenshot" } ] } ] } ],
  "bugs": [ { "id", "title", "tc_id", "req_id", "severity", "status" } ],
  "skips": [ { "tc_id", "status", "reason" } ], "deviations": [ "…" ],
  "data_readiness": { "verdict": "READY | READY-WITH-SKIPS",
                      "gaps": [ { "gap", "tcs": [], "decision": "READY | prepared (api|ui|db) | skip — data_missing | skip — not creatable | skip — QC declined",
                                  "source", "provisioning", "identifiers", "stamped_values", "verified_on", "cleanup": "kept | cleaned up | left | null" } ],
                      "predicted_skips": [] },
  "manual_run": { "skill": "link-qc-5b-test-run-manual-cli", "tool": "playwright-cli", "tool_version", "login_methods": { "A1": "attended" } } }
```

Paths are POSIX, relative to `{automation_root}`, exactly as skill 5 writes them. `data_readiness`
holds the same rows as the phase's `### Test-data readiness` table (skill 5's shape plus
`identifiers`, `stamped_values`, `verified_on`); it is written only when at least one item was
looked at. Not written: `compliance`, `run_plan`, `open_questions`, `coverage_snapshot`,
`merged`, `heal_log`, `unverified_assumptions`, `timeouts`, `watchdog_events` (the renderer
ignores them; skill 5's coverage delta skips a file without `coverage_snapshot`). Created with
`status: planning` at step 7, updated after each stage, final at step 12, then immutable.

## 7. Evidence, provenance, comments

Evidence links are relative to the report folder and must exist (`evidence-file-missing` is a
warning you must not deliver with). The page carries the renderer's provenance comment with the
report / bugs / runs / comments hashes; a page without one is replaced with a warning, a
hand-edited one is refused without `--force`. Reviewer comments (`General`, `BUG-{n}`,
`phase-{N}`) come from `REVIEW-COMMENTS-{feature}.md` beside the report: you only set a handled
entry's Status (`applied | answered | declined {date}`) and `Response`; a comment never changes a
bug's Status and never a TC's result.
