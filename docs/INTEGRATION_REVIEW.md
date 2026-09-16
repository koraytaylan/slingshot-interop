# Integration review

Status: in progress. A passing seven-scenario run is not yet sufficient evidence
for release readiness or complete integration coverage.

## Current verification summary

- Agent: the full default gate passes after route-checker and large-cursor
  parser changes, including all 466 interop tests. Optional owner Adobe and
  sibling-client tiers are explicitly excluded and were not run.
- Client: the full offline quality run is terminal with exit 101 at two
  source-policy tests (stale baseline diagnostics and unbaselined findings).
  All 18 selected-admission integration tests pass in this run, including the
  strengthened decimal-reset fixture and live-event admission checks. The
  latest separate source-policy scan reports 296 findings after counting Tokio
  join bodies (finding 143); the full client gate
  is not green, and stages after this failing test target are not verified. A newly added
  reset-coverage regression exposed acceptance of snapshot cursor `7:9` as
  covering capture `7:10`; a second exposed treating `7:10` after `7:9` as stale.
  Both now pass with shared numeric ordering for decimal agent cursors, also
  applied to ledger checks and SQLite predicates. Broader verification remains
  incomplete; these passes do not establish release readiness.
  The latest all-target/all-feature transport-package run passes all 439
  tests across 29 targets, including the subsequent artifact, event and finite
  HTTP/2 decoder changes. Current transport-library Clippy also passes with
  warnings denied. This is not a full client-gate pass and does not exercise
  current sibling candidates.
- Harness: the latest full gate after high-water admission checks has
  436 passes and one failure (2,589 assertions across 55 files): stale candidate
  provenance. The prior real-container timeout failure was reproduced with
  delayed dispatch, repaired, and now passes in both focused and full-gate runs.
  This run includes descriptor, machine-envelope, wait exit/deadline and
  in-container observation-timeout repairs.
  Strict capture bounds and UTF-8 decoding pass in this full run as well.
  Configuration-upload/startup, cleanup, deadline, early-refusal reporting,
  and bounded/duplicate-aware JSON checks pass. TypeScript and pinned-input
  verification pass. Candidate provenance has not been bypassed; the gate is red.
- End-to-end release evidence remains open: rebuilt dirty artifacts are not the
  bytes/source commits named by the existing acknowledged candidate pins. No
  acknowledgements or source attribution were rewritten to hide that mismatch.
- Coverage is still incomplete across commands, recovery and exactly-once
  effects. Detailed findings below include chronological intermediate results;
  a focused pass does not establish full interoperability.
- Target binding: the harness now retains independently computed target digests
  from authored profiles and requires them in both database resolvers. This is
  verified by vector, filesystem, WAL and scenario tests included in the full
  harness gate above. Current-candidate live verification is still open.

## Scope and inspected inputs

Review the standalone harness and both sibling projects, repair demonstrated
defects, and repeat verification. The inspected sibling worktrees were clean:

- Client: `79397e8aa8e28bdeb65603ca7b68ae92d36c3584`.
- Agent: `993dd6550b7f5f67b27719026009c67b4b24e1e9`.

Both match the candidate commit pins. Matching pins does not itself establish
that the supplied binaries were built from those commits.

## Findings and work remaining

1. **Fixed: failed scenarios exited successfully.** The command always exited
   zero after orchestration, even when scenario outcomes were false. It now
   derives its exit status from a nonempty list of passing outcomes. A subprocess
   regression test exercises the real command with a failed run.
2. **Fixed: report evidence was reconstructed after execution.** Display-text
   parsing lost diagnostics containing colons/newlines, and rereading side pins
   could attribute a run to different inputs. The orchestrator now returns its
   original structured identities and outcomes. The command test checks exact
   saved evidence without any side documents available to reread.
3. **Open: severed submission does not prove recovery or exactly-once behavior.**
   The scenario races arming against submission, uses a five-connection threshold,
   and accepts a recovery park. A succeeded snapshot and existing folder do not
   count admissions or effects. The proxy forwards response bytes before
   terminating, so it does not establish that the submission acknowledgement was
   withheld. Required: deterministic submission-response interruption, observed
   injection evidence, restored connectivity and client reconciliation, and
   independent admission/effect assertions.
   Partial repair: a strengthened real-socket test demonstrated that response
   severance leaked all 25 response bytes before reset. The proxy now severs
   before forwarding and no longer injects a synthetic NUL byte; the client
   observes a reset and zero bytes. A concurrent-response regression also proved
   that the global connection count retroactively selected an earlier skipped
   relay. Selection is now bound to each relay and arming instance. All eight
   socket tests pass (22 assertions). Scenario arming is awaited before invoking
   submission, removing that race. The threshold assumption, injection receipt,
   recovery and exactly-once assertions remain open. The prepared proxy image
   must be rebuilt before a real run can exercise this source repair.
   Control-input regression: `mode=typo` previously returned 200 and armed an
   immediate cut. Unknown modes, negative/fractional/non-finite/unsafe thresholds,
   duplicate and unknown arming parameters now refuse without changing state;
   direct arming validates numeric bounds too. Nine real-socket tests pass
   (41 assertions), as do TypeScript and diff checks.
   Partial-startup regression: forwarding bind failure previously threw after
   opening the control listener. Startup now returns its declared listen refusal
   and closes the control listener when the second bind fails. A real-socket
   subprocess verifies the refusal and successful rebinding of the same port;
   all ten proxy tests pass (45 assertions), with TypeScript and diff checks.
   Recovery assertion added (live verification pending): after disarming, the
   scenario now invokes `operation-restart` for the original local operation,
   quoting its observed revision and `ambiguous_submission` category. It
   requires a first-application resume receipt and then the original operation's
   successful result with the expected `repository_path`; a second recovery
   park or terminal failure no longer passes. Two helper tests (12 assertions)
   validate exact preconditions and refuse missing/unsafe revisions or a changed
   category. TypeScript and diff checks pass. This implementation is not yet
   live evidence of recovery: the rebuilt proxy image and correctly identified
   sibling candidates remain prerequisites. Targeted injection and independent
   admission/effect counts remain open. Additional isolation gap found: early
   returns before the explicit disarm can leave the shared proxy armed; cleanup
   must cover all exits, not just the successful observation path.
   Isolation repair: the armed section now owns a disarm attempt on every
   return or exception, including an arming request whose response is lost.
   The explicit pre-recovery disarm remains; final cleanup is idempotent and
   independently verified. Cleanup refusals/exceptions force failure without
   erasing the original observation diagnostic. Four recovery/cleanup tests
   pass (33 assertions), and the combined MCP/recovery/cleanup run passes
   31 tests (111 assertions), with TypeScript and diff checks clean. These
   are callback-level lifecycle tests; live shared-proxy revalidation remains
   pending with the other severance changes.
   Correction to the preceding cleanup evidence: subsequent inspection found
   that the indentation rewrite had accidentally removed both wrapper-call
   boundary lines. Helper-only tests stayed green but the actual scenario no
   longer invoked cleanup. A new isolated subprocess test ran the real scenario
   through an early submission refusal and failed with only `/arm/client`
   recorded. Restored the wrapper call and expanded the scenario-level test to
   submission exceptions and lost arming responses. All seven severance tests
   now pass (48 assertions), with TypeScript/diff checks. The prior full harness
   pass count did not establish this wiring; the new scenario-level tests do.
   Content-evidence repair: severed and detached scenarios previously accepted
   any successful HTTP response at the folder URL. They now refuse redirects
   and require a direct 200 JSON document, read within the harness capture bound,
   with the requested `jcr:title` and `sling:OrderedFolder` primary type. Invalid
   JSON/UTF-8, wrong properties and overflow fail; overflow cancels the stream.
   Three tests first failed against the previous status-only acceptance rule.
   Combined content/severance tests pass 10/10 (61 assertions), with TypeScript
   and diff checks. Live folder readback remains pending; matching properties
   still do not prove an exactly-once execution count.
   Injection-observation repair: each arming now returns a fresh identity;
   `/observed/client` reports that identity's actual severed-relay count and
   suppressed response-byte count. Counters start at zero, cannot be inherited
   on rearming, and disappear on disarm. A real-socket regression first failed
   for absent evidence, then verified one cut, exact suppressed bytes, fresh
   rearming, and absent post-disarm evidence. The scenario requires matching
   response-mode evidence with positive safe-integer counts before disarming
   and resuming. Combined socket/scenario tests pass 18/18 (110 assertions),
   plus TypeScript and diff checks. A new proxy-image rebuild has started.
   This proves a response was cut in this arming, not that it was the submission
   response; the five-connection assumption remains and request-targeted
   injection is still required.
   Request-targeting implementation started: the proxy control now accepts an
   exact bounded HTTP/1.1 request line in response mode (without a connection
   threshold). It inspects only the first line, including bytes received before
   the upstream connection opens; headers and bodies are not searched. This
   matches the client's cleartext HTTP/1.1 `Connection: close` implementation.
   A real-socket regression first failed, then proved unrelated paths/methods
   pass untouched and the exact jobs POST response is reset with zero delivered
   bytes. Its observation names the selected request line. All 11 socket tests
   pass (59 assertions), plus TypeScript/diff checks. Split-line and bound tests
   remain to be added before switching the scenario. The scenario still uses
   the threshold, and the container image still predates request targeting.
   Target-framing verification: a real upstream coordinates each split so the
   second fragment is sent only after the first arrives, testing every boundary
   of the request line including split CRLF. Every target response resets with
   zero bytes delivered and the upstream receives the exact request. Additional
   tests cover the 1024-character target limit and one beyond, invalid/control
   input, no threshold combination, an oversized observed line, and matching
   text in a body. None of the non-target cases produces a cut. All 13 socket
   tests pass (191 assertions), with TypeScript/diff checks. Scenario wiring
   remains pending: targeted injection leaves lookup traffic available, so the
   assertion must distinguish successful automatic reconciliation from a
   recovery park that requires guarded restart, without accepting either as
   completion unless the original operation returns the expected result.
   Scenario wiring is now implemented. Source verification of
   `selected_author_submission.rs` established that the actual POST is
   `/bin/slingshot/agent/submit`, not the `/jobs` physical-job route used in the
   initial matcher fixtures. Corrected the target and fixtures before live use.
   The scenario no longer counts connections: it requires cut evidence naming
   this exact submission request. It accepts automatic reconciliation or a
   single guarded restart after disarming, but only the original operation's
   expected folder result can pass. Six new subprocess cases run the actual
   scenario with controlled boundaries, covering both success paths and wrong
   result, missing cut, wrong target, and persistent recovery park. They verify
   one create invocation, the original identifier throughout, and exact restart
   preconditions/order. Combined proxy/scenario tests pass 27/27 (309
   assertions), plus TypeScript/diff checks. The targeted proxy image rebuilt
   successfully at
   `sha256:0642ee6086b28d5000076071282a28c466e9a1cb1ef5daee63ab695d5a1a8e32`.
   Real sibling execution and independent exactly-once counts remain pending.
4. **Open: authentication refusal accepts ambiguity.** The scenario expects
   `ambiguous_submission` and treats any failure of a local database lookup as
   proof of no agent admission. Missing/unreadable database evidence cannot prove
   absence in the agent. The client's `selected_author_submission.rs` deliberately
   classifies POST 401 as unknown; this must be reviewed against the protocol's
   authority rules before changing it. Require independent absence evidence and
   distinguish pre-submission authentication failure from an ambiguous POST.
   Partial repair: removed the local lookup-failure-as-absence assertion.
   The scenario now captures the isolated author's retained logical-operation
   inventory before and after the exchange using authenticated repository reads.
   It requires an unchanged generation/bucket/identifier set. Non-200 responses,
   redirects, non-JSON, malformed/truncated trees, invalid buckets, and capture
   overflow fail rather than prove absence. Three parser/real-HTTP tests pass
   (19 assertions). The generation prefix is checked against `StatePath` (`g1`,
   not `1`). Live Sling endpoint/depth verification remains pending; unchanged
   inventories alone do not exclude admission followed by retirement between
   observations, so the success message claims only the retained evidence.
   Live diagnostic: started the explicitly identified rebuilt agent JAR
   (`dce887e78d22d779d97c3ab2a8b0817896eaffd5e362b13a65aae4ca9a9430b0`)
   without changing candidate pins or claiming release provenance. The author
   became ready, and the actual inventory endpoint answered 200 with JSON
   content type. Its empty `sling:Folder` includes `jcr:createdBy` and
   `jcr:created`, which the initial parser incorrectly rejected. Reproduced the
   exact metadata in a failing test, then admitted only these nonempty scalar
   strings; malformed values and unknown metadata remain refused. All four
   inventory tests pass (24 assertions), plus TypeScript/diff checks. The
   diagnostic terminated with the original parser failure and clean teardown;
   a follow-up request raced its teardown, so the repaired helper has not yet
   been verified against a new live author. Populated-tree depth also remains
   to be verified live. The observed continuation-readiness delay settled and
   was not a startup failure.
   Fresh live revalidation now passes (diagnostic exit 0): the repaired helper
   reads the new author's empty inventory, then reads exactly one deliberately
   planted synthetic `g1/aa/bb/<64-hex-id>` leaf through `.4.json`. This verifies
   the real endpoint, media type, folder metadata and populated traversal depth.
   The synthetic leaf was not submitted as a command and is not admission or
   execution evidence. The diagnostic container, its synthetic repository and
   network were removed with an empty cleanup-failure list. Added a parser
   assertion for creation metadata at every intermediate depth; TypeScript and
   diff checks pass. Before/after inventory observations still cannot, alone,
   exclude an operation admitted and retired between captures.
5. **Open: exceptional runs lose scenario evidence.** Setup/scenario exceptions
   and leak-check failures can bypass report publication. The plan's run-report
   task requires every discovered scenario to have an outcome or not-run reason.
   Partial repair: after side resolution and inventory discovery, image/network/
   runtime exceptions preserve structured reports with explicit `NOT_RUN` entries.
   Cleanup independently attempts stop, remove, network removal, leak checking,
   and scratch removal, retaining both refusals and exceptions. Run-level failures
   force exit 1 even when every scenario passed. Real-command subprocess tests
   verify failed report publication; isolated orchestration tests inject image,
   network, and author exceptions together with a separate leak-check failure.
   A further regression throws in the second scenario and verifies that the
   earlier success, throwing scenario, later not-run entries, every container's
   cleanup, and an independent leak failure are all retained.
   Discovery repair: a new subprocess regression first confirmed that an
   unreadable scenario inventory escaped report construction. Discovery now
   runs inside the protected setup block. Its failure preserves resolved side
   identities and run-level diagnostics, with an empty inventory because no
   scenario names were discovered; independent teardown failure is retained
   too. The reporting/command/orchestration suite passes 17 tests (156
   assertions), plus TypeScript and diff checks.
   Remaining: malformed values and malformed/unresolved side inputs still
   precede report construction.
6. **Open: sibling policy drift.** Agent
   `policy/client-route-constants.toml` records old `/libs` routes; the current
   client's production snapshot/jobs/high-water/artifact/event constants use
   `/bin`. Review the agent's conformance checker and compatibility routing
   against the actual sibling sources.
   Follow-up: `RouteAliasCoverage` and its tests compare the agent's two local
   policy files, not the sibling source files. The recorded historical snapshot
   can be internally consistent while providing no evidence about the current
   client. Its documentation overstated what the checker verifies. The checker
   Javadoc, contributor rule, policy comments, and compatibility guide now state
   that this is a historical local-table comparison, not sibling-source
   validation. Direct `git show` inspection of client commit
   `79397e8aa8e28bdeb65603ca7b68ae92d36c3584` confirms all five production
   constants already use the canonical routes. Historical aliases remain
   opt-in; removing support for the older recorded client requires an explicit
   compatibility decision. Source-provenance validation and live verification
   of every route remain open; documentation corrections do not provide either.
   Verification: the offline `RouteAliasCoverageTest` and
   `ProductDocumentationTest` run passes all 16 tests with no skips. This is a
   focused policy/documentation check, not another full agent quality-gate run.
   Checker repair: a new fixture demonstrated that a matching historical client
   path could conceal an alias pointing at a nonexistent canonical route. The
   new regression failed before the fix (one failure among seven route tests).
   `RouteAliasCoverage` now checks alias destinations against the route names
   loaded from the policy table, reporting `alias-unknown-canonical`. The seven
   route tests and ten documentation tests pass after the repair. This validates
   destination existence, not that an existing destination implements the
   intended client operation or that deployed servlet registration matches it.
   The follow-up formatting check and eight selected policy suites pass (82
   tests, zero failures/errors/skips), covering source policy, method shape,
   allocation, Javadoc, nullability, API shape, routes, and documentation.
7. **Open: coverage and isolation review.** Complete the mapping from both
   siblings' protocol/command contracts to meaningful positive, negative,
   disruption, artifact-upload/download, event/restart, and authorization tests.
   Inspect live SQLite copying, scenario independence, bounded waits, teardown
   failures, and archive/identity validation. Complete both sibling quality gates
   and rerun the real integration suite after repairs.
   Command-surface audit: the committed agent registry contains 64 command rows,
   but the eight current harness scenarios invoke only `create_asset_folder`,
   `load_content_as_json`, and `create_page` (3/64, about 4.7%). Only the first
   two have successful command-result assertions; `create_page` is exercised
   for its missing-template failure. This is a source-level invocation count,
   not a claim that all 64 are supported by the Sling-only runtime or that the
   new scenarios have passed live. The MCP sweep explicitly filters to control
   tools, so catalog enumeration does not add registry-command execution
   coverage. The new high-water scenario adds protocol coverage, not another
   command. A full matrix must distinguish registry presence, runtime support,
   successful execution, refusal behavior, and CLI versus MCP entrypoints.
   Additional false pass repaired: the control sweep counted missing content,
   malformed JSON, missing/non-string/unknown outcome tags, and another control's
   outcome as successful answers because it excluded only `local_application_error`.
   Two new tests first failed against the extracted existing check. Swept controls
   now require their own independently specified outcome vocabulary; unknown
   controls fail closed until reviewed. All 23 MCP helper tests pass (65
   assertions), as do TypeScript and diff checks. This validates outcome tags,
   not every payload field or independent proof of daemon execution; a live
   scenario rerun remains pending.
   MCP response-boundary follow-up: three further regressions demonstrated
   acceptance of missing/wrong JSON-RPC revisions, non-object results, and
   duplicate catalog names. The reader now requires revision `2.0`, validates
   the result before exposing it as an object, and rejects duplicate names
   instead of inflating coverage or selecting ambiguous schemas. Parsed
   result/error fields remain `unknown` until inspected. All 26 MCP tests pass
   (76 assertions). A combined non-container run of MCP, high-water, live WAL,
   cleanup, reporting, command, and orchestration-exception tests passes 46/46
   (248 assertions); TypeScript and diff checks also pass. These checks do not
   replace the pending live MCP rerun against rebuilt, correctly identified
   sibling artifacts.
   Shared CLI-reader repair: `parseMachineEnvelope` previously selected only
   the first JSON-looking stdout line, accepting contradictory second answers
   and silently discarding non-JSON stdout. It also accepted an object without
   a valid outcome tag. Three new tests reproduced these weaknesses; the reader
   now parses the complete stdout as one object with a nonempty string outcome.
   Whitespace and pretty-printed single documents remain valid. Scenario-specific
   payload validation is still required; this is not a full closed-union schema
   validator. The combined envelope/MCP/severance run passes 33 tests (126
   assertions), and TypeScript/diff checks pass.
8. **Fixed: network leaks passed the cleanup check.** The leak check now lists
   labelled networks as well as containers. A real Podman regression leaves a
   network with no containers and verifies detection, removal, and a clean check.
9. **Fixed: failed author startup leaked its container.** Readiness failure
   returned no handle to orchestration but left the runtime running. Startup now
   retains ownership until success and removes its container on failure or an
   exception. The real unresolvable-bundle test confirms only its caller-owned
   network remains. Container stop also trims Podman's newline before comparing
   its running-state answer.
10. **Open: runtime configuration is outside recorded input provenance.** The
    harness loads three service configuration files from an ambient agent checkout
    (`SLINGSHOT_AGENT_ROOT` or a hardcoded developer path), without digest pinning
    or report entries. Thus identical candidate archives can run with different
    configuration, and a standalone checkout cannot run from the named inputs.
    Supply and verify these bytes as explicit inputs or committed harness fixtures,
    with their relationship to the candidate package verified.
    The ambient-read dependency has now been replaced with three explicit harness
    fixtures copied unchanged from the inspected agent commit, plus a closed
    SHA-256 inventory. The loader refuses altered/missing files and extra manifest
    entries, and installation uses the same bytes it authenticated. Runtime setup
    reports the names/hashes to orchestration for inclusion in both successful
    and post-load failure reports. No `SLINGSHOT_AGENT_ROOT` or developer path is
    consulted. Focused loader/report/orchestration tests passed 17/17 before the
    added report-serialization assertions; TypeScript passed. Real runtime setup
    then passed with an intentionally invalid ambient checkout: 16 combined
    runtime/fixture/report tests, 51 assertions, exit 0. The fixtures are
    explicitly separate harness inputs; matching them to candidate deployment
    package contents remains open, not implied by the bundle's digest.
    Additional orchestration assertions now verify the hashes survive both
    author-startup and subsequent scenario exceptions, while failures before
    loading do not invent configuration evidence. Combined configuration/report/
    orchestration tests pass 18/18 (166 assertions); the full harness gate rerun
    including these changes has started.
    That rerun ended with 182 passes and two failures: the stale candidate pin
    and an intermittent 404 uploading the service-user-mapping configuration,
    after folder creation succeeded. This does not contradict fixture digest
    verification, but prevents calling full runtime setup reliable yet.
11. **Repair implemented: client scheduler held a blocking mutex across remote awaits.** The
    client full gate now reaches `await_holding_lock` in
    `crates/slingshot-daemon/src/service.rs:716`. `scheduler_loop` runs via
    `spawn_local` and holds the `std::sync::Mutex<DurableRuntime>` guard across
    `execute_retained_with_claim`; `answer_operation`, ownership reads, and wait
    registration also synchronously lock it. A pending remote exchange can
    therefore block local request processing and potentially the local executor.
    A real-socket regression held the author response open and reproduced a local
    ping timeout on the old code. The scheduler now has two independent live
    SQLite connections to the same verified database, sharing the existing
    authentication provider, transport, artifact store and cancellation scope.
    Claims and settlement retain the short frontend lock; remote awaits do not.
    The extended regression passes for both local ping and operation status
    while the author still withholds its response. Remaining: full sibling gates,
    rebuilt-candidate integration, and a real CLI-level slow-author scenario.
12. **Open: high-water response contracts disagree.** Agent `HighWaterServlet`
    returns generation, subscription, and numeric `events_shown`; its
    `HighWaterServletTest::alivesubscriptionAnswersItsOwnCursor` asserts that
    exact three-member JSON. Client `SubscriptionHighWater` instead denies
    unknown members and requires `format`, `transport_contract_digest`, and
    string `high_water_cursor` alongside generation/subscription. Its
    `decode_high_water` cannot accept the agent's response. The standalone
    seven-scenario suite does not exercise this recovery boundary. Resolve the
    cursor semantics and provenance requirements, then prove the exchange with
    both real sibling implementations; aligning synthetic request fixtures is
    not evidence that this response incompatibility is fixed.
    The agent's `HighWaterScenario` only checks unauthenticated, unknown-
    subscription, and malformed-body refusals. It never establishes the planned
    positive post-disconnection cursor comparison, and never invokes the client
    decoder. The agent's eight `HighWaterServletTest` checks passed in the
    current preparation run while this cross-project mismatch remained.
    Added `high-water.scenario.ts`: it submits through the real client, waits
    for success, resolves the admitted agent snapshot's subscription/generation/
    contract, obtains a CSRF token, and POSTs a capture. It checks the client's
    closed response shape and binding, not full recovery. Run
    `run-1789509553091` reproduced the three-member `events_shown` response and
    failed this new scenario while the original seven scenarios passed. The
    validator's two unit tests (24 assertions) and TypeScript check pass.
    That run completed teardown and exited 1, proving a real incompatibility
    now makes the standalone command fail instead of remaining undetected.
    Repair implemented in the agent servlet: successful capture now returns
    the five client-required members; the cursor uses the stream's existing
    `generation:sequence` representation and the snapshot's `0:0` sentinel for
    nothing shown. A generation mismatch additionally returns the reset reason,
    requested generation, and null requested Last-Event-ID. Three new/strengthened
    assertions failed on the original servlet; all eight high-water tests then
    passed after the change. Wider core tests and rebuilt-bundle interoperability
    remain pending; the original pinned bundle has not been relabelled as a
    build of these uncommitted changes.
    The complete agent core suite subsequently passed: 1,180 tests, zero
    failures/errors/skips. Core Checkstyle also reports zero violations.
