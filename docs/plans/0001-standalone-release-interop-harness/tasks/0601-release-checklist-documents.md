---
id: release-checklist-documents
title: "Release checklist documents"
workstream: "0006"
kind: task
depends_on:
  - run-report
  - unknown-outcome-scenario
gated: false
touches:
  - README.md
  - docs/INTEROP.md
status: done
merged_as: "6321d6160159385ce9e8f683685ceed392d8c69d"
---
# Release checklist documents

The documents state the contract each sibling's release checklist adopts, describing what ships in this commit rather than what anybody intends: the two commands, the three run modes, the owner's exact steps for each, every refusal with its remedy, and the report a checklist reads.

**Steps:**

1. Write `README.md`: what this repository is, what it proves and refuses, the two commands and their fetch-nothing rule, and the three run modes — the released pair as the standing baseline, either side's candidate against the other's released pinning as that sibling's release step, and both candidates as the integration run.
2. Write `docs/INTEROP.md`: the per-side contract — which bytes each slot takes (the Linux release archive for the client, the Sling-only bundle for the agent), where its holder puts them, the digest, the commit, and the acknowledgement only they can set; the six refusals with what to do about each; the scenario inventory with the one sentence each proves; and the report's shape.
3. Make every command, path, and refusal named in the documents exist exactly as described in this commit.

- **Done when:** every command the documents name exists and behaves as described, each of the six refusals appears with its owner's remedy, and the three run modes are each stated with their exact owner steps and the one command that runs them.
