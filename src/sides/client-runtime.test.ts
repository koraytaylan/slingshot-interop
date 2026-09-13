// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, it, expect, mock } from "bun:test";
import {
	verifyReleaseArchive,
	extractExecutable,
	startClientRunner,
	proveClientSequence,
	type StartClientRunnerOptions,
	type VerifiedArchiveOutcome,
	type StartClientRunnerOutcome,
} from "./client-runtime.ts";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// Mock runPodman to avoid needing a real engine for the logic tests.
mock.module("../harness/podman.ts", () => ({
	runPodman: mock(),
}));

import { runPodman } from "../harness/podman.ts";

describe("Client Runtime", () => {
	describe("verifyReleaseArchive", () => {
		const archivePath = join(tmpdir(), "test-archive.tar.gz");
		const executableContent = "binary-bytes";
		const checksumsContent = `5891b806d2226981433328e35023d377d6d5e4003497254f8818430101010101  slingshot\n`;
		// The above is a fake hash for the example, I'll calculate real ones.

		async function createTestArchive(files: Record<string, string>) {
			const dir = join(tmpdir(), `archive-work-${Date.now()}`);
			await mkdir(dir, { recursive: true });
			for (const [name, content] of Object.entries(files)) {
				const filePath = join(dir, name);
				if (name.includes('/')) {
					await mkdir(join(dir, name.substring(0, name.lastIndexOf('/'))), { recursive: true });
				}
				await writeFile(filePath, content);
			}
			execSync(`tar -czf ${archivePath} -C ${dir} .`);
			await rm(dir, { recursive: true, force: true });
			return archivePath;
		}

		it("verifies a valid archive", async () => {
			const execBytes = new TextEncoder().encode(executableContent);
			const execHash = createHash("sha256").update(execBytes).digest("hex");
			const checksums = `${execHash}  slingshot\n`;
			
			await createTestArchive({
				"slingshot": executableContent,
				"SHA256SUMS": checksums,
			});

			const archiveBytes = await Bun.file(archivePath).bytes();
			const pinnedDigest = createHash("sha256").update(archiveBytes).digest("hex");

			const outcome = await verifyReleaseArchive(archivePath, pinnedDigest);
			expect(outcome.ok).toBe(true);
			if (outcome.ok) {
				expect(outcome.members.some(m => m.name.endsWith("slingshot"))).toBe(true);
			}
			await rm(archivePath);
		});

		it("refuses an archive with a differing digest", async () => {
			await createTestArchive({ "slingshot": "bin", "SHA256SUMS": "hash bin" });
			const outcome = await verifyReleaseArchive(archivePath, "wrong-digest");
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.reason).toBe("DIGEST_DIFFERING");
			}
			await rm(archivePath);
		});

		it("refuses an archive missing the checksums member", async () => {
			await createTestArchive({ "slingshot": "bin" });
			const archiveBytes = await Bun.file(archivePath).bytes();
			const pinnedDigest = createHash("sha256").update(archiveBytes).digest("hex");
			const outcome = await verifyReleaseArchive(archivePath, pinnedDigest);
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.reason).toBe("CHECKSUMS_MEMBER_ABSENT");
			}
			await rm(archivePath);
		});

		it("refuses an archive where checksums disagree", async () => {
			await createTestArchive({ 
				"slingshot": "bin", 
				"SHA256SUMS": "wrong-hash  slingshot\n" 
			});
			const archiveBytes = await Bun.file(archivePath).bytes();
			const pinnedDigest = createHash("sha256").update(archiveBytes).digest("hex");
			const outcome = await verifyReleaseArchive(archivePath, pinnedDigest);
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.reason).toBe("CHECKSUMS_DISAGREE");
			}
			await rm(archivePath);
		});
	});

	describe("extractExecutable", () => {
		it("extracts the executable with correct permissions", async () => {
			const verified: VerifiedArchiveOutcome = {
				ok: true,
				members: [{ name: "slingshot", bytes: new TextEncoder().encode("bin") }],
			};
			const workDir = join(tmpdir(), `extract-work-${Date.now()}`);
			await mkdir(workDir, { recursive: true });
			
			const outcome = await extractExecutable(verified, workDir);
			expect(outcome.ok).toBe(true);
			if (outcome.ok) {
				const stat = await Bun.file(outcome.path).stat();
				expect(stat.mode & 0o777).toBe(0o755);
			}
			await rm(workDir, { recursive: true, force: true });
		});

		it("refuses to extract an unverified archive", async () => {
			const verified: VerifiedArchiveOutcome = {
				ok: false,
				reason: "DIGEST_DIFFERING",
				message: "wrong",
				pinnedDigest: "p",
				actualDigest: "a",
			};
			const outcome = await extractExecutable(verified, tmpdir());
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) {
				expect(outcome.reason).toBe("NOT_VERIFIED");
			}
		});
	});

	describe("Runtime Sequence", () => {
		const options: StartClientRunnerOptions = {
			image: "test-image",
			values: {
				label: { key: "test-label" },
				capture: { maximumBytes: 1024 },
				readiness: { pollIntervalSeconds: 1 },
			} as any,
			network: "test-net",
			labelValue: "test-val",
			executablePath: "/tmp/bin",
			scratchHome: {
				homePath: "/tmp/home",
				rootPath: "/tmp/home/.config/slingshot",
				profileName: "main",
				environmentName: "dev",
			},
			runtimeRoot: "/tmp/runtime",
			captureDirectory: tmpdir(),
			deadline: new Date(Date.now() + 10000),
		};

		it("proves the successful client sequence", async () => {
			// Mock runPodman for startContainer (returns container ID)
			(runPodman as any).mockResolvedValueOnce({
				ok: true,
				exitCode: 0,
				stdoutPath: await writeTempFile("container-123"),
				stderrPath: await writeTempFile(""),
			});

			// Mock runPodman for readiness probe (check-configuration)
			(runPodman as any).mockResolvedValueOnce({
				ok: true,
				exitCode: 0,
				stdoutPath: await writeTempFile(JSON.stringify({
					outcome: "configuration_report",
					resolved: true,
				})),
				stderrPath: await writeTempFile(""),
			});

			const runner = await startClientRunner(options);
			expect(runner.ok).toBe(true);
			if (runner.ok) {
				// Mock runPodman for proveClientSequence
				// 1. check-configuration
				(runPodman as any).mockResolvedValueOnce({
					ok: true,
					exitCode: 0,
					stdoutPath: await writeTempFile(JSON.stringify({
						outcome: "configuration_report",
						resolved: true,
					})),
					stderrPath: await writeTempFile(""),
				});
				// 2. daemon ping
				(runPodman as any).mockResolvedValueOnce({
					ok: true,
					exitCode: 0,
					stdoutPath: await writeTempFile(JSON.stringify({
						outcome: "daemon_control",
						state: "absent",
					})),
					stderrPath: await writeTempFile(""),
				});
				// 3. daemon start
				(runPodman as any).mockResolvedValueOnce({
					ok: true,
					exitCode: 0,
					stdoutPath: await writeTempFile(JSON.stringify({
						outcome: "daemon_control",
						state: "created",
					})),
					stderrPath: await writeTempFile(""),
				});

				const outcome = await proveClientSequence(runner, options);
				expect(outcome.ok).toBe(true);
				if (outcome.ok) {
					expect(outcome.answers.configurationAccepted).toBe(true);
					expect(outcome.answers.pingAbsent).toBe(true);
					expect(outcome.answers.startCreated).toBe(true);
				}
			}
		});

		async function writeTempFile(content: string) {
			const path = join(tmpdir(), `temp-${Math.random()}.txt`);
			await writeFile(path, content);
			return path;
		}
	});
});
