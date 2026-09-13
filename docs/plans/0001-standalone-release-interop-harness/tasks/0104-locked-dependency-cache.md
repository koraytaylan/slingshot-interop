---
id: locked-dependency-cache
title: "Locked dependency cache"
workstream: "0001"
kind: task
depends_on:
  - pinned-bun-tooling
gated: false
touches:
  - bun.lock
  - package.json
  - scripts/prepare_locked_dependency_cache
  - scripts/verify_locked_dependency_cache
  - support/locked-dependency-cache.toml
status: done
merged_as: "3e8ede5177413405b6f28b0c5810cfc16c1bd38d"
---
# Locked dependency cache

The harness needs exactly one dependency: the TypeScript compiler, so the gate can hold the source to a type check rather than to what Bun's transpiler lets by. It is installed from a cache prepared once over the network and verified offline, the same split both siblings use.

**Steps:**

1. Add the compiler and Bun's own type definitions as the only development dependencies, exact versions, and commit the lockfile.
2. Write `support/locked-dependency-cache.toml` recording what the cache is and its digest.
3. Write `scripts/prepare_locked_dependency_cache`, which reaches the network once and says so, populating the cache from the committed lockfile.
4. Write `scripts/verify_locked_dependency_cache`, which never fetches: it verifies the cache against the committed lockfile and refuses a difference naming the preparation command.

- **Done when:** an offline install from the prepared cache succeeds with no network, and a cache differing from the committed lockfile makes verification refuse naming the preparation command rather than repairing it.
