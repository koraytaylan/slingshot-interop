// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The detached-operation scenario: a submission carrying --detach is
// acknowledged with a receipt, the client then observes the
// operation to its terminal disposition, and the agent's own record agrees
// with what the client reports. The two disagreeing is the failure this
// scenario exists to catch.

import { agentAuthorization, agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { verifyCreatedFolder, verifyCreatedFolderResult } from "./created-folder.ts";

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

		// 1. Submit a detached write and require its receipt. Completion may
		// race observation; this scenario does not measure that ordering.
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
		if ((receipt as Record<string, unknown>)['outcome'] !== "operation_receipt") {
			return { ok: false, message: `the detached submission answered ${String((receipt as Record<string, unknown>)['outcome'])} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = (receipt as Record<string, unknown>)['operation_identifier'];
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the detached submission named no operation: ${submitted.stdout}` };
		}

		// 2. Wait on the operation through the client to its terminal
		// disposition.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!ended.ok) {
			return ended;
		}
		if (ended.envelope.outcome !== "operation_result" || ended.envelope.result?.["repository_path"] !== folderPath) {
			return { ok: false, message: `the detached operation did not return the expected successful folder result: ${JSON.stringify(ended.envelope)}` };
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
		const lookup = await agentSnapshot(options, resolved.agentOperationIdentifier, resolved.targetDigest);
		if (!lookup.ok) return lookup;
		const snapshot = lookup.snapshot;
		if (snapshot.kind !== "succeeded") {
			return {
				ok: false,
				message: `disposition mismatch: the client says ${(ended.envelope as Record<string, unknown>)['outcome']}, the agent's own record says ${(snapshot as Record<string, unknown>)['kind']} for ${operationIdentifier}`,
			};
		}
		const verifiedResult = verifyCreatedFolderResult(ended.envelope.result, snapshot.terminal_result, folderPath);
		if (!verifiedResult.ok) return verifiedResult;
		// The write's effect is there, under the address the command computed.
		// The rendering is asked for by name: a bare request for a folder is
		// the platform's own 403 — it has no default renderer for a node that
		// is not a page — and what proves the write is the document the
		// platform renders for it.
		const content = await fetch(`http://127.0.0.1:${options.values.ports.author}${folderPath}.json`, {
			redirect: "error",
			headers: { authorization: agentAuthorization("admin", "admin") },
			signal: AbortSignal.timeout(10_000),
		});
		const verifiedContent = await verifyCreatedFolder(content, title, options.values.capture.maximumBytes);
		if (!verifiedContent.ok) return verifiedContent;
		return { ok: true, message: "detached operation: receipt observed, client and retained agent results match the requested folder, agent reports success and folder properties match" };
	},
};
