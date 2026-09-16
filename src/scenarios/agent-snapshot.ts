// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { readBoundedJson } from "../harness/bounded-json.ts";

export type AgentSnapshot = Record<string, unknown> & {
	readonly kind: string;
	readonly attempt: number;
	readonly physical_sling_job_identifiers: readonly string[];
	readonly terminal_result?: unknown;
	readonly terminal_failure?: unknown;
};

export async function readAgentSnapshot(response: Response, identifier: string, maximumBytes: number, expectedTargetDigest: string):
	Promise<{ readonly ok: true; readonly snapshot: AgentSnapshot } | { readonly ok: false; readonly message: string }> {
	const captured = await readBoundedJson(response, maximumBytes);
	if (!captured.ok) return { ok: false, message: `agent snapshot: ${captured.message}` };
	return verifyAgentSnapshot(captured.value, identifier, expectedTargetDigest);
}

// Validate independent lookup evidence, not a complete wire-schema or effect count.
export function verifyAgentSnapshot(value: unknown, identifier: string, expectedTargetDigest: string):
	{ readonly ok: true; readonly snapshot: AgentSnapshot } | { readonly ok: false; readonly message: string } {
	const refused = (detail: string) => ({ ok: false as const, message: `agent snapshot ${detail}` });
	if (typeof expectedTargetDigest !== "string" || expectedTargetDigest.length !== 64 || /[^0-9a-f]/.test(expectedTargetDigest)) return refused("has no canonical independent target expectation");
	if (value === null || typeof value !== "object" || Array.isArray(value)) return refused("is not an object");
	const snapshot = value as Record<string, unknown>;
	if (snapshot["agent_operation_identifier"] !== identifier) return refused("names another operation or no operation");
	if (snapshot["author_target_identity_digest"] !== expectedTargetDigest) return refused("target differs from the independently authored profile");
	if (typeof snapshot["kind"] !== "string" || !["accepted", "started", "progress", "succeeded", "failed"].includes(snapshot["kind"])) return refused("names no recognized event kind");
	const generation = snapshot["agent_event_store_generation"];
	if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) return refused("names no valid generation");
	const deliveries = snapshot["physical_sling_job_identifiers"];
	if (!Array.isArray(deliveries) || deliveries.some((identifier: unknown) => typeof identifier !== "string" || identifier.length === 0)
		|| new Set(deliveries).size !== deliveries.length) return refused("does not name distinct nonempty delivery identifiers");
	const attempt = snapshot["attempt"];
	if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 0 || attempt !== deliveries.length) return refused("attempt count disagrees with its delivery records");
	if (snapshot["kind"] === "succeeded" && attempt === 0) return refused("claims success without a delivery");
	if ((snapshot["kind"] === "succeeded" || snapshot["kind"] === "failed") && !terminalIdentityMatches(snapshot)) {
		return refused("terminal evidence does not retain its operation and submission identity");
	}
	return { ok: true, snapshot: snapshot as AgentSnapshot };
}

function terminalIdentityMatches(snapshot: Record<string, unknown>): boolean {
	const succeeded = snapshot["kind"] === "succeeded";
	const terminal = snapshot[succeeded ? "terminal_result" : "terminal_failure"];
	if (Object.hasOwn(snapshot, succeeded ? "terminal_failure" : "terminal_result")) return false;
	if (!isMapping(terminal) || !isMapping(terminal["operation"])) return false;
	const operation = terminal["operation"];
	const operationMembers = ["agent_event_store_generation", "agent_operation_identifier", "author_target_identity_digest", "selected_environment_revision"];
	if (Object.keys(operation).length !== operationMembers.length || operationMembers.some(member => operation[member] !== snapshot[member])) return false;
	// The outer generation, operation and target were already checked above.
	// These remaining echoes must exist: two missing values are not agreement.
	for (const member of ["selected_environment_revision", "daemon_subscription_identifier", "submitted_command_digest"]) {
		const expected = snapshot[member];
		if (typeof expected !== "string" || expected.length === 0) return false;
		if (member !== "selected_environment_revision" && terminal[member] !== expected) return false;
	}
	return true;
}

function isMapping(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
