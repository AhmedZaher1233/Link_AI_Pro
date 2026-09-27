# 3b vs 3c comparison — same inputs, separate outputs, measured (COMPARISON mode only)

The purpose of skill 3c is to be compared with skill 3b. This protocol makes the two runs
comparable and keeps their outputs apart. It produces numbers and per-row verdicts — **it never
concludes that 3b should be replaced, that a default should change, or that either skill should
be retired.** Those are later, explicit user instructions after the report has been read.

## 1. Identical inputs — fix them before either run

| Input | Rule |
|---|---|
| Story | one story, one `TEST-CASES-{feature}.md` + `TEST-DATA-{feature}.md` (+ Arabic sidecar when both runs are given `--lang ar`; without the flag both render English whatever the header line or the sidecar says) |
| Starting revision | a recorded git revision of the story folder **and** `Testing/project-learning.md` in which **no TC carries a validation stamp from either skill** (the cross-validator check must never fire). If the story was validated before: use the revision from before that run, or strip the stamps, the header stamp, the Enhancement Log rows and the PB entries on a working copy and commit that copy as the baseline — say which |
| Application state | the same seeded data, reset before each run by a documented procedure (what is reset, how, by whom). Record the build the app shows |
| Model | the same model for both sessions (name it) |
| Scope | `--full` on both invocations: 3c always walks every TC (it has no scope gate), so 3b is given `--full` to walk the same set — never the scope question |
| Login | the same method for both: **attended** (3b asks for credentials in chat today, so a 3c run that also uses attended login keeps the comparison about the browser tool, not about the login path). Both resolve every `[A{n}]` / `[E{n}]` / `[D{n}]` token through the same `TEST-DATA` rows. Note the method in the report |
| Data changes | the same answer for both runs ("yes" only when the reset procedure covers it) |
| Session | a **fresh Claude Code session** per run, nothing else done in it; the invocation names the comparison explicitly ("compare 3b and 3c — run {skill} on {document} --full") so 3b asks no cross-validator or repeat question (3c never asks one) |
| Order | run 3b first or 3c first — state the order; the reset between runs makes it irrelevant |

## 2. Separate outputs — nothing from one run is visible to the other

After each run, copy the outputs into `{tc_output_folder}/comparison/` with the skill prefix, then
restore the inputs:

```text
comparison/
  3b-TEST-CASES-{feature}.md      ← copy of the patched TEST-CASES after the 3b run
  3b-TEST-DATA-{feature}.md
  3b-TC-REVIEW-{feature}.html
  3b-learning.diff                ← git diff of Testing/project-learning.md after the 3b run
  3b-cost.txt                     ← the /cost output of the 3b session, pasted by the user
  3c-TEST-CASES-{feature}.md      ← same set for the 3c run
  3c-TEST-DATA-{feature}.md
  3c-TC-REVIEW-{feature}.html
  3c-evidence/                    ← the evidence/ screenshots of the 3c run
  3c-learning.diff
  3c-cost.txt
  VALIDATION-COMPARISON-{feature}.md   ← the report (assets/validation-comparison.template.md)
```

The `3b-` / `3c-` prefixes keep every `TEST-CASES-*.md` glob of skills 4 and 5 from matching the
copies. Between the runs: `git restore` the story folder files and the learning file to the
baseline revision, delete `evidence/` if the first run created it, reset the application data. The
story folder's live files end the exercise **restored to the baseline** — the comparison never
leaves one skill's result as the story's current document (the user chooses afterwards which run,
if any, to keep by re-running that skill normally).

## 3. Measures — recorded per run, then side by side

