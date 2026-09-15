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
	readonly reason: "missing" | "failed";
	readonly message: string;
	readonly stdoutTail: string;
	readonly stderrTail: string;
	readonly stdoutPath: string;
	readonly stderrPath: string;
};

export type PodmanOutcome = PodmanResult | PodmanRefusal;

export type RunPodmanOptions = {
	// The engine executable; defaults to "podman" resolved from PATH.
	readonly executable?: string;
	// The per-stream capture bound in bytes. Callers pass
	// values.capture.maximumBytes; there is no implicit default.
	readonly captureLimitBytes: number;
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
): Promise<void> {
	const handle = await open(filePath, "w");
	try {
		let written = 0;
		for await (const chunk of stream) {
			if (written >= limitBytes) {
				continue; // keep draining so the child never blocks on a full pipe
			}
			const room = limitBytes - written;
			const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
			await handle.write(kept);
			written += kept.length;
		}
	} finally {
		await handle.close();
	}
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

	const child = Bun.spawn({
		cmd: [...command],
		// A Blob's bytes are handed to the child and the stream then ends,
		// which is what tells a server reading its input that it is done. An
		// invocation carrying no bytes gets the empty stream, unchanged.
		stdin: options.stdinBytes === undefined ? "ignore" : new Blob([options.stdinBytes]),
		stdout: "pipe",
		stderr: "pipe",
	});

	await Promise.all([
		drainBounded(child.stdout as ReadableStream<Uint8Array>, stdoutPath, limitBytes),
		drainBounded(child.stderr as ReadableStream<Uint8Array>, stderrPath, limitBytes),
	]);
	const exitCode = await child.exited;

	const stdoutTail = await tailOfFile(stdoutPath, limitBytes);
	const stderrTail = await tailOfFile(stderrPath, limitBytes);

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

