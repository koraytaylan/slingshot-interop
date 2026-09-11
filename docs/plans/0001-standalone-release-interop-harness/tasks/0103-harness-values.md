---
id: harness-values
title: "Harness values"
workstream: "0001"
kind: task
depends_on:
  - pinned-bun-tooling
gated: false
touches:
  - src/harness/values.test.ts
  - src/harness/values.ts
  - support/harness-values.toml
status: planned
merged_as: ""
---
# Harness values

Every bound and deadline the harness uses, in one place, read through one typed loader — the rule both siblings learned by breaking it: a value written down twice is two things that can disagree quietly.

**Steps:**

1. Write `support/harness-values.toml`: the readiness deadlines (one for a published runtime, one for the deadline itself), the readiness poll interval, the stop grace, the capture bound, the harness label every container carries, the ports the three roles use, the severance chunk, and the size a scenario plants to overflow the protocol's inline result bound — each with its reason.
2. Write `src/harness/values.ts`: one typed loader over Bun's TOML parser that refuses a missing key and refuses an unknown one, so the schema is closed in both directions and no value is read anywhere else.
3. Write `src/harness/values.test.ts` proving every declared value loads typed, a fixture missing a key refuses, and a fixture carrying an extra key refuses.

- **Done when:** the loader's tests prove the closed schema in both directions — a missing key and an extra key each refuse — and every declared value loads typed through the loader.
