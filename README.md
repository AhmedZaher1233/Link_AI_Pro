# Link_AI_Pro — QC Skills for Claude Code

A set of Claude Code skills that take a User Story from **requirement review** to **manual test
cases**, **implementation audit**, **hidden-rule discovery**, **Azure DevOps publishing** and
**Playwright automation**, with every step writing into one shared, plain-English project
knowledge base.

This repository is the **canonical source**. Any project pulls the skills from here with the
`/sync-skills` command; nothing project-specific lives in this repo.

```
.claude/
  skills/
    link-qc-1-generate-update-testing-structure/   audit / repair / restructure a project's QA foundation
      SKILL.md · INPUT.txt · references/ · scripts/ (preflight, validate-setup, sync-qa-skills) · assets/ (templates)
    link-qc-2-review-requirements/                 review a story / spec, produce the structured REQ file
    link-qc-3-generate-manual-test-cases/          design manual TCs (EN + AR) — design only, no environment; rendered HTML review page; human approval gate
      SKILL.md INPUT.txt references/ (8) scripts/ (render-tc-review, selftest + fixtures) assets/ (2: page body + shared report shell)
    link-qc-3b-validate-manual-test-cases/         OPTIONAL: walk the TCs live with Playwright MCP, set validation states, potential bugs, test-data facts — patches the same files in place
      SKILL.md INPUT.txt references/ (10) scripts/ + assets/ mirrored byte-for-byte with skill 3
    link-qc-3c-validate-manual-test-cases-cli/     OPTIONAL, evaluation twin of 3b through playwright-cli (no MCP): same contracts, attended / secret-name login, data-change authorization, PB screenshots, the 3b-vs-3c comparison protocol
      SKILL.md INPUT.txt references/ (12) scripts/ + assets/ mirrored byte-for-byte with skills 3 and 3b
    link-qc-4-publish-test-cases-azure/            beautify the approved TCs and publish them to Azure DevOps with verified tags / automation status (ADO-MAP.md); --suite-only places them in a Test Plan suite later
      SKILL.md INPUT.txt scripts/ (ado-sync-plan, tc-hash, selftest-ado-sync + fixtures)
    link-qc-5-test-run-automation/                 generate + run Playwright (POM, automation inventory), two compliance gates, coverage, reports
      SKILL.md (≈180 lines, orchestrator) INPUT.txt references/ (18, loaded per activity) scripts/ (13 + fixtures) assets/ (8)
    link-qc-5b-test-run-manual-cli/                OPTIONAL, manual twin of 5 through playwright-cli (no MCP): runs EVERY TC of an approved document in full, smoke gate without heal, AI chatbot TCs judged against their `AI Oracle` rubric, writes skill 5's report set into skill 5's story folder — report only, gates nothing
      SKILL.md INPUT.txt references/ (9) scripts/ (render-run-report, selftest-run-report, scan-lib + fixtures/run-report — mirrors of skill 5's; selftest-manual-run + fixtures/manual-run — 5b-only) assets/ (2: run-report body + report shell, mirrored)
    link-qc-6-ui-testing/                          visual UI audit of an implemented screen against its design (Figma MCP / screenshots / reference site) or, with no design, against tokens, consistency, WCAG, RTL — beside the chain
      SKILL.md (≈420 lines) INPUT.txt references/ (10, loaded per step)
    link-qc-7-sync-tc-status-to-azure/             Azure loop: latest TC outcomes → one Test Plan run (cloud test-plan tools; else NOT_RUN)
    link-qc-8-sync-bugs-azure/                     Azure loop: two-way bug sync with a direction gate (md → Azure creates + pushes, evidence attached through an upload-capable MCP and verified; Azure → md pulls retest candidates); ADO-BUG-MAP.md
      SKILL.md INPUT.txt references/ (qc-contract — canonical copy, md-to-azure, azure-to-md)
    link-qc-9-retesting/                           Azure loop: retest bugs (skill 5's automation for automated TCs, playwright-cli for the rest), update the latest run in place, close or reopen in Azure, then attach the evidence
    link-qc-10-white-box-testing/                  audit the code against the requirement: gaps, bugs, repro scenarios
    link-qc-11-discover-business-rules/            find rules the code enforces that the spec never states (PO approval gate)
    link-qc-12-adhd-output-style/                  ADHD-friendly CHAT output style with a QA-pipeline overlay — beside the chain, chat only, writes nothing
      SKILL.md INPUT.txt references/ (qa-pipeline)
    find-skills/                           helper: discover and install skills from skills.sh
  commands/
    sync-skills.md                         /sync-skills — thin wrapper around scripts/sync-qa-skills.mjs
docs/
  steering/                                L1 / L2 / L3 quality-authority documents copied into projects
```

Every skill folder has a `SKILL.md` (the instructions Claude follows) and an `INPUT.txt`
(what you must provide, what you get back, when to run it). Read `INPUT.txt` first.

---

## Quick start in a new project

1. Install the sync command once (from the project root):

   ```bash
   mkdir -p .claude/commands
   curl -fsSL -o .claude/commands/sync-skills.md https://raw.githubusercontent.com/AhmedZaher1233/Link_AI_Pro/main/.claude/commands/sync-skills.md
   ```

2. In Claude Code run `/sync-skills` — it bootstraps the sync script, copies skills 1-12, 3b, 3c and 5b
   into `.claude/skills/` and updates itself. Reload the session when it tells you to. Add
   `--tools` only if you want to run skill 3c or 5b (installs `playwright-cli` and its browser) or
   annotate static design images with link-qc-6-ui-testing (installs Pillow + numpy when Python exists) — 3b and
   every other skill need none of it.
3. Run `/link-qc-1-generate-update-testing-structure`. On a fresh project it runs the full setup
   without questions. On a project that already has automation it asks for a mode, or you pass
   one: `audit` (zero writes), `repair`, or `restructure` (confirmed move plan). This skill must
   be invoked explicitly; other skills never run it for you.
