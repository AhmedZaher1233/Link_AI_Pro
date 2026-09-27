# EARS Format

Adapted from jeffallan/claude-skills@spec-miner (MIT). EARS — Easy Approach to Requirements
Syntax — gives every observed rule one unambiguous shape so the QC can turn it straight
into a test case.

## Patterns

| Type | Pattern | Use for |
|------|---------|---------|
| Ubiquitous | The system shall `<action>`. | Always-true constraints (a code is unique per organisation) |
| Event-driven | When `<trigger>`, the system shall `<action>`. | Validation on save, submit, import |
| State-driven | While `<state>`, the system shall `<action>`. | Read-only after approval, locked while pending |
| Conditional | While `<state>`, when `<trigger>`, the system shall `<action>`. | Role × state × action rules |
| Optional | Where `<configuration>`, the system shall `<action>`. | Feature flags, environment-driven limits |

Always prefix the enforcing layer in brackets: `(UI)`, `(server)`, `(DB)`, `(UI+server)`.
Always include the value and the scope: not "name is limited" but "name is limited to 100
characters after trimming".

## Examples — rules typically found in code but not in specs

**RULE-001 · Field constraints**
```
(UI+server) When a KPI is saved with a name longer than 100 characters,
the system shall reject the save with "Name must not exceed 100 characters".
```

**RULE-002 · Uniqueness & identity**
```
(server) When a KPI is saved with a code already used by another KPI in the same
organisation (case-insensitive, trimmed), the system shall reject the save with
"Code already exists".
```

**RULE-003 · Defaults & derived values**
```
(server) When a KPI is created without a status, the system shall set status = Draft
and owner = the creating user.
```

**RULE-004 · Ranges & thresholds**
```
(server) When a yearly target is saved with a value above 999,999,999.99 or below 0,
the system shall reject the save.
```

**RULE-005 · Lifecycle & state**
```
(server) While a KPI is Approved, when any user edits its yearly values,
the system shall reject the edit; only Draft and Returned KPIs are editable.
```

**RULE-006 · Relationships**
```
(DB) When an initiative is deleted while KPIs reference it, the system shall block
the delete (restrict) — the UI shows a generic error, no business message.
```

**RULE-007 · Permissions**
```
(server) While the user holds only the Viewer role, when they call the delete action,
the system shall return 403; the UI hides the button but the endpoint is still exposed.
```

**RULE-008 · Duplicate & conflict handling**
```
(server) When the same create request is submitted twice within one session,
the system shall create two records — no idempotency check exists.
```

**RULE-009 · Locale**
```
(UI) Where the interface language is Arabic, the system shall limit the description
to 500 characters, versus 1000 in English (separate resource limits).
```

## Writing checklist

- One rule per statement; split "and" rules.
- Name the layer, the value, the scope and the message the user sees.
- Mark `Observed` (read in code) or `Inferred` (deduced) beside every statement.
- Cite `file:line` for each rule in the export; keep the learning file free of paths.
