// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Shared vocabulary for the scenarios: the machine invocation shape every
// scenario uses, the terminal observation loop, and the authenticated reads
// of the agent's own routes. Nothing here invents a vocabulary the client
// does not offer: every option and envelope tag is spelled as the client's
// own sources spell it.

import { Database } from "bun:sqlite";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execInContainer, parseMachineEnvelope, runnerExecutablePath, type ExecResult, type MachineEnvelope, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

// The global shape every catalog invocation carries, machine-rendered,
// against the run's runtime root and the scratch home's pair: the machine
// form and the runtime root before the leaf, then the profile and the
// environment.
export function machineArguments(options: StartClientRunnerOptions, profileName: string): string[] {
	return [
		"--machine",
		"--runtime-root",
		options.runtimeRoot,
		"--profile",
		profileName,
		"--environment",
		options.scratchHome.environmentName,
	];
}

export function runner(): string {
	return runnerExecutablePath;
}

// One invocation: an engine answer is an answer, an engine failure is a
// scenario failure.
export type Invocation = { readonly ok: true; readonly exitCode: number; readonly stdout: string; readonly stderr: string };

export async function invoke(handle: ContainerHandle, command: readonly string[], options: StartClientRunnerOptions, stdinBytes?: Uint8Array): Promise<Invocation | { readonly ok: false; readonly message: string }> {
	const outcome: ExecResult = await execInContainer(handle.id, command, options, stdinBytes);
	if (!outcome.ok) {
		return { ok: false, message: outcome.message };
	}
	return outcome;
}

// Reads the first machine envelope of one captured stdout, as its own
// failure when there is none. The success branch spreads the parsed envelope
// over its own `ok`, so the caller's guard against `ok === false` narrows to
// the envelope's declared members and a caller that never guarded is a type
// error rather than an undefined read.
export type EnvelopeRead = MachineEnvelope & { readonly ok: true };

export function envelope(stdout: string, what: string): EnvelopeRead | { readonly ok: false; readonly message: string } {
	const parsed = parseMachineEnvelope(stdout);
	if (parsed === null) {
		return { ok: false, message: `${what} wrote no machine envelope: ${stdout}` };
	}
	return { ...parsed, ok: true };
}

// Waits on one operation through the client's own observation leaf until
// the machine envelope is terminal. What it ends as is the scenario's to
// assert, so no polling here classifies an outcome it does not own. A
// structured-result artifact access is terminal: it is the answer the daemon
// hands over once an over-inline result is settled, and it carries the
// artifact entry the artifact-transfer scenario asserts on.
//
// The loop mirrors the client's own live wait: a bare status leaf whose
// state says terminal or recovery_required is not itself the answer, and
// the client fetches the operation's result and returns that envelope. A
// status whose state is neither keeps the loop waiting.
export type WaitOutcome =
	| { readonly ok: true; readonly envelope: EnvelopeRead }
	| { readonly ok: false; readonly message: string };

export async function waitTerminal(handle: ContainerHandle, machine: readonly string[], operationIdentifier: string, options: StartClientRunnerOptions, deadlineMs: number): Promise<WaitOutcome> {
	const poll = options.values.readiness.pollIntervalSeconds * 1000;
	const deadline = Date.now() + deadlineMs;
	let lastAnswer: string | undefined;
	while (Date.now() < deadline) {
		const waited = await invoke(handle, [runner(), ...machine, "operation-wait", "--operation", operationIdentifier], options);
		if (!waited.ok) {
			return { ok: false, message: `operation-wait could not run: ${waited.message}` };
		}
		const terminal = await terminalAnswer(handle, machine, waited, operationIdentifier, options);
		if (terminal !== undefined) {
			return terminal;
		}
		lastAnswer = waited.stdout;
		await Bun.sleep(Math.min(poll, Math.max(1, deadline - Date.now())));
	}
	return { ok: false, message: `operation-wait on ${operationIdentifier} did not reach a terminal answer by the scenario's deadline; its last answer was ${JSON.stringify((lastAnswer ?? "").slice(0, 800))}` };
}

// The terminal answers the operation-wait leaf can lead to. A bare status
// whose state names an ended operation is followed by the result read the
// client's own wait does; a status in any other state, or a stdout that
// carries no machine envelope at all, keeps the loop waiting — except that
// an unparseable stdout is reported as its own failure rather than waited
// through to the deadline.
async function terminalAnswer(handle: ContainerHandle, machine: readonly string[], answer: Invocation, operationIdentifier: string, options: StartClientRunnerOptions): Promise<WaitOutcome | undefined> {
	const parsed = envelope(answer.stdout, "operation-wait");
	if (parsed.ok === false) {
		return { ok: false, message: `operation-wait on its last answer: ${parsed.message}` };
	}
	const outcome = parsed.outcome;
	if (
		outcome === "operation_result"
		|| outcome === "operation_terminal_error"
		|| outcome === "operation_recovery_required"
		|| outcome === "structured_result_artifact_access"
	) {
		return { ok: true, envelope: parsed };
	}
	if (outcome === "operation_status") {
		const state = parsed.state;
		if (state === "terminal" || state === "recovery_required") {
			const fetched = await invoke(handle, [runner(), ...machine, "operation-result", "--operation", operationIdentifier], options);
			if (!fetched.ok) {
				return { ok: false, message: `operation-result could not run after a ${String(state)} status: ${fetched.message}` };
			}
			const terminal = terminalEnvelope(fetched, `operation-result after a ${String(state)} status`);
			return terminal;
		}
	}
	return undefined;
}

