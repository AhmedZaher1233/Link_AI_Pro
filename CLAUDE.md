# CLAUDE.md

Guidance for Claude Code when working **inside this repository**.

## What this repo is

`Link_AI_Pro` is the **canonical source** for a suite of Claude Code QA skills that carry a User
Story from requirement review → manual test cases (design) → optional live validation →
implementation audit → Azure DevOps publishing → Playwright automation. It contains **no
application code, no package.json, no build and no application test suite** — the deliverable is
prompt/instruction content plus zero-dependency Node scripts (five `.mjs` + two pairs of user-run
shell scripts under skill 1, five under skill 5, and the review-page renderer + its self-test
mirrored under skills 3, 3b and 3c).

Consumer projects pull the skills from here with `/sync-skills`. Nothing project-specific ever
belongs in this repo. The sync set is `SKILLS` in `lib.mjs`: fifteen folders named `link-qc-{N}-{purpose}` in
test-cycle order — 1 setup, 2 review, 3 / 3b / 3c manual TCs and their live validation, 4 publish, 5 automation,
5b manual CLI run (report only), 6 UI audit (beside the chain, gates nothing), 7-9 the optional Azure loop (TC outcomes, two-way bug sync,
retest), 10 white-box, 11 business rules, 12 the ADHD chat output style (beside the chain, chat only,
writes nothing). Every folder name equals its frontmatter `name`. Prose says
"skill N" with these numbers; the pre-`link-qc` folder names live only in `SKILL_RENAMES` (consumer migration).

**Two worlds — don't confuse them:**

| | This repo (authoring) | A consumer project (runtime) |
|---|---|---|
| Content | `.claude/skills/`, `.claude/commands/`, `docs/steering/` | `Testing/`, `docs/steering/`, `.mcp.json`, synced `.claude/skills/` |
| Your job here | edit skill instructions, scripts, templates | run the skills |

Paths like `Testing/qa-manifest.json`, `Testing/project-learning.md`,
`Testing/Requirements/US-{id}-{name}/` described throughout the skills refer to the **consumer
project**, not to this repo. Do not create them here.

## Layout

```
.claude/
  skills/
    link-qc-1-generate-update-testing-structure/   QA foundation: audit / repair / restructure
      SKILL.md INPUT.txt references/ (10, incl. azure-mcp-troubleshooting.md — CANONICAL, mirrored in 2, 3, 4, 5, 7, 8, 9, 11) scripts/ (4 .mjs + selftest.mjs + fixtures/mcp/ + set-azure-devops-pat + check-azure-devops-pat + set-playwright-secrets .ps1/.sh) assets/ (4 templates + mcp-launchers/azure-devops-attachments.cjs)
    link-qc-2-review-requirements/                 story/spec → REQ-*.md + review
    link-qc-3-generate-manual-test-cases/          manual TCs (EN/AR), DESIGN ONLY, rendered HTML review page (human gate)
      SKILL.md INPUT.txt references/ (8) scripts/ (render-tc-review, selftest, fixtures/) assets/ (2: tc-review body partial + report-shell — the one general HTML page, shared with skill 5)
    link-qc-3b-validate-manual-test-cases/         OPTIONAL live validation of a TC doc (Playwright MCP), patches in place — the default validator
      SKILL.md INPUT.txt references/ (11, incl. test-data-resolution.md — SHARED-3B-3C blocks byte-identical with 3c's) scripts/ + assets/ = byte-identical mirrors of skill 3's
    link-qc-3c-validate-manual-test-cases-cli/     OPTIONAL evaluation twin of 3b on playwright-cli (no MCP); same contracts; NO scope gate (walks every TC); comparison protocol
      SKILL.md INPUT.txt references/ (13, incl. test-data-resolution.md — shared contract with 3b) assets/ (template mirror + comparison template) scripts/ = mirrors of skill 3's
    link-qc-4-publish-test-cases-azure/            beautify approved TCs → Azure DevOps + ADO-MAP.md with verified tags / automation status; --suite-only places published TCs in a Test Plan suite later
      SKILL.md INPUT.txt scripts/ (ado-sync-plan, tc-hash — canonical copy, selftest-ado-sync + fixtures/ado-sync/)
    link-qc-5-test-run-automation/                 Playwright POM generation (automation inventory first) + staged run (one run-stage.mjs call and one message per stage, isolation check inside, inside the machine's capacity ledger and an environment lease) + targeted re-run of the TCs a fix touched (impact.mjs) + 2 script-decided compliance gates (check.mjs) + drafts → freeze → Checkpoint B → publish (run-data.mjs) + run acceptance
      SKILL.md (≈200 lines: orchestrator — workflow with activity names, every-activity rules, block index; `metadata.version` = the skill's semver) INPUT.txt references/ (19, one per activity: intake, results-and-evidence, azure-devops, code-generation, run-plan-and-config, open-questions, coverage, test-data-readiness, test-data-preparation, execution, final-run, structured-returns, compliance-checkpoints, automation-rules, code-craft, validator, run-report, scratch-investigation, azure-mcp-troubleshooting — plus rule-registry.md, the maintainers' one-home-per-rule map, expected-differences.md, the 1.2.0 → 2.0 gate parity register, and schemas/script-payloads.md, loaded by no activity) scripts/ (33 + fixtures/: the 31 below plus tc-hash — mirror of skill 4's — and selftest-tc-hash) assets/ (11: run-report body partial + report-shell mirror, 9 *.template.ts copied into consumer projects)
    link-qc-5b-test-run-manual-cli/                manual twin of 5: every TC of an APPROVED document run in full through playwright-cli (no MCP), smoke gate without heal, `AI Oracle` TCs judged by rubric; writes skill 5's report set into skill 5's story folder — report only, gates nothing
      SKILL.md INPUT.txt references/ (10: intake, browser-cli, run-plan, execution-rules, test-data-preparation, ai-response-rules, run-report-manual, open-questions, learning-file, self-review) scripts/ (render-run-report, selftest-run-report, scan-lib + fixtures/run-report/ — mirrors of skill 5's; selftest-manual-run + fixtures/manual-run/ — 5b-only) assets/ (2: run-report body partial + report-shell — mirrors)
    link-qc-6-ui-testing/                          visual UI audit of one implemented screen vs its design (Playwright MCP; optional Figma MCP) or, with no design, vs tokens / consistency / WCAG / RTL — beside the chain, gates nothing
      SKILL.md (≈420 lines, orchestrator) INPUT.txt references/ (10: capture-and-files, no-design-audit, measurement-passes, coverage-passes, bug-metadata, annotation, annotation-fallback, report-template, learning-and-coverage-index, second-round) — no scripts
    link-qc-7-sync-tc-status-to-azure/             Azure loop: latest TC outcomes → ONE Test Plan run (cloud test-plan tools; otherwise NOT_RUN) — SKILL.md INPUT.txt references/qc-contract.md (mirror)
    link-qc-8-sync-bugs-azure/                     Azure loop: two-way bug sync, direction gate (md → Azure creates + pushes · Azure → md pulls · both), ADO-BUG-MAP.md ledger; evidence attached through the contract's capability ladder after the §6b identity check, verified by read-back
      SKILL.md INPUT.txt references/ (qc-contract.md — CANONICAL copy, md-to-azure.md, azure-to-md.md)
    link-qc-9-retesting/                           Azure loop: retest bugs — automated TCs re-run from skill 5's code (run-stage.mjs), the rest through playwright-cli, never the Playwright MCP; the LATEST run-report phase updated in place (pass rate); close / reopen in Azure, THEN the evidence upload; incidental bugs; its own environment lease + one session hold per playwright-cli browser through skill 5's capacity.mjs — SKILL.md INPUT.txt references/ (qc-contract.md mirror, automation-rerun.md, browser-cli.md, report-update.md, coordination.md)
    link-qc-10-white-box-testing/                  code audit against a requirement
    link-qc-11-discover-business-rules/            code-enforced rules (EARS) not in the spec
    link-qc-12-adhd-output-style/                  ADHD chat output style + QA-pipeline overlay (was `i-have-adhd`); chat only, writes no file
      SKILL.md INPUT.txt references/qa-pipeline.md — no scripts, no learning section, no MCP
    find-skills/                           helper skill (not part of the sync set)
  commands/sync-skills.md                  thin wrapper over scripts/sync-qa-skills.mjs
  agents/                                  empty
docs/steering/                             L1 / L2 / L3 quality-authority documents
README.md                                  the full user-facing documentation — keep it current
```

Every skill folder has `SKILL.md` (what Claude follows) and `INPUT.txt` (what the user must
provide / gets back). Read `README.md` for the pipeline diagram and the shared conventions; it is
the most complete description of the system and is treated as part of the product.

## Scripts

