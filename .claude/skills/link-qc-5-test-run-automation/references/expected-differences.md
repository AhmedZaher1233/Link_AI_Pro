# Expected-difference register — compliance gate 1.2.0 → 2.0 (B18 / B22)

Maintainers' document, loaded by no activity (like `rule-registry.md`). Optimisation plan Revision 3.1 §6.3: since
2.0 the checkpoints are decided by `scripts/check.mjs gate` (B18 — one result per check and unit for a frozen snapshot,
gate records `.runs/phase-N.checkpoint-{A|B}.json`) and the runtime checks by `scripts/run-data.mjs verify` (B22). The
**parity rule**: a check whose rule did not change must give the result the 1.2.0 checklist gave for the same
evidence; every other difference must be listed here and approved before release.

**Status: PROPOSED — awaiting your review.** Nothing here is approved yet. Until it is, Phase 2 of the plan has not
exited (`CHANGELOG.md` 2.0 entry) and the change is not synced to a consumer project.

How the parity table is checked: `selftest-check.mjs` case 18 reads this file and fails when a check of `CHECKS` is
missing or listed twice, when a row's 2.0 columns differ from the code, when a row marked `identical` is not
structurally identical (below), when a row marked `differs` is, or when an `ED` is cited but not defined (or defined
but never cited).

*Structurally identical* = the 2.0 catalogue gives the check the legacy kind (`M` → `M`, `S` → `S`, `M+S` → `MS`) at
exactly the legacy checkpoints, with no N/A predicate, no never-N/A flag and no runtime (`R`) or lint (`L`) unit. Its
verdict then comes from the same sources as in 1.2.0: the same validator rules (their logic is unchanged — the
validator harness keeps its 1.2.0 expectations for them, cases 1-18; `selftest-check.mjs` case 10 proves the mechanical
results equal the legacy validator gate) and the same semantic review.

## 1. Differences that apply to every check (the protocol)

| ED | Legacy 1.2.0 | 2.0 | Direction | Evidence |
|---|---|---|---|---|
| ED-1 | one checklist line per item, written by the model; a missing, duplicated or out-of-date line was not detected mechanically | exactly one result per (check, unit) for the snapshot; a missing, stale (other snapshot), contradictory or duplicate result → `BLOCKED` | stricter — adds `BLOCKED`, never a PASS | `selftest-check.mjs` cases 4, 15 |
| ED-2 | the checkpoint judged the code as it was during the review | the scope is hashed (snapshot) first and re-hashed at the gate; a difference voids the checkpoint | stricter | `selftest-check.mjs` case 6 |
| ED-3 | Checkpoint B's verdict was written into the report; the report and page could be delivered before B | gate records are separate files; the report set is drafted, frozen, checked by B and published byte for byte only on B PASS; B needs gate record A and `stale: []` | stricter (timing of publication) | `selftest-check.mjs` cases 7-8, `selftest-run-data.mjs` case 9 |

## 2. Differences of individual checks