// The terminal envelopes the operation-result leaf answers with.
function terminalEnvelope(answer: Invocation, what: string): WaitOutcome {
	const parsed = envelope(answer.stdout, what);
	if (parsed.ok === false) {
		return { ok: false, message: `${what} wrote no machine envelope: ${answer.stdout.slice(0, 800)}` };
	}
	const outcome = parsed.outcome;
	if (
		outcome === "operation_result"
		|| outcome === "operation_terminal_error"
		|| outcome === "operation_recovery_required"
		|| outcome === "structured_result_artifact_access"
	) {
		return { ok: true, envelope: parsed };
	}
	return { ok: false, message: `${what} answered ${JSON.stringify(parsed)} instead of a terminal envelope` };
}

// The agent's own snapshot document, as the lookup route answers it. The
// member a scenario compares is declared, so a route that stopped writing it
// is a compile-time absence rather than an undefined read: the whole point of
// this read is that the agent's record agrees with what the client reported,
// and a `kind` read off an index signature would compare `undefined` and
// prove nothing.
export type AgentSnapshot = {
	readonly kind: string;
	readonly generation?: number;
	readonly terminal_result?: unknown;
	readonly terminal_failure?: unknown;
};

// Reads one authenticated snapshot of the agent's own record, or a refusal
// naming what the route answered instead.
export async function agentSnapshot(
	options: StartClientRunnerOptions,
	agentOperationIdentifier: string,
): Promise<{ readonly ok: true; readonly snapshot: AgentSnapshot } | { readonly ok: false; readonly message: string }> {
	const response = await fetch(
		`http://127.0.0.1:${options.values.ports.author}/bin/slingshot/agent/snapshot?agent_operation_identifier=${encodeURIComponent(agentOperationIdentifier)}`,
		{ headers: { authorization: agentAuthorization("admin", "admin") }, signal: AbortSignal.timeout(10_000) },
	);
	if (!response.ok) {
		return { ok: false, message: `the agent's lookup route answered ${response.status} for ${agentOperationIdentifier}` };
	}
	const snapshot = (await response.json()) as AgentSnapshot;
	if (typeof snapshot.kind !== "string") {
		return { ok: false, message: `the agent's lookup route answered a document naming no kind for ${agentOperationIdentifier}` };
	}
	return { ok: true, snapshot };
}

