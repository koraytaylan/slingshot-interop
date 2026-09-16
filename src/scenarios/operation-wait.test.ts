// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["direct", "fallback", "failed-direct", "failed-status", "failed-result", "terminal-error", "recovery"])("operation waiting preserves exit evidence: %s", async (mode) => {
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		mock.module(${JSON.stringify(new URL("../sides/client-runtime.ts", import.meta.url).pathname)}, () => ({
			runnerExecutablePath: "runner", parseMachineEnvelope: JSON.parse,
			execInContainer: async (_id, command) => {
				const resultRead = command.includes("operation-result");
				const fallback = ["fallback", "failed-status", "failed-result"].includes(mode);
				const answer = fallback && !resultRead ? { outcome: "operation_status", state: "terminal", revision: 1 }
					: mode === "terminal-error" ? { outcome: "operation_terminal_error", disposition: "authoritative_non_execution", kind: "agent_rejection", failure: {} }
					: mode === "recovery" ? { outcome: "operation_recovery_required", category: "uncertain", evidence: "unknown", revision: 1 }
					: { outcome: "operation_result", result: { path: "/expected" } };
				const exitCode = mode === "failed-direct" || mode === "failed-status" && !resultRead || mode === "failed-result" && resultRead ? 7
					: mode === "terminal-error" ? 3 : mode === "recovery" ? 5 : 0;
				return { ok: true, exitCode, stdout: JSON.stringify(answer), stderr: "" };
			},
		}));
		const { waitTerminal } = await import(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)});
		console.log(JSON.stringify(await waitTerminal({ id: "fixture" }, [], "operation", { values: { readiness: { pollIntervalSeconds: 0 } } }, 1000)));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	expect(JSON.parse(stdout).ok).toBe(!mode.startsWith("failed-"));
});
