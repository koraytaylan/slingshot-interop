# Plan 0001 — Standalone release interop harness for the Slingshot pair
## 0001 — Foundations and pinned tooling

## 0002 — Container harness

## 0003 — Sides and supplied inputs

## 0004 — Interop scenarios

## 0005 — Disruption and reconciliation

## 0006 — Release wiring and acceptance

## Two commands, one gate each

`scripts/quality` proves the harness itself: the pinned tooling verified offline, the locked compiler cache verified offline, the strict type check, and the unit and container tests, including the harness's own lifecycle proof against a pinned probe image so its assertions never wait for somebody else's runtime. `scripts/interop` proves the pair. Each takes no argument, runs every stage every time, and fetches nothing: every prepared input is prepared once by a named command that says when it reaches the network, and verified at gate time by a command that never does. A missing input is a refusal naming the preparation command, never a fetch and never a quiet skip.

## Sides resolve from bytes somebody recorded

Each side — the slingshot client and the slingshot-agent Sling-only bundle — has one pinning document with two slots. The released slot is recorded by an owner after a release and is explicitly absent until then, because there has been no release to record. The candidate slot holds bytes an owner built in the sibling's own verified environment: recorded with a digest, an exact commit, and an acknowledgement only the holder can set. A run resolves a side to its candidate when the bytes are present, the digest matches, the pin names an exact commit, and the holder acknowledged — otherwise to the released recording when one exists. Six distinct refusals (bytes absent, digest differing, commit not a commit, not acknowledged, no released recording, released digest differing) each name what the owner must do, and a run with an unresolved side starts nothing rather than running half a suite. The harness never builds, fetches, or caches a sibling.

## Three containers on one network per run

Rootless Podman, one network per run, every container labelled with the harness's label and removed through the handle that started it.

- **The author runtime**: the pinned public Apache Sling image with the pinned Java 21 runtime layered in — the same base digests, and for the same reason the agent's own public tier layers it: the published image's runtime and ASM cannot read the class files this side compiles. It is built once by the preparation command and verified offline by its recorded identifier. The resolved bundle is installed through the platform's own console route and awaited to the active state against an absolute deadline.
- **The client runner**: a pinned glibc image carrying nothing but the runtime the Linux release row needs. The executable is mounted from the supplied release archive, never baked into an image, because the bytes under proof are the bytes a user downloads. The client is configured through its own profile mechanism exactly as its contract states — a profile document and a selection document under a scratch home inside the container, where its own account-database home resolution and ownership rules apply — because a tier that configured the client some other way would prove a path no user takes. The harness drives each CLI invocation through exec with bounded capture, and the daemon the client converges on lives in the container for the whole run.
- **The severance proxy**: a small Bun program in a container built from the pinned Bun binary and this repository's own source. It forwards bytes untouched until it is armed at a named point, where it severs with a reset rather than an orderly close — because a close both sides can flush through and read to the end of is exactly the case being excluded.

The harness publishes one port — the author's — for its own reads. Deadlines are absolute and polled at the declared interval; nothing sleeps for a fixed span and nothing asserts how long anything took. Container output goes to bounded files, never to memory.

## The scenario set: the exchange, not the inventory

Scenarios live one file each in one directory and are discovered in a deterministic order, so a new scenario never serializes behind a shared list. The first version proves the exchange-level contract through the real client: the walking skeleton (configuration loads, the daemon converges, the capabilities route answers live); a write then a read of the same content; a detached operation followed to its terminal disposition with the agent's own snapshot agreeing; the agent's declared failure category surfacing through the client unchanged; an authentication refusal mapped to the client's declared category with nothing admitted; an oversized result answered by artifact reference and fetched against its declared byte count and digest; and a severed submission landing in the client's declared unknown outcome and reconciling to the true disposition without resubmitting — exactly one admission, exactly one effect. Per-command behavior stays where it already is: the agent's own tier drives all sixty-four commands through its own code.

## One report naming every byte

A run writes one report recording what resolved on each side (released or candidate, with commit, digest, and version), the images it ran on with digests and built identifiers, and every scenario with an outcome or an explicit not-run reason. A result is about exactly the bytes the report names, and the report is the thing a release checklist reads.

## What the harness is held to

The working rules of both siblings, in the form a harness can keep: every number that carries meaning is a named value in one file with a reason; output is captured to bounded files rather than memory; every refusal names what its holder can do about it; nothing claims freshness, no timestamp authenticates anything, no run quietly does less than it says, and nothing a suite started outlives the suite.
