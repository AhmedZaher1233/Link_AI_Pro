# Script payloads and records — the shapes, for when an output needs explaining

Loaded by no activity. Open it only when a script's payload, a gate record or a helper record needs to be
read field by field — or to write one of the INPUT files below. A script's flags come from its `--help`; never read a
script's source during a run. The rules these shapes serve live in their homes (`references/rule-registry.md`); paths,
discovery, repeats and evidence pairing: `references/schemas/paths-and-evidence.md`.

## Inputs you write

- **Review batch** (`check.mjs checkpoint … --review`, `run-data.mjs finalize … --review`, `check.mjs record --batch`):
  `{ "snapshot": "{the frozen snapshot id}", "results": [ { "check": "{id}", "unit": "scope" | "phase", "status":
  "verified-semantic" | "unresolved" | "FAIL" | "N/A", "reason": "{what was read and decided, ≥ 8 chars}", "evidence":
  ["{file:line}", …], "executor": "SB-P" | "SB-Q" | "SB-E" | "SB-D" | "SB-H" } ] }` — start from the
  `semantic-{A|B}.template.json` the checkpoint wrote (its entries are exactly what the gate still misses). Validated as
  a whole: an invalid, stale, duplicate or contradictory entry, another snapshot, or a scope changed since the freeze →
  nothing recorded. `N/A` only where the check's predicate says it has no subject.
- **Member reviews** (`--member-reviews`, Checkpoint B): `{ "TC-07": "pages/OrderPage.ts:58 — the changed member is
  unreachable from TC-07 because …" }`, one per `fresh_by_member_only[]` TC.
- **Judgements** (`run-data.mjs judge` / `finalize --judgements`): `{ "results": { "TC-01": { "classification",
  "root_cause", "severity", "assumption" } }, "parallel_checks": [ { "tc", "parallel_attempt"?, "cause"
  (test_data_conflict | possible_product_concurrency_defect | environment | unexplained), "cause_evidence"?, "resolution"
  ("test-side: {evidence}" | "bug: BUG-{n}") } ], "events": [ { "kind": "watchdog" | "timeout", "tc", "step"?, "stage"?,
  "group"?, "classification" } ], "heal_log": [ { tc_id, files, category, previous, updated, reason, requirement_ref,
  verification, rerun_result } ], "deviations": ["…"], "skips": [ { tc_id, status, reason } ], "unverified_assumptions":
  [ { tc_id, wording, interpretation, evidence, result } ], "bugs": [ { id, title, tc_id, severity, status } ] }` — a FAIL
  takes one of selector_failure · assertion_failure · app_bug · api_contract_failure · db_assertion_failure ·
  environment_failure · data_missing · timeout_failure · evidence_failure · unverified_assumption · automation_failure ·
  ai_rubric_failure; severity Critical · High · Medium · Low · N/A; arrays REPLACE the run file's; any error rejects all.
- **Coverage judgements** (`coverage.mjs --judgements`): the shape in `coverage.mjs --help` / its header.

## Orchestration outputs (compact)

- **`check.mjs checkpoint`**: `{ outcome: PASS | FAIL | BLOCKED | NOT_RUN | AWAITING_REVIEW, step, reason, steps[],
  snapshotId, template?, needed[]?, coordination?, first[]? / failing[]?, open[]?, record?, exit }` — exit always mapped
  (0 · 1 · 2 · 3 · 4). `coordination { budgetMs, waitedMs, outcome: OK | TIMEOUT | NO_SAFE_COORDINATION, refusals[],
  holders[] { token, runId, runFile, kind, state, since, pid, alive } }`.
- **`run-data.mjs finalize`**: the same envelope; call 1 ends `AWAITING_REVIEW` (or a stop with its step), call 2
  `PUBLISHED` with `page`, `acceptance` — under the run's `delivery.report: md` `page: null`, `reportFormat: "md"` and,
  when an earlier phase rendered one, `stalePage` (that page, untouched, does not show this phase). `publish` alone
  returns the same keys.