| Measure | How it is taken | Where it comes from |
|---|---|---|
| Tokens | the user runs `/cost` at the end of each session and pastes the output into `{skill}-cost.txt`; record input, output, cache-read and cache-write when the output splits them, else the total and "not split". Never estimate | the Claude Code session |
| Elapsed time | from the first browser command to the final message, from the session's timestamps (or the user's clock, stated) | the session |
| TCs completed per state | the six `MCP validation` counts and `App validation progress` after the run | the renderer payload of each copy (`node scripts/render-tc-review.mjs --tc comparison/{skill}-TEST-CASES-{feature}.md --pretty`) |
| Blockers | Environment blockers written, unwalked TC-IDs, BLOCKED returns | the copies' Open Findings |
| Verification quality | same states for the same TCs; same PBs found (title, TC, actual result); labels captured live (count of "(Arabic label: to be captured live)" notes replaced); every `validated` / `enhanced` TC has a non-empty `outcome-check` (3c) or an enhancement-log reason / an evidence stamp (3b); Arabic labels captured | the copies + the payload `document.evidence[]` |
| Output compatibility | renderer gate PASS for both copies; `diff` of the two markdown copies limited to metadata (`tool`, `outcome-check`, `screenshot`, the header stamp) and wording differences, each wording difference listed with the TC-ID and a one-line judgement (equivalent / one is more accurate / needs a human) | `diff comparison/3b-TEST-CASES-… comparison/3c-TEST-CASES-…` |
| Evidence | PB screenshots present for every 3c discrepancy; 3b has none by design (say so, not as a defect) | `comparison/3c-evidence/` |
| Capability gaps | anything the CLI could not do (recorded in `browser-cli.md` §10) or the MCP could not do | the runs' Environment blockers |

## 4. Case matrix — what both runs must cover

One row per case; the story is chosen (or its data seeded) so that every row is exercised. Each
row: the TC-IDs, the expected outcome, the 3b result, the 3c result, a verdict.

| # | Case | Expected outcome (both skills) |
|---|---|---|
| 1 | Successful flow | `validated`, stamp fresh, no PB |
| 2 | Genuine application discrepancy | `discrepancy` + one PB with the requirement-based expected result copied; 3c adds a screenshot |
| 3 | Dynamic element / stale reference (a screen that re-renders after an action) | the step still completes; 3c re-snapshots once (`browser-cli.md` §6); no `draft (screen could not be driven)` |
| 4 | Two roles | both sessions / both logins used; role-specific TCs observed under the right role |
| 5 | Arabic screen | secondary-locale labels captured live, none guessed; RTL assertion walked when the TC has one |
| 6 | Missing data | the TC stays `draft`, the data item `MISSING`, never `validated` |
| 7 | Unavailable environment (a screen made unreachable on purpose) | failure rule: re-ask once, honest partial write-back, BLOCKED with the unwalked TC-IDs; 3c sessions closed |
| 8 | Interrupted run (the session is killed mid-walk, the skill is re-run) | no assumption about what the interrupted run saw; freshness pass on any stamp written; states honest |
| 9 | APPROVED document without authorization | read-only report, nothing written, `ADO-MAP.md` untouched |
| 10 | APPROVED document with `--authorize-revision` | `PENDING HUMAN REVIEW` only when something changed; `--republish` mentioned only with `ADO-MAP.md` |
| 11 | Existing PB retest | `resolved` only after the reproduction was rerun and the expected result confirmed; otherwise `not-checked-this-run` |
| 12 | Stale evidence (a step edited after a first run) | the TC is re-queued as `draft (stale — content)` and re-validated; history kept |
| 13 | `[HUMAN]` step (an OTP read from a test phone, no test interface) | both walk up to the step and stop: `draft — not app-validated (human step pending)`, `outcome-check: human step pending`, listed under "Needs a human run"; never `validated`, marker untouched |
| 14 | Reference tokens (`[E1]`, `[A1]`, `[D2]`) | both resolve each token through its own `TEST-DATA` row; no literal URL / username written into a TC by either; an `enhanced` step keeps the token |

Rows 9-12 need a second pass on each side (an approved copy, an edited step); they are run after
rows 1-8, with the same reset discipline, and their outputs go into the same prefixed copies with
a `-pass2` suffix.

## 5. Acceptance — what the report may say

- **Equivalent verification quality**: the same TCs end in the same states, the same PBs are
  found, no label is guessed on either side, no `validated` without an observed outcome.
- **Compatible outputs**: both copies render with `gate: PASS`; the markdown diff is metadata and
  listed wording differences only; skills 4 and 5 would accept either document.
- **Measured difference**: tokens, elapsed time and blockers reported as numbers, with the
  cache-read share stated separately when available.
- **Capability gaps**: named per skill with the TC, what was needed and what happened — never
  resolved by weakening a check.

The report ends with the numbers and the per-row verdicts. It does not recommend a default. The
final chat message says where the report is and that the story files were restored to the
baseline.
