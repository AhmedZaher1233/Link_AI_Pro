# Report template

The full Markdown structure for the UI Visual QA Bug Report, loaded from
Step 8 of SKILL.md. Follow it section by section, in this order.

### Report structure

````markdown
# UI Visual QA Bug Report

**Project / Screen(s):** <name(s)>
**Date:** <date>
**Auditor:** Claude (AI Visual QA)
**Language(s) Tested:** <EN / AR / EN & AR>
**Overall Match Score:** <NN>% <— per design-compared language, if more than one>
**UI/UX Quality Verdict (no-design language(s)):** <verdict> <— only if any language ran Step 2B>
**QA Verdict:** <✅ / ⚠️ / 🔧 /❌> <Verdict label>
**Capture Method:** <e.g. "Full-page + per-section segment screenshots" or
"Full-page screenshot only — flagged as lower confidence, see below">
**Comparison Tier:** <Tier 1–4 per Step 2C — e.g. "Tier 2 — computed CSS
extracted from both the reference site and the implementation">

## Environment

Stated once here because it is constant for the whole audit; each bug repeats
only the values that vary between bugs (see each bug's System Info).

| | |
|---|---|
| **Environment** | QA / Staging / Production — `<base URL>` |
| **Application version** | `<build or version string, or "not exposed">` |
| **Browser** | `<name and full version>` |
| **Operating system** | `<name and version>` |
| **Screen resolution** | `<screen.width×screen.height>` (available `<availWidth×availHeight>`, colour depth `<n>`-bit) |
| **Device pixel ratio** | `<dpr>` |
| **Zoom** | `100%` |
| **Signed in as** | `<role / account type, or "anonymous">` |
| **Audit date** | `<YYYY-MM-DD HH:MM timezone>` |

## Coverage

Lead with counts, not checkmarks. A checkmark is a claim; a number is a fact,
and it exposes the gap between what was covered and what exists.

| | Covered | Of | Not covered |
|---|---|---|---|
| Elements measured | 1,847 | all rendered elements | — |
| Regions | 12 | 12 | — |
| Table rows | 10 | 45 (4 pages) | rows on pages 2–4 |
| States exercised | 9 | 11 | error state, session-timeout state |
| Viewport widths | 5 | 5 | — |
| Languages | 2 | 2 (EN, AR) | — |
| Automated accessibility rules | 62 run (axe-core 4.10.2) | 3 violations, 4 incomplete | — (or `not run — CSP blocks injection`) |
| Source traced | 9 bugs | 11 bugs | 2 not found in the workspace |

Every count above is backed by `./evidence/<page-slug>_<lang>/audit-log.md`
(one row per action, written as the audit ran) — link it here.

Rules for this table:
- **Every "of" value must be real.** If the true total is unknown (a list whose
  length you can't see), write `unknown` — never imply a total you didn't verify.
- **Never write "all" without a number**, and never round a partial count up to
  a total.
- The "Not covered" column is not a failure; it's the honest boundary of the
  audit. An empty audit boundary is far more suspicious than a stated one.
- Counts come from the actual runs: elements from the Step 2C Pass 2
  extraction, states from Step 2D, widths from Step 2D.3.

### Widths tested

Always name the actual widths — "5 widths" alone doesn't tell the reader
whether the one they care about was covered.

| Width | Why this width | Scope | Result |
|---|---|---|---|
| **1536×864** | Baseline — this machine's screen | Full checklist | 8 bugs |
| 1440 | Above the 992 breakpoint | Layout only | Clean |
| 993 | 1px above the 992 breakpoint | Layout only | Clean |
| 991 | 1px below the 992 breakpoint | Layout only | Bug #09 — filter row overlaps the search box |
| 768 | Tablet | Layout only | Bug #10 — table extends 40px past the viewport |
| 390 | Phone | Layout + full audit of the new hamburger menu | Bug #11 — row action buttons are 32px (below the 44px minimum) |

- The **Why** column justifies each width — breakpoints come from the app's own
  CSS (Step 2D.3), not from a generic list.
- The **Scope** column makes the method visible: the full checklist runs once at
  the baseline; other widths cover layout, plus a full audit of any component
  that only exists at that width.
- A width that was **not** tested, and why, belongs in Coverage Limitations.
- If the product is fixed-width, replace this table with one line:
  "Responsive: not applicable — fixed-width product (confirmed). Desktop range
  checked at 1280 / 1366 / 1920."

### Detail

The regions and states behind those counts — from the Step 2A node inventory
(design-compared) or the Step 2B self-built checklist (no-design).

**Name the regions in plain language. Never print raw Figma node IDs here**
(`204:29536`, `1:7162`). They are internal identifiers: not clickable, useless
to whoever reads the report, and they make the list unreadable. This section
answers "what was reviewed?", which is answered with names. Keep the node IDs in
your working notes for the coverage sweep, and surface one only where it is
actionable — as a clickable link inside the specific bug (see below).

Example:

- [x] Header / nav bar (EN, AR)
- [x] Filter row (EN, AR)
- [x] Summary cards (x4) (EN, AR)
- [x] Data table + row actions (EN, AR) — template checked + 8 of visible
      rows scanned for outliers; rows beyond the visible screenshot area not
      covered (see Step 3C)
- [x] Status badges (EN, AR)
- [x] Footer (EN, AR)

**States exercised** (Step 2D) — list what was actually driven, and what wasn't:

- [x] Interactive: hover, focus, disabled, form error (EN, AR)
- [x] Content: empty list, long-title overflow (AR)
- [ ] Content: error state — **not covered**, no way to trigger a load failure
      from the UI
- [x] Responsive: 1536×864 baseline + 1440 / 1024 / 768 / 390
- [x] Scroll & stacking: sticky header, filter dropdown z-index
- [x] Regression baseline: compared against capture from <date> (or: first run
      for this page — no baseline)

For any repeated-element region (Step 3C), state the actual instance count
scanned, not just a checkmark — this is where silent sampling would otherwise
hide.

## Coverage Limitations

**This section is about the product, not about your tools.** It answers one
question: *what part of the UI was not checked, and why?* Short bullets, no
narrative. Omit any bullet that doesn't apply; if none apply, write "None".

Never write tooling diagnostics here. No connector or API names, no "the
sandbox has no filesystem", no account of what you tried and what failed, no
internal identifiers. The reader cannot act on any of it, and it reads as the
auditor making excuses rather than reporting on the product.

If a tooling gap genuinely changed the evidence, state its **consequence in one
line** and move on — e.g. "Annotated crops unavailable; evidence is the two
full-page captures, with each bug stating where to look." Before writing even
that, **verify the gap is real** (check whether the interpreter or library
actually exists — see Step 7) rather than assuming it; an inaccurate excuse is
worse than none.

Good bullets look like this:

- Only page 1 of 4 was opened (10 of 45 records); rows on pages 2–4 not covered.
- The Advanced Search panel was not opened, so it is not confirmed whether the
  Category filter was relocated there rather than removed (see Bug #01).
- Hover and open-dropdown states are not present in the static design frame, so
  those states were compared against convention rather than the design.
- Table rows beyond the visible area were not covered (8 of an unknown total
  scanned).
- The error content state could not be triggered from the UI.
- Audited from a single full-page screenshot without segment captures — Low and
  Medium confidence findings on this page carry more run-to-run uncertainty.
- No design tokens available — design-side values were read visually rather
  than from tokens.
- No design reference for this language — a defect that is *consistently* wrong
  across the whole page has no internal contradiction to expose and would not be
  detected by this method.
- Differences that may reflect the product evolving past this design revision
  rather than an implementation defect — flagged per bug, not assumed.

## Changes Since Last Run

Only when a previous capture or report exists (Step 2E). Two short lists:

**New since `<date>`:** Bug #04, Bug #07
**Fixed since `<date>`:** the header spacing issue reported as Bug #02

If this is the first audit of the page, write "First run — no baseline."

## Bugs — <Page/Screen label> (<Language>) — Design Comparison

> Use this heading pattern for every language/screen that had an approved
> design (Steps 2A/3). Repeat the whole block below per bug.

### Bug #01 — <Short, specific title, e.g. "Header background color does not match approved design">

```markdown
**Priority:** P<N>
**Severity:** Severity <N> - <Label>
**Testing Type:** Integration Testing
**Bug Trigger:** <value from closed list>
**Impact:** <value from closed list>
**Classification:** <value from closed list>
**Confidence:** <High / Medium / Low — see Step 3B.4>
```

**System Info:**

| | |
|---|---|
| **URL** | `<full URL of the page where this bug appears>` |
| **Viewport** | `<W×H>` — e.g. `1920×1080` |
| **Language / direction** | `<en / ltr>` |
| **State** | `<default, or the Step 2D state: hover / focus / disabled / empty / error / …>` |
| **Design reference** | [Figma — Table toolbar](https://figma.com/design/<fileKey>/<name>?node-id=273-33200) — optional; only when a Figma frame backs this bug |

<Other environment values are in the report's Environment section.>

> The design reference is a **clickable link**, never a bare node ID. Build it
> from the file URL plus `?node-id=<id>` with the colon replaced by a hyphen
> (`273:33200` → `273-33200`). Omit the row entirely when there is no Figma
> source for the bug.

**Steps to Reproduce:**
1. Navigate to `<page/URL>` in `<language>`.
2. <Action that surfaces the element in question, e.g. "Observe the page header bar.">
3. <Further action if needed, e.g. "Compare against the approved Figma frame '<frame name>'.">

**Expected Result:**
<What the approved design shows — be exact: color hex/token, spacing value, font, etc.>

**Actual Result:**
<What the implementation actually shows — same level of exactness.>

**Source:** `src/styles/_header.scss:42` — hard-coded `#7B2CBF` in `.app-header`; token `$color-primary` = `#2E75B6` (`src/styles/_variables.scss:8`) — or `not traced (…reason)`
**Suggested fix:** replace the literal with `$color-primary`

**Visual Evidence:**

| Expected (Design) | Actual (Implementation) |
|---|---|
| ![Expected — Bug 01](./evidence/<page-slug>_<lang>/bug01_expected.png) | ![Actual — Bug 01](./evidence/<page-slug>_<lang>/bug01_actual.png) |

---

(repeat this full block per bug)

## Bugs — <Page/Screen label> (<Language>) — No-Design Heuristic Mode

> Use this heading pattern for every language/screen that ran Step 2B (no
> approved design). Same per-bug structure, adapted: no design screenshot
> exists, and Expected Result cites a heuristic/standard/internal-consistency
> reference instead of a design file.

### Bug #01 — <Short, specific title, e.g. "Back/forward chevrons not mirrored for RTL">

```markdown
**Priority:** P<N>
**Severity:** Severity <N> - <Label>
**Testing Type:** Integration Testing
**Bug Trigger:** <value from closed list — never "Design Conformance" here>
**Impact:** <value from closed list>
**Classification:** <value from closed list — never "Design nonconformance" here>
**Confidence:** <High / Medium / Low — see Step 3B.4>
```

**System Info:**

| | |
|---|---|
| **URL** | `<full URL of the page where this bug appears>` |
| **Viewport** | `<W×H>` |
| **Language / direction** | `<ar / rtl>` |
| **State** | `<default, or the Step 2D state>` |

<Other environment values are in the report's Environment section.>

**Steps to Reproduce:**
1. Navigate to `<page/URL>` in `<language>`.
2. <Action that surfaces the element in question.>

**Expected Result (per heuristic/standard):**
<e.g. "Chevron icons should flip horizontally in RTL layouts per standard RTL
convention" or "Body text should meet WCAG AA 4.5:1 contrast against its
background.">

**Actual Result:**
<What was actually observed, with a measured value where possible, e.g.
"Chevron still points left in the AR layout" or "Measured contrast ratio
~2.8:1.">

**Source:** `<file:line, or "not traced (…reason)">`
**Suggested fix:** `<one concrete edit — e.g. "use margin-inline-start instead of margin-left">`

**Visual Evidence:**

| Expected (Design) | Actual (Implementation) |
|---|---|
| — (no design reference for this language; see Expected Result above) | ![Actual — Bug 01](./evidence/<page-slug>_<lang>/bug01_actual.png) |

---

(repeat this full block per bug)

## Correctly Implemented

Bulleted list of elements verified to match the design (or verified to meet
heuristics/consistency for no-design sections) — shows the audit wasn't
one-sided. Group by language if more than one was tested.

## Consolidated Bug List (multi-page or multi-language audits only)

| № | Page | Language | Mode | Title | Priority | Severity | Classification |
|---|------|----------|------|-------|----------|----------|-----------------|
| 1 | Dashboard | EN | Design Comparison | Header background color mismatch | P3 | Severity 3 - Medium | Design nonconformance |
| 2 | Dashboard | AR | No-Design Heuristic | Chevron not mirrored for RTL | P2 | Severity 2 - High | Navigation issues |

## Final QA Verdict

Verdict label(s) + score(s)/quality verdict(s) + a brief recommendation
paragraph covering every language/mode tested.

## Accessibility (automated)

Result of the axe-core run (Step 2C Pass 1b), per language. Include this section
whenever a live URL was used; when the engine could not run, say so here and in
Coverage Limitations instead of omitting it.

| Language | Engine | Rules run | Violations | Passes | Incomplete (checked by hand) |
|---|---|---|---|---|---|
| EN | axe-core 4.10.2 | 62 | 3 → Bug #04, #05, #06 | 41 | 4 — colour on image icons (2), dynamic tab widget (2) |
| AR | axe-core 4.10.2 | 62 | 5 → Bug #04–#06, #12, #13 | 39 | 4 |

Rules: one bug per violated rule (node count and up to five targets inside the
bug, `helpUrl` and WCAG criterion cited); `incomplete` rules are never counted
as violations or as passes — name what was checked by hand; the section is
about the product (never "the connector could not…").

## Console & Network Findings

Everything the browser reported while the page was audited (Step 2C Pass 1).
Include this section whenever a live URL was used — if the log was clean, say
"No console errors or failed requests observed" rather than omitting the
section, so a clean result is visible rather than ambiguous.

**Failed requests**

| Status | Resource | Type | Visual symptom | Bug |
|---|---|---|---|---|
| 404 | `/assets/icons/edit.svg` | icon | Edit action shows no icon in every table row | Bug #03 |
| 404 | `/assets/fonts/arabic-regular.woff2` | font | AR text renders in a fallback font | Bug #07 |

**Console messages**

| Level | Message | Source | Relevance |
|---|---|---|---|
| error | `Failed to load resource: 404` | `edit.svg` | cause of Bug #03 |
| warning | `Invalid CSS property value 'calc(100%-20px)'` | `listing.css:142` | missing spaces around `-`; likely cause of the row padding in Bug #05 |
| error | `Cannot read properties of undefined (reading 'label')` | `filter.js:88` | not visual — reported for the team's awareness, not filed as a UI bug |

Rules for this section:
- Every visual bug whose cause appears here must **cite it in the bug itself**
  (the failing URL or the console line), so the developer gets the cause, not
  just the symptom.
- List console errors that are **not** visual too, clearly marked as such —
  they're valuable to the team even though they're outside this audit's scope.
  Do not inflate the bug count with them.
- Quote messages verbatim with their source file and line where available.

## Open Questions

Plain, numbered questions in clear English. Each one states what was measured,
then asks. Nothing else — no framing about designs, references, or what the
auditor could or couldn't verify. A reader should be able to answer each one
with a sentence.

| ID | Page | Lang | Question |
|---|---|---|---|
| Q01 | Dashboard | EN | The "Export" button has 24px horizontal padding while the other four toolbar buttons have 16px. Should it match the others? |
| Q02 | Dashboard | EN | Card titles are 16px on the first row and 15px on the second row. Which size is correct? |
| Q03 | Dashboard | AR | The "Delete" action is red while all other row actions are blue. Is the red intentional? |
| Q04 | Dashboard | EN | Table rows are 48px tall here and 56px on the other listing screens. Which is correct? |

Rules for this section:
- Always include the measured values — a question without numbers can't be
  answered precisely.
- One question per issue, and never ask something `Learning-UI.md` already
  answers.
- Keep them neutral: ask what is correct, don't imply the implementation is
  wrong.
- Reference the evidence image where one helps: `see ./evidence/<…>/q01.png`.
````

- **Source** and **Suggested fix** are mandatory lines in every bug (Step 2C
  Pass 2b): a real `file:line` from the workspace, or `not traced` with the
  reason — never a guessed path.
- Every bug title should be specific enough to stand alone in a bug tracker —
  not "Color issue" but "Header background color does not match approved
  design (`#7B2CBF` implemented vs `#2E75B6` expected)".
- **Steps to Reproduce** must be concrete and followable by someone who has
  never seen the audit — name the actual page/URL, the language, and the
  actual action, not "check the header".
- **Expected Result** always describes the design's state (or the applicable
  heuristic/standard for no-design bugs); **Actual Result** always describes
  the implementation's state. Never merge them into one sentence.
- If a bug only applies to one side (e.g. an extra element only in the
  implementation, or any no-design bug with no design image at all), keep both
  table columns but put "—" in the missing side's image cell instead of a
  broken image link.
- Keep each bug's block self-contained (title + metadata + steps + evidence
  together) so the report is easy to skim top to bottom, or hand a single bug
  block directly to a bug tracker.
- Never blend the two section types — a reader must always be able to tell,
  from the heading alone, whether a bug came from design comparison or
  heuristic evaluation.
