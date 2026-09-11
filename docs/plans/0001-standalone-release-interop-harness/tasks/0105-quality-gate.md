---
id: quality-gate
title: "Quality gate"
workstream: "0001"
kind: task
depends_on:
  - harness-values
  - locked-dependency-cache
gated: false
touches:
  - scripts/quality
status: planned
merged_as: ""
---
# Quality gate

The self gate: it proves the harness, takes no argument, runs every stage every time, and fetches nothing. Every stage that needs a prepared input verifies it and refuses naming the command that prepares it.

**Steps:**

1. Write `scripts/quality`: verify the pinned tooling, verify the locked dependency cache, install offline from it, run the type check with no error suppressed, then run the whole unit suite.
2. Give each stage its own refusal naming exactly one preparation command, so a missing input is one sentence about what its owner must do.
3. Prove the gate from a prepared machine end to end, including the case where each prepared input is deleted: one distinct refusal per input.

- **Done when:** `scripts/quality` passes on a prepared machine with every stage run, and deleting each prepared input in turn makes it refuse naming that input's preparation command rather than fetching or skipping.
