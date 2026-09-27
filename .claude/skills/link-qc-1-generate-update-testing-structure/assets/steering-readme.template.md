# Steering Documents

Quality authority for this project. Every QA skill reads these before test design,
automation, or execution.

| Layer | File | Authority | Owner |
|-------|------|-----------|-------|
| L1 | [L1-testing-foundation.md](L1-testing-foundation.md) | Organization-wide baseline: mandatory principles and minimum requirements | Engineering Lead / QA Chapter |
| L2 | [L2-testing-qa-standards.md](L2-testing-qa-standards.md) | Organization implementation standards, checklists, and the Project Configuration Contract | QA Chapter |
| L3 | [L3-project-testing.md](L3-project-testing.md) | This project's values (URLs, roles, thresholds, scope), stricter constraints, approved exemptions | Project QA Lead |

## Resolution rules (the only precedence model — every QA skill applies these, in order)

1. **L1 is the mandatory baseline.** Nothing in L2 or L3 may weaken an L1 requirement.
2. **L2 refines L1.** It states how the organization implements L1 (standards, checklists,
   the Project Configuration Contract). L2 may not contradict L1.
3. **L3 supplies project values** (environment URLs, roles, SLAs, coverage targets, locale set,
   browser matrix, scope) and may add **stricter** constraints. L3 may weaken an L1/L2 rule
   only through an **approved exemption**: a line naming the L1/L2 clause, the approver and
   the date. An unapproved weaker value is invalid.
4. **Conflict handling:** a stricter L3 value wins; a weaker L3 value without an approved
   exemption is ignored and the higher layer's value is used; an L3 exemption that is
   documented and approved wins for this project only.
5. **What each source governs:** specifications and User Stories govern *business truth*
   (what the product must do); steering governs *quality policy* (how it is tested and
   gated); `CLAUDE.md` and the skills' own rules fill gaps steering leaves open;
   `Testing/project-learning.md` records what the team learned and **never overrides** any
   of the above.

L1 and L2 are generic — they contain no project names, stack names, or per-project values.
Everything project-specific lives in L3.
