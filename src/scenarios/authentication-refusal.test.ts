// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { observedSubmissionRefusal, submissionRequestLine, authenticationRequestLine } from "./proxy-observation.ts";

test("authentication evidence requires only matched 401s from this arming", () => {
	const valid = { arm: "current", mode: "observe", requestLine: submissionRequestLine,
		severed: 0, suppressedResponseBytes: 0, matchedRequests: 2, statusCounts: { "401": 2 } };
	expect(observedSubmissionRefusal(valid, "current")).toBe(true);
	for (const changed of [{ arm: "old" }, { mode: "response" }, { requestLine: "GET /other HTTP/1.1" },
		{ severed: 1 }, { suppressedResponseBytes: 1 }, { matchedRequests: 0 }, { matchedRequests: 1.5 },
		{ statusCounts: {} }, { statusCounts: { "401": 1 } }, { statusCounts: { "401": 1, "500": 1 } }]) {
		expect(observedSubmissionRefusal({ ...valid, ...changed }, "current")).toBe(false);
	}
});

test.each(["refused", "no-status", "changed-inventory", "arm-throws", "submission-throws", "disarm-fails", "duplicate-status", "oversized-status"])("authentication scenario verifies observation and cleanup: %s", async (mode) => {
	const source = `
		import { mock } from "bun:test";
		import { mkdtemp, mkdir, rm } from "node:fs/promises";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import { profileDirectoryName } from ${JSON.stringify(new URL("../sides/client-configuration.ts", import.meta.url).pathname)};
		const root = await mkdtemp(join(tmpdir(), "authentication-observation-"));
		const mode = ${JSON.stringify(mode)};
		const events = [];
		let inventories = 0;
		globalThis.fetch = async url => {
			const path = new URL(url).pathname; events.push(path);
			if (path === "/arm/client" && mode === "arm-throws") throw new Error("arm lost");
			if (path === "/observed/client" && ["duplicate-status", "oversized-status"].includes(mode)) {
					const evidence = JSON.stringify({ arm: "current", mode: "observe", requestLine: ${JSON.stringify(authenticationRequestLine)}, severed: 0,
					suppressedResponseBytes: 0, matchedRequests: 1, statusCounts: { "401": 1 } });
				const body = mode === "duplicate-status" ? '{"statusCounts":{"500":1},' + evidence.slice(1) : " ".repeat(1025) + evidence;
				return new Response(body, { headers: { "content-type": "application/json" } });
			}
			if (path === "/observed/client") return Response.json({ arm: "current", mode: "observe",
				requestLine: ${JSON.stringify(authenticationRequestLine)}, severed: 0, suppressedResponseBytes: 0,
				matchedRequests: 1, statusCounts: mode === "no-status" ? {} : { "401": 1 } });
			return new Response("", { status: path === "/disarm/client" && mode === "disarm-fails" ? 500 : 200, headers: { "x-severance-arm": "current" } });
		};
		mock.module(${JSON.stringify(new URL("./agent-operation-inventory.ts", import.meta.url).pathname)}, () => ({
			agentOperationInventory: async () => ({ ok: true, operations: ++inventories === 2 && mode === "changed-inventory" ? ["admitted"] : [] }),
		}));
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [],
			invoke: async (_handle, command) => {
				events.push(command);
				if (command.includes("load_content_as_json") && mode === "submission-throws") throw new Error("submission lost");
				return { ok: true, exitCode: 0, stderr: "", stdout: JSON.stringify({ outcome: "operation_receipt", operation_identifier: "original" }) };
			}, envelope: stdout => JSON.parse(stdout),
			waitTerminal: async () => ({ ok: true, envelope: { outcome: "operation_recovery_required", category: "ambiguous_submission", evidence: "SubmissionUnknown" } }),
		}));
		try {
			await mkdir(join(root, profileDirectoryName));
			const { scenario } = await import(${JSON.stringify(new URL("./authentication-refusal.scenario.ts", import.meta.url).pathname)});
			const answer = await scenario.run({}, { labelValue: "fixture", scratchHome: { rootPath: root, environmentName: "local" },
				values: { ports: { author: 4502, proxy: 4503 }, readiness: { harnessSeconds: 1 }, capture: { maximumBytes: 1024 } } });
			console.log(JSON.stringify({ answer, events }));
		} finally { await rm(root, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { answer, events } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "refused");
	expect(events.at(-1)).toBe("/disarm/client");
	if (mode !== "arm-throws") expect(events.indexOf("/arm/client")).toBeLessThan(events.findIndex((event: unknown) => Array.isArray(event) && event.includes("load_content_as_json")));
});