- **`run-stage.mjs preflight`** (`skill5-preflight/1`): `{ verdict: ready | restricted | blocked, reason, environment,
  lease, capacity { ceiling, source, free, used, availableMb, cpus, reserveMb, perWorkerMb, admissibleNow }, workers {
  start, max, why }, coordination { mode, dir }, display, playwright { cli, version, source }, config { shared, source,
  ambiguous? } }`; detail in `artifacts/progress/preflight.json`.
- **`run-data.mjs report --write`**: `{ outcome, written { file, sections[] }, phaseOutcome, counts, acceptance, warnings }`.
- **`run-data.mjs judge`**: `{ outcome: OK | REJECTED | BLOCKED, changed { results, parallel_checks, events, replaced[] },
  errors[] }`.
- **`config-inventory.mjs reconcile`**: adds `sharedSource`, `ambiguous[]`, `chain[]`, `externalConfigs[]`,
  `unresolved[]` and `refresh[]` to its settings / changes / conflicts / backup.

## `run-stage.mjs` stage summary (`artifacts/progress/{run}-{stage}-{seq}.summary.json`, `skill5-run-stage/1`)

Existing fields (statuses, reasons, executed, counts, failures, notRun, isolation, interference, rateLimit,
groups, merged_stages, watchdog_events, timeout_events, code, telemetry (opt-in: `--telemetry`; else `{ disabled: true }`), cumulative, update) plus, all
optional for readers:

| Field | Shape |
|---|---|
| `smokeGate` | `{ failPct \| null, limit: 30, eligible, decision: continue \| classify \| no_verdict, verdict: PASS \| ABOVE_LIMIT \| NO VERDICT }` — eligible = PASS + FAIL |
| `interference[]` | `+ cause: test_data_conflict \| possible_product_concurrency_defect \| environment \| unexplained`, `cause_evidence[]`, `window {start, end}` |
| `isolation` | `+ deferred[]` (refused TCs whose server deadline exceeded `--max-wait`) |
| `deferred[]` | `{ tc, until (ISO), scope }` |
| `rateLimit` | `+ scopes[] { scope, kind: throttling, count, notBefore, tcs[], group, attempt }`, `unavailable` (count of 503 + Retry-After without rate-limit headers); `adjustments[]` `+ scope` (`environment` or the cooled-down scope) |
| `ledger` | `{ enabled, mode: ledger \| exclusive, exclusive?: { reason }, ceiling, source, dir, configured, refusedRaises[], ceilingLowered[], lowered[] { group, command?, from, to, by }, reservations[] { token, group, command, units, exclusive?, waitedMs, released, confirmed: table | none, killed?[], alive[], reason? }, sweep, demand { kind, memMbPerWorker, measured }, reserves, unavailable? }` — `mode: exclusive` when the ledger is off (`QA_LEDGER=off` / `--no-ledger`) or the process listing failed: one Playwright command at a time on the machine |
| `lease` | `{ envId, valid, reason, bookId }` — `bookId`: the shared rate-limit book `PW_RATE_LIMIT_STATE` names |
| `pressure` | `{ episodes[] { start, end, reason, peak, blockedAdmissions }, blockedAdmissions }` |
| `admission` | `{ file, updates, timeouts[], helperInstalled }` |
| `dispatch` | `{ scheduler: dispatch \| serial \| groups, schedulerDecision, units, pool[], conflicts[], timeline[] { unit, units[], command, attempt, start, end, workers, tcs[], global?, batch?, notAdmitted? }, validatedWorkers (null until a 60 s window closed), rampTarget, ramp[], rampRecords[] { now, batch, workers, completed, wallMs, durationMs, expectedMs?, cpuPct, availableMb, needMb, refusal, envRefusal, crash, interference, p95Ms }, next }` |
| `scheduler` | `{ requested: auto \| groups \| dispatch, used: dispatch \| serial \| groups, fallback: reason \| null, changed[] (readiness fingerprint parts), replanned }` |
| `host` | `{ samples, minAvailableMb, peakCpuPct, maxLagMs }` — the ledger's 2 s sampler (null in exclusive execution) |
| `display` · `status` | `{ headed, source: default \| --headless \| ci \| no-desktop, reason }` · the path of `artifacts/progress/status.json` (`skill5-status/1`: `{ at, event, stage, run, ceiling, ceilingSource, headed, activeWorkers, active[] { command, workers, tcs[] }, line }`) |
| `timeouts_shadow` | `{ mode: active (default) \| shadow, silence_ms, would_stop[] (shadow only) { group, command, attempt, worker, tc, step, at, silence_ms, deadline_ms }, long_deadlines[], stalls[] }` |
| `proposals[]` | ready `run_plan_adjustments[]` entries: `{ kind: move, tc, from, to, reason, evidence }` · `{ kind: rate-limit, service, to {…}, reason, evidence }` · `{ kind: workers, group, from, to, reason, evidence }` · `{ kind: ceilings, computed {group: ms}, formula, source }` |
| `groups[]` | `+ unit`, `lane`, `notAdmitted`, `stop.rule` (`deadline` \| `silence` \| `wait-budget`) |

