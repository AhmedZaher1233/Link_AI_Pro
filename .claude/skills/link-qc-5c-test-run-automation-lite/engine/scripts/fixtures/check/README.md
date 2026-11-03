# Fixtures — `selftest-check.mjs`

Inputs for the harness of `scripts/check.mjs`. Nothing here is executed by Playwright; the harness copies `project/`
into a temporary folder before it takes snapshots, records results or edits a file, so this folder is never written.

| Path | Purpose |
|---|---|
| `project/` | a miniature consumer project (`Testing/qa-manifest.json`, `Testing/Automation/…`): the shared config with `actionTimeout: 0` and no `navigationTimeout` (A15 report), `timeouts.ts` with one 15-minute operation (a deadline ≥ 10 min), a page object, an evidence helper, an evidence image stub for the Checkpoint B manifest, the TC document (TC-01, TC-02), TEST-DATA and REQ-001 |
| `project/Testing/Automation/tests/orders.spec.ts` | compliant like `fixtures/valid.fixture.ts` — kept free of comments so no comment can read as a justification |
| `project/Testing/Automation/tests/bad.spec.ts` | violates `focus-only` and `pom-raw-locator` on purpose — the mechanical results are compared with the validator's own gate (T-31) |
| `run-file.json` | `.runs/phase-1.json` at Checkpoint A: run plan with a start-of-test rate limit only, readiness with no gap |
| `drafts/` | the Checkpoint B drafts (run file with `impact.final_check.stale: []`, report, bug file, page stub) |
| `impact-fresh.json` · `impact-stale.json` | `impact.mjs select` payloads: no stale TC / TC-02 stale |
| `bin/fake-tsc.mjs` | `FAKE_TSC=fail` → one TS2307 diagnostic, exit 2; otherwise exit 0 |
| `bin/fake-eslint.mjs` | `FAKE_ESLINT=floating` → one no-floating-promises error; otherwise no message |
| `eslint/typed/` · `eslint/plain/` | lint configurations with / without type information (Check 27 deterministic or not) |

Every expected number in the harness is worked out by hand from these files and the check catalogue (`CHECKS` in
`check.mjs`); the comments of each case show the arithmetic. Regenerating anything is never needed — there are no
goldens.
