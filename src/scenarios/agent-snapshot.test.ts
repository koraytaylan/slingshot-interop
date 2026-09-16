// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, spyOn, test } from "bun:test";
import { readAgentSnapshot, verifyAgentSnapshot } from "./agent-snapshot.ts";
import { agentSnapshot } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";

const identifier = "a".repeat(64);
const targetDigest = "e".repeat(64);
const operation = { agent_operation_identifier: identifier, agent_event_store_generation: 1,
	author_target_identity_digest: targetDigest, selected_environment_revision: "r".repeat(64) };
const submission = { daemon_subscription_identifier: "subscription-one", submitted_command_digest: "b".repeat(64) };
const valid = { ...operation, ...submission, kind: "succeeded", attempt: 1,
	physical_sling_job_identifiers: ["request-one"],
	terminal_result: { ...submission, operation, canonical_result: "{}", declared_artifacts: [] } };
const captureMaximumBytes = 2 * Buffer.byteLength(JSON.stringify(valid));

test.each(["succeeded", "failed"])("terminal %s evidence must retain the outer operation and submission identity", (kind) => {
	const terminalKey = kind === "succeeded" ? "terminal_result" : "terminal_failure";
	const terminal = { ...submission, operation, ...(kind === "succeeded" ? { canonical_result: "{}", declared_artifacts: [] } : { canonical_failure: "{}" }) };
	const snapshot: Record<string, unknown> = { ...valid, kind };
	delete snapshot["terminal_result"];
	snapshot[terminalKey] = terminal;
	expect(verifyAgentSnapshot(snapshot, identifier, targetDigest).ok).toBe(true);
	for (const member of Object.keys(operation)) {
		for (const changed of [undefined, "another-operation", null]) {
			expect(verifyAgentSnapshot({ ...snapshot, [terminalKey]: { ...terminal, operation: { ...operation, [member]: changed } } }, identifier, targetDigest).ok).toBe(false);
		}
	}
	for (const member of Object.keys(submission)) {
		for (const changed of [undefined, "another-submission", null]) {
			expect(verifyAgentSnapshot({ ...snapshot, [terminalKey]: { ...terminal, [member]: changed } }, identifier, targetDigest).ok).toBe(false);
		}
	}
	for (const changed of [undefined, null, [], {}]) {
		expect(verifyAgentSnapshot({ ...snapshot, [terminalKey]: changed }, identifier, targetDigest).ok).toBe(false);
		expect(verifyAgentSnapshot({ ...snapshot, [terminalKey]: { ...terminal, operation: changed } }, identifier, targetDigest).ok).toBe(false);
	}
	expect(verifyAgentSnapshot({ ...snapshot, [kind === "succeeded" ? "terminal_failure" : "terminal_result"]: terminal }, identifier, targetDigest).ok).toBe(false);
	expect(verifyAgentSnapshot({ ...snapshot, [terminalKey]: { ...terminal, operation: { ...operation, extra: true } } }, identifier, targetDigest).ok).toBe(false);
	for (const member of ["selected_environment_revision", "daemon_subscription_identifier", "submitted_command_digest"]) {
		for (const absent of [undefined, "", null]) {
			const altered = { ...terminal, [member]: absent, operation: { ...operation, ...(member === "selected_environment_revision" ? { [member]: absent } : {}) } };
			expect(verifyAgentSnapshot({ ...snapshot, [member]: absent, [terminalKey]: altered }, identifier, targetDigest).ok).toBe(false);
		}
	}
});

test("snapshot evidence must match the independently expected target", () => {
	for (const target of [undefined, null, "f".repeat(64), targetDigest + "\n", targetDigest.toUpperCase()]) {
		expect(verifyAgentSnapshot({ ...valid, author_target_identity_digest: target }, identifier, targetDigest).ok).toBe(false);
	}
	expect(verifyAgentSnapshot(valid, identifier, targetDigest).ok).toBe(true);
	for (const expected of ["", "e".repeat(63), targetDigest + "\n", targetDigest.toUpperCase()]) {
		expect(verifyAgentSnapshot({ ...valid, author_target_identity_digest: expected }, identifier, expected).ok).toBe(false);
	}
});

