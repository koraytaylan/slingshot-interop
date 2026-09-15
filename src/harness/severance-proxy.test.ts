// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { afterAll, describe, expect, test } from "bun:test";
import { createServer, connect, type Socket as NodeSocket } from "node:net";
import { isSeverancePoint, severancePoints, startSeveranceProxy } from "./severance-proxy.ts";

// These tests run over real sockets: a real upstream echo server, the real
// proxy forwarding through it, and a real client reading what comes back.
// The reset assertion is made against what the client's read actually
// reports, distinguished from an orderly close (an EOF that reads as zero).

const anyPort = 0;
const loopback = "127.0.0.1";

const openResources: { close: () => Promise<void> }[] = [];
afterAll(async () => {
	for (const resource of openResources) {
		await resource.close();
	}
});

// The upstream: echoes every byte back, the way a real server answers a
// request, so an unarmed relay can be proven untouched both ways.
async function startEcho(): Promise<{ port: number; close: () => Promise<void> }> {
	const server = createServer((socket) => {
		socket.on("data", (chunk: Buffer) => {
			socket.write(chunk);
		});
	});
	const close = () =>
		new Promise<void>((resolve, reject) => {
			server.close((error) => (error === undefined ? resolve() : reject(error)));
		});
	openResources.push({ close });
	return new Promise((resolve, reject) => {
		server.listen(anyPort, loopback, () => {
			const address = server.address();
			if (address !== null && typeof address === "object") {
				resolve({ port: address.port, close });
			} else {
				reject(new Error("the echo server did not report a port"));
			}
		});
		server.on("error", reject);
	});
}

async function startProxy(upstreamPort: number): Promise<{
	port: number;
	controlPort: number;
	arm: (point: string, options?: any) => { ok: boolean };
	stop: () => Promise<void>;
}> {
	const start = await startSeveranceProxy({
		listenAddress: loopback,
		listenPort: anyPort,
		upstreamAddress: loopback,
		upstreamPort,
		controlAddress: loopback,
		controlPort: anyPort,
	});
	if (!start.ok) {
		throw new Error(`the proxy did not start: ${start.message}`);
	}
	openResources.push({ close: start.handle.stop });
	return {
		port: start.port,
		controlPort: start.controlPort,
		arm: (point: string, options?: any) => {
			const outcome = start.handle.arm(point, options);
			return { ok: outcome.ok };
		},
		stop: () => start.handle.stop(),
	};
}

// One client connection to the proxy that sends one chunk and reports how
// its read ended: "reset" (the connection was severed with a reset), "eof"
// (an orderly close read to the end), or "data" (an answer arrived).
type ReadEnding = "reset" | "eof" | "data";

function connectAndSend(
	port: number,
	payload: Buffer,
	options: { readonly resolveOnData?: boolean } = {},
): Promise<{ ending: ReadEnding; data: Buffer }> {
	return new Promise((resolve, reject) => {
		const socket: NodeSocket = connect(port, loopback, () => {
			socket.write(payload);
		});
		let ending: ReadEnding = "eof";
		let data = Buffer.alloc(0);
		socket.on("data", (chunk: Buffer) => {
			ending = "data";
			data = Buffer.concat([data, chunk]);
			if (options.resolveOnData === true) {
				// The echo came back untouched: the unarmed property is proven and
				// the socket can go away without an orderly-close assertion.
				socket.destroy();
				resolve({ ending, data });
			}
		});
		socket.on("error", (error: Error & { code?: string }) => {
			// A read interrupted by a reset surfaces here as ECONNRESET: this is
			// the reset case, never an orderly close, which ends with no error.
			if (error.code === "ECONNRESET") {
				ending = "reset";
				resolve({ ending, data });
				socket.destroy();
				return;
			}
			reject(error);
		});
		socket.on("close", () => {
			resolve({ ending, data });
		});
	});
}

describe("severance points", () => {
	test("enumerates exactly the declared points", () => {
		expect([...severancePoints]).toEqual(["client", "agent"]);
	});

	test("accepts every declared point and nothing else", () => {
		for (const point of severancePoints) {
			expect(isSeverancePoint(point)).toBe(true);
		}
		expect(isSeverancePoint("mid-body")).toBe(false);
		expect(isSeverancePoint("")).toBe(false);
	});
});

describe("severance proxy over real sockets", () => {
	test("unarmed, bytes pass untouched both ways", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const payload = Buffer.from("request-untouched");
		const result = await connectAndSend(proxy.port, payload, { resolveOnData: true });
		expect(result.ending).toBe("data");
		expect(result.data).toEqual(payload);
	});

	test("armed immediately through the control channel, the client side observes a reset", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const armed = await fetch(`http://${loopback}:${proxy.controlPort}/arm/client`, { method: "POST" });
		expect(armed.status).toBe(200);
		const payload = Buffer.from("request-severed");
		const result = await connectAndSend(proxy.port, payload);
		expect(result.ending).toBe("reset");
		expect(result.ending).not.toBe("eof");
	});

	test("armed in response mode, request passes but answer is reset", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const armed = await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?mode=response`, { method: "POST" });
		expect(armed.status).toBe(200);
		const payload = Buffer.from("request-response-severed");
		const result = await connectAndSend(proxy.port, payload);
		// The request reaches the echo server, and the echo server's first byte back triggers the reset.
		expect(result.ending).toBe("reset");
	});

	test("threshold skips connections before severing", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const armed = await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?threshold=1`, { method: "POST" });
		expect(armed.status).toBe(200);
		const payload = Buffer.from("request-threshold");

		// First connection should pass untouched.
		const result1 = await connectAndSend(proxy.port, payload, { resolveOnData: true });
		expect(result1.ending).toBe("data");

		// Second connection should be reset.
		const result2 = await connectAndSend(proxy.port, payload);
		expect(result2.ending).toBe("reset");
	});

	test("the control channel refuses an unknown point", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const refused = await fetch(`http://${loopback}:${proxy.controlPort}/arm/mid-body`, { method: "POST" });
		expect(refused.status).toBe(400);
		expect(await refused.text()).toContain("mid-body");
	});
});