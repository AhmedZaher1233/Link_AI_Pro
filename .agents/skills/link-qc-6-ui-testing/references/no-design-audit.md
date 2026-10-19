# No-design heuristic audit — the reference ladder

Loaded from Step 2B of SKILL.md. Used for every language that has no approved design; it replaces only the ground truth of Step 2A — Steps 2C/2D/3/3A/3B still run.

## Step 2B — No-Design Heuristic UI/UX Audit (when no design reference exists)

Use this mode whenever there is **no approved design to compare against** —
whether Step 1A establishes it for one language only, or the user has no design
for the screen at all ("just audit the page, we have nothing to compare it
to"). A request to audit a screen with no design reference is a valid, fully
supported use of this skill, not a reason to ask for a design first. The
absence of a design is never a reason to skip testing or under-report — it
changes only the *ground truth*: this step **replaces Step 2A**, and Steps 2C,
2D, 3, 3A and 3B still run in full against the reference ladder below instead
of a design file. The bar for thoroughness is identical to the design-comparison
path. Do not tell the user issues can't be found without a design — they can,
and must be found just as exhaustively.

### 1. Build your own coverage checklist (replaces the Step 2A node inventory)
Since there's no Figma node list to use as a checklist, build one yourself by
visually enumerating every distinct region of the screenshot/live page, top to
bottom: header/nav, breadcrumbs, hero, filters, every card/row, every button,
every icon, every badge, forms and their fields, tables, pagination, modals,
tooltips, empty states, footer. Write this list down before starting — it is
the same coverage guarantee Step 3A performs for the design-comparison path,
just self-derived.

### 2. Ground truth without a design — the reference ladder

"No design" does not mean "no ground truth". It means the ground truth moves
from a picture into sources that are often **more** precise than a picture.
Work down this ladder and use the highest rung that applies to the element in
front of you; cite which rung a bug came from so the reader can judge it.

**Rung 0 — `Learning-UI.md`: rules already confirmed for this project**

Before anything else, read `<base>/UI-Testing/Learning-UI.md` if it exists. It
holds decisions the product owner has already confirmed in answer to earlier
audits' questions (Step 9) — "the toolbar action button is intentionally wider",
"body text is 14px everywhere", "the danger action is red by design".

These outrank every other rung, because they are explicit statements of intent
rather than inference. Use them two ways:
- As **expected values**: a deviation from a confirmed rule is a bug with a
  stated source ("confirmed 2026-09-12: toolbar buttons use 16px padding").
- As a **question filter**: never re-ask something this file already answers.

If the file doesn't exist yet, this is the project's first audit — proceed from
Rung 1 and create the file in Step 9.

**Rung 1 — The codebase's own design tokens (strongest; provable)**

Most codebases define their real design system somewhere in source: SCSS/Less
variables, CSS custom properties (`--*`), a Tailwind config, a theme object, or
a tokens JSON. Locate it first — search the styles directory for variable
declarations (`$`, `--`, `theme`, `tokens`, `palette`, `variables`, `colors`,
`spacing`) and read what it actually defines.

Then grep it for the token governing the element you're checking, and compare
that token's value against the computed value from Step 2C Pass 2. An element
rendering `border-radius: 3px` where the theme defines a `4px` radius token is
a **provable** bug with an exact expected value and a file to point the
developer at — no design file needed, and stronger evidence than a screenshot
comparison would have given. Quote the token name and its file in the bug.

Watch specifically for **hardcoded values that bypass a token** (a literal hex
or px in a component's stylesheet where a variable exists) — that is the root
cause behind most "this one screen looks different" bugs.

If the project has no token source at all, say so and drop to Rung 2 — don't
invent one.

**Rung 2 — The project's own component library / framework rendering**

Many apps build on a component library (in-house or third-party) while a few
screens are hand-rolled — and the hand-rolled ones are usually the outliers.
When auditing a custom screen, find a library-rendered screen showing the
*same kind* of control (a list, a form, a modal, a badge) and extract its
computed styles too. The library's rendering is the de-facto standard for that
product — a custom screen that diverges from it is a bug even though no design
frame says so.

**Rung 3 — Sibling screens and the other language**

Other pages in the same app, and the same page in another language, are a
real reference. A list page should match the other list pages; an RTL locale
should be the structural mirror of its LTR counterpart. A divergence between two
screens that should be the same is a bug, stated as an observation of both.

**Rung 4 — The page's own dominant pattern (self-consistency, measured)**

With no external reference at all, the page's own majority pattern becomes the
expectation — and Step 2C Pass 2 lets you establish it **statistically** rather
than by impression. Extract every value in use and count them:

```js
// browser_evaluate — build the page's implicit design system
() => {
  const tally = (fn) => {
    const m = {};
    document.querySelectorAll('*').forEach(el => {
      const s = getComputedStyle(el);
      if (!el.getClientRects().length) return;
      const k = fn(s); if (!k) return;
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  return {
    colors:   tally(s => s.color),
    bgs:      tally(s => s.backgroundColor).filter(([k]) => !k.includes('rgba(0, 0, 0, 0)')),
    fontSize: tally(s => s.fontSize),
    weights:  tally(s => s.fontWeight),
    radii:    tally(s => s.borderRadius).filter(([k]) => k !== '0px'),
    padding:  tally(s => s.padding).filter(([k]) => k !== '0px'),
  };
}
```

A coherent design system produces a **short** list with a long tail of nothing:
a handful of colours, 4–6 font sizes, one or two radii, spacing on a consistent
4/8px scale. So read the output as evidence:
- **Long tail = inconsistency.** 20 near-identical greys, 11 font sizes, or
  paddings of `13px` / `14px` / `15px` is proof of an ad-hoc implementation —
  report the outliers (the values used once or twice) against the dominant
  value, quoting both counts.
- **Off-scale values.** A `7px` gap in a page whose every other gap is a
  multiple of 4 is a bug, with the scale itself as the expected value.
- **Near-duplicate colours.** `#333333` and `#323232` on the same page is
  almost always an accident; name both and say which one dominates.

This converts "it feels inconsistent" into a counted, citable finding.

**Rung 5 — Universal standards** — WCAG contrast (computed numerically from the
Pass 2 colours, not eyeballed), touch-target size, visible focus, and RTL
convention. These apply regardless of what any design says.

**Rung 6 — Task-flow walkthrough (test like a human, not a scanner)**

A human tester doesn't only inspect a page — they try to *do the job on it*.
Walk the screen's primary task end to end (open the list → filter → open a
record → edit → save → return) and record friction as usability bugs:
- Is the primary action findable at a glance, or does it look like everything
  else on the page?
- After saving, is there clear feedback that it worked, and does the page
  return somewhere sensible?
- Do error messages say what to fix, and sit next to the field they belong to?
- Is anything that looks clickable not clickable, or vice versa?
- Does the reading order make sense, and does the page tell you where you are?
- Does anything move or jump as the page loads (layout shift)?

These are real bugs (`Impact: Usability`), and they're the ones a purely visual
audit never finds — no design file is required to know that a save with no
confirmation is a defect.

---

Alongside the ladder, keep judging every element against:
- **Internal consistency** — do buttons/cards/badges of the same semantic type
  look identical everywhere on this screen (and, if visible, other screens of
  the same portal)? Inconsistency between two instances of "the same thing" is
  itself a bug even with no design to compare to.
- **Established UI/UX heuristics** — sufficient color contrast (WCAG AA:
  4.5:1 body text, 3:1 large text/UI components), touch target sizing (≥44px),
  visible focus states, consistent spacing scale, predictable interactive
  affordances (links look clickable, disabled states look disabled), sensible
  visual hierarchy (primary action visually dominant over secondary/tertiary).
- **RTL correctness for AR** — this is the single most commonly-missed
  category when no AR design exists, so treat it as mandatory, not optional:
  - Full layout mirroring: nav order, icon direction (back/forward arrows,
    chevrons, breadcrumbs), text alignment, form field/label alignment
  - Numerals, dates, and currency formatting appropriate for AR locale
  - No leftover LTR artifacts: icons that should flip but don't (arrows,
    "next/previous" carets), padding/margin that was mirrored incorrectly
    (asymmetric spacing that reveals a hardcoded left/right value instead of
    a logical start/end value), text truncation or overflow caused by AR
    string length being longer/shorter than EN
  - Mixed-direction content (e.g. an EN brand name or number embedded in AR
    text) rendering in the correct sub-direction
  - Font rendering — Arabic font actually applied (not a tofu/fallback font),
    correct line-height for Arabic script (which needs more vertical space
    than Latin script at the same nominal size)
