# Patch rules — freshness, write-back, test data, potential bugs, render, returns (steps 6, 9, 11)

## 0. Authorization check — before the first write

| Document | Write? |
|---|---|
| `Status: PENDING HUMAN REVIEW` | yes — patch in place |
| `Status: APPROVED`, `--authorize-revision` given or authorized earlier in this run | yes — patch in place; if the patch changed anything, set `Status: PENDING HUMAN REVIEW`, say so, and add the `--republish` note only when `ADO-MAP.md` exists |
| `Status: APPROVED`, no authorization yet, changes expected | ask ONCE (`intake.md` §3 shape) with the concrete list: which TCs change state, which steps get reworded, which PB / Q entries and data statuses would be written. "Yes" → patch. "No" or no answer → **READ-ONLY**: deliver the observation report (`## TEST CASES VALIDATED (read-only)`), write nothing, approval and `ADO-MAP.md` intact |
| `Status: APPROVED`, nothing would change (every walked TC matched, no new PB / data fact) | no write needed; approval untouched; say so |

Re-read the document immediately before patching — it may have changed since intake (a hash of
the text at intake vs now; a difference → re-parse, redo the freshness pass for the affected TCs).

## 1. Freshness pass — earlier evidence is re-checked, never trusted blindly

For every TC that carries a `<!-- tc-evidence -->` stamp, before deciding to skip it:

| Compare | Stale when |
|---|---|
| `content-sha256` vs sha256 of the current Preconditions + Steps + Expected Result | different — the TC was edited (skill 3 `--revision`, a reviewer, a merge) |
| `req-sha256` vs sha256 of the cited acceptance-criterion text read from the REQ / spec **now** | different — the requirement was rewritten while its ID stayed the same |
| `env` vs the environment of this run | different — observed on another environment |
| `build` vs the build the app shows now (when both known) | different — a new build may have changed the behaviour |
| `open-questions` vs the current status of those `Q-*` | a question was answered since, and the answer could change the confirmed steps or expected result |

Any stale reason → `Validation: draft — not app-validated (stale — {content | requirement |
environment | build | open question Q-n})`, the stamp is removed, the TC joins the re-run
candidate set (`scope-gate.md` §5), and its enhancement-log rows stay (history). A question that
does not undermine what was observed leaves the state alone and is simply listed against the TC.
Fresh stamp on every point → the TC may be skipped in RE-VALIDATE mode (unless `--full`).

`checked-in-run` records the last run that looked at the TC, so "not re-checked this run" and
"never checked" stay distinguishable on the page and in the log.

## 1b. Cross-validator check — the other validator's evidence is asked about, never silently dropped

Two validators write the same states: 3b (Playwright MCP) and 3c (playwright-cli). This check
runs **after the freshness pass (§1) and after the scope decision (`scope-gate.md` §2-§3), and
before any automatic exclusion** — the re-run default set (`scope-gate.md` §5) is computed only
after it. An explicit comparison or repeat-validation request (`--full`, "validate again",
"repeat the validation", "compare 3b and 3c") already authorizes re-validation: apply it, say so
in one line, and skip the question.

1. **Per TC, not per header.** For every TC in the user-requested scope read its own
   `<!-- tc-evidence -->` stamp. Author: `tool: cli` → 3c; `tool: mcp` → 3b; no `tool` key → 3b
   (written before 3c existed). The header stamp (`by 3b` / `by 3c`) is corroboration only —
   never the decider. No stamp → nothing to ask about.
2. **Partition** the TCs whose stamp belongs to the *other* validator: **current** (every §1
   freshness point matches) and **stale** (§1 already reset them to `draft — not app-validated
   (stale — {reason})` and re-queued them).
3. **No other-validator evidence in scope → no question; proceed.**
4. Otherwise ONE `AskUserQuestion` in the `open-questions.md` shape, listing every affected
   TC-ID with its stamp date and environment, split into the two groups (stale ones with the
   failed freshness point), and offering: `Skip the {n} current, re-validate the {m} stale
   (Recommended)` · `Re-validate all {n+m} with this skill` · `Re-validate current, skip stale` ·
   `Skip all {n+m}`. Recommend skipping current evidence and re-validating stale evidence. WAIT.
