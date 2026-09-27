# Built-in self-review — the eleven checks, load before the write-back (workflow step 10)

You are your own first reviewer. Run every check below, FIX your own findings in place, and only
then patch the files. There is no separate reviewer agent — the next gate is the human.

1. **Validation honesty** — no TC marked `validated` whose unique tail was not observed this run
   this run; every `inferred` TC names why its tail could not be driven and what fresh prior
   evidence it relied on; every TC in the document was walked or carries the application's
   reason for not being observed — never "out of scope"; no
   not-implemented functionality marked validated, enhanced or as a defect; every observed TC
   carries an evidence stamp (`tool: cli`) whose `build` is a value the app showed or `unknown`;
   **outcome rule** — every `validated` / `enhanced` TC has an `outcome-check` line that names
   what was looked at and what it showed; a command that merely succeeded is not an observation.
2. **Separation** — requirement / coverage gaps, application defects (one line per PB), pending
   implementation, environment blockers and unclear requirements appear in five distinct
   buckets — never mixed; a coverage gap is recorded for skill 3, never closed by adding a TC.
3. **No design field changed** — diff `ID`, `Type`, `Locale`, `Requirement`, `Stage`,
   `Description`, `Smoke`, `Automation Candidate`, `Data effect`, `Shared data`, `Tags`,
   `Data Oracle`, every `[HUMAN]` marker, every `[E{n}]` / `[A{n}]` / `[D{n}]` token and the TC
   set before vs after your patch: identical, or your patch is wrong.
4. **Coverage untouched** — `Requirement coverage (weighted)`, the per-AC table, the traceability
   matrix and the manual-only table are byte-identical before vs after, unless a recorded design
   gap or an authorized case update changed the evidence — then the change is named in the final
   message and the figures still match the tables.
5. **Every TC still present with the same ID** — the summary table and the `###` sections list
   the same IDs as before the run; nothing added, removed or renumbered.
6. **History kept** — enhancement-log rows appended, none edited or deleted; PB entries updated
   in place with stable ids, `resolved` only where a retest succeeded this run, `not-checked-
   this-run` where it did not; evidence stamps replaced only for TCs observed this run.
7. **Potential bugs are concise** — five visible lines each (title, TC, numbered reproduction
   steps, requirement-based expected result copied from the TC, actual result); no analysis, no
   suspected cause; no PB for a gap, a blocker or an unclear requirement.
8. **Secrets, code and references** — no password, token, selector, locator, element ref,
   attribute name, code snippet or file identifier in the TC document, the test-data file, the
   page, the sidecar or the learning file; roles and `[A{n}]` references in the TCs, the username
   only in `TEST-DATA` §1; no URL, username or dataset identifier written into a TC as a
   literal — every token you resolved was looked up through its own `TEST-DATA` row; the base
   URL in the `[E1]` row and as `[type: env]`; **no password on any command line this run
   issued** (secret names `A{n}_USER` / `A{n}_PASSWORD` only, or attended login).
8b. **Human steps honest** — every TC with a `[HUMAN]` step ends `draft — not app-validated
   (human step pending)` with `outcome-check: human step pending`, never `validated`, `enhanced`
   or `inferred`; the marker is untouched; each is listed under "Needs a human run".
9. **Counts** — the six `MCP validation` numbers, `App validation progress`, the test-data header
   counts and the PB counts equal the tables they summarize; the renderer's dry run reports no
   `MISMATCH` (fix the header, never the page).
10. **Open questions** — every unresolved gap has a `Q-{n}` in the required shape (affected TCs,
    gap, why, evidence, recommendation + reason, alternatives, pending, status); nothing was
    done on the strength of an unanswered recommendation; the dependent TCs kept their state and
    are listed under Unclear requirements; the same questions appear in the final message.
11. **Sessions closed, data reconciled** — every session this run opened is closed and the run's
    `.playwright-cli/` files are removed; every record a data-changing TC created or changed is
    listed as cleaned up or left behind (Environment blockers); no mutation happened without the
    run's "yes"; every TC that carried 3b evidence was re-validated and its stamp replaced (or
    left `draft` with the application's reason) — nothing kept from 3b, nothing skipped.

Anything you cannot fix yourself (an unreachable screen, a contradiction, an unclear
requirement) is listed under **Open Findings for the Human Reviewer** — never silently resolved.