13. **Repair implemented: agent release verification compared against rewritten hashes.**
    `verify_release_artifacts` copied the first artifacts and recorded their
    hashes, but never checked those saved hashes; its second comparison reread
    the inventory rewritten by `build_release_artifacts`. A real-process fixture
    changed `artifact.txt` from `before` to `after` and rewrote its inventory;
    the original verifier exited zero and claimed identical artifacts. The
    verifier now authenticates the copied first-build bytes and compares the
    rebuilt files against a saved original inventory. Added process tests for
    unchanged, changed, and initially tampered bytes. Verification is pending;
    the earlier verifier success is not evidence of reproducibility.
    The eight release-artifact tests now pass, including all three executable
    regression cases. Shellcheck passes after separating setup assignments from
    readonly declarations. The corrected real verifier authenticated all eight
    original artifacts, rebuilt, and reported identical bytes with exit zero.
14. **Repair implemented: live client database copies were not atomic.** Both
    identifier lookup helpers copied the database, WAL, and shared-memory files
    independently while the daemon could write or checkpoint. Sidecar copy
    failures were also ignored as if they proved a quiescent database. Replaced
    copying with short synchronous read-only SQLite connections that participate
    in WAL locking. A real WAL regression keeps a writer open, verifies committed
    data is visible, pending changes are invisible until commit, writes through
    the reader fail, and checkpointing preserves the observed row. TypeScript
    checks pass. Full container-backed scenario verification remains pending.

15. **Open: agent attempt-counter consistency.** Do not use snapshot `attempt`
    as an independent execution count yet. `OperationLookupServlet.rendered`
    publishes `LogicalOperation.attempts()`. New logical records start at zero;
    state moves preserve that value, and the sole incrementing method,
    `LogicalOperation.attempted()`, has no production caller. Actual delivery
    recording in `Outbox.record` creates child records and counts those children
    instead. `RestartRecovery` also consults the separately stored logical
    `attempts` property. The two representations are not synchronized by the
    inspected production paths. The lookup test builds its expected document
    from the same logical-record accessor, so it does not check delivery-count
    consistency. A new Oak-backed servlet regression now reproduces the defect:
    recording the same immediate delivery twice leaves one durable outbox entry,
    but the actual lookup response reported zero attempts (nine tests, one
    failure before repair). Lookup now derives its count from the outbox instead
    of introducing another mutable counter. Complete offline core tests passed:
    1,182 tests, zero failures/errors/skips, Maven exit 0.
    Recovery's stale-property reader was independently reproduced next: 64 real
    outbox deliveries still yielded `RESTARTABLE` instead of `UNDETERMINED`.
    Its old fixture manually wrote the stale counter, masking the same defect.
    The fixture now records real deliveries, with a new 63/64 boundary and
    duplicate-delivery regression. Before repair, two of 12 recovery tests failed;
    after switching recovery to the same outbox-count implementation, all 12 pass.
    Complete offline core verification passed after that repair: 1,183 tests,
    zero failures/errors/skips, exit 0. A complete agent quality gate rerun has
    started; its prior green result predates both attempt-counter repairs.
    Harness lookup evidence is now validated centrally: exact requested operation
    identifier, known event kind, positive safe-integer generation, distinct
    nonempty delivery IDs, and a nonnegative safe-integer attempt count matching
    their count. Success without a delivery is refused. The detached scenario
    now uses the same reader as write/read, failure, high-water and severance.
    Direct JSON HTTP 200 is required and redirects are refused. Three new tests
    pass (32 assertions), including exercising the reader's HTTP boundary;
    TypeScript passes. This is selected-field consistency validation, not full
    wire-schema validation, independent admission/effect counting, or a live
    rerun with acknowledged candidates. Snapshot body bounding was subsequently
    reproduced with a valid document one byte past the configured capture limit
    (the old reader accepted it). The shared reader now enforces the byte bound
    while streaming, cancels on overflow, releases its lock, and refuses invalid
    UTF-8/JSON or stream errors. Exact-limit/multibyte and cancellation tests pass.
    Combined snapshot/detached/severed tests pass 17/17 (123 assertions), with
    TypeScript and whitespace checks passing.
    A delivery count is still not a handler-effect count: fences may refuse a
    delivered job before execution. These are repository-backed servlet tests,
    not a new live sibling integration run.

16. **Repaired: detached operation could pass without successful creation.**
    Its old disposition comparison mapped every non-result client outcome to
    agent failure; if folder properties happened to match, failed and parked
    operations passed. Successful envelopes with missing or wrong result paths
    also passed. New isolated-process tests execute the real scenario with those
    boundary responses: before repair four of six tests failed by observing a
    false pass. The scenario now requires `operation_result` naming the expected
    folder path, followed by an agent success snapshot and content readback.
    All six tests pass. The success message no longer claims acknowledgement
    preceded completion: receipt observation alone cannot establish that timing.
    Combined snapshot, content, detached and severed-recovery tests pass 18/18
    (125 assertions); TypeScript and diff whitespace checks pass. Live candidate
    verification remains outstanding.

17. **Repaired: write/read ignored read-result address and property types.**
    The readback asserted title and primary-type text but did not bind the
    result/document paths or inspect the declared property type/cardinality.
    Extracting those existing checks unchanged allowed regressions to demonstrate
    acceptance of a wrong-path result and a wrongly typed title. Validation now
    requires both paths to match, inline disposition, a single string title and
    a single name-valued primary type, with no contradictory plural values.
    These spellings were checked against `LoadContentResult` and
    `RepositoryValueKind`, not inferred from the harness's old comment.
    Both focused tests pass (20 assertions), including malformed shapes and
    primary-type mutations. Combined scenario checks passed 19 tests before the
    last eight negative assertions; TypeScript and whitespace checks passed.
    This does not cover artifact-form reads or replace live sibling verification.

18. **Open: authentication-refusal does not observe the client's HTTP refusal.**
    Wrong credentials plus `operation_recovery_required`, `ambiguous_submission`
    and evidence containing `SubmissionUnknown` do not uniquely establish a 401.
    The independent unchanged inventory checks retained admission, not the cause
    of non-admission. Source tracing confirms the client maps a submission 401
    to `UnknownCause::LookupRequired`, but other paths also produce that cause,
    and body/media failures also become `SubmissionUnknown`. Therefore current
    assertions can fit unrelated failed exchanges. An independent preflight 401
    alone would not prove the actual client request's result. Required follow-up:
    correlate the submitted request with observed HTTP refusal evidence (without
    exposing credentials), and regress unrelated exchange failures. This finding
    is source-backed; no live wrong-cause fault injection has yet been run.
    A bounded first-response-line observer has now been added as preparation:
    it retains at most 1,024 bytes, yields only a valid final HTTP/1.1 status,
    clears buffered bytes, and cannot be rescued by status-looking body text.
    Informational responses and other protocol versions are conservatively
    unsupported, not interpreted as final refusals. Three tests pass (111
    assertions), covering every first-line split, exact-size/overflow, malformed
    statuses, and header/body exclusion; TypeScript passes. The forwarding proxy
    now exposes non-cutting `observe` mode with a required exact request line,
    per-arming matched-request count and bounded status-code counts. Only
    connections opened under that arming qualify; old observations cannot migrate
    into a later arming. Real-socket tests confirm matched 401 counts, exclusion
    of unrelated 200s, unchanged request/response bodies, no credential output,
    fresh counters after re-arming, and disarm cleanup. Existing severance tests
    pass too: combined 17 tests, 321 assertions, TypeScript and whitespace clean.
    The authentication scenario now points its wrong-credential profile through
    the proxy, arms exact submission-POST observation before submitting, and
    requires every matched request to have a 401 with no cut/suppressed bytes.
    Shared cleanup disarms even after unanswered arm requests and exceptions.
    Seven authentication tests pass (40 assertions), exercising the actual
    scenario with missing status evidence, changed inventory, arm/submission
    exceptions and cleanup failure. Existing severance/recovery tests still pass
    after sharing cleanup (14 tests, 112 assertions); TypeScript passes.
    A real-socket overlap regression now confirms that a late 403 from an old
    arming cannot enter a new arming's counts; a subsequent matching 401 does.
    Combined scenario/proxy/status tests pass 97/97 (748 assertions across 14
    files), with TypeScript and whitespace checks clean. Image preparation passed;
    the proxy now pins
    `sha256:8b3289003b6871bd8d56386c4d1ec14decd8c9b564a27f0484487efc9cef05a6`,
    including the new status-observer module. Tier/runner digests stayed unchanged.
    A subsequent real-socket test exercises every status-line split. It waits for
    the incomplete prefix to reach the downstream client, checks that no status
    was recorded yet, releases the remaining response, and verifies identical
    bytes plus exactly one status count. Proxy/parser tests now pass 19/19 (403
    assertions), with TypeScript and whitespace checks clean. The rebuilt image
    also passed offline digest verification. Live candidate verification remains
    open; mocked scenarios do not prove the new live path.

19. **Open: runtime readiness accepts a root 404 before setup is available.**
    The latest full harness gate failed its unresolvable-bundle regression before
    installation: creating `/apps/slingshot-agent` returned 404. The readiness
    probe `consoleAnswers` does not probe the console; it GETs `/` and accepts
    every status below 500. That is insufficient evidence that repository-backed
    POST setup is usable. An isolated rerun passed all three runtime tests (20
    assertions), so the failure is intermittent, not cleared by that rerun.
    Repair now separates console availability from repository POST availability:
    readiness requires an authenticated usable bundle listing (not a root status),
    and idempotent configuration-folder creation retries only 404/503 under the
    declared console startup deadline. Other statuses and request failures refuse;
    redirects are forbidden. Tests cover early unavailable responses, malformed
    listings, immediate authentication/error refusal and an already-expired budget.
    The unchanged real unresolvable-bundle/cleanup regression passed against
    that repair: six combined tests, 45 assertions, TypeScript and whitespace
    clean. The subsequent full harness rerun passed startup and cleanup too:
    180 tests passed; its only failure is the independently stale candidate pin.
    A later full rerun with explicit fixtures exposed a further transition:
    the second configuration upload returned 404 after folders were ready.
    Thus the folder-only retry is insufficient for the whole startup sequence.
    Deadline-bounded handling of idempotent configuration uploads and repeated
    real/full-gate verification remain required; no assertion was weakened.
    Configuration uploads now use the same original startup deadline and retry
    only 404/503. Each attempt creates fresh multipart framing around the same
    verified filename/bytes; upload conflicts remain refusals (unlike an existing
    folder). Five focused tests pass (36 assertions), including an exact deadline
    transition that proves the retry budget is not renewed. TypeScript and
    whitespace checks pass. The unchanged real runtime regression then passed
    all three tests (24 assertions, exit 0). A full harness gate rerun has started;
    its result remains pending.
    That first gate stopped at TypeScript: the newly added deadline test's fetch
    mock omitted Bun's required `preconnect` member. The mock now preserves the
    exact interface, without a cast or suppression. TypeScript and all five setup
    tests pass again; a corrected full gate rerun has started. The earlier
    TypeScript pass preceded that final test addition and did not verify it.
    A further boundary regression reproduced acceptance of a successful response
    arriving at/after the original deadline. Setup now checks completion time
    before accepting success. All six setup tests pass (39 assertions), including
    before/exact/after completion, and TypeScript passes. This last change was
    made while the prior full gate was finishing, so that run cannot establish
    verification of the final worktree; a fresh full run is required.
    It ended with 185 passes and two failures: the newly added boundary test ran
    before its repair, plus the stale candidate pin. A fresh complete gate has
    now started against the repaired final worktree.

20. **Open: reset coverage misorders the agent's decimal cursors.** Agent
   `ReplayCursor.rendered`, `OperationLookupServlet.watermarkOf`, and
   `HighWaterServlet.answered` emit unpadded `generation:sequence` strings.
   Client `ValidatedHighWater.require_snapshot_coverage` instead compares cursor
   text lexicographically. Its existing test uses padded `cursor-009` through
   `cursor-011`, concealing the decimal-boundary mismatch. The daemon calls this
   method before staging snapshots for subscription reset.
   A new client regression uses the actual agent encoding at 9/10 and 99/100.
   The focused run fails at its first case: capture `7:10` with snapshot `7:9`
   returns success where coverage must be refused (one failed test, 15 filtered
   out). The converse false refusal follows from the same comparison but later
   vectors have not run past the first assertion. This is a reproduced validator
   defect, not yet proof of an end-to-end lost-event incident. The harness's
   positive high-water shape check cannot detect it. Repair requires consistent
   cursor ordering across the protocol, decoder, reset path, and fixtures; do not
   hide it by changing only these vectors to padded strings.
   Expanded scope: `SubscriptionFold` explicitly assumes increasing sortable
   cursor values and uses the domain cursor's derived text ordering. A second
   executable regression confirms that receiving `7:10` after `7:9` produces
   `StaleCursorOnly`, not `Advanced` (one failure, 13 filtered out). Static
   inspection finds the same assumption in the durable ledger's snapshot
   coverage, recovery-floor and disposition checks, plus SQL predicates for
   advancing the ledger and compacting events. The storage paths have not yet
   been exercised with these vectors. A numeric comparison confined to the
   high-water validator would therefore be an incomplete repair. Changing only
   the agent's future wire rendering also requires handling already-persisted
   cursors: mixing padded new values with unpadded retained values is not a safe
   migration. The repair must choose and consistently enforce cursor ordering
   across wire issuance, Rust values, durable comparisons, and restart behavior.
   Repair implemented on the client: a shared domain comparator recognizes
   canonical decimal generation/sequence pairs and compares their numbers,
   preserving exact wire and stored bytes. Both cursor types, reset validation,
   ledger recovery/compaction guards and event classification use it. SQLite's
   advancement and compaction predicates explicitly use the same comparator via
   a registered collation on in-memory, startup, and live-reopened operation
   database connections. No stored identifiers, schema rows, or agent wire
   spellings were rewritten. Other historical opaque encodings retain text
   order within their own class; that class sorts before decimal pairs, avoiding
   a non-transitive numeric-or-lexical fallback. This ordering does not itself
   authorize a generation change or prove arbitrary mixed-format stream history.
   Verification: two ordering-law tests, 14 event-reducer tests, 16 snapshot
   tests, and 42 real storage-repository tests pass. The new file-backed storage
   regression advances 9 to 10, closes and reopens the database, advances to 100,
   refuses compaction beyond 100 without changes, compacts the two earlier
   positions, and treats 99 as stale. Clippy with warnings denied passes for all
   three affected libraries. The subsequent locked, offline all-storage-target
   run exits successfully with no failed tests; broader daemon and real sibling
   verification remain pending.
   Follow-up validation: dependency-direction passes all 33 local edges. The
   source-policy rescan remains red at 762 findings (previously 710), including
   old exact-line-baseline findings exposed by shifted lines in touched files.
   No finding names the new ordering module or collation installation helper;
   the baseline remains unchanged. The full daemon selected-admission target
   completes successfully against the repaired libraries: 18 tests pass with
   no failures or filtering in 234.38 seconds. That full run used the earlier
   reset fixtures; the decimal fixture enhancement below is checked separately.
   Daemon-level coverage enhancement: the atomic reset scenario now starts at
   `7:5`, normally captures `7:9` and requires snapshots at `7:10` to cover it.
   Its older-snapshot refusal case captures `7:10` and returns `7:9` for the
   second member, requiring the existing no-partial-installation assertions to
   hold. Generation-change responses and installed boundaries now use `8:10`.
   This exercises decimal ordering through authenticated transport, staging,
   durable installation, and reopen instead of relying on padded synthetic
   cursors. The focused scenario passes in 170.16 seconds (one test, 17
   filtered out), retaining its HTTP/1.1, HTTP/2, and provider-authentication
   cases. This is a real daemon/SQLite/loopback transport test, not a live
   sibling-agent run.

21. **Compaction boundary guard repaired; cursor ordering remains open.**
   `AgentSubscriptionLedger.compact_below` documented that it would not compact
   beyond the retained cursor, but performed deletion without checking that
   boundary. A real SQLite-backed regression failed when a ledger at
   `cursor-0004` accepted floor `cursor-0005`. The method now validates the cursor
   bound and refuses a missing retained cursor, a higher floor, or a floor below
   the previously compacted boundary before any deletion. Tests verify unchanged
   ledger evidence on refusal, equality at the retained cursor, repeated floors,
   empty ledgers, malformed floors, and normal compaction. The complete
   `agent_job_repository` test target passes all 41 tests, with no filtered or
   ignored tests. These comparisons still use the existing text-order contract;
   finding 20 must repair their ordering together with SQL and the other ledger
   comparisons. This guard alone does not make decimal-cursor compaction safe.
   Focused Clippy with warnings denied also passes; both worktree diff checks
   pass. The subsequent shared-order repair in finding 20 updates these guards
   as well as SQL comparisons and makes the decimal-order regressions pass.

22. **Repaired: agent cannot read its own large valid cursors.**
   `ReplayCursor.of` and the underlying generation/sequence types admit positive
   signed-long values, and `rendered` emits them as decimal. The parser's strict
   less-than-19-digit check nevertheless rejected every 19-digit value. A new
   round-trip test fails before the repair at the 18/19-digit boundary. Parsing
   now checks decimal characters, length, and the maximum signed-long value
   before conversion. The regression covers the largest 18-digit value, the
   smallest 19-digit value, `Long.MAX_VALUE - 1`, `Long.MAX_VALUE`, and overflow
   in either generation or sequence. All eight `EventReplayTest` cases and
   Checkstyle pass after the repair. The local release rebuild completes and
   records all declared artifacts and 111 BOM components. The rebuilt core JAR
   SHA-256 is `cc4af8739fef393f839cf8edf089250bd002a89340b26b03de890adb7ae074a2`.
   The subsequent full offline agent gate completes with exit 0 and
   `gate passed`, including 466 interop tests. Optional owner tiers are explicitly
   excluded. Harness candidate acknowledgements and source pins remain unchanged.
   This new local digest is
   build evidence, not an owner-acknowledged candidate identity.

23. **Repaired: high-water capture bypassed the harness byte bound.** The
   scenario previously called `Response.json()` directly for its CSRF token and
   captured high-water document. Both now use a streaming JSON reader enforcing
   the configured capture-byte limit, direct HTTP 200 JSON media, fatal UTF-8
   decoding, cancellation, and reader-lock release. Error diagnostics do not
   include parser or stream exception excerpts that could contain token bytes.
   Six focused high-water/reader tests pass (44 assertions), including exact
   multibyte bounds, overflow cancellation, invalid status/media/encoding/syntax,
   and cleanup plus redaction on read failure. TypeScript passes. This is not a
   complete client wire-decoder conformance check, and the full harness gate has
   not been rerun for this change.
   Follow-up: six isolated subprocess cases now exercise the actual high-water
   scenario with mocked transport/support boundaries, not a mocked JSON reader.
   They verify exact POST binding and token forwarding, token refusal before
   any POST, both HTTP refusals, both overflows and cancellation, and mismatched
   response identity. Overflow bodies are finite, valid JSON with excess
   whitespace, so failure cannot be attributed to bad syntax or schema and a
   regression cannot consume an infinite fixture stream. All 12 focused tests
   pass (86 assertions), together with TypeScript. This remains local scenario
   coverage rather than a live sibling run.
   Duplicate-field repair: the client deserializes a closed typed high-water
   struct and rejects duplicate members, while native `JSON.parse` silently
   keeps the last value. A new regression demonstrated that false acceptance.
   After native syntax validation, the bounded reader now checks decoded key
   uniqueness within each object scope, including escaped spellings and objects
   inside arrays. Equal keys in separate objects and key-like string values
   remain valid. Actual-scenario cases reject duplicate CSRF-token and echoed
   subscription fields even when the final value is correct. All 15 focused
   tests pass (106 assertions); this does not claim complete equivalence with
   the client's HTTP decoder or every protocol schema.
   The subsequent full harness gate exits 1 with 203 passing tests and the
   candidate-resolution failure (1,386 assertions, 32 files). The rebuilt agent
   still differs from the acknowledged digest. No new scenario, startup,
   cleanup, stream, or type-check failure appears in that run.
   Broader validation: all 92 scenario tests pass in an isolated run with
   loopback access. The initial sandboxed attempt passed 91 tests but could not
   bind the inventory test's local HTTP listener (`EPERM`); rerunning with that
   permission succeeds without code changes or exclusions. The full harness
   container-backed gate remains pending while the agent gate owns its runtime.

24. **Event-decoder source-policy cleanup verified.** The cursor-order edit
   exposed older exact-line-baseline findings in `server_sent_event_decoder.rs`.
   Its Debug implementations now use the policy's exact external trait path,
   the resolver type parameter and formatter spell out their names, and both
   public fallible methods explain their failure behavior. The unchanged
   lowercase-hexadecimal check is shared between identifier and digest validation
   using their existing domain bounds, reducing correlation-method branching.
   All 28 event-decoder tests pass after the final edit. The source-policy rescan
   reports no findings in this decoder and 755 findings overall, down from 762;
   no baseline or suppression was added. This does not clear the full client gate.
   The follow-up high-water API cleanup documents failure behavior, names its
   HTTP status constants, and separates response preconditions from closed-body
   binding checks without changing their order. It also corrects a misleading
   comment: the POST body preserves the subscription through JSON escaping, not
   percent-encoding. Its three decoder tests and 16 snapshot tests pass, as does
   library Clippy with warnings denied. The next source-policy scan reports no
   findings in `subscription_high_water.rs` and 745 overall, down from 755;
   baseline and suppressions remain unchanged.
   A new full offline client gate is now running against advisory snapshot
   `b331df68b3ed0e99594d259040bdcb9de3c7c8a4` to verify workspace-wide effects of
   the shared cursor order and SQLite collation feature. Its result is pending;
   focused test passes above are not a substitute for that gate.
   That run has passed the minimum-supported-version workspace build,
   formatting, compilation and static analysis and reached workspace tests.
   Its authenticated high-water transport tests have passed within that run;
   the full test stage and later gate stages are still pending.

25. **Independent evidence readers accepted contradictory duplicate JSON keys.**
   Added regressions demonstrated that snapshot `attempt`, created-folder title,
   and inventory generation fields used native last-value-wins parsing. In the
   inventory case a later duplicate generation hid an invalid subtree, allowing
   an empty inventory to be accepted as admission evidence. All three new
   regressions failed before the repair (11 passing tests, three failures).
   These HTTP readers now share `readBoundedJson`, retaining their separate
   semantic validators while enforcing bounded bytes, direct JSON responses,
   fatal UTF-8 decoding, unique decoded object keys, and stream cleanup. This
   also removes inventory's replacement-character UTF-8 decoding and ensures
   its stream lock is released even when cancellation fails. The focused run
   passes 19 tests with 113 assertions; TypeScript passes. The full harness gate
   exits 1 with 205 passes, one failure and 1,390 assertions across 32 files
   (29.70 seconds). The sole failure remains candidate provenance; container
   lifecycle, proxy and cleanup tests pass. These checks strengthen evidence admission, not command
   coverage or exactly-once effect proof.

