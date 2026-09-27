# MCP validation pass — load at workflow steps 5 and 8

> **MCP makes the Manual TCs smarter — it discovers missing information and corrects wrong
> assumptions. It is NOT a replay harness. 50 TCs never means 50 full MCP executions.**

The combined ask (base URL, credentials per role, implementation status, environment notes) has
already happened in `intake.md` §3, and the Playwright MCP probe before it — a run without a
server is BLOCKED there. The set analysis (common flows, unique tails, risk) and the scope
decision live in `scope-gate.md`; the test-data look and the write-back live in
`patch-rules.md`. This file holds what happens in the browser.

## 1. Implementation-status gate — run BEFORE any TC-level validation

Before treating ANY test case as executable validation of the application, determine the User
Story's implementation status. Signals, in order:

1. The document header (`Implementation status:` with its source) and the user's answer from the
   combined ask (implemented / partially / not implemented).
2. A quick live probe via Playwright MCP: does the feature's entry point (menu item, screen,
   control) exist at all in the app? (One targeted check — not a full walk.)
3. Optionally, a `link-qc-10-white-box-testing` report for this requirement, if one exists — glob
   `{white_box_reports}/**/US-{storyID}-*/{storyID}-*-analysis.md` (older reports may sit flat at
   the root).

Classify the story (and, where they differ, each acceptance criterion) as exactly one:

| Status | Meaning | Effect on this run |
|---|---|---|
| **Implemented** | Feature reachable and behaving | Full pass (§2-§6) within the chosen scope |
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
- Record the implementation status (and the evidence for it: probe result, answer, report path)
  in the document header and in the structured return. When the document said "not yet checked
  live", this run establishes it.
- The build / version: read it wherever the app already shows it (footer, about screen, a
  health page reached during the walk). Never guess — `unknown` when it is not visible. It goes
  into every evidence stamp and the header stamp.

## 2. Analyze before touching the browser

The **discovery plan** comes from `scope-gate.md` §1: common flows (shared step prefixes,
validated ONCE), known knowledge (confirmed by the learning file or by a flow validated earlier
this run — NOT rediscovered), gaps (missing navigation, preconditions, data, filters, async waits,
triggers, ambiguous steps — the discovery targets), and locale-sensitive points (every element
label referenced in any step, plus screens whose secondary-locale behaviour must be walked live,
§4). Data items are checked with one read-only look each during the walk — `patch-rules.md` §3.
Apply the plan within the chosen scope (FULL / SHARED / CUSTOM — `scope-gate.md` §4).

## 3. Targeted MCP budget rules

- **Snapshot once per NEW screen** to learn its structure. After that, use a targeted
  element/text lookup and targeted assertions instead of another snapshot. NEVER take a full
  snapshot per TC, and never re-snapshot a screen already understood this run unless its state
  materially changed.
- **Validate each common flow once** (primary locale): walk it, capture verbatim labels,
  required reveals (P1), async waits (P2), and explicit triggers (P3). Reuse the validated
  flow's wording in every TC that shares it — the TC keeps its full steps written out (never
  replaced by a bare reference), but the flow is not re-walked.
- **Per TC, replay only its UNIQUE TAIL** — the steps after its common-flow prefix — in the
  primary locale (FULL scope, or the TCs named in CUSTOM scope). The unique tail is where
  spec-vs-app discrepancies hide; do not skip it inside the scope. A unique tail is left
  unwalked ONLY when the scope excludes it (SHARED-FLOWS-ONLY) or when the learning file or an
  earlier observation this run confirms those exact steps on that exact screen — then the TC is
  marked `inferred`, never `validated`.
- **Resolve every token through its own row.** `Open the portal [E1]` → the `E1` row's `Value`
  (the base URL you asked for), `Open the mail sandbox [E2]` → the `E2` row — never "E1 = the
  URL" for every `[E{n}]`; `Login as Administrator [A1]` → the `A1` row's username + the
  password asked for that account — never "whoever has the role"; `[D2]` → that data item.
  A token with no row → a `data-ref-unresolved` finding for skill 3, never a guess. The TC keeps
  the token; the resolved value never enters a step.
- **Stop at a `[HUMAN]` step.** Walk the TC up to the first step or expected-result line that
  starts with `[HUMAN]`, confirm the steps before it, then stop: the TC ends `draft — not
  app-validated (human step pending)` with `outcome-check: human step pending` in its stamp
  (§6); it is never `validated`, `enhanced` or `inferred`, the marker is never reworded away,
  and the TC is listed under "Needs a human run" in the final message.
