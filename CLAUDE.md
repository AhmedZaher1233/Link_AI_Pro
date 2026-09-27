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
belongs in this repo. The sync set is `SKILLS` in `lib.mjs`: fourteen folders named `link-qc-{N}-{purpose}` in
test-cycle order — 1 setup, 2 review, 3 / 3b / 3c manual TCs and their live validation, 4 publish, 5 automation,
6 UI audit (beside the chain, gates nothing), 7-9 the optional Azure loop (TC outcomes, two-way bug sync,
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
      SKILL.md INPUT.txt references/ (9) scripts/ (4 .mjs + selftest.mjs + fixtures/mcp/ + set-azure-devops-pat + set-playwright-secrets .ps1/.sh) assets/ (4 templates)
    link-qc-2-review-requirements/                 story/spec → REQ-*.md + review
    link-qc-3-generate-manual-test-cases/          manual TCs (EN/AR), DESIGN ONLY, rendered HTML review page (human gate)
      SKILL.md INPUT.txt references/ (8) scripts/ (render-tc-review, selftest, fixtures/) assets/ (1)
    link-qc-3b-validate-manual-test-cases/         OPTIONAL live validation of a TC doc (Playwright MCP), patches in place — the default validator
      SKILL.md INPUT.txt references/ (10) scripts/ + assets/ = byte-identical mirrors of skill 3's
    link-qc-3c-validate-manual-test-cases-cli/     OPTIONAL evaluation twin of 3b on playwright-cli (no MCP); same contracts; NO scope gate (walks every TC); comparison protocol
      SKILL.md INPUT.txt references/ (12) assets/ (template mirror + comparison template) scripts/ = mirrors of skill 3's
    link-qc-4-publish-test-cases-azure/            beautify approved TCs → Azure DevOps + ADO-MAP.md; --suite-only places published TCs in a Test Plan suite later
    link-qc-5-test-run-automation/                 Playwright POM generation + phased run + 2 compliance gates
      SKILL.md INPUT.txt references/ (5: automation-rules, compliance-checkpoints, run-report, validator, code-craft) scripts/ (9 + fixtures/) assets/ (8: run-report template + css, 6 *.template.ts copied into consumer projects)
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
human output). Skill 1 owns the project-setup scripts; skill 5 owns the automation-code validator.

### `skills/link-qc-1-generate-update-testing-structure/scripts/`

The three `.mjs` entry points always exit 0 — the result lives in the payload; `selftest.mjs` is
the harness and exits non-zero on mismatch.

```bash
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/preflight.mjs      --root <project> --pretty
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/validate-setup.mjs --root <project> --pretty [--mcp k=PASS,…] [--sync-report x.json]
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/sync-qa-skills.mjs --check|--apply --pretty [--target <dir>] [--only <skill>]… [--force] [--no-mcp] [--tools] [--branch main]
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/selftest.mjs --pretty
```

- `lib.mjs` holds every shared scanner and **all the canonical constants** (`SKILLS`,
  `TESTING_FOLDERS`, `STEERING_CANONICAL`, `LEARNING_*`, `MCP_REQUIRED`, `DOCX_*`, `MANIFEST`).
  Change a name there first, then everywhere it is echoed in prose.
- `sync-qa-skills.mjs` **refuses to run when the git origin is this repo** — use `git pull` here.
  It is the single implementation of sync; `sync-skills.md` must stay a wrapper and never
  re-describe the algorithm in prose.
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
- `selftest.mjs` (8 cases over `fixtures/mcp/`) **exits non-zero on mismatch by design**: the
  sync guard (azure-devops byte-identical, cloud and self-hosted), the plan never naming
  azure-devops, `detectAdoHosting`, `scanMcp` inline-token detection, `scanPat` session-vs-machine
  (probe-injected, never the registry) and the template's placeholder-only check. Run it after
  any change to `lib.mjs`, the template or the PAT handling.
- `set-playwright-secrets.ps1` / `.sh` (optional, skill 3c) are likewise user-run: per-role
  `{ROLE}_USER` / `{ROLE}_PASSWORD` lines in `~/.link-ai-pro/playwright-secrets.env` and the
  user-level `PLAYWRIGHT_MCP_SECRETS_FILE` pointing at it. `scanBrowserSecrets` checks existence
  only; nothing in this repo ever reads the file.
