---
id: failure-category-scenario
title: "Failure category scenario"
workstream: "0004"
kind: task
depends_on:
  - write-read-scenario
gated: false
touches:
  - src/scenarios/failure-category.scenario.ts
status: done
merged_as: "2b0eb1f7e26bdfb66dd57ada225b2e5476e37156"
---
# Failure category scenario

A command that fails on the agent has to surface through the client as the failure the agent declared — same category, same status, same retryability — and never as a transport error.

**Steps:**

1. Write `src/scenarios/failure-category.scenario.ts`: read a path this run never created, reaching a terminal failure disposition.
2. Assert the client's machine output carries the agent's declared category for a missing root together with the status and retryability the client's own contract records for it.
3. Assert the category is the agent's word rather than a client-side reclassification: a difference in any of the three fields fails.

- **Done when:** the agent's declared failure category, status, and retryability surface through the client unchanged, and a change in any of the three — or a transport error where a declared failure belonged — fails the scenario.
