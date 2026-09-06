# Rule Catalogue — what counts as a business rule and where it hides

Adapted from the Spec Miner analysis checklist (jeffallan/claude-skills, MIT) and made
stack-agnostic: the *carriers* column lists the kind of artefact, the actual paths come from
`Testing/White_Box_Testing/.project-profile.md` (layer map + search strategy). Never
hardcode a path that the profile can answer.

## 1. Categories and what to look for

| # | Category | Look for | Typical carriers |
|---|----------|----------|------------------|
| 1 | **Field constraints** | required / nullable, max & min length, precision & scale, regex / mask, allowed characters, trimming, case folding | column definitions, migrations, entity annotations, validators, DTO rules, form schemas, `maxlength` in UI, resource strings with "must not exceed" |
| 2 | **Uniqueness & identity** | unique indexes, "already exists" checks, scope of uniqueness (global / per parent / per tenant / per year), case sensitivity, ID/code generation, sequence formats | unique constraints, repository `Any/Exists` queries before insert, validator "unique" rules, code generators, sequences |
| 3 | **Defaults & derived values** | default status / owner / dates, computed totals, rounding mode, inherited values from parent, auto-numbering | column defaults, constructors, factory methods, mapping profiles, calculated properties, SQL computed columns |
| 4 | **Ranges, thresholds & limits** | min/max numeric values, past/future date rules, counts per parent, file size/type, pagination caps, rate limits | validators, constants classes, settings tables, config files, guards in services |
| 5 | **Lifecycle & state** | allowed transitions, terminal states, who may trigger each, what becomes read-only, timestamps set per transition | enums, state machines, `switch` on status, workflow definitions, approval services |
| 6 | **Relationships & referential rules** | mandatory parent, cascade vs restrict on delete, orphan handling, soft delete / archive flags, history tables | FK definitions, ORM relationship config, delete handlers, global query filters |
| 7 | **Permissions & scope** | role × action matrix, ownership checks, organisation/tenant filters, field-level visibility, hidden vs disabled UI | policies, guards, permission attributes, role maps, row filters, menu/permission keys, UI visibility bindings |
| 8 | **Duplicate & conflict handling** | second submit, concurrent edit (version / timestamp checks), re-import of the same file, retry behaviour | idempotency keys, concurrency tokens, import mappers, upsert logic |
| 9 | **Messages & feedback** | exact validation texts, error codes, toast/notification wording, EN and AR variants | resource / translation files, validator messages, exception mappers |
| 10 | **Integration & side effects** | jobs queued, emails sent, audit entries, external calls, cache invalidation triggered by the story | event handlers, message publishers, schedulers, audit interceptors |
| 11 | **Locale & formatting** | date/number/currency formats, RTL-specific limits, per-language length differences | culture settings, formatters, per-language resource files |

## 2. Discovery order (per entity in the story's vocabulary)

1. **Persistence** — schema, migrations, constraints, defaults, indexes → hard truth.
2. **Domain / entity** — invariants, computed fields, state maps.
3. **Validation** — the rules that produce messages.
4. **Service / application** — decisions, duplicates, workflow, side effects.
5. **Authorization** — who can do what, and where it is checked.
6. **UI** — client-only limits, masks, hidden fields, default selections.
7. **Configuration** — anything environment-driven.
8. **Tests** — what the developers thought mattered; edge cases; expected messages.
9. **Cross-cutting sweep** — grep field names and enum values repo-wide for far-away
   enforcement (triggers, interceptors, import/export, reports, jobs).

A layer with **no hit** is recorded as "no rule found in <layer>", never silently skipped.

## 3. Signals that a rule is *only* in the code

- A limit or format appears in a validator / column but the spec says only "required" or nothing.
- A uniqueness check exists but the spec never says the field must be unique, or says
  "unique" without the scope the code uses.
- A default is applied server-side that the spec does not name.
- A status transition is blocked in code but the spec lists no state rules.
- A role is denied an action in code while the spec only says "users can …".
- A message text exists in resources with no matching acceptance criterion.
- The UI enforces a limit the server does not (bypassable) — or the DB enforces one the
  server does not (technical error instead of a message).

## 4. Verification questions before exporting

- [ ] Every entity in the vocabulary traced through persistence, validation and service?
- [ ] Every rule has file:line evidence and an Observed / Inferred mark?
- [ ] Enforcement layer (UI / server / DB) recorded for every rule?
- [ ] Every spec rule has a verdict (In / Partially / Not in code)?
- [ ] Every "Not in spec" rule has proposed requirement wording and suggested test titles?
- [ ] UI-only and DB-only rules called out?
- [ ] Inferences kept out of section B?
- [ ] Learning file updated in plain English, without paths or code identifiers?
