# Execution rules — load at workflow steps 5 and 8

> **Every TC is executed in full, separately, as the approved document wrote it. The run reports
> what the application did; it never makes a failure disappear, never heals, never edits.**

The combined ask (base URL, username and login method per account, implementation status,
environment notes, data-changes permission) has already happened in `intake.md` §3, and the
playwright-cli probe before it — a run without the tool is BLOCKED there. The set analysis, the
stage order, the smoke gate and the AI repeats live in `run-plan.md`; how each browser action is
issued (sessions, login, commands, refs, evidence files) is `browser-cli.md`; the judging rules
for an assistant's reply are `ai-response-rules.md` (referenced, not restated); the report shapes
are skill 5's `references/run-report.md` §4-§5. This file holds what happens per TC and what each
outcome is called.

## 1. Implementation-status gate — run BEFORE any TC is executed

Before treating ANY test case as executable, determine the User Story's implementation status.
Signals, in order:

1. The document header (`Implementation status:` with its source) and the user's answer from the
   combined ask (implemented / partially / not implemented).
2. A quick live look: does the feature's entry point (menu item, screen, control) exist at all in
   the app? (One targeted `find` / `snapshot --depth` on the entry screen — not a full walk.)
3. Optionally, a `link-qc-10-white-box-testing` report for this requirement, if one exists — glob
   `{white_box_reports}/**/US-{storyID}-*/{storyID}-*-analysis.md` (older reports may sit flat at
   the root).

Classify the story (and, where they differ, each acceptance criterion) as exactly one:

| Status | Meaning | Effect on this run |
|---|---|---|
| **Implemented** | Feature reachable and behaving | Run every TC (§2-§3) |
| **Partially implemented** | Some ACs live, some absent | Run the TCs of the live parts; every TC of an absent part gets a row `SKIP` with reason `pending implementation` — never a defect |
| **Not implemented** | Feature / entry point absent | Every TC `SKIP — pending implementation`; no browser beyond the look; `**Outcome:** INCOMPLETE`; nothing filed as a bug |
| **Cannot be validated** | Environment blocks verification (app down, login fails, screen unreachable for environmental reasons) | `**Outcome:** ENVIRONMENT_BLOCKED — {what blocked}` after the failure rule (§6); the TCs are `NOT_RUN · not started: environment blocked` |

Hard rules:

- A missing screen / control on a NOT-implemented story is **pending implementation**, never an
  application defect. Keep **requirement / coverage gaps** (spec has no TC) strictly separate from
  **application defects** (implemented behaviour contradicts the spec) in every table and finding.
- Never mark a TC `PASS` or `FAIL` for functionality that is not implemented.
- Record the implementation status (and the evidence for it: the live look, the answer, the
  report path) in the phase's `### Run` bullets and in the structured return — never in the TC
  document, even when it said "not yet checked live".
- The build / version: read it wherever the app already shows it (footer, about screen, a health
  page — `browser-cli.md` §7). Never guess — `unknown` when it is not visible. It goes into the
  `- **Build:**` bullet and every bug entry.

## 2. Per-TC execution — the whole TC, every time

- **Preconditions are verified, not assumed**: each Preconditions line is checked with a targeted
  look (the account is logged in, the record exists, the setting is on) before step 1. A
  precondition that does not hold is judged like a step (§3): missing data → `SKIP ·
  data_missing`; a state the application cannot reach → `FAIL · app_bug` on implemented
  functionality, `FAIL · environment_failure` otherwise.
- **Every step is issued, in document order** (`browser-cli.md` §4), including the common login
  and navigation steps every TC shares — no step is skipped because a previous TC walked it, no
  prefix is "known", no tail is inferred.
- **Inline checks are made as they occur**: a step that says "verify …", "the … is shown" or a
  wait condition is observed at that moment (`find` / `eval` / the wait call), and a failure there
  is the TC's result at that step — the remaining steps are not issued.
- **Tokens resolve through their OWN `TEST-DATA` row**: `Open the portal [E1]` → the `E1` row's
  `Value`; `Open the mail sandbox [E2]` → the `E2` row — never "E1 = the URL" for every `[E{n}]`;
  `Login as Administrator [A1]` → the `A1` row's username and that account's login method —
  never "whoever has the role"; `[D2]` → that data item. A token with no row → `SKIP ·
  data_missing` with the token named; the resolved value goes into the command, never into a
  report line.
- **No reuse of a previous TC's state**: before each TC navigate to the landing screen, or log out
  and in again when the TC needs another account or starts from the login page; close the
  dialogs the previous TC left open; a filter, a selection or a draft left behind is not this TC's
  starting state. A data-changing TC's cleanup runs **after** its assertion-point screenshot
  (§5), still inside that TC.
