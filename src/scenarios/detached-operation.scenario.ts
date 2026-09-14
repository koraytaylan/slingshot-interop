// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The detached-operation scenario: a submission carrying --detach is
// acknowledged before the work is done, the client then observes the
// operation to its terminal disposition, and the agent's own record agrees
// with what the client reports. The two disagreeing is the failure this
// scenario exists to catch.

import { agentAuthorization, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const machine = machineArguments(options, options.scratchHome.profileName);
		const parent = `/content/interop/${options.labelValue}`;
		const folderName = "detached";
		const folderPath = `${parent}/${folderName}`;
		const title = `Detached by ${options.labelValue}`;

		// 0. The daemon: the submission is the daemon's remote exchange. An
		// explicit start converges regardless of which scenario ran first.
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		// 1. Submit a detached write: the acknowledgement is the receipt for
		// work accepted but not finished.
		const submitted = await invoke(handle, [
			runner(), ...machine, "create_asset_folder",
			"--operation-key", `${options.labelValue}-detached`,
			"--detach",
			"--path", parent,
			"--name", folderName,
			"--title", title,
		], options);
		if (!submitted.ok) {
			return { ok: false, message: `the detached submission could not run: ${submitted.message}` };
		}
		if (submitted.exitCode !== 0) {
			return { ok: false, message: `the detached submission exited ${submitted.exitCode}: ${submitted.stderr}` };
		}
		const receipt = envelope(submitted.stdout, "create_asset_folder --detach");
		if (receipt.ok === false) {
			return receipt;
		}
		if (receipt.outcome !== "operation_receipt") {
			return { ok: false, message: `the detached submission answered ${String(receipt.outcome)} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = receipt.operation_identifier;
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the detached submission named no operation: ${submitted.stdout}` };
		}

		// 2. Wait on the operation through the client to its terminal
		// disposition.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!ended.ok) {
			return ended;
		}

		// 3. Cross-check with the harness's authenticated read of the agent's
		// own lookup route: same operation, terminal, and the state the
		// client's terminal answer agrees with. The route's query member is
		// the agent-side identifier the client derived at submission, not
		// the receipt's local one.
		const resolved = await resolveAgentOperationIdentifier(options, options.scratchHome.profileName, operationIdentifier);
		if (!resolved.ok) {
			return resolved;
		}
		const lookup = await fetch(
			`http://127.0.0.1:${options.values.ports.author}/bin/slingshot/agent/snapshot?agent_operation_identifier=${encodeURIComponent(resolved.agentOperationIdentifier)}`,
			{ headers: { authorization: agentAuthorization("admin", "admin") }, signal: AbortSignal.timeout(10_000) },
		);
		if (!lookup.ok) {
			return { ok: false, message: `the agent's lookup route answered ${lookup.status} for ${operationIdentifier}` };
		}
		const snapshot = await lookup.json() as Record<string, unknown>;
		const clientKind = ended.envelope.outcome === "operation_result" ? "succeeded" : "failed";
		if (snapshot.kind !== clientKind) {
			return {
				ok: false,
				message: `disposition mismatch: the client says ${String(ended.envelope.outcome)}, the agent's own record says ${String(snapshot.kind)} for ${operationIdentifier}`,
			};
		}
		// The write's effect is there, under the address the command computed.
		const content = await fetch(`http://127.0.0.1:${options.values.ports.author}${folderPath}`, {
			headers: { authorization: agentAuthorization("admin", "admin") },
			signal: AbortSignal.timeout(10_000),
		});
		if (!content.ok) {
			return { ok: false, message: `the created folder does not answer on the agent: ${content.status} ${content.statusText}` };
		}
		return { ok: true, message: "detached operation: acknowledged before completion, reached terminal, the agent's record agrees" };
	},
};

function join3(...parts: readonly string[]): string {
	return parts.join("/");
}