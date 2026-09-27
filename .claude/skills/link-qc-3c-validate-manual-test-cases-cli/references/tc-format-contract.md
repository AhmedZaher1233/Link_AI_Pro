# TC format contract — what you read, what you may patch, what you never touch (steps 4, 11)

The document is skill 3's; its field names and shape are a frozen contract parsed by skills 4, 5,
this skill and the renderer (`html-page.md` §3). Never rename, drop or reorder a field.

## The frozen per-TC shape

```markdown
### {TC-ID} — {Description}
- **Type:** happy-path | edge-case | negative
- **Locale:** en | ar | …
- **Requirement:** REQ-…, REQ-…
- **Stage:** @positive | @negative
- **Preconditions:**
  1. {…}
- **Steps:**
  1. {action + element label + value + inline assertion}
- **Expected Result:** {…}
- **Data Oracle:** {… | —}
- **Smoke:** YES | NO
- **Automation Candidate:** YES | NO
- **Data effect:** {read-only | creates | modifies | deletes | —}
- **Shared data:** {plain words | —}
- **Tags:** {comma-separated | —}   (optional; older documents lack it)
- **Validation:** {one of the six states — validation-states.md}
<!-- tc-evidence
validated-on: YYYY-MM-DD
env: {environment name}
build: {version shown by the app | unknown}
scope: full-tail   (this skill never writes prefix-only — it has no shared-flows-only mode)
tool: cli
outcome-check: {what was looked at → what it showed, plain words | human step pending}
content-sha256: {sha256 of Preconditions + Steps + Expected Result text, normalized}
req-sha256: {sha256 of the cited acceptance-criterion text as read from the REQ / spec now}
open-questions: {Q-ids open at observation time | —}
checked-in-run: YYYY-MM-DD
-->
```

A **legacy** document may use `### {TC-ID}: {Description}`, lack `Stage` or `Tags`, and carry no
stamp — read it (the renderer's compatibility rules apply), patch the fields below in place, and
add `Stage` / the stamp only to the TCs you touch (never `Tags` — a design field).

Inside `Preconditions` / `Steps` / `Expected Result` / `Data Oracle` / `Shared data` the TC names
configuration by **reference**: `[E{n}]` an environment row, `[A{n}]` an account, `[D{n}]` a data
item of `TEST-DATA-{feature}.md`, always name + token (`Login as Administrator [A1]`). Each token
resolves to its own row — never role → account, never "E1 = the URL". A step or expected-result
line starting with `[HUMAN] ` needs a person; it is a frozen marker in the text, not a field.

## What this skill may write

| Field / block | Rule |
|---|---|
| `Validation` | exactly one state from `validation-states.md`; the summary-table cell is updated to the same value |
| `<!-- tc-evidence -->` | written or replaced for every TC observed this run, always with `tool: cli` and an `outcome-check` line (SKILL.md invariant 15); removed when a TC drops to `draft (stale — …)`; never invented for a TC not observed. A stamp with `tool: mcp` or without a `tool` key belongs to skill 3b: kept untouched or replaced only per `patch-rules.md` §1b |
| `Preconditions`, `Steps`, `Expected Result` | **label wording only** — verbatim control / option / banner / heading text in every required locale, "(Arabic label: to be captured live)" notes replaced by the captured label, and **inserted** reveal (P1) / wait (P2) / trigger (P3) / navigation / selection steps the app requires. Reference tokens stay as written and an inserted step uses the same form — a URL, a username or a dataset identifier is never written in as a literal; a `[HUMAN]` marker is never removed or reworded past. The requirement-based *meaning* of the Expected Result is never changed — a contradiction is a `discrepancy` + PB, not a rewrite |
| Header lines | `Implementation status` (+ source), `MCP validation` (six counts + stamp), `App validation progress`; every other header line only when recomputed from tables you legitimately changed (`Total test cases` never changes) |
| `## Enhancement Log` | append rows (`TC-ID · Validation · What changed · Why · Run`); never delete or rewrite earlier rows |
| `## Potential Bugs` | upsert `PB-{n}` entries (`patch-rules.md` §2); the `pb-meta` comment carries `screenshot: evidence/PB-{n}-{date}.png` |
| `evidence/PB-{n}-{date}.png` | one screenshot per discrepancy observed this run (`browser-cli.md` §7); earlier files are never deleted |
| `## Open Questions` | add / answer `Q-{n}` entries (`open-questions.md`) |
| `## Open Findings for the Human Reviewer` | the five buckets — add, never remove another skill's items |
| `Status` | only per SKILL.md invariant 5 (authorized change to an APPROVED document → `PENDING HUMAN REVIEW`) |

## What this skill never touches

`ID`, `Type`, `Locale`, `Requirement`, `Stage`, `Description`, `Smoke`, `Automation Candidate`,
`Data effect`, `Shared data`, `Tags` (design-owned; skill 4 publishes them), `Data Oracle` values
(a wrong oracle is a PB or a Q, not an edit), the `[HUMAN]` markers, the reference tokens,
the summary-table design columns, `## Traceability Matrix`, `## Negative Coverage`,
`## Standards Alignment`, `## Requirement Coverage Score`, `## Manual-Only Scenarios`,
`## Existing-TC Analysis`, `Requirement coverage (weighted)`, `Manual-only scenarios`,
`Total test cases`, `Smoke TCs`, `Automation candidates`, `Tag convention`, `Scope`, `Generated`,
`Entry case`, the frozen anchors and their order, and the TC set itself (no TC added, removed or
renumbered). `Review page language` is rewritten to what this run rendered (English unless
`--lang ar`) — a record, never an input.

Before writing, diff the design fields before / after (`self-review.md` check 3): any difference
is a defect in your patch, not a finding.
