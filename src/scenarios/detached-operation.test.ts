// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["success", "failed", "parked", "wrong-result", "missing-result", "agent-disagrees", "agent-result-missing", "agent-result-wrong"])("detached scenario requires the expected successful result: %s", async (mode) => {
	// Isolated module mocks exercise the actual scenario without contaminating other tests.
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const observed = [];
		const terminal = mode === "failed" ? { outcome: "operation_terminal_error" }
			: mode === "parked" ? { outcome: "operation_recovery_required" }
			: { outcome: "operation_result", ...(mode === "missing-result" ? {} : { result: { repository_path: mode === "wrong-result" ? "/wrong" : "/content/interop/fixture/detached" } }) };
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [], agentAuthorization: () => "",
			invoke: async (_handle, command) => {
				observed.push(command);
				return { ok: true, exitCode: 0, stderr: "", stdout: JSON.stringify({ outcome: "operation_receipt", operation_identifier: "original" }) };
			},
			envelope: stdout => JSON.parse(stdout),
			waitTerminal: async (_handle, _machine, identifier) => {
				observed.push(["wait", identifier]); return { ok: true, envelope: terminal };
			},
			resolveAgentOperationIdentifier: async (_options, _profile, identifier) => {
				observed.push(["resolve", identifier]); return { ok: true, agentOperationIdentifier: "remote-original", targetDigest: "e".repeat(64) };
			},
			agentSnapshot: async (_options, identifier, target) => {
				observed.push(["snapshot", identifier, target]);
				return { ok: true, snapshot: {
					kind: ["failed", "parked", "agent-disagrees"].includes(mode) ? "failed" : "succeeded",
					...(mode === "agent-result-missing" ? {} : { terminal_result: { canonical_result: JSON.stringify({ repository_path: mode === "agent-result-wrong" ? "/wrong" : "/content/interop/fixture/detached" }) } }),
				} };
			},
		}));
		globalThis.fetch = async () => Response.json({ "jcr:primaryType": "sling:OrderedFolder", "jcr:title": "Detached by fixture" });
		const { scenario } = await import(${JSON.stringify(new URL("./detached-operation.scenario.ts", import.meta.url).pathname)});
		const answer = await scenario.run({}, { labelValue: "fixture", scratchHome: { profileName: "fixture" },
			values: { ports: { author: 4502 }, readiness: { harnessSeconds: 1 }, capture: { maximumBytes: 1024 } } });
		console.log(JSON.stringify({ answer, observed }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { answer, observed } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "success");
	expect(observed.find((event: string[]) => event[0] === "wait")).toEqual(["wait", "original"]);
	if (mode === "success") {
		expect(observed.find((event: string[]) => event[0] === "resolve")).toEqual(["resolve", "original"]);
		expect(observed.find((event: string[]) => event[0] === "snapshot")).toEqual(["snapshot", "remote-original", "e".repeat(64)]);
	}
});
