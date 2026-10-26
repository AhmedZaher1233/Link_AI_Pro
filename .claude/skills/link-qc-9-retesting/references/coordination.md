# Coordination — the environment lease and the machine's worker ceiling (steps 3, 4, 5, 9)

Loaded by SKILL.md step 3. A retest drives the same application environment and the same machine as a skill 5
run, so it takes part in skill 5's coordination — never beside it. Skill 9 calls skill 5's script by path and never
copies, imports or edits it:

```text
.claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs   the environment lease and the session holds
```

Skill 5's folder absent → no coordination is possible: **BLOCKED** for every route ("environment coordination
unavailable — install link-qc-5-test-run-automation with /sync-skills"). Nothing is executed, no report changes,
Azure is untouched.

## 1. Run id

One id per invocation, `skill9-{US-leaf or source}-{yyyymmddThhmmZ}` (UTC) = `{runId}`, used by every lease and
hold of the run. Never phase N's `run_id`: that run is skill 5's, and its lease is not skill 9's to take over.

## 2. The lease — before anything touches the environment

After the combined ask (step 3) confirmed the environment and before any login, data preparation, `run-stage.mjs`
call or playwright-cli `open`, once per environment of the run:

```text
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease acquire
  --env {base URL (E1)}[,{every other host of TEST-DATA ## 0. Environment}] --test-data {TEST-DATA md}
  [--aliases {a=b,…} from the learning file's [type: env] lines]
  --run-file {results_root}/.runs/phase-{N}.json --run-id {runId} --wait 600000 --strict
```

- No story run file (a UI bug only): `--run-id {runId}` without `--run-file`.
- Exit 0 (`ok: true`) → record the payload's `envId`; it is held through every route, every retest, data
  preparation, clean-up and the questions in between — a long pause never releases it.
- Exit 1 (`code: held`, after the 10-minute wait) → **BLOCKED** for every bug on that environment, first line of the
  reply: "the environment is leased by run {heldBy.runId} ({heldBy.runFile}) — a skill 5 run or another retest is
  using it; retest after it finishes". A lease whose run is known to be gone is the user's to release
  (`capacity.mjs lease release --env-id {envId} --run-id {heldBy.runId}`) — never yours.
- Exit 2 (no owner process found, an unreadable ledger, a coordination directory that is not writable) → **BLOCKED**
  with the payload's `error`. Never a retest without the lease.

## 3. Automation route — `--env-id`

Every `run-stage.mjs` call of the run carries `--env-id {envId}` (automation-rerun.md §3). run-stage accepts this
run's lease because it names the phase's run file, runs every command inside the machine's worker ceiling (the
capacity ledger; with `QA_LEDGER=off`, exclusive execution — one Playwright command at a time on the machine), and
refuses to start anything while another run holds the environment. Its payload decides, never a retry another way:

| Payload | Bugs of that call |
|---|---|
| `BLOCKED` naming the `environment lease` or `no safe coordination` | unobserved — `NOT_RUN` with the payload reason |
| a TC `NOT_RUN` `not started: admission timeout (…)` · `host pressure` · `no safe coordination (…)` | unobserved — `NOT_RUN` with that reason |

## 4. playwright-cli route — one session hold per open browser

A playwright-cli browser counts against the same machine ceiling as a Playwright worker — the same holds skills 3c and
5b take. Before the `open` of each session (browser-cli.md §3):

```text
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs hold acquire
  [--run-file {results_root}/.runs/phase-{N}.json] --run-id {runId} --session {session} --workers 1
  --label "playwright-cli {session}" --wait 600000 --strict
```

- `{session}` = the `-s=` name (`qa9-{storyId}-{accountId}`). Exit 0 → keep the payload's `token`, `open`, then once
  `capacity.mjs hold track --token {token}`. Acquiring the same session again (a re-`open`) reuses its hold — never
  counted twice. Two sessions open side by side (two roles) = two holds.
- After that session's `close`: `capacity.mjs hold release --token {token} --wait 30000 --strict` — exit 0 = confirmed
  closed; exit 1 = the session still runs: `close` it again and release again; still 1 → name it in the final message
  (the hold stays until a process table shows the session gone).
- Exit 1 after the wait (the machine is at its ceiling — a skill 5 run is using it) → that session's bugs are
  `NOT_RUN (not started: machine at its worker ceiling)`; never open the browser anyway.
- With `QA_LEDGER=off` the hold is exclusive: granted only when nothing else runs, and nothing else starts while it
  is held — release it as soon as the session closes.
- The hold belongs to the Claude Code process. If that process dies while the browser still runs, the hold stays
  (orphaned) until a process table shows the session gone; a hold whose session was closed without a release is freed
  after a short grace.

## 5. Release — at the end and on every stop after the acquire

Step 9, and every BLOCKED / stop after step 3: close every playwright-cli session, then

```text
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs hold release --run-id {runId} --wait 30000 --strict
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease release --env-id {envId} --run-id {runId} [--quiet-ms {ms}]
```

The hold release exits 1 while a session of the run still runs — close it and release again. `--quiet-ms` only when this run created or changed data whose background effects (mails, jobs, indexing) are still
pending — the learning file's quiet period for that environment, if recorded. The final message carries one line:
`Coordination: lease {envId} held {from} – {to} · {n} session hold(s) · released` (or the BLOCKED reason).

## 6. Never

- Never edit `ledger.json`, `config.json` or a lease by hand; never `--force`, never `reclaim` or `sweep` (user-run).
- Never set `QA_LEDGER`, `QA_MAX_WORKERS` or a capacity config to make a retest start — report what blocks it.
- Never retest on an environment this run does not hold, and never through another route because coordination
  refused the first one.
