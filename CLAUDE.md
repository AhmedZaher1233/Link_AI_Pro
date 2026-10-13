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
      SKILL.md INPUT.txt references/ (10, incl. azure-mcp-troubleshooting.md — CANONICAL, mirrored in 2, 3, 4, 5, 7, 8, 9, 11) scripts/ (4 .mjs + selftest.mjs + fixtures/mcp/ + set-azure-devops-pat + check-azure-devops-pat + set-playwright-secrets .ps1/.sh) assets/ (4 templates)
    link-qc-2-review-requirements/                 story/spec → REQ-*.md + review
    link-qc-3-generate-manual-test-cases/          manual TCs (EN/AR), DESIGN ONLY, rendered HTML review page (human gate)
      SKILL.md INPUT.txt references/ (8) scripts/ (render-tc-review, selftest, fixtures/) assets/ (2: tc-review body partial + report-shell — the one general HTML page, shared with skill 5)
    link-qc-3b-validate-manual-test-cases/         OPTIONAL live validation of a TC doc (Playwright MCP), patches in place — the default validator
      SKILL.md INPUT.txt references/ (11, incl. test-data-resolution.md — SHARED-3B-3C blocks byte-identical with 3c's) scripts/ + assets/ = byte-identical mirrors of skill 3's
    link-qc-3c-validate-manual-test-cases-cli/     OPTIONAL evaluation twin of 3b on playwright-cli (no MCP); same contracts; NO scope gate (walks every TC); comparison protocol
      SKILL.md INPUT.txt references/ (13, incl. test-data-resolution.md — shared contract with 3b) assets/ (template mirror + comparison template) scripts/ = mirrors of skill 3's
    link-qc-4-publish-test-cases-azure/            beautify approved TCs → Azure DevOps + ADO-MAP.md with verified tags / automation status; --suite-only places published TCs in a Test Plan suite later
      SKILL.md INPUT.txt scripts/ (ado-sync-plan, tc-hash — canonical copy, selftest-ado-sync + fixtures/ado-sync/)
    link-qc-5-test-run-automation/                 Playwright POM generation (automation inventory first) + phased run + 2 compliance gates
      SKILL.md INPUT.txt references/ (5: automation-rules, compliance-checkpoints, run-report, validator, code-craft) scripts/ (11 + fixtures/: the 9 below plus tc-hash — mirror of skill 4's — and selftest-tc-hash) assets/ (8: run-report body partial + report-shell mirror, 6 *.template.ts copied into consumer projects)
    link-qc-5b-test-run-manual-cli/                manual twin of 5: every TC of an APPROVED document run in full through playwright-cli (no MCP), smoke gate without heal, `AI Oracle` TCs judged by rubric; writes skill 5's report set into skill 5's story folder — report only, gates nothing
      SKILL.md INPUT.txt references/ (10: intake, browser-cli, run-plan, execution-rules, test-data-preparation, ai-response-rules, run-report-manual, open-questions, learning-file, self-review) scripts/ (render-run-report, selftest-run-report, scan-lib + fixtures/run-report/ — mirrors of skill 5's; selftest-manual-run + fixtures/manual-run/ — 5b-only) assets/ (2: run-report body partial + report-shell — mirrors)
    link-qc-6-ui-testing/                          visual UI audit of one implemented screen vs its design (Playwright MCP; optional Figma MCP) or, with no design, vs tokens / consistency / WCAG / RTL — beside the chain, gates nothing
      SKILL.md (≈420 lines, orchestrator) INPUT.txt references/ (10: capture-and-files, no-design-audit, measurement-passes, coverage-passes, bug-metadata, annotation, annotation-fallback, report-template, learning-and-coverage-index, second-round) — no scripts
    link-qc-7-sync-tc-status-to-azure/             Azure loop: latest TC outcomes → ONE Test Plan run (cloud test-plan tools; otherwise NOT_RUN) — SKILL.md INPUT.txt references/qc-contract.md (mirror)
    link-qc-8-sync-bugs-azure/                     Azure loop: two-way bug sync, direction gate (md → Azure creates + pushes · Azure → md pulls · both), ADO-BUG-MAP.md ledger
      SKILL.md INPUT.txt references/ (qc-contract.md — CANONICAL copy, md-to-azure.md, azure-to-md.md)
    link-qc-9-retesting/                           Azure loop: retest bugs live (Playwright MCP), close / reopen in Azure with evidence, incidental bugs — SKILL.md INPUT.txt references/qc-contract.md (mirror)
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
and the canonical TC hash; skill 5 owns the automation-code validator.

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
- `tc-hash.mjs` + `selftest-tc-hash.mjs`: the byte-identical copy of skill 4's canonical hash
  (see skill 4's section) and its harness — the close-out writes `automated_tc_sha256` with it
  for every TC that ran `full` coverage with PASS after Checkpoint B PASS, never for a `PARTIAL`
  TC. Regenerate the golden hash only together with skill 4's.
- `selftest.mjs` (9 cases over `fixtures/mcp/`, the last one `planReplace` — only our folders replaced / removed) **exits non-zero on mismatch by design**: the
  sync guard (azure-devops byte-identical, cloud and self-hosted), the plan never naming
  azure-devops, `detectAdoHosting`, `scanMcp` inline-token detection, `scanPat` session-vs-machine
  (probe-injected, never the registry) and the template's placeholder-only check. Run it after
  any change to `lib.mjs`, the template or the PAT handling.
- `set-playwright-secrets.ps1` / `.sh` (optional, skills 3c and 5b) are likewise user-run: per-role
  `{ROLE}_USER` / `{ROLE}_PASSWORD` lines in `~/.link-ai-pro/playwright-secrets.env` and the
  user-level `PLAYWRIGHT_MCP_SECRETS_FILE` pointing at it. `scanBrowserSecrets` checks existence
  only; nothing in this repo ever reads the file.
- `sync-qa-skills.mjs --apply --tools` (opt-in) installs `@playwright/cli` globally, runs
  `playwright-cli install-browser` and adds `.playwright-cli/` to `.gitignore` (skills 3c and 5b), and
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
  `_optional_figma_server_for_qc_ui`; skill 1 adds it only on request.

### `skills/link-qc-5-test-run-automation/scripts/`

```bash
node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root <project> --pretty [--files a,b] [--tc-ids <csv|file>] [--req-ids <csv|file>] [--inventory <automation-inventory.md>] [--require-steps] [--strict]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/tc-hash.mjs --tc <TEST-CASES md> [--data <TEST-DATA md>] [--ids a,b] --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-tc-hash.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/render-run-report.mjs --report <TEST-RUN-REPORT-{feature}.md> [--bugs <BUG-REPORT-{feature}.md>] [--runs <dir>] [--out <html>] [--write] [--force] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-report.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/watchdog.mjs --plan <group-or-run-plan.json> [--group <name>] --heartbeat <jsonl> [--results <jsonl>] [--now <ISO>] [--grace <ms>] [--out <watchdog.json>] [--write] [--strict] [--pretty]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-watchdog.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/config-inventory.mjs --root <project> [--automation-root <dir>] --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-config-inventory.mjs --pretty
```

- `scan-lib.mjs` is the text engine (comment/string stripper that preserves line numbers, brace
  balancing, relative-import resolution, sha256). It is **self-contained** — never import skill
  1's `lib.mjs` across skill folders, because `/sync-skills` copies one skill folder at a time;
  `parseArgs` and `print` are copied verbatim and must stay behaviourally identical.
- `validate-automation.mjs` is a **screen, not a judge**. It is deliberately not a parser: what a
  token scan cannot decide is emitted at severity `review` and left to semantic review, never
  guessed. Default exit 0; `--strict` maps the gate (FAIL 1 · BLOCKED 2 · NOT_RUN 3) for CI.
  Rule ids, the exemptible/non-exemptible split and the documented limits live in
  `references/validator.md` — change them together. `pom-duplicate-page` (severity `review`)
  reports two page classes that look like the same page (normalised class name, identical
  `goto` / URL literal, or ≥ 2 identical locator strings) across the WHOLE automation root; with
  `--inventory <automation-inventory.md>` a pair covered by a decision row becomes
  `pom-duplicate-page-decided` (info). Matching only produces candidates — the decision table is
  the verdict. An undecided pair is the ONE review item that moves the scanner gate itself to
  BLOCKED (`--strict` exit 2; documented in `validator.md`), so an unaddressed candidate can never
  pass Checkpoint A / B.
- `selftest.mjs` **exits non-zero on mismatch by design** (it is a harness, not a reporting
  script). Run it after any validator change. Its seventeen cases include the false-PASS guards
  and, for the three timing rules (`wait-network-idle`, `positional-unscoped`, `step-missing`
  behind `--require-steps`), true positives, false-positive guards and false-negative guards on
  `timing*.fixture.ts`; when adding a rule, add the fixture case with it. The fingerprint hashes
  one hop of each config's relative imports (`timeouts.ts`) — case 17.
- `watchdog.mjs` is the freeze decision + result reconstruction for one stage command: it reads
  the heartbeat (`helpers/steps.ts`) and the incremental results (`helpers/progress-reporter.ts`)
  and declares a worker `FROZEN` only when an open step is past its OWN deadline + grace with no
  progress, no newer worker record and no newer result — console silence and a stale stage JSON
  never count. Dry-run by default; `--write` produces the `*.watchdog.json` (completed /
  interrupted / not_started). `selftest-watchdog.mjs` (10 cases, golden under
  `fixtures/watchdog/golden/`) exits non-zero on mismatch.
- `config-inventory.mjs` lists every `playwright*.config.*`, every reference to each (package
  scripts, CI, docs, other configs, code — comments and code fences count) and the settings that
  block a merge; `deletable[]` is the ONLY authority for removing a consolidated config. It never
  deletes. `selftest-config-inventory.mjs` (7 cases over `fixtures/config-inventory/`) exits
  non-zero on mismatch.
- `assets/*.template.ts` (`playwright.config`, `timeouts`, `steps`, `progress-reporter`,
  `console-guard`, `test-data`) are TypeScript the skill copies INTO a consumer project when the
  equivalent is absent. They are never executed here; the consumer-project acceptance probe in
  `<shared_config>` is what verifies them, and it is reported `NOT_RUN` in this repo.
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
  the provenance line gains an optional `comments=` hash (v1.0 pages still verify). The contract
  lives in `references/run-report.md` (§9b comments, §10 templates).
- `selftest-run-report.mjs` exits non-zero on mismatch by design; its 29 cases (23 PARTIAL rows, 24 reviewer comments, 25 one shell per page, 26 shell + kit mirror with 3 / 3b / 3c, 27 the `ai_rubric_failure` classification, 28 the full mirror with 5b — renderer, harness, scan-lib, both templates, run-report fixtures, 29 the test-data readiness decisions counted per phase) run on a temporary
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
useful, `model: claude-opus-5` where the skill already sets it, and
`disable-model-invocation: true` for skills with side effects or session-wide effect (1, 12). Skill 1's
`allowed-tools` pre-approves only the three read-only script invocations — every mutation must go
through the normal permission flow. Skills 3 and 3b pre-approve only their two scripts
(`Bash(node *render-tc-review.mjs*)`, `Bash(node *selftest.mjs*)`); skill 3 has no Playwright MCP
at all, 3b has no Azure DevOps / Docx MCP. Skill 3c pre-approves the same two scripts plus
`Bash(playwright-cli *)` and `Bash(npx --no-install playwright-cli *)` and has **no MCP server of
any kind** — never add `mcp__playwright` to it, never add `--browser-tool` or a CLI path to 3b. Skill 5b
pre-approves its three scripts (`Bash(node *render-run-report.mjs*)`, `Bash(node *selftest-run-report.mjs*)`,
`Bash(node *selftest-manual-run.mjs*)`) plus the same two `playwright-cli` forms and likewise has **no MCP
server of any kind** — never add `mcp__playwright` to it.

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
the `<result_organization>` / `<second_run>` /
`<checkpoint_b>` / `<bug_report_format>` blocks and the checklist in `SKILL.md`, `INPUT.txt`,
skill 1's `references/testing-layout.md` and `README.md`.

**When changing skill 5's compliance rules**, keep these five in step: the `<checkpoint_a>` /
`<checkpoint_b>` blocks and `<quality_checklist>` in `SKILL.md`, the derived checklist in
`references/compliance-checkpoints.md`, the `[M]` / `[R]` tags in `references/code-craft.md`, the
rule catalogue in `scripts/validate-automation.mjs` (`RULES` + `LIMITS`) and its mirror in
`references/validator.md`. A new rule needs a `scripts/fixtures/` case and a `selftest.mjs`
expectation — a true positive, a false-positive guard and a false-negative guard — or it is
unverified.

**When changing skill 5's shared config / timeout contract** (the setting table, the env-var
names, the timeout keys, the heartbeat / results record shapes, the watchdog verdicts, the
consolidation procedure), keep in step: `<shared_config>` / `<live_progress>` /
`<staged_execution>` / `<first_run>` step 2b and the Timeout policy section in `SKILL.md`,
`references/code-craft.md` §8-9 and §14, the six `assets/*.template.ts`, `scripts/watchdog.mjs` +
`selftest-watchdog.mjs` + its fixtures, `scripts/config-inventory.mjs` + its harness,
`references/run-report.md` (§3 folder contract, §7 `timeouts` / `watchdog_events` /
`merged.stages[].source`), `INPUT.txt`, skill 1's `references/testing-layout.md` and `README.md`.
Deliberate departures from community Playwright practice are listed in code-craft §15 — change
one only on an explicit user instruction, and update the row.

**Progressive disclosure.** `SKILL.md` stays compact and delegates detail to `references/*.md`
loaded per step (skill 1 ≈ 110 lines over 9 references). Don't inline reference content back into
a SKILL.md.

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
  PHASE 2.6 and 5b `references/test-data-preparation.md`, plus a shared consent table): for every
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
  on the final code, both of which must PASS for the delivered scope. The scanner gate is not the
  compliance gate — open `review[]` / `notRun[]` items must be closed by semantic review or the
  checkpoint is BLOCKED.
- **Skill 5 runs from ONE shared `playwright.config.ts`** (Chrome, headed, 2 workers,
  `fullyParallel`), never a per-story file; a second config is merged only when its behaviour is
  reproducible and every reference is rewritten, deleted only when `config-inventory.mjs` lists it
  `deletable[]`, otherwise kept and reported. Timeouts come from `timeouts.ts` only and are
  calibrated from evidence, never raised to hide a broken locator or a frozen step; the watchdog
  stops a command only on a `FROZEN` verdict, keeps every finished result and names interrupted vs
  never-started TCs. The consumer-project run and the probe are `NOT_RUN` here.
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
`SKILL.md`, `INPUT.txt`, `lib.mjs` and `README.md` are consistent, and that all twelve self-test
harnesses pass (skill 1's
`selftest.mjs`; skill 4's `selftest-ado-sync.mjs`; skill 5's validator, run-report, watchdog,
config-inventory and tc-hash harnesses; the mirrored one in skills 3, 3b and 3c including its
mirror case; and skill 5b's `selftest-run-report.mjs` — the run-report mirror — and
`selftest-manual-run.mjs`), before committing.

## Azure loop conventions (skills 7 to 9)

Three optional skills after publishing / automation; explicit invocation only
(`disable-model-invocation: true`), compact orchestrator `SKILL.md` (≤ 150 lines) + `INPUT.txt` +
the mirrored `references/qc-contract.md`. They share ONE learning section,
`### Azure Sync Model (skills 7 to 9)`. Rules the three encode:
- **MCP only.** `mcp__azure-devops` (plus `mcp__playwright` for skill 9); never a PAT, a `.env`, REST or
  a shell HTTP call — skill 4's REST suite fallback does not apply to them. 401 → "fully quit VS Code and
  relaunch", never "reconnect". Test-plan capabilities exist on the cloud server only; a missing capability
  is `NOT_RUN` with the reason, never a fallback.
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
  `resolved (phase N)` · `not-checked-this-run`); skill 9 may append a new `### BUG-{n}` entry. UI reports
  are read-only (their state lives in the ledger). TC documents and `ADO-MAP.md` are never edited (skill 4's
  `--suite-only` owns the `Suite` column).
- **No project value** (assignee, tags, story title, path, selector, language label) is a default: task input
  → learning-file `[type: env]` → MCP discovery → ask once.
When adding or renaming a member: the three contract mirrors, `SKILLS` / `SKILL_RENAMES`, the learning
section and `LEARNING_LEGACY_HEADINGS`, the INPUT files, the skill 12 overlay and README.
