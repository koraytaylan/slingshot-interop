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

import { agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { verifyCreatedFolderResult } from "./created-folder.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const machine = machineArguments(options, options.scratchHome.profileName);
		const parent = `/content/interop/${options.labelValue}`;
		const folderName = "written";
		const folderPath = `${parent}/${folderName}`;
		const title = `Written by ${options.labelValue}`;

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
		// what the write declared. A submission is answered with its receipt
		// — the client's own contract is that a machine render writes exactly
		// one envelope, and a submission's envelope is the acknowledgement of
		// work taken rather than the work's answer — so the operation is then
		// waited to its terminal disposition, which is where the result
		// arrives.
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
		const submitted = envelope(loaded.stdout, "load_content_as_json");
		if (submitted.ok === false) {
			return submitted;
		}
		if (submitted.outcome !== "operation_receipt") {
			return { ok: false, message: `load_content_as_json answered ${String(submitted.outcome)} instead of its receipt: ${loaded.stdout}` };
		}
		const readOperation = submitted.operation_identifier;
		if (typeof readOperation !== "string" || readOperation.length === 0) {
			return { ok: false, message: `load_content_as_json named no operation: ${loaded.stdout}` };
		}
		const read = await waitTerminal(handle, machine, readOperation, options, waitBudget(options));
		if (!read.ok) {
			return read;
		}
		if (read.envelope.outcome !== "operation_result") {
			return { ok: false, message: `load_content_as_json ended as ${JSON.stringify(read.envelope)} instead of a result` };
		}
		const verified = verifyLoadedFolder(read.envelope.result, folderPath, title);
		if (!verified.ok) return verified;

		// 4. Cross-check the disposition against the agent's own lookup route.
		const resolved = await resolveAgentOperationIdentifier(options, options.scratchHome.profileName, operationIdentifier);
		if (!resolved.ok) return resolved;
		const lookup = await agentSnapshot(options, resolved.agentOperationIdentifier, resolved.targetDigest);
		if (!lookup.ok) return lookup;
		if (lookup.snapshot.kind !== "succeeded") {
			return { ok: false, message: `the agent's own record does not report success for ${operationIdentifier}: ${JSON.stringify(lookup.snapshot)}` };
		}
		const verifiedResult = verifyCreatedFolderResult(ended.envelope.result, lookup.snapshot.terminal_result, folderPath);
		if (!verifiedResult.ok) return verifiedResult;
		return { ok: true, message: "write-then-read: client and retained agent creation results match the requested folder, whose content was read back with the write's declaration equal to the read's answer" };
	},
};

export function verifyLoadedFolder(answer: unknown, folderPath: string, title: string): { readonly ok: boolean; readonly message: string } {
	const result = readMapping(answer, []);
	const document = readMapping(result, ["document"]);
	if (result?.["path"] !== folderPath || result["disposition"] !== "inline" || document?.["path"] !== folderPath) {
		return { ok: false, message: "loaded result and inline document must name the requested folder path" };
	}
	const properties = readMapping(document, ["properties"]);
	if (properties === undefined) return { ok: false, message: "loaded document carried no properties table" };
	if (propertyValue(properties, "jcr:title", "string") !== title
		|| propertyValue(properties, "jcr:primaryType", "name") !== "sling:OrderedFolder") {
		return { ok: false, message: "loaded folder title and primary type must match, including property type and single cardinality" };
	}
	return { ok: true, message: "loaded folder path and typed properties match" };
}

// The observation budget one scenario waits under, read from the values the
// orchestration passes: the harness readiness bound is the one this wait
// inherits, because the command's execution is itself inside that bound.
function waitBudget(options: StartClientRunnerOptions): number {
	return options.values.readiness.harnessSeconds * 1000;
}

function readMapping(value: unknown, path: readonly string[]): Record<string, unknown> | undefined {
	let current: unknown = value;
	for (const member of path) {
		if (current === null || typeof current !== "object" || Array.isArray(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[member];
	}
	return current !== null && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : undefined;
}

// One property's value out of the agent's typed rendering: each entry is
// carries property_type and cardinality alongside its singular value.
function propertyValue(properties: Record<string, unknown>, name: string, propertyType: string): string | undefined {
	const entry = properties[name];
	if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
		return undefined;
	}
	const held = entry as Record<string, unknown>;
	if (held["property_type"] !== propertyType || held["cardinality"] !== "single" || "values" in held) return undefined;
	return typeof held["value"] === "string" ? String(held["value"]) : undefined;
}
