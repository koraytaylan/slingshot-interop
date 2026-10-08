// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { structuredResult } from "./structured-result.ts";
import { readBoundedJson } from "../harness/bounded-json.ts";
import { refuseHttpResponse } from "../harness/http-refusal.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { authorHostPort } from "../sides/author-host-port.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { agentAuthorization, envelope, invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import { type DiscoveryCommand, DiscoveryEnumeration, enumerationBudgetMilliseconds, groupCount, groupForm, groupName, plantedNodes, requestedMatches, requireReviewedDiscoveryBudget, verifyGroup } from "./incremental-discovery.ts";

async function read(base: string, path: string, options: StartClientRunnerOptions): Promise<unknown> {
	const response = await fetch(`${base}${path}`, { headers: { authorization: agentAuthorization("admin", "admin") }, redirect: "error", signal: AbortSignal.timeout(30_000) });
	const captured = await readBoundedJson(response, options.values.capture.maximumBytes);
	if (!captured.ok) throw new Error(captured.message);
	return captured.value;
}

async function enumerate(handle: ContainerHandle, options: StartClientRunnerOptions, root: string, command: DiscoveryCommand) {
	const machine = machineArguments(options, options.scratchHome.profileName);
	const observed = new DiscoveryEnumeration(root, command);
	const beginning = performance.now();
	let firstUsefulMilliseconds: number | undefined;
	let token: string | undefined;
	do {
		if (performance.now() - beginning >= enumerationBudgetMilliseconds) throw new Error("discovery exceeded its monotonic scenario deadline");
		options.progress?.(`reading ${command} page ${observed.pages.length + 1}; ${observed.examined}/${plantedNodes} nodes examined`);
		const window = token === undefined ? ["--offset", "0", "--limit", String(requestedMatches)] : ["--continuation-token", token];
		const predicates = command === "query_paths" ? ["--property-predicate", '{"operator":"exists","property_path":"sling:resourceType"}'] : [];
		const submitted = await invoke(handle, [runner(), ...machine, command, "--path", root, ...predicates, ...window], options);
		if (!submitted.ok) throw new Error(submitted.message);
		if (submitted.exitCode !== 0) throw new Error(`discovery submission exited ${submitted.exitCode}: ${submitted.stdout}`);
		const receipt = envelope(submitted.stdout, "incremental discovery");
		if (!receipt.ok) throw new Error(receipt.message);
		if (receipt.outcome !== "operation_result" && receipt.outcome !== "structured_result_artifact_access" && (receipt.outcome !== "operation_receipt" || typeof receipt.operation_identifier !== "string")) throw new Error(`discovery submission failed: ${submitted.stdout}`);
		const terminal = receipt.outcome === "operation_result" || receipt.outcome === "structured_result_artifact_access" ? { ok: true as const, envelope: receipt } : await waitTerminal(handle, machine, receipt.operation_identifier!, options, options.values.readiness.harnessSeconds * 1000);
		if (!terminal.ok) throw new Error(terminal.message);
		const document = await structuredResult(handle, machine, terminal.envelope, options);
		if (document.outcome !== "operation_result") throw new Error(`discovery page ended as ${String(terminal.envelope.outcome)}`);
		token = observed.accept(document.result);
		if (observed.seen.size > 0 && firstUsefulMilliseconds === undefined) firstUsefulMilliseconds = performance.now() - beginning;
	} while (!observed.complete);
	return { command, examined_nodes: observed.examined, unique_matches: observed.seen.size, pages: observed.pages, first_useful_milliseconds: firstUsefulMilliseconds!, enumeration_milliseconds: performance.now() - beginning };
}

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		try {
			const base = `http://127.0.0.1:${authorHostPort(options)}`;
			const capabilities = await read(base, "/bin/slingshot/agent/capabilities", options);
			for (const command of ["list_components", "query_paths"] as const) requireReviewedDiscoveryBudget(capabilities, command);
			const root = `/content/interop-discovery/${options.labelValue}`;
			const plantingStarted = performance.now();
			for (let index = 0; index < groupCount; index++) {
				options.progress?.(`planting discovery group ${index + 1}/${groupCount}`);
				const path = `${root}/${groupName(index)}`;
				const response = await fetch(`${base}${path}`, { method: "POST", headers: { authorization: agentAuthorization("admin", "admin") }, body: groupForm(), redirect: "error", signal: AbortSignal.timeout(30_000) });
				if (![200, 201].includes(response.status) || response.redirected) return refuseHttpResponse(response, "planting discovery group failed");
				await response.body?.cancel();
				verifyGroup(await read(base, `${path}.1.json`, options));
			}
			const plantMilliseconds = performance.now() - plantingStarted;
			const machine = machineArguments(options, options.scratchHome.profileName);
			const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
			if (!started.ok) return started;
			if (started.exitCode !== 0) throw new Error("discovery daemon did not start");
			const enumerations = [];
			for (const command of ["list_components", "query_paths"] as const) enumerations.push(await enumerate(handle, options, root, command));
			return {
				ok: true,
				message: `Both commands enumerated ${groupCount} exact paths across ${plantedNodes} independently verified nodes in bounded pages.`,
				evidence: { planted_nodes: plantedNodes, planting_milliseconds: plantMilliseconds, enumerations },
			};
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : "incremental discovery scenario failed" };
		}
	},
};
