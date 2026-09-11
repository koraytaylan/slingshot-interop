# Plan 0001 — Standalone release interop harness for the Slingshot pair
## Why this plan

slingshot and slingshot-agent change independently, and neither can prove the pair still works. The only cross-repository tier that exists today lives inside the agent repository, runs only when an owner supplies the sibling's executable, and answers from the agent's perspective alone; the client repository has no cross-repository tier at all. A release of either half is today a claim about bytes nobody has run against the other half.

This repository is the missing third thing: a standalone gate, owned by neither sibling, that runs the real client executable against the real agent bundle inside rootless Podman containers, with each side pinned by digest to released bytes, to owner-supplied candidate bytes, or to both at once. Each sibling's release checklist points at one command here, and each result names exactly the bytes it ran.

## In scope

- **0001 — Foundations and pinned tooling.** The package identity and licence, the ignored directories every prepared input and bounded output lives in, the pinned Bun runtime prepared once and verified offline, the one values file every bound and deadline lives in, the locked compiler cache, and the no-argument self gate.
- **0002 — Container harness.** The process wrapper over rootless Podman with no orchestration dependency, the digest-pinned base images prepared once and verified offline, and the container lifecycle: labels, absolute readiness deadlines, bounded capture, cleanup through the handle that started a container, and the leak check that lists only what this harness labelled.
- **0003 — Sides and supplied inputs.** One pinning document per side with an explicit-absent released slot and an owner-acknowledged candidate slot, six distinct refusals, and no sibling ever built, fetched, or cached here; the author runtime that installs the resolved Sling-only bundle through the platform's own console and awaits it active; and the client runner that mounts the supplied release executable and is configured through the client's own profile mechanism.
- **0004 — Interop scenarios.** The no-argument tier command with its walking skeleton, then the exchange-level contract through the real client: a write then a read of the same content, a detached operation followed to a terminal disposition the agent's own record agrees with, the agent's declared failure category surfacing unchanged, an authentication refusal with nothing admitted, an oversized result answered by artifact reference and fetched against its declared byte count and digest, and one report naming every byte a run was about.
- **0005 — Disruption and reconciliation.** The severance proxy that forwards untouched and resets at a named point, and the scenario proving a severed submission lands in the client's declared unknown outcome, reconciles by lookup rather than resubmission, and left exactly one admission and one effect on the agent.
- **0006 — Release wiring and acceptance.** The documents stating the contract each sibling's release checklist adopts, and the one cold-start command that prepares everything once, passes the self gate, produces the distinct no-input refusals, and runs a complete candidate-versus-candidate pair.

## Out of scope

- Building either sibling. Bytes are supplied by their holders: released pinning is recorded by an owner after a release, and candidate bytes are built in the sibling's own verified environment and recorded here with a digest, an exact commit, and an acknowledgement only their holder can set.
- Editing either sibling repository. Each wires its own release-checklist change against the contract this repository's documents state; that change belongs to that repository's plan.
- The licensed Adobe quickstart tier. The public Apache Sling runtime proves the whole protocol surface — that is what the agent's two-bundle split is for — and the quickstart remains the agent's own optional tier.
- Per-command parity with the agent's own tier. That tier drives all sixty-four commands against a real Sling through its own code; this harness proves the exchange-level contract through the real client instead, and the two cover different claims.
- Adversarial identity scenarios, such as an agent that lies about its transport-contract digest. Those need a fake author, which is the client repository's own hermetic suite; a harness that proved the pair with a fake would not be proving the pair.
- Cluster, document-store, handover, and chaos coverage. Two nodes and fault injection against the agent's store belong to the agent's own harness.
- Rebuilding the siblings' policy-checker machinery — abbreviation lists, complexity ceilings, coverage floors. This harness adopts their working rules where they are structural (named values, absolute deadlines, bounded capture, fetch-nothing gates, explicit refusal) and is held by its own strict type check and tests.
- Any continuous-integration provider or workflow. The commands exist; wiring a provider is a later owner decision.
- Rows other than Linux. The harness runs on Linux, so the client release archive it pins is the Linux row's; the other rows are each sibling's own native smoke evidence.

## Plan dependencies

None. This is the first plan in this repository.
