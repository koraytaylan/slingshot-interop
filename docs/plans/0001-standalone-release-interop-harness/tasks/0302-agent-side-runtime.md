---
id: agent-side-runtime
title: "Agent-side runtime"
workstream: "0003"
kind: task
depends_on:
  - container-lifecycle
  - side-pinning
gated: false
touches:
  - interop/tier-sling/Containerfile
  - scripts/prepare_interop_images
  - scripts/verify_interop_images
  - src/sides/agent-runtime.test.ts
  - src/sides/agent-runtime.ts
  - support/interop-images.toml
status: planned
merged_as: ""
---
# Agent-side runtime

The author half runs on the pinned public Sling runtime with the resolved Sling-only bundle installed through the platform's own console, awaited to the active state. The image is the published runtime with the declared Java 21 layered in, built once by the preparation command — the same reason the agent's own tier builds it: the published image's runtime and ASM cannot read what this side compiles, so the tier runs on the release the deployment matrix names.

**Steps:**

1. Write `interop/tier-sling/Containerfile`: the pinned Java runtime layered over the pinned published Sling runtime, both digests from the images pinning.
2. Record the built image in `support/interop-images.toml`, build it in the preparation command, and verify it offline by its recorded identifier like every other image.
3. Write `src/sides/agent-runtime.ts`: start the runtime with the harness label on the run's network, publishing exactly one port for the harness; await the console against an absolute deadline; install the resolved bundle jar through the platform's install route with authenticated headers; await the active state against an absolute deadline, refusing `NEVER_BECAME_READY` with the captured state named.
4. Write `src/sides/agent-runtime.test.ts`: the install request's shape against a stub server — authenticated, the jar's bytes as the body — and against the built image a planted jar that installs but can never resolve, proving the active-state wait refuses at the deadline naming what the bundle actually became.

- **Done when:** the stub test proves the authenticated install request, and the integration test proves a planted unresolvable jar is installed, never becomes active, and refuses at the values-declared deadline naming the captured state.
