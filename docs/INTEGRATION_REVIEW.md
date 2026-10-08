# Current integration evidence

As of 2026-09-29, acknowledged pair `pair-8x8sfa` passes all **14 live public
Sling scenarios**, with complete teardown and independently verified cleanup.
Evidence paths below are relative to the parent workspace.

## Acknowledged artifacts

| Side | Synthetic source commit | Artifact SHA-256 |
|---|---|---|
| Client | `9711719b8d603d1aa6a1baf535238bc3c749e97d` | `b6652cca1e220bfb5150d6215b0ce07bd395f3691f17078c9d219fa6385621b3` |
| Agent | `1c547ea494b26cf87a22319773b61b2dcef0a74a` | `5558b6206db6eceb8269e81fb41da7068ad63d3c5e2b1aacb9afec35523c6c98` |

Source snapshots, original repository identities, build logs and receipts are
under `.effectiveness-candidates/preparations/pair-8x8sfa/`; durable artifacts
are content-addressed under `.effectiveness-candidates/artifacts/`. Both source
inventories exactly match the successful full gates. Original repository histories
are unchanged. Current candidate pins acknowledge these exact bytes under the
user's standing delegation, recorded in
`.effectiveness-evidence/load-depth-repair/final-acknowledgement/holder-acknowledgement.json`.

## Live results

Run `run-bec7c42a-cb4f-4158-9ed1-e4c3efcd16a9` completes in 151.635 seconds
with exit 0. Its complete report, images, invocation, logs and cleanup checks are
in `.effectiveness-evidence/final-pair-attempt-2/`. The consolidated
`completion-report.json` also maps all nine review findings to verification.

| Scenario | Result |
|---|---|
| 00-contract-catalogue | Pass: Both built candidates publish the same 72 five-field command identities; 49 live handlers match those identities (23 inactive). Transport and canonical-JSON digests agree. |
| artifact-transfer | Pass: artifact transfer: 525272 bytes answered by reference and verified at the destination, carrying all 8 planted properties of 65536 bytes |
| authentication-refusal | Pass: authentication refusal: proxy observed capability GET 401 responses, client retained confirmed non-execution, and independent agent operation inventory is unchanged |
| detached-operation | Pass: detached operation: durable answer observed, client and retained agent results match the requested folder, agent reports success and folder properties match |
| discovery-access | Pass: A separately authenticated caller reads four components, cannot transfer its token to the admin target, loses access to one independently verified existing row, cannot replay that cached row, and enumerates exactly the three still-readable rows. |
| discovery-lifecycle | Pass: Discovery: wrong-root refusal preserves the valid cursor; replay is identical until an independently observed content change invalidates it; a real agent-bundle restart rejects old tokens while new cursors advance. |
| failure-category | Pass: failure category: the agent's declared "template_not_found" surfaced through the client unchanged, and the agent's own record agrees |
| high-water | Pass: a real client-admitted subscription returned the client's closed high-water response shape |
| incremental-discovery | Pass: Enumerated 100 exact component paths in 6 bounded pages; 100101 nodes examined once across a tree larger than one request budget. |
| model-context-protocol | Pass: the protocol server answered a 80-tool catalog, every tool with an input schema, an initialized-era operation-list call carrying "operation_list_page", 41 read-only tools each answered through a call built from that tool's own declared schema (3 needing prior work not driven here: operation-restart, operation-artifact, maintenance-apply), a real operation-list call carrying its own "operation_list_page" document, and a real create_asset_folder call whose command ran on the agent and left /content/interop/run-bec7c42a-cb4f-4158-9ed1-e4c3efcd16a9/protocol/from-protocol |
| non-idempotent-recovery | Pass: Non-idempotent workflow fixture: two sensitivity controls produced two effects; targeted lost response recovered with automatic reconciliation; replay retained one logical admission and exactly one additional effect. Public Sling platform seam only. |
| severed-submission | Pass: severed submission: observed targeted submission POST response cut; automatic reconciliation recovered the original operation's folder result, matching the agent's retained result and requested path; independent inventory retains exactly one new logical operation matching its agent identifier; the agent reports success and folder properties match; exactly-once effect counts are not verified |
| unstartable-daemon | Pass: unstartable daemon: a shared runtime root was refused with its remedy and left empty; a daemon that exited while starting was reported with what it wrote and its owner-only log |
| write-read | Pass: write-then-read: client and retained agent creation results match the requested folder, whose content was read back with the write's declaration equal to the read's answer |

Both offline MCP revisions also match every built command identity and the
canonical/transport digests. Evidence is in
`.effectiveness-evidence/load-depth-repair/final-catalogues/`.
The non-idempotent WorkflowService fixture is bound to the current agent in
`.effectiveness-candidates/preparations/workflow-kNTyro/workflow-fixture.json`.
Its two controls establish sensitivity before response loss, automatic recovery
and replay prove one additional effect and admission. Fixture uninstall and
capability removal pass. The separate folder recovery scenario verifies logical
admission; its effect-count limitation is preserved in its own result.

Outer teardown succeeds. Independent checks find no containers or networks for
the main label or isolated caller label
`run-2c016216-17bf-4e9e-b2c8-34f3a80c965e`.

## Reproduction and scope

With the pinned dependencies, images and acknowledged artifacts prepared, from
the parent workspace run the archived wrapper with a fresh evidence directory:

```sh
CONTAINERS_CONF_OVERRIDE="$PWD/.effectiveness-evidence/load-depth-repair/containers.conf" \
SLINGSHOT_CAPTURE_AUTHOR_ACCESS=0 \
SLINGSHOT_INTEROP_WORKFLOW_FIXTURE="$PWD/.effectiveness-candidates/preparations/workflow-kNTyro/workflow-fixture.json" \
python3 .effectiveness-evidence/load-depth-repair/run-matrix.py fresh-pair-verification
```

The wrapper chooses an unused author host port and invokes the complete
`scripts/interop` matrix. The task-local Podman override sets `cgroups = "disabled"`
to avoid host delegation failures seen in prior attempts. Containers inherit the
parent cgroup; namespace, user, network, image and artifact pinning are retained.
No host-wide configuration was changed; no cgroup quota validation is claimed.

Full gates pass: 2,630 client aggregate executions, 2,295 agent tests and 547
harness tests. Current pins and this status document were updated after the
harness gate; final source revalidation records those differences. Product source
remains exactly the gated source. Source revalidation is retained beside the
completion report.

Coverage is Linux and public Sling. Licensed AEM deployments, native Windows and
live IMS/WAN behavior are not established. The non-idempotent fixture exercises
a platform service seam, not the AEM workflow engine. Earlier failures and
interrupted runs remain retained; the [integration history](INTEGRATION_HISTORY.md)
keeps older evidence with its original identities and scope.