4. Skill 1 detects the Azure DevOps hosting from the git remote (or a User Story URL you give
   it): `dev.azure.com` / `*.visualstudio.com` is **cloud** (Microsoft's `@azure-devops/mcp`);
   any other host is a **self-hosted** Azure DevOps Server (`@tiberriver256/mcp-server-azure-devops`,
   configured with the org URL `https://host/Collection`, `AZURE_DEVOPS_AUTH_METHOD=pat` and the
   default project — that server has no test plan / suite tools). Both live under the same
   `azure-devops` key. When skill 1 writes the entry it asks you to run
   `scripts/set-azure-devops-pat.ps1` (or `.sh`) in your own terminal: one hidden prompt stores the
   PAT twice as user-level environment variables — `AZURE_DEVOPS_PAT_B64 = base64(":" + PAT)` for
   the cloud server and `AZURE_DEVOPS_PAT` (raw) for the self-hosted one. Then **fully quit VS Code
   (all windows) and relaunch it** — a window reload or an `/mcp` reconnect keeps the old
   environment, and the validator says "saved on this machine but missing from this session"
   until you do. The token never goes through the chat or into a file. If an Azure call still
   fails (`CONNECT_TIMEOUT`, `TF400813` "anonymous", 401, 403), every Azure skill points you to
   the same guide, `references/azure-mcp-troubleshooting.md` (mirrored in each of them): run
   `scripts/check-azure-devops-pat.ps1` (or `.sh`) — it prints booleans only — and apply the one
   fix for the matching row.
5. Optional, for skills 3c, 5b and 9 only: `scripts/set-playwright-secrets.ps1` (or `.sh`) stores per-role
   usernames and passwords in a file outside the repository so the CLI validator, the manual CLI run and the CLI retest can log in by
   secret *name*; without it you log in yourself in the browser window they open.
6. Optional, for link-qc-6-ui-testing only: if you audit against Figma designs, let skill 1 add the `figma` MCP
   entry (Figma's hosted server — you log in once through `/mcp`, no token in any file). Without
   it, Figma links fall back to exported screenshots.

---

## The flow

```
   spec / story / Word / Azure DevOps
                 │
                 ▼
   ┌──────────────────────────┐
   │ 2  review-requirements   │──► Testing/Requirements/US-{id}-{name}/REQ-*.md + review
   └──────────────────────────┘
                 │
                 ▼
   ┌────────────────────────┐
   │ 3 manual test cases    │──► TEST-CASES-*.md (PENDING HUMAN REVIEW,
   │   design only, no env  │    every TC draft — not app-validated),
   │   + rendered HTML page │    TEST-DATA-*.md, TC-REVIEW-*.html
   └────────────────────────┘         │
              ┆ optional              ▼
              ▼                       │
   ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐        │
   ┆ 3b validate live        ┆──► same files patched in place:
   ┆  (Playwright MCP, scope ┆    validation states + evidence,
   ┆  gate, potential bugs)  ┆    Potential Bugs, test-data statuses
   ┆ 3c same, via playwright ┆    (3c: + evidence/ screenshots;
   ┆  -cli — evaluation twin ┆     one or the other, not both)
   └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘        │
                                      │ human sets APPROVED
                                      ▼
   ┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
   │ 4 publish-test-cases-    │   │ 5 test-run-automation    │   │ 5b test-run-manual-cli   │──► 5: Playwright suite, coverage;
   │   azure (beautify + ADO, │   │  Checkpoint A → run →    │   │  (manual CLI run → same  │    5 and 5b: TEST-RUN-REPORT,
   │   --suite-only) optional │   │  Checkpoint B (both PASS)│   │   report set) optional   │    BUG-REPORT, screenshots — one
   └──────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘    story folder, one phase counter
          ┆ ADO-MAP.md only closes the loop in 5 ▲       │
          └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘       ▼  optional Azure loop
                              ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
                              │ 7 TC outcomes →  │ │ 8 bugs ⇄ Azure   │ │ 9 retest (auto / │
                              │   Test Plan run  │ │  (direction gate,│ │  cli), update run│
                              │                  │ │   ADO-BUG-MAP)   │ │  close + evidence│
                              └──────────────────┘ └──────────────────┘ └──────────────────┘

   beside the chain, any time:  6 ui-testing (visual UI audit per screen → Testing/UI-Testing/)
   closing code audits:         10 white-box-testing (bugs, gaps)   11 discover-business-rules
                                (code → spec; PO approves → --apply-approved → REQ delta → 2 → 3)
```

Approval unlocks skills 4, 5 and 5b **independently**: publishing is optional and is not skill 5's
or 5b's gate, the manual CLI run (5b) is optional and gates nothing, and live validation (3b, or its
CLI twin 3c) is optional and is not a gate for anything. Skill 4 refuses an unapproved document;
skills 5 and 5b do not — on anything but `Status: APPROVED` they ask ONCE (approve now — the skill
sets `Status: APPROVED` in the document for you —, run without approval, or stop; `--approve` /
`--unapproved` answer in advance) and a run without approval is recorded in the report.
`link-qc-6-ui-testing` sits beside the chain: it audits one implemented screen at a time (any time, any story)
and writes to `Testing/UI-Testing/`; nothing gates it and it gates nothing.

All skills read `Testing/qa-manifest.json` for paths and `Testing/project-learning.md`
for behaviour knowledge — see below.

---

## Skills

### 1 — generate-update-testing-structure
A compact orchestrator (SKILL.md ≈ 150 lines) over three read-only Node scripts and nine
reference files. `scripts/preflight.mjs` snapshots the original project state and classifies
it NEW or EXISTING before anything is touched; the mode is resolved from that snapshot;
`scripts/validate-setup.mjs` produces the PASS / WARN / FAIL / NOT_RUN table at the end and
never reports PASS for a check that did not run. Run modes on an existing project:
**audit** writes nothing at all and lists what repair would change; **repair** syncs skills
1-12, 3b, 3c and 5b, adds missing folders, steering layers, MCP entries and learning-file sections (and,
only after you say yes, `playwright-cli` for skills 3c, 5b and 9 and Pillow + numpy for link-qc-6-ui-testing), normalizes
names (steering files, `.claude/Skills` → `.claude/skills`, legacy learning heading) and writes
the manifest; **restructure** adds a confirmed `git mv` migration to the canonical layout.
Front-matter: `disable-model-invocation: true`, `model: inherit`, and `allowed-tools` limited
to reads plus the three script invocations — every mutation goes through the normal permission
flow. Templates live in `assets/` (learning file, steering README with the single resolution
rule set, manifest, `.mcp.json`).

### 2 — review-requirements
Input: an Azure DevOps story ID, a Word document, pasted text, or a spec file (multi-story
specs are split). Output per story: `REQ-{id}-{name}.md` (structured requirement, the input
for skills 3, 10 and 11) and `US-{id}-review.md` (testability, completeness, clarity,
consistency, feasibility, risk). Multi-story specs also get `SPEC-REVIEW-SUMMARY.md`.

### 3 — generate-manual-test-cases
**Design only.** Designs complete manual test cases (EN + AR) from the REQ file and the learning
file — no running application, no URL, no credentials; every TC leaves as
`draft — not app-validated`. Records the implementation status the tester states (or a skill-4
report shows) instead of probing it. Delivers the markdown TC document (source of truth,
`Status: PENDING HUMAN REVIEW`, frozen header lines and section anchors, an `## Open Questions`
section where every unresolved question carries a recommendation and is never acted on
unanswered), a plain-English `TEST-DATA-{feature}.md` per story (what data the TCs need, whether
it is *known* to exist from the learning file, how to create what is missing — skill 5 starts its
test-data readiness from it) and the HTML review page — **rendered by
`scripts/render-tc-review.mjs`, never hand-written**: every number recomputed from the tables, a
requirement-coverage gauge that is independent of validation, an "App validation progress" tile
(`0/N` from this skill), Potential Bugs and Open Questions sections. **Reviewer comments:**
every TC, potential bug and open question on the page has a comment box, plus one general box.
The reviewer types, clicks *Save comments* (the file `REVIEW-COMMENTS-{feature}.md` goes beside
the page) or *Copy for chat*, then says "read my comments". Skill 3 `--revision` applies them and
marks each one applied / answered / declined with a one-line response, which the next render
shows as history. The page file itself never changes, so its hand-edit guard stays valid. **The page and the
narrative are English unless this run's task input asks for Arabic** (`--lang ar` or an explicit
sentence) — the source language, a saved learning-file answer, the document's `Review page
language:` line (a record of the last render) and an existing sidecar never decide it; Arabic
pages come from a persisted translation sidecar (`TC-REVIEW-STRINGS-{feature}.ar.json`) and an
incomplete translation is a clearly marked preview. Application labels stay in the application's
language on either page. **Configuration by reference:** environment URLs, account usernames and
reusable datasets live only in `TEST-DATA-{feature}.md` (`## 0. Environment` rows `E{n}`,
`## 1. Accounts` rows `A{n}`, items `D{n}`) and a TC names them by token — `Login as Administrator
[A1]`, `Open the portal [E1]`; typed test inputs and exact expected outputs stay inline; the
renderer warns on a repeated configuration value (`data-literal`) and on an unknown token. **Tool
limits never reduce coverage:** an outcome that leaves the browser (email, SMS, OTP, push,
notification, background job) gets a complete TC; the skill first checks which authorized test
interfaces exist (task input → learning file → one question) and prefixes only a step a person
must really perform or observe with `[HUMAN]` — candidacy, execution coverage (skill 5) and
validation status (3b / 3c) stay separate axes. An optional per-TC `Tags` field (e.g. `uat`)
travels to Azure DevOps through skill 4. A TC that exercises an AI assistant / chatbot carries an
optional `AI Oracle` field (after `Data Oracle`: Intent · Must contain · Must not contain · Language ·
Max length · Repeats / Pass threshold) — the rubric skill 5b judges the reply text against; it enters the
TC hash only when present and never holds a secret. **A human must set `Status: APPROVED`** — that unlocks
skills 4 (optional), 5 and 5b (optional) independently (5 and 5b can also set it for you on your
explicit "approve now", or run the unapproved document and say so in the report). Live validation is the separate, optional skill 3b — or
its evaluation twin 3c.

