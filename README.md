# Slingshot Interop Harness

This repository is the standalone gate that both siblings' release checklists rely on. It proves that the real Slingshot client executable works against the real Slingshot Agent Sling-only bundle inside rootless Podman containers.

## What it Proves and Refuses

The harness proves that the exact bytes named in the pinning documents produce the observed results. It refuses to run if the bytes on disk do not match the recorded digests, if a candidate is not acknowledged by its holder, or if a commit pin is not a 40-hex object name.

## The Two Commands

1. `scripts/prepare_interop_images`: The only command that reaches the network. It pulls digest-pinned base images and builds the harness runtimes.
2. `bun run interop`: The run command. It resolves the sides, starts the containers, executes all scenarios, and produces a report.

**Fetch-nothing rule:** Only `scripts/prepare_interop_images` fetches data from the network. The run command (`bun run interop`) operates entirely offline using the pinned bytes and images.

## The Three Run Modes

A run is configured by editing `support/slingshot-side.toml` and `support/agent-side.toml`.

### 1. Standing Baseline
Proves the current released pair.
- **Owner steps:** Clear the `candidate.path` in both `support/slingshot-side.toml` and `support/agent-side.toml`.
- **Command:** `bun run interop`

### 2. Sibling's Release Step
Proves a candidate against the other sibling's released pinning.
- **Owner steps:**
    - For the candidate sibling: Record the bytes at `candidate.path`, record the `candidate.digest`, record the 40-hex `candidate.commit`, and set `candidate.acknowledged = true`.
    - For the other sibling: Clear its `candidate.path`.
- **Command:** `bun run interop`

### 3. Integration Run
Proves both candidates together.
- **Owner steps:** Record bytes, digests, and 40-hex commits for both candidates in their respective TOML files, and set `candidate.acknowledged = true` for both.
- **Command:** `bun run interop`
