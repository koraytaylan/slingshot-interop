// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkForLeaks,
	createNetwork,
	isLeak,
	removeNetwork,
	startContainer,
} from "./container.ts";

// These are the integration tests for the lifecycle, run against the pinned
// probe image: a container starts, becomes ready, stops through the handle
// that started it, and is gone; a container whose probe never succeeds
// refuses at the deadline these values declare, naming its log; and the
// leak check is clean after each case while catching a deliberately
// left-behind labelled container.

const labelKey = "rs.slingshot.interop";
const labelValue = `lifecycle-test-${process.pid}-${Date.now()}`;
const probeImage = "docker.io/library/busybox@sha256:b7f3d86d6e84fc17718c48bcde1450807faa2d56704205c697b4bd5df7b9e29f";
const captureLimitBytes = 4096;

let directory: string | null = null;

function captureDirectory(): string {
	if (directory === null) {
		throw new Error("capture directory not prepared");
	}
	return directory;
}

const runOptions = () => ({
	labelKey,
	labelValue,
	captureLimitBytes,
	captureDirectory: captureDirectory(),
});

const createdNetworks: string[] = [];

async function makeNetwork(name: string): Promise<string> {
	const outcome = await createNetwork(name, runOptions());
	expect(outcome.ok).toBe(true);
	createdNetworks.push(name);
	return name;
}

async function assertNoLeaks(context: string): Promise<void> {
	const leaks = await checkForLeaks(runOptions());
	expect(isLeak(leaks) ? `${context}: ${leaks.message}` : context).toBe(context);
}

async function removeTrackedNetwork(name: string): Promise<void> {
	const outcome = await removeNetwork(name, {
		captureLimitBytes,
		captureDirectory: captureDirectory(),
	});
	expect(outcome.ok, outcome.ok ? "network removed" : outcome.message).toBe(true);
	const position = createdNetworks.indexOf(name);
	if (position !== -1) createdNetworks.splice(position, 1);
}

afterAll(async () => {
	// Nothing this suite started may outlive it: any labelled remainder is
	// removed here so the machine is left as it was found.
	const leaks = await checkForLeaks(runOptions());
	const ids = isLeak(leaks) ? [...leaks.containers] : [];
	for (const id of ids) {
		await Bun.spawn(["podman", "rm", "-f", "-t", "0", id]).exited;
	}
	for (const name of [...createdNetworks]) {
		await removeTrackedNetwork(name);
	}
	await assertNoLeaks("suite cleanup removed all resources");
	if (directory !== null) {
		await rm(directory, { recursive: true, force: true });
	}
});

