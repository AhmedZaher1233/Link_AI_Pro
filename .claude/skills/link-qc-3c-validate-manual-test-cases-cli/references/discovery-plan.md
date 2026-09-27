# Discovery plan — analyse the whole set, then walk ALL of it (steps 4, 7)

This skill has **no scope gate**. Every TC in the document is in scope on every run: each common
flow is walked once, every TC's unique tail is walked, and nothing is skipped because an earlier
run (by this skill or by 3b) already looked at it. No scope question is ever asked, nothing is
recommended, nothing is "left unvalidated by choice". The only TCs that end a run unobserved are
the ones the application itself keeps out of reach: `not-implemented` (`walk-rules.md` §1),
`draft (data changes not authorized)` (`walk-rules.md` §3a), `draft (screen could not be
driven | app unreachable)` (`walk-rules.md` §7) — each with its reason, each listed.

## 1. Analyse the whole TC set FIRST — no browser yet

Read every TC (`tc-format-contract.md`) and build the **discovery plan**:

1. **Common flows** — shared step prefixes across TCs (login → navigate → open panel → …). A
   common flow is the longest shared prefix used by ≥ 2 TCs and ≥ 3 steps long; count the
   distinct flows `F`. Each distinct flow is validated ONCE, not per TC.
2. **Unique tail** per TC — the steps after its common-flow prefix. This is where spec-vs-app
   discrepancies hide. Every tail is walked this run.
3. **Known knowledge** — steps already confirmed by the learning file (`## Common Flows`,
   `## UI Knowledge`, `## Locale Knowledge`). It shortens discovery of a flow's wording; it never
   replaces walking a TC's tail (a tail known from prior knowledge is still observed this run —
   `inferred` is reserved for a tail this run could not reach).
4. **Executable set** `N` — every TC that is not `not-implemented` after the implementation-status
   gate (`walk-rules.md` §1). `N` is the walk set; there is no other subset.
5. **Risk signals** — per TC: `Smoke: YES`, `Type: negative`, `Data effect` other than read-only
   (runs only when the data-changes answer was "yes" — `walk-rules.md` §3a; otherwise it stays
   `draft` with that reason), a role no other TC uses, a unique tail longer than the prefix, a
   locale variant whose labels are not in the learning file, a `discrepancy` from an earlier run,
   an open `Q-*` naming it. Risk signals order the walk (smoke and data-changing TCs first, then
   the rest) — they never exclude anything.
6. **Gaps** — missing navigation, preconditions, test data, filters/selections, async waits or
   triggers, ambiguous steps, "(Arabic label: to be captured live)" notes: the discovery targets.
   A `[HUMAN]` step is not a gap: the tail is walked up to it and stops there (`walk-rules.md`
   §3); count those TCs for the plan line — they end `draft (human step pending)`.
7. **Locale-sensitive points** — every element label referenced in any step, plus screens whose
   secondary-locale behaviour must be walked live (`walk-rules.md` §4).

## 2. Flags — accepted, never a question

- `--full` / `--scope full` / "validate everything": already the only behaviour; accepted without
  comment (3b takes the same flag, so the comparison protocol can pass it to both).
- `--scope shared` / `--scope <TC-ID,…>`: **not supported by this skill.** State in one line that
  this skill always walks every TC, then walk every TC. Never narrow, never ask.
- A sentence in the task naming a subset ("just TC-ORD-03") is answered the same way: one line,
  then the full walk. The user who wants a narrowed live check runs skill 3b.

## 3. State the plan in one line, then walk

Before the first browser command, after the implementation-status gate and the freshness pass:

```
Walking all {N} executable TCs (of {T}; {n} not-implemented) · {F} common flows once · {d} data-changing ({authorized | not authorized}) · {h} stop at a [HUMAN] step · tool cli
```

No WAIT here — nothing to answer.

## 4. Walk rule

| Walk | States |
|---|---|
| each common flow once (primary locale, `walk-rules.md` §3), **every** unique tail in the executable set, locale policy §4 | per `walk-rules.md` §6-§6a — `validated` / `enhanced` / `discrepancy` (outcome observed) / `not-implemented` / `draft` (app unreachable, data changes not authorized, screen could not be driven, stale and unreachable — reason in parentheses); `inferred` only when the tail could not be driven this run but a fresh earlier observation confirms those exact steps on that exact screen — and then it is listed as needing the reviewer's extra care |

The implementation-status gate runs first; the test-data look (`patch-rules.md` §3) covers every
item whose listing screen the walk reaches; the coverage tables are never recomputed by the walk
itself (SKILL.md invariant 6). Evidence stamps always carry `scope: full-tail`; the header stamp
always says `scope full`.

## 5. Re-runs (document already stamped by this skill or by 3b)

The freshness pass (`patch-rules.md` §1) still runs — it decides which earlier states are
**reported** as stale and which stamps are reset — but it excludes nothing: every TC is walked
again, every observed TC gets a fresh stamp, `validated` / `enhanced` with fresh evidence
included. Evidence written by 3b is re-validated and replaced on observation (`patch-rules.md`
§1b); there is no "kept from 3b" set. The header stamp becomes
`— by 3c on {date}, env {name}, scope full, re-run {n}, tool cli`.

## 6. Progress line

One line per screen or flow, fixed order, no prose between refreshes:

```
Validated 7/18 · flows 2/3 · 2 pending implementation · 1 stale · 0 blocked · tool cli
```

(`Validated` counts TCs observed so far — `validated` + `enhanced` + `discrepancy`; the per-run
detail lives in the enhancement log, not in the chat.)