- **Observing only.** Do not write code, selectors, or JSON. You may read element identifiers
  incidentally and record them in the learning file's `## Automation Tricks` section — but
  NEVER in the TC deliverables.
- **Read-only in spirit**: prefer navigation and selection over creating, editing, or deleting
  records. If a case genuinely requires mutated state, use seeded fixture data.
- **One progress line per screen** in the chat (`scope-gate.md` §6) — no narration of clicks.

## 4. Secondary-locale policy — verify where localization matters

Do NOT fully replay every TC in the secondary locale. Do NOT pay the MCP cost twice for
behaviour that only changes language. But NEVER assume a label is a direct translation —
accessible names, ordinals, and column ordering have all differed non-obviously between
locales.

- **ALWAYS capture live** (targeted lookup — cheap) the secondary-locale display label of EVERY
  element referenced in any step within scope, and every banner/heading/empty-state text asserted
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
   (per §4). In SHARED scope, a prefix correction is applied to every TC that shares the flow.
2. **Insert missing steps** the app actually requires: reveal a collapsed panel first (P1), wait
   for async population (P2), explicit apply/save trigger (P3), plus any navigation hop,
   precondition, or selection the draft skipped.
3. **Fix wrong assumptions**: note whether a control is *removed from the page* or merely
   *emptied*, *hidden* versus *disabled* — these need different assertions. Record the precise
   read-only surface where relevant.
4. **Observed behaviour that contradicts the spec is a FINDING, not a design decision.** Record
   both the documented and the observed behaviour: the TC becomes `discrepancy`, its
   requirement-based Expected Result stays exactly as designed, and a Potential Bug entry
   (`patch-rules.md` §2) holds the concise reproduction. Never quietly design around it, and
   never rewrite the requirement as if the observed behaviour were intended — the spec may be
   right and the code wrong. (Applies only to IMPLEMENTED functionality — see §1.)
5. **A scenario the design missed** (an unanticipated negative case, a locale difference, a
   state the requirement implies but no TC covers) is a **requirement / coverage gap** for skill 3
   `--revision` — recorded under Open Findings, never added as a TC here (SKILL.md invariant 2).
6. **Design fields are never touched**: `ID`, `Type`, `Locale`, `Requirement`, `Stage`, `Smoke`,
   `Automation Candidate`, `Data effect`, `Shared data`, `Tags`, `Description`, the coverage
   tables. Reference tokens and `[HUMAN]` markers stay as written (§3).

## 6. Validation states — every TC gets exactly one

`validation-states.md` holds the table and the rules. In short: `validated` (own tail seen,
matched) · `enhanced` (corrected / extended from observation — log what changed) · `inferred`
(prefix seen, tail confirmed from prior knowledge or SHARED scope — not witnessed) ·
`discrepancy` (app contradicts spec — PB recorded) · `not-implemented — pending implementation`
(§1) · `draft — not app-validated` (not walked: scope excluded, app unreachable, stale, or
**human step pending** — reason in parentheses). A TC stopped at a `[HUMAN]` step is
`draft — not app-validated (human step pending)`, stamped `outcome-check: human step pending`
(the only case this skill writes that key); the six states are unchanged — this is a draft
reason. Never mark a TC `validated` on the strength of its prefix alone — that is `inferred`.
Every observed TC gets its evidence stamp (`patch-rules.md` §2).

## 7. Failure rule

**App unreachable, login fails, or a screen cannot be driven** → STOP and report to the user
exactly what failed (URL tried, role, error seen) and re-ask ONCE. Still failing → write back
what was validated so far (every state honest — the walked TCs keep their new states, the
rest stay `draft — not app-validated`), list the unwalked TC-IDs under Environment blockers, and
return BLOCKED. NEVER fill the gap by guessing — silently-inferred steps are exactly the ambiguity
this pass removes.
(An entry point absent because the story is not implemented is NOT this failure — that is §1's
`not-implemented` outcome. No Playwright MCP server at all is `intake.md` §3's BLOCKED.)

**Enhancement log** — maintain the table in the document (`## Enhancement Log`, append-only):

| TC-ID | Validation | What changed | Why (what the app showed) | Run |
|-------|-----------|--------------|---------------------------|-----|
