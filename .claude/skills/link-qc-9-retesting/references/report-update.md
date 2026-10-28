# Report update — the latest phase, in place (step 6)

Loaded by SKILL.md step 6. Contract §7. **User decision (2026-10-19):** a retest updates the
LATEST phase N of skill 5's run report in place, so the TC status and the pass rate follow the fix.
This is the one exception to "finalized phases and run files are immutable", and it belongs to
skill 9 alone. The shapes are skill 5's (`../link-qc-5-test-run-automation/references/run-report.md`
§4, §5, §7) — read that file once before the first edit; this page says only what a retest changes.

**Scope of an edit.** Phase N only — an earlier `## Phase`, its run file, its screenshots and its
progress logs never change. Only the rows of TCs that were re-run IN FULL with a product verdict
(automation-rerun.md §4, browser-cli.md §1) change; an unobserved TC keeps its row. A row is never
added or removed, so the phase's Total never changes. No new `###` sub-section, no new file in the
story folder (skill 5's whitelist).

**Run files from skill 5 2.0 (and older ones).** The steps below are the same for both. A 2.0 phase also has
skill 5's gate records `.runs/phase-{N}.checkpoint-A.json` / `-B.json`, an `acceptance` object in the run file, a
`- **Acceptance:**` bullet and drafts under `artifacts/drafts/phase-{N}/`: they are skill 5's record of the phase as
it was checked and published — never edited, deleted or re-created here, never hashed into the amended page
(render WITHOUT `--gate`, §4), and `run-data.mjs` / `check.mjs` are never called. The retest is recorded as an
amendment (`retests[]`, the `Retest` bullet, `### Deviations`), not as a new checkpoint or a new acceptance
decision. An older run file (no gate records, no `acceptance`) is updated the same way.

## 1. `TEST-RUN-REPORT-{feature}.md` — the `## Phase N` section

| Part | Change |
|---|---|
| `### Results` row of each changed TC | `Status` (PASS · FAIL · INCOMPLETE · PARTIAL — human step pending); `Duration` of the retest attempt; `Classification` (`—` for PASS, the catalogue word otherwise — never a free reason, `unknown-classification` must not appear); `Evidence` = the new images first, the earlier links kept after them: `[attempt-2.png](../../screenshots/…/phase-N/TC-007/chromium--variation-a--r0/attempt-2.png) · [attempt-1.png](…)`. `REQ`, `Name`, `Group` unchanged |
| `### Stages` | one new row `{Stage} (retest — skill 9)` per stage that had retest TCs, counting only the retest subset (same columns), inserted above **Total**; the **Total** row recomputed = the results of record (one per TC — never the sum of the rows). Add the `Partial` column if a row now needs it |
| `### Run` | `**Outcome:**` recomputed with the renderer's rule (smoke gate FAILED-STOPPED → `SMOKE GATE FAILED`; any FAIL → `FAILURES`; any INCOMPLETE or PARTIAL → `INCOMPLETE`; else `GREEN`); one bullet `- **Retest:** {date} — skill 9 · {n} automation re-run · {m} playwright-cli · {p} passed · {f} failed · {u} unobserved · {BUG-…} resolved · {BUG-…} still open` on ONE line (a later retest of the same phase appends `; {date} — …` to that bullet). No other bullet changes |
| `### Bugs` | the bug's `Status` cell; one row per incidental bug (`BUG-{n} · TC · Severity · open`) |
| `### Unverified assumptions` | the `Result` cell of a changed TC |
| `### Skips and residual failures` | a changed TC's row: removed when it is now PASS (the table becomes `none` when empty), its Status / Reason updated otherwise |
| `### Deviations` | `- none` replaced, or one line appended per changed row: `- {TC} {old} → {new} — skill 9 retest {date} ({automation re-run, attempt {a} \| playwright-cli}, {BUG-n}); phase {N} updated in place`, plus a line per environment / headless / login-method deviation |

Header block (before the first `##`): `**Status:**` = phase N's Outcome; `**Latest results:** {p}
passed · {f} failed · {i} incomplete · {s} skipped · {n} not run[ · {x} partial] of {t} TCs`
recomputed from the Results table (` · {x} partial` exactly when a PARTIAL row exists). Every other
header line stays. `## Run history`: phase N's row — `Outcome` and the counts recomputed (`Partial`
column added for every row when it becomes needed), `Bugs` gains the incidental ids; `Date` and
`Duration` unchanged.

