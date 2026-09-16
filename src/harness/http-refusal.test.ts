// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { refuseHttpResponse } from "./http-refusal.ts";

test.each([false, true])("HTTP refusal cancels without reading or exposing the body; cancellation throws: %s", async (throws) => {
	let pulls = 0;
	let cancellations = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode("private body")); },
		cancel() { cancellations++; if (throws) throw new Error("private cancellation failure"); },
	}, { highWaterMark: 0 });
	expect(await refuseHttpResponse(new Response(body, { status: 503 }), "planting failed"))
		.toEqual({ ok: false, message: "planting failed: HTTP 503" });
	expect(pulls).toBe(0);
	expect(cancellations).toBe(1);
});

test("HTTP refusal retains status when there is no body", async () => {
	expect(await refuseHttpResponse(new Response(null, { status: 403 }), "arming failed"))
		.toEqual({ ok: false, message: "arming failed: HTTP 403" });
});
