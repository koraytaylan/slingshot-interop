---
id: interop-command
title: "The interop command"
workstream: "0004"
kind: task
depends_on:
  - agent-side-runtime
  - client-side-runtime
gated: false
touches:
  - scripts/interop
  - src/run/orchestration.test.ts
  - src/run/orchestration.ts
status: done
merged_as: bc25d093ee33e1ef32ad58b63387fa3bd991efce
---
# The interop command

The tier command. It takes no argument, resolves both sides from their pinning, and runs the pair — or refuses distinctly and starts nothing. The walking skeleton runs through it first: configuration loads, the daemon converges, and the capabilities route answers live.

**Steps:**

1. Write `src/run/orchestration.ts`: resolve both sides, with an unresolved side refusing with that owner's steps named and nothing started; verify the images; create the bounded run work directory and the per-run network; start the author runtime and install the resolved bundle; start the client runner with the resolved executable and its written configuration pointing directly at the author.
2. Discover scenarios from one directory, one file each, in a deterministic order — so adding a scenario never touches a shared list.
3. Run the walking-skeleton sequence as the first scenario: `check-configuration`, `daemon ping` absent, `daemon start` created, and the capabilities route answering live through the harness's own authenticated read.
4. Tear everything down through the handles that started it, then run the leak check over the harness label.
5. Write `scripts/interop` as the no-argument entry, and unit tests for the refusal paths and the discovery order.

- **Done when:** `scripts/interop` with nothing recorded on either side refuses distinctly naming both owners' steps and starts nothing; with both sides resolved it runs the walking skeleton green against the real pair, tears everything down through its handles, and the leak check finds nothing.
