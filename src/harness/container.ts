// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The container lifecycle: one container, one handle. The network, the
// container, its readiness, its captured output and its removal all go
// through the values the caller declares here and nothing looks a container
// name up afterwards. The leak check lists only what was started under the
// harness label, so it can only ever fail on this harness's own work.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPodman, type PodmanOutcome, type PodmanRefusal } from "./podman.ts";

export type { PodmanOutcome, PodmanRefusal };

export type StartContainerOptions = {
	readonly image: string;
	readonly labelKey: string;
	readonly labelValue: string;
	readonly network: string;
	// The container ports to publish, mapped as-is to the same host port. The
	// caller declares the ports it needs and no other port is published.
	readonly publish?: readonly number[];
	readonly command: readonly string[];
	// The readiness probe, called with the started container's id; a resolved
	// true means ready.
	readonly probe: (id: string) => Promise<boolean>;
	readonly probeIntervalSeconds: number;
	// The absolute instant by which the probe must have succeeded.
	readonly deadline: Date;
	readonly stopGraceSeconds: number;
	readonly captureLimitBytes: number;
	// Directory under which every capture file is kept. Each command gets its
	// own fresh subdirectory, so concurrent captures never overwrite one
	// another and nothing can look a prior capture up by a fixed name.
	readonly captureDirectory?: string;
	readonly executable?: string;
};

export type ContainerHandle = {
	readonly ok: true;
	readonly id: string;
	readonly labelKey: string;
	readonly labelValue: string;
	readonly network: string;
	readonly publishedPorts: readonly number[];
	// Captures everything the container has printed so far into a bounded
	// file and names that file.
	captureLogs(): Promise<{ ok: true; logPath: string } | PodmanRefusal>;
	stop(graceSeconds: number): Promise<PodmanOutcome>;
	remove(): Promise<PodmanOutcome>;
};

export type ContainerRefusal =
	| {
			readonly ok: false;
			// A start that never came up is its own refusal naming the captured
			// log it kept, never a bare timeout.
			readonly reason: "NEVER_BECAME_READY";
			readonly message: string;
			readonly logPath: string;
			readonly logTail: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "START_FAILED";
			readonly message: string;
			readonly stdoutTail: string;
			readonly stderrTail: string;
	  };

export type StartContainerOutcome = ContainerHandle | ContainerRefusal;

export function isContainerRefusal(outcome: StartContainerOutcome): outcome is ContainerRefusal {
	return outcome.ok === false;
}

// A fresh capture subdirectory per command: two commands sharing one file
// name would let one run's output be read as another's.
async function freshCaptureDirectory(parent?: string): Promise<string> {
	return mkdtemp(join(parent ?? tmpdir(), "podman-capture-"));
}

export type NetworkOutcome = { readonly ok: true; readonly name: string } | PodmanRefusal;

export type CreateNetworkOptions = {
	readonly labelKey: string;
	readonly labelValue: string;
	readonly captureLimitBytes: number;
	readonly captureDirectory?: string;
	readonly executable?: string;
};

export async function createNetwork(
	name: string,
	options: CreateNetworkOptions,
): Promise<NetworkOutcome> {
	const directory = await freshCaptureDirectory(options.captureDirectory);
	const outcome = await runPodman(
		["network", "create", "--label", `${options.labelKey}=${options.labelValue}`, name],
		{
			captureLimitBytes: options.captureLimitBytes,
			captureDirectory: directory,
			...(options.executable !== undefined ? { executable: options.executable } : {}),
		},
	);
	await rm(directory, { recursive: true, force: true });
	return outcome.ok ? { ok: true, name } : outcome;
}

export async function removeNetwork(
	name: string,
	options: Omit<CreateNetworkOptions, "labelKey" | "labelValue">,
): Promise<PodmanOutcome> {
	const directory = await freshCaptureDirectory(options.captureDirectory);
	const outcome = await runPodman(["network", "rm", "-f", name], {
		captureLimitBytes: options.captureLimitBytes,
		captureDirectory: directory,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});
	await rm(directory, { recursive: true, force: true });
	return outcome;
}

async function captureLogs(
	id: string,
	options: StartContainerOptions,
): Promise<{ ok: true; logPath: string } | PodmanRefusal> {
	const directory = await freshCaptureDirectory(options.captureDirectory);
	const outcome = await runPodman(["logs", id], {
		captureLimitBytes: options.captureLimitBytes,
		captureDirectory: directory,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});
	if (!outcome.ok) {
		await rm(directory, { recursive: true, force: true });
		return outcome;
	}
	return { ok: true, logPath: outcome.stdoutPath };
}

