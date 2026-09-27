# Scope gate — analyse the set, respect an explicit instruction, otherwise ask once (steps 4, 7)

## 1. Analyse the whole TC set FIRST — no browser yet

Read every TC (`tc-format-contract.md`) and build the **discovery plan**:

1. **Common flows** — shared step prefixes across TCs (login → navigate → open panel → …). A
   common flow is the longest shared prefix used by ≥ 2 TCs and ≥ 3 steps long; count the
   distinct flows `F`. Each distinct flow is validated ONCE, not per TC.
2. **Unique tail** per TC — the steps after its common-flow prefix. This is where spec-vs-app
   discrepancies hide.
3. **Known knowledge** — steps already confirmed by the learning file (`## Common Flows`,
   `## UI Knowledge`, `## Locale Knowledge`) or by a TC whose evidence stamp is still fresh
   (`patch-rules.md` §1). These are NOT rediscovered.
4. **Executable set** `N` — TCs that are not `not-implemented` after the implementation-status
   gate (`mcp-pass.md` §1), minus TCs excluded by a CUSTOM list.
5. **Risk signals** — per TC: `Smoke: YES`, `Type: negative`, `Data effect` other than read-only,
   a role no other TC uses, a unique tail longer than the prefix, a locale variant whose labels
   are not in the learning file, a `discrepancy` from an earlier run, an open `Q-*` naming it.
6. **Gaps** — missing navigation, preconditions, test data, filters/selections, async waits or
   triggers, ambiguous steps, "(Arabic label: to be captured live)" notes: the discovery targets.
   A `[HUMAN]` step is not a gap: the tail is walked up to it and stops there (`mcp-pass.md` §3);
   count those TCs so the recommendation can say they end `draft (human step pending)`.
7. **Locale-sensitive points** — every element label referenced in any step, plus screens whose
   secondary-locale behaviour must be walked live (`mcp-pass.md` §4).

## 2. An explicit instruction is respected — no question

`--scope full`, `--scope shared`, `--scope TC-…,TC-…`, `--full`, or an equivalent sentence in the
task ("validate everything", "only the shared flows", "just TC-ORD-03 and 04") settles the scope.
Apply it, state it in one line with what it leaves unvalidated, and move on. An explicit scope
given earlier in the same run is never re-asked.

## 3. Otherwise: ONE question, with a recommendation

Asked in the `open-questions.md` shape (one `AskUserQuestion`, one option `(Recommended)`, free
text allowed for a TC-ID list). Contents:

- the numbers: `N` executable TCs (of `T` total; `n` not-implemented), `F` common flows, the risk
  signals found (e.g. "3 smoke, 4 negative, 2 data-changing, 2 roles, 5 long unique tails");
- **FULL** — walks each of the `F` flows once + every unique tail; every TC can reach
  `validated` / `enhanced` / `discrepancy`;
- **SHARED-FLOWS-ONLY** — walks the `F` flows only and propagates the corrected prefix wording
  to every TC; unique tails are NOT walked → those TCs end `inferred` at best (`draft` where
  nothing confirms the tail); **name the TC-IDs that stay unvalidated**, and the smoke / negative
  / data-changing ones among them explicitly;
- **CUSTOM** — a TC-ID list, fully walked; every other TC untouched;
- the recommendation and its reason (§3a), and the cost in plain words (roughly one minute per
  flow plus one per walked tail — a heuristic, corrected from the elapsed time once one exists).

Then WAIT. Never silently choose, never proceed on the recommendation.

### 3a. How to recommend

Use the analysis, not a threshold alone. Recommend **FULL** when any of these hold: the executable
set is small (**around 15 or fewer — a heuristic, not a rule**), several TCs are smoke or
data-changing, the TCs span more than one role, most tails are long or unique, the story is
partially implemented, an earlier run left `discrepancy` or stale TCs, or the reviewer needs
approval-grade evidence. Recommend **SHARED-FLOWS-ONLY** when the set is large and homogeneous
(many TCs differing only by data values or locale on the same screens), risk signals are few, and
the goal is to fix wording before a wider pass. Recommend **CUSTOM** when the task names a subset
(a reviewer's list, the stale set on a re-run, the TCs of one AC). Always state what the
recommended scope leaves unvalidated.

## 4. Mode rules

| Mode | Walk | States |
|---|---|---|
| **FULL** | each common flow once (primary locale, `mcp-pass.md` §3), every unique tail in the executable set, locale policy §4 | per `mcp-pass.md` §6 — `validated` / `enhanced` / `discrepancy` / `inferred` (only when a tail was confirmed by fresh prior evidence) / `not-implemented` / `draft` (unreachable) |
| **SHARED-FLOWS-ONLY** | each common flow once; capture labels, P1 / P2 / P3 steps; tails not walked | prefix corrections propagated to every TC sharing the flow (logged once per flow, "prefix only"); a TC becomes `inferred` when the learning file or a fresh earlier observation confirms its tail, else stays `draft — not app-validated`; never `validated`; evidence stamp `scope: prefix-only` |
| **CUSTOM** | the listed TCs as FULL (their flows once + their tails); nothing else | listed TCs per FULL; every other TC, its stamp and its log rows untouched |

Whatever the mode: the implementation-status gate runs first; the test-data look
(`patch-rules.md` §3) covers every item whose listing screen the walk reaches; the coverage
tables are never recomputed by the walk itself (SKILL.md invariant 6).

## 5. Re-run defaults (document already stamped by 3b)

After the freshness pass **and the cross-validator check** (`patch-rules.md` §1b — stamps written
by 3c are asked about first, and its answer decides whether those TCs join this set or are kept),
the default candidate set is: every TC now `draft` (incl. stale), every
`inferred`, every `discrepancy` (retest of its PB reproduction), and every `not-implemented`
(re-gate through `mcp-pass.md` §1). `validated` / `enhanced` TCs whose stamps are still fresh are
skipped unless `--full`. The scope question (§3) is still asked over that candidate set unless an
explicit scope was given; the recommendation names it as CUSTOM (the candidate list) or FULL. The
header stamp becomes `— by 3b on {date}, env {name}, scope {mode}, re-run {n}`.

## 6. Progress line

One line per screen or flow, fixed order, no prose between refreshes:

```
Validated 7/18 · flows 2/3 · 2 pending implementation · 1 stale · 0 blocked
```

(`Validated` counts TCs observed so far — `validated` + `enhanced` + `discrepancy`; the per-run
detail lives in the enhancement log, not in the chat.)
