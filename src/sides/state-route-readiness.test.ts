// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, spyOn, test } from "bun:test";
import { awaitStateRoute, type StartSlingRuntimeOptions } from "./agent-runtime.ts";
import { isStateRouteRefusal } from "./state-route-readiness.ts";

test("state refusal checks the empty body on a real HTTP response", async () => {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
		return new URL(request.url).pathname === "/empty"
			? new Response(null, { status: 404, headers: { "content-length": "0", "retry-after": "30" } })
			: new Response("not found", { status: 404 });
	} });
	try {
		for (const path of ["empty", "platform"]) {
			const response = await fetch(`http://127.0.0.1:${server.port}/${path}`, { redirect: "error", signal: AbortSignal.timeout(1000) });
			expect(await isStateRouteRefusal(response)).toBe(path === "empty");
		}
	} finally { await server.stop(true); }
});

test("nonempty refusal bodies are cancelled and their locks released even if cancellation fails", async () => {
	let cancelled = false;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) { controller.enqueue(new Uint8Array([1])); },
		cancel() { cancelled = true; throw new Error("fixture cancellation failure"); },
	});
	expect(await isStateRouteRefusal(new Response(body, { status: 404,
		headers: { "content-length": "0", "retry-after": "30" } }))).toBe(false);
	expect(cancelled).toBe(true);
	expect(body.locked).toBe(false);
});

test("state readiness requires the lookup servlet's empty retryable refusal, not any 404", async () => {
	let now = 100;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const sleep = spyOn(Bun, "sleep").mockImplementation(() => { now = 101; return Promise.resolve(); });
	const request = spyOn(globalThis, "fetch");
	const options = { consoleUsername: "admin", consolePassword: "fixture", activeDeadline: new Date(101),
		values: { readiness: { pollIntervalSeconds: 0 } } } as StartSlingRuntimeOptions;
	try {
		for (const [response, accepted] of [
			[new Response(null, { status: 404, headers: { "content-length": "0", "retry-after": "30" } }), true],
			[new Response("<html>not found</html>", { status: 404 }), false],
			[new Response(null, { status: 404 }), false],
			[new Response("x", { status: 404, headers: { "content-length": "0", "retry-after": "30" } }), false],
			...["0", "-1", "1.5", "30, 30", "tomorrow"].map(value => [new Response(null, { status: 404,
				headers: { "content-length": "0", "retry-after": value } }), false] as const),
		] as const) {
			now = 100;
			request.mockReset().mockResolvedValue(response);
			expect((await awaitStateRoute(4502, options)).ok).toBe(accepted);
			expect(request).toHaveBeenCalledTimes(1);
		}
	} finally { request.mockRestore(); sleep.mockRestore(); clock.mockRestore(); }
});
