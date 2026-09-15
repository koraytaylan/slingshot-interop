// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The authentication-refusal scenario: credentials the author refuses have
// to be reported as what they are — an outcome the client cannot settle —
// never as a clean success or a fabricated failure. A second profile
// carries the same address with a wrong password, a read is submitted
// through it, and the agent's own lookup route proves the attempted key
// never reached the store.

import { chmod } from "node:fs/promises";
import { envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import { serializeProfile, sha256OfBytes, serializeSnapshot, profileDirectoryName, profileFileNameSuffix, configurationSnapshotFileName, selectionFileName, type SnapshotSource } from "../sides/client-configuration.ts";
import { join } from "node:path";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		// 1. A second profile, the same addresses, a wrong password: written
		// through the client's own configuration mechanism, the selection
		// document still naming the run's own pair.
		const profileName = `refused-${options.labelValue}`;
		const profile = {
			name: profileName,
			environment: options.scratchHome.environmentName,
			deployment: "adobe_experience_manager_6_5",
			authorAddress: authorAddress(options.values.ports.author),
			publisherAddress: authorAddress(options.values.ports.author),
			username: "admin",
			password: "not-the-password",
		};
		const profileContent = serializeProfile(profile);
		const profilePath = join(options.scratchHome.rootPath, profileDirectoryName, `${profileName}${profileFileNameSuffix}`);
		await Bun.write(profilePath, profileContent, { mode: 0o600 });
		// Bun.write ignores its mode option, so the owner-only bits the
		// client's own filesystem authority requires are set explicitly.
		await chmod(profilePath, 0o600);
		await updateSnapshot(options);

		const machine = machineArguments(options, profileName);

		// 1a. The daemon: the submission and the reconciliation that follows
		// both read through it. Each profile is its own daemon namespace
		// (the endpoints are named by the profile/environment pair), so the
		// run's default daemon does not serve this profile's operations.
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		const submitted = await invoke(handle, [
			runner(), ...machine, "load_content_as_json",
			"--operation-key", `${options.labelValue}-refused`,
			"--path", "/content",
			"--depth", "1",
		], options);
		if (!submitted.ok) {
			return { ok: false, message: `the refused submission could not run: ${submitted.message}` };
		}
		if (submitted.exitCode !== 0) {
			return { ok: false, message: `the refused submission exited ${submitted.exitCode}: ${submitted.stderr}` };
		}

		// 2. The submission itself answers with its receipt: a 401 from the
		// author is a validated POST whose outcome the client cannot settle,
		// so the operation exists and is reported by its identifier, exactly
		// as an accepted submission is. The refusal is what the operation
		// then ends as.
		const receipt = envelope(submitted.stdout, "load_content_as_json under the refused profile");
		if (receipt.ok === false) {
			return receipt;
		}
		if ((receipt as Record<string, unknown>)['outcome'] !== "operation_receipt") {
			return { ok: false, message: `the refused submission answered ${String((receipt as Record<string, unknown>)['outcome'])} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = (receipt as Record<string, unknown>)['operation_identifier'];
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the refused submission named no operation: ${submitted.stdout}` };
		}

		// 3. The operation ends in the client's own recovery state: the
		// lookup the daemon performs to reconcile the uncertain submission
		// is refused under the same wrong credentials, so the operation
		// parks as recovery_required naming the ambiguous submission — the
		// one disposition that never invents a result the author did not
		// give.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!ended.ok) {
			return ended;
		}
		if ((ended.envelope as Record<string, unknown>)['outcome'] !== "operation_recovery_required") {
			return { ok: false, message: `the refused submission ended as ${String((ended.envelope as Record<string, unknown>)['outcome'])} instead of the unresolved recovery state: ${JSON.stringify(ended.envelope)}` };
		}
		const category = typeof (ended.envelope as Record<string, unknown>)['category'] === "string" ? String((ended.envelope as Record<string, unknown>)['category']) : undefined;
		if (category !== "ambiguous_submission") {
			return { ok: false, message: `the unresolved recovery named ${JSON.stringify(category)} instead of the ambiguous submission it is: ${JSON.stringify(ended.envelope)}` };
		}
		const evidence = typeof (ended.envelope as Record<string, unknown>)['evidence'] === "string" ? String((ended.envelope as Record<string, unknown>)['evidence']) : "";
		if (!evidence.includes("SubmissionUnknown")) {
			return { ok: false, message: `the unresolved recovery's evidence does not name the submission as unknown: ${JSON.stringify(ended.envelope)}` };
		}

		// 4. The attempted key never reached the agent's store: the daemon's
		// own record holds no agent submission for the operation the
		// receipt named — the author refused the credentials, so no job
		// was ever admitted and no agent-side identifier was ever
		// recorded. A snapshot query on a key the agent would have
		// allocated itself is not the proof here: the key exists only
		// after an admission, so its absence from the daemon's record is
		// exactly what the refusal left.
		const resolved = await resolveAgentOperationIdentifier(options, profileName, operationIdentifier);
		if (resolved.ok) {
			return { ok: false, message: `the daemon's record names agent submission ${resolved.agentOperationIdentifier} for ${operationIdentifier}, and a refused submission was never admitted: ${JSON.stringify(resolved)}` };
		}
		return { ok: true, message: "authentication refusal: the client reported the submission as provably unresolved and the agent proves the key was never admitted" };
	},
};

// The address the refused profile points at: the run's author runtime, by
// the address the runner itself resolves on the run's network.
function authorAddress(port: number): string {
	return `http://tier-sling:${port}`;
}

// The configuration snapshot must name every source the root carries, with
// the digest of its bytes. The profile is written before this runs, so the
// scan already holds it: pushing it again would name one source twice,
// which the client's own configuration validation refuses.
async function updateSnapshot(options: StartClientRunnerOptions): Promise<void> {
	const sources: SnapshotSource[] = [];
	const rootPath = options.scratchHome.rootPath;
	for (const reference of await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: rootPath, onlyFiles: true }))) {
		if (reference === configurationSnapshotFileName) {
			continue;
		}
		const bytes = await Bun.file(join(rootPath, reference)).bytes();
		sources.push({ reference, sha256: sha256OfBytes(bytes) });
	}
	await Bun.write(join(rootPath, configurationSnapshotFileName), serializeSnapshot(sources), { mode: 0o600 });
	// Bun.write ignores its mode option; the snapshot must be owner-only too.
	await chmod(join(rootPath, configurationSnapshotFileName), 0o600);
	void selectionFileName;
}