### 3b — validate-manual-test-cases (optional)
Takes an existing TC document (pending or approved) and walks it through the **running
application** with Playwright MCP — targeted discovery, never a replay: probes the server first
(absent → BLOCKED), asks once for the base URL, credentials per role, the implementation status
when the document does not know it and environment notes, runs the implementation-status gate
(unbuilt parts → `not-implemented — pending implementation`, never defects), a **freshness pass**
(each earlier validation carries an evidence stamp — date, environment, build, content and
requirement-text hashes, open questions; any change makes it stale and re-queued) and a **scope
gate** — FULL (each common flow once + every TC's unique tail), SHARED-FLOWS-ONLY (the shared
prefixes once, propagated; tails `inferred` at best) or CUSTOM (a TC-ID list). An explicit
`--scope` / `--full` is respected without asking; otherwise one question with a recommendation
from case count, risk, roles and unique behaviour (15 cases is a heuristic) that names exactly
what stays unvalidated. Writes back **in place**: validation states + stamps, corrected labels
and the reveal / wait / trigger steps the app really needs, an appended enhancement log, concise
**Potential Bugs** (stable `PB-n` ids, updated on recurrence, resolved only after an actual
successful retest, history in non-rendered metadata), test-data statuses from one read-only look
per item plus the advanced facts it finds, and the re-rendered page. It asks once whether the run
may create / modify / delete data (data-changing TCs run only on "yes", records identified and
reverted through the UI) and **prepares missing test data itself** for the in-scope TCs
(`references/test-data-resolution.md`, the same contract as 3c's): the way is decided from
evidence — the learning file, the automation project's existing helpers found through the
manifest paths and by search, the application's source code, a creating TC or common flow, a
database helper — a UI journey is prepared without asking, an existing helper under the
data-changes "yes", an endpoint read from the source code or a database write only after an
explicit "yes" asked once; the seed is a temporary script that imports the project's own helpers
and is deleted afterwards, the item is `READY` only after its oracle confirmed it, values the
system stamped are read back (each substitution a finding for skill 3), records are kept unless
the reviewer asks once after the walk to clean up, and a state that provably cannot exist is
`NOT CREATABLE` with its evidence — never "data missing". Design fields, TC ids and the
coverage tables are never changed ("validation alone does not change design coverage"). On an
**approved** document it validates read-only by default; modifying it needs the reviewer's
revision authorization, and `Status` returns to `PENDING HUMAN REVIEW` only when something
actually changed (republish is mentioned only when an `ADO-MAP.md` exists). **Not a gate**:
skills 4 and 5 accept a document that never went through it. When a TC in scope already carries
evidence written by 3c, the **cross-validator check** asks once — current vs stale — whether to
re-validate or skip (skipped stale cases never count as validated).

### 3c — validate-manual-test-cases-cli (optional, evaluation twin of 3b)
The same validator built on Microsoft's **`playwright-cli`** (`@playwright/cli`) instead of the
Playwright MCP server, so the two can be compared on identical inputs. Same document contract,
states, approval rule, freshness pass, open-question shape, Potential Bugs, renderer and Arabic
handling; two things differ. **3c has no scope gate**: it walks every TC on every run (each
common flow once + every TC's unique tail, TCs with fresh evidence included) — no scope
question, no shared-flows-only mode, no custom list, no re-run skip set, and evidence written by
3b is re-validated and replaced instead of asked about (the final message lists which TCs
carried it). And the tool: named CLI sessions per role, **no
password ever typed** (you log in yourself in the headed browser it opens, or it types the
secret *names* from the file `set-playwright-secrets.ps1` created), a per-run **data-changes
authorization** for TCs that create / modify / delete (with UI cleanup and a list of every
record), a **test-data resolution** pass (`references/test-data-resolution.md`, shared
word-for-word with 3b: decides from the learning file, the automation project's existing helpers,
the application's source code and what the walk showed how each data item is obtained — fixed
way order `e2e scenario → api → db → set directly → manual`, item priority High / Medium / Low
from the TCs that need it — and **prepares a missing item itself** before its dependents: a UI
journey without asking, an existing helper under that same "yes", an endpoint read from the
source code or a database write only after an explicit "yes" asked once; a temporary seed that
imports the project's helpers and is deleted afterwards, verified on the oracle, the values the
system stamped read back, records kept unless the reviewer asks once after the walk to clean up,
`NOT CREATABLE` with evidence instead of "data missing"; closes test-data questions that evidence
turned into facts and asks once, after the walk, for the rest), an
**outcome rule** (a TC is `validated` only after its expected result was positively
observed and written to the stamp as `outcome-check` — a command that merely succeeded proves
nothing), one **screenshot per potential bug** under `evidence/`, and run metadata (`tool: cli`,
header stamp `by 3c … , tool cli`) so results stay traceable. `playwright-cli` missing → BLOCKED with the
`/sync-skills --tools` hint; it never installs anything and never falls back to MCP. Ships
`references/cli-vs-mcp-comparison.md`: identical inputs, separate `comparison/` output copies,
measured tokens / time / states / PBs / compatibility, a twelve-row case matrix — and no
recommendation: **3b stays the default validator until an explicit decision says otherwise.**

### 4 — publish-test-cases-azure
Takes the **approved** TC document and **beautifies** it into a separate upload document:
"Validate that / Check that" titles, every Steps block opening with `Login with <role>` and
the navigation journey, the nine canonical step verbs, every `as TC-…` delegation expanded
inline, every step confirmed from page objects, the learning file or the app source
(Playwright MCP only for a genuine gap), and a hard meaning-preservation gate; `[A{n}]` data
references and `[HUMAN]` markers survive verbatim. Then it **publishes** that document to Azure
DevOps as Test Case work items linked to the User Story with Tested-By, idempotently, with
**owned fields decided by `scripts/ado-sync-plan.mjs`** (MCP does the I/O, the script decides):
`AutomationStatus` from the TC's `Automation Candidate` (`YES` → `Planned`, `NO` → `Not
Automated`, field absent → `unknown`, an existing `Automated` kept only while skill 5's
`automated_tc_sha256` still matches the TC's canonical hash — otherwise a reconciliation
conflict); tags it introduces (`{feature}`, `smoke`, `automation` / `manual`, `human-step`, the
TC's `Tags:` values, the project's convention tags) tracked per TC so pre-existing tags are
preserved and obsolete owned tags removed; a per-TC "Test data" description block (the referenced
TEST-DATA rows, never a password) that makes the TC executable from Azure alone, plus a
supplementary snapshot on the story. Every write is **read back** and compared; the outcome is one
of `PUBLISHED AND VERIFIED` · `PUBLISHED, NOT VERIFIED` · `PUBLISHED WITH MISMATCHES` ·
`PUBLICATION INCOMPLETE` · `BLOCKED`, never a success claim over a failed or unavailable read-back.
`ADO-MAP.md` records the TC-ID → work item map, `published_tc_sha256`, `automated_tc_sha256`
(skill 5's column), the introduced tags and the suite. The approved source document is never modified.
`--suite-only <suite URL | planId suiteId>` skips beautify + publish and only adds the already-published
work items of `ADO-MAP.md` to that Test Plan suite (additive; the `Suite` column records it) — the
suite is where skill 7 later records outcomes.

### 5 — test-run-automation
Its only document rule is `Status: APPROVED`: an approved document proceeds at once; anything else
is ONE question — **approve now** (the skill rewrites the `Status:` line to `APPROVED`, nothing else),
**run without approval** (the document is untouched; the report's `Source document` line, the phase's
Deviations and the final message say `run without approval (user decision)`) or **stop** (BLOCKED).
`--approve` / `--unapproved` answer it in advance; a pipeline run with neither is BLOCKED. The choice
is per run, never remembered. Publishing to Azure DevOps (skill 4) is optional
and never asked for. Before writing any file it takes an **automation inventory** of the whole
automation root — every page class, whatever skill or agent wrote it — and records one decision
per screen (`reuse` / `extend` / `create`, each surfaced candidate accepted or rejected with a
reason) in `automation-inventory.md`; the validator's `pom-duplicate-page` rule turns a
same-name / same-route / shared-locator pair into a review item that only a documented decision
closes, so a duplicate page object can no longer slip through. Generates Playwright
automation with a mandatory Page Object Model from the original approved document (resolving
`[A{n}]` / `[E{n}]` / `[D{n}]` references through TEST-DATA, each to its own row; a TC with
`[HUMAN]` steps runs up to the human step and is reported `PARTIAL — human step pending`, never
PASS), builds a
per-story run plan (parallel vs serial groups), measures static coverage against the L3
target, resolves test-data readiness — searching a way to create every missing item (the
learning file, the automation project's helpers wherever the manifest or a search finds them, the
application's source code, a UI journey, a DB helper) and **preparing it itself** through a
temporary seed or a setup journey, asking the QC once only for an endpoint taken from the source
code or a database write, verifying each item on its oracle, reading back system-stamped values
into the test-data layer, keeping the records unless told once after the run to clean up, and
skipping only with `data_missing` (no way found), `not creatable` (evidence) or `QC declined` —
then runs headed in priority order (smoke
behind a 30 % failure gate, then positive, then negative) — each stage as ONE call of
`scripts/run-stage.mjs`, which runs the stage's group commands, watches them itself and returns once,
so the chat gets one cumulative update per finished stage (and an immediate one if a stage stops),
labelled with what the skill is doing ("Running Smoke Tests (first run)" / "(re-run)", never a phase number),
while the live per-test detail and the ETA go to a tailable progress log — and takes
an **assertion-point screenshot** per TC — captured while the verified state is still on screen,
before any teardown or cleanup runs, kept as immutable per-attempt history. It runs from the
project's **one shared `playwright.config.ts`** (Google Chrome, visible, 2 workers; dependent
tests serial with a documented reason; an existing config updated in place, several consolidated
only when safe, created only when none exists). **Parallelism never changes a status:** a TC that
fails while other tests ran beside it is re-run alone inside the same stage call before it counts (the
isolation check — passing alone is recorded as parallel interference, and the tests that ran beside it
are re-checked alone too); a network guard notices when the application refuses requests (429 /
`Retry-After`), the runner cools down and lowers the workers, a TC refused even alone is reported
`rate_limited` (no verdict, never a bug), and known limits (learning file, the application's
rate-limiter configuration, earlier runs) pace only the limited call — every test keeps logging in
through the UI. After the first run the skill heals automation defects and **re-runs only the TCs those
fixes touched** (decided per TC by `scripts/impact.mjs` from a code fingerprint of each test's page
objects, helpers and timeout keys) plus the TCs without a verdict; their results are merged into the
same phase, everything else keeps its first-run result, and Checkpoint B proves every reported result
is fresh. The run uses a **timeout policy** in `timeouts.ts` (TC
budget separate from per-step deadlines, initial values documented, calibrated after the first
run from evidence and never raised to hide a broken step) and a **heartbeat watchdog** that stops
only a genuinely hung worker while keeping every finished result (`run-stage.mjs` applies it, and
also stops a command Playwright failed to stop at its own time ceiling). Its `SKILL.md` is a short
orchestrator — workflow, the rules of every activity, a block index — and each activity loads only
its own `references/` file, so a run carries far less instruction text per turn. Code-writing conventions —
page objects, locator order, positional selectors, steps, fixtures, unique data, diagnostics —
are in its `references/code-craft.md`, with three matching validator rules. The references hold only
this project's rules — standard Playwright behaviour (locators, auto-waiting, assertion retries, the
runner's flags) is assumed known and not re-explained, and a rule stated in several places has one home
with pointers elsewhere.

**Scratch investigation.** When the source and the retained trace cannot explain a failure or settle an
ambiguous selector, `scripts/scratch.mjs` runs ONE temporary probe with the project's own Playwright,
shared config (through a generated one-worker overlay), page objects and env-layer login — from
`test-results/qa-scratch/`, a folder the validator, `impact.mjs` and every Playwright run ignore. A
probe is an investigation, never a result: it refuses evidence capture, its own screenshots,
`storageState`, file writes, `process.env` and TC ids, filters credentials from its output, flags any
write outside its folder, never runs while a stage is in flight, and is cleaned before Checkpoint B.

**Version.** Skill 5 carries a semantic version in its `SKILL.md` front-matter (`metadata.version`,
currently 1.1.0); `/sync-skills` shows the installed and the available version.

**Two mandatory compliance checkpoints** bracket the run, and both must PASS before the skill
claims the automation is compliant:

* **Checkpoint A**, before anything executes — `scripts/validate-automation.mjs` (a read-only,
  zero-dependency static screen: focused modifiers, placeholder assertions, POM boundaries,
  evidence capture traced through the methods each test actually calls, traceability) **plus**
  semantic review of everything a text scan cannot decide. Confirmed automation-code defects are
  repaired there and then, never handed back as suggestions; only the compliant scope runs.
* **Checkpoint B**, on the final code after all debugging — the same review repeated, plus proof
  that the screenshots, reports and logs were actually produced and match that code.

Each gate is recorded PASS / FAIL / BLOCKED against a content hash of the tested files, every
reported result must match its TC's current code fingerprint (a TC a later change touched is re-run,
never reported from before the change), and a check that did not run
is never recorded as PASS. Compliance status stays separate from execution status. When the story
*happens* to be published already, it also closes the loop in DevOps (`Custom.TestAutomated` and
automated-test metadata on the work items skill 4 created, plus a summary comment); otherwise that
phase is skipped silently.

Every run appends a `## Phase N` section to the story's **`TEST-RUN-REPORT-{feature}.md`** (test-case
status, run history, earlier phases never rewritten) and updates the story's
**`BUG-REPORT-{feature}.md`** (one entry per defect with reproducible steps, the failure screenshot
and a per-phase history; resolved only after a passing retest), both under
`reports/[SPEC-{spec-name}/]US-{id}-{name}/` — the same leaf as the TC folder. The run's machine
data (run plan, open questions, readiness, coverage snapshot, compliance gates, merged results per
variant and attempt) folds into one immutable `.runs/phase-N.json`; raw Playwright output goes to
`artifacts/`; the three coverage CSVs stay. `scripts/render-run-report.mjs` renders both markdown
files into one **`TEST-RUN-REPORT-{feature}.html`** with separate Test Results and Bugs sections and
screenshot thumbnails that open a "View screenshot" viewer (zoom, scroll, open the original) —
relative links, never base64, never hand-written. It is the same general report page as skill 3's
review page (one shared shell: header, tiles, cards, viewer, theme toggle and comment boxes), so
every bug and phase takes a reviewer comment the same way; a comment never changes a bug's status
on its own. The story folder's top level holds nothing else (plus the reviewer's optional
`REVIEW-COMMENTS-{feature}.md`); folders from the older layout are read-only history.

