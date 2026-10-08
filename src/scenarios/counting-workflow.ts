// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { isAbsolute } from "node:path";
import { JarResources } from "../sides/jar-resources.ts";
import { readBoundedFile } from "../harness/bounded-file.ts";
import { parseUniqueJson } from "../harness/bounded-json.ts";
import { fixtureSources, fixtureDependencies, fixtureDependencyPins, fixtureCompilerImage } from "../preparation/workflow-fixture.ts";

export const fixtureModel = "interop-non-idempotent-v1";
export const fixtureBundle = "rs.slingshot.interop.counting-workflow";
const maximumBytes = 1024 * 1024;
const effectName = /^effect-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
	return value as Record<string, unknown>;
}

export function manifestFields(value: string): Map<string, string> {
	const fields = new Map<string, string>();
	for (const line of value.replace(/\r\n/g, "\n").replace(/\n /g, "").trimEnd().split("\n")) {
		const separator = line.indexOf(": ");
		if (separator < 1) throw new Error("invalid fixture manifest field");
		const name = line.slice(0, separator).toLowerCase();
		if (fields.has(name)) throw new Error("duplicate fixture manifest field");
		fields.set(name, line.slice(separator + 2));
	}
	return fields;
}

export async function loadWorkflowFixture(receiptPath: string, agentDigest: string): Promise<{ bytes: Buffer; evidence: Record<string, unknown> }> {
	const receipt = object(parseUniqueJson((await readBoundedFile(receiptPath, maximumBytes)).toString("utf8")));
	const sources = await fixtureSources();
	const { path, digest, sourceDigest } = receipt;
	if (receipt["format"] !== "slingshot.workflow-fixture/1" || receipt["agentDigest"] !== agentDigest
		|| typeof path !== "string" || !isAbsolute(path) || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)
		|| sourceDigest !== sources.digest) throw new Error("fixture receipt is stale or does not name the selected agent");
	if (receipt["compilerImage"] !== await fixtureCompilerImage()
		|| JSON.stringify(fixtureDependencies({ dependency: receipt["dependencies"] })) !== JSON.stringify(await fixtureDependencyPins())) throw new Error("fixture compiler or API provenance differs from the reviewed pins");
	const bytes = await readBoundedFile(path, maximumBytes);
	const jar = new JarResources(bytes);
	if (jar.sha256 !== digest) throw new Error("fixture artifact digest mismatch");
	const manifest = manifestFields(jar.read("META-INF/MANIFEST.MF"));
	if (manifest.get("bundle-symbolicname") !== fixtureBundle
		|| manifest.get("bundle-activator") !== "rs.slingshot.interop.fixture.CountingWorkflow"
		|| manifest.get("sling-nodetypes") !== "SLING-INF/interop-pages.cnd;reregister:=false"
		|| jar.read("SLING-INF/interop-pages.cnd") !== sources.nodetypes.toString("utf8")
		|| manifest.get("slingshot-agent-sha256") !== agentDigest || manifest.get("slingshot-fixture-source-sha256") !== sourceDigest) throw new Error("fixture manifest provenance does not match its receipt");
	return { bytes, evidence: receipt };
}

// Read depth one: every immediate child must have all fixture properties and no
// nested objects. A truncated listing or an unrelated child cannot pass as zero.
export function effectInventory(value: unknown, payload: string): string[] {
	const parent = object(value);
	if (parent["jcr:primaryType"] !== "nt:unstructured") throw new Error("effect payload has the wrong primary type");
	const effects: string[] = [];
	for (const [name, value] of Object.entries(parent)) {
		if (name === "jcr:primaryType") continue;
		if (!effectName.test(name)) throw new Error("unexpected effect inventory member");
		const child = object(value);
		if (Object.keys(child).sort().join(",") !== ["fixtureModel", "jcr:primaryType", "payloadPath", "startedAt", "startedBy"].sort().join(",")
			|| child["jcr:primaryType"] !== "nt:unstructured" || child["fixtureModel"] !== fixtureModel
			|| child["payloadPath"] !== payload || child["startedBy"] !== "admin" || typeof child["startedAt"] !== "string"
			|| !Number.isFinite(Date.parse(child["startedAt"]))) throw new Error("effect properties are missing or incorrect");
		effects.push(`${payload}/${name}`);
	}
	return effects.sort();
}

export function workflowResult(value: unknown, payload: string): string {
	const result = object(value);
	const identifier = result["instance_identifier"];
	if (Object.keys(result).sort().join(",") !== "instance_identifier,model_identifier,state"
		|| result["model_identifier"] !== fixtureModel || result["state"] !== "running" || typeof identifier !== "string"
		|| !identifier.startsWith(`${payload}/`) || !effectName.test(identifier.slice(payload.length + 1))) throw new Error("workflow result does not identify one fixture effect");
	return identifier;
}
