# Intake — locate the document, gate on its status, probe playwright-cli, ask once (workflow steps 1 and 3)

## 1. Locate the document(s) and the result folders — all inputs read-only

Resolution order — first hit wins, several hits → ask (`open-questions.md` shape, the newest
document as the recommendation):

1. **Explicit path** to a `TEST-CASES-{feature}.md` → that document; `{tc_output_folder}` is its
   folder; `{feature}` is the file-name stem after `TEST-CASES-`; `{user_story_name}` is the
   folder's exact leaf (`US-{id}-{name}`); `{spec_level}` is its `SPEC-*` parent when it has one.
2. **Feature name or User Story ID** → glob `{paths.manualTestCases}/**/US-{id}-*/TEST-CASES-*.md`
   (manifest path first, `Testing/Manual_Test/TestCases` as the fallback).
3. **A `SPEC-{spec-name}/` folder** → every `US-*/TEST-CASES-*.md` under it: a multi-story run (§4).

No document → BLOCKED: "run `link-qc-3-generate-manual-test-cases` first and get its document
approved — this skill executes an approved document and designs nothing". The resolved
`{tc_output_folder}` is stated in the chat and is immutable for the run. A same-story folder at
another level (flat `US-*` while a `SPEC-*/US-*` twin exists) is reported; the approved one wins.

Companion files in the same folder, **read when present, never written** (this skill writes
nothing into the TC folder — not a state, not a stamp, not a data status): `TEST-DATA-{feature}.md`
(its `## 0. Environment` / `## 1. Accounts` / `## 2.` rows are what every `[E{n}]` / `[A{n}]` /
`[D{n}]` token resolves to; missing → the tokens are unresolved, their TCs `SKIP — data_missing`,
and the final message says to re-run skill 3), `evidence/` (3b / 3c screenshots — never touched),
`ADO-MAP.md` (only to name the work-item ids in the final message — never a gate, never edited),
`TC-REVIEW-STRINGS-{feature}.ar.json` and `REVIEW-COMMENTS-{feature}.md` (ignored).

**Result folders** — skill 5's folder contract (`../link-qc-5-test-run-automation/references/run-report.md`
§3), computed once, stated in the chat, immutable for the run:

| Name | Value |
|---|---|
| `{automation_root}` | the manifest's `paths.automation`, fallback `Testing/Automation` |
| `{results_root}` | `{automation_root}/reports/[SPEC-{spec-name}/]{user_story_name}/` — the manifest's `paths.reports` plus the same `{spec_level}` and the same leaf as the TC folder |
| `{screenshots_root}` | `{automation_root}/screenshots/[SPEC-{spec-name}/]{user_story_name}/` |
| `{logs_root}` | `{automation_root}/automation-logs/[SPEC-{spec-name}/]{user_story_name}/` |
| `{run_report_md}` / `{bug_report_md}` / `{run_report_html}` | `{results_root}/TEST-RUN-REPORT-{feature}.md` / `BUG-REPORT-{feature}.md` / `TEST-RUN-REPORT-{feature}.html` |
| `{run_file}` | `{results_root}/.runs/phase-{N}.json` |
| **Phase `N`** | `1 +` the highest phase found across `{results_root}/.runs/phase-*.json`, the `## Phase N` headings of `{run_report_md}`, legacy `phase-N.*` files at the top of `{results_root}` and the legacy roots `reports/US-{id}/` and `reports/[SPEC-*/]US-{id}/` — skill 5's rule, ONE counter: a phase written by skill 5 and a phase written by this skill both count. Nothing found → `N = 1` and both markdown files are created with their header block and frozen anchors |

`N` is computed at intake and consumed by the first file this run writes (the progress log at the
plan line, `run-plan.md` §3); an entry-gate BLOCKED (§2, §3) consumes no phase and writes nothing.
Legacy artifacts (`phase-N.json|html`, `merged-results.json`, `run-plan.json`, …) are read-only
history: counted for `N`, named on the header's `Earlier phases` line, never opened as run data.

## 2. Entry gate — the document's state decides whether the run starts

Read the header block and the frozen anchors, then classify. This skill has one gate and no
read-only mode: an unapproved document is not executed, an approved one is never modified.

| Header / shape | State | What you do |
|---|---|---|
| `Status: APPROVED` | approved | proceed |
| `Status: PENDING HUMAN REVIEW` | not approved | **BLOCKED** — "set `Status: APPROVED` after review, then re-run this skill". No browser, no ask, nothing written |
| any other `Status` value, or no `Status` line | not approved | the same BLOCKED, naming the value found |
| Frozen fields missing inside a TC (`Type`, `Steps`, `Expected Result`), or not a skill-3 document at all | invalid | **BLOCKED** — "not a skill-3 TC document"; never repair it |
| No `Scope` / `Generated` / `Stage` (renderer `compatibility[]` lists them) | legacy shape | proceed — the stage of each TC is derived from `Type` and `Smoke` (`run-plan.md` §1); say so once in the plan line. Never rewrite the document |
| TC stamps by 3b / 3c (`tool: mcp` / `tool: cli`, `MCP validation:` header line) | informational | never changed, never freshness-checked; the `Validation` states are context only. A state this run's observation contradicts (`validated` and the TC fails as `app_bug`; `discrepancy` and the TC passes) → one bullet under the phase's `### Deviations`, nothing in the TC document |
| `Implementation status:` says `not yet checked live` | status unknown | the combined ask includes the implementation question; `execution-rules.md` §1 establishes it live either way |
| `ADO-MAP.md` present | published | mention the mapping in the final message; it gates nothing and is never edited |

