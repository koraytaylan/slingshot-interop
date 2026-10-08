# scripts

The commands. Preparation commands say when they reach the network and are
never run by the gate; verification commands fetch nothing and refuse a
missing input by naming the preparation command. `quality` proves the harness
and `interop` proves the pair; each takes no argument and runs every stage
every time.

- `prepare_tooling` fetches and installs the pinned Bun; `verify_tooling`
  proves the installed binary offline.
- `prepare_locked_dependency_cache` builds the locked dependency cache;
  `verify_locked_dependency_cache` proves it offline.
- `prepare_interop_images` pulls the digest-pinned container images and never
  a tag; `verify_interop_images` proves them offline at their exact digests.

## Prepare changed siblings for review

Run the separate offline preparation command with both source directories and
an absolute durable artifact destination:

```sh
.tooling/bun-linux-x64/bun scripts/prepare_candidates \
  ../slingshot ../slingshot-agent /path/to/durable/slingshot-candidates
```

It captures tracked and nonignored new files, including uncommitted changes,
in separate synthetic Git commits. Deleted files stay deleted. Each receipt
records the original HEAD, snapshot commit and tree, and a file hash inventory.
The original repositories and live pinning files are not modified. Symlinks,
submodules, changing source, and existing snapshot destinations are refused.
The snapshot commit's fixed date is synthetic, not a claim about source history.

The command uses the installed Cargo toolchain and the Maven distribution
already prepared for the agent's wrapper pin. Cargo and Maven dependencies
must already be cached; builds use offline mode. It builds a release client
and the core agent bundle from the snapshots, checks that building did not
change source, and verifies the packaged client's checksum manifest. Build
logs (stdout and `.stderr`) and source archives survive in the destination.
Artifacts and source archives are stored by SHA-256 with read-only file modes;
subsequent readers must still verify hashes because a file owner can change
permissions. Existing artifact bytes are never silently replaced.

`candidates.json` names the exact inputs and outputs. The two proposed TOML
pins name the synthetic snapshot commits and set `acknowledged = false`.
Review these concrete artifacts before the holder copies the proposed pins
into `support/` and acknowledges them. Preparation does not run quality gates
or interoperability scenarios; those results must be recorded separately.
It does not establish licensed AEM behavior.

## Prepare the non-idempotent workflow fixture

After preparing the exact agent candidate, run:

```sh
.tooling/bun-linux-x64/bun scripts/prepare_workflow_fixture \
  /path/to/slingshot-agent-core.jar AGENT_SHA256 \
  ../slingshot-agent/.dependency-cache /path/to/durable/slingshot-candidates
```

This builds only the test platform seam in `fixtures/counting-workflow/`, using
the already pinned Java image with networking disabled. The two compile-only
API jars must be present at their digest-pinned paths in the supplied prepared
Maven cache. No dependency is downloaded or bundled into the output. The exact
agent JAR, fixture source digest, compiler image, API digests and build commands
are recorded in `workflow-fixture.json`; source and agent digests are also embedded
in the JAR manifest. Compiler containers are removed even after a failed command.

Set `SLINGSHOT_INTEROP_WORKFLOW_FIXTURE` to that receipt when running integration.
The scenario checks source, artifact, agent and tooling provenance before upload,
then uninstalls the bundle when it finishes. The fixture models a non-idempotent
platform effect through the real command handler; it does not model AEM workflows.
Preparation grants no candidate-holder acknowledgement and is not a live test.