- `sync-qa-skills.mjs --apply --tools` (opt-in) installs `@playwright/cli` globally, runs
  `playwright-cli install-browser` and adds `.playwright-cli/` to `.gitignore` (skill 3c), and
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
node .claude/skills/link-qc-5-test-run-automation/scripts/validate-automation.mjs --root <project> --pretty [--files a,b] [--tc-ids <csv|file>] [--req-ids <csv|file>] [--require-steps] [--strict]
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest.mjs --pretty
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
  `references/validator.md` — change them together.
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
  rendered. It copies skill 3's template engine and never imports it (sync copies one folder).
  The contract lives in `references/run-report.md`.
- `selftest-run-report.mjs` exits non-zero on mismatch by design; its 22 cases run on a temporary
  copy of `scripts/fixtures/run-report/automation/` (a story with two phases, two bugs and PNG
  stubs) and compare against `scripts/fixtures/run-report/golden/`. Regenerate the golden only for
  a deliberate change (command in the fixture README).

### `skills/link-qc-3-generate-manual-test-cases/scripts/` = `skills/link-qc-3b-validate-manual-test-cases/scripts/` = `skills/link-qc-3c-validate-manual-test-cases-cli/scripts/`

```bash
node .claude/skills/link-qc-3-generate-manual-test-cases/scripts/render-tc-review.mjs --tc <TEST-CASES-{feature}.md> [--data <TEST-DATA.md>] [--out <html>] [--lang en|ar] [--strings <json>] [--write] [--write-skeleton] [--emit-keys] [--force] [--strict] [--pretty]
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
  the clock. `--strict` maps the gate (PASS 0 · MISMATCH 1 · BLOCKED 2 · NOT_RUN 3).
- `--write-skeleton` **merges** the sidecar and never resets a translation (unchanged `en` keeps
  its `ar`; changed → `stale` with the old `ar` kept; new → `ar: null`; removed → `orphan`). A
  page rendered with missing / stale keys is a preview (`arabicComplete: false`).
- `selftest.mjs` exits non-zero on mismatch by design; its 21 cases cover the golden EN / AR /
  legacy pages, the merge rule, the false-PASS guards, exit codes, provenance, **case 20 (run
  metadata — the `by 3c … , tool cli` header, the `tool` / `outcome-check` stamp keys and the
  `screenshot` pb-meta key are parsed into the payload and never rendered)** and **case 0, the
  mirror check** (sha256 of every mirrored path against every sibling skill folder present —
  `MIRROR_SKILLS` = 3, 3b, 3c; `skipped` only when none is present). Regenerate a golden only for a
  deliberate change (`scripts/fixtures/MIRROR.md`).
- The renderer reads both validators' header stamps (`by 3b on …` / `by 3c on …, tool cli`) and
  picks the matching chrome string; `document.stamp.by` / `.tool`, `document.evidence[]` and
  `document.potentialBugs[]` carry the run metadata for the 3b-vs-3c comparison.

## Mirrored files — skills 3, 3b and 3c

`/sync-skills` copies one skill folder at a time, so the three skills never import from each other;
what they share is duplicated **byte-for-byte** and must be edited in all three places:
`references/learning-file.md`, `references/html-page.md`, `references/validation-states.md`,
`references/open-questions.md`, `assets/tc-review.template.html`, `scripts/render-tc-review.mjs`,
`scripts/selftest.mjs`, `scripts/fixtures/**`. Each file carries a `MIRROR` banner in its own
comment syntax (JSON / HTML goldens are listed in `scripts/fixtures/MIRROR.md` instead); self-test
case 0 enforces it against every sibling present. Prose blocks that must say the same thing in the
SKILL.md files of 3, 3b and 3c: the approved-document rule (3b / 3c invariant 5 / skill 3
invariant 7), the coverage rule ("Validation alone does not change design coverage; discovering a
genuine coverage gap or updating cases may change it"), the no-code rule with the sidecar
exception, the frozen field list, and "3b / 3c is not a gate". Between 3b and 3c only: the
freshness / PB / open-question rules, which 3c copied from 3b and adapted only where the browser
tool differs (`walk-rules.md` = 3b's `mcp-pass.md` made tool-neutral + §3a data changes + §6a
outcome rule; `browser-cli.md` is 3c-only). **Scope is where they deliberately differ** (user
decision, 2026-09-27): 3b keeps its scope gate (`references/scope-gate.md`, FULL / SHARED /
CUSTOM, one question) and its cross-validator question (`patch-rules.md` §1b); 3c has
`references/discovery-plan.md` instead — no scope question, no narrowing flag, every TC walked
on every run — and its `patch-rules.md` §1b is the no-question variant (3b evidence is
re-validated and replaced, never asked about). Do not "re-mirror" either direction without an
explicit instruction.

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
any kind** — never add `mcp__playwright` to it, never add `--browser-tool` or a CLI path to 3b.

**When adding or renaming a skill**, update all of: `scripts/lib.mjs` (`SKILLS`,
`SKILL_RENAMES` — the old folder → new folder map that `sync-qa-skills.mjs --apply` uses to remove a
consumer's legacy folder and `validate-setup.mjs` reports as a WARN row —, `LEARNING_MODEL_SECTIONS`,
`LEARNING_LEGACY_HEADINGS` when a heading number changes, and, when it owns a folder, `TESTING_FOLDERS`),
`assets/project-learning.template.md`, the skill's own `SKILL.md` + `INPUT.txt`, skill 1's
`SKILL.md` / `INPUT.txt` counts, its `references/` (`testing-layout.md` chain + folder table,
`validation-contract.md` counts, `mcp-setup.md`, `project-learning-protocol.md`, `run-modes.md`,
`skills-sync.md`, `toolchain.md` when it needs a tool), `.claude/commands/sync-skills.md`, the
skill 12 pipeline overlay (`link-qc-12-adhd-output-style/SKILL.md` + `references/qa-pipeline.md`), `README.md` and this
file. The mirrored `learning-file.md` of skills 3 / 3b / 3c says "skills 1-11, 3b and 3c" — update
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

**When changing the TC document contract** (header lines, frozen anchors, the per-TC shape, the
six validation states, the PB / Q shapes, the stamp metadata keys `tool` / `outcome-check` /
`screenshot`), keep in step: skill 3 `references/deliverables.md` + `tc-design.md`, 3b **and 3c**
`references/tc-format-contract.md` + `patch-rules.md`, the mirrored
`html-page.md` / `validation-states.md`, the renderer's parser, the sample fixture and the
goldens (regenerated deliberately), and skills 4 / 5 where they parse the field.

**When changing skill 5's run report contract** (the two markdown shapes, the `skill6-run/1` run
file, the folder whitelist, the renderer's gates or the viewer), keep in step:
`references/run-report.md`, the parser and view model in `scripts/render-run-report.mjs`,
`assets/run-report.template.html`, the fixture markdown / run files / golden page (regenerated
deliberately), `selftest-run-report.mjs`, the `<result_organization>` / `<second_run>` /
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
- Human gates: skill 3's TC doc needs `Status: APPROVED` before 5/6; skill 11's findings need PO
  approval + `--apply-approved`; skill 1 Mode C needs a confirmed move plan. **Skill 4 is NOT a
  gate for skill 5** — `ADO-MAP.md` at a matching source hash only switches skill 5 from `local`
  to `linked`; keep skills 4 and 5 saying the same thing about this.
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
  cross-validator check and the `tool: mcp` stamp key.
- **Cross-validator check (3b):** before execution and before any automatic exclusion, every
  in-scope TC's own stamp is inspected; evidence written by 3c is asked about once (current vs
  stale; recommend skip current, re-validate stale), never silently reused or dropped; a skipped
  stale case never counts as validated; `--full` or an explicit compare / repeat instruction
  answers it in advance. **3c has no gate of this kind and no scope gate:** it walks every TC on
  every run, notes 3b evidence per TC (current vs stale at intake), re-validates it and replaces
  the stamp on observation, and lists those TC-IDs in the final message; `--full` is accepted as
  a no-op, `--scope shared|<ids>` is refused in one line and the full walk follows. The only TCs
  a 3c run leaves unobserved are the ones the application keeps out of reach (not implemented,
  data changes not authorized, screen could not be driven), each with its reason.
- **3c never receives a password** (attended login, or secret names from the user-run secrets
  file), never installs anything (`/sync-skills --tools` does), never uses MCP, never switches
  tool mid-run; a TC is `validated` only after its expected result was positively observed
  (`outcome-check`); data-changing TCs run only with the per-run "yes" and are reconciled.
- **Approved documents and 3b:** read-only validation is always allowed; modifying needs the
  user's explicit revision authorization (asked once, `--authorize-revision` counts); `Status`
  becomes `PENDING HUMAN REVIEW` only when something actually changed; republish is mentioned only
  when an `ADO-MAP.md` exists. The only status flip any skill may make.
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
  is a preview, never the deliverable.
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
`/sync-skills`, so a push here is effectively a release — make sure `SKILL.md`, `INPUT.txt`,
`lib.mjs` and `README.md` are consistent, and that all eight self-test harnesses pass (skill 1's
`selftest.mjs`, skill 5's
validator, run-report, watchdog and config-inventory harnesses, and the mirrored one in skills 3,
3b and 3c including its mirror case), before committing.

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
