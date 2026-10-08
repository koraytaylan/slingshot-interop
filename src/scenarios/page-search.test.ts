// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { PageSearchEnumeration, expectedPages, groupForm, pagePath, phrase, plantedNodes, verifyGroup, verifyGroupReadback } from "./page-search.ts";
import { candidateBound, groupCount, leavesPerGroup, requestedMatches } from "./incremental-discovery.ts";

const root = "/content/synthetic-page-search";
const row = (index: number) => ({ repository_path: pagePath(root, index), title: `${phrase}-${index}` });

test("page corpus exceeds the unchanged reviewed candidate bound", () => {
	expect(plantedNodes).toBeGreaterThan(candidateBound);
	expect(expectedPages(root, "phrase").size).toBe(groupCount / 2);
	expect(expectedPages(root, "any").size).toBe(groupCount);
	expect(expectedPages(root, "all").size).toBe(groupCount / 2);
	expect(expectedPages(root, "absent_phrase").size).toBe(0);
	expect(expectedPages(root, "absent_component").size).toBe(0);
});

test("closed results preserve unique provider order and require complete oracle coverage", () => {
	const held = new PageSearchEnumeration(root, "phrase");
	const indices = Array.from({ length: groupCount / 2 }, (_, index) => index * 2).reverse();
	for (let start = 0; start < indices.length; start += requestedMatches) {
		const complete = start + requestedMatches >= indices.length;
		held.accept({ matches: indices.slice(start, start + requestedMatches).map(row), complete, examined_nodes: candidateBound, ...(complete ? {} : { next_continuation_token: `page-${start}` }) });
	}
	expect(held.seen.size).toBe(groupCount / 2);
	expect(held.complete).toBe(true);
	expect(() => new PageSearchEnumeration(root, "phrase").accept({ matches: [], complete: true, examined_nodes: 0 })).toThrow();
});

test("partial emptiness is legal and duplicates or incomplete progress are refused", () => {
	const held = new PageSearchEnumeration(root, "absent_phrase");
	expect(held.accept({ matches: [], complete: false, examined_nodes: candidateBound, next_continuation_token: "next" })).toBe("next");
	expect(held.accept({ matches: [], complete: true, examined_nodes: 1 })).toBeUndefined();
	for (const result of [
		{ matches: [row(0)], complete: false, examined_nodes: 1 },
		{ matches: [row(0), row(0)], complete: false, examined_nodes: 2, next_continuation_token: "next" },
		{ matches: [], complete: false, examined_nodes: candidateBound + 1, next_continuation_token: "next" },
		{ matches: [], complete: true, examined_nodes: 0, next_continuation_token: "next" },
		{ matches: [row(1)], complete: false, examined_nodes: 1, next_continuation_token: "next" },
		{ matches: [{ ...row(0), excerpt: "unrequested" }], complete: false, examined_nodes: 1, next_continuation_token: "next" },
	]) expect(() => new PageSearchEnumeration(root, "phrase").accept(result)).toThrow();
	const replay = new PageSearchEnumeration(root, "phrase");
	const page = { matches: [row(0)], complete: false, examined_nodes: 1, next_continuation_token: "next" };
	replay.accept(page);
	expect(() => replay.accept(page)).toThrow();
});

test("plant readback checks every leaf and the exact synthetic page properties", () => {
	const group: Record<string, unknown> = { "jcr:primaryType": "sling:OrderedFolder" };
	const form = groupForm(0);
	for (let index = 0; index < leavesPerGroup; index++) group[`node-${index}`] = { "jcr:primaryType": form.get(`node-${index}/jcr:primaryType`) };
	(group["node-0"] as Record<string, unknown>)["jcr:content"] = { "jcr:primaryType": "cq:PageContent", "jcr:title": `${phrase}-0`, "sling:resourceType": "interop/page-text", "body": phrase, image: { "jcr:primaryType": "nt:unstructured", "sling:resourceType": "interop/page-image" } };
	expect(() => verifyGroup(group, 0)).not.toThrow();
	const shallow = { ...group, "node-0": { "jcr:primaryType": "cq:Page" } };
	expect(() => verifyGroupReadback(shallow, group["node-0"], 0)).not.toThrow();
	expect(() => verifyGroupReadback(shallow, { ...(group["node-0"] as Record<string, unknown>), "jcr:primaryType": "sling:Folder" }, 0)).toThrow();
	const missing: Record<string, unknown> = { ...shallow };
	delete missing["node-9"];
	expect(() => verifyGroupReadback(missing, group["node-0"], 0)).toThrow();
	delete group["node-9"];
	expect(() => verifyGroup(group, 0)).toThrow();
});
