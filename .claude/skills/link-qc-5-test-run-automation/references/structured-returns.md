# The structured returns and the final quality checklist

Loaded by `SKILL.md` at **Preparing Final Report**, before writing any return: work
`<quality_checklist>` first, then write exactly one of the returns.

<structured_returns>

## AUTOMATION COMPLETE

**Precondition — not negotiable** (SKILL.md *Returns*): both checkpoints PASS for the final delivered
scope at the current `scopeDigest`, no applicable check `unresolved`, no reported result stale —
otherwise return **`## BLOCKED`** with the gate record, however green the run. A passing suite is not a
passed gate.

**Feature:** {name} · **User Story:** {ID — title}
**TC document (automation source):** {path} · Status {APPROVED | APPROVED — set this run on the user's instruction | {value} — run without approval (user decision, {date})}
**Environment:** {env} · **Run command:** {exact command}

### Azure DevOps linkage
**Mode:** {`linked` | `local`}

*Under `linked`:*
**Beautified document (published by skill 4):** {path} · source revision `{sha short}` — matches the approved document
**ADO-MAP.md:** {N} rows / {N} TCs · spot-check `[{TC-ID}]` → work item {id}, Tested-By linked — OK
{Needs human review notes carried from the beautified document: {TC-IDs} — or "None"}

*Under `local`:* `local — not published to Azure DevOps ({reason: never published | ADO-MAP.md
older than the approved document | ADO not reachable}); the Azure DevOps close-out was skipped. Publishing is the
separate skill 4 and is not required for this run.`

### Placement Manifest
{File · Path · Registered · Status table — includes the shared playwright.config.ts (updated / consolidated / created), timeouts.ts, helpers/evidence.ts, helpers/steps.ts, helpers/progress-reporter.ts, helpers/console-guard.ts, helpers/network-guard.ts, helpers/rate-limit.ts, helpers/test-data.ts, .gitignore, and every config removed as `removed (consolidated from …)`}

### Automation inventory
**Scanned:** the whole `{automation_root}` — {N} page classes in {N} files (validator `pageScan`) · **File:** `{reports_folder}/automation-inventory.md`
| Screen | Decision | Class | Candidates considered | Reason |
|---|---|---|---|---|
{one row per screen the TCs touch — `reuse {class}` / `extend {class} (+methods)` / `create {class}`; every candidate the matching surfaced, accepted or rejected with the reason}
**Validator:** `pom-duplicate-page-decided` {n} · **open `pom-duplicate-page`: 0** (anything else is a Checkpoint A failure) · **Learning lines written:** {n}

### Configuration
**Shared config:** {path} — {updated in place | consolidated from N files | created from the template} · **Chrome channel:** {yes} · **Workers:** 2 (serial groups 1) · **Playwright:** {version} ({feature gates: tags object · --last-failed · native step timeout — each yes/no})
**Configurations not merged:** {file — blocking setting — kept because …} — or "none"
**References rewritten:** {package.json scripts · CI files · docs — counts} · **Removed:** {files, each only after config-inventory listed it under deletable[]} — or "none"

### Run plan
| Group | Mode | Workers | TCs | Reason |
|-------|------|---------|-----|--------|
{one row per group; `parallel` first; every serial group's reason names the shared data and the `--workers 1` override; `account:{A-ID}` lanes last in their stage}
**Decisions:** {N field-driven} · {N inferred} · {N fail-safe serial}
**Rate limits planned:** {service — limit / window — pace — source, one per `rate_limits[]` entry — or "none known; detection only"}
**Adjustments during the run:** {n} (`run_plan_adjustments[]`: moves · rate-limit · workers) — or "none"
**Estimate:** serial-only ~{s} vs planned ~{s} → actual {s}
**Headed:** {yes | no — reason}
**Run plan file:** {run_file}.run_plan

### Timeout policy
| Key | Initial | After calibration | Reason / evidence |
|-----|---------|-------------------|-------------------|
{one row per `timeouts.ts` key: test.default · test.long · expect · action · navigation · hook · step.default · step.long · operations.* · watchdog_grace · rate_limit.max_start_wait · rate_limit.in_step_wait · rate_limit.cooldown · rate_limit.cooldown_max; "confirmed" when unchanged}
**First-run events:** {n} timeouts · {n} watchdog stops — {TC-ID · step · elapsed · expected · evidence path} — or "none"
**Adjustments:** {n} ({key from → to — reason — evidence}) — or "none; every value confirmed"
**Unresolved:** {a timeout whose cause the evidence does not settle — stays `timeout_failure`, never re-timed} — or "none"
**Probe:** {watchdog-probe PASS (step error named TC + step, failure image written, teardown completed, next test started after it, no orphan Chrome) | NOT_RUN — reason}
**Calibration status:** {done in this phase | NOT_RUN — no first run in this invocation}

### Open questions
**Raised:** {n} · **Answered by you:** {n} · **Reused from the learning file:** {n} · **Assumed (unverified):** {n} · **Unresolved (skip-guarded):** {n}
| # | Source | Ambiguity (exact wording) | TCs | Decision | By | Learning line written |
|---|--------|---------------------------|-----|----------|----|-----------------------|
{one row per question; By = you / learning / assumption}
**Unverified assumptions carried into the run:** {TC-IDs + the assumption — or "none"} — tagged `@unverified-assumption`, never counted as an application bug, never published as Passed
**Open-questions file:** {run_file}.open_questions

### Test-data readiness
**Verdict:** {READY | READY-WITH-SKIPS ({n} TCs)[ — {p} gaps prepared] | BLOCKED} · **QC asked:** {yes — {m} rows needed a yes in one message | no — every gap prepared automatically, ready or already decided in the learning file}
| # | Gap | Affected TCs | Status | Decision | Source | Provisioning | Identifiers / names | Effective stamped values | Verified on | Cleanup |
|---|-----|--------------|--------|----------|--------|--------------|---------------------|--------------------------|-------------|---------|
{one row per non-READY requirement; Decision = READY / prepared (api|ui|db) / skip — data_missing / skip — not creatable / skip — QC declined; Source = qc / learning / discovery / pipeline-default}
**Predicted skips carried into the run:** {TC-IDs + reason — or "none"}
**Setup groups run first:** {setup:{entity} → spec path — or "none"}
**Created data:** {n} fixtures — kept {n} (registered in `## Test Data`) · cleaned up on request {n} · left {n}
**Stamped values substituted:** {R{n}: field — TC literal → system value, routed to skill 3 — or "none"}
**Readiness file:** {run_file}.data_readiness

### Screenshots
**Folder:** {automation_root}/screenshots/{spec_level}{user_story_name}/phase-{N}/
**Written:** {N} assertion-point images · {N} failure images · across {N} variants / {N} attempts · **nothing overwritten or deleted** (earlier phases untouched)
**Evidence sanity check:** {N} PASS images verified against Expected Result · {N} `evidence_failure` healed
{TC-IDs without an image and why (NOT_RUN / SKIP)}
{Legacy flat `screenshots/{user_story_name}/` present: yes (left untouched) | no}

### Coverage
*Three separate figures — never merged:* **(1)** requirement outcome coverage · **(2)** TC
automation coverage (the gate) · **(3)** execution pass rate (in *Results of record*).

**(1) Requirement outcome coverage** — does each requirement's required outcome get asserted?
| Requirement ID | Requirement (short) | Outcome coverage | Asserted by | Note |
|---|---|---|---|---|
{Full / Partial / Missing / **Assumed**; `Assumed` = covered only by an `@unverified-assumption` test.
Linked-but-not-asserted is `Partial`, never `Full`. IDs validated against {REQ file / approved doc /
ADO-MAP}; unresolvable IDs listed here, never invented.}
**Totals:** Full {n} · Partial {n} · Missing {n} · Assumed {n} of {N} requirements

**(2) TC automation coverage**
| TC-ID | Requirement ID(s) | Smoke | Automation candidate | Implementation | Static coverage | Status of record |
|-------|-------------------|-------|----------------------|----------------|-----------------|--------------|
{Implementation = `full` / `partial (human step: n)` / `manual — not automated` / `pending — not covered for this run`; Static coverage = Fully / Partially / Not Covered from the pre-run measurement; Status of record = PASS / FAIL / INCOMPLETE / SKIP / NOT_RUN / `PARTIAL — human step pending` — the latest attempt over the phase, fresh}

**Weighted static coverage (pre-run):** {x}% — target {t}% ({L3 | default}, {mechanism}) — **{PASS | user override | report-only}**
Smoke {x}% · Positive {x}% · Negative {x}% · Full {n} · Partial {n} · None {n} of {N}
**Δ vs previous measurement:** {±d} pts — improved {TC-IDs} · regressed {TC-IDs} · TCs added/removed {+a/−b} — or "no prior measurement"
**Repair pass:** {n} TCs strengthened → {before}% → {after}% — or "not needed"
**Manual-only scenarios:** {n} (High {h} · Medium {m} · Low {l}) → `{coverage_root}/manual-scenarios.csv`
**Coverage folder:** `{coverage_root}` — coverage-summary.csv · coverage-detail.csv · manual-scenarios.csv

### First run — Heal Log
{TC-ID · failure · classification · fix · result (the re-run / burn-in outcome) — or "First run fully green"}
**Smoke gate (first run):** {passed | healed-then-passed ({n} retry cycles) | FAILED-STOPPED} — fail% {x}% over {n} smoke TCs with a verdict

### Results of record (first run + re-run)

| Field | Value |
|---|---|
| User Story | US-{ID} — {title} |
| Run number | {N} (report section `## Phase {N}`) |
| Re-run | {n} TCs re-run ({i} impacted · {v} no verdict · {a} added) in {k} heal iteration(s), {b} burn-in — or "not needed — no code changed after the first run and every TC has a verdict"; outside scope: {specs — or "none"} |
| Results freshness | `impact.mjs select` on the final code: `stale: []` · {n} `fresh_by_member_only` reviewed — or the stale TCs reported `NOT_RUN` (`not started: code changed after its run`) |
| Isolation checks | {n} TCs failed beside other tests → {p} passed alone (parallel interference — moved out of the parallel group, Deviation each) · {c} confirmed · {r} `rate_limited` · {o} overlapping tests run alone — or "none needed"; breaker {not tripped \| tripped in {stage} — classified by hand} |
| Rate limits | {services paced (limit / window, pace)} · {n} refusals ({services}) · cool-downs {s} · workers adjusted {from → to in stage} · learned: {limits written back as `[type: env]`} — or "none seen" |
| Total TCs | {N} |
| Passed / Failed / Incomplete / Skipped / NOT_RUN / Partial | {n} / {n} / {n} / {n} / {n} / {n} (TC counts — each TC-ID once, its latest attempt over the phase; a PARTIAL TC is never in Passed; `rate_limited` TCs are in Incomplete) |
| Variants executed | {n} passed / {n} failed / {n} skipped over {N} required variants ({projects} × data variations); attempts {n} |
| Incomplete TCs | {TC-IDs with their missing variants — or "none"} (published to ADO as Inconclusive, never Passed) |
| Partial TCs | {TC-IDs with `human step: n` — or "none"} (`PARTIAL — human step pending`: Inconclusive in ADO, never `Automated`, no `automated_tc_sha256`) |
| Smoke | {n} TCs — gate: {passed \| healed-then-passed \| FAILED-STOPPED} (fail% {x}%) |
| Positive | {passed}/{total} |
| Negative | {passed}/{total} |
| Static coverage (pre-run) | {x}% weighted — target {t}% — {PASS \| user override \| report-only} |
| Coverage folder | {results_root}/coverage/ (3 CSVs, replaced); snapshot/delta in the run file |
| Test-data readiness (pre-run) | {READY \| READY-WITH-SKIPS ({n} TCs)} — {n} prepared ({api}/{ui}/{db}), {n} manual, {n} skipped ({data_missing}/{not creatable}/{QC declined}), {n} stamped values substituted |
| Total execution time | {hh:mm:ss} |
| Planned vs actual duration | ~{planned} vs {actual} (serial-only would be ~{serial}) |
| Headed / workers | {yes \| no} / parallel ×{N}, serial ×1 — shared playwright.config.ts, Chrome |
| Timeouts | test {s} · step {s} · action {s} · navigation {s} · expect {s} — {n} calibrated, {n} watchdog events (Timeout policy section) |
| Screenshots | {screenshots_root}/phase-{N}/ — {N} images across {N} variants / {N} attempts (immutable) |
| Result folder | {results_root} = {automation_root}/reports/{spec_level}{user_story_name}/ |
| Stage results | {results_root}/artifacts/stages/ — {N} stage files (first run, isolation, re-run, burn-in), each fresh for its command · merged: {run_file}.merged |
| Progress log | {logs_root}/run-progress-{stamp}.log |
| Run report | {run_report_md} — `## Phase {N}` appended · rendered {run_report_html} (renderer gate {PASS}, provenance verified) |
| Bug report | {bug_report_md} — {n} new · {n} retested · {n} resolved · {n} not checked this run |
| Run file | {run_file} |
| Earlier phases | {list with folder — nested and legacy — or "none"} |
| Overall status | {GREEN \| FAILURES \| SMOKE GATE FAILED \| ENVIRONMENT_BLOCKED} |

**App bugs found:** {N} — {BUG-ids · TC-IDs + one-line titles}

### DevOps close-out
{AutomationStatus updates + `automated_tc_sha256` written for {n} TCs (full coverage, PASS, Checkpoint B PASS — never a PARTIAL) + US comment link — or what failed; the other ADO-MAP.md columns untouched}

### Compliance gates
**Checkpoint A (pre-run):** {PASS | FAIL | BLOCKED} · **Checkpoint B (final code):** {PASS | FAIL | BLOCKED}
*Both must be PASS for the final delivered scope before automation compliance is claimed.*

| | Checkpoint A | Checkpoint B |
|---|---|---|
| Scope | {N tests · M page objects/fixtures/helpers/config} | {same, or the final scope after the re-run} + results freshness `stale: []` |
| Code state | `scopeDigest {sha}` · {N} files hashed · git {HEAD short} {clean \| +K uncommitted} *(git is context only)* | `scopeDigest {sha}` |
| Mechanical checks | validator `{gate}` — {v} violations · {w} warnings · {r} review · {n} notRun · {e} exceptions; {project tooling + result \| none configured} | {same, re-run on the final code} |
| Semantic review | {items reviewed} | {items reviewed, including files that passed A} |
| Findings | {ruleId} {file}:{line} — {one line}, or "None" | {…} |
| Repairs | {what changed} → {re-check run} → {result} | {…} |
| Open items | {item} — {verified-semantic: reasoning} | {…} |
| **Unresolved** | {check} — {why it could not be verified} — **each one keeps this gate BLOCKED** | {…} |
| N/A | {check} — {why this rule has NO SUBJECT in this scope} | {check} — {why} |

*`N/A` vs `Unresolved`: `compliance-checkpoints.md` §1 — a validator `notRun[]` or open `review[]` item is `Unresolved`.*

**Runtime artifacts** (images, run file, report markdown / HTML, logs) are verified at Checkpoint B only — at A they
were recorded `scheduled for Checkpoint B`, never PASS.
**Compliance vs execution:** {one line — e.g. "both gates PASS; 3 TCs failed on real application
defects" or "suite green; Checkpoint B BLOCKED on 2 unresolved review items"}.
{When code changed after a recorded run: which checks were refreshed, which TCs `impact.mjs`
named stale and were re-run (or reported `NOT_RUN — not started: code changed after its run`), and
the `fresh_by_member_only` review.}

### Deviations
{everything that differs from the approved document, with reasons — or "None"}

### Learning file
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}

---

## ENVIRONMENT_BLOCKED

**Reason:** {specific unhealthy service/dependency + evidence}
**Environment:** {env}
**Action required:** ops / human — not a code defect. Activities completed before the block: {list}

---

## BLOCKED

**Reason:** {unapproved TC doc — user chose *stop*, or pipeline run without `--approve` / `--unapproved` | missing User Story | ambiguous US name | missing profile key | unresolved test-data precondition (QC chose stop, or provisioning failed and no alternative accepted) | **compliance gate not PASS** (Checkpoint A or B `FAIL`/`BLOCKED`, an applicable check still `unresolved`, or a TC reported with a result is stale per `impact.mjs`)}
*(Never blocked for Azure DevOps: a missing or stale ADO-MAP.md, an unpublished story, or an
ADO auth failure all degrade to `ado_mode = local` and the run continues. Never blocked for an
ambiguous TC step or an unresolved element either: those are raised as open questions
and, unanswered, become tagged assumptions or skip-guarded TCs. **An unresolved compliance item IS
a block for the affected scope** — but only for that scope: independent work still completes and is
reported.)*
**Details:** {exact item and what was observed}
**Compliance gates:** {the `### Compliance gates` table — which gate, which items are unresolved,
what would close each one}
**Execution status (kept separate):** {what actually ran and its result — a green suite here does
not lift the gate, and failing tests here may be genuine application defects rather than a
compliance problem}
**Completed before blocking:** {activities/items}
**Required from the user:** {the exact input or action needed — or "nothing: the open items are
mine to verify" when no user input is needed}

</structured_returns>

---

<quality_checklist>
Before returning AUTOMATION COMPLETE, confirm every line against its home block (where the full rule
lives). A line that does not hold → `## BLOCKED` for the affected scope.

**Gates and honesty**
- [ ] Checkpoint A PASS for the executed scope and Checkpoint B PASS for the FINAL delivered scope, both
      at the current `scopeDigest` — confirmed violations fixed at once, affected checks re-run
      (`<checkpoint_a>`, `<checkpoint_b>`)
- [ ] Validator result reported in full (`gate`, `counts`, `review[]`, `notRun[]`, `exceptions[]`); a
      scanner PASS never presented as proof the tests are correct; a scanner BLOCKED / NOT_RUN recorded
      verbatim and closed another way against the same `scopeDigest`, or left BLOCKED (compliance §1)
- [ ] No applicable check recorded PASS or `N/A` without having run — `unresolved` keeps its gate
      BLOCKED; runtime artifacts never claimed at Checkpoint A (compliance §1, §5)
- [ ] Every honoured exception's source opened and its substance recorded; no `qa-allow` on a
      non-exemptible rule (item 39)
- [ ] No reported result stale: `impact.mjs select` on the final code → `stale: []`,
      `fresh_by_member_only[]` reviewed, both in `{run_file}.impact` (`<checkpoint_b>` step 4)
- [ ] Blocked tests reported against the ORIGINAL scope, never dropped or counted as passing; compliance
      reported apart from execution; the three coverage figures separate, no requirement ID invented
      (automation-rules §6)
- [ ] No product code or application setting changed, no error suppressed, no assertion lowered, no skip
      or timeout added to hide a failure, no app bug masked (SKILL role, `<first_run>`)
- [ ] No scratch probe left or cited — `scratch.mjs clean` → `removed` / `absent` (item 50,
      `<scratch_investigation>`)

**Intake**
- [ ] Approval per `<input_gate>`: `APPROVED` proceeded, otherwise ONE question or `--approve` /
      `--unapproved`; *approve now* rewrote only the `Status:` line; *run without approval* recorded on
      the `Source document` line, in `### Deviations` and in the final message; never persisted
- [ ] User Story id resolved without Azure and confirmed before any folder was named (`<input_gate>`)
- [ ] `ado_mode` derived and stated; the run never blocked, paused or degraded for Azure, the user never
      asked to publish or to run skill 4; ADO auth only under `linked`, 401 / 403 → `local`, no token
      logged (`<input_gate>`, `<ado_linkage>`)
- [ ] Layout and roots per `<project_profile>` / `<result_organization>`: an existing automation project
      reused, `spec_level` derived once, the three roots stated at the start and never changed or
      flattened to a bare `US-*` path; legacy folders read as history only

**Code**
- [ ] Generated from the ORIGINAL approved document; no beautify, no TC work-item edit (SKILL role)
- [ ] Hierarchy verified, Placement Manifest emitted, spec registered (`<hierarchy_verification>`)
- [ ] POM enforced and its self-check grep reported; no spec-local UI helper, no chaining off exposed
      locators (`<pom_mandatory>`)
- [ ] Automation inventory before any page object; validator with `--inventory` at both checkpoints, no
      open `pom-duplicate-page`; decisions in `## Automation Tricks` (`<automation_inventory>`)
- [ ] Every selector confirmed in source; safe-fix impact checks before any rename
      (`<selector_resolution>`)
- [ ] Every TEST-DATA reference resolved by its own ID through `helpers/test-data.ts` — never by role,
      no literal URL / username, no default value (`<spec_writing>`)
- [ ] `[HUMAN]` TCs generated up to the first human step: coverage `partial (human step: n)`, status
      `PARTIAL — human step pending` — never PASS, `Automated` or an `automated_tc_sha256`
- [ ] Code-craft [M] items (compliance items 40-49); every timeout from `timeouts.ts`, raised only on
      trace evidence and recorded `{key, from, to, reason, evidence}`, no retry absorbing a timeout;
      calibration and probe `NOT_RUN` with the reason when no run happened (code-craft §9,
      `<first_run>` step 2b)
- [ ] ONE shared `playwright.config.ts` per `<shared_config>` (extra configs deleted only from
      `deletable[]`, unmergeable ones listed with the blocking setting, reporters additive); headed
      Chrome, or the `PW_HEADLESS=1` fallback reported in chat AND under Deviations

**Before the first run**
- [ ] Open questions per `<open_questions>`: all four sources, one question per ambiguity, learning file
      first, evidence-backed options with the recommendation first; every answer written back at once as
      a generic rule; unanswered → `@unverified-assumption` or skip-guarded, and such a failure never
      `app_bug`, never in the smoke-gate math, never published as Passed; `{run_file}.open_questions`
- [ ] Static coverage measured, gate verdict recorded with target + source + mechanism; below target →
      one repair pass, re-measure, then the user; three CSVs and the snapshot / delta
      (`<coverage_measurement>`)
- [ ] Test-data readiness resolved per `<data_readiness>` and the twelve principles;
      `{run_file}.data_readiness` written; every skip guard traces to a readiness decision
- [ ] Run plan in `{run_file}.run_plan` with `required_variants` and `rate_limits[]`; one `@run:` tag per
      TC; a serial group isolated by its tag + own `--workers 1` command, `mode: 'serial'` only around a
      true chain; every serial decision has its reason (`<run_plan>`)

**Run**
- [ ] Every Playwright command of the run through `run-stage.mjs` — one background call per stage, never
      polled; no `--reporter` / `--config` on any run command (`scratch.mjs`'s overlay is not a run);
      every command's stage JSON fresh, `FRESHNESS_FAILED` stopped the stage (`<live_progress>`)
- [ ] Watchdog stops only on `FROZEN` or past ceiling + margin; `completed[]` kept, `interrupted[]` /
      `not_started[]` named and run again once, the event `timeout_failure` (`<live_progress>`)
- [ ] Stage order setup → smoke → gate → positive → negative; further executions only as the isolation
      check, a smoke retry, the re-run or the burn-in, each a new attempt (`<staged_execution>`)
- [ ] One chat message per finished stage plus immediate stop / blocker messages, activity names as
      labels; the progress log appended across ALL activities, history untouched (`<live_progress>`,
      `<automation_logs>`)
- [ ] Smoke gate math and action per `<staged_execution>`; on a gate stop the run file, phase section,
      bug file and page were still completed
- [ ] Isolation check and rate limits per `<live_progress>`: an alone-PASS is PASS + Deviation + tag move
      + `run_plan_adjustments[]` + learning line; `rate_limited` is INCOMPLETE, never FAIL / bug / heal;
      limits learned as `[type: env]` lines, never asked, never a code change
- [ ] Every failure classified; only test-code defects healed (≤ 2 iterations); Heal Log kept
      (automation-rules §5)
- [ ] Re-run chosen by `impact.mjs select` — or "Re-run not needed" stated (`<second_run>` step 1)
- [ ] `@smoke` tags only from the TC document's `Smoke:` field

**Evidence and report**
- [ ] Every attempt's assertion-point image and every failed attempt's failure image at the
      `<result_organization>` path, recorded in the run file; nothing under `screenshots/` overwritten
      or deleted; evidence sanity check done, every `evidence_failure` healed by moving the call
- [ ] `{run_file}.merged` per `<second_run>` step 2 — every variant and attempt, the latest the status of
      record, PASS only when every `required_variants` entry passed, a multi-`[TC-ID]` title credited
      to each TC; phase auto-incremented, no earlier phase rewritten
- [ ] Run file finalized, `## Phase {N}` appended, page rendered by `render-run-report.mjs` with gate
      PASS and `selftest-run-report.mjs` passing (run-report.md §1-§2)
- [ ] Bug file per run-report.md §5 and `<bug_report_format>`: plain-sentence titles, numbered steps from
      login, one-sentence Expected / Actual, root cause + screenshot; `resolved (phase N)` only after a
      passing retest
- [ ] Azure close-out only under `linked`, per `<ado_closeout>`; under `local` skipped silently, no
      publish suggested
- [ ] Deviations honest and complete; learning file grepped before every ask and discovery and updated
      with tagged plain-English lines — no secrets, no code identifiers (`<project_learning_file>`)
</quality_checklist>
