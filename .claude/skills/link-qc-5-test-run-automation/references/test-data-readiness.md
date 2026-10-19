# Test-data readiness — PHASE 2.6

Loaded by `SKILL.md` at **Preparing Test Data**. Steps 4-7 of `<data_readiness>` (discovering a way,
the one consent question, preparing, keep / clean-up) and the twelve preparation principles live in
`references/test-data-preparation.md` — load it only when a requirement is `MISSING`, `UNKNOWN` or
`IMPOSSIBLE` after step 3.

## PHASE 2.6 — PRECONDITION & TEST-DATA READINESS (prepare first, skip only with a reason)

<data_readiness>
**Runs after PHASE 2.5 and BEFORE anything executes.** A TC that would skip because its
precondition cannot be met or its data is absent from the environment is **decided here — never
discovered by the run.** The run must not be the first place a "no data" skip appears, and a gap
the project itself can create is **prepared by this skill, never left as "data missing"**.

**1. Collect the requirements** — start from skill 3's
`{tc_output_folder}/TEST-DATA-{feature}.md` when it exists: take its environment rows (`## 0.
Environment`, `E{n}`), data items (`D{n}`), TC mapping, accounts (`## 1. Accounts`, `A{n}`),
statuses (`READY` / `MISSING` / `IMPOSSIBLE` / `UNKNOWN` / `NOT CREATABLE`), Problems table,
recommended ways and — when 3b / 3c wrote them — the per-item `How we handle it` / `Decided from`
/ `Prepared this run` / `Stamped values` bullets as the inventory of record — **do not rebuild
the inventory from scratch**. Every ID a TC references is a requirement of its own: `[E2]` is the
mail sandbox row, not the base URL; `[A2]` is that account, not "an Administrator"; a referenced
ID with no row is a gap to list here, never a substitution.
Add only requirements the approved TC document carries that the file lacks (a Preconditions /
Data Oracle / Shared data sentence or a role with no data item), and say which were added.
Skill 3 owns that file — never edit it; record outcomes in the learning file and
`{run_file}.data_readiness` only. When the file is missing, derive the requirements from
`<normalization>` as before (one per Preconditions / Data Oracle / Shared data sentence and per
role used), de-duplicated across TCs, each with the list of TC-IDs that depend on it. Either
way, reuse the PHASE 2.5 flags (`dataGated`, `alwaysSkipped`) as hints for which requirements
the generated code already doubts — do not re-derive them.

**2. Probe the environment — cheap, once per distinct requirement, never per TC.** Items the
test-data file marks `READY` are re-confirmed from the learning file only; probe the `MISSING`
/ `UNKNOWN` items (and `IMPOSSIBLE` ones only to look for a way the file did not know; a
`NOT CREATABLE` item is re-checked only when its evidence line is older than the build). A way
the file marks "to be confirmed" (`api` / `db`) is offered only after step 4 finds it:
1. `Testing/project-learning.md` first: `[type: data]` lines (`## Test Data`), `[type: env]`
   lines (incl. not-creatable evidence), and this skill's Q&A. A recorded fixture or a recorded
   decision is reused — say so.
2. Accounts: the env layer of the automation project keyed by account ID (`helpers/test-data.ts`
   `accounts['A1']` → `A1_USER` / `A1_PASSWORD`); a role-keyed legacy layer is read for the
   username only and the ID-keyed entry is added — never "any user of that role".
3. Existing test-data helpers, **wherever they live** (principle 1 step 2): the paths
   `Testing/qa-manifest.json` names first (`paths.automationRoot`, any fixtures / helpers path),
   then a search across `{automation_root}` for create / seed / fixture / factory / pre-request /
   setup modules and API clients (`prerequest/*PreRequest.ts`, DB-oracle helpers in `pages/`,
   `00-setup-*.spec.ts` journeys from earlier stories are the conventional names, not the only
   ones). Record where each was found; a helper counts as a way only when it creates the entity.
4. One read probe per remaining data need: an existing API GET through the project's request
   helper, or ONE Playwright MCP look at the listing screen for that entity. Nothing the
   learning file already answers is probed again.