26. **MCP command success evidence was weaker than direct-command evidence.**
   Its command-call path rejected only two terminal outcomes, did not bind the
   result's repository path, and accepted any HTTP-success folder document with
   the expected title. Isolated subprocess regressions exercise that actual
   path: the valid control passed while six negative cases incorrectly passed
   (unexpected outcome, wrong/missing result, wrong node type, duplicate title,
   oversized response). The path now requires `operation_result` naming the
   exact requested folder and uses the shared bounded folder validator, with
   redirects refused. The combined protocol/folder suite passes 37 tests and
   114 assertions, and TypeScript passes. These mocked wiring checks do not
   substitute for a live sibling MCP exchange. The full harness gate exits 1:
   212 passes, one failure, 1,414 assertions across 33 files (27.32 seconds).
   The sole failure is the unchanged candidate provenance mismatch.

27. **Artifact-transfer evidence did not bind the access receipt or document.**
   The scenario compared byte counts with coercion but accepted any artifact
   identifier, ignored the access entry's operation and digest, ignored failed
   measurement/read command exits, and checked property text without its type
   or document path. Nine isolated subprocess cases exercise the actual scenario;
   the valid control passed while eight negative cases incorrectly passed before
   repair. The access entry must now match the requested local artifact, original
   operation, digest and numeric byte count; measurement and read commands must
   exit successfully; the loaded document must name the requested path and carry
   each planted property as a single string. All nine tests pass (27 assertions),
   as does TypeScript. The full harness rerun exits 1 with 221 passes and only
   the candidate-provenance failure (1,441 assertions, 34 files, 27.98 seconds).
   This does not prove
   resumed/partial artifact transfers, publication atomicity, or real sibling
   exchange of the current dirty builds.

28. **IMS HTTP/2 driver policy repair verified against existing behavior tests.**
   The full client gate's policy failure led to inspection of the authentication
   driver's 24-branch response reader. Its existing six driver tests passed
   before the change. The reader now separates deadline-owned frame reading,
   frame dispatch, control confirmation, and successful GOAWAY validation; the
   writer separates its post-request control drain. The partially consumed
   frame's read future stays pinned across request-completion notifications,
   and timeout checks, credit confirmation, cancellation ownership and shutdown
   ordering are preserved. Wire constants and generic names are explicit and
   the public fallible exchange documents its refusal conditions. All 22 driver,
   header and response tests pass afterwards, including paused-clock deadline
   and cancellation tests; library Clippy passes with warnings denied. No source
   policy findings remain in `identity_management_http2.rs`; the repository
   count is 736, down from 745. No baseline entries or suppressions were added.
   The full client gate has not been rerun after this refactor and remains open.

29. **Event attachment and authenticated-read policy cleanup verified on wire tests.**
   Replaced abbreviated event-delivery generic/closure names, used the HTTP
   library's unauthorized status constant, named nanoseconds-per-millisecond,
   and documented public authenticated-read refusals. Cursor validation,
   heartbeat timing, elapsed-time rounding, and one-refresh retry behavior are
   unchanged. The existing loopback event-attachment and authenticated-refresh
   tests both pass before and after the edits; library Clippy passes with
   warnings denied. The source-policy scan has no findings in either
   `selected_author_events.rs` or `selected_author_authenticated_read.rs`, and
   its overall count falls from 736 to 730. No baseline/suppression was added.
   This does not clear the remaining policy failures or establish live sibling
   authentication coverage for the dirty candidates.

30. **HTTP/1 artifact transport separated below the source-size ceiling.**
   The 1,046-line `selected_author_http.rs` mixed finite exchanges, framing and
   artifact streaming. Artifact methods and their streaming helper now live in
   a private child module without changing public method paths or receipt types.
   The parent is 753 lines and the child 365 lines. Bounded refusal handling and
   final deadline/length/digest validation are separate helpers; wire constants
   and fallible public contracts are explicit. The existing artifact wire test
   passes before and after extraction, the finite framing-refusal regression
   passes, and library Clippy passes with warnings denied. No policy findings
   remain in the child module; the parent is below the file ceiling but still
   has other findings. Overall policy diagnostics fall from 730 to 723 without
   baseline additions or suppressions. The full client gate remains open.

31. **Chunk-extension parser decomposition and byte-class coverage.**
   The existing two grammar/overflow tests pass before refactoring. Quoted-value
   validation now has its own helper, retaining strict closing-quote, escape,
   control-character and suffix handling. Added an exhaustive 512-case check of
   all byte values, escaped and unescaped, followed by a second extension to
   verify parser position as well as character admission. All three decoder
   tests and the loopback finite-framing regression pass afterwards; library
   Clippy passes with warnings denied. The decoder complexity finding is gone
   and the repository policy count falls from 723 to 720. This is a refactor
   with expanded boundary coverage, not evidence of a newly fixed wire defect;
   other HTTP parser policy findings and the full client gate remain open.

32. **HTTP response-head validation decomposed with exhaustive status coverage.**
   Status-line validation and unique body-framing selection are now separate
   helpers from incremental header reading. Status categories use the HTTP
   library while retaining the previous acceptance set (200–299 and 400–599).
   A new test checks all 1,000 three-digit spellings and malformed lexical forms.
   All five head/chunk unit tests, including raw-versus-decoded header bounds,
   and the finite wire-refusal regression pass; library Clippy passes with
   warnings denied. The head-reader complexity finding is removed; the overall
   policy count drops from 720 to 710. No baseline additions or exemptions were
   used. Other parser findings and the complete client gate remain unresolved.

33. **Remaining HTTP/1 module policy findings repaired.** Request-owned header
   validation and decoded field-byte accounting now have separate helpers,
   preserving validation order and exact whitespace charging. Named conversion
   and delimiter constants, explicit external Debug implementation syntax, and
   full closure names remove the remaining lexical findings. The 860-line
   module has no source-policy diagnostics. All five parser/boundary unit
   tests, the bounded/ordered query wire test, and finite framing-refusal wire
   test pass; library Clippy passes with warnings denied. One initial test
   invocation produced an empty log and was not counted as a pass; the direct
   rerun completed successfully. Overall policy findings fall from 710 to 699.
   An all-target/all-feature transport-package test run is now underway to
   broaden verification of the accumulated refactors. That run is terminal
   with exit 0: 437 tests pass across 29 targets. The full client gate
   and current-candidate sibling integration remain open.

34. **Runtime readiness accepted success after its shared deadline.** New
   clock-controlled regressions reproduced late success in bundle activation,
   continuation-authority and state-route readiness (all three failed before
   repair). Each now refuses success at or after the deadline, sends no request
   once expired, and caps each request timeout to the lesser of ten seconds and
   the remaining startup budget. Capability and state probes also refuse
   redirects. Tests cover one tick before, exactly at, and after expiry, plus
   no-request-on-expiry and the exact remaining timeout. The focused readiness
   and configuration suite passes nine tests; TypeScript passes. The first full
   harness run exposed that the planted-bundle test depended on a console read
   after its 12-second budget had already expired during startup. Its declared
   budget is now 30 poll intervals (60 seconds), and activation failure retains
   the last observed bundle state rather than losing it when the final poll
   cannot start. The final full harness run exits 1 with 224 passing tests and
   only the unchanged candidate-provenance failure (1,477 assertions, 35 files,
   77.47 seconds). State-route readiness still relies on status 404 alone and
   needs stronger identity-bearing evidence; this deadline repair does not
   establish that an arbitrary 404 proves route registration or state access.

35. **A platform 404 falsely counted as state-route readiness.** The actual
   agent intentionally conceals operation existence: `OperationLookupServlet`
   returns positive integer Retry-After and `AgentServlet.refuse` emits an
   explicitly empty body, not an identity-bearing JSON document. A scenario
   regression first showed that an HTML platform 404 passed readiness. The
   harness now requires a direct 404 with that retry header, Content-Length 0,
   and an actually empty completed body; malformed/refused bodies are cancelled
   and reader locks released. This distinguishes common platform errors without
   inventing a protocol identity claim. Deadline checks still follow completed
   body validation. The focused readiness/deadline suite passes six tests with
   59 assertions, including real HTTP and cancellation-failure cases; TypeScript
   passes. The full harness rerun exits 1 with 227 passes and only the unchanged
   candidate-provenance failure (1,500 assertions, 36 files, 74.30 seconds). This is not proof
   against a different endpoint deliberately imitating the same wire response.

36. **Runtime JSON readiness accepted ambiguous and unbounded documents.**
   Bundle activation and continuation-authority probes used unbounded native
   JSON parsing; duplicate fields could overwrite Installed/false with
   Active/true. Both new regressions failed before repair. The shared JSON
   reader now lives under `src/harness` and is reused by runtime and scenario
   evidence: direct 200 JSON, configured byte bound, fatal UTF-8, unique decoded
   keys and stream cleanup. Bundle identity duplicates are refused rather than
   reduced to the last row. The focused suite passes 16 tests and 125 assertions,
   including oversized documents, wrong media/status, duplicates and deadline
   boundaries; TypeScript passes. The full harness gate exits 1 with 229 passes
   and only the unchanged candidate-provenance failure (1,522 assertions,
   37 files, 74.44 seconds). The readiness
   flag is not a substitute for validating the full capability contract, which
   remains the client's responsibility during its actual agent exchange.

37. **HTTP/1 event-driver policy cleanup verified.** Generic names now state
   resolver, consumer and output roles; the read-buffer size and test timing,
   generation and capacity values are named. The heartbeat lower-bound
   assertion reads the contract-owned heartbeat timeout instead of restating
   45 seconds, and fixed framing derives its heartbeat byte count from the
   fixture itself. Public attachment failures are documented without changing
   retry, delivery or framing behavior. All four existing driver tests pass
   before and after the edits; the real loopback attachment/preflight regression
   and library Clippy also pass. No policy findings remain in
   `selected_author_http1_events.rs`; the overall count is 682, down from 699,
   with no exemptions or baseline additions. The earlier full transport-package
   pass predates this cleanup; the full client gate remains unresolved.

38. **HTTP/2 request encoding boundary coverage expanded.** Review confirmed
   that request encoding uses the shared selected-origin/authentication gate;
   no new encoder defect was demonstrated. HPACK literal-length tests now check
   exact expected prefixes at zero, 126/127/128, 254/255 and 16,510/16,511 bytes,
   with both ASCII and high-byte payloads. Frame reconstruction/flag checks now
   cross the second continuation boundary and include three full fragments.
   All three encoder tests and the selected-origin/query/authentication preflight
   regression pass; library Clippy passes. The source-policy count remains 682,
   with no additional findings in the encoder. These tests do not clear the
   shared HTTP/2 driver's remaining complexity findings or the full client gate.

39. **Shared HTTP/2 response driver decomposed without relaxing completion.**
   The 31-branch reader now delegates frame classification, deadline state,
   and final stream draining. An in-progress frame read remains pinned when
   request completion changes the header deadline; flow-control credit is still
   confirmed before another DATA frame is admitted, and available trailing
   response frames are still checked before completion. The async helper keeps
   a mutable consumer borrow, preserving Send callers without imposing Sync.
   Writer post-request control draining is also separate. All ten driver tests
   pass before and after the reader changes; all 62 HTTP/2 module tests pass
   after the final writer cleanup, and library Clippy passes. Workspace-wide
   all-target/all-feature compilation passed after the reader refactor. The
   974-line driver now has no function-complexity findings, though naming and
   constant findings remain; the overall count is 678 versus 682 previously.
   The real cleartext/TLS finite-exchange regression also passes. These checks do
   not establish the full client gate or current-candidate sibling integration.

40. **HTTP/2 driver production policy cleaned up; fixture debt stays visible.**
   Wire frame kinds, acknowledgement flags, receive-window credit shape and
   time conversion now have explicit names; generic names state consumer and
   reader roles, and the public exchange documents failure conditions. The
   unchanged driver fixtures moved into a dedicated test module while retaining
   their existing module path for sibling test consumers. Production is 578
   lines and fixtures 413 lines. All 62 HTTP/2 module tests and library Clippy
   pass. The production driver has no source-policy findings; 66 remain in the
   moved fixtures and were neither suppressed nor baselined. The overall count
   drops from 678 to 660. This is not a full client-gate or sibling-candidate pass.

41. **HTTP/2 driver fixtures now satisfy numeric-value naming policy.**
   Named the existing frame sizes, fixture windows, phase budgets, traffic
   intervals and test bounds without changing their values. Fixture protocol
   constants remain independent of production encoder constants; expected wire
   literals remain in assertions. The consumer uses the existing flow-credit
   type alias. All 62 HTTP/2 tests passed after the first naming pass; library
   Clippy passes after the completed cleanup. The final policy scan reports no
   findings in the fixture module and 594 overall, down from 660, without new
   suppressions or baseline entries. Formatting passes. The subsequent
   all-target/all-feature transport package run exits 0 with 438 tests across
   29 targets, including the terminal-failure suite; the full client gate
   remains red.

42. **Artifact HTTP/2 response admission decomposed with failure state retained.**
   Header admission, decoded-header validation and DATA delivery now have
   separate helpers. The outer consumer still poisons itself before admission
   and clears that state only on success; exact length, digest, private-sink,
   refused-response and stream-completion checks are unchanged. Production
   frame constants, flow-credit type and generic roles now have explicit names.
   All six artifact consumer tests pass before and after the split and after
   naming cleanup; library Clippy passes. The real socket-level artifact test
   passes after the split and again after final naming cleanup. No
   function-complexity finding remains in this
   module. Overall policy findings are 588, down from 594; 13 findings remain
   in this module, including preexisting documentation/numeric debt exposed by
   line movement. No baseline or suppression was added. The preceding 438-test
   package run predates this refactor; this focused verification does not
   replace the full client gate or current-candidate sibling integration.

43. **Artifact failure contracts documented and poisoning regression strengthened.**
   Public transfer methods now document request/authentication, transport,
   framing, sink and verification failures, explicitly withholding permission
   to publish staged bytes on error. The module description correctly refers
   to stream completion rather than requiring connection EOF. Remaining
   numeric and fixture-name findings were removed without changing values.
   A new regression checks final chunks one byte below and above the expected
   length: neither may enter the private sink, and subsequent correct bytes
   cannot repair the poisoned response or produce a receipt. All seven artifact
   unit tests pass. Library Clippy passes after the production/documentation
   cleanup, and package documentation builds with warnings denied. The policy
   count is 575, with no findings in this artifact module; no baseline entries
   or suppressions were added. Full client and sibling-candidate verification
   remain incomplete.

44. **HTTP/2 event response admission made reviewable without changing delivery.**
   Split the 21-branch consumer into header admission, decoded-head setup and
   DATA delivery. The outer failure flag still covers delegated finite error
   bodies and every event-admission helper; only successful admission clears
   it. Content-length checks still precede delivery, and previously delivered
   events are not retracted when a later frame fails. Named resolver/consumer
   roles, frame constants and the shared flow-credit type remove the remaining
   production findings. All five event module tests pass before and after the
   split, and library Clippy passes. Source policy reports 568 total findings,
   down from 575, with none in this module and no new suppressions or baseline
   entries. All 63 HTTP/2 module tests and the real socket-level event
   attachment regression pass. This does not establish a full client-gate or
   current-sibling-candidate pass.

45. **Artifact evidence no longer accepts ambiguous documents or partial counts.**
   Four new actual-scenario subprocess fixtures demonstrated false positives:
   a terminal result naming another repository path, duplicate fetched path
   members, duplicate property values, and byte-count output with trailing
   junk. All four were accepted before the repair. The scenario now binds the
   result path as well as the fetched document path, uses the shared decoded-key
   duplicate-aware JSON parser, and requires a complete canonical safe-integer
   byte count. Existing valid transfer coverage still passes. The focused
   artifact/JSON suite passes 18 tests with 67 assertions, and TypeScript passes.
   The full harness gate finishes with 233 passes and one failure, with 1,534
   assertions across 37 files. The only failure is the unchanged candidate
   digest/provenance mismatch; tooling, offline inputs, TypeScript and the
   other runtime/proxy tests pass. Candidate provenance has not been changed.
   This strengthens evidence admission, not current-candidate live
   interoperability or exactly-once transfer claims.

46. **Artifact descriptors checked against the loaded-content contract.**
   Six further actual-scenario regressions showed acceptance of a prefixed
   digest, empty remote identifier, wrong slot, wrong media type, wrong suggested
   file name and surplus descriptor member. All six failed before the repair
   because the scenario incorrectly returned success. The descriptor now must
   have the closed six-field shape, a nonempty bounded identifier, canonical
   lowercase SHA-256 text, a positive safe-integer byte length, and the declared
   loaded-content slot/media/file-name values. Those values were checked against
   the agent result schema and client artifact declarations. The success
   fixture's old `loaded_document` slot was incorrect and is now
   `loaded_content_json`, with its required media/file-name fields present.
   The focused artifact/JSON suite passes 24 tests with 85 assertions;
   TypeScript and diff whitespace checks pass. The last full harness gate
   predates this repair, and candidate provenance remains unresolved.

47. **Descriptor boundaries tested before artifact lookup.**
   The actual-scenario subprocess fixture now accepts an identifier exactly
   128 characters long and rejects one character beyond it. Zero, negative,
   fractional and unsafe-integer byte lengths are refused before artifact
   resolution; the mock throws if those cases reach that boundary. All 25
   artifact scenario tests pass. The full gate rerun finishes with 245 passes
   and the sole existing candidate-digest failure (1,570 assertions).
   Inspection also exposed an identifier alphabet gap: two new regressions
   showed spaces and Unicode were accepted despite the client requiring ASCII
   graphic characters. The harness now checks that alphabet and its byte bound.
   A trailing-newline regression also ensures no line-ending regex loophole.
   All 28 artifact scenario tests and TypeScript pass after this final repair;
   the preceding full gate predates the alphabet change.

48. **Shared machine-envelope admission rejects duplicate evidence.**
   Four new parser regressions demonstrated last-member-wins acceptance of
   contradictory outcome tags, operation identifiers, escaped duplicate result
   paths and nested property values. All four failed against the old reader.
   Client-runtime machine parsing now uses the shared duplicate-aware JSON
   parser, covering both startup and scenario consumers. Separate objects may
   still use the same field name. The focused reader/runtime/JSON suite passed
   20 tests; TypeScript caught an array-shaped result in the new positive
   fixture, which was corrected to an object containing an items array.
   The full gate after the correction finishes with 253 passes and the sole
   existing candidate-digest failure, with 1,584 assertions across 37 files.
   TypeScript, offline inputs and runtime/proxy checks pass. This run also
   covers the identifier-alphabet repair from finding 47. No candidate pin or
   owner acknowledgement was changed, and full sibling interoperability remains
   unverified.

49. **Operation waiting preserves contradictory process exits.**
   Three subprocess regressions demonstrated that nonzero exits were ignored
   when direct wait stdout reported a result, wait stdout reported terminal
   status, or the following result read reported success. The shared waiter now
   rejects nonzero exits for status, operation-result and artifact-access
   envelopes. Legitimate terminal-error and recovery envelopes remain terminal
   observations, not successful command outcomes. All seven new waiter cases
   and eight machine-reader tests pass (43 assertions); TypeScript and whitespace
   checks pass. The prior full gate predates this repair.
   Identity review found an evidence limit, not a field to invent: current CLI
   inline-result/status/terminal-error envelopes omit an operation identifier.
   Binding relies on the addressed invocation and the client's own daemon
   response checks; stdout alone cannot independently prove it. Also still open:
   the waiter checks its deadline around polling, but an individual container
   invocation has no harness-enforced timeout and can outlive that budget.

50. **Late operation answers no longer count as timely completion.**
   Fake-clock subprocess tests exposed acceptance at and beyond the scenario
   deadline on direct wait, terminal-status and fallback-result paths. All
   three cases failed before repair. Answers must now complete strictly before
   the deadline, and an expired status cannot initiate a fallback read. The ten
   deadline/exit waiter tests and TypeScript pass, followed by the isolated
   scenario suite (139 passes, 647 assertions across 18 files). This repairs
   evidence admission only: individual container
   invocations still lack cancellation. Killing a local Podman process would
   not by itself prove the in-container client stopped, so no such unverified
   cancellation claim is made. The full harness gate predates these changes.

51. **Observation commands have an in-container execution timeout.**
   Verified GNU timeout in the prepared digest-addressed client-runner image.
   Wait and fallback-result commands now run through it with the remaining
   scenario budget and SIGKILL, retaining strict host-side late-answer refusal.
   This bounds the observing CLI, not an admitted remote operation or daemon.
   A real-container test starts a waiter that ignores SIGTERM, waits for the
   timeout refusal, inspects its recorded PID to require absence or zombie
   state (no running waiter), and proves a later command still succeeds in the
   same container. Its finally block removes the owned container and captures.
   All 11 timeout/wait tests pass with 37 assertions, plus TypeScript and
   whitespace checks. The full harness gate finishes with 264 passes and the
   sole existing candidate-digest failure (1,621 assertions across 40 files).
   TypeScript, pinned/offline inputs and all other runtime/proxy tests pass.
   Remaining limitation: the timeout starts inside the container after engine
   startup/exec delivery, so engine setup or Podman itself can still stall.
   This is not proof of a hard end-to-end wall-clock cancellation bound.

52. **Truncated client output cannot masquerade as a complete machine answer.**
   Process capture previously discarded bytes beyond its bound without exposing
   that fact. A valid JSON prefix could therefore hide contradictory trailing
   output. New stdout/stderr boundary tests failed against that behavior.
   The process wrapper now records overflow while continuing to drain, and an
   explicit complete-capture option returns a typed refusal. Every client exec
   requests complete capture for both streams; ordinary bounded log collection
   retains its previous behavior. All six process-wrapper tests pass. A real
   client-runner container also accepts a machine document exactly at the bound
   and refuses the same document followed by one extra byte; the combined
   container test passes all ten assertions. TypeScript and whitespace checks
   pass. The prior full harness gate predates this repair. Candidate provenance
   and full sibling integration remain unresolved.

53. **Client capture decoding refuses malformed UTF-8.**
   A real-container regression showed that invalid stdout bytes were accepted
   after replacement decoding. Client exec now reads captured bytes through a
   fatal UTF-8 decoder for both streams, on zero and nonzero process exits.
   Read/decoding failures are typed refusals with no partial machine answer.
   BOM characters are preserved rather than silently stripped, retaining the
   downstream parser's original syntax checks. The container regression passes
   for invalid stdout and stderr, with a valid Unicode/BOM preservation check
   added for the final full gate. That gate finishes with 266 passes and the
   sole existing candidate-digest failure (1,635 assertions across 40 files).
   TypeScript, pinned/offline inputs, valid Unicode/BOM preservation, strict
   capture boundaries and all other runtime/proxy tests pass. No pin or owner
   acknowledgement was changed; full sibling integration remains unverified.

54. **Finite HTTP/2 response admission and fixtures satisfy source policy.**
   Separated head and DATA admission behind the unchanged outer poison flag.
   The decoder still validates head policy, checks bounded body storage and
   declared lengths, rejects forbidden no-content bodies, and only releases
   flow-control credit after admission. Public acceptance/completion methods
   document refusal behavior; frame and fixture values now have names while
   their wire values and independent assertions remain unchanged. The seven
   decoder tests pass before refactoring; all 63 HTTP/2 module tests pass after
   refactoring and final fixture cleanup. Library Clippy and the real
   cleartext/TLS finite-exchange test pass after the production refactor.
   The final policy scan reports no findings in this module and 555 overall,
   down from 568, without baseline additions or suppressions. The full client
   gate and current-candidate sibling integration remain incomplete.

55. **Oversized subscription ledger split without changing transactions.**
   Event-writing methods moved to a private child module; public type/method
   paths and transaction bodies remain unchanged. The main file is now 940
   lines and the child 326, both within the project ceiling. Internal cursor
   writes remain accessible only to the containing ledger module. Remaining
   event-validation complexity has not been hidden or suppressed. The final
   source-policy scan reports 566 findings versus 555 previously: movement
   exposes old exact-line-baselined debt, including fixture lines, rather than
   clearing the gate. No baseline additions were made.