- **A data-changing TC** (`Data effect` ≠ read-only) is executed only under the run's "yes" (§5);
  on "no" it is `SKIP` with reason `data changes not authorized`, its row says so, and no step of
  it is issued.
- **Observing, and executing only what the TC says.** You may read element identifiers
  incidentally and record them in the learning file's `## Automation Tricks` section, explained
  in words — never in the run report, the bug report or `reply.md`.
- **Timing**: wait conditions use the ceiling the TC names or the default (`browser-cli.md` §4);
  a ceiling that elapses is `timeout_failure` and is never raised during the run to make the step
  pass. The duration column is the TC's wall time from its first command to its status.

## 3. Outcome rule — a successful command proves nothing by itself

*"A successful command alone does not prove the expected result."* A `click` or `fill` that
returned without error only says the action was issued. Before a TC becomes `PASS`:

1. **Look for the Expected Result explicitly** — the text the requirement expects (`find`), the
   state of the control it names (`eval`: disabled / hidden / value / count), the row that should
   now exist, the banner that should appear, the URL or title after navigation. Wait for async
   population first when the screen loads data. For an AI TC, read the reply **text**
   (`browser-cli.md` §4) and judge it by `ai-response-rules.md`: every hard check, then the
   rubric against the threshold.
2. **Take the assertion-point screenshot** at that moment (`browser-cli.md` §7), then record in
   the progress log what you looked at and what it showed, in plain words (`banner "Saved
   successfully" found; grid shows 12 rows`).
3. **Anything less is not a pass**: the expected text absent → re-check once after the wait, then
   the status table below. The expectation itself ambiguous ("the total updates" — which total?)
   → `FAIL · assertion_failure` is NOT assumed: the TC gets a `Q-{n}` (`open-questions.md`), its
   row is `INCOMPLETE · expectation ambiguous (Q-{n})`, nothing is judged on a guess.

