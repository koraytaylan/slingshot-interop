// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { DiscoveryEnumeration, candidateBound, componentType, discoveryLimitsDigest, groupCount, groupForm, leafName, leavesPerGroup, maximumDiscoveryPages, plantedNodes, requestedMatches, requireReviewedDiscoveryBudget, verifyGroup } from "./incremental-discovery.ts";
const root = "/content/fixture";
const row = (repository_path: string) => ({ repository_path, resource_type: componentType });

test("fixture exceeds its reviewed built-contract budget", () => {
	expect(plantedNodes).toBeGreaterThan(candidateBound);
	const identity = { command_wire_name: "list_components", command_semantic_contract_version: "0.0.0", command_contract_limits_digest: discoveryLimitsDigest };
	expect(() => requireReviewedDiscoveryBudget({ command_contracts: [identity] })).not.toThrow();
	for (const command_contracts of [[], [identity, identity], [{ ...identity, command_contract_limits_digest: "a".repeat(64) }], [{ ...identity, command_semantic_contract_version: "0.0.0+another-build" }]]) expect(() => requireReviewedDiscoveryBudget({ command_contracts })).toThrow();
});

test("query discovery requires its own reviewed version two identity", () => {
	const identity = { command_wire_name: "query_paths", command_semantic_contract_version: "0.0.0", command_contract_limits_digest: discoveryLimitsDigest };
	expect(() => requireReviewedDiscoveryBudget({ command_contracts: [identity] }, "query_paths")).not.toThrow();
	for (const command_contracts of [[], [{ ...identity, command_wire_name: "list_components" }], [identity, identity], [{ ...identity, command_semantic_contract_version: "0.0.0+another-build" }]]) expect(() => requireReviewedDiscoveryBudget({ command_contracts }, "query_paths")).toThrow();
});

test("query pages enumerate provider order with addresses only and unchanged page bounds", () => {
	const held = new DiscoveryEnumeration(root, "query_paths");
	const paths = [...held.expected].reverse();
	for (let start = 0; start < paths.length; start += requestedMatches) {
		const matches = paths.slice(start, start + requestedMatches).map(repository_path => ({ repository_path }));
		const complete = start + requestedMatches >= paths.length;
		const examined_nodes = complete ? plantedNodes - held.examined : matches.length * (leavesPerGroup + 1);
		held.accept({ matches, complete, examined_nodes, ...(complete ? {} : { next_continuation_token: `query-${start}` }) });
	}
	expect(held.seen.size).toBe(groupCount);
	expect(held.examined).toBe(plantedNodes);
	const repository_path = paths[0]!;
	for (const matches of [[row(repository_path)], [{ repository_path, secret: "undisclosed" }], [{ repository_path }, { repository_path }], Array.from({ length: requestedMatches + 1 }, (_, index) => ({ repository_path: paths[index] }))]) expect(() => new DiscoveryEnumeration(root, "query_paths").accept({ matches, complete: false, examined_nodes: candidateBound, next_continuation_token: "next" })).toThrow();
});

test("plant and independent platform readback agree on every leaf", () => {
	const form = groupForm();
	expect([...form.keys()]).toHaveLength(leavesPerGroup + 2);
	const group: Record<string, unknown> = { "jcr:primaryType": "nt:unstructured" };
	for (let index = 0; index < leavesPerGroup; index++) group[leafName(index)] = { "jcr:primaryType": form.get(`${leafName(index)}/jcr:primaryType`), ...(index === 0 ? { "sling:resourceType": componentType } : {}) };
	expect(() => verifyGroup(group)).not.toThrow();
	delete group[leafName(1)];
	expect(() => verifyGroup(group)).toThrow();
	group[leafName(1)] = { "jcr:primaryType": "nt:unstructured", "sling:resourceType": componentType };
	expect(() => verifyGroup(group)).toThrow();
});

test("bounded partial pages enumerate exact stable paths once", () => {
	const held = new DiscoveryEnumeration(root);
	const paths = [...held.expected];
	for (let start = 0; start < paths.length; start += requestedMatches) {
		const matches = paths.slice(start, start + requestedMatches).map(row);
		const complete = start + requestedMatches >= paths.length;
		const examined_nodes = complete ? plantedNodes - held.examined : matches.length * (leavesPerGroup + 1);
		held.accept({ matches, complete, examined_nodes, ...(complete ? {} : { next_continuation_token: `token-${start}` }) });
	}
	expect(held.complete).toBe(true);
	expect(held.examined).toBe(plantedNodes);
	expect(held.seen.size).toBe(groupCount);
	expect(() => held.accept({})).toThrow();
});

test("partial empty pages are allowed, while omissions, duplicates, repeated prefixes and tokens fail", () => {
	const partial = (matches: unknown[], examined_nodes: number, next_continuation_token: string) => ({ matches, examined_nodes, complete: false, next_continuation_token });
	const held = new DiscoveryEnumeration(root);
	expect(held.accept(partial([], 1, "first"))).toBe("first");
	expect(() => held.accept(partial([], 0, "first"))).toThrow();
	const duplicate = new DiscoveryEnumeration(root);
	const path = [...duplicate.expected][0]!;
	duplicate.accept(partial([row(path)], 1, "first"));
	expect(() => duplicate.accept(partial([row(path)], 1, "second"))).toThrow();
	const repeated = new DiscoveryEnumeration(root);
	repeated.accept(partial([], candidateBound, "first"));
	expect(() => repeated.accept(partial([], candidateBound, "second"))).toThrow();
	expect(() => new DiscoveryEnumeration(root).accept({ matches: [], examined_nodes: 1, complete: true })).toThrow();
	for (const page of [partial([], candidateBound + 1, "t"), partial([], -1, "t"), { matches: [], examined_nodes: 0, complete: false }, { matches: [], examined_nodes: 0, complete: true, next_continuation_token: "t" }]) expect(() => new DiscoveryEnumeration(root).accept(page)).toThrow();
});

test("fresh empty tokens cannot extend discovery beyond its page bound", () => {
	const held = new DiscoveryEnumeration(root);
	for (let index = 0; index < maximumDiscoveryPages; index++) held.accept({ matches: [], examined_nodes: 0, complete: false, next_continuation_token: String(index) });
	expect(() => held.accept({ matches: [], examined_nodes: 0, complete: false, next_continuation_token: "more" })).toThrow();
});
