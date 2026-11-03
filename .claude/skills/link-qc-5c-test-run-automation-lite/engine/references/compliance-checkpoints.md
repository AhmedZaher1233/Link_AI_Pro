# Compliance checkpoints — the two mandatory gates (rules)

Loaded at **Validating Automation Code** (`<checkpoint_a>`, §3a); `<checkpoint_b>` (§4a) at **Re-running Fixed & Impacted Tests**. Both must PASS for the final scope. Detail: `maintainers/compliance-checkpoints.md`.

## 1. The three-state model and the result protocol

Every applicable check ends in exactly one state: `verified-mechanical` (the validator) · `verified-semantic` (a reviewer, `file:line`) · `unresolved` (applies, not completed — say why; never PASS, never `N/A`; holds the gate BLOCKED) · `N/A` (NO SUBJECT, reason stated). An unanalysed file, a `notRun[]` rule, an open `review[]` item or short time is `unresolved`. Items 14, 15, 16a, 19, 46a, 46b, 49 are N/A only under the `no-browser-tests` predicate decided by `check.mjs`, never at B; 51-54 only under their own predicate. A scanner that cannot read valid code is a limitation, never a violation (its `gate` recorded verbatim; checks closed by project tooling or semantic review).

**A clean scan is not a clean checkpoint.** `PASS` = no confirmed violation AND every `review[]` / `notRun[]` item closed; anything `unresolved` → BLOCKED for those items, named one by one; independent work continues.

**Result protocol — decided by `check.mjs gate`, never by hand.** A checkpoint = a snapshot + exactly ONE result per (check, unit); statuses `verified-mechanical` · `verified-semantic` · `unresolved` · `N/A` · `scheduled-for-B` · `FAIL`. Rejected (BLOCKED): a missing, stale, contradictory or duplicate result, a runtime result at A (`scheduled-for-B` there), `scheduled-for-B` at B, N/A without its predicate (26 no `api_setup` · 22 no modifier · 39 `exceptions[]` empty · 49 no limited service). Never N/A at B: 16b, 18, 19, 25b, 46b, 48a, 48b — zero events is a PASS with evidence. A `FAIL` is repaired, never closed. No edits during a checkpoint. Gate record: `.runs/phase-{N}.checkpoint-{A|B}.json`. `check.mjs carry` is SHADOW ONLY.

**One command per checkpoint.** `check.mjs checkpoint --checkpoint A|B` (B through `run-data.mjs finalize`): snapshot (freeze) → mechanical checks → (B: runtime checks) → `AWAITING_REVIEW` (exit 4, the expected handoff) with `semantic-{A|B}.template.json` listing every missing semantic result EMPTY — or, with `--review {semantic.json}`, the validated batch and the gate. Exit codes: PASS 0 · FAIL 1 · BLOCKED 2 · NOT_RUN 3 · AWAITING_REVIEW 4. **Checkpoint A never takes a capacity-ledger slot** (static checks); below the host memory minimum it prints `host memory N GB — static checks run without the ledger` and continues; a memory question about a static check is never asked. B's runtime processes take slots within ONE `--max-wait` budget (120 s, cap 240 s); no slot → `BLOCKED` with `coordination { outcome, waitedMs, holders[] }` — a coordination failure, not a result.

## 2. The reusable checklist

`M` = validator / script, `S` = semantic review, `Rt` = runtime (`run-data.mjs verify`).

