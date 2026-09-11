---
id: side-pinning
title: "Side pinning documents"
workstream: "0003"
kind: task
depends_on:
  - pinned-bun-tooling
gated: false
touches:
  - src/sides/pinning.test.ts
  - src/sides/pinning.ts
  - support/agent-side.toml
  - support/slingshot-side.toml
status: planned
merged_as: ""
---
# Side pinning documents

Each side is bytes somebody recorded, never bytes this repository produced. One pinning document per side with two slots: the released pinning an owner records after a release — explicit and absent until then, because there has been no release to record — and the candidate slot holding bytes an owner built in the sibling's own verified environment and acknowledged. A run resolves each side or refuses; it never builds, fetches, or caches a sibling.

**Steps:**

1. Write `support/slingshot-side.toml` and `support/agent-side.toml`, each recording the released slot (version, the archive or bundle path under the supplied-inputs directory, and its digest — explicit empty values until an owner records them) and the candidate slot (path, digest, exact commit, and an acknowledgement only the holder can set).
2. Write `src/sides/pinning.ts`: resolve a side to its candidate when the bytes are present, the digest matches, the pin names an exact commit, and the holder acknowledged — otherwise to the released recording when one exists, otherwise refuse.
3. Type six distinct refusals — bytes absent, digest differing, commit not a commit, not acknowledged, no released recording, released digest differing — each naming what the owner must do.
4. Write `src/sides/pinning.test.ts` over fixtures: every refusal in isolation, the candidate winning over a recorded release when everything is in place, the absent candidate falling back to a recorded release, and nothing recorded refusing with both owners' steps named.

- **Done when:** the unit tests drive all six refusals and both resolution directions from fixtures, and the committed documents carry explicit absent values rather than special cases in code.
