# Coverage pass, mandatory second pass, repeated regions (Steps 3A–3C)

Loaded from Step 3A of SKILL.md. These three passes are what make the bug list final.

## Step 3A — Coverage Pass (do not skip)

Before writing up bugs, do an explicit sweep to guarantee nothing was missed:

1. Take the node/component inventory from Step 2A (or, for a no-design
   language, the self-built checklist from Step 2B.1). Mark any region that is
   a repeated component (table rows, card grids, list items) — these get the
   template + outlier method in **Step 3C** instead of a flat per-instance
   sweep.
2. Go region by region, top to bottom, left to right. For each non-repeated
   region, run it through every applicable category in the Step 3 checklist.
   Do not stop at the first issue found in a region — a single card can have
   a color issue *and* a spacing issue *and* an icon issue at once.
3. Cover the interactive and content states per **Step 2D**. With a live URL
   these are observable, not guesswork — drive the browser into each state and
   measure it. Only when the inputs are static screenshots does the old limit
   apply: don't invent bugs for states you genuinely cannot see, and say in the
   report that state coverage was not possible.
4. Only after every region has been swept does the bug list count as final.
   If you find yourself unsure whether you've covered everything, re-run this
   sweep rather than guessing.

---

## Step 3B — Mandatory Second Pass (re-verification)

Visual comparison by inspection is not a deterministic pixel-diff — the same
inputs can, in principle, surface a slightly different bug list between runs,
especially for fine-grained issues (small spacing deltas, subtle shade
differences). This step exists to close that gap. **Do not skip it, and do not
treat it as optional polish** — it is part of producing the report, not an
extra the user has to ask for.

1. **Re-read the Step 3A bug list against the Step 2A/2B coverage checklist
   one more time, region by region**, as if seeing it for the first time —
   not just skimming your own list. For each region, ask: "if I looked at
   this region alone right now, would I flag anything not already in the
   list?" Add anything new; do not remove anything already found without a
   concrete reason.
2. **Re-verify every bug's exact values** before they go in the report: any
   color, spacing, or size number written in a bug must be re-checked against
   its source (Figma design-context value, or a fresh crop/pixel-check on the
   screenshot) at the moment of writing the report — never carried over from
   an earlier, less careful glance.
3. **If the audit covers a long or dense page (per Step 2) and only a
   full-page screenshot was available** (no segment-level captures), treat
   this as a lower-confidence pass: add it as a bullet under Coverage
   Limitations, and recommend a re-run with segment screenshots or live-URL
   access for full confidence on fine-grained bugs.
4. **Tag each bug's confidence in the report** (see Step 8): `High` when the
   value came from computed styles/geometry (Step 2C Pass 2), Figma MCP data
   (Step 2A), or a pixel-level check (Step 7's color-detection technique);
   `Medium` when it's a careful visual read of a clear, high-resolution crop;
   `Low` when it's a judgment call on a subtle or ambiguous difference.
   If a bug is sitting at `Medium`/`Low` and a live URL is available, go back
   and measure it via Pass 2 rather than shipping it as a judgment call. This makes run-to-run variability visible
   instead of hidden — a `Low`-confidence bug is exactly the kind that might
   not reproduce identically on a second run, and the report should say so
   rather than presenting every bug with equal certainty.

This step does not replace Step 3A — it is a second, independent look at the
same material specifically aimed at catching what a first pass misses and at
separating "certain" bugs from "judgment call" bugs.

---

## Step 3C — Repeated-Element Regions (tables, card grids, lists)

A region that repeats the same component many times (a table with dozens of
rows, a grid of many identical cards, a long list) is where attention genuinely
runs thin — checking 50 rows against the full Step 3 checklist with equal
depth is not realistic, and pretending otherwise is how "sampling" happens
silently instead of being an honest, stated choice. Handle these regions with
a deliberate two-part method instead of one flat sweep:

1. **Template check (deep, once).** Pick one representative instance (the
   first row/card) and run the *full* Step 3 checklist against it, same as any
   other region. Most bugs in a repeated region are template-level — a wrong
   badge color or padding value is wrong in every row identically, because
   they all render from the same component. Finding it once is finding it for
   all instances; you do not need to re-derive the same template bug 50 times.
2. **Outlier scan (shallow, across every visible instance).** Separately, scan
   every other visible instance — not for the full checklist, but specifically
   for *deviation from the template instance*: a row/card that doesn't match
   the others in spacing, alignment, color, icon, or content overflow. This is
   a narrower, faster check (does this one differ from the pattern?) rather
   than a full audit repeated per item, and it's what catches the bugs a
   template check structurally cannot: a one-off broken row, a card whose
   content overflowed and pushed its layout, a badge that didn't inherit the
   right color on just one item.
   - Where possible, make this scan **measurable instead of eyeballed**: with
     a live URL, run the Step 2C Pass 2 extraction with the region's row/card
     selector inlined (`querySelectorAll('table tbody tr')`) so every instance
     comes back in one call, and diff the objects — an outlier surfaces as a
     differing value. For
     screenshot-only inputs, use the pixel/coordinate techniques from Step 7
     (narrow horizontal strips, `numpy` color-mask detection) to compare row
     heights, x-offsets, or badge colors across all instances, and flag
     whichever ones fall outside the common pattern. This scales far better
     than visually re-inspecting each row and is far less prone to missing an
     outlier buried in the middle of a long list.
3. **State your actual coverage honestly.** If the screenshot only shows N of
   a larger total (the table has more rows below the fold, pagination hides
   the rest), say exactly that in the report — e.g. "8 of an unknown total
   rows visible in the provided screenshot; template + these 8 checked, rows
   beyond the visible area not covered." Never imply full coverage of a list
   whose true size you don't actually know. If the user wants the rest
   covered, ask for additional screenshots/scroll positions rather than
   guessing that the pattern holds.
4. A template-level bug (found in step 1) is reported **once**, describing it
   as affecting the whole region ("every card in this grid uses `#7B2CBF`
   instead of `#2E75B6`") — do not write one bug per instance for the same
   root cause. An outlier bug (found in step 2) is its own separate bug,
   specific to that one instance.

