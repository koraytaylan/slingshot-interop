// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { mapping } from "./discovery-lifecycle.ts";
import { candidateBound, groupCount, leavesPerGroup, maximumDiscoveryPages, requestedMatches } from "./incremental-discovery.ts";

export const traversalNodes = 1 + groupCount * (1 + leavesPerGroup);
export const storedNodes = traversalNodes + groupCount * 5;
export const originalBytes = new TextEncoder().encode("synthetic");
export const mediaFormat = "application/octet-stream";
export const firstTag = "synthetic-first-tag";
export const secondTag = "synthetic-second-tag";
export type Search = "all" | "size" | "tags" | "absent";
export const assetPath = (root: string, index: number) => `${root}/group-${index}/node-0`;
const tags = (index: number) => index % 2 === 0 ? [firstTag, secondTag] : [secondTag];
export const assetRow = (root: string, index: number) => ({ repository_path: assetPath(root, index), byte_length: originalBytes.length, media_format: mediaFormat, tags: tags(index) });

export async function verifyOriginal(response: Response): Promise<void> {
	if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0] !== mediaFormat || response.body === null) {
		await response.body?.cancel();
		throw new Error("original binary readback has the wrong status, type or body");
	}
	const reader = response.body.getReader();
	let position = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			if (position + chunk.value.length > originalBytes.length) throw new Error("original binary exceeds its independent byte bound");
			for (const byte of chunk.value) {
				if (byte !== originalBytes[position++]) throw new Error("original binary differs from its independent byte oracle");
			}
		}
		if (position !== originalBytes.length) throw new Error("original binary is incomplete");
	} finally {
		try { await reader.cancel(); } finally { reader.releaseLock(); }
	}
}

export function groupForm(index: number): URLSearchParams {
	const form = new URLSearchParams({ "jcr:primaryType": "sling:OrderedFolder" });
	for (let child = 0; child < leavesPerGroup; child++) form.set(`node-${child}/jcr:primaryType`, child === 0 ? "dam:Asset" : "sling:Folder");
	form.set("node-0/jcr:content/jcr:primaryType", "nt:unstructured");
	form.set("node-0/jcr:content/metadata/jcr:primaryType", "nt:unstructured");
	form.set("node-0/jcr:content/metadata/dam:size", String(originalBytes.length + 1));
	form.set("node-0/jcr:content/metadata/dam:size@TypeHint", "Long");
	if (index % 2 !== 0) form.set("node-0/jcr:content/metadata/dc:format", mediaFormat);
	form.set("node-0/jcr:content/metadata/cq:tags@TypeHint", "String[]");
	for (const tag of index % 2 === 0 ? [secondTag, firstTag, firstTag] : [secondTag]) form.append("node-0/jcr:content/metadata/cq:tags", tag);
	return form;
}

function children(value: Record<string, unknown>): string[] {
	return Object.keys(value).filter(name => value[name] !== null && typeof value[name] === "object" && !Array.isArray(value[name])).sort();
}

export function verifyGroup(value: unknown): void {
	const group = mapping(value);
	const expected = Array.from({ length: leavesPerGroup }, (_, index) => `node-${index}`).sort();
	if (group["jcr:primaryType"] !== "sling:OrderedFolder" || JSON.stringify(children(group)) !== JSON.stringify(expected)) throw new Error("asset corpus group is incomplete");
	for (let index = 0; index < leavesPerGroup; index++) {
		const leaf = mapping(group[`node-${index}`]);
		if (leaf["jcr:primaryType"] !== (index === 0 ? "dam:Asset" : "sling:Folder") || children(leaf).length !== 0) throw new Error("asset corpus leaf has the wrong type or descendants");
	}
}

export function verifyMetadata(value: unknown, index: number): void {
	const content = mapping(value);
	if (content["jcr:primaryType"] !== "nt:unstructured" || children(content).join(",") !== "metadata,renditions") throw new Error("asset content differs from its independent oracle");
	const metadata = mapping(content["metadata"]);
	const plantedTags = index % 2 === 0 ? [secondTag, firstTag, firstTag] : [secondTag];
	if (metadata["jcr:primaryType"] !== "nt:unstructured" || metadata["dam:size"] !== originalBytes.length + 1
		|| JSON.stringify(metadata["cq:tags"]) !== JSON.stringify(plantedTags)
		|| metadata["dc:format"] !== (index % 2 === 0 ? undefined : mediaFormat) || children(metadata).length !== 0) throw new Error("asset metadata plant differs from its oracle");
	const renditions = mapping(content["renditions"]);
	const original = mapping(renditions["original"]);
	const data = mapping(original["jcr:content"]);
	if (children(renditions).join(",") !== "original" || original["jcr:primaryType"] !== "nt:file"
		|| children(original).join(",") !== "jcr:content" || data["jcr:primaryType"] !== "nt:resource"
		|| data["jcr:mimeType"] !== mediaFormat || data[":jcr:data"] !== originalBytes.length
		|| children(data).length !== 0) throw new Error("asset original differs from its planted structure");
}

export class AssetEnumeration {
	readonly expected: Set<string>;
	readonly seen = new Set<string>();
	readonly tokens = new Set<string>();
	readonly pages: { examined_nodes: number; matches: number; complete: boolean }[] = [];
	examined = 0;
	complete = false;
	constructor(readonly root: string, readonly search: Search) {
		this.expected = new Set(Array.from({ length: groupCount }, (_, index) => index)
			.filter(index => search !== "absent" && (search !== "tags" || index % 2 === 0)).map(index => assetPath(root, index)));
	}
	accept(value: unknown): string | undefined {
		const page = mapping(value);
		const rows = page["matches"];
		const examined = page["examined_nodes"];
		const complete = page["complete"];
		const token = page["next_continuation_token"];
		if (this.complete || this.pages.length >= maximumDiscoveryPages || !Array.isArray(rows) || rows.length > requestedMatches
			|| typeof examined !== "number" || !Number.isSafeInteger(examined) || examined < rows.length || examined > candidateBound
			|| typeof complete !== "boolean" || (complete ? token !== undefined : typeof token !== "string" || token.length === 0)
			|| Object.keys(page).length !== (complete ? 3 : 4)) throw new Error("asset page violates closed progress or work bounds");
		for (const value of rows) {
			const row = mapping(value);
			const path = row["repository_path"];
			if (typeof path !== "string" || !this.expected.has(path) || this.seen.has(path)) throw new Error("asset search returned an unexpected or repeated match");
			const index = Number(path.slice(this.root.length + "/group-".length).split("/")[0]);
			const oracle = assetRow(this.root, index);
			if (Object.keys(row).sort().join(",") !== Object.keys(oracle).sort().join(",") || row["byte_length"] !== oracle.byte_length
				|| row["media_format"] !== oracle.media_format || JSON.stringify(row["tags"]) !== JSON.stringify(oracle.tags)) throw new Error("asset row differs from its independent metadata oracle");
			this.seen.add(path);
		}
		this.examined += examined;
		if (this.examined > traversalNodes) throw new Error("asset search re-examined a stable prefix or descended inside an asset");
		this.pages.push({ examined_nodes: examined, matches: rows.length, complete });
		this.complete = complete;
		if (complete) {
			if (this.seen.size !== this.expected.size || this.examined !== traversalNodes) throw new Error("asset search claimed completion without the full independent oracle");
			return undefined;
		}
		if (this.tokens.has(token as string)) throw new Error("asset continuation did not advance");
		this.tokens.add(token as string);
		return token as string;
	}
}
