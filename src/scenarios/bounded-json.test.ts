// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { readBoundedJson } from "../harness/bounded-json.ts";

test("JSON capture counts UTF-8 bytes and accepts exactly the configured bound", async () => {
	const value = { token: "é" };
	const bound = Buffer.byteLength(JSON.stringify(value));
	expect(await readBoundedJson(Response.json(value), bound)).toEqual({ ok: true, value });
	expect((await readBoundedJson(Response.json(value), bound - 1)).ok).toBe(false);
});

test("JSON capture cancels overflow and releases the stream lock", async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) { controller.enqueue(new Uint8Array(32)); },
		cancel() { cancelled = true; },
	});
	expect((await readBoundedJson(new Response(body, { headers: { "content-type": "application/json" } }), 16)).ok).toBe(false);
	expect(cancelled).toBe(true);
	expect(body.locked).toBe(false);
});

test("JSON capture refuses invalid bounds, HTTP responses, encoding and syntax", async () => {
	for (const bound of [0, -1, NaN, Infinity, 1.5]) {
		expect((await readBoundedJson(Response.json({}), bound)).ok).toBe(false);
	}
	for (const response of [
		Response.json({}, { status: 401 }), new Response(null, { status: 204 }),
		new Response("{}", { headers: { "content-type": "text/html" } }),
		new Response("broken", { headers: { "content-type": "application/json" } }),
		new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
	]) expect((await readBoundedJson(response, 1024)).ok).toBe(false);
});

test("read failures release locks and do not expose response or exception excerpts", async () => {
	const secret = "synthetic-token-that-must-not-enter-diagnostics";
	const body = new ReadableStream<Uint8Array>({ pull() { throw new Error(secret); } });
	const result = await readBoundedJson(new Response(body, { headers: { "content-type": "application/json" } }), 1024);
	expect(result.ok).toBe(false);
	expect(body.locked).toBe(false);
	expect(JSON.stringify(result)).not.toContain(secret);
	const malformed = await readBoundedJson(new Response(`{"token":"${secret}`, { headers: { "content-type": "application/json" } }), 1024);
	expect(malformed.ok).toBe(false);
	expect(JSON.stringify(malformed)).not.toContain(secret);
});

test("JSON capture rejects duplicate decoded object keys without confusing values or sibling objects", async () => {
	for (const text of [
		'{"token":"first","token":"second"}',
		'{"token":"first","to\\u006ben":"second"}',
		'{"nested":{"same":1,"same":2}}',
		'[{"same":1,"same":2}]',
		'{"__proto__":1,"__proto__":2}',
	]) {
		expect((await readBoundedJson(new Response(text, { headers: { "content-type": "application/json" } }), 1024)).ok).toBe(false);
	}
	for (const value of [
		{ token: "token", nested: { token: "another" } },
		[{ same: 1 }, { same: 2 }],
		{ escaped: 'quote \\" braces {,}:[]', empty: {}, array: ["same", "same"] },
	]) expect(await readBoundedJson(Response.json(value), 1024)).toEqual({ ok: true, value });
});