### 5b — test-run-manual-cli (manual CLI run, optional)
The manual twin of skill 5, beside it the way 3b / 3c sit beside 3. It takes skill 3's TC document
(`Status: APPROVED` proceeds; anything else is skill 5's one approval question — approve now / run
without approval / stop, `--approve` / `--unapproved` — independent of skills 4 and 5) and
executes **every** test case in full and separately through `playwright-cli` — the same tool as
3c, never the Playwright MCP, never an install of its own (`/sync-skills --tools`), attended login
in the headed browser or secret names from the user-run secrets file, never a password. Order is
smoke first behind the 30 % smoke gate — **no self-heal**: an application-error majority stops the
run and is reported — then positive, then negative. Each TC ends PASS / FAIL / INCOMPLETE / SKIP /
NOT_RUN or `PARTIAL — human step pending` (a `[HUMAN]` step, never PASS), with an assertion-point
screenshot under `screenshots/…/phase-N/{TC-ID}/manual-cli--none--r{k}/`. A TC that carries skill
3's optional `AI Oracle` field (an AI assistant / chatbot reply) is run the rubric's number of
times and judged by Claude from the reply text — hard checks (must contain / must not contain /
language / max length) plus the rubric and its pass threshold; a hard-check miss is `app_bug`, a
rubric miss `ai_rubric_failure` (both a bug entry), and every reply is stored verbatim in `reply.md` beside the screenshot
(`references/ai-response-rules.md`). It writes **only skill 5's run-report set into skill 5's story
folder** — `TEST-RUN-REPORT-{feature}.md`, `BUG-REPORT-{feature}.md`, `.runs/phase-N.json` and
the rendered `TEST-RUN-REPORT-{feature}.html` through a byte-identical mirror of skill 5's
renderer — sharing one phase counter and continuing `BUG-{n}` numbering with skill 5, so one page
tells the story's whole run history. It never writes into the TC document: a design problem goes
to skill 3 `--revision`. It is not a gate for anything, asks no learning questions beyond its own
`### Manual Run Model (skill 5b)` section, and has no MCP server of any kind (`allowed-tools`:
its three scripts plus `playwright-cli`). **Missing test data is prepared, not skipped**
(`references/test-data-preparation.md`, the same twelve principles as 3b / 3c / 5): a `MISSING`
item is searched for a way — the learning file, the automation project's helpers, the
application's source code, a UI journey, a DB helper — and prepared before its TCs run: a UI
journey without asking, an existing helper under the run's data-changes "yes", an endpoint from
the source code or a database write only after an explicit "yes" asked once; a temporary seed in
the session scratch folder that imports the project's helpers and is deleted afterwards, the item
verified on its oracle, system-stamped values read back and reported as Deviations for skill 3,
records kept unless the QC answers "clean up" to the one post-run question; the phase's
`### Test-data readiness` table and the run file's `data_readiness` record every item as `READY`
/ `prepared (api|ui|db)` / `skip — data_missing` / `skip — not creatable` / `skip — QC declined`
(the renderer counts them). Prerequisites: `playwright-cli` (BLOCKED with the
`/sync-skills --tools` hint when missing) and, optionally, the secrets file for unattended logins.
What it never does: heal, re-run smoke on its own, switch tool mid-run, touch Azure DevOps, read
a password, modify a record it did not create, leave a seed script in the repository, or change a
TC's design, state or status.

