// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["success", "token-overflow", "capture-overflow", "token-refused", "capture-refused", "wrong-binding", "token-duplicate", "capture-duplicate",
	"admission-empty-identifier", "admission-wrong-client-result", "admission-failed-agent", "admission-active-agent", "admission-wrong-agent-result", "admission-digest-newline"])(
	"high-water scenario preserves binding and applies capture limits: %s", async (mode) => {
		const source = `
			import { mock } from "bun:test";
			const mode = ${JSON.stringify(mode)};
			const requests = [];
			const folderPath = "/content/interop/fixture/high-water";
			const transportDigest = "a".repeat(64) + (mode === "admission-digest-newline" ? String.fromCharCode(10) : "");
			let cancelled = false;
			mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
				runner: () => "runner", machineArguments: () => [], agentAuthorization: () => "Basic fixture",
				invoke: async () => ({ ok: true, exitCode: 0, stderr: "", stdout: "receipt" }),
				envelope: () => ({ ok: true, outcome: "operation_receipt", operation_identifier: mode === "admission-empty-identifier" ? "" : "local" }),
				waitTerminal: async () => ({ ok: true, envelope: { outcome: "operation_result", result: { repository_path: mode === "admission-wrong-client-result" ? "/wrong" : folderPath } } }),
				resolveAgentOperationIdentifier: async () => ({ ok: true, agentOperationIdentifier: "remote", targetDigest: "e".repeat(64) }),
				agentSnapshot: async (_options, identifier, target) => {
					if (identifier !== "remote" || target !== "e".repeat(64)) throw new Error("snapshot lost checked operation/target binding");
					return { ok: true, snapshot: {
					kind: mode === "admission-failed-agent" ? "failed" : mode === "admission-active-agent" ? "started" : "succeeded",
					terminal_result: { canonical_result: JSON.stringify({ repository_path: mode === "admission-wrong-agent-result" ? "/wrong" : folderPath }) },
					daemon_subscription_identifier: "subscription", agent_event_store_generation: 7,
					provenance: { transport_contract_digest: transportDigest },
				} }; },
			}));
			globalThis.fetch = async (url, init) => {
				requests.push({ url, method: init.method ?? "GET", body: init.body, headers: init.headers });
				const token = url.endsWith("/csrf/token.json");
				const document = token ? { token: "fixture-token" } : {
					format: "slingshot.agent/1", transport_contract_digest: transportDigest,
					daemon_subscription_identifier: mode === "wrong-binding" ? "other" : "subscription",
					agent_event_store_generation: 7, high_water_cursor: "7:10",
				};
				if (mode === (token ? "token-overflow" : "capture-overflow")) {
					let sent = false;
					const body = new ReadableStream({ pull(controller) {
						if (sent) { controller.close(); return; }
						sent = true;
						controller.enqueue(new TextEncoder().encode(" ".repeat(513) + JSON.stringify(document)));
					}, cancel() { cancelled = true; } }, { highWaterMark: 0 });
					return new Response(body, { headers: { "content-type": "application/json" } });
				}
				if (mode === (token ? "token-refused" : "capture-refused")) return Response.json({}, { status: 401 });
				if (mode === (token ? "token-duplicate" : "capture-duplicate")) {
					const first = token ? '"token":"other",' : '"daemon_subscription_identifier":"other",';
					return new Response("{" + first + JSON.stringify(document).slice(1), { headers: { "content-type": "application/json" } });
				}
				return Response.json(document);
			};
			const { scenario } = await import(${JSON.stringify(new URL("./high-water.scenario.ts", import.meta.url).pathname)});
			const answer = await scenario.run({}, { labelValue: "fixture", scratchHome: { profileName: "fixture" },
				values: { ports: { author: 4502 }, readiness: { harnessSeconds: 1 }, capture: { maximumBytes: 512 } } });
			console.log(JSON.stringify({ answer, requests, cancelled }));
		`;
		const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
		const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect(exit).toBe(0);
		expect(stderr).toBe("");
		const { answer, requests, cancelled } = JSON.parse(stdout);
		expect(answer.ok).toBe(mode === "success");
		expect(requests.length).toBe(mode.startsWith("admission-") ? 0 : mode.startsWith("token-") ? 1 : 2);
		if (mode.endsWith("overflow")) expect(cancelled).toBe(true);
		if (requests.length === 2) {
			expect(requests[1].url).toBe("http://127.0.0.1:4502/bin/slingshot/agent/subscriptions/high-water");
			expect(requests[1].method).toBe("POST");
			expect(JSON.parse(requests[1].body)).toEqual({ daemon_subscription_identifier: "subscription", agent_event_store_generation: 7 });
			expect(requests[1].headers["csrf-token"]).toBe("fixture-token");
		}
	},
);
