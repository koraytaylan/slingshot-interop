---
id: artifact-transfer-scenario
title: "Artifact transfer scenario"
workstream: "0004"
kind: task
depends_on:
  - write-read-scenario
gated: false
touches:
  - src/scenarios/artifact-transfer.scenario.ts
status: done
merged_as: eaf23f7aff998623e9770277df4551ce567d217d
---
# Artifact transfer scenario

A result too large to answer inline is answered by reference, and the reader verifies the bytes itself: byte count and digest declared by the result, checked against what actually arrives.

**Steps:**

1. Write `src/scenarios/artifact-transfer.scenario.ts`: plant a text node comfortably larger than the protocol's inline result bound through the platform's own default POST servlet — the runtime's own way of making content, not the agent's routes — at a path unique to this run, sized from a named value.
2. Load it back through the client deeply enough that the serialized result exceeds the inline bound, and assert the operation's result is an artifact reference carrying a byte count and digest rather than an inline answer.
3. Fetch the artifact through the client to a destination, and verify the destination's byte count and digest against what the result declared.

- **Done when:** the oversized load is answered by artifact reference, the fetched destination matches the declared byte count and digest, and a mismatch in either fails the scenario rather than truncating.
