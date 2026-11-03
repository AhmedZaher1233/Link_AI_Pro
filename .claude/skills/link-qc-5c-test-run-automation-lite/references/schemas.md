# lite.mjs — commands, outputs, files (model-facing; read this instead of any script source)

Call: `node .claude/skills/link-qc-5c-test-run-automation-lite/scripts/lite.mjs <cmd> [flags]` from the project root. One compact JSON line on stdout; the full
payload is written to `{results_root}/artifacts/lite/<cmd>-{stamp}.json` (`--json` prints it, `--pretty` indents). Paths: project-relative or absolute.
Exit: PASS / PUBLISHED / COMPLETED / READY / OK **0** · FAIL / STOPPED **1** · BLOCKED **2** · NOT_RUN **3**. `lite.mjs --help` lists every flag.

| Command | Flags (required first) | Compact output keys |
|---|---|---|
| `init-run` | `--tc` · `--environment --env-url --env-class --allow-data-changes --report --screenshots --max-workers --project --tcs --phase --force --root` | `phase runFile resultsRoot feature tcs stages{smoke,positive,negative} layers project delivery dataChanges document next` |
| `consent` | `--run-file --allow-data-changes` · `--env-class` | `consent tcs environmentClass next` |
| `auth` | `--run-file` · `--probe-spec` \| `--probe` \| `--mechanism --survives-reset --language-scope` · `--api-signin --fallback-reason --source` · `--clear` | `strategy per why source gitignore next` · `removed` |
| `journey` | `--run-file --spec a,b` | `journeys[{spec,kind,tests}] next` |
| `preflight` | `--run-file` · `--probe-url --env-id --cli --headless` | `verdict reason memory environment playwright config workers fullVersion next` |
| `cache` | `--results-root --files` · `--mark --root` | `read[] new[] changed[] unchanged[] missing[]` |
| `checkpoint-a` | `--results-root --phase --files` · `--tc --data --req --coverage --specs --assertion-review --tsc --cli --root` | `outcome snapshotId reusedMechanical checks{tsc,pom,traceability,assertions} safety problems[≤10] more warnings ownership{fail,warn,fix} ledger{warn,tcs} signIns{warn,fix} traceability journeys coverage gate next` |
| `stage` | `--run-file --stage` · `--run first\|rerun --tcs --stage-tcs --spec --burn-in --max-workers --headless --cli --env-id --replan` | `outcome stage run counts workers workerCap scheduler serialBecause memoryGate smokeGate failing[] notRun reason summaryLog next` |
| `teardown` | `--run-file --spec` (remembered after the first call) · `--headless --cli` | `outcome spec journeys{passed,failed,other} reason summaryLog next` |
| `rerun-select` | `--run-file` · `--spec` | `rerun[] byStage impactLevel stale[] expanded[] noVerdict[] neverRun[] memberOnly[] next` |
| `finalize` | `--results-root --phase --files` · `--feature --judgements --tc --data --req --root --automation-root` | `outcome step reason steps checks{results-integrity,tc-status-coverage,failure-evidence} problems acceptance notAccepted counts report page statusLines authStateRemoved advisory next` |

## Files Lite writes
- `.runs/phase-N.json` (init-run): schema `skill6-run/1` + `run_plan { projects, required_variants, groups, layers }` + `data_changes { consent, tcs, setup, cleanup, asked_at }`
  (init-run / consent) + `lite { version, project, stages, max_workers, specs[], log, sources { tc, data, spec, constitution, manifest, learning, automation_root, automation_root_source } }`. `checkpoint-a` PASS adds `lite.specs`, `lite.checkpoint_a` (its inputs, for
  finalize's refresh) and the `coverage_snapshot`; `teardown` adds `run_plan.setup_groups[teardown]` and `lite.teardown`; `journey` / `teardown` keep
  `lite.journeys[{spec,kind}]`; `auth` writes `auth { mechanism, survives_reset, language_scope, api_signin, strategy, per, why, source, fallback_reason? }`.
- `{automation root}/.auth/` (git-ignored): storageState per role and `probe.json` (names / booleans only) — never logged, removed by `finalize` / `auth --clear`.
- `.runs/phase-N.checkpoint-A.json` / `-B.json` (+ `artifacts/checks/{snapshotId}/gate-{A|B}.json`): Full's `skill5-gate/1` shape with `profile: "lite"`; results are the four / three
  `lite:*` checks (`status` `verified-mechanical | FAIL | unresolved`, `reason`, `evidenceRef[]`). B adds `freshness`, `frozen.drafts`, `gateA`, `advisory[]`. Only the script writes them.
- `artifacts/lite/`: `mech-{snapshotId}.json` (reusable tsc / validator / config components), `mapping.json` (`[TC-ID]` → spec files), `read-cache.json`, one payload per call.
- Full's own files stay where Full puts them: `artifacts/progress/*.summary.json`, `artifacts/stages/`, `artifacts/diagnostics/`, `artifacts/drafts/phase-N/`, published reports, `automation-logs/`.

## Inputs the model writes
- coverage judgements (stage 2) · `--assertion-review` (stage 2, only for `assertions-conditional` / `-unresolved` items) · judgements file (stage 4) · bug narratives (stage 4).
  Shapes: stage references; Full `references/schemas/script-payloads.md` *Inputs* for the judgements.

## Checkpoint rules at a glance
A PASS needs: tsc passes · no POM violation / undecided duplicate page / spec-imports-spec · every approved TC judged, covered TCs mapped, exclusions documented, no duplicate or unknown
`[TC-ID]` mapping · no placeholder / empty / assertion-free test and every conditional path reviewed — and no provable execution-safety violation
(a ledger label check 53 would refuse — `modify` / `remove` of a resource nothing in scope creates, any `modify-external` — is one; the gate record keeps `ledgerOwnership`).
B PASS needs: runtime checks 16b 18 25b 38 48a 48b 53 54 (48b / 53 skip a proven superseded attempt — stage 4) + no stale result + every PASS ends on a passing attempt · every in-scope TC has one final status (reason for NOT_RUN / SKIP / INCOMPLETE) ·
every FAIL classified, evidence on disk, `app_bug` keeps its original expected outcome and is never an `@unverified-assumption` test. Acceptance (Full's six conditions) is final: `ACCEPTED` or `NOT ACCEPTED — reasons`.
