// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startContainer, removeNetwork, checkForLeaks } from "./container.ts";
import { startClientRunner, type StartClientRunnerOptions } from "../sides/client-runtime.ts";

test.each(["container", "client"])("%s cleanup interrupts stalled host commands", async (kind) => {
	const directory = await mkdtemp(join(tmpdir(), "cleanup-deadline-"));
	try {
		const executable = join(directory, "engine");
		await writeFile(executable, `#!/bin/sh
case "$1" in
run) printf '%s\\n' '${"a".repeat(64)}' ;;
exec) exit 0 ;;
*) exec sleep 300 ;;
esac
`, { mode: 0o700 });
		const options = {
			image: "fixture", network: "fixture", labelKey: "fixture", labelValue: "fixture",
			executable, captureDirectory: directory, captureLimitBytes: 1024,
			deadline: new Date(Date.now() + 5000), probeIntervalSeconds: 0, stopGraceSeconds: 0,
			cleanupTimeoutSeconds: 1,
			command: [], probe: async () => true,
		};
		const started = kind === "container" ? await startContainer(options)
			: await startClientRunner({ ...options, executablePath: "/fixture", scratchHome: { homePath: directory },
				values: { label: { key: "fixture" }, capture: { maximumBytes: 1024 }, readiness: { pollIntervalSeconds: 0 } },
			} as unknown as StartClientRunnerOptions);
		expect(started.ok).toBe(true);
		if (!started.ok) throw new Error(started.message);
		const handle = "handle" in started ? started.handle : started;
		for (const invoke of [
			() => handle.stop(0, Date.now() + 100),
			() => handle.remove(Date.now() + 100),
			() => handle.captureLogs(Date.now() + 100),
		]) {
			const outcome = await invoke();
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) expect(outcome.reason).toBe("deadline");
		}
		const removed = await removeNetwork("fixture", { ...options, deadline: Date.now() + 100 });
		expect(removed.ok).toBe(false);
		if (!removed.ok) expect(removed.reason).toBe("deadline");
		const leaks = await checkForLeaks({ ...options, deadline: Date.now() + 100 });
		expect(leaks.ok).toBe(false);
		if (!leaks.ok) expect(leaks.message).toContain("deadline");
	} finally { await rm(directory, { recursive: true, force: true }); }
}, 10_000);