describe("container lifecycle", () => {
	test(
		"a started container becomes ready, stops through the handle, and is gone",
		async () => {
			directory ??= await mkdtemp(join(tmpdir(), "container-test-"));
			const network = await makeNetwork(`lifecycle-test-ok-${process.pid}`);
			const started = await startContainer({
				image: probeImage,
				publish: [],
				command: ["sleep", "300"],
				labelKey,
				labelValue,
				network,
				probe: async () => true,
				probeIntervalSeconds: 1,
				deadline: new Date(Date.now() + 30_000),
				stopGraceSeconds: 2,
				cleanupTimeoutSeconds: 30,
				captureLimitBytes,
				captureDirectory: captureDirectory(),
			});
			expect(started.ok).toBe(true);
			if (!started.ok) {
				throw new Error("start unexpectedly refused");
			}
			// The published ports are exactly the ones the caller declared — none here.
			expect(started.publishedPorts).toEqual([]);
			const captured = await started.captureLogs(Date.now() + 30_000);
			expect(captured.ok).toBe(true);
			if (captured.ok) {
				const { size } = await stat(captured.logPath);
				expect(size).toBeLessThanOrEqual(captureLimitBytes);
			}
			const stopped = await started.stop(2, Date.now() + 30_000);
			expect(stopped.ok).toBe(true);
			const removed = await started.remove(Date.now() + 30_000);
			expect(removed.ok).toBe(true);
			await removeTrackedNetwork(network);
			await assertNoLeaks("the stopped container is gone");
		},
		120_000,
	);

	test(
		"a container whose probe never succeeds refuses at the deadline, naming its log",
		async () => {
			directory ??= await mkdtemp(join(tmpdir(), "container-test-"));
			const network = await makeNetwork(`lifecycle-test-deadline-${process.pid}`);
			// The test's own values declare the deadline: five seconds out,
			// polled at a one second interval.
			const deadline = new Date(Date.now() + 5_000);
			const before = Date.now();
			const started = await startContainer({
				image: probeImage,
				publish: [],
				command: ["sh", "-c", "echo the-probe-never-passes; sleep 300"],
				labelKey,
				labelValue,
				network,
				probe: async () => false,
				probeIntervalSeconds: 1,
				deadline,
				stopGraceSeconds: 2,
				cleanupTimeoutSeconds: 30,
				captureLimitBytes,
				captureDirectory: captureDirectory(),
			});
			const elapsed = Date.now() - before;
			expect(started.ok).toBe(false);
			if (started.ok) {
				throw new Error("start unexpectedly succeeded");
			}
			expect(started.reason).toBe("NEVER_BECAME_READY");
			if (started.reason !== "NEVER_BECAME_READY") {
				throw new Error("unexpected refusal reason");
			}
			// The refusal lands at the deadline the test declared, not on some
			// fixed timeout of the machinery's own choosing.
			expect(elapsed).toBeGreaterThanOrEqual(5_000);
			expect(elapsed).toBeLessThan(30_000);
			expect(started.message).toContain("did not become ready");
			expect(started.message).toContain("the-probe-never-passes");
			expect(started.logPath).not.toBe("");
			const log = await readFile(started.logPath, "utf8");
			expect(log).toContain("the-probe-never-passes");
			expect(started.logTail).toContain("the-probe-never-passes");
			// The refused container is already gone; nothing is left to clean up.
			await removeTrackedNetwork(network);
			await assertNoLeaks("the refused container is gone");
		},
		120_000,
	);

	test("the leak check catches a network without any containers", async () => {
		directory ??= await mkdtemp(join(tmpdir(), "container-test-"));
		const network = await makeNetwork(`lifecycle-test-network-leak-${process.pid}`);
		try {
			const leaks = await checkForLeaks(runOptions());
			expect(leaks.ok).toBe(false);
			if (leaks.ok) throw new Error("network leak unexpectedly clean");
			expect(leaks.containers).toEqual([]);
			expect(leaks.networks).toContain(network);
			expect(leaks.message).toContain(network);
		} finally {
			await removeTrackedNetwork(network);
		}
		await assertNoLeaks("the leaked network was removed");
	});

	test(
		"the leak check catches a deliberately left-behind labelled container",
		async () => {
			directory ??= await mkdtemp(join(tmpdir(), "container-test-"));
			const network = await makeNetwork(`lifecycle-test-leak-${process.pid}`);
			const started = await startContainer({
				image: probeImage,
				publish: [],
				command: ["sleep", "300"],
				labelKey,
				labelValue,
				network,
				probe: async () => true,
				probeIntervalSeconds: 1,
				deadline: new Date(Date.now() + 30_000),
				stopGraceSeconds: 2,
				cleanupTimeoutSeconds: 30,
				captureLimitBytes,
				captureDirectory: captureDirectory(),
			});
			expect(started.ok).toBe(true);
			if (!started.ok) {
				throw new Error("start unexpectedly refused");
			}
			// Deliberately leave it running: the leak check must see it.
			const leaks = await checkForLeaks(runOptions());
			expect(leaks.ok).toBe(false);
			if (!isLeak(leaks)) {
				throw new Error("leak unexpectedly clean");
			}
			expect(leaks.containers).toContain(started.id);
			expect(leaks.message).toContain(started.id);
			const stopped = await started.stop(2);
			expect(stopped.ok).toBe(true);
			const removed = await started.remove();
			expect(removed.ok).toBe(true);
			await removeTrackedNetwork(network);
			await assertNoLeaks("the deliberate container leak was cleaned up");
		},
		120_000,
	);
});
