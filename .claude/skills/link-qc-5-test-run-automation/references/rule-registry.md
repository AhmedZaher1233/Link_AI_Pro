# Rule registry — one home per rule

Maintainers' map, not loaded by any activity: every rule this skill enforces has exactly ONE home (the file
and block, or section, that states it in full); every other mention is a pointer to that home. `Enforced by`
names what checks the rule mechanically — a validator rule id, a compliance checklist item
(`compliance-checkpoints.md` §2) or a script — and `—` when only semantic review does. `Needed at` names the
Workflow activities (`SKILL.md` rows) that must have the home loaded; `all` means `SKILL.md` itself states it.
`scripts/selftest-references.mjs` case 4 fails when a home is missing or doubled, a pointer dangles, an
enforcement id vanished or an activity needs a home it has not loaded. When you move or reword a rule, edit its
home and this row in the same change.

| ID | Rule | Home | Enforced by | Needed at |
|---|---|---|---|---|
| R01 | One document gate: `APPROVED` proceeds, anything else gets ONE question | `intake.md` `<input_gate>` | — | 1 |
| R02 | Azure DevOps is never a gate (`ado_mode` detected, never asked) | `intake.md` `<input_gate>` | — | 1 |
| R03 | The environment lease is acquired at intake before any readiness probe and released at close-out | `intake.md` `<input_gate>` | `capacity.mjs` | 1 |
| R04 | Resolved roots, the phase number and the profile are fixed once per run | `intake.md` `<project_profile>` | — | 1 |
| R05 | Learning file first — grep before any question; every answer written back | `intake.md` `<project_learning_file>` | — | 1 |
| R06 | Evidence at the assertion point, immutable screenshots and history | `results-and-evidence.md` `<result_organization>` | item 14 · item 15 · item 16a · item 16b · `evidence-missing` · `evidence-in-hook` | 1 |
| R07 | Only an approved requirement or clarification defines an expected result | `code-generation.md` `<source_of_truth>` | item 11 · item 12 | 2 |
| R08 | Page Object Model is mandatory; no locator or screen helper in a spec | `code-generation.md` `<pom_mandatory>` | `pom-raw-locator` · `pom-chained-locator` · `pom-spec-helper` · item 1 · item 2 · item 4 | 2 |
| R09 | The automation inventory decides every page object before it is written | `code-generation.md` `<automation_inventory>` | `pom-duplicate-page` · item 5 | 2 |
| R10 | Every modifier carries a traceable reason; `only` never committed | `code-generation.md` `<test_modifiers>` | `focus-only` · `modifier-no-reason` · item 20 · item 21 | 2 |
| R11 | Waits are observable and bounded; never `networkidle` | `code-generation.md` `<wait_policy>` | `wait-network-idle` · `wait-for-timeout` · item 24 · item 42 | 2 |
| R12 | The run plan: parallel by default, serial only with a reason, `mode: 'serial'` only around a true chain | `run-plan-and-config.md` `<run_plan>` | item 25a | 2 |
| R13 | The parallel readiness check every run; dispatch only on a fresh OK payload with the ledger, else serial; the ramp sizes workers; the shadow comparison opt-in (`--parallel-shadow`) | `run-plan-and-config.md` `<parallel_readiness>` | `parallel-plan.mjs` | 2 |
| R14 | ONE shared Playwright config; consolidation only through `deletable[]` | `run-plan-and-config.md` `<shared_config>` | item 44 · `config-inventory.mjs` | 2 |
| R38 | The run protections are reconciled before Checkpoint A: supported settings fixed with a backup, conflicts reported, never overwritten | `run-plan-and-config.md` `<shared_config>` | `config-inventory.mjs` · item 43 | 2 |
| R15 | Every timeout from `timeouts.ts`; finite, fixed deadlines; the active silence rule on meaningful progress; exceptions only as named `operations` | `code-craft.md` §9 | `timeout-literal` · item 43 | 2 |
| R16 | Side-effecting fixtures and `beforeAll` honour the admission contract | `code-craft.md` §6 | `admission-contract` · item 25a | 2 |
| R17 | Console and network guards attached in every spec; the guard's report is the teardown marker | `code-craft.md` §11 | `console-guard-missing` · `network-guard-missing` · item 46a · item 46b · item 49 | 2 |
| R18 | Constants have one source of truth | `code-generation.md` `<pom_mandatory>` | `constant-redeclared` · item 6 | 2 |
| R37 | A repair never weakens an assertion or suppresses an error; every repair is a Heal Log row | `automation-rules.md` §5 | `empty-catch` · item 13 · item 28 | 2 |
| R19 | Open questions: evidence-backed options, ONE ask, unanswered → tagged assumption | `open-questions.md` `<open_questions>` | — | 2b |
| R20 | A scratch probe is never a result, evidence, re-run or freshness proof | `scratch-investigation.md` `<scratch_investigation>` | item 50 · `scratch.mjs` | 2 |
| R21 | Never PASS a check that did not run; the result protocol and the gate records | `compliance-checkpoints.md` §1 | `check.mjs` | 3 |
| R22 | Checkpoint A before anything executes | `compliance-checkpoints.md` `<checkpoint_a>` | `check.mjs` | 3 |
| R23 | Static coverage: three figures separate; the gate before the run | `coverage.md` `<coverage_measurement>` | `coverage.mjs` · item 31 · item 33 · item 34 | 3 |
| R24 | Missing test data is prepared, not skipped — the twelve principles | `test-data-readiness.md` `<data_readiness>` | — | 4 |
| R25 | Every Playwright command through `run-stage.mjs`, one call and one message per stage | `execution.md` `<live_progress>` | `run-stage.mjs` · item 48a | 5 |
| R26 | The Auto machine ceiling, the capacity ledger, host pressure and the lease are enforced by the runner | `execution.md` `<capacity_and_lease>` | `run-stage.mjs` · `capacity.mjs` · item 25b | 5 |
| R27 | Parallelism never changes a status: the isolation check; the first failure kept with its cause | `execution.md` `<live_progress>` | `run-stage.mjs` | 5 |
| R28 | Smoke → gate → positive → negative; the smoke gate over PASS + FAIL; NO VERDICT stops | `execution.md` `<staged_execution>` | `run-stage.mjs` | 5 |
| R29 | Failures classified; only test-code defects healed, ≤ 2 iterations per phase incl. smoke retries | `execution.md` `<first_run>` | — | 6 |
| R30 | Re-run only what a fix touched; healed TCs as burn-in | `final-run.md` `<second_run>` | `impact.mjs` | 7 |
| R31 | Checkpoint B on the frozen final code and drafts | `compliance-checkpoints.md` `<checkpoint_b>` | `check.mjs` · `run-data.mjs` · item 18 · item 48b | 7 |
| R32 | Drafts → freeze → Checkpoint B → publish byte for byte | `final-run.md` `<publication>` | `run-data.mjs` | 8 |
| R33 | The report page is rendered, never hand-written | `run-report.md` §1 | `render-run-report.mjs` | 8 |
| R34 | Run-level acceptance decides `AUTOMATION COMPLETE` | `structured-returns.md` `<run_acceptance>` | `run-data.mjs` | 8 |
| R35 | Bug entries in the plain-sentence shape, resolved only after a passing retest | `final-run.md` `<bug_report_format>` | — | 8 |
| R36 | No secrets anywhere | `SKILL.md` | `hardcoded-credential` · item 38 | all |
