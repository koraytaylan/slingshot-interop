// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// These independent fixture bounds belong to this reviewed command-limits digest.
export const discoveryLimitsDigest = "66be041fb0623ea682a53b61d20e19c458e25d2a2df209c9ca9edcc2a405278e";
export const candidateBound = 100_000;
export const groupCount = 100;
export const leavesPerGroup = 1_000;
export const plantedNodes = 1 + groupCount * (1 + leavesPerGroup);
export const requestedMatches = 17;
export const maximumDiscoveryPages = 512;
export const enumerationBudgetMilliseconds = 900_000;
export const componentType = "interop/discovery-component";
export const groupName = (index: number): string => `group-${String(index).padStart(3, "0")}`;
export const leafName = (index: number): string => `leaf-${String(index).padStart(4, "0")}`;

function mapping(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("discovery evidence is not an object");
	return value as Record<string, unknown>;
}

export type DiscoveryCommand = "list_components" | "query_paths";

export function requireReviewedDiscoveryBudget(capabilities: unknown, command: DiscoveryCommand = "list_components"): void {
	const contracts = mapping(capabilities)["command_contracts"];
	if (!Array.isArray(contracts)) throw new Error("discovery capabilities have no command identities");
	const matching = contracts.map(mapping).filter(row => row["command_wire_name"] === command);
	if (matching.length !== 1 || matching[0]!["command_contract_limits_digest"] !== discoveryLimitsDigest
		|| matching[0]!["command_semantic_contract_version"] !== (command === "query_paths" ? "0.0.0" : "0.0.0")) throw new Error("discovery fixture budget has not been reviewed for these built command limits");
	if (plantedNodes <= candidateBound) throw new Error("discovery fixture does not exceed one request budget");
}

export function groupForm(): URLSearchParams {
	const body = new URLSearchParams({ "jcr:primaryType": "nt:unstructured" });
	for (let index = 0; index < leavesPerGroup; index++) body.set(`${leafName(index)}/jcr:primaryType`, "nt:unstructured");
	body.set(`${leafName(0)}/sling:resourceType`, componentType);
	return body;
}

// Independent platform readback prevents an incomplete plant from passing as a large tree.
export function verifyGroup(value: unknown): void {
	const group = mapping(value);
	const children = Object.entries(group).filter(([, value]) => value !== null && typeof value === "object");
	if (children.length !== leavesPerGroup) throw new Error("planted discovery group has the wrong leaf count");
	for (let index = 0; index < leavesPerGroup; index++) {
		const node = mapping(group[leafName(index)]);
		if (node["jcr:primaryType"] !== "nt:unstructured") throw new Error("planted discovery leaf has the wrong primary type");
		if (node["sling:resourceType"] !== (index === 0 ? componentType : undefined)) throw new Error("planted discovery match set differs from its fixture");
		if (Object.values(node).some(value => value !== null && typeof value === "object")) throw new Error("planted discovery leaf contains unexpected descendants");
	}
}

export class DiscoveryEnumeration {
	readonly expected: Set<string>;
	readonly seen = new Set<string>();
	readonly tokens = new Set<string>();
	readonly pages: { examined_nodes: number; matches: number; complete: boolean }[] = [];
	examined = 0;
	complete = false;
	constructor(root: string, private readonly command: DiscoveryCommand = "list_components") {
		this.expected = new Set(Array.from({ length: groupCount }, (_, index) => `${root}/${groupName(index)}/${leafName(0)}`));
	}
	accept(value: unknown): string | undefined {
		if (this.complete) throw new Error("discovery returned a page after completion");
		if (this.pages.length >= maximumDiscoveryPages) throw new Error("discovery exceeded the scenario page bound");
		const page = mapping(value);
		const rows = page["matches"];
		const examined = page["examined_nodes"];
		const complete = page["complete"];
		const token = page["next_continuation_token"];
		if (!Array.isArray(rows) || rows.length > requestedMatches || typeof examined !== "number"
			|| !Number.isSafeInteger(examined) || examined < rows.length || examined > candidateBound || typeof complete !== "boolean") throw new Error("discovery page violates its result/work bounds");
		if (complete ? token !== undefined : typeof token !== "string" || token.length === 0) throw new Error("discovery completeness and continuation disagree");
		if (Object.keys(page).length !== (complete ? 3 : 4)) throw new Error("discovery page contains unexpected fields");
		for (const value of rows) {
			const row = mapping(value);
			const path = row["repository_path"];
			if (typeof path !== "string" || !this.expected.has(path)) throw new Error("discovery returned a path outside the independently planted matches");
			if (this.command === "query_paths" ? Object.keys(row).length !== 1 : Object.keys(row).length !== 2 || row["resource_type"] !== componentType) throw new Error("discovery returned fields outside its command's disclosure contract");
			if (this.seen.has(path)) throw new Error("discovery repeated a result across pages");
			this.seen.add(path);
		}
		this.examined += examined;
		if (this.examined > plantedNodes) throw new Error("discovery re-examined the stable tree prefix");
		this.pages.push({ examined_nodes: examined, matches: rows.length, complete });
		this.complete = complete;
		if (complete) {
			if (this.seen.size !== this.expected.size || this.examined !== plantedNodes) throw new Error("discovery completed with omitted matches or unaccounted traversal");
			if (this.pages.length < 2) throw new Error("a tree over one budget completed without continuation");
			return undefined;
		}
		const next = token as string;
		if (this.tokens.has(next)) throw new Error("discovery did not advance its continuation token");
		this.tokens.add(next);
		return next;
	}
}
