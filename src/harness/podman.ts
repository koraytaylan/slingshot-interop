// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The Podman process wrapper: the only place the harness starts the container
// engine. Plain child processes, capture written to files bounded by the
// caller-supplied limit rather than held in memory, and every exit typed into
// a result or a refusal that names the command and the captured tail. No
// container-orchestration dependency sits under this file.

import { existsSync } from "node:fs";
import { mkdtemp, open, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PodmanCommand = readonly string[];

export type PodmanResult = {
	readonly ok: true;
	readonly command: PodmanCommand;
	readonly exitCode: number;
	readonly stdoutPath: string;
	readonly stderrPath: string;
};

export type PodmanRefusal = {
	readonly ok: false;
	readonly command: PodmanCommand;
	// "missing" means the engine executable is absent on this machine; the
	// message is one sentence about that. "failed" means the process ran and
	// exited nonzero; the message names the command and the captured tail.
	// "capture_exceeded" means a strict evidence reader would see only a prefix.
	readonly reason: "missing" | "failed" | "capture_exceeded" | "capture_failed" | "deadline";
	readonly message: string;
	readonly stdoutTail: string;
	readonly stderrTail: string;
	readonly stdoutPath: string;
	readonly stderrPath: string;
};

export type PodmanOutcome = PodmanResult | PodmanRefusal;

export type RunPodmanOptions = {
	// Absolute host deadline, including capture drains. Deadline-owned POSIX
	// invocations have a separate process group so inherited pipes cannot stall
	// their caller after the engine exits. Container cleanup remains separate.
	readonly deadline?: number;
	// The engine executable; defaults to "podman" resolved from PATH.
	readonly executable?: string;
	// The per-stream capture bound in bytes. Callers pass
	// values.capture.maximumBytes; there is no implicit default.
	readonly captureLimitBytes: number;
	// Evidence readers must not interpret a truncated prefix as a whole answer.
	// Log collectors may continue to retain bounded prefixes without refusal.
	readonly requireCompleteCapture?: boolean;
	// Directory holding the capture files. Defaults to a fresh temporary
	// directory; callers that want the captures cleaned up pass their own and
	// remove it themselves.
	readonly captureDirectory?: string;
	// The bytes the command's standard input carries, if the command takes
	// any. Absent means the input is the empty stream and is closed
	// immediately, which is what every command that asks nothing of a caller
	// gets. A command that reads its input — a protocol server answering
	// request lines — is driven by passing them here, so no second invocation
	// path exists and the capture bounds above still apply to its answers.
	readonly stdinBytes?: Uint8Array;
};

const executableFallback = "podman";

async function drainBounded(
	stream: ReadableStream<Uint8Array>,
	filePath: string,
	limitBytes: number,
	signal: AbortSignal,
): Promise<boolean> {
	const handle = await open(filePath, "w");
	const reader = stream.getReader();
	const cancel = () => { void reader.cancel().catch(() => {}); };
	signal.addEventListener("abort", cancel, { once: true });
	if (signal.aborted) cancel();
	let exceeded = false;
	try {
		let written = 0;
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			const chunk = next.value;
			if (chunk.length > limitBytes - written) exceeded = true;
			if (written >= limitBytes) {
				continue; // keep draining so the child never blocks on a full pipe
			}
			const room = limitBytes - written;
			const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
			await handle.write(kept);
			written += kept.length;
		}
	} finally {
		signal.removeEventListener("abort", cancel);
		reader.releaseLock();
		await handle.close();
	}
	return exceeded;
}

async function tailOfFile(filePath: string, limitBytes: number): Promise<string> {
	const { size } = await stat(filePath);
	if (size === 0) {
		return "";
	}
	const start = size > limitBytes ? size - limitBytes : 0;
	const buffer = await readFile(filePath);
	const tail = buffer.subarray(start);
	return new TextDecoder().decode(tail);
}

