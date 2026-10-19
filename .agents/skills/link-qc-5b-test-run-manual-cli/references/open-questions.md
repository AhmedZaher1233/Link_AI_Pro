# Open questions — search first, ask in one shape, never act on an unanswered recommendation

Load whenever something is missing, ambiguous or contradictory and a human answer would change a
verdict. The shape is skill 3c's; where a question lives is different: this skill never writes
into the TC document, so a question goes into the phase's `### Open questions` table of
`{run_report_md}` and into the final message — nothing else.

## 1. Search before asking

1. **Learning file, targeted:** `## Index` → the module / page / element names and their
   `Similar to` entries → grep the tags (`\[module: X\]`, `\[page: Y\]`, `\[type: env\]`,
   `\[type: qa\]`) and read only the matching lines.
2. **Previous answers:** grep `#### Questions and Answers` under `### Manual Run Model (skill 5b)`,
   `### Automation Model (skill 5)`, `### CLI Validation Model (skill 3c)`, `### Validation Model
   (skill 3b)` and `### Manual TC Model (skill 3)`.
3. **The TC document's `## Open Questions`:** an entry with `Status: answered` is an answer; one
   with `Status: open` that touches the TC is the ambiguity itself — it is repeated here under
   this phase's numbering with `Source TC` naming it, never re-invented, never edited there.
4. **Earlier phases:** an `### Open questions` row of a previous phase with a decision is an
   answer; one without is re-asked.

Then exactly one of four outcomes: an explicit applicable answer → **reuse it** and say so; related
knowledge from a similar module → a **recommendation that requires confirmation**; knowledge that
contradicts the requirement or the live observation → state the conflict and ask (the
requirement still wins over the learning file; a live observation that contradicts the
requirement is an `app_bug`, not a question); nothing → say so and recommend who can answer.

## 2. The required shape — every question, every time

Asked through `AskUserQuestion` (several questions in one batch, after the stage that raised
them, never one at a time during a TC; one option marked `(Recommended)`; a free-text "Other"
always there) and written as one row of the phase's `### Open questions` table —
`# · Source · Ambiguity · TCs · Decision · By` — where `#` is `Q-{n}` (numbered per phase, from 1),
`Source` is the source TC, `By` is one of `rubric-ambiguous` (the AI rubric cannot decide the
reply), `expectation-ambiguous` (the TC's Expected Result can be read two ways) or `data` (which
record / value the TC means), and `Decision` is `open` until answered. The full shape goes into
the final message:

```markdown
### Q-{n} — {one-line title}
- **Affected TCs:** TC-…, TC-…
- **Gap:** {exactly what is ambiguous or conflicting — quote the expectation line or the observation}
- **Why it matters:** {which verdict changes depending on the answer}
- **Evidence:** {learning-file entry (section + line), requirement line, screen observed, reply excerpt — or "none found"}
- **Recommended:** {one answer} — {the reason}
- **Alternatives:** {the other meaningful answers, each with its consequence}
- **Pending:** {the TC-IDs left INCOMPLETE until answered}
- **Status:** open | answered {YYYY-MM-DD}
```

## 3. Never act on an unanswered recommendation

- There is no "judge on the assumption" path. The run continues with every TC that does not
  depend on the answer; every TC that does is `INCOMPLETE · expectation ambiguous (Q-{n})`
  (`execution-rules.md` §3) — never `PASS`, never `FAIL`, never a bug.
- An answer given in the task input or earlier in the same run is an answer — never re-asked; a
  question answered before the phase is written back is applied to its TCs **only when their
  observation already covers the answer** (the reply text or the screen state is on record);
  otherwise the TC stays `INCOMPLETE` and the next phase judges it.
- The final message repeats each open question with the exact answer that would close it.
- A question is never written into the TC document, `TEST-DATA` or the bug report.

## 4. Provenance — what reaches the learning file

Only a **confirmed** answer (given by the user, or an existing entry they reused) is written,
later, as `- [module: X] [type: qa] **Q (skill 5b, {YYYY-MM-DD}):** {question} — **A:** {answer}
(confirmed by user {date})` under `### Manual Run Model (skill 5b)` → `#### Questions and
Answers` (`learning-file.md`). An unanswered recommendation is never written; a confirmed answer
that contradicts an older entry replaces it; credentials are never a question written anywhere.
An answer that changes what a TC should expect is also a note for skill 3 `--revision` in the
final message — the document is not edited here.
