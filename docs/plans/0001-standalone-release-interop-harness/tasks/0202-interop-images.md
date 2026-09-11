---
id: interop-images
title: "Pinned interop images"
workstream: "0002"
kind: task
depends_on:
  - quality-gate
gated: false
touches:
  - scripts/prepare_interop_images
  - scripts/quality
  - scripts/verify_interop_images
  - support/interop-images.toml
status: planned
merged_as: ""
---
# Pinned interop images

Every container image the tiers run on, pinned by content digest in one file, prepared once and verified offline — never pulled at gate time. A tag moves; a digest does not.

**Steps:**

1. Write `support/interop-images.toml` pinning the four base images by digest: the probe the harness proves itself against, so its own assertions never wait for somebody else's runtime; the glibc base the client runner builds on; the published Apache Sling runtime; and the Java 21 runtime the agent's deployment rows declare, layered in rather than inherited — each row carrying its reason.
2. Write `scripts/prepare_interop_images`, which reaches the network and says so: it pulls only full digest-pinned references and never a tag.
3. Write `scripts/verify_interop_images`, which never fetches: every pinned image present at the exact digest, or one refusal per absence naming the preparation command.
4. Add the image-verification stage to `scripts/quality`.

- **Done when:** after preparation the verification accepts offline, an absent image and a re-tagged one both refuse naming the preparation command, and the gate's new stage refuses rather than pulls when one is missing.
