# The structured returns and the final quality checklist

Loaded by `SKILL.md` at **Preparing Final Report**, before writing any return: work
`<quality_checklist>` first, then write exactly one of the returns.

<structured_returns>

## AUTOMATION COMPLETE

**Precondition — not negotiable.** Return this ONLY when `<checkpoint_a>` and `<checkpoint_b>` are
both recorded **PASS for the final delivered scope**, at the current `scopeDigest`. If either gate
is `FAIL` or `BLOCKED`, if any applicable check is `unresolved`, or if any recorded result predates
the last code change, return **`## BLOCKED`** instead with the gate record attached — however green
the test run was. A passing suite is not a passed gate.

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
{File · Path · Registered · Status table — includes the shared playwright.config.ts (updated / consolidated / created), timeouts.ts, helpers/evidence.ts, helpers/steps.ts, helpers/progress-reporter.ts, helpers/console-guard.ts, helpers/test-data.ts, .gitignore, and every config removed as `removed (consolidated from …)`}

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
{one row per group; `parallel` first; every serial group's reason names the shared data and the `--workers 1` override}
**Decisions:** {N field-driven} · {N inferred} · {N fail-safe serial}
**Estimate:** serial-only ~{s} vs planned ~{s} → actual {s}
**Headed:** {yes | no — reason}
**Run plan file:** {run_file}.run_plan

### Timeout policy
| Key | Initial | After calibration | Reason / evidence |
|-----|---------|-------------------|-------------------|
{one row per `timeouts.ts` key: test.default · test.long · expect · action · navigation · hook · step.default · step.long · operations.* · watchdog_grace; "confirmed" when unchanged}
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
automation coverage (the gate) · **(3)** execution pass rate (in *Final run — Results*).

**(1) Requirement outcome coverage** — does each requirement's required outcome get asserted?
| Requirement ID | Requirement (short) | Outcome coverage | Asserted by | Note |
|---|---|---|---|---|
{Full / Partial / Missing / **Assumed**; `Assumed` = covered only by an `@unverified-assumption` test.
Linked-but-not-asserted is `Partial`, never `Full`. IDs validated against {REQ file / approved doc /
ADO-MAP}; unresolvable IDs listed here, never invented.}
**Totals:** Full {n} · Partial {n} · Missing {n} · Assumed {n} of {N} requirements

**(2) TC automation coverage**
| TC-ID | Requirement ID(s) | Smoke | Automation candidate | Implementation | Static coverage | Final-run status |
|-------|-------------------|-------|----------------------|----------------|-----------------|--------------|
{Implementation = `full` / `partial (human step: n)` / `manual — not automated` / `pending — not covered for this run`; Static coverage = Fully / Partially / Not Covered from the pre-run measurement; Final-run status = PASS / FAIL / INCOMPLETE / SKIP / NOT_RUN / `PARTIAL — human step pending`}

**Weighted static coverage (pre-run):** {x}% — target {t}% ({L3 | default}, {mechanism}) — **{PASS | user override | report-only}**
Smoke {x}% · Positive {x}% · Negative {x}% · Full {n} · Partial {n} · None {n} of {N}
**Δ vs previous measurement:** {±d} pts — improved {TC-IDs} · regressed {TC-IDs} · TCs added/removed {+a/−b} — or "no prior measurement"
**Repair pass:** {n} TCs strengthened → {before}% → {after}% — or "not needed"
**Manual-only scenarios:** {n} (High {h} · Medium {m} · Low {l}) → `{coverage_root}/manual-scenarios.csv`
**Coverage folder:** `{coverage_root}` — coverage-summary.csv · coverage-detail.csv · manual-scenarios.csv

### First run — Heal Log
{TC-ID · failure · classification · fix · result — or "First run fully green"}
**Smoke gate (first run):** {passed | healed-then-passed ({n} retry cycles) | FAILED-STOPPED} — fail% {x}%

### Final run — Results (run of record)

| Field | Value |
|---|---|
| User Story | US-{ID} — {title} |
| Run number | {N} (report section `## Phase {N}`) |
| Total TCs | {N} |
| Passed / Failed / Incomplete / Skipped / NOT_RUN / Partial | {n} / {n} / {n} / {n} / {n} / {n} (TC counts — each TC-ID once; a PARTIAL TC is never in Passed) |
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
| Stage results | {results_root}/artifacts/stages/ — {N} stage files, all fresh · merged: {run_file}.merged |
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
| Scope | {N tests · M page objects/fixtures/helpers/config} | {same, or the final scope after reruns} |
| Code state | `scopeDigest {sha}` · {N} files hashed · git {HEAD short} {clean \| +K uncommitted} *(git is context only)* | `scopeDigest {sha}` |
| Mechanical checks | validator `{gate}` — {v} violations · {w} warnings · {r} review · {n} notRun · {e} exceptions; {project tooling + result \| none configured} | {same, re-run on the final code} |
| Semantic review | {items reviewed} | {items reviewed, including files that passed A} |
| Findings | {ruleId} {file}:{line} — {one line}, or "None" | {…} |
| Repairs | {what changed} → {re-check run} → {result} | {…} |
| Open items | {item} — {verified-semantic: reasoning} | {…} |
| **Unresolved** | {check} — {why it could not be verified} — **each one keeps this gate BLOCKED** | {…} |
| N/A | {check} — {why this rule has NO SUBJECT in this scope} | {check} — {why} |

*`N/A` means the rule has nothing to act on here (no ADO linkage, no modifier in scope, no API
fixtures). A check that applies but did not run is **`Unresolved`**, never `N/A` and never PASS —
that includes anything the validator reported in `notRun[]` or left open in `review[]`.*

**Runtime artifacts** (images, run file, report markdown / HTML, logs) are verified at Checkpoint B only — at A they
were recorded `scheduled for Checkpoint B`, never PASS.
**Compliance vs execution:** {one line — e.g. "both gates PASS; 3 TCs failed on real application
defects" or "suite green; Checkpoint B BLOCKED on 2 unresolved review items"}.
{When code changed after a recorded run: which checks were refreshed and which results were
discarded as stale.}

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

**Reason:** {unapproved TC doc — user chose *stop*, or pipeline run without `--approve` / `--unapproved` | missing User Story | ambiguous US name | missing profile key | unresolved test-data precondition (QC chose stop, or provisioning failed and no alternative accepted) | **compliance gate not PASS** (Checkpoint A or B `FAIL`/`BLOCKED`, an applicable check still `unresolved`, or the recorded results are stale)}
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
Before returning AUTOMATION COMPLETE:

- [ ] **Checkpoint A recorded PASS for the executed scope** — validator + project tooling +
      semantic review; confirmed violations fixed immediately, affected checks re-run
- [ ] **Checkpoint B recorded PASS for the FINAL delivered scope** — full review repeated on the
      final code including files that passed A; debugging introduced no shortcut
- [ ] **Validator result reported in full** — `gate`, `counts`, `review[]`, `notRun[]`,
      `exceptions[]`; a `PASS` never presented as proof that the tests are correct; a scanner
      `BLOCKED`/`NOT_RUN` recorded verbatim and its checks closed another way against the same
      `scopeDigest`, or left BLOCKED
- [ ] **No applicable check recorded as PASS or as `N/A` without having run** — an applicable
      check that did not complete is `unresolved` and **keeps its gate BLOCKED**; `N/A` is only
      for a rule with no subject in this scope, with the reason naming why it has none. Every
      validator `notRun[]` and open `review[]` item is an applicable check, never an `N/A`.
      Runtime artifacts are never claimed at Checkpoint A
- [ ] **Every honoured exception's source opened and its substance recorded** (justified /
      rejected); no `qa-allow` on a non-exemptible rule
- [ ] **Both gates' records carry the `scopeDigest`**, and no result from an earlier digest was
      reused after a code change
- [ ] **Blocked tests reported against the ORIGINAL scope** with reasons — isolated, never
      silently dropped, never counted as passing
- [ ] **Compliance status reported separately from execution status**
- [ ] **Requirement outcome coverage, TC automation coverage and execution pass rate reported as
      three separate figures**, each requirement ID validated against the resolved sources and
      none invented here
- [ ] **No product code modified, no application setting changed, no error suppressed to obtain
      a pass**

- [ ] TC document `Status:` read; `APPROVED` proceeded, anything else asked ONCE (approve now /
      run without approval / stop) or answered by `--approve` / `--unapproved`; *approve now*
      rewrote the `Status:` line only; *run without approval* is recorded on the report's
      `Source document` line, in `### Deviations` and in the final message; the choice was never
      written to the learning file
- [ ] User Story id resolved without Azure (task input → frontmatter → folder name → ask) and
      confirmed with the user before naming any folder; never guessed
- [ ] **`ado_mode` derived and stated (`linked` / `local` + reason); the run was NEVER blocked,
      paused, or degraded because the TCs were not published, and the user was NEVER asked to
      publish/upload to Azure DevOps or to run skill 4**
- [ ] ADO auth verified under `ado_mode = linked` only; 401/403 dropped to `local` instead of
      stopping; token never logged or written — N/A under `local`
- [ ] **Folder layout follows `generate-testing-structure`: new projects under
      `Testing/Automation/` (pages/tests/reports/screenshots/automation-logs); an existing
      automation project reused, never duplicated**
- [ ] **`spec_level` derived once from the approved document's folder; `results_root`, `logs_root`
      and `screenshots_root` carry the same `[SPEC-{spec-name}/]` parent as the TC folder, were
      stated at the start, and never changed or fell back to a flat `US-*` path during the run;
      legacy flat folders read as history only, never written**
- [ ] **Linkage detected, not required: under `linked` the beautified document + ADO-MAP.md carry
      `source_sha256` equal to the approved document's hash and one work item was spot-checked
      (title prefix, Tested-By link); otherwise `local` with the reason stated once**
- [ ] **No beautify, no TC work-item creation or edit in this run — skill 4 owns both**
- [ ] **Automation generated from the ORIGINAL approved document, never from the beautified file**
- [ ] Hierarchy verified/created; Placement Manifest emitted; spec registered in the browser project
- [ ] POM mandatory rule enforced — zero inline locators in specs; self-check grep reported
- [ ] **Automation inventory (`<automation_inventory>`): the WHOLE automation root scanned before
      any page object was written; `{reports_folder}/automation-inventory.md` holds one decision
      row per screen (`reuse` / `extend` / `create`) naming every candidate with its reason; the
      validator ran with `--inventory` at both checkpoints with no open `pom-duplicate-page`; no
      `create` row left a candidate unaddressed; each decision recorded in `## Automation Tricks`**
- [ ] **Every TEST-DATA reference resolved per ID — `[E{n}]` its own environment entry, `[A{n}]`
      that account by ID (never by role), `[D{n}]` that data item — through `helpers/test-data.ts`
      env vars named after the ID; no literal URL / username, no default value**
- [ ] **`[HUMAN]` steps: the candidate TC generated up to the first one, coverage
      `partial (human step: n)`, run status `PARTIAL — human step pending` in its own bucket —
      never PASS, never `Automated`, never an `automated_tc_sha256`**
- [ ] No spec-local UI helper functions; no chaining off exposed page-object locators
- [ ] Every selector confirmed in source; safe-fix impact checks run before any rename
- [ ] Self-check passed before first run; no banned patterns
- [ ] **Open questions (PHASE 2.4) collected from all four sources (ambiguous step, unresolved
      element, skill 4 `Needs human review`, TBD/assumption markers), de-duplicated to ONE
      question per ambiguity with its TC list — and the run NEVER blocked because of one**
- [ ] **Every candidate answer carries real evidence (source file / page object / sibling TC /
      code-rules doc); the learning file was grepped FIRST and a recorded answer reused without
      asking; the user was asked with selectable options, recommended one first**
- [ ] **Every answer written back to `Testing/project-learning.md` AT THE MOMENT IT WAS GIVEN as
      a GENERIC tagged behaviour rule (module/page/element level — never "TC-xx expects …"),
      project-wide ones also under `## Project Knowledge`, `## Index` rows updated, deduped —
      so no later phase, run, or story asks it again**
- [ ] **Unanswered questions: generated from the recommended evidence-backed candidate, tagged
      `@unverified-assumption` with the assumption stated in the spec and the report; no
      evidence-backed candidate → skip-guarded with the exact question, never invented**
- [ ] **No `@unverified-assumption` failure reclassified as `app_bug`, filed as a bug, counted in
      the smoke-gate majority math, or published as Passed**
- [ ] **`{run_file}.open_questions` written with every question, candidate, evidence,
      decision, decidedBy and the learning line recorded for it**
- [ ] **Static coverage measured BEFORE the first run: every TC of the approved document classified
      Fully / Partially / Not Covered from the spec source (always-skipped, data-gated, access-only
      and role-variant tests downgraded); weighted % computed overall and per stage**
- [ ] **Gate verdict recorded with target + source (L3 or default 80 %) + mechanism; below target →
      one repair pass, re-measure, then the user asked — never silently run; override reported**
- [ ] **Three coverage CSVs written; snapshot/delta in run file; Coverage section rendered**
- [ ] **Test-data readiness resolved BEFORE the first run: requirements extracted per TC, probed once
      each (learning file first), a way searched per MISSING gap in the principle-1 order, UI journeys and
      existing helpers prepared without a question, the QC asked in ONE message only for an endpoint from
      the source code / a DB write (yes / no) and for gaps with no way (manual / skip) — pipeline mode
      prepared the automatic ways and skipped the rest with the precise reason**
- [ ] **Preparation only through a temporary seed in the scratch folder that imports the project's own
      helpers or calls an endpoint found in the source (deleted afterwards, kept as code only on request),
      `00-setup-*.spec.ts` page-object journeys, or the DB helper / CLI with a QC-named env var touching
      only records this run created; every prepared gap verified on its oracle before any dependent ran;
      stamped values read back and propagated through the test-data layer with a Deviation per substitution;
      keep by default, cleaned up only on the ONE post-run answer, kept fixtures registered in `## Test Data`;
      no connection string or credential echoed, logged, or written anywhere; a permission refusal reported,
      never worked around**
- [ ] **`{run_file}.data_readiness` written; every skip guard in the specs traces to a
      readiness decision; decisions recorded in the learning file Q&A**
- [ ] First run: every failure classified; only test-code defects healed (≤2 iterations); Heal Log kept
- [ ] No assertion lowered, no skip added to hide a failure, no app bug masked
- [ ] **Results under `{results_root}` (`reports/[SPEC-{spec-name}/]{user_story_name}/`) as the Markdown phase plus `{run_file}` — phase auto-incremented across the nested AND legacy folders, NO prior phase overwritten or deleted; previous-phase links resolve into whichever folder holds them**
- [ ] **No `--reporter` and no `--config` passed on any CLI command; every stage / run-group command wrote its own stage JSON at the resolved `{stage_json_path}` (mtime later than that command's start) — or, for a watchdog stop, its `{stage}-{group}.watchdog.json` — checked right after each command, run STOPPED on a missing or stale file**
- [ ] **ONE shared `playwright.config.ts`: config-inventory run before generation; every extra config merged only when reproducible with identical behaviour, its references rewritten, the smoke stage run, and the file deleted only after a re-run listed it under `deletable[]`; every unmergeable config listed under `Configurations not merged` with its blocking setting; no `playwright.us-*.config.ts` left unexplained; reporters additive (line · json · progress-reporter beside the project's own)**
- [ ] **Timeout policy: every value from `timeouts.ts` (none inline), initial values + `playwright_version` + feature gates recorded in the run file and the Timeout policy section; every `timeout_failure` / watchdog event listed with TC-ID, step, elapsed, expected condition and evidence path; a value raised only where the trace shows the operation legitimately completing after the deadline, recorded `{key, from, to, reason, evidence}` in the run file, the Heal Log and the report; no retry added to absorb a timeout; calibration and the probe reported `NOT_RUN` with the reason when no run happened**
- [ ] **Watchdog: every Playwright command run through `run-stage.mjs` with `PW_GLOBAL_TIMEOUT` = the group's ceiling; the script ran `watchdog.mjs` on the group's heartbeat and killed a command only on `FROZEN` or past ceiling + margin (an outer-ceiling stop); a freeze stop taken only on `FROZEN` (an open step past its OWN deadline + grace, no progress, no newer worker record, no newer result), never on console silence or a stale stage JSON; on a stop the `completed[]` results kept, `interrupted[]` (`INCOMPLETE`, step + elapsed, `collateral` marked) and `not_started[]` (`NOT_RUN`) named, the group re-queued once, the event classified `timeout_failure`**
- [ ] **Code craft (`references/code-craft.md` [M] items): every generated / updated test uses `step()` per manual step (validator run with `--require-steps`); positional selectors scoped or justified; no `networkidle` readiness; tags via the details object where the version allows, `[TC-ID]` in the title always; `expect.soft` only for independent checks; created data named by `uniqueName()`; console guard attached; fixtures (when used) wrap `prerequest/` functions; `.gitignore` lines present; page objects and components follow §1-3**
- [ ] **`{run_file}.merged` keeps every variant (project × data variation) and every attempt in order; a TC is `PASS` only when every `required_variants` entry from the run plan passed, otherwise `INCOMPLETE` (never published as Passed — ADO outcome Inconclusive); TC totals count each TC-ID once; a multi-`[TC-ID]` title is credited to every TC; `phase sections` built from the merge only**
- [ ] **Progress log created at `{logs_root}/run-progress-{stamp}.log` (`automation-logs/[SPEC-{spec-name}/]{user_story_name}/`), announced at start with the three resolved roots, appended across ALL stages (not just execution — execution entries by `run-stage.mjs`, activity entries by you), historical logs untouched**
- [ ] **Each stage run as ONE background `run-stage.mjs` call, never polled; exactly one chat message per finished stage (Smoke; Positive cumulative; Negative with the run's totals, defects, blockers, evidence and compliance status) plus immediate messages for a stop or blocker; activity names, never "Phase N", as labels; counts, current TC, elapsed and the refreshed estimate in the progress log**
- [ ] **Stage order enforced: setup journeys (if any) → smoke → gate → positive → negative; no TC run twice in one phase; a failed setup journey skips its dependent TCs with reason and never counts against the smoke gate**
- [ ] **Run plan built from the approved TCs and written to `{run_file}.run_plan` with `required_variants` per TC; every TC carries one `@run:` tag; serial groups in `mode: 'serial'` describes; inside every stage the parallel group ran ×{workers_parallel} then serial groups ×1; reasons recorded for every serial decision**
- [ ] **Browser visible (headed Google Chrome, `channel: 'chrome'`) through the shared `playwright.config.ts` — or the `PW_HEADLESS=1` fallback reported in chat AND under Deviations; the shared config changed only per `<shared_config>` (contract settings, additive reporters, `testMatch` registration), every valid project setting preserved**
- [ ] **Every executed test attempt has `{screenshots_root}/phase-{N}/{TC-ID}/{variant_slug}/attempt-{a}.png` captured AT THE ASSERTION POINT (before teardown / cleanup / navigation away — never from `afterEach`); every failed attempt also has `attempt-{a}-failed.png`; nothing under `screenshots/` overwritten or deleted — earlier attempts and earlier phases byte-identical; every path recorded in the merged and phase JSON**
- [ ] **Evidence sanity check done: no PASS image shows a cleaned-up screen; every `evidence_failure` healed by moving the call, not by editing the image or the assertion**
- [ ] **Smoke gate math reported (fail%, majority classification, action); automation/env majority → heal + smoke re-run (≤2 cycles); app_bug majority → run stopped**
- [ ] **On a gate stop: run file completed (`stopped-smoke-gate`), phase section appended with Outcome SMOKE GATE FAILED, smoke failures recorded in the bug file, page rendered with the banner and every positive/negative TC as NOT_RUN**
- [ ] **`@smoke` tags derive only from the TC document's `Smoke:` field**
- [ ] Second run clean; run file finalized, `## Phase {N}` appended (earlier sections byte-identical), page rendered by the script with RELATIVE screenshot links and the viewer (no base64, every link resolving), renderer gate PASS and `selftest-run-report.mjs` passing before the page is delivered; INCOMPLETE TCs shown with their missing variants, variant/attempt sub-rows for multi-variant or retried TCs
- [ ] **`BUG-REPORT-{feature}.md` updated: one entry per `app_bug` of this phase, a History line for every retested bug, `resolved (phase N)` only after a passing retest, `not-checked-this-run` when the TC did not run, no entry rewritten or id reused; the phase's `### Bugs` table cites those ids and the renderer reports no `bug-*` mismatch**
- [ ] **Every app_bug titled as a plain sentence (`The system doesn't … when …`) — never an
      assertion string, locator, or TC-ID; raw error text lives under Evidence**
- [ ] **Every app_bug has numbered reproduce steps starting at login, in the canonical verbs,
      plus one-sentence Expected and Actual**
- [ ] Every app_bug has root cause and a screenshot (or states plainly that none was captured)
- [ ] ADO close-out **under `ado_mode = linked` only**: the resolved automation flag set where
      earned (if the template rejects `AutomationStatus = Automated`, it stays `Planned` and the
      custom flag carries the status); summary comment posted; ADO-MAP updated — only the
      `AutomationStatus` and `automated_tc_sha256` columns, the hash from `scripts/tc-hash.mjs`
      (harness `selftest-tc-hash.mjs` passing) for TCs that ran full coverage with PASS after
      Checkpoint B PASS, `—` for every PARTIAL / other TC; `published_tc_sha256`,
      `Tags (introduced)` and `Suite` never touched.
      Under `local`: phase skipped silently, recorded as not applicable, no publish suggested
- [ ] Deviations honest and complete
- [ ] Learning file searched (Index + tag grep, not the whole file) before every ask and before
      selector/environment discovery; recorded and `[similar:]` knowledge reused
- [ ] Learning file updated: user answers under Automation Model Q&A, automation tricks and env
      facts as tagged plain-English lines, Index rows updated — no PATs, no code identifiers
</quality_checklist>
