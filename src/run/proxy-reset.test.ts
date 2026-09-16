// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { disarmSeveranceProxy } from "./orchestration.ts";
import { severancePoints, startSeveranceProxy } from "../harness/severance-proxy.ts";
import type { Values } from "../harness/values.ts";

test.each([200, 202, 204, 302, 500])("between-scenario reset requires direct control acknowledgement: %s", async (status) => {
	const requests: { path: string; method: string }[] = [];
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
		const path = new URL(request.url).pathname;
		requests.push({ path, method: request.method });
		if (path === "/unrelated") return new Response("unrelated success");
		return new Response(status === 204 ? null : "private-error-body", {
			status, headers: status === 302 ? { location: "/unrelated" } : {},
		});
	} });
	try {
		const answer = await disarmSeveranceProxy({ ports: { proxy: server.port! - 1 } } as Values);
		expect(answer.ok).toBe(status === 200);
		expect(requests.some(request => request.path === "/unrelated")).toBe(false);
		expect(requests).toEqual((status === 200 ? severancePoints : severancePoints.slice(0, 1))
			.map(point => ({ path: `/disarm/${point}`, method: "POST" })));
		if (!answer.ok) expect(answer.message).not.toContain("private-error-body");
	} finally { await server.stop(true); }
});

test("between-scenario reset clears both actual proxy armings", async () => {
	const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("relayed") });
	const started = await startSeveranceProxy({ listenAddress: "127.0.0.1", listenPort: 0,
		upstreamAddress: "127.0.0.1", upstreamPort: upstream.port!, controlAddress: "127.0.0.1", controlPort: 0 });
	try {
		if (!started.ok) throw new Error(started.message);
		for (const point of severancePoints) {
			expect(started.handle.arm(point).ok).toBe(true);
			const response = await fetch(`http://127.0.0.1:${started.controlPort}/observed/${point}`);
			expect(response.status).toBe(200);
			await response.body?.cancel();
		}
		expect(await disarmSeveranceProxy({ ports: { proxy: started.controlPort - 1 } } as Values)).toEqual({ ok: true });
		for (const point of severancePoints) {
			const response = await fetch(`http://127.0.0.1:${started.controlPort}/observed/${point}`);
			expect(response.status).toBe(404);
			await response.body?.cancel();
		}
		const response = await fetch(`http://127.0.0.1:${started.port}/after-reset`, { signal: AbortSignal.timeout(2000) });
		expect(await response.text()).toBe("relayed");
	} finally {
		if (started.ok) await started.handle.stop();
		await upstream.stop(true);
	}
});
