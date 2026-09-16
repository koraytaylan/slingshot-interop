// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// A positive capture for a subscription admitted by the real client. This
// checks the closed client wire shape, not full stream-reset reconciliation.
// Authority: slingshot/schemas/agent-protocol/job/subscription-high-water.json
// and slingshot-agent-connection/src/subscription_high_water.rs.
import { agentAuthorization, agentSnapshot, envelope, invoke, machineArguments, resolveAgentOperationIdentifier, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { readBoundedJson } from "../harness/bounded-json.ts";
import { verifyCreatedFolderResult } from "./created-folder.ts";

type Outcome = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string };
type Binding = { readonly subscription: string; readonly generation: number; readonly digest: string };
const members = ["agent_event_store_generation", "daemon_subscription_identifier", "format", "high_water_cursor", "transport_contract_digest"];
const maximumCursorCharacters = 96;

export function verifyHighWater(value: unknown, expected: Binding): Outcome {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return { ok: false, message: "high-water returned no response object" };
	}
	const document = value as Record<string, unknown>;
	const actual = Object.keys(document).sort();
	if (JSON.stringify(actual) !== JSON.stringify(members)) {
		return { ok: false, message: `high-water response members ${actual.join(", ")} differ from the client's required ${members.join(", ")}` };
	}
	if (document["format"] !== "slingshot.agent/1" || document["transport_contract_digest"] !== expected.digest
		|| document["daemon_subscription_identifier"] !== expected.subscription
		|| document["agent_event_store_generation"] !== expected.generation) {
		return { ok: false, message: "high-water response does not preserve the admitted subscription, generation, and transport contract" };
	}
	if (typeof document["high_water_cursor"] !== "string" || document["high_water_cursor"].length === 0
		|| document["high_water_cursor"].length > maximumCursorCharacters
		|| Buffer.byteLength(document["high_water_cursor"], "utf8") > maximumCursorCharacters
		|| /^[ \t]|[ \t]$|[\x00-\x08\x0a-\x1f\x7f]/.test(document["high_water_cursor"])) {
		return { ok: false, message: "high-water response has no bounded high_water_cursor" };
	}
	return { ok: true, message: "a real client-admitted subscription returned the client's closed high-water response shape" };
}

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
		try {
			return await capture(handle, options);
		} catch (failure) {
			return { ok: false, message: `high-water capture failed: ${failure instanceof Error ? failure.message : String(failure)}` };
		}
	},
};

async function capture(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
	const machine = machineArguments(options, options.scratchHome.profileName);
	const parent = `/content/interop/${options.labelValue}`;
	const folderPath = `${parent}/high-water`;
	const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
	if (!started.ok) return started;
	if (started.exitCode !== 0) return { ok: false, message: `daemon start exited ${started.exitCode}` };
	const created = await invoke(handle, [runner(), ...machine, "create_asset_folder",
		"--operation-key", `${options.labelValue}-high-water`,
		"--path", parent, "--name", "high-water",
		"--title", "High-water contract probe"], options);
	if (!created.ok) return created;
	if (created.exitCode !== 0) return { ok: false, message: `high-water admission exited ${created.exitCode}: ${created.stderr}` };
	const receipt = envelope(created.stdout, "high-water admission");
	if (!receipt.ok) return receipt;
	if (receipt.outcome !== "operation_receipt" || typeof receipt.operation_identifier !== "string" || receipt.operation_identifier.length === 0) {
		return { ok: false, message: "high-water admission did not return an operation receipt" };
	}
	const ended = await waitTerminal(handle, machine, receipt.operation_identifier, options, options.values.readiness.harnessSeconds * 1000);
	if (!ended.ok) return ended;
	if (ended.envelope.outcome !== "operation_result") return { ok: false, message: "high-water admission did not finish successfully" };
	const resolved = await resolveAgentOperationIdentifier(options, options.scratchHome.profileName, receipt.operation_identifier);
	if (!resolved.ok) return resolved;
	const lookup = await agentSnapshot(options, resolved.agentOperationIdentifier, resolved.targetDigest);
	if (!lookup.ok) return lookup;
	if (lookup.snapshot.kind !== "succeeded") return { ok: false, message: "the agent snapshot does not confirm successful high-water admission" };
	const verifiedResult = verifyCreatedFolderResult(ended.envelope.result, lookup.snapshot.terminal_result, folderPath);
	if (!verifiedResult.ok) return { ok: false, message: verifiedResult.message };
	const snapshot = lookup.snapshot as unknown as Record<string, unknown>;
	const provenance = snapshot["provenance"] as Record<string, unknown> | undefined;
	const subscription = snapshot["daemon_subscription_identifier"];
	const generation = snapshot["agent_event_store_generation"];
	const digest = provenance?.["transport_contract_digest"];
	if (typeof subscription !== "string" || !subscription || typeof generation !== "number"
		|| !Number.isSafeInteger(generation) || generation < 1 || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
		return { ok: false, message: "the admitted snapshot did not provide a complete high-water request binding" };
	}
	const origin = `http://127.0.0.1:${options.values.ports.author}`;
	const authorization = agentAuthorization("admin", "admin");
	const tokenResponse = await fetch(`${origin}/libs/granite/csrf/token.json`, { headers: { authorization }, signal: AbortSignal.timeout(10_000), redirect: "error" });
	const tokenDocument = await readBoundedJson(tokenResponse, options.values.capture.maximumBytes);
	if (!tokenDocument.ok) return { ok: false, message: `high-water CSRF token: ${tokenDocument.message}` };
	const token = tokenDocument.value !== null && typeof tokenDocument.value === "object"
		? (tokenDocument.value as Record<string, unknown>)["token"] : undefined;
	if (typeof token !== "string" || !token) return { ok: false, message: "high-water CSRF token response named no token" };
	const response = await fetch(`${origin}/bin/slingshot/agent/subscriptions/high-water`, {
		method: "POST", headers: { authorization, "csrf-token": token, "content-type": "application/json", referer: `${origin}/` },
		body: JSON.stringify({ daemon_subscription_identifier: subscription, agent_event_store_generation: generation }),
		signal: AbortSignal.timeout(10_000), redirect: "error",
	});
	const captured = await readBoundedJson(response, options.values.capture.maximumBytes);
	if (!captured.ok) return { ok: false, message: `high-water capture: ${captured.message}` };
	return verifyHighWater(captured.value, { subscription, generation, digest });
}
