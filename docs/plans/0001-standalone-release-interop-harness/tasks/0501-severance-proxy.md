---
id: severance-proxy
title: "Severance proxy"
workstream: "0005"
kind: task
depends_on:
  - container-lifecycle
gated: false
touches:
  - interop/severance-proxy/Containerfile
  - scripts/prepare_interop_images
  - scripts/verify_interop_images
  - src/harness/severance-proxy.test.ts
  - src/harness/severance-proxy.ts
  - support/interop-images.toml
status: planned
merged_as: ""
---
# Severance proxy

The interesting case in a transport is neither success nor refusal: the request left and no answer came back. The proxy forwards untouched until it is armed at a named point, and then it severs with a reset rather than an orderly close — because a close both sides can flush through and read to the end of is exactly the case being excluded.

**Steps:**

1. Write `src/harness/severance-proxy.ts`: a forwarding proxy with a control listener, severance points enumerated in the values before the injector is written, and a severance implemented so the peer observes a reset — a destroy with unread pending data — rather than a clean finish.
2. Write `interop/severance-proxy/Containerfile` from the pinned glibc base carrying the pinned Bun binary and this source, recorded in the images pinning, built by the preparation command, and verified offline by its identifier like every other image.
3. Write `src/harness/severance-proxy.test.ts` over real sockets: unarmed, bytes pass untouched both ways; armed at the declared point, the client side observes a reset, asserted as a reset and distinguished from an orderly close; the control channel refuses an unknown point.

- **Done when:** the proxy passes traffic untouched until armed, an armed point resets the connection where a probe observes the reset rather than a clean close, and the image is prepared once and verified offline like every other.
