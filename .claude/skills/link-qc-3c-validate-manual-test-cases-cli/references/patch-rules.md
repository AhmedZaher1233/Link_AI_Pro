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

This skill skips nothing (`discovery-plan.md`): every TC is walked and re-stamped this run. The
freshness pass still runs on every TC that carries a `<!-- tc-evidence -->` stamp, so the run can
report which earlier states were stale and why, and so a TC the application keeps out of reach
this run (`walk-rules.md` §7) does not keep an outdated state:

| Compare | Stale when |
|---|---|
| `content-sha256` vs sha256 of the current Preconditions + Steps + Expected Result | different — the TC was edited (skill 3 `--revision`, a reviewer, a merge) |
| `req-sha256` vs sha256 of the cited acceptance-criterion text read from the REQ / spec **now** | different — the requirement was rewritten while its ID stayed the same |
| `env` vs the environment of this run | different — observed on another environment |
| `build` vs the build the app shows now (when both known) | different — a new build may have changed the behaviour |
| `open-questions` vs the current status of those `Q-*` | a question was answered since, and the answer could change the confirmed steps or expected result |

Any stale reason → `Validation: draft — not app-validated (stale — {content | requirement |
environment | build | open question Q-n})`, the stamp is removed, the reason is counted in the
`**Freshness:**` return line, and its enhancement-log rows stay (history). A question that does
not undermine what was observed leaves the state alone and is simply listed against the TC.
Fresh stamp on every point → reported as fresh; the TC is walked anyway and its stamp replaced
by this run's observation.

`checked-in-run` records the last run that looked at the TC, so "not re-checked this run" and
"never checked" stay distinguishable on the page and in the log.

## 1b. Cross-validator handling — 3b's evidence is re-validated, never asked about, never dropped

Two validators write the same states: 3b (Playwright MCP) and 3c (playwright-cli). Skill 3b asks
the user whether to keep or re-validate evidence written by 3c; this skill does not ask — it has
no scope gate and walks every TC, so the answer is always "re-validate all". This step runs after
the freshness pass (§1) and before the first browser command:

1. **Per TC, not per header.** For every TC read its own `<!-- tc-evidence -->` stamp. Author:
   `tool: cli` → 3c; `tool: mcp` → 3b; no `tool` key → 3b (written before 3c existed). The
   header stamp (`by 3b` / `by 3c`) is corroboration only — never the decider.
2. **Note** the TCs whose stamp belongs to 3b, split into **current** (every §1 freshness point
   matched) and **stale** (§1 already reset them to `draft — not app-validated (stale —
   {reason})`). Say it in one line: `{n} TCs carry 3b evidence ({c} current, {s} stale) — all
   re-validated this run`.
3. **Effects.** Every such TC is walked like the rest; on observation this skill's stamp replaces
   3b's (the old stamp is not kept) and one enhancement-log row records `re-validated by 3c;
   previous evidence 3b {date}`. A 3b-stamped TC the application keeps out of reach this run
   (`walk-rules.md` §7) ends `draft — not app-validated ({reason})` with the 3b stamp removed —
   **a case not observed this run never counts as currently validated**, whoever observed it
   before. The structured return lists the TC-IDs under `**3b evidence at intake:**`.
4. Nothing is kept from 3b, nothing is skipped, no question is asked and none is expected in the
   task — an explicit "compare 3b and 3c" or "validate again" changes nothing here.

## 2. `TEST-CASES-{feature}.md` — patch in place (`tc-format-contract.md`)

1. **Per walked TC**: `Validation` (both the section field and the summary cell), the evidence
   stamp (with `tool: cli` and the `outcome-check` line — `tc-format-contract.md`,
   `walk-rules.md` §6a), label corrections and inserted steps in `Preconditions` / `Steps` /
   `Expected Result`; a locale-variant TC gets its captured secondary-locale labels.
   **References stay references**: an `enhanced` step keeps `Open the portal [E1]` / `Login as
   Administrator [A1]` / `[D2]` exactly as written — the URL, the username or the dataset you
   resolved through `TEST-DATA` is never written into the TC as a literal, and an inserted step
   that needs one uses the same token (a new account or service the app requires gets a new
   `TEST-DATA` row and its token, §3). A `[HUMAN]` step is kept verbatim; the TC's state is
   `draft — not app-validated (human step pending)` and its stamp carries `outcome-check: human
   step pending` (`walk-rules.md` §6a).
2. **Header**: `Implementation status` with its source (`probe {date} · answer · report {path}`),
   `MCP validation` six counts + `— by 3c on {YYYY-MM-DD}, env {name}, scope full[, re-run {n}],
   tool cli`, `App validation progress: {observed}/{N} TCs observed live ({pct}%)`
   (observed = `validated` + `enhanced` + `discrepancy`, non-stale). Every count equals the
   tables — the renderer checks.
3. **`## Enhancement Log`** — append one row per change (`TC-ID · Validation · What changed · Why
   (what the app showed) · Run {date}`); a common-flow correction is logged once per flow with
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
   <!-- pb-meta: first-seen: {date}; last-checked: {date}; env: {name}; build: {version|unknown}; status: open | resolved {date} | not-checked-this-run; screenshot: evidence/PB-{n}-{date}.png -->
   ```
   Rules: no technical analysis, no suspected cause, no extra detail. `PB-{n}` is allocated once
   per (TC-ID + observed contradiction) and never reused. Re-observed this run → update the
   entry in place (`last-checked`, `actual result` refreshed, a fresh screenshot under a new
   date — `browser-cli.md` §7) — never a second entry for the same bug. **Resolved only after an actual successful retest**: the reproduction steps were
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
(element identifiers explained in words) → shared sections; the login method used on this
environment (attended / secrets file — a name, never a value) and confirmed answers →
`### CLI Validation Model (skill 3c) → #### Questions and Answers` with `(confirmed by user {date})`.
Never a credential, never a secret name paired with a value, never an unanswered recommendation.

