// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPodman } from "../harness/podman.ts";
import { execInContainer, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { invoke, invokeBeforeDeadline } from "./support.ts";

test.each(["direct", "delayed", "ordinary"])("an observation deadline kills the in-container waiter and leaves its container usable: %s", async (dispatch) => {
	const directory = await mkdtemp(join(tmpdir(), "observation-timeout-"));
	const pins = Bun.TOML.parse(await Bun.file(new URL("../../support/interop-images.toml", import.meta.url)).text()) as Record<string, { name: string; identifier: string }>;
	const pin = pins["client-runner"]!;
	const capture = { captureLimitBytes: 4096, captureDirectory: directory };
	let identifier: string | undefined;
	try {
		const started = await runPodman(["run", "--detach", "--network", "none", `${pin.name}@${pin.identifier}`, "sleep", "600"], capture);
		expect(started.ok).toBe(true);
		identifier = (await readFile(started.stdoutPath, "utf8")).trim();
		expect(identifier).toMatch(/^[0-9a-f]{64}$/);
		const options = { captureDirectory: directory, values: { capture: { maximumBytes: 4096 }, readiness: { harnessSeconds: 2 } } } as StartClientRunnerOptions;
		const handle = { id: identifier } as Parameters<typeof invokeBeforeDeadline>[0];
		const deadline = Date.now() + 2000;
		let observingOptions = options;
		if (dispatch === "delayed") {
			const executable = join(directory, "delayed-engine");
			// Spend half the observation budget before dispatch, exercising the
			// difference between host invocation and in-container command start.
			await writeFile(executable, `#!${process.execPath}
const dispatchAt = ${deadline - 1000};
while (Date.now() < dispatchAt) await Bun.sleep(Math.max(1, dispatchAt - Date.now()));
const child = Bun.spawn([${JSON.stringify(Bun.which("podman"))}, ...process.argv.slice(2)], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
process.exit(await child.exited);
`, { mode: 0o700 });
			observingOptions = { ...options, executable };
		}
		const command = ["sh", "-c", 'echo $$ > /tmp/observation-waiter.pid; trap "" TERM; while :; do :; done'];
		const timed = dispatch === "ordinary" ? await invoke(handle, command, options)
			: await invokeBeforeDeadline(handle, command, observingOptions, deadline);
		expect(timed.ok).toBe(false);
		// The helper retains no successful envelope on expiry. A second command
		// proves the container remains usable and no busy waiter survived.
		const checked = await runPodman(["exec", identifier, "sh", "-c", 'pid=$(cat /tmp/observation-waiter.pid) || exit 1; if [ -r "/proc/$pid/stat" ]; then read number name state rest < "/proc/$pid/stat"; [ "$state" = Z ] || exit 1; fi; echo usable'], capture);
		expect(checked.ok, JSON.stringify(checked)).toBe(true);
		expect(await readFile(checked.stdoutPath, "utf8")).toBe("usable\n");
		const completed = await invokeBeforeDeadline(handle, ["sh", "-c", "echo completed"], options, Date.now() + 10_000);
		expect(completed.ok && completed.exitCode === 0 && completed.stdout === "completed\n").toBe(true);
		const input = "literal ' quotes and $variables\n";
		const echoed = await invoke(handle, ["cat"], options, new TextEncoder().encode(input));
		expect(echoed.ok && echoed.exitCode === 0 && echoed.stdout === input).toBe(true);
		const answer = '{"outcome":"operation_result","result":{}}';
		const bounded = { ...options, values: { ...options.values, capture: { maximumBytes: Buffer.byteLength(answer) } } };
		for (const suffix of ["", "x"]) {
			const captured = await execInContainer(identifier, ["sh", "-c", 'printf %s "$1"', "fixture", answer + suffix], bounded);
			expect(captured.ok).toBe(suffix === "");
			if (!captured.ok) expect(captured.message).toContain("exceeded the capture byte bound");
		}
		for (const stream of ["stdout", "stderr"]) {
			const invalid = await execInContainer(identifier, ["sh", "-c", `printf '\\377'${stream === "stderr" ? " >&2" : ""}`], options);
			expect(invalid.ok).toBe(false);
			if (!invalid.ok) expect(invalid.message).toContain("UTF-8");
		}
		const unicode = "\uFEFFé";
		const preserved = await execInContainer(identifier, ["sh", "-c", 'printf %s "$1"', "fixture", unicode], options);
		expect(preserved.ok && preserved.stdout === unicode).toBe(true);
	} finally {
		if (identifier && /^[0-9a-f]{64}$/.test(identifier)) {
			const removed = await runPodman(["rm", "--force", identifier], capture);
			expect(removed.ok).toBe(true);
		}
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);