56. **Old-schema storage test no longer passes on initialization failure.**
   The pre-split full storage run failed 17 capacity tests because SQLite had
   initialized before the product could install its required no-spill setting.
   A post-split run passed, exposing order dependence. The old-schema fixture
   opened raw SQLite first and accepted any product error, so it could poison
   process initialization while falsely claiming schema-refusal coverage.
   Requiring the specific current-schema refusal failed in isolation before
   repair. The fixture now initializes SQLite through an independent in-memory
   product database before constructing the historical file; it still checks
   unchanged file bytes, schema and journalling. The isolated regression passes,
   and the final all-target storage suite passes 188 tests across 12 targets.
   Product database initialization and its refusal rules were not weakened.

57. **Ledger event validation decomposed without moving write boundaries.**
   Cursor-only and active-event paths now share canonical digest validation.
   Active events separately check their retained owner/generation binding and
   contiguous nonterminal transition before opening the same write transaction.
   Validation ordering and conflict results remain unchanged; physical-job,
   observation and ledger writes still commit together or roll back. The
   13- and 24-branch methods now satisfy complexity policy, and the event-write
   module has no remaining source-policy findings. All 188 storage tests across
   12 targets and library Clippy pass. Overall policy findings fall from 566 to
   559, with no exemptions or baseline additions. The full client gate and
   current-candidate sibling integration remain incomplete.

58. **Completed-event cursor validation retains its terminal evidence checks.**
   Extracted database ownership, generation, operation, covered sequence and
   physical-job checks into a private helper, then reused canonical digest
   admission. Time/size checks keep their original order, and the same write
   transaction still rereads and compares the complete terminal view before
   cursor advancement. The completed-event method and helper now satisfy
   complexity policy. All 188 storage tests across 12 targets and library
   Clippy pass. Overall source-policy findings fall from 559 to 556 without
   exemptions or baseline additions. Snapshot-reset complexity, other client
   policy debt and current-candidate integration remain open.

59. **Snapshot-reset validation separated without weakening atomic recovery.**
   Snapshot identity, watermark coverage, nonterminal state, integer bounds,
   observation time and retained physical-job coverage now have a private
   admission helper. Its invocation stays inside the original transaction and
   loop: a later rejection still rolls back earlier associations, and the
   subscription boundary commits only after all members succeed. Recovery-view,
   active-reset and empty-reset methods now document failures; external Debug
   paths and the equivalent ASCII-control predicate satisfy naming rules.
   All 188 storage tests across 12 targets and library Clippy pass. The parent
   ledger is 951 lines; neither ledger module has source-policy findings.
   Overall findings fall from 556 to 547 with no baseline additions or rule
   exemptions. Full client-gate and current-candidate integration remain open.

60. **One SQLite FFI call replaced; no-spill policy conflict remains explicit.**
   Inspection of pinned rusqlite 0.40.2 found `version_number()` wraps exactly
   the existing version query through a safe dependency interface. The product
   now uses it; all 15 migration/initialization tests pass, including the
   isolated late-initialization refusal. Overall policy findings drop from 547
   to 546. Four raw unsafe calls and two unsafe allowances remain in database
   initialization/build checks; they were not suppressed or moved out of view.
   The pinned safe API exposes connection-level settings, but not the required
   process-wide statement-journal configuration, explicit initialization or
   pre-initialization source/build-option queries. Bundled SQLite has a compile-
   time spill default, but substituting it would change the explicitly tested
   late-initialization contract and has not been done. A safe dependency API or
   a reviewed contract/dependency change is still needed to reconcile these
   requirements. Existing runtime identity and no-spill checks remain intact.

61. **Database inventory isolated without obscuring unsafe initialization debt.**
   Physical-file accounting and database fixtures moved into private modules,
   leaving the production database file below the 1,000-line ceiling. Public
   database paths remain unchanged; inventory access stays within its containing
   module. Unix descriptor enumeration is now separate from permitted-name,
   regular-file/link and checked-byte-total validation, preserving those checks
   and the platform-specific paths. The inventory module has no policy findings.
   All 188 storage tests across 12 targets and library Clippy pass after the
   final extraction. Overall source-policy findings fall from 546 to 544.
   Unsafe initialization code and allowances remain visible in the main module;
   no baseline entries or exemptions were added. Full client and sibling gates
   remain unresolved.

62. **Database documentation and named-value debt cleared without altering rules.**
   Reopen/identity APIs now state their actual refusal conditions. Existing
   schema-version, result-column and private-directory permission values have
   explicit names, as do database fixture settings, times and partition cases.
   Installation fixture widths use the domain's identifier constant. Values,
   SQL statements and initialization behavior are unchanged. All 188 storage
   tests across 12 targets and library Clippy pass. Overall policy findings
   drop from 544 to 524; the database module's only remaining findings are its
   four unsafe initialization/build calls and two unsafe allowances, matching
   the unresolved safe-dependency-API gap. Neither rules nor baselines changed.

63. **Recovery activation now has explicit receipt and child refusal coverage.**
   The real-file storage fixture now rejects changes to each of the five receipt
   fields, a changed retained child's snapshot watermark, a different recovery
   category, and activation one millisecond before receipt creation. Every case
   asserts the complete paused operation and persisted receipt remain unchanged.
   The valid activation succeeds exactly at the receipt timestamp; existing
   injected-write-failure rollback and replay-after-reopen checks still pass.
   No production behavior changed. The focused test and all 188 storage tests
   across 12 targets pass (`/tmp/slingshot-activation-guards-tests.log` and
   `/tmp/slingshot-activation-guards-package.log`). The policy scan now reports
   600 findings: moving lines in the existing oversized agent-job fixture
   exposes 76 additional findings against its location-sensitive baseline.
   The new helper has no findings; no baseline or exemption was changed.
   These are local persistence checks, not proof of live sibling recovery.

64. **Artifact verification accepted contradictory metadata and incomplete documents.**
   Nine added scenario regressions initially passed malformed results: missing
   or wrong access-entry media type, surplus result members, a mixed inline and
   artifact result, missing children, an unexpected child, a truncated child
   list, and surplus document/property members. The command's result schema
   closes the artifact branch; the client loaded-document reader requires the
   four resource fields and exact property shapes. This scenario plants a leaf,
   so its returned children must be empty and explicitly untruncated. The
   harness now checks these constraints and binds access media type to the
   descriptor. All 37 artifact-scenario cases pass (111 assertions), and
   TypeScript passes. Before/after logs are
   `/tmp/interop-artifact-shape-before.log` and
   `/tmp/interop-artifact-shape-after.log`. This strengthens the scenario oracle;
   it does not establish canonical serialization of every repository property,
   nor replace a live run against acknowledged current sibling candidates.
   The subsequent full harness gate is terminal with exit 1: 275 passes and one
   failure, 1,662 assertions across 40 files, in 86.70 seconds. The sole failure
   remains the stale candidate digest; pinned tooling/images, TypeScript,
   real-container observations and all scenario regressions pass. Full output:
   `/tmp/interop-artifact-shape-quality.log`.

65. **Local artifact resolution silently selected ambiguous or malformed evidence.**
   The harness queried by operation and slot with `.get()`, although the storage
   primary key also includes the target digest. A real WAL-backed fixture with
   two target partitions demonstrated that the helper accepted the first match.
   Seven further cases accepted empty, null, numeric, uppercase, short, long,
   or newline-suffixed local identifiers. The helper now reads at most two rows,
   requires exactly one, and checks the client's exact 64-character lowercase
   hexadecimal local identifier shape before passing it to the CLI. The ten
   real-database cases include missing/valid matches, unrelated operation/slot
   rows, and unchanged row counts. All ten plus the 37 artifact-scenario tests
   pass (132 assertions), as does TypeScript. Before/after evidence:
   `/tmp/interop-artifact-resolution-before.log` and
   `/tmp/interop-artifact-resolution-after.log`. This proves helper refusals,
   not that every malformed association previously made the complete scenario
   green: the CLI may refuse it later. Unique resolution also does not replace
   independently binding the target partition to the selected environment.
   The complete scenario suite subsequently passes: 159 tests, 710 assertions
   across 20 files, including the real-container timeout/output-capture checks
   (`/tmp/interop-artifact-resolution-scenarios.log`). The prior full harness
   gate predates this helper repair; it remains red for candidate provenance.

66. **Remote-operation lookup also accepted an ambiguous target match.**
   The helper used by recovery/high-water observations selected the first
   matching local operation across target partitions. A real WAL-backed
   database regression failed before the repair; the other eight cases already
   passed, including malformed identifier refusals. Resolution now reads at
   most two matches and requires exactly one, with an explicit string/length/
   lowercase-hex check. All 19 agent/artifact-resolution cases pass (40
   assertions), with unrelated rows ignored and table row counts unchanged.
   TypeScript passes. Evidence is in `/tmp/interop-agent-resolution-before.log`
   and `/tmp/interop-agent-resolution-after.log`. This prevents arbitrary
   first-row evidence selection; it still does not independently authenticate
   the single row's target against the selected environment.
   The complete offline harness gate subsequently finishes with 294 passes and
   one failure (1,702 assertions, 42 files, 86.84 seconds). The only failure is
   the existing candidate digest mismatch. Both resolver repairs, scenario
   assertions, real-container tests, pinned inputs and TypeScript pass.
   Full evidence: `/tmp/interop-identity-resolution-quality.log`.

67. **Database observation loaded whole files and leaked query errors past its refusal type.**
   Both identity-resolution helpers first loaded the entire database with
   `readFile`, then separately opened SQLite. This added allocation proportional
   to the database file without helping the WAL-consistent query. Corrupt and
   wrong-schema fixtures also showed four uncaught exceptions despite the
   helpers' declared success/refusal return type. The helpers now open the
   database directly through the read-only SQLite reader, catch open/query
   failures, and return content-free diagnostic refusals. Six real-file cases
   cover missing/corrupt/wrong-schema inputs for both helpers, asserting that
   missing databases are not created and existing main-file bytes are unchanged.
   All 25 database-resolution cases pass (58 assertions), and TypeScript passes.
   Before/after logs: `/tmp/interop-database-refusal-before.log` and
   `/tmp/interop-database-refusal-after.log`. Removal of the preread is a code
   change, not a measured memory ceiling or a hard SQLite query deadline.
   The complete scenario suite passes afterward: 174 tests and 747 assertions
   across 22 files, including real-container observation checks
   (`/tmp/interop-database-refusal-scenarios.log`). The latest full harness gate
   predates this change and remains red for candidate provenance.

68. **Failure-category comparison did not bind the agent's semantic failure to its target.**
   The scenario compared only `failure` inside the agent's canonical failure
   string. Both the agent's `CreatePageHandler.refused` and the client's closed
   `CreatePageRefusal` contract also require the computed `target_path`.
   Five added scenario cases exposed acceptance of a wrong/missing target,
   surplus failure fields, and duplicate category/target members. The scenario
   now parses unique-member JSON and requires exactly the category plus the
   submitted page's computed destination. All 14 failure-category cases pass
   (58 assertions), and TypeScript passes. Logs:
   `/tmp/interop-failure-binding-before.log` and
   `/tmp/interop-failure-binding-after.log`. These tests strengthen the scenario
   oracle with substituted transport responses; they do not replace a live
   failure-category exchange between current sibling candidates.
   The complete scenario suite also passes: 179 tests, 767 assertions across
   22 files (`/tmp/interop-failure-binding-scenarios.log`), including the real
   observation-container checks. The prior full harness gate predates this
   repair and the database-open repair in finding 67.

69. **Snapshot request failures escaped the observation helper's refusal contract.**
   The lookup helper awaited `fetch` outside any refusal boundary. An injected
   request error demonstrated rejection of the promise instead of its declared
   success/refusal result. The helper now catches request/read failures without
   including private exception text. A real loopback server verifies redirects
   are refused without following the destination, and closing that listener
   verifies a connection refusal. The initial sandboxed socket attempt was
   denied permission and is not counted as behavioral evidence; a fixture
   TypeScript error was also corrected before final verification. All eight
   snapshot tests pass with loopback access (49 assertions), and TypeScript
   passes (`/tmp/interop-snapshot-transport-final.log`). These checks do not
   establish a hard deadline for every possible stalled network condition.
   The corrected full offline harness gate finishes with 307 passes and one
   failure (1,745 assertions across 43 files, 88.15 seconds). The sole failure
   remains candidate provenance. This run includes findings 67–69, pinned-input
   verification, TypeScript and real container/socket checks. Evidence:
   `/tmp/interop-observation-refusals-quality-final.log`.

70. **Operation repository split without splitting transactions.**
   The 2,028-line repository exceeded the client's 1,000-line source ceiling.
   Complete transition/publication methods now live in a private mutations
   module, and reconstruction/resume-receipt methods in a private recovery
   module. Public type paths, method bodies, SQL and transaction scopes remain
   unchanged. The resulting files are 991, 705 and 347 lines. All 188 storage
   tests across 12 targets pass before and after, including recovery activation
   refusal/rollback assertions; storage-library Clippy passes with warnings
   denied. Evidence: `/tmp/slingshot-operation-split-before.log`,
   `/tmp/slingshot-operation-split-final.log`, and
   `/tmp/slingshot-operation-split-clippy.log`. The source-policy scan now reports
   607 findings: the size violation is removed, while existing location-bound
   exemptions no longer match several moved methods. No baseline/exemption
   changes were made. Method complexity and missing failure documentation
   remain explicit work, not a claimed clean client gate.

71. **Recovery activation complexity reduced without weakening persistence guards.**
   The caller-supplied receipt identity/time guard is now a named private helper,
   still executed before the write transaction. Persisted receipt equality,
   operation revision, retained child equality, recovery eligibility, folding
   and commit remain in their original transactional order. Activation now
   meets the complexity ceiling. Its `None` outcomes and refusal conditions,
   eligible-receipt errors, and retained-input read errors are documented.
   The retained-input Debug implementation uses the policy's exact external
   trait path. All 188 storage tests across 12 targets and library Clippy pass
   (`/tmp/slingshot-recovery-guards-tests.log` and
   `/tmp/slingshot-recovery-guards-clippy.log`). Source findings fall from 607
   to 602; the parent repository and recovery module have none. Mutations-module
   findings and the broader client gate remain unresolved. No baseline changed.

72. **Artifact-acquisition admission now meets the method-shape policy.**
   The existing local-identifier/digest/slot check is extracted into a private
   pretransaction helper using the artifact store's declared digest width.
   Acquisition anchor readback uses its four named SQL columns, and the public
   method documents actual refusal conditions. No predicate, SQL statement,
   transaction scope, or persisted anchor behavior changed. All 188 storage
   tests and storage-library Clippy pass; the daemon's
   `retained_loaded_completion_binds_download_and_atomic_success` integration
   test also passes (one selected test, 17 filtered), covering durable
   acquisition, stale-revision refusal, anchor reuse and atomic completion.
   Evidence: `/tmp/slingshot-acquisition-identity-storage.log`,
   `/tmp/slingshot-acquisition-identity-daemon.log`, and
   `/tmp/slingshot-acquisition-identity-clippy.log`. Overall source-policy
   findings fall from 602 to 597 without baseline changes; the full client gate
   and current-candidate live integration remain open.

73. **Successful settlement guards clarified without moving the commit boundary.**
   Retained-child and scheduler-fence checks are private helpers taking the
   existing write transaction. Calls remain in their original order relative
   to local-row reads, environment/revision checks, artifact writes, snapshot
   persistence, publication consumption and commit. The successful-settlement
   method now meets the complexity policy, and all five public settlement
   variants document their actual failure conditions. All 188 storage tests
   and warnings-denied library Clippy pass (`/tmp/slingshot-settlement-guards-tests.log`
   and `/tmp/slingshot-settlement-guards-clippy.log`). Overall source findings
   fall from 597 to 591; the mutations module remains below the file ceiling at
   779 lines. No baseline/exemption changed. This is a verified persistence
   refactor, not a new current-candidate end-to-end integration result.

74. **Operation-repository modules now have no source-policy findings.**
   Generation-loss settlement's original database/generation/time precheck is
   a private helper; the captured recovery view, member and local revision
   checks remain in their original order, with view revalidation and mutation
   inside one write transaction. The method meets the complexity ceiling.
   The six remaining mutation APIs now document their actual refusal contracts,
   without claiming that storage authenticates remote evidence. All 188 storage
   tests across 12 targets, library Clippy and all-feature storage API docs
   with warnings denied pass. Evidence:
   `/tmp/slingshot-generation-guards-tests.log`,
   `/tmp/slingshot-generation-guards-clippy.log`, and
   `/tmp/slingshot-operation-repository-docs.log`. The three repository modules
   are 995, 822 and 370 lines with no policy findings; overall findings fall
   from 591 to 584. Baselines and rules are unchanged. The wider client gate,
   unsafe SQLite initialization gap and current-candidate integration remain
   unresolved.

75. **Storage agent-job integration tests are split without losing cases.**
   The oversized test file now retains shared fixtures in 255 lines, with
   snapshot, association, recovery and event test modules of 805, 588, 841 and
   506 lines. The existing 104-line activation-guard helper is unchanged.
   Complete test bodies moved without changing assertions. Before/after test
   inventories contain the same 42 test names (only module prefixes differ),
   and the complete storage suite passes all 188 tests across 12 targets.
   Evidence: `/tmp/slingshot-agent-fixture-list-before.log`,
   `/tmp/slingshot-agent-fixture-list-after.log`, and
   `/tmp/slingshot-agent-fixture-split-tests.log`. A direct all-target storage
   Clippy invocation passes with warnings denied. Initial captured policy
   invocations ended without diagnostics and are not relied on; the subsequent
   direct policy scan reports 583 findings, down from 584 by removing the file
   ceiling violation. Existing fixture naming/complexity debt remains; no
   baseline or exemption changed.

76. **Storage fixture widths now come from their owning domain constants.**
   Agent-job fixtures use the declared digest and installation-identifier widths
   instead of repeated 64/32 literals. Two-character seed repetitions derive
   their count from the appropriate width and seed length, preserving identical
   fixture bytes. The reservation-ownership test names its original 100/200/300
   byte amounts without changing assertions. All 188 storage tests and
   all-target warnings-denied Clippy pass. Source findings fall from 583 to 560;
   the persistent-capacity accounting file has no remaining findings, and all
   split agent-job test modules remain below the file ceiling. Evidence:
   `/tmp/slingshot-storage-fixture-values-tests.log` and
   `/tmp/slingshot-storage-fixture-values-policy.log`. No baseline or exemption
   changes were made. Remaining policy debt and live integration are still open.

77. **Snapshot integration fixtures now have no source-policy findings.**
   Snapshot sequence, attempt, progress, paused revision, observation offset and
   retention-scale values now have semantic names. The empty-object artifact's
   byte count derives from its unchanged fixture bytes. Values and assertions
   are preserved, including stale snapshot/revision refusal and publication
   rollback cases. All 188 storage tests and all-target warnings-denied Clippy
   pass. The snapshot module is 850 lines with no remaining findings, and the
   overall policy count falls from 560 to 540 without baseline changes.
   Evidence: `/tmp/slingshot-snapshot-fixture-values-tests.log` and
   `/tmp/slingshot-snapshot-fixture-values-policy.log`. This is fixture-policy
   cleanup, not new proof of current-candidate sibling interoperability.

78. **Atomic event/reset fixtures now have explicit phases and no policy findings.**
   The active-event test retains all 24 defect cases, but separates pre-capture
   history, post-capture database/write faults, and offered-event mutations.
   The active-reset test likewise separates member setup, persisted-state faults
   and supplied-snapshot defects. Every original success/rollback assertion and
   capture boundary is preserved. Event sizes, sequence gaps, reset counts,
   progress and elapsed retention now have named values. All 188 storage tests
   pass after the final lint correction, and all-target warnings-denied Clippy
   passes. Evidence: `/tmp/slingshot-event-fixture-phases-verified.log` and
   `/tmp/slingshot-event-fixture-phases-policy.log`. The event module is 582
   lines with no policy findings; the overall count falls from 540 to 528.
   No baseline, test case, assertion or product behavior was relaxed.

79. **Probe and cursor-only recovery fixtures meet the complexity ceiling.**
   Probe retained-evidence construction is a named helper evaluated at the same
   pre-capture point. Cursor-only fault injection is a separate helper called
   after view capture, preserving database-change and offered-event cases.
   Original defect lists, reads, reopen checks and assertions are unchanged.
   Fixture event byte counts and retry delay now have semantic names. All 188
   storage tests and all-target warnings-denied Clippy pass. Both refactored
   tests and their helpers meet the complexity policy; the recovery file is
   865 lines. Overall findings fall from 528 to 523, with generation-loss and
   completed-cursor fixture complexity still open. Evidence:
   `/tmp/slingshot-probe-cursor-fixtures-tests.log` and
   `/tmp/slingshot-probe-cursor-fixtures-policy.log`. No baseline changes.

80. **Completed-cursor fixture complexity cleared with all eleven cases retained.**
   Post-capture event mutations and persisted-state faults are now in a named
   helper. The wrong-subscription early refusal, view capture, independent
   database reads, write attempt, and cursor/local/remote rollback assertions
   remain in their original order. Completed and future event sequences use
   named values. All 188 storage tests and all-target warnings-denied Clippy
   pass. The test and helper meet the complexity ceiling; the recovery module
   remains below the size limit at 880 lines. Source findings fall from 523
   to 519, without baseline changes. Evidence:
   `/tmp/slingshot-completed-cursor-fixture-tests.log` and
   `/tmp/slingshot-completed-cursor-fixture-policy.log`. Generation-loss fixture
   complexity remains unresolved, along with the broader integration blockers.

81. **Generation-loss fixture complexity cleared without dropping maintenance checks.**
   Its sixteen cases remain intact. Retained certainty/recovery construction,
   post-capture database faults, and generation/revision/time arguments now have
   separate helpers. Settlement outcomes, replay refusal, independent retained
   state comparisons, empty-recovery installation, and early/aged maintenance
   assertions remain in the original test and order. All 188 storage tests and
   all-target warnings-denied Clippy pass. Neither the test nor helpers exceed
   the complexity ceiling; the recovery module is 930 lines. The current scan
   has no storage file-size or complexity findings, and overall findings fall
   from 519 to 518. Evidence: `/tmp/slingshot-generation-fixture-phases-tests.log`
   and `/tmp/slingshot-generation-fixture-phases-policy.log`. Numeric fixture
   findings and unsafe SQLite initialization remain unresolved; no rules or
   baselines were changed.

82. **Storage tests are now source-policy clean.**
   Recovery pagination derives its one-page-plus-one fixture from the SQL
   inventory's declared maximum rows, preserving today's 257-member case and
   256-row refusal bound. Terminal sequence/progress, held local revision,
   consecutive/nonconsecutive retry counts and maintenance time have semantic
   names. The initial attempt constants used the wrong integer type; they were
   corrected to the domain field's `u32` before final verification. All 188
   storage tests across 12 targets and all-target warnings-denied Clippy pass.
   Evidence: `/tmp/slingshot-recovery-fixture-values-final-tests.log` and
   `/tmp/slingshot-recovery-fixture-values-final-policy.log`. Overall findings
   fall from 518 to 504. Storage's only six findings are its four unsafe SQLite
   calls and two existing unsafe allowances; every storage-test file has none.
   The safe initialization-API gap remains unresolved. No baseline or rule was
   relaxed, and this does not clear the full client gate or candidate provenance.

83. **Transport integration fixture separated into behavior-focused modules.**
   The 5,088-line environment-provider fixture now has a 495-line shared parent
   and modules for selection, connections/TLS, events, high-water, refresh,
   finite responses, submission and artifacts. Complete test bodies moved;
   compile-time fixture paths were corrected to reference the same certificate
   and JSON files after the first compile identified the changed relative base.
   All 29 tests pass in 48.71 seconds, and before/after inventories preserve all
   original test names except module prefixes. Target-specific Clippy passes
   with warnings denied. Evidence:
   `/tmp/slingshot-transport-fixture-split-final-tests.log`,
   `/tmp/slingshot-transport-fixture-list-before.log`, and
   `/tmp/slingshot-transport-fixture-list-after.log`. Every module except the
   1,173-line submission test is below the source ceiling; that test still needs
   a semantic refactor. Policy findings rise from 504 to 506 because two existing
   single-letter shared-helper names no longer match their location baseline.
   No baseline changes were made. This verifies the moved target, not a fresh
   full-package/client gate or current-candidate sibling run.
   The two exposed helper names were subsequently spelled out as `byte`;
   target Clippy still passes with warnings denied. The terminal policy scan
   `/tmp/slingshot-transport-fixture-names-policy.log` reports 504 violations
   (exit 1). The submission fixture remains oversized and the full gate remains
   open; no policy rule or baseline was relaxed.

