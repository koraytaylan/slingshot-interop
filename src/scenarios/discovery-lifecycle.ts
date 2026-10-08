// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { candidateBound } from "./incremental-discovery.ts";

export function mapping(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("discovery lifecycle evidence is not an object");
	return value as Record<string, unknown>;
}

export function page(answer: unknown, root: string): { document: Record<string, unknown>; path: string; token: string } {
	const envelope = mapping(answer);
	if (envelope["outcome"] !== "operation_result") throw new Error("discovery did not produce a result");
	const result = mapping(envelope["result"]);
	const matches = result["matches"];
	if (!Array.isArray(matches) || matches.length !== 1 || result["complete"] !== false
		|| typeof result["examined_nodes"] !== "number" || !Number.isSafeInteger(result["examined_nodes"])
		|| result["examined_nodes"] < 1 || result["examined_nodes"] > candidateBound
		|| typeof result["next_continuation_token"] !== "string" || result["next_continuation_token"].length === 0
		|| Object.keys(result).length !== 4) throw new Error("discovery lifecycle page is not one bounded partial result");
	const row = mapping(matches[0]);
	const path = row["repository_path"];
	if (typeof path !== "string" || !["one", "two", "three", "four"].some(name => path === `${root}/${name}`)
		|| row["resource_type"] !== "interop/lifecycle") throw new Error("discovery lifecycle result differs from its fixture");
	return { document: result, path, token: result["next_continuation_token"] };
}

export function refused(answer: unknown, expected: string): string {
	const envelope = mapping(answer);
	if (envelope["outcome"] !== "operation_terminal_error") throw new Error(`expected ${expected}, got ${String(envelope["outcome"])}`);
	const actual = mapping(envelope["failure"])["metadata"];
	if (actual !== expected) throw new Error(`expected ${expected}, got ${String(actual)}`);
	return expected;
}

export function samePage(left: Record<string, unknown>, right: Record<string, unknown>): void {
	// Ordering of members is irrelevant; every value and array position is not.
	const canonical = (value: unknown): string => {
		if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
		if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
		return JSON.stringify(value);
	};
	if (canonical(left) !== canonical(right)) throw new Error("continuation replay changed its page");
}