### 6 — ui-testing (visual UI audit, beside the chain)
Compares an implemented screen with its approved design and writes a **UI Visual QA Bug
Report** (`Testing/UI-Testing/Reports/UI-Visual-QA-<page>.md`) where every finding is a full,
reproducible bug — Priority / Severity / Bug Trigger / Impact / Classification / Confidence,
System Info, Steps to Reproduce, Expected vs Actual, and a red-boxed evidence pair under
`Reports/evidence/`. Inputs: the implementation as a live URL (preferred) or screenshots; the
design as a Figma link (exact tokens, layer inventory and frame screenshots through the optional
**Figma MCP**), design screenshots, or a live reference site. With a live URL it measures before
it looks: computed styles and geometry through the Playwright MCP, then interactive / content
states, the app's own CSS breakpoints (1 px either side), scroll and stacking, console and
network failures as root causes, an **axe-core** run per language (one bug per violated WCAG
rule, `incomplete` checked by hand) and a **source trace** that turns each measured mismatch
into a `file:line` + suggested fix when the app's source is in the workspace — and never judges
by eye what the browser can measure. Every action is logged as it happens to
`evidence/<page>_<lang>/audit-log.md`, which backs the report's Coverage counts. With
**no design at all** it runs a heuristic audit against a reference ladder (confirmed rules in
`Learning-UI.md`, the codebase's design tokens, the component library's rendering, sibling
screens, the page's measured self-consistency, WCAG / RTL standards, a task-flow walkthrough) and
names the rung behind every bug; a plausible deliberate choice becomes an Open Question with its
measured values, never a bug. Asks once, before the browser opens, for the languages to test and
the languages the design covers (an RTL locale is audited independently, never as a mirrored
copy), the role, credentials only when the project has no test-credential mechanism, and the
environment. Ships a Coverage table with real counts, a mandatory second pass with per-bug
confidence, a template-plus-outlier method for repeated regions, a regression check against the
previous capture (`Actual-UI/_history/`), a `Coverage-Index.md` of which screens were ever
audited, and a second round framed as a completeness measurement. Python + Pillow is needed only
to annotate static images (`/sync-skills --tools`); live pages are annotated in the DOM.


### 7 — sync-tc-status-to-azure (Azure loop, optional)
Publishes the latest phase of skill 5's `TEST-RUN-REPORT-{feature}.md` (or an explicit
`TC-ID=PASS|FAIL` list) to the Test Plan points of the published test cases as **one** test run
through the azure-devops MCP — PASS → Passed, FAIL → Failed, INCOMPLETE → Blocked, never Passed
for an unverified assumption. Needs the cloud server's test-plan tools; on the self-hosted server
every outcome is `NOT_RUN` and nothing is created. Writes no local file; `AutomationStatus`
stays skill 5's job.

