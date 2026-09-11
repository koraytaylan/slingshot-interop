---
id: authentication-refusal-scenario
title: "Authentication refusal scenario"
workstream: "0004"
kind: task
depends_on:
  - write-read-scenario
gated: false
touches:
  - src/scenarios/authentication-refusal.scenario.ts
status: planned
merged_as: ""
---
# Authentication refusal scenario

Credentials the author refuses have to be reported as that refusal, with nothing admitted: the client's declared authentication category, and an operation key that never reached the agent's store.

**Steps:**

1. Write `src/scenarios/authentication-refusal.scenario.ts`: a second profile carrying the same address with a wrong password, selected through the client's own flags; submit a read through it.
2. Assert the client reports its declared authentication-failure category rather than a transport error or an unknown outcome.
3. Assert through the harness's authenticated read that the attempted operation key answers never-there on the agent's own lookup route.

- **Done when:** wrong credentials produce the client's declared authentication category and the agent's own route proves nothing was admitted for the attempted key — the pair refusing together rather than half-executing.
