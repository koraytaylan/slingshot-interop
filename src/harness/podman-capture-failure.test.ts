// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPodman } from "./podman.ts";

test.each([
	{ withDeadline: true, stream: "stdout" }, { withDeadline: false, stream: "stdout" },
	{ withDeadline: true, stream: "stderr" }, { withDeadline: false, stream: "stderr" },
])("capture write failure terminates the child and returns a refusal: %j", async ({ withDeadline, stream }) => {
	const directory = await mkdtemp(join(tmpdir(), "podman-capture-failure-"));
	const pidPath = join(directory, "child.pid");
	let identifier: number | undefined;
	try {
		// A real full device makes the file write fail after the child has started.
		await symlink("/dev/full", join(directory, stream));
		const engine = `await Bun.write(${JSON.stringify(pidPath)}, String(process.pid)); console.${stream === "stdout" ? "log" : "error"}("output"); setInterval(() => {}, 1000);`;
		let result: unknown;
		try {
			result = await runPodman(["--eval", engine], {
				executable: process.execPath, captureDirectory: directory, captureLimitBytes: 1024,
				...(withDeadline ? { deadline: Date.now() + 2000 } : {}),
			});
		} catch { result = "threw instead of refusing"; }
		identifier = Number(await readFile(pidPath, "utf8"));
		expect(Number.isSafeInteger(identifier) && identifier > 1).toBe(true);
		let alive = false;
		try { process.kill(identifier, 0); alive = true; }
		catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ESRCH") throw failure; }
		expect(alive).toBe(false);
		expect(result).toMatchObject({ ok: false, reason: "capture_failed", stdoutTail: "", stderrTail: "" });
	} finally {
		if (identifier !== undefined) {
			try { process.kill(identifier, "SIGKILL"); }
			catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ESRCH") throw failure; }
		}
		await rm(directory, { recursive: true, force: true });
	}
});
