// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["container", "client"])("%s startup rejects readiness at or after its deadline", async (kind) => {
	const source = `
		import { mock } from "bun:test";
		import { mkdtemp, rm, writeFile } from "node:fs/promises";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		const root = await mkdtemp(join(tmpdir(), "startup-deadline-"));
		let now = 100;
		let completion = 100;
		let probes = 0;
		let calls = [];
		let expectedDeadline;
		Date.now = () => now;
		mock.module(${JSON.stringify(new URL("./podman.ts", import.meta.url).pathname)}, () => ({
			runPodman: async (command, options) => {
				if (expectedDeadline !== undefined && options.deadline !== expectedDeadline) throw new Error("cleanup lost its host deadline");
				calls.push(command);
				if (command[0] === "exec") { probes++; now = completion; }
				const directory = await mkdtemp(join(root, "capture-"));
				const stdoutPath = join(directory, "stdout");
				const stderrPath = join(directory, "stderr");
				await writeFile(stdoutPath, command[0] === "run" ? "a".repeat(64) : "");
				await writeFile(stderrPath, "");
				return { ok: true, command, exitCode: 0, stdoutPath, stderrPath };
			},
		}));
		const { startContainer } = await import(${JSON.stringify(new URL("./container.ts", import.meta.url).pathname)});
		const { startClientRunner } = await import(${JSON.stringify(new URL("../sides/client-runtime.ts", import.meta.url).pathname)});
		const results = [];
		try {
			for (const mode of ["before", "exact", "after", "already-expired"]) {
				now = mode === "already-expired" ? 101 : 100;
				completion = mode === "before" ? 100 : mode === "after" ? 102 : 101;
				probes = 0; calls = [];
				const common = { image: "fixture", labelKey: "fixture", labelValue: "fixture", network: "fixture",
					captureDirectory: root, captureLimitBytes: 1024, deadline: new Date(101), stopGraceSeconds: 0,
					cleanupTimeoutSeconds: 1,
					probeIntervalSeconds: 0, command: [], probe: async () => { probes++; now = completion; return true; } };
				const answer = ${JSON.stringify(kind)} === "container" ? await startContainer(common)
					: await startClientRunner({ ...common, executablePath: "/fixture", scratchHome: { homePath: root },
						values: { label: { key: "fixture" }, capture: { maximumBytes: 1024 }, readiness: { pollIntervalSeconds: 0 } } });
				results.push({ ok: answer.ok, reason: answer.reason, probes, removed: calls.some(command => command[0] === "rm") });
				if (answer.ok) {
					const handle = answer.handle ?? answer;
					expectedDeadline = 201;
					await handle.stop(0, expectedDeadline);
					expectedDeadline = 202;
					await handle.remove(expectedDeadline);
					expectedDeadline = 203;
					await handle.captureLogs(expectedDeadline);
					expectedDeadline = undefined;
				}
			}
			console.log(JSON.stringify(results));
		} finally { await rm(root, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	expect(JSON.parse(stdout)).toEqual([
		{ ok: true, probes: 1, removed: false },
		{ ok: false, reason: "NEVER_BECAME_READY", probes: 1, removed: true },
		{ ok: false, reason: "NEVER_BECAME_READY", probes: 1, removed: true },
		{ ok: false, reason: "NEVER_BECAME_READY", probes: 0, removed: true },
	]);
});
