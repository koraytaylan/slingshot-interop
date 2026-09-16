// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The severed-submission scenario: the answer to a submission never comes
// back. The client retains a receipt and parks unresolved while the harness
// checks the agent's completed operation and resulting content. This scenario
// resumes that same operation if reconciliation parks. Independent
// effect counts are still needed for exactly-once proof. Repository inventories
// independently require exactly one new retained logical operation.

import { chmod } from "node:fs/promises";
import { readBoundedJson } from "../harness/bounded-json.ts";
import { refuseHttpResponse } from "../harness/http-refusal.ts";
import { agentAuthorization, agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal, type WaitOutcome } from "./support.ts";
import { severanceControlPort } from "../run/orchestration.ts";
import { submissionRequestLine, withProxyDisarmed } from "./proxy-observation.ts";
export { submissionRequestLine, withProxyDisarmed } from "./proxy-observation.ts";
import { verifyCreatedFolder, verifyCreatedFolderResult } from "./created-folder.ts";
import { agentOperationInventory } from "./agent-operation-inventory.ts";
import { expectedProfileTargetDigest, serializeProfile, sha256OfBytes, serializeSnapshot, profileDirectoryName, profileFileNameSuffix, configurationSnapshotFileName, type SnapshotSource } from "../sides/client-configuration.ts";
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
		const resolutionOptions: StartClientRunnerOptions = {
			...options,
			scratchHome: { ...options.scratchHome, expectedTargetDigests: {
				...options.scratchHome.expectedTargetDigests,
				[profileName]: expectedProfileTargetDigest(profile),
			} },
		};
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
		const before = await agentOperationInventory(options.values.ports.author, options.values.capture.maximumBytes);
		if (!before.ok) return before;

		// 2. Submit a write through the proxy, arming the client-side
		// severance point before submission starts. Only the exact submission POST
		// response is cut; authentication and reconciliation reads remain usable.
		const disarm = async (): Promise<ScenarioAnswer> => {
			const response = await fetch(`http://127.0.0.1:${proxyControlPort(options)}/disarm/client`, { method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error" });
			return response.ok ? { ok: true, message: "proxy disarmed" } : refuseHttpResponse(response, "disarming the proxy failed");
		};
		// Cleanup owns even an unanswered arm request: the server could have
		// applied it before the control connection failed.
		return withProxyDisarmed(async () => {
			const armed = await fetch(`http://127.0.0.1:${proxyControlPort(options)}/arm/client?mode=response&request-line=${encodeURIComponent(submissionRequestLine)}`, { method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error" });
			if (!armed.ok) {
				return refuseHttpResponse(armed, "arming the proxy failed");
			}
			const armIdentifier = armed.headers.get("x-severance-arm");
			if (!armIdentifier) return { ok: false, message: "proxy arming returned no observation identity" };
			const submitted = await invoke(handle, [
				runner(), ...machine, "create_asset_folder",
				"--operation-key", operationKey,
				"--detach",
				"--path", parent,
				"--name", folderName,
				"--title", title,
			], options);
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

			// 4. Lookup traffic is intact: the client may reconcile automatically
			// or retain an ambiguous-submission park requiring guarded restart.
			// Neither a terminal error nor a lasting park proves recovery.
			const parked = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
			if (!parked.ok) {
				return parked;
			}
			if (parked.envelope.outcome === "operation_terminal_error") {
				return { ok: false, message: `the severed submission was reported as a terminal error, inventing a failure the agent never reported: ${JSON.stringify(parked.envelope)}` };
			}
			if (parked.envelope.outcome !== "operation_recovery_required" && parked.envelope.outcome !== "operation_result") {
				return { ok: false, message: `the severed submission produced an unexpected recovery outcome: ${JSON.stringify(parked.envelope)}` };
			}

			// 5. Cross-check the completed operation and content. A succeeded
			// snapshot and existing content do not count admissions or effects.
			// The route's query
			// member is the agent-side identifier the client derived at
			// submission, not the receipt's local one.
			//
			// The proxy is disarmed first: it is the one the whole run shares, and
			// the reads below are this scenario's own, not the client's. Leaving
			// the point armed would also sever every later scenario's exchanges,
			// which is a different thing to prove than this one.
			const observation = await fetch(`http://127.0.0.1:${proxyControlPort(options)}/observed/client`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
			const evidence = await readBoundedJson(observation, options.values.capture.maximumBytes);
			if (!evidence.ok) return { ok: false, message: `proxy observation: ${evidence.message}` };
			if (!observedResponseCut(evidence.value, armIdentifier)) return { ok: false, message: "the current arming has no verified response-cut evidence" };
			const disarmed = await disarm();
			if (!disarmed.ok) return disarmed;
			let recovered = parked;
			let recoveryMode = "automatic reconciliation";
			if (parked.envelope.outcome === "operation_recovery_required") {
				const restart = recoveryArguments(operationIdentifier, parked.envelope);
				if (!restart.ok) return restart;
				const resumed = await invoke(handle, [runner(), ...machine, ...restart.arguments], options);
				if (!resumed.ok) return { ok: false, message: `recovery restart could not run: ${resumed.message}` };
				if (resumed.exitCode !== 0) return { ok: false, message: `recovery restart exited ${resumed.exitCode}: ${resumed.stderr}` };
				const resumeReceipt = envelope(resumed.stdout, "recovery restart");
				if (resumeReceipt.ok === false) return resumeReceipt;
				if (resumeReceipt.outcome !== "operation_resume_receipt" || resumeReceipt.category !== parked.envelope.category || (resumeReceipt as Record<string, unknown>)["replayed"] !== false) {
					return { ok: false, message: `recovery restart did not acknowledge the first guarded resume: ${JSON.stringify(resumeReceipt)}` };
				}
				// Resume only re-queues the durable row; explicitly converge the
				// daemon so its scheduler claims the newly eligible operation.
				const restarted = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
				if (!restarted.ok || restarted.exitCode !== 0) {
					return { ok: false, message: `daemon convergence after guarded resume failed: ${restarted.ok ? restarted.stderr : restarted.message}` };
				}
				const waited = await waitForRecoveredResult(handle, machine, operationIdentifier, options);
				if (!waited.ok) return waited;
				recovered = waited;
				recoveryMode = "guarded resume";
			}
			if (recovered.envelope.outcome !== "operation_result" || recovered.envelope.result?.["repository_path"] !== folderPath) {
				return { ok: false, message: `the original operation did not recover its expected folder result: ${JSON.stringify(recovered.envelope)}` };
			}
			const resolved = await resolveAgentOperationIdentifier(resolutionOptions, profileName, operationIdentifier);
			if (!resolved.ok) {
				return resolved;
			}
			const lookup = await agentSnapshot(options, resolved.agentOperationIdentifier, resolved.targetDigest);
			if (!lookup.ok) {
				return { ok: false, message: `${lookup.message}, and reconciliation needs the operation there` };
			}
			const snapshot = lookup.snapshot;
			if (snapshot.kind !== "succeeded") {
				return { ok: false, message: `the agent's record names ${snapshot.kind} for ${operationKey} while the submission's answer was destroyed in transit: ${JSON.stringify(snapshot)}` };
			}
			const verifiedResult = verifyCreatedFolderResult(recovered.envelope.result, snapshot.terminal_result, folderPath);
			if (!verifiedResult.ok) return verifiedResult;
			const after = await agentOperationInventory(options.values.ports.author, options.values.capture.maximumBytes);
			if (!after.ok) return after;
			const prior = new Set(before.operations);
			const current = new Set(after.operations);
			const added = after.operations.filter(path => !prior.has(path));
			if (before.operations.some(path => !current.has(path)) || added.length !== 1
				|| added[0]!.split("/").at(-1) !== resolved.agentOperationIdentifier
				|| before.operations.some(path => path.split("/").at(-1) === resolved.agentOperationIdentifier)) {
				return { ok: false, message: "the agent inventory did not retain exactly the original recovered operation as its sole new admission" };
			}
			// The rendering is asked for by name: a bare request for a folder is
			// the platform's own 403 — it has no default renderer for a node that
			// is not a page — and what proves the write is the document the
			// platform renders for it.
			const content = await fetch(`http://127.0.0.1:${options.values.ports.author}${folderPath}.json`, {
				redirect: "error",
				headers: { authorization: agentAuthorization("admin", "admin") },
				signal: AbortSignal.timeout(10_000),
			});
			const verifiedContent = await verifyCreatedFolder(content, title, options.values.capture.maximumBytes);
			if (!verifiedContent.ok) return verifiedContent;
			return { ok: true, message: `severed submission: observed targeted submission POST response cut; ${recoveryMode} recovered the original operation's folder result, matching the agent's retained result and requested path; independent inventory retains exactly one new logical operation matching its agent identifier; the agent reports success and folder properties match; exactly-once effect counts are not verified` };
		}, disarm);
	},
};

// A resume acknowledgement only makes the durable row eligible; the scheduler
// may not have claimed it by the next operation-wait response. Keep polling
// through that transitional recovery envelope until the resumed result is
// observable, while still surfacing terminal errors and deadline failures.
async function waitForRecoveredResult(handle: ContainerHandle, machine: readonly string[], operationIdentifier: string, options: StartClientRunnerOptions): Promise<WaitOutcome> {
	const deadline = Date.now() + options.values.readiness.harnessSeconds * 1000;
	while (Date.now() < deadline) {
		const waited = await waitTerminal(handle, machine, operationIdentifier, options, Math.max(1, deadline - Date.now()));
		if (!waited.ok) return waited;
		if (waited.envelope.outcome !== "operation_recovery_required") return waited;
		await Bun.sleep(Math.min(options.values.readiness.pollIntervalSeconds * 1000, Math.max(1, deadline - Date.now())));
	}
	return { ok: false, message: `the resumed operation did not reach a result by the scenario's deadline: ${operationIdentifier}` };
}

type ScenarioAnswer = { readonly ok: boolean; readonly message: string };

export function observedResponseCut(value: unknown, arm: string): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const evidence = value as Record<string, unknown>;
	return evidence["arm"] === arm && evidence["mode"] === "response" && evidence["requestLine"] === submissionRequestLine
		&& typeof evidence["severed"] === "number" && Number.isSafeInteger(evidence["severed"]) && evidence["severed"] > 0
		&& typeof evidence["suppressedResponseBytes"] === "number" && Number.isSafeInteger(evidence["suppressedResponseBytes"]) && evidence["suppressedResponseBytes"] > 0;
}

// Quote the observed recovery preconditions rather than guessing a revision or
// submitting another create command. An unsafe JSON number cannot be quoted
// faithfully as the client's u64 revision and must fail this observation.
export function recoveryArguments(operationIdentifier: string, parked: Record<string, unknown>):
	{ readonly ok: true; readonly arguments: readonly string[] } | { readonly ok: false; readonly message: string } {
	if (operationIdentifier.length === 0 || parked["outcome"] !== "operation_recovery_required"
		|| parked["category"] !== "ambiguous_submission" || typeof parked["revision"] !== "number"
		|| !Number.isSafeInteger(parked["revision"]) || parked["revision"] < 0) {
		return { ok: false, message: `cannot safely resume the observed ambiguous submission: ${JSON.stringify(parked)}` };
	}
	return { ok: true, arguments: ["operation-restart", "--operation", operationIdentifier,
		"--expected-revision", String(parked["revision"]), "--expected-category", parked["category"]] };
}

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
