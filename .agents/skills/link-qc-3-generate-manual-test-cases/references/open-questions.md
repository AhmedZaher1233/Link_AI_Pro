<!-- MIRROR — byte-identical copies live in the sibling skill folders
     (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli, each under references/). Edit all three;
     scripts/selftest.mjs case 0 sha256-compares every mirrored file. -->
# Open questions — search first, ask in one shape, never act on an unanswered recommendation

Load whenever something is missing, ambiguous or contradictory and a human answer would change
what you write. Applies to skill 3 (design), skill 3b (live validation through Playwright MCP) and skill 3c (live validation through playwright-cli) alike.

## 1. Search before asking

1. **Learning file, targeted:** `## Index` → the module / page / element names and their
   `Similar to` entries → grep the tags (`\[module: X\]`, `\[page: Y\]`, `\[type: env\]`,
   `\[type: qa\]`) and read only the matching lines.
2. **Previous answers:** grep `#### Questions and Answers` under **all of** `### Manual TC Model
   (skill 3)`, `### Validation Model (skill 3b)` and `### CLI Validation Model (skill 3c)` — and skill 2's section for language and
   spec-source answers.
3. **This document:** an existing `## Open Questions` entry (`Q-{n}`) with `Status: answered` is an
   answer; one with `Status: open` is re-asked, never re-invented under a new id.

Then exactly one of four outcomes:

| Found | What you do |
|---|---|
| An explicit answer that applies to this module / screen / role | **Reuse it** and say what you reused so the user can override. Do not ask |
| Related knowledge from a similar module (`[similar: …]`) or a look-alike screen | Turn it into a **recommendation that requires confirmation** — name the analogy in the evidence line. Ask |
| Learning-file knowledge that contradicts the requirement or a live observation | State the conflict and ask for a decision. The requirement still wins over the learning file (precedence model); a live observation that contradicts the requirement is a discrepancy, not a decision |
| Nothing | Say so, and recommend how to close the gap (who can answer, or what to look at) |

## 2. The required shape — every question, every time

Written into `## Open Questions` of the TC document AND asked through `AskUserQuestion` (several
questions in one batch; one option marked `(Recommended)`; a free-text "Other" is always there):

```markdown
### Q-{n} — {one-line title}
- **Affected TCs:** TC-…, TC-… (or "none yet — blocks design of {scenario}")
- **Gap:** {exactly what is missing, ambiguous or conflicting — quote the requirement line or the observation}
- **Why it matters:** {what changes in the steps / expected result / coverage depending on the answer}
- **Evidence:** {learning-file entry (section + line), spec line, screen observed, skill-4 report — or "none found"}
- **Recommended:** {one answer} — {the reason, e.g. "matches the Objectives module (similar), confirmed there on 2026-09-02"}
- **Alternatives:** {the other meaningful answers, each with its consequence}
- **Pending:** {what stays unresolved until answered — TC-IDs left in their current state, coverage rows, data items}
- **Status:** open | answered {YYYY-MM-DD} | superseded by Q-{m}
```

`Q-{n}` ids are allocated once per document and never reused. An answered question keeps its
entry with `Status: answered {date}` and the answer appended (`- **Answer:** …`).

## 3. Never act on an unanswered recommendation

- There is no "proceed on the assumption" path. Work that does not depend on the answer continues;
  every TC that does depend on it **stays in the state it was already in** (skill 3: not designed
  or designed with the gap named in the step; 3b / 3c: not validated, `Validation` untouched) and is
  listed under `## Open Findings for the Human Reviewer → Unclear requirements` against its
  `Q-{n}`.
- Independent stories in a multi-story run finish normally; the blocked ones are listed.
- The final message repeats each open question with the exact answer that would close it.
- An answer given in the task input or earlier in the same run is an answer — never re-asked.

## 4. Provenance — what reaches the learning file

- Only a **confirmed** answer (given by the user, or an existing entry they reused) is written:
  `- [module: X] [type: qa] **Q (skill 3 | skill 3b | skill 3c, {YYYY-MM-DD}):** {question} — **A:** {answer} (confirmed by user {date})`
  under this skill's `#### Questions and Answers`; project-wide answers (base URL per
  environment, roles, module names, implementation status, review-page language) also under
  `## Project Knowledge`.
- Only a confirmed answer is reused later without re-asking. A recommendation the user did not
  answer is **not** written to the learning file at all.
- A confirmed answer that contradicts an older entry replaces it (never two conflicting lines).
- Credentials are never a question written anywhere; the base URL is stored only as `[type: env]`.

## 5. Freshness (3b and 3c)

A question's status at the time of an observation is part of the TC's evidence stamp
(`open-questions: Q-1, Q-3`). An answer that arrives later and could change the confirmed steps or
expected result makes those TCs `draft — not app-validated (stale — open question Q-n)`; an answer
that does not touch what was observed leaves the state alone.