**3. Classify every requirement** and map it back to TC-IDs:

| Status | Meaning | Effect |
|---|---|---|
| `READY` | Present in the environment (or a kept fixture a learning-file line confirms) | nothing to decide |
| `MISSING` | Absent, but creatable (entity, state, count, role assignment) | **prepared** through the first available way of step 4, under the consent that way needs |
| `IMPOSSIBLE` | Skill 3's word: needs a background job, an external system, a role that exists in no environment, or a state the app cannot reach through any interface | prepared when step 4 finds a way the file did not know; otherwise `skip — not creatable` with the Problems-row reason, or `manual` |
| `UNKNOWN` | Could not be probed (screen unreachable, no read access) | the QC decides, flagged |
| `NOT CREATABLE` | Evidence proves the state cannot exist on `{env}` — a rule in the code or configuration, a role no environment has, a job that never runs here (written by 3b / 3c in the file, or found by step 4 here) | `skip — not creatable — {evidence}`; the evidence → `[type: env]`. Distinct from `IMPOSSIBLE`: it names the evidence |

Every TC touching a non-`READY` requirement goes on the **predicted-skip list** with the reason
until its gap is prepared and verified.

**4-7. Discover the way, ask the QC, prepare, keep or clean up** — `references/test-data-preparation.md`
(the twelve principles, the consent table and steps 4-7). Every requirement `READY` after step 3 →
nothing to prepare; go to step 8.

**8. Re-probe → verdict** `READY` · `READY-WITH-SKIPS ({n} TCs)[ — {p} gaps prepared]` ·
`BLOCKED` (interactive QC chose to stop, or a chosen preparation failed and the QC declined the
alternatives). Update `{run_file}.run_plan`: setup groups first; TCs whose data was created →
`serial:{gap}` after their setup group — data PHASE 2.6 created stays `serial:{gap}` (the own-data
parallel rule of `<run_plan>` covers only records a TC creates itself). The group's teardown deletes
that data, so **re-running a `serial:{gap}` TC re-runs its setup group first** (`<second_run>` step
1). Write the `data_readiness` object into `{run_file}`:

```json
{
  "verdict": "READY-WITH-SKIPS",
  "gaps": [
    { "gap": "An order with line items exists in UAT", "tcs": ["TC-010", "TC-011", "TC-011b"],
      "decision": "prepared (api)", "source": "learning", "provisioning": "the automation project's order helper",
      "identifiers": "order no. 10231 in customer \"qa-create-order-2026-05-02\"", "stamped_values": "order date = 2026-05-02",
      "verified_on": "order list + read-only API read, 2026-05-02", "cleanup": "kept" },
    { "gap": "A user with the Approver role", "tcs": ["TC-030", "TC-030b"],
      "decision": "skip — not creatable", "source": "discovery", "provisioning": null,
      "identifiers": null, "stamped_values": null, "verified_on": null, "cleanup": null }
  ],
  "predicted_skips": ["TC-030", "TC-030b"]
}
```

The same rows are the phase's `### Test-data readiness` table (`Gap · TCs · Decision · Source ·
Provisioning · Identifiers / names · Effective stamped values · Verified on · Cleanup`,
`references/run-report.md` §4); `Decision` ∈ `READY` · `prepared (api|ui|db)` · `skip —
data_missing` · `skip — not creatable` · `skip — QC declined` — the renderer counts them and
warns on any other word.

Progress-log line (activity **Preparing Test Data**, `<live_progress>`; in the chat only inside a
message this step already sends — the one consent question or the verdict):
`Preparing Test Data: {ready}/{total} requirements ready — {n} TCs would skip — {awaiting QC decision | preparing via api/ui/db | waiting for manual insert | READY | READY-WITH-SKIPS}`

**9. Learning write-back:** every QC decision (consent, keep / clean-up) → `[type: qa]` line in
this skill's Q&A; kept fixtures → `[type: data]` in `## Test Data` (with the stamped values);
environment facts ("no user exists for role X in any environment", "entity Y has no empty state
anywhere") and not-creatable evidence → `[type: env]`; "the screen is not the rule" facts →
`[type: env]`. Plain English only.

</data_readiness>
