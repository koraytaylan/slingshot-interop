---
id: cold-start-acceptance
title: "Cold start acceptance"
workstream: "0006"
kind: task
depends_on:
  - release-checklist-documents
gated: false
touches:
  - scripts/smoke
status: planned
merged_as: ""
---
# Cold start acceptance

The whole thing from nothing: one command that performs every preparation once, runs the self gate, then runs the tier — proving the refusals with nothing recorded, and a complete candidate-versus-candidate run with both working trees' bytes supplied.

**Steps:**

1. Write `scripts/smoke`: the one command that chains every preparation command — saying when it reaches the network — then the self gate, then the tier command.
2. Prove the cold start from a clean clone on a machine with rootless Podman: with nothing recorded, the tier refuses distinctly for both sides and nothing starts.
3. Supply both sides' candidate bytes built from the current working trees — recorded with digest, commit, and acknowledgement — and prove the complete run: every scenario green, the report naming every byte, nothing left running.

- **Done when:** from a clean clone, `scripts/smoke` prepares everything once, passes the self gate, produces the distinct no-input refusals with nothing started, and — with both sides' acknowledged candidate bytes supplied — a complete run whose report names every byte and scenario and leaves no labelled container behind.