| Observation | Status | Classification | Also |
|---|---|---|---|
| every inline check and the Expected Result positively observed | `PASS` | `—` | image |
| implemented functionality contradicts the Expected Result (default for any observed contradiction) | `FAIL` | `app_bug` | failure image · `### BUG-n` (§7) |
| the application matches the requirement text and the TC's own expectation is the wrong one | `FAIL` | `assertion_failure` | failure image · one `### Deviations` bullet + a `Q-{n}` for skill 3 `--revision` — never a document edit, no bug |
| an AI hard check failed (`ai-response-rules.md` §3 — a required fact missing, a forbidden phrase, wrong language, over length, no reply, an error text, a secret echoed) | `FAIL` | `app_bug` | `reply.md` names the failed check · `### BUG-n` in the assistant voice (§7) |
| the AI rubric scored below the threshold, hard checks passed | `FAIL` | `ai_rubric_failure` | `reply.md` with the score · `### BUG-n` in the assistant voice (§7) |
| the page could not be reached or driven for an environmental reason (VPN, 5xx, blank screen, login lost) | one **second attempt** (`attempt-2`; `attempt-1` and its images stay); still failing → `FAIL` | `environment_failure` | listed under `### Skips and residual failures`; counted by the smoke gate |
| a wait ceiling elapsed (page load, async population, the assistant's reply) | `FAIL` | `timeout_failure` | a second attempt only when the cause is environmental |
| the observation was made but no assertion-point image was written (the command failed) | take it now, under the same attempt, while the verified state is still on screen; the state is gone → `INCOMPLETE` | `evidence_failure` | never `PASS` without its image |
| the assertion-point image exists but shows a post-cleanup / post-navigation screen | `INCOMPLETE` — the file stays (nothing under `screenshots/` is overwritten), no new attempt (attempts are for environment failures only) | `evidence_failure` | the next phase runs the TC again |
| the session died mid-TC (`browser-cli.md` §9) | `INCOMPLETE` | `interrupted: session lost at step {n}` | not re-run this phase |
| the first `[HUMAN]` step reached and every step before it passed | `PARTIAL — human step pending` | `human step: {n}` | image of the last executed step; listed under "Needs a human run"; never `PASS`, never counted as passed; the phase is `INCOMPLETE` at best |
| data the TC needs is `MISSING` and no way to prepare it was found after the whole search (§4), the preparation failed / was not confirmed, or a token has no row | `SKIP` | `data_missing` | `### Test-data readiness` row `skip — data_missing` + the Skips row with the precise reason |
| data the TC needs is `NOT CREATABLE` — evidence that the state cannot exist on this environment (§4) | `SKIP` | `—` | reason `not creatable — {evidence}` in `### Skips and residual failures`; readiness row `skip — not creatable` |
| the QC declined the preparation (endpoint from the source code / database) | `SKIP` | `—` | reason `QC declined (data preparation through {way})`; readiness row `skip — QC declined` |
| data-changing TC, run not authorized | `SKIP` | `—` | reason `data changes not authorized` in `### Skips and residual failures` |
| behind an absent part of a partially / not implemented story (§1) | `SKIP` | `—` | reason `pending implementation` |
| smoke gate stopped the run (`run-plan.md` §4) | `NOT_RUN` | `—` | reason `smoke gate failed (application errors)` |
| the run was blocked before the TC's turn (§6) | `NOT_RUN` | `—` | reason `not started: run blocked` |

**A TC never heals and never re-runs to make a failure disappear.** The only second attempt is
the one after an environment failure; a `FAIL · app_bug` (including a failed AI hard check), `assertion_failure`, `ai_rubric_failure`
or `timeout_failure` on a reachable page is final for this phase. A `[HUMAN]` TC is never
`PASS`; a TC without an image is never `PASS`.

## 4. Test data — one read-only look per item, then prepare what is absent

For every `D{n}` item the executable TCs reference, plan ONE read-only look at the listing
screen the `TEST-DATA` file names (a targeted text / row lookup, before the first stage that
needs the item, shared by every TC that uses it — never create, edit or delete anything to find
out). What the look shows decides what happens next (`test-data-preparation.md` §2-§5):

| Seen | Effect |
|---|---|
| the item is there with the values the TCs need | its TCs run; readiness row `Decision: READY` |
| the screen was reached and the item is absent, or the file already says `MISSING` | **discover a way and prepare the item** before its dependents (`test-data-preparation.md` §3 — the learning file, the automation project's helpers, the application's source code, a UI journey, a database helper; the consent its way needs; a temporary seed; verified on the oracle; stamped values read back); row `Decision: prepared (api \| ui \| db)` with the identifiers, the stamped values, where it was verified and `kept` / `cleaned up`; the dependents run |
| no way exists after the whole search, or the preparation failed / was not confirmed | every dependent TC is `SKIP · data_missing`, decided before its turn, with the precise reason in the Skips table; row `Decision: skip — data_missing` |
| evidence proves the state cannot exist on `{env}` (the file says `NOT CREATABLE`, or the discovery found the rule) | dependents `SKIP`, classification `—`, Skips reason `not creatable — {evidence}`; row `Decision: skip — not creatable`; the evidence → learning file |
| the QC answered "no" to the consent ask (endpoint from the source code / database) | dependents `SKIP`, classification `—`, Skips reason `QC declined (data preparation through {way})`; row `Decision: skip — QC declined` |
| the file says `IMPOSSIBLE` | prepared like `MISSING` when the discovery finds a way the file did not know; otherwise `skip — not creatable` with the Problems-row reason |
| the screen was not reached | the item is tried at execution; absent there → the same discovery and preparation at that moment, before the TC's steps are issued |

`**Verdict:** READY` · `READY-WITH-SKIPS ({n} TCs)[ — {p} gaps prepared]`. The preparation itself
is a temporary seed in the session scratch folder or a UI journey in the run's own session —
never new code in the repository, never a password on a command line, never a pre-existing record
modified, never on production (`test-data-preparation.md` principles). `TEST-DATA-{feature}.md` is
never written: a gap, a fact discovered live or a status that should change goes to the readiness
table and, when project-wide and confirmed, to the learning file (`learning-file.md`); the final
message tells the user which rows 3b / 3c or skill 3 `--revision` should update.

## 5. Data-changing TCs — executed when authorized, always reconciled

The combined ask (`intake.md` §3) answered "may this run create / modify / delete data on
{env}?". The answer holds for the whole run and is never re-asked.

- **Which TCs**: those whose `Data effect` is `creates`, `modifies` or `deletes` (a read-only TC
  never mutates, whatever the answer). Production named in the environment note forces "no".
- **"No"** → each such TC is `SKIP` with reason `data changes not authorized`; none of its steps
  is issued (not even its prefix — a manual run executes a TC whole or not at all). This is the
  one exclusion the run makes on the user's word, and the final message names every TC it kept
  out.
- **"Yes"** → before the mutating step, identify the record as the UI shows it (name, number,
  key — plain words, no ids from the DOM) and note it in the progress log; after the TC's
  Expected Result was checked **and its assertion-point screenshot taken**, **revert through the
  UI** when a way exists: the TC's own cleanup step, a `TEST-DATA` §5 way, or a learning-file
  entry (delete the created record, restore the modified value, recreate a deleted seeded record
  only when its exact values are known). Never revert through an API or the database from here.
- **Outcome per record** → the `### Run` bullet and the structured return line
  `**Data changes:** {authorized | not authorized} · {n} made · {n} cleaned up · {n} left
  ({identities})`; every record left behind (no way to revert, or the revert failed) is a
  `### Deviations` bullet `left in {env}: {record} — created/changed by TC-…`. The TC keeps its
  observed status either way — a failed cleanup never changes a `PASS`.
- The same "yes" covers a preparation through an existing automation helper (§4); a UI journey
  preparation needs no answer; an endpoint from the application's source code and a database
  write each need the explicit "yes" of the consent ask (`test-data-preparation.md` §4). A record
  a preparation created is **kept by default** — the keep / clean-up decision is the ONE post-run
  question, and only an existing helper or the UI removes it.
- A TC that needs fixture data that is absent is a `MISSING` data item (§4): the item is prepared
  through the first available way and the TC runs on it; it is `SKIP · data_missing` only when no
  way exists or the preparation failed / was not confirmed — the run never invents data to make
  a TC pass.

## 6. Failure rule

**App unreachable, login fails, a session dies twice, or the entry screen cannot be driven** →
STOP and report to the user exactly what failed (URL tried, role, session, error seen) and re-ask
ONCE. Still failing → write back what was executed so far (every row honest — the executed TCs
keep their status, every TC not reached is `NOT_RUN · not started: run blocked`), append a short
phase section like skill 5's — `### Run` with `**Outcome:** BLOCKED — {reason}` (or
`ENVIRONMENT_BLOCKED — {reason}` when §1 said "Cannot be validated"), no Stages / Results when
nothing ran — and a run-history row of `—`; close every session you opened (`browser-cli.md` §2),
remove the snapshot files, and return BLOCKED with the unexecuted TC-IDs. NEVER fill the gap by
guessing a result. Never switch to another browser tool: this skill has exactly one.
(An entry point absent because the story is not implemented is NOT this failure — that is §1's
`pending implementation` outcome. No playwright-cli at all is `browser-cli.md` §1's BLOCKED,
which consumes no phase.)

