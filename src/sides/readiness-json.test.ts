// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, spyOn, test } from "bun:test";
import { awaitActive, awaitContinuationAuthority, type StartSlingRuntimeOptions } from "./agent-runtime.ts";

test.each(["bundle", "authority"])("%s readiness requires bounded unambiguous direct JSON", async (kind) => {
	let now = 100;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const sleep = spyOn(Bun, "sleep").mockImplementation(() => { now = 101; return Promise.resolve(); });
	const request = spyOn(globalThis, "fetch");
	const options = { consoleUsername: "admin", consolePassword: "fixture", activeDeadline: new Date(101),
		values: { capture: { maximumBytes: 128 }, readiness: { pollIntervalSeconds: 0 } } } as StartSlingRuntimeOptions;
	const valid = kind === "bundle" ? '{"data":[{"symbolicName":"bundle","state":"Active"}]}' : '{"continuation_authority_ready":true}';
	const duplicate = kind === "bundle" ? '{"data":[{"symbolicName":"bundle","state":"Installed","state":"Active"}]}'
		: '{"continuation_authority_ready":false,"continuation_authority_ready":true}';
	try {
		for (const mode of ["success", "duplicate", "oversized", "wrong-media", "accepted-status", ...(kind === "bundle" ? ["duplicate-bundles"] : [])]) {
			now = 100;
			const body = mode === "duplicate" ? duplicate : mode === "oversized" ? " ".repeat(129) + valid
				: mode === "duplicate-bundles" ? '{"data":[{"symbolicName":"bundle","state":"Installed"},{"symbolicName":"bundle","state":"Active"}]}' : valid;
			request.mockReset().mockResolvedValue(new Response(body, { status: mode === "accepted-status" ? 202 : 200,
				headers: { "content-type": mode === "wrong-media" ? "text/html" : "application/json" } }));
			const answer = kind === "bundle" ? await awaitActive("bundle", 4502, options) : await awaitContinuationAuthority(4502, options);
			expect(answer.ok).toBe(mode === "success");
			expect(request).toHaveBeenCalledTimes(1);
		}
	} finally { request.mockRestore(); sleep.mockRestore(); clock.mockRestore(); }
});
