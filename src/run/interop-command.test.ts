// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.each(["missing-images", "malformed-images", "orchestration-throw", "unresolved"])("early refusal leaves an honest report: %s", async mode => {
	const root = await mkdtemp(join(tmpdir(), "interop-early-refusal-"));
	try {
		await mkdir(join(root, "support"));
		if (mode !== "missing-images") await writeFile(join(root, "support/interop-images.toml"), mode === "malformed-images" ? "[broken" :
			["tier-sling", "client-runner", "severance-proxy"].map(name => `[${name}]\nname="${name}"\nidentifier="sha256:test"\n`).join("\n"));
		const source = `import { mock } from "bun:test";
			mock.module(${JSON.stringify(new URL("./orchestration.ts", import.meta.url).pathname)}, () => ({ runInterop: async () => {
				if (${JSON.stringify(mode)} === "orchestration-throw") throw new Error("invalid side input");
				return { ok: false, reason: "SIDE_UNRESOLVED", refusals: [{ side: "agent", ownerStep: "supply acknowledged bytes" }] };
			} }));
			await import(${JSON.stringify(new URL("../../scripts/interop", import.meta.url).pathname)});`;
		const child = Bun.spawn([process.execPath, "--eval", source], { cwd: root, stdout: "pipe", stderr: "pipe" });
		const [exit, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect(exit).toBe(1);
		expect(stderr.length).toBeGreaterThan(0);
		const reports = (await readdir(root)).filter(name => name.endsWith(".toml"));
		expect(reports).toHaveLength(1);
		const report = Bun.TOML.parse(await readFile(join(root, reports[0]!), "utf8")) as Record<string, unknown>;
		expect(report["status"]).toBe("refused");
		expect(report["stage"]).toBe(mode.endsWith("images") ? "prepare-inputs" : mode === "unresolved" ? "side-resolution" : "orchestration");
		expect(report["sides"]).toBeUndefined();
		expect(report["scenarios"]).toBeUndefined();
		if (mode === "unresolved") expect(report["message"]).toContain("supply acknowledged bytes");
	} finally { await rm(root, { recursive: true, force: true }); }
});

test.each([true, false])("the command preserves failed evidence when orchestration completes=%s", async (completed) => {
	const root = await mkdtemp(join(tmpdir(), "interop-command-"));
	const orchestration = new URL("./orchestration.ts", import.meta.url).pathname;
	const command = new URL("../../scripts/interop", import.meta.url).pathname;
	const side = { source: "candidate", name: "slingshot", path: "/original/candidate", digest: "a".repeat(64), commit: "b".repeat(40) };
	const data = {
		label: "run-command-test",
		sides: { slingshot: side, agent: { ...side, name: "agent" } },
		images: {},
		scenarios: [{ scenario: "broken.scenario.ts", ok: false, message: "failure: first line\nsecond line (detail)" }],
	};
	try {
		await mkdir(join(root, "support"));
		await writeFile(join(root, "support/interop-images.toml"), ["tier-sling", "client-runner", "severance-proxy"].map((name) => `[${name}]\nname = "${name}"\nidentifier = "sha256:test"\n`).join("\n"));
		// No side documents exist here: the command must use the run's
		// original resolved evidence, not resolve mutable inputs a second time.
		const source = `import { mock } from "bun:test";
			mock.module(${JSON.stringify(orchestration)}, () => ({
				runInterop: async () => (${JSON.stringify(completed
					? { ok: true, report: "completed with a failed scenario", data }
					: { ok: false, reason: "SETUP_FAILED", message: "setup interrupted", data })})
			}));
			await import(${JSON.stringify(command)});`;
		const child = Bun.spawn([process.execPath, "--eval", source], { cwd: root, stdout: "pipe", stderr: "pipe" });
		const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect(stderr).toBe(completed ? "" : "Run failed: setup interrupted\n");
		expect(exit).toBe(1);
		if (completed) expect(stdout).toContain("completed with a failed scenario");
		const saved = Bun.TOML.parse(await readFile(join(root, data.label + ".toml"), "utf8"));
		expect(saved).toEqual(data);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
