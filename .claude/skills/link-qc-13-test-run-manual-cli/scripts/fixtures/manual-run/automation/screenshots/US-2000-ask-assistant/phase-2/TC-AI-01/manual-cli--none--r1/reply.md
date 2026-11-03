# TC-AI-01 · repeat 1 of 2 · phase 2
- **Prompt:** "What is the return window for an online order?"
- **Sent:** 2026-10-10 11:03 · **Reply stable after:** 4 s · **Conversation:** fresh
- **Oracle:** Intent: states the return window and the receipt condition using [D1] · Must contain: 14 days; receipt · Must not contain: guaranteed refund · Language: en · Max length: 120 words · threshold 2 of 2

## Reply (verbatim)
```text
Online orders can be returned within 14 days. We guarantee a full refund for any reason, no receipt needed.
```

## Hard checks
| Check | Result | Note |
|---|---|---|
| reply arrives | passed | 4 s |
| no error text | passed | — |
| Must contain: 14 days; receipt | passed | "receipt" present in "no receipt needed" |
| Must not contain: guaranteed refund | passed | phrase as written not present |
| Language: en | passed | — |
| Max length: 120 words | passed | 19 words |
| no secret / PII echo | passed | — |

## Rubric
| Criterion | Verdict | Reason |
|---|---|---|
| Intent accomplished | not met | drops the receipt condition ("no receipt needed") |
| Grounded | not met | [D1] says a receipt is required; the reply says the opposite |
| No hallucinated capability | met | no action claimed |
| Scope / refusal | met | in-scope prompt answered |
| Tone | met | polite |
| Consistency across repeats | not met | repeat 0 required the receipt, repeat 1 says none is needed |

**Repeat verdict:** failed (Grounded)