### 8 — sync-bugs-azure (Azure loop, optional)
One skill, two directions, one gate: unless `--direction` is given it asks **once** whether to run
**md → Azure** (create the bugs of `BUG-REPORT-{feature}.md` / `UI-Visual-QA-<page>.md` that Azure
does not have yet, then push local status changes: verified close, or reopen with `[Reopened]`,
the `reopened` tag, the first assignee and a mention), **Azure → md** (pull developer states into
the ledger and the bug History as retest candidates) or **both** (pull first). The ledger is
`ADO-BUG-MAP.md` beside `ADO-MAP.md` (identity = source + Bug ID, rows never dropped). The truth
rule is asymmetric: Azure wins for `open`, only an actual retest (skill 9) produces `resolved`;
an Azure Resolved is never a local resolution and a local resolved without retest evidence is
never pushed. MCP only — never a PAT, a `.env` or REST. Evidence screenshots are attached for
real (since 2026-10-13): before any upload the evidence files are hashed and two bugs sharing one
byte-identical image are resolved (the image goes to the bug whose Actual result it shows, the other
gets the correct image from the same attempt folder or stays pending; the producer report is never
edited); then each file is uploaded through a capability ladder — an upload tool that takes a file
path on the attached `azure-devops` server (self-hosted), else the optional second server
`azure-devops-attachments` (cloud; upload / delete only), else `NOT_RUN` and pending in the ledger
with the manual instruction — and counts only after read-back (`AttachedFile` name + size). Contract in
[references/qc-contract.md](.claude/skills/link-qc-8-sync-bugs-azure/references/qc-contract.md)
(canonical copy, mirrored in skills 7 and 9).

### 9 — retesting (Azure loop, optional)
Retests a bug in the running application — never through the Playwright MCP. One route per bug:
when its TC is automated (a test of skill 5's automation carries `[TC-ID]` and the latest phase's run
plan holds it) the TC is re-run from that code through skill 5's `run-stage.mjs --run rerun` (every
variant, the isolation check included — a test-code failure is no verdict and is reported for skill 5,
never healed here); otherwise (no automated TC, a UI bug, a manual-run phase) it is retested through
`playwright-cli` — the full TC when it has a row in the latest phase, else the bug's own reproduction
steps. It positively observes the Expected result, captures evidence, then **updates the LATEST phase
of the run report in place** (user decision 2026-10-19: the changed TC rows, a `(retest — skill 9)`
stage row and the Total, the Outcome, the Bugs table, a Retest bullet, Deviations, the header pass
rate and the run-history row, plus `.runs/phase-N.json` to match), sets the bug Status
(`resolved (phase N)` only after an actual pass; `open` + History on a fail) and re-renders the page
(delivered only at gate PASS). Then skill 8's push inline — close, or reopen with tag / assignee /
mention — and **after** the state change the retest screenshot is uploaded through the attachment
ladder (the `azure-devops-attachments` MCP on cloud projects) and verified by read-back; skill 7's
outcome push for the TCs whose row changed. Candidates come from skill 8's Azure → md pull
(`--awaiting-retest`) or explicit bug IDs. Asks once before anything executes (environment,
data-change authorization; for playwright-cli bugs the URL, login method per role and language
switch); a password is typed in the browser or named from the user-run secrets file. Incidental
defects are logged in the producer format and created in Azure through skill 8's recipe.

### 10 — white-box-testing
Stack-agnostic implementation audit. First run profiles the repository (languages,
frameworks, layers, requirement sources) and caches it in
`Testing/White_Box_Testing/.project-profile.md`. Then traces the requirement in code and
reports gaps, potential bugs and reproduction scenarios. Read-only on the codebase.

### 11 — discover-business-rules
The reverse direction of skill 10: starting from a story it reads the code and writes every rule
the code **enforces** as an EARS statement with file:line evidence — field limits, formats,
uniqueness, defaults, ranges, state transitions, permissions, duplicate handling, messages,
locale differences. It compares them with the spec and exports the rules that exist **only in
the code** to `Testing/Requirements/US-{id}-{name}/US-{id}-code-rules.md`, one file per story,
with proposed requirement wording and suggested test cases. Findings are **proposals**
(`PENDING PO APPROVAL`): nothing reaches the learning file or the REQ until the QC and Product
Owner fill the decision block and the skill is re-run with `--apply-approved`. If
`Testing/Requirements/` does not exist it asks where to write.
Adapted from [jeffallan/claude-skills@spec-miner](https://github.com/Jeffallan/claude-skills) (MIT).

### 12 — adhd-output-style
An output style, not a pipeline step: `/link-qc-12-adhd-output-style` reshapes the **chat** for a
reader with ADHD for the rest of the session — the next action first, numbered multi-step work,
the pipeline position restated on every turn (`Skill N · phase · story · progress`), every human
gate (`Status: APPROVED`, PO decision, QC readiness, an unresolved compliance item) turned into
one next action, BLOCKED returns rewritten as cause → fix, wins made visible. It never changes a
skill and never touches the files the skills write (REQ, TC documents, review pages, ADO-MAP,
the learning file, run reports). Explicit invocation only; "stop adhd mode" turns it off. Part of
the sync set since 2026-09-27 (previously the local helper `i-have-adhd`, which `/sync-skills`
now replaces). Adapted from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) (MIT).

### find-skills
Helper for discovering and installing community skills from <https://skills.sh/> with
`npx skills find` / `npx skills add`.

---

## Shared conventions

**QA manifest** — `Testing/qa-manifest.json`, written by skill 1 (repair / restructure / new
project, never by audit). Machine-readable structure contract: QA paths, steering file paths,
framework config, documented deviations. Skills 2-11, 3b, 3c and 5b read it first and fall back to detection
only when it is missing, telling the user to run skill 1.

**Project learning file** — `Testing/project-learning.md`, created by skill 1 from
`assets/project-learning.template.md`. One tagged plain-English line per fact
(`[module: X] [page: Y] [type: rule|qa|data|env|trick|status|bug]`), an `## Index` of modules,
shared sections (Project Knowledge, Common Flows, UI Knowledge, Test Data, Locale Knowledge,
Automation Tricks) and twelve model sections (skills 1-11, 3b, 3c and 5b; the Azure-loop skills 7 to 9 share one) with `Knowledge` and
`Questions and Answers`. Every skill greps it **before asking you anything** and writes back what
it learned; only a **confirmed** answer is written (`(confirmed by user {date})`) and reused —
an unanswered recommendation never is. No secrets, file paths, selectors or code identifiers
ever go in it.

**Open questions** — skills 3, 3b and 3c ask in one shape (`references/open-questions.md`, mirrored):
the exact gap, the affected TC-IDs, the evidence, a recommended answer with its reason, the
alternatives and what stays pending. They never proceed on an unanswered recommendation:
independent work continues, dependent TCs stay in their current state and are listed.

