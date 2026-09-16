// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["container", "network"].flatMap(kind => ["owned", "wrong-label", "bad-id", "duplicate-label", "list-refused", "remove-refused", "mixed-ownership"].map(mode => [kind, mode])))("%s recovery validates ownership before deletion: %s", async (kind, mode) => {
	const source = `
		import { mock } from "bun:test";
		import { mkdtemp, writeFile, rm } from "node:fs/promises";
		const directory = await mkdtemp("/tmp/recovery-scope-");
		const mode = ${JSON.stringify(mode)};
		const kind = ${JSON.stringify(kind)};
		const label = "run-" + crypto.randomUUID();
		const identifier = "a".repeat(64);
		const commands = [];
		mock.module(${JSON.stringify(new URL("./podman.ts", import.meta.url).pathname)}, () => ({ runPodman: async (command, options) => {
			commands.push(command);
			const verb = command[0] === "network" ? command[1] : command[0];
			if (!options.requireCompleteCapture || !Number.isFinite(options.deadline)) throw new Error("unbounded recovery evidence");
			if (mode === "list-refused" && ["ps", "ls"].includes(verb) || mode === "remove-refused" && verb === "rm") return { ok: false, message: "fixture refusal" };
			const stdoutPath = options.captureDirectory + "/stdout";
			const wrongOwner = mode === "wrong-label" || mode === "mixed-ownership" && command.at(-1) === identifier;
			const labels = JSON.stringify({ fixture: wrongOwner ? "another-run" : label });
			await writeFile(stdoutPath, ["ps", "ls"].includes(verb) ? (mode === "bad-id" ? "--all" : identifier) + "\\n" + (mode === "mixed-ownership" ? "b".repeat(64) + "\\n" : "")
				: verb === "inspect" ? (mode === "duplicate-label" ? '{"fixture":"another-run",' + labels.slice(1) : labels) : "");
			return { ok: true, stdoutPath };
		} }));
		try {
			const { recoverRunContainers, recoverRunNetworks } = await import(${JSON.stringify(new URL("./recover-containers.ts", import.meta.url).pathname)});
			const recover = kind === "network" ? recoverRunNetworks : recoverRunContainers;
			const answer = await recover({ labelKey: "fixture", labelValue: label, captureLimitBytes: 1024, captureDirectory: directory, deadline: Date.now() + 1000 });
			console.log(JSON.stringify({ answer, commands, label, identifier }));
		} finally { await rm(directory, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { answer, commands, label, identifier } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "owned");
	expect(commands[0]).toEqual([...(kind === "network" ? ["network", "ls"] : ["ps", "-a"]), "--no-trunc", "--filter", `label=fixture=${label}`, "--format", "{{.ID}}"]);
	const removal = kind === "network" ? ["network", "rm"] : ["rm", "-f", "-t", "0"];
	expect(commands.filter((command: string[]) => command.includes("rm")))
		.toEqual(mode === "mixed-ownership" ? [[...removal, "b".repeat(64)]]
			: mode === "owned" || mode === "remove-refused" ? [[...removal, identifier]] : []);
});