Also note, for the plan (`run-plan.md` §1): every TC's `Stage`, `Smoke`, `Type`, `Data effect`,
the TCs with an `AI Oracle` field (and their `Repeats` / `Pass threshold`), the TCs carrying a
`[HUMAN]` step, and the highest `BUG-{n}` already in `{bug_report_md}` (ids continue from it,
whoever wrote it — `execution-rules.md` §7).

## 3. playwright-cli probe, then the ONE combined ask

**Probe first** (`browser-cli.md` §1): `playwright-cli --version`, else
`npx --no-install playwright-cli --version`. Neither → BLOCKED immediately: "playwright-cli is
not installed — run `/sync-skills --tools` (installs playwright-cli and its browser) or
`/link-qc-1-generate-update-testing-structure repair`, then re-run this skill". Never ask for anything
that cannot be used; never install; never fall back to the Playwright MCP server. (`--audit`
stops here with its report.)

Then ONE message — never a second one for any of these — after searching the learning file
(`learning-file.md`, `open-questions.md` §1) and stating what you reuse:

| Item | Ask when | Never |
|---|---|---|
| Application base URL — the `[E1]` row of `TEST-DATA` §0 | the row says `unknown — asked by 3b/3c` and no `[type: env]` line names it for the target environment, or the user names another environment. Any other `[E{n}]` row still `unknown` (mail sandbox, SMS test provider…) is asked in the same message — each is its own service, never "the URL" | auto-detected; written into the TC document or `TEST-DATA` |
| Username per account the TCs reference (`[A{n}]` — role and username from `TEST-DATA` §1) | only for a row whose username is `unknown`; the answer is used for this run's login | written anywhere but the `### Run` bullets; written into `TEST-DATA` |
| **Login method per account** — A) attended: you open a visible browser for that account and the user logs in themselves; B) secrets file: skill 1's `set-playwright-secrets` script was run with names that follow the account ID (`A1_USER` / `A1_PASSWORD` for `[A1]`) and you type only those NAMES (`browser-cli.md` §3) | always, per referenced account; state the recorded method for this environment as the recommendation when the learning file has one | a password — not in chat, not on a command line, not in a file; the run never receives one |
| Implementation status (implemented / partially / not implemented / not sure) | the header says `not yet checked live` and no skill-4 / skill-10 report answers it | trusted over the live look — both are recorded |
| Environment notes | always, one line: VPN / tenant / where the build number shows / anything that blocks screens / whether this is production | — |
| **Data changes on {env}** — may this run create / modify / delete data (`execution-rules.md` §5)? | always; name the data-changing TCs (`Data effect` ≠ read-only) and what each would leave behind and how it is cleaned up. **Production named in the notes → "no" is stated, not asked** ("production environment → forced to no") | a mutation on "no"; a mutation on production; a second question about it |
| Revision authorization | never — this skill never modifies the document | — |
| Scope | never — every TC of the approved document is executed, in full, separately (`run-plan.md`) | a scope question, a recommendation, a narrowing |
| 3b / 3c evidence | never — the stamps are informational (§2) | a keep / skip / re-validate question |
| How to get a missing data item | never — a `MISSING` item makes its dependents `SKIP — data_missing`; nothing is prepared (`execution-rules.md` §4) | a provisioning question; a per-item question during the run |

**Where each answer is recorded** — in the phase section's `### Run` bullets of
`{run_report_md}` and in the learning file, **never in the TC document or `TEST-DATA`**:
base URL → `- **Environment:** {name}` (the URL itself only as a learning-file `[type: env]` line,
project-wide); usernames → `- **Accounts:** {role} [A{n}] — {username} — attended | secrets file`
(a name, never a value); login method → also `### Manual Run Model (skill 5b)` in the learning
file; implementation status → `- **Implementation status:** {value} ({source})`; environment notes
→ `- **Environment notes:** …` (project-wide facts also to the learning file); the data-changes
answer → `- **Data changes:** {authorized | not authorized} · …` (`execution-rules.md` §5), the run
only. A `TEST-DATA` row that stayed `unknown` is named in the final message so 3b / 3c or skill 3
`--revision` can fill it.

## 4. Multi-story input — a SPEC folder or several IDs

1. List the stories you found and state the split before anything else; a story whose document
   is not `APPROVED` is listed as blocked (§2) and the others proceed.
2. One probe, one combined ask for all stories (login method per account once; one attended login
   per account is reused across stories).
3. Set analysis and plan line **per story** (`run-plan.md` §1-§2); every TC of every story is
   executed; phase `N` is computed per story (each story has its own `{results_root}` and its
   own counter).
4. Sessions are per account and shared across stories (`browser-cli.md` §2); the page state is
   reset between TCs exactly as within one story (`execution-rules.md` §2).
5. One report set per story (`{run_report_md}`, `{bug_report_md}`, `{run_file}`, rendered page,
   screenshots, progress log) — never a combined report. When `TC-GENERATION-SUMMARY.md` exists
   in the spec folder it is not touched.
6. One story blocked (app screen unreachable, login failed) does not stop the others: finish every
   story you can and list the blocked ones with the reason.