84. **Submission preflight separated without changing exchange ownership.**
   The submission fixture now has 994 lines and a 239-line private preflight
   helper. The helper borrows the same listener, transport, identity, credential,
   synchronous/asynchronous providers, source and expected provenance. Discovery
   still runs through all five modes and four compatibility cases inside each
   outer response-media case; invalid arguments and identity/digest refusals
   still precede the POST exchanges. Both the preflight no-socket assertion and
   final no-extra-POST assertion remain on the original listener. Canonical
   Unicode arguments stay shared with the later wire assertions. The initial
   compile caught that shared argument dependency; it was corrected before the
   successful validation runs. Warnings-denied target Clippy passes, and all
   29 environment-provider tests pass with no ignored or filtered tests in
   `/tmp/slingshot-submission-preflight-tests.log` (48.54 seconds, exit 0).
   `/tmp/slingshot-submission-preflight-policy.log` reports 503 remaining
   violations (exit 1), down from 504; no baseline or policy was changed.
   All files in this fixture family are now below the file-size ceiling, but
   that does not resolve their remaining policy findings or prove current
   sibling integration.

85. **Proxy evidence now passes bounded, duplicate-aware JSON admission.**
   Both the response-cut recovery scenario and authentication-refusal scenario
   previously used `Response.json()` for proxy observations. Four new scenario
   regressions demonstrated false success for contradictory duplicate members
   (a prior zero cut count or HTTP 500 status count overwritten by the last key)
   and bodies exceeding the configured capture limit. Both observation reads
   now use the existing `readBoundedJson` boundary before their arming, request
   target and counter checks. This also requires direct HTTP 200 JSON and valid
   UTF-8. Existing cleanup wrappers still disarm on evidence refusal. The focused
   suite passes 25 tests with 178 assertions across three files, and TypeScript
   passes. Evidence: `/tmp/interop-proxy-evidence-tests.log`; the authentication
   red run is `/tmp/interop-proxy-status-before.log`. The full harness gate is
   terminal with exit 1: 311 tests pass and only the existing candidate-digest
   mismatch fails (1,771 assertions, 43 files, 86.84 seconds). Pinned inputs,
   offline dependency installation, TypeScript and real container tests pass.
   Evidence: `/tmp/interop-proxy-evidence-quality.log`. This is not a green gate
   or current-candidate integration; no candidate pin was changed.
   The separate database lookup review still leaves independent target binding
   open: row uniqueness does not establish the expected target digest.

86. **Severance control refuses redirects instead of accepting another endpoint.**
   The response-cut scenario's arm and disarm fetches omitted the redirect
   policy already used by authentication control and observation reads. New
   real-loopback regressions demonstrate both requests following HTTP 302 to
   an unrelated endpoint returning HTTP 200 (and an arm header). Both control
   requests now set `redirect: "error"`. The regressions prove the destination
   is not contacted, cleanup is still attempted after arm refusal, and a disarm
   redirect is retained as a cleanup failure. Before-fix evidence:
   `/tmp/interop-control-redirect-before.log` (8 pass, 2 fail). After-fix evidence:
   `/tmp/interop-control-redirect-after.log` (27 tests pass across three files).
   TypeScript and `git diff --check` also pass. The last full harness gate above
   predates this change; no current-candidate live integration is claimed.
   Remaining unbounded HTTP error-body reads were also identified in planting
   and severance-control diagnostics; these are not addressed by redirect refusal.

87. **Failed HTTP setup/control requests no longer consume arbitrary bodies.**
   The four remaining scenario `Response.text()` error paths (artifact planting,
   protocol-call parent planting, severance arming and disarming) read complete
   untrusted bodies for diagnostics. An artifact-scenario regression confirms
   the previous report included the response's private marker. These paths now
   cancel the response body and retain only local operation context plus HTTP
   status. Shared stream tests prove zero body pulls, cancellation attempted
   once, and status retained even when cancellation fails or no body exists.
   The focused suite passes 85 tests with 342 assertions across five files;
   TypeScript and `git diff --check` pass. Evidence:
   `/tmp/interop-http-refusal-before.log` (37 pass, 1 fail) and
   `/tmp/interop-http-refusal-after.log` (85 pass). The full gate is terminal with
   exit 1: 317 pass, one existing candidate-digest failure, 1,798 assertions over
   44 files in 87.04 seconds. Pinned inputs, offline installation, TypeScript and
   real container checks pass. This also verifies finding 86 in the full suite.
   Evidence: `/tmp/interop-http-refusal-quality.log`. These are error-path safety
   checks, not proof of live sibling
   integration or complete command coverage.

88. **Confirmed: host deadline must include inherited capture pipes.**
   Inspection of `runPodman` shows both bounded stream drains are awaited before
   `child.exited`; byte bounds do not bound time. A controlled stand-in engine
   spawned a child inheriting stdout/stderr, wrote `engine-exiting`, and exited
   with code zero. The wrapper never returned before an external two-second
   GNU timeout stopped the experiment (terminal exit 124). The engine's captured
   marker is `/tmp/interop-inherited-pipe-lOC31f/stdout`. This is a real-process
   diagnostic, not evidence that the real Podman engine currently hangs.
   The existing in-container observation deadline cannot interrupt a stalled
   host invocation or these inherited pipes. The pinned Bun declarations also
   state that subprocess timeout/abort targets the spawned process, whereas
   detached mode provides a separate process group on POSIX. Therefore merely
   adding native subprocess timeout is insufficient: the repair needs explicit
   ownership and termination of host helpers, cancellation/closure of capture
   drains, typed timeout refusal, and deadline propagation through invocation
   and cleanup paths. It must retain cleanup of labelled containers even when
   engine acknowledgement is lost. This remains open; no timeout guarantee was
   added or claimed, and the last full gate is unchanged.

89. **Observation waits now carry a host process-and-capture deadline.**
   `runPodman` accepts an absolute deadline; deadline-owned POSIX invocations
   start in their own process group. Expiry kills that group, cancels both
   capture readers, and returns a distinct `deadline` refusal rather than
   interpreting truncated output as an answer. Expired, nonfinite, unsupported
   platform and unrepresentable timer intervals refuse before spawn. The deadline
   travels from `invokeBeforeDeadline` through `invoke` and `execInContainer`;
   the existing in-container timeout remains. Ordinary invocations without a
   deadline retain their previous behavior and are still an open coverage gap.
   Two real-process regressions previously hit their external five-second guard
   (0 pass, 2 fail in `/tmp/interop-host-deadline-before.log`). Both now pass,
   proving the direct stalled process and same-group inherited-pipe child are
   no longer running. The wrapper suite passes 8 tests with Podman access in
   `/tmp/interop-host-deadline-after-unrestricted.log`; a restricted run failed
   only its existing real-Podman version check. The real-container observation
   test passes all 15 assertions, including waiter termination and subsequent
   container usability (`/tmp/interop-host-deadline-container.log`). TypeScript
   and `git diff --check` pass. The full gate is terminal with exit 1: 321 pass,
   one existing candidate-digest failure, 1,822 assertions over 45 files in
   89.03 seconds (`/tmp/interop-host-deadline-quality.log`). This includes the
   invalid-deadline, successful-completion and deadline-propagation cases, real
   container checks, pinned inputs, offline installation and TypeScript.
   Startup, ordinary invocations and cleanup still need deadline propagation;
   escaped process sessions and kernel-level uninterruptible waits are not
   covered by the same-process-group termination evidence.

90. **Startup no longer accepts readiness after its declared deadline.**
   Both generic container startup and client-runner startup previously tested
   probe success before comparing time, allowing a late true result to become
   a ready handle. New controlled-clock tests cover completion immediately
   before, exactly at, and immediately after the deadline, plus a deadline
   already expired before probing. Both test matrices failed before the fix.
   Both loops now check before probing and again before returning a ready
   handle. Late answers follow the existing timeout/removal path; already-expired
   waits do not run a probe. The matrices pass (two tests, six compound
   assertions) in `/tmp/interop-startup-deadline-after.log`; red evidence is
   `/tmp/interop-startup-deadline-before.log`. TypeScript and `git diff --check`
   pass. Full-gate verification is terminal with exit 1: 323 pass, one existing
   candidate-digest failure, 1,828 assertions across 46 files in 98.56 seconds
   (`/tmp/interop-startup-deadline-quality.log`). Pinned-input verification,
   offline installation, TypeScript and real container checks pass. This fixes
   late success, not stalled
   probe cancellation. Inspection also confirms orchestration removes only
   retained handles and detects remaining labelled containers via its leak
   check; ownership recovery for a lost startup acknowledgement remains needed
   before startup host timeouts can safely be extended.

91. **Run ownership labels no longer collide at one clock value.**
   The orchestration label was `run-${Date.now()}`. A regression invokes the
   actual orchestrator twice with a frozen clock and mocked startup failure;
   both reports previously named `run-100`. Labels now use `run-` plus a fresh
   cryptographic UUID, and the network name/report identity continue to derive
   from that label. The 40-character label keeps the `severed-` and `refused-`
   profile names below the client's inspected 64-byte profile-name limit.
   The failure/report/command suite passes 22 tests with 193 assertions after
   the fix, including distinct labels under the unchanged clock. Evidence:
   `/tmp/interop-run-identity-before.log` and `/tmp/interop-run-identity-final.log`.
   TypeScript passes. This is a prerequisite for safe ownership recovery after
   lost startup acknowledgement; automatic label-based deletion is not yet
   enabled. The last full harness gate predates this label change.

92. **Teardown recovers containers missing from its acknowledged handle list.**
   After normal handle cleanup, orchestration now lists containers with the
   current UUID run label, validates complete canonical IDs, independently
   inspects each container's labels, and force-removes only an exact ID whose
   ownership matches. Listing, inspection and removal share a fresh deadline
   using the configured harness-operation window and require complete captures;
   evidence decoding is strict UTF-8 and duplicate-aware JSON. A failed owner
   check or removal remains a cleanup failure while later IDs are still checked.
   Network removal follows recovery, and the independent final leak check stays
   in place. Recovery cannot accept non-UUID run identities.
   The real-container regression removes an otherwise untracked container owned
   by one run, proves a differently labelled container remains, and proves an
   empty second recovery succeeds. Fixture cleanup removes the second container;
   both disposable test containers are gone. Evidence:
   `/tmp/interop-recovery-live.log` (1 pass, 10 assertions).
   Focused ownership/refusal and orchestration-order checks pass in
   `/tmp/interop-recovery-focused.log` (11 pass, 170 assertions); an additional
   mixed-ownership case now checks continuation after an ownership refusal.
   TypeScript and `git diff --check` pass. Full-gate verification is terminal:
   331 pass, one existing candidate-digest failure, 1,874 assertions across 48
   files in 89.19 seconds, exit 1 (`/tmp/interop-owned-recovery-quality.log`).
   This includes the run-label change, mixed-ownership case, real recovery and
   lifecycle tests, pinned inputs, offline installation and TypeScript.
   Lost network acknowledgement and still-unbounded ordinary handle cleanup
   remain open; this does not yet make all startup/teardown paths time-bounded.

93. **Teardown also recovers networks with lost creation acknowledgements.**
   Network recovery shares the strict UUID-label, canonical-ID, complete-capture,
   strict UTF-8, duplicate-aware ownership inspection and host-deadline checks
   used for containers. It lists full network IDs under the exact run label,
   verifies each network's own labels, then removes the exact ID without force.
   It runs after container recovery and normal network cleanup, before the final
   leak check, including when network creation never returned an acknowledged
   handle. Original setup/cleanup failures remain in the report.
   The live fixture proves the current run's otherwise untracked network is
   removed, another run's network remains, and an empty repeat succeeds; it
   also reruns container ownership isolation. Both pass with 17 assertions in
   `/tmp/interop-network-recovery-live.log`. All disposable test resources were
   removed. Fourteen mocked ownership/refusal cases plus orchestration failure
   ordering pass (19 tests, 210 assertions) in
   `/tmp/interop-network-recovery-focused.log`. TypeScript and `git diff --check`
   pass. The full gate is terminal with exit 1: 339 pass, one existing candidate
   digest failure, 1,916 assertions across 48 files in 89.50 seconds
   (`/tmp/interop-network-recovery-quality.log`). Pinned-input checks, offline
   installation, TypeScript and real container/network tests pass.
   Ordinary handle cleanup still needs
   host deadlines; recovery cannot run if an earlier unbounded action stalls.

94. **Ordinary orchestration teardown now passes host deadlines.**
   Container and client-runner handles accept deadlines for stop, remove and
   log capture. Stop propagates one deadline through signalling, inspection
   and final kill, caps its grace wait by that deadline, and retains a signalling
   deadline refusal. Orchestration supplies a fresh configured harness-operation
   window to each stop/remove action, network removal and the final leak check,
   so expired actions can yield to later recovery instead of indefinitely
   blocking the cleanup sequence. Leak listings now also require complete
   captures. Network creation accepts the same optional deadline field, though
   startup callers have not yet been wired to supply it.
   Seven propagation/order cases failed before the change and pass afterward
   (`/tmp/interop-cleanup-deadlines-before.log`,
   `/tmp/interop-cleanup-deadlines-after.log`: 7 pass, 146 assertions). Real
   stand-in processes verify stalled stop, remove, log and network/leak commands
   return deadline refusals for both handle types (2 tests, 22 assertions).
   The real container lifecycle test now passes explicit deadlines to its log,
   stop and remove calls. The full gate is terminal with exit 1: 341 pass, one
   existing candidate-digest failure, 1,938 assertions across 49 files in 90.84
   seconds (`/tmp/interop-cleanup-deadlines-quality.log`). Pinned inputs, offline
   installation, TypeScript, real recovery/lifecycle tests and stand-in deadline
   tests pass. `git diff --check` also passes.
   Startup probes and the internal cleanup performed inside failed startup
   paths still need deadline propagation. No global run-time bound is claimed.

95. **Client-runner startup is bounded and retains its own log evidence.**
   The client's `podman run` and configuration probe now share the declared
   startup deadline. On readiness failure, kill/log/removal commands each receive
   a fresh configured harness-operation window, so an expired startup deadline
   does not prevent cleanup. Every client-runner command receives a distinct
   capture directory, including handle methods: the prior shared capture files
   let removal overwrite the startup log with its own output. A real-process
   regression demonstrated that overwrite, while three stalled-command cases
   required an external five-second guard before the fix (0 pass, 4 fail in
   `/tmp/interop-client-startup-before.log`). These now complete with typed
   refusals and preserved logs. A separate removal-only timeout regression
   demonstrated missing cleanup diagnostics; kill/removal failures are now
   retained alongside the readiness failure and log evidence.
   Final focused validation passes 9 tests with 56 assertions across three
   files (`/tmp/interop-client-startup-final-focused.log`); TypeScript and
   `git diff --check` pass. Full-gate verification is terminal with exit 1:
   345 pass, two failures, 1,956 assertions across 50 files in 91.40 seconds
   (`/tmp/interop-client-startup-quality.log`). Besides the known candidate-digest
   mismatch, `observation-timeout.test.ts:30` fails its post-timeout waiter/
   container-usability assertion. This is unresolved and must not be dismissed
   as provenance or replaced by a passing rerun. The host deadline and relative
   in-container timeout currently start at different points; delayed engine
   dispatch is a candidate cause requiring controlled reproduction. These tests use
   real host stand-ins, not a current client release against the agent. Generic
   container startup still needs equivalent deadlines, and ordinary scenario
   invocations without explicit deadlines remain open.

96. **Reproduced and repaired the host/in-container observation timer mismatch.**
   A real Podman wrapper delays dispatch until half the observation budget has
   elapsed. Before repair, the host returned a deadline refusal but the
   in-container waiter was still running; the controlled delayed case failed
   `/tmp/interop-delayed-observation-before.log`. This explains a concrete route
   to the failure in finding 95 instead of relying on a passing retry.
   Observation invocations now pass the absolute epoch deadline as a quoted
   argument. The runner computes remaining time after dispatch using its GNU
   date/timeout tools, refuses an already-expired budget, and execs the original
   argument vector under that remaining timeout. The host still enforces the
   same deadline independently. Deadline input must be a safe integer.
   Direct and delayed real-container cases both pass, including terminated
   waiter, usable container, successful subsequent command, capture bounds and
   UTF-8 checks (2 tests, 30 assertions in
   `/tmp/interop-delayed-observation-after.log`). Operation-wait checks pass
   10 tests/30 assertions, and TypeScript plus `git diff --check` pass. The full
   gate is terminal with exit 1: 347 pass, one existing candidate-digest failure,
   1,981 assertions across 50 files in 105.72 seconds
   (`/tmp/interop-absolute-observation-quality.log`). Both observation cases,
   real lifecycle/recovery tests, pinned inputs and offline installation pass.
   This relies on the local host/container shared epoch
   clock and does not establish behavior for a remote engine with clock skew.

97. **Generic container startup now propagates host deadlines and bounded cleanup.**
   `startContainer` gives `podman run` the declared startup deadline and passes
   that same deadline to its readiness callback. The proxy log probe uses it;
   the author's console probe already uses the shared console deadline. Failed
   startup receives an explicit positive finite cleanup budget from callers,
   using configured harness seconds in production. Stop, log capture and removal
   each get a fresh deadline; stop/removal failures remain in the refusal beside
   log evidence. The author's post-start installation-failure cleanup also
   supplies deadlines to its handle methods.
   Five generic real-process stand-in cases cover stalled launch, probe, all
   cleanup commands, removal alone, and preserved logs. Four failed before the
   change (`/tmp/interop-generic-startup-before.log`). Generic and client startup,
   propagation, and stalled cleanup checks now pass 14 tests with 84 assertions
   across three files (`/tmp/interop-generic-startup-after.log`). TypeScript and
   `git diff --check` pass. The full gate is terminal with exit 1: 352 pass,
   one existing candidate-digest failure, 2,009 assertions across 50 files in
   116.36 seconds (`/tmp/interop-generic-startup-quality.log`). Pinned inputs,
   offline installation, TypeScript, real lifecycle/recovery and both direct/
   delayed observation deadline cases pass. Arbitrary third-party
   probe callbacks must honor the provided deadline; this API does not forcibly
   cancel arbitrary JavaScript promises. Ordinary scenario invocations and
   remaining setup engine calls still need an explicit deadline audit.

98. **Setup, bootstrap and ordinary scenario commands now receive deadlines.**
   Prepared-image inspection and network creation use a fresh configured
   harness-operation deadline. Image inspection preserves the actual engine
   refusal instead of misreporting every failure as a missing image. The three
   bootstrap CLI commands (configuration, ping and daemon start) now receive
   host deadlines as well. Ordinary scenario `invoke` calls use the same
   absolute host/in-container deadline wrapper as observation waits, with the
   configured harness window unless an explicit deadline is supplied. Invalid
   or expired deadlines refuse before execution, and arguments/stdin remain
   separate from the wrapper script rather than being interpolated into it.
   Setup and invocation propagation regressions failed before these changes.
   Real-container direct, delayed and ordinary invocation cases all pass,
   including waiter termination, reuse and literal stdin (3 tests, 48 assertions
   in `/tmp/interop-all-invocation-deadlines-live.log`). Ten operation-wait tests
   plus the new invocation case pass; setup/bootstrap/failure-reporting checks
   pass 13 tests/184 assertions in `/tmp/interop-invocation-setup-corrected.log`.
   The first combined focused run exposed a preexisting partial test configuration
   lacking `harnessSeconds`; the fixture now supplies it, and deadline assertions
   remain intact. `/tmp/interop-invocation-setup-final.log` is the failed prior
   fixture run, not passing evidence. TypeScript and
   `git diff --check` pass. The full gate is terminal with exit 1: 354 pass,
   one existing candidate-digest failure, 2,054 assertions across 51 files in
   124.30 seconds (`/tmp/interop-setup-invocation-deadlines-quality.log`). This
   includes the corrected bootstrap fixture, all three real invocation cases,
   lifecycle/recovery tests, pinned inputs, offline installation and TypeScript.
   This bounds
   production engine-command paths, not arbitrary filesystem calls, remote
   admitted work or every HTTP/setup action, and is not a single global deadline.

99. **Between-scenario proxy reset now requires a direct acknowledgement.**
   The orchestration reset independently used permissive HTTP handling even
   after scenario-specific controls were repaired: it accepted 202/204, followed
   redirects and copied arbitrary error bodies into diagnostics. Four of five
   real-loopback regressions failed before the repair
   (`/tmp/interop-proxy-reset-before.log`). Reset now requires a direct HTTP 200,
   refuses redirects, cancels response bodies and reports failures without
   consuming their contents. The actual proxy synchronously deletes the arming
   before returning 200. A production-proxy test arms both points, confirms both
   are present, resets them, confirms both observations disappear and verifies
   a subsequent request is forwarded. Focused reset and orchestration tests
   pass 11/11 with 178 assertions (`/tmp/interop-proxy-reset-final.log`);
   TypeScript and `git diff --check` pass. The initial restricted invocation
   could not bind loopback sockets (EPERM); the successful rerun had local socket
   access. The full gate is terminal with exit 1: 360 pass, one existing
   candidate-provenance failure, 2,081 assertions across 52 files in 128.03
   seconds (`/tmp/interop-proxy-reset-quality.log`). Pinned inputs, offline
   installation, TypeScript and the real-container tests pass. This proves
   local reset behavior, not end-to-end sibling integration.

100. **A failed command capture no longer abandons the engine process.**
   The wrapper previously cleared its deadline timer when either drain failed,
   then threw while the engine could remain alive. Real `/dev/full` capture
   writes reproduced the live-child leak with and without a deadline (0/2
   passing in `/tmp/interop-capture-failure-before.log`). The failure path now
   terminates the deadline-owned process group, or the direct child when no
   group was created, aborts capture, settles both drains and awaits child exit
   when termination succeeded. It returns `capture_failed` with empty tails,
   rather than trying to read failed paths or treating partial output as
   evidence. Termination failures are explicitly reported. Both stdout and
   stderr failures pass with and without deadlines; together with the existing
   process-deadline tests, 8 tests/36 assertions pass
   (`/tmp/interop-capture-failure-final.log`). This does not establish cleanup of
   escaped process sessions, kernel-uninterruptible operations or remote work;
   container recovery remains independently necessary. The full harness gate
   is terminal with exit 1: 364 pass, one existing candidate-provenance failure,
   2,093 assertions across 53 files in 121.07 seconds
   (`/tmp/interop-capture-failure-quality.log`). Pinned-input verification,
   offline installation, TypeScript and real-container tests pass;
   `git diff --check` passes. Candidate authority remains unresolved.

101. **Interrupted-submission recovery now checks independent retained admissions.**
   The scenario previously accepted successful recovery and matching content
   without checking whether additional logical operations were admitted. Five
   adversarial scenario fixtures all incorrectly passed: an extra admission,
   no new admission, an unrelated new admission, removal of a preexisting
   admission, and an unreadable final inventory (8 pass/5 fail in
   `/tmp/interop-recovery-admission-before.log`). It now captures the independent
   agent repository inventory before submission and after recovery, preserves
   every prior operation, and requires exactly one added path whose operation
   identifier matches the original operation's resolved agent identifier. That
   identifier must not already occur in the prior inventory. The existing
   bounded, duplicate-aware inventory reader refuses incomplete evidence.
   Focused scenario, cleanup and inventory tests pass 27/27 with 215 assertions
   (`/tmp/interop-recovery-admission-after.log`). These are adversarial scenario
   tests and loopback inventory-reader tests, not a current sibling end-to-end
   run. Retained logical-operation counts do not count handler invocations,
   transient deleted admissions or repository effects; exactly-once effect
   proof and correctly acknowledged current candidate execution remain open.
   The full gate is terminal with exit 1: 369 pass, one existing candidate-digest
   failure, 2,138 assertions across 53 files in 121.41 seconds
   (`/tmp/interop-recovery-admission-quality.log`). Pinned inputs, offline
   installation, TypeScript and real-container tests pass, as does
   `git diff --check`.

