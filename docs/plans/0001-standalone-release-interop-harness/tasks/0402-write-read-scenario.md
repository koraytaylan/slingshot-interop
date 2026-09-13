---
id: write-read-scenario
title: "Write-then-read scenario"
workstream: "0004"
kind: task
depends_on:
  - interop-command
gated: false
touches:
  - src/scenarios/write-read.scenario.ts
status: done
merged_as: "4c0ae5086e4ab2e30ee7d8e84e338e7157e5b14f"
---
# Write-then-read scenario

One write, then one read of what was written — the exchange in both directions: the canonical submission, the agent's digest derivation and in-request execution, the inline result, and the operation ledger behind them.

**Steps:**

1. Write `src/scenarios/write-read.scenario.ts`: create a page at a path unique to this run through the client's own command surface, wait on the operation to its terminal disposition, then load the same path back as content and read the answer from the client's machine output.
2. Assert the read answer carries exactly what the write declared, and that the operation's status answers the recorded disposition.
3. Let any mismatch fail the scenario rather than skip it.

- **Done when:** the scenario passes against the real pair by creating then reading back its own content with the write's declaration equal to the read's answer, and a deliberately wrong expectation makes it fail rather than pass vacuously.
