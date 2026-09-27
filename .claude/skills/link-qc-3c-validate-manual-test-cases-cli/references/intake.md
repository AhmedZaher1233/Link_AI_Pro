# Intake — locate the document, classify it, probe playwright-cli, ask once (workflow steps 1 and 3)

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
`--lang ar`; its presence decides nothing), `evidence/` (earlier PB screenshots — never
deleted), `ADO-MAP.md` (only to know whether a publication exists).

## 2. Document state — decides the run mode before anything else

Read the header block (`html-page.md` §3) and the frozen anchors, then classify:

| Header / shape | State | What you do |
|---|---|---|
| `Status: PENDING HUMAN REVIEW` | pending | proceed; patch in place |
| `Status: APPROVED` | approved | **READ-ONLY by default** (SKILL.md invariant 5): validate and report what would change. Patching needs the revision authorization — `--authorize-revision`, or a "yes" to the single ask in §3 (which lists the concrete changes you expect: states, wording, PB entries, data statuses). After an authorized patch that changed something → `Status: PENDING HUMAN REVIEW`; nothing changed → untouched. `ADO-MAP.md` present → the final message says skill 4 `--republish`; absent → no republish talk |
| any TC stamp carries `tool: mcp` or no `tool` key (written by skill 3b) | validated by the other validator | no question: after the freshness pass, note current vs stale (`patch-rules.md` §1b), re-validate every such TC this run and replace its stamp on observation; the header line (`by 3b on …`) is corroboration only |
| `MCP validation:` line carries `by 3c on {date}` | already validated by this skill | **RE-VALIDATE** mode: freshness pass first (`patch-rules.md` §1) for the report; the walk set is still every TC (no re-run skip set — `discovery-plan.md` §5); stamp gets `re-run {n}` |
| No `Scope` / `Generated` / `Stage` / frozen anchors (renderer `compatibility[]` lists them) | legacy shape | proceed — it renders and it is patchable. Do NOT rewrite it into the new shape on your own; when you patch it anyway (authorized, or pending) add only the lines and sections your patch needs (`App validation progress`, `## Enhancement Log`, `## Potential Bugs`, `## Open Questions`, evidence stamps) and say so |
| Frozen fields missing inside a TC (`Type`, `Steps`, `Expected Result`), or not a skill-3 document at all | invalid | BLOCKED — "not a skill-3 TC document"; never repair it |
| `Implementation status:` says `not yet checked live` | status unknown | the combined ask includes the implementation question; §1 of `walk-rules.md` establishes it live either way |

Also note: the `Review page language:` line — a **record** of what the last run rendered, never
this run's decision (the page is English unless this run passes `--lang ar` or says so; you
rewrite the line to what you render), the existing `PB-*` and `Q-*` ids (reused, never
reallocated), the TCs carrying a `[HUMAN]` step (walked up to it, never past it), and the current
per-TC `Validation` values with their evidence stamps.

## 3. playwright-cli probe, then the ONE combined ask

**Probe first** (`browser-cli.md` §1): `playwright-cli --version`, else
`npx --no-install playwright-cli --version`. Neither → BLOCKED immediately: "playwright-cli is
not installed — run `/sync-skills --tools` (installs playwright-cli and its browser) or
`/link-qc-1-generate-update-testing-structure repair`, then re-run this skill". Never ask for anything
that cannot be used; never install; never fall back to the Playwright MCP server. (`--audit`
stops here with its report.)

Then ONE message — never a second one for any of these — after searching the learning file and
the three model sections' Q&A (`open-questions.md` §1) and stating what you reuse:

| Item | Ask when | Never |
|---|---|---|
| Application base URL — the `[E1]` row of `TEST-DATA` §0 | not recorded as `[type: env]` for the target environment (the row says `unknown — asked by 3b/3c`), or the user names another environment; the answer fills that row's `Value` / `Status`. Any other `[E{n}]` row still `unknown` (mail sandbox, SMS test provider…) is asked in the same message — each is its own service, never "the URL" | auto-detected; written into a TC as a literal |
| Username per account the TCs reference (`[A{n}]` — role and username from `TEST-DATA` §1) | only for a row whose username is `unknown`; the answer fills that row | written into a step — the TC keeps `Login as {role} [A{n}]` |
| **Login method per account** — A) attended: you open a visible browser for that account and the user logs in themselves; B) secrets file: skill 1's `set-playwright-secrets` script was run with names that follow the account ID (`A1_USER` / `A1_PASSWORD` for `[A1]`) and you type only those NAMES (`browser-cli.md` §3) | always, per referenced account; state the recorded method for this environment as the recommendation when the learning file has one | a password — not in chat, not on a command line, not in a file; the run never receives one |
| Implementation status (implemented / partially / not implemented / not sure) | the header says `not yet checked live` and no skill-4 report answers it | trusted over the live look — both are recorded |
| Environment notes | always, one line: VPN / tenant / where the build number shows / anything that blocks screens / whether this is production | — |
| **Data changes on {env}** — may this run create / modify / delete data (`walk-rules.md` §3a)? | always; name the TCs it concerns (`Data effect` ≠ read-only) and what would be cleaned up; production named in the notes → "no" is stated, not asked | a mutation on "no"; a mutation on production |
| Revision authorization (approved document, changes expected) | `Status: APPROVED` and no `--authorize-revision`; list the concrete changes you expect | re-asked in the same run |
| Scope | never — this skill has no scope gate; every TC is walked (`discovery-plan.md`) | a scope question, a recommendation, a narrowing |
| Re-validate 3b's evidence | never — every TC carrying 3b evidence is re-validated (`patch-rules.md` §1b) | a keep / skip question |

Record every answer except anything secret before opening a browser: base URL → the `[E1]` row
of `TEST-DATA` §0 and the learning file `[type: env]` (project-wide); other environment rows and
usernames → their `TEST-DATA` rows; login method used on this environment → `### CLI Validation Model
(skill 3c)` (a name, never a value); implementation status → header + return; environment notes →
header stamp (`env {name}`) and learning file when project-wide; the data-changes answer and the
authorization → the run only.

## 4. Multi-story input — a SPEC folder or several IDs

1. List the stories you found and state the split before anything else.
2. One probe, one combined ask for all stories (login method per account once; one attended login per account is reused across stories).
3. Set analysis **per story** — one plan line each (`discovery-plan.md` §3); every TC of every
   story is walked; no scope question for any of them.
4. Shared common flows (login, navigation to a shared module) are walked ONCE and reused across
   stories; record them in the learning file once.
5. Write back per story (`patch-rules.md`). When `TC-GENERATION-SUMMARY.md` exists in the spec
   folder, patch only its per-story `implementation status` and `open findings count` columns —
   never its shape.
6. One story blocked (app screen unreachable, authorization refused) does not stop the others:
   finish every story you can and list the blocked ones with the reason.
