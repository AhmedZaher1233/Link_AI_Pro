# Walk rules — load at workflow steps 5 and 8

> **The browser makes the Manual TCs smarter — it discovers missing information and corrects
> wrong assumptions. It is NOT a replay harness. 50 TCs never means 50 full executions.**

The combined ask (base URL, username and login method per role, implementation status,
environment notes, data-changes permission) has already happened in `intake.md` §3, and the
playwright-cli probe before it — a run without the tool is BLOCKED there. The set analysis
(common flows, unique tails, risk) and the no-gate rule live in `discovery-plan.md`; the
cross-validator handling in `patch-rules.md` §1b; the test-data look and the write-back in
`patch-rules.md`. How each browser action is issued (sessions, login, commands, refs, evidence)
is `browser-cli.md`. This file holds what happens in the browser regardless of the tool — it is
the same discipline as skill 3b's, so the two validators stay comparable; the one difference is
that here the walk set is always every TC (3b narrows it through its scope gate; this skill
never does).

## 1. Implementation-status gate — run BEFORE any TC-level validation

Before treating ANY test case as executable validation of the application, determine the User
Story's implementation status. Signals, in order:

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
| **Implemented** | Feature reachable and behaving | Full pass (§2-§6) over every TC |
| **Partially implemented** | Some ACs live, some absent | Validate the live parts normally; mark TCs for absent parts `not-implemented — pending implementation` |
| **Not implemented** | Feature/entry point absent | SKIP the validation pass for these TCs entirely. Keep the requirement-based TCs; mark every one `not-implemented — pending implementation` |
| **Cannot be validated** | Environment blocks verification (app down, login fails, screen unreachable for environmental reasons) | TCs keep `draft — not app-validated`; report exactly what blocked validation under Environment blockers |

Hard rules:

- A missing screen/control on a NOT-implemented story is **pending implementation**, never an
  application defect. Keep **requirement/coverage gaps** (spec has no TC) strictly separate from
  **application defects** (implemented behaviour contradicts the spec) in every table and
  finding.
- Never mark a TC `validated`, `enhanced`, or `discrepancy` for functionality that is not
  implemented.
- Record the implementation status (and the evidence for it: the live look, the answer, the
  report path) in the document header and in the structured return. When the document said "not
  yet checked live", this run establishes it.
- The build / version: read it wherever the app already shows it (footer, about screen, a
  health page reached during the walk — `browser-cli.md` §7). Never guess — `unknown` when it is
  not visible. It goes into every evidence stamp and the header stamp.

## 2. Analyze before touching the browser

The **discovery plan** comes from `discovery-plan.md` §1: common flows (shared step prefixes,
validated ONCE), known knowledge (confirmed by the learning file or by a flow validated earlier
this run — it shortens the discovery of wording, never replaces walking a tail), gaps (missing
navigation, preconditions, data, filters, async waits, triggers, ambiguous steps — the discovery
targets), and locale-sensitive points (every element label referenced in any step, plus screens
whose secondary-locale behaviour must be walked live, §4). Data items are checked with one
read-only look each during the walk — `patch-rules.md` §3. Apply the plan to **every** executable
TC (`discovery-plan.md` §4) — there is no scope to narrow it and no cross-validator answer to
wait for (`patch-rules.md` §1b).

## 3. Targeted browser budget rules

- **Snapshot once per NEW screen** to learn its structure. After that, use a targeted text
  lookup (`find`), an element snapshot or an element read (`eval`) instead of another full
  snapshot. NEVER take a full snapshot per TC, and never re-snapshot a screen already understood
  this run unless its state materially changed (`browser-cli.md` §5-§6).
- **Validate each common flow once** (primary locale): walk it, capture verbatim labels,
  required reveals (P1), async waits (P2), and explicit triggers (P3). Reuse the validated
  flow's wording in every TC that shares it — the TC keeps its full steps written out (never
  replaced by a bare reference), but the flow is not re-walked.
- **Per TC, replay only its UNIQUE TAIL** — the steps after its common-flow prefix — in the
  primary locale, for **every** TC in the executable set. The unique tail is where spec-vs-app
  discrepancies hide; never skip one. A tail this run could not drive (§7) but that a fresh
  earlier observation confirms on that exact screen is `inferred`, never `validated`; a tail
  nothing confirms stays `draft` with the reason.