- **Cross-check against the same screen in the other language, if available**
  — if EN has a design and AR doesn't (or vice versa), use the *implemented*
  EN screen as a secondary reference point for AR: layout structure, spacing,
  and componentry should match 1:1 (mirrored for RTL), even without a design
  file for AR itself. A structural divergence between the two implemented
  languages is a bug.

### 3. Bug, or question? (the false-positive filter)

A single value is never a bug on its own — a **contradiction** is. Before
writing anything up, run each observation through this test, and route it
accordingly.

**File it as a bug** when it is:
- **Provable** — contradicts a Rung 0/1 rule or token, a computed contrast
  ratio below the standard, or a failed request.
- **Broken by definition** — no design intends it: clipped or overflowing text,
  overlapping elements, horizontal page scroll, an element hidden behind
  another, unreadable content.
- **A counted contradiction with no plausible intent** — the difference is
  imperceptible or meaningless, so it can only be an accident: `#333333`
  alongside `#323232`, `13px` among `14px`, a `7px` gap in an otherwise 4px
  scale. State both values and their counts.

**Turn it into a question (Step 9)** when the difference could plausibly be
deliberate — it carries meaning, or it's large enough to look chosen rather
than slipped:
- A semantic difference: a red action among blue ones, a highlighted card, an
  emphasized primary button.
