# Interop Contract

This document defines the contract for the interop harness, describing the requirements for each sibling's release checklist and the results the harness produces.

## Per-Side Contract

The harness relies on two pinning documents: `support/slingshot-side.toml` (the client) and `support/agent-side.toml` (the agent).

### Slots and Bytes

Each side has two slots: `released` and `candidate`.

- **Client (Slingshot):** The bytes are a Linux release archive containing the `slingshot` executable.
- **Agent (Sling):** The bytes are a Sling-only bundle (JAR) containing the agent's runtime.

### Recorded Metadata

For every active slot (a slot where `path` is not empty), the following must be recorded:
- **Path:** The absolute or relative path to the bytes on disk.
- **Digest:** The SHA-256 digest of the bytes.
- **Commit:** (Candidate only) The 40-hex object name of the commit the bytes were built from.
- **Acknowledgement:** (Candidate only) A boolean set to `true` only by the sibling's owner to acknowledge the candidate.

## Refusals and Remedies

The harness refuses to run if any of the following conditions are met. The run report will name the refusal and the required remedy.

| Refusal | Remedy |
| :--- | :--- |
| **Bytes Absent** | Place the missing bytes at the recorded path, or clear the slot recording them, or record the other slot. |
| **Candidate Digest Differing** | Re-record the candidate digest over the bytes now on disk, or replace the bytes with the ones the digest names. |
| **Commit Not a Commit** | Record the exact 40-hex commit the candidate was built from. |
| **Not Acknowledged** | Acknowledge the candidate, as only the holder can, or remove the candidate slot. |
| **No Released Recording** | Acknowledge the candidate or record a release in the released slot; the harness builds, fetches, and caches nothing. |
| **Released Digest Differing** | Replace the released bytes with the ones the recorded digest names, or re-record the digest over the bytes now on disk. |

## Scenario Inventory

Every run executes the following scenarios in deterministic order. Each scenario proves a specific property of the interop:

- **Write-Read:** Proves that a value written through the client can be read back exactly.
- **Artifact Transfer:** Proves that results exceeding the inline bound are transferred as verified artifacts.
- **Detached Operation:** Proves that the client can submit work and wait for its terminal disposition via an operation key.
- **Failure Category:** Proves that the client and agent agree on the category, status, and retryability of a failed operation.
- **Authentication Refusal:** Proves that a client with wrong credentials is refused by the agent and does not admit an operation key to the agent's store.
- **Severed Submission:** Proves that the client handles a transport severance during submission according to the contract.
- **Model Context Protocol:** Proves that the shipped client's `protocol-serve` server answers a real consumer over its standard-input/standard-output interface. It speaks both revisions this build offers: the preferred stateless revision (`2026-07-28`) with `protocolVersion` on every request, and the initialized revision (`2025-06-18`) that a standard host actually sends — `initialize`, `notifications/initialized`, then `tools/call` with no per-request revision. Empty content on that initialized-era call is a failure: that is how a host can list tools and never reach the daemon. `tools/list` returns a non-empty catalog in which every tool carries a name and an input schema, a control call (`operation-list`) answers its own `operation_list_page` document rather than a JSON-RPC error, and a registry command call (`create_asset_folder`) reaches the agent — its answer is a receipt, the operation it names reaches a terminal disposition through the client's own wait, and the folder it declared answers on the agent's route with the title the call declared. The catalog is then swept: every read-only tool it advertises — hyphenated controls and registry commands whose `readOnlyHint` is true — is called with arguments built from that tool's own declared schema, and a call that is answered with a local failure rather than by the daemon fails the scenario. Three controls are excluded by name because their arguments name something a run must have made first — `operation-restart`, `operation-artifact`, and `maintenance-apply` — and the scenario names them rather than skipping them silently. The Sling starter does not carry Granite CSRF or Sling referrer filters; the harness plants `/libs/granite/csrf/token.json` and the severance proxy requires that planted token plus a `Referer` on state-changing agent POSTs, so a client that skips either cannot complete a write-read.

## The Report

A successful run produces a TOML report named after the run label. The report contains:
- **Label:** The unique identifier for the run.
- **Sides:** The resolved pinning for both Slingshot and Agent (source, path, digest, and either version or commit).
- **Images:** The identifiers and digests of the harness runtimes used.
- **Scenarios:** A list of every scenario executed, marking it as `ok` or naming the failure message.