| ED | Checks | Legacy 1.2.0 | 2.0 | Direction | Evidence |
|---|---|---|---|---|---|
| ED-4 | 6, 25a, 28, 43, 46a, 47, 49 | semantic review only | the six staged validator rules (B8: `constant-redeclared`, `empty-catch`, `timeout-literal`, `console-guard-missing`, `network-guard-missing`, `admission-contract`) at severity `review` add a mechanical result; an open review item is `unresolved` until a verified semantic result closes it | stricter (more review items; never a FAIL by itself) | `selftest.mjs` cases 21-26 |
| ED-5 | 14, 15, 16a, 17 | Checkpoint A only | A and B — re-checked on the final code | stricter | `selftest-check.mjs` case 1 (units per checkpoint) |
| ED-6 | 16 → 16a + 16b | one semantic item at A | 16a = the code (A, B); 16b = this phase's heartbeats show every captured image before teardown — runtime at B, never N/A; no `teardown` heartbeat (older helpers) → `unresolved` unless the order is proven by reading the specs | stricter | `selftest-run-data.mjs` cases 5-6 |
| ED-7 | 25 → 25a + 25b | one semantic item (groups honoured) | 25a = tags vs the run plan (code); 25b = execution honoured the plan (modes, workers, no conflicting units overlapped, isolation moves applied) — runtime at B, never N/A | stricter | `selftest-run-data.mjs` case 5 |
| ED-8 | 46 → 46a + 46b | one semantic item | 46a = the guards attached (code, mechanical); 46b = a console report for every executed test — runtime at B, never N/A | stricter | `selftest.mjs` cases 21-26, `selftest-run-data.mjs` case 5 |
| ED-9 | 48 → 48a + 48b | one semantic item at B; could read N/A when no stop happened | 48a = stops only on FROZEN or the documented ceiling stop; 48b = every watchdog / stall / admission-wait / timeout event classified — both runtime, never N/A: zero events = PASS with evidence | stricter (N/A no longer possible) | `selftest-run-data.mjs` case 5 |
| ED-10 | 18, 19 | semantic at B; N/A by judgement | never N/A at B | stricter | `selftest-check.mjs` case 8 |
| ED-11 | 22, 26, 39, 49 (slot part) | N/A by judgement | N/A only when the check's predicate says it has no subject (`fail-slow`, `api-setup`, `exceptions`, `rate-limit-step`), with the predicate's evidence | stricter | `selftest-check.mjs` cases 3-4 |
| ED-12 | 18, 19, 22, 23, 31, 32, 33, 34, 37, 38, 43, 45, 50 | semantic at B | at B the runtime part comes from `run-data.mjs verify` on this phase's files (counts, paths, logs, flags); a runtime result at A is `scheduled-for-B`, never N/A or PASS | equal or stricter — the same facts read mechanically; a gap the model might have read past becomes FAIL / `unresolved` | `selftest-run-data.mjs` cases 5-6, `selftest-check.mjs` case 3 (`scheduled-for-B`) |
| ED-13 | 27 | semantic | `tool:lint` when the project's lint makes floating promises deterministic, else semantic | equal (a deterministic tool where one exists) | `selftest-check.mjs` case 14 |
| ED-14 | 35 | semantic | the project's `tsc --noEmit` (`tool:tsc`) | stricter (a type error is a FAIL) | `selftest-check.mjs` case 11 |
| ED-15 | 33, 34, 36, 39, 47 | semantic | validator rules that already existed in 1.2.0 (`outcome-coverage-unassessed`, `trace-uncovered-id`, `manifest-unreadable`, `exception-*`, `absolute-url`) now enter the gate as the check's mechanical result | stricter (their findings can no longer be overlooked) | `selftest-check.mjs` case 1 (rule mapping) |
| ED-16 | 44 | semantic, `config-inventory.mjs` consulted | `config-inventory.mjs` is a mechanical unit (`tool:configs`) | equal | `selftest-check.mjs` case 1 |
| ED-17 | 43 | semantic review of the timeout policy | `tool:protections` — `config-inventory.mjs reconcile` (dry-run) is a mechanical unit: an unbounded action / navigation / test budget, a disabled protection (retries > 0, a forced local headless, a missing helper or stall key, QA_LEDGER=off, a persistent browser profile) or a value above its target without an approved exception is a FAIL | stricter (a disabled protection can no longer be read past) | `selftest-check.mjs` case 1 (units), `selftest-config-inventory.mjs` |

## 3. Parity table — every check of `scripts/check.mjs` `CHECKS`

Columns: legacy kind · legacy checkpoints (1.2.0 `compliance-checkpoints.md` §2) · 2.0 units per checkpoint (`M`
mechanical, `S` semantic, `R` runtime, `L` lint-or-semantic) · validator rules mapped · N/A predicate · never N/A at
B · parity.