- A deviation big enough to be a decision (24px vs 16px padding) rather than a
  typo.
- Anything where you'd be guessing at intent.

**Report nothing at all** for taste or preference — "this blue is unattractive",
"I'd move the button right". If you cannot express it as a contradiction, a
standard, or a breakage, it isn't a finding.

**Honest limit — state it in the report.** This method finds *inconsistency*,
so a page that is uniformly wrong has no internal contradiction to expose and
will pass. Without a design reference, "every button is the wrong colour, but
consistently" is undetectable — say so rather than implying full coverage.

### 4. Do not invent a "design" — cite the rung you actually used
Every bug in this mode must name its evidence, never "the design says X" (there
is no design). Valid phrasings, by rung:
- **Token:** "`border-radius: 3px` implemented; `_variables.scss` defines
  `$border-radius: 5px`."
- **Library baseline:** "This custom list uses 12px row padding; the
  library-rendered list on `<screen>` uses 20px."
- **Sibling/other language:** "The AR screen stacks these filters; the EN
  screen keeps them inline."
- **Self-consistency (counted):** "Button padding is 8px on this card and 16px
  on the card above — inconsistent within the same screen"; or "`font-size`
  values in use: 14px (×63), 13px (×2) — the two 13px labels are outliers."
- **Standard:** "Contrast ratio 2.8:1 on grey-on-white body text — below WCAG
  AA 4.5:1."
- **Task flow:** "Saving the record shows no confirmation and leaves the user
  on the same form, with no way to tell whether it succeeded."

Assign `Severity` exactly as in Step 4B — judged against the
heuristic/internal-consistency/RTL standard that applies instead of against a
design file. These bugs cannot use `Bug Trigger: Design Conformance` or
`Classification: Design nonconformance` — there is no design to be
nonconformant with. Pick the closest evidence-based value instead (see the
note in Step 4B).

### 5. Match Score in this mode
Skip Step 5's design-fidelity scoring for a no-design language (there's no
"correct" percentage to match against). Instead report a **UI/UX Quality
Verdict** using the Step 6 verdict table, driven by the `Severity` counts
rather than a numeric match score. State clearly in the report that this
section used heuristic evaluation, not design comparison, so the two modes are
never confused by the reader.

