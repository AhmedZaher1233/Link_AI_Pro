# Intake — locate the document, classify it, probe, ask once (workflow steps 1 and 3)

## 1. Locate the document(s)

Resolution order — first hit wins, several hits → ask (`open-questions.md` shape, the newest
document as the recommendation):

1. **Explicit path** to a `TEST-CASES-{feature}.md` → that document; `{tc_output_folder}` is its
   folder; `{feature}` is the file-name stem after `TEST-CASES-`.
2. **Feature name or User Story ID** → glob `{paths.manualTestCases}/**/US-{id}-*/TEST-CASES-*.md`
   (manifest path first, `Testing/Manual_Test/TestCases` as the fallback).
3. **A `SPEC-{spec-name}/` folder** → every `US-*/TEST-CASES-*.md` under it: a multi-story run (§4).

No document → BLOCKED: "run `link-qc-3-generate-manual-test-cases` first — this skill validates an
existing document and designs nothing". The resolved `{tc_output_folder}` is stated in the chat
and is immutable for the run (SKILL.md 9b). A same-story folder at another level (flat `US-*`
while a `SPEC-*/US-*` twin exists) is reported and never written to.

Companion files in the same folder, read when present: `TEST-DATA-{feature}.md` (the test-data
inventory you patch — missing → validate the TCs, put data findings under Open Findings, tell the
user to re-run skill 3; never author the file — its `## 0. Environment` / `## 1. Accounts` /
`## 2.` rows are what every `[E{n}]` / `[A{n}]` / `[D{n}]` token in the TCs resolves to),
`TC-REVIEW-STRINGS-{feature}.ar.json` (Arabic sidecar — used by the renderer only under
`--lang ar`; its presence decides nothing), `ADO-MAP.md` (only to know whether a publication
exists).

## 2. Document state — decides the run mode before anything else

Read the header block (`html-page.md` §3) and the frozen anchors, then classify:

| Header / shape | State | What you do |
|---|---|---|
| `Status: PENDING HUMAN REVIEW` | pending | proceed; patch in place |
| `Status: APPROVED` | approved | **READ-ONLY by default** (SKILL.md invariant 5): validate and report what would change. Patching needs the revision authorization — `--authorize-revision`, or a "yes" to the single ask in §3 (which lists the concrete changes you expect: states, wording, PB entries, data statuses). After an authorized patch that changed something → `Status: PENDING HUMAN REVIEW`; nothing changed → untouched. `ADO-MAP.md` present → the final message says skill 4 `--republish`; absent → no republish talk |
| any in-scope TC stamp carries `tool: cli` (written by skill 3c) | validated by the other validator | after the freshness pass and the scope decision, the cross-validator check (`patch-rules.md` §1b) asks once — current vs stale — unless an explicit compare / repeat instruction already answered it; the header line (`by 3c on …`) is corroboration only |
| `MCP validation:` line carries `by 3b on {date}` | already validated | **RE-VALIDATE** mode: freshness pass first (`patch-rules.md` §1); default scope = stale + `draft` + `inferred` + `discrepancy` (retest) + `not-implemented` (re-gate); `--full` re-walks everything; stamp gets `re-run {n}` |
| No `Scope` / `Generated` / `Stage` / frozen anchors (renderer `compatibility[]` lists them) | legacy shape | proceed — it renders and it is patchable. Do NOT rewrite it into the new shape on your own; when you patch it anyway (authorized, or pending) add only the lines and sections your patch needs (`App validation progress`, `## Enhancement Log`, `## Potential Bugs`, `## Open Questions`, evidence stamps) and say so |
| Frozen fields missing inside a TC (`Type`, `Steps`, `Expected Result`), or not a skill-3 document at all | invalid | BLOCKED — "not a skill-3 TC document"; never repair it |
| `Implementation status:` says `not yet checked live` | status unknown | the combined ask includes the implementation question; §1 of `mcp-pass.md` establishes it live either way |

Also note: the `Review page language:` line — a **record** of what the last run rendered, never
this run's decision (the page is English unless this run passes `--lang ar` or says so; you
rewrite the line to what you render), the existing `PB-*` and `Q-*` ids (reused, never
reallocated), the TCs carrying a `[HUMAN]` step (walked up to it, never past it), and the current
per-TC `Validation` values with their evidence stamps.

## 3. Playwright probe, then the ONE combined ask

**Probe first.** Check that a Playwright MCP server is attached to the session (one harmless
call). Absent → BLOCKED immediately: "no Playwright MCP server attached — attach it (`/mcp`) or
run `/link-qc-1-generate-update-testing-structure repair`, then re-run this skill". Never ask for
credentials that cannot be used. (`--audit` stops here with its report.)

Then ONE message — never a second one for any of these — after searching the learning file and
both skills' Q&A (`open-questions.md` §1) and stating what you reuse:

| Item | Ask when | Never |
|---|---|---|
| Application base URL — the `[E1]` row of `TEST-DATA` §0 | not recorded as `[type: env]` for the target environment (the row says `unknown — asked by 3b/3c`), or the user names another environment; the answer fills that row's `Value` / `Status`. Any other `[E{n}]` row still `unknown` (mail sandbox, SMS test provider…) is asked in the same message — each is its own service, never "the URL" | auto-detected; written into a TC as a literal |
| Password per account the TCs reference (`[A{n}]` — role and username from `TEST-DATA` §1; a username still `unknown` there is asked too and filled in that row) | always (passwords are asked fresh every run) | written anywhere; a username never enters a step — the TC keeps `Login as {role} [A{n}]` |
| Implementation status (implemented / partially / not implemented / not sure) | the header says `not yet checked live` and no skill-4 report answers it | trusted over the live probe — both are recorded |
| Environment notes | always, one line: VPN / tenant / where the build number shows / anything that blocks screens | — |
| Revision authorization (approved document, changes expected) | `Status: APPROVED` and no `--authorize-revision`; list the concrete changes you expect | re-asked in the same run |
| Scope | never here — it has its own step and its own shape (`scope-gate.md` §2-§3), and only when no explicit instruction was given | — |

Record every answer except credentials before navigating: base URL → the `[E1]` row of
`TEST-DATA` §0 and the learning file `[type: env]` (project-wide); other environment rows and
usernames → their `TEST-DATA` rows; implementation status → header + return; environment notes → header stamp
(`env {name}`) and learning file when project-wide; the authorization → the run only.

## 4. Multi-story input — a SPEC folder or several IDs

1. List the stories you found and state the split before anything else.
2. One probe, one combined ask for all stories (credentials per role once).
3. Set analysis and scope question **per story** — counts and recommendations differ — in one
   message with a per-story table when the user gave no `--scope`.
4. Shared common flows (login, navigation to a shared module) are walked ONCE and reused across
   stories; record them in the learning file once.
5. Write back per story (`patch-rules.md`). When `TC-GENERATION-SUMMARY.md` exists in the spec
   folder, patch only its per-story `implementation status` and `open findings count` columns —
   never its shape.
6. One story blocked (app screen unreachable, authorization refused) does not stop the others:
   finish every story you can and list the blocked ones with the reason.
