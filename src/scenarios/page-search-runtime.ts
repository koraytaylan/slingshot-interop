// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { runCleanup } from "../run/cleanup.ts";
import { loadWorkflowFixture } from "./counting-workflow.ts";
import { WorkflowFixtureRuntime } from "./workflow-fixture-runtime.ts";
import { structuredResult } from "./structured-result.ts";
import { envelope, invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import { enumerationBudgetMilliseconds, groupCount, requestedMatches } from "./incremental-discovery.ts";
import { PageSearchEnumeration, groupForm, imageType, phrase, plantedNodes, requireReviewedPageSearch, textType, verifyGroupReadback, wireName, type Search } from "./page-search.ts";

async function enumerate(handle: ContainerHandle, options: StartClientRunnerOptions, root: string, search: Search) {
	const machine = machineArguments(options, options.scratchHome.profileName);
	const held = new PageSearchEnumeration(root, search);
	const beginning = performance.now();
	let firstUseful: number | undefined;
	let token: string | undefined;
	let replayChecked = false;
	const argumentsFor = (continuation: string | undefined) => {
		const filters = search === "phrase" || search === "absent_phrase"
			? ["--phrase", search === "phrase" ? phrase : "synthetic-absent-page-needle"]
			: ["--resource-types", search === "absent_component" ? "interop/absent-page-component" : `${textType},${imageType}`, ...(search === "all" ? ["--match-all"] : [])];
		return [runner(), ...machine, wireName(search), "--path", root, ...filters,
			...(continuation === undefined ? ["--offset", "0", "--limit", String(requestedMatches)] : ["--continuation-token", continuation])];
	};
	const readPage = async (continuation: string | undefined) => {
		const submitted = await invoke(handle, argumentsFor(continuation), options);
		if (!submitted.ok) throw new Error(submitted.message);
		if (submitted.exitCode !== 0) throw new Error(`page-search submission exited ${submitted.exitCode}`);
		const receipt = envelope(submitted.stdout, "page search");
		if (!receipt.ok) throw new Error(receipt.message);
		if (receipt.outcome !== "operation_result" && receipt.outcome !== "structured_result_artifact_access" && (receipt.outcome !== "operation_receipt" || typeof receipt.operation_identifier !== "string")) throw new Error("page search did not produce a receipt or result");
		const terminal = receipt.outcome === "operation_result" || receipt.outcome === "structured_result_artifact_access"
			? { ok: true as const, envelope: receipt }
			: await waitTerminal(handle, machine, receipt.operation_identifier!, options, options.values.readiness.harnessSeconds * 1000);
		if (!terminal.ok) throw new Error(terminal.message);
		const result = await structuredResult(handle, machine, terminal.envelope, options);
		if (result.outcome !== "operation_result") throw new Error("page search ended without a structured result");
		return result.result;
	};
	do {
		if (performance.now() - beginning >= enumerationBudgetMilliseconds) throw new Error("page search exceeded its monotonic scenario deadline");
		options.progress?.(`reading ${search} page ${held.pages.length + 1}; ${held.seen.size} unique page matches`);
		const requested = token;
		const result = await readPage(requested);
		token = held.accept(result);
		if (held.seen.size > 0 && firstUseful === undefined) firstUseful = performance.now() - beginning;
		if (!replayChecked && requested !== undefined) {
			if (JSON.stringify(await readPage(requested)) !== JSON.stringify(result)) throw new Error("latest page-search continuation did not replay the exact response");
			replayChecked = true;
		}
	} while (!held.complete);
	if (held.pages.length <= 1 || !replayChecked) throw new Error("large page corpus did not exercise continuation and replay");
	return { search, command: wireName(search), unique_matches: held.seen.size, examined_nodes: held.examined,
		pages: held.pages, replay_verified: replayChecked, enumeration_milliseconds: performance.now() - beginning,
		...(firstUseful === undefined ? {} : { first_useful_milliseconds: firstUseful }) };
}

export async function runPageSearch(handle: ContainerHandle, options: StartClientRunnerOptions, family: "phrase" | "components") {
	const runtime = new WorkflowFixtureRuntime(options);
	const root = `/content/interop-page-search-${family}/${options.labelValue}`;
	let ownsFixture = false;
	let ownsRoot = false;
	let outcome: { ok: boolean; message: string; evidence?: Record<string, unknown> };
	try {
		if (options.workflowFixtureReceipt === undefined || options.agentBundleDigest === undefined) throw new Error("prepare the synthetic public fixture for the selected agent");
		if (await runtime.bundle() !== undefined) throw new Error("another scenario left the synthetic fixture installed");
		const fixture = await loadWorkflowFixture(options.workflowFixtureReceipt, options.agentBundleDigest);
		ownsFixture = true;
		await runtime.install(fixture.bytes);
		const searches: Search[] = family === "phrase" ? ["phrase", "absent_phrase"] : ["any", "all", "absent_component"];
		const capabilities = await runtime.read("/bin/slingshot/agent/capabilities");
		for (const search of searches) requireReviewedPageSearch(capabilities, search);
		ownsRoot = true;
		await runtime.post(root, new URLSearchParams({ "jcr:primaryType": "sling:OrderedFolder" }));
		const plantingStarted = performance.now();
		for (let index = 0; index < groupCount; index++) {
			options.progress?.(`planting ${family} group ${index + 1}/${groupCount}`);
			const path = `${root}/group-${index}`;
			await runtime.post(path, groupForm(index));
			verifyGroupReadback(await runtime.read(`${path}.1.json`), await runtime.read(`${path}/node-0.2.json`), index);
		}
		const plantingMilliseconds = performance.now() - plantingStarted;
		const machine = machineArguments(options, options.scratchHome.profileName);
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok || started.exitCode !== 0) throw new Error("page-search daemon did not start");
		const enumerations = [];
		for (const search of searches) enumerations.push(await enumerate(handle, options, root, search));
		outcome = { ok: true, message: `Page-search ${family} enumerated exact synthetic page oracles across ${plantedNodes} verified nodes with bounded continuation and replay.`,
			evidence: { planted_nodes: plantedNodes, planting_milliseconds: plantingMilliseconds, enumerations, fixture: fixture.evidence, scope: "Public Sling with minimal synthetic page types; platform page APIs are not exercised." } };
	} catch (failure) {
		outcome = { ok: false, message: failure instanceof Error ? failure.message : "page-search scenario failed" };
	}
	const cleanup = await runCleanup([
		...(ownsRoot ? [{ name: "page corpus removal", run: () => runtime.post(root, new URLSearchParams({ ":operation": "delete" })) }] : []),
		...(ownsFixture ? [{ name: "synthetic fixture removal", run: () => runtime.remove() }] : []),
	]);
	return cleanup.length === 0 ? { ...outcome, evidence: { ...outcome.evidence, fixture_cleanup: "passed" } }
		: { ok: false, message: `${outcome.message}; cleanup: ${cleanup.join("; ")}`, evidence: { ...outcome.evidence, fixture_cleanup: cleanup } };
}
