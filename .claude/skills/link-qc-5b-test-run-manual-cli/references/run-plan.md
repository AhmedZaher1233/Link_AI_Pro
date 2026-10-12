# Run plan — analyse the whole set, state the plan, run ALL of it in stages (steps 4, 5, 7)

This skill has **no scope gate and no sampling**. Every TC of the approved document is executed
in full and separately, one after another, in stage order — smoke, then positive, then negative —
with one row, one image and one status each. Nothing is skipped because a common flow was already
seen in another TC, because 3b / 3c validated it, or because an earlier phase passed it. The only
TCs a phase leaves unexecuted are the ones the application or the data keep out of reach
(`execution-rules.md` §3), each with its reason, each listed.

## 1. Set analysis — no browser yet

Read every TC and build the plan:

1. **Stage per TC** — the `Stage` field (`smoke` / `positive` / `negative`). Legacy document
   without it: `Smoke: YES` → smoke; otherwise `Type: positive` → positive, `Type: negative` →
   negative (a `Type` outside these two → positive, said once in the plan line). A smoke TC
   belongs to the smoke stage only — it is never run again in its polarity stage.
2. **Smoke set** `s` — `Smoke: YES`. The 30 % gate (§4) is computed over this set alone.
3. **AI set** `a` — every TC that carries an `AI Oracle` field (the assistant's reply is judged
   from its text: hard checks first, then the rubric — rules and thresholds live in
   `ai-response-rules.md`, which this skill only references). Its `Repeats: n · Pass threshold:
   k of n` line decides the variants (§5); absent → `1 · 1 of 1`.
4. **Human-step set** `h` — every TC with a step or expected-result line starting `[HUMAN]`: it is
   executed up to that step and ends `PARTIAL — human step pending` (`execution-rules.md` §3).
5. **Data-changing set** `d` — `Data effect` is `creates`, `modifies` or `deletes`. Executed only
   under the run's "yes" (`execution-rules.md` §5); otherwise each is `SKIP` with the reason.
6. **Not-implemented set** — the TCs the implementation gate (`execution-rules.md` §1) puts
   behind an absent part: `SKIP — pending implementation`, never a defect.
7. **Executable set** `N` — every TC minus the not-implemented set. `T` is the document's total.
   A data-changing TC without authorization and a TC whose data is `MISSING` stay in `N` (they
   are executed as far as "SKIP with reason" — a row each, counted).
8. **Order inside a stage** — document order. No parallel groups, no reordering for shared data:
   a manual run is strictly serial, one TC at a time, so the `### Run plan` sub-section (optional)
   is one row `all · serial · 1 · {N} · manual run (playwright-cli)` with `**Decisions:** 0 field ·
   0 inferred · 0 fail-safe`.