102. **Client connection fixtures now satisfy the unchanged source policy.**
   The connection fixture had 12 remaining diagnostics: unnamed wire-buffer
   sizes, mode/count values and fixture deadlines, plus a TLS matrix exceeding
   the complexity ceiling. Its eight real-socket connection tests passed before
   editing (`/tmp/slingshot-connection-policy-before.log`). Semantic constants
   now name those values, and a private bounded TLS request-head reader retains
   the original byte/EOF behavior and maximum-size assertion. The TLS matrix
   retains both protocol versions, trusted/untrusted roots, matching/mismatched
   hostnames, explicit/negotiated requests, credential-before-authentication
   refusal and no-reconnect assertions. The unchanged policy checker now reports
   491 total findings, down from 503, with none naming this file
   (`/tmp/slingshot-connection-policy-scan.log`). No baseline or exemption was
   changed. All 29 environment-provider tests pass in 48.61 seconds
   (`/tmp/slingshot-connection-policy-after.log`), including the unchanged
   real-socket connection matrix. Formatting and whitespace checks pass.
   Target Clippy with warnings denied passes; the full client gate
   remains red and the remaining policy debt is not cleared by this fixture.

103. **Client terminal lookup recovery is separated without relaxing identity checks.**
   The durable lookup file exceeded 1,000 lines, and retirement combined retained
   identity and tombstone echo checks into a complexity-16 function. Its existing
   real SQLite/socket retirement regression passed before editing
   (`/tmp/slingshot-retirement-before.log`). Terminal success/retirement handling
   now lives in a private 142-line child module; retained-byte checks precede
   echo checks in private guards, with the original short-circuit order, local
   revision checks and atomic persistence preserved. The exported retirement
   API retains its path through a re-export. Six existing lookup entry points
   and retirement now document their failure conditions. Unchanged pause tests
   moved into a private test module, and their focused run passes. The parent
   is 993 lines. Initial relocation exposed seven previously line-baselined
   diagnostics; documentation fixes leave the larger reconciliation function's
   complexity-52 finding explicitly open, not newly exempted. The final unchanged
   policy checker reports 487 findings, down from 491, with none in the terminal
   child (`/tmp/slingshot-lookup-final-policy.log`). All-target/all-feature daemon
   Clippy with warnings denied passed after the production extraction and again
   after the documentation/test-module changes. All 18 real-process/socket/SQLite
   admission tests pass in 232.26 seconds
   (`/tmp/slingshot-terminal-extraction-tests.log`), including live events,
   subscription reset, failed lookup, retirement and retained artifact cases.
   The moved library pause test separately passes; formatting and whitespace
   checks pass. No baseline was changed, and the full client gate is not green.

104. **Client retained-operation reconciliation now follows explicit evidence stages.**
   The complexity-52 function exposed by the preceding extraction is split into
   local revision admission, retained identity/contracts, failed-snapshot
   validation/classification, successful result completion and active-snapshot
   reconciliation. The parent lookup API remains unchanged. Command-specific
   failure decoding stays exhaustive, with no new fallback; validation retains
   its original short-circuit ordering and failure-accounting callback. Success
   is still persisted before result acquisition, missing-result retries still
   consume their budget, and active snapshots cannot retract proven success.
   Main lookup, reconciliation and failure-classification files now have 506,
   346 and 294 lines respectively. The unchanged policy checker reports 486
   findings, down from 487, with none in the lookup module or its children
   (`/tmp/slingshot-reconciliation-policy.log`). All-target/all-feature daemon
   Clippy passes with warnings denied. Daemon documentation also builds with
   warnings denied. A structural comparison preserves all 64 command-pattern
   occurrences and 11 persistence-call occurrences from the original function;
   these counts describe the extraction, not live command coverage. No baseline
   or exemption was changed. The complete daemon package test run is terminal
   with exit 0: 224 tests pass across 27 targets with all features enabled and
   locked offline dependencies (`/tmp/slingshot-reconciliation-daemon-tests.log`).
   This includes the 18 real admission tests, live events, subscription reset,
   retirement, artifact completion, shutdown and capability probes. Formatting
   and whitespace checks pass. This package pass does not clear the client-wide
   policy gate or substitute for current acknowledged sibling integration.

105. **Client synchronous service dispatch now has bounded private handlers.**
   The complexity-32 operation dispatcher is separated into artifact streaming,
   maintenance streaming, ready wait, execute, maintenance preview/apply and
   query handlers. The same runtime mutex guard spans decoding and the complete
   synchronous handler call; no new await or lock release is introduced. Both
   request matches remain exhaustive, preserving compile-time checks for future
   variants. Existing responses, admission timestamps, maintenance review-cache
   mutations and terminal wait result lookup are retained. Service generic names
   now spell their meaning, and asynchronous wait documents its protocol and
   cancellation refusals. Parent and child files have 455 and 339 lines. The
   final unchanged source-policy scan reports 482 findings, down from 486, with
   none in these service files (`/tmp/slingshot-service-final-policy.log`). All
   42 library, ping-service and local-server tests pass
   (`/tmp/slingshot-service-final-tests.log`), including connection deadline,
   capacity release and nonce-bound shutdown tests. Final all-target/all-feature
   daemon Clippy passes with warnings denied. All five runtime admission cases
   also pass against the final exhaustive dispatcher
   (`/tmp/slingshot-service-final-runtime.log`). Formatting and whitespace checks
   pass. No exemption or baseline changed.
   This focused verification does not replace a full client gate or current
   sibling end-to-end run.

106. **Transport fixture bounds are named, with contract-backed query edge tests.**
   The finite HTTP fixtures now name their preparation/frame/data/shutdown byte
   counts and exchange deadlines; response iterator names are spelled out.
   Their independent wire literals, malformed framing cases and no-fallback
   assertions remain unchanged. The selection fixture's oversized query now
   derives from `maximum_route_query_bytes` instead of embedding 8193. A new
   real-socket test exercises exact-limit and one-byte-over queries for both
   literal ASCII and percent-encoding expansion: exact values reach the peer
   with the independently expected request line, oversized values open no
   connection, and successful exchanges do not reconnect. This test passes.
   The unchanged policy scan reports 471 findings, down from 482, with none in
   these two fixture files (`/tmp/slingshot-wire-fixtures-policy.log`). An initial
   compile check caught a named decoder bound declared as usize instead of the
   API's u64; its type is corrected, and final target Clippy passes with warnings
   denied. All 30 environment-provider integration tests pass in 48.17 seconds
   (`/tmp/slingshot-wire-fixtures-final-tests.log`); formatting and whitespace
   checks pass. No production transport code, baseline or exemption changed.
   This strengthens selected wire-boundary evidence, not full sibling coverage.

107. **Event-stream fixture values are explicit without changing wire evidence.**
   Named constants replace the event generation, cursor fixture capacity,
   HTTP/2 preparation/frame lengths and length shifts, transport-mode boundaries,
   optional progress, END_HEADERS flag and exchange deadlines. Configuration
   variable names now spell out their words. Independent literal request and
   response payloads remain unchanged, as do the seven transport modes, eight
   event-document cases, five reset cases and no-reconnect assertions. The
   unchanged source-policy checker reports 425 findings, down from 471; the
   event fixture retains only its preexisting complexity-41 finding
   (`/tmp/slingshot-event-values-policy.log`). Target Clippy with warnings denied
   and formatting/whitespace checks pass. No production implementation, baseline
   or exemption changed; decomposition of this fixture is still required.
   All 30 environment-provider integration tests pass in 47.82 seconds
   (`/tmp/slingshot-event-values-tests.log`). Structural comparison confirms the
   literal-string inventory and all 46 assertion/match sites are unchanged.
   This fixture pass does not establish current sibling end-to-end coverage.

108. **The event-stream matrix now has bounded, phase-specific helpers.**
   Extracted per-mode setup, event/reset peer I/O, document construction,
   request selection and result verification from the complexity-41 test. The
   original listener remains shared across all phases and seven modes; all eight
   event-document and five reset cases still run for each mode. Event delivery
   and reset rejection share the same five-path request selector with different
   consumers, retaining the panic on unexpected reset delivery. Authentication,
   encoded route/cursor checks and post-exchange no-reconnect assertions remain
   in place. Structural comparison preserves all 46 assertion/match sites and
   the unique literal-string inventory. The 690-line fixture now has no source
   policy findings; the unchanged checker reports 424 total, down from 425
   (`/tmp/slingshot-event-decomposition-policy.log`). Final target Clippy passes
   with warnings denied. All 30 environment-provider integration tests pass in
   47.68 seconds (`/tmp/slingshot-event-decomposition-tests.log`); formatting and
   whitespace checks pass. No baseline, exemption or product transport changed.
   Current sibling end-to-end verification remains separate and unresolved.

109. **High-water HTTP/2 capture tests now observe the POST body they claim to bind.**
   The fake author previously read only HTTP/2 request headers before returning
   capture/reset evidence; its comment deferred DATA-frame reading, but no such
   read existed. A new exact-body assertion failed against that fixture
   (`/tmp/slingshot-high-water-body-before.log`). The peer now reads the complete
   DATA frame, verifies its declared length, type, END_STREAM flag and stream
   identifier, and independently checks the canonical generation/subscription
   JSON bytes before replying. HTTP/1 reads return their body separately for the
   same exact-byte assertion; a matching suffix alone is not accepted. Existing
   CSRF token, route, credential, reset and no-fallback checks remain intact.
   The strengthened high-water matrix passes across its seven transport modes;
   target Clippy with warnings denied passes. This repairs test evidence, not a
   demonstrated product serialization defect. The fixture's preexisting policy
   debt still needs work, and current sibling integration remains unverified.
   All 30 environment-provider integration tests pass in 47.56 seconds
   (`/tmp/slingshot-high-water-body-tests.log`). Formatting and whitespace checks
   pass; the unchanged source-policy checker still reports 424 findings
   (`/tmp/slingshot-high-water-body-policy.log`).

110. **High-water fixture stages now satisfy source policy with body checks intact.**
   Named transport-mode boundaries, statuses, generation, frame sizes/flags and
   deadlines, then extracted socket/TLS acceptance, request reading, request
   assertions, JSON responses, capture documents and transport selection. The
   original shared listener, seven transport modes, invalid-preflight cases and
   seven status/defect cases are retained. Both valid and preflight requests use
   the same five-path transport selector. CSRF acquisition still precedes the
   POST, and the independently expected body and DATA-frame checks added in
   finding 109 remain before any capture response. The 466-line fixture has no
   findings under the unchanged checker; total findings fall from 424 to 398
   (`/tmp/slingshot-high-water-decomposition-policy.log`). Target Clippy passes
   with warnings denied. All 30 environment-provider tests pass in 47.21 seconds
   (`/tmp/slingshot-high-water-decomposition-tests.log`); formatting and whitespace
   checks pass. Structural comparison retains all 35 assertion/match sites and
   the unique literal-string inventory. No baseline, exemption or production
   transport changed. Current sibling end-to-end verification remains open.

111. **Refresh fixtures now name their retry/status values and check exact capture bytes.**
   Named HTTP statuses, token-refresh count, post-after-refresh request index,
   event generation and existing timing values without changing scenarios,
   wire replies, retry decisions or token/guard assertions. The high-water branch
   previously checked only that both field names occurred in the request body;
   it now additionally requires the exact canonical generation/subscription
   bytes, while preserving those earlier assertions. No production behavior was
   changed. The unchanged checker reports 367 findings, down from 398, with only
   the preexisting complexity-125 finding remaining in this fixture
   (`/tmp/slingshot-refresh-values-policy.log`). Target Clippy, formatting and
   whitespace checks pass. The large matrix and its existing fixed-delay timing
   technique still require review; naming that delay does not resolve the
   contribution rule against fixed sleeps. All 30 environment-provider tests
   pass in 47.50 seconds (`/tmp/slingshot-refresh-values-tests.log`). No baseline
   or exemption changed; current sibling integration remains unverified.

112. **Refresh response construction is separated and independently table-checked.**
   Extracted status/body construction into bounded event, artifact, capture,
   submission and read helpers. The original matrix still owns token counters,
   connection counts, retry/guard assertions and peer I/O. An independent table
   covers all 22 scenario names, Basic/Cloud modes and three attempt positions
   (132 exact status expectations); its test passes
   (`/tmp/slingshot-refresh-status-matrix.log`). All 30 existing wire integration
   tests pass in 47.20 seconds after the extraction
   (`/tmp/slingshot-refresh-response-final-tests.log`). The unchanged policy
   checker retains 367 total findings; the main refresh test's complexity drops
   from 125 to 83, and the new response helpers/table have no findings
   (`/tmp/slingshot-refresh-response-final-policy.log`). Clippy with warnings
   denied, formatting and whitespace checks pass. Further matrix decomposition
   and the fixed-delay timing issue remain open. No baseline, exemption or
   product transport was changed.

113. **Artifact fixture planting accepted ambiguous HTTP success and left its body open.**
   The planting POST used `Response.ok`, followed redirects by default, and
   neither consumed nor cancelled successful response bodies. New isolated
   scenario regressions reproduced acceptance of 202, 204 and a redirected
   response, plus continuation before body cancellation: 38 tests passed and
   four failed before repair. Planting now requires a direct 200/201 response,
   sets `redirect: "error"`, and cancels the body before submitting the load.
   A 200 update control also passes. The artifact-transfer and artifact-resolution
   suites pass all 53 tests with 152 assertions; TypeScript and whitespace checks
   pass. These are mocked scenario regressions, not real HTTP redirect or current
   sibling integration evidence. The previous full-gate result above predates
   this repair; candidate provenance and client policy failures remain open.

114. **Artifact planting is now checked over real HTTP, and the full harness gate was rerun.**
   Six loopback cases exercise the actual fetch implementation with 200, 201,
   202, 204, 302 and 307. Every peer sees exactly one POST with the expected
   path and planted property bytes; only 200/201 reach load submission. Redirect
   targets are never requested. The artifact suite passes all 49 tests with 161
   assertions. Client command/result handling remains mocked in these tests;
   they establish the harness HTTP boundary, not full sibling interoperability.
   The full offline `scripts/quality` run is terminal with exit 1: 380 passes,
   one failure and 2,183 assertions across 53 files in 120.61 seconds
   (`/tmp/interop-artifact-planting-quality.log`). Pinned inputs, TypeScript and
   real-container checks pass. The sole failure remains candidate provenance;
   no candidate pins or acknowledgements were changed.

115. **Artifact resolution did not verify its retained operation's target partition.**
   A unique canonical artifact association was enough to resolve an identifier,
   even if its operation was absent, retained under a different target, or
   ambiguous across targets. Three new real WAL-backed SQLite regressions
   reproduced these false passes (10 passes/3 failures before repair). Resolution
   now requires exactly one retained operation with that identifier and a target
   matching the association, in the same SQL statement and read snapshot. The
   operation table and composite key were checked against the client's
   `0001-operations.sql` migration. All 29 focused database tests pass with 70
   assertions; TypeScript passes. No production sibling schema was changed.
   This is a consistency check, not independent expected-target verification:
   both records can still agree on the wrong digest. Independent derivation must
   bind the profile-authentication contract digest, deployment, canonical author
   address and principal identity; taking a digest from another daemon-owned row
   does not establish that requirement. The full harness gate above predates
   this additional repair.

116. **Agent identifier resolution had the same retained-operation consistency gap.**
   A unique `agent_operation` row could name an orphan, a different target's
   operation, or a local identifier ambiguous across retained targets. Three
   WAL-backed regressions reproduced acceptance (9 passes/3 failures before
   repair). The reader now requires one retained local operation and matching
   target identity in the same SQL statement/snapshot, before returning the
   canonical agent identifier. All 32 database-reader tests pass with 76
   assertions, and TypeScript passes. This strengthens the provenance chain for
   snapshot/recovery observations without claiming independent derivation of
   either the target digest or the agent identifier. That stronger requirement
   and current-candidate end-to-end verification remain open. The full-gate
   summary above predates findings 115 and 116.

117. **The full harness gate includes both retained-operation binding repairs.**
   `scripts/quality` completed with exit 1, 386 passes, one failure and 2,195
   assertions across 53 files in 120.59 seconds
   (`/tmp/interop-retained-binding-quality.log`). The sole failure remains
   candidate provenance. Pinned tooling/images, offline dependencies,
   TypeScript and real-container checks pass. This supersedes the earlier full
   result for findings 115/116 without establishing current sibling integration.
   Source inspection confirmed the independent target expectation must use the
   selected candidate's exact profile-authentication manifest digest, not an
   ambient checkout's version: `profile_authentication_contract_digest()` hashes
   the embedded manifest bytes, and `AuthorTargetIdentityDigest::build()` frames
   those raw digest bytes with deployment, canonical author address and raw
   principal digest. Basic principal framing uses method and exact username
   bytes. A future independent check must bind its contract input to candidate
   provenance and test its framing against known vectors; agreement between
   database records or a current-checkout calculation is insufficient.

118. **Artifact access envelopes could omit or misbind target and URI fields.**
   The scenario checked artifact/operation identifiers, digest, length and media
   type but ignored target identity, URI and extra fields. Five new regressions
   reproduced false passes (49 passes/5 failures before repair with socket
   permission). The resolver now returns and validates the retained association's
   canonical target digest. The scenario requires the exact seven-field
   `ArtifactAccess` shape, matches that digest, and reconstructs the URI from
   profile, environment, target, operation and artifact with RFC3986 segment
   encoding. The shape and URI layout were checked against the client's
   `machine_outcome_envelope.rs`. Additional regressions reject a wrong target
   with an internally consistent URI and malformed database target digests.
   All 77 focused artifact/database-refusal tests pass with 230 assertions;
   TypeScript and whitespace checks pass. Access results are mocked in these
   scenario tests; this is not a current-candidate integration run. Independent
   expected-target derivation remains open, and the full gate above predates
   this repair.

119. **Artifact measurement accepted malformed or differently named checksum records.**
   The measurement reader stripped a `sha256-` prefix, ignored the filename,
   and ignored surplus or unterminated output. Four regressions reproduced
   false passes. It now requires exactly two complete lines, validates the byte
   count, and requires the exact GNU text-mode checksum record for the declared
   digest and harness-owned destination. A positive control invokes the actual
   scenario measurement command with host `wc`/`sha256sum` against a real temporary
   file and passes; this does not exercise those tools inside the pinned runner.
   All five measurement cases pass, including the four refusals. TypeScript and
   whitespace checks pass. The full gate above predates findings 118 and 119;
   candidate provenance and current sibling integration remain unresolved.

120. **Client artifact-wire fixture values now meet the naming policy.**
   Named generation, artifact size, timeout, digest width, mode selectors, HTTP/2
   frame sizes/flags and length shifts, and expanded the configuration identifier.
   Wire documents and the test's assertions remain intact. The existing real
   artifact matrix passes both before (13.75 seconds) and after (13.94 seconds)
   the cleanup. The unchanged source-policy checker drops from 367 to 341
   findings (`/tmp/slingshot-artifact-values-policy.log`); this fixture now has
   only its existing complexity-42 finding. No baseline, exemption or product
   transport behavior changed. Full client quality remains red; the complexity
   finding and other outstanding client findings still need repair.

121. **Client artifact response construction is separated from exchange orchestration.**
   Extracted artifact status/body construction and unavailable-response framing
   into bounded helpers, retaining the same wire data and matrix assertions.
   The artifact matrix passes after extraction (14.23 seconds), and all-feature
   warnings-denied target Clippy, formatting and whitespace checks pass. The
   unchanged policy checker reports 341 findings; the main artifact test's
   complexity falls from 42 to 34, while both new helpers have no findings
   (`/tmp/slingshot-artifact-response-policy.log`). Further decomposition is
   still required to meet the limit of 10. The complete all-feature
   environment-provider suite passes all 31 tests in 47.34 seconds, with none
   filtered or ignored. Reinspection of the pinned SQLite
   safe API did not resolve the already-recorded pre-initialization contract
   conflict; its checks and policy violations were not suppressed or weakened.

122. **The client artifact-wire fixture is now source-policy clean.**
   Extracted TLS acceptance, the selected wire peer, HTTP/1 framing cases,
   unavailable-result cases, large-stream verification and outcome assertions.
   The parent still owns the shared listener and context, invalid-selection
   preflight checks, six transport modes, no-retry assertions, cancellation and
   local-slot refusal. Peer helpers retain TLS/ALPN, route/authentication,
   framing and connection-close checks. No cases or assertions were removed.
   The unchanged source-policy checker reports no artifact-fixture findings
   and 340 overall (`/tmp/slingshot-artifact-decomposition-policy.log`), down
   from 341. All 31 all-feature environment-provider tests pass in 47.82 seconds
   (`/tmp/slingshot-artifact-decomposition-tests.log`). Warnings-denied target
   Clippy, formatting and whitespace checks pass. No baseline, suppression or
   product transport behavior changed.

123. **Full harness verification includes the latest artifact evidence repairs.**
   The complete offline `scripts/quality` run is terminal with exit 1: 400
   passes, one failure and 2,234 assertions across 53 files in 122.91 seconds
   (`/tmp/interop-artifact-evidence-quality.log`). This includes findings 118/119,
   their artifact access/measurement refusal cases and real host measurement
   control. Pinned inputs, TypeScript and real-container tests pass. The sole
   failure is still the acknowledged-candidate digest mismatch; candidate
   records and source attribution remain unchanged. This is a current harness
   self-test result, not evidence that current sibling worktrees integrate.

124. **Independent target-identity framing now has a pinned, vector-checked oracle.**
   Read the profile-authentication manifest and independent identity vectors
   directly from acknowledged client source commit
   `79397e8aa8e28bdeb65603ca7b68ae92d36c3584`. Its manifest SHA-256 is
   `c6f35b255b37d6898b13c7a25e6e8de424bcf3b730e18bbb5cbc9dff3ef9eff8`,
   identical to the current checkout's manifest. Added a harness-owned framing
   implementation pinned to that contract: named fields, presence bytes,
   eight-byte big-endian UTF-8 byte lengths, raw contract/principal digests and
   SHA-256. It matches the committed Basic-principal and Cloud-target vectors;
   changed deployment/address/principal and ambiguous concatenations separate,
   while malformed UTF-16, empty fields and noncanonical digests are refused.
   Three tests pass with 16 assertions, and TypeScript passes. No sibling
   checkout is consulted by this implementation at runtime. This is groundwork,
   not a completed binding repair: profile canonicalization, storing authored
   expectations and enforcing them in both database resolvers remain to be
   connected and verified. Existing candidate acknowledgements are unchanged.

125. **Client address parsing silently discarded suffixes after bracketed hosts.**
   While tracing canonicalization for the independent target oracle, found that
   `split_authority` treated a non-colon suffix after `]` as an absent port.
   A new vector reproduced accepting `http://[::1]suffix` as `http://[::1]`.
   The parser now permits only an empty remainder or a colon-prefixed port;
   existing port validation handles empty/malformed port values. Added six
   refusal vectors and two accepted controls, and corrected a stale fixture
   comment: explicit default ports are refused, not removed. Extracted authority
   parsing into a private module because the original file was already at its
   1,000-line ceiling; neither changed parser file has policy findings. Final
   all-target/all-feature domain tests pass 644 tests across 92 targets
   (`/tmp/slingshot-bracketed-authority-final-domain-tests.log`), configuration
   tests pass 73 across 15 targets
   (`/tmp/slingshot-bracketed-authority-configuration-tests.log`), and domain
   warnings-denied Clippy, formatting and whitespace checks pass. The real-socket
   IPv6-author regression also passes, preserving valid bracketed authority
   behavior. Overall source
   policy remains at 340 findings, with no baseline or exemption change.
   Independent target-oracle wiring is still open; fixing this parser defect
   does not establish current sibling integration.

