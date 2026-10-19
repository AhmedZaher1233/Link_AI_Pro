# Open questions — the interpretation gate (PHASE 2.4)

Loaded by `SKILL.md` at **Writing Automation Code** only when a TC was parked (a step or expected
result that does not map deterministically, an unresolved element, a "Needs human review" note, a
TBD). Nothing parked → never loaded.

## PHASE 2.4 — OPEN QUESTIONS (interpretation gate)

<open_questions>
**Runs after PHASE 2 generated everything it could, and BEFORE PHASE 2.5.** An approved TC
document can still read ambiguously in places. Those TCs are **decided here with the user —
never blocked, never guessed silently, and never discovered by the run.**

The shape is the same as `<data_readiness>`: collect → dedupe → find options with evidence →
ask ONCE → execute → write the artifact → write back to the learning file.

**1. Collect the open questions** from four sources, each item carrying the exact wording:

| Source | What | Where it came from |
|---|---|---|
| `A` | A step or Expected Result that cannot map deterministically to an action + assertion | `<normalization>` parked it |
| `B` | An AMBIGUOUS / NOT_FOUND / DYNAMIC element no safe fix resolved | `<selector_resolution>` step 4 |
| `C` | `> Needs human review: …` notes in `{beautified_tc_doc}` | skill 4 — only under `ado_mode = linked` |
| `D` | `TBD`, `to be confirmed`, `open question`, `assumption:`, or a trailing `?` inside an Expected Result / Precondition of `{source_tc_doc}` | the approved document itself |

**De-duplicate:** the same ambiguity hit by several TCs is **ONE question** carrying the TC
list — exactly as `<data_readiness>` dedupes a requirement across TCs. Never ask the same thing
twice in one run.

**2. Derive the candidate answers — from evidence ONLY, never invented.** In order, stopping at
the first that answers it:
1. **`Testing/project-learning.md` first** — grep `[module: …]` / `[page: …]` / `[element: …]`
   / `[similar: …]` / `[type: trick]` / `[type: qa]` for this feature. **A recorded answer is
   REUSED and NOT asked** (`decidedBy: learning`): quote the line in the chat and move on.
2. **The application source and existing page objects** — what the code actually does: sort
   order, exact message text, validation limit, default state, which element carries the label.
3. **A sibling TC in the same approved document** that states the same behaviour unambiguously.
4. **`US-{id}-code-rules.md`** (skill 11) and skill 10's white-box output, when present.

Every candidate states its evidence — the file and what it shows. Offer **2-4 candidates**,
plus always `manual — don't automate this TC` and `other — type the exact expected wording`.
Mark exactly ONE **recommended** (strongest evidence) and say why in one line.

**3. Ask the user — `AskUserQuestion`, in batches of up to 4.** One question per open item:
- `header` — the TC-ID (e.g. `TC-014`)
- `question` — the ambiguous wording quoted verbatim, then what must be decided
- options — the candidates, **recommended first and labelled `(Recommended)`**, each
  `description` carrying its evidence

Interactive → **WAIT**; the reply is the decision of record. When `AskUserQuestion` is not
available, fall back to the single combined table of `<data_readiness>` step 5 (`| # | TC |
Ambiguity | Options (evidence) | Recommended |`, answered in one line).

**4. Unanswered, or non-interactive → best guess, explicitly marked.**
- Generate the test from the **recommended, evidence-backed** candidate.
- Tag the test `@unverified-assumption`, state the assumption as a comment at the top of the
  test and in the report.
- **HARD GUARD — a failing `@unverified-assumption` test is classified `unverified_assumption`,
  NEVER `app_bug`.** The interpretation is suspect before the application is. Such failures are
  **excluded from the smoke-gate `app_bug` majority math** (a wrong guess must never stop the
  run), are never filed as a bug, and are never published as Passed — ADO outcome
  `Inconclusive`, like `INCOMPLETE`.
- **No evidence-backed candidate → nothing to guess from.** That TC is skip-guarded with the
  exact open question as its reason; it is never invented.
- Coverage table: `partially covered — unverified assumption`.

**5. Write every answer to the learning file as GENERIC knowledge — IMMEDIATELY.**
This is what stops the question ever being asked again — in a later phase of this run, in a
later run, or for another story hitting the same ambiguity.
- Write it **the moment the answer arrives, BEFORE generating the parked TCs**, so PHASE 2.5,
  2.6, 3, 4, 5 and every later story in the session already find it. Never defer it to the end
  of the run.
- Record the **general behaviour rule, not the TC-specific note.** Not
  `TC-014 expects newest first` but
  `- [module: Orders] [page: Orders List] [type: trick] The orders list is sorted newest first by creation date unless the user picks another sort.`
  Any TC touching that list then reuses it without asking.
- Tag it at the level the rule actually holds (`[module: …]` / `[page: …]` / `[element: …]`),
  and add `[similar: …]` on both entries when sibling pages behave the same way.
- An answer that holds **project-wide** goes to `## Project Knowledge` as well, so skills 1-11, 3b and 3c
  share it — that is the generic tier.
- Also keep one traceability line in this skill's `#### Questions and Answers`:
  `- [module: X] [type: qa] **Q (skill 5, {YYYY-MM-DD}):** … — **A:** …`
- Update the `## Index` row for every module touched.
- Grep first: **update or dedupe instead of appending twins**; a later correction by the user
  REPLACES the line rather than adding a second one.
- Plain English only — no selectors, no code identifiers, no credentials
  (`<project_learning_file>` content rules).

**6. Generate the parked TCs** with the resolved interpretation, under the PHASE 2 rules (POM
mandatory, selectors confirmed in source, no banned patterns), then continue to PHASE 2.5.

**Write the `open_questions` object into `{run_file}`** (this phase's run file; the shape below):

```json
{
  "measuredAt": "ISO-8601",
  "totals": { "raised": 3, "answered": 1, "reusedFromLearning": 1, "assumed": 1, "unresolved": 0 },
  "questions": [
    { "id": "Q1", "source": "A", "tcs": ["TC-014", "TC-015"],
      "wording": "the list shows the correct order",
      "candidates": [
        { "key": "a", "answer": "Newest first, by creation date", "evidence": "OrdersController.cs orders by CreatedOn descending", "recommended": true },
        { "key": "b", "answer": "Alphabetical by order name", "evidence": "the column header offers it as a manual sort" }
      ],
      "decision": "a", "decidedBy": "user",
      "learningLine": "[module: Orders] [page: Orders List] [type: trick] The orders list is sorted newest first by creation date unless the user picks another sort.",
      "tag": null },
    { "id": "Q2", "source": "B", "tcs": ["TC-022"],
      "wording": "the confirmation message is proper",
      "candidates": [{ "key": "a", "answer": "\"Saved successfully\"", "evidence": "en.json key orders.save.success", "recommended": true }],
      "decision": "a", "decidedBy": "assumption",
      "learningLine": "[module: Orders] [type: trick] Saving an order shows the confirmation message \"Saved successfully\".",
      "tag": "@unverified-assumption" }
  ]
}
```

Progress-log line (activity **Writing Automation Code**, `<live_progress>`; in the chat only inside
the question message itself):
`Writing Automation Code — open questions: {answered}/{raised} decided — {n} TCs parked — {reused n from learning | awaiting user decision | assumed n (unverified) | RESOLVED}`
</open_questions>
