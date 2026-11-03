# Stage 2 — Lightweight Checkpoint A & Test Data

## 1 · Coverage judgements — once
Write ONE file `{results_root}/artifacts/coverage-judgements.json` for every TC of the approved document (candidate or not):
```json
{ "tcs": [
  { "tc": "TC-01", "status": "Fully Covered", "mappedTests": ["tests/Orders_Tests/01-orders.spec.ts"] },
  { "tc": "TC-02", "status": "Partially Covered", "mappedTests": ["…"], "note": "the email part needs the mail server — manual" },
  { "tc": "TC-15", "status": "Not Covered", "category": "Not an automation candidate", "note": "needs a physical device" } ],
  "requirements": [ { "id": "REQ-001", "outcome": "Full" } ] }
```
`status`: Fully / Partially / Not Covered. A covered TC needs a test whose title carries `[TC-ID]` (the script checks it); a Not Covered TC
needs `category` or `note` — the explicit exclusion / blocker. `requirements[].outcome`: Full / Partial / Missing / Assumed. This is the only judgement
file of the stage; it also feeds the report's coverage block.

## 2 · Run the checkpoint
```
lite checkpoint-a --results-root {results_root} --phase {N} --files {specs + the POMs / fixtures / helpers they touch}
   --tc {doc} --data {TEST-DATA} --req {REQ file(s)} --coverage {judgements}
```
- `--files` = what this run created or changed plus the shared files they import (never the whole project). On a refresh after a heal: the
  changed files only; the script remembers the story's specs, so traceability still sees them.
- Output: `checks {tsc, pom, traceability, assertions}` each PASS / FAIL / OPEN, `safety`, `problems` (≤ 10 `check: file:line rule`), `next`.
  `tsc` also runs `playwright test --list --reporter=list` (throw-away output, no stage variables — it writes nothing under the results,
  artifacts, reports, screenshots or logs roots, so no result goes stale) on the story specs in the run's project(s): a spec that does not
  load (tag without `@`, unknown project, a spec the config's `testMatch` misses) FAILs here, not at smoke. `traceability` reads its
  **resolved** titles (`traceability: resolved titles (n)`): every resolved title carries exactly one `[TC-ID]` of the document, one test per
  TC variant; the problem names the resolved title. Static titles are the fallback only when the list cannot run. A declared journey
  listed in the run file (`lite journey`) is exempt from the `[TC-ID]` rule only; an undeclared one, or a journey with a `[TC-ID]`, FAILs.
  `signIns {warn}`: a non-sign-in test drives the sign-in page more than once — use the recorded auth strategy (stage 1 §4). `ledger {warn, tcs}`: consented TCs whose spec reaches no
  ledger call — route those changes through `recordChange` (stage 1) and run the checkpoint again before smoke. `ownership {fail, warn}`
  (safety lane — a FAIL fails the gate): the ledger labels read statically, as check 53 will at B — a `modify` / `remove` of a resource
  no ledger call in scope creates, or any `modify-external`, is named `file:line`; relabel it (stage 1), never loosen it. A computed op,
  target or key is a warning (proven only at B).
- **PASS** is recorded by the script (`.runs/phase-N.checkpoint-A.json`) — no approval step. **FAIL / BLOCKED**: fix the listed code (never the
  rule), run the same command again; an unchanged scope reuses the mechanical run. Never bypass: no `qa-allow.json` entry without a real,
  reasoned exception (Full `validator.md`).
- `assertions` items marked `assertions-conditional` / `assertions-unresolved`: static analysis cannot prove the assertion runs. Read ONLY
  those `file:line`s, and if the assertion is real pass `--assertion-review {file}` = `{ "snapshot": "{snapshotId from the output}", "items":
  { "{file:line rule}": "what it asserts and why it always runs (≥ 8 chars)" } }`. Otherwise fix the code. Never put a credential in the text.
- `safety` FAIL = a provable execution-safety violation (focus-only, unbounded timeout, disabled run protection, hardcoded credential): repair
  (`config-inventory.mjs reconcile --apply` fixes protections). Warnings are reported in the return, not blocking.

## 3 · Test data
- **Reuse first:** the TEST-DATA rows the document references; check each exists with the cheapest probe (the app, an existing helper). A
  missing item that a TC needs: try an existing helper / UI journey; otherwise mark the TC `SKIP` with its reason (`data_missing`) — it stays
  visible in the report, never dropped. Full `test-data-preparation.md` only for a MISSING / IMPOSSIBLE item you cannot resolve in two tries.
- **Data changes** (a TC creates / modifies / deletes data): ask ONE message listing the TCs and what each changes; proceed only with the
  tester's per-TC yes (`--allow-data-changes` answers it); environment class must be `test` / `staging`; records are named by `uniqueName()` and
  swept by `runPrefix()`; the data-ledger helper records every change. Never modify a record this run did not create. Record the answer
  with `lite consent --run-file {rf} --allow-data-changes all|TC,…|none` (it writes `consent`, `tcs`, `setup`, `cleanup`, `asked_at`) —
  never write `data_changes` by hand; a descriptive record is ignored by run-stage and check 53.
- Record what you created / changed in the learning file (`[type: data]`) — generic wording.

Done when `checkpoint-a` is PASS and every data prerequisite is ready or its TC is a visible SKIP. Next: stage 3.
