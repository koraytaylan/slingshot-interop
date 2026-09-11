---
id: detached-operation-scenario
title: "Detached operation scenario"
workstream: "0004"
kind: task
depends_on:
  - write-read-scenario
gated: false
touches:
  - src/scenarios/detached-operation.scenario.ts
status: planned
merged_as: ""
---
# Detached operation scenario

Work that outlives the request that submitted it: the acknowledgement comes back before the work is done, the client follows it, and the agent's own record agrees with what the client reports.

**Steps:**

1. Write `src/scenarios/detached-operation.scenario.ts`: submit a detached write, asserting the acknowledgement is the one the client's contract declares for work accepted but not finished.
2. Wait on the operation through the client to its terminal disposition.
3. Cross-check with the harness's authenticated read of the agent's own snapshot route: same operation, same terminal disposition.

- **Done when:** the detached submission acknowledges before completion, the client reaches the terminal disposition, and the agent's own snapshot route agrees with the client's answer — the two disagreeing being the failure the scenario exists to catch.
