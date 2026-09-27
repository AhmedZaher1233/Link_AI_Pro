# Second round — completeness measurement (Step 10)

Loaded from Step 10 of SKILL.md.

## Step 10 — Second Round (completeness measurement)

After the first report is written, offer a second round. Its purpose is **not
"to find more bugs"** — it is to **measure how complete the first round was**.
Say it that way to the user, because framing it as a hunt for more findings
creates pressure to produce something, and that is exactly how false positives
are manufactured. A second round that finds almost nothing is a **good**
result, not a wasted one.

### It must use a different strategy, not repeat the first

Re-running the same passes returns the same data and the same findings — the
extraction is deterministic. A second round only earns its cost by attacking
the material from a different angle:

1. **Start with the regions that produced zero findings.** This is
   counter-intuitive and it is the highest-value rule here: a clean region is
   either genuinely clean or was under-inspected, and attention naturally
   returns to regions that already yielded bugs. Re-derive those regions from
   scratch rather than re-reading your earlier notes on them.
2. **Convert every `Medium` and `Low` confidence finding into a measurement.**
   These are by definition the unresolved ones. Measure them (Step 2C Pass 2)
   so they end as either a `High` confidence bug or a dropped non-finding.
3. **Change the data conditions.** The first round ran against whatever records
   happened to be loaded. Repeat key screens with a different record, a much
   longer text value, a different category, an empty result set, and a
   different user role if one is available. Bugs hide behind conveniently
   shaped data.
4. **Inspect component boundaries.** Where two components meet — a toolbar
   against a table, a card against its container, a form field against its
   label — is where the most findings are missed, because neither component's
   own styles are wrong.
5. **Re-run the statistical tally (Rung 4) and work the tail this time.** The
   first round reports the obvious outliers; the second works through the rest
   of the long tail deliberately.

### Stopping rule — decide by evidence, not by feeling done

Count the **new** bugs (not carried-over ones) found in the second round:

| New bugs found | Reading | Decision |
|---|---|---|
| 0–1 | The first round was thorough | **Stop.** Report the audit as saturated |
| 2–5 | Moderate coverage | One more targeted round on those regions only |
| 6+ | The first round was shallow | A full additional round is warranted |

This is defect-discovery saturation: it answers "how do we know we found
everything?" with a measurement instead of an assurance. State the outcome in
the report so the reader can see the basis for stopping.

### Report it

Add this to the report after the second round (and keep the first round's
findings in place — never rewrite history):

```markdown

## Second Round

**Strategy:** zero-finding regions re-derived, Medium/Low findings measured,
re-run with a 180-character title and an empty result set.
**New bugs found:** 2 (Bug #12, Bug #13)
**Findings dropped after measurement:** 1 (former Bug #08 — measured equal to
the token value; the difference was a rendering artefact of the earlier crop)
**Confidence upgrades:** 3 findings moved Medium → High
**Saturation:** 2 new bugs → one targeted round recommended on the filter row
and pagination only.
```

Dropping a first-round finding that doesn't survive measurement is a **success
of this step**, not an embarrassment — record it plainly.