Node ≥ 18, ESM, zero dependencies, read-only, result returned as a JSON payload (`--pretty` for
human output). Skill 1 owns the project-setup scripts; skill 4 owns the Azure sync decision script
and the canonical TC hash; skill 5 owns the automation-code validator and the one runner,
`run-stage.mjs` — the only script that starts a process (the consumer project's Playwright); it
writes only under the story's `artifacts/` and appends to the run's progress log.

### `skills/link-qc-4-publish-test-cases-azure/scripts/`

```bash
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/ado-sync-plan.mjs plan   --tc <approved doc> [--beautified <doc>] --data <TEST-DATA md> [--map <ADO-MAP.md>] --remote <json> --feature <name> [--convention-tags a,b] --pretty
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/ado-sync-plan.mjs verify --plan <plan.json> --readback <json> [--write-map <ADO-MAP.md>] [--strict] --pretty
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/tc-hash.mjs --tc <TEST-CASES md> [--data <TEST-DATA md>] [--ids a,b] [--canonical] --pretty
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/selftest-ado-sync.mjs --pretty
```

- `tc-hash.mjs` is the **canonical TC hash** (`tc-hash/1`): the behaviour fields (Locale,
  Requirement, Preconditions, Steps, Expected Result, Data Oracle, Data effect, Shared data) with
  quoted literals kept byte-for-byte and only the text outside quotes normalised, plus a
  fingerprint of the referenced TEST-DATA rows (account role + note, item name + "Must look
  like", environment "What") — usernames, URL values, statuses, `Validation`, the evidence stamp,
  `Smoke`, `Automation Candidate`, `Tags` and `Description` never enter it; the canonical string gains an
  `AI Oracle=` part ONLY when the optional field is present (`HASH_VERSION` and every existing hash
  unchanged). Byte-identical copy in skill 5 (`MIRROR` banner); both harnesses assert one golden hash for
  the same fixture.
- `ado-sync-plan.mjs` **decides, MCP does the I/O**: `plan` turns the document, the previous map
  and the remote fields (fetched through MCP and passed as JSON) into per-TC tag adds / removes /
  preserves, the AutomationStatus action (`write` / `keep` / `unknown` / `conflict`) and the
  per-TC "Test data" description block; `verify` compares the read-back with the plan
  (`verified` / `MISMATCH` / `NOT_RUN`), derives the outcome (`PUBLISHED AND VERIFIED` ·
  `PUBLISHED, NOT VERIFIED` · `PUBLISHED WITH MISMATCHES` · `PUBLICATION INCOMPLETE` · `BLOCKED`,
  precedence high → low, counts on the line) and writes the new `ADO-MAP.md` (`published_tc_sha256`,
  `automated_tc_sha256` copied through untouched, `Tags (introduced)` persisted only from verified
  writes). The skill never hard-codes `Planned`, never assumes ownership of a pre-existing tag and
  never keeps `Automated` without a matching `automated_tc_sha256`.
- `selftest-ado-sync.mjs` exits non-zero on mismatch by design: tag preservation, the four-run
  ownership case, conflicts, unknown candidacy, mismatch / retry / `NOT_RUN`, the legacy map, the
  canonical-hash same-vs-different set and the incomplete-publication outcome.

### `skills/link-qc-1-generate-update-testing-structure/scripts/`

The three `.mjs` entry points always exit 0 — the result lives in the payload; `selftest.mjs` is
the harness and exits non-zero on mismatch.

```bash
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/preflight.mjs      --root <project> --pretty
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/validate-setup.mjs --root <project> --pretty [--mcp k=PASS,…] [--sync-report x.json]
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --check|--apply --pretty [--target <dir>] [--only <skill>]… [--replace --yes | --force] [--no-mcp] [--tools] [--branch main]
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/selftest.mjs --pretty
```

- `lib.mjs` holds every shared scanner and **all the canonical constants** (`SKILLS`,
  `TESTING_FOLDERS`, `STEERING_CANONICAL`, `LEARNING_*`, `MCP_REQUIRED`, `DOCX_*`, `MANIFEST`).
  Change a name there first, then everywhere it is echoed in prose.
- **Skill versions** (`skillVersion` / `compareSemver` / `versionStatus` in `lib.mjs`): the ONE source of a
  skill's version is its SKILL.md front-matter `metadata:` → `version: "x.y.z"` (Agent Skills form; only skill 5
  declares one so far). `sync-qa-skills.mjs` reports `versions[]` (installed vs source, `versionStatus` current ·
  update-available · ahead-of-source · not-installed · pre-versioning · unversioned; `--apply` adds
  `installedAfter` / `statusAfter`, a self re-run `installedBefore`); `scanSuite().versions` feeds the
  `QA Skills` row and a version behind the source makes `Skills current` WARN. Bump rule: **MAJOR** — a
  consumer must change something or an existing delivery stops passing (a flag, script, output file or
  schema such as `skill5-run-stage/1` / `skill6-run/1` / the report shape / the folder whitelist removed or
  renamed, stricter gate semantics, a newly required input or MCP server); **MINOR** — a backward-compatible
  capability (new flag, script, reference, optional field); **PATCH** — wording, token trimming, pointer
  fixes, a script fix with unchanged contracts. Bump in the same change and name `link-qc-5 x.y.z` in
  the CHANGELOG entry.
- `sync-qa-skills.mjs` **refuses to run when the git origin is this repo** — use `git pull` here.
  It is the single implementation of sync; `sync-skills.md` must stay a wrapper and never
  re-describe the algorithm in prose.
- **Clean replace** (`--apply --replace --yes`): deletes each of OUR skill folders (`SKILLS` + legacy
  `SKILL_RENAMES`) and re-downloads it whole (staged, old folder restored on failure), and overwrites
  `sync-skills.md`; local edits and extra files in those folders are lost. `planReplace()` in `lib.mjs` is
  the only decider — any other skill folder is `keep`, a folder missing in the source is `refused`. The
  script refuses `--replace` without `--yes`; `/sync-skills` and skill 1 (Mode B / C / new) ask ONCE with
  `replace.confirmText` (`REPLACE_WARNING`) from `--check` — Replace / Update only / Cancel. Scope is the
  skill folders + the command only: `.mcp.json`, `.gitignore`, tools and every other file keep the normal
  sync behaviour.
- `check-azure-devops-pat.ps1` / `.sh` are likewise user-run diagnostics (guide §0): five booleans
  about `AZURE_DEVOPS_PAT_B64` (user-scope set, in this process, equal, valid base64, decodes with
  a leading `:`) and the one-line fix for the first failing check — never the value, its length
  or any part of it.
- `set-azure-devops-pat.ps1` / `.sh` are run by the *user* in their own terminal; one prompt
  stores BOTH `AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)` (cloud server) and `AZURE_DEVOPS_PAT`
  (raw, self-hosted server) as user-level env vars. Never handle the token. A new env var
  reaches an MCP server only after VS Code is **fully quit and relaunched** — every doc says
  that, never "reopen / reconnect".
- **Azure DevOps hosting** (`detectAdoHosting` in `lib.mjs`, `ADO_*` / `PAT_VAR_*` constants):
  `dev.azure.com` / `*.visualstudio.com` → cloud → `@azure-devops/mcp` +
  `${AZURE_DEVOPS_PAT_B64}`; any other host → self-hosted → `@tiberriver256/mcp-server-azure-devops`
  + `AZURE_DEVOPS_ORG_URL` / `AUTH_METHOD=pat` / `${AZURE_DEVOPS_PAT}` / `DEFAULT_PROJECT`
  (the `_self_hosted_azure_devops_server` block of the template, written under the same key
  `azure-devops`; no test plan / suite tools). `scanMcp().azureDevops` reads the entry
  (package, referenced PAT variable, `inlinePat`), `scanPat(name)` checks whichever variable the
  entry references (`sessionMissing` = saved on the machine but not in this process), and
  `applyMcpMigration` is the ONLY .mcp.json mutation the sync performs — never the
  `azure-devops` entry. Templates and fixtures carry placeholders only (`devops.example.com`,
  `{ORG_URL}`, `{PROJECT_NAME}`) — never a project's real host, collection or project.
- **Azure DevOps attachments server** (`ADO_ATTACHMENTS_*` constants, `inspectAdoAttachmentsEntry`,
  `scanAdoAttachments` → `scanMcp().adoAttachments`; added 2026-10-13): the cloud server cannot upload
  a work-item attachment from disk, so every CLOUD project gets a second, optional entry
  `azure-devops-attachments` (`node .claude/mcp-launchers/azure-devops-attachments.cjs`, template block
  `_optional_azure_devops_attachments_server`, placeholders only, no PAT key) whose launcher runs the
  pinned `@tiberriver256/mcp-server-azure-devops@0.1.49` and derives `AZURE_DEVOPS_PAT` in memory from
  `AZURE_DEVOPS_PAT_B64` when the raw variable is absent. Skills 8 / 9 use it for
  `create_work_item_attachment` / `delete_work_item_attachment` ONLY. Self-hosted projects need
  nothing (their entry already uploads). The launcher asset lives in `assets/mcp-launchers/` and is
  copied by skill 1 Mode B to `.claude/mcp-launchers/` — outside the sync set, so `/sync-skills` never
  writes it; the scanner reports `launcherExists` / `launcherCurrent` (sha256 vs the asset, CRLF
  normalised) and the `Azure DevOps attachments MCP` row is WARN at worst (absent on cloud, launcher
  missing / not referenced / outdated, literal token) and PASS "not needed" on self-hosted. Bump the pin in
  `ADO_ATTACHMENTS_PACKAGE_PIN` AND the launcher together (selftest case 11 asserts they agree).
- `tc-hash.mjs` + `selftest-tc-hash.mjs`: the byte-identical copy of skill 4's canonical hash
  (see skill 4's section) and its harness — the close-out writes `automated_tc_sha256` with it
  for every TC that ran `full` coverage with PASS after Checkpoint B PASS, never for a `PARTIAL`
  TC. Regenerate the golden hash only together with skill 4's.
- `selftest.mjs` (16 cases over `fixtures/mcp/`; case 15 the execution limits — `scanExecutionLimits` (the coordination directory, the Auto ceiling on a fixed host with `config.json` as its bound, the fallback, a saved `QA_LEDGER`, lower-only overrides, `QA_LEDGER=off` = exclusive, a torn ledger) and the `Execution limits` / `Coordination directory` rows, constants checked against skill 5's `capacity.mjs`; case 8 `planReplace` — only our folders replaced / removed; cases 9-12 the optional attachments server: scanner states, migration guard, launcher asset, the validator row on scratch roots; case 13 skill versions: the `metadata.version` parser, semver compare, the status matrix, `scanSuite().versions` and the two validate-setup rows; case 14 the sync arguments: every repeated `--only` (`argValues` — `parseArgs` keeps the last) and the `summary` keys (`syncSummary`: `missing_in_source`, `local_only`)) **exits non-zero on mismatch by design**: the
  sync guard (azure-devops and azure-devops-attachments byte-identical, cloud and self-hosted), the plan never naming
  either, `detectAdoHosting`, `scanMcp` inline-token detection, `scanPat` session-vs-machine
  (probe-injected, never the registry) and the template's placeholder-only check. Run it after
  any change to `lib.mjs`, the template, the launcher asset or the PAT handling.
- `set-playwright-secrets.ps1` / `.sh` (optional, skills 3c, 5b and 9) are likewise user-run: per-role
  `{ROLE}_USER` / `{ROLE}_PASSWORD` lines in `~/.link-ai-pro/playwright-secrets.env` and the
  user-level `PLAYWRIGHT_MCP_SECRETS_FILE` pointing at it. `scanExecutionLimits` (rows `Execution limits` /
  `Coordination directory`, `references/toolchain.md` "Execution limits") reads skills 5 / 9's machine ceiling and
  coordination directory with skill 5's rules — read-only; skill 1 never writes `config.json` or raises a limit, and
  this is separate from the pending B17 permission allow rules. `scanBrowserSecrets` checks existence
  only; nothing in this repo ever reads the file.
- `sync-qa-skills.mjs --apply --tools` (opt-in) installs `@playwright/cli` globally, runs
  `playwright-cli install-browser` and adds `.playwright-cli/` to `.gitignore` (skills 3c, 5b and 9), and
  runs `<python> -m pip install pillow numpy` **only when `scanPython` found an interpreter**
  (link-qc-6-ui-testing's static-image annotation; the interpreter itself is never installed) — the only
  machine-level installs the suite performs; `planTools()` in `lib.mjs` is the single read-only
  plan shared with `preflight.mjs` / `validate-setup.mjs` (rows `Playwright CLI*` and
  `Python + Pillow` WARN at worst). None of it is a prerequisite for 3b or any other skill;
  `--check` only reports.
- MCP servers: `MCP_REQUIRED` (`playwright`, `azure-devops`, `docx`) are FAIL when missing;
  `MCP_OPTIONAL` (`figma`, link-qc-6-ui-testing only — Figma's hosted server at `FIGMA_MCP_URL`, `"type":
  "http"`, OAuth through `/mcp`, never a token in a file) is reported under `mcp.optional` and
  its `Figma MCP` row is WARN at worst. The template keeps it under
  `_optional_figma_server_for_qc_ui`; skill 1 adds it only on request. `MCP_OPTIONAL` also lists
  `azure-devops-attachments` (cloud projects only, added with every cloud entry without asking — see
  the attachments bullet above); its row is WARN at worst too.

### `skills/link-qc-5-test-run-automation/scripts/`

```bash
node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root <project> --pretty [--files a,b] [--tc-ids <csv|file>] [--req-ids <csv|file>] [--inventory <automation-inventory.md>] [--require-steps] [--summary --out <full.json>] [--page-scan] [--strict]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/tc-hash.mjs --tc <TEST-CASES md> [--data <TEST-DATA md>] [--ids a,b] --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-tc-hash.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report <TEST-RUN-REPORT-{feature}.md> [--bugs <BUG-REPORT-{feature}.md>] [--runs <dir>] [--base <story folder>] [--gate <.runs/phase-N.checkpoint-B.json>] [--out <html>] [--write] [--force] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-report.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/watchdog.mjs --plan <group-or-run-plan.json> [--group <name>] --heartbeat <jsonl> [--results <jsonl>] [--now <ISO>] [--grace <ms>] [--silence <ms>] [--silence-mode active|shadow] [--stop-reason <text>] [--out <watchdog.json>] [--write] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-watchdog.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs --run-file <.runs/phase-N.json> --stage setup|smoke|positive|negative --run first|rerun --stage-tcs <TC,…> --ceilings <group=ms,…|auto> [--timeouts <timeouts.ts>] [--grace <ms>] --log <progress log> --project <name> --cwd <automation root> [--spec <files>] [--groups <names>] [--tcs <TC,…>] [--burn-in <TC,…>] [--extra repeat-each=N,last-failed,workers=N] [--cooldown <ms>] [--cooldown-max <ms>] [--max-wait <ms>] [--label <text>] [--headless] [--cli <cli.js>] [--cmd "<run command>"] [--stage-json-source <path>] [--env-id <id>] [--no-ledger] [--capacity-dir <dir>] [--silence <ms>] [--timeouts-mode active|shadow] [--scheduler auto|groups|dispatch] [--telemetry] [--units <parallel-plan.json>] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/run-stage.mjs reclaim [--capacity-dir <dir>] [--dry-run]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-stage.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs status|config|sweep|reclaim [--dry-run] [--capacity-dir <dir>] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs lease acquire --env <url,…> [--test-data <TEST-DATA md>] [--aliases a=b,…] --run-file <f> [--run-id <id>] [--wait <ms>] [--no-dns] | lease status|release (--env <…> | --env-id <id>) [--run-file <f>] [--quiet-ms <ms>]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-capacity.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/parallel-plan.mjs --root <automation root> [--spec a,b] [--tc <TEST-CASES md>] [--data <TEST-DATA md>] [--learning <md>] [--run-file <.runs/phase-N.json>] [--stage smoke|positive|negative] [--ceiling N] [--out <file>] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-parallel-plan.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-dispatch.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-admission.mjs --pretty   (needs a local Playwright test runner — QA_PLAYWRIGHT_DIR; NOT_RUN, exit 3, without one)
node .claude/skills/link-qc-5-test-run-automation/scripts/check.mjs snapshot|run|record|gate|carry|harness … [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-check.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/run-data.mjs merge|report|readiness|handoff|verify|acceptance --run-file <run file or its draft> [--write] [--snapshot <id>] | draft-init|publish --results-root <dir> --phase N [--feature f] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-data.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/coverage.mjs --judgements <json> [--run-file <f>] [--tc-doc <md>] [--target <pct>] [--target-source L3|default] [--mechanism <m>] [--override] [--write] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-coverage.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/impact.mjs fingerprint|select|reverse --root <automation root> [--spec <files>] [--tcs <TC,…>] [--files <changed,…>] [--progress <results_root>/artifacts/progress] [--run-file <.runs/phase-N.json>] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-impact.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs [reconcile] --root <project> [--automation-root <dir>] [--results-root <dir>] [--run-file <f>] [--apply] --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-config-inventory.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/scratch.mjs run --root <automation root> --spec <root>/test-results/qa-scratch/<name>.spec.ts [--config <shared config>] [--project <name>] [--grep <text>] [--timeout <ms>] [--headless] [--results-root <dir>] [--cli <cli.js>] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/scratch.mjs clean --root <automation root> [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-scratch.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-references.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/profile-run.mjs [--transcript <session.jsonl>] [--windows <fromISO>..<toISO>[=label],…] [--progress <results_root>/artifacts/progress] [--hang-ms <ms>] [--login-pattern <regex>] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-profile-run.mjs --pretty
```

- `scan-lib.mjs` is the text engine (comment/string stripper that preserves line numbers, brace
  balancing, relative-import resolution, sha256). It is **self-contained** — never import skill
  1's `lib.mjs` across skill folders, because `/sync-skills` copies one skill folder at a time;
  `parseArgs` and `print` are copied verbatim and must stay behaviourally identical.
- `validate-automation.mjs` is a **screen, not a judge**. It is deliberately not a parser: what a
  token scan cannot decide is emitted at severity `review` and left to semantic review, never
  guessed. Default exit 0; `--strict` maps the gate (FAIL 1 · BLOCKED 2 · NOT_RUN 3) for CI.
  Rule ids, severities and the documented limits live in the script (`RULES`, `LIMITS` → the payload's
  `limits[]`); `references/validator.md` keeps only the exemptible / non-exemptible split, the gate and
  how to act on each outcome — change it when a rule's exemptibility or severity changes. `pom-duplicate-page` (severity `review`)
  reports two page classes that look like the same page (normalised class name, identical
  `goto` / URL literal, or ≥ 2 identical locator strings) across the WHOLE automation root; with
  `--inventory <automation-inventory.md>` a pair covered by a decision row becomes
  `pom-duplicate-page-decided` (info). Matching only produces candidates — the decision table is
  the verdict. An undecided pair is the ONE review item that moves the scanner gate itself to
  BLOCKED (`--strict` exit 2; documented in `validator.md`), so an unaddressed candidate can never
  pass Checkpoint A / B. `--summary` prints a compact payload (gate, counts, at most 20 open items) and `--out`
  writes the full one — the gate is the same by construction (`summarize()`); `--page-scan` is the
  `<automation_inventory>` discovery digest (`pageScanDigest()`). Six stricter rules ship at the staged
  severity `review` (they never move the scanner gate): `constant-redeclared` (item 6), `empty-catch` (28),
  `timeout-literal` (43), `console-guard-missing` (46a), `network-guard-missing` (49), `admission-contract`
  (25a / 47 — only when the automation root has `helpers/admission.*`); `RULE_CHECKS` maps every rule id to its
  compliance item(s) and `check.mjs` imports it.
- `selftest.mjs` **exits non-zero on mismatch by design** (it is a harness, not a reporting
  script). Run it after any validator change. Its 26 cases include the false-PASS guards
  and, for the three timing rules (`wait-network-idle`, `positional-unscoped`, `step-missing`
  behind `--require-steps`), true positives, false-positive guards and false-negative guards on
  `timing*.fixture.ts`; cases 19-26 cover `--summary` ≡ full gate, `--page-scan`, and the six staged rules (TP /
  FP / FN fixtures under `fixtures/b8/`); when adding a rule, add the fixture case with it. The fingerprint hashes
  one hop of each config's relative imports (`timeouts.ts`) — case 17.
- `watchdog.mjs` is the freeze decision + result reconstruction for one stage command: it reads
  the heartbeat (`helpers/steps.ts`) and the incremental results (`helpers/progress-reporter.ts`)
  and declares a worker `FROZEN` when an open step (a STACK per worker — a nested step never hides its parent) is past
  its OWN FIXED deadline + grace (progress never extends a deadline) while the worker is still in that test (no newer
  test-start / test-end / teardown / console-report, no newer result) — console silence and a stale stage JSON never
  count. Dry-run by default; `--write` produces the `*.watchdog.json` (completed / interrupted / not_started). A
  heartbeat `tc` of a test covering several TCs ("TC-01,TC-02") counts for each; `--stop-reason` names a non-freeze
  stop (run-stage's outer-ceiling kill) in the reasons. The helpers' informational heartbeats (`admission-wait`,
  `rate-wait`, `stall`, `teardown`, `console-report`, `deferred`) are never a step and never progress of one;
  `--silence <ms>` (a step's own `silence_ms` first) adds the silence rule — a LONG step without MEANINGFUL progress
  (`meaningful: true`, or a legacy note whose n/m counter rose; changed text, timestamps, polling never count) past
  silence + grace — declared FROZEN (`--silence-mode active`, the DEFAULT, `rule: silence`) or only reported in
  `would_freeze[]` (`shadow`); an open admission / rate-limit wait is never a UI stall but FROZEN past its own
  `budget_ms` + grace (`rule: wait-budget`). The written file's shape is unchanged (golden; a deadline freeze carries no
  `rule`). It is imported by `run-stage.mjs`, never polled by the model. `selftest-watchdog.mjs` (15 cases, golden
  under `fixtures/watchdog/golden/`) exits non-zero on mismatch.
- `run-stage.mjs` runs ONE stage of a run (`--stage setup|smoke|positive|negative`, `--run
  first|rerun` — `final` is refused: the clean full re-run was removed): every run-plan group of that
  stage in plan order (after `run_plan_adjustments[]`), one Playwright command per group plus a
  `--burn-in` command for healed TCs (workers 1, `--repeat-each=3`, ceiling × 3, any failing repeat =
  FAIL) (the project's `cli.js` without a shell by default; ONE lookahead `--grep` with tag-end guards;
  `--reporter` / `--config` / `--retries` refused), the `PW_*` environment per command (incl.
  `PW_RATE_LIMIT_FILE` / `PW_RATE_LIMIT_STATE` / `PW_RATE_LIMITS`), the next free `-attempt{n}` per
  COMMAND, a stage-filtered group file for the watchdog, `watchdog.run()` every `--interval`
  (a kill of the process tree only on `FROZEN`, or past `PW_GLOBAL_TIMEOUT` + margin as an
  outer-ceiling stop), the per-command freshness gate (`FRESHNESS_FAILED` stops the stage), a
  tailable progress log (line output, 30 s status lines, credential-looking lines withheld) and ONE
  compact payload + `artifacts/progress/{run}-{stage}-{seq}.summary.json` with the ready, phase-wide
  stage message (`update`). **Parallelism never changes a status:** a FAIL from a command that ran beside others —
  workers > 1, or a run that overlapped another command (dispatch's pool and unit children, each perhaps workers 1) — (or
  whose failing step's OWN request was throttled — 429, or 403 / 503 with rate-limit headers;
  matched by step title, time window for old helpers; never for an `expects-refusal` test) is re-run ALONE inside
  the same call — the isolation check: candidates without a refusal at once, refused ones after the server's
  deadline (never shortened or capped; `--cooldown` / `--cooldown-max` bound only a self-chosen, full-jitter
  backoff; beyond `--max-wait` the TC is deferred: NOT_RUN `not started: deferred until …`); pass alone =
  parallel interference (`interference[]` with a `cause` from evidence — `test_data_conflict` ·
  `possible_product_concurrency_defect` · `environment` · `unexplained`; the tests that overlapped it — in its own
  command and in every command running at the time — are re-run alone too), refused again = INCOMPLETE `rate_limited`, more than max(3, 30 %) failures = breaker, no isolation;
  a 503 + `Retry-After` without rate-limit headers is temporary unavailability, never throttling. Refusals cool
  down only their SCOPE (`service:` / `account:` / `endpoint:` in the admission file; the runner waits before the
  next command only when the project lacks `helpers/admission.ts`); workers are halved and the ceiling scaled
  only for environment-wide refusals. The helpers' non-verdicts map mechanically: SKIP + `admission-timeout` →
  NOT_RUN `not started: admission timeout (…)`; a worker that was not admitted throws `AdmissionRefusedError` from
  `workerAdmission` (so none of the worker fixtures / beforeAll hooks that depend on it run) → the same NOT_RUN, its
  serial followers too, never FAIL; SKIP + `rate-limit-deferred` → NOT_RUN `not started: deferred
  until …` (re-queued alone when due inside `--max-wait`), a `RateLimitWaitError` "wait budget exhausted" →
  INCOMPLETE `interrupted: wait budget exhausted (…)`; a serial-chain follower Playwright skipped is NOT_RUN `not
  started: depends on …`. Cumulative counts and the smoke gate are phase-wide (all summaries by start time; smoke
  fail % over the PASS + FAIL smoke TCs; none → `no_verdict` / NO VERDICT, and a first run's positive / negative is
  then refused). **Capacity (default on):** every command
  reserves its full `--workers` in `capacity.mjs`'s ledger under the machine ceiling (lower-only; lowered further
  when free memory / CPU admit fewer — recorded), is spawned through `ledger-exec.mjs` and released only when its
  tree is confirmed gone (`ledger.*` in the summary); a 2 s sampler publishes host pressure to
  `artifacts/progress/admission.json` (`PW_ADMISSION_FILE`; also `PW_UNIT_SCOPES`, `PW_UNIT_MAP`, `PW_LANE`,
  `PW_CANCEL_FILE`, `PW_DIAGNOSTICS_DIR`, `PW_ENV_ID`); not admitted within `--max-wait` → NOT_RUN `not started:
  admission timeout / host pressure`; `--env-id` must name a lease this run holds (else BLOCKED, NOT_RUN `not
  started: environment lease`) and moves the rate-limit book to the coordination directory. `--ceilings auto
  --timeouts timeouts.ts` does the documented ceiling arithmetic; `--grace` defaults to `watchdog_grace`, the silence
  limit to `stall.silence` (else min(3 × max(action, navigation, expect), 55 s)) and the silence rule is ACTIVE
  (`--timeouts-mode shadow` = rollback, `timeouts_shadow`); `proposals[]` carries ready `run_plan_adjustments[]`
  entries. **Scheduler `auto` (the default):** with the ledger on and `--units` an OK `skill5-parallel-plan/1` payload
  whose `inputs.fingerprint` (`parallel-plan.mjs readinessFingerprint`: code, TCs, TEST-DATA, learning file, run plan,
  environment) still matches — else re-planned in-process and written back (`scheduler.replanned`) — it DISPATCHES:
  the conflict-free pool in BATCHES (one multi-worker command per max(4 × workers, 8) TCs, reserved / released per
  batch, workers from the ramp, which records one sample per batch with its monotonic wall span), every restricted unit
  as its own child, run-alone / barrier units recorded `global` in `dispatch.timeline`; without that proof (no / BLOCKED
  / unrefreshable payload, ledger off, setup) every command runs with ONE worker (`scheduler.used: serial`,
  `scheduler.fallback`). `--scheduler groups` (explicit) runs the hand-built run plan; `--scheduler dispatch`
  (explicit) refuses instead of falling back. The last validated worker count per environment and browser kind is kept
  in `ramp.json` (a trial target only, never evidence). `display`: headed unless `--headless`, CI or no graphical
  desktop; `status.json` + one log line on every change of the active worker → TC map. `run-stage.mjs reclaim`
  (user-run) ends orphaned trees.
  Every summary carries the per-TC code fingerprint (`impact.mjs`, imported lazily; a failure there is
  a warning, never a stop) at call start and end. Every command gets its OWN Playwright outputDir
  (`artifacts/test-output/phase-{N}/{stage}-{group}[-attempt{n}]/`, `groups[].outputDir`) — Playwright wipes only
  that folder, so no later command deletes an earlier one's traces and failure screenshots; `pruneOutput` removes
  earlier phases' folders and the old flat layout at each call and keeps the phase's newest `OUTPUT_KEEP` (100,
  `output_pruned[]`); `--extra last-failed` gets the previous command's `.last-run.json` seeded. Every summary carries
  `host` (the ledger's 2 s sampler's minima / peaks — the ONE host sampler of a call); `telemetry` (`skill5-telemetry/1`)
  is OPT-IN (`--telemetry`; `--no-telemetry` is accepted, a no-op) and observe only: it reuses the sampler's readings
  and adds the running command's process tree (count, working set; PowerShell CIM on Windows, `ps` elsewhere) every
  `--tree-interval` (30 s); nothing reads it to decide anything. The model starts it as one background command per
  stage and never polls it. **`--no-ledger` / `QA_LEDGER=off` (the rollback switch) or no process listing never
  launch uncoordinated:** every command then takes an EXCLUSIVE reservation in the same ledger file (one Playwright
  command at a time on the machine, workers ≤ the ceiling; no pressure admission, no dispatch); an unwritable
  coordination directory or unreadable ledger → BLOCKED "no safe coordination", nothing started. **In both modes a
  command runs under `ledger-exec.mjs` and its reservation is released only on a FRESH process table that shows
  nothing it owns alive** (`capacity.mjs releaseConfirmed`): a browser that outlives its command — detached,
  re-parented, its parent ended — keeps the slots held and is stopped only when the table shows it with its recorded
  identity; no table → the slots stay held (`confirmed: none`), later commands wait, never launched beside it.
  `--units` for dispatch must be an OK `skill5-parallel-plan/1` payload with its conflict list. A lease is accepted
  for its run file under any run id (skill 9's own lease). `selftest-run-stage.mjs` (40 cases — every case without its own `--scheduler` runs the legacy `groups`; 40 the default `auto` → serial — over `fixtures/run-stage/` — a fake
  Playwright that filters `suite.json` with the real regexes and misbehaves on purpose: freeze with a
  grandchild process, quiet long step, malformed heartbeat, hang past the ceiling, missing / stale
  JSON, no tests, secret output, `0xC0000142`, failures only beside other tests, false passes, 429s
  with `Retry-After`, mass failure, a serial chain, flaky repeats, the fingerprint read back by `impact.mjs select`, an outputDir wiped per command like the real one,
  NO VERDICT, deferrals, the wait budget, admission timeouts, 503 / 5xx causes, environment-wide refusals; cases
  1-32 run with `QA_LEDGER=off` — exclusive execution in a throw-away `QA_CAPACITY_DIR` — and, with
  `QA_LEDGER_SELFTEST=on` (the ledger-enabled variant — run BOTH before a commit), the same 32 cases with the ledger on;
  either way on fixed host readings (`QA_CAPACITY_HOST_FIXTURE`) and a fixed process table, so no result depends on this
  machine's free memory; 33-39 use the real process listing in temp directories — the ledger and scarce-memory lowering,
  the lease, dispatch (the 2-worker pool consumes ONE reservation), 36 the rollback hard cap, 37 skill 9's call shapes
  beside skill 5, 38 a browser that outlives its command and a failed listing, 39 two single-worker dispatch units side
  by side: the failure beside the other command and the other command's overlapping pass both re-run alone; 27 also
  covers a refused worker) exits non-zero on mismatch; the watchdog
  timing cases (3, 4, 26, 31) assume an otherwise idle machine — run the harnesses one after another. The
  consumer-project run stays `NOT_RUN` here.
- `impact.mjs` decides which TCs a code change touched — the targeted re-run and Checkpoint B's
  results-freshness check: `fingerprint` (per test: the test call, hooks, spec / describe remainders,
  page-object members reached — class-aware, never a name guess, by-name fallback across the import
  closure, file level when a member table cannot be built —, every closure module's remainder,
  re-exports and tsconfig `paths`, `timeouts.ts` at key level, config / Playwright version / data files
  / setup journeys as parts; `@run:` tags, comments, whitespace and a describe's `mode` never count;
  anything dynamic or unresolvable = `unknown` = always stale) and `select` (latest executed attempt per
  TC from the summaries by start time → `stale[]` with the changed parts, `fresh[]`,
  `fresh_by_member_only[]`, `never_run[]`, `no_verdict[]`, `expanded[]` — the closure over tests shared
  by several TCs —, `outside_scope[]`, `unknown[]`) and `reverse --files <changed>` (`reverseDependencies()`: every
  test and TC whose closure reaches a changed file or part; `unknown` always included — `closureOf()` gives the
  per-test closure `parallel-plan.mjs` reads). Read-only, fail-safe (over-selects, never
  under-selects), imports only `scan-lib.mjs`. `selftest-impact.mjs` (44 cases over `fixtures/impact/`,
  a mini POM project) exits non-zero on mismatch.
- `config-inventory.mjs` lists every `playwright*.config.*`, every reference to each (package
  scripts, CI, docs, other configs, code — comments and code fences count) and the settings that
  block a merge; `deletable[]` is the ONLY authority for removing a consolidated config. It never
  deletes. `reconcile` resolves the EFFECTIVE run protections of an existing project (config + presets + project
  overrides + inherited defaults, `timeouts.ts`, helpers, env files, the environment) with a precise status per key
  (`ok` · `unbounded-operation` · `no-suite-timeout` · `above-target` · `exception-approved` · `protection-disabled`);
  `--apply --results-root` backs every original up to `artifacts/reconcile/{stamp}/` (+ `summary.md`) and fixes only
  the supported shapes (missing `timeouts.ts` keys from the template, literal `0` action / navigation, a missing pair in
  `use`, `retries`, a literal `headless: true`, an absent helper) idempotently; everything else is a `conflicts[]` entry,
  never overwritten. `check.mjs run` runs it dry as item 43's `tool:protections` unit. `selftest-config-inventory.mjs`
  (8 cases over `fixtures/config-inventory/` + a throw-away reconcile project) exits non-zero on mismatch.
- `scratch.mjs` is the **investigation runner** (`references/scratch-investigation.md`, `<scratch_investigation>`):
  ONE temporary probe from `{automation_root}/test-results/qa-scratch/` run with the consumer project's OWN
  `@playwright/test` through a generated overlay `scratch.config.ts` over the shared config (1 worker, no
  retries, list + json reporter, trace + screenshot on, no globalSetup / globalTeardown, one project; the name
  never matches `playwright*.config.*`), with the run-stage variables removed. It refuses a probe outside that
  folder or one that captures evidence, screenshots itself, uses `storageState`, writes files, reads
  `process.env`, prints a credential or names a TC, and refuses while a stage's progress file is fresh; output is
  credential-filtered, a write outside `test-results/` is `violation`, the payload is `kind: investigation,
  officialResult: false`. `test-results/` is in every scanner's skip list, so the validator, `impact.mjs` and
  `config-inventory.mjs` never see a probe. A probe holds ONE Playwright slot under the machine ceiling (exclusive
  under `QA_LEDGER=off`; released only when a table confirms the probe and its browser ended; none within
  `--max-wait` → refused `capacity`, no coordination → refused `no-coordination`). Never a result, evidence, re-run, burn-in or freshness proof;
  `clean` before Checkpoint B (compliance item 50). `selftest-scratch.mjs` (14 cases over
  `fixtures/scratch/` + the impact fixture project) exits non-zero on mismatch.
- `selftest-references.mjs` (4 cases, read-only) checks the contracts BETWEEN the instruction files: Heal Log
  columns cited by name and matching `automation-rules.md` §5 (with the run-report fixture's header and
  `heal_log[]` keys), everything the smoke-gate STOP needs loaded by the stopping activity (block index → file,
  the Workflow Load column), the block index against the blocks, and `references/rule-registry.md` (one home per
  rule; the home's block / § exists; every validator rule id, checklist item and script it names exists; every
  activity that needs a rule has its home loaded by then; every block SKILL.md's every-activity rules cite is a
  registry home). Run it after editing the Workflow table, the block index, a Heal Log passage, a stop path or a
  rule's home; it exits non-zero on mismatch.
- `capacity.mjs` (+ `ledger-exec.mjs`) is the machine-wide coordination layer, in `{QA_CAPACITY_DIR |
  ~/.link-ai-pro/capacity}/`: the AUTO machine ceiling (`autoCeiling` / `resolveCeiling`: min((total memory − reserve)
  ÷ 1536 MB, (cores − reserve) ÷ 1.5) for headed workers, within [1, upper]; `upper` = `config.json` `machineMaxWorkers`
  written by hand, else `AUTO_MAX` 8 — a safety bound; unusable readings → `AUTO_FALLBACK` 2; `QA_MAX_WORKERS`, manifest
  `execution.maxWorkers` and `--workers` only lower; ONE shared value recorded in the ledger — a run may lower it but
  never raise it while anything runs),
  the capacity ledger (atomic `mkdir` lock with an owner file — dead owner broken at once, ownerless after 30 s; a
  release RENAMES the folder away and, when Windows refuses that because a contender has `owner.json` open, renames
  `owner.json` to `released-*.json` — a marked folder is broken at once, so a refused delete never leaves an ownerless
  lock everyone waits 30 s out (the cause of the run-stage stalls and FRESHNESS_FAILED stops, measured with
  `QA_CAPACITY_TRACE={file}` — an opt-in JSONL of every lock, command-start / ceiling-stop / freshness event, never read
  by a decision); `helpers/rate-limit.ts` keeps the same convention for the book lock; temp + rename writes; two-phase spawn: `reserve` → `ledger-exec.mjs` self-registers → `activate`; descendants
  and browser-profile markers tracked; released only when nothing it owns is alive — recorded processes (pid + start),
  the token on a command line or in the environment (Linux), markers, a session's `cliDaemon.js`, children of a
  recorded or ENDED process (birth-ordered; a reused parent pid fathers only children born before the reuse) and their
  trees; unknown liveness counts as alive; `sweep` resolves dead owners / orphans; `reclaim` ends only recorded
  orphaned trees), CONFIRMED release (`confirm: 'table'` — exclusive commands, probes, named session holds: freed only
  on a fresh table, never by a PID check; a waiting `reserve({ snapshot })` confirms; `releaseConfirmed` stops only the
  run's own survivors; `release --token --force` is the user-run escape), committed-demand
  admission, the pressure monitor (fed by the runner's 2 s sampler), and the environment lease (canonical host
  identity with alias / CNAME / shared-address grouping; exclusive per OVERLAPPING environment too — a request whose
  identity tokens (names, resolved addresses) meet another run's lease is held by it whatever the ids, so stories listing
  different subsets / aliases of one application never run side by side — and they share ONE rate-limit book (the
  ledger's `books` registry: a lease's `bookId` is the oldest book whose tokens meet its own; a request bridging two
  books merges them, never shortening a deadline; `validateLease` hands run-stage the book for `PW_RATE_LIMIT_STATE`);
  liveness owner = the Claude Code host process; reclaimed only when that owner is dead AND nothing it owns is alive —
  no recorded tree of the run and no process the owner started after taking the lease (a shell, a playwright-cli
  daemon and its browser — birth-ordered, PID-reuse guarded; a child older than the lease is not the run's); accepted
  for its run file under any run id), EXCLUSIVE
  execution (`reserve({ exclusive, liveness: 'pid' })` — granted only while nothing else of the class is live, blocks
  everything else while live; PID-judged entries pruned inside every reserve and by a tableless sweep) and session
  holds (the playwright-cli browsers of skills 3c, 5b and 9 under the same ceiling, owned by the Claude Code process,
  ONE per `--session` name — reused, never counted twice; released when a table shows the session's daemon and browser
  ended; an abandoned one stays held while its session runs; legacy holds without a session live as long as their owner).
  CLI `status | config | sweep | reclaim | release | lease acquire | status | release | hold acquire | track | release`.
  `selftest-capacity.mjs` (26 cases, injected process tables / clocks / DNS; case 2 the Auto ceiling on fixed hosts, its config bound, the fallback and the shared value a run cannot raise beside others; cases 19 and 21 bound Auto at 2 in their config; cases 15-16, 19, 22 and 26 start real `node`
  children — 22: cancellation and clean-up on the real table, only the run's own process stopped; 23 overlapping
  environments: subsets, aliases, shared addresses, no DNS, legacy leases; 24 lease takeover blocked by processes the
  dead owner started after the lease; 25 one rate-limit book per overlapping group, merges never shortening a deadline;
  26 lock release with `owner.json` held open, 4 processes × 60 contended cycles without a lost update) exits non-zero
  on mismatch.
- `selftest-admission.mjs` (5 cases) is the REAL-Playwright integration test of `assets/admission.template.ts` (no
  browser launched): throw-away projects from the real templates + `fixtures/admission/` (fixtures that log every side
  effect), run by a LOCAL Playwright test runner — `QA_PLAYWRIGHT_DIR`, one Node resolves, or the npm npx cache; it never
  installs anything and without one reports NOT_RUN and exits 3, never a pass. A worker refused by timeout or
  cancellation runs no seeding, shared login, per-test login, `beforeAll` or body and every test classifies (run-stage's
  own `collectTests` → `markFollowers` → `classifyTest`) as `NOT_RUN — not started: admission timeout (…)`; a unit refused
  by a scoped cool-down skips only its own login and body; a reopened state admits again; the control proves the probes.
- `check.mjs` decides the compliance checkpoints: `snapshot` (the §6.2 hashes — scope files, per-TC tc-hash,
  requirements, TEST-DATA, run plan, readiness, exceptions, configs, timeouts, lint config, tool versions; at B
  also the evidence manifest and the drafts), `run` (the consumer's `tsc --noEmit`, the validator, the config
  inventory, an optional typed lint and the A15 timeouts report — side by side within the compliance limit of 2,
  through the ledger's `compliance` class; compact stdout, full output under `artifacts/checks/{snapshot}/`),
  `record` (one semantic result; `--batch <results.json>` all of a checkpoint in ONE call — validated as a whole first,
  any invalid / stale / duplicate / contradictory entry or a changed scope rejects the batch, nothing written; the
  gate is identical to one-by-one records), `gate` (the result protocol: one result per (check, unit) for the snapshot;
  missing / stale / contradictory / duplicate rejected; N/A only with its predicate; never-N/A at B: 16b, 18, 19,
  25b, 46b, 48a, 48b; runtime items at A `scheduled-for-B`; a re-hash mismatch voids; B needs freshness, gate
  record A and frozen drafts → `.runs/phase-N.checkpoint-{A|B}.json`, `skill5-gate/1`), `carry` (incremental
  Checkpoint B — SHADOW ONLY, never a result) and `harness` (B20: a harness pass reused only on an exact key —
  harness, scripts, fixtures, assets, lockfile, Node, platform / arch, timezone / locale, skill version — cached
  under `~/.link-ai-pro/harness-cache/`). `CHECKS` (54 entries) is the catalogue; `references/expected-differences.md`
  is the 1.2.0 → 2.0 parity register (every check identical or `differs: ED-n`, status PROPOSED until reviewed).
  `selftest-check.mjs` (19 cases, fake tsc / eslint; required units 64 at A / 78 at B — item 43 carries `tool:protections`; case 18 ties the register to `CHECKS`; 19 the batch ≡ individual
  records at the gate and every rejection) exits non-zero on mismatch.
- `run-data.mjs` produces the phase's deterministic report data and the publication: `merge` (the `<second_run>`
  merge into the run file, model-owned fields kept), `report` / `readiness` (ready markdown fragments: header
  lines, run-history row, Stages + smoke-gate line, Results rows, the `### Run` bullets incl. `Acceptance`, the
  readiness table), `handoff` (a structured view for a fresh session), `verify` (the runtime checks 16b, 18, 22,
  23, 25b, 31-34, 37, 38, 43, 45, 46b, 48a, 48b, 50 + freshness, recorded per snapshot), `acceptance` (Revision 3.1
  §3.8: `ACCEPTED` / `NOT ACCEPTED — {reasons}`, pre-gate or final), `draft-init` and `publish` (only on gate B
  PASS with matching draft hashes: byte-identical promotion, the page rendered with `--gate`, a reproduction
  check, rollback on any mismatch). It keeps its own copy of run-stage's report parsing ("keep in step").
  `selftest-run-data.mjs` (10 cases) exits non-zero on mismatch.
- `coverage.mjs` is the static coverage arithmetic and files from the model's judgements JSON (weighted % overall
  and per stage, the gate verdict, manual priorities, the delta, the three CSVs, `coverage_snapshot`, the
  `### Coverage` fragment); judgements stay semantic; a document TC without one BLOCKs. `selftest-coverage.mjs`
  (6 cases) exits non-zero on mismatch.
- `parallel-plan.mjs` is the parallel readiness check (read-only; `--out` is its only write): claims per TC and
  per hook / fixture (TC fields, TEST-DATA tokens, learned interference lines — a changed TC hash marks them
  `revalidate`, still honoured —, code structure via `impact.mjs closureOf`), conflict rules, classes, execution
  units U1-U4 (contract violations and unclassifiable structures → U4), readiness counts (`mode: readiness`, what
  dispatch needs — run on every skill-5 run) and `inputs.fingerprint` (`readinessFingerprint`, compared part by part by
  `fingerprintChanges`); `--out` writes a BLOCKED payload too; only with `--compare` (`mode: shadow`, skill 5's
  `--parallel-shadow`) a candidate plan compared with the hand plan. `dispatch.mjs` (pure) holds the
  conflict rules, the list scheduler (priority, aging, barriers, pool constraint) and the ramp (W0 = min(2, ceiling);
  windows of max(minTests, workers) tests and `minWindowMs` of summed WALL time — samples accumulate, a sample at another
  worker count restarts the window; one +1 trial — or straight to a remembered `target` — after a healthy window, kept
  only with ≥ 10 % gain; −1 on interference, environment-wide throttling (`envRefusal`) or a slower p95; scoped
  throttling only blocks an increase; `validated()`; `requeue` hands back a unit whose reservation was refused). A step that edits a record named by its token is a write on that record (`rec:D{n}`) —
  skill 3's `Data effect` / `Shared data` semantics (`tc-design.md`). `selftest-parallel-plan.mjs` (13)
  and `selftest-dispatch.mjs` (14: case 14 the batch ramp — wall-clock windows, accumulation, scoped vs environment throttling, the remembered target) exit non-zero on mismatch.
- `profile-run.mjs` measures a finished run for the performance baseline (Phase 0 of the optimisation plan) — never
  used during a run. From a Claude Code transcript (`--transcript`, optional `--windows from..to=label,…`, windows with
  one label merged): API calls, token classes (cache reads / writes, uncached input, output; sidechains counted
  apart), context per call and its segments (P0, growth g; a drop below half = compaction), full-prefix cache writes
  (> max(50 000, 25 % of the context)), tool calls by category with approval paths and nearest-rank p50 / p90, the time
  split (model / tool / background wait / waits for the user; active = wall span − user waits). From a story's
  `artifacts/progress` (`--progress`): Playwright time, test starts vs executions (records of never-run tests —
  worker -1, e.g. skips — are starts only), executions per TC, workers and time-weighted average concurrency, gaps
  between commands vs idle periods (`--max-gap-ms`, 1 h), hung and login steps, run-stage telemetry peaks. READ-ONLY and AGGREGATES ONLY — no transcript text,
  command, path, step title or note ever reaches the output. `selftest-profile-run.mjs` (7 cases over
  `fixtures/profile-run/`, every value hand-computed, incl. a no-leak check) exits non-zero on mismatch.
- `assets/*.template.ts` (`playwright.config`, `timeouts`, `steps`, `progress-reporter`,
  `console-guard`, `network-guard`, `rate-limit`, `test-data`, `admission`) are TypeScript the skill copies INTO a
  consumer project when the equivalent is absent (`network-guard`, `rate-limit` and `admission` always — they do
  nothing without their environment variables, so learning a limit changes the run plan, never code). The
  always-installed helpers exchange state through `globalThis.__linkQcRuntime`, never through new imports from
  the copied-when-absent ones, so an older `steps.ts` / `test-data.ts` keeps compiling. `admission` holds the
  `workerAdmission` / `unitAdmission` fixtures (code-craft §6); `rate-limit` books service / account / endpoint /
  environment buckets together in the shared book (never shortening a server deadline, deferring when out of
  reach, full-jitter backoff, 50 % recovery, cancellable waits); `network-guard` writes the classified records;
  `steps` adds the stall detector; `console-guard` writes the `teardown` and `console-report` heartbeats;
  `timeouts` adds `stall.silence` and `admission.max_wait` and refuses unlimited action / navigation timeouts. They
  are never executed here; the consumer-project acceptance probe in `<shared_config>` is what verifies them, and it
  is reported `NOT_RUN` in this repo.
- `render-run-report.mjs` is the **only** way a `TEST-RUN-REPORT-*.html` page is produced — skill
  5 never hand-writes it. It reads the story's `TEST-RUN-REPORT-{feature}.md` (test-case status,
  one `## Phase N` section per run) **and** `BUG-REPORT-{feature}.md` (the defects), enriches
  from `.runs/phase-N.json`, and renders one page with separate Test Results and Bugs sections.
  Same rules as skill 3's renderer: dry-run by default, writes only behind `--write`, `--force`
  for a hand-edited page, provenance comment with a self-hash (report / bugs / runs sha256),
  `mismatches[]` when a header line, run-history row, stage total, run-file total, bug count or
  bug cross-reference disagrees with the tables, `—` never `0`, `--strict` PASS 0 · MISMATCH 1 ·
  BLOCKED 2 · NOT_RUN 3. Screenshots are linked by RELATIVE path (thumbnail + "View screenshot"
  viewer in the template's own `<dialog>` + inline script); a `data:` URI BLOCKs, a missing file
  only warns. Legacy artifacts (`phase-N.*`, `merged-results.json`, …) are listed, never
  rendered. It copies skill 3's template engine and the "report-shell kit" block (between its
  BEGIN / END markers: comments parser, comment boxes, shell strings, `renderShell`) and never
  imports them (sync copies one folder). Two passes: the body partial
  `assets/run-report.template.html`, then `assets/report-shell.template.html` around it — the one
  general page (one stylesheet, one script: theme toggle, viewer, filter bars, reviewer comments),
  byte-identical with skills 3 / 3b / 3c. Reviewer comments: every bug and phase card and one
  general box take a comment; the page saves `REVIEW-COMMENTS-{feature}.md` beside itself (the
  reviewer's file, the only extra entry in the story-folder whitelist); `--comments` overrides;
  the provenance line gains an optional `comments=` hash (v1.0 pages still verify). `--base {story folder}`
  resolves evidence links, the legacy listing, comments and the tracker against that folder (how a DRAFT under
  `artifacts/drafts/phase-N/` renders exactly what the published page will); `--gate {gate record}` adds an
  optional ` · gate={sha256}` to the provenance and the gate verdict to the meta line (`run-data.mjs publish`
  passes it); pages with or without it verify. The smoke-gate word `NO VERDICT` is accepted (the phase is
  INCOMPLETE, never GREEN). The contract lives in `references/run-report.md` (§1 flags, §9b comments, §10 templates).
- `selftest-run-report.mjs` exits non-zero on mismatch by design; its 36 cases (36 skill 9's in-place retest update of the latest phase on a 1.x and a 2.0 run file — PASS, no gate claim, gate records untouched; 23 PARTIAL rows, 24 reviewer comments, 25 one shell per page, 26 shell + kit mirror with 3 / 3b / 3c, 27 the `ai_rubric_failure` classification, 28 the full mirror with 5b — renderer, harness, scan-lib, both templates, run-report fixtures, 29 the test-data readiness decisions counted per phase, 30 the TC status tracker, 31 navigation markup, 32 `rate_limited` and the documented `interrupted:` / `not started:` / `cleanup_incomplete` reasons accepted without a warning, 33 `--base`, 34 `--gate`, 35 `NO VERDICT` — none needs a new golden) run on a temporary
  copy of `scripts/fixtures/run-report/automation/` (a story with two phases, two bugs and PNG
  stubs) and compare against `scripts/fixtures/run-report/golden/`. Regenerate the golden only for
  a deliberate change (command in the fixture README).

### `skills/link-qc-5b-test-run-manual-cli/scripts/`

```bash
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/render-run-report.mjs --report <TEST-RUN-REPORT-{feature}.md> [--bugs <BUG-REPORT-{feature}.md>] [--runs <dir>] [--out <html>] [--write] [--force] [--strict] [--pretty]
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-run-report.mjs --pretty
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-manual-run.mjs --pretty
```

- `render-run-report.mjs`, `selftest-run-report.mjs`, `scan-lib.mjs`, `assets/run-report.template.html`,
  `assets/report-shell.template.html` and `scripts/fixtures/run-report/**` are **byte-identical mirrors of
  skill 5's** (same flags, same gates, same goldens; `MIRROR` banners). 5b renders its
  `TEST-RUN-REPORT-{feature}.html` with its own copy because `/sync-skills` copies one folder at a time;
  skill 5's `selftest-run-report.mjs` case 28 and the 5b copy check the mirror. Edit skill 5's, copy,
  regenerate the goldens together.
- `selftest-manual-run.mjs` + `scripts/fixtures/manual-run/**` are 5b-only: the harness renders the
  manual-run fixture through the mirrored renderer and compares it with its golden; it exits non-zero on
  mismatch by design.

### `skills/link-qc-3-generate-manual-test-cases/scripts/` = `skills/link-qc-3b-validate-manual-test-cases/scripts/` = `skills/link-qc-3c-validate-manual-test-cases-cli/scripts/`

```bash
node .claude/skills/link-qc-3-generate-manual-test-cases/scripts/render-tc-review.mjs --tc <TEST-CASES-{feature}.md> [--data <TEST-DATA.md>] [--out <html>] [--lang en|ar] [--strings <json>] [--comments <md>] [--write] [--write-skeleton] [--emit-keys] [--force] [--strict] [--pretty]
node .claude/skills/link-qc-3-generate-manual-test-cases/scripts/selftest.mjs --pretty
```

- `render-tc-review.mjs` is the **only** way a `TC-REVIEW-*.html` page is produced — the skills
  never hand-write it. Default mode is dry-run (payload only); it is the one script that writes,
  and only behind `--write` (the page) / `--write-skeleton` (the Arabic strings sidecar). It
  recomputes every number from the markdown tables (`mismatches[]` when a header line
  disagrees), never invents a number (`—`, never `0`), never drops a TC (orphans are badged),
  renders legacy documents with `compatibility[]` findings, BLOCKs only on things that would make
  the page wrong (out-of-vocabulary enum, broken row, missing frozen field, password-shaped
  literal, leftover placeholder), stamps a provenance comment with a self-hash and refuses to
  overwrite a hand-edited page without `--force`. Same inputs → same bytes; nothing depends on
  the clock. `--strict` maps the gate (PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3). Three
  `warnings[]` kinds the skills must clear before delivery (they never change the gate):
  `data-literal` (a TEST-DATA environment host / value or account username repeated in a TC
  text — matched against TEST-DATA, never by shape; `(intentional input)` at the end of a line
  opts out), `data-ref-unresolved` (a `[A/E/D{n}]` token with no row) and
  `narrative-not-english` (Arabic-script narrative on an English page, quoted labels ignored).
  **Language is `--lang` or English** — the document's `Review page language:` line is a record
  of the last render (`document.reviewLangHeader`, `review-lang-header-stale` warning), never an
  input. `[HUMAN]` steps are counted and badged (`counts.humanSteps`); the optional `Tags` field
  renders as chips and is never a translation key. Two passes: the body partial
  `assets/tc-review.template.html`, then the shared `assets/report-shell.template.html` (also in
  skill 5). Reviewer comments (`references/html-page.md` §7b): every TC / PB / Q card and one general
  box take a comment; the page saves `REVIEW-COMMENTS-{feature}.md` beside itself; the renderer
  pre-fills open entries, shows handled ones (`applied` / `answered` / `declined` + Response) as
  history, lists unknown ids, never translates comment text; an optional `Reviewer comment` TC
  field is shown and is not in the TC hash. Typing in the page never changes the page file, so the
  hand-edit guard stays valid.
- `--write-skeleton` **merges** the sidecar and never resets a translation (unchanged `en` keeps
  its `ar`; changed → `stale` with the old `ar` kept; new → `ar: null`; removed → `orphan`). A
  page rendered with missing / stale keys is a preview (`arabicComplete: false`).
- `selftest.mjs` exits non-zero on mismatch by design; its 30 cases cover the golden EN / AR /
  legacy pages, the merge rule, the false-PASS guards, exit codes, provenance, **case 20 (run
  metadata — the `by 3c … , tool cli` header, the `tool` / `outcome-check` stamp keys and the
  `screenshot` pb-meta key are parsed into the payload and never rendered)**, **cases 21-22
  (configuration literals warn, typed inputs / boundary values / `(intentional input)` never do;
  unresolved tokens warn; no TEST-DATA → unchecked; legacy TEST-DATA → compatibility)**, **case 23
  (language precedence L1-L4: the header line and the sidecar never decide, `--lang ar` does, the
  narrative check flags Arabic narrative and ignores quoted labels)**, **case 24 (`[HUMAN]` count
  and badge, `Tags` chips, Tags optional)**, **case 25 (reviewer comments: pre-fill, badges, history, orphans, stale revision, other page, secret, `--comments`, Arabic)**, **case 26 (one shell per page)**, **case 27 (shell + kit byte-identical with skills 5 and 5b when installed)**, **case 28 (the optional `AI Oracle` field)**, **case 29 (the fifth test-data status `NOT CREATABLE` — accepted, counted, badged; any other word still BLOCKs)** and **case 0, the mirror check** (sha256 of every
  mirrored path against every sibling skill folder present — `MIRROR_SKILLS` = 3, 3b, 3c;
  `skipped` only when none is present). Regenerate a golden only for a deliberate change
  (`scripts/fixtures/MIRROR.md`).
- The renderer reads both validators' header stamps (`by 3b on …` / `by 3c on …, tool cli`) and
  picks the matching chrome string; `document.stamp.by` / `.tool`, `document.evidence[]` and
  `document.potentialBugs[]` carry the run metadata for the 3b-vs-3c comparison.

## Mirrored files — skills 3, 3b and 3c

`/sync-skills` copies one skill folder at a time, so the three skills never import from each other;
what they share is duplicated **byte-for-byte** and must be edited in all three places:
`references/learning-file.md`, `references/html-page.md`, `references/validation-states.md`,
`references/open-questions.md`, `assets/tc-review.template.html`, `assets/report-shell.template.html`
(also byte-identical in skills 5 and 5b, with the renderers' "report-shell kit" block — skill 3 case 27 and
skill 5 run-report cases 26 / 28 check it), `scripts/render-tc-review.mjs`,
`scripts/selftest.mjs`, `scripts/fixtures/**`. Each file carries a `MIRROR` banner in its own
comment syntax (JSON / HTML goldens are listed in `scripts/fixtures/MIRROR.md` instead); self-test
case 0 enforces it against every sibling present. Prose blocks that must say the same thing in the
SKILL.md files of 3, 3b and 3c: the approved-document rule (3b / 3c invariant 5 / skill 3
invariant 7), the coverage rule ("Validation alone does not change design coverage; discovering a
genuine coverage gap or updating cases may change it"), the no-code rule with the sidecar
exception, the frozen field list, and "3b / 3c is not a gate". Between 3b and 3c only: the
freshness / PB / open-question rules, which 3c copied from 3b and adapted only where the browser
tool differs (`walk-rules.md` = 3b's `mcp-pass.md` made tool-neutral + §3a data changes + §6a
outcome rule; `browser-cli.md` is 3c-only; `test-data-resolution.md` — the evidence-based way
decision, item priority, the nine-step preparation run with its consent table, the delivered
statuses incl. `NOT CREATABLE` and closure-by-evidence of test-data questions — exists in both
with the tool sections adapted and two `SHARED-3B-3C` blocks byte-identical; 3b's `mcp-pass.md`
§3a is 3c's `walk-rules.md` §3a with MCP wording). **Scope is where they deliberately differ** (user
decision, 2026-09-27): 3b keeps its scope gate (`references/scope-gate.md`, FULL / SHARED /
CUSTOM, one question) and its cross-validator question (`patch-rules.md` §1b); 3c has
`references/discovery-plan.md` instead — no scope question, no narrowing flag, every TC walked
on every run — and its `patch-rules.md` §1b is the no-question variant (3b evidence is
re-validated and replaced, never asked about). Do not "re-mirror" either direction without an
explicit instruction.

## Mirrored files — skills 4 and 5

`scripts/tc-hash.mjs` is byte-identical in `link-qc-4-publish-test-cases-azure` (canonical copy)
and `link-qc-5-test-run-automation`; its MIRROR banner says so. Both harnesses
(`selftest-ado-sync.mjs`, `selftest-tc-hash.mjs`) assert the same golden hash for the same fixture
TC, so drift fails a test. Change the canonical form only deliberately, bump `HASH_VERSION`, and
regenerate both goldens together — an old `automated_tc_sha256` then reads as a conflict, which is
the intended effect.

## Mirrored files — skills 5 and 5b

`scripts/render-run-report.mjs`, `scripts/selftest-run-report.mjs`, `scripts/scan-lib.mjs`,
`assets/run-report.template.html`, `assets/report-shell.template.html` and `scripts/fixtures/run-report/**`
are byte-identical in `link-qc-5-test-run-automation` (canonical copies) and `link-qc-5b-test-run-manual-cli`;
each carries a `MIRROR` banner (goldens listed in the fixture README instead). The report shell is therefore
mirrored FIVE ways — skills 3, 3b, 3c, 5 and 5b. Skill 5's `selftest-run-report.mjs` case 28 and the 5b copy
of the harness check the mirror; skill 3's case 27 checks the shell against both. `selftest-manual-run.mjs` and
`scripts/fixtures/manual-run/**` are 5b-only. Change skill 5's copy, copy it over, and regenerate the goldens
of both folders together.

## Mirrored file — the Azure MCP troubleshooting guide (skills 1, 2, 3, 4, 5, 7, 8, 9, 11)

`references/azure-mcp-troubleshooting.md` is byte-identical in the nine skills that touch the Azure
DevOps MCP; the canonical copy is skill 1's and every copy opens with the same `MIRROR` banner. No
script enforces it — check with `sha256sum .claude/skills/link-qc-*/references/azure-mcp-troubleshooting.md`
(nine identical hashes) before a commit. Each in-scope `SKILL.md` carries one short "Azure MCP failure"
block that links the guide and keeps the skill's own outcome wording (STOP / BLOCKED / `NOT_RUN` / drop to
`local`); the guide's §4 steps must match the prompts of `set-azure-devops-pat.ps1` / `.sh` word for word.
Row 7 (the optional `azure-devops-attachments` server) names the pinned package in its warm-up command — change it
together with `ADO_ATTACHMENTS_PACKAGE_PIN`, the launcher asset and `mcp-setup.md` §2d, then re-copy all nine.

## Mirrored files — skills 7, 8 and 9

`references/qc-contract.md` is byte-identical in `link-qc-7-sync-tc-status-to-azure`, `link-qc-8-sync-bugs-azure`
(canonical copy) and `link-qc-9-retesting`; its MIRROR banner says so. No script enforces it — check with
`sha256sum .claude/skills/link-qc-{7,8,9}-*/references/qc-contract.md` (three identical hashes) before a commit.
Skill 9 applies skill 8's push and create procedures inline (it reads
`../link-qc-8-sync-bugs-azure/references/md-to-azure.md` when present and falls back to contract §§4–6);
change a procedure there and re-read skill 9's steps 5–7.

## Conventions to keep

**Skill front-matter** needs `name` and `description`. The `description` is the trigger — keep its
trigger phrases when editing, and keep it in step with `INPUT.txt`. Add `argument-hint` where
useful, `model: claude-opus-5` where the skill already sets it — **never on skill 5**, which inherits the model selected
for the session (no `model:` key; a forced model switched the model at every invocation and rewrote the whole prompt
cache — user decision, 2026-10-25; the other skills' lines are a separate decision), `metadata: version: "x.y.z"` where
the skill is versioned (skill 5), and
`disable-model-invocation: true` for skills with side effects or session-wide effect (1, 12). Skill 1's
`allowed-tools` pre-approves only the three read-only script invocations — every mutation must go
through the normal permission flow. Skills 3 and 3b pre-approve only their two scripts
(`Bash(node *render-tc-review.mjs*)`, `Bash(node *selftest.mjs*)`); skill 3 has no Playwright MCP
at all, 3b has no Azure DevOps / Docx MCP. Skill 3c pre-approves the same two scripts plus
`Bash(node *capacity.mjs*)` (skill 5's, called by path for its session holds), `Bash(playwright-cli *)` and
`Bash(npx --no-install playwright-cli *)` and has **no MCP server of any kind** — never add `mcp__playwright` to it, never add `--browser-tool` or a CLI path to 3b. Skill 5b
pre-approves its three scripts (`Bash(node *render-run-report.mjs*)`, `Bash(node *selftest-run-report.mjs*)`,
`Bash(node *selftest-manual-run.mjs*)`) plus `Bash(node *capacity.mjs*)` and the same two `playwright-cli` forms and
likewise has **no MCP server of any kind** — never add `mcp__playwright` to it. Skill 9 pre-approves skill 5's four scripts it
calls by path (`Bash(node *run-stage.mjs*)`, `Bash(node *impact.mjs*)`, `Bash(node *render-run-report.mjs*)`,
`Bash(node *capacity.mjs*)`),
the same two `playwright-cli` forms, `mcp__azure-devops` and exactly the two attachment tools — never
`mcp__playwright` (user decision, 2026-10-19).

**When adding or renaming a skill**, update all of: `scripts/lib.mjs` (`SKILLS`,
`SKILL_RENAMES` — the old folder → new folder map that `sync-qa-skills.mjs --apply` uses to remove a
consumer's legacy folder and `validate-setup.mjs` reports as a WARN row —, `LEARNING_MODEL_SECTIONS`,
`LEARNING_LEGACY_HEADINGS` when a heading number changes, and, when it owns a folder, `TESTING_FOLDERS`),
`assets/project-learning.template.md`, the skill's own `SKILL.md` + `INPUT.txt`, skill 1's
`SKILL.md` / `INPUT.txt` counts, its `references/` (`testing-layout.md` chain + folder table,
`validation-contract.md` counts, `mcp-setup.md`, `project-learning-protocol.md`, `run-modes.md`,
`skills-sync.md`, `toolchain.md` when it needs a tool), `.claude/commands/sync-skills.md`, the
skill 12 pipeline overlay (`link-qc-12-adhd-output-style/SKILL.md` + `references/qa-pipeline.md`), `README.md` and this
file. The mirrored `learning-file.md` of skills 3 / 3b / 3c says "skills 1-11, 3b, 3c and 5b" — update
all three copies together or leave all three.

**link-qc-6-ui-testing specifics.** `SKILL.md` is the compact orchestrator (step table → one reference per
step); the verbatim method detail lives in `references/` — don't inline it back. Its
`browser_evaluate` snippets take **no parameters** (the Playwright MCP calls the function with
none) — keep selectors inlined. `Testing Type`, the Bug Trigger / Impact
/ Classification lists in `references/bug-metadata.md` and the EN + AR assumption are suite
defaults, overridable from the project's learning file — never hard-code a project into them.
No-design mode replaces only the ground truth (Step 2A); Steps 2C / 2D / 3 / 3A / 3B always run.
The Match Score is Σ(category score × weight)/100 with each category starting at 100. Pass 1b
(axe-core from the cdnjs CDN, one bug per violated rule, `incomplete` never counted), Pass 2b
(source trace: `Source:` is a real `file:line` or `not traced` — never guessed) and the
per-action `audit-log.md` (written as the audit runs; Coverage counts derive from it) are
contracts shared by `measurement-passes.md`, `capture-and-files.md`, `bug-metadata.md` and
`report-template.md` — change them together.

**When changing the TC document contract** (header lines incl. `Tag convention`, frozen anchors,
the per-TC shape incl. the optional `Tags` field, the `[A{n}]` / `[E{n}]` / `[D{n}]` reference
tokens and the `(intentional input)` escape, the `[HUMAN]` step marker, the six validation states
and their draft reasons (incl. `human step pending`), the PB / Q shapes, the stamp metadata keys
`tool` / `outcome-check` / `screenshot`, the TEST-DATA `## 0. Environment` / `## 1. Accounts`
tables, the optional `AI Oracle` field — after `Data Oracle`: Intent · Must contain · Must not contain ·
Language · Max length · Repeats / Pass threshold), keep in step: skill 3 `references/deliverables.md` + `tc-design.md` + `self-review.md`,
3b **and 3c** `references/tc-format-contract.md` + `patch-rules.md`, the mirrored
`html-page.md` / `validation-states.md`, the renderer's parser, the sample fixture and the
goldens (regenerated deliberately), skill 4's `tc-hash.mjs` (+ skill 5's copy) and
`ado-sync-plan.mjs` where they parse the field, and skill 5 where it resolves the tokens. For `AI Oracle`
in particular the consumers are: skill 3 `tc-design.md` / `deliverables.md` / `self-review.md`, 3b / 3c
`tc-format-contract.md` + the outcome rule, the mirrored `html-page.md`, the review renderer (case 28),
both `tc-hash.mjs` copies (an `AI Oracle=` part only when present, `HASH_VERSION` unchanged), skill 4's
meaning preservation and 5b's `references/ai-response-rules.md`.

**When changing skill 5's run report contract** (the two markdown shapes, the `skill6-run/1` run
file, the folder whitelist, the renderer's gates or the viewer), keep in step:
`references/run-report.md`, the parser and view model in `scripts/render-run-report.mjs`,
`assets/run-report.template.html`, `assets/report-shell.template.html` + the report-shell kit (a change there is also a skill 3 / 3b / 3c change: copy both, regenerate all four goldens), the fixture markdown / run files / golden page (regenerated
deliberately), `selftest-run-report.mjs`, 5b's byte-identical mirror of all of these (renderer, harness,
scan-lib, both templates, fixtures — regenerate its goldens with skill 5's) + its `references/run-report-manual.md`,
the `<result_organization>` (`references/results-and-evidence.md`) / `<second_run>` /
`<bug_report_format>` / `<publication>` (`references/final-run.md`) / `<checkpoint_b>` (`references/compliance-checkpoints.md`
§4a) blocks and the checklist + `<run_acceptance>` (`references/structured-returns.md`), `scripts/run-data.mjs`
(`merge`, `report` fragments, `verify`, `acceptance`, `publish`) + `selftest-run-data.mjs` + `fixtures/run-data/`,
`references/schemas/script-payloads.md`, `INPUT.txt`, skill 1's `references/testing-layout.md` and `README.md`.

**When changing skill 5's compliance rules**, keep these five in step: the `<checkpoint_a>` /
`<checkpoint_b>` blocks (`references/compliance-checkpoints.md` §3a / §4a) and `<quality_checklist>`
(`references/structured-returns.md`), with the every-activity rules of `SKILL.md`, the derived checklist in
`references/compliance-checkpoints.md`, the `[M]` / `[R]` tags in `references/code-craft.md`, the
rule catalogue in `scripts/validate-automation.mjs` (`RULES` + `LIMITS` + `RULE_CHECKS`), the check catalogue in
`scripts/check.mjs` (`CHECKS`: kinds, units, N/A predicates, never-N/A list) + `selftest-check.mjs` (its required
unit counts follow `RULE_CHECKS`), the runtime checks of `scripts/run-data.mjs verify`, `references/rule-registry.md`
(+ `selftest-references.mjs` case 4), `references/expected-differences.md` (+ `selftest-check.mjs` case 18 — a check
whose kind, units, predicate or never-N/A flag changes needs its row and, if it now differs, an `ED`) and the
exemptibility lists in
`references/validator.md`. A new rule needs a `scripts/fixtures/` case and a `selftest.mjs`
expectation — a true positive, a false-positive guard and a false-negative guard — or it is
unverified.

**When changing skill 5's shared config / timeout contract** (the setting table, the env-var
names, the timeout keys, the heartbeat / results record shapes, the watchdog verdicts, the
consolidation procedure, the stage messages), keep in step: `<shared_config>`
(`references/run-plan-and-config.md`) / `<live_progress>` / `<staged_execution>` / `<first_run>`
step 2b (`references/execution.md`) and the return's `Timeouts:` line (`references/structured-returns.md`),
`references/code-craft.md` §6, §8-9, §11 and §14, the nine `assets/*.template.ts`, `scripts/watchdog.mjs` +
`selftest-watchdog.mjs` + its fixtures, `scripts/run-stage.mjs` + `selftest-run-stage.mjs` +
`fixtures/run-stage/` (the fake Playwright emulates the helpers' records and annotations), `scripts/capacity.mjs`
+ `ledger-exec.mjs` + `selftest-capacity.mjs` (the lock protocol is shared with `rate-limit.template.ts`),
`scripts/dispatch.mjs` / `parallel-plan.mjs` + their harnesses, `scripts/run-data.mjs verify` (heartbeat events),
`scripts/impact.mjs` + `selftest-impact.mjs` + `fixtures/impact/` (the summary
`code{}` shape and the part ids), `scripts/config-inventory.mjs` + its harness, `<capacity_and_lease>` /
`<parallel_readiness>`, `references/schemas/script-payloads.md`,
`references/run-report.md` (§3 folder contract, §7 `timeouts` / `watchdog_events` /
`merged.stages[].source`), `INPUT.txt`, skill 1's `references/testing-layout.md` and `README.md`.
Deliberate departures from community Playwright practice are listed in code-craft §15 — change
one only on an explicit user instruction, and update the row.

**Progressive disclosure.** `SKILL.md` stays compact and delegates detail to `references/*.md`
loaded per step (skill 1 ≈ 110 lines over 9 references; skill 5 ≈ 200 lines over 19 references + the rule registry,
one per activity, with a block index — every moved block keeps its `<tag>`, so a pointer like
`<pom_mandatory>` still resolves). Load each reference once and keep it. Don't inline reference
content back into a SKILL.md.

**Hard rules the skills encode** (preserve them when editing):
- Human gates: skill 3's TC doc needs `Status: APPROVED` before 4 (refused otherwise); 5 and 5b proceed at
  once on `APPROVED` and on anything else ask ONCE — **approve now** (the skill rewrites the `Status:` line
  to `APPROVED`, nothing else in the document), **run without approval** (document untouched; recorded on the
  report's `Source document` line, in `### Deviations` and in the final message) or **stop** (BLOCKED);
  `--approve` / `--unapproved` answer in advance, a pipeline run with neither is BLOCKED, the choice is per
  run and never persisted (user decision, 2026-10-12). Each of 4 / 5 / 5b is unlocked independently;
  skill 11's findings need PO approval + `--apply-approved`; skill 1 Mode C needs a confirmed move plan.
  **Skill 4 is NOT a gate for skill 5** — `ADO-MAP.md` at a matching source hash only switches skill 5
  from `local` to `linked`; keep skills 4 and 5 saying the same thing about this. **5b is not a gate for
  anything.**
- **5b is a real run, report only.** Its entry rule is skill 5's (approved → run; otherwise the one approval
  question; the `Status:` line is the only byte of the TC document it may ever write); every TC of the document
  is executed in full and separately through playwright-cli — smoke first behind the 30 % smoke gate with
  NO self-heal (application-error majority → stopped and reported), then positive, then negative; statuses
  PASS / FAIL / INCOMPLETE / SKIP / NOT_RUN, a `[HUMAN]` step ends `PARTIAL — human step pending`, never
  PASS; an `AI Oracle` hard-check miss is `app_bug`, a rubric miss `ai_rubric_failure`, both a bug entry, and every assistant reply is stored verbatim
  in `reply.md` beside the screenshot; it writes only skill 5's report set into skill 5's story folder,
  sharing the phase counter and the `BUG-{n}` sequence, and never writes into the TC document (a design
  problem → skill 3 `--revision`). Like 3c it never receives a password, never installs, never uses MCP,
  never switches tool mid-run. Missing test data is prepared per the twelve principles below
  (`references/test-data-preparation.md`); `TEST-DATA` stays read-only for it.
- **Skill 9 retests through the automation or playwright-cli, never the Playwright MCP** (user decision,
  2026-10-19). One route per bug, never switched mid-bug: a TC carried by a test of skill 5's automation and
  held by the latest phase's run plan is re-run through skill 5's `run-stage.mjs --run rerun` (called by path;
  a test-code / environment / rate-limit failure is no verdict and is reported for skill 5 — skill 9 never edits
  automation code); every other bug goes through playwright-cli (the full TC when it has a row in the latest
  phase, else the bug's own steps; same login rules as 3c / 5b). The result updates the LATEST phase in place
  (see the Azure loop conventions), and in Azure the evidence is uploaded only AFTER the verified close / reopen.
  Before anything touches the environment it takes ITS OWN environment lease through skill 5's `capacity.mjs`
  (`--run-id skill9-…`, the phase's run file; held → BLOCKED naming the holder; skill 5 absent → BLOCKED), passes
  `--env-id` to every `run-stage.mjs` call and holds one capacity slot per open playwright-cli browser; both are
  released at the end (`references/coordination.md`). A 2.0 phase's gate records are never edited and the amended
  page is rendered without `--gate`.
- **AI Oracle** (optional TC field after `Data Oracle`: Intent · Must contain · Must not contain ·
  Language · Max length · Repeats / Pass threshold): designed by skill 3, judged by 5b from the reply
  text — hard checks + rubric against the pass threshold, never from a screenshot; no secret in the prompt
  or the rubric; automation candidacy NO by default; it enters the TC hash only when present.
- **Skill 3 is design-only; 3b and 3c are optional.** Skill 3 opens no browser and writes only
  `draft — not app-validated` (or `not-implemented` when told so); 3b (Playwright MCP) or 3c
  (playwright-cli) sets the other states from observation with evidence stamps (`tool: mcp | cli`);
  skills 4 and 5 accept an all-`draft` document and never ask for 3b or 3c. Neither validator adds
  a TC or changes a design field; a scenario the design missed is a coverage gap for skill 3
  `--revision`.
- **3b is the default validator; 3c is its evaluation twin.** 3c exists to be compared with 3b on
  identical inputs (`3c/references/cli-vs-mcp-comparison.md`: separate `comparison/` output
  copies, measured tokens / time / states / PBs / compatibility, no recommendation). Replacing 3b,
  changing a default or retiring either skill needs an explicit user instruction — never a
  conclusion drawn inside a skill or this repo. 3b got exactly one addition for 3c: the
  cross-validator check and the `tool: mcp` stamp key. The only other stamp key 3b writes is
  `outcome-check: human step pending` (shared with 3c for a `[HUMAN]` step).
- **Cross-validator check (3b):** before execution and before any automatic exclusion, every
  in-scope TC's own stamp is inspected; evidence written by 3c is asked about once (current vs
  stale; recommend skip current, re-validate stale), never silently reused or dropped; a skipped
  stale case never counts as validated; `--full` or an explicit compare / repeat instruction
  answers it in advance. **3c has no gate of this kind and no scope gate:** it walks every TC on
  every run, notes 3b evidence per TC (current vs stale at intake), re-validates it and replaces
  the stamp on observation, and lists those TC-IDs in the final message; `--full` is accepted as
  a no-op, `--scope shared|<ids>` is refused in one line and the full walk follows. The only TCs
  a 3c run leaves unobserved are the ones the application keeps out of reach (not implemented,
  data changes not authorized, data missing, screen could not be driven), each with its reason.
- **3c never receives a password** (attended login, or secret names from the user-run secrets
  file), never installs anything (`/sync-skills --tools` does), never uses MCP, never switches
  tool mid-run; a TC is `validated` only after its expected result was positively observed
  (`outcome-check`); data-changing TCs run only with the per-run "yes" and are reconciled.
- **Missing test data is prepared, not skipped — the twelve principles** (user decision,
  2026-10-13; byte-identical block in 3b / 3c `references/test-data-resolution.md`, skill 5
  `references/test-data-preparation.md` (PHASE 2.6) and 5b `references/test-data-preparation.md`,
  plus a shared consent table): for every
  `MISSING` / `UNKNOWN` item the skill searches a way in the order learning file → the automation
  project's helpers (manifest paths, then a search for create / seed / fixture / factory /
  pre-request / setup modules) → the application's create endpoints read from its source code
  (skill 10's `.project-profile.md` first) → a UI journey (creating TC / common flow / creation
  screen) → a DB helper → manual; "available" only by code, a screen seen live or a recorded
  decision (API docs alone = `to be confirmed`). **Consent follows the way:** a UI journey needs
  no question; an existing helper runs under the run's data-changes "yes"; an endpoint from the
  source code and a DB write each need an explicit "yes" naming the item, asked ONCE together
  after discovery and before the dependents; keep / clean-up is asked ONCE after the run (default
  keep); production named in the environment note stops every preparation. The seed is a
  temporary script in the session scratch folder (project helpers imported by absolute path,
  env selected the project's way, deleted afterwards — never new code in the repository, kept as
  a fixture only on request); fixtures are dedicated and right-sized; an item is `READY` only
  after its oracle confirmed it (screen + a read-only API / DB read when the screen hides the
  value); system-stamped values (dates, periods, codes, sequence numbers) are read back and used
  for the run, each substitution a Deviation / step-wording finding for skill 3, never a silent
  rewrite; permission / visibility / ownership preconditions are checked against the rule's
  source too; evidence that a state cannot exist is `NOT CREATABLE — {evidence}` (never "data
  missing"); a permission-layer refusal stops the step and is reported, never worked around; no
  secret is printed, logged, stored or passed on a command line and captured output is filtered;
  a pre-existing record is never modified. Runners (5, 5b) record every item in the readiness
  table / `data_readiness` as `READY` · `prepared (api|ui|db)` · `skip — data_missing` (no way
  found) · `skip — not creatable` · `skip — QC declined` (the run-report renderer counts them,
  warns on any other word, still accepts the legacy bare words); validators (3b, 3c) deliver a
  kept item `READY`, a removed one `MISSING` with a recreate note, write `NOT CREATABLE` (the
  fifth TEST-DATA status, accepted and counted by the review renderer, never written by skill 3)
  and stamp a walked TC `data: prepared this run ({way})`; draft reasons `data missing — D{n}` /
  `data not creatable — D{n}` exist only after the search. 3b prepares only for items whose
  dependents are inside the chosen scope; neither validator prepares in a 3b-vs-3c COMPARISON
  run. No seed runner is ever pre-approved in `allowed-tools`.
- **3c resolves test data from evidence** (`references/test-data-resolution.md`): each item's
  way is the first available in `e2e scenario → api → db → set directly → manual` (availability
  per the principles above); item priority High / Medium / Low from the using TCs; a test-data
  question is closed only by evidence (facts → `## Test Data`, never the Q&A); undecided items
  are asked ONCE after the walk, in the same message as keep / clean-up. 3b shares the file
  (MCP wording in the tool sections, the `SHARED-3B-3C` blocks byte-identical — not a `MIRROR`
  file, not in selftest case 0; check with a marker-bounded diff). The mirrored
  `open-questions.md` is untouched by this.
- **Approved documents and 3b:** read-only validation is always allowed; modifying needs the
  user's explicit revision authorization (asked once, `--authorize-revision` counts); `Status`
  becomes `PENDING HUMAN REVIEW` only when something actually changed; republish is mentioned only
  when an `ADO-MAP.md` exists. Besides 5 / 5b's user-instructed `APPROVED`, the only status flip any
  skill may make.
- **Coverage is requirement-based:** "Validation alone does not change design coverage;
  discovering a genuine coverage gap or updating cases may change it." App validation progress is
  the separate observation number.
- **Open questions** follow `references/open-questions.md` in skills 3, 3b and 3c: search first, one
  shape with a recommendation, never act on an unanswered recommendation, only confirmed answers
  reach the learning file.
- **Freshness:** a validation state survives only while its evidence stamp still matches the TC
  content, the requirement text, the environment, the build and the open questions; stale → draft
  and re-queued; enhancement-log and Potential-Bug history is appended, never replaced; a PB is
  resolved only after an actual successful retest.
- **The review page is rendered**, never hand-written; an Arabic page with missing / stale keys
  is a preview, never the deliverable. Both HTML pages are one general page (the shared report
  shell); the reviewer's channel back is `REVIEW-COMMENTS-{feature}.md`, saved from the page. A
  skill never creates, rewords, reorders or drops a comment — it only sets a handled entry's
  Status (`applied` / `answered` / `declined {date}`) and Response; a comment is never a status
  source (a bug is resolved only by a passing retest) and never a design change outside skill 3
  `--revision`.
- **Output language is English unless the current run asks otherwise** (skills 2, 3, 3b, 3c):
  `--lang ar` or an explicit sentence in the task input decides; the source language, a saved
  learning-file answer (no longer written), the document's `Review page language:` line (a
  record, rewritten after every render) and an existing sidecar never do. Narrative English,
  application labels in the application's language.
- **Configuration by reference, inputs inline** (skill 3 → 3b / 3c / 4 / 5): environment
  URLs / hosts, account usernames and shared datasets live only in TEST-DATA (`E{n}` / `A{n}` /
  `D{n}` rows) and a TC names them by token beside the plain name; each token resolves to its
  OWN row (never role → account, never "E1 = the URL"); typed test inputs and exact expected
  outputs stay inline. The tokens survive into Azure (skill 4's per-TC "Test data" block makes
  the item executable from Azure alone).
- **Tool limits never reduce coverage** (skill 3): an out-of-browser outcome gets a complete TC;
  the interface check (task input → learning file → ONE question) decides whether a step is
  ordinary (`[E{n}]` mail sandbox / SMS provider / OTP hook / job trigger) or `[HUMAN]`. Four
  separate axes: design coverage, automation candidacy, execution coverage (skill 5 `partial
  (human step: n)` / `PARTIAL — human step pending`, never PASS, never `Automated`), validation
  status (3b / 3c `draft — not app-validated (human step pending)`, never `validated`).
- **Page-object reuse is decided, not guessed** (skill 5): the automation inventory scans the
  whole automation root before any file is written; every screen gets a `reuse` / `extend` /
  `create` row naming each surfaced candidate; `pom-duplicate-page` is closed only by that row.
- **Azure sync is verified, owned and safe** (skill 4): field values come from the document and
  the decision script, never from a hard-coded default; pre-existing tags are never owned;
  `Automated` is kept only with a matching `automated_tc_sha256`; missing candidacy is `unknown`;
  every write is read back; the outcome word never claims more than the read-back proved; a
  supplementary snapshot `NOT_RUN` never blocks `PUBLISHED AND VERIFIED` when every required
  per-TC block was verified.
- **No project, product or customer name and no real host in any skill**: neutral examples
  (`Administrator`, `admin.user`, `Open Products`), placeholders in templates and fixtures.
- Skill 5 enforces **two machine gates**: `<checkpoint_a>` before execution and `<checkpoint_b>`
  on the final code, both of which must PASS for the delivered scope — decided by `check.mjs gate` from one
  result per check for a frozen snapshot, recorded in `.runs/phase-N.checkpoint-{A|B}.json`. The scanner gate is
  not the compliance gate — open `review[]` / `notRun[]` items must be closed by semantic review or the
  checkpoint is BLOCKED. The report set is drafted, frozen, checked by B and only then published byte for byte
  (`run-data.mjs publish`); `AUTOMATION COMPLETE` also needs the run ACCEPTED (`<run_acceptance>`: no unresolved
  possible concurrency defect or unexplained first-attempt regression, no required TC left unstarted by
  admission / pressure / deferral / the lease, a smoke verdict). Incremental Checkpoint B (`check.mjs carry`) is
  shadow only until separately approved.
- **Skill 5 runs inside the machine's capacity** (Revision 3.1 of the optimisation plan, approved 2026-10-24):
  the machine ceiling is AUTO (host memory / CPU, headed demand; the capacity config only bounds it, lower-only
  overrides — user decision, 2026-10-26: workers are never asked), every command reserves
  its workers in the ledger and releases them only when its tree is gone, host pressure holds new commands and
  tests back, and an environment lease (acquired at intake, released at close-out; skill 9 may take the same
  lease) keeps one run per environment on this machine. Ledger off ⇒ dispatch off — and ledger off is never
  uncoordinated: exclusive execution keeps the hard cap (user decision, 2026-10-24), and a command's slots are released
  only when a process table confirms its tree — browsers included — ended (no table → held); investigation probes and
  the playwright-cli browsers of skills 3c, 5b and 9 count against the ceiling too — one session hold per browser,
  taken before its `open`, released after a confirmed close (user decision, 2026-10-25). The parallel readiness check
  runs on every run and the default scheduler (`auto`) dispatches on a fresh OK payload — independent tests in batches
  the ramp sizes, conflicting units apart, unknown effects alone — and runs SERIALLY without that proof (user decision,
  2026-10-26); the silence rule is ACTIVE by default (fixed deadlines, meaningful progress only, bounded waits — a stuck
  step stopped within 120 s); run-stage telemetry is opt-in; an existing project's run protections are reconciled
  before Checkpoint A (`config-inventory.mjs reconcile`). Checkpoint semantic results are recorded in one `check.mjs
  record --batch` per checkpoint; the final return is a summary that links the report. Session reuse, reduced
  isolation / burn-in, reviewer delegation and model routing stay deferred.
- **Skill 5 runs from ONE shared `playwright.config.ts`** (Chrome, headed locally, runner-decided workers,
  `fullyParallel`), never a per-story file; a second config is merged only when its behaviour is
  reproducible and every reference is rewritten, deleted only when `config-inventory.mjs` lists it
  `deletable[]`, otherwise kept and reported. Timeouts come from `timeouts.ts` only and are
  calibrated from evidence, never raised to hide a broken locator or a frozen step; the watchdog
  stops a command only on a `FROZEN` verdict, keeps every finished result and names interrupted vs
  never-started TCs. Every Playwright command of a run goes through `run-stage.mjs`, one background
  call per stage, never polled; it also kills a command Playwright failed to stop at ceiling +
  margin. Progress is one chat message per finished stage (Smoke; Positive and Negative cumulative)
  plus immediate messages for a stop or blocker — never on a timer — labelled with activity names
  (Reviewing Requirements & Test Cases … Preparing Final Report, "first run" / "re-run"), never
  "Phase N" (user decision, 2026-10-16; the report's `## Phase N` run counter is unchanged). The
  consumer-project run and the probe are `NOT_RUN` here.
- **Skill 5 re-runs only what a fix touched** (user decision, 2026-10-19 — the clean full re-run is
  gone): after the first run and the heal, `impact.mjs select` returns the stale TCs (code changed since
  their latest attempt) and the TCs without a verdict; only those run again (`--run rerun`, healed ones
  through `--burn-in`), their attempts are merged into the SAME phase (latest attempt by start time wins,
  the rest keep their first-run result), app-bug failures are re-run only when stale, and Checkpoint B
  passes only with `stale: []` for every reported result. Max 2 heal iterations.
- **Parallelism never changes a TC's status** (user decision, 2026-10-19): a FAIL beside other tests is
  re-run alone before it counts (isolation check — a classification step, not a retry; `retries: 0`
  stays, the parallel attempt is kept and reported); a refusal by the application's rate limit is never a
  verdict (`rate_limited`, INCOMPLETE, never a bug); limits are detected and learned, never asked, and
  pace only the limited call (`helpers/rate-limit.ts` from `PW_RATE_LIMITS`) — every test still logs in
  through the UI (no storageState, code-craft §15). A serial `describe` is written only for a true
  chain; every other serial group is its tag plus its own `--workers=1` command.
- Never report PASS for a check that did not run — unprobed items are `NOT_RUN` (skill 1) or
  `unresolved` / `N/A + reason` (skill 5). This applies to both validators and to every checklist.
- No secrets in files, logs, chat, command lines or the learning file. "No code / no JSON in deliverables" has
  exactly one exception: the Arabic strings sidecar `TC-REVIEW-STRINGS-{feature}.ar.json`
  (human-readable strings only, written by the renderer and by filling its `ar` values).
- Skills 2/10/11 are read-only on source code and never modify specs.
- The `docx` MCP entry **must** carry `--with mcp<2`; unpinned `mcp` 2.x crashes the server on
  import. The legacy `word` server (`office-word-mcp-server`) is superseded and migrated by sync.

## Known state / quirks

- `docs/steering/` here holds the source documents under **non-canonical filenames**
  (`L1-testing-foundation-v1.1 1.md`, `L2-Testing-QA-Standards-v2.md`,
  `L3-final-integration-testing 2.md`). Skill 1 renames them to
  `L1-testing-foundation.md` / `L2-testing-qa-standards.md` / `L3-project-testing.md` in the
  consumer project. There is no `docs/steering/README.md` here — the template lives at
  `skills/1-.../assets/steering-readme.template.md`.
- L1 and L2 must stay product-generic; `validate-setup.mjs` flags product tokens in them.
- `.claude/agents/` is empty (a second working directory of agents may be attached to a session;
  it is not part of this repo).
- Consumer projects automated before the run-report layout still hold skill 5's older artifacts
  (`reports/[SPEC-*/]US-{id}/phase-N.json + .html`, `merged-results.json`, `run-plan.json`,
  `coverage-dashboard.html`, …). The skill treats them as read-only legacy history (phase
  numbering, `Earlier phases` line) and never migrates, moves or deletes them; the renderer lists
  them and never reads them as run data.

## Git

Branch `main`; commit and push only when asked. Projects pick changes up on their next
`/sync-skills`, so a push here is effectively a release — add an entry under `## [Unreleased]` in
`CHANGELOG.md` (one sub-list per skill touched; it doubles as the PR description), make sure
`SKILL.md`, `INPUT.txt`, `lib.mjs` and `README.md` are consistent, a changed versioned skill bumped its
`metadata.version`, and that all twenty-four self-test harnesses pass (skill 1's
`selftest.mjs`; skill 4's `selftest-ado-sync.mjs`; skill 5's validator, run-report, watchdog,
config-inventory, tc-hash, run-stage, impact, scratch, references, profile-run, check, run-data, coverage,
capacity, parallel-plan, dispatch and admission harnesses — run-stage in both variants, default and `QA_LEDGER_SELFTEST=on`,
the admission one on a local Playwright test runner (its NOT_RUN is not a pass), one harness after another, each with
its own temp folder and `QA_CAPACITY_DIR`; the mirrored one in skills 3, 3b and 3c including its
mirror case; and skill 5b's `selftest-run-report.mjs` — the run-report mirror — and
`selftest-manual-run.mjs`), before committing.

## Azure loop conventions (skills 7 to 9)

Three optional skills after publishing / automation; explicit invocation only
(`disable-model-invocation: true`), compact orchestrator `SKILL.md` (≤ 150 lines) + `INPUT.txt` +
the mirrored `references/qc-contract.md`. They share ONE learning section,
`### Azure Sync Model (skills 7 to 9)`. Rules the three encode:
- **MCP only.** `mcp__azure-devops` for every Azure read and write (skill 9 drives the application through skill 5's
  `run-stage.mjs` for automated TCs and `playwright-cli` for the rest — never the Playwright MCP); never a PAT, a `.env`, REST or
  a shell HTTP call — skill 4's REST suite fallback does not apply to them. 401 → "fully quit VS Code and
  relaunch", never "reconnect". Test-plan capabilities exist on the cloud server only; a missing capability
  is `NOT_RUN` with the reason, never a fallback.
- **Evidence attachments are laddered, identity-checked and verified** (contract §3 / §6 / §6b, 2026-10-13):
  upload only through an MCP tool that takes a FILE PATH — the attached `azure-devops` server's own
  (self-hosted), else the optional `azure-devops-attachments` server (cloud; skills 8 / 9 list exactly
  `create_work_item_attachment` / `delete_work_item_attachment` in `allowed-tools`, never another use), else
  `NOT_RUN (no upload-capable MCP server)` pending in the ledger Note with the manual instruction; never REST,
  never an inline base64 upload. Before any upload the evidence files are sha256-hashed: two bugs sharing one
  byte-identical image is a producer defect — the image goes to the bug whose Actual result it shows, the other
  gets the correct image from the same attempt folder (`evidence_substituted=`) or stays pending; the producer
  report is never edited. Name `BUG-{n}-{TC-ID}-phase-{N}-{original}`, comment `BUG-{n} evidence - …`, no duplicate
  names, and an upload counts only after read-back (`AttachedFile` relation with that name, `resourceSize` = local
  byte size). Delete only a file this skill added in error. Note keys `attachments=`, `pending: attach …`,
  `evidence_substituted=`.
- **Skill 8 is one skill with a direction gate**: `--direction md-to-azure | azure-to-md | both`, otherwise ONE
  question with a ledger-derived recommendation, answered per run and never persisted. `both` pulls first.
- **Asymmetric truth rule.** Azure DevOps is the truth for `open` (a developer-side reopen is mirrored at
  once); an actual successful retest (skill 9) is the only source of a local `resolved`; an Azure Resolved is
  recorded as *awaiting retest*; a local resolved without retest evidence is never pushed.
- **The ledger `ADO-BUG-MAP.md`** lives beside `ADO-MAP.md` in the story's TestCases folder — never in the
  reports folder (skill 5's whitelist). Identity is (source path, Bug ID); rows are never dropped; local and
  Azure baselines are kept apart; ADO ids never go into a bug entry.
- **Producer documents stay the producers'.** In `BUG-REPORT-{feature}.md` only `Status`, appended
  `History` lines and the recomputed `**Bugs:**` header change (the renderer's vocabulary: `open` ·
  `resolved (phase N)` · `not-checked-this-run`); skill 9 may append a new `### BUG-{n}` entry. **Skill 9 alone updates
  the LATEST run-report phase in place** (user decision, 2026-10-19): the rows of TCs it re-ran in full with a
  product verdict, a `{Stage} (retest — skill 9)` Stages row and the Total, the Outcome, the `### Bugs` table, one
  `- **Retest:**` bullet, `### Deviations` lines, the header and the phase's run-history row, and
  `.runs/phase-N.json` to match (`retests[]` append-only); never an earlier phase, never a row added or removed,
  never automation code; the page is re-rendered by skill 5's renderer and delivered only at gate PASS
  (procedure: skill 9 `references/report-update.md`; skill 5 `run-report.md` §3). UI reports
  are read-only (their state lives in the ledger). TC documents and `ADO-MAP.md` are never edited (skill 4's
  `--suite-only` owns the `Suite` column).
- **No project value** (assignee, tags, story title, path, selector, language label) is a default: task input
  → learning-file `[type: env]` → MCP discovery → ask once.
When adding or renaming a member: the three contract mirrors, `SKILLS` / `SKILL_RENAMES`, the learning
section and `LEARNING_LEGACY_HEADINGS`, the INPUT files, the skill 12 overlay and README.
