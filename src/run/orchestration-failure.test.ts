// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana
import { expect, test } from "bun:test";

test.each(["author", "image", "network", "scenario", "inventory"])("%s exception retains available evidence and independent teardown failure", async (stage) => {
	const modulePath = (relative: string) => new URL(relative, import.meta.url).pathname;
	const root = modulePath("../../");
	const source = `
		import { mock } from "bun:test";
		import { readdir } from "node:fs/promises";
		const actions = [];
		mock.module(${JSON.stringify(modulePath("../harness/recover-containers.ts"))}, () => ({
			recoverRunContainers: async () => { actions.push("recover containers"); return { ok: true }; },
			recoverRunNetworks: async () => { actions.push("recover networks"); return { ok: true }; },
		}));
		const requireDeadline = deadline => { if (!Number.isFinite(deadline) || deadline <= Date.now()) throw new Error("cleanup has no future host deadline"); };
		const handle = { ok: true, id: "fixture", stop: async (_grace, deadline) => { requireDeadline(deadline); actions.push("stop"); return { ok: true }; },
			remove: async deadline => { requireDeadline(deadline); actions.push("remove"); return { ok: true }; } };
		globalThis.fetch = async () => new Response("", { status: 200 });
		const files = (await readdir(${JSON.stringify(root + "src/scenarios")})).filter(file => file.endsWith(".scenario.ts")).sort();
		if (${JSON.stringify(stage)} === "inventory") {
			const filesystem = { ...await import("node:fs/promises") };
			mock.module("node:fs/promises", () => ({ ...filesystem, readdir: async () => { throw new Error("fixture inventory failure"); } }));
		}
		for (const [index, file] of files.entries()) {
			mock.module(${JSON.stringify(root + "src/scenarios/")} + file, () => ({ scenario: { run: async () => {
				if (index === 1) throw new Error("fixture scenario failure");
				return { ok: true, message: "fixture passed" };
			} } }));
		}
		mock.module(${JSON.stringify(modulePath("../sides/pinning.ts"))}, () => ({
			readSideDocument: () => ({}),
			resolveSide: (name) => ({ resolved: { source: "candidate", name, path: "/fixture",
				digest: "a".repeat(64), commit: "b".repeat(40) } }),
		}));
		mock.module(${JSON.stringify(modulePath("../harness/podman.ts"))}, () => ({ runPodman: async (_command, options) => {
			requireDeadline(options.deadline);
			if (${JSON.stringify(stage)} === "image") return { ok: false, reason: "deadline", message: "fixture image failure" };
			return { ok: true };
		} }));
		mock.module(${JSON.stringify(modulePath("../harness/container.ts"))}, () => ({
			createNetwork: async (name, options) => {
				requireDeadline(options.deadline);
				if (${JSON.stringify(stage)} === "network") throw new Error("fixture network failure");
				return { ok: true, name };
			},
			removeNetwork: async (_name, options) => { requireDeadline(options.deadline); actions.push("remove network"); return { ok: true }; },
			checkForLeaks: async options => { requireDeadline(options.deadline); actions.push("check leaks"); return { ok: false, message: "fixture leak" }; },
			startContainer: async () => handle,
		}));
		mock.module(${JSON.stringify(modulePath("../sides/agent-runtime.ts"))}, () => ({
			startSlingRuntime: async (options) => {
				options.configurationObserved([{ name: "verified-fixture.cfg.json", digest: "c".repeat(64) }]);
				if (${JSON.stringify(stage)} === "author") throw new Error("fixture author failure");
				return { ok: true, handle };
			},
		}));
		mock.module(${JSON.stringify(modulePath("../sides/client-runtime.ts"))}, () => ({
			verifyReleaseArchive: async () => ({ ok: true }),
			extractExecutable: async () => ({ ok: true, path: "/fixture" }),
			startClientRunner: async () => ({ ok: true, handle }),
		}));
		const { runInterop } = await import(${JSON.stringify(modulePath("./orchestration.ts"))});
		if (${JSON.stringify(stage)} === "author") Date.now = () => 100;
		const options = { images: {
			"tier-sling": { identifier: "fixture@sling" }, "client-runner": { identifier: "fixture@runner" },
			"severance-proxy": { identifier: "fixture@proxy" },
		} };
		const outcome = await runInterop(${JSON.stringify(root)}, options);
		const originalActions = [...actions];
		const repeatLabel = ${JSON.stringify(stage)} === "author"
			? (await runInterop(${JSON.stringify(root)}, options)).data.label : undefined;
		console.log(JSON.stringify({ outcome, actions: originalActions, repeatLabel }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const { outcome, actions, repeatLabel } = JSON.parse(stdout);
	if (stage === "author") expect(repeatLabel).not.toBe(outcome.data.label);
	expect(actions).toEqual(stage === "scenario"
		? ["stop", "remove", "stop", "remove", "stop", "remove", "recover containers", "remove network", "recover networks", "check leaks"]
		: stage === "author" ? ["recover containers", "remove network", "recover networks", "check leaks"] : ["recover containers", "recover networks", "check leaks"]);
	expect(outcome.ok).toBe(false);
	expect(outcome.data.failures).toHaveLength(2);
	expect(outcome.data.failures[0]).toContain(`fixture ${stage} failure`);
	if (stage === "image") expect(outcome.data.failures[0]).not.toContain("is missing");
	expect(outcome.data.failures[1]).toBe("leak check: fixture leak");
	if (stage === "inventory") expect(outcome.data.scenarios).toEqual([]);
	else expect(outcome.data.scenarios.length).toBeGreaterThan(0);
	expect(outcome.data.sides.agent.digest).toBe("a".repeat(64));
	expect(outcome.data.sides.slingshot.commit).toBe("b".repeat(40));
	if (stage === "author" || stage === "scenario") {
		expect(outcome.data.agentConfiguration).toEqual([{ name: "verified-fixture.cfg.json", digest: "c".repeat(64) }]);
	} else {
		expect(outcome.data.agentConfiguration).toBeUndefined();
	}
	if (stage === "scenario") {
		expect(outcome.data.scenarios[0].ok).toBe(true);
		expect(outcome.data.scenarios[0].message).toBe("fixture passed");
		expect(outcome.data.scenarios[1].reason).toBe("SCENARIO_EXCEPTION");
		expect(outcome.data.scenarios[1].message).toBe("fixture scenario failure");
	}
	for (const scenario of outcome.data.scenarios.slice(stage === "scenario" ? 2 : 0)) {
		expect(scenario.ok).toBe(false);
		expect(scenario.reason).toBe("NOT_RUN");
		expect(scenario.message).toContain(`fixture ${stage} failure`);
	}
});