5. **Effects.** Re-validate → the TC joins the walk set; on observation this skill's stamp
   replaces the other's (the old stamp is not kept) and one enhancement-log row records
   `re-validated by {this skill}; previous evidence {other skill} {date}`. Skip **current** →
   state, stamp and `checked-in-run` untouched; the TC keeps counting in App validation progress
   and is listed in the final message and the structured return as `**Kept from {other skill}:**
   {n} — {TC-IDs}`. Skip **stale** → the TC stays `draft — not app-validated (stale — {reason})`,
   its stamp removed, excluded from App validation progress, listed as `**Stale, not
   re-validated:** {TC-IDs}` — **a skipped stale case never counts as currently validated.**
6. Only now apply the re-run defaults (`scope-gate.md` §5) to this skill's own stamps. The
   answer holds for the whole run and is never re-asked.

## 2. `TEST-CASES-{feature}.md` — patch in place (`tc-format-contract.md`)

1. **Per walked TC**: `Validation` (both the section field and the summary cell), the evidence
   stamp (with `tool: mcp` — `tc-format-contract.md`), label corrections and inserted steps in
   `Preconditions` / `Steps` / `Expected Result`; a locale-variant TC gets its captured
   secondary-locale labels. **References stay references**: an `enhanced` step keeps `Open the
   portal [E1]` / `Login as Administrator [A1]` / `[D2]` exactly as written — the URL, the
   username or the dataset you resolved through `TEST-DATA` is never written into the TC as a
   literal, and an inserted step that needs one uses the same token (a new account or service
   the app requires gets a new `TEST-DATA` row and its token, §3). A `[HUMAN]` step is kept
   verbatim; the TC's state is `draft — not app-validated (human step pending)` and its stamp
   carries `outcome-check: human step pending` (`mcp-pass.md` §6). A TC kept from 3c under §1b
   is not touched at all.
2. **Header**: `Implementation status` with its source (`probe {date} · answer · report {path}`),
   `MCP validation` six counts + `— by 3b on {YYYY-MM-DD}, env {name}, scope {full | shared |
   custom}[, re-run {n}]`, `App validation progress: {observed}/{N} TCs observed live ({pct}%)`
   (observed = `validated` + `enhanced` + `discrepancy`, non-stale). Every count equals the
   tables — the renderer checks.
3. **`## Enhancement Log`** — append one row per change (`TC-ID · Validation · What changed · Why
   (what the app showed) · Run {date}`); SHARED scope logs a prefix correction once per flow with
   the TC-IDs it propagated to. Earlier rows are never edited or deleted.
4. **`## Potential Bugs`** — one entry per `discrepancy`, exactly five visible lines:
   ```markdown
   ### PB-{n} — {short, clear title}
   - **Test case:** TC-…
   - **Steps to reproduce:**
     1. …
     2. …
   - **Expected result:** {the requirement-based result — copied from the TC, never rewritten}
   - **Actual result:** {what the application did}
   <!-- pb-meta: first-seen: {date}; last-checked: {date}; env: {name}; build: {version|unknown}; status: open | resolved {date} | not-checked-this-run -->
   ```
   Rules: no technical analysis, no suspected cause, no extra detail. `PB-{n}` is allocated once
   per (TC-ID + observed contradiction) and never reused. Re-observed this run → update the
   entry in place (`last-checked`, `actual result` refreshed) — never a second entry for the
   same bug. **Resolved only after an actual successful retest**: the reproduction steps were
   rerun this run and the requirement's expected result was confirmed → `status: resolved
   {date}`, dropped from the current counts, kept as history. Not retested this run → status
   unchanged, `status: not-checked-this-run` appended, shown as such. Implementation gaps,
   environment blockers and unclear requirements are **not** potential bugs — they stay in their
   Open Findings buckets, which cross-reference PB ids where relevant.
5. **`## Open Questions`** — new `Q-{n}` entries in the `open-questions.md` shape; answered ones
   get `Status: answered {date}` + the answer.