9. **Secondary-locale TCs** (`TC-01b`) are TCs like any other: their own row, their own image,
   executed fully in the secondary locale (switched through the app's own control), never
   inferred from the primary-locale twin.
10. **Test-data look** (`execution-rules.md` §4) — one read-only look per `D{n}` item the TCs
    reference, planned before the first stage that needs the item; `MISSING` → the dependents of
    that item are `SKIP — data_missing` before their turn.

## 2. The plan line — stated once, before the first browser command

After the implementation gate and the test-data look for the smoke stage:

```
Running all {N} executable TCs (of {T}; {s} smoke · {p} positive · {n} negative · {a} AI · {h} stop at [HUMAN] · {d} data-changing {authorized | not authorized}) · phase {N} · tool cli
```

`p` and `n` count the non-smoke positive and negative TCs. No WAIT here — nothing to answer.
`--audit` stops after this line (`browser-cli.md` §1.5). Flags that narrow a run (`--scope`,
`--only`, a TC-ID list in the sentence) are refused in one line — "this skill executes every TC
of the approved document" — and the full run follows.

## 3. Progress — one line per TC completion, and the log file

**Chat**: skill 5's shape plus the tool, printed after every TC, no prose between refreshes:

```
Smoke 4/9 · TC-ORD-05 running · 03:10 elapsed · ETA 04:00 · 0 failed · tool cli
Positive 2/14 · TC-ORD-12 running · 11:42 elapsed · ETA 09:30 · 1 failed · tool cli
```

`{Stage} {done}/{stage total}` · the TC now starting · elapsed since the plan line · ETA from the
average duration of the TCs completed so far in this stage (`—` before the first) · failed so far
in the whole phase · `tool cli`. The smoke-gate verdict, a stage transition and a SKIP batch each
get one extra line.

**Progress log** — `{logs_root}/run-progress-{YYYY-MM-DD-HHmm}.log`, created at the plan line
(the first file the run writes; its path is told to the user at once so they can tail it), one
NEW file per run, never appended to a previous run's file. Its first lines record `results_root`,
`screenshots_root`, `logs_root`, phase `N`, the plan line and the start time; then one timestamped
line per TC start, per TC result (`TC-ID · status · classification · duration`), per stage
transition, the smoke-gate verdict, every second attempt and every session re-open; the last line
is the outcome. Plain English, no command text, no secret.

## 4. Smoke gate — after the smoke stage, before anything else runs

`fail% = failed smoke TCs / total smoke TCs` (SKIP, PARTIAL and NOT_RUN rows are neither). One
rounding, to a whole percent, shown as `{x}%`.

| fail% | What happens | `**Smoke gate:**` line in `### Stages` |
|---|---|---|
| **≤ 30 %** | continue with the positive stage; the failures keep their classification and their bug entries | `passed — fail% {x}% — continued` |
| **> 30 %** | classify EVERY smoke failure first (`execution-rules.md` §3). **`app_bug` majority** (strictly more `app_bug` than all other classifications together) → **STOP**: no positive or negative stage; every non-smoke TC gets a `NOT_RUN` row with reason `smoke gate failed (application errors)`; `**Outcome:** SMOKE GATE FAILED`; `{run_file}.status: stopped-smoke-gate`; every smoke `app_bug` is filed as a bug (§7 of `execution-rules.md`); the gate result opens the final message | `FAILED-STOPPED — fail% {x}% — application-error majority ({n} app_bug of {m}); positive and negative stages not run` |
| **> 30 %**, other majority | continue — there is **no self-heal and no smoke re-run in a manual run**; the failures stay as classified (an `environment_failure` earned its one second attempt already, `execution-rules.md` §3) | `passed — fail% {x}% — continued: {n} environment_failure · {n} assertion_failure (no self-heal in a manual run)` — list every classification present, in that style |

Hard rules: the renderer accepts only `passed` or `FAILED-STOPPED` as the first word of the
smoke-gate line — `healed-then-passed` is **never written** by this skill (nothing heals).
`{m}` is the number of failed smoke TCs; a tie is not a majority. A document with no smoke TC
→ `passed — no smoke TCs — continued`. The verdict and the counts also go into
`{run_file}.smoke_gate` (`fail_pct`, `verdict`, `action_taken`, `cycles: 0`).

## 5. AI repeats — one variant per repeat, one attempt each

An AI TC with `Repeats: n · Pass threshold: k of n` is executed `n` times back-to-back, in the
same session, each repeat a complete execution of the TC (reset the conversation the way the
application offers — a new chat / reset control the learning file names — before every repeat;
never reuse the previous reply). Each repeat is the variant `manual-cli--none--r{k}` (`k` from 0
to n−1) with exactly one attempt: its own `attempt-1.png`, its own `reply.md`, its own verdict
(`execution-rules.md` §3). The TC's row is one row: `PASS` when at least `k` repeats passed,
otherwise `FAIL` with the classification of the majority of the failed repeats (`ai_rubric_failure`
or `assertion_failure`); `Evidence` links every repeat's image; `{run_file}.results[].variants[]`
holds one entry per repeat; `variant_totals` counts them. A repeat that hits the reply ceiling is
`timeout_failure` for that repeat and counts as not passed. A TC without the line is `1 · 1 of 1`
— variant `manual-cli--none--r0`.

## 6. Re-runs — the next phase

Every invocation is a new phase `N` (`intake.md` §1) and executes every TC again — there is no
"only the failed ones" mode. `- **Previous phase:** {N−1} ({nested | legacy})` in `### Run` names
the phase it follows (`—` for the first). A bug whose TC runs this phase is retested by that run:
the TC passes → `resolved (phase {N})` with a History line; it fails again → stays `open`, History
appended; its TC did not run (SKIP / NOT_RUN / blocked) → `not-checked-this-run`
(`execution-rules.md` §7). Earlier phase sections, run-history rows, images and run files are
never edited; the header block and the new rows are the only things that change.
