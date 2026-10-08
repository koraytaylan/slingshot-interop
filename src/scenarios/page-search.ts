// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { mapping } from "./discovery-lifecycle.ts";
import { candidateBound, discoveryLimitsDigest, groupCount, leavesPerGroup, maximumDiscoveryPages, requestedMatches } from "./incremental-discovery.ts";

export const phrase = "synthetic-page-needle";
export const textType = "interop/page-text";
export const imageType = "interop/page-image";
export const plantedNodes = 1 + groupCount * (leavesPerGroup + 2) + groupCount / 2;
export type Search = "phrase" | "absent_phrase" | "any" | "all" | "absent_component";
export const wireName = (search: Search) => search === "phrase" || search === "absent_phrase" ? "find_pages_containing_phrase" : "find_pages_using_components";
export const pagePath = (root: string, index: number) => `${root}/group-${index}/node-0`;
const title = (index: number) => `${index % 2 === 0 ? phrase : phrase.toUpperCase()}-${index}`;

export function expectedPages(root: string, search: Search): Set<string> {
	return new Set(Array.from({ length: groupCount }, (_, index) => index)
		.filter(index => search === "any" || (search === "phrase" || search === "all") && index % 2 === 0)
		.map(index => pagePath(root, index)));
}

export function groupForm(index: number): URLSearchParams {
	const form = new URLSearchParams({ "jcr:primaryType": "sling:OrderedFolder" });
	for (let child = 0; child < leavesPerGroup; child++) form.set(`node-${child}/jcr:primaryType`, child === 0 ? "cq:Page" : "sling:Folder");
	for (const [name, value] of Object.entries({ "jcr:primaryType": "cq:PageContent", "jcr:title": title(index), "sling:resourceType": textType, body: phrase })) form.set(`node-0/jcr:content/${name}`, value);
	if (index % 2 === 0) {
		form.set("node-0/jcr:content/image/jcr:primaryType", "nt:unstructured");
		form.set("node-0/jcr:content/image/sling:resourceType", imageType);
	}
	return form;
}

function children(value: Record<string, unknown>): string[] {
	return Object.keys(value).filter(name => value[name] !== null && typeof value[name] === "object" && !Array.isArray(value[name])).sort();
}

export function verifyGroup(value: unknown, index: number): void {
	const group = mapping(value);
	const names = Array.from({ length: leavesPerGroup }, (_, child) => `node-${child}`).sort();
	if (group["jcr:primaryType"] !== "sling:OrderedFolder" || JSON.stringify(children(group)) !== JSON.stringify(names)) throw new Error("page corpus group is incomplete or has unexpected children");
	for (let child = 0; child < leavesPerGroup; child++) {
		const leaf = mapping(group[`node-${child}`]);
		if (leaf["jcr:primaryType"] !== (child === 0 ? "cq:Page" : "sling:Folder") || JSON.stringify(children(leaf)) !== JSON.stringify(child === 0 ? ["jcr:content"] : [])) throw new Error("page corpus leaf has the wrong type or children");
	}
	const content = mapping(mapping(group["node-0"])["jcr:content"]);
	if (content["jcr:primaryType"] !== "cq:PageContent" || content["jcr:title"] !== title(index) || content["sling:resourceType"] !== textType || content["body"] !== phrase
		|| JSON.stringify(children(content)) !== JSON.stringify(index % 2 === 0 ? ["image"] : [])) throw new Error("page corpus content differs from the planted oracle");
	if (index % 2 === 0) {
		const image = mapping(content["image"]);
		if (image["jcr:primaryType"] !== "nt:unstructured" || image["sling:resourceType"] !== imageType || children(image).length !== 0) throw new Error("page corpus image differs from the planted oracle");
	}
}

export function verifyGroupReadback(shallowValue: unknown, pageValue: unknown, index: number): void {
	const group = mapping(shallowValue);
	const shallowPage = mapping(group["node-0"]);
	const page = mapping(pageValue);
	for (const [name, value] of Object.entries(shallowPage)) {
		if (JSON.stringify(page[name]) !== JSON.stringify(value)) throw new Error("page readbacks disagree about the same planted resource");
	}
	verifyGroup({ ...group, "node-0": page }, index);
}

export function requireReviewedPageSearch(capabilities: unknown, search: Search): void {
	const rows = mapping(capabilities)["command_contracts"];
	if (!Array.isArray(rows)) throw new Error("page search capabilities have no command identities");
	const matching = rows.map(mapping).filter(row => row["command_wire_name"] === wireName(search));
	if (matching.length !== 1 || matching[0]!["command_semantic_contract_version"] !== "0.0.0" || matching[0]!["command_contract_limits_digest"] !== discoveryLimitsDigest) throw new Error("page search fixture has not been reviewed for the selected command identity");
}

export class PageSearchEnumeration {
	readonly seen = new Set<string>();
	readonly expected: Set<string>;
	readonly pages: { examined_nodes: number; matches: number; complete: boolean }[] = [];
	complete = false;
	examined = 0;
	constructor(readonly root: string, search: Search) { this.expected = expectedPages(root, search); }
	accept(value: unknown): string | undefined {
		const result = mapping(value);
		const rows = result["matches"];
		const complete = result["complete"];
		const examined = result["examined_nodes"];
		const token = result["next_continuation_token"];
		if (this.complete || this.pages.length >= maximumDiscoveryPages || !Array.isArray(rows) || rows.length > requestedMatches || typeof complete !== "boolean"
			|| typeof examined !== "number" || !Number.isSafeInteger(examined) || examined < rows.length || examined > candidateBound
			|| (complete ? token !== undefined : typeof token !== "string" || token.length === 0) || Object.keys(result).length !== (complete ? 3 : 4)) throw new Error("page search violated its closed progress or work bounds");
		for (const value of rows) {
			const row = mapping(value);
			const path = row["repository_path"];
			if (typeof path !== "string" || !this.expected.has(path) || this.seen.has(path) || Object.keys(row).sort().join(",") !== "repository_path,title") throw new Error("page search returned an unexpected, repeated or excessive row");
			const index = Number(path.slice(this.root.length + "/group-".length).split("/")[0]);
			if (row["title"] !== title(index)) throw new Error("page search omitted or changed a planted title");
			this.seen.add(path);
		}
		if (complete && this.seen.size !== this.expected.size) throw new Error("page search declared completion without the entire independent match oracle");
		this.complete = complete;
		this.examined += examined;
		this.pages.push({ examined_nodes: examined, matches: rows.length, complete });
		return typeof token === "string" ? token : undefined;
	}
}
