# Export template — `Testing/Requirements/[SPEC-{spec-name}/]US-{id}-{name}/US-{id}-code-rules.md`

```markdown
# Business Rules in Code — US-{id} {Story title}
**Status**: PENDING PO APPROVAL   ← becomes `APPROVED {YYYY-MM-DD} by {name}` after --apply-approved
**Story**: US-{id} — {title}
**Spec source(s)**: {REQ-{id}-{name}.md | specs/.../spec.md | none — catalogue mode}
**Profile**: {reused, generated YYYY-MM-DD | built new}
**Commit**: {git short sha} · **Date**: {YYYY-MM-DD}
**Files analysed**: N across {layers}

---

## Executive Summary

| Verdict | Count |
|---|---|
| In spec | N |
| Partially in spec | N |
| **Not in spec** | **N** |
| Contradicts spec | N |
| In spec, not in code | N |

**Top undocumented rules**
1. RULE-004 (High, Observed) — {EARS one-liner}
2. …

**Enforcement warnings**: N UI-only rules (bypassable) · N DB-only rules (technical error, no message)

---

## A. Partially specified

| Rule | Spec says | Code adds | Enforced at | Evidence | Impact | Proposed REQ wording |
|---|---|---|---|---|---|---|
| RULE-002 | "Name is required" | max 100 chars after trim; message "Name must not exceed 100 characters" | UI+server | `path/File.cs:87`, `path/form.tsx:42` | Medium | REQ-{id}-14 The KPI name is mandatory and limited to 100 characters after trimming. |

## B. Not in spec — business rules living only in the code

### RULE-004 · Uniqueness & identity · Impact High · Observed
**(server)** When a KPI is saved with a code already used by another KPI in the same
organisation (case-insensitive, trimmed), the system shall reject the save with
"Code already exists".
- **Enforced at**: server (+ unique index in DB, scope org+code)
- **Evidence**: `path/KpiValidator.cs:54-61`; `path/Migrations/2026..._KpiCodeIndex.cs:12`
- **Message**: EN "Code already exists" · AR "الكود موجود مسبقاً"
- **Proposed requirement**: REQ-{id}-15 A KPI code must be unique within the organisation;
  comparison ignores case and surrounding spaces. A duplicate is rejected with "Code already exists".
- **Suggested test cases**: Create KPI with a code already used in the same org → rejected ·
  Same code, different org → accepted · Same code different case / with spaces → rejected ·
  Edit existing KPI keeping its own code → accepted

### RULE-007 · …

## C. Contradictions — spec vs code

| Rule | Spec says | Code does | Probably wrong | Evidence | Hand-off |
|---|---|---|---|---|---|
| RULE-011 | target range 0–100 | accepts up to 999 | code | `…:120` | skill 10 (bug) |

## D. In spec, not in code

| Spec rule | Statement | Searched layers | Hand-off |
|---|---|---|---|
| REQ-{id}-07 | Description max 500 chars | validation, persistence, UI — no hit | skill 10 (gap) |

---

## Enforcement matrix

| Rule | Category | UI | Server | DB | Note |
|---|---|:-:|:-:|:-:|---|
| RULE-001 | Field constraints | ✔ | ✔ | ✔ | |
| RULE-005 | Ranges | ✔ | ✖ | ✖ | **UI-only — bypassable** |
| RULE-006 | Relationships | ✖ | ✖ | ✔ | **DB-only — technical error, no message** |

## Coverage of the spec

| Spec rule | Verdict | Covered by |
|---|---|---|
| REQ-{id}-01 | In spec | RULE-001 |
| REQ-{id}-02 | Partially | RULE-002 |
| REQ-{id}-07 | Not in code | — |

## Discovery map

| Layer | Files read | Rules found |
|---|---|---|
| Persistence | `…`, `…` | RULE-001, 004, 006 |
| Validation | `…` | RULE-001, 002, 004 |
| Authorization | — no hit — | none found |

## Unverified / assumptions

- RULE-009 (Inferred) — deduced from test name `…`; the enforcing code was not located.
- Profile could not confirm a background-job layer; integration rules may be incomplete.

## QC / PO decision block

Filled by the QC together with the Product Owner. Every B and C rule needs exactly one
decision and a name/date before `--apply-approved` will record anything. Until then every rule
above is a proposal, not a fact.

| Rule | ☐ Intended → add to REQ | ☐ Bug → raise (skill 10) | ☐ Ignore (reason) | Decided by / date |
|---|---|---|---|---|
| RULE-004 | | | | |
| RULE-007 | | | | |
| RULE-011 | | | | |

---

## REQ delta — proposed (not applied)

<!-- --apply-approved appends a second block "REQ delta — approved" holding only the Intended rules -->

# Multi-story summary — `{requirements-root}/[SPEC-{spec-name}/]CODE-RULES-SUMMARY.md` (only when the input held several stories; inside the spec folder when they came from a spec file)

```markdown
# Code Rules Summary — {spec or feature name}
**Date**: {YYYY-MM-DD} · **Stories**: N · **Status**: PENDING PO APPROVAL

| Story | Export | In spec | Partially | Not in spec | Contradicts | Not in code | UI-only | DB-only |
|---|---|---|---|---|---|---|---|---|
| US-{id1} | US-{id1}-{name}/US-{id1}-code-rules.md | N | N | N | N | N | N | N |
| US-{id2} | … | | | | | | | |

## Rules spanning stories
| Rule | Owning story | Also referenced by |
|---|---|---|
| US-{id1} RULE-004 | US-{id1} | US-{id2} |
```

```text
REQ-{id}-14  The KPI name is mandatory and limited to 100 characters after trimming.
REQ-{id}-15  A KPI code must be unique within the organisation; comparison ignores case and
             surrounding spaces. A duplicate is rejected with "Code already exists".
```
```
