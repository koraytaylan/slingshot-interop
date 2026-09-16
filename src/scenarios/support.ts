// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Shared vocabulary for the scenarios: the machine invocation shape every
// scenario uses, the terminal observation loop, and the authenticated reads
// of the agent's own routes. Nothing here invents a vocabulary the client
// does not offer: every option and envelope tag is spelled as the client's
// own sources spell it.

import { readDaemonDatabase } from "./daemon-database.ts";
import { join } from "node:path";
import { execInContainer, parseMachineEnvelope, runnerExecutablePath, type ExecResult, type MachineEnvelope, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { WAIT_NOTICE_SECONDS } from "../run/progress.ts";
import { readAgentSnapshot, type AgentSnapshot } from "./agent-snapshot.ts";

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

export async function invoke(handle: ContainerHandle, command: readonly string[], options: StartClientRunnerOptions, stdinBytes?: Uint8Array, deadline?: number): Promise<Invocation | { readonly ok: false; readonly message: string }> {
	const commandDeadline = deadline ?? Date.now() + options.values.readiness.harnessSeconds * 1000;
	if (!Number.isSafeInteger(commandDeadline) || commandDeadline <= Date.now()) {
		return { ok: false, message: "invocation deadline expired or invalid before dispatch" };
	}
	const outcome: ExecResult = await execInContainer(handle.id,
		["sh", "-c", observationDeadlineScript, "observation-deadline", String(commandDeadline), ...command],
		options, stdinBytes, commandDeadline);
	if (Date.now() >= commandDeadline || outcome.ok && (outcome.exitCode === 124 || outcome.exitCode === 137)) {
		return { ok: false, message: "invocation exceeded its command deadline" };
	}
	if (!outcome.ok) {
		return { ok: false, message: outcome.message };
	}
	return outcome;
}

// Bound the observing CLI inside the container, not merely its local Podman
// transport. This does not cancel an admitted remote operation or its daemon.
// The runner image provides GNU date/timeout. Container and host use the same
// epoch clock; compute the budget after engine dispatch, not before it.
const observationDeadlineScript = `set -eu
deadline="$1"
shift
now="$(date +%s%3N)"
case "$now" in ''|*[!0-9]*) exit 125 ;; esac
remaining=$((deadline - now))
[ "$remaining" -gt 0 ] || exit 124
duration="$(printf '%d.%03ds' "$((remaining / 1000))" "$((remaining % 1000))")"
exec timeout --signal=KILL -- "$duration" "$@"`;

export async function invokeBeforeDeadline(handle: ContainerHandle, command: readonly string[], options: StartClientRunnerOptions, deadline: number): Promise<Invocation | { readonly ok: false; readonly message: string }> {
	const remaining = deadline - Date.now();
	if (!Number.isSafeInteger(deadline) || !Number.isFinite(remaining) || remaining <= 0) return { ok: false, message: "observation deadline expired or invalid before invocation" };
	const outcome = await invoke(handle, command, options, undefined, deadline);
	if (Date.now() >= deadline || outcome.ok && (outcome.exitCode === 124 || outcome.exitCode === 137)) {
		return { ok: false, message: "observation command exceeded its scenario deadline" };
	}
	return outcome;
}

// Reads the single machine envelope of one captured stdout, as its own
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
	const report = options.progress ?? (() => {});
	const startedAt = Date.now();
	let noticed = 0;
	let lastAnswer: string | undefined;
	report(`waiting for ${operationIdentifier} to reach a terminal answer (up to ${Math.round(deadlineMs / 1000)}s)`);
	while (Date.now() < deadline) {
		const waited = await invokeBeforeDeadline(handle, [runner(), ...machine, "operation-wait", "--operation", operationIdentifier], options, deadline);
		if (!waited.ok) {
			return { ok: false, message: `operation-wait could not run: ${waited.message}` };
		}
		lastAnswer = waited.stdout;
		if (Date.now() >= deadline) break;
		const terminal = await terminalAnswer(handle, machine, waited, operationIdentifier, options, deadline);
		if (Date.now() >= deadline) break;
		if (terminal !== undefined) {
			// Nothing is said here on success. The scenario that asked for this
			// wait reports how it went, and a second voice on the same event is
			// a line a reader has to reconcile rather than read.
			return terminal;
		}
		// Still waiting is the one thing a reader cannot tell from a hang, so it
		// is said at the same cadence the run says it everywhere else. The state
		// the daemon reported travels with it, because "still waiting" and
		// "still waiting, and it is running" are different things to a person
		// watching.
		const waitedSeconds = Math.round((Date.now() - startedAt) / 1000);
		if (waitedSeconds >= (noticed + 1) * WAIT_NOTICE_SECONDS) {
			noticed += 1;
			const parsed = envelope(waited.stdout, "operation-wait");
			const state = parsed.ok === false ? "an answer that could not be read" : `state ${String(parsed.state ?? "unknown")}`;
			report(`still waiting for ${operationIdentifier} after ${waitedSeconds}s (${state})`);
		}
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
async function terminalAnswer(handle: ContainerHandle, machine: readonly string[], answer: Invocation, operationIdentifier: string, options: StartClientRunnerOptions, deadline: number): Promise<WaitOutcome | undefined> {
	const parsed = envelope(answer.stdout, "operation-wait");
	if (parsed.ok === false) {
		return { ok: false, message: `operation-wait on its last answer: ${parsed.message}` };
	}
	const outcome = parsed.outcome;
	if (answer.exitCode !== 0 && (outcome === "operation_status" || outcome === "operation_result" || outcome === "structured_result_artifact_access")) {
		return { ok: false, message: `operation-wait reported ${outcome} but exited ${answer.exitCode}` };
	}
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
			if (Date.now() >= deadline) return { ok: false, message: "operation-result was not started because the scenario deadline expired" };
			const fetched = await invokeBeforeDeadline(handle, [runner(), ...machine, "operation-result", "--operation", operationIdentifier], options, deadline);
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
	if (answer.exitCode !== 0 && (outcome === "operation_result" || outcome === "structured_result_artifact_access")) {
		return { ok: false, message: `${what} reported ${outcome} but exited ${answer.exitCode}` };
	}
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
export type { AgentSnapshot } from "./agent-snapshot.ts";

// Reads one authenticated snapshot of the agent's own record, or a refusal
// naming what the route answered instead.
export async function agentSnapshot(
	options: StartClientRunnerOptions,
	agentOperationIdentifier: string,
	expectedTargetDigest: string,
): Promise<{ readonly ok: true; readonly snapshot: AgentSnapshot } | { readonly ok: false; readonly message: string }> {
	try {
		const response = await fetch(
			`http://127.0.0.1:${options.values.ports.author}/bin/slingshot/agent/snapshot?agent_operation_identifier=${encodeURIComponent(agentOperationIdentifier)}`,
			{ redirect: "error", headers: { authorization: agentAuthorization("admin", "admin") }, signal: AbortSignal.timeout(10_000) },
		);
		return await readAgentSnapshot(response, agentOperationIdentifier, options.values.capture.maximumBytes, expectedTargetDigest);
	} catch {
		return { ok: false, message: "agent snapshot request could not complete without transport or redirect failure" };
	}
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
// the daemon's sqlite rather than re-derived here. The client's inventory row
// ("find one local operation's retained author submission") also keys on its
// target digest. The receipt does not expose that digest, so this observation
// checks the independent expectation retained from the authored profile as
// well as uniqueness in the selected namespace.
//
// A short read-only SQLite connection participates in WAL locking; copying
// the live database and sidecars separately would not be a coherent snapshot.
const DAEMON_STATE_RELATIVE = ".local/share/slingshot/state";
const TARGETS_DIRECTORY = "targets";
const DATABASE_FILE_NAME = "operations.sqlite3";
// The constants the client's own namespace digest is taken over
// (crates/slingshot-daemon/src/runtime_namespace.rs).
const NAMESPACE_DIGEST_DOMAIN = "slingshot.runtime-namespace/1";
const READABLE_NAME_CHARACTERS = 24;

export type AgentIdentifierResolution =
	| { readonly ok: true; readonly agentOperationIdentifier: string; readonly targetDigest: string }
	| { readonly ok: false; readonly message: string };

export async function resolveAgentOperationIdentifier(options: Pick<StartClientRunnerOptions, "scratchHome">, profileName: string, operationIdentifier: string): Promise<AgentIdentifierResolution> {
	const expectedTarget = expectedTargetForProfile(options, profileName);
	if (expectedTarget === undefined) return { ok: false, message: "no independent target expectation is recorded for the selected profile" };
	const homePath = options.scratchHome.homePath;
	const targets = join(homePath, DAEMON_STATE_RELATIVE, TARGETS_DIRECTORY);
	const key = namespaceKey(profileName, options.scratchHome.environmentName);
	const databasePath = join(targets, key, DATABASE_FILE_NAME);
	try {
		return readDaemonDatabase(databasePath, (database): AgentIdentifierResolution => {
			const rows = database
				.query<{ agent_operation_identifier: unknown; author_target_identity_digest: unknown; operation_count: number; matching_operation_count: number }, [string]>(
					`SELECT agent_operation_identifier, author_target_identity_digest,
						(SELECT COUNT(*) FROM operation
						 WHERE operation.operation_identifier = agent_operation.operation_identifier) AS operation_count,
						(SELECT COUNT(*) FROM operation
						 WHERE operation.operation_identifier = agent_operation.operation_identifier
						 AND operation.author_target_identity_digest = agent_operation.author_target_identity_digest) AS matching_operation_count
					 FROM agent_operation WHERE operation_identifier = ? LIMIT 2`,
				)
				.all(operationIdentifier);
			const row = rows[0];
			if (rows.length !== 1 || row === undefined) {
				return { ok: false, message: `the daemon's record does not hold exactly one agent submission for ${operationIdentifier} in ${key}` };
			}
			if (row.operation_count !== 1 || row.matching_operation_count !== 1) {
				return { ok: false, message: "the daemon's agent submission does not belong to one unambiguous retained operation in the same target" };
			}
			if (row.author_target_identity_digest !== expectedTarget) {
				return { ok: false, message: "the daemon's agent submission target differs from the independently authored profile" };
			}
			if (typeof row.agent_operation_identifier !== "string" || row.agent_operation_identifier.length !== 64
				|| /[^0-9a-f]/.test(row.agent_operation_identifier)) {
				return { ok: false, message: "the daemon's submission does not name a canonical derived agent identifier" };
			}
			return { ok: true, agentOperationIdentifier: row.agent_operation_identifier, targetDigest: expectedTarget };
		});
	} catch {
		return { ok: false, message: "the daemon's operation database could not be opened or queried for the retained agent submission" };
	}
}

export type LocalArtifactResolution =
	| { readonly ok: true; readonly artifactIdentifier: string; readonly targetDigest: string }
	| { readonly ok: false; readonly message: string };

// The local name the daemon bound one artifact slot to. A result's own
// descriptor carries the name the agent chose, which the daemon treats as
// opaque provenance: the artifact it publishes is named by the daemon's own
// derivation over its installation, this target, this operation and the slot
// (crates/slingshot-storage/src/artifact_store.rs, `ArtifactIdentifier::derive`).
// The fetch leaf addresses the daemon's name, so it is read from the daemon's
// own association row rather than from the agent's descriptor.
export async function resolveLocalArtifactIdentifier(options: Pick<StartClientRunnerOptions, "scratchHome">, profileName: string, operationIdentifier: string, slot: string): Promise<LocalArtifactResolution> {
	const expectedTarget = expectedTargetForProfile(options, profileName);
	if (expectedTarget === undefined) return { ok: false, message: "no independent target expectation is recorded for the selected profile" };
	const homePath = options.scratchHome.homePath;
	const targets = join(homePath, DAEMON_STATE_RELATIVE, TARGETS_DIRECTORY);
	const key = namespaceKey(profileName, options.scratchHome.environmentName);
	const databasePath = join(targets, key, DATABASE_FILE_NAME);
	try {
		return readDaemonDatabase(databasePath, (database): LocalArtifactResolution => {
			// The receipt does not expose the target digest. Refuse ambiguity
			// rather than silently choosing one partition's first matching row.
			// Check the retained operation in the same SQLite statement/snapshot:
			// a unique association alone could be orphaned or in another target.
			const rows = database
				.query<{ artifact_identifier: unknown; author_target_identity_digest: unknown; operation_count: number; matching_operation_count: number }, [string, string]>(
					`SELECT artifact_identifier, author_target_identity_digest,
						(SELECT COUNT(*) FROM operation
						 WHERE operation.operation_identifier = artifact_association.operation_identifier) AS operation_count,
						(SELECT COUNT(*) FROM operation
						 WHERE operation.operation_identifier = artifact_association.operation_identifier
						 AND operation.author_target_identity_digest = artifact_association.author_target_identity_digest) AS matching_operation_count
					 FROM artifact_association WHERE operation_identifier = ? AND artifact_slot = ? LIMIT 2`,
				)
				.all(operationIdentifier, slot);
			const row = rows[0];
			if (rows.length !== 1 || row === undefined) {
				return { ok: false, message: `the daemon's record does not hold exactly one artifact in slot ${slot} for ${operationIdentifier} in ${key}` };
			}
			if (row.operation_count !== 1 || row.matching_operation_count !== 1) {
				return { ok: false, message: "the daemon's artifact association does not belong to one unambiguous retained operation in the same target" };
			}
			if (row.author_target_identity_digest !== expectedTarget) {
				return { ok: false, message: "the daemon's artifact target differs from the independently authored profile" };
			}
			if (typeof row.artifact_identifier !== "string" || row.artifact_identifier.length !== 64
				|| /[^0-9a-f]/.test(row.artifact_identifier)) {
				return { ok: false, message: "the daemon's artifact association does not name a canonical local artifact identifier" };
			}
			if (typeof row.author_target_identity_digest !== "string" || !/^[0-9a-f]{64}$/.test(row.author_target_identity_digest)) {
				return { ok: false, message: "the daemon's artifact association does not name a canonical target digest" };
			}
			return { ok: true, artifactIdentifier: row.artifact_identifier, targetDigest: row.author_target_identity_digest };
		});
	} catch {
		return { ok: false, message: "the daemon's operation database could not be opened or queried for the artifact association" };
	}
}

// Missing or malformed oracle metadata is a refusal, never permission to use
// a target supplied by the system being checked.
function expectedTargetForProfile(options: Pick<StartClientRunnerOptions, "scratchHome">, profileName: string): string | undefined {
	const expectations = options.scratchHome.expectedTargetDigests;
	if (!expectations || !Object.hasOwn(expectations, profileName)) return undefined;
	const digest = expectations[profileName];
	return typeof digest === "string" && digest.length === 64 && !/[^0-9a-f]/.test(digest) ? digest : undefined;
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
