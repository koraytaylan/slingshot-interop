// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { recoveryArguments, withProxyDisarmed, observedResponseCut } from "./severed-submission.scenario.ts";

const parked = { outcome: "operation_recovery_required", category: "ambiguous_submission", revision: 3 };

test("response-cut evidence must belong to this arming and record actual suppression", () => {
	const evidence = { arm: "current", mode: "response", requestLine: "POST /bin/slingshot/agent/submit HTTP/1.1", severed: 1, suppressedResponseBytes: 25 };
	expect(observedResponseCut(evidence, "current")).toBe(true);
	for (const value of [null, {}, [], { ...evidence, arm: "previous" }, { ...evidence, mode: "immediate" },
		{ ...evidence, severed: 0 }, { ...evidence, severed: 1.5 }, { ...evidence, suppressedResponseBytes: 0 },
		{ ...evidence, suppressedResponseBytes: "25" }]) expect(observedResponseCut(value, "current")).toBe(false);
});

test.each(["submission-refusal", "submission-exception", "arm-exception", "arm-redirect", "disarm-redirect"])("the actual scenario disarms after %s", async (failure) => {
	const source = `
		import { mock } from "bun:test";
		import { mkdtemp, mkdir, rm } from "node:fs/promises";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		import { profileDirectoryName } from ${JSON.stringify(new URL("../sides/client-configuration.ts", import.meta.url).pathname)};
		const root = await mkdtemp(join(tmpdir(), "severed-scenario-"));
		const calls = [];
		const followed = [];
		mock.module(${JSON.stringify(new URL("./agent-operation-inventory.ts", import.meta.url).pathname)}, () => ({
			agentOperationInventory: async () => ({ ok: true, operations: [] }),
		}));
		const nativeFetch = globalThis.fetch;
		const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/unexpected") {
				followed.push(path);
				return new Response("", { headers: { "x-severance-arm": "fixture-arm" } });
			}
			return new Response(null, { status: 302, headers: { location: "/unexpected" } });
		} });
		globalThis.fetch = async (url, init) => {
			const path = new URL(url).pathname;
			calls.push(path);
			if ((${JSON.stringify(failure)} === "arm-redirect" && path === "/arm/client") ||
				(${JSON.stringify(failure)} === "disarm-redirect" && path === "/disarm/client")) {
				return nativeFetch(new URL(path, server.url), init);
			}
			if (${JSON.stringify(failure)} === "arm-exception" && path === "/arm/client") throw new Error("fixture arm response lost");
			return new Response("", { status: 200, headers: { "x-severance-arm": "fixture-arm" } });
		};
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [],
			invoke: async (_handle, command) => {
				if (command.includes("daemon")) return { ok: true, exitCode: 0, stdout: "", stderr: "" };
				if (${JSON.stringify(failure)} === "submission-exception") throw new Error("fixture submission threw");
				return { ok: false, message: "fixture submission refused" };
			},
			agentAuthorization: () => "", agentSnapshot: () => {}, envelope: () => {},
			resolveAgentOperationIdentifier: () => {}, waitTerminal: () => {},
		}));
		try {
			await mkdir(join(root, profileDirectoryName));
			const { scenario } = await import(${JSON.stringify(new URL("./severed-submission.scenario.ts", import.meta.url).pathname)});
			const answer = await scenario.run({}, { labelValue: "fixture", runtimeRoot: root,
				scratchHome: { rootPath: root, environmentName: "local" }, values: { ports: { proxy: 12345 }, capture: { maximumBytes: 1024 } } });
			console.log(JSON.stringify({ answer, calls, followed }));
		} finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const { answer, calls, followed } = JSON.parse(stdout);
	expect(answer.ok).toBe(false);
	if (failure !== "arm-redirect") expect(answer.message).toContain("fixture");
	expect(calls).toEqual(["/arm/client", "/disarm/client"]);
	expect(followed).toEqual([]);
	if (failure === "disarm-redirect") expect(answer.message).toContain("cleanup");
});

test("proxy cleanup follows success, early refusal, and thrown arm or observation", async () => {
	for (const disposition of ["success", "refusal", "throw"] as const) {
		const events: string[] = [];
		const answer = await withProxyDisarmed(async () => {
			events.push("attempt");
			if (disposition === "throw") throw new Error("lost arm response");
			return { ok: disposition === "success", message: disposition };
		}, async () => { events.push("disarm"); return { ok: true, message: "clean" }; });
		expect(events).toEqual(["attempt", "disarm"]);
		expect(answer.ok).toBe(disposition === "success");
		expect(answer.message).toContain(disposition === "throw" ? "lost arm response" : disposition);
	}
});

test("failed or throwing disarm fails the scenario and retains the original evidence", async () => {
	for (const originalPassed of [true, false]) {
		for (const throws of [true, false]) {
			const answer = await withProxyDisarmed(async () => ({ ok: originalPassed, message: "original evidence" }), async () => {
				if (throws) throw new Error("control unavailable");
				return { ok: false, message: "control refused" };
			});
			expect(answer.ok).toBe(false);
			expect(answer.message).toContain("original evidence");
			expect(answer.message).toContain(throws ? "control unavailable" : "control refused");
		}
	}
});

test("resume quotes the original operation and observed recovery preconditions", () => {
	expect(recoveryArguments("original-operation", parked)).toEqual({ ok: true, arguments: [
		"operation-restart", "--operation", "original-operation", "--expected-revision", "3",
		"--expected-category", "ambiguous_submission",
	] });
});

test("a missing, changed or unrepresentable recovery observation cannot be resumed", () => {
	for (const changed of [
		{ outcome: "operation_result" }, { category: "artifact_transfer" }, { category: undefined },
		{ revision: undefined }, { revision: "3" }, { revision: -1 }, { revision: 1.5 },
		{ revision: Number.MAX_SAFE_INTEGER + 1 }, { revision: Infinity }, { revision: NaN },
	]) expect(recoveryArguments("original-operation", { ...parked, ...changed }).ok).toBe(false);
	expect(recoveryArguments("", parked).ok).toBe(false);
});
