---
id: container-lifecycle
title: "Container lifecycle"
workstream: "0002"
kind: task
depends_on:
  - interop-images
  - podman-process-wrapper
gated: false
touches:
  - src/harness/container.test.ts
  - src/harness/container.ts
status: planned
merged_as: ""
---
# Container lifecycle

One container, one handle: started with a label and a network, made ready against an absolute deadline, captured to a bounded file, and stopped through the handle that started it. Nothing looks a name up afterwards, and the leak check lists only what this harness labelled — the same guarantees the agent's own harness gives, proved here against the probe image rather than against somebody else's runtime.

**Steps:**

1. Write `src/harness/container.ts`: create the per-run network; start a container with the harness label, declaring the ports it needs and no others; poll a caller-supplied readiness probe at the declared interval against the declared absolute deadline; capture output to a bounded file; stop with grace through the same handle; remove through it.
2. Type `NEVER_BECAME_READY` as its own refusal naming the captured log it kept, so a container that never came up is reported as that rather than as a timeout.
3. Write the leak check: list containers by the harness label and assert nothing remains, so it can only ever fail on this harness's own work.
4. Write `src/harness/container.test.ts` against the pinned probe image: start, become ready, stop, and be gone; a container whose probe never succeeds refuses at the deadline the test's own values declare, naming its log; the leak check is clean after each case and catches a deliberately left-behind labelled container.

- **Done when:** the integration tests prove the full lifecycle and the deadline refusal against the probe image, and the leak check finds nothing after a run while catching a deliberately leaked labelled container when one is left behind.
