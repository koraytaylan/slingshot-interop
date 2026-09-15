// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The severed-submission scenario: the answer to a submission never comes
// back. The client reports the operation as retained by its receipt — the
// one outcome it can prove at that moment — then settles the unknown
// through its own observation, and the agent's own record proves exactly
// one admission and exactly one effect. What it may never do is invent a
// clean failure for work the agent completed: resubmission would double
// the effect.

import { chmod } from "node:fs/promises";
import { agentAuthorization, agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import { severanceControlPort } from "../run/orchestration.ts";
import { serializeProfile, sha256OfBytes, serializeSnapshot, profileDirectoryName, profileFileNameSuffix, configurationSnapshotFileName, type SnapshotSource } from "../sides/client-configuration.ts";
import { join } from "node:path";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		// 1. A profile pointing at the severance proxy, written through the
		// client's own configuration mechanism.
		const profileName = `severed-${options.labelValue}`;
		const profile = {
			name: profileName,
			environment: options.scratchHome.environmentName,
			deployment: "adobe_experience_manager_6_5",
			authorAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			publisherAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			username: "admin",
			password: "admin",
		};
		const profileContent = serializeProfile(profile);
		const profilePath = join(options.scratchHome.rootPath, profileDirectoryName, `${profileName}${profileFileNameSuffix}`);
		await Bun.write(profilePath, profileContent, { mode: 0o600 });
		// Bun.write ignores its mode option, so the owner-only bits the
		// client's own filesystem authority requires are set explicitly.
		await chmod(profilePath, 0o600);
		await updateSnapshot(options);

		const machine = machineArguments(options, profileName);
		const parent = `/content/interop/${options.labelValue}`;
		const folderName = "severed";
		const folderPath = `${parent}/${folderName}`;
		const title = `Severed by ${options.labelValue}`;
		const operationKey = `${options.labelValue}-severed`;

		// 0. The daemon: the submission is the daemon's remote exchange, and
		// the observation after the severance reads through it too.
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		// 2. Submit a write through the proxy, arming the client-side
		// severance point before the daemon connects: we skip the first
		// connection (capability discovery) and sever the answer to the
		// second (the submission), so the request reaches the agent and
		// the answer never comes back.
		const arm = fetch(`http://127.0.0.1:${proxyControlPort(options)}/arm/client?mode=response&threshold=5`, { method: "POST", signal: AbortSignal.timeout(10_000) });
		const submitted = await invoke(handle, [
			runner(), ...machine, "create_asset_folder",
			"--operation-key", operationKey,
			"--detach",
			"--path", parent,
			"--name", folderName,
			"--title", title,
		], options);
		const armed = await arm;
		if (!armed.ok) {
			return { ok: false, message: `arming the proxy failed: ${armed.status} ${await armed.text()}` };
		}
		if (!submitted.ok) {
			return { ok: false, message: `the severed submission could not run: ${submitted.message}` };
		}
		if (submitted.exitCode !== 0) {
			return { ok: false, message: `the severed submission exited ${submitted.exitCode}: ${submitted.stderr}` };
		}

		// 3. The submission answers with its receipt: the daemon retains the
		// operation before the remote exchange, so the answer it can prove
		// at that moment is exactly what an accepted submission answers —
		// never a success for the work itself, whose outcome is the one
		// thing the severed transport cannot carry back.
		const receipt = envelope(submitted.stdout, "the severed submission");
		if (receipt.ok === false) {
			return receipt;
		}
		if (receipt.outcome !== "operation_receipt") {
			return { ok: false, message: `the severed submission answered ${String(receipt.outcome)} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = receipt.operation_identifier;
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the severed submission named no operation: ${submitted.stdout}` };
		}

		// 4. Observe the operation through the client afterwards: the
		// exchange came apart mid-answer, so the operation parks at
		// recovery_required rather than at a clean answer — the proxy
		// stays armed, so every lookup connection the daemon opens is
		// severed on its answer half too, and that is the honest state an
		// unreachable agent leaves an accepted write in. What the client
		// may never report is a terminal error for work the agent
		// completed: resubmission would double the effect.
		const parked = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!parked.ok) {
			return parked;
		}
		if (parked.envelope.outcome === "operation_terminal_error") {
			return { ok: false, message: `the severed submission was reported as a terminal error, inventing a failure the agent never reported: ${JSON.stringify(parked.envelope)}` };
		}
		if (parked.envelope.outcome !== "operation_recovery_required") {
			return { ok: false, message: `the severed submission ended as ${String(parked.envelope.outcome)} instead of the recovery park: ${JSON.stringify(parked.envelope)}` };
		}

		// 5. Exactly one admission and exactly one effect, proved from the
		// agent's own route: the record names the operation once as
		// succeeded, and the created content exists — while the client's
		// own view honestly holds the recovery park. The route's query
		// member is the agent-side identifier the client derived at
		// submission, not the receipt's local one.
		//
		// The proxy is disarmed first: it is the one the whole run shares, and
		// the reads below are this scenario's own, not the client's. Leaving
		// the point armed would also sever every later scenario's exchanges,
		// which is a different thing to prove than this one.
		const disarmed = await fetch(`http://127.0.0.1:${proxyControlPort(options)}/disarm/client`, { method: "POST", signal: AbortSignal.timeout(10_000) });
		if (!disarmed.ok) {
			return { ok: false, message: `disarming the proxy failed: ${disarmed.status} ${await disarmed.text()}` };
		}
		const resolved = await resolveAgentOperationIdentifier(options, profileName, operationIdentifier);
		if (!resolved.ok) {
			return resolved;
		}
		const lookup = await agentSnapshot(options, resolved.agentOperationIdentifier);
		if (!lookup.ok) {
			return { ok: false, message: `${lookup.message}, and reconciliation needs the operation there` };
		}
		const snapshot = lookup.snapshot;
		if (snapshot.kind !== "succeeded") {
			return { ok: false, message: `the agent's record names ${snapshot.kind} for ${operationKey} while the submission's answer was destroyed in transit: ${JSON.stringify(snapshot)}` };
		}
		// The rendering is asked for by name: a bare request for a folder is
		// the platform's own 403 — it has no default renderer for a node that
		// is not a page — and what proves the write is the document the
		// platform renders for it.
		const content = await fetch(`http://127.0.0.1:${options.values.ports.author}${folderPath}.json`, {
			headers: { authorization: agentAuthorization("admin", "admin") },
			signal: AbortSignal.timeout(10_000),
		});
		if (!content.ok) {
			return { ok: false, message: `the created content does not answer on the agent: ${content.status} ${content.statusText}` };
		}
		return { ok: true, message: "severed submission: answered by receipt, parked at recovery while the agent's record proves the completed effect, exactly one admission" };
	},
};

// The proxy's control listener is on the port the values name; the forward
// listener is the one the profile points at. The control port is published
// to the host mapped as-is, so the harness arms the proxy through the
// published port — the run's network is not reachable by name from the
// host side.
function proxyControlPort(options: StartClientRunnerOptions): number {
	return severanceControlPort(options.values);
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
}