- **Resolve every token through its own row.** `Open the portal [E1]` → the `E1` row's `Value`
  (the base URL you asked for), `Open the mail sandbox [E2]` → the `E2` row — never "E1 = the
  URL" for every `[E{n}]`; `Login as Administrator [A1]` → the `A1` row's username and that
  account's login method (secret names `A1_USER` / `A1_PASSWORD`, or attended) — never "whoever
  has the role"; `[D2]` → that data item. A token with no row → a `data-ref-unresolved` finding
  for skill 3, never a guess. The TC keeps the token; the resolved value never enters a step.
- **Stop at a `[HUMAN]` step.** Walk the TC up to the first step or expected-result line that
  starts with `[HUMAN]`, confirm the steps before it, then stop: the TC ends `draft — not
  app-validated (human step pending)` with `outcome-check: human step pending` in its stamp
  (§6a); it is never `validated`, `enhanced` or `inferred`, the marker is never reworded away,
  and the TC is listed under "Needs a human run" in the final message.
- **Observing, and executing only what the TC says.** Do not write code, selectors, or JSON into
  any deliverable. You may read element identifiers incidentally and record them in the learning
  file's `## Automation Tricks` section, explained in words — but NEVER in the TC deliverables.
- **Data changes follow §3a**, never a general "read-only in spirit" rule: a TC that creates,
  modifies or deletes data is executed when the run is authorized to, and reconciled.
- **One progress line per screen** in the chat (`discovery-plan.md` §6) — no narration of commands.

## 3a. Data-changing TCs — executed when authorized, always reconciled

The combined ask (`intake.md` §3) answered "may this run create / modify / delete data on
{env}?". The answer holds for the whole run and is never re-asked.

- **Which TCs**: those whose `Data effect` is `creates`, `modifies` or `deletes` (a read-only TC
  never mutates, whatever the answer). Production named in the environment note forces "no".
- **"No"** → each such TC stays `draft — not app-validated (data changes not authorized)`; its
  common-flow prefix may still be observed for wording, but its tail is not run and it is never
  `inferred` from the prefix alone. This is the one exclusion the run makes on the user's word,
  and the final message names every TC it kept out.
- **"Yes"** → before the mutating step, identify the record as the UI shows it (name, number,
  key — plain words, no ids from the DOM) and note it in the run log you keep in the chat
  context; after the TC's Expected Result was checked, **revert through the UI** when a way
  exists: the TC's own cleanup step, a `TEST-DATA` §5 way, or a learning-file entry (delete the
  created record, restore the modified value, recreate a deleted seeded record only when its
  exact values are known). Never revert through an API or the database from here.
- **Outcome per record** → the structured return line `**Data changes:** {n} made · {n} cleaned
  up · {n} left ({record identities})`; every record left behind (no way to revert, or the
  revert failed) is an Environment-blockers line `left in {env}: {record} — created/changed by
  TC-…`. The TC keeps its observed state either way.
- A TC that needs seeded fixture data that is absent is a `MISSING` data item
  (`patch-rules.md` §3) and stays `draft` — the run never invents data to make a TC pass.

## 4. Secondary-locale policy — verify where localization matters

Do NOT fully replay every TC in the secondary locale. Do NOT pay the browser cost twice for
behaviour that only changes language. But NEVER assume a label is a direct translation —
accessible names, ordinals, and column ordering have all differed non-obviously between
locales.

- **ALWAYS capture live** (a targeted `find` — cheap) the secondary-locale display label of EVERY
  element referenced in any step, and every banner/heading/empty-state text asserted
  on. Replace skill 3's "(Arabic label: to be captured live)" notes with the captured label. No
  secondary-locale label in a TC may be a guessed translation.
