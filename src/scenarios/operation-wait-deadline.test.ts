// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["direct", "status", "result"])("operation %s answers must complete before the deadline", async (phase) => {
	const source = `
		import { mock } from "bun:test";
		const phase = ${JSON.stringify(phase)};
		let now = 100;
		let completion = 100;
		let calls = 0;
		Date.now = () => now;
		mock.module(${JSON.stringify(new URL("../sides/client-runtime.ts", import.meta.url).pathname)}, () => ({
			runnerExecutablePath: "runner", parseMachineEnvelope: JSON.parse,
			execInContainer: async (_id, command, _options, _stdin, deadline) => {
				if (deadline !== 101) throw new Error("observation lost its host deadline");
				calls += 1;
				const resultRead = command.includes("operation-result");
				if (phase !== "result" || resultRead) now = completion;
				const answer = phase !== "direct" && !resultRead
					? { outcome: "operation_status", state: "terminal", revision: 1 }
					: { outcome: "operation_result", result: {} };
				return { ok: true, exitCode: 0, stdout: JSON.stringify(answer), stderr: "" };
			},
		}));
		const { waitTerminal } = await import(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)});
		const results = [];
		for (completion of [100, 101, 102]) {
			now = 100; calls = 0;
			const answer = await waitTerminal({ id: "fixture" }, [], "operation", { values: { readiness: { pollIntervalSeconds: 0 } } }, 1);
			results.push({ ok: answer.ok, calls });
		}
		console.log(JSON.stringify(results));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	expect(JSON.parse(stdout)).toEqual([
		{ ok: true, calls: phase === "direct" ? 1 : 2 },
		{ ok: false, calls: phase === "result" ? 2 : 1 },
		{ ok: false, calls: phase === "result" ? 2 : 1 },
	]);
});
