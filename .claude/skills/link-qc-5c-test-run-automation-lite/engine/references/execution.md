# Running the tests — PHASE 3 (rules)

Loaded at **Running Smoke / Positive / Negative Tests**. Detail: `maintainers/execution.md`.

## PHASE 3 — FIRST RUN (IMPROVE)

<environment_gate>
Gates, in order: 1) `<checkpoint_a>` recorded — only the scope whose checks passed executes; BLOCKED tests isolated, reported against the original scope. 2) PHASE 2.5 `PASS` / `report-only` / user override. 3) PHASE 2.6 `READY` / `READY-WITH-SKIPS`.

Grep `Testing/project-learning.md` for `[type: env]` first. Then ONE preflight call — never a process listing, memory probe or URL check of your own — at the END of intake (before any code) AND before the first run:
```text
node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs preflight --run-file {run_file} --env-id {env_id} --probe-url {url}
```
No `--cwd` (paths resolve against the automation root derived from the run file). `verdict`:
- `blocked`, environment unreachable / 5xx → **ENVIRONMENT_BLOCKED** (name the dependency; ops action, not a code defect).
- `blocked`, `reason` starts `config location` (the shared config, `testDir`, `outputDir`, a reporter output path or `PW_SCREENSHOTS_ROOT` is OUTSIDE the automation root) → ONE question offering `node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs reconcile --root {project} --results-root {results_root} --apply --move-config`; nothing is generated before it is answered.
- other `blocked` (no Playwright CLI, no safe coordination, insufficient capacity, lease held) → BLOCKED; never execute.
- `restricted` runs; its reasons go into the run-start message.
Facts learned → `[type: env]` lines under `## Automation Tricks`. Browser visible by default; no desktop / CI → headless, said in chat + Deviations. Confirm first: `screenshot: 'only-on-failure'`, `trace: 'retain-on-failure'`, `helpers/progress-reporter.ts`, `helpers/steps.ts`, the evidence helper (`<result_organization>`). `0xC0000142` = `environment_failure`, never an app / test defect.
</environment_gate>

<capacity_and_lease>
Enforced by `run-stage.mjs`, never by you: every command reserves its `--workers` in the machine-wide capacity ledger (`capacity.mjs`) under the AUTO ceiling (`<run_plan>`; lowered, never raised). No admission within `--max-wait` (10 min) → `NOT_RUN` `not started: admission timeout ({reason})` / `not started: host pressure`. Low memory never forces execution or disables coordination (BLOCKED `insufficient capacity`, or a wait). The lease (`--env-id`) is exclusive per OVERLAPPING environment; not held → every TC `NOT_RUN` `not started: environment lease ({reason})`, `BLOCKED`. No safe coordination → `BLOCKED`. A required TC `NOT_RUN` for any of these → NOT ACCEPTED.
</capacity_and_lease>

<live_progress>
One message per finished stage, never on a timer; the live view is the summary log (`<automation_logs>`). Exactly these (labels: `SKILL.md` *Progress and messages*; the report keeps `## Phase {N}`): 1. **Run start** (same turn as the first stage): counts per stage, readiness line, preflight line (ceiling, `workers.start`, headed or why not, lease), initial timeouts, summary-log then progress-log paths, the fresh-session line when it applies. 2. **After Smoke**: the payload's `update` (+ gate decision when `classify`). 3. **After Positive**: `update` + "Phase so far". 4. **After Negative**: `update` + "Phase totals", defects, blockers, compliance status. 5. **At once** on a stop, freshness failure, ENVIRONMENT_BLOCKED or smoke-gate stop: reason + every NOT_RUN / INCOMPLETE TC. 6. A question the workflow asks. 7. The return. Nothing else; retries and isolation checks report inside their stage's message; re-run stages are labelled "re-run". The script writes the progress log (machine lines, never read by the model) and the summary log; every activity transition and gate verdict: `node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs activity --log {progress_log} --text "{activity name}"`, never by hand.