test("snapshot HTTP reader rejects contradictory targets from a real endpoint", async () => {
	let target: string | undefined = targetDigest;
	const requests: string[] = [];
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
		requests.push(new URL(request.url).searchParams.get("agent_operation_identifier") ?? "");
		return Response.json({ ...valid, author_target_identity_digest: target });
	} });
	const options = { values: { ports: { author: server.port }, capture: { maximumBytes: captureMaximumBytes } } } as StartClientRunnerOptions;
	try {
		for (const selected of [targetDigest, undefined, "f".repeat(64)]) {
			target = selected;
			expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(selected === targetDigest);
		}
		expect(requests).toEqual([identifier, identifier, identifier]);
	} finally { await server.stop(true); }
});

test("snapshot transport failures are refusals and redirects are never followed", async () => {
	const requests: string[] = [];
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
		requests.push(new URL(request.url).pathname);
		return Response.redirect(new URL("/unexpected-target", request.url).toString(), 302);
	} });
	const options = { values: { ports: { author: server.port }, capture: { maximumBytes: captureMaximumBytes } } } as StartClientRunnerOptions;
	try {
		expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
		expect(requests).toEqual(["/bin/slingshot/agent/snapshot"]);
	} finally { await server.stop(true); }
	// The closed listener provides a real connection refusal without a sleep.
	expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
});

test("real HTTP terminal snapshots preserve every operation and submission echo", async () => {
	let document: Record<string, unknown> = valid;
	let requests = 0;
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
		requests++;
		return Response.json(document);
	} });
	const options = { values: { ports: { author: server.port }, capture: { maximumBytes: captureMaximumBytes } } } as StartClientRunnerOptions;
	try {
		for (const kind of ["succeeded", "failed"]) {
			const terminalKey = kind === "succeeded" ? "terminal_result" : "terminal_failure";
			const terminal = { ...submission, operation, ...(kind === "succeeded" ? { canonical_result: "{}", declared_artifacts: [] } : { canonical_failure: "{}" }) };
			const snapshot: Record<string, unknown> = { ...valid, kind };
			delete snapshot["terminal_result"];
			document = { ...snapshot, [terminalKey]: terminal };
			expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(true);
			for (const member of Object.keys(operation)) {
				document = { ...snapshot, [terminalKey]: { ...terminal, operation: { ...operation, [member]: "foreign" } } };
				expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
			}
			for (const member of Object.keys(submission)) {
				document = { ...snapshot, [terminalKey]: { ...terminal, [member]: "foreign" } };
				expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
			}
		}
		expect(requests).toBe(2 * (1 + Object.keys(operation).length + Object.keys(submission).length));
	} finally { await server.stop(true); }
});

test("snapshot request exceptions disclose no private diagnostic text", async () => {
	const options = { values: { ports: { author: 4502 }, capture: { maximumBytes: captureMaximumBytes } } } as StartClientRunnerOptions;
	const request = spyOn(globalThis, "fetch");
	try {
		request.mockRejectedValue(new Error("private request diagnostic"));
		const answer = await agentSnapshot(options, identifier, targetDigest);
		expect(answer.ok).toBe(false);
		if (!answer.ok) expect(answer.message).not.toContain("private request diagnostic");
	} finally { request.mockRestore(); }
});

test("duplicate snapshot fields cannot overwrite contradictory evidence", async () => {
	const body = `{"attempt":0,${JSON.stringify(valid).slice(1)}`;
	expect((await readAgentSnapshot(new Response(body, { headers: { "content-type": "application/json" } }), identifier, captureMaximumBytes, targetDigest)).ok).toBe(false);
});

