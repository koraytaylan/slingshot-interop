---
id: run-report
title: "Run report"
workstream: "0004"
kind: task
depends_on:
  - artifact-transfer-scenario
  - authentication-refusal-scenario
  - detached-operation-scenario
  - failure-category-scenario
gated: false
touches:
  - scripts/interop
  - src/run/report.test.ts
  - src/run/report.ts
status: planned
merged_as: ""
---
# Run report

A result is about exactly the bytes the report names: what resolved on each side, what it ran on, and what each scenario proved. The report is the thing a release checklist reads.

**Steps:**

1. Write `src/run/report.ts`: one TOML report per run in the bounded work directory, recording the run's identity; each side's resolution — released or candidate, with commit, digest, and version; the images with their digests and built identifiers; and every discovered scenario with its outcome or its explicit not-run reason.
2. Wire it into `scripts/interop` so no scenario outcome exists outside a report.
3. Write `src/run/report.test.ts`: a stub run produces the report with every field present, and a run missing any required field refuses rather than writing a partial report.

- **Done when:** a full run writes a report naming every byte that ran and every scenario with an outcome, and the unit test proves a missing required field refuses rather than writing half a report.
