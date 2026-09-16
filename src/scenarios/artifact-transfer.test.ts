// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each([
	"success", "wrong-identifier", "wrong-operation", "wrong-digest", "string-length",
	"measure-failed", "read-failed", "wrong-path", "wrong-property-type", "wrong-result-path",
	"duplicate-path", "duplicate-property-value", "malformed-byte-count", "prefixed-digest",
	"empty-remote-identifier", "wrong-slot", "wrong-media", "wrong-file-name", "surplus-descriptor",
	"identifier-at-limit", "identifier-over-limit", "zero-length", "negative-length", "fractional-length", "unsafe-length",
	"identifier-space", "identifier-unicode", "identifier-newline",
	"wrong-access-media", "missing-access-media", "surplus-result", "mixed-result",
	"missing-children", "unexpected-child", "truncated-children", "surplus-document", "surplus-property", "planting-error-body",
	"planting-accepted", "planting-no-content", "planting-redirected", "planting-body-cancelled", "planting-updated",
	"planting-wire-200", "planting-wire-201", "planting-wire-202", "planting-wire-204", "planting-wire-302", "planting-wire-307",
	"missing-access-target", "wrong-access-target", "missing-access-uri", "wrong-access-uri", "surplus-access",
	"wrong-access-target-and-uri",
	"measured-prefixed-digest", "measured-wrong-file", "measured-extra-line", "measured-missing-newline",
	"measured-real-tools",
])("artifact transfer binds its access entry and fetched document: %s", async (mode) => {
	const source = `
		import { mock } from "bun:test";
		import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		const mode = ${JSON.stringify(mode)};
		const temporaryHome = mode === "measured-real-tools" ? await mkdtemp(join(tmpdir(), "interop-artifact-measurement-")) : undefined;
		const homePath = temporaryHome ?? "/fixture";
		const destination = homePath + "/artifacts/fixture.bin";
		let plantingBodyCancelled = false;
		let loadCalls = 0;
		const nativeFetch = globalThis.fetch;
		const path = "/content/interop-artifact/fixture";
		const targetDigest = "e".repeat(64);
		const resource = { children: [], children_truncated: false, path: mode === "wrong-path" ? "/other" : path, properties: {
			text0000: { property_type: mode === "wrong-property-type" ? "name" : "string", cardinality: "single", value: "AA" }
		} };
		if (mode === "missing-children") delete resource.children;
		if (mode === "unexpected-child") resource.children.push({ path: path + "/unplanted" });
		if (mode === "truncated-children") resource.children_truncated = true;
		if (mode === "surplus-document") resource.extra = true;
		if (mode === "surplus-property") resource.properties.text0000.extra = true;
		let document = JSON.stringify(resource);
		if (mode === "duplicate-path") document = document.replace('{', '{"path":"/other",');
		if (mode === "duplicate-property-value") document = document.replace('"value":"AA"', '"value":"wrong","value":"AA"');
		const length = Buffer.byteLength(document);
		const digest = new Bun.CryptoHasher("sha256").update(document).digest("hex");
		if (temporaryHome) {
			await mkdir(join(temporaryHome, "artifacts"));
			await writeFile(destination, document);
		}
		const descriptor = { identifier: mode === "empty-remote-identifier" ? "" : "remote-artifact",
			slot: mode === "wrong-slot" ? "content_package" : "loaded_content_json", byte_length: length,
			digest: mode === "prefixed-digest" ? "sha256-" + digest : digest,
			media_type: mode === "wrong-media" ? "application/zip" : "application/json",
			suggested_file_name: mode === "wrong-file-name" ? "other.json" : "loaded-content.json" };
		if (mode === "surplus-descriptor") descriptor.extra = true;
		if (mode === "identifier-at-limit") descriptor.identifier = "x".repeat(128);
		if (mode === "identifier-over-limit") descriptor.identifier = "x".repeat(129);
		if (mode === "identifier-space") descriptor.identifier = "remote artifact";
		if (mode === "identifier-unicode") descriptor.identifier = "é";
		if (mode === "identifier-newline") descriptor.identifier = "remote" + String.fromCharCode(10);
		const invalidLengths = { "zero-length": 0, "negative-length": -1, "fractional-length": 1.5, "unsafe-length": Number.MAX_SAFE_INTEGER + 1 };
		if (mode in invalidLengths) descriptor.byte_length = invalidLengths[mode];
		const entry = { artifact_identifier: mode === "wrong-identifier" ? "other" : "local-artifact",
			author_target_identity_digest: targetDigest,
			uri: "slingshot://profiles/fixture/environments/fixture/targets/" + targetDigest + "/operations/operation/artifacts/local-artifact",
			operation_identifier: mode === "wrong-operation" ? "other" : "operation",
			byte_length: mode === "string-length" ? String(length) : length,
			content_digest: mode === "wrong-digest" ? "0".repeat(64) : digest, media_type: "application/json" };
		if (mode === "wrong-access-media") entry.media_type = "application/zip";
		if (mode === "missing-access-media") delete entry.media_type;
		if (mode === "missing-access-target") delete entry.author_target_identity_digest;
		if (mode === "wrong-access-target") entry.author_target_identity_digest = "f".repeat(64);
		if (mode === "wrong-access-target-and-uri") {
			entry.author_target_identity_digest = "f".repeat(64);
			entry.uri = entry.uri.replace(targetDigest, "f".repeat(64));
		}
		if (mode === "missing-access-uri") delete entry.uri;
		if (mode === "wrong-access-uri") entry.uri += "/other";
		if (mode === "surplus-access") entry.extra = true;
		const result = { path: mode === "wrong-result-path" ? "/other" : path, disposition: "artifact", artifact: descriptor };
		if (mode === "surplus-result") result.extra = true;
		if (mode === "mixed-result") result.document = resource;
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [], agentAuthorization: () => "",
			envelope: stdout => JSON.parse(stdout),
			resolveLocalArtifactIdentifier: async () => {
				if (mode === "identifier-over-limit" || mode in invalidLengths) throw new Error("invalid descriptor reached artifact resolution");
				return { ok: true, artifactIdentifier: "local-artifact", targetDigest };
			},
			waitTerminal: async () => ({ ok: true, envelope: { outcome: "operation_result", result } }),
			invoke: async (_handle, command) => {
				let stdout = "";
				let exitCode = 0;
				if (command.includes("load_content_as_json")) {
					loadCalls += 1;
					if (mode === "planting-body-cancelled" && !plantingBodyCancelled) throw new Error("planting body was left open");
					stdout = JSON.stringify({ outcome: "operation_receipt", operation_identifier: "operation" });
				}
				if (command.includes("operation-artifact")) stdout = JSON.stringify({ outcome: "structured_result_artifact_access", artifact: entry });
				if (command[0] === "sh") {
					if (mode === "measured-real-tools") {
						const measurement = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
						const [exitCode, stdout, stderr] = await Promise.all([measurement.exited, new Response(measurement.stdout).text(), new Response(measurement.stderr).text()]);
						return { ok: true, exitCode, stdout, stderr };
					}
					stdout = length + (mode === "malformed-byte-count" ? "junk" : "") + "\\n"
						+ (mode === "measured-prefixed-digest" ? "sha256-" : "") + digest
						+ "  " + (mode === "measured-wrong-file" ? "other-file" : destination)
						+ (mode === "measured-missing-newline" ? "" : "\\n")
						+ (mode === "measured-extra-line" ? "unexpected\\n" : "");
					if (mode === "measure-failed") exitCode = 1;
				}
				if (command[0] === "cat") { stdout = document; if (mode === "read-failed") exitCode = 1; }
				return { ok: true, exitCode, stderr: "", stdout };
			},
		}));
		globalThis.fetch = async (_url, options) => {
			if (options.redirect !== "error") throw new Error("planting permits redirects");
			if (mode === "planting-updated") return new Response(null, { status: 200 });
			if (mode === "planting-error-body") return new Response("private-error-body", { status: 500 });
			if (mode === "planting-accepted") return new Response(null, { status: 202 });
			if (mode === "planting-no-content") return new Response(null, { status: 204 });
			const response = mode === "planting-body-cancelled"
				? new Response(new ReadableStream({ cancel() { plantingBodyCancelled = true; } }), { status: 201 })
				: new Response(null, { status: 201 });
			if (mode === "planting-redirected") Object.defineProperty(response, "redirected", { value: true });
			return response;
		};
		const requests = [];
		const wireStatus = mode.startsWith("planting-wire-") ? Number(mode.slice("planting-wire-".length)) : undefined;
		const server = wireStatus === undefined ? undefined : Bun.serve({ hostname: "127.0.0.1", port: 0,
			async fetch(request) {
				requests.push({ path: new URL(request.url).pathname, method: request.method, body: await request.text() });
				if (requests.length > 1) return new Response("redirect target", { status: 200 });
				return new Response(null, { status: wireStatus, headers: { location: "/must-not-follow" } });
			}
		});
		if (server) globalThis.fetch = nativeFetch;
		const { scenario } = await import(${JSON.stringify(new URL("./artifact-transfer.scenario.ts", import.meta.url).pathname)});
		let answer;
		try {
			answer = await scenario.run({}, { labelValue: "fixture", scratchHome: { profileName: "fixture", environmentName: "fixture", homePath },
				values: { ports: { author: server?.port ?? 4502 }, readiness: { harnessSeconds: 1 }, plantedResult: { bytes: 2, propertyBytes: 2 } } });
		} catch (failure) {
			if (wireStatus !== 302 && wireStatus !== 307) throw failure;
			answer = { ok: false, message: "redirect refused" };
		} finally {
			await server?.stop(true);
			if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
		}
		console.log(JSON.stringify({ ...answer, requests, loadCalls }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	expect(JSON.parse(stdout).ok).toBe(["success", "identifier-at-limit", "planting-body-cancelled", "planting-updated", "planting-wire-200", "planting-wire-201", "measured-real-tools"].includes(mode));
	if (mode.startsWith("planting-wire-")) {
		const answer = JSON.parse(stdout);
		expect(answer.requests).toEqual([{ path: "/content/interop-artifact/fixture", method: "POST", body: "text0000=AA" }]);
		expect(answer.loadCalls).toBe(mode === "planting-wire-200" || mode === "planting-wire-201" ? 1 : 0);
	}
	if (mode === "planting-error-body") {
		expect(JSON.parse(stdout).message).toContain("500");
		expect(JSON.parse(stdout).message).not.toContain("private-error-body");
	}
});
