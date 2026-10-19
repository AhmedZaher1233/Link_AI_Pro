# Changelog

All notable changes to the Link_AI_Pro skill suite. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); consumer projects pick a change up on
their next `/sync-skills`, so every entry under *Unreleased* is a release once it is pushed to `main`.

## [Unreleased]

### Skill 5 1.1.0, skill 1: five defects found in the skill 5 review fixed at the root

Each fix has a regression test that fails on the old code and passes on the new.

- **link-qc-5-test-run-automation** — `metadata.version: "1.1.0"` (MINOR: new payload fields, new harness).
  - `run-stage.mjs`: Playwright wipes its outputDir before every command, and every command shared
    `artifacts/test-output/` — the next group, the isolation check or the next stage deleted the traces and failure
    screenshots the heal still needed (and `failures[].screenshot` pointed at deleted files). Every command now gets
    its own `artifacts/test-output/phase-{N}/{stage}-{group}[-attempt{n}]/` (payload `groups[].outputDir`; the
    attempt number also counts these folders, so none is reused); `pruneOutput` removes earlier phases' folders and the
    old flat layout at each call and keeps the phase's newest 100 (`output_pruned[]`, a warning when this phase is
    trimmed); `--extra last-failed` gets the previous command's `.last-run.json` seeded (Playwright reads it before
    wiping). `selftest-run-stage.mjs` case 22; the fake Playwright now wipes its outputDir and writes per-test
    failure files and `.last-run.json` like the real one. Docs: run-report.md §3, results-and-evidence.md, INPUT.txt,
    the config template's `PW_OUTPUT_DIR` comment.
  - Heal Log: execution.md's timeout calibration said "column 7 = the evidence path", but column 7 is the
    Approved-requirement reference (automation-rules.md §5). It now names the columns: Reason = the evidence path,
    Approved-requirement reference `n/a — no expected value changed`. Every other Heal Log reference checked
    (run-report.md, structured-returns.md, the fixture report and run file, the timeouts template) — consistent.
  - Smoke-gate STOP: it needs `<bug_report_format>` and the report contract, which loaded only at Workflow rows 7-8,
    after the stop. Workflow row 5 now loads `final-run.md` + row 8's references only at a smoke-gate stop, and the STOP (and
    the honest stop after two smoke retries) says to load them; final-run.md's header notes that step 1 does not
    apply there. Normal runs load nothing earlier.
  - `scripts/selftest-references.mjs` (new, 3 cases): Heal Log columns cited by name and matching §5, the smoke-gate
    STOP's needs loaded by the stopping activity, the block index against the blocks.
  - Token cost: the wording added for these fixes is offset by trims in the passages it touched (duplicated label,
    slicing and "read my comments" wording, a shorter SKILL.md intro): SKILL.md 13.7 → 13.6 KB; a full run's
    mandatory loads 265,195 → 265,194 B (net ≈ −3 tokens).
