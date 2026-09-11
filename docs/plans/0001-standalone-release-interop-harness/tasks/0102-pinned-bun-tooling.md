---
id: pinned-bun-tooling
title: "Pinned Bun tooling"
workstream: "0001"
kind: task
depends_on:
  - repository-foundation
gated: false
touches:
  - scripts/prepare_tooling
  - scripts/verify_tooling
  - support/tooling.toml
status: planned
merged_as: ""
---
# Pinned Bun tooling

Bun is the harness runtime and an external executable, so it is pinned the way both siblings pin theirs: one exact version, one recorded digest, prepared once by a command that says it reaches the network, and verified offline by everything that runs it.

**Steps:**

1. Write `support/tooling.toml` recording the exact Bun release: its origin, version, archive name, and content digest, with the reason each value is what a result can be reproduced from.
2. Write `scripts/prepare_tooling`, the one command that reaches the network and says so when it runs: it fetches only the pinned archive, verifies the digest before unpacking, and refuses one that differs.
3. Write `scripts/verify_tooling`, which never fetches: it verifies the installed binary's digest against the pinning and refuses a deleted or modified one naming the preparation command.

- **Done when:** `scripts/prepare_tooling` fetches nothing but the pinned archive and refuses one whose digest differs, and `scripts/verify_tooling` accepts the prepared binary offline while refusing a deleted or modified one by naming the preparation command.