126. **Both database resolvers now enforce independent authored target expectations.**
   Added harness-owned address canonicalization and a local copy of the pinned
   address vectors plus reviewed bracket-suffix regressions. The oracle checks
   canonical host/scheme/path spelling, escapes and address bounds without a
   browser URL parser's numeric-host or dot-segment rewriting. Profile creation
   computes and retains a frozen digest map before writing any scratch files.
   The severed scenario separately derives its dynamically authored profile's
   expectation. Both database readers refuse missing/malformed metadata and
   require the retained target to equal the independent expectation; matching
   daemon records alone are no longer sufficient. Four new WAL regressions
   reproduced false passes before the checks (wrong target or absent expectation
   for each reader). All 66 focused profile/database/recovery tests passed with
   305 assertions; the subsequent profile/oracle suite passes 12 tests with 121
   assertions, including password/publisher independence and canonical-address
   equivalence. TypeScript and whitespace checks pass. No candidate acknowledgement
   changed and no sibling is consulted by the runtime oracle. Full harness and
   current-candidate integration verification after this repair remain open.

127. **The full harness gate includes independent profile-target enforcement.**
   The complete offline `scripts/quality` run finished with exit 1: 411 passes,
   one failure and 2,333 assertions across 55 files in 122.31 seconds
   (`/tmp/interop-independent-target-quality.log`). This includes the pinned
   identity/address oracles, authored expectation metadata, both resolver
   checks and scenario wiring. Pinned inputs, TypeScript, startup, timeout,
   cleanup and real-container checks pass. The sole failure remains candidate
   provenance; no pins or acknowledgements changed. Current sibling integration
   remains unverified despite this broader current harness self-test evidence.

128. **Client signed-port parsing bypassed canonical port spelling.**
   The integer parser accepted `+8443`, and the leading-zero guard only examined
   the first character, allowing a sign to bypass that guard. A new address
   vector reproduced the signed-port acceptance before repair. Port parsing now
   requires ASCII decimal digits before conversion. Three refusal vectors cover
   ordinary/bracketed hosts and the signed leading-zero spelling; positive
   controls cover ports 1 and 65535 alongside existing 0/65536 refusals. The
   independent harness address oracle already refused signed ports and now
   carries these vectors as well. The full all-target/all-feature domain suite
   passes 644 tests across 92 targets
   (`/tmp/slingshot-signed-port-domain-tests.log`), and the harness profile/oracle
   suite passes 12 tests with 128 assertions. Domain warnings-denied Clippy and
   formatting pass. The unchanged source-policy scan remains at 340 findings
   with none in the authority module (`/tmp/slingshot-signed-port-policy.log`).
   No baseline or candidate acknowledgement changed; current sibling integration
   is still unverified.

129. **Bracketed host validation accepted non-IPv6 strings in both client and oracle.**
   The hexadecimal/colon vocabulary check accepted `[abcd]`, malformed
   compression, oversized groups and incorrect group counts. New vectors
   reproduced acceptance in both the client and harness before repair. The
   client now uses Rust's safe IPv6 parser and the harness uses the independent
   `node:net` IPv6 validator, while retaining the existing restricted character
   set and lowercase spelling without reformatting valid literals. Seven new
   refusal vectors and two valid full-width/uppercase controls pass. All 644
   domain tests across 92 targets pass
   (`/tmp/slingshot-ipv6-syntax-domain-tests.log`), as do 12 harness oracle/profile
   tests with 139 assertions. Domain Clippy with warnings denied, TypeScript,
   formatting and whitespace checks pass. Source policy remains at 340 findings
   with no authority-module findings (`/tmp/slingshot-ipv6-syntax-policy.log`).
   The valid IPv6-author real-socket regression also passes.
   Full harness and current-candidate integration after this repair remain open.

130. **Submission preflight fixture policy debt reduced without changing coverage.**
   Named the existing event generations, HTTP/2 preface/frame-header sizes,
   frame-length shifts and exchange timeout in the client submission preflight
   fixture. The original real-socket submission matrix passed before the edit;
   all 31 environment-provider tests pass afterward, including submission,
   no-repeat POST, artifact, event and transport negotiation checks
   (`/tmp/slingshot-submission-preflight-after.log`). No wire values, cases or
   assertions changed. The source-policy scan drops from 340 to 334 findings,
   with none remaining in this preflight module
   (`/tmp/slingshot-submission-preflight-policy.log`). Formatting and the
   environment-provider target's all-feature Clippy with warnings denied pass
   (`/tmp/slingshot-submission-preflight-clippy.log`).
   The parent submission matrix still exceeds the complexity limit; this is
   not a full client-gate pass or current-candidate interoperability evidence.

131. **Agent snapshot evidence did not check the independently authored target.**
   The retained database association was checked against the authored profile,
   but the subsequent HTTP snapshot could name the expected agent operation
   identifier and a missing or different `author_target_identity_digest` and
   still pass. A regression reproduced this false positive. The resolver now
   returns its independently checked target digest alongside the identifier;
   all five snapshot-consuming scenarios pass both to the snapshot reader.
   The reader refuses malformed expectations and missing or contradictory
   targets. This matches the field emitted by the agent's
   `OperationLookupServlet` rather than inventing a new wire requirement.
   The affected tests pass 67/67 with 367 assertions, including actual HTTP
   responses, read-only live-WAL resolution and scenario argument-binding
   assertions (`/tmp/interop-snapshot-target-tests.log`). TypeScript and
   whitespace checks pass. The complete harness gate finishes with 413 passes
   and one failure, 2,367 assertions across 55 files in 120.95 seconds
   (`/tmp/interop-snapshot-target-quality.log`). Its sole failure remains the
   acknowledged-candidate byte/digest mismatch. Pinned-input verification,
   TypeScript and real-container timeout, cleanup and recovery checks pass.
   No candidate pin, acknowledgement or baseline was changed.
   This strengthens cross-target evidence, not exactly-once effect evidence:
   the agent's outbox count records distinct physical job identifiers and its
   own tests explicitly admit redelivery without incrementing that count.
   Neither that count nor a single logical repository record independently
   proves how many times the command's side effect ran.

132. **Successful folder scenarios ignored the agent's retained result.**
   Recovery, detached execution and write/read compared the client's folder
   path and repository content, but accepted the agent snapshot's `succeeded`
   label without reading `terminal_result.canonical_result`. Six new recovery
   regressions demonstrated false passes for missing, malformed, wrong-path,
   duplicate-key and extra-field agent results, plus an extra-field client
   result (`/tmp/interop-retained-folder-result-before.log`). The agent's
   `create_asset_folder-result.json` and `CreateAssetFolderResult` define a
   closed, one-member result containing `repository_path`. A shared verifier
   now requires both sides' results to satisfy that shape and match the authored
   destination; the embedded agent JSON is parsed with duplicate-key refusal.
   All three scenarios call it and retain their content checks. Focused tests
   pass 39/39 with 278 assertions, including actual scenario execution with
   isolated transport fixtures and a new write/read scenario matrix
   (`/tmp/interop-retained-folder-result-tests.log`). TypeScript and whitespace
   checks pass. The full harness gate finishes with 427 passes and one failure,
   2,470 assertions across 55 files in 120.97 seconds
   (`/tmp/interop-retained-folder-result-quality.log`). The sole failure remains
   candidate provenance; pinned inputs, TypeScript and real-container timeout,
   cleanup and recovery checks pass. No provenance was rewritten. This proves
   stronger result agreement, not canonical-byte spelling, complete terminal
   provenance validation, independent effect counts or current-candidate live
   interoperability.

133. **Terminal snapshot identity could contradict the outer snapshot.**
   The snapshot reader bound the outer operation identifier and target but did
   not compare the nested terminal operation, subscription or submitted-command
   digest. Success and failure regressions both reproduced false acceptance
   (`/tmp/interop-terminal-identity-before.log`). The agent's
   `OperationLookupServlet.identityDocument` and `terminalDocument` emit these
   echoes from the same retained record. The harness now requires their
   agreement: generation, operation identifier, target and selected revision
   inside the four-member terminal operation; subscription and submitted-command
   digest inside the terminal envelope. Missing echoes cannot agree merely
   because both are absent. Missing/malformed terminal documents, extra nested
   operation members and contradictory result/failure branches are refused.
   Focused tests pass 69/69 with 514 assertions, including real HTTP success
   and failure snapshots with each of the six echoes independently corrupted
   (`/tmp/interop-terminal-identity-tests.log`). The larger complete fixture's
   normal capture budget is derived from its serialized size; exact byte-bound
   and overflow tests remain intact. The full harness gate finishes with 430
   passes and one failure, 2,565 assertions across 55 files in 120.94 seconds
   (`/tmp/interop-terminal-identity-quality.log`). Its sole failure remains
   candidate provenance. TypeScript, pinned-input checks and real-container
   timeout, recovery, lifecycle and cleanup checks pass. No candidate metadata
   or policy baseline changed.
   This is consistency checking, not independent authentication of the selected
   revision or submission digest. Contract provenance, canonical-byte validation,
   effect counts and current-candidate live verification remain distinct gaps.

134. **High-water capture accepted contradictory admission evidence.**
   The scenario waited for a result but ignored its path and the agent's
   terminal disposition/result. Five regressions exposed false passes for an
   empty receipt identifier, a wrong client folder result, failed or active
   agent snapshots, and a wrong retained agent folder result. A sixth control
   confirmed a newline-suffixed transport digest was already refused
   (`/tmp/interop-high-water-admission-before.log`: five failures, one pass).
   The scenario now requires a nonempty receipt identifier, a succeeded agent
   snapshot and the same closed folder result for the authored path from both
   sides, before issuing token or high-water requests. Focused tests pass
   21/21 with 137 assertions (`/tmp/interop-high-water-admission-tests.log`);
   TypeScript and whitespace checks pass. The full harness gate finishes with
   436 passes and one failure, 2,589 assertions across 55 files in 121.35 seconds
   (`/tmp/interop-high-water-admission-quality.log`). Candidate provenance
   remains the sole failure; pinned-input, type and real-container checks pass.
   End-to-end stream continuity remains unproved: this scenario directly calls
   high-water after admission and does not induce or observe client stream
   reset/reconciliation. `HighWaterServlet.answered` legitimately emits `0:0`
   when no event was shown. A closed, bound capture response therefore is not
   evidence that any stream event was delivered, let alone recovered after a
   reset. Existing scope comments correctly limit the scenario to capture.

135. **Submission absence checks extracted without dropping wire coverage.**
   The client's 994-line submission fixture now delegates its missing/retired
   logical-operation lookup matrix to a 128-line `submission/absent.rs` helper.
   It borrows the original listener, identity, authentication providers and
   submission; all four transport/authentication modes, both status responses,
   route assertions and typed absence assertions remain in the original run.
   Named lookup modes replace numeric selectors, and status/timeout values
   are named. The parent is 907 lines and its measured complexity falls from
   80 to 76; substantial decomposition remains. Source policy reports 332
   findings, down from 334, with none in the new helper
   (`/tmp/slingshot-absent-lookup-policy.log`). The original submission test
   passes before extraction, and all 31 environment-provider tests pass afterward
   (`/tmp/slingshot-absent-lookup-before.log`,
   `/tmp/slingshot-absent-lookup-after.log`). Formatting, whitespace checks and
   target Clippy with all features and warnings denied pass
   (`/tmp/slingshot-absent-lookup-clippy.log`). This changes
   test organization, not product behavior, candidate metadata or policy baselines;
   it is not a full client-gate pass.

136. **Absent-operation wire tests checked only a request prefix.**
   The extracted client fixture accepted any suffix after
   `snapshot?agent_operation_identifier=` and never checked its Authorization
   header. Extracting that exact predicate into a testable helper demonstrated
   two failing regressions: wrong operation identity and missing authentication
   (`/tmp/slingshot-absent-request-before.log`). The real socket peer now requires
   the exact request line for the submitted operation and exactly one matching
   Authorization header. Header-name casing remains insensitive. Regression
   cases also cover extra query members, wrong credentials, duplicate/conflicting
   authorization and a misleading `X-Authorization` header. Credentials are not
   included in assertion diagnostics. Source policy remains at 332 findings,
   with none in the helper (`/tmp/slingshot-absent-request-policy.log`). All 33
   environment-provider tests pass, including the real-wire submission matrix
   (`/tmp/slingshot-absent-request-after.log`). Target Clippy with all features
   and warnings denied, formatting and whitespace checks pass
   (`/tmp/slingshot-absent-request-clippy.log`). This closes a coverage gap; it does
   not demonstrate a product request-construction defect.

137. **Malformed-token submission checks extracted and request evidence strengthened.**
   The client submission fixture now delegates its six malformed-CSRF-token
   cases to `submission/token.rs`. Missing, empty, duplicate, surplus-member,
   line-break and oversized token bodies still traverse the same real listener;
   each still requires `SubmissionSendRefusal::Request` and observes no subsequent
   POST for the original bounded observation interval. The oversized token is
   still derived from the embedded transport contract. The exact request-line
   and single-Authorization predicate from the absence fixture now lives in
   `submission/request.rs` and is applied to these token GETs as well; its existing
   regressions remain, with an additional token-route/authentication control.
   The parent falls from 907 to 869 lines and measured complexity from 76 to 74.
   Source policy falls from 332 to 331 findings, with none in the new helpers
   (`/tmp/slingshot-token-refusal-policy.log`). All 34 environment-provider tests
   pass (`/tmp/slingshot-token-refusal-tests.log`), as do target Clippy with all
   features and warnings denied, formatting and whitespace checks
   (`/tmp/slingshot-token-refusal-clippy.log`). Product behavior, timeout values and policy baselines are
   unchanged; substantial client quality work remains.

138. **Physical lookup mode dispatch consolidated without narrowing the matrix.**
   The client submission fixture used four repeated numeric-mode dispatch
   ladders for invalid identifiers, moved revisions, zero generation and wire
   response cases. `submission/physical.rs` now names the five modes and
   dispatches snapshot/job requests through the same public transport methods,
   retaining the original provider, authentication, clock and identity arguments.
   The parent still owns the real listener, all pre-I/O refusals and no-socket
   checks, and all ten status/defect cases for each mode. The independently
   observed physical generation remains eight, distinct from the operation's
   generation seven; the invalid-generation vector remains nine. The parent
   falls from 869 to 681 lines and measured complexity from 74 to 58. Source
   policy falls from 331 to 314 findings, with none in the new helper
   (`/tmp/slingshot-physical-dispatch-policy.log`). All 34 environment-provider
   tests pass (`/tmp/slingshot-physical-dispatch-tests.log`), as do target Clippy
   with all features and warnings denied, formatting and whitespace checks
   (`/tmp/slingshot-physical-dispatch-clippy.log`). This is fixture restructuring, not a product change
   or a complete client-policy repair.

139. **Physical lookup response construction and socket peer separated.**
   The client submission matrix now calls dedicated response-body and real-peer
   helpers in `submission/physical.rs`. The same success, changed physical ID,
   changed digest, logical absence/retirement, physical absence, changed
   generation/identifier and truncated-body cases remain. HTTP/1 and HTTP/2
   preface/frame handling, encoded route and authentication observations,
   advertised-versus-sent body length, stream closure and typed receipt checks
   are preserved. Existing frame sizes, shifts, status sizes and statuses are
   named rather than exempted from policy. The parent falls from 681 to 589
   lines and complexity from 58 to 48. Source policy falls from 314 to 307
   findings with no new physical-helper finding
   (`/tmp/slingshot-physical-peer-policy.log`). All 34 environment-provider
   tests pass (`/tmp/slingshot-physical-peer-tests.log`), as do target Clippy
   with all features and warnings denied, formatting and whitespace checks
   (`/tmp/slingshot-physical-peer-clippy.log`). The client-wide policy gate is
   not yet repaired, and no candidate or baseline metadata changed.

140. **Lookup orchestration separated from the submission matrix.**
   The accepted-submission branch now performs checked logical snapshot,
   physical lookup matrix and absence lookup as three calls in the same order
   on the original listener. The extracted logical helper retains retention,
   progress and sequence assertions and now uses the shared exact-request and
   single-Authorization check. The physical helper retains all five modes,
   local refusals, no-socket observation, ten wire cases and typed receipt
   assertions. Its oversized identifier is now derived from
   `maximum_sling_job_identifier_bytes + 1`, preserving today's 1,025-byte
   fixture without restating the contract limit. The parent falls from 589 to
   489 lines and complexity from 48 to 42. Source policy falls from 307 to 305
   findings, with no logical/physical helper finding
   (`/tmp/slingshot-lookup-matrix-policy.log`). All 34 environment-provider
   tests pass (`/tmp/slingshot-lookup-matrix-tests.log`), as do target Clippy
   with all features and warnings denied, formatting and whitespace checks
   (`/tmp/slingshot-lookup-matrix-clippy.log`). The remaining submission branches and client-wide gate
   are not yet compliant.

141. **HTTP/1 acknowledgement matrix extracted with stronger request evidence.**
   `submission/http_one.rs` now owns the original synchronous/asynchronous
   acknowledgement matrix and its job-set fixture selection. The same response
   media types, wrong-echo cases, job sets, recorded/unknown classification and
   no-repeat socket observations remain. Token GET and submission POST requests
   now use the exact-request/single-Authorization verifier instead of merely
   looking for a Basic prefix. The POST body must also equal the complete bound
   `Submission::wire_body`, while the independent original Unicode argument and
   empty-artifact-manifest checks remain. This strengthens coverage; it is not
   evidence that the client previously emitted wrong requests. The parent falls
   from 489 to 392 lines and complexity from 42 to 34. Source policy falls from
   305 to 304 findings with none in the new helper
   (`/tmp/slingshot-http-one-matrix-policy.log`). All 34 environment-provider
   tests pass on the final source (`/tmp/slingshot-http-one-matrix-tests.log`),
   as do target Clippy with all features and warnings denied, formatting and
   whitespace checks (`/tmp/slingshot-http-one-matrix-clippy.log`). HTTP/2
   submission decomposition and the full client gate remain
   unfinished.

142. **HTTP/2 submission peer decomposed into explicit protocol stages.**
   `submission/http_two_peer.rs` separates TLS acceptance/ALPN checks, request
   head reading, stage-specific header observations, complete submission-body
   reading and response framing. Named stages replace numeric sentinel ranges.
   Eight explicit stage-selection controls preserve both protocol modes across
   success, invalid token, guard refusal and truncation: token/guard refusal
   never reaches a POST, and only an undefected negotiated exchange adds the
   snapshot lookup. Existing certificate, TLS 1.3, ALPN, preface/settings, frame
   flag, route/authentication, token/idempotency/referer, exact body, truncation
   and close assertions remain. The first full environment-provider run passes
   35 tests (`/tmp/slingshot-http-two-peer-tests.log`). After naming the remaining
   fixture values and sharing its generation with preflight, source policy
   reports 291 findings and none under `environment_provider/submission`
   (`/tmp/slingshot-http-two-peer-final-policy.log`). The parent is 266 lines;
   the new peer is 242. Target Clippy, formatting and whitespace checks pass
   (`/tmp/slingshot-http-two-peer-clippy.log`). The final-source wire rerun also
   passes all 35 tests (`/tmp/slingshot-http-two-peer-final-tests.log`).
   The scan's acceptance does not complete broader review: the client-side
   HTTP/2 control flow remains inline inside `tokio::join!`, and the client-wide
   gate, current candidates and integration evidence remain unresolved.

143. **Complexity checking skipped executable Tokio join bodies.**
   The client source-policy visitor did not inspect macro tokens, so branches
   inside `tokio::join!` were absent from its complexity count. Six new fixtures
   exercise the limit of ten and the first refused value of eleven for qualified
   `join!`, leading-colon `join!(biased; ...)`, and `try_join!`. Before the
   repair, the refused join fixture incorrectly reported no violations
   (`/tmp/slingshot-join-complexity-before.log`). The visitor now parses these
   explicitly qualified Tokio macros as comma-separated Rust expressions,
   supports the optional `biased;` directive, and visits their expressions.
   Both accepted/refused fixture suites pass after the repair
   (`/tmp/slingshot-join-complexity-focused.log`). This is not general macro
   expansion, alias resolution, or enforcement of other policies inside macros.
   The corrected repository scan reports 296 violations, rather than the old
   291 (`/tmp/slingshot-join-complexity-policy.log`). The submission parent is
   still complexity 15 and refresh is 103; discovery's newly exposed branch
   chain was extracted and is now below the ceiling.
   Finding 142's recorded clean submission scan was therefore incomplete, not
   proof that the remaining inline control flow met the ceiling. No baseline,
   ceiling, or exemption was changed. Development-package all-target/all-feature
   Clippy with warnings denied passes (`/tmp/slingshot-join-complexity-clippy.log`),
   as do scoped formatting and whitespace checks. The complete all-feature
   source-policy target finishes with ten passed and two failed: the existing
   repository inventory/baseline assertions remain red
   (`/tmp/slingshot-join-complexity-all-tests.log`). The complete
   environment-provider target passes all 35 tests after the discovery
   extraction (`/tmp/slingshot-preflight-all-env-tests.log`). Current-candidate
   integration evidence is unchanged.

144. **Candidate-digest unit coverage assumed stale bytes were valid.**
   The pinning test previously required every recorded candidate to resolve,
   even when the committed digest intentionally no longer matched bytes on
   disk after a sibling rebuild. It now computes the on-disk digest and asserts
   the contract on both sides: matching bytes resolve as the candidate, while
   stale bytes refuse with `candidate-digest-differing` and expose the computed
   digest. The focused pinning and TypeScript checks pass, and the authoritative
   isolated harness suite passes 437 tests with 2,591 assertions and no
   failures (`/tmp/interop-full-after-pinning-isolated.log`). A non-isolated
   Bun run remains invalid evidence because module mocks contaminate unrelated
   files; `scripts/quality` correctly uses `--isolate`.

145. **Reviewable sibling candidates were prepared from exact commits.**
   The reviewed client worktree is committed as `57478c77b688abf5bcc3f278335732e1902ee181`
   (`test: strengthen integration transport verification`), and its release
   archive is `/tmp/interop-candidate-reviewed/slingshot-x86_64-unknown-linux-gnu.tar.gz`
   with SHA-256
   `e96dd6835c52ed044af338dbb9d4e4f82025089a1706d8baf809488c5c65929e`.
   The reviewed agent worktree is committed as
   `6ef67e005696d766b4aa43b1372ab1324922c00d`
   (`test: strengthen agent integration verification`), and its core bundle is
   `/tmp/interop-candidate-reviewed/slingshot-agent-core-0.0.0.jar` with
   SHA-256 `cc4af8739fef393f839cf8edf089250bd002a89340b26b03de890adb7ae074a2`.
   Both worktrees are clean after commit. The client environment-provider
   matrix passes 35/35 tests, and the isolated harness passes 437/437 tests;
   neither candidate is marked acknowledged or written into the committed
   side-pin records. These artifacts are therefore ready for owner review, not
   yet valid evidence of an acknowledged end-to-end run.

146. **First exact-commit candidate orchestration exposed three cross-sibling failures.**
   An isolated temporary harness with both candidate pins updated to the exact
   commits and digests reached author startup, bundle installation, client
   startup, and all eight scenarios. Five scenarios passed; three failed with
   contract-level evidence: artifact transfer reported that the destination
   lock could not be taken, authentication refusal did not observe only 401
   submission responses, and severed recovery returned a `queued` resume receipt
   instead of acknowledging the first guarded resume. The complete run log is
   `/tmp/interop-prepared-candidates-run3.log`. This is the first live result
   using the reviewed sibling commits; it is not converted into an acceptance
   claim, and no pin or acknowledgement is changed to hide the failures.

