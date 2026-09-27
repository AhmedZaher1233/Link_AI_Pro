<!-- MIRROR — byte-identical copies live in the sibling skill folders
     (link-qc-3-generate-manual-test-cases ↔ link-qc-3b-validate-manual-test-cases ↔ link-qc-3c-validate-manual-test-cases-cli, each under references/). Edit all three;
     scripts/selftest.mjs case 0 sha256-compares every mirrored file. -->
# Validation states — one per TC, a cross-skill contract

The `Validation` field of every TC carries exactly one of these values. Skill 3 writes only the
last one; skills 3b (Playwright MCP) and 3c (playwright-cli) set the others from live observation; skills 4 and 5 read them (skill 5
carries them forward as "possibly stale"). The words are frozen — never rename, never add.

| State | Meaning | Written by |
|-------|---------|-----------|
| `validated` | The TC's own steps — including its unique tail — were observed live and matched the document | 3b, 3c |
| `enhanced` | Steps were corrected or extended from live observation; the enhancement log says what changed and why | 3b, 3c |
| `inferred` | Only the TC's common-flow prefix was observed live; its unique tail was confirmed from the learning file or an earlier observation, NOT replayed (also every TC in a SHARED-FLOWS-ONLY scope whose tail is known). The reviewer must treat it as not directly witnessed | 3b, 3c |
| `discrepancy` | The application contradicts the requirement (implemented functionality only) — recorded as a Potential Bug, never designed around | 3b, 3c |
| `not-implemented — pending implementation` | Requirement-based TC for functionality the app does not have yet. Not an application defect | 3b, 3c (skill 3 may write it only when the tester or a skill-4 report states the story is not implemented) |
| `draft — not app-validated` | Never observed: designed from the requirement (skill 3), scope-excluded, app unreachable, or reset. May carry a reason in parentheses: `draft — not app-validated (stale — {content \| requirement \| environment \| build \| open question Q-n \| revised \| data changes not authorized \| screen could not be driven})`, or `draft — not app-validated (human step pending)` when the TC's browser part was walked but a `[HUMAN]` step remains for a person (3b / 3c stamp `outcome-check: human step pending`; the TC is listed under "Needs a human run" and never counts as observed) | 3, 3b, 3c |

Rules that hold in every skill that writes a state:

- **Never claim what you did not observe.** A TC is `validated` only when its own unique tail was
  seen live; prefix-only knowledge is `inferred`; unobservable is `draft`. A `[HUMAN]` step is by
  definition not observed by the tool: the validator walks up to it, stops, and writes
  `draft — not app-validated (human step pending)` — never `validated`, never `enhanced` away.
- **A state survives only while its evidence applies.** Each observed TC carries a
  `<!-- tc-evidence -->` stamp (date, environment, build, scope, content hash, requirement-text
  hash, open questions at observation time; 3b writes `tool: mcp`, 3c writes `tool: cli` plus an
  `outcome-check` line — a stamp without `tool` was written by 3b before 3c existed). When the TC
  content, the cited requirement text, the
  environment, the build (where known) or an undermining open question changes, the state drops to
  `draft — not app-validated (stale — {reason})` and the TC is re-queued. A stale TC is counted as
  draft and badged `stale` on the page.
- **Gaps, defects and pending implementation stay separate.** A missing screen on a story that is
  not implemented is `not-implemented`, never `discrepancy`; a spec-vs-app contradiction is
  `discrepancy` + a `PB-{n}` entry, never a rewrite of the requirement.
- **App validation progress** counts `validated` + `enhanced` + `discrepancy` (non-stale) over all
  TCs — it is an observation measure, not a pass rate, and it never changes the requirement
  coverage score.
- On skill 3 `--revision`, a TC whose steps change is reset to `draft — not app-validated (stale —
  revised)`; TCs the revision did not touch keep their state.
