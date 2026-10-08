// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { page, refused, samePage } from "./discovery-lifecycle.ts";

const root = "/content/interop-lifecycle/run";
const answer = { outcome: "operation_result", result: { matches: [{ repository_path: `${root}/one`, resource_type: "interop/lifecycle" }], complete: false, examined_nodes: 2, next_continuation_token: "opaque" } };

test("lifecycle evidence validates bounded partial pages and exact failure categories", () => {
	expect(page(answer, root).path).toBe(`${root}/one`);
	for (const result of [{ ...answer.result, complete: true }, { ...answer.result, examined_nodes: 100_001 }, { ...answer.result, matches: [] }, { ...answer.result, extra: true }, { ...answer.result, next_continuation_token: "" }]) expect(() => page({ ...answer, result }, root)).toThrow();
	expect(() => page(answer, "/other")).toThrow();
	expect(refused({ outcome: "operation_terminal_error", failure: { metadata: "continuation_token_expired" } }, "continuation_token_expired")).toBe("continuation_token_expired");
	expect(() => refused({ outcome: "operation_terminal_error", failure: { metadata: "transport_error" } }, "continuation_token_expired")).toThrow();
	expect(() => refused(answer, "continuation_token_expired")).toThrow();
	samePage({ one: 1, two: [2] }, { two: [2], one: 1 });
	expect(() => samePage({ one: [1, 2] }, { one: [2, 1] })).toThrow();
});

const modulePath = (name: string) => JSON.stringify(new URL(name, import.meta.url).pathname);