6. **`## Open Findings for the Human Reviewer`** — requirement / coverage gaps the walk revealed
   (for skill 3 `--revision`), application defects (one line per PB: `TC-… — see PB-n`), pending
   implementation, environment blockers (unreachable screens, login failures, VPN), unclear
   requirements (one line per open Q). Add; never remove another skill's items.
7. **Coverage tables** — untouched by validation alone (SKILL.md invariant 6). Recompute only
   when a recorded design gap or an authorized case update changed the design evidence, and
   then say so in the final message.
8. **Legacy document** — add only the header lines and sections your patch needs; say so.

## 3. `TEST-DATA-{feature}.md` — one read-only look per item, plus the advanced facts

For every data item the walk's screens can show (`## 2. Test data at a glance`), plan ONE
read-only look at the listing screen (a targeted text / row lookup, shared across all TCs that
use the item — never create, edit or delete anything to find out):

| Seen | Status |
|---|---|
| the item is there with the values the TCs need | `READY` — `Where I checked: listing screen "{name}" seen live {date}` |
| the screen was reached and the item is absent | `MISSING` — a §5 way is recommended (or a §4 problem row) |
| the screen was not reached / not looked at | `UNKNOWN` — unchanged; never `MISSING` because it was not checked |

**Advanced facts** the app reveals are written into the file (plain English, no code):

