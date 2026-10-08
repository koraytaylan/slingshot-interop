// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectInventory, workflowResult, fixtureModel, fixtureBundle, manifestFields, loadWorkflowFixture } from "./counting-workflow.ts";
import { fixtureSources, fixtureDependencyPins, fixtureCompilerImage } from "../preparation/workflow-fixture.ts";
import { fixtureJar } from "../sides/jar-test-fixture.ts";
import { sha256 } from "../preparation/source-snapshot.ts";

const payload = "/content/interop/run-example/counting-effects";
const name = "effect-00000000-0000-4000-a000-000000000001";
const effect = { "jcr:primaryType": "nt:unstructured", fixtureModel, payloadPath: payload, startedBy: "admin", startedAt: "2026-09-29T12:00:00Z" };
const result = { instance_identifier: `${payload}/${name}`, model_identifier: fixtureModel, state: "running" };

test("effect inventories are independent, complete and exact", () => {
	expect(effectInventory({ "jcr:primaryType": "nt:unstructured" }, payload)).toEqual([]);
	expect(effectInventory({ "jcr:primaryType": "nt:unstructured", [name]: effect }, payload)).toEqual([`${payload}/${name}`]);
	for (const bad of [null, {}, { "jcr:primaryType": "nt:unstructured", [name]: {} },
		{ "jcr:primaryType": "nt:unstructured", [name]: { ...effect, payloadPath: "/other" } },
		{ "jcr:primaryType": "nt:unstructured", [name]: { ...effect, startedBy: "other" } },
		{ "jcr:primaryType": "nt:unstructured", [name]: { ...effect, child: {} } },
		{ "jcr:primaryType": "nt:unstructured", unexpected: effect }]) expect(() => effectInventory(bad, payload)).toThrow();
});

test("workflow results identify the exact model, state and one effect below the payload", () => {
	expect(workflowResult(result, payload)).toBe(`${payload}/${name}`);
	for (const bad of [{}, { ...result, extra: 1 }, { ...result, state: "completed" }, { ...result, model_identifier: "other" },
		{ ...result, instance_identifier: `${payload}/${name}/child` }, { ...result, instance_identifier: `${payload}-other/${name}` }]) expect(() => workflowResult(bad, payload)).toThrow();
});

test("manifest folds line continuations but refuses duplicate fields", () => {
	expect(manifestFields("Name: abc\r\n def\r\n").get("name")).toBe("abcdef");
	expect(() => manifestFields("Name: one\nname: two\n")).toThrow();
	expect(() => manifestFields("broken\n")).toThrow();
});

test("fixture loading binds artifact, source, agent and reviewed compiler/API inputs", async () => {
	const directory = await mkdtemp(join(tmpdir(), "workflow-fixture-load-"));
	try {
		const source = await fixtureSources();
		const agentDigest = "a".repeat(64);
		const manifest = `Manifest-Version: 1.0\nBundle-SymbolicName: ${fixtureBundle}\nBundle-Activator: rs.slingshot.interop.fixture.CountingWorkflow\nSling-Nodetypes: SLING-INF/interop-pages.cnd;reregister:=false\nSlingshot-Agent-SHA256: ${agentDigest}\nSlingshot-Fixture-Source-SHA256: ${source.digest}\n`;
		const bytes = fixtureJar([{ name: "META-INF/MANIFEST.MF", value: manifest, deflated: true }, { name: "SLING-INF/interop-pages.cnd", value: source.nodetypes.toString("utf8"), deflated: true }]);
		const path = join(directory, "fixture.jar");
		const receiptPath = join(directory, "receipt.json");
		const receipt = { format: "slingshot.workflow-fixture/1", path, digest: sha256(bytes), sourceDigest: source.digest, agentDigest,
			compilerImage: await fixtureCompilerImage(), dependencies: await fixtureDependencyPins() };
		await writeFile(path, bytes);
		await writeFile(receiptPath, JSON.stringify(receipt));
		expect((await loadWorkflowFixture(receiptPath, agentDigest)).bytes).toEqual(bytes);
		for (const mutation of [{ ...receipt, digest: "b".repeat(64) }, { ...receipt, sourceDigest: "b".repeat(64) },
			{ ...receipt, agentDigest: "b".repeat(64) }, { ...receipt, compilerImage: "changed" }, { ...receipt, dependencies: [] }]) {
			await writeFile(receiptPath, JSON.stringify(mutation));
			await expect(loadWorkflowFixture(receiptPath, agentDigest)).rejects.toThrow();
		}
		for (const entries of [
			[{ name: "META-INF/MANIFEST.MF", value: manifest, deflated: true }],
			[{ name: "META-INF/MANIFEST.MF", value: manifest, deflated: true }, { name: "SLING-INF/interop-pages.cnd", value: "changed", deflated: true }],
			[{ name: "META-INF/MANIFEST.MF", value: manifest.replace(";reregister:=false", ""), deflated: true }, { name: "SLING-INF/interop-pages.cnd", value: source.nodetypes.toString("utf8"), deflated: true }],
		]) {
			const changed = fixtureJar(entries);
			await writeFile(path, changed);
			await writeFile(receiptPath, JSON.stringify({ ...receipt, digest: sha256(changed) }));
			await expect(loadWorkflowFixture(receiptPath, agentDigest)).rejects.toThrow();
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});
