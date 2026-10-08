# Non-idempotent workflow fixture

This test-only OSGi bundle supplies the actual agent's published `WorkflowService`
seam. It replaces no agent command, admission, execution, persistence or transport
code. It is not an AEM workflow engine.

The bundle also registers minimal synthetic page and asset node types for
disposable public Sling discovery scenarios. These types provide repository
shapes only; they supply no page or asset platform APIs.

Every successful `start_workflow` invocation creates and commits a fresh UUID
child using the actual caller's resolver. It never deduplicates by operation key
or payload. The scenario must read children independently through Sling's default
GET servlet, compare the returned instance path with the retained agent result,
and require exactly one effect after the targeted lost response and recovery.
A control using two distinct admissions for identical arguments must produce
two different children, proving that the counter would detect duplicate effects.

Only the `interop-non-idempotent-v1` model and an existing payload matching
`/content/interop/RUN_LABEL/counting-effects` are accepted. The production handler
still applies its normal payload permission checks. The fixture registers no
HTTP endpoint, obtains no administrative resolver and creates no background job.
A reported commit failure has an unknown effect outcome; it never claims that no
write happened. Other workflow controls are explicitly refused.

Install only in the disposable public Sling test runtime after verifying that no
real workflow platform service is present. Remove the fixture bundle when the
scenario finishes. A fixture source and artifact digest, the exact agent JAR
used to compile its interface, compiler image and dependency digests must be
retained with the report. Compilation alone is not integration evidence.
