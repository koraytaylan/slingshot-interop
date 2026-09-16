// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPodman } from "./podman.ts";

test("expired and invalid host deadlines refuse before spawning", async () => {
	const directory = await mkdtemp(join(tmpdir(), "podman-expired-"));
	try {
		for (const deadline of [Date.now() - 1, NaN, Infinity, Date.now() + 2 ** 32]) {
			const outcome = await runPodman(["--eval", 'console.log("must-not-run")'], {
				executable: process.execPath, captureDirectory: directory, captureLimitBytes: 1024, deadline,
			});
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) expect(outcome.reason).toBe("deadline");
			expect(await readFile(outcome.stdoutPath, "utf8")).toBe("");
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("an invocation completed before its host deadline retains its complete answer", async () => {
	const directory = await mkdtemp(join(tmpdir(), "podman-completed-"));
	try {
		const outcome = await runPodman(["--eval", 'console.log("complete")'], {
			executable: process.execPath, captureDirectory: directory, captureLimitBytes: 1024,
			deadline: Date.now() + 1000, requireCompleteCapture: true,
		});
		expect(outcome.ok).toBe(true);
		expect(await readFile(outcome.stdoutPath, "utf8")).toBe("complete\n");
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test.each(["engine-stalled", "inherited-pipes"])("host deadline terminates owned processes: %s", async (mode) => {
	const directory = await mkdtemp(join(tmpdir(), "podman-deadline-"));
	try {
		const engine = mode === "engine-stalled"
			? 'console.log(process.pid); setInterval(() => {}, 1000);'
			: 'const child = Bun.spawn([process.execPath, "--eval", "setInterval(() => {}, 1000)"], { stdin: "ignore", stdout: "inherit", stderr: "inherit" }); console.log(child.pid); process.exit(0);';
		const source = `import { runPodman } from ${JSON.stringify(new URL("./podman.ts", import.meta.url).pathname)};
			const outcome = await runPodman(["--eval", ${JSON.stringify(engine)}], {
				executable: process.execPath, captureDirectory: ${JSON.stringify(directory)},
				captureLimitBytes: 1024, deadline: Date.now() + 1000,
			}); console.log(JSON.stringify(outcome));`;
		// A separate process-group guard bounds the regression even before the
		// wrapper implements deadlines. It is not the deadline under test.
		const child = Bun.spawn(["timeout", "--signal=KILL", "5s", process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
		const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect(exit).toBe(0);
		expect(stderr).toBe("");
		const outcome = JSON.parse(stdout);
		expect(outcome.ok).toBe(false);
		expect(outcome.reason).toBe("deadline");
		const identifier = Number((await readFile(join(directory, "stdout"), "utf8")).trim());
		expect(Number.isSafeInteger(identifier) && identifier > 1).toBe(true);
		try {
			const status = await readFile(`/proc/${identifier}/stat`, "utf8");
			expect(status.slice(status.lastIndexOf(")") + 2).split(" ")[0]).toBe("Z");
		} catch (failure) {
			if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure;
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
}, 15_000);
