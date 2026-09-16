// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

test.each(["client", "container"].flatMap(kind => ["run-stalled", "probe-stalled", "cleanup-stalled", "remove-stalled", "log-preserved"].map(mode => [kind, mode])))("%s startup bounds host work and preserves cleanup evidence: %s", async (kind, mode) => {
	const source = `
		import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
		import { startClientRunner } from ${JSON.stringify(new URL("./client-runtime.ts", import.meta.url).pathname)};
		import { startContainer } from ${JSON.stringify(new URL("../harness/container.ts", import.meta.url).pathname)};
		import { runPodman } from ${JSON.stringify(new URL("../harness/podman.ts", import.meta.url).pathname)};
		const directory = await mkdtemp("/tmp/client-startup-deadline-");
		const callsPath = directory + "/calls";
		const mode = ${JSON.stringify(mode)};
		const executable = directory + "/engine";
		const engine = '#!' + process.execPath + '\\n' +
			'import { appendFileSync } from "node:fs"; const verb = process.argv[2]; appendFileSync(' + JSON.stringify(callsPath) + ', verb + "\\\\n");' +
			'const mode = ' + JSON.stringify(mode) + ';' +
			'if (mode === "run-stalled" || verb === "exec" && mode === "probe-stalled" || ["kill", "logs", "rm"].includes(verb) && mode === "cleanup-stalled" || verb === "rm" && mode === "remove-stalled") setInterval(() => {}, 1000);' +
			'else if (verb === "run") console.log("a".repeat(64)); else if (verb === "exec") process.exit(1); else console.log(verb === "logs" ? "fixture-startup-log" : "cleanup-output");';
		await writeFile(executable, engine, { mode: 0o700 });
		try {
			const options = { executable, executablePath: "/fixture", captureDirectory: directory,
				image: "fixture", network: "fixture", labelValue: "fixture", scratchHome: { homePath: directory }, deadline: new Date(Date.now() + 150),
				values: { label: { key: "fixture" }, capture: { maximumBytes: 1024 }, readiness: { pollIntervalSeconds: 0.01, harnessSeconds: 0.1 } } };
			const answer = ${JSON.stringify(kind)} === "client" ? await startClientRunner(options) : await startContainer({ ...options,
				labelKey: "fixture", captureLimitBytes: 1024, cleanupTimeoutSeconds: 0.1, stopGraceSeconds: 0, command: [], probeIntervalSeconds: 0.01,
				probe: async (id, deadline) => (await runPodman(["exec", id], { executable, deadline, captureLimitBytes: 1024,
					captureDirectory: await mkdtemp(directory + "/probe-") })).ok,
			});
			console.log(JSON.stringify({ answer, calls: (await readFile(callsPath, "utf8")).trim().split("\\n") }));
		} finally { await rm(directory, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn(["timeout", "--signal=KILL", "5s", process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const { answer, calls } = JSON.parse(stdout);
	expect(answer.ok).toBe(false);
	expect(answer.reason).toBe(mode === "run-stalled" ? "START_FAILED" : "NEVER_BECAME_READY");
	if (mode !== "run-stalled") expect(calls.slice(-3)).toEqual(["kill", "logs", "rm"]);
	if (mode === "log-preserved") expect(answer.logTail).toBe("fixture-startup-log\n");
	if (mode === "cleanup-stalled") expect(answer.message).toContain("deadline");
	if (mode === "remove-stalled") {
		expect(answer.logTail).toBe("fixture-startup-log\n");
		expect(answer.message).toContain("removal: The host invocation deadline expired");
	}
}, 10_000);
