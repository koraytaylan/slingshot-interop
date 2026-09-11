---
id: repository-foundation
title: "Repository foundation"
workstream: "0001"
kind: task
depends_on: []
gated: false
touches:
  - .gitignore
  - LICENSE-APACHE
  - LICENSE-MIT
  - package.json
  - tsconfig.json
status: planned
merged_as: ""
---
# Repository foundation

The repository is empty except its plan-authoring contract, so the first change fixes what every later task inherits. This is a Bun and TypeScript project with no runtime dependency: the test framework is Bun's own and the harness is plain TypeScript, so the only thing ever installed is what the compiler needs. Both siblings are dual-licensed under exactly the same two texts, so this repository carries them reproduced the same way.

**Steps:**

1. Write `package.json` declaring the package private with no runtime dependency and the scripts the later tasks land, and a committed `tsconfig.json` at the strictest settings Bun's type definitions support.
2. Write `.gitignore` covering every directory a prepared input or bounded output lives in: the pinned tooling, the locked dependency cache, the supplied sibling inputs, installed modules, and the per-run work directory.
3. Reproduce `LICENSE-MIT` and `LICENSE-APACHE` exactly as both sibling repositories carry them.
4. Fix the source layout the later tasks fill: `src/harness` for the container machinery, `src/sides` for the pinning and per-side runtimes, `src/run` for the orchestration and report, `src/scenarios` for the one-file-per-scenario inventory, `scripts` for the commands, `support` for every pinned value, and `interop` for the Containerfiles.

- **Done when:** `package.json` declares the package private with no runtime dependency, `LICENSE-MIT` and `LICENSE-APACHE` are byte-identical to the sibling repositories' copies, and creating a file under each ignored directory leaves `git status` clean.