export async function startContainer(
	options: StartContainerOptions,
): Promise<StartContainerOutcome> {
	const run = async (
		args: readonly string[],
	): Promise<{ outcome: PodmanOutcome; stdoutText: string }> => {
		const directory = await freshCaptureDirectory(options.captureDirectory);
		const outcome = await runPodman(args, {
			captureLimitBytes: options.captureLimitBytes,
			captureDirectory: directory,
			...(options.executable !== undefined ? { executable: options.executable } : {}),
		});
		// The captures are read before the directory goes away: nothing after
		// this point can look a prior capture up by a fixed name.
		const stdoutText = outcome.ok ? await readFile(outcome.stdoutPath, "utf8") : "";
		await rm(directory, { recursive: true, force: true });
		return { outcome, stdoutText };
	};
	const runText = async (args: readonly string[]): Promise<string> => {
		const { outcome, stdoutText } = await run(args);
		return outcome.ok ? stdoutText : "";
	};

	const runArgs = [
		"run",
		"-d",
		"--pull=never",
		"--label",
		`${options.labelKey}=${options.labelValue}`,
		"--network",
		options.network,
	];
	for (const port of options.publish ?? []) {
		runArgs.push("-p", `${port}:${port}`);
	}
	runArgs.push(options.image, ...options.command);

	const started = await run(runArgs);
	if (!started.outcome.ok) {
		return {
			ok: false,
			reason: "START_FAILED",
			message: started.outcome.message,
			stdoutTail: started.outcome.stdoutTail,
			stderrTail: started.outcome.stderrTail,
		};
	}
	const id = started.stdoutText.trim();

	const handle: ContainerHandle = {
		ok: true,
		id,
		labelKey: options.labelKey,
		labelValue: options.labelValue,
		network: options.network,
		publishedPorts: [...(options.publish ?? [])],
		captureLogs: () => captureLogs(id, options),
	// Stopping with SIGTERM is the orderly path, but this Podman's rootless
	// netns teardown fails with "permission denied" after a stop on a custom
	// network, so the graceful span is signalled as SIGTERM by hand and the
	// removal uses the force path that survives the failed cleanup.
	stop: async (graceSeconds: number) => {
		await run(["kill", "--signal", "TERM", id]);
		const graceMs = graceSeconds * 1000;
		const graceDeadline = Date.now() + graceMs;
		while (Date.now() < graceDeadline) {
			if ((await runText(["container", "inspect", "-f", "{{.State.Running}}", id])) === "false") {
				const done = await run(["container", "inspect", "-f", "{{.State.Running}}", id]);
				return done.outcome;
			}
			await Bun.sleep(Math.min(200, Math.max(1, graceDeadline - Date.now())));
		}
		return (await run(["kill", "--signal", "KILL", id])).outcome;
	},
	remove: async () => (await run(["rm", "-f", "-t", "0", id])).outcome,
	};

	const intervalMs = options.probeIntervalSeconds * 1000;
	const deadlineMs = options.deadline.getTime();
	while (true) {
		if (await options.probe(id)) {
			return handle;
		}
		const remainingMs = deadlineMs - Date.now();
		if (remainingMs <= 0) {
			break;
		}
		await Bun.sleep(Math.min(intervalMs, remainingMs));
	}

	// The deadline passed: stop the container with grace, keep its captured
	// log, remove it, and refuse as NEVER_BECAME_READY naming that log.
	await handle.stop(options.stopGraceSeconds);
	const logs = await captureLogs(id, options);
	await handle.remove();
	if (!logs.ok) {
		return {
			ok: false,
			reason: "NEVER_BECAME_READY",
			message: `The container ${id} did not become ready by the deadline ${options.deadline.toISOString()} and its log could not be captured: ${logs.message}`,
			logPath: "",
			logTail: "",
		};
	}
	const logText = await readFile(logs.logPath, "utf8");
	return {
		ok: false,
		reason: "NEVER_BECAME_READY",
		message: `The container ${id} did not become ready by the deadline ${options.deadline.toISOString()}; the captured log at "${logs.logPath}" holds what it printed: ${JSON.stringify(logText)}`,
		logPath: logs.logPath,
		logTail: logText,
	};
}

export type LeakCheck =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly message: string;
			readonly containers: readonly string[];
			readonly networks: readonly string[];
	  };

export type LeakCheckOptions = {
	readonly labelKey: string;
	readonly labelValue: string;
	readonly captureLimitBytes: number;
	readonly captureDirectory?: string;
	readonly executable?: string;
};

// Lists containers by the harness label and asserts nothing remains, so the
// check can only ever fail on this harness's own labelled work and never on
// anything else on the host. Networks are not listed: each run's network is
// created and removed through the same handle that owns the run.
export async function checkForLeaks(options: LeakCheckOptions): Promise<LeakCheck> {
	const label = `${options.labelKey}=${options.labelValue}`;
	const listing = await runPodman(
		["ps", "-a", "--no-trunc", "--filter", `label=${label}`, "--format", "{{.ID}}"],
		{
			captureLimitBytes: options.captureLimitBytes,
			captureDirectory: await freshCaptureDirectory(options.captureDirectory),
			...(options.executable !== undefined ? { executable: options.executable } : {}),
		},
	);
	if (!listing.ok) {
		return {
			ok: false,
			message: `The leak check could not list containers labelled ${label}: ${listing.message}`,
			containers: [],
			networks: [],
		};
	}
	const containerIds = (await readFile(listing.stdoutPath, "utf8"))
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (containerIds.length === 0) {
		return { ok: true };
	}
	return {
		ok: false,
		message: `The leak check found labelled containers left behind: ${JSON.stringify(containerIds)} carrying the label ${label}.`,
		containers: containerIds,
		networks: [],
	};
}

export function isLeak(outcome: LeakCheck): outcome is Extract<LeakCheck, { ok: false }> {
	return outcome.ok === false;
}