// The basic-auth credentials the run's agent accepts, spelled by the caller
// that owns them.
export function agentAuthorization(username: string, password: string): string {
	return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

// The agent-side name of one submitted operation, read from the daemon's own
// record. The client derives `agent_operation_identifier` at submission
// (crates/slingshot-domain/src/agent_identity.rs) and stores it next to the
// operation it came from, so the lookup route's query member is answered from
// the daemon's sqlite rather than re-derived here: the statement mirrors the
// client's own inventory row ("find one local operation's retained author
// submission"), keyed on the operation identifier the receipt named.
//
// The database is opened from a copy, never in place: a daemon holds the live
// file under WAL, and a second connection on the host side is a reader the
// daemon's own locking never accounted for.
const DAEMON_STATE_RELATIVE = ".local/share/slingshot/state";
const TARGETS_DIRECTORY = "targets";
const DATABASE_FILE_NAME = "operations.sqlite3";
// The constants the client's own namespace digest is taken over
// (crates/slingshot-daemon/src/runtime_namespace.rs).
const NAMESPACE_DIGEST_DOMAIN = "slingshot.runtime-namespace/1";
const READABLE_NAME_CHARACTERS = 24;

export type AgentIdentifierResolution =
	| { readonly ok: true; readonly agentOperationIdentifier: string }
	| { readonly ok: false; readonly message: string };

export async function resolveAgentOperationIdentifier(options: StartClientRunnerOptions, profileName: string, operationIdentifier: string): Promise<AgentIdentifierResolution> {
	const homePath = options.scratchHome.homePath;
	const targets = join(homePath, DAEMON_STATE_RELATIVE, TARGETS_DIRECTORY);
	let entries: readonly string[];
	try {
		entries = await readdir(targets);
	} catch {
		return { ok: false, message: `the daemon's target state is not under ${targets}: the daemon's record could not be read` };
	}
	const key = namespaceKey(profileName, options.scratchHome.environmentName);
	const databasePath = join(targets, key, DATABASE_FILE_NAME);
	try {
		await readFile(databasePath);
	} catch {
		return { ok: false, message: `the daemon's operation database is not at ${databasePath} (its targets hold ${entries.slice(0, 5).join(", ")} or fewer): the daemon's record could not be read` };
	}
	const scratch = await mkdtemp(join(tmpdir(), "interop-sqlite-"));
	try {
		await copyFile(databasePath, join(scratch, DATABASE_FILE_NAME));
		// Sidecars copied too, so a transaction the live daemon left
		// mid-flight is read as the pages it wrote, not as none.
		for (const sidecar of [`${DATABASE_FILE_NAME}-wal`, `${DATABASE_FILE_NAME}-shm`]) {
			try {
				await copyFile(join(databasePath, "..", sidecar), join(scratch, sidecar));
			} catch {
				// A database with no sidecar is a quiesced one: nothing to carry.
			}
		}
		const database = new Database(join(scratch, DATABASE_FILE_NAME), { readonly: true });
		try {
			const row = database
				.query<{ agent_operation_identifier: string }, [string]>(
					"SELECT agent_operation_identifier FROM agent_operation WHERE operation_identifier = ?",
				)
				.get(operationIdentifier);
			if (row === null || row === undefined) {
				return { ok: false, message: `the daemon's record holds no agent submission for ${operationIdentifier} in ${key}` };
			}
			if (!/^[0-9a-f]{64}$/.test(row.agent_operation_identifier)) {
				return { ok: false, message: `the daemon's record names ${JSON.stringify(row.agent_operation_identifier)} for ${operationIdentifier}, which is not a derived agent identifier` };
			}
			return { ok: true, agentOperationIdentifier: row.agent_operation_identifier };
		} finally {
			database.close();
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

export type LocalArtifactResolution =
	| { readonly ok: true; readonly artifactIdentifier: string }
	| { readonly ok: false; readonly message: string };

// The local name the daemon bound one artifact slot to. A result's own
// descriptor carries the name the agent chose, which the daemon treats as
// opaque provenance: the artifact it publishes is named by the daemon's own
// derivation over its installation, this target, this operation and the slot
// (crates/slingshot-storage/src/artifact_store.rs, `ArtifactIdentifier::derive`).
// The fetch leaf addresses the daemon's name, so it is read from the daemon's
// own association row rather than from the agent's descriptor.
export async function resolveLocalArtifactIdentifier(options: StartClientRunnerOptions, profileName: string, operationIdentifier: string, slot: string): Promise<LocalArtifactResolution> {
	const homePath = options.scratchHome.homePath;
	const targets = join(homePath, DAEMON_STATE_RELATIVE, TARGETS_DIRECTORY);
	const key = namespaceKey(profileName, options.scratchHome.environmentName);
	const databasePath = join(targets, key, DATABASE_FILE_NAME);
	try {
		await readFile(databasePath);
	} catch {
		return { ok: false, message: `the daemon's operation database is not at ${databasePath}: the daemon's record could not be read` };
	}
	const scratch = await mkdtemp(join(tmpdir(), "interop-sqlite-"));
	try {
		await copyFile(databasePath, join(scratch, DATABASE_FILE_NAME));
		for (const sidecar of [`${DATABASE_FILE_NAME}-wal`, `${DATABASE_FILE_NAME}-shm`]) {
			try {
				await copyFile(join(databasePath, "..", sidecar), join(scratch, sidecar));
			} catch {
				// A database with no sidecar is a quiesced one: nothing to carry.
			}
		}
		const database = new Database(join(scratch, DATABASE_FILE_NAME), { readonly: true });
		try {
			const row = database
				.query<{ artifact_identifier: string }, [string, string]>(
					"SELECT artifact_identifier FROM artifact_association WHERE operation_identifier = ? AND artifact_slot = ?",
				)
				.get(operationIdentifier, slot);
			if (row === null || row === undefined) {
				return { ok: false, message: `the daemon's record holds no artifact in slot ${slot} for ${operationIdentifier} in ${key}` };
			}
			return { ok: true, artifactIdentifier: row.artifact_identifier };
		} finally {
			database.close();
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

// The namespace key one target's state directory is named with: the readable
// parts first, then the digest over the length-framed pair, exactly the
// derivation crates/slingshot-daemon/src/runtime_namespace.rs performs.
function namespaceKey(profileName: string, environmentName: string): string {
	const readable = (name: string): string => {
		let text = "";
		for (const character of name) {
			const lower = character.toLowerCase();
			text += /^[a-z0-9-.]$/.test(lower) ? lower : "_";
		}
		return text.slice(0, READABLE_NAME_CHARACTERS);
	};
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(NAMESPACE_DIGEST_DOMAIN);
	absorbName(hasher, profileName);
	absorbName(hasher, environmentName);
	return `${readable(profileName)}-${readable(environmentName)}-${hasher.digest("hex")}`;
}

function absorbName(hasher: Bun.CryptoHasher, value: string): void {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(Buffer.byteLength(value, "utf8"));
	hasher.update(length);
	hasher.update(value, "utf8");
}