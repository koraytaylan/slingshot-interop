// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { submittedOperation } from "./submission.ts";
import { readBoundedJson, parseUniqueJson } from "../harness/bounded-json.ts";
import { runCleanup } from "../run/cleanup.ts";
import { severanceControlPort } from "../run/orchestration.ts";
import { authorHostPort } from "../sides/author-host-port.ts";
import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { agentOperationInventory } from "./agent-operation-inventory.ts";
import { fixtureModel, effectInventory, loadWorkflowFixture, workflowResult } from "./counting-workflow.ts";
import { submissionRequestLine } from "./proxy-observation.ts";
import { observedResponseCut, recoveryArguments } from "./severed-submission.scenario.ts";
import { WorkflowFixtureRuntime } from "./workflow-fixture-runtime.ts";
import { agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";

type Outcome = { ok: boolean; message: string; evidence?: Record<string, unknown> };

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
		const runtime = new WorkflowFixtureRuntime(options);
		const control = `http://127.0.0.1:${severanceControlPort(options.values)}`;
		const machine = machineArguments(options, options.scratchHome.profileName);
		const payload = `/content/interop/${options.labelValue}/counting-effects`;
		const evidence: Record<string, unknown> = {};
		let ownsFixture = false;
		let ownsArm = false;
		const disarm = async () => {
			const response = await fetch(`${control}/disarm/client`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000) });
			await response.body?.cancel();
			if (!response.ok) throw new Error("could not disarm the response cut");
		};
		const command = async (arguments_: readonly string[]) => {
			const result = await invoke(handle, [runner(), ...machine, ...arguments_], options);
			if (!result.ok) throw new Error(result.message);
			if (result.exitCode !== 0) throw new Error(`fixture command exited ${result.exitCode}: ${result.stderr}`);
			return result;
		};
		const submit = async (key: string) => {
			const result = await invoke(handle, [runner(), ...machine, "start_workflow", "--operation-key", key, "--model", fixtureModel, "--payload-path", payload, "--detach"], options);
            if (!result.ok) throw new Error(result.message);
			const receipt = submittedOperation(result, key);
			if (!receipt.ok) throw new Error(receipt.message);
			return receipt.operation_identifier;
		};
		const wait = async (identifier: string) => {
			const result = await waitTerminal(handle, machine, identifier, options, options.values.readiness.harnessSeconds * 1000);
			if (!result.ok) throw new Error(result.message);
			return result.envelope;
		};
		const effects = async () => effectInventory(await runtime.read(`${payload}.1.json`), payload);
		let outcome: Outcome;
		try {
			if (options.workflowFixtureReceipt === undefined || options.agentBundleDigest === undefined) throw new Error("prepare the workflow fixture and set SLINGSHOT_INTEROP_WORKFLOW_FIXTURE to its receipt");
			const fixture = await loadWorkflowFixture(options.workflowFixtureReceipt, options.agentBundleDigest);
			evidence["fixture"] = fixture.evidence;
			options.progress?.("installing the non-idempotent workflow fixture");
			if (await runtime.bundle() !== undefined || await runtime.hasWorkflow()) throw new Error("the fixture requires a public Sling runtime with no existing workflow service");
			ownsFixture = true; // an unanswered install may still have succeeded
			await runtime.install(fixture.bytes);
			await runtime.post(payload, new URLSearchParams({ "jcr:primaryType": "nt:unstructured" }));
			if ((await effects()).length !== 0) throw new Error("fixture payload was not initially empty");
			await command(["daemon", "start"]);
			const controls: string[] = [];
			for (const suffix of ["control-a", "control-b"]) {
				const terminal = await wait(await submit(`${options.labelValue}-${suffix}`));
				if (terminal.outcome !== "operation_result") throw new Error("non-idempotent control did not succeed");
				controls.push(workflowResult(terminal.result, payload));
			}
			const beforeEffects = await effects();
			evidence["control_effects"] = controls;
			evidence["before_effects"] = beforeEffects;
			if (new Set(controls).size !== 2 || JSON.stringify(beforeEffects) !== JSON.stringify([...controls].sort())) throw new Error("identical arguments in two admissions did not produce two independently visible effects");
			const before = await agentOperationInventory(authorHostPort(options), options.values.capture.maximumBytes);
			if (!before.ok) throw new Error(before.message);
			options.progress?.("cutting one workflow submission response after two sensitivity controls");
			ownsArm = true;
			const armed = await fetch(`${control}/arm/client?mode=response&request-line=${encodeURIComponent(submissionRequestLine)}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000) });
			await armed.body?.cancel();
			const arm = armed.headers.get("x-severance-arm");
			if (!armed.ok || arm === null) throw new Error("response cut has no arming identity");
			const key = `${options.labelValue}-non-idempotent-cut`;
			const identifier = await submit(key);
			let terminal = await wait(identifier);
			const observationResponse = await fetch(`${control}/observed/client`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
			const observation = await readBoundedJson(observationResponse, options.values.capture.maximumBytes);
			if (!observation.ok || !observedResponseCut(observation.value, arm)) throw new Error("no verified submission-response cut for this arm");
			evidence["proxy_observation"] = observation.value;
			await disarm();
			let recovery = "automatic reconciliation";
			if (terminal.outcome === "operation_recovery_required") {
				const restart = recoveryArguments(identifier, terminal);
				if (!restart.ok) throw new Error(restart.message);
				const resumed = envelope((await command(restart.arguments)).stdout, "workflow recovery restart");
				if (!resumed.ok || resumed.outcome !== "operation_resume_receipt" || resumed.category !== terminal.category || (resumed as Record<string, unknown>)["replayed"] !== false) throw new Error("guarded workflow restart did not acknowledge the observed recovery");
				await command(["daemon", "start"]);
				const end = performance.now() + options.values.readiness.harnessSeconds * 1000;
				do {
					terminal = await wait(identifier);
					if (terminal.outcome !== "operation_recovery_required") break;
					await Bun.sleep(options.values.readiness.pollIntervalSeconds * 1000);
				} while (performance.now() < end);
				recovery = "guarded resume";
			}
			if (terminal.outcome !== "operation_result") throw new Error(`the severed workflow did not recover its result: ${JSON.stringify(terminal)}`);
			const effect = workflowResult(terminal.result, payload);
			const resolved = await resolveAgentOperationIdentifier(options, options.scratchHome.profileName, identifier);
			if (!resolved.ok) throw new Error(resolved.message);
			const snapshot = await agentSnapshot(options, resolved.agentOperationIdentifier, resolved.targetDigest);
			if (!snapshot.ok) throw new Error(snapshot.message);
			if (snapshot.snapshot.kind !== "succeeded") throw new Error("agent did not retain workflow success");
			const retained = snapshot.snapshot.terminal_result as Record<string, unknown> | undefined;
			if (typeof retained?.["canonical_result"] !== "string" || workflowResult(parseUniqueJson(retained["canonical_result"]), payload) !== effect) throw new Error("retained workflow result differs from the recovered effect");
			if (await submit(key) !== identifier) throw new Error("replay produced a new local operation");
			const replayed = await wait(identifier);
			if (replayed.outcome !== "operation_result" || workflowResult(replayed.result, payload) !== effect) throw new Error("replay changed the workflow result");
			const after = await agentOperationInventory(authorHostPort(options), options.values.capture.maximumBytes);
			if (!after.ok) throw new Error(after.message);
			const added = after.operations.filter(path => !before.operations.includes(path));
			if (before.operations.some(path => !after.operations.includes(path)) || added.length !== 1 || added[0]!.split("/").at(-1) !== resolved.agentOperationIdentifier) throw new Error("recovery did not retain exactly one new agent admission");
			const afterEffects = await effects();
			evidence["after_effects"] = afterEffects;
			if (controls.includes(effect) || JSON.stringify(afterEffects) !== JSON.stringify([...controls, effect].sort())) throw new Error("the severed submission did not produce exactly one new independently visible effect");
			outcome = { ok: true, message: `Non-idempotent workflow fixture: two sensitivity controls produced two effects; targeted lost response recovered with ${recovery}; replay retained one logical admission and exactly one additional effect. Public Sling platform seam only.`, evidence: { fixture: fixture.evidence, control_effects: controls, before_effects: beforeEffects, after_effects: afterEffects, recovered_effect: effect, local_operation: identifier, agent_operation: resolved.agentOperationIdentifier, proxy_observation: observation.value, recovery } };
		} catch (failure) {
			outcome = { ok: false, message: failure instanceof Error ? failure.message : "non-idempotent recovery scenario failed", evidence };
		}
		const cleanup = await runCleanup([
			...(ownsArm ? [{ name: "proxy disarm", run: disarm }] : []),
			...(ownsFixture ? [{ name: "fixture uninstall and capability removal", run: () => runtime.remove() }] : []),
		]);
		return cleanup.length === 0 ? { ...outcome, evidence: { ...outcome.evidence, fixture_cleanup: "passed" } }
			: { ok: false, message: `${outcome.message}; cleanup: ${cleanup.join("; ")}`, evidence: { ...outcome.evidence, fixture_cleanup: cleanup } };
	},
};
