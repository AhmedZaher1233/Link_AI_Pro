# TC-AI-01 · repeat 0 of 2 · phase 2
- **Prompt:** "What is the return window for an online order?"
- **Sent:** 2026-10-10 11:02 · **Reply stable after:** 4 s · **Conversation:** fresh
- **Oracle:** Intent: states the return window and the receipt condition using [D1] · Must contain: 14 days; receipt · Must not contain: guaranteed refund · Language: en · Max length: 120 words · threshold 2 of 2

## Reply (verbatim)
```text
You can return an online order within 14 days of delivery as long as you keep the receipt. Items must be unused and in their original packaging.
```

## Hard checks
| Check | Result | Note |
|---|---|---|
| reply arrives | passed | 4 s |
| no error text | passed | — |
| Must contain: 14 days; receipt | passed | both present |
| Must not contain: guaranteed refund | passed | phrase as written not present |
| Language: en | passed | — |
| Max length: 120 words | passed | 27 words |
| no secret / PII echo | passed | — |

## Rubric
| Criterion | Verdict | Reason |
|---|---|---|
| Intent accomplished | met | names the 14-day window and the receipt condition |
| Grounded | met | matches [D1] (14 days, receipt required) |
| No hallucinated capability | met | no action claimed |
| Scope / refusal | met | in-scope prompt answered |
| Tone | met | polite, factual |

**Repeat verdict:** passed
