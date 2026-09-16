// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test("ordinary invocations carry a bounded deadline and preserve arguments and stdin", async () => {
	const source = `
		import { mock } from "bun:test";
		const calls = [];
		Date.now = () => 100;
		mock.module(${JSON.stringify(new URL("../sides/client-runtime.ts", import.meta.url).pathname)}, () => ({
			runnerExecutablePath: "runner", parseMachineEnvelope: JSON.parse,
			execInContainer: async (id, command, options, stdin, deadline) => {
				calls.push({ id, command, stdin: Array.from(stdin ?? []), deadline });
				return { ok: true, exitCode: 0, stdout: "complete", stderr: "" };
			},
		}));
		const { invoke } = await import(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)});
		const options = { values: { readiness: { harnessSeconds: 2 } } };
		const command = ["runner", "literal ' quote", "$not-expanded", "space value"];
		const normal = await invoke({ id: "fixture" }, command, options, new Uint8Array([0, 10, 255]));
		const explicit = await invoke({ id: "fixture" }, command, options, undefined, 101);
		const invalid = await invoke({ id: "fixture" }, command, { values: { readiness: { harnessSeconds: 0 } } });
		console.log(JSON.stringify({ calls, normal, explicit, invalid, command }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { calls, normal, explicit, invalid, command } = JSON.parse(stdout);
	expect(normal.ok && explicit.ok && !invalid.ok).toBe(true);
	expect(calls).toHaveLength(2);
	expect(calls.map((call: { deadline: number }) => call.deadline)).toEqual([2100, 101]);
	for (const call of calls) {
		expect(call.command.slice(0, 2)).toEqual(["sh", "-c"]);
		expect(call.command.slice(3)).toEqual(["observation-deadline", String(call.deadline), ...command]);
	}
	expect(calls[0].stdin).toEqual([0, 10, 255]);
});
