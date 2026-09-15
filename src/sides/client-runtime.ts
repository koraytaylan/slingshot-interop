// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The client half's runtime: the supplied release archive is verified
// against its recorded pinning and against its own checksums member before
// anything starts, the executable is extracted into the run's work
// directory, the runner container is started with the executable and the
// scratch home mounted in — the bytes under proof are the bytes a user
// downloads, so the executable is mounted, never baked in — and every CLI
// invocation is driven through exec with bounded capture. Every bound comes
// from the values loader; nothing here sleeps for a fixed span or picks its
// own.

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runPodman } from "../harness/podman.ts";
import {
	type ContainerHandle,
	type ContainerRefusal,
} from "../harness/container.ts";
import type { Values } from "../harness/values.ts";
import type { ScratchHome } from "./client-configuration.ts";

// The runner image, verified offline by support/interop-images.toml. The
// caller passes the verified identifier.
export type StartClientRunnerOptions = {
	readonly image: string;
	readonly values: Values;
	readonly network: string;
	readonly labelValue: string;
	// The extracted executable on the host, mounted read-only into the
	// runner; never baked into the image.
	readonly executablePath: string;
	// The scratch home the client's own profile mechanism reads.
	readonly scratchHome: ScratchHome;
	// The runtime root the client's daemon endpoints and locks live under,
	// inside the runner. The invocations name it explicitly, so the daemon
	// sequence is proven where the run put it and nothing outside the run's
	// own paths is touched.
	readonly runtimeRoot: string;
	// Directory holding every capture file. Each exec gets its own fresh
	// subdirectory under it, so concurrent captures never overwrite one
	// another.
	readonly captureDirectory: string;
	// The absolute instant by which the runner must be up.
	readonly deadline: Date;
	readonly executable?: string;
};

export type ClientRunnerHandle = {
	readonly ok: true;
	readonly handle: ContainerHandle;
};

export type ClientRunnerRefusal = ContainerRefusal;

export type StartClientRunnerOutcome = ClientRunnerHandle | ClientRunnerRefusal;

export function isClientRunnerRefusal(
	outcome: StartClientRunnerOutcome,
): outcome is ClientRunnerRefusal {
	return outcome.ok === false;
}

// Where the executable and the scratch home live inside the runner. The
// scratch home path is the client account's home — the path its own
// account-database home resolution reads, spelled by the Containerfile's
// passwd entry — so the client's own ownership and single-name rules apply.
export const runnerExecutablePath = "/opt/slingshot/bin/slingshot";
export const runnerHomePath = "/home/client";

// One entry of the archive's structure, read by the parse below.
export type ArchiveMember = {
	readonly name: string;
	readonly bytes: Uint8Array;
};

export type VerifiedArchive = {
	readonly ok: true;
	readonly members: readonly ArchiveMember[];
};

export type ArchiveRefusal =
	| {
			readonly ok: false;
			readonly reason: "DIGEST_DIFFERING";
			readonly message: string;
			readonly pinnedDigest: string;
			readonly actualDigest: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "NOT_AN_ARCHIVE";
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "CHECKSUMS_DISAGREE";
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "CHECKSUMS_MEMBER_ABSENT";
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "EXECUTABLE_MEMBER_ABSENT";
			readonly message: string;
	  };

export type VerifiedArchiveOutcome = VerifiedArchive | ArchiveRefusal;

export function isArchiveRefusal(
	outcome: VerifiedArchiveOutcome,
): outcome is ArchiveRefusal {
	return outcome.ok === false;
}

// The name the archive's own checksums member carries, as the release
// writer spells it (crates/slingshot-development/src/release_artifacts.rs
// CHECKSUM_MANIFEST). A release archive that carries no checksums member is
// refused: the cross-check is the archive speaking about itself, and its
// absence is silence.
const checksumsMemberName = "SHA256SUMS";

function isChecksumsMember(name: string): boolean {
	return name === checksumsMemberName || name === `./${checksumsMemberName}`;
}