**Steering documents** — `docs/steering/L1-testing-foundation.md` (organization baseline),
`L2-testing-qa-standards.md` (organization implementation standards),
`L3-project-testing.md` (this project's values, stricter constraints, approved exemptions).
One set of **resolution rules**, stated once in `docs/steering/README.md`: L1 is mandatory and
nothing below may weaken it; L2 refines L1; L3 supplies values and may only weaken through an
approved exemption; specs govern business truth, steering governs quality policy, the learning
file overrides neither. L1 and L2 are copied from this repo and never authored by a skill; L3
is a template you fill in.

**Requirement folders** — one folder per User Story:
`Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{kebab-name}/` holding the REQ file and review
(skill 2) and the code-rules export (skill 11). The `SPEC-{spec-name}/` parent appears whenever the
story came from a spec FILE; stories from Azure DevOps, Word or pasted text sit directly under
`Testing/Requirements/`.

**Test-case folders** — `Testing/Manual_Test/TestCases/[SPEC-{spec-name}/]{UserStoryName}/`
holding the TC document, the test-data file, the rendered review page and (Arabic) the strings
sidecar (skill 3, patched in place by 3b or 3c; 3c adds `evidence/` and, during the comparison,
`comparison/`), the beautified upload document and `ADO-MAP.md`
(skill 4) — mirroring the requirement folder, `SPEC-*` parent included. Skill 5's (and 5b's) reports, logs
and screenshots mirror it again.

**Human gates** — skill 3's TC document must be approved by a human before skills 4, 5 and 5b
run; skill 11's findings must be approved by the Product Owner before they become knowledge;
skill 1's restructure needs a confirmed move plan. Publishing to Azure DevOps is **not** a gate:
skill 5 runs locally when skill 4 has not run; the manual CLI run (5b) is **not** a gate for anything
and needs nothing but the approval. Live validation (3b or 3c) is **not** a gate either:
skills 4, 5 and 5b accept a document whose TCs are all `draft — not app-validated`. The one status
change a skill may make: 3b or 3c, with the reviewer's explicit revision authorization, sets an
approved document back to `PENDING HUMAN REVIEW` — only when it actually changed something.

**Validation states and coverage** — every TC carries one of six states (`validated` /
`enhanced` / `inferred` / `discrepancy` / `not-implemented — pending implementation` /
`draft — not app-validated`, see `references/validation-states.md`); skill 3 writes only `draft`,
3b or 3c sets the rest from observation with an evidence stamp (`tool: mcp | cli`), skill 5 carries them forward as
possibly stale. Requirement coverage is computed from the acceptance criteria and the designed
TCs only — "validation alone does not change design coverage; discovering a genuine coverage gap
or updating cases may change it" — and live observation is reported separately as App validation
progress.

**Machine gates** — distinct from the human ones, and enforced by the skill itself: skill 5's
two compliance checkpoints (before execution and on the final code) must both PASS for the
delivered scope, skill 1's validator never reports PASS for a check that did not run, and neither
does skill 5 — an applicable check that could not be completed is `unresolved` or `N/A` with a
reason, and leaves its gate BLOCKED.

**Credentials** — never in files or logs. Azure DevOps uses `AZURE_DEVOPS_PAT_B64` (cloud) or
`AZURE_DEVOPS_PAT` (self-hosted) — both written by the one user-run PAT script; the app
URL and test users are asked for at run time and stored only as non-secret facts.

**Output language** — every review output (skill 2's review, skill 3's page, 3b / 3c re-renders)
is English unless the current run's task input asks for another language (`--lang ar` or an
explicit sentence). Nothing else decides it. Application text (quoted labels, messages) stays in
the application's language.

**Project-neutral** — no skill names a customer, product, project or real host; examples use
neutral roles and screens (`Administrator`, `admin.user`, `Open Products`), templates and fixtures
carry placeholders only, and skill 1's validator flags product tokens in the steering files.

---

## MCP servers the skills use