| Discovered live | Where it goes |
|---|---|
| exact values, counts or identifiers the item really has | §2 `Must look like` + §3 `Exact values needed` (and the TC's Data Oracle stays — a mismatch is a `Q-{n}` or a PB, never an edit) |
| a state the item must be in that the design did not name | same |
| an additional account / role the screens require | §1 Accounts row with the next free `A{n}` ID (username only), mapped to the TCs; the inserted step references it as `{role} [A{n}]` |
| the base URL or another environment value you asked for at intake (§0 row was `unknown — asked by 3b/3c`) | that row's `Value` + `Status: READY` — the TC keeps `[E{n}]`; a service the walk needed that had no row (a mail sandbox reached for an OTP) gets a new `E{n}` row, never a literal in a step |
| a creation screen / setting that makes an `e2e scenario` or `set directly` way available | §5 row `available — seen live {date}`; never `api` / `db` from observation (those need confirmation, `tc-design.md` rules) |
| an item that cannot be reached or created in this environment | §4 Problems row, status `IMPOSSIBLE` only after the ways were considered |
| a problem row now solved (item exists) | row marked `closed {date}` |

Then recompute the header counts and set `Environment: {env} checked {date}`. Items confirmed
`READY` that the learning file did not know → one `[type: data]` line under `## Test Data`.
`MISSING` / `IMPOSSIBLE` / `UNKNOWN` statuses are NOT written to the learning file — skill 5
records the final outcome.

## 4. Render the page — `html-page.md`

Dry-run first and read the payload: a `MISMATCH` means a count you patched disagrees with the
tables — fix the header, not the page; a `BLOCKED` names the markdown line to fix; a
`data-literal` / `data-ref-unresolved` warning on a line you patched means your patch broke the
reference form — fix the step, never the page. Then `--write`.

**Language.** *"The output language of a run is English unless this run's task input asks for
another language (`--lang ar` or an explicit sentence). Nothing else decides it: not the source
language, not a saved learning-file answer, not the document's `Review page language:` line, not
an existing Arabic sidecar."* So: no `--lang ar` this run → English page, the `Review page
language:` line rewritten to `English`, and — when an Arabic sidecar is on disk — one sentence in
the final message: "an Arabic sidecar exists — pass `--lang ar` to render it". `--lang ar` →
`--lang ar --write-skeleton` (the merge keeps every unchanged translation; only your corrected
strings and new PB / Q entries come back `null` or `stale`) → fill only those `ar` values →
`--lang ar --write`, line rewritten to `Arabic`. `arabicComplete: false` → say "preview — {n}
strings outstanding", never "Arabic page delivered". A hand-edited page is refused by the
renderer — tell the user what would be lost before `--force`.

## 5. Learning file — `learning-file.md`

Base URL per environment (`[type: env]`), common flows walked (name + date), labels and locale
facts, screens confirmed locale-independent, where the build number shows, `READY` data, tricks
(element identifiers explained in words) → shared sections; confirmed answers →
`### Validation Model (skill 3b) → #### Questions and Answers` with `(confirmed by user {date})`.
Never a credential, never an unanswered recommendation.

## 6. Final message

1. What was written, where (`{tc_output_folder}`), and whether the page is complete or an Arabic
   preview; READ-ONLY runs: "nothing written — approval intact" and the offered authorization.
2. Scope: recommended vs chosen, and **exactly which TC-IDs stay unvalidated** (`inferred`,
   `draft`, `not-implemented`) and why.
2b. **Needs a human run:** every TC with a `[HUMAN]` step — walked up to that step, now
   `draft — not app-validated (human step pending)`; name the step and the interface it lacks.
   These are never validated by this skill and never enhanced away.
3. Implementation status established live, with evidence.
4. States before → after (six counts) and App validation progress; the coverage score,
   unchanged (or changed because of a recorded gap / authorized update — say which).
5. Potential bugs: open / resolved this run / not checked this run, each with its PB id and TC.
6. `inferred` cards need the reviewer's extra care; `discrepancy` cards point at their PB.
7. Test data before → after (ready / missing / impossible / unknown) and the advanced facts added.
8. Open questions repeated with the recommended answer and what stays pending.
9. Approved document that changed → now `PENDING HUMAN REVIEW`, re-review needed; `--republish`
   only when `ADO-MAP.md` exists. Unchanged → still approved.
10. Next: approve (or re-approve) → skills 4 (optional) and 5, independently; coverage gaps →
    skill 3 `--revision`; a new build → re-run this skill (stale evidence is re-queued).

## 7. Structured returns

```markdown
## TEST CASES VALIDATED {(read-only)}

**Feature:** {name} · **Document:** {path} · **Status:** {unchanged PENDING | unchanged APPROVED | APPROVED → PENDING HUMAN REVIEW (changed, authorized)}
**Playwright MCP:** attached · **Environment:** {name} ({base URL recorded as [type: env]}) · **Build:** {version | unknown}
**Implementation status:** {Implemented | Partially implemented | Not implemented | Cannot be validated} — {probe · answer · report}
**Scope:** recommended {FULL | SHARED | CUSTOM} because {reason} · chosen {…} ({explicit | asked}) · leaves unvalidated: {TC-IDs | none}
**Needs a human run:** {n} — {TC-IDs (human step pending) | none}
**Freshness:** {n} stale ({reasons}) re-queued · {n} skipped (fresh evidence)
**Cross-validator:** {no 3c evidence in scope | asked → {answer} | answered by the instruction} · **Kept from 3c:** {n} — {TC-IDs | none} · **Stale, not re-validated:** {TC-IDs | none}
**MCP validation:** {v/e/i/d/ni/dr} → {v/e/i/d/ni/dr} · **App validation progress:** {a}/{N} → {b}/{N}
**Requirement coverage:** {x}% — unchanged {| recomputed because {gap / authorized update}}
**Common flows walked:** {list}
**Potential bugs:** {n} open ({PB-ids}) · {n} resolved this run · {n} not checked this run
**Test data:** ready {a}→{b} · missing {a}→{b} · impossible {a}→{b} · unknown {a}→{b} · advanced facts added: {n}
**Open questions:** {N} — {Q-ids with the recommended answer, or "none"}
**Files patched:** TEST-CASES {TC-IDs + header} · TEST-DATA {items} · page re-rendered ({English | Arabic}, gate {PASS | preview}{; Arabic sidecar on disk — pass --lang ar to render it}) · summary {columns | n/a} — or "none (read-only)"
**Learning file:** read {sections/tags} · updated {N added / M updated | "no new knowledge"}
**Open findings for the reviewer:** {gaps / defects / pending / blockers / unclear, or "None"}
**Next step:** {from §6}
```

```markdown
## VALIDATION AUDIT (no files written)

**Document:** {path} — Status {…} · {stamped by 3b on {date} | never validated} · shape {new | legacy}
**Playwright MCP:** {attached | absent → BLOCKED}
**Set:** {T} TCs · {N} executable · {F} common flows · risk: {signals}
**Recommended scope:** {mode} — {reason}; leaves unvalidated: {TC-IDs}
**Would write:** {files and what in them} · **Authorization needed:** {yes (approved) | no}
**Learning file:** not touched (audit)
```

## 8. Quality checklist — before returning TEST CASES VALIDATED

- [ ] Playwright MCP probed BEFORE any ask; absent → BLOCKED, no credentials asked
- [ ] ONE combined ask (URL only if not recorded, credentials per role, implementation status only if unknown, env notes, authorization only if approved and needed); every question in the `open-questions.md` shape; no unanswered recommendation acted on
- [ ] Document located and classified (pending / approved / re-validate / legacy / invalid); `tc_output_folder` stated once and unchanged
- [ ] Approved document: read-only unless authorized; `Status` flipped only when something actually changed; `--republish` mentioned only when `ADO-MAP.md` exists
- [ ] Implementation status established live (probe + answer + report) and recorded with evidence; not-implemented TCs never marked validated, enhanced or as defects
- [ ] Freshness pass run on every stamped TC before skipping it; stale TCs reset with the reason and re-queued; history kept
- [ ] Cross-validator check run on every in-scope TC's own stamp before any automatic exclusion; question asked only when 3c evidence exists in scope, showing current vs stale; skipped current TCs untouched and listed; skipped stale TCs left `draft (stale)` and never counted as validated; not asked when an explicit compare / repeat instruction answered it
- [ ] Scope: explicit instruction respected without asking; otherwise asked once with recommendation + reason + what stays unvalidated; the chosen scope stated in the return
- [ ] Discovery plan built before any navigation; common flows validated once; per-TC replay limited to unique tails in scope; snapshots once per new screen
- [ ] No TC marked `validated` whose unique tail was not observed; SHARED-scope TCs `inferred` at best; every observed TC has a fresh evidence stamp with build `unknown` when not shown
- [ ] Secondary-locale labels for every in-scope element captured live — none guessed; "(Arabic label: to be captured live)" notes replaced
- [ ] Every correction in the enhancement log (appended, dated); design fields (incl. `Tags`) diffed before/after and identical; TC set unchanged
- [ ] Every `[E{n}]` / `[A{n}]` / `[D{n}]` token resolved through its own `TEST-DATA` row (no role → account or "E1 = the URL" shortcut); no URL, username or dataset identifier written into a TC as a literal; `enhanced` and inserted steps keep the reference form; asked-for environment values and usernames filled in their rows
- [ ] Every TC with a `[HUMAN]` step walked up to that step and stopped — `draft — not app-validated (human step pending)`, `outcome-check: human step pending`, marker untouched, listed under "Needs a human run"; never validated, never enhanced away
- [ ] Page language English unless this run passed `--lang ar` / said so; `Review page language:` line rewritten to what was rendered; an Arabic sidecar on disk mentioned once, never used without the flag
- [ ] Every discrepancy has a PB entry: five lines, stable id, requirement-based expected result copied not rewritten, meta with status; resolved only after a successful retest; not retested → "not checked in this run"
- [ ] Gaps / defects / pending / blockers / unclear in five separate buckets; coverage gaps handed to skill 3, never fixed here
- [ ] Coverage score, traceability, manual-only tables untouched (or recomputed only for a recorded gap / authorized update, stated)
- [ ] Test data: one read-only look per reachable item; statuses from evidence only (`MISSING` only when checked and absent); advanced facts written; counts and `Environment` line updated; `READY` items to the learning file
- [ ] Page re-rendered by the script with `gate: PASS` (or MISMATCH fixed then PASS); Arabic complete or delivered explicitly as a preview with the outstanding keys; no hand edit
- [ ] `node scripts/selftest.mjs` passes in this skill folder after any renderer / template change (mirror case 0 passes or `skipped`)
- [ ] Learning file: base URL as `[type: env]`, flows / labels / locale / data / tricks in the shared sections, confirmed answers under Validation Model Q&A; no credentials, no code identifiers, no unanswered recommendation
- [ ] Final message names the unvalidated TC-IDs, the PB ids, the open questions, the status outcome and the next step (approve → 5 optional and 6 independently)
