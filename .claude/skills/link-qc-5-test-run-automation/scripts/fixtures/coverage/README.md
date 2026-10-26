# coverage fixture

- `judgements.json` — the model's judgements for five TCs of `US-9001 — Sample orders` (smoke TC-001 Fully · positive
  TC-002 Fully, TC-003 Partially · negative TC-004 Partially, TC-005 Not Covered / not a candidate) and four requirements.
  Weighted: smoke 100 · positive 75 · negative 25 · total 60 % — below the default 80 % target (soft block).
- `story/.runs/phase-1.json` — the previous phase's coverage_snapshot (50 %: TC-002 Partially, TC-004 Not Covered, no
  TC-005) → delta +10 pts, improved TC-002 and TC-004, TC-005 added.
- `story/.runs/phase-2.json` — the current phase's run file without a snapshot (`--write` sets it in the harness copy).
- `TEST-CASES-sample.md` — the approved document's summary table (the five TC-IDs) for the completeness check.

Every expected value in `selftest-coverage.mjs` is computed by hand from these files.