Every test command goes through `run-stage.mjs`; the model never reads a script's source (conventions: `references/schemas/README.md`).
- ONE call per stage (`setup` · `smoke` · `positive` · `negative`; `--run first | rerun`), DELEGATED: a fresh subagent gets the run-file path + ONE command (background; wait for the completion notice, never poll) and returns a ≤ 6-line verdict; the main thread keeps code, heals, classifications, questions, the return.
  ```text
  node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs --run-file {run_file} --stage {stage} --run first|rerun --stage-tcs {this stage's TCs} --ceilings auto --timeouts {timeout_policy} --log {progress_log} --project {browser_project}[,{backend_project}] --spec {spec files} --env-id {env_id} --units {parallel_plan} [--groups …] [--tcs …] [--burn-in auto|TC-…] [--extra …] [--cooldown …] [--cooldown-max …] [--label …] [--headless] [--cmd …]
  ```
  One plain `node` call: no `cd`, pipe, env prefix, `--pretty` or `--cwd`; the script passes the shared config (`--config`), never you; `--reporter` / `--config` / `--retries` are refused; `--headless` only on the user's request.
- Serial: readiness `candidateConcurrency` 1 (or the user lowered workers to 1) → ONE `playwright test` process per run-plan group, `--workers=1`; Workers line `serial — readiness: candidate concurrency 1 — one process per group`; per-TC processes only for units side by side or an isolation check.
- Watchdog (script): a stop only on a `watchdog.mjs` `FROZEN` verdict (`STOPPED_FROZEN`) or past ceiling + margin (`STOPPED_CEILING`); completed TCs keep their status, interrupted = `INCOMPLETE`, not started = `NOT_RUN`, run again ONCE; event `timeout_failure`, never `app_bug`.
- Isolation check (script, every call) — a classification step, not a retry (`retries` 0): a FAIL beside other tests, or throttled, runs alone (beyond `--max-wait` → `NOT_RUN` `not started: deferred until {T}`). Alone PASS → **PASS, parallel interference** (Deviation, `parallel_checks[]`, `@run:` move, `[type: env]` line); cause from evidence (`test_data_conflict` · `possible_product_concurrency_defect` · `environment` · `unexplained`); you set `parallel_checks[].resolution` (`test-side: {evidence}` | `bug: BUG-{n}`); unresolved concurrency / unexplained → NOT ACCEPTED. Refused again → **`rate_limited`**: `INCOMPLETE`, never FAIL / bug / heal, re-run set; limits learned as `[type: env]` lines, never code.
- Freshness gate after EVERY command: stage JSON newer than the command start, else `FRESHNESS_FAILED` → STOP, fix the reporting, run the stage again; never build results from the line output. "No tests found" → `NOT_RUN` "no test matched the stage filter".
</live_progress>

<staged_execution>
Order: 0) Setup → 1) Smoke → gate → 2) Positive → 3) Negative, each ONE `run-stage.mjs` call, each a barrier. A TC runs once per stage pass; further executions only as isolation check, smoke retry, re-run or burn-in — each a new attempt.
Stage 0 (only with PHASE 2.6 `setup_groups`): `--stage setup` runs each setup spec alone, serially; a failed journey = `data_missing` for its `serial:{gap}` group → those TCs `SKIP`, never counted against the smoke gate; in the re-run it runs first (`--groups setup:{gap}`).
1. **Smoke** — `--stage smoke`, `@smoke` only; post its message.
2. **Smoke gate** — phase-wide, after the isolation check: `fail% = failed / eligible`, eligible = smoke TCs whose latest attempt is PASS or FAIL (SKIP, `rate_limited`, interrupted, deferred, NOT_RUN carry no verdict). `smokeGate.decision`: `continue` ≤ 30 %, `classify` above, `no_verdict` when none eligible.
   - **NO VERDICT** → positive / negative never start. Interactive: ONE question — fix + smoke retry, or stop. Pipeline: stop as below, Outcome `INCOMPLETE — smoke gate NO VERDICT`.
   - **≤ 30 %** → positive.
   - **> 30 %** → classify EVERY smoke failure first (`<first_run>` step 2); `unverified_assumption` failures are EXCLUDED from the majority.
     - **Majority automation / env** (`selector_failure` + `assertion_failure` + `environment_failure` + `timeout_failure` + `rate_limited` outnumber `app_bug`) → heal, then a **smoke retry** of the stale + failed smoke TCs (`--run first --stage smoke --tcs {…} --label "smoke retry"`). Max **2 smoke retry cycles**, each a heal iteration; still failing → stop as below.
     - **Majority `app_bug`** → **STOP THE RUN**: no positive / negative stage. Go to Preparing Final Report — load `final-run.md` (`<second_run>` steps 2-4, `<bug_report_format>`), `run-report.md` and `structured-returns.md` now — and still complete `{run_file}` (`status: stopped-smoke-gate`), the phase section (`**Outcome:** SMOKE GATE FAILED`), every smoke failure in `{bug_report_md}`, every positive / negative TC `NOT_RUN` `smoke gate failed (application errors)` and the render — all through `run-data.mjs finalize` (`<publication>`), never by hand. A STOP in the re-run: `<second_run>` step 1.6.
