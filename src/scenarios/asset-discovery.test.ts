// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { AssetEnumeration, assetPath, assetRow, groupForm, traversalNodes, verifyGroup, verifyMetadata, verifyOriginal, originalBytes, mediaFormat } from "./asset-discovery.ts";
import { candidateBound, groupCount, leavesPerGroup, requestedMatches } from "./incremental-discovery.ts";

const root = "/content/synthetic-asset-search";

test("asset traversal independently exceeds the original candidate budget", () => {
	expect(traversalNodes).toBeGreaterThan(candidateBound);
	const form = groupForm(0);
	expect(form.get("node-0/jcr:primaryType")).toBe("dam:Asset");
	expect(form.get("node-0/jcr:content/metadata/dam:size")).toBe("10");
	expect(form.getAll("node-0/jcr:content/metadata/cq:tags")).toHaveLength(3);
});

test("asset pages keep exact metadata, provider order and the complete traversal oracle", () => {
	const held = new AssetEnumeration(root, "all");
	const indices = Array.from({ length: groupCount }, (_, index) => index).reverse();
	for (let start = 0; start < indices.length; start += requestedMatches) {
		const complete = start + requestedMatches >= indices.length;
		held.accept({ matches: indices.slice(start, start + requestedMatches).map(index => assetRow(root, index)), complete,
            examined_nodes: complete ? traversalNodes - Math.floor(start / requestedMatches) * leavesPerGroup : leavesPerGroup,
			...(complete ? {} : { next_continuation_token: `synthetic-page-${start}` }) });
	}
	expect(held.complete).toBe(true);
	expect(held.examined).toBe(traversalNodes);
	expect(held.seen.size).toBe(groupCount);
});

test("asset pages refuse missing, repeated, stale-sized or unrequested matches", () => {
	for (const result of [
		{ matches: [], complete: true, examined_nodes: traversalNodes },
		{ matches: [assetRow(root, 0), assetRow(root, 0)], complete: false, examined_nodes: 2, next_continuation_token: "next" },
		{ matches: [{ ...assetRow(root, 0), byte_length: 10 }], complete: false, examined_nodes: 1, next_continuation_token: "next" },
		{ matches: [{ ...assetRow(root, 0), tags: ["synthetic-second-tag", "synthetic-first-tag"] }], complete: false, examined_nodes: 1, next_continuation_token: "next" },
		{ matches: [assetRow(root, 0)], complete: false, examined_nodes: candidateBound + 1, next_continuation_token: "next" },
		{ matches: [assetRow(root, 0)], complete: false, examined_nodes: 1 },
	]) expect(() => new AssetEnumeration(root, "all").accept(result)).toThrow();
	expect(() => new AssetEnumeration(root, "tags").accept({ matches: [assetRow(root, 1)], complete: false, examined_nodes: 1, next_continuation_token: "next" })).toThrow();
});

test("asset readback verifies every leaf and refuses an incomplete plant", () => {
	const group: Record<string, unknown> = { "jcr:primaryType": "sling:OrderedFolder" };
	for (let index = 0; index < leavesPerGroup; index++) group[`node-${index}`] = { "jcr:primaryType": index === 0 ? "dam:Asset" : "sling:Folder" };
	expect(() => verifyGroup(group)).not.toThrow();
	delete group["node-9"];
	expect(() => verifyGroup(group)).toThrow();
	expect(assetPath(root, 0)).toBe(`${root}/group-0/node-0`);
});

test("independent original readback checks exact bytes and refuses either side of its bound", async () => {
 await expect(verifyOriginal(new Response(originalBytes, { headers: { "content-type": mediaFormat } }))).resolves.toBeUndefined();
 for (const bytes of [originalBytes.slice(0, -1), new Uint8Array([...originalBytes, 0]), new Uint8Array(originalBytes.length)]) {
  await expect(verifyOriginal(new Response(bytes, { headers: { "content-type": mediaFormat } }))).rejects.toThrow();
 }
});

test("metadata readback requires a nested file original and the exact binary length", () => {
	const content = { "jcr:primaryType": "nt:unstructured", metadata: {
		"jcr:primaryType": "nt:unstructured", "dam:size": 10,
		"cq:tags": ["synthetic-second-tag", "synthetic-first-tag", "synthetic-first-tag"],
	}, renditions: { original: { "jcr:primaryType": "nt:file", "jcr:content": {
		"jcr:primaryType": "nt:resource", "jcr:mimeType": "application/octet-stream", ":jcr:data": 9,
	} } } };
	expect(() => verifyMetadata(content, 0)).not.toThrow();
	for (const length of [8, 10]) {
		const wrong = structuredClone(content);
		wrong.renditions.original["jcr:content"][":jcr:data"] = length;
		expect(() => verifyMetadata(wrong, 0)).toThrow();
	}
	const flattened = { ...content, renditions: { original: content.renditions.original["jcr:content"] } };
	expect(() => verifyMetadata(flattened, 0)).toThrow();
});
