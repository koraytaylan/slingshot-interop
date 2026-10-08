// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { submittedOperation } from "./submission.ts";
import { authorHostPort } from "../sides/author-host-port.ts";

// The authentication-refusal scenario: credentials the author refuses have
// to be reported as what they are — an outcome the client cannot settle —
// never as a clean success or a fabricated failure. A second profile
// carries the same address with a wrong password, a read is submitted
// through it, and independent repository inventories check for any retained
// admission during the refused exchange.

import { chmod } from "node:fs/promises";
import { readBoundedJson } from "../harness/bounded-json.ts";
import { invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import { agentOperationInventory } from "./agent-operation-inventory.ts";
import { severanceControlPort } from "../run/orchestration.ts";
import { observedRequestRefusal, authenticationRequestLine, withProxyDisarmed } from "./proxy-observation.ts";
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
			authorAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			publisherAddress: `http://severance-proxy:${options.values.ports.proxy}`,
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

		const before = await agentOperationInventory(authorHostPort(options), options.values.capture.maximumBytes);
		if (!before.ok) return before;
		const control = `http://127.0.0.1:${severanceControlPort(options.values)}`;
		return withProxyDisarmed(async () => {
			const armed = await fetch(`${control}/arm/client?mode=observe&request-line=${encodeURIComponent(authenticationRequestLine)}`, { method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error" });
			if (armed.status !== 200) return { ok: false, message: `proxy observation could not arm: ${armed.status}` };
			const arm = armed.headers.get("x-severance-arm");
			if (!arm) return { ok: false, message: "proxy observation returned no arming identity" };
			const submitted = await invoke(handle, [
				runner(), ...machine, "load_content_as_json",
				"--operation-key", `${options.labelValue}-refused`,
				"--path", "/content",
				"--depth", "1",
			], options);
			if (!submitted.ok) {
				return { ok: false, message: `the refused submission could not run: ${submitted.message}` };
			}
			const receipt = submittedOperation(submitted, `${options.labelValue}-refused`);
			if (!receipt.ok) return receipt;
			const operationIdentifier = receipt.operation_identifier;
			if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
				return { ok: false, message: `the refused submission named no operation: ${submitted.stdout}` };
			}

            // A capability refusal happens before submission. Require the durable
            // non-execution disposition, then prove the actual HTTP refusal and
            // unchanged agent inventory independently below.
            const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
            if (!ended.ok) return ended;
            if (ended.envelope.outcome !== "operation_terminal_error"
                || (ended.envelope as Record<string, unknown>)["disposition"] !== "AuthoritativeNonExecution { certainty: ConfirmedNotExecuted }") {
                return { ok: false, message: `authentication refusal did not establish non-execution: ${JSON.stringify(ended.envelope)}` };
            }
			const observation = await fetch(`${control}/observed/client`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
			const captured = await readBoundedJson(observation, options.values.capture.maximumBytes);
			if (!captured.ok) return { ok: false, message: `proxy observation: ${captured.message}` };
			if (!observedRequestRefusal(captured.value, arm, authenticationRequestLine)) {
				return { ok: false, message: "proxy did not witness only 401 responses for the matched capability GET requests" };
			}

			// Missing client acknowledgement is not evidence of absent admission.
			// Require an unchanged independent inventory in this isolated test author.
			const after = await agentOperationInventory(authorHostPort(options), options.values.capture.maximumBytes);
			if (!after.ok) return after;
			if (JSON.stringify(after.operations) !== JSON.stringify(before.operations)) {
				return { ok: false, message: "the agent's logical-operation inventory changed during the authentication-refused exchange" };
			}
			return { ok: true, message: "authentication refusal: proxy observed capability GET 401 responses, client retained confirmed non-execution, and independent agent operation inventory is unchanged" };
		}, async () => {
			const response = await fetch(`${control}/disarm/client`, { method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error" });
			return { ok: response.status === 200, message: `proxy observation disarm: ${response.status}` };
		});
	},
};


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