| # | Check | How | Gate |
|---|---|---|---|
| 1 | No raw locator or driving in a spec | M + S | A, B |
| 2 | Nothing chained off an exposed locator | M + S | A, B |
| 3 | Flows in the project's own layer | S | A, B |
| 4 | No spec-local driver | M + S | A, B |
| 5 | Page objects reused; no open `pom-duplicate-page` | M + S | A, B |
| 6 | No constant redeclared in a spec | M + S | A, B |
| 7 | Every test verifies its outcome | S | A, B |
| 8 | No placeholder assertion | M + S | A, B |
| 9 | Helper assertions recognised | M + S | A, B |
| 10 | Visibility-only checks only when required | S | A, B |
| 11 | Expected values trace to a REQ | S | A, B |
| 12 | TC / requirement conflicts reported | S | A, B |
| 13 | Weak assertions repaired | S | A, B |
| 14 | Assertion-point evidence captured | M + S | A |
| 15 | Evidence never from hooks; one per test | M | A |
| 16a | Call at the assertion point, before teardown | S | A, B |
| 16b | `evidence` BEFORE `teardown` per PASS | Rt | B only |
| 17 | Evidence helper and roots writable | S | A |
| 18 | Artifacts produced for the final code (relocated images → PASS) | Rt + S | B only |
| 19 | No PASS image of a cleaned-up screen | S | B only |
| 20 | No focused execution | M | A, B |
| 21 | Every modifier has a reason | M + S | A, B |
| 22 | `fail` / `slow` distinguished in the report | S | B |
| 23 | Missing prerequisites visible | S | A, B |
| 24 | Bounded waits; none hides a failure | M + S | A, B |
| 25a | Isolation and run plan honoured in code | M + S | A, B |
| 25b | Execution honoured the plan | Rt | B only |
| 26 | `api_setup` teardown after the evidence image | S | A, B |
| 27 | No floating promises | M or S | A, B |
| 28 | Errors never swallowed | M + S | A, B |
| 29 | `[TC-ID]` per title; REQ ID per suite | M | A, B |
| 30 | IDs validated, none invented | M | A, B |
| 31 | REQ IDs in coverage artifacts and run JSON | S | A, B |
| 32 | REQ → TC → test → result mappable | S | B |
| 33 | Three coverage figures separate | S | A (two), B (all) |
| 34 | Coverage gaps visible | S | A, B |
| 35 | Imports resolve; no spec-to-spec import | S | A, B |
| 36 | Files at manifest paths; spec registered | S | A, B |
| 37 | Artifacts under the resolved roots | S | A, B |
| 38 | No credential or connection string anywhere | M + S | A, B |
| 39 | Honoured exceptions' sources opened | S | A, B |
| 40 | Steps in `step()`; `captureEvidence` before Assert | M + S | A, B |
| 41 | Positional selectors scoped | M + S | A, B |
| 42 | No `networkidle`; bounded waits | M + S | A, B |
| 43 | Timeouts from `timeouts.ts`; protections active; calibration recorded | M + S | A, B |
| 44 | ONE shared `playwright.config.ts` | S + M | A, B |
| 45 | Data by `uniqueName()`; swept by `runPrefix()` | S | A, B |
| 46a | Console guard attached and reported | M + S | A, B |
| 46b | Console reports per executed test | Rt | B only |
| 47 | Locators and fixtures per `code-craft.md` | S | A, B |
| 48a | Stops only on `FROZEN` / ceiling; results kept | Rt + S | B only |
| 48b | Every timeout event classified (zero = PASS) | Rt | B only |
| 49 | Network guard; `rateLimitSlot()` used | M + S | A, B |
| 50 | No scratch probe delivered | S | A, B |
| 51 | `[API]` lines through `api/` clients | M + S | A, B |
| 52 | `[DB]` lines through `db/` objects | M + S | A, B |
| 53 | Data changes consented and run-owned | M + Rt + S | A (code), B (ledgers) |
| 54 | Redacted record per backend attempt | M + Rt + S | A (code), B (records) |

## 3. Checkpoint A — before execution

Procedure of record: §3a.

## 3a. Checkpoint A — the procedure of record (`<checkpoint_a>`)

