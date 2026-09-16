// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["success", "unexpected-outcome", "wrong-result", "missing-result", "wrong-type", "duplicate-title", "oversized"])("protocol command requires matching successful evidence: %s", async (mode) => {
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const path = "/content/interop/fixture/protocol/from-protocol";
		const terminal = { outcome: mode === "unexpected-outcome" ? "operation_receipt" : "operation_result",
			...(mode === "missing-result" ? {} : { result: { repository_path: mode === "wrong-result" ? "/wrong" : path } }) };
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", agentAuthorization: () => "", machineArguments: () => [],
			invoke: async () => ({ ok: true, exitCode: 0, stderr: "", stdout: [
				{ jsonrpc: "2.0", id: "catalog", result: { tools: [{ name: "create_asset_folder", inputSchema: { type: "object" } }] } },
				{ jsonrpc: "2.0", id: "command", result: { content: [{ type: "text", text: JSON.stringify({ outcome: "operation_receipt", operation_identifier: "original" }) }] } },
			].map(value => JSON.stringify(value)).join("\\n") }),
			waitTerminal: async () => ({ ok: true, envelope: terminal }),
		}));
		const requests = [];
		globalThis.fetch = async (url, options) => {
			requests.push({ url, redirect: options.redirect });
			if (options.method === "POST") return new Response(null, { status: 201 });
			const document = { "jcr:title": "Made over the protocol by fixture", "jcr:primaryType": mode === "wrong-type" ? "nt:unstructured" : "sling:OrderedFolder" };
			const body = (mode === "oversized" ? " ".repeat(1025) : "")
				+ (mode === "duplicate-title" ? '{"jcr:title":"wrong",' + JSON.stringify(document).slice(1) : JSON.stringify(document));
			return new Response(body, { headers: { "content-type": "application/json" } });
		};
		const { commandCall } = await import(${JSON.stringify(new URL("./model-context-protocol.scenario.ts", import.meta.url).pathname)});
		const answer = await commandCall({}, { labelValue: "fixture", scratchHome: { profileName: "fixture", environmentName: "fixture" },
			values: { ports: { author: 4502 }, readiness: { harnessSeconds: 1 }, capture: { maximumBytes: 1024 } } }, []);
		console.log(JSON.stringify({ answer, requests }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const { answer, requests } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "success");
	if (mode === "success") {
		expect(answer.effect).toBe("/content/interop/fixture/protocol/from-protocol");
		expect(answer.operationIdentifier).toBe("original");
		expect(requests[1].redirect).toBe("error");
	}
});