## 6. Final message

1. What was written, where (`{tc_output_folder}`), and whether the page is complete or an Arabic
   preview; READ-ONLY runs: "nothing written — approval intact" and the offered authorization.
2. The walk: all `N` executable TCs walked (no scope gate), and **exactly which TC-IDs still
   ended unobserved** (`inferred`, `draft`, `not-implemented`) and the reason the application
   gave for each.
2b. **Needs a human run:** every TC with a `[HUMAN]` step — walked up to that step, now
   `draft — not app-validated (human step pending)`; name the step and the interface it lacks.
   These are never validated by this skill and never enhanced away.
3. Implementation status established live, with evidence.
4. States before → after (six counts) and App validation progress; the coverage score,
   unchanged (or changed because of a recorded gap / authorized update — say which).
5. Potential bugs: open / resolved this run / not checked this run, each with its PB id and TC.
6. `inferred` cards need the reviewer's extra care; `discrepancy` cards point at their PB.
7. Test data before → after (ready / missing / impossible / unknown) and the advanced facts added.
7b. Data changes: made / cleaned up / left behind (with the record identities), or "none — not
    authorized" / "none — no data-changing TC in scope".
7c. Housekeeping: "sessions closed" (`browser-cli.md` §2) and "snapshot files removed" (§8), and the
    gitignore warning when `.playwright-cli/` is not ignored.
8. Open questions repeated with the recommended answer and what stays pending.
9. Approved document that changed → now `PENDING HUMAN REVIEW`, re-review needed; `--republish`
   only when `ADO-MAP.md` exists. Unchanged → still approved.
10. Next: approve (or re-approve) → skills 4 (optional) and 5, independently; coverage gaps →
    skill 3 `--revision`; a new build → re-run this skill (stale evidence is re-queued).

## 7. Structured returns

```markdown
## TEST CASES VALIDATED {(read-only)}

**Feature:** {name} · **Document:** {path} · **Status:** {unchanged PENDING | unchanged APPROVED | APPROVED → PENDING HUMAN REVIEW (changed, authorized)}
**Browser tool:** playwright-cli {version} ({global | project-local}) · sessions closed · snapshot files removed · **Environment:** {name} ({base URL recorded as [type: env]}) · **Build:** {version | unknown} · **Login:** {attended | secrets file} per role
**Implementation status:** {Implemented | Partially implemented | Not implemented | Cannot be validated} — {probe · answer · report}
**Walk:** all {N} executable TCs (no scope gate) · {F} common flows once · not observed: {TC-IDs with reason | none}
**Needs a human run:** {n} — {TC-IDs (human step pending) | none}
**Freshness:** {n} stale at intake ({reasons}) · {n} fresh at intake · all re-stamped this run
**3b evidence at intake:** {none | {n} — {TC-IDs} ({c} current, {s} stale) — all re-validated, stamps replaced}
**Data changes:** {authorized | not authorized} · {n} made · {n} cleaned up · {n} left ({record identities | none})
**MCP validation:** {v/e/i/d/ni/dr} → {v/e/i/d/ni/dr} · **App validation progress:** {a}/{N} → {b}/{N}
**Requirement coverage:** {x}% — unchanged {| recomputed because {gap / authorized update}}
**Common flows walked:** {list}
**Potential bugs:** {n} open ({PB-ids}) · {n} resolved this run · {n} not checked this run · screenshots under evidence/
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
**playwright-cli:** {version (global | project-local) | absent → BLOCKED}
**Set:** {T} TCs · {N} executable · {F} common flows · risk: {signals}
**Plan:** all {N} executable TCs would be walked (no scope gate) · {n} not-implemented · {d} data-changing (walked only with the run's "yes")
**Would write:** {files and what in them} · **Authorization needed:** {yes (approved) | no}
**Learning file:** not touched (audit)
```