<checkpoint_a>
**MANDATORY PRE-RUN GATE** after generation, BEFORE anything executes (first gate of `<environment_gate>`). Scope: every test created, modified or selected plus the code and configuration it touches; work every §2 item gated A.
1. **ONE command — snapshot, then the mechanical checks** → `AWAITING_REVIEW` with the template. DELEGATED: a fresh subagent gets the run-file path and this one command, returns a ≤ 6-line verdict; review, repairs and questions stay in the main thread.
   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/check.mjs checkpoint --checkpoint A --root . --results-root {results_root} --phase {N} --files {in-scope specs + the page objects, fixtures and helpers they touch} --tc {source_tc_doc} --data {TEST-DATA md} --req {REQ files} --run-file {run_file} --inventory {reports_folder}/automation-inventory.md --require-steps [--lint]
   ```
   An unaddressed `pom-duplicate-page` candidate fails the checkpoint. Report `gate`, `counts`, open `review[]` / `notRun[]` / `exceptions[]` — never just "clean"; `gate: PASS` means no banned pattern, nothing more.
2. **Semantic review** of what the scanner cannot judge.
3. **Fix confirmed automation-code violations immediately**; only a BUSINESS decision goes to the user.
4. **Repeat the affected checks after every repair** (new snapshot).
5. **Proceed with the compliant scope only**; blocked tests isolated, reported against the original scope.
6. **Fill the template, then the same command with `--review`:** copy `semantic-A.template.json` to `semantic-A.json`, fill EVERY entry (`verified-semantic` + `file:line`, `unresolved` + why, or `FAIL`).
   ```text
   node .claude/skills/link-qc-5-test-run-automation/scripts/check.mjs checkpoint --checkpoint A {the same arguments} --review {results_root}/artifacts/checks/{snapshotId}/semantic-A.json
   ```
   The gate writes `.runs/phase-{N}.checkpoint-A.json` (§5); copy its verdict, snapshot id and open items into `{run_file}.compliance.checkpoint_a` and the report — never your own verdict.

**Gate result:** `PASS` only with no confirmed violation AND every open item closed against the same `scopeDigest`; else BLOCKED for the named items. At A only IMPLEMENTATION AND CONFIGURATION are verified; runtime artifacts are `scheduled for Checkpoint B`, never claimed.
</checkpoint_a>

## 4. Checkpoint B — after the re-run

Procedure of record: §4a.

## 4a. Checkpoint B — the procedure of record (`<checkpoint_b>`)

<checkpoint_b>
**MANDATORY POST-RUN GATE** after execution and ALL debugging, before `AUTOMATION COMPLETE`. **Order: drafts → freeze → validations → gate → publish** (`<publication>`), all by ONE delegated command, `run-data.mjs finalize` (drafts, freshness check, freeze, then `check.mjs checkpoint --checkpoint B`). Nothing is edited from freeze to gate. A valid PASS of A must cover every final file (refresh A on healed files first).
1. **Repeat the FULL review on the FINAL code** — mechanical + runtime by `finalize` (`run-data.mjs verify`: 16b, 18, 22, 23, 25b, 31-34, 37, 38, 43, 45, 46b, 48a, 48b, 50); semantic: every `S` item of §2 re-reviewed, `semantic-B.template.json` filled and passed to `finalize --review`.
2. **No shortcuts from debugging:** no weakened assertion, broken POM boundary, removed evidence, suppressed error, new skip or raised timeout, changed setting, product-code edit, scratch probe.
3. **Artifacts ACTUALLY produced** (18 by `run-data.mjs verify`; the rest your review of the DRAFTS): every attempt's images at the recorded path — missing images under another root with the same relative layout are relocated by `finalize` (`evidence_relocated: {from, to, files}`, listed under `### Deviations`) and 18 PASSES, no re-execution, no new phase; drafts consistent with the final code; renderer `gate: PASS`.
4. **Results-freshness check.** `finalize` runs `check.mjs freshnessCheck`, which ALWAYS writes `{run_file}.impact.final_check` (`{ outcome: FRESH | STALE, stale: [], fresh: N, checked_at }`) BEFORE the freeze; a stale TC stops `finalize` (re-run it or report it `NOT_RUN`); every `fresh_by_member_only[]` TC needs `--member-reviews {json}`, else `AWAITING_REVIEW`. Nothing is copied into the run file by hand.
5. **Gate, then publication — `finalize --review {semantic-B.json}`** on the frozen drafts: validated batch → gate → only on `PASS` the publication of exactly those drafts; `FAIL` / `BLOCKED` → nothing published; repair, re-draft, freeze again.

**An automation defect found here:** repair → static checks → rerun what `impact.mjs select` names → repeat the full review. **Never rerun to make a failure disappear.**

**Gate result:** `PASS` only with no confirmed violation in the final scope AND every open item closed against the same `scopeDigest` AND `impact.final_check.outcome: FRESH` AND `check.mjs gate --checkpoint B` accepted every result. Otherwise `FAIL` / `BLOCKED`, item by item (§5). A phase ending BLOCKED continues only in a fresh session from `run-data.mjs handoff --run-file {run_file}` (`<publication>` step 4).
</checkpoint_b>

## 5. Recording a gate

The record is the gate-record file written by `check.mjs gate`; the return, the report's `- **Compliance:**` bullet, `{run_file}.compliance` and the summary log carry what it says — never your own verdict. A BLOCKED gate with a green suite is a real outcome, as is a PASS gate with failing tests.
