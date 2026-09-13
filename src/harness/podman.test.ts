// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPodman } from "./podman.ts";

// The tests run whatever engine the machine has for the happy path; the
// refusal and bound cases are proven with a shell executable whose behavior
// is fixed, so the suite holds on a machine without rootless Podman.
const shell = Bun.which("sh") ?? Bun.which("bash") ?? "/bin/sh";

async function captureDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "podman-test-"));
}

const limitBytes = 1024;

describe("runPodman", () => {
	test("a version query succeeds", async () => {
		const directory = await captureDirectory();
		try {
			// On a machine with rootless Podman the real engine answers; on one
			// without, a shell stand-in proves the wrapper types a clean exit as
			// a result either way.
			const podman = Bun.which("podman");
			const outcome = podman
				? await runPodman(["--version"], {
						executable: podman,
						captureLimitBytes: limitBytes,
						captureDirectory: directory,
					})
				: await runPodman(["-c", "echo podman version 5.0.0"], {
						executable: shell,
						captureLimitBytes: limitBytes,
						captureDirectory: directory,
					});
			expect(outcome.ok).toBe(true);
			if (!outcome.ok) {
				throw new Error("version query unexpectedly refused");
			}
			expect(outcome.exitCode).toBe(0);
			const stdout = await readFile(outcome.stdoutPath, "utf8");
			expect(stdout.length).toBeGreaterThan(0);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("a failing subcommand surfaces the typed refusal with its captured output", async () => {
		const directory = await captureDirectory();
		try {
			const outcome = await runPodman(["-c", "echo to-stderr-tail >&2; echo to-stdout-tail; exit 7"], {
				executable: shell,
				captureLimitBytes: limitBytes,
				captureDirectory: directory,
			});
			expect(outcome.ok).toBe(false);
			if (outcome.ok) {
				throw new Error("unexpected result");
			}
			expect(outcome.reason).toBe("failed");
			expect(outcome.command).toEqual([shell, "-c", "echo to-stderr-tail >&2; echo to-stdout-tail; exit 7"]);
			expect(outcome.stdoutTail).toBe("to-stdout-tail\n");
			expect(outcome.stderrTail).toBe("to-stderr-tail\n");
			expect(outcome.message).toContain("exited with code 7");
			expect(outcome.message).toContain("to-stdout-tail");
			expect(outcome.message).toContain("to-stderr-tail");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("output beyond the capture bound keeps exactly the bound and still reports", async () => {
		const directory = await captureDirectory();
		try {
			// 40 bytes per line, 100 lines: 4000 bytes per stream, far past the bound.
			const outcome = await runPodman(["-c", "i=0; while [ $i -lt 100 ]; do echo 0123456789012345678901234567890123456789; i=$((i+1)); done; exit 3"], {
				executable: shell,
				captureLimitBytes: 1024,
				captureDirectory: directory,
			});
			expect(outcome.ok).toBe(false);
			if (outcome.ok) {
				throw new Error("unexpected result");
			}
			expect(outcome.reason).toBe("failed");
			expect(outcome.stdoutTail).toHaveLength(1024);
			expect(outcome.stderrTail).toHaveLength(0);
			const stdout = await readFile(outcome.stdoutPath);
			expect(stdout.byteLength).toBe(1024);
			// The captured bytes are the first bound bytes of the stream, and the
			// refusal still names the command and carries the tail.
			expect(stdout.toString("utf8").startsWith("0123456789012345678901234567890123456789")).toBe(true);
			expect(outcome.message).toContain("exited with code 3");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("an absent executable is refused distinctly with one sentence", async () => {
		const directory = await captureDirectory();
		try {
			const outcome = await runPodman(["--version"], {
				executable: join(directory, "no-such-podman"),
				captureLimitBytes: limitBytes,
				captureDirectory: directory,
			});
			expect(outcome.ok).toBe(false);
			if (outcome.ok) {
				throw new Error("unexpected result");
			}
			expect(outcome.reason).toBe("missing");
			const sentences = outcome.message.trim().split(/[.!?]/).filter((s) => s.length > 0);
			expect(sentences).toHaveLength(1);
			expect(outcome.message).toContain("no-such-podman");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});