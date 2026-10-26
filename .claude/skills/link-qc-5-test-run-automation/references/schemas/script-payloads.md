# Script payloads and records — the shapes, for when an output needs explaining

Loaded by no activity. Open it only when a script's payload, a gate record or a helper record needs to be
read field by field. The rules these shapes serve live in their homes (`references/rule-registry.md`).

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
elapsed_ms, note}` · `evidence {path}` · `test-start {retry, project}` · `test-end {status}`.
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
