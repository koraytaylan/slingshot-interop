// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

package rs.slingshot.interop.fixture;

import java.time.Instant;
import java.util.Hashtable;
import java.util.List;
import java.util.Map;
import java.util.SequencedMap;
import java.util.UUID;
import org.apache.sling.api.resource.PersistenceException;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.api.resource.ResourceResolver;
import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;
import rs.slingshot.agent.command.platform.SuspensionState;
import rs.slingshot.agent.command.platform.WorkflowInstanceState;
import rs.slingshot.agent.command.platform.WorkflowService;

/** Test-only platform seam: every successful invocation commits a new child. */
public final class CountingWorkflow implements BundleActivator, WorkflowService {
    private static final String MODEL = "interop-non-idempotent-v1";

    /** Registers only the published workflow seam; no servlet or agent handler is replaced. */
    @Override
    public void start(BundleContext context) {
        Hashtable<String, Object> properties = new Hashtable<>();
        properties.put("slingshot.interop.fixture", MODEL);
        context.registerService(WorkflowService.class, this, properties);
    }

    /** The framework unregisters this bundle's services when it stops. */
    @Override
    public void stop(BundleContext context) {
    }

    /** The fixture's single model, clearly distinguished from an AEM workflow engine. */
    @Override
    public Outcome models(String titlePrefix, ResourceResolver session) {
        Model model = new Model(MODEL, MODEL, "1");
        return new Models(MODEL.startsWith(titlePrefix) ? List.of(model) : List.of());
    }

    /** Uses only the real command caller's resolver and an isolated fixture payload. */
    @Override
    public Outcome start(String modelIdentifier, String payloadPath,
            SequencedMap<String, String> metadata, ResourceResolver session) {
        if (!MODEL.equals(modelIdentifier)) {
            return new Refused("model_not_found", "Only the counting fixture model is available.");
        }
        if (!payloadPath.matches("/content/interop/[a-zA-Z0-9_-]+/counting-effects")) {
            return new Refused("payload_access_denied", "The counting fixture requires its isolated payload.");
        }
        Resource parent = session.getResource(payloadPath);
        if (parent == null) {
            return new Refused("payload_not_found", "The fixture payload must already exist.");
        }
        String name = "effect-" + UUID.randomUUID();
        String started = Instant.now().toString();
        try {
            Resource effect = session.create(parent, name, Map.of(
                    "jcr:primaryType", "nt:unstructured",
                    "fixtureModel", MODEL,
                    "payloadPath", payloadPath,
                    "startedBy", session.getUserID(),
                    "startedAt", started));
            session.commit();
            return new Started(new Instance(effect.getPath(), MODEL, payloadPath,
                    WorkflowInstanceState.RUNNING, started));
        } catch (PersistenceException failure) {
            session.revert();
            // Commit may have reached storage before reporting failure. Never claim no effect.
            return new Refused("platform_control_outcome_unknown", "The fixture commit outcome is unknown.");
        }
    }

    /** This fixture intentionally implements only workflow start and model listing. */
    @Override
    public Outcome instances(InstanceQuery query, ResourceResolver session) {
        return new Refused("workflow_inventory_failed", "Use an independent repository read to count effects.");
    }

    /** Independent repository reads are the fixture's observation authority. */
    @Override
    public Outcome inspect(String instanceIdentifier, ResourceResolver session) {
        return new Refused("instance_not_found", "Use the independent repository effect inventory.");
    }

    /** No workflow control is simulated. */
    @Override
    public Outcome terminate(String instanceIdentifier, ResourceResolver session) {
        return new Refused("instance_not_terminable", "The counting fixture does not run a workflow engine.");
    }

    /** No workflow control is simulated. */
    @Override
    public Outcome suspend(String instanceIdentifier, SuspensionState requested, ResourceResolver session) {
        return new Refused("instance_not_suspendable", "The counting fixture does not run a workflow engine.");
    }
}
