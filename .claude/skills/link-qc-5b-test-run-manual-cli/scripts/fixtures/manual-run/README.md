# Manual-run fixture (skill 5b only — not mirrored)

A synthetic story `US-2000-ask-assistant` in skill 5's report layout with TWO phases in the same files:
phase 1 written by skill 5 (automation: TC-001 PASS, TC-002 app_bug → BUG-1, TC-AI-01 SKIP because
its reply differs every run) and phase 2 written by this skill (manual run through playwright-cli:
TC-001 and TC-002 PASS — BUG-1 resolved by the manual retest —, TC-AI-01 FAIL `ai_rubric_failure`
with two repeats `manual-cli--none--r0` / `r1`, each with its `reply.md` beside the screenshot, → BUG-2
in the assistant voice, TC-030 `PARTIAL — human step pending`, TC-040 `SKIP` because its data is
`not creatable` on UAT; one data item `prepared (api)` through the automation project's helper with a
system-stamped value substituted for the run and routed to skill 3 as a Deviation). It proves that the
mirrored renderer renders a manual phase after an automation phase with the shared phase counter and bug
numbering, the `manual run — playwright-cli` Run bullets, the `— (manual run)` compliance line, the new
classification without a warning, the reply links as plain evidence links, and the test-data readiness
decisions (`prepared (api)` · `skip — not creatable`) counted on a `Decisions:` line.

```text
automation/
  reports/US-2000-ask-assistant/TEST-RUN-REPORT-ask-assistant.md · BUG-REPORT-ask-assistant.md · .runs/phase-1.json · phase-2.json
  screenshots/US-2000-ask-assistant/phase-1/…/chromium--none--r0/attempt-1[-failed].png
  screenshots/US-2000-ask-assistant/phase-2/…/manual-cli--none--r{0,1}/attempt-1[-failed].png (+ reply.md for TC-AI-01)
golden/TEST-RUN-REPORT-ask-assistant.html   the page the mirrored renderer must reproduce byte for byte
```

The fixture is generated once and committed; `selftest-manual-run.mjs` works on a temporary copy.
Regenerate the golden only for a deliberate renderer / template change (after regenerating skill
5's golden and re-mirroring):

```bash
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/render-run-report.mjs --report .claude/skills/link-qc-5b-test-run-manual-cli/scripts/fixtures/manual-run/automation/reports/US-2000-ask-assistant/TEST-RUN-REPORT-ask-assistant.md --write --force --out .claude/skills/link-qc-5b-test-run-manual-cli/scripts/fixtures/manual-run/golden/TEST-RUN-REPORT-ask-assistant.html --strict
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-manual-run.mjs --pretty
```