## 2. `.runs/phase-{N}.json` — the same change, so the renderer finds no mismatch

- `results[]` entry of each changed TC: `status`, `classification` (`N/A` for PASS),
  `duration_ms`, `evidence_screenshot` / `failure_screenshot` (POSIX, relative to
  `automation_root`), `attempts` (+ the retest attempts), `missing_variants` (required minus the
  variants with a verdict), and per variant `final_status`, `duration_ms` and an appended
  `attempts[]` record `{ attempt, stage: "{stage} · retest (skill 9)", status, evidence_screenshot,
  failure_screenshot, run: "retest", started_at }` (a playwright-cli retest adds the variant
  `retest-cli--{lang}--r1` with `project: "playwright-cli"`); plus `retest { at, bug, before, after,
  way: "automation" | "playwright-cli" }`.
- `merged.tcs[]` of the TC (status, `variant_slugs`, `missing_variants`); `merged.stages[]` and
  `merged.executions[]` gain the entries of the run-stage summaries (`merged_stages`, executions —
  ready-made by the script).
- `totals` and the affected `stages.{stage}` counts recomputed from `results[]`; `variant_totals`
  when present.
- `bugs[]`: the bug's `status`; incidental bugs appended. `deviations[]`: the same lines as §1.
- New top-level array `retests[]` (append-only): `{ at, skill: "link-qc-9-retesting", bug, source,
  tc, way, environment, build, before, after, evidence[], summary }` (`summary` = the run-stage
  summary path, or `null` for playwright-cli).
- `status`, `started_at`, `finished_at`, `total_duration_ms`, `compliance`, `run_plan`,
  `run_plan_adjustments` and every other key stay as they are.

Edit the JSON as data (read → change the keys above → write the whole file, 2-space indent);
re-read it to confirm it parses.

## 3. `BUG-REPORT-{feature}.md`

- `Status`: `resolved (phase {N})` only after an actual pass; `open` after a FAIL (also when it was
  resolved — a reopen); unobserved → unchanged.
- `History`: one line appended to the sub-list — `- phase {N} — {PASS | FAIL | not run}: retest by
  skill 9 on {date} ({automation re-run, attempt {a} | playwright-cli}) on {environment}, build
  {build} — [{file}]({relative link})`; unobserved → `not run: retest by skill 9 on {date} —
  {reason}`. Nothing above it is rewritten.
- `**Bugs:** {open} open · {resolved} resolved · {n} not checked this run of {total}` recomputed
  from the entries. No other field of an existing entry changes (no new Build, Screenshot or
  Evidence on an old bug).
- Incidental bugs: a new `### BUG-{n}` (next free number — shared with skills 5 and 5b) in the
  producer format with `Found in phase: {N}`, `Status: open`, its evidence and a first History line.

UI bugs (skill 6 report) change nothing here: their result lives in the ledger (contract §§4–5).

## 4. Render — the only way the page changes

```text
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report {results_root}/TEST-RUN-REPORT-{feature}.md --pretty
```

(no `--gate`: the amended page must not carry the Checkpoint B record of the page skill 5 published; skill 5
absent cannot happen here — the run is BLOCKED without its coordination, coordination.md). Dry run first: `gate` must be `PASS` with `mismatches: []` and no warning this edit
caused (`unknown-classification`, `evidence-file-missing`, `evidence-path-not-relative`) — a
mismatch names the markdown line to fix; fix it and dry-run again. Then the same command with
`--write` — only when phase N's run file chose the page (`delivery.report` absent or `html`); under `delivery.report:
md` the dry run is the whole step (the markdown is the deliverable, no page is written). `refused.reason: hand-edited` → tell the user what will be lost and re-render with
`--force` only after they agree. Never write or patch the HTML. The tracker
(`TC-STATUS-TRACKER-{feature}.md`) is read-only here.

**Pass rate for the final message:** `{p} passed of {t} TCs ({p ÷ t, one decimal}%)` before → after,
from the Results table of phase N (a PARTIAL row is never passed).