## 8. Quality checklist — before returning TEST CASES VALIDATED

- [ ] playwright-cli probed BEFORE any ask; absent → BLOCKED with the `/sync-skills --tools` hint, nothing installed, no fallback to MCP
- [ ] ONE combined ask (URL only if not recorded, username + login method per role, implementation status only if unknown, env notes, data-changes permission, authorization only if approved and needed); every question in the `open-questions.md` shape; no unanswered recommendation acted on
- [ ] No password in chat, on any command line, or in any file; secrets typed by NAME only, attended login otherwise; the substitution probe ran before relying on the secrets file
- [ ] Document located and classified (pending / approved / re-validate / legacy / invalid); `tc_output_folder` stated once and unchanged
- [ ] Approved document: read-only unless authorized; `Status` flipped only when something actually changed; `--republish` mentioned only when `ADO-MAP.md` exists
- [ ] Implementation status established live (probe + answer + report) and recorded with evidence; not-implemented TCs never marked validated, enhanced or as defects
- [ ] Freshness pass run on every stamped TC; stale TCs reset with the reason and reported; nothing skipped on the strength of fresh evidence; history kept
- [ ] 3b evidence noted per TC (current vs stale at intake), every such TC re-validated and its stamp replaced on observation, listed in the return; no question asked, nothing kept from 3b, nothing silently dropped
- [ ] No scope question, no recommendation, no narrowing: all `N` executable TCs walked; a narrowing flag or sentence answered with the one-line "this skill always walks every TC"; the plan line stated before the first browser command
- [ ] Discovery plan built before any navigation; common flows validated once; per-TC replay covers every unique tail; snapshots once per new screen
- [ ] No TC marked `validated` whose unique tail was not observed this run; every observed TC has a fresh evidence stamp (`tool: cli`, `scope: full-tail`) with build `unknown` when not shown
- [ ] Outcome rule: every `validated` / `enhanced` TC has an `outcome-check` line naming what was looked at and what it showed; a command that merely succeeded never counted as an observation
- [ ] Data changes: mutating TCs run only on "yes" (never on production), records identified before the change, reverted through the UI where a way exists, made / cleaned up / left listed; "no" → those TCs `draft (data changes not authorized)`
- [ ] Every discrepancy has its screenshot under `evidence/` and the `pb-meta` `screenshot:` key; no screenshot for a matching TC
- [ ] Every session this run opened is closed (`list` confirms) and the run's `.playwright-cli/` files are deleted, before the final message and before any BLOCKED
- [ ] Secondary-locale labels for every in-scope element captured live — none guessed; "(Arabic label: to be captured live)" notes replaced
- [ ] Every correction in the enhancement log (appended, dated); design fields (incl. `Tags`) diffed before/after and identical; TC set unchanged
- [ ] Every `[E{n}]` / `[A{n}]` / `[D{n}]` token resolved through its own `TEST-DATA` row (no role → account or "E1 = the URL" shortcut; secret names `A{n}_USER` / `A{n}_PASSWORD` follow the account ID); no URL, username or dataset identifier written into a TC as a literal; `enhanced` and inserted steps keep the reference form; asked-for environment values and usernames filled in their rows
- [ ] Every TC with a `[HUMAN]` step walked up to that step and stopped — `draft — not app-validated (human step pending)`, `outcome-check: human step pending`, marker untouched, listed under "Needs a human run"; never validated, never enhanced away
- [ ] Page language English unless this run passed `--lang ar` / said so; `Review page language:` line rewritten to what was rendered; an Arabic sidecar on disk mentioned once, never used without the flag
- [ ] Every discrepancy has a PB entry: five lines, stable id, requirement-based expected result copied not rewritten, meta with status; resolved only after a successful retest; not retested → "not checked in this run"
- [ ] Gaps / defects / pending / blockers / unclear in five separate buckets; coverage gaps handed to skill 3, never fixed here
- [ ] Coverage score, traceability, manual-only tables untouched (or recomputed only for a recorded gap / authorized update, stated)
- [ ] Test data: one read-only look per reachable item; statuses from evidence only (`MISSING` only when checked and absent); advanced facts written; counts and `Environment` line updated; `READY` items to the learning file
- [ ] Page re-rendered by the script with `gate: PASS` (or MISMATCH fixed then PASS); Arabic complete or delivered explicitly as a preview with the outstanding keys; no hand edit
- [ ] `node scripts/selftest.mjs` passes in this skill folder after any renderer / template change (mirror case 0 passes or `skipped`)
- [ ] Learning file: base URL as `[type: env]`, flows / labels / locale / data / tricks in the shared sections, confirmed answers under Validation Model Q&A; no credentials, no code identifiers, no unanswered recommendation
- [ ] Final message names the TC-IDs that ended unobserved with the application's reason, the PB ids, the open questions, the status outcome and the next step (approve → 5 optional and 6 independently)
