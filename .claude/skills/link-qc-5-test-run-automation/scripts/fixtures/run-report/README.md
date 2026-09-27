# Run report fixture

A synthetic story `US-1234-create-order` (no `SPEC-*` parent) with two phases, laid out exactly as
a consumer project's `Testing/Automation/` would be, so the report's relative screenshot links
(`../../screenshots/US-1234-create-order/…`) resolve the same way:

```text
automation/
  reports/US-1234-create-order/
    TEST-RUN-REPORT-create-order.md   phase 1 FAILURES (TC-010 app_bug → BUG-1, TC-007 healed after a retry, TC-020 skipped)
                                      phase 2 INCOMPLETE (TC-007 missing variation B, TC-010 passes → BUG-1 resolved, BUG-2 opened,
                                      TC-030 `PARTIAL — human step pending` — ran up to its [HUMAN] step 4, classification `human step: 4`,
                                      counted in the Partial column / ` · 1 partial` of the header, never as passed)
    BUG-REPORT-create-order.md        BUG-1 resolved (phase 2) with a screenshot, BUG-2 open with none captured
    .runs/phase-1.json, phase-2.json  schema skill6-run/1 — variants, attempts, totals, coverage snapshot, compliance
  screenshots/US-1234-create-order/phase-{1,2}/…/attempt-*.png   1×1 PNG stubs, not application evidence
golden/TEST-RUN-REPORT-create-order.html   the page the renderer must reproduce byte for byte (case 1)
```

Every harness case works on a temporary copy of `automation/`; the fixture itself is never written.

Regenerate the golden **only for a deliberate renderer or template change**, from the repository
root, then re-run the harness and review the diff of the golden before committing:

```bash
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report .claude/skills/link-qc-5-test-run-automation/scripts/fixtures/run-report/automation/reports/US-1234-create-order/TEST-RUN-REPORT-create-order.md --write --force --out .claude/skills/link-qc-5-test-run-automation/scripts/fixtures/run-report/golden/TEST-RUN-REPORT-create-order.html --strict
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-report.mjs --pretty
```

To look at the page in a browser, render it **beside the fixture markdown** (omit `--out`) so the
thumbnails and the viewer find the PNG stubs, then delete the generated HTML from the fixture folder.

The golden is rendered through two templates: `assets/run-report.template.html` (the body partial)
and `assets/report-shell.template.html` (the shared report shell, byte-identical in skills 3, 3b and
3c). A shell change changes this golden and skill 3's three goldens; regenerate all four. The
fixture folder holds no `REVIEW-COMMENTS-create-order.md` on purpose: case 24 writes one into a
temporary copy.
