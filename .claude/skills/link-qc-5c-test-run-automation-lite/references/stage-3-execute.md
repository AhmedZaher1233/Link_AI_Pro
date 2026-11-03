# Stage 3 — Execute, Analyze & Heal

Every Playwright command goes through `lite stage` (it wraps `run-stage.mjs`: watchdog, capacity ledger, isolation re-run, rate limits). One
call and one message per stage, run in the foreground. Never run `npx playwright` yourself, never pass `--config` / `--cwd`, never poll.

## 1 · Stages (first run)
```
lite stage --run-file {rf} --stage smoke    --run first [--max-workers N] [--headless]
lite stage --run-file {rf} --stage positive --run first
lite stage --run-file {rf} --stage negative --run first
```
Order is enforced: positive / negative refuse until smoke has a verdict. `--stage-tcs` defaults to the run file's lists; `--spec` to the story's specs.
Output: `outcome`, `counts {tcs, passed, failed, skipped, notRun}`, `workers` (used) / `workerCap`, `scheduler` (+ `serialBecause`), `smokeGate`,
`failing[]`, `notRun`, `next`. The stage message to the user is exactly that, in one line, plus the failing TC IDs.
- **Workers:** 2-5 when `parallel-plan` proved ≥ 2 TCs independent (no shared test data), else 1; never above `--max-workers` (default and maximum 5); the Auto ceiling and
  `machineMaxWorkers` can only lower it. Do not raise it to go faster. A conflict (shared account, one DB, rate limit) keeps it serial — say why from `serialBecause`. Low free memory never makes a stage wait: a serial stage skips the ledger, a parallel one drops workers (`memoryGate`). Never ask the user about memory.
- **Smoke gate 30 %:** `smokeGate.decision` `continue` ⇒ go on. `classify` (> 30 %) ⇒ classify the smoke failures: if the majority are `app_bug`, STOP (positive /
  negative stay NOT_RUN, finalize and report); if they are test-code defects, heal (≤ 2) and `lite stage --stage smoke --run first` again until the gate opens or the
  attempts are spent. `no_verdict` ⇒ fix the cause and retry smoke, or finalize. `lite stage` returns `STOPPED` for positive / negative while the gate is closed.
- `outcome` `STOPPED` / `BLOCKED` (frozen step, ceiling, spawn failure, environment) ⇒ read `reason`; an unhealthy environment is
  `ENVIRONMENT_BLOCKED`, not a test result. TCs the run did not execute are `NOT_RUN` with the script's reason — never PASS.

## 2 · Analyze failures (only the failing TCs)
Evidence order: the stage payload's `failing[]` → `{results_root}/artifacts/diagnostics/phase-N/{command}/playwright-output.log` (grep the TC, do not read the whole
log) → the failure screenshot / record → the source. Classify each FAIL with the cause evidence shows:
`selector_failure · assertion_failure · app_bug · api_contract_failure · db_assertion_failure · environment_failure · data_missing · timeout_failure · evidence_failure · automation_failure · unverified_assumption`.
- **Automation defect** (wrong selector, wait, data setup, POM bug, evidence call) ⇒ heal it. **Application defect** ⇒ keep the test as written, class `app_bug`,
  `severity`, `root_cause` with the **original expected outcome** quoted from the approved TC — it becomes a bug. A failing `@unverified-assumption` test is never `app_bug`.
- FAIL beside other tests that passes alone is interference (`parallel_checks[]`): give `cause` + `resolution` or it stays an open finding (the run is then NOT ACCEPTED).

## 3 · Heal (test code only, ≤ 2 attempts per test) — one heal ROUND
Classify every failure of smoke / positive / negative first, then fix ALL automation defects together; never re-run per heal. Fix the root cause in the page
object / spec / helper; never lower or broaden an assertion, change an expected value, add a skip, retry or longer timeout to hide a failure, or touch product
behaviour. A "click again when the state did not change" heal must assert the expected state after the retry (a dead control still FAILs) and its row says
`retry_used: true`. After each heal: a Heal Log row (the nine columns, `cause_class` `deterministic | timing | flaky | race`) goes into the judgements
file (stage 4). `run-stage.mjs activity --log {progress_log} --note "heal TC-07: …"` writes the row to the summary log. A test still failing after 2 attempts is
reported as is.

## 4 · Impacted re-run — at most ONE widened pass per heal round
1. `lite rerun-select --run-file {rf}` → `rerun[]` (stale ∪ expanded ∪ no-verdict), `byStage`, `impactLevel`. `Re-run not needed` ⇒ step 5. A change to a shared POM /
   fixture / helper / config widens the set by itself; `app_bug` failures are re-run only if stale.
2. `lite checkpoint-a … --files {the changed files}` (refresh; a FAIL is fixed first).
3. **Burn-in first** (only `timing` / `flaky` / `race` heals): `lite stage --run-file {rf} --stage {S} --run rerun --tcs {healed} --burn-in {healed}` (×3). A burn-in
   failure is healed now (round 2), not discovered by the widened pass.
4. **One widened pass:** per stage in `byStage`, `lite stage --run-file {rf} --stage {S} --run rerun --tcs {byStage[S] minus the burned-in TCs}`. The smoke gate applies
   again if smoke TCs are in the set. Still failing and healable ⇒ round 2 (steps 1-4). Maximum 2 rounds per phase.
   **A fix that invalidates an earlier attempt's evidence** (ledger labels, a silent wait) — never delete it: after the fix's Checkpoint A PASS re-run **every TC of
   that attempt in one command** of the same stage, then record the supersession in stage 4. A smaller re-run cannot supersede it.
5. **Teardown once:** `lite teardown --run-file {rf} --spec {teardown spec}` (stage 1's journey; it lists the journey in the run file) after the last stage / re-run of the phase. `FAIL` ⇒ fix the
   journey and run it again; what stayed changed goes under Deviations.

Done when every TC has a verdict or a NOT_RUN reason, no stale result remains and teardown ran. Next: stage 4.