- **link-qc-1-generate-update-testing-structure** — `sync-qa-skills.mjs`: a repeated `--only` kept only the last
  skill (`parseArgs` keeps the last value; its shape is mirrored in skill 5's scan-lib, so it stays) — `only` now
  comes from `lib.mjs` `argValues()` (every repeated value, a comma list too; a single `--only` unchanged); the
  `summary` keyed `MISSING-IN-SOURCE` as `missing_in-source` (only the first dash replaced) — now `syncSummary()`
  (`missing_in_source`). `selftest.mjs` case 14; `references/skills-sync.md` (repeat `--only`, the summary keys).
- **Docs**: CLAUDE.md (run-stage outputDir, the references harness, sixteen harnesses, skill 1 case 14), README
  (version, harness list), skill 5 `INPUT.txt`.

### Skill 5 1.0.0: scratch investigation runner, skill versions in /sync-skills, lighter references

Skill 5 had no way to look at the live application during a heal without running a whole stage, no
version a consumer project could see, and references that re-explained standard Playwright and restated
the same rule in several files. It now has a probe runner that reuses the project's own Playwright, a
semantic version that `/sync-skills` reports, and about 18 % less instruction text over a full run with
every gate kept.

- **link-qc-5-test-run-automation** — `metadata.version: "1.0.0"` (first versioned release).
  - `scripts/scratch.mjs` (new): `run` executes ONE probe from `{automation_root}/test-results/qa-scratch/`
    with the consumer's own `@playwright/test` through a generated overlay `scratch.config.ts` over the shared
    config (1 worker, no retries, list + json reporter, trace + screenshot on, no globalSetup, one project);
    run-stage variables removed; refuses a probe outside the folder or one with `captureEvidence`, its own
    screenshot, `storageState`, file writes, `process.env`, a printed credential or a TC id, and refuses while
    a stage's progress file is fresh; credential filtering, a write outside `test-results/` → `violation`;
    payload `kind: investigation`, `officialResult: false`. `clean` removes the folder. Checked by hand against
    a real `@playwright/test` 1.63 (overlay loads, project globalSetup / reporter skipped, a browser probe runs).
  - `scripts/selftest-scratch.mjs` + `fixtures/scratch/` (new, 13 cases) — refusals, overlay, environment,
    secrets, payload, timeout kill, write guard, clean, and the probe being invisible to
    `validate-automation.mjs`, `impact.mjs` and `config-inventory.mjs`.
  - `references/scratch-investigation.md` (new, `<scratch_investigation>`): when (source + trace cannot
    decide), how, and the limits; loaded only at an AMBIGUOUS selector or an unexplained failure. Wired into
    `<selector_resolution>`, `<first_run>` step 3, the run-stage rule of SKILL.md, `allowed-tools`, and
    Checkpoint B / `<quality_checklist>` through new compliance item 50 (no probe left or cited).
  - Token optimization (no gate removed; every `<tag>`, § and step number kept): generic Playwright
    explanations removed; one home per rule with pointers elsewhere — compliance-checkpoints old §3 / §4
    became pointers to §3a / §4a, `<quality_checklist>` one line per check naming its home, validator.md no
    longer mirrors `RULES` / `LIMITS` (the payload carries them), execution.md no longer narrates
    `run-stage.mjs` internals, final-run.md field lists instead of JSON examples, run-report.md renderer
    internals shortened. SKILL.md 15.3 → 13.7 KB; SKILL.md + mandatory references over a full run 322 → 265 KB
    (≈ 79.7k → 65.7k tokens, chars ÷ 4). Pointer fixes: final-run "§6" → §7 (run-file schema), "§4" → §4a,
    intake's broken troubleshooting link and the no-op legacy-heading note (`(skill 6)` → `(skill 5)`),
    execution's "readiness gate second" → third.
- **link-qc-1-generate-update-testing-structure** — skill versions: `lib.mjs` `skillVersion` (front-matter
  `metadata.version`), `compareSemver`, `versionStatus`, `scanSuite().versions`; `sync-qa-skills.mjs` reports
  `versions[]` (installed / source / status; `installedAfter` on `--apply`, `installedBefore` across a self
  re-run); `validate-setup.mjs` lists installed versions in `QA Skills` and WARNs `Skills current` when one is
  behind; `selftest.mjs` case 13; `references/skills-sync.md`, `validation-contract.md`, `output-format.md`.
- **commands/sync-skills.md** — the report table gains the version column and the outdated-skills line.
- **Docs**: CLAUDE.md (layout, skill versions and bump rule, scratch runner, validator wording, fifteen
  harnesses), README (skill 5: references, scratch investigation, version; Keeping projects up to date:
  versions; Contributing: bump rule; harness list), skill 5 `INPUT.txt`.

### Skill 9: retest through the automation or playwright-cli, update the run report in place, attach evidence after the close

A retest replayed a bug's steps through the Playwright MCP and was not allowed to touch the run report, so a
fixed bug never changed a TC's status or the story's pass rate (user decisions, 2026-10-19: an automated TC is
re-run from skill 5's automation code; every other bug is retested through playwright-cli; the Playwright MCP
is no longer used by skill 9; the LATEST run-report phase is updated in place; the evidence is uploaded to the
Azure bug after it is closed or reopened).

- **link-qc-9-retesting**
  - `SKILL.md` / `INPUT.txt` rewritten: one route per bug (automation re-run · playwright-cli), the probe and
    the ONE combined ask cover only what the chosen routes need, the Azure order is state transition → read
    back → evidence upload → read back, the summary gains the route, the TC row before → after, the pass rate
    before → after and the page gate. `allowed-tools`: skill 5's `run-stage.mjs` / `impact.mjs` /
    `render-run-report.mjs`, the two `playwright-cli` forms, `mcp__azure-devops` and the two attachment tools;
    `mcp__playwright` removed.
  - New `references/automation-rerun.md`: route decision (`impact.mjs fingerprint` + the latest phase's run
    plan), runner readiness, one background `run-stage.mjs --run rerun` call per stage against
    `.runs/phase-N.json`, the verdict table (a test-code / environment / rate-limit failure is no verdict and
    goes to skill 5; skill 9 never edits automation code), evidence.
  - New `references/browser-cli.md`: the playwright-cli route adapted from 5b (full TC when it has a row in the
    latest phase, else the bug's own steps; sessions `qa9-…`, attended / secret-name login, step → command map,
    evidence under `retest-cli--{lang}--r1`, hygiene).
  - New `references/report-update.md`: the in-place update of the latest phase (Results rows, a
    `{Stage} (retest — skill 9)` row, Total, Outcome, Bugs table, Retest bullet, Deviations, header, run-history
    row), the matching `.runs/phase-N.json` edits (`retests[]` append-only), the bug report, and the render
    (dry run to gate PASS with no mismatch, then `--write`). Verified on skill 5's run-report fixture: gate PASS,
    no mismatches, pass count 2 → 3 of 5.
- **link-qc-7 / 8 / 9** — `references/qc-contract.md` (mirror, three identical hashes): §6 retest evidence name
  `BUG-{n}-{TC-ID}-phase-{N}-retest-{variant}-{file}` and the state-then-upload order; §7 rewritten (routes, no
  Playwright MCP, the in-place latest-phase rule replaces "no run JSON or historical phase edits").
- **link-qc-5-test-run-automation** — `references/run-report.md` §3 / §4 / §5 / §7, `results-and-evidence.md`
  and the `SKILL.md` history rule document the one exception: skill 9 updates the LATEST phase in place. No
  script, template or golden changed.
- **link-qc-5b-test-run-manual-cli** — `SKILL.md`, `references/run-report-manual.md` and `execution-rules.md`
  name the same exception.
- **link-qc-1-generate-update-testing-structure** — playwright-cli and the browser secrets file now serve skills
  3c, 5b and 9 (`preflight.mjs` warns when skill 9 is installed without the CLI; row texts in
  `validate-setup.mjs`, hints in `sync-qa-skills.mjs`, comments in `lib.mjs` and the secrets scripts,
  `SKILL.md`, `INPUT.txt`, `toolchain.md`, `mcp-setup.md`, `validation-contract.md`, `skills-sync.md`,
  `output-format.md`, `run-modes.md`, `testing-layout.md`).
- **link-qc-12-adhd-output-style** — the skill 9 row, grouping, timing and status example.
- **Docs**: README (layout line, pipeline box, `### 9 — retesting`, MCP table, playwright-cli scope, Azure loop
  line), CLAUDE.md (layout, secrets / `--tools` scope, skill 9 `allowed-tools` convention, a hard rule, the Azure
  loop MCP rule and the producer-documents exception).

### Skill 5: targeted re-run instead of the clean full re-run; parallelism that never changes a status

The final run re-ran every TC, so a 30-TC story ran at least twice, and side-by-side tests could turn a
correct TC red when the application rate-limits a service (user decisions, 2026-10-19: re-run only what a
fix touched; app-bug failures keep their first-run result; no storageState — every test keeps logging in
through the UI and login is paced instead; rate limits are detected and learned, never asked; the second
pass is called "re-run").

- **link-qc-5-test-run-automation**
  - New `scripts/impact.mjs` + `selftest-impact.mjs` + `fixtures/impact/` (a mini POM project): a per-TC
    code fingerprint (test call, hooks, spec / describe remainders, page-object members reached —
    class-aware, by-name fallback across the import closure, never a name guess —, closure-module
    remainders, re-exports, tsconfig `paths`, `timeouts.ts` per key, config / Playwright version / data
    files / setup journeys; `@run:` tags, comments, whitespace and a describe's `mode` never count;
    anything dynamic = always stale) and `select` (stale / fresh / no verdict / never run / shared-test
    closure / outside scope). Read-only and fail-safe.
  - `<second_run>` (`references/final-run.md`) is now the **re-run**: after the heal, only the stale TCs
    and the TCs without a verdict run again (`run-stage.mjs --run rerun`, healed TCs with `--burn-in`),
    their attempts merge into the same phase (latest attempt by start time wins), everything else keeps
    its first-run result, "Re-run not needed" when nothing changed; Checkpoint B gains the per-TC
    results-freshness check (`stale: []`) instead of "any result older than the last change → BLOCKED".
    Activity 7 is "Re-running Fixed & Impacted Tests"; stage labels "(first run)" / "(re-run)".
  - `run-stage.mjs`: `--run first|rerun` (`final` refused with a hint); attempt numbers per command;
    `--burn-in` (workers 1, `--repeat-each=3`, ceiling × 3, any failing repeat = FAIL); the automatic
    **isolation check** (a FAIL beside other tests, or with a refused request inside its failing step, is
    re-run alone after a `Retry-After` cool-down — `--cooldown` / `--cooldown-max`; pass alone = parallel
    interference and the overlapping tests are re-checked alone; refused again = INCOMPLETE `rate_limited`;
    mass-failure breaker); refusals slow the rest of the stage (cool-down, half the workers, scaled
    ceiling); `run_plan_adjustments[]` applied; serial-chain followers NOT_RUN "depends on"; phase-wide
    cumulative counts and smoke gate (by start time, fail % over TCs with a verdict); per-call code
    fingerprints in every summary; `PW_RATE_LIMIT_FILE` / `PW_RATE_LIMIT_STATE` / `PW_RATE_LIMITS`.
    `selftest-run-stage.mjs` 13 → 21 cases; the fake Playwright nests describes, repeats, runs side by
    side and writes 429 records.
  - New assets `network-guard.template.ts` (records 429 / 503 + Retry-After and policy headers for the
    application's own origins; reserves start-of-test slots before any step opens) and
    `rate-limit.template.ts` (cross-worker sliding window from `PW_RATE_LIMITS`; `rateLimitSlot` for a
    mid-test call); `timeouts.template.ts` gains `rate_limit {max_start_wait, in_step_wait, cooldown,
    cooldown_max}`; the config template documents the new env vars and chain-only serial describes.
  - Run plan (`references/run-plan-and-config.md`): the guarantee "parallelism never changes a status";
    own-data TCs may run parallel; lockout TCs in an `account:{A-ID}` lane; `rate_limits[]`; serial
    describe only for a true chain. Prose in sync: SKILL.md, INPUT.txt, references `execution`,
    `code-generation`, `code-craft`, `compliance-checkpoints`, `structured-returns`, `run-report`,
    `automation-rules`, `azure-devops`, `intake`, `results-and-evidence`, `test-data-readiness`.
  - Renderer: `rate_limited` in the classification catalogue and the sort order; INCOMPLETE rows accept
    `rate_limited` / `interrupted: …` / `cleanup_incomplete` and the documented `interrupted:` /
    `not started:` reasons no longer warn; `selftest-run-report.mjs` case 32; goldens regenerated (sort
    order only).
- **link-qc-5b-test-run-manual-cli**: byte-identical copies of the renderer, its harness, the template and
  the run-report goldens; the manual-run golden regenerated (sort order only). No behaviour change.
- **link-qc-12-adhd-output-style**: re-run label and example, isolation-check line, "results of record".
- **Docs**: README (skill 5 parallelism and targeted re-run, harness list); CLAUDE.md (layout, scripts,
  impact.mjs, hard rules, keep-in-step list, fourteen harnesses).

### Skill 5: lighter instructions, stage-based progress, activity names

Skill 5 carried a 2,848-line `SKILL.md` (~56k tokens) on every turn and polled its test runs from
the model. It now loads ~14 KB up front, reads each activity's reference once, runs every stage as
one monitored script call, and reports once per finished stage with activity names (user decision,
2026-10-16). No rule, gate or checkpoint changed; the `## Phase N` run counter of the report is
unchanged.

- **link-qc-5-test-run-automation**
  - `SKILL.md` is now a ~180-line orchestrator: the role, the rules that hold in every activity,
    the workflow (activity · internal step · what · which reference to load), a block index, the
    scripts, modes and returns. Every block moved byte for byte into one reference per activity
    and kept its `<tag>`, so every pointer still resolves: `intake.md`, `results-and-evidence.md`,
    `azure-devops.md` (loaded only when `ADO-MAP.md` exists), `code-generation.md`,
    `run-plan-and-config.md`, `open-questions.md` (only when a TC was parked), `coverage.md`,
    `test-data-readiness.md` + `test-data-preparation.md` (the twelve principles, byte-identical
    with 3b / 3c / 5b — only when an item is missing), `execution.md`, `final-run.md`,
    `structured-returns.md` (end only). `<checkpoint_a>` / `<checkpoint_b>` moved verbatim into
    `compliance-checkpoints.md` §3a / §4a (one self-reference re-pointed). `run-report.md` now loads
    only at the final report. Each reference is loaded once.
  - Duplicates removed: `<source_of_truth>`, `<test_modifiers>`, `<wait_policy>` and the coverage
    "three numbers" section are short forms pointing to `automation-rules.md` §1-§4 / §6; the few
    sentences that existed only in SKILL.md moved there first.
  - Description cut from ~6,300 to ~800 characters, trigger phrases first (two added: "write
    Playwright automation for the user story", "execute the automated tests"); the old one was
    truncated in the skill listing before its triggers.
  - New `scripts/run-stage.mjs`: runs ONE stage (every run-plan group in plan order, one command per
    group from the project's `cli.js`, no shell), sets the `PW_*` environment and the next free
    `-attempt{n}`, builds ONE lookahead `--grep` with tag-end guards (the "do repeated `--grep` flags
    AND?" check is gone), refuses `--reporter` / `--config` / `--retries`, runs `watchdog.mjs` every
    few seconds on a stage-filtered group file, kills the process tree only on `FROZEN` — or past
    `PW_GLOBAL_TIMEOUT` + margin as a new outer-ceiling stop —, applies the freshness gate, writes a
    tailable progress log (line output, 30 s status lines, credential-looking lines withheld) and
    returns one compact payload + a stage summary with the ready, cumulative stage message.
    `selftest-run-stage.mjs` + `fixtures/run-stage/` (a fake Playwright that misbehaves on purpose):
    13 cases.
  - `<live_progress>` rewritten: one message at run start, one per finished stage (Smoke; Positive
    and Negative cumulative), immediate messages for a stop or blocker; nothing on a timer, per
    poll or per activity change; labels are activity names (Reviewing Requirements & Test Cases …
    Preparing Final Report, "first run" / "final run"), never "Phase N". `<staged_execution>`,
    `<first_run>` steps 0 / 1 / 4 and `<second_run>` step 1 run through the script; `artifacts/progress/`
    is emptied with `artifacts/stages/` at phase start. Structured returns: "Final run — Results",
    "Run number", "Activities completed"; two checklist items follow the new execution.
  - `watchdog.mjs`: a test covering several TCs that is in flight at a freeze is now reported
    interrupted for each TC (was "not started"); `--stop-reason` names a non-freeze stop in the
    reasons (the outer-ceiling kill). `selftest-watchdog.mjs` cases 11-12; golden unchanged.
  - `references/run-report.md` §3 (`*.plan.json`, `*.summary.json`, the watchdog file on a ceiling
    stop, the attempt rule), §4 (ceiling-stop reasons), §7 (`watchdog_events[].action`);
    `automation-rules.md`, `code-craft.md` §9, `INPUT.txt` (progress you see, artifacts, harness counts).
- **link-qc-12-adhd-output-style**: skill 5's progress is per stage with activity names (§E,
  `qa-pipeline.md` §2 opener, §4, examples).
- **link-qc-5b-test-run-manual-cli**: `run-plan.md` §3 no longer calls its per-TC line "skill 5's shape".
- **Docs**: README (skill 5 layout and progress, the runner, self-test list); CLAUDE.md (layout,
  scripts, the runner exception, keep-in-step locations, twelve-principles location, thirteen
  harnesses, the hard rule).

### Test runners (5, 5b) and live validators (3b, 3c) prepare missing test data instead of skipping

Shared, word for word in the four skills: the **twelve preparation principles** and the **consent
by way** table (discover before skipping in the order learning file → automation helpers → the
application's source code → UI journey → DB helper → manual; the skill prepares the item itself; a
UI journey needs no question, an existing helper runs under the run's data-changes "yes", an
endpoint read from the source code and a database write each need an explicit "yes" asked once
after discovery; temporary seed in the scratch folder, never new code in the repository;
dedicated, right-sized fixtures; verified on the oracle before use; system-stamped values read
back and routed to skill 3; the real rule checked, not just the screen; `NOT CREATABLE` with
evidence instead of "data missing"; a permission refusal stops the step; no secrets anywhere;
keep or clean up asked once after the run, default keep).

- **link-qc-5b-test-run-manual-cli**
  - Invariant 10 and workflow steps 6 / 6b / 11: missing data is prepared, not skipped; skips only
    as `data_missing` (no way found), `not creatable` (evidence) or `QC declined`.
  - New `references/test-data-preparation.md` (principles, inventory of record, the five statuses
    incl. `NOT CREATABLE`, the nine preparation steps, the two questions, readiness decisions,
    learning-file lines, worked example with four MISSING items and no "data missing" outcome).
  - `intake.md` §3 (consent and keep / clean-up rows), `execution-rules.md` §3-§5 and §7,
    `run-report-manual.md` (`Data preparation` Run bullet, the nine-column readiness table, the
    stamped-value Deviation shape, `data_readiness` now written to the run file), `run-plan.md`,
    `learning-file.md` (prepared fixtures, not-creatable evidence, consent answers),
    `ai-response-rules.md`, `INPUT.txt`.
  - `self-review.md`: fourteen checks (no `data_missing` where a way existed; every prepared item
    verified before its dependents; no seed left in the repository; no credential in any output);
    hard-check failures now consistently `app_bug`.
  - Harness: the manual-run fixture gains a `prepared (api)` item with a stamped value, a
    `skip — not creatable` TC and a stamped-value Deviation; golden regenerated;
    `selftest-manual-run.mjs` asserts the readiness counts.
- **link-qc-5-test-run-automation**
  - PHASE 2.6 rewritten: helpers found through the manifest paths and a generic search; the
    application's source code searched for create endpoints (skill 10's profile first); the QC
    asked only for an endpoint from the source / a DB write and for gaps with no way; UI journeys
    and existing helpers prepared without asking; non-interactive default prepares the automatic
    ways; temporary seed (kept as a fixture only on request); dedicated right-sized fixtures;
    seed-once kept; verify before use; stamped values propagated through the test-data layer;
    rule-level verification; `NOT CREATABLE` distinct from `IMPOSSIBLE`; refusals stop and ask;
    keep by default, clean-up asked once after the run; `data_readiness` keys aligned with the
    fixture (`gaps` / `predicted_skips`) plus `identifiers` / `stamped_values` / `verified_on`.
  - `references/run-report.md` §4 readiness row (nine columns, decision vocabulary, counted by the
    renderer) and §7 run-file shape; checklist items, the `data_missing` failure-table row, the
    learning-file line, the final-message block and summary row; `INPUT.txt`.
  - `scripts/render-run-report.mjs`: the readiness table's `Decision` column is parsed into
    per-phase counts (`document.phases[].readiness`), shown as a `Decisions:` line, legacy bare
    words still accepted, `unknown-readiness-decision` warning; a bare `all ready` body renders
    as the verdict. Fixture and golden updated; harness case 29. Mirrored to 5b.
- **link-qc-3c-validate-manual-test-cases-cli**
  - Invariant 18 rewritten to the consent model; workflow step 4b (consent ask), steps 8 / 9 / 11;
    READ-ONLY / COMPARISON lines; Permissions (temporary seed through the normal permission flow).
  - `references/test-data-resolution.md` rewritten: principles + consent table (`SHARED-3B-3C`
    blocks), `api` available through an existing helper or an endpoint in the source (pending the
    user's yes), the nine-step preparation run for every way, delivered statuses (kept → `READY`,
    removed → `MISSING` with a recreate note, `NOT CREATABLE` with evidence), one post-walk ask
    (keep / clean-up + undecided items), return lines, worked example with TEST-DATA rows and TC
    stamps.
  - `walk-rules.md` §3a / §6 / §6a, `discovery-plan.md`, `intake.md` §3, `patch-rules.md` §3 / §6
    / §7 / §8, `self-review.md` check 12, `cli-vs-mcp-comparison.md` (both runs switched off),
    `tc-format-contract.md` (stamp key `data`), `INPUT.txt`.
- **link-qc-3b-validate-manual-test-cases**
  - Full data-changes model (user decision, 2026-10-13): new invariants 16 (data changes) and 17
    (test data), `mcp-pass.md` §3a, the data-changes question in `intake.md` §3.
  - New `references/test-data-resolution.md` — 3c's file with the Playwright MCP wording in the
    tool sections and the `SHARED-3B-3C` blocks byte-identical; preparation only for items whose
    dependents are inside the chosen scope (`scope-gate.md` §1 item 8, §4); workflow steps 7c
    (consent ask), 8b (preparation), 9, 11; `patch-rules.md` §3 / §6 / §7 / §8 (`Data changes`
    and extended `Test data` return lines, `Data plan` audit line); `self-review.md` check 11;
    `tc-format-contract.md`; `INPUT.txt`.
- **Mirrored across 3 / 3b / 3c** (`validation-states.md`, `learning-file.md`, `html-page.md`):
  draft reasons `data missing — D{n}` / `data not creatable — D{n}`, the `data:` stamp key, the
  prepared-fixture and not-creatable learning lines, the fifth test-data status.
- **link-qc-3-generate-manual-test-cases** (shared renderer and TEST-DATA contract)
  - `scripts/render-tc-review.mjs`: `NOT CREATABLE` accepted as the fifth TEST-DATA status,
    counted (`counts.testData.notCreatable`), badged `d-not-creatable`; the data header note shows
    five counts (EN + AR); sample fixture gains a `NOT CREATABLE` item and a Problems row; goldens
    regenerated; harness case 29 (31 cases incl. 0 and 27). `assets/report-shell.template.html`
    gains the badge rule (mirrored five ways: 3, 3b, 3c, 5, 5b).
  - `references/deliverables.md` / `tc-design.md`: five status words, `NOT CREATABLE` never written
    by skill 3, "3b / 3c" as live checkers.
- **link-qc-12-adhd-output-style** overlay rows for 3b, 3c and 5b.
- **Docs**: README sections for 3b, 3c, 5 and 5b; CLAUDE.md (the principles as a hard rule, the
  3b/3c shared-block rule, reference and harness counts, the changelog convention in *Git*).
