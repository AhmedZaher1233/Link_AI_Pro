# Built-in self-review — the fourteen checks, load before the write-back (workflow step 12)

You are your own first reviewer. Run every check below, FIX your own findings in place, and only
then write the report set and render. There is no separate reviewer agent — the next gate is the
human reading the page.

1. **Honesty** — every `PASS` row has a positively observed Expected Result recorded in the
   progress log AND an assertion-point image on disk at the linked path; nothing unprobed is
   `PASS`; no TC of a not-implemented part is `PASS` or `FAIL`; every `FAIL` has its failure
   image or `none captured` said plainly; a command that merely succeeded is not an observation
   (`execution-rules.md` §3); the `Build` value is what the app showed or `unknown`.
2. **Every TC executed in full and separately** — one row per TC-ID of the approved document, no
   TC missing, none added, none run twice in the phase; every executed TC was started from a
   reset page state and issued every step up to its result; no "common flow seen in TC-01"
   shortcut; the `### Results` row count equals the document's TC count and the `Total` row.
3. **No file in the TC folder changed** — sha256 of every file under `{tc_output_folder}` (the
   TC document, `TEST-DATA`, the review page, the sidecar, `ADO-MAP.md`, `evidence/`,
   `REVIEW-COMMENTS`) before the run equals the hash after; a difference is a bug of this run and
   is reported, never patched over.
4. **Arithmetic** — the `### Stages` table sums to its `Total` row per column; the smoke-gate
   line's `fail%` equals failed / total smoke, its first word is `passed` or `FAILED-STOPPED`
   and `healed-then-passed` appears nowhere; the `Partial` column exists in `### Stages` and in
   `## Run history` **exactly when** a `PARTIAL` row exists; `**Latest results:**` and the
   run-history row equal the Results table; a `NOT_RUN` row after a gate stop carries the exact
   reason `smoke gate failed (application errors)`.
5. **Human steps honest** — every TC with a `[HUMAN]` step is `PARTIAL — human step pending`
   with Classification `human step: {n}` (`n` = that step's number), never `PASS`, never counted
   as passed; its image is the last executed step's; each is listed under "Needs a human run";
   the phase holding one is `INCOMPLETE` at best.
6. **AI** — for every AI TC the hard checks were judged before the rubric and from the reply
   TEXT (`reply.md` holds it verbatim); a failed hard check is `app_bug`, a rubric
   below threshold is `ai_rubric_failure`, never the other way round; the threshold arithmetic
   holds (`PASS` iff ≥ `k` of `n` repeats passed); exactly one `reply.md` per repeat, each in its
   own `manual-cli--none--r{k}` folder with its own image; no verdict was guessed from a
   screenshot or from a partial (still streaming) reply.
7. **Bugs** — every `app_bug` and `ai_rubric_failure` row has its `### BUG-n`; titles in the
   `The system doesn't X when Y` / `The assistant doesn't X when asked Y` voice; every required
   field present, `Browser: Chromium (playwright-cli)`, `Screenshot` relative; no duplicate id,
   ids continue from the highest existing one; History appended, never replaced; `resolved` only
   after a passing retest this phase; `not-checked-this-run` for every bug whose TC did not run;
   the header `**Bugs:**` counts equal the entries; no bug for a Deviation, a skip or a blocker.
8. **Secrets and code** — no password on any command line this run issued (secret names
   `A{n}_USER` / `A{n}_PASSWORD` only, or attended login); no password, token, selector, locator,
   element ref, attribute name, code snippet or command text in the run report, the bug report,
   `reply.md`, the progress log or the learning file; every reply text and every `Evidence`
   excerpt scanned for a secret echo (a value the assistant or a page repeated back — a password,
   a token, a connection string) before it was written; URLs only as the environment name in the
   reports, the base URL only as a learning-file `[type: env]` line.
9. **Data reconciled** — no mutation happened without the run's "yes" and none on production;
   every record a data-changing TC created or changed is listed as cleaned up or left behind
   (`### Deviations`); every record a preparation created is listed as kept, cleaned up or left,
   and the keep / clean-up question was asked once; every `D{n}` item looked at has a
   `### Test-data readiness` row whose `Decision` is in the vocabulary (`READY` · `prepared
   (api|ui|db)` · `skip — data_missing` · `skip — not creatable` · `skip — QC declined`) and the
   run file's `data_readiness` holds the same rows; `TEST-DATA` untouched (check 3).
10. **Open questions** — every ambiguity that blocked a verdict has a `Q-{n}` in the required
    shape (`open-questions.md`) in the phase's `### Open questions` table and in the final
    message; nothing was judged on the strength of an unanswered recommendation; the dependent
    TCs are `INCOMPLETE · expectation ambiguous (Q-{n})`; no question was written into the TC
    document.
11. **Report consistency** — `render-run-report.mjs` dry run on the two markdown files reports
    gate `PASS` with no `mismatches[]`, and no `evidence-file-missing`, `run-file-missing` or
    `bug-report-missing` warning (fix the markdown or the file layout, never the page); the
    `## Phase N` heading, `**Latest phase:**`, the run-history row and `{run_file}.phase` agree;
    earlier phase sections and rows are byte-identical to before the run; the skill's
    self-test harnesses pass when run.
12. **Clean exit** — every session this run opened is closed (`{pw} list` shows none of them),
    the run's `.playwright-cli/` snapshot files are removed, the progress log ends with the
    outcome line, and the learning file was written (`learning-file.md`): login method per
    environment, assistant UI facts, confirmed answers, prepared fixtures and not-creatable
    evidence — nothing more.
13. **No "data missing" where a way existed** (`test-data-preparation.md`) — every `skip —
    data_missing` row names the search that found nothing (learning file, automation helpers
    through the manifest paths and by search, the application's source code, UI journeys, a
    database helper) or the preparation failure / unconfirmed oracle; no item was skipped while
    an available way existed and the consent its way needs was given or not needed; every
    `not creatable` skip carries its evidence and a learning line; every `QC declined` skip
    follows an actual "no" to the consent ask; every prepared item was verified on its oracle
    **before** any dependent ran, and every stamped-value substitution is a `### Deviations`
    bullet routed to skill 3 (never a silent change of the expectation, never a `PASS` judged
    against the literal the system overrode).
14. **No seed left, no secret anywhere** — no temporary seed script or captured output remains
    in the scratch folder, nothing of it entered the repository (`git status` of the automation
    root shows no new file from this run), no helper or source file was edited; no credential,
    token or connection string appears in any command line this run issued, in any captured
    output that was recorded, in the report set, in `reply.md`, in the progress log or in the
    learning file (every captured output was filtered before it was written anywhere); a
    permission refusal was reported and asked about, never worked around.

Anything you cannot fix yourself (an unreachable screen, a contradiction, an unclear
expectation, a record left behind) is listed in the final message under the matching heading —
never silently resolved, never softened into a `PASS`.