## 7. Bug entries — one `### BUG-n` per `app_bug` and per `ai_rubric_failure`

Written into `{bug_report_md}` in skill 5's shape (`run-report.md` §5, `<bug_report_format>`):

- **Id**: `n` continues from the highest `BUG-{n}` already in the file, whoever wrote it (skill 5
  or this skill); never reused, never renumbered. A defect already on file (same TC, same
  symptom) is the same entry — Status and History change, nothing else.
- **Title**: ONE plain sentence naming the user-visible symptom — `The system doesn't X when Y`
  (`The system doesn't show the confirmation banner when the user saves an order`); for an
  `ai_rubric_failure`, `The assistant doesn't X when asked Y` (`The assistant doesn't list the
  open orders when asked for today's pending work`). Never an assertion string, a locator, a
  TC-ID or a requirement code as the title.
- **Fields**, one `- **Field:** value` bullet each: `TC-ID` · `Requirement` · `Severity`
  (`Critical | High | Medium | Low`) · `Environment` · `Browser: Chromium (playwright-cli)` ·
  `Language` · `Build` (the value the app showed, or `unknown`) · `Found in phase` · `Status`
  (`open`) · `Root cause` (plain English, or `not analysed`) · `Steps to reproduce` (numbered,
  starting at login, the nine canonical verbs, no selector) · `Expected` / `Actual` (one simple
  sentence each) · `Screenshot` = the failure image by relative link (`attempt-{a}-failed.png`),
  or `none captured` · `Evidence` = the observed text, at most two lines, secret-free (for an AI
  bug the reply excerpt that failed the rubric and the score) · `History` = `- phase {N} — FAIL:
  {note}`.
- **History is appended, never replaced**; an entry is never rewritten. A bug is `resolved
  (phase {M})` **only after an actual passing retest** of its TC in a later phase (History gets
  `- phase {M} — PASS: {note}`); a bug whose TC did not run this phase becomes
  `not-checked-this-run` (History `- phase {N} — not run: {reason}`); seen again → stays `open`,
  History appended.
- The phase's `### Bugs` sub-section of `{run_report_md}` is the cross-reference table
  (`Bug · TC-ID · Severity · Status`) — details never live there; the header's `**Bugs:**`
  counts are recomputed from the entries. No bug this phase → `none`.
- No bug for an `assertion_failure`, a `timeout_failure`, an `environment_failure`, a
  `data_missing` / not-creatable / declined skip or a pending implementation — those are
  Deviations, open questions, residual failures or readiness rows, never defects.