3. **Positive** — `--stage positive`: `@positive`, `--grep-invert "@smoke"`; cumulative message.
4. **Negative** — `--stage negative`: `@negative`, `--grep-invert "@smoke"`; cumulative message.
5. Merge + report = `run-data.mjs finalize` (`<second_run>` steps 2-4); every planned stage needs a fresh stage JSON or a "stage not run" marker.
</staged_execution>

<first_run>
0. Initialize per `<result_organization>` and `<automation_logs>` (roots resolved ONCE; next phase N). Write `{run_file}.run_plan` and `{run_file}.timeouts.initial` (every `timeouts.ts` value, `playwright_version`); post both in message 1.
1. Run every stage through `run-stage.mjs --run first` (`<staged_execution>`).
2. **Classify every failure:** `selector_failure` · `assertion_failure` (→ SELF-HEAL) · `app_bug` (test correct, app violates the approved TC → DO NOT TOUCH THE TEST, bug list) · `api_contract_failure` / `db_assertion_failure` (backend `app_bug`; helper refusals never bugs) · `environment_failure` (→ ENVIRONMENT_BLOCKED) · `data_missing` (`READY` in 2.6 → environment regression; a recorded skip decision → `SKIP`) · `timeout_failure` (→ 2b; no retry absorbs a timeout) · `evidence_failure` (PASS image of a post-cleanup screen → move `captureEvidence` to the assertion point; never `app_bug`) · `unverified_assumption` (never heal into passing, **NEVER reclassify as `app_bug`**; re-ask; unanswered → report as-is) · `rate_limited` (isolation check only → `INCOMPLETE`, never FAIL / bug / heal).
2b. **Timeout calibration — once, from evidence:** the trace shows the operation completing legitimately after the deadline → raise the named key (`test.long`, `step.long`, `operations.{name}`) in `timeouts.ts` — never inline — recorded `{key, from, to, reason, evidence}` in `{run_file}.timeouts.adjusted[]` and in the Heal Log (category `timeout_failure`; Reason = the evidence path; Approved-requirement reference `n/a — no expected value changed`); **NOT_RUN** when no first run happened.
3. **Self-heal ONLY test-code defects** (`selector_failure`, `assertion_failure`, `evidence_failure`): diagnose from trace and source (undecidable → one `<scratch_investigation>` probe); fixes in page objects / spec waits; a locator repair preserves the intended element; an expected-value change needs an approved REQ / AC / TC id, else `unresolved`. NEVER: lower / broaden an assertion · add a skip · suppress an error · change an application setting · edit product code.
4. No separate heal-check call: the re-run burn-in confirms heals (`<second_run>` step 1). Max **2 heal iterations per phase, smoke retries included**.
5. **Heal Log** — one row per repair, the nine columns of `automation-rules.md` §5 (`n/a` with a reason is a value, a blank is not) plus `cause_class`: `timing` / `flaky` / `race` (burn-in in the re-run) or `deterministic` (wrong locator, text or branch — runs once).
6. Every reusable heal → one tagged line under `## Automation Tricks` in `Testing/project-learning.md`; `app_bug` findings never go there.
</first_run>
