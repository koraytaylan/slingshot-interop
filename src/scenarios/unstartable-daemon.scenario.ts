// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The unstartable-daemon scenario: a start that cannot produce a daemon has
// to say why, promptly, through the client that was asked. Two causes are
// driven through the real executable, because each once ended as nothing but
// the whole start deadline elapsing:
//
// 1. A runtime root that others may enter. The daemon refuses to own a
//    namespace in any directory its user does not alone own
//    (crates/slingshot-daemon/src/runtime_namespace.rs), so a client that
//    accepted such a root started a child that refused in silence. The client
//    must refuse the root itself, name what to change, and create nothing in
//    it. A root left mode 0755 by an earlier installation is exactly how this
//    reached a person.
// 2. A daemon that exits while starting. A profile the scratch home does not
//    configure makes the child refuse after it took its namespace. The client
//    must report that the child exited, quote what it wrote, and name the
//    owner-only startup log it wrote it to
//    (crates/slingshot-command-line/src/explicit_daemon_start.rs).
//
// Both roots are siblings of the run's own runtime root and neither ever
// holds a serving daemon, so the scenario shares no namespace, lock, or state
// with the daemon the other scenarios use.

import { envelope, invoke, runner } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

// A profile name the scratch home never configures, spelled in the grammar
// the client admits so the refusal is the daemon's rather than the parser's.
export const unconfiguredProfileName = "interop-unconfigured";

// The permission bits an earlier installation left a shared root with.
const SHARED_ROOT_MODE = "755";

// The permission bits the startup log must carry: its owner's alone.
const OWNER_ONLY_FILE_MODE = "600";

// The words the client's own start failures are spelled with. Each is what a
// person reading the diagnostic acts on, so each is asserted rather than the
// sentence around it.
const PRIVATE_ROOT_REFUSAL = "alone owns";
const PRIVATE_ROOT_REMEDY = "0700";
const EARLY_EXIT_REPORT = "the daemon exited before it became responsive";
const QUOTED_DIAGNOSTIC = "it wrote:";
const STARTUP_LOG_SUFFIX = ".startup.log";
const SILENT_TIMEOUT = "no daemon became responsive";

type Outcome = { readonly ok: boolean; readonly message: string };

function arguments_(root: string, profileName: string, options: StartClientRunnerOptions): string[] {
	return [
		runner(),
		"--machine",
		"--runtime-root",
		root,
		"--profile",
		profileName,
		"--environment",
		options.scratchHome.environmentName,
	];
}

// Runs one shell step inside the runner, as its own failure when it fails.
async function shell(handle: ContainerHandle, options: StartClientRunnerOptions, what: string, script: string, ...values: string[]): Promise<{ readonly ok: true; readonly stdout: string } | { readonly ok: false; readonly message: string }> {
	const ran = await invoke(handle, ["sh", "-c", script, what, ...values], options);
	if (!ran.ok) {
		return { ok: false, message: `${what} could not run: ${ran.message}` };
	}
	if (ran.exitCode !== 0) {
		return { ok: false, message: `${what} exited ${ran.exitCode}: ${ran.stderr}` };
	}
	return { ok: true, stdout: ran.stdout };
}

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
		const shared = await sharedRoot(handle, options);
		if (!shared.ok) {
			return shared;
		}
		const exiting = await exitingDaemon(handle, options);
		if (!exiting.ok) {
			return exiting;
		}
		return { ok: true, message: `unstartable daemon: ${shared.message}; ${exiting.message}` };
	},
};

