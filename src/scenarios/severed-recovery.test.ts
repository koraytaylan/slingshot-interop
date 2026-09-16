// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["automatic", "guarded", "wrong-result", "no-cut", "wrong-target", "still-parked", "duplicate-cut", "oversized-cut",
	"extra-admission", "missing-admission", "wrong-admission", "removed-admission", "inventory-refused",
	"agent-result-missing", "agent-result-malformed", "agent-result-wrong", "agent-result-duplicate", "agent-result-surplus", "client-result-surplus"])("targeted scenario requires original-operation recovery: %s", async (mode) => {
	const target = "POST /bin/slingshot/agent/submit HTTP/1.1";
	const source = `
		import { mock } from "bun:test";
		import { mkdtemp, mkdir, rm } from "node:fs/promises";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import { profileDirectoryName } from ${JSON.stringify(new URL("../sides/client-configuration.ts", import.meta.url).pathname)};
		const root = await mkdtemp(join(tmpdir(), "targeted-recovery-"));
		const mode = ${JSON.stringify(mode)};
		const events = [];
		let armParameters;
		let waits = 0;
		let inventories = 0;
		const originalRemote = "a".repeat(64);
		const inventoryPath = identifier => "g1/" + identifier.slice(0, 2) + "/" + identifier.slice(2, 4) + "/" + identifier;
		mock.module(${JSON.stringify(new URL("./agent-operation-inventory.ts", import.meta.url).pathname)}, () => ({
			agentOperationInventory: async () => {
				events.push("inventory");
				inventories++;
				const existing = inventoryPath("b".repeat(64));
				if (inventories === 1) return { ok: true, operations: [existing] };
				if (mode === "inventory-refused") return { ok: false, message: "inventory refused" };
				const added = mode === "wrong-admission" ? "c".repeat(64) : originalRemote;
				return { ok: true, operations: [
					...(mode === "removed-admission" ? [] : [existing]),
					...(mode === "missing-admission" ? [] : [inventoryPath(added)]),
					...(mode === "extra-admission" ? [inventoryPath("d".repeat(64))] : []),
				] };
			},
		}));
		const park = { outcome: "operation_recovery_required", category: "ambiguous_submission", revision: 3 };
		const result = { outcome: "operation_result", result: { repository_path: mode === "wrong-result" ? "/wrong" : "/content/interop/fixture/severed" } };
		if (mode === "client-result-surplus") result.result.extra = true;
		const agentResult = { repository_path: mode === "agent-result-wrong" ? "/wrong" : "/content/interop/fixture/severed" };
		if (mode === "agent-result-surplus") agentResult.extra = true;
		const canonical = mode === "agent-result-malformed" ? "broken" : mode === "agent-result-duplicate"
			? '{"repository_path":"/wrong",' + JSON.stringify(agentResult).slice(1) : JSON.stringify(agentResult);
		globalThis.fetch = async (url) => {
			const parsed = new URL(url);
			events.push(parsed.pathname);
			if (parsed.pathname === "/arm/client") armParameters = Object.fromEntries(parsed.searchParams);
			if (parsed.pathname === "/observed/client" && ["duplicate-cut", "oversized-cut"].includes(mode)) {
				const evidence = JSON.stringify({ arm: "fixture-arm", mode: "response", requestLine: ${JSON.stringify(target)}, severed: 1, suppressedResponseBytes: 25 });
				const body = mode === "duplicate-cut" ? '{"severed":0,' + evidence.slice(1) : " ".repeat(1025) + evidence;
				return new Response(body, { headers: { "content-type": "application/json" } });
			}
			if (parsed.pathname === "/observed/client") return Response.json({ arm: "fixture-arm", mode: "response",
				requestLine: mode === "wrong-target" ? "GET /other HTTP/1.1" : ${JSON.stringify(target)},
				severed: mode === "no-cut" ? 0 : 1, suppressedResponseBytes: 25 });
			if (parsed.pathname.endsWith(".json")) return Response.json({ "jcr:primaryType": "sling:OrderedFolder", "jcr:title": "Severed by fixture" });
			return new Response("", { headers: { "x-severance-arm": "fixture-arm" } });
		};
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [], agentAuthorization: () => "",
			invoke: async (_handle, command) => {
				events.push(command);
				const receipt = command.includes("operation-restart") ? { outcome: "operation_resume_receipt", category: "ambiguous_submission", replayed: false }
					: { outcome: "operation_receipt", operation_identifier: "original-operation" };
				return { ok: true, exitCode: 0, stdout: JSON.stringify(receipt), stderr: "" };
			},
			envelope: stdout => ({ ...JSON.parse(stdout), ok: true }),
			waitTerminal: async (_handle, _machine, identifier) => {
				events.push(["wait", identifier]);
				waits++;
				return { ok: true, envelope: ((mode === "guarded" && waits === 1) || mode === "still-parked") ? park : result };
			},
			resolveAgentOperationIdentifier: async (_options, _profile, identifier) => {
				events.push(["resolve", identifier]); return { ok: true, agentOperationIdentifier: originalRemote, targetDigest: "e".repeat(64) };
			},
			agentSnapshot: async (_options, identifier, target) => {
				if (identifier !== originalRemote || target !== "e".repeat(64)) throw new Error("snapshot lost checked operation/target binding");
				return { ok: true, snapshot: { kind: "succeeded", ...(mode === "agent-result-missing" ? {} : { terminal_result: { canonical_result: canonical } }) } };
			},
		}));
		try {
			await mkdir(join(root, profileDirectoryName));
			const { scenario } = await import(${JSON.stringify(new URL("./severed-submission.scenario.ts", import.meta.url).pathname)});
			const answer = await scenario.run({}, { labelValue: "fixture", runtimeRoot: root,
				scratchHome: { rootPath: root, environmentName: "local" }, values: { ports: { proxy: 12345, author: 12346 },
				readiness: { harnessSeconds: 1 }, capture: { maximumBytes: 1024 } } });
			console.log(JSON.stringify({ answer, events, armParameters }));
		} finally { await rm(root, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const { answer, events, armParameters } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "automatic" || mode === "guarded");
	expect(armParameters).toEqual({ mode: "response", "request-line": target });
	expect(events.at(-1)).toBe("/disarm/client");
	const commands = events.filter(Array.isArray) as string[][];
	expect(commands.filter(command => command.includes("create_asset_folder"))).toHaveLength(1);
	for (const command of commands.filter(command => command[0] === "wait" || command[0] === "resolve")) expect(command[1]).toBe("original-operation");
	const restarts = commands.filter(command => command.includes("operation-restart"));
	expect(restarts).toHaveLength(mode === "guarded" || mode === "still-parked" ? 1 : 0);
	if (mode === "guarded") {
		expect(restarts[0]).toEqual(["runner", "operation-restart", "--operation", "original-operation", "--expected-revision", "3", "--expected-category", "ambiguous_submission"]);
		expect(events.indexOf("/disarm/client")).toBeLessThan(events.indexOf(restarts[0]));
	}
});
