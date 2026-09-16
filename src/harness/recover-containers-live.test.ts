// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPodman } from "./podman.ts";
import { recoverRunContainers, recoverRunNetworks } from "./recover-containers.ts";

test("lost-acknowledgement recovery removes only the current run's real network", async () => {
	const directory = await mkdtemp(join(tmpdir(), "network-recovery-live-"));
	const labelKey = "rs.slingshot.interop.recovery-test";
	const labelValue = `run-${crypto.randomUUID()}`;
	const otherLabel = `run-${crypto.randomUUID()}`;
	const names: string[] = [];
	const run = async (command: string[]) => runPodman(command, {
		captureLimitBytes: 4096, requireCompleteCapture: true, deadline: Date.now() + 10_000,
		captureDirectory: await mkdtemp(join(directory, "command-")),
	});
	try {
		for (const label of [labelValue, otherLabel]) {
			const name = `net-${label}`;
			names.push(name);
			expect((await run(["network", "create", "--label", `${labelKey}=${label}`, name])).ok).toBe(true);
		}
		const recovered = await recoverRunNetworks({ labelKey, labelValue, captureDirectory: directory, captureLimitBytes: 4096, deadline: Date.now() + 10_000 });
		expect(recovered.ok, recovered.message).toBe(true);
		expect((await run(["network", "exists", names[0]!])).ok).toBe(false);
		expect((await run(["network", "exists", names[1]!])).ok).toBe(true);
		expect((await recoverRunNetworks({ labelKey, labelValue, captureDirectory: directory, captureLimitBytes: 4096, deadline: Date.now() + 10_000 })).ok).toBe(true);
	} finally {
		for (const name of names) {
			const exists = await run(["network", "exists", name]);
			if (exists.ok) expect((await run(["network", "rm", name])).ok).toBe(true);
		}
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);

test("lost-handle recovery removes only the current run's real container", async () => {
	const directory = await mkdtemp(join(tmpdir(), "recovery-live-"));
	const labelKey = "rs.slingshot.interop.recovery-test";
	const labelValue = `run-${crypto.randomUUID()}`;
	const otherLabel = `run-${crypto.randomUUID()}`;
	const identifiers: string[] = [];
	const pins = Bun.TOML.parse(await Bun.file(new URL("../../support/interop-images.toml", import.meta.url)).text()) as Record<string, { name: string; identifier: string }>;
	const image = pins["client-runner"]!;
	const run = async (command: string[]) => runPodman(command, {
		captureLimitBytes: 4096, requireCompleteCapture: true, deadline: Date.now() + 10_000,
		captureDirectory: await mkdtemp(join(directory, "command-")),
	});
	try {
		for (const label of [labelValue, otherLabel]) {
			const started = await run(["run", "--detach", "--pull=never", "--network", "none", "--label", `${labelKey}=${label}`, `${image.name}@${image.identifier}`, "sleep", "300"]);
			expect(started.ok).toBe(true);
			const identifier = (await readFile(started.stdoutPath, "utf8")).trim();
			expect(identifier).toMatch(/^[0-9a-f]{64}$/);
			identifiers.push(identifier);
		}
		const recovered = await recoverRunContainers({ labelKey, labelValue, captureDirectory: directory, captureLimitBytes: 4096, deadline: Date.now() + 10_000 });
		expect(recovered.ok, recovered.message).toBe(true);
		expect((await run(["container", "exists", identifiers[0]!])).ok).toBe(false);
		expect((await run(["container", "exists", identifiers[1]!])).ok).toBe(true);
		expect((await recoverRunContainers({ labelKey, labelValue, captureDirectory: directory, captureLimitBytes: 4096, deadline: Date.now() + 10_000 })).ok).toBe(true);
	} finally {
		for (const identifier of identifiers) {
			if (!/^[0-9a-f]{64}$/.test(identifier)) continue;
			const removed = await run(["rm", "--force", "--ignore", "-t", "0", identifier]);
			expect(removed.ok).toBe(true);
		}
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);
