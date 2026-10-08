// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { mapping } from "./discovery-lifecycle.ts";
import { candidateBound } from "./incremental-discovery.ts";

export const accessNames = ["one", "two", "three", "four"] as const;
export const accessType = "interop/access-component";

export function accessPage(answer: unknown, root: string): { paths: string[]; token?: string } {
	const envelope = mapping(answer);
	if (envelope["outcome"] !== "operation_result") throw new Error(`permission discovery did not produce a result: ${JSON.stringify(envelope)}`);
	const result = mapping(envelope["result"]);
	const matches = result["matches"];
	const complete = result["complete"];
	const token = result["next_continuation_token"];
	const examined = result["examined_nodes"];
	if (!Array.isArray(matches) || matches.length > accessNames.length || typeof complete !== "boolean"
		|| typeof examined !== "number" || !Number.isSafeInteger(examined) || examined < matches.length || examined > candidateBound
		|| (complete ? token !== undefined : typeof token !== "string" || token.length === 0)
		|| Object.keys(result).length !== (complete ? 3 : 4)) throw new Error("permission discovery page violates its bounds");
	const paths = matches.map(value => {
		const row = mapping(value);
		const path = row["repository_path"];
		if (typeof path !== "string" || !accessNames.some(name => path === `${root}/${name}`) || row["resource_type"] !== accessType) throw new Error("permission discovery returned an unexpected row");
		return path;
	});
	if (new Set(paths).size !== paths.length) throw new Error("permission discovery repeated a row");
	return { paths, ...(typeof token === "string" ? { token } : {}) };
}

export function singleAccessPage(answer: unknown, root: string): { path: string; token: string } {
	const result = accessPage(answer, root);
	if (result.paths.length !== 1 || result.token === undefined) throw new Error("permission discovery did not return one partial row");
	return { path: result.paths[0]!, token: result.token };
}

export function excludesUnreadable(answer: unknown, root: string, hidden: string): string[] {
	const result = accessPage(answer, root);
	const expected = accessNames.map(name => `${root}/${name}`).filter(path => path !== hidden).sort();
	if (result.token !== undefined || JSON.stringify([...result.paths].sort()) !== JSON.stringify(expected)) throw new Error("permission discovery disclosed an unreadable row or omitted a readable one");
	return result.paths;
}