## The admission file (`artifacts/progress/admission.json`, `skill5-admission/1`) — written only by `run-stage.mjs`

`{ schema, runId, seq, updatedAt, state: open | paused, reason | null, cooldowns: [{ scope, until }], maxWaitMs }`;
scopes `service:{name}` · `account:{A-ID}` · `endpoint:{METHOD path}` · `environment`.

## Heartbeat records (`PW_PROGRESS_FILE`) — all `{ at, worker, tc, … }`

Steps: `start {step, deadline_ms, note}` · `progress {step, note}` · `end {step, outcome: ok|timeout|error,
elapsed_ms, note}` · `evidence {path}` · `test-start {retry, project, repeat}` (`repeat` from 3.1 progress reporters) ·
`test-end {status}`.
Informational (never a step): `admission-wait {phase: start|end, reason, unit, waited_ms?, outcome?}` · `stall
{step, silence_ms, classification: ui_blocked|app_slow|no_activity, diagnostics}` · `teardown {}` ·
`console-report {entries, unexpected}` · `deferred {until, scope}`.

## Network-guard / rate-limit records (`PW_RATE_LIMIT_FILE`)

`{ at, worker, tc[], step, request_id, kind, method, path, url, host, account, status, retry_after_s,
retry_after_at, limit, remaining, reset_s, policy, window_s, latency_ms, error }`, `kind` ∈ `refused` (429, or
403 / 503 with rate-limit headers showing no quota) · `unavailable` (503 + Retry-After without them) ·
`server-error` · `policy` · `network-error`; the rate-limit helper adds `{ kind: paced, service, scope, wait_ms,
outcome: waited|exceeded|deferred, until? }`. Origin + path template only.

## The gate record (`.runs/phase-{N}.checkpoint-{A|B}.json`, `skill5-gate/1`) — written only by `check.mjs gate`

`{ schema, checkpoint, phase, verdict: PASS | FAIL | BLOCKED, snapshotId, snapshotFile, decidedAt, rehash {
matched, differences[] }, results[] { checkId, unit, snapshotId, status, reason, evidenceRef, executor, at },
rejected[] { checkId, unit, why }, na[] { checkId, predicate, evidence }, closed[], open[], fail[], auto[],
counts, freshness { stale[], source } (B), frozen { drafts { path: sha256 } } (B), gateA (B), tools {
skillVersion, scripts, validatorRules }, executors[], scopeDigest }`.

## The parallel readiness payload (`artifacts/parallel-plan.json`, `skill5-parallel-plan/1`)

`{ outcome, mode: readiness | shadow (--compare), stage, tcs { TC: { class, claims[], unit, effect, reasons[] } }, units[] { id, type:
U1|U2|U3|U4, chain, stages[], spec, specs[], describePath, tests[], tcs[], claims[] { key, mode:
read|write|aggregate-read|exclusive, source: field|inferred|learned|fail-safe, evidence }, class, expectedMs,
selector { specs[], describe, tcs[] }, scopes[], reasons[], after[], degree }, conflicts[] { a, b, keys[], kind,
evidence }, pool[], orderDependencies[], learned[], readiness {…}, candidatePlan? { groups[] }, comparison? {
handPlan, compared, agree, differences[], onlyHand[], onlyCandidate[] }, unlockSuggestions[], warnings[], review[] }` —
`candidatePlan` / `comparison` only with `--compare` (the shadow experiment). `inputs.fingerprint` = `readinessFingerprint()` `{ specs[], code, tcs, data, learning, runPlan, environment }`; `--out` writes a BLOCKED payload too. Scheduler `auto` re-plans a stale payload and runs serially on a missing / BLOCKED / unrefreshable one; `--scheduler dispatch` refuses a
payload of another schema, one with `outcome: BLOCKED` and one without `conflicts[]`.