// Verifies the supplied archive twice before anything starts: its whole-file
// digest against the recorded pinning, and every member it names in its own
// checksums member against the bytes actually in the archive. A tampered
// archive is refused here, before any container runs. The Linux release row
// publishes a gzipped tar archive (docs/RELEASES.md), so that is the shape
// this parse reads; a different shape is not the row's archive.
export async function verifyReleaseArchive(
	archivePath: string,
	pinnedDigest: string,
): Promise<VerifiedArchiveOutcome> {
	const bytes = await readFile(archivePath);
	const actualDigest = createHash("sha256").update(bytes).digest("hex");
	if (actualDigest !== pinnedDigest) {
		return {
			ok: false,
			reason: "DIGEST_DIFFERING",
			message: `The supplied archive ${archivePath} digests to ${actualDigest}, not the recorded ${pinnedDigest}; the bytes on disk are not the bytes the pinning names.`,
			pinnedDigest,
			actualDigest,
		};
	}
	const parsed = parseTarGz(bytes);
	if (!parsed.ok) {
		return {
			ok: false,
			reason: "NOT_AN_ARCHIVE",
			message: `The supplied archive ${archivePath} is not a gzipped tar archive: ${parsed.message}`,
		};
	}
	const checksums = parsed.members.find((member) => isChecksumsMember(member.name));
	if (checksums === undefined) {
		return {
			ok: false,
			reason: "CHECKSUMS_MEMBER_ABSENT",
			message: `The supplied archive ${archivePath} carries no checksums member; the archive's own cross-check cannot be read and the archive is refused. Members: ${parsed.members.map(m => m.name).join(", ")}`,
		};
	}
	const listed = parseChecksums(checksums.bytes);
	if (listed.size === 0) {
		return {
			ok: false,
			reason: "CHECKSUMS_DISAGREE",
			message: `The checksums member of ${archivePath} parses to no entries; the archive's own cross-check is empty and the archive is refused.`,
		};
	}
	for (const [name, expected] of listed) {
		const member = parsed.members.find((candidate) => {
			const normalized = candidate.name.startsWith("./") ? candidate.name.substring(2) : candidate.name;
			return normalized === name;
		});
		if (member === undefined) {
			return {
				ok: false,
				reason: "CHECKSUMS_DISAGREE",
				message: `The checksums member of ${archivePath} names "${name}", which the archive does not carry; the archive disagrees with itself.`,
			};
		}
		const memberDigest = createHash("sha256").update(member.bytes).digest("hex");
		if (memberDigest !== expected) {
			return {
				ok: false,
				reason: "CHECKSUMS_DISAGREE",
				message: `The member "${name}" of ${archivePath} digests to ${memberDigest}, but the archive's own checksums member records ${expected}; the archive disagrees with itself.`,
			};
		}
	}
	const executable = executableMember(parsed.members);
	if (!executable.ok) {
		return {
			ok: false,
			reason: "EXECUTABLE_MEMBER_ABSENT",
			message: `The supplied archive ${archivePath} carries no Linux executable member: ${executable.message}`,
		};
	}
	return { ok: true, members: parsed.members };
}

// The executable member: exactly one member names the client's Linux binary,
// so a run never guesses which bytes to mount. The checksums member is not a
// candidate, a directory entry is not either, and a member that does not
// name the binary is nothing the release row publishes.
function executableMember(
	members: readonly ArchiveMember[],
): { readonly ok: true; readonly member: ArchiveMember } | {
	readonly ok: false;
	readonly message: string;
} {
	const candidates = members.filter(
		(member) =>
			!isChecksumsMember(member.name) &&
			!/\/$/.test(member.name) &&
			/(?:^|\/)slingshot(?:-linux-x64)?$/.test(member.name),
	);
	if (candidates.length === 0) {
		return { ok: false, message: "no member whose name names slingshot" };
	}
	if (candidates.length > 1) {
		return {
			ok: false,
			message: `several members name slingshot: ${candidates.map((c) => c.name).join(", ")}`,
		};
	}
	return { ok: true, member: candidates[0]! };
}

// Parses the checksums member: lines of "digest  name", the shape sha256sum
// writes. Anything else in the member is refused by yielding nothing.
function parseChecksums(bytes: Uint8Array): Map<string, string> {
	const entries = new Map<string, string>();
	const text = new TextDecoder().decode(bytes);
	for (const line of text.split("\n")) {
		const match = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
		if (match && match[1] !== undefined && match[2] !== undefined) {
			entries.set(match[2].trim(), match[1]);
		}
	}
	return entries;
}

type TarGzParse =
	| { readonly ok: true; readonly members: readonly ArchiveMember[] }
	| { readonly ok: false; readonly message: string };

