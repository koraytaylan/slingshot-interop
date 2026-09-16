// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Independent admission evidence from the test author's repository, not the
// client's knowledge of an acknowledgement. StatePath declares these four
// levels: generation / two-hex bucket / two-hex bucket / operation identifier.
import { agentAuthorization } from "./support.ts";
import { readBoundedJson } from "../harness/bounded-json.ts";

type Inventory = { readonly ok: true; readonly operations: readonly string[] }
	| { readonly ok: false; readonly message: string };

export function parseOperationInventory(value: unknown): Inventory {
	const operations: string[] = [];
	const walk = (node: unknown, segments: readonly string[]): void => {
		if (node === null || typeof node !== "object" || Array.isArray(node)) throw new Error("inventory node is not an object");
		const object = node as Record<string, unknown>;
		if (typeof object["jcr:primaryType"] !== "string") throw new Error("inventory node has no primary type; the tree may be truncated");
		if (segments.length === 4) {
			const identifier = segments[3]!;
			if (identifier.slice(0, 2) !== segments[1] || identifier.slice(2, 4) !== segments[2]) throw new Error("operation is in the wrong bucket");
			operations.push(segments.join("/"));
			return;
		}
		for (const [name, child] of Object.entries(object)) {
			if (name === "jcr:primaryType") continue;
			// Sling's folder type carries mix:created metadata in its JSON
			// rendering. Admit only these scalar properties, not arbitrary keys
			// that might hide a truncated or unexpectedly shaped child tree.
			if (name === "jcr:created" || name === "jcr:createdBy" || name === "transition_revision") {
				if (typeof child !== "string" || child.length === 0) throw new Error(`invalid folder metadata: ${name}`);
				continue;
			}
			const pattern = segments.length === 0 ? /^g[1-9][0-9]*$/ : segments.length === 3 ? /^[0-9a-f]{64}$/ : /^[0-9a-f]{2}$/;
			if (!pattern.test(name)) throw new Error(`unexpected inventory member at depth ${segments.length}: ${name}`);
			walk(child, [...segments, name]);
		}
	};
	try {
		walk(value, []);
		return { ok: true, operations: operations.sort() };
	} catch (failure) {
		return { ok: false, message: `agent admission inventory is incomplete or invalid: ${failure instanceof Error ? failure.message : String(failure)}` };
	}
}

export async function agentOperationInventory(port: number, maximumBytes: number): Promise<Inventory> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/var/slingshot-agent/operations.4.json`, {
			headers: { authorization: agentAuthorization("admin", "admin") },
			redirect: "error", signal: AbortSignal.timeout(10_000),
		});
		const captured = await readBoundedJson(response, maximumBytes);
		if (!captured.ok) return { ok: false, message: `agent admission inventory: ${captured.message}` };
		return parseOperationInventory(captured.value);
	} catch (failure) {
		return { ok: false, message: `agent admission inventory could not be read: ${failure instanceof Error ? failure.message : String(failure)}` };
	}
}
