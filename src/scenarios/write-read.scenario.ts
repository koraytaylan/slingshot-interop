// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The write-then-read scenario: one asset folder created through the
// client's own command surface, waited to its terminal disposition, then
// the same path loaded back as content with the write's declaration
// asserted equal to the read's answer. Every mismatch fails rather than
// skips. The command is the agent's asset-folder creation, whose write is
// a sling:OrderedFolder node — a type the plain-Sling runtime itself
// registers, so what this scenario proves is the real round trip, not a
// planting.

import { agentAuthorization, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const machine = machineArguments(options, options.scratchHome.profileName);
		const parent = `/content/interop/${options.labelValue}`;
		const folderName = "written";
		const folderPath = `${parent}/${folderName}`;
		const title = `Written by ${options.labelValue}`;
		const textProperty = `Text declared by ${options.labelValue}`;

		// 0. The daemon: the write is the daemon's remote exchange. An
		// explicit start converges regardless of which scenario ran first.
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		// 1. Create the folder.
		const created = await invoke(handle, [
			runner(), ...machine, "create_asset_folder",
			"--operation-key", `${options.labelValue}-write-read`,
			"--path", parent,
			"--name", folderName,
			"--title", title,
		], options);
		if (!created.ok) {
			return { ok: false, message: `create_asset_folder could not run: ${created.message}` };
		}
		if (created.exitCode !== 0) {
			return { ok: false, message: `create_asset_folder exited ${created.exitCode}: ${created.stderr}` };
		}
		const receipt = envelope(created.stdout, "create_asset_folder");
		if (receipt.ok === false) {
			return receipt;
		}
		if (receipt.outcome !== "operation_receipt") {
			return { ok: false, message: `create_asset_folder answered ${String(receipt.outcome)} instead of a receipt: ${created.stdout}` };
		}
		const operationIdentifier = receipt.operation_identifier;
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `create_asset_folder named no operation: ${created.stdout}` };
		}

		// 2. Wait on the operation to its terminal disposition, and assert
		// the answer names the folder the command declared.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, waitBudget(options));
		if (!ended.ok) {
			return ended;
		}
		if (ended.envelope.outcome !== "operation_result") {
			return { ok: false, message: `create_asset_folder ended as ${JSON.stringify(ended.envelope)} instead of a result` };
		}
		const result = ended.envelope.result as Record<string, unknown> | undefined;
		const writtenPath = typeof result?.["repository_path"] === "string" ? String(result["repository_path"]) : undefined;
		if (writtenPath !== folderPath) {
			return { ok: false, message: `the create answered ${JSON.stringify(result)} where the command's target is ${folderPath}` };
		}

		// 3. Load the same path back and assert the read's answer carries
		// what the write declared.
		const loaded = await invoke(handle, [
			runner(), ...machine, "load_content_as_json",
			"--operation-key", `${options.labelValue}-write-read-read`,
			"--path", folderPath,
			"--depth", "0",
		], options);
		if (!loaded.ok) {
			return { ok: false, message: `load_content_as_json could not run: ${loaded.message}` };
		}
		if (loaded.exitCode !== 0) {
			return { ok: false, message: `load_content_as_json exited ${loaded.exitCode}: ${loaded.stderr}` };
		}
		const answer = envelope(loaded.stdout, "load_content_as_json");
		if (answer.ok === false) {
			return answer;
		}
		if (answer.outcome !== "operation_result") {
			return { ok: false, message: `load_content_as_json answered ${String(answer.outcome)} instead of a result: ${loaded.stdout}` };
		}
		const read = answer.result as Record<string, unknown> | undefined;
		// The read's answer carries the loaded node itself, and the document
		// below it is the agent's own rendering: one properties table keyed
		// by name, with every value typed. The write's declaration must be
		// equal in the read's answer.
		const document = readMapping(read, ["document"]);
		const properties = readMapping(document, ["properties"]);
		if (properties === undefined) {
			return { ok: false, message: `load_content_as_json carried no properties table: ${loaded.stdout}` };
		}
		const readTitle = propertyValue(properties, "jcr:title");
		if (readTitle !== title) {
			return { ok: false, message: `the loaded document names the folder's title ${JSON.stringify(readTitle)} where the write declared ${JSON.stringify(title)}: ${JSON.stringify(properties).slice(0, 2000)}` };
		}
		const readType = propertyValue(properties, "jcr:primaryType");
		if (readType !== "sling:OrderedFolder") {
			return { ok: false, message: `the loaded document names the folder's type ${JSON.stringify(readType)} where the command's write is a sling:OrderedFolder: ${JSON.stringify(properties).slice(0, 2000)}` };
		}

		// 4. Cross-check the disposition against the agent's own lookup route.
		// The route's query member names the agent-side operation
		// identifier, which the client derived at submission and recorded
		// in its own state; the receipt's identifier is the local one.
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
		if (snapshot.kind !== "succeeded") {
			return { ok: false, message: `the agent's own record names ${String(snapshot.kind)} for ${operationIdentifier}, and the client reported success: ${JSON.stringify(snapshot)}` };
		}
		return { ok: true, message: "write-then-read: the created asset folder was read back with the write's declaration equal to the read's answer" };
	},
};

// The observation budget one scenario waits under, read from the values the
// orchestration passes: the harness readiness bound is the one this wait
// inherits, because the command's execution is itself inside that bound.
function waitBudget(options: StartClientRunnerOptions): number {
	return options.values.readiness.harnessSeconds * 1000;
}

function readMapping(value: unknown, path: readonly string[]): Record<string, unknown> | undefined {
	let current: unknown = value;
	for (const member of path) {
		if (current === null || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[member];
	}
	return current !== null && typeof current === "object" ? current as Record<string, unknown> : undefined;
}

// One property's value out of the agent's typed rendering: each entry is
// `{ type, value }` (or `{ type, values }` for the plural form), and the
// scenario reads the value a write declared.
function propertyValue(properties: Record<string, unknown>, name: string): string | undefined {
	const entry = properties[name];
	if (entry === null || typeof entry !== "object") {
		return undefined;
	}
	const held = entry as Record<string, unknown>;
	return typeof held["value"] === "string" ? String(held["value"]) : undefined;
}