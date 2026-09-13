---
id: podman-process-wrapper
title: "Podman process wrapper"
workstream: "0002"
kind: task
depends_on:
  - harness-values
  - quality-gate
gated: false
touches:
  - src/harness/podman.test.ts
  - src/harness/podman.ts
status: done
merged_as: "6082173901003dda3d7b5a56ee870f90163ef79b"
---
# Podman process wrapper

The harness drives the container engine rootlessly through a process wrapper this repository owns, taking no container-orchestration dependency — the same decision both siblings made, for the same reason: the harness is the thing every suite depends on behaving. Plain child processes, bounded capture, typed refusals.

**Steps:**

1. Write `src/harness/podman.ts`: run podman with arguments, capture stdout and stderr to bounded files rather than to memory, and type the exit into a result or a refusal naming the command and the captured tail.
2. Refuse distinctly when the executable is absent, so a machine without rootless Podman gets one sentence about that rather than a spawn error.
3. Write `src/harness/podman.test.ts`: a version query succeeds; a failing subcommand surfaces the typed refusal with its captured output; a command producing more than the capture bound keeps exactly the bound and still reports.

- **Done when:** the wrapper's tests prove a successful query, a typed refusal carrying the captured tail, and the capture bound enforced on output that exceeds it.