export async function runPodman(
	args: readonly string[],
	options: RunPodmanOptions,
): Promise<PodmanOutcome> {
	const executable = options.executable ?? executableFallback;
	const limitBytes = options.captureLimitBytes;
	const command: PodmanCommand = [executable, ...args];

	if (executable.includes("/") ? !existsSync(executable) : Bun.which(executable) === null) {
		const directory = options.captureDirectory ?? (await mkdtemp(join(tmpdir(), "podman-")));
		const stdoutPath = join(directory, "stdout");
		const stderrPath = join(directory, "stderr");
		await open(stdoutPath, "w").then((handle) => handle.close());
		await open(stderrPath, "w").then((handle) => handle.close());
		return {
			ok: false,
			command,
			reason: "missing",
			message: `The container engine executable "${executable}" is not available on this machine; rootless Podman must be installed before this run.`,
			stdoutTail: "",
			stderrTail: "",
			stdoutPath,
			stderrPath,
		};
	}

	const directory = options.captureDirectory ?? (await mkdtemp(join(tmpdir(), "podman-")));
	const stdoutPath = join(directory, "stdout");
	const stderrPath = join(directory, "stderr");

	const remaining = options.deadline === undefined ? undefined : options.deadline - Date.now();
	// setTimeout cannot represent intervals beyond a signed 32-bit millisecond
	// count. Refuse unsupported deadlines instead of silently wrapping them.
	const maximumTimerMilliseconds = 2 ** 31 - 1;
	if (remaining !== undefined && (!Number.isFinite(remaining) || remaining <= 0
		|| remaining > maximumTimerMilliseconds || process.platform === "win32")) {
		await Promise.all([stdoutPath, stderrPath].map(async path => (await open(path, "w")).close()));
		return { ok: false, command, reason: "deadline", message: "The host invocation deadline is expired or unsupported.",
			stdoutTail: "", stderrTail: "", stdoutPath, stderrPath };
	}

	const child = Bun.spawn({
		cmd: [...command],
		detached: remaining !== undefined,
		// A Blob's bytes are handed to the child and the stream then ends,
		// which is what tells a server reading its input that it is done. An
		// invocation carrying no bytes gets the empty stream, unchanged.
		stdin: options.stdinBytes === undefined ? "ignore" : new Blob([options.stdinBytes]),
		stdout: "pipe",
		stderr: "pipe",
	});

	const capture = new AbortController();
	let expired = false;
	let terminationFailed = false;
	const terminate = () => {
		try {
			if (remaining === undefined) child.kill("SIGKILL");
			else process.kill(-child.pid, "SIGKILL");
		}
		catch (failure) { terminationFailed = (failure as NodeJS.ErrnoException).code !== "ESRCH"; }
		capture.abort();
	};
	const timer = remaining === undefined ? undefined : setTimeout(() => {
		expired = true;
		terminate();
	}, Math.max(0, options.deadline! - Date.now()));
	let exceeded: boolean[];
	let exitCode: number;
	const drains = [
		drainBounded(child.stdout as ReadableStream<Uint8Array>, stdoutPath, limitBytes, capture.signal),
		drainBounded(child.stderr as ReadableStream<Uint8Array>, stderrPath, limitBytes, capture.signal),
	];
	try {
		exceeded = await Promise.all(drains);
		exitCode = await child.exited;
	} catch {
		// A failed capture must not abandon a live engine or the other drain.
		// Do not read tails from failed capture paths (which may not be files).
		terminate();
		await Promise.allSettled(drains);
		if (!terminationFailed) await child.exited;
		return { ok: false, command, reason: "capture_failed",
			message: terminationFailed ? "Command capture failed; terminating the invocation also failed."
				: "Command capture failed; the invocation was terminated and capture stopped.",
			stdoutTail: "", stderrTail: "", stdoutPath, stderrPath };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}

	const stdoutTail = await tailOfFile(stdoutPath, limitBytes);
	const stderrTail = await tailOfFile(stderrPath, limitBytes);
	if (expired) {
		return { ok: false, command, reason: "deadline",
			message: terminationFailed ? "The host invocation deadline expired; terminating its process group failed."
				: "The host invocation deadline expired; its process group was terminated and capture stopped.",
			stdoutTail, stderrTail, stdoutPath, stderrPath };
	}
	if (options.requireCompleteCapture && exceeded.some(Boolean)) {
		return {
			ok: false, command, reason: "capture_exceeded",
			message: "The command output exceeded the capture byte bound; truncated output cannot establish a complete answer.",
			stdoutTail, stderrTail, stdoutPath, stderrPath,
		};
	}

	if (exitCode !== 0) {
		return {
			ok: false,
			command,
			reason: "failed",
			message: `The command ${JSON.stringify(command)} exited with code ${exitCode}; captured stdout tail: ${JSON.stringify(stdoutTail)}; captured stderr tail: ${JSON.stringify(stderrTail)}.`,
			stdoutTail,
			stderrTail,
			stdoutPath,
			stderrPath,
		};
	}

	return {
		ok: true,
		command,
		exitCode,
		stdoutPath,
		stderrPath,
	};
}
