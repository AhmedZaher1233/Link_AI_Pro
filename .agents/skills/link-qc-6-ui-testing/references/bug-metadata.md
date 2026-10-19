# Bug metadata field values

Closed-list values for the `Bug Trigger`, `Impact` and `Classification`
fields, loaded from Step 4B of SKILL.md. Choose exactly one value from each.

**These lists are the suite's default catalogue** (the Azure DevOps process
template most consumer projects use). Before the first report in a project,
check `Testing/project-learning.md` → `### Publish Model (skill 4)` and
`### UI Visual QA Model (skill 6)` for the tracker's actual field values;
when the project records different ones, use those and keep this file as the
fallback. `Testing Type: Integration Testing` is likewise the default value —
override it only when the project's tracker or learning file says so.

**Bug Trigger**

- `Basic Coverage`: failure in an ordinary primary flow.
- `Coverage with Varied Input`: failure occurs with a particular valid or invalid input variation.
- `Design Conformance`: mismatch with an approved design or visual specification.
- `Module Interaction`: failure occurs when two or more modules/features interact.
- `Rare Situation`: unusual boundary, interruption, recovery, or low-frequency condition.
- `Security Testing`: security or authorization testing revealed the issue.
- `Software Configuration`: environment, device, OS, permission, feature flag, or configuration dependent.
- `Special Sequence`: only a particular action order or state transition triggers it.
- `Workload/Stress`: load, volume, concurrency, or resource pressure triggers it.

For a bug from a **design-comparison** section (Steps 2A/3), most bugs will be
`Design Conformance`. For a bug from a **no-design heuristic** section (Step
2B), `Design Conformance` is never valid — there is no design to conform to.
Use whichever value actually fits the observed cause instead: an RTL mirroring
break is usually `Software Configuration` (locale-dependent) or `Special
Sequence` if it only shows up after a particular interaction; a plain internal
color/spacing inconsistency is usually `Basic Coverage`.

**Impact**

- `Functionality`: feature behavior or business flow is wrong.
- `Integrity/Security`: authorization, privacy, correctness, or stored-data integrity is at risk.
- `Performance`: responsiveness, throughput, stability under load, or resource use is affected.
- `Usability`: users can complete the task, but the experience is confusing or difficult.
- `User Interface`: visual styling, spacing, alignment, clipping, or presentation is wrong.

Most visual QA bugs are `User Interface`. Use `Usability` when the issue
genuinely makes the task harder to complete rather than just cosmetically
off — this is common for heuristic-mode bugs like poor contrast, missing
focus states, or broken RTL flow.

**Classification**

- `Design nonconformance`
- `Fields issue`
- `General Usability`
- `Labels , Texting and Validation msgs` (in the default process template the Azure field combines the "Labels" and "Texting and Validation messages" categories into one option — do not send them as two separate values, the API rejects both `Labels` and `Texting and Validation messages` alone)
- `Logic defects (out of RSD)`
- `Navigation issues`
- `Not implemented Functionality`
- `Not working Functionality`
- `Performance`
- `RSD nonconformance`
- `Security`
- `Server/JS error`
- `Spelling mistakes`
- `Translation`
- `UI/Layout Issue`
- `Unsaved/non-reflected data`

Use `RSD nonconformance` only when an accessible requirement explicitly proves
the mismatch. Use `Design nonconformance` only when an accessible approved
design proves it — for a design-comparison section, the Figma reference (Step
2A) or provided design screenshot is that proof, so most of those bugs should
use `Design nonconformance`. For a **no-design heuristic** section, there is
by definition no such proof, so never use `Design nonconformance` there —
pick the most specific observable classification instead: `UI/Layout Issue`
for spacing/alignment/contrast problems, `General Usability` for broken
affordances or hierarchy issues, `Navigation issues` for broken RTL nav/flow,
`Translation` for AR string/locale problems.

**Automated accessibility findings** (axe-core, Pass 1b) map as follows — one
bug per rule, node count inside the bug, `Confidence: High`:

| axe `impact` | Severity | Priority | Bug Trigger | Impact | Classification |
|---|---|---|---|---|---|
| critical | Severity 2 - High | P2 | Basic Coverage | Usability | General Usability |
| serious | Severity 3 - Medium | P2 | Basic Coverage | Usability | General Usability |
| moderate | Severity 3 - Medium | P3 | Basic Coverage | Usability | UI/Layout Issue |
| minor | Severity 4 - Low | P4 | Basic Coverage | User Interface | UI/Layout Issue |

Exceptions: a missing form label or an unlabelled control is `Fields issue`; a
wrong `lang` / `dir` on an AR page is `Translation`; keyboard traps and missing
landmarks / skip links are `Navigation issues`. In a design-comparison section
an accessibility rule is still never `Design Conformance` — the design did not
specify ARIA.

This list is a starting reference, not guaranteed to be exhaustive or exactly
correct — a project's Azure custom fields can differ subtly from what's
documented here (spacing, abbreviations, combined options). If this report's
data is later used to create or update an actual Azure work item and a
create/update call is rejected with "value ... is not in the list of supported
values" for `Bug Trigger`, `Impact`, or `Classification`, do not guess-and-retry
blindly: find an existing work item that already uses a value in the same
family (WIQL `CONTAINS` on the field, or on the title) and copy its exact field
value verbatim, then record the value actually accepted as a `[type: qa]` line
under `### UI Visual QA Model (skill 6)` in `Testing/project-learning.md`
(never edit this synced file in a consumer project) so the next run doesn't hit
the same rejection.