async function sharedRoot(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
	const root = `${options.runtimeRoot}-shared`;
	const prepared = await shell(handle, options, "preparing the shared runtime root",
		'rm -rf -- "$1" && mkdir -p -- "$1" && chmod "$2" -- "$1"', root, SHARED_ROOT_MODE);
	if (!prepared.ok) {
		return prepared;
	}

	const started = await invoke(handle, [...arguments_(root, options.scratchHome.profileName, options), "daemon", "start"], options);
	if (!started.ok) {
		return { ok: false, message: `daemon start on a shared root could not run: ${started.message}` };
	}
	if (started.exitCode === 0) {
		return { ok: false, message: `daemon start accepted a runtime root others may enter: ${started.stdout}` };
	}
	if (started.stderr.includes(SILENT_TIMEOUT)) {
		return { ok: false, message: `daemon start on a shared root waited out its deadline instead of refusing the root: ${started.stderr}` };
	}
	if (!started.stderr.includes(PRIVATE_ROOT_REFUSAL) || !started.stderr.includes(PRIVATE_ROOT_REMEDY)) {
		return { ok: false, message: `daemon start on a shared root did not say the root must be its user's alone and how to make it so: ${started.stderr}` };
	}

	const listed = await shell(handle, options, "listing the shared runtime root", 'ls -A -- "$1"', root);
	if (!listed.ok) {
		return listed;
	}
	if (listed.stdout.trim().length > 0) {
		return { ok: false, message: `a refused shared root was left holding ${JSON.stringify(listed.stdout.trim())}` };
	}

	const pinged = await invoke(handle, [...arguments_(root, options.scratchHome.profileName, options), "daemon", "ping"], options);
	if (!pinged.ok) {
		return { ok: false, message: `daemon ping on the shared root could not run: ${pinged.message}` };
	}
	const probe = envelope(pinged.stdout, "daemon ping on the shared root");
	if (probe.ok === false) {
		return probe;
	}
	if (pinged.exitCode !== 0 || probe.state !== "absent") {
		return { ok: false, message: `daemon ping on a refused shared root exited ${pinged.exitCode} with ${pinged.stdout}, where nothing should be serving` };
	}

	const removed = await shell(handle, options, "removing the shared runtime root", 'rm -rf -- "$1"', root);
	if (!removed.ok) {
		return removed;
	}
	return { ok: true, message: "a shared runtime root was refused with its remedy and left empty" };
}

async function exitingDaemon(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
	const root = `${options.runtimeRoot}-unconfigured`;
	const cleared = await shell(handle, options, "clearing the unconfigured runtime root", 'rm -rf -- "$1"', root);
	if (!cleared.ok) {
		return cleared;
	}

	const started = await invoke(handle, [...arguments_(root, unconfiguredProfileName, options), "daemon", "start"], options);
	if (!started.ok) {
		return { ok: false, message: `daemon start for an unconfigured profile could not run: ${started.message}` };
	}
	if (started.exitCode === 0) {
		return { ok: false, message: `daemon start for a profile nobody configured reported a daemon: ${started.stdout}` };
	}
	if (started.stderr.includes(SILENT_TIMEOUT) || !started.stderr.includes(EARLY_EXIT_REPORT)) {
		return { ok: false, message: `daemon start did not report that its daemon exited while starting: ${started.stderr}` };
	}
	if (!started.stderr.includes(QUOTED_DIAGNOSTIC)) {
		return { ok: false, message: `daemon start reported the exit without quoting what the daemon wrote: ${started.stderr}` };
	}
	const named = started.stderr.match(/(\/\S+\.startup\.log)/);
	const log = named?.[1];
	if (log === undefined || !log.startsWith(root) || !log.endsWith(STARTUP_LOG_SUFFIX)) {
		return { ok: false, message: `daemon start named no startup log inside its runtime root: ${started.stderr}` };
	}

	const inspected = await shell(handle, options, "inspecting the startup log", 'stat -c %a -- "$1" && cat -- "$1"', log);
	if (!inspected.ok) {
		return inspected;
	}
	const [mode, ...written] = inspected.stdout.split("\n");
	if (mode?.trim() !== OWNER_ONLY_FILE_MODE) {
		return { ok: false, message: `the startup log ${log} is mode ${String(mode)}, readable by more than its owner` };
	}
	const contents = written.join("\n").trim();
	if (contents.length === 0 || !started.stderr.includes(contents)) {
		return { ok: false, message: `what daemon start quoted is not what its startup log holds: ${JSON.stringify(contents)} against ${started.stderr}` };
	}

	const removed = await shell(handle, options, "removing the unconfigured runtime root", 'rm -rf -- "$1"', root);
	if (!removed.ok) {
		return removed;
	}
	return { ok: true, message: "a daemon that exited while starting was reported with what it wrote and its owner-only log" };
}
