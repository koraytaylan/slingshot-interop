---
id: client-side-runtime
title: "Client-side runtime"
workstream: "0003"
kind: task
depends_on:
  - container-lifecycle
  - side-pinning
gated: false
touches:
  - interop/client-runner/Containerfile
  - scripts/prepare_interop_images
  - scripts/verify_interop_images
  - src/sides/client-configuration.test.ts
  - src/sides/client-configuration.ts
  - src/sides/client-runtime.test.ts
  - src/sides/client-runtime.ts
  - support/interop-images.toml
status: done
merged_as: "d62bf78878066c42a8847482a74b98468ff2ab90"
---
# Client-side runtime

The client half runs as the executable its release archive carries, mounted into a pinned glibc container — never baked into an image, because the bytes under proof are the bytes a user downloads. It is configured through its own profile mechanism and nothing else: a profile document and a selection document under a scratch home, exactly the path its contract says it reads, because a tier that configured the client some other way would prove a path no user takes.

**Steps:**

1. Write `interop/client-runner/Containerfile` from the pinned glibc base: nothing in it but the runtime the Linux release row needs.
2. Record and build it through the images pinning, preparation, and verification like every other image.
3. Write `src/sides/client-configuration.ts`: author the client's own documents into a scratch home — a profile declaring the 6.5 deployment with basic credentials and the author's address, spelled exactly the one spelling its contract allows, and the selection document — parameterized so a scenario can write a second profile pointing elsewhere.
4. Write `src/sides/client-runtime.ts`: verify the supplied archive's digest against its recorded pinning and cross-check the archive's own checksums member; extract the executable into the run's work directory; start the runner with the executable and the scratch home mounted; drive each CLI invocation through exec with bounded capture.
5. Prove the sequence the contract gives: `check-configuration` accepts the harness-written documents — which is what proves the mounts satisfy the client's own ownership and single-name rules — then `daemon ping` reports absent and `daemon start` reports created.
6. Write the tests: the configuration documents carry only the client's own two shapes and the exact address spelling; the archive path refuses a digest that differs from the pinning and a checksums member that disagrees; the runtime sequence asserts the three answers above from captured machine output.

- **Done when:** with a supplied archive whose digest matches its recording, the extracted executable starts in the runner, `check-configuration` accepts the documents the harness wrote, `daemon ping` reports absent, and `daemon start` reports created — every answer read from bounded captured output, and a tampered archive refused before anything starts.