| Check | Legacy | 2.0 units | Rules | N/A predicate | Never N/A | Parity |
|---|---|---|---|---|---|---|
| 1 | M+S · A,B | A: MS · B: MS | 5 | — | — | identical |
| 2 | M+S · A,B | A: MS · B: MS | 1 | — | — | identical |
| 3 | S · A,B | A: S · B: S | — | — | — | identical |
| 4 | M+S · A,B | A: MS · B: MS | 1 | — | — | identical |
| 5 | M+S · A,B | A: MS · B: MS | 3 | — | — | identical |
| 6 | S · A,B | A: MS · B: MS | 1 | — | — | differs: ED-4 |
| 7 | S · A,B | A: S · B: S | — | — | — | identical |
| 8 | M+S · A,B | A: MS · B: MS | 3 | — | — | identical |
| 9 | M+S · A,B | A: MS · B: MS | 3 | — | — | identical |
| 10 | S · A,B | A: S · B: S | — | — | — | identical |
| 11 | S · A,B | A: S · B: S | — | — | — | identical |
| 12 | S · A,B | A: S · B: S | — | — | — | identical |
| 13 | S · A,B | A: S · B: S | — | — | — | identical |
| 14 | M+S · A | A: MS · B: MS | 4 | — | — | differs: ED-5 |
| 15 | M · A | A: M · B: M | 2 | — | — | differs: ED-5 |
| 16a | S · A | A: MS · B: MS | 1 | — | — | differs: ED-6, ED-5 |
| 16b | S · A | A: — · B: R | — | — | yes | differs: ED-6 |
| 17 | S · A | A: S · B: S | — | — | — | differs: ED-5 |
| 18 | S · B | A: — · B: RS | — | — | yes | differs: ED-10, ED-12 |
| 19 | S · B | A: — · B: RS | — | — | yes | differs: ED-10, ED-12 |
| 20 | M · A,B | A: M · B: M | 1 | — | — | identical |
| 21 | M+S · A,B | A: MS · B: MS | 2 | — | — | identical |
| 22 | S · B | A: — · B: R | — | fail-slow | — | differs: ED-11, ED-12 |
| 23 | S · A,B | A: S · B: SR | — | — | — | differs: ED-12 |
| 24 | M+S · A,B | A: MS · B: MS | 2 | — | — | identical |
| 25a | S · A,B | A: MS · B: MS | 1 | — | — | differs: ED-7, ED-4 |
| 25b | S · A,B | A: — · B: R | — | — | yes | differs: ED-7 |
| 26 | S · A,B | A: S · B: S | — | api-setup | — | differs: ED-11 |
| 27 | S · A,B | A: L · B: L | — | — | — | differs: ED-13 |
| 28 | S · A,B | A: MS · B: MS | 1 | — | — | differs: ED-4 |
| 29 | M · A,B | A: M · B: M | 3 | — | — | identical |
| 30 | M · A,B | A: M · B: M | 2 | — | — | identical |
| 31 | S · A,B | A: S · B: R | — | — | — | differs: ED-12 |
| 32 | S · B | A: — · B: R | — | — | — | differs: ED-12 |
| 33 | S · A,B | A: S · B: R | 1 | — | — | differs: ED-12, ED-15 |
| 34 | S · A,B | A: S · B: R | 2 | — | — | differs: ED-12, ED-15 |
| 35 | S · A,B | A: M · B: M | — | — | — | differs: ED-14 |
| 36 | S · A,B | A: MS · B: MS | 1 | — | — | differs: ED-15 |
| 37 | S · A,B | A: S · B: R | — | — | — | differs: ED-12 |
| 38 | M+S · A,B | A: MS · B: MSR | 1 | — | — | differs: ED-12 |
| 39 | S · A,B | A: MS · B: MS | 5 | exceptions | — | differs: ED-11, ED-15 |
| 40 | M+S · A,B | A: MS · B: MS | 1 | — | — | identical |
| 41 | M+S · A,B | A: MS · B: MS | 1 | — | — | identical |
| 42 | M+S · A,B | A: MS · B: MS | 1 | — | — | identical |
| 43 | S · A,B | A: MS · B: MSR | 1 | — | — | differs: ED-4, ED-12, ED-17 |
| 44 | S · A,B | A: MS · B: MS | — | — | — | differs: ED-16 |
| 45 | S · A,B | A: S · B: SR | — | — | — | differs: ED-12 |
| 46a | S · A,B | A: M · B: M | 1 | — | — | differs: ED-8, ED-4 |
| 46b | S · A,B | A: — · B: R | — | — | yes | differs: ED-8 |
| 47 | S · A,B | A: MS · B: MS | 2 | — | — | differs: ED-4, ED-15 |
| 48a | S · B | A: — · B: R | — | — | yes | differs: ED-9 |
| 48b | S · B | A: — · B: R | — | — | yes | differs: ED-9 |
| 49 | S · A,B | A: MS · B: MS | 1 | part: rate-limit-step | — | differs: ED-4, ED-11 |
| 50 | S · A,B | A: S · B: R | — | — | — | differs: ED-12 |

Totals: 20 identical · 34 differ (every difference stricter or equal — none turns a legacy FAIL / BLOCKED into a
PASS).

## 4. Result-visible changes outside the checklist (not covered by the parity rule)

Listed so one review sees every way 2.0 can report differently from 1.2.0 on the same run.

| Change | 1.2.0 | 2.0 | Where |
|---|---|---|---|
| Smoke gate with no PASS / FAIL result | 0 % fail → passed | `NO VERDICT`; a first run's positive / negative stages refused | `run-stage.mjs` `smokeGateOf`, run-stage case 24 |
| `AUTOMATION COMPLETE` | both checkpoints PASS | also the run `ACCEPTED` (no unresolved concurrency defect or unexplained first-attempt regression, no TC left unstarted by admission / pressure / deferral / lease / missing coordination, a smoke verdict) | `<run_acceptance>`, `run-data.mjs acceptance` — `selftest-run-data.mjs` case 7 |
| `rate_limited` | any refusal on the failing TC | only the failing step's own request, refused again when run alone after the server's deadline | run-stage cases 15, 28 |
| 503 + `Retry-After` without rate-limit headers | throttling | temporary unavailability — the failure keeps its normal classification | run-stage case 30 |
| A wait longer than the budget | `rate_limited` | `NOT_RUN — not started: deferred until …` / `INCOMPLETE — interrupted: wait budget exhausted` | run-stage cases 25-26 |
| Capacity / coordination | none | `NOT_RUN — not started: admission timeout · host pressure · environment lease · no safe coordination`; `QA_LEDGER=off` = exclusive execution | run-stage cases 27, 33-37 |
| Interference | passed alone = PASS, interference noted | the same status, plus a cause from evidence and the first attempt kept | run-stage cases 14, 30 |
