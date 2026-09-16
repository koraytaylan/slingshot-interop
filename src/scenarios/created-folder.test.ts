// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { verifyCreatedFolder, verifyCreatedFolderResult } from "./created-folder.ts";

const title = "Created for this run";
const document = { "jcr:primaryType": "sling:OrderedFolder", "jcr:title": title };

test("both folder results must satisfy the closed result contract and authored destination", () => {
	const path = "/content/interop/folder";
	const result = { repository_path: path };
	const retained = { canonical_result: JSON.stringify(result) };
	expect(verifyCreatedFolderResult(result, retained, path).ok).toBe(true);
	for (const malformed of [null, [], {}, { repository_path: "/other" }, { ...result, extra: true }, { repository_path: 1 }]) {
		expect(verifyCreatedFolderResult(malformed, retained, path).ok).toBe(false);
		expect(verifyCreatedFolderResult(result, { canonical_result: JSON.stringify(malformed) }, path).ok).toBe(false);
	}
	for (const malformed of [undefined, null, [], {}, { canonical_result: result }, { canonical_result: "broken" },
		{ canonical_result: '{"repository_path":"/other",' + JSON.stringify(result).slice(1) }]) {
		expect(verifyCreatedFolderResult(result, malformed, path).ok).toBe(false);
	}
	expect(verifyCreatedFolderResult({ repository_path: "/other" }, { canonical_result: '{"repository_path":"/other"}' }, path).ok).toBe(false);
});

test("duplicate properties cannot overwrite contradictory folder evidence", async () => {
	const body = `{"jcr:title":"another run",${JSON.stringify(document).slice(1)}`;
	expect((await verifyCreatedFolder(new Response(body, { headers: { "content-type": "application/json" } }), title, 1024)).ok).toBe(false);
});

test("a bounded repository document proves the requested folder properties", async () => {
	const bytes = new TextEncoder().encode(JSON.stringify(document));
	expect((await verifyCreatedFolder(Response.json(document), title, bytes.length)).ok).toBe(true);
	expect((await verifyCreatedFolder(Response.json(document), title, bytes.length - 1)).ok).toBe(false);
});

test("HTTP success is not proof of a created folder", async () => {
	for (const response of [new Response("<html>login</html>"), new Response(null, { status: 204 }),
		Response.json(document, { status: 404 }), Response.json(null), Response.json([]), Response.json({}),
		Response.json({ ...document, "jcr:title": "another run" }),
		Response.json({ ...document, "jcr:primaryType": "nt:unstructured" }),
		new Response("broken", { headers: { "content-type": "application/json" } }),
	]) expect((await verifyCreatedFolder(response, title, 1024)).ok).toBe(false);
});

test("overflow cancels the body instead of reading an unbounded document", async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(32)); }, cancel() { cancelled = true; } });
	expect((await verifyCreatedFolder(new Response(body, { headers: { "content-type": "application/json" } }), title, 16)).ok).toBe(false);
	expect(cancelled).toBe(true);
});
