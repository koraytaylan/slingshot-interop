// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The failure-category scenario: a command that fails on the agent has to
// surface through the client as the failure the agent declared, never as a
// transport error, and never as the client's own reclassification. What the
// two sides name is compared, and a difference in any of them fails. The
// failing command is a page creation whose template path resolves to
// nothing: the agent's row for create_page declares template_not_found for
// exactly this, and the runtime carries no such template, so the failure is
// deterministic without planting anything.

import { agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const machine = machineArguments(options, options.scratchHome.profileName);

		// 0. The daemon: the submission is the daemon's remote exchange. An
		// explicit start converges regardless of which scenario ran first.
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		// 1. Create a page whose template does not exist, reaching a terminal
		// failure disposition. The parent is a path earlier scenarios in the
		// same run may have written under, but the template is named out of
		// the air: no such node is ever planted.
		const parent = `/content/interop/${options.labelValue}`;
		const missingTemplate = "/conf/site/settings/wcm/templates/no-such-template";
		const submitted = await invoke(handle, [
			runner(), ...machine, "create_page",
			"--operation-key", `${options.labelValue}-failure`,
			"--path", parent,
			"--name", "failing",
			"--template", missingTemplate,
			"--title", `Failing page of ${options.labelValue}`,
		], options);
		if (!submitted.ok) {
			return { ok: false, message: `the failing submission could not run: ${submitted.message}` };
		}
		if (submitted.exitCode !== 0) {
			return { ok: false, message: `the failing submission exited ${submitted.exitCode}: ${submitted.stderr}` };
		}
		const receipt = envelope(submitted.stdout, "create_page");
		if (receipt.ok === false) {
			return receipt;
		}
		if (receipt.outcome !== "operation_receipt") {
			return { ok: false, message: `the failing submission answered ${String(receipt.outcome)} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = receipt.operation_identifier;
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the failing submission named no operation: ${submitted.stdout}` };
		}

		// 2. Wait for the operation to reach a terminal disposition.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!ended.ok) {
			return ended;
		}
		if (ended.envelope.outcome !== "operation_terminal_error") {
			return { ok: false, message: `a page creation naming ${missingTemplate} ended as ${JSON.stringify(ended.envelope.outcome)} instead of a terminal error` };
		}

		// 3. Assert the category is the agent's word, not a client-side
		// reclassification: the row the agent serves for this command
		// declares `template_not_found` for a template that resolves to
		// nothing, and the client's terminal failure must carry exactly it.
		//
		// The client renders it as the failure object's own `metadata`
		// member, which is one bounded string rather than a nested
		// document: `machine_outcome_envelope.rs` declares `failure` as the
		// semantic failure the agent reported, and
		// `crates/slingshot-command-line/src/daemon_answer.rs` writes the
		// category there.
		const failure = ended.envelope.failure as { readonly metadata?: unknown } | undefined;
		const category = typeof failure?.metadata === "string" ? failure.metadata : undefined;
		if (category === undefined) {
			return { ok: false, message: `the terminal error carried no category in its failure metadata: ${JSON.stringify(ended.envelope)}` };
		}
		const expected = "template_not_found";
		// A transport error here would be the client reclassifying a declared
		// failure, which is the reading the scenario refuses. It is asked
		// before the comparison with the expected category, because a category
		// that is not the agent's fails that comparison whichever word it is
		// and the message would then name the wrong fault.
		if (category === "transport_error" || category === "result_unavailable") {
			return { ok: false, message: `the client reported ${JSON.stringify(category)} instead of the declared failure` };
		}
		if (category !== expected) {
			return { ok: false, message: `the client reports category ${JSON.stringify(category)} where the agent's row for create_page declares ${JSON.stringify(expected)}` };
		}

		// 4. Cross-check the agent's own record: terminal, the same category
		// the client reported, and the same kind the client's terminal error
		// asserts. The route's query member is the agent-side identifier the
		// client derived at submission, not the receipt's local one.
		const resolved = await resolveAgentOperationIdentifier(options, options.scratchHome.profileName, operationIdentifier);
		if (!resolved.ok) {
			return resolved;
		}
		const lookup = await agentSnapshot(options, resolved.agentOperationIdentifier);
		if (!lookup.ok) {
			return lookup;
		}
		const snapshot = lookup.snapshot;
		if (snapshot.kind !== "failed") {
			return { ok: false, message: `the agent's own record names ${snapshot.kind} for ${operationIdentifier}, and the client reported a failure: ${JSON.stringify(snapshot)}` };
		}
		const declared = declaredCategory(snapshot.terminal_failure);
		if (declared === undefined) {
			return { ok: false, message: `the agent's own record names no declared failure for ${operationIdentifier}: ${JSON.stringify(snapshot)}` };
		}
		if (declared !== category) {
			return { ok: false, message: `the client reports ${JSON.stringify(category)} where the agent's own record declares ${JSON.stringify(declared)} for the same operation` };
		}
		return { ok: true, message: `failure category: the agent's declared ${JSON.stringify(category)} surfaced through the client unchanged, and the agent's own record agrees` };
	},
};

// The category the agent itself declared, read from its own record. The
// snapshot carries the terminal failure document the agent committed, whose
// `canonical_failure` is the semantic failure as the agent wrote it and whose
// `failure` member is the category. Reading it here is what makes the
// comparison two-sided rather than an assertion about one side's word.
function declaredCategory(terminalFailure: unknown): string | undefined {
	if (terminalFailure === null || typeof terminalFailure !== "object" || Array.isArray(terminalFailure)) {
		return undefined;
	}
	const canonical = (terminalFailure as Record<string, unknown>)["canonical_failure"];
	if (typeof canonical !== "string") {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(canonical);
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	const named = (parsed as Record<string, unknown>)["failure"];
	return typeof named === "string" ? named : undefined;
}