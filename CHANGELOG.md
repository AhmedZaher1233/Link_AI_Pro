# Changelog

All notable changes to the Link_AI_Pro skill suite. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); consumer projects pick a change up on
their next `/sync-skills`, so every entry under *Unreleased* is a release once it is pushed to `main`.

## [Unreleased]

### Test runners (5, 5b) and live validators (3b, 3c) prepare missing test data instead of skipping

Shared, word for word in the four skills: the **twelve preparation principles** and the **consent
by way** table (discover before skipping in the order learning file → automation helpers → the
application's source code → UI journey → DB helper → manual; the skill prepares the item itself; a
UI journey needs no question, an existing helper runs under the run's data-changes "yes", an
endpoint read from the source code and a database write each need an explicit "yes" asked once
after discovery; temporary seed in the scratch folder, never new code in the repository;
dedicated, right-sized fixtures; verified on the oracle before use; system-stamped values read
back and routed to skill 3; the real rule checked, not just the screen; `NOT CREATABLE` with
evidence instead of "data missing"; a permission refusal stops the step; no secrets anywhere;
keep or clean up asked once after the run, default keep).

- **link-qc-5b-test-run-manual-cli**
  - Invariant 10 and workflow steps 6 / 6b / 11: missing data is prepared, not skipped; skips only
    as `data_missing` (no way found), `not creatable` (evidence) or `QC declined`.
  - New `references/test-data-preparation.md` (principles, inventory of record, the five statuses
    incl. `NOT CREATABLE`, the nine preparation steps, the two questions, readiness decisions,
    learning-file lines, worked example with four MISSING items and no "data missing" outcome).
  - `intake.md` §3 (consent and keep / clean-up rows), `execution-rules.md` §3-§5 and §7,
    `run-report-manual.md` (`Data preparation` Run bullet, the nine-column readiness table, the
    stamped-value Deviation shape, `data_readiness` now written to the run file), `run-plan.md`,
    `learning-file.md` (prepared fixtures, not-creatable evidence, consent answers),
    `ai-response-rules.md`, `INPUT.txt`.
  - `self-review.md`: fourteen checks (no `data_missing` where a way existed; every prepared item
    verified before its dependents; no seed left in the repository; no credential in any output);
    hard-check failures now consistently `app_bug`.
  - Harness: the manual-run fixture gains a `prepared (api)` item with a stamped value, a
    `skip — not creatable` TC and a stamped-value Deviation; golden regenerated;
    `selftest-manual-run.mjs` asserts the readiness counts.
- **link-qc-5-test-run-automation**
  - PHASE 2.6 rewritten: helpers found through the manifest paths and a generic search; the
    application's source code searched for create endpoints (skill 10's profile first); the QC
    asked only for an endpoint from the source / a DB write and for gaps with no way; UI journeys
    and existing helpers prepared without asking; non-interactive default prepares the automatic
    ways; temporary seed (kept as a fixture only on request); dedicated right-sized fixtures;
    seed-once kept; verify before use; stamped values propagated through the test-data layer;
    rule-level verification; `NOT CREATABLE` distinct from `IMPOSSIBLE`; refusals stop and ask;
    keep by default, clean-up asked once after the run; `data_readiness` keys aligned with the
    fixture (`gaps` / `predicted_skips`) plus `identifiers` / `stamped_values` / `verified_on`.
  - `references/run-report.md` §4 readiness row (nine columns, decision vocabulary, counted by the
    renderer) and §7 run-file shape; checklist items, the `data_missing` failure-table row, the
    learning-file line, the final-message block and summary row; `INPUT.txt`.
  - `scripts/render-run-report.mjs`: the readiness table's `Decision` column is parsed into
    per-phase counts (`document.phases[].readiness`), shown as a `Decisions:` line, legacy bare
    words still accepted, `unknown-readiness-decision` warning; a bare `all ready` body renders
    as the verdict. Fixture and golden updated; harness case 29. Mirrored to 5b.
- **link-qc-3c-validate-manual-test-cases-cli**
  - Invariant 18 rewritten to the consent model; workflow step 4b (consent ask), steps 8 / 9 / 11;
    READ-ONLY / COMPARISON lines; Permissions (temporary seed through the normal permission flow).
  - `references/test-data-resolution.md` rewritten: principles + consent table (`SHARED-3B-3C`
    blocks), `api` available through an existing helper or an endpoint in the source (pending the
    user's yes), the nine-step preparation run for every way, delivered statuses (kept → `READY`,
    removed → `MISSING` with a recreate note, `NOT CREATABLE` with evidence), one post-walk ask
    (keep / clean-up + undecided items), return lines, worked example with TEST-DATA rows and TC
    stamps.
  - `walk-rules.md` §3a / §6 / §6a, `discovery-plan.md`, `intake.md` §3, `patch-rules.md` §3 / §6
    / §7 / §8, `self-review.md` check 12, `cli-vs-mcp-comparison.md` (both runs switched off),
    `tc-format-contract.md` (stamp key `data`), `INPUT.txt`.
- **link-qc-3b-validate-manual-test-cases**
  - Full data-changes model (user decision, 2026-10-13): new invariants 16 (data changes) and 17
    (test data), `mcp-pass.md` §3a, the data-changes question in `intake.md` §3.
  - New `references/test-data-resolution.md` — 3c's file with the Playwright MCP wording in the
    tool sections and the `SHARED-3B-3C` blocks byte-identical; preparation only for items whose
    dependents are inside the chosen scope (`scope-gate.md` §1 item 8, §4); workflow steps 7c
    (consent ask), 8b (preparation), 9, 11; `patch-rules.md` §3 / §6 / §7 / §8 (`Data changes`
    and extended `Test data` return lines, `Data plan` audit line); `self-review.md` check 11;
    `tc-format-contract.md`; `INPUT.txt`.
- **Mirrored across 3 / 3b / 3c** (`validation-states.md`, `learning-file.md`, `html-page.md`):
  draft reasons `data missing — D{n}` / `data not creatable — D{n}`, the `data:` stamp key, the
  prepared-fixture and not-creatable learning lines, the fifth test-data status.
- **link-qc-3-generate-manual-test-cases** (shared renderer and TEST-DATA contract)
  - `scripts/render-tc-review.mjs`: `NOT CREATABLE` accepted as the fifth TEST-DATA status,
    counted (`counts.testData.notCreatable`), badged `d-not-creatable`; the data header note shows
    five counts (EN + AR); sample fixture gains a `NOT CREATABLE` item and a Problems row; goldens
    regenerated; harness case 29 (31 cases incl. 0 and 27). `assets/report-shell.template.html`
    gains the badge rule (mirrored five ways: 3, 3b, 3c, 5, 5b).
  - `references/deliverables.md` / `tc-design.md`: five status words, `NOT CREATABLE` never written
    by skill 3, "3b / 3c" as live checkers.
- **link-qc-12-adhd-output-style** overlay rows for 3b, 3c and 5b.
- **Docs**: README sections for 3b, 3c, 5 and 5b; CLAUDE.md (the principles as a hard rule, the
  3b/3c shared-block rule, reference and harness counts, the changelog convention in *Git*).