148. **Artifact lock failure was narrowed to the client lock acquisition path.**
   A diagnostic client commit `7edbd69` preserves the exact derived lock path
   in the refusal. Its isolated artifact-only candidate run still refuses before
   transfer, identifying a concrete lock pathname under the container's
   writable scratch home (`/tmp/interop-artifact-diagnostic.log`). The refusal
   is therefore not a missing destination or an archive-verification problem;
   the remaining question is why the lock's private-file/ownership checks reject
   that container filesystem. No security check was relaxed. The diagnostic
   candidate archive is `/tmp/interop-candidate-reviewed/slingshot-x86_64-unknown-linux-gnu.tar.gz`
   with SHA-256
   `df4f7ac130c39a17df410ccbb5673b83191c37e1515c4af6f80ca3fe7d1c9e5b`.

149. **Bounding derived lock names repaired artifact transfer in the live run.**
   The client now hashes an overlong staging stem while retaining all source
   identity in the digest, keeping each lock filename below the filesystem
   component ceiling. Boundary tests pass and client commit `30134fc` produces
   candidate archive SHA-256
   `3008004b6be25d659c9f7405a6e8e8d2736e752410452d085648bdbb0ab80764`.
   The full exact-candidate orchestration then passes artifact transfer and six
   of eight scenarios; authentication refusal and severed recovery remain
   failing as recorded in `/tmp/interop-candidates-after-lock-fix.log`.

147. **Exact-commit orchestration exposed deeper sibling incompatibilities after parser repair.**
   With `transition_revision` admitted as validated agent metadata, the temporary
   candidate run reached all eight scenarios. Five passed; artifact transfer
   failed to acquire its destination lock, authentication refusal failed to
   observe only the expected 401 submission responses, and severed recovery
   returned a queued resume receipt instead of acknowledging the first guarded
   resume. Evidence: `/tmp/interop-prepared-candidates-run3.log`. These remain
   open compatibility defects; no scenario was weakened and no pin was changed
   to conceal them.

## Verification so far

- Current client transport package reverified after all decoder repairs:
  `CARGO_NET_OFFLINE=true CARGO_TARGET_DIR=/var/tmp/slingshot-quality-target
  cargo test --locked -p slingshot-agent-connection --all-targets --all-features`
  completes with exit 0, 439 tests across 29 targets. The long-running
  terminal-failure target completes with all ten tests passing; nothing is
  filtered or skipped. Evidence: `/tmp/slingshot-current-transport-package.log`.
  The production library also passes all-feature Clippy with `-D warnings`
  (`/tmp/slingshot-current-transport-clippy.log`). This supersedes the earlier
  438-test transport result for current-worktree verification, but not the
  unresolved full client quality gate or live sibling integration.

- Client finite-HTTP public methods now document their actual failure phases,
  bounds/deadlines and post-write execution uncertainty. The request-failure enum
  documentation no longer claims no network access: negotiation may precede a
  selected-codec encoding refusal, although no application request has been sent.
  The policy rescan drops from 713 to 710 findings, with the three documentation
  findings removed and no baseline/suppression change. Formatting passed; the
  focused finite-HTTP integration regression passes (one test; 28 filtered out).

- Latest full harness gate including early-refusal reporting completed with
  190 passes and one failure, 1,304 assertions over 30 files (exit 1). The only
  failure remains the acknowledged agent candidate's stale digest. This run used
  unchanged code throughout and passed startup/configuration, cleanup, deadline,
  report, scenario and socket regressions, plus TypeScript and image verification.

- Fresh full harness verification after upload/deadline repairs ended with 186
  passes and one failure (1,275 assertions, 30 files). Only the stale candidate
  digest failed; runtime startup, cleanup and deadline assertions passed.
- Four new real-command subprocess tests reproduced absent reports for missing
  or malformed image inputs, orchestration exceptions before structured evidence,
  and unresolved sides. All now pass: the command writes a separate `refused`
  report with stage/diagnostic and no invented resolved identities or scenario
  inventory. Existing resolved reports remain unchanged. Combined command/report
  tests pass 17/17 (53 assertions); TypeScript passes. Full-gate verification of
  this latest reporting change remains pending.

- Full client selected-admission integration suite after startup decomposition
  passed 18/18 with no ignored or filtered tests (244.40 seconds). The long
  event-stream and subscription-reset cases completed successfully. This does
  not clear the outstanding client-wide source-policy gate.
- Full harness gate after readiness repair is terminal with exit 1: 180 pass,
  one failure, 1,240 assertions over 29 files. The only failure is the stale
  acknowledged agent digest. Runtime startup, cleanup, socket/scenario tests,
  image verification and TypeScript passed; no candidate check was bypassed.

- Latest complete harness gate is terminal with exit 1: 176 tests passed, two
  failed, 1,207 assertions across 28 files. One failure correctly rejects the
  rebuilt agent against its stale acknowledged digest; the other is the startup
  readiness failure described above. No test was skipped or weakened.

- Agent full gate after lookup/recovery repairs and release-inventory refresh
  is terminal with exit 0 and `gate passed`. Its interop module reports 466 tests,
  zero failures/errors/skips. Owner Adobe quickstart and sibling-client tiers
  were explicitly excluded; this is not a full sibling end-to-end pass.
- Client startup decomposition began with its durable installation/reopen
  regression passing before changes. Installation-record admission, database
  presence, retained-operation binding and registration consistency are now
  separate validation helpers, preserving the transaction lifetime and ordering.
  The first extraction reduced the method from 21 branches to 12 and passed all
  four runtime-builder regressions. Final extraction again passed those four;
  the policy rescan reports 713 findings, with none in `runtime_builder.rs`.
  The full selected-admission integration suite has started to broaden recovery
  verification; the client-wide policy gate remains unresolved.

- Client runtime policy follow-up corrected the exact external `Debug` trait
  paths and documented failure conditions on six public fallible methods.
  No behavior, suppression, or policy baseline changed. The authoritative
  source-policy rescan now reports 714 findings rather than 722; only the
  21-branch `establish_durable` complexity finding remains in `runtime_builder.rs`.
  Formatting checks pass. The offline all-target/all-feature daemon compile
  passed with exit 0; the client-wide gate remains unresolved.

- Added nine isolated-process failure-category scenario tests. They confirm the
  existing scenario rejects transport/reclassified categories, absent metadata,
  success instead of failure, conflicting agent state/category, and malformed or
  missing canonical failure documents. The valid case follows the original local
  operation to its resolved agent identifier. All nine pass (38 assertions);
  these are mocked boundary checks, not additional live command coverage.
- Combined scenario tests passed 63/63 (345 assertions) before those nine tests
  were added. The first sandboxed run had one local-listen permission failure;
  repeating with authorized local socket access passed without changing code.
  The combined rerun including the new failure-category tests passed 72/72
  (383 assertions across 11 files). The full agent gate is still running.

- Latest agent gate after counter repairs stopped in development tests: the
  generated release inventory still names the prior core, sources and container
  artifact bytes. Core tests passed, but this is a failed full gate, not a pass.
  A fresh offline `scripts/build_release_artifacts` run has started to regenerate
  the agent's own artifact inventory; harness candidate pins and owner
  acknowledgements remain unchanged.
  That artifact build completed successfully, recording all declared hashes and
  111 components. A new complete agent gate has started against this refreshed
  inventory; its result is pending.
  The rebuilt core bundle after the counter repairs currently hashes to
  `20ae81f513a855c192d80e88964c927cc75a978775c0b5848f3a7810e7e88274`;
  this supersedes the earlier dirty-build hash in this chronological record,
  not the committed owner-acknowledged candidate pin.

- Initial full harness quality gate: 92 tests passed, but Podman printed cleanup
  permission errors. Passing tests alone do not prove clean teardown.
- Revised TypeScript check and focused command/report tests pass.
- Real integration run `run-1789507599931`: seven scenarios passed, teardown and
  leak check completed, exit zero. Its TOML report preserves scenario messages.
  These passes remain subject to the proof gaps above.
- A concurrent quality run failed the planted-bundle test because runtime setup
  shares a fixed container name/port with integration. Do not run these gates
  concurrently until runtime isolation is fixed.
- Sequential full revised gate: 95 passed, 1 failed. The planted-bundle runtime
  test received `INSTALL_FAILED` rather than `NEVER_BECAME_READY` after 16.5s.
  Investigate the actual install diagnostic and readiness assumptions; the
  current assertion prints only the reason and the test deletes its captures.
  Podman also printed a rootless network cleanup permission error. The full
  gate is not currently verified green.
- Follow-up runtime retries: four sequential runs passed before the cleanup fix.
  The improved assertion now includes the actual installation diagnostic on
  failure. After the fix, the real planted-bundle test passed and verified no
  leftover container, without its prior cleanup permission diagnostic. The
  intermittent install failure remains open until its cause is established.
- Full harness gate after lifecycle repairs: **97 passed, 0 failed**, including
  the new network leak regression and failed-start ownership assertion. The
  deliberately leaked-container fixture still prints a Podman rootless-network
  permission warning while cleaning up; its final container/network leak check
  passes.
- Agent full gate stopped at cache verification: nine recorded local 0.0.0
  reactor artifacts are absent and nine unrecorded 0.1.0 artifacts are present.
  No product/policy tests ran. Review cache preparation and avoid treating those
  stale locally installed reactor artifacts as external dependency authority.
- Client gate first stopped for an unspecified advisory checkout. A clean
  checkout was located at `/var/tmp/slingshot-rustsec-0.2.0`; its origin and HEAD
  match the committed advisory pin. The full offline gate then passed advisory
  verification, minimum-version compilation, formatting, and workspace checking,
  but failed Clippy's `needless_question_mark` in
  `crates/slingshot-configuration/src/platform_trust.rs`. Removed the redundant
  `Ok(...?)` around the collected result, preserving error propagation. A full
  offline rerun is in progress using `CARGO_TARGET_DIR=/var/tmp/slingshot-quality-target`.
- Real integration after lifecycle repairs: `run-1789508002050` passed all seven
  scenarios, completed teardown, and passed the stricter container/network leak
  check. It used the previously pinned client archive, before the source-only
  lint correction above; it is not evidence for a freshly rebuilt client.
- The deliberate leak fixture now uses normal stop/remove after proving the
  leak. Its focused suite passed four tests and a final empty resource check
  without cleanup permission warnings.
- Client gate rerun after the redundant-result repair passed compilation again
  but stopped at lints: the scheduler mutex issue above, six needless borrows in
  `crates/slingshot-agent-connection/tests/environment_provider.rs` (around
  lines 1293–1300 and 1557–1565), and a sliced-string-as-bytes diagnostic at
  line 2460. No client tests or later policy gates have run yet. Both gate
  processes and the integration rerun are terminal; no process needs resuming.
- Scheduler regression: failed on the old code with a local-ping timeout, then
  passed after the connection-ownership repair. Extended ping/status regression
  also passed. Full retained-submission suite: **14 passed, 4 failed** in 101.67s.
  Failures are event-route scope, subscription-reset request flow, retired
  artifact lookup route, and submission idempotency-header expectation. The
  event-route failure was reproduced on unchanged HEAD in the isolated local
  checkout `/tmp/slingshot-review-baseline.SKGTA3`. Do not attribute all four
  failures to either the repair or stale tests until individually checked.
- Also repaired the client's six reported redundant transport-test borrows,
  sliced-string-as-bytes expression, and an accidental Markdown list in the MCP
  ToolRunner documentation. Workspace Clippy subsequently passed with all
  targets/features and warnings denied.
- Wire diagnostics established that the event fixture omitted the required
  `agent_operation_identifier`; the artifact-retirement fixture expected
  `/snapshot` instead of `/artifact`; and submission fixtures expected the
  operation identifier as the idempotency key instead of the manifest-bound
  submitted command digest. Confirmed these expectations against the agent's
  `EventStreamServlet`, `ArtifactServlet`, and `SubmitServlet`/`SubmissionBinding`,
  then repaired the fixtures (both HTTP variants for submission) and the stale
  client module documentation. The artifact and submission tests now pass.
  The subscription-reset fixture still expects a GET high-water query but
  receives the CSRF-token request preceding the current POST flow. Its repair
  must cover authentication, request body, and both HTTP variants, not just
  relax the route assertion.
- The direct client source-policy check reports 738 violations. A filtered
  rerun reports none in the new execution worker, scheduler module, or scheduler
  responsiveness regression. Unchanged HEAD reports 636 violations. The
  repository's debt baseline keys diagnostics by exact line number, so moving
  existing code also exposes previously baselined findings; the larger count
  must not be represented as 102 newly introduced defects. The structural gate
  is not green and no suppression has been added.
- Revised retained-submission suite: **16 passed, 2 failed** in 99.86s. The
  event test passed its repaired scope assertion, then timed out in terminal
  reconciliation; its fixture still used the historical `/operations/` route
  to decide when capability refusal must stop the exchange. Updated that guard
  to the current `/snapshot?` route and added case-specific timeout diagnostics;
  focused verification is running. Subscription-reset fixture repair remains
  open. No full client gate or rebuilt-candidate integration pass is claimed.
- Event fixture verification subsequently passed all cases (242.81s). Repaired
  the reset fixture to serve and authenticate the CSRF-token request, require
  POST for high-water, validate its token and exact JSON members, and consume
  its body on both HTTP/1 and HTTP/2. Its existing atomic-state checks remain.
  All reset cases passed (177.35s). The long runs advanced through fresh
  databases; high CPU usage was not evidence of a hang. The new helper passed
  Clippy and produced no source-policy findings. These two focused passes
  supplement the 16 earlier passes; a full client quality rerun is now running.
  They do not fix or prove compatibility with the real high-water response in
  finding 12.
- Full client gate rerun passed the advisory pin, minimum-version build,
  formatting, compilation and workspace Clippy; workspace tests are running.
  Agent `scripts/prepare_locked_dependency_cache` completed its build-only pass
  and reached its non-container test pass. This is preparation, not a full
  agent gate: static-analysis decisions and coverage are relaxed by that
  documented preparation command, and the generated cache record still needs
  inspection. No old digest was manually replaced. The previously pinned agent
  JAR was copied to `/tmp/slingshot-agent-reviewed-input.HqAKCT/` and its digest
  was confirmed unchanged (`a33be224...806f9`) so rebuilding does not destroy
  the input used by the earlier interoperability runs.
- Agent preparation stopped with exit 1 in `ReleaseArtifactsTest` after core's
  1,180 tests passed. The development suite had 453 tests, one failure: its
  `anunbuiltReleaseSaysSo` test assumes the real checkout is unbuilt, but the
  checked-in release inventory contains digests and some current outputs differ;
  the declared bill of materials is also absent. Preparation therefore did not
  rewrite the dependency-cache record, and the agent worktree remains clean.
  Isolate the unbuilt-state fixture without weakening actual release-byte
  verification; separately rebuild and verify the declared release outputs.
  Follow-up: the current real-checkout assertion permits an empty finding list,
  so a correctly rebuilt recorded release can satisfy it despite the misleading
  unbuilt-state name. The next step is the repository's offline release-build
  command, preserving its generated digest evidence and then verifying it;
  no release-byte check has been relaxed or removed.
- The offline agent release build completed and regenerated the missing bill
  of materials and digest inventory. The repaired core JAR is
  `dce887e78d22d779d97c3ab2a8b0817896eaffd5e362b13a65aae4ca9a9430b0`;
  it is not the original acknowledged candidate. Release reproducibility must
  be rerun with the corrected verifier described in finding 13.
- Full client gate progress: the retained-submission suite now passes together,
  **18/18**, in 243.60s. The gate is continuing into later suites; this is not a
  full-gate pass.
- The client full gate subsequently stopped in `rustsec_advisory_pin`: five
  synthetic-checkout tests could not create their fixture commit because the
  machine's commit-message hook rejected `one advisory`. Changed only that
  fixture message to `test: add advisory fixture`; hooks remain enabled and
  the pinned advisory checkout is untouched. All eight focused tests pass.
- Latest full harness gate: **102 passed, 1 failed**. The failure correctly
  rejects the rebuilt agent JAR against the original acknowledged candidate
  digest. No candidate acknowledgement or commit attribution was rewritten.
  Lifecycle tests passed without cleanup warnings. Subsequent expanded failure-
  reporting checks pass **16 tests, 114 assertions**; TypeScript and diff checks
  pass. The full gate remains non-green until candidate provenance is resolved.
- Agent release-verifier regression now avoids dynamic process command arguments
  and multiline format strings rather than suppressing analyzer findings. Its
  eight focused tests pass; documented cache preparation has been restarted to
  check the complete build and test path before recording the cache.
- Agent cache preparation completed successfully, recording 1,634 artifacts.
  The inventory diff changes only the preparation time and nine local reactor
  artifact paths from 0.0.0 to 0.1.0; all recorded digests remain unchanged.
  Development SpotBugs reports zero findings. This is not a full-gate pass:
  preparation relaxes coverage and analyzer decisions. The full offline agent
  gate is now running, as is the client gate rerun after its advisory fixture fix.
- Agent full gate has now passed cache/image verification, formatting,
  compilation, static analysis, source policy, nullability, API/method shape,
  documentation, allocation, and Adobe practice. Tests/coverage are running.
  Client compilation and Clippy passed again; its workspace tests are running.
- Agent live gate reached crash scenarios. `GenerationRotationCrashScenario`
  failed: `/bin/slingshot-proof/transitions` returned HTTP 500 because
  `GenerationRotationProbe.prepare:64` casts `JobEvent.Refused` to
  `JobEvent.Held`. The gate continues collecting tests; this needs diagnosis
  before a focused rerun, not a relaxed assertion. Earlier clock-chaos,
  container-lifecycle, crash-consistency, and concurrent-write scenarios passed.
  Diagnosis: the test-only probe constructs an accepted event with sequence 0,
  but `EventSequence.FIRST` is 1 and the decoder correctly refuses zero. Updated
  the fixture to use that declared constant and report typed decoding failures
  instead of an unchecked cast. Added a core regression that runs the live
  fixture's publication, rotates, then checks its retained operation/snapshot/
  artifact readback. Verification is pending until the running gate finishes;
  rebuilding shared target classes mid-gate would contaminate its evidence.
- Combined non-container review regression run: **31 passed, 0 failed, 213
  assertions** across failure reporting/cleanup, high-water response validation,
  independent admission inventory, live WAL reads, and real-socket severance.
  Both sibling gates were confirmed live by their process handles and process
  inspection; the client was in retained-submission tests and the agent in
  intake-publication crash tests. Neither was restarted on quiet output.
- Client full gate is now terminal with exit 101 at `source_policy`: 10 tests
  passed and two failed (repository-rule command and file-ceiling/baseline
  coverage). Its retained-submission suite again passed 18/18 (243.98s), and
  the earlier advisory-fixture blocker was cleared. The known source-policy
  debt remains unresolved; no baseline relaxation has been made.
- Agent gate found two additional live failures. WalkingSkeletonScenario still
  requires `command_contracts: []` even though the running bundle advertises its
  implemented command contracts. Its replacement must validate the actual
  registry-derived contract set, not merely remove the assertion.
  Replacement implemented: parse the bounded live document, require a command
  array, and compare its complete ordered identities against the 32 commands
  registered by the Sling-only DefaultCommandRuntime, with each identity loaded
  from the committed registry. This compares schema/limits digests and versions,
  not merely names or non-emptiness. Compilation and live rerun remain pending.
  StateAccessOwnershipScenario expected an operator to use another daemon's
  subscription, contrary to StateAuthority's explicit owner-only subscription
  rule. Updated the matrix to retain operator operation inspection but require
  404 for foreign subscription high-water/events; owner access remains 200 and
  anonymous access 401. No product authorization was widened. Live revalidation
  is pending until the running gate ends.
- Agent full gate is terminal (exit 1): its interop suite ran 466 tests with
  three failures and no errors/skips, exactly the generation fixture,
  WalkingSkeleton capability assertion, and StateAccessOwnership subscription
  assertion described above. Core, AEM, package and development modules passed
  this reactor run. Focused recompilation/reruns of the three live scenarios
  and the new generation fixture regression have now started.
- Focused agent rerun passed: 19 generation-rotation core tests and seven live
  tests across GenerationRotationCrashScenario, WalkingSkeletonScenario, and
  StateAccessOwnershipScenario. Build exit 0; all three prior live failures now
  pass without changing product authorization or accepting an empty capability
  set. A complete agent gate rerun has started.
- Current direct client policy diagnostics: 738 (626 unnamed numeric values,
  41 naming findings, 32 missing failure sections, 31 complexity findings,
  seven file ceilings, one forbidden suppression). This is not a count of new
  defects: the unchanged baseline run already reported 636, and exact line
  numbers make moved debt reappear. Added the execution entrypoint's missing
  failure documentation; formatting passes. Removed the artifact-fetch test's
  forbidden missing-docs allowance; focused verification is running.
- Artifact-fetch tests pass 7/7 with the prohibited allowance removed.
  IMS HTTP/2 response-decoder cleanup names existing frame/credit/status values,
  fully qualifies its external Debug interface, documents failure contracts,
  and corrects a stale comment requiring transport EOF despite stream completion.
  No wire values or validation branches were changed. Its exchange suite is
  running; the oversized response-assembly method still needs decomposition.
  Exchange tests passed 16/16 and the formatter completed. The decoder's own
  frame-level tests are now running; the exchange-suite pass alone does not
  establish all HTTP/2 framing behavior.
  All eight frame-level tests passed before and after splitting response
  assembly into header admission, header completion, and body admission.
  Existing ordering, poisoning, exact-limit, trailer, and completion assertions
  remain intact. The policy rescan is terminal: 722 diagnostics remain, down
  from 738, and none now name this response-decoder module. No complexity
  exemption or baseline addition was made. The full client gate remains open.
- Agent full `scripts/quality` rerun is terminal with exit 0 and `gate passed`.
  The interop reports total 466 tests, zero failures/errors/skips. The final
  package analysis, policy stages, and public-interop-tier build also passed.
  The gate explicitly excludes the owner-supplied Adobe quickstart tier and
  sibling-client end-to-end tier; neither was run by this gate. Therefore this
  is evidence for the repaired agent's default gate, not proof of full sibling
  interoperability. Harness live reruns still require rebuilt proxy inputs and
  correctly acknowledged/identified candidate artifacts.
- The existing client-runtime harness tests pass 7/7 after tightening the
  machine-envelope reader (17 assertions), including the successful mocked
  configuration/ping/start sequence and release archive checks.
- Harness image preparation completed successfully using
  `scripts/prepare_interop_images`. Tier-Sling and client-runner identifiers
  stayed unchanged; the repaired severance proxy is now recorded at
  `sha256:e71e7daa8c10c3e9df6f7db281c2083254348b509d970b2d12cde1b7cfc80837`.
  A full harness quality run has started against these prepared inputs.
  The rebuilt agent bundle still hashes to
  `dce887e78d22d779d97c3ab2a8b0817896eaffd5e362b13a65aae4ca9a9430b0`,
  not its old acknowledged pin. The owner has been asked whether to supply
  committed/acknowledged candidates or authorize preparing commits/candidates
  for review. No owner acknowledgement or old source attribution was changed.
  The subsequent image rebuild for per-arming observation completed at proxy
  digest `sha256:dbbeab680404afb0ddf1de03d87a26d58e721ab18a343d44c10dbb104987d24e`;
  later request-targeting source changes are not in that image yet.
- Full harness gate is terminal with exit 1: 124 tests passed and one failed
  (576 assertions over 20 files). The sole failure is the committed candidate
  resolution test, correctly refusing the rebuilt agent against its old digest.
  Prepared image verification, offline dependency installation, TypeScript,
  real proxy socket tests, startup-refusal cleanup, container lifecycle and
  leak checks all passed. This is not a green gate; candidate provenance remains
  unresolved and no test was skipped or weakened to hide it.
- Started the complete client `slingshot-agent-connection` package tests with
  all targets/features, locked dependencies and offline networking for Cargo.
  This broadens verification beyond the focused IMS decoder/exchange suites;
  the client-wide source-policy gate remains unresolved.
  This run is now terminal with exit 0. All package targets/features passed,
  including the environment-provider wire suite (29 tests), terminal-failure
  suite (10 tests, 234.54s), and capability probes. This verifies the current
  transport worktree more broadly, but does not clear the client-wide policy
  gate or replace real sibling integration.