test.each(["success", "stale-replay", "wrong-refusal", "change-unobserved", "stop-response-lost", "restart-failed", "old-token-accepted", "fresh-cursor-broken"])("discovery lifecycle checks and restoration: %s", async mode => {
	const script = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const calls = []; let number = 0; let changed = false; let starts = 0;
		const root = "/content/interop-lifecycle/run";
		const make = (name, token) => ({ outcome: "operation_result", result: { matches: [{ repository_path: root + "/" + name, resource_type: "interop/lifecycle" }], complete: false, examined_nodes: 1, next_continuation_token: token } });
		const failure = category => ({ outcome: "operation_terminal_error", failure: { metadata: category } });
		mock.module(${modulePath("./discovery-lifecycle-runtime.ts")}, () => ({ DiscoveryLifecycleRuntime: class {
			async read(path) {
				if (path.endsWith("capabilities")) return { command_contracts: [{ command_wire_name: "list_components", command_semantic_contract_version: "0.0.0", command_contract_limits_digest: "10a708a6b720a2b70ed150fb5c0bbf063ea8c235a4395cffe51d92d9c2193ecd" }] };
				if (path.endsWith(".1.json")) return Object.fromEntries(["one", "two", "three", "four"].map(name => [name, { "jcr:primaryType": "nt:unstructured", "sling:resourceType": "interop/lifecycle" }]));
				return { "jcr:title": changed && mode !== "change-unobserved" ? "lifecycle-change" : "old" };
			}
			async post(_path, form) { if (form.has("jcr:title")) changed = true; }
			async start() {}
			async agentBundle() { return 9; }
			async action(identifier, action) {
				calls.push(action); if (identifier !== 9) throw new Error("wrong bundle");
				if (action === "stop" && mode === "stop-response-lost") throw new Error("stop response lost");
				if (action === "start" && starts++ === 0 && mode === "restart-failed") throw new Error("restart failed");
			}
			async discover(path, token) {
				number++;
				if (number === 1) { if (token !== undefined) throw new Error("initial token"); return make("one", "first"); }
				if (number === 2) { if (path !== root + "/absent" || token !== "first") throw new Error("wrong misuse request"); return failure(mode === "wrong-refusal" ? "transport_error" : "continuation_token_wrong_query"); }
				if (number === 3 || number === 4) { if (token !== "first") throw new Error("wrong replay token"); return make(number === 4 && mode === "stale-replay" ? "three" : "two", "second"); }
				if (number === 5) return failure("continuation_token_expired");
				if (number === 6) return make("one", "before-restart");
				if (number === 7) return make("one", "after-restart");
				if (number === 8) { if (token !== "before-restart") throw new Error("wrong old token"); return mode === "old-token-accepted" ? make("two", "oops") : failure("continuation_token_wrong_query"); }
				if (number === 9) { if (token !== "after-restart") throw new Error("wrong fresh token"); return make(mode === "fresh-cursor-broken" ? "one" : "two", "fresh-next"); }
				throw new Error("extra operation");
			}
		} }));
		const { scenario } = await import(${modulePath("./discovery-lifecycle.scenario.ts")});
		const result = await scenario.run({}, { labelValue: "run" });
		console.log(JSON.stringify({ result, calls, number }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(status, stderr).toBe(0);
	const { result, calls, number } = JSON.parse(stdout) as { result: { ok: boolean; message: string; evidence: { fresh_cursor_advances?: boolean; bundle_restoration?: string } }; calls: string[]; number: number };
	expect(result.ok, result.message).toBe(mode === "success");
	if (mode === "success") { expect(number).toBe(9); expect(calls).toEqual(["stop", "start"]); expect(result.evidence.fresh_cursor_advances).toBe(true); }
	if (mode === "stop-response-lost") { expect(calls).toEqual(["stop", "start"]); expect(result.evidence.bundle_restoration).toBe("active"); }
	if (mode === "restart-failed") { expect(calls).toEqual(["stop", "start", "start"]); expect(result.evidence.bundle_restoration).toBe("active"); }
});

test("runtime sends unique operations and exact observed bundle actions", async () => {
	const script = `
		import { mock } from "bun:test";
		const commands = []; const actions = []; let state = "Active";
		mock.module(${modulePath("../sides/agent-runtime.ts")}, () => ({ bundleSymbolicName: async path => { if (path !== "exact.jar") throw new Error("wrong candidate"); return "exact.agent"; } }));
		mock.module(${modulePath("./support.ts")}, () => ({
			agentAuthorization: () => "Basic fixture", runner: () => "runner", machineArguments: () => ["--machine"],
			envelope: text => ({ ok: true, ...JSON.parse(text) }),
			invoke: async (_handle, command) => { commands.push(command); return { ok: true, exitCode: 0, stdout: JSON.stringify({ outcome: "operation_receipt", operation_identifier: "op" }) }; },
			waitTerminal: async () => ({ ok: true, envelope: { outcome: "operation_terminal_error", failure: { metadata: "transport_error" } } }),
		}));
		globalThis.fetch = async (url, options) => {
			if (!url.startsWith("http://127.0.0.1:12345/") || options.headers.authorization !== "Basic fixture" || !options.signal) throw new Error("wrong authority or unbounded request");
			if (options.method === "POST") {
				if (options.redirect !== "manual" || !url.endsWith("/system/console/bundles/9")) throw new Error("wrong action endpoint");
				const action = options.body.get("action"); actions.push(action); state = action === "stop" ? "Resolved" : "Active";
				return new Response("", { status: 200 });
			}
			if (options.redirect !== "error") throw new Error("wrong read redirect policy");
			if (url.endsWith("bundles.json")) return Response.json({ data: [{ id: 9, symbolicName: "exact.agent", state }] });
			if (url.endsWith("capabilities")) return Response.json({});
			throw new Error("unexpected request");
		};
		const { DiscoveryLifecycleRuntime } = await import(${modulePath("./discovery-lifecycle-runtime.ts")});
		const runtime = new DiscoveryLifecycleRuntime({}, { authorHostPort: 12345, agentBundlePath: "exact.jar", labelValue: "run", scratchHome: { profileName: "fixture" }, values: { capture: { maximumBytes: 10000 }, readiness: { harnessSeconds: 1, pollIntervalSeconds: 0.001 } } });
		await runtime.start(); const result = await runtime.discover("/content/example"); await runtime.discover("/content/example", "opaque");
		const identifier = await runtime.agentBundle(); await runtime.action(identifier, "stop"); await runtime.action(identifier, "start");
		console.log(JSON.stringify({ commands, actions, result }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(status, stderr).toBe(0);
	const parsed = JSON.parse(stdout) as { commands: string[][]; actions: string[]; result: { failure: { metadata: string } } };
	expect(parsed.commands[1]).not.toContain("--operation-key");
	expect(parsed.commands[1]).toContain("--offset");
	expect(parsed.commands[2]).not.toContain("--operation-key");
	expect(parsed.commands[2]).toContain("--continuation-token");
	expect(parsed.commands[2]).toContain("opaque");
	expect(parsed.commands[2]).not.toContain("--offset");
	expect(parsed.actions).toEqual(["stop", "start"]);
	expect(parsed.result.failure.metadata).toBe("transport_error");
});