test("snapshot evidence binds the operation and counts distinct deliveries", () => {
	expect(verifyAgentSnapshot(valid, identifier, targetDigest).ok).toBe(true);
	expect(verifyAgentSnapshot({ ...valid, attempt: 2, physical_sling_job_identifiers: ["job-one", "job-two"] }, identifier, targetDigest).ok).toBe(true);
	expect(verifyAgentSnapshot({ ...valid, kind: "accepted", attempt: 0, physical_sling_job_identifiers: [] }, identifier, targetDigest).ok).toBe(true);
	for (const member of Object.keys(valid)) {
		const missing: Record<string, unknown> = { ...valid };
		delete missing[member];
		expect(verifyAgentSnapshot(missing, identifier, targetDigest).ok).toBe(false);
	}
});

test("old zero counter and malformed snapshot evidence cannot pass", () => {
	for (const changed of [
		{ attempt: 0 }, { attempt: -1 }, { attempt: 1.5 }, { attempt: "1" }, { attempt: Number.MAX_SAFE_INTEGER + 1 },
		{ physical_sling_job_identifiers: ["job", "job"], attempt: 2 },
		{ physical_sling_job_identifiers: [""] }, { physical_sling_job_identifiers: [1] },
		{ physical_sling_job_identifiers: "job" }, { physical_sling_job_identifiers: [], attempt: 0 },
		{ agent_operation_identifier: "another" }, { agent_event_store_generation: 0 },
		{ agent_event_store_generation: 1.5 }, { agent_event_store_generation: "1" }, { kind: "unknown" },
	]) expect(verifyAgentSnapshot({ ...valid, ...changed }, identifier, targetDigest).ok).toBe(false);
	for (const value of [null, [], "succeeded", 1]) expect(verifyAgentSnapshot(value, identifier, targetDigest).ok).toBe(false);
});

test("the scenario lookup reader applies validation to the HTTP response", async () => {
	const options = { values: { ports: { author: 4502 }, capture: { maximumBytes: captureMaximumBytes } } } as StartClientRunnerOptions;
	const request = spyOn(globalThis, "fetch");
	try {
		request.mockResolvedValue(Response.json(valid));
		expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(true);
		expect(request.mock.calls[0]?.[1]?.redirect).toBe("error");
		request.mockResolvedValue(Response.json({ ...valid, attempt: 0 }));
		expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
		request.mockResolvedValue(new Response(JSON.stringify(valid), { headers: { "content-type": "text/html" } }));
		expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
		request.mockResolvedValue(Response.json(valid, { status: 202 }));
		expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(false);
	} finally {
		request.mockRestore();
	}
});

test("snapshot reads enforce the byte bound at its exact boundary", async () => {
	const bytes = new TextEncoder().encode(JSON.stringify({ ...valid, annotation: "é" }));
	const request = spyOn(globalThis, "fetch");
	try {
		for (const maximumBytes of [bytes.length, bytes.length - 1]) {
			const options = { values: { ports: { author: 4502 }, capture: { maximumBytes } } } as StartClientRunnerOptions;
			request.mockResolvedValue(new Response(bytes, { headers: { "content-type": "application/json" } }));
			expect((await agentSnapshot(options, identifier, targetDigest)).ok).toBe(maximumBytes === bytes.length);
		}
	} finally { request.mockRestore(); }
});

test("snapshot overflow cancels reading and malformed input is a refusal", async () => {
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) { controller.enqueue(new Uint8Array(32)); },
		cancel() { cancelled = true; },
	});
	expect((await readAgentSnapshot(new Response(stream, { headers: { "content-type": "application/json" } }), identifier, 16, targetDigest)).ok).toBe(false);
	expect(cancelled).toBe(true);
	expect(stream.locked).toBe(false);
	for (const body of ["not json", new Uint8Array([0xff]), "null", "[]"]) {
		expect((await readAgentSnapshot(new Response(body, { headers: { "content-type": "application/json" } }), identifier, captureMaximumBytes, targetDigest)).ok).toBe(false);
	}
	const broken = new ReadableStream({ start(controller) { controller.error(new Error("broken stream")); } });
	expect((await readAgentSnapshot(new Response(broken, { headers: { "content-type": "application/json" } }), identifier, captureMaximumBytes, targetDigest)).ok).toBe(false);
	expect(broken.locked).toBe(false);
});
