// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { agentOperationInventory, parseOperationInventory } from "./agent-operation-inventory.ts";

const node = (children = {}) => ({ "jcr:primaryType": "nt:unstructured", ...children });
const identifier = "aabb" + "c".repeat(60);

test("admission inventory identifies complete generation and bucket paths", () => {
	expect(parseOperationInventory(node({ g1: node({ aa: node({ bb: node({ [identifier]: node({ state: "succeeded" }) }) }) }) })))
		.toEqual({ ok: true, operations: [`g1/aa/bb/${identifier}`] });
	expect(parseOperationInventory(node())).toEqual({ ok: true, operations: [] });
});

test("Sling creation metadata is allowed only with its expected field types", () => {
	const metadata = { "jcr:createdBy": "admin", "jcr:created": "Tue Sep 15 2026 23:00:04 GMT+0000" };
	expect(parseOperationInventory(node(metadata))).toEqual({ ok: true, operations: [] });
	const folder = (children = {}) => node({ ...metadata, ...children });
	expect(parseOperationInventory(folder({ g1: folder({ aa: folder({ bb: folder({ [identifier]: node() }) }) }) })))
		.toEqual({ ok: true, operations: [`g1/aa/bb/${identifier}`] });
	for (const invalid of [{ "jcr:createdBy": {} }, { "jcr:created": [] }, { "jcr:created": "" }, { "jcr:truncated": true }]) {
		expect(parseOperationInventory(node(invalid)).ok).toBe(false);
	}
});

test("compare-and-set transition metadata is allowed only as nonempty text", () => {
	expect(parseOperationInventory(node({ transition_revision: "revision-one" }))).toEqual({ ok: true, operations: [] });
	for (const invalid of [{ transition_revision: "" }, { transition_revision: 1 }, { transition_revision: null }]) {
		expect(parseOperationInventory(node(invalid)).ok).toBe(false);
	}
});

test("inventory capture authenticates and refuses missing, redirected, malformed, or oversized evidence", async () => {
	let reply = () => Response.json(node());
	const requests: { path: string; authorization: string | null }[] = [];
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
		requests.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") });
		return reply();
	} });
	try {
		expect(await agentOperationInventory(server.port!, 1024)).toEqual({ ok: true, operations: [] });
		expect(requests[0]).toEqual({ path: "/var/slingshot-agent/operations.4.json", authorization: `Basic ${Buffer.from("admin:admin").toString("base64")}` });
		for (const response of [() => new Response("missing", { status: 404 }),
			() => new Response("", { status: 302, headers: { location: "/login" } }),
			() => new Response("<html>login</html>"),
			() => new Response("broken", { headers: { "content-type": "application/json" } }),
			() => new Response('{"jcr:primaryType":"nt:unstructured","g1":{"jcr:primaryType":"nt:unstructured","aa":{}},"g1":{"jcr:primaryType":"nt:unstructured"}}', { headers: { "content-type": "application/json" } }),
			() => new Response(new Uint8Array([...new TextEncoder().encode('{"jcr:primaryType":"'), 0xff, ...new TextEncoder().encode('"}')]), { headers: { "content-type": "application/json" } }),
			() => Response.json(node({ extra: "x".repeat(2048) }))]) {
			reply = response;
			expect((await agentOperationInventory(server.port!, 1024)).ok).toBe(false);
		}
	} finally {
		await server.stop(true);
	}
});

test("missing, truncated, malformed, and misbucketed inventories cannot prove absence", () => {
	for (const value of [null, {}, [], node({ g1: {} }), node({ g1: node({ aa: 1 }) }),
		node({ g1: node({ aa: node({ bb: node({ [identifier]: {} }) }) }) }),
		node({ g1: node({ aa: node({ cc: node({ [identifier]: node() }) }) }) }),
		node({ "jcr:truncated": true }), node({ g0: node() }), node({ "1": node() })]) {
		expect(parseOperationInventory(value).ok).toBe(false);
	}
});
