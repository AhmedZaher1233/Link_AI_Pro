# run-data fixture

A synthetic story `US-9001-sample` (feature `sample`, phase 1, no `SPEC-*` parent) laid out as a consumer project's
`Testing/Automation/` would be, so the run file's automation-root-relative paths and the report's relative links resolve:

```text
automation/
  reports/US-9001-sample/
    .runs/phase-1.json                                the run file in progress (status running) — model fields only
    artifacts/drafts/phase-1/.runs/phase-1.json       its draft (same bytes) — `merge --write` fills the mechanical blocks
    artifacts/drafts/phase-1/TEST-RUN-REPORT-sample.md  the draft report, written to match the merged phase
    artifacts/drafts/phase-1/BUG-REPORT-sample.md       the draft bug file (no bugs)
    artifacts/progress/{run}-{stage}-1.summary.json   four run-stage.mjs summaries (first smoke / positive / negative, re-run positive)
    artifacts/progress/{stage}-{group}[-attemptN].jsonl  the heartbeat of each command (evidence / teardown / console-report)
    artifacts/stages/{stage}-{group}[-attemptN].json  the raw Playwright JSON of each command
  automation-logs/US-9001-sample/run-progress-2026-10-01-0900.log
learning.md                                           a learning file without a credential
```

The screenshot stubs (`automation/screenshots/US-9001-sample/phase-1/…`) are written by the harness into its temporary
copy (`SHOTS` in `selftest-run-data.mjs`), never committed here.

What happened in the phase (every expectation in the harness is computed from this by hand):

| TC | Stage | Group | Commands | Result of record |
|---|---|---|---|---|
| TC-001 | smoke | parallel | smoke-parallel (PASS) | PASS, `TC-001/chromium--none--r0/attempt-1.png` |
| TC-002 | positive | parallel → serial:interference | positive-parallel (FAIL beside TC-005), isolation attempt 2 (PASS alone) | PASS (interference, cause `unexplained`, no resolution), `attempt-2.png` |
| TC-003 | positive | serial:orders | positive-serial-orders (FAIL, step timeout), re-run burn-in attempt 2 (3 × PASS → r0 attempt-2, r1 attempt-1, r2 attempt-1) | PASS, re-run `impacted`, evidence `r2/attempt-1.png` |
| TC-004 | negative | parallel | negative-parallel (SKIP — readiness `skip — QC declined`) | SKIP, `data_missing` |
| TC-005 | positive | parallel | positive-parallel (variation A PASS), isolation attempt 3 (overlap re-run, PASS) | INCOMPLETE — `incomplete: chromium--variation-b--r0` |

Totals: 5 TCs — 3 passed · 0 failed · 1 incomplete · 1 skipped · 0 not run; variant totals 4 passed · 1 skipped ·
1 not run. Hand-edit a file only together with the harness expectations that depend on it.