| Server | Used by | Purpose |
|---|---|---|
| Playwright MCP | 3b (required), 4 (gap-filler only), 5, 6 (live URLs) | live application discovery and automation — skill 3 never uses it; 3c, 5b and 9 use `playwright-cli` instead, no MCP (skill 9 re-runs automated TCs through skill 5's `run-stage.mjs`) (installed by `/sync-skills --tools`, never a prerequisite for 3b) |
| Azure DevOps MCP | 2, 3, 4, 5, 7, 8, 9, 11 | read User Stories, publish Test Cases, update automation fields, comment results — cloud (`@azure-devops/mcp`: `wit_*`, `search_workitem`, `testplan_*`) or self-hosted Azure DevOps Server (`@tiberriver256/mcp-server-azure-devops`: `get_work_item`, `search_work_items`, `create_work_item`, `update_work_item`, `manage_work_item_link`; no test plan / suite tools — skill 4 places TCs in a suite through the REST API only when you name one, otherwise reports it skipped) |
| Azure DevOps attachments MCP (optional, cloud only) | 8, 9 | upload evidence screenshots as Bug attachments (`create_work_item_attachment`, and `delete_work_item_attachment` for a file the skill itself attached in error) — `@tiberriver256/mcp-server-azure-devops` started by `.claude/mcp-launchers/azure-devops-attachments.cjs` against the same cloud organization with the same PAT (derived in memory from `AZURE_DEVOPS_PAT_B64`; no new variable), because the cloud server cannot upload a file from disk; written by skill 1 with every cloud `azure-devops` entry; self-hosted projects need nothing extra; without it attachments stay pending with manual instructions |
| Docx MCP | 2, 3 | read requirement and test-case documents, and write review comments back into them |
| Figma MCP (optional) | link-qc-6-ui-testing | exact design tokens, layer inventory and frame screenshots from Figma links — Figma's hosted server (`https://mcp.figma.com/mcp`, login through `/mcp`, no token in files); without it link-qc-6-ui-testing uses exported screenshots |

Skill 1 writes `.mcp.json` from `assets/mcp.template.json` — the `azure-devops` entry as the
cloud or the self-hosted block per the detected hosting — and validates each server (the
optional `figma` entry only on request; on a cloud project the `azure-devops-attachments` entry and
its launcher always, replaced when outdated — `/sync-skills` never touches either). An Azure DevOps connection or auth failure
(`CONNECT_TIMEOUT`, "anonymous access" `TF400813`, 401, 403) is handled by one shared guide,
`references/azure-mcp-troubleshooting.md` (canonical in skill 1, byte-identical in skills 2, 3, 4, 5,
7, 8, 9 and 11): the skill stops Azure calls and gives you the one fix for the matching row first —
reconnect, full quit + relaunch of VS Code (a reload or `/mcp` reconnect does not reload environment
variables), the 7-step "Set or replace the PAT", or a missing PAT scope. The user-run
`check-azure-devops-pat.ps1` / `.sh` tells the cases apart without revealing the token.

---

## Keeping projects up to date

```
/sync-skills                            # all skills + the command itself — asks first, then deletes our skill folders and downloads them fresh
/sync-skills link-qc-5-test-run-automation      # one skill
/sync-skills --dry-run                  # read-only check, nothing copied
/sync-skills --force                    # with the "update only" answer: overwrite locally edited skill files
/sync-skills --tools                    # also install playwright-cli + browser (skills 3c, 5b and 9) and Pillow + numpy (link-qc-6-ui-testing, when Python exists) — opt-in
```

The command is a wrapper around `scripts/sync-qa-skills.mjs` (`--check` / `--apply`). It never
touches anything outside `.claude/skills/`, `.claude/commands/sync-skills.md`, the `docx` entry of
`.mcp.json` and — only with `--tools` — the global `@playwright/cli` package, its browser, the
`.playwright-cli/` gitignore line and the `pillow` + `numpy` Python packages; never deletes
local-only files, and skips locally edited files unless `--force` is given.

**Versions.** A versioned skill declares `metadata: version: "x.y.z"` in its `SKILL.md` front-matter (skill
5 so far). `--check` reports `versions[]` — installed vs source and `current` · `update-available` ·
`ahead-of-source` · `not-installed` · `pre-versioning` · `unversioned` — and `/sync-skills` shows
`installed → source` per skill; skill 1's `validate-setup.mjs` lists the installed versions and turns the
`Skills current` row WARN when one is behind. What changed between versions is in `CHANGELOG.md`.

**Clean replace, after confirmation.** `/sync-skills` (and skill 1 in repair / restructure / new-project
mode) runs `--check` first and asks once: *this sync deletes the Link QA skill folders and downloads fresh
copies — if you enhanced or edited any Link skill, those changes are removed and replaced with the new
version* (it lists every edited or extra file that will disappear, and the other skills it keeps).
**Replace** → `--apply --replace --yes` · **Update only — keep my edits** → the in-place update above ·
**Cancel** → nothing changes. Only our folders (`lib.mjs` `SKILLS` + the legacy `SKILL_RENAMES` names) and
`.claude/commands/sync-skills.md` are deleted and re-downloaded; your own skills, other commands, `.mcp.json`,
`.gitignore`, `Testing/`, `docs/` and settings are never deleted. The script refuses `--replace` without
`--yes`, so the question cannot be skipped.

**Upgrading a project set up before September 2026:** run `/sync-skills` (it migrates
`.claude/Skills` to `.claude/skills` and, once each replacement is in place, removes the skill folders that
carried the pre-`link-qc-N` names — `1-generate-update-testing-structure` … `qc-ui` — reporting them as `legacy-removed`), then `/link-qc-1-generate-update-testing-structure audit` to see
what changed, then `repair`. Repair renames the learning-file headings
of earlier releases to the current numbering (`lib.mjs` `LEARNING_LEGACY_HEADINGS`: e.g. `### Publish Model (skill 5)`
→ `(skill 4)`, `### Automation Model (skill 6)` → `(skill 5)`, `### UI Visual QA Model (skill qc-ui)` → `(skill 6)`),
adds the missing model sections (including `### Azure Sync Model (skills 7 to 9)`) and the `Testing/UI-Testing/` folder, seeds the steering README with the single resolution rule
set, and writes the manifest. TC documents written before the design / validation split (no
`Scope` / `Generated` / `Stage` lines, no frozen anchors) still render and are still patchable by
3b or 3c — the renderer lists the accommodations under `compatibility[]` and no skill rewrites an
old document into the new shape on its own. Skill 3c is opt-in: nothing changes for a project
that keeps using 3b, and 3b stays the default validator until the comparison has been reviewed
and you decide otherwise.

---

## Contributing

Edit the skill in this repository, keep `SKILL.md` and `INPUT.txt` in step, and update
`scripts/lib.mjs` (`SKILLS` and `LEARNING_MODEL_SECTIONS`), skill 1's references and
`assets/project-learning.template.md`, `sync-skills.md`, `CLAUDE.md` and this README when a
skill is added or renamed. Skill front-matter needs `name`, `description` (this is what triggers
the skill — keep the trigger phrases) and, where useful, `argument-hint`. Skills with side
effects set `disable-model-invocation: true`. A versioned skill bumps `metadata.version` in the same
change: **MAJOR** when a consumer must change something or an existing delivery stops passing (a
removed or renamed flag, script, output file or schema, stricter gate semantics, a newly required input
or MCP server), **MINOR** for a backward-compatible capability, **PATCH** for wording, token trimming,
pointer fixes or a script fix with unchanged contracts; the CHANGELOG entry names the new version. Commit, push to `main`, and every project picks
the change up on its next `/sync-skills`.

**Mirrored files.** Skills 3, 3b and 3c share the renderer, its self-test and fixtures, the page
template and four references (`learning-file.md`, `html-page.md`, `validation-states.md`,
`open-questions.md`) as **byte-identical copies** in the three folders — `/sync-skills` copies one
skill folder at a time, so none may import from another. Edit all copies; each carries a
MIRROR banner, `scripts/fixtures/MIRROR.md` lists the comment-free ones, and self-test case 0
sha256-compares every mirrored path against every sibling that is present. The **report shell**
(`assets/report-shell.template.html`, the one general HTML page) and the renderers' "report-shell
kit" block are shared five ways, by skills 3, 3b, 3c, 5 and 5b: skill 3's case 27 and skill 5's run-report
cases 26 and 28 compare them. Skills 5 and 5b share the run-report renderer, its harness, `scan-lib.mjs`,
both templates and the run-report fixtures the same way (byte-identical, MIRROR banners, checked by skill
5's case 28 and by the 5b copy); only `selftest-manual-run.mjs` and `fixtures/manual-run/` are 5b's own.
Skills 3b and 3c also
share the cross-validator check prose (`patch-rules.md` §1b) word for word. Skills 4 and 5 share
`scripts/tc-hash.mjs` (the canonical TC hash) the same way: byte-identical, MIRROR banner, and
each harness asserts the same golden hash for the same fixture.

Scripts are zero-dependency ESM, Node ≥ 18, and return their result as a JSON payload. The
reporting scripts are read-only and always exit 0 (`--strict` on skill 5's validator and on the
two renderers is the opt-in exception, for CI); the renderers write only behind `--write` (skill
3's also `--write-skeleton`); skill 5's `run-stage.mjs` is the one runner — it starts the consumer
project's Playwright, writes only under the story's `artifacts/` and appends to the run's progress
log; every `selftest*.mjs` is a test harness and exits non-zero on
mismatch by design. After changing skill 5's validator, run-stage / watchdog / impact scripts or run-report renderer / template (mirrored in
5b), or the review-page renderer / template in skills 3, 3b and 3c, run the self-tests:

```bash
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-report.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-watchdog.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-config-inventory.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-tc-hash.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-run-stage.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-impact.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-scratch.mjs --pretty
node .claude/skills/link-qc-5-test-run-automation/scripts/selftest-references.mjs --pretty
node .claude/skills/link-qc-1-generate-update-testing-structure/scripts/selftest.mjs --pretty
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-run-report.mjs --pretty
node .claude/skills/link-qc-5b-test-run-manual-cli/scripts/selftest-manual-run.mjs --pretty
node .claude/skills/link-qc-4-publish-test-cases-azure/scripts/selftest-ado-sync.mjs --pretty
node .claude/skills/link-qc-3-generate-manual-test-cases/scripts/selftest.mjs --pretty
node .claude/skills/link-qc-3b-validate-manual-test-cases/scripts/selftest.mjs --pretty
node .claude/skills/link-qc-3c-validate-manual-test-cases-cli/scripts/selftest.mjs --pretty
```

The optional Azure loop after publishing / automation is: skill 4 `--suite-only` (suite placement) → link-qc-7 (outcomes → one Test Plan run) → link-qc-8 md-to-azure (defects) → link-qc-8 azure-to-md (developer states, retest candidates) → link-qc-9 (retest; push rules inline) → link-qc-8 md-to-azure again for manual local changes. These steps gate nothing. All three use the Azure DevOps MCP only; link-qc-7 (and skill 4 `--suite-only`) need the cloud server's test-plan tools and report NOT_RUN when missing; link-qc-9 never uses the Playwright MCP — it re-runs automated TCs through skill 5's runner and retests the rest through playwright-cli, and it is the one skill that updates the latest run-report phase in place. `ADO-BUG-MAP.md` lives beside `ADO-MAP.md` in TestCases, never at the report root.
