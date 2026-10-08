// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { runCleanup } from "../run/cleanup.ts";
import { mapping } from "./discovery-lifecycle.ts";
import { loadWorkflowFixture } from "./counting-workflow.ts";
import { WorkflowFixtureRuntime } from "./workflow-fixture-runtime.ts";
import { structuredResult } from "./structured-result.ts";
import { agentAuthorization, envelope, invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import { discoveryLimitsDigest, enumerationBudgetMilliseconds, groupCount, requestedMatches } from "./incremental-discovery.ts";
import { AssetEnumeration, assetPath, firstTag, groupForm, mediaFormat, originalBytes, secondTag, storedNodes, traversalNodes, verifyGroup, verifyMetadata, verifyOriginal, type Search } from "./asset-discovery.ts";

async function enumerate(handle: ContainerHandle, options: StartClientRunnerOptions, root: string, search: Search) {
	const machine = machineArguments(options, options.scratchHome.profileName);
	const held = new AssetEnumeration(root, search);
	const beginning = performance.now();
	let firstUseful: number | undefined;
	let token: string | undefined;
	let replayChecked = false;
	const readPage = async (continuation: string | undefined) => {
		const filters = search === "size" ? ["--minimum-bytes", String(originalBytes.length), "--maximum-bytes", String(originalBytes.length)]
			: search === "tags" ? ["--tags", `${firstTag},${secondTag}`, "--match-all"]
			: search === "absent" ? ["--media-formats", "application/x-synthetic-absent"] : [];
		const window = continuation === undefined ? ["--offset", "0", "--limit", String(requestedMatches)] : ["--continuation-token", continuation];
		const submitted = await invoke(handle, [runner(), ...machine, "find_assets_by_metadata", "--path", root, ...filters, ...window], options);
		if (!submitted.ok) throw new Error(submitted.message);
		if (submitted.exitCode !== 0) throw new Error(`asset search submission exited ${submitted.exitCode}`);
		const receipt = envelope(submitted.stdout, "asset search");
		if (!receipt.ok) throw new Error(receipt.message);
		if (receipt.outcome !== "operation_result" && receipt.outcome !== "structured_result_artifact_access" && (receipt.outcome !== "operation_receipt" || typeof receipt.operation_identifier !== "string")) throw new Error("asset search did not produce a receipt or result");
		const terminal = receipt.outcome === "operation_result" || receipt.outcome === "structured_result_artifact_access" ? { ok: true as const, envelope: receipt }
			: await waitTerminal(handle, machine, receipt.operation_identifier!, options, options.values.readiness.harnessSeconds * 1000);
		if (!terminal.ok) throw new Error(terminal.message);
		const result = await structuredResult(handle, machine, terminal.envelope, options);
		if (result.outcome !== "operation_result") throw new Error("asset search ended without a structured result");
		return result.result;
	};
	do {
		if (performance.now() - beginning >= enumerationBudgetMilliseconds) throw new Error("asset search exceeded its monotonic scenario deadline");
		options.progress?.(`reading ${search} asset page ${held.pages.length + 1}; ${held.seen.size} unique matches`);
		const requested = token;
		const result = await readPage(requested);
		token = held.accept(result);
		if (held.seen.size > 0 && firstUseful === undefined) firstUseful = performance.now() - beginning;
		if (!replayChecked && requested !== undefined) {
			if (JSON.stringify(await readPage(requested)) !== JSON.stringify(result)) throw new Error("latest asset continuation did not replay its exact response");
			replayChecked = true;
		}
	} while (!held.complete);
	if (held.pages.length <= 1 || !replayChecked) throw new Error("large asset corpus did not exercise continuation and replay");
	return { search, unique_matches: held.seen.size, examined_nodes: held.examined, pages: held.pages,
		replay_verified: replayChecked, enumeration_milliseconds: performance.now() - beginning,
		...(firstUseful === undefined ? {} : { first_useful_milliseconds: firstUseful }) };
}

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const runtime = new WorkflowFixtureRuntime(options);
		const root = `/content/interop-asset-discovery/${options.labelValue}`;
		let ownsFixture = false;
		let ownsRoot = false;
		let outcome: { ok: boolean; message: string; evidence?: Record<string, unknown> };
		try {
			if (options.workflowFixtureReceipt === undefined || options.agentBundleDigest === undefined) throw new Error("prepare the synthetic fixture for the selected agent");
			if (await runtime.bundle() !== undefined) throw new Error("another scenario left the synthetic fixture installed");
			const fixture = await loadWorkflowFixture(options.workflowFixtureReceipt, options.agentBundleDigest);
			ownsFixture = true;
			await runtime.install(fixture.bytes);
			const contracts = mapping(await runtime.read("/bin/slingshot/agent/capabilities"))["command_contracts"];
			if (!Array.isArray(contracts)) throw new Error("asset capabilities have no command identities");
			const identity = contracts.map(mapping).filter(row => row["command_wire_name"] === "find_assets_by_metadata");
			if (identity.length !== 1 || identity[0]!["command_semantic_contract_version"] !== "0.0.0"
				|| identity[0]!["command_contract_limits_digest"] !== discoveryLimitsDigest) throw new Error("asset fixture has not been reviewed for this identity");
			ownsRoot = true;
			await runtime.post(root, new URLSearchParams({ "jcr:primaryType": "sling:OrderedFolder" }));
			const plantingStarted = performance.now();
			for (let index = 0; index < groupCount; index++) {
				options.progress?.(`planting asset group ${index + 1}/${groupCount}`);
				await runtime.post(`${root}/group-${index}`, groupForm(index));
				const path = assetPath(root, index);
				const upload = new FormData();
				upload.set("original@TypeHint", "nt:file");
				upload.set("original", new Blob([originalBytes], { type: mediaFormat }), "original");
				await runtime.post(`${path}/jcr:content/renditions`, upload);
				verifyGroup(await runtime.read(`${root}/group-${index}.1.json`));
				verifyMetadata(await runtime.read(`${path}/jcr:content.3.json`), index);
				const binary = await fetch(`${runtime.base}${path}/jcr:content/renditions/original`, { headers: { authorization: agentAuthorization("admin", "admin") }, redirect: "error", signal: AbortSignal.timeout(10_000) });
                await verifyOriginal(binary);
			}
			const plantingMilliseconds = performance.now() - plantingStarted;
			const machine = machineArguments(options, options.scratchHome.profileName);
			const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
			if (!started.ok || started.exitCode !== 0) throw new Error("asset-search daemon did not start");
			const enumerations = [];
			for (const search of ["all", "size", "tags", "absent"] as const) enumerations.push(await enumerate(handle, options, root, search));
			outcome = { ok: true, message: "Asset search exhausted four independent large-tree oracles with bounded continuation and exact metadata.",
				evidence: { stored_nodes: storedNodes, traversal_nodes: traversalNodes, original_binary_readbacks: groupCount,
					planting_milliseconds: plantingMilliseconds, enumerations, fixture: fixture.evidence,
					scope: "Public Sling with a minimal synthetic asset type; asset platform APIs are not exercised." } };
		} catch (failure) {
			outcome = { ok: false, message: failure instanceof Error ? failure.message : "asset scenario failed" };
		}
		const cleanup = await runCleanup([
			...(ownsRoot ? [{ name: "asset corpus removal", run: () => runtime.post(root, new URLSearchParams({ ":operation": "delete" })) }] : []),
			...(ownsFixture ? [{ name: "synthetic fixture removal", run: () => runtime.remove() }] : []),
		]);
		return cleanup.length === 0 ? { ...outcome, evidence: { ...outcome.evidence, fixture_cleanup: "passed" } }
			: { ok: false, message: `${outcome.message}; cleanup: ${cleanup.join("; ")}`, evidence: { ...outcome.evidence, fixture_cleanup: cleanup } };
	},
};