// A proper tar.gz parse over the archive's real bytes: the gzip stream is
// inflated with zlib's own decoder, then the ustar headers are walked the
// way the release writer wrote them (crates/slingshot-development/src/
// release_artifacts.rs write_tar: GNU headers, fixed metadata, members in
// the order the platform row declares). A member's size comes from its own
// header, not from a scan for a delimiter.
function parseTarGz(bytes: Uint8Array): TarGzParse {
	let tarBytes: Uint8Array;
	try {
		tarBytes = gunzipSync(bytes);
	} catch (error) {
		return {
			ok: false,
			message: `the gzip stream could not be inflated: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
	const decoder = new TextDecoder();
	const members: ArchiveMember[] = [];
	let offset = 0;
	while (offset + 512 <= tarBytes.length) {
		const header = tarBytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) {
			break;
		}
		const nameField = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, "");
		const sizeField = decoder.decode(header.subarray(124, 136)).replace(/\0.*/s, "").trim();
		const size = Number.parseInt(sizeField, 8);
		const typeFlag = String.fromCharCode(header[156] ?? 0x30);
		if (!Number.isInteger(size) || size < 0) {
			return { ok: false, message: `the member "${nameField}" carries an unreadable size` };
		}
		const contents = tarBytes.subarray(offset + 512, offset + 512 + size);
		// The type flag decides: '0' and '\0' name ordinary files, '5' names a
		// directory; anything else the release row does not publish and this
		// parse does not guess at.
		if (typeFlag === "0" || typeFlag === "\0") {
			members.push({ name: nameField, bytes: contents });
		} else if (typeFlag === "5") {
			members.push({ name: `${nameField}/`, bytes: new Uint8Array() });
		} else {
			return {
				ok: false,
				message: `the member "${nameField}" is stored with an unsupported type flag "${typeFlag}"`,
			};
		}
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	if (members.length === 0) {
		return { ok: false, message: "the tar carries no members" };
	}
	return { ok: true, members };
}

export type ExtractedExecutable = {
	readonly ok: true;
	readonly path: string;
};

export type ExtractRefusal =
	| {
			readonly ok: false;
			readonly reason: "NOT_VERIFIED";
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "EXECUTABLE_MEMBER_ABSENT";
			readonly message: string;
	  };

// Extracts the verified archive's executable into the run's work directory,
// executable bit set, and nothing else: the scratch home and every other
// path the run uses are the harness's own writes.
export async function extractExecutable(
	verified: VerifiedArchiveOutcome,
	workDirectory: string,
): Promise<ExtractedExecutable | ExtractRefusal> {
	if (!verified.ok) {
		return {
			ok: false,
			reason: "NOT_VERIFIED",
			message: "The archive was not verified, so nothing is extracted from it.",
		};
	}
	const executable = executableMember(verified.members);
	if (!executable.ok) {
		return {
			ok: false,
			reason: "EXECUTABLE_MEMBER_ABSENT",
			message: `The verified archive carries no single executable member: ${executable.message}`,
		};
	}
	// Extract under the archive's own member name, flattened to a single
	// file, so the mount is one path a run report can name.
	const memberName = executable.member.name.split("/").pop() ?? "slingshot";
	const path = join(workDirectory, memberName);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, executable.member.bytes);
	// The executable bit travels with the bytes: a mount of a non-executable
	// file proves nothing about the release row a user runs.
	await chmod(path, 0o755);
	return { ok: true, path };
}

// Starts the runner: the executable and the scratch home mounted, nothing
// published, the client account's passwd home carrying the scratch home. The
// readiness probe runs through the mounted executable itself, so a runner
// whose executable does not start never reports ready.
export async function startClientRunner(
	options: StartClientRunnerOptions,
): Promise<StartClientRunnerOutcome> {
	const runArgs = [
		"run",
		"-d",
		"--pull=never",
		"--userns=keep-id:uid=1000,gid=1000",
		"--label",
		`${options.values.label.key}=${options.labelValue}`,
		"--network",
		options.network,
		"-v", `${options.executablePath}:${runnerExecutablePath}:ro`,
		"-v", `${options.scratchHome.homePath}:${runnerHomePath}`,
		options.image,
		"sleep", "infinity",
	];

	const outcome = await runPodman(runArgs, {
		captureLimitBytes: options.values.capture.maximumBytes,
		captureDirectory: options.captureDirectory,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});

	if (!outcome.ok) {
		return {
			ok: false,
			reason: "START_FAILED",
			message: outcome.message,
			stdoutTail: outcome.stdoutTail,
			stderrTail: outcome.stderrTail,
		};
	}

	const containerId = (await readFile(outcome.stdoutPath, "utf8")).trim();

	const intervalMs = options.values.readiness.pollIntervalSeconds * 1000;
	const deadlineMs = options.deadline.getTime();
	while (true) {
		if (await executableAnswers(containerId, options)) {
			return {
				ok: true,
				handle: {
					ok: true,
					id: containerId,
					labelKey: options.values.label.key,
					labelValue: options.labelValue,
					network: options.network,
					publishedPorts: [],
					captureLogs: async () => {
						const logs = await runPodman(["logs", containerId], {
							captureLimitBytes: options.values.capture.maximumBytes,
							captureDirectory: options.captureDirectory,
							...(options.executable !== undefined ? { executable: options.executable } : {}),
						});
						if (!logs.ok) return logs;
						return { ok: true, logPath: logs.stdoutPath };
					},
					stop: async (graceSeconds: number) => {
						await runPodman(["kill", "--signal", "TERM", containerId], {
							captureLimitBytes: options.values.capture.maximumBytes,
							captureDirectory: options.captureDirectory,
							...(options.executable !== undefined ? { executable: options.executable } : {}),
						});
						const graceDeadline = Date.now() + graceSeconds * 1000;
						while (Date.now() < graceDeadline) {
							const inspect = await runPodman(["inspect", "-f", "{{.State.Running}}", containerId], {
								captureLimitBytes: options.values.capture.maximumBytes,
								captureDirectory: options.captureDirectory,
								...(options.executable !== undefined ? { executable: options.executable } : {}),
							});
							if (inspect.ok && (await readFile(inspect.stdoutPath, "utf8")).trim() === "false") {
								return { ok: true, command: ["stop"], exitCode: 0, stdoutPath: "", stderrPath: "" };
							}
							await Bun.sleep(200);
						}
						return (await runPodman(["kill", "--signal", "KILL", containerId], {
							captureLimitBytes: options.values.capture.maximumBytes,
							captureDirectory: options.captureDirectory,
							...(options.executable !== undefined ? { executable: options.executable } : {}),
						}));
					},
					remove: async () => runPodman(["rm", "-f", "-t", "0", containerId], {
						captureLimitBytes: options.values.capture.maximumBytes,
						captureDirectory: options.captureDirectory,
						...(options.executable !== undefined ? { executable: options.executable } : {}),
					}),
				},
			};
		}
		const remainingMs = deadlineMs - Date.now();
		if (remainingMs <= 0) {
			break;
		}
		await Bun.sleep(Math.min(intervalMs, remainingMs));
	}

	// Handle timeout
	const id = containerId;
	await runPodman(["kill", "--signal", "KILL", id], {
		captureLimitBytes: options.values.capture.maximumBytes,
		captureDirectory: options.captureDirectory,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});
	const logs = await runPodman(["logs", id], {
		captureLimitBytes: options.values.capture.maximumBytes,
		captureDirectory: options.captureDirectory,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});
	await runPodman(["rm", "-f", "-t", "0", id], {
		captureLimitBytes: options.values.capture.maximumBytes,
		captureDirectory: options.captureDirectory,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});

	if (!logs.ok) {
		return {
			ok: false,
			reason: "NEVER_BECAME_READY",
			message: `The container ${id} did not become ready by the deadline ${options.deadline.toISOString()} and its log could not be captured: ${logs.message}`,
			logPath: "",
			logTail: "",
		};
	}
	const logText = await readFile(logs.stdoutPath, "utf8");
	return {
		ok: false,
		reason: "NEVER_BECAME_READY",
		message: `The container ${id} did not become ready by the deadline ${options.deadline.toISOString()}; the captured log at "${logs.stdoutPath}" holds what it printed: ${JSON.stringify(logText)}`,
		logPath: logs.stdoutPath,
		logTail: logText,
	};
}

// The runner's readiness is the mounted executable answering: an exec of the
// binary itself, so readiness proves the mount carries executable bytes and
// nothing else.
async function executableAnswers(
	id: string,
	options: StartClientRunnerOptions,
): Promise<boolean> {
	const outcome = await execInContainer(id, [runnerExecutablePath, "check-configuration"], options);
	return outcome.ok && outcome.exitCode === 0;
}

export type ExecOutcome = {
	readonly ok: true;
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export type ExecRefusal = {
	readonly ok: false;
	readonly message: string;
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export type ExecResult = ExecOutcome | ExecRefusal;

export function isExecRefusal(outcome: ExecResult): outcome is ExecRefusal {
	return outcome.ok === false;
}

// One CLI invocation through exec, bounded capture, the answer read from the
// captured output — never from a probe's absence or a fixed span. Each exec
// captures into its own fresh subdirectory, so no invocation's answer is
// ever read from another's file. An exit code the invocation itself chose is
// an answer, not an engine failure: the client's own CLI signals through it,
// so the exit code and both streams travel to the caller.
//
// `stdinBytes` is how a leaf that reads its input is driven: the bytes travel
// on the same bounded invocation path as every other command, so the protocol
// server is reached through the run's own capture discipline rather than a
// second path with its own limits.
export async function execInContainer(
	id: string,
	command: readonly string[],
	options: StartClientRunnerOptions,
	stdinBytes?: Uint8Array,
): Promise<ExecResult> {
	const captureDirectory = await mkdtemp(join(options.captureDirectory, "exec-"));
	const outcome = await runPodman(
		// The input flag travels with the input: an invocation carrying no
		// bytes is the invocation every other scenario makes, unchanged.
		["exec", ...(stdinBytes !== undefined ? ["-i"] : []), id, ...command],
		{
			captureLimitBytes: options.values.capture.maximumBytes,
			captureDirectory,
			...(stdinBytes !== undefined ? { stdinBytes } : {}),
			...(options.executable !== undefined ? { executable: options.executable } : {}),
		},
	);

	if (!outcome.ok) {
		if (outcome.reason === "failed") {
			const match = outcome.message.match(/exited with code (\d+)/);
			const captured = match?.[1];
			const exitCode = captured === undefined ? 1 : parseInt(captured, 10);
			const stdout = await readFile(outcome.stdoutPath, "utf8");
			const stderr = await readFile(outcome.stderrPath, "utf8");
			return { ok: true, exitCode, stdout, stderr };
		}
		return {
			ok: false,
			message: outcome.message,
			exitCode: 1,
			stdout: outcome.stdoutTail,
			stderr: outcome.stderrTail,
		};
	}

	const stdout = await readFile(outcome.stdoutPath, "utf8");
	const stderr = await readFile(outcome.stderrPath, "utf8");
	return { ok: true, exitCode: outcome.exitCode, stdout, stderr };
}

// The three answers the contract's sequence gives, each read from captured
// machine output: check-configuration accepts the harness-written documents
// (which proves the mounts satisfy the client's own ownership and
// single-name rules), daemon ping reports absent, daemon start reports
// created. The client's own exit classification (crates/slingshot-command-
// line/src/exit_classification.rs) declares every lifecycle answer a
// SUCCESS: ping reports absence with exit 0 and state "absent", start
// reports creation with exit 0 and state "created".
export type SequenceAnswers = {
	readonly configurationAccepted: boolean;
	readonly pingAbsent: boolean;
	readonly startCreated: boolean;
};

export type SequenceOutcome =
	| { readonly ok: true; readonly answers: SequenceAnswers }
	| {
			readonly ok: false;
			readonly step: "check-configuration" | "daemon-ping" | "daemon-start";
			readonly message: string;
			readonly stdout: string;
			readonly stderr: string;
	  };

// The machine envelope the client's --machine form writes, read back from
// the captured output: the answer comes from the client's own bytes, never
// from a probe's absence. Every member a scenario reads is declared, so a
// member the client does not write is a compile-time absence rather than an
// undefined read at run time: an index signature here would accept any name
// and prove nothing about the envelope's shape.
export type MachineEnvelope = {
	readonly outcome: string;
	readonly state?: string;
	readonly resolved?: boolean;
	readonly kind?: string;
	readonly operation_identifier?: string;
	readonly revision?: number;
	readonly category?: string;
	readonly evidence?: string;
	readonly result?: Record<string, unknown>;
	readonly failure?: { readonly metadata?: string };
};

export function parseMachineEnvelope(stdout: string): MachineEnvelope | null {
	const line = stdout.split("\n").find((candidate) => candidate.trim().startsWith("{"));
	if (line === undefined) {
		return null;
	}
	try {
		return JSON.parse(line) as MachineEnvelope;
	} catch {
		return null;
	}
}

export async function proveClientSequence(
	handle: ClientRunnerHandle,
	options: StartClientRunnerOptions,
): Promise<SequenceOutcome> {
	const id = handle.handle.id;
	// Options before the leaf, the pair named explicitly: the machine form
	// the run reads its answers from, and the runtime root the run's daemon
	// endpoints live under. The daemon lifecycle leaves resolve the
	// namespace solely from --profile/--environment named on the invocation
	// (crates/slingshot-command-line/src/target_selection.rs namespace_of;
	// the selection document is never consulted there), so the scratch
	// home's pair travels on each one — an unnamed target is refused
	// SelectionIncomplete with usage exit 2 and empty stdout.
	const namespace = [
		"--profile",
		options.scratchHome.profileName,
		"--environment",
		options.scratchHome.environmentName,
	];
	const machine = ["--machine", "--runtime-root", options.runtimeRoot, ...namespace];
	const configuration = await execInContainer(
		id,
		[runnerExecutablePath, "check-configuration", ...machine],
		options,
	);
	const configurationEnvelope = configuration.ok
		? parseMachineEnvelope(configuration.stdout)
		: undefined;
	if (
		!configuration.ok ||
		configuration.exitCode !== 0 ||
		configurationEnvelope?.outcome !== "configuration_report" ||
		configurationEnvelope.resolved !== true
	) {
		return {
			ok: false,
			step: "check-configuration",
			message: configuration.ok
				? `check-configuration exited ${configuration.exitCode} and reported ${
						JSON.stringify(configurationEnvelope ?? configuration.stdout)
					} instead of a resolved report.`
				: configuration.message,
			stdout: configuration.ok ? configuration.stdout : "",
			stderr: configuration.ok ? configuration.stderr : "",
		};
	}
	const ping = await execInContainer(
		id,
		[runnerExecutablePath, "daemon", "ping", ...machine],
		options,
	);
	const pingEnvelope = ping.ok ? parseMachineEnvelope(ping.stdout) : undefined;
	// The daemon is absent before anything starts it: the client's own ping
	// says so, with exit 0 and the state its envelope names.
	if (
		!ping.ok ||
		ping.exitCode !== 0 ||
		pingEnvelope?.outcome !== "daemon_control" ||
		pingEnvelope.state !== "absent"
	) {
		return {
			ok: false,
			step: "daemon-ping",
			message: ping.ok
				? `daemon ping exited ${ping.exitCode} and reported ${JSON.stringify(
						pingEnvelope ?? ping.stdout,
					)} instead of absent.`
				: ping.message,
			stdout: ping.ok ? ping.stdout : "",
			stderr: ping.ok ? ping.stderr : "",
		};
	}
	const start = await execInContainer(
		id,
		[runnerExecutablePath, "daemon", "start", ...machine],
		options,
	);
	const startEnvelope = start.ok ? parseMachineEnvelope(start.stdout) : undefined;
	if (
		!start.ok ||
		start.exitCode !== 0 ||
		startEnvelope?.outcome !== "daemon_control" ||
		startEnvelope.state !== "created"
	) {
		return {
			ok: false,
			step: "daemon-start",
			message: start.ok
				? `daemon start exited ${start.exitCode} and reported ${JSON.stringify(
						startEnvelope ?? start.stdout,
					)} instead of created.`
				: start.message,
			stdout: start.ok ? start.stdout : "",
			stderr: start.ok ? start.stderr : "",
		};
	}
	return {
		ok: true,
		answers: {
			configurationAccepted: true,
			pingAbsent: true,
			startCreated: true,
		},
	};
}

// The run's work directory cleanup is the caller's; this helper removes one
// when the caller asks, so no scenario leaves bytes behind.
export async function removeWorkDirectory(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}

// A fresh work directory for one run's extracted executable, under the
// caller's parent: the path an extracted executable lives in is the run's
// own, never a shared name.
export async function freshWorkDirectory(parent?: string): Promise<string> {
	return mkdtemp(join(parent ?? tmpdir(), "client-work-"));
}