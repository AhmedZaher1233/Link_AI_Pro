---
name: link-qc-5c-engine
metadata:
  version: "3.2.0"
description: >
  Internal engine of link-qc-5c-test-run-automation-lite — not a skill to invoke. A vendored copy of the
  link-qc-5-test-run-automation 3.2.0 scripts, templates and references that Lite runs. The version above is
  read by the engine's own scripts (check.mjs skillVersionOf) for the gate records.
user-invocable: false
disable-model-invocation: true
---

# Engine of link-qc-5c (vendored)

Do not invoke or load this file. Lite's `scripts/lite.mjs` calls `engine/scripts/*.mjs`; Lite's references point at
`engine/references/*.md` when a rule needs its full text. Provenance, contents and local changes: `../references/maintainers/ENGINE.md`.
