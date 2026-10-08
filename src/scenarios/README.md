# src/scenarios

The scenario inventory, one file per scenario. Scenarios are discovered from
this directory in a deterministic order, so a new scenario never serializes
behind a shared list.

`00-contract-catalogue` first compares the client executable's MCP metadata with
the registry embedded in the exact digest-verified agent JAR. It then checks the
live capability subset against that shipped registry and retains both full
catalogues, active identities, and inactive names in the run report. Inactive
platform handlers are not claimed as available on Sling.

`incremental-discovery` plants and independently reads back 100,101 repository
nodes, above the reviewed 100,000-candidate request bound. The real client walks
sparse component matches and general query paths through separate bounded continuations on the
same planted tree; query rows must contain only their address. The scenario rejects
repeated paths, omitted matches, inconsistent completion, and total examined
counts that indicate prefix rescanning. Each command must preserve the original 17-row limit
when subsequent requests contain only a token. Its report includes each page's counts,
first useful result latency, and total enumeration time. The independent fixture
bound is accepted only for its reviewed command-limits digest. Permission changes and elapsed expiry require their own evidence; this stable-tree
case does not claim them.

`discovery-lifecycle` independently reads a four-component fixture, then drives
distinct real CLI operations. Wrong-root token misuse must leave the valid cursor
usable, and replay must return an identical page. An independently observed title
change must invalidate replay. The scenario stops and starts the exact candidate
agent bundle, observes both states, then requires old-token refusal and a fresh
cursor that advances. A lost stop/start response still triggers bundle restoration;
restoration outcomes survive in scenario evidence. Its focused mock checks prove
the scenario rejects missing evidence, not live agent behavior.

`discovery-access` creates a separate named caller and gives it operator membership
and explicit fixture read access. A second pinned client runner uses a private
scratch home with that caller's credentials. Independent HTTP reads must observe
all four components before revocation. A token cannot move to the admin target;
a user-specific deny must remove access to a row that still exists for admin.
Replaying that cached row must fail, and a fresh traversal must return exactly the
three remaining readable rows. User/root deletion and labeled runner recovery
are checked even after lost startup responses; cleanup failures fail the scenario.
The scenario uses Sling's [user management](https://sling.apache.org/documentation/bundles/managing-users-and-groups-jackrabbit-usermanager.html)
and [permission APIs](https://sling.apache.org/documentation/bundles/managing-permissions-jackrabbit-accessmanager.html).
Effective access is established by readback, not inferred from group membership.

`non-idempotent-recovery` installs a verified test-only workflow service in the
public Sling runtime. Identical arguments under two distinct operation keys must
produce two different repository children, proving counter sensitivity. It then
cuts a submission response, recovers the original operation, replays its key,
and requires one new logical admission and exactly one additional child. The
recovered result must match the retained agent result and independently read
child. Proxy disarm and fixture uninstall run on success and failure. The report
retains fixture provenance, the actual cut observation, before/after effect paths
and cleanup outcome. It requires `SLINGSHOT_INTEROP_WORKFLOW_FIXTURE` naming the
receipt produced by `scripts/prepare_workflow_fixture`; it refuses an existing
workflow service and does not claim AEM workflow-engine behavior.

`asset-discovery` independently reads back 100,601 stored nodes and the original
bytes of 100 synthetic assets. Each search must examine exactly 100,101 traversal
nodes, pruning asset descendants, and return its complete independent oracle.
It exercises root-only discovery, exact original size against stale recorded
size, both requested tags and an absent format, with initial limit 17,
continuation, replay and metadata fallback. Its minimal synthetic asset type
does not provide asset platform APIs. Fixture and corpus removal run on failure
and success; cleanup failures fail the scenario.
