# Validation comparison — {feature} — 3b (Playwright MCP) vs 3c (playwright-cli)

**Story:** US-{id} {name} · **Document:** `{path to TEST-CASES-{feature}.md}` · **Baseline revision:** `{git sha}` (no validation stamps)
**Application:** {environment} · build {version | unknown} · data reset procedure: {what / how / by whom}
**Model:** {model name} · **Scope (both runs):** --full (3c always walks every TC) · **Login (both runs):** {attended | secrets file} · **Data changes (both runs):** {yes | no}
**Order:** {3b then 3c | 3c then 3b} · **Dates:** 3b {YYYY-MM-DD}, 3c {YYYY-MM-DD}
**Outputs:** `comparison/3b-*` and `comparison/3c-*` (this folder); story files restored to the baseline afterwards: {yes}

## 1. Numbers

| Measure | 3b (MCP) | 3c (CLI) | Note |
|---|---|---|---|
| Input tokens | {n | not split} | {n | not split} | from `/cost` |
| Output tokens | {n | not split} | {n | not split} | |
| Cache read / cache write tokens | {n / n | not shown} | {n / n | not shown} | |
| Total tokens | {n} | {n} | |
| Elapsed (first browser command → final message) | {mm:ss} | {mm:ss} | {source of the timestamps} |
| TCs in scope | {N} | {N} | identical by construction |
| validated / enhanced / inferred / discrepancy / not-implemented / draft | {v/e/i/d/ni/dr} | {v/e/i/d/ni/dr} | |
| App validation progress | {a}/{N} | {a}/{N} | |
| Potential bugs found (open) | {n} ({PB-ids}) | {n} ({PB-ids}) | |
| Blockers / unwalked TC-IDs | {…} | {…} | |
| Labels captured live ("to be captured live" notes replaced) | {n}/{m} | {n}/{m} | |
| Renderer gate on the copy | {PASS | MISMATCH | BLOCKED} | {PASS | MISMATCH | BLOCKED} | |

## 2. Verification quality

| TC-ID | 3b state | 3c state | Same? | 3b evidence (log reason / stamp) | 3c outcome-check | Judgement |
|---|---|---|---|---|---|---|
| TC-… | | | yes / no | | | equivalent / 3b more accurate / 3c more accurate / needs a human |

Potential bugs: {same set | differences listed one by one with TC-ID, title, and which run missed it and why}.

## 3. Output compatibility

`diff comparison/3b-TEST-CASES-{feature}.md comparison/3c-TEST-CASES-{feature}.md`:
- Metadata-only differences (header stamp, `tool`, `outcome-check`, `screenshot`): {listed}
- Wording differences: {TC-ID — what differs — judgement}, one per line, or "none"
- Design fields, TC set, coverage tables: {identical | difference → a defect in one run, named}

## 4. Case matrix

| # | Case | TC-IDs | Expected | 3b result | 3c result | Verdict |
|---|---|---|---|---|---|---|
| 1 | Successful flow | | | | | |
| 2 | Genuine discrepancy | | | | | |
| 3 | Dynamic element / stale reference | | | | | |
| 4 | Two roles | | | | | |
| 5 | Arabic screen | | | | | |
| 6 | Missing data | | | | | |
| 7 | Unavailable environment | | | | | |
| 8 | Interrupted run | | | | | |
| 9 | APPROVED without authorization | | | | | |
| 10 | APPROVED with `--authorize-revision` | | | | | |
| 11 | Existing PB retest | | | | | |
| 12 | Stale evidence | | | | | |

## 5. Capability gaps

| Skill | TC-ID | What was needed | What happened | Recorded in |
|---|---|---|---|---|
| 3c | | | | `browser-cli.md` §10 |
| 3b | | | | Environment blockers |

## 6. Summary of measurements

{Numbers and verdicts only. No recommendation about the default validator — that decision is
taken by the user, by explicit instruction, after reading this report.}
