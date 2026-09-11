---
id: unknown-outcome-scenario
title: "Severed submission scenario"
workstream: "0005"
kind: task
depends_on:
  - interop-command
  - severance-proxy
gated: false
touches:
  - src/scenarios/severed-submission.scenario.ts
status: planned
merged_as: ""
---
# Severed submission scenario

The headline property of the pair: a submission whose answer never came back is reported as unknown with its cause, reconciled by lookup rather than resubmitted, and the agent proves exactly one admission and exactly one effect.

**Steps:**

1. Write `src/scenarios/severed-submission.scenario.ts`: a profile pointing at the proxy, the proxy armed at the declared point after the request body has left, and a write submitted through it.
2. Assert the client reports its declared submission-unknown outcome with the cause, rather than success or a clean failure.
3. Reconcile through the client's own lookup: the operation is there, with its true disposition — the agent ran it inside the request even though the answer never arrived.
4. Assert through the agent's own authenticated routes that exactly one physical attempt was admitted for the key and the created content exists exactly once — the no-resubmission property proved from the side that would have seen a second effect.

- **Done when:** the severed submission lands in the client's declared unknown outcome with its cause, reconciliation finds the true disposition without a second submission, and the agent's own routes answer exactly one attempt and one effect.
