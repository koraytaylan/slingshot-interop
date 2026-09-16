// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { verifyLoadedFolder } from "./write-read.scenario.ts";

const path = "/content/interop/fixture/written";
const title = "Written by fixture";
const properties = {
	"jcr:title": { property_type: "string", cardinality: "single", value: title },
	"jcr:primaryType": { property_type: "name", cardinality: "single", value: "sling:OrderedFolder" },
};
const document = { path, properties, children: [], children_truncated: false };
const valid = { path, disposition: "inline", document };

test.each(["success", "missing-agent-result", "wrong-agent-result", "surplus-agent-result", "surplus-client-result"])(
	"write-read scenario compares the retained creation result: %s", async (mode) => {
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const folderPath = ${JSON.stringify(path)};
		const clientResult = { repository_path: folderPath, ...(mode === "surplus-client-result" ? { extra: true } : {}) };
		const agentResult = { repository_path: mode === "wrong-agent-result" ? "/other" : folderPath,
			...(mode === "surplus-agent-result" ? { extra: true } : {}) };
		const observed = [];
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [],
			invoke: async (_handle, command) => ({ ok: true, exitCode: 0, stderr: "", stdout: JSON.stringify({
				outcome: "operation_receipt", operation_identifier: command.includes("load_content_as_json") ? "read" : "created",
			}) }),
			envelope: stdout => JSON.parse(stdout),
			waitTerminal: async (_handle, _machine, identifier) => ({ ok: true, envelope: {
				outcome: "operation_result", result: identifier === "read" ? ${JSON.stringify(valid)} : clientResult,
			} }),
			resolveAgentOperationIdentifier: async (_options, _profile, identifier) => {
				observed.push(["resolve", identifier]);
				return { ok: true, agentOperationIdentifier: "remote-created", targetDigest: "e".repeat(64) };
			},
			agentSnapshot: async (_options, identifier, target) => {
				observed.push(["snapshot", identifier, target]);
				return { ok: true, snapshot: { kind: "succeeded", ...(mode === "missing-agent-result" ? {} : {
					terminal_result: { canonical_result: JSON.stringify(agentResult) },
				}) } };
			},
		}));
		const { scenario } = await import(${JSON.stringify(new URL("./write-read.scenario.ts", import.meta.url).pathname)});
		const answer = await scenario.run({}, { labelValue: "fixture", scratchHome: { profileName: "fixture" }, values: { readiness: { harnessSeconds: 1 } } });
		console.log(JSON.stringify({ answer, observed }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { answer, observed } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "success");
	expect(observed).toEqual([["resolve", "created"], ["snapshot", "remote-created", "e".repeat(64)]]);
});

test("readback must name the requested path in both envelope and document", () => {
	expect(verifyLoadedFolder(valid, path, title).ok).toBe(true);
	for (const changed of [{ path: "/other" }, { path: undefined }, { disposition: "artifact" },
		{ document: { ...document, path: "/other" } }, { document: { ...document, path: undefined } }]) {
		expect(verifyLoadedFolder({ ...valid, ...changed }, path, title).ok).toBe(false);
	}
});

test("matching text does not excuse the wrong repository type or cardinality", () => {
	for (const changed of [{ property_type: "name" }, { property_type: undefined }, { cardinality: "multiple" },
		{ cardinality: undefined }, { values: [title] }, { value: "other" }]) {
		const altered = { ...valid, document: { ...document, properties: { ...properties, "jcr:title": { ...properties["jcr:title"], ...changed } } } };
		expect(verifyLoadedFolder(altered, path, title).ok).toBe(false);
	}
	for (const changed of [{ property_type: "string" }, { cardinality: "multiple" }, { value: "nt:unstructured" }]) {
		expect(verifyLoadedFolder({ ...valid, document: { ...document, properties: {
			...properties, "jcr:primaryType": { ...properties["jcr:primaryType"], ...changed },
		} } }, path, title).ok).toBe(false);
	}
	for (const value of [null, [], {}, { ...valid, document: [] }, { ...valid, document: { ...document, properties: [] } }]) {
		expect(verifyLoadedFolder(value, path, title).ok).toBe(false);
	}
});
