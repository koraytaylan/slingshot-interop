// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, spyOn, test } from "bun:test";
import { awaitActive, awaitContinuationAuthority, awaitStateRoute, type StartSlingRuntimeOptions } from "./agent-runtime.ts";

test.each(["bundle", "authority", "state"])("%s readiness must complete before the shared deadline", async (kind) => {
	let now = 100;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
	const request = spyOn(globalThis, "fetch");
	const options = { consoleUsername: "admin", consolePassword: "fixture", activeDeadline: new Date(101),
		values: { capture: { maximumBytes: 1024 }, readiness: { pollIntervalSeconds: 0 } } } as StartSlingRuntimeOptions;
	const check = () => kind === "bundle" ? awaitActive("bundle", 4502, options)
		: kind === "authority" ? awaitContinuationAuthority(4502, options) : awaitStateRoute(4502, options);
	try {
		for (const completion of [100, 101, 102]) {
			now = 100;
			timeout.mockClear();
			request.mockReset().mockImplementation(Object.assign(async () => {
				now = completion;
				return kind === "bundle" ? Response.json({ data: [{ symbolicName: "bundle", state: "Active" }] })
					: kind === "authority" ? Response.json({ continuation_authority_ready: true }) : new Response(null, { status: 404,
						headers: { "content-length": "0", "retry-after": "30" } });
			}, { preconnect: globalThis.fetch.preconnect }));
			expect((await check()).ok).toBe(completion < 101);
			expect(request).toHaveBeenCalledTimes(1);
			expect(timeout.mock.calls).toEqual([[1]]);
		}
		now = 101;
		request.mockClear();
		timeout.mockClear();
		expect((await check()).ok).toBe(false);
		expect(request).not.toHaveBeenCalled();
		expect(timeout).not.toHaveBeenCalled();
	} finally { request.mockRestore(); timeout.mockRestore(); clock.mockRestore(); }
});
