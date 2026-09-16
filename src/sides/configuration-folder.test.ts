// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, spyOn, test } from "bun:test";
import { createConfigurationFolder, uploadConfiguration } from "./configuration-folder.ts";

test("configuration upload retries startup 404 with exactly the same named bytes", async () => {
	const request = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("early", { status: 404 }))
		.mockResolvedValueOnce(new Response("uploaded", { status: 201 }));
	try {
		const bytes = new TextEncoder().encode('{"fixture":"é"}');
		expect((await uploadConfiguration("http://author/config/", "Basic fixture", "fixture.cfg.json", bytes, new Date(Date.now() + 10_000), 0)).ok).toBe(true);
		expect(request).toHaveBeenCalledTimes(2);
		for (const call of request.mock.calls) {
			const file = (call[1]?.body as FormData).get("*") as File;
			expect(file.name).toBe("fixture.cfg.json");
			expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
		}
		request.mockReset().mockResolvedValue(new Response("conflict", { status: 409 }));
		expect((await uploadConfiguration("http://author/config/", "Basic fixture", "fixture.cfg.json", bytes, new Date(Date.now() + 10_000), 0)).ok).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
	} finally { request.mockRestore(); }
});
import { consoleAnswers, type StartSlingRuntimeOptions } from "./agent-runtime.ts";

test("an unavailable upload stops at the original deadline without renewing its budget", async () => {
	let now = 100;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const unavailable = Object.assign(async () => {
		now = 101;
		return new Response("not yet", { status: 503 });
	}, { preconnect: globalThis.fetch.preconnect });
	const request = spyOn(globalThis, "fetch").mockImplementation(unavailable);
	try {
		const answer = await uploadConfiguration("http://author/config/", "Basic fixture", "fixture.cfg.json", new Uint8Array(), new Date(101), 1000);
		expect(answer.ok).toBe(false);
		if (!answer.ok) expect(answer.message).toContain("HTTP 503");
		expect(request).toHaveBeenCalledTimes(1);
	} finally { request.mockRestore(); clock.mockRestore(); }
});

test("an upload must finish before its deadline, not merely start before it", async () => {
	let now = 100;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const request = spyOn(globalThis, "fetch");
	try {
		for (const completion of [100, 101, 102]) {
			now = 100;
			request.mockImplementation(Object.assign(async () => {
				now = completion;
				return new Response("created", { status: 201 });
			}, { preconnect: globalThis.fetch.preconnect }));
			expect((await uploadConfiguration("http://author/config/", "Basic fixture", "fixture.cfg.json", new Uint8Array(), new Date(101), 0)).ok).toBe(completion < 101);
		}
	} finally { request.mockRestore(); clock.mockRestore(); }
});

test("runtime readiness requires an authenticated usable console listing, not root 404", async () => {
	const options = { consoleUsername: "admin", consolePassword: "fixture", values: { capture: { maximumBytes: 1024 } } } as StartSlingRuntimeOptions;
	const request = spyOn(globalThis, "fetch");
	try {
		for (const response of [new Response("not ready", { status: 404 }), new Response("login"),
			Response.json({ data: [] }), Response.json({ data: [{}] }), Response.json({ data: [{ name: "bundle", state: 1 }] })]) {
			request.mockResolvedValue(response);
			expect(await consoleAnswers(4502, options)).toBe(false);
		}
		request.mockResolvedValue(Response.json({ data: [{ symbolicName: "org.example.bundle", state: "Active" }] }));
		expect(await consoleAnswers(4502, options)).toBe(true);
		expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4502/system/console/bundles.json");
		expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", headers: { authorization: `Basic ${Buffer.from("admin:fixture").toString("base64")}` } });
	} finally { request.mockRestore(); }
});

test("early repository 404/503s do not fail setup while the startup budget remains", async () => {
	const request = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("early", { status: 404 }))
		.mockResolvedValueOnce(new Response("starting", { status: 503 })).mockResolvedValueOnce(new Response("created", { status: 201 }));
	try {
		expect(await createConfigurationFolder("http://author/apps/agent", "Basic fixture", new Date(Date.now() + 10_000), 0)).toEqual({ ok: true });
		expect(request).toHaveBeenCalledTimes(3);
		expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Basic fixture" } });
	} finally { request.mockRestore(); }
});

test("refusals other than startup-unavailable fail without retry", async () => {
	const request = spyOn(globalThis, "fetch");
	try {
		for (const status of [204, 302, 400, 401, 403, 500]) {
			request.mockReset().mockResolvedValue(new Response(null, { status }));
			expect((await createConfigurationFolder("http://author/apps/agent", "Basic fixture", new Date(Date.now() + 10_000), 0)).ok).toBe(false);
			expect(request).toHaveBeenCalledTimes(1);
		}
		request.mockReset();
		expect((await createConfigurationFolder("http://author/apps/agent", "Basic fixture", new Date(0), 0)).ok).toBe(false);
		expect(request).not.toHaveBeenCalled();
	} finally { request.mockRestore(); }
});