- **FULL secondary-locale walk required** (once per screen, reused across that screen's TCs)
  when the screen involves any of: report content, rendered numbers/dates/counts, RTL layout
  assertions (panel side, alignment, indentation, column order), or any element whose
  secondary-locale name is known or observed to not be a direct translation.
- A flow confirmed locale-independent (same structure, labels captured) is reused — record that
  fact in the learning file's `## Locale Knowledge` section so future runs skip it too.

## 5. Correction rules — what the walk feeds back into the TCs

1. **Correct verbatim** every control label, option list (in rendered order), banner / heading /
   warning / empty-state text to exactly what the app shows — in every required locale
   (per §4). A common-flow correction is applied to every TC that shares the flow.
2. **Insert missing steps** the app actually requires: reveal a collapsed panel first (P1), wait
   for async population (P2), explicit apply/save trigger (P3), plus any navigation hop,
   precondition, or selection the draft skipped.
3. **Fix wrong assumptions**: note whether a control is *removed from the page* or merely
   *emptied*, *hidden* versus *disabled* — these need different assertions. Record the precise
   read-only surface where relevant.
4. **Observed behaviour that contradicts the spec is a FINDING, not a design decision.** Record
   both the documented and the observed behaviour: the TC becomes `discrepancy`, its
   requirement-based Expected Result stays exactly as designed, and a Potential Bug entry
   (`patch-rules.md` §2, with its screenshot) holds the concise reproduction. Never quietly
   design around it, and never rewrite the requirement as if the observed behaviour were
   intended — the spec may be right and the code wrong. (Applies only to IMPLEMENTED
   functionality — see §1.)
5. **A scenario the design missed** (an unanticipated negative case, a locale difference, a
   state the requirement implies but no TC covers) is a **requirement / coverage gap** for skill 3
   `--revision` — recorded under Open Findings, never added as a TC here (SKILL.md invariant 2).
6. **Design fields are never touched**: `ID`, `Type`, `Locale`, `Requirement`, `Stage`, `Smoke`,
   `Automation Candidate`, `Data effect`, `Shared data`, `Tags`, `Description`, the coverage
   tables. Reference tokens and `[HUMAN]` markers stay as written (§3).

## 6. Validation states — every TC gets exactly one

`validation-states.md` holds the table and the rules. In short: `validated` (own tail seen,
matched, outcome observed) · `enhanced` (corrected / extended from observation — log what
changed) · `inferred` (prefix seen, tail could not be driven this run but fresh prior evidence
confirms it — not witnessed) · `discrepancy` (app contradicts spec — PB recorded) ·
`not-implemented — pending implementation` (§1) · `draft — not app-validated` (not walked: app
unreachable, data changes not authorized, screen could not be driven, stale and unreachable, or
**human step pending** — reason in parentheses; never "scope excluded" — this skill has no
scope).
Never mark a TC `validated` on the strength of its prefix alone — that is `inferred`. Every
observed TC gets its evidence stamp (`patch-rules.md` §2) with `tool: cli` and its
`outcome-check`.

## 6a. Outcome rule — a command that succeeded proves nothing by itself

*"A successful command alone does not prove the expected result."* A `click` or `fill` that
returned without error only says the action was issued. Before a TC becomes `validated` or
`enhanced`:

1. **Look for the Expected Result explicitly** — the text the requirement expects (`find`), the
   state of the control it names (`eval`: disabled / hidden / value / count), the row that should
   now exist, the banner that should appear, the URL or title after navigation
   (`browser-cli.md` §4). Wait for async population first (P2) when the screen loads data.
2. **Write what you looked at and what it showed** into the stamp's `outcome-check` line, in
   plain words (e.g. `banner "Saved successfully" found; grid shows 12 rows`). This line is
   metadata — never rendered, never a step.
3. **Anything less is not validated**: the expected text absent → re-check once after the P2
   wait, then `discrepancy` + PB (implemented functionality) or `draft` with the reason
   (environment); data needed for the check missing → `draft` + the `MISSING` data item; the
   expectation itself ambiguous ("the total updates" — which total?) → a `Q-{n}` in the
   `open-questions.md` shape, the TC stays as it was, nothing acted on until answered.
4. **A `[HUMAN]` step is the end of the walk for that TC** (§3): the steps before it are
   confirmed, the state is `draft — not app-validated (human step pending)` and the stamp's
   `outcome-check` line reads exactly `human step pending` — the outcome behind a human step is
   never observed by this tool, so the TC is never `validated` or `enhanced`; it is listed under
   "Needs a human run".

## 7. Failure rule

**App unreachable, login fails, a session dies, or a screen cannot be driven** → STOP and report
to the user exactly what failed (URL tried, role, session, error seen) and re-ask ONCE. Still
failing → write back what was validated so far (every state honest — the walked TCs keep their
new states, the rest stay `draft — not app-validated`), list the unwalked TC-IDs under
Environment blockers, close every session you opened (`browser-cli.md` §2), and return BLOCKED.
NEVER fill the gap by guessing — silently-inferred steps are exactly the ambiguity this pass
removes. Never switch to another browser tool: this skill has exactly one.
(An entry point absent because the story is not implemented is NOT this failure — that is §1's
`not-implemented` outcome. No playwright-cli at all is `browser-cli.md` §1's BLOCKED.)

**Enhancement log** — maintain the table in the document (`## Enhancement Log`, append-only):

| TC-ID | Validation | What changed | Why (what the app showed) | Run |
|-------|-----------|--------------|---------------------------|-----|
