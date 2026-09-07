# MCP discovery & validation pass — load at the MCP pass (workflow steps 6 and 8)

> **MCP makes the Manual TCs smarter — it discovers missing information and corrects wrong
> assumptions. It is NOT a replay harness. 50 TCs never means 50 full MCP executions.**

## 1. Implementation-status gate — run BEFORE any TC-level validation

Before treating ANY test case as executable validation of the application, determine the User
Story's implementation status. Signals, in order:

1. The user's answer from the combined ask (implemented / partially / not implemented).
2. A quick live probe via Playwright MCP: does the feature's entry point (menu item, screen,
   control) exist at all in the app? (One targeted check — not a full walk.)
3. Optionally, a `4-white-box-testing` report for this requirement, if one exists under
   `{white_box_reports}`.

Classify the story (and, where they differ, each acceptance criterion) as exactly one:

| Status | Meaning | Effect on this run |
|---|---|---|
| **Implemented** | Feature reachable and behaving | Full validation pass (§2-§6) |
| **Partially implemented** | Some ACs live, some absent | Validate the live parts normally; mark TCs for absent parts `not-implemented — pending implementation` |
| **Not implemented** | Feature/entry point absent | SKIP the MCP validation pass for these TCs entirely. Keep the requirement-based TCs; mark every one `not-implemented — pending implementation` |
| **Cannot be validated** | Environment blocks verification (app down, no credentials, screen unreachable for environmental reasons, **no Playwright MCP server attached**) | TCs keep `draft — not app-validated`; report exactly what blocked validation |

Hard rules:

- A missing screen/control on a NOT-implemented story is **pending implementation**, never an
  application defect. Keep **requirement/coverage gaps** (spec has no TC) strictly separate
  from **application defects** (implemented behaviour contradicts the spec) in every table and
  finding.
- Never mark a TC `validated`, `enhanced`, or `discrepancy` for functionality that is not
  implemented.
- Record the implementation status (and the evidence for it) in the deliverable header and in
  the structured return.

### No Playwright MCP server attached

The probe for this happens in the combined-ask step, **before** the URL/credentials ask — never ask for
credentials that cannot be used. When no Playwright MCP server is available for the session:

- The run resolves to `Cannot be validated — no Playwright MCP server attached`.
- Every TC keeps `draft — not app-validated`; no TC may be marked `validated`, `enhanced`,
  `inferred` or `discrepancy`.
- Skip the URL/credentials ask and the whole MCP pass except this gate. The design,
  self-review and deliverables run in full — the document is still delivered.
- Say so in the document header, in the Open Findings section and in the final message, and
  tell the user to attach the server (`/mcp`) or run `/1-generate-update-testing-structure
  repair`, then re-run this skill to validate.
- A story already classified **Not implemented** needs no Playwright MCP at all — that is
  §1's `not-implemented` outcome, not this one.

## 2. Analyze the whole TC set FIRST — no MCP yet

Use the URL and credentials from the combined ask. This pass turns spec-derived wording into app-verified
ground truth — by discovering the UNKNOWN, not by replaying the known.

Before touching the browser, analyze all draft TCs together and produce a **discovery plan**:

1. **Common flows** — shared step prefixes across TCs (login → navigate → open panel → ...).
   Each distinct common flow is validated ONCE, not per TC.
2. **Known knowledge** — steps already confirmed by the learning file or by a flow validated
   earlier in this run. These are NOT rediscovered.
3. **Gaps** — missing navigation, missing preconditions, missing test data, missing
   filters/selections, missing async waits or triggers, ambiguous steps. These are the
   discovery targets.
4. **Locale-sensitive points** — every element label referenced in any step, plus screens whose
   secondary-locale behaviour must be walked live (see §4).

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
  primary locale. The unique tail is where spec-vs-app discrepancies hide; do not skip it. A
  unique tail may be skipped ONLY when the learning file or an earlier observation this run
  confirms those exact steps on that exact screen — then the TC is marked `inferred`, never
  `validated`.
- **Observing only.** Do not write code, selectors, or JSON. You may read element identifiers
  incidentally and record them in the learning file's `## Automation Tricks` section — but
  NEVER in the TC deliverables.
- **Read-only in spirit**: prefer navigation and selection over creating, editing, or deleting
  records. If a case genuinely requires mutated state, use seeded fixture data.

## 4. Secondary-locale policy — verify where localization matters

Do NOT fully replay every TC in the secondary locale. Do NOT pay the MCP cost twice for
behaviour that only changes language. But NEVER assume a label is a direct translation —
accessible names, ordinals, and column ordering have all differed non-obviously between
locales.

- **ALWAYS capture live** (targeted lookup — cheap) the secondary-locale display label of EVERY
  element referenced in any step, and every banner/heading/empty-state text asserted on. No
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
   (per §4).
2. **Insert missing steps** the app actually requires: reveal a collapsed panel first (P1), wait
   for async population (P2), explicit apply/save trigger (P3), plus any navigation hop,
   precondition, or selection the draft skipped.
3. **Fix wrong assumptions**: note whether a control is *removed from the page* or merely
   *emptied*, *hidden* versus *disabled* — these need different assertions. Record the precise
   read-only surface where relevant.
4. **Observed behaviour that contradicts the spec is a FINDING, not a design decision.** Record
   both the documented and the observed behaviour on the TC, mark it `discrepancy`, and surface
   it in the output. Never quietly design around it, and never rewrite the requirement as if the
   observed behaviour were intended — the spec may be right and the code wrong. (Applies only to
   IMPLEMENTED functionality — see §1.)

## 6. Validation states — every TC gets exactly one

| State | Meaning |
|-------|---------|
| `validated` | The TC's own steps — including its unique tail — were observed live and matched the draft |
| `enhanced` | Steps corrected/extended from live observation (log what changed) |
| `inferred` | Only its common-flow prefix was observed live; the unique tail was confirmed from the learning file or a prior observation, NOT replayed. The human reviewer must treat these as not directly witnessed. |
| `discrepancy` | The app contradicts the spec — finding recorded (implemented functionality only) |
| `not-implemented — pending implementation` | Requirement-based TC for functionality the app does not have yet (§1). Not an application defect. |
| `draft — not app-validated` | Could not be observed (app/screen unreachable, or no Playwright MCP — "cannot be validated") |

Never mark a TC `validated` on the strength of its prefix alone — that is `inferred`.

## 7. Failure rule

**App unreachable, login fails, or a screen cannot be driven** → STOP and report back to the
user exactly what failed (URL tried, role, error seen) and re-ask. Affected TCs keep
`draft — not app-validated`. NEVER fill the gap by guessing — silently-inferred steps are
exactly the ambiguity this pass removes.
(An entry point absent because the story is not implemented is NOT this failure — that is
§1's `not-implemented` outcome. No Playwright MCP server at all is §1's
`Cannot be validated` outcome.)

**Enhancement log** — maintain a table (included in the deliverable):

| TC-ID | Validation | What changed | Why (what the app showed) |
|-------|-----------|--------------|---------------------------|
