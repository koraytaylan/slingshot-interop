// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

const modulePath = (name: string) => JSON.stringify(new URL(name, import.meta.url).pathname);
for (const mode of ["success", "digest", "length", "duplicate", "fetch", "cleanup"] as const) {
	test(`structured result uses bounded verified client bytes and cleanup: ${mode}`, async () => {
		const script = `
			import { mock } from "bun:test";
			import { createHash } from "node:crypto";
			const mode = ${JSON.stringify(mode)};
			const bytes = mode === "duplicate" ? '{"matches":[],"matches":[]}' : '{"matches":[],"complete":true,"examined_nodes":1}';
			const digest = createHash("sha256").update(bytes).digest("hex");
			const calls = [];
			mock.module(${modulePath("./support.ts")}, () => ({ runner: () => "runner", invoke: async (_handle, command) => {
				calls.push(command);
				if (command[0] === "cat") return { ok: true, exitCode: 0, stdout: bytes };
				if (command[0] === "rm") return { ok: mode !== "cleanup", exitCode: 0 };
				if (!command.includes(digest) && mode !== "digest") throw new Error("fetch did not bind digest");
				return { ok: mode !== "fetch", exitCode: 0, stdout: "{}" };
			} }));
			const { structuredResult } = await import(${modulePath("./structured-result.ts")});
			const options = { values: { capture: { maximumBytes: 1000 } } };
			const plain = { ok: true, outcome: "operation_result", result: { untouched: true } };
			if (await structuredResult({}, [], plain, options) !== plain) throw new Error("changed plain result");
			let answer; let error;
			try { answer = await structuredResult({}, ["--machine"], { ok: true, outcome: "structured_result_artifact_access", artifact: {
				artifact_identifier: "artifact", operation_identifier: "operation", content_digest: mode === "digest" ? "0".repeat(64) : digest,
				byte_length: bytes.length + (mode === "length" ? 1 : 0), media_type: "application/json",
			} }, options); } catch (failure) { error = failure.message; }
			console.log(JSON.stringify({ answer, error, calls }));
		`;
		const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
		const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		expect(status, stderr).toBe(0);
		const result = JSON.parse(stdout);
		expect(result.calls.at(-1)[0]).toBe("rm");
		expect(result.calls[0]).toContain("operation-artifact");
		if (mode === "success") {
			expect(result.error).toBeUndefined();
			expect(result.answer.result).toEqual({ matches: [], complete: true, examined_nodes: 1 });
		} else expect(result.error).toBeString();
	});
}
