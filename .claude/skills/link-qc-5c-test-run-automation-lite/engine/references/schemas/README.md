# Script conventions — what every call needs (model-facing)

Read this instead of any script's source. A script's full flags: its `--help`. Payload shapes:
`script-payloads.md` (only when a field needs explaining).

## Calling

- Always `node .claude/skills/link-qc-5-test-run-automation/scripts/{script} …` from the project root. No `cd`, pipe,
  environment prefix or `--pretty`. Every script prints ONE JSON object.
- Paths may be relative to the project root or absolute. Each script normalises them.
- `--run-file` is the anchor: `{results_root}/.runs/phase-{N}.json`. The **automation root** is derived from it (the
  folder its `results_root` is relative to). `--cwd` / `--automation-root` are overrides only.
- `--root` = the project root (where `Testing/qa-manifest.json` lives). `scratch.mjs` needs `--root <automation root>`.

## The commands of a run

| Step | Command |
|---|---|
| Preflight (end of intake, again before the first run) | `run-stage.mjs preflight --run-file {run_file} --env-id {env_id} --probe-url {url}` |
| Config outside the automation root (preflight reason `config location`) | `config-inventory.mjs reconcile --root {project} --results-root {results_root} --apply --move-config` |
| Run protections + helpers (incl. `helpers/evidence.ts`) | `config-inventory.mjs reconcile --root {project} --results-root {results_root} --run-file {run_file} --apply` |
| Readiness | `parallel-plan.mjs … --out {results_root}/artifacts/parallel-plan.json` |
| Checkpoint A | `check.mjs checkpoint --checkpoint A --root {project} --results-root {results_root} --phase {N} --files {a,b,…}` → `AWAITING_REVIEW` → same + `--review {file}` |
| A stage | `run-stage.mjs --run-file {run_file} --stage smoke\|positive\|negative --run first\|rerun --stage-tcs {…} --log {progress_log} --project {p} --spec {…} --ceilings auto --units {parallel-plan.json}` |
| Re-run set | `impact.mjs select --root {automation_root} --spec {…} --progress {results_root}/artifacts/progress --run-file {run_file}` |
| Re-run stage | the stage command with `--run rerun --tcs {set} --burn-in auto` |
| Activity / note line | `run-stage.mjs activity --log {progress_log} --text "{activity}"` · `--note "{line}"` |
| Finalize (Checkpoint B + publish) | `run-data.mjs finalize --results-root {results_root} --phase {N} --files {…} [--judgements {f}]` → `AWAITING_REVIEW` → same + `--review {file}` |
| New phase after a BLOCKED phase | `run-data.mjs handoff --run-file {run_file}` — in a FRESH session |

Exit codes: 0 pass / published · 1 FAIL · 2 BLOCKED · 3 NOT_RUN · 4 AWAITING_REVIEW (the expected handoff).

## Rules the scripts apply (do not redo them)

- **Static checks** (`check.mjs`) never take a capacity-ledger slot. Low memory prints `host memory N GB — static
  checks run without the ledger` and continues. Never ask the user about memory for a static check.
- **Serial**: readiness `candidateConcurrency` 1 → one `playwright test` process per group, `--workers=1`.
- **`--config`** is passed to Playwright by `run-stage.mjs`. Never write `--config`, `--cwd` or `cd` yourself.
- **Burn-in** (`--burn-in auto`): only Heal Log entries with `cause_class` `timing` / `flaky` / `race` repeat ×3;
  `deterministic` runs once.
- **Impact**: `impact_level` `file | method | branch`; `fresh_by_branch[]` = TCs whose variant does not take the
  changed branch; `branch_undecided[]` says why a decision fell back.
- **draft-init** keeps an existing draft folder: seeds missing files, lists `kept[]`.

## Evidence layout

`{screenshots_root}/phase-{N}/{TC-ID}/{project}--{variation}--r{repeat}/attempt-{a}.png` (+ `attempt-{a}-failed.png`,
`attempt-{a}.record.json`), `variants.json` per TC folder. Written only by `helpers/evidence.ts` (template
`assets/evidence.template.ts`): ONE `evidence` heartbeat per attempt, none for the failure image. Images found under
another root with the same layout are moved by `finalize` and recorded as `evidence_relocated {from, to, files, at}`
(listed under Deviations, check 18 PASS) — never a reason to re-run a phase.

## Records the scripts write

- `{run_file}.impact.final_check` = `{ outcome: FRESH | STALE, fresh: N, stale: [], checked_at, impact_level? }` —
  always present after `finalize`; never copied in by hand.
- `{run_file}.heal_log[]` = the nine Heal Log keys + optional `cause_class` (`deterministic | timing | flaky | race`).
- Logs: `{logs_root}/run-progress-{stamp}.log` (machine lines — never read) and `run-summary-{stamp}.log` (≈ 40 human
  lines: activities, stage start / end with wall and test time, one line per TC, heal rows, gate verdicts). The return
  links the summary log first.
