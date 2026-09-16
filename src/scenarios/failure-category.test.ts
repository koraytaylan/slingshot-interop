// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["declared", "transport", "reclassified", "missing-metadata", "success", "agent-success", "agent-other", "malformed-canonical", "missing-canonical", "wrong-target", "missing-target", "surplus-failure", "duplicate-category", "duplicate-target"])("failure category is compared on both sides: %s", async (mode) => {
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const observed = [];
		const metadata = mode === "transport" ? "transport_error" : mode === "reclassified" ? "another_category" : "template_not_found";
		const failure = mode === "missing-metadata" ? {} : { metadata };
		const category = mode === "agent-other" ? "another_category" : "template_not_found";
		const canonical = { failure: category, target_path: mode === "wrong-target" ? "/other" : "/content/interop/fixture/failing" };
		if (mode === "missing-target") delete canonical.target_path;
		if (mode === "surplus-failure") canonical.extra = true;
		let canonicalText = JSON.stringify(canonical);
		if (mode === "duplicate-category") canonicalText = canonicalText.replace('{', '{"failure":"other",');
		if (mode === "duplicate-target") canonicalText = canonicalText.replace('{', '{"target_path":"/other",');
		const terminal_failure = mode === "missing-canonical" ? {} : { canonical_failure: mode === "malformed-canonical" ? "broken" : canonicalText };
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner", machineArguments: () => [],
			invoke: async (_handle, command) => {
				observed.push(command);
				return { ok: true, exitCode: 0, stderr: "", stdout: JSON.stringify({ outcome: "operation_receipt", operation_identifier: "original" }) };
			},
			envelope: stdout => JSON.parse(stdout),
			waitTerminal: async (_handle, _machine, identifier) => {
				observed.push(["wait", identifier]);
				return { ok: true, envelope: { outcome: mode === "success" ? "operation_result" : "operation_terminal_error", failure } };
			},
			resolveAgentOperationIdentifier: async (_options, _profile, identifier) => {
				observed.push(["resolve", identifier]); return { ok: true, agentOperationIdentifier: "remote-original", targetDigest: "e".repeat(64) };
			},
			agentSnapshot: async (_options, identifier, target) => {
				observed.push(["snapshot", identifier, target]);
				return { ok: true, snapshot: { kind: mode === "agent-success" ? "succeeded" : "failed", terminal_failure } };
			},
		}));
		const { scenario } = await import(${JSON.stringify(new URL("./failure-category.scenario.ts", import.meta.url).pathname)});
		const answer = await scenario.run({}, { labelValue: "fixture", scratchHome: { profileName: "fixture" }, values: { readiness: { harnessSeconds: 1 } } });
		console.log(JSON.stringify({ answer, observed }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { answer, observed } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "declared");
	expect(observed.find((event: string[]) => event[0] === "wait")).toEqual(["wait", "original"]);
	if (mode === "declared") {
		expect(observed.find((event: string[]) => event[0] === "resolve")).toEqual(["resolve", "original"]);
		expect(observed.find((event: string[]) => event[0] === "snapshot")).toEqual(["snapshot", "remote-original", "e".repeat(64)]);
	}
});