## The coordination directory (`{QA_CAPACITY_DIR | ~/.link-ai-pro/capacity}/`, `capacity.mjs`)

`config.json` (`machineMaxWorkers` — written by hand: the UPPER BOUND of the Auto ceiling, `"auto"` / absent → 8 —, class limits) · `ramp.json` (the last validated worker count per environment and browser kind — performance history, a ramp trial target only) · `demand.json` · the ledger's shared `ceiling { value, at, by }` ·
`ledger.json` (`skill5-capacity/1`: `entries[] { token, class, units, state: spawning|active|releasing|orphaned,
owner, wrapper, child, descendants[], ended[], markers[], demand, environment, exclusive, liveness: table|pid, confirm?:
table, unconfirmed?, kind?: session-hold, session?, label?, lastSeenAt?, … }`, `leases { envId: { runId, runFile, owner, members[], tokens?[], bookId?, acquiredAt } }`, `books { bookId: { tokens[], createdAt } | { mergedInto } }` — a lease is valid
for its run id or its run file; `tokens` (`name:{host}`, `addr:{ip}`) make it exclusive for every OVERLAPPING environment —
`lease acquire` refused `held` with `heldBy { runId, envId, shared[] }` when another run's lease shares one) · `ledger.lock/owner.json` · `demand.json` (measured per-worker memory, written
by `run-stage.mjs`) · `rate-limits/{bookId}.json` (+ `.lock/`; a released lock that could not be removed holds `released-*.json`) — the shared
rate-limit book of a group of overlapping environment identities.

## `run-data.mjs` acceptance (`acceptance` in the draft run file, and the final call's payload)

`{ verdict: ACCEPTED | NOT ACCEPTED, reasons[], mode: pre-gate | final, conditional_on[], computed_at }`.

## The evidence record (`attempt-{a}[-failed].record.json`, `skill5-record/1`, 3.0) — written only by `helpers/record.ts`

`{ schema, tc, test_id, title, project, attempt, retry, layer, identity: verified | unverified | null, entries[], assertions[],
redaction{}, sha256 }`. An API entry: `{ id, seq, step, step_title, purpose: test | setup | teardown, channel: 'api', method,
effect, path (query values redacted except declared-safe keys), status, latency_ms, redirects[], request { headers, body },
response { headers, body } }`; a DB entry: `{ …, channel: 'db', op: read | insert | update | delete, name | table, sql
(parameterised, literals masked), params (masked except asserted positions), row_count, sample (asserted columns, ≤ 5
rows), read_back: ok | mismatch, identity }`. An assertion: `{ id, tc_line: 'ER{n}', entry_ref, target, outcome:
pass | fail }`. Every value outside an asserted / captured path is `<type:len>`, `[redacted]` or `sha256:…`; the seal
covers the canonical JSON. `scripts/redact.mjs checkRecordFile` is the validity test run-stage, run-data (item 54) and
skill 8's §6b identity check use.

## The data ledger (`artifacts/progress/{stage}-{group}[-attempt{n}].data-ledger.jsonl`, 3.0) — `helpers/data-ledger.ts`

One line per state change: `{ at, run_id, channel: api | db, state: intent | committed | verified | rolled_back |
teardown-intent | teardown-done | teardown-failed | retained | recovered, write_id, tc, attempt, step, purpose, op: insert |
update | delete | create | modify | remove, table | resource, key, intended?, host?, identity?, note? }` — keys and
intended values of the run's own records only. An intent without a later line is IN DOUBT. The stage summary carries
`data_ledger { files, writes, in_doubt, retained, orphaned, removed }`; `run-data.mjs report` turns the ledgers into
`retainedTable` / `inDoubtTable`, `verify` into item 53.
