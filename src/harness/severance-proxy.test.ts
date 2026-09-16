// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { afterAll, describe, expect, test } from "bun:test";
import { createServer, connect, type Socket as NodeSocket } from "node:net";
import { PLANTED_FORGERY_TOKEN } from "./forgery-protection.ts";
import { isSeverancePoint, severancePoints, startSeveranceProxy } from "./severance-proxy.ts";

// These tests run over real sockets: a real upstream echo server, the real
// proxy forwarding through it, and a real client reading what comes back.
// The reset assertion is made against what the client's read actually
// reports, distinguished from an orderly close (an EOF that reads as zero).

const anyPort = 0;
const loopback = "127.0.0.1";

test("observation forwards every fragmented status prefix before recording its final status", async () => {
	const status = Buffer.from("HTTP/1.1 401 Unauthorized\r\n");
	const response = Buffer.concat([status, Buffer.from("Content-Length: 4\r\nConnection: close\r\n\r\nbody")]);
	let split = 1;
	let responder: NodeSocket | undefined;
	const upstream = createServer(socket => {
		socket.once("data", () => { responder = socket; socket.write(response.subarray(0, split)); });
	});
	await new Promise<void>(resolve => { upstream.listen(0, loopback, resolve); });
	const address = upstream.address();
	if (address === null || typeof address === "string") throw new Error("upstream did not bind");
	const started = await startSeveranceProxy({ listenAddress: loopback, listenPort: 0,
		upstreamAddress: loopback, upstreamPort: address.port, controlAddress: loopback, controlPort: 0 });
	if (!started.ok) throw new Error(started.message);
	const control = `http://${loopback}:${started.controlPort}`;
	try {
		for (; split < status.length; split++) {
			await fetch(`${control}/arm/client?mode=observe&request-line=${encodeURIComponent("POST /submit HTTP/1.1")}`, { method: "POST" });
			let delivered: () => void = () => {};
			const prefixDelivered = new Promise<void>(resolve => { delivered = resolve; });
			let seen = 0;
			const exchange = connectAndSend(started.port, Buffer.from("POST /submit HTTP/1.1\r\nHost: local\r\nContent-Length: 0\r\n\r\n"), {
				onConnected(socket) { socket.on("data", chunk => { seen += chunk.length; if (seen >= split) delivered(); }); },
			});
			await prefixDelivered;
			expect(await (await fetch(`${control}/observed/client`)).json()).toMatchObject({ matchedRequests: 1, statusCounts: {} });
			responder!.end(response.subarray(split));
			expect((await exchange).data.equals(response)).toBe(true);
			expect(await (await fetch(`${control}/observed/client`)).json()).toMatchObject({ matchedRequests: 1, statusCounts: { "401": 1 }, severed: 0 });
		}
	} finally {
		await started.handle.stop();
		responder?.destroy();
		await new Promise<void>((resolve, reject) => { upstream.close(error => error ? reject(error) : resolve()); });
	}
});

test("late responses cannot migrate into a new observation arming", async () => {
	let release: (response: Response) => void = () => { throw new Error("no request waiting"); };
	let arrived: () => void = () => {};
	const arrival = new Promise<void>(resolve => { arrived = resolve; });
	let first = true;
	const upstream = Bun.serve({ hostname: loopback, port: 0, fetch() {
		if (!first) return new Response("new", { status: 401 });
		first = false;
		return new Promise<Response>(resolve => { release = resolve; arrived(); });
	} });
	const started = await startSeveranceProxy({ listenAddress: loopback, listenPort: 0,
		upstreamAddress: loopback, upstreamPort: upstream.port!, controlAddress: loopback, controlPort: 0 });
	if (!started.ok) throw new Error(started.message);
	const control = `http://${loopback}:${started.controlPort}`;
	const arm = () => fetch(`${control}/arm/client?mode=observe&request-line=${encodeURIComponent("POST /submit HTTP/1.1")}`, { method: "POST" });
	try {
		await arm();
		const earlier = fetch(`http://${loopback}:${started.port}/submit`, { method: "POST", headers: { connection: "close" } });
		await arrival;
		const current = await arm();
		release(new Response("old", { status: 403 }));
		expect(await (await earlier).text()).toBe("old");
		expect(await (await fetch(`${control}/observed/client`)).json()).toMatchObject({ arm: current.headers.get("x-severance-arm"), matchedRequests: 0, statusCounts: {} });
		const later = await fetch(`http://${loopback}:${started.port}/submit`, { method: "POST", headers: { connection: "close" } });
		expect(await later.text()).toBe("new");
		expect(await (await fetch(`${control}/observed/client`)).json()).toMatchObject({ matchedRequests: 1, statusCounts: { "401": 1 } });
	} finally {
		release(new Response("cleanup"));
		await started.handle.stop();
		await upstream.stop(true);
	}
});

test("observe mode records only matched response statuses without modifying traffic", async () => {
	const received: string[] = [];
	const upstream = Bun.serve({ hostname: loopback, port: 0, async fetch(request) {
		received.push(await request.text());
		return new Response("unchanged response body", { status: new URL(request.url).pathname === "/submit" ? 401 : 200 });
	} });
	const started = await startSeveranceProxy({ listenAddress: loopback, listenPort: 0,
		upstreamAddress: loopback, upstreamPort: upstream.port!, controlAddress: loopback, controlPort: 0 });
	if (!started.ok) throw new Error(started.message);
	const control = `http://${loopback}:${started.controlPort}`;
	const target = "POST /submit HTTP/1.1";
	try {
		expect((await fetch(`${control}/arm/client?mode=observe`, { method: "POST" })).status).toBe(400);
		const arm = await fetch(`${control}/arm/client?mode=observe&request-line=${encodeURIComponent(target)}`, { method: "POST" });
		expect(arm.status).toBe(200);
		for (const path of ["/other", "/submit", "/submit"]) {
			const answer = await fetch(`http://${loopback}:${started.port}${path}`, { method: "POST", body: "request body",
				headers: { connection: "close", authorization: "Basic do-not-record" } });
			expect(answer.status).toBe(path === "/submit" ? 401 : 200);
			expect(await answer.text()).toBe("unchanged response body");
		}
		const observation = await (await fetch(`${control}/observed/client`)).json();
		expect(observation).toEqual({ arm: arm.headers.get("x-severance-arm"), mode: "observe", requestLine: target,
			severed: 0, suppressedResponseBytes: 0, matchedRequests: 2, statusCounts: { "401": 2 } });
		expect(JSON.stringify(observation)).not.toContain("do-not-record");
		expect(received).toEqual(["request body", "request body", "request body"]);
		await fetch(`${control}/arm/client?mode=observe&request-line=${encodeURIComponent(target)}`, { method: "POST" });
		expect(await (await fetch(`${control}/observed/client`)).json()).toMatchObject({ matchedRequests: 0, statusCounts: {} });
		await fetch(`${control}/disarm/client`, { method: "POST" });
		expect((await fetch(`${control}/observed/client`)).status).toBe(404);
	} finally {
		await started.handle.stop();
		await upstream.stop(true);
	}
});

test("a forwarding bind refusal releases the already-open control listener", async () => {
	const source = `
		import { startSeveranceProxy } from ${JSON.stringify(new URL("./severance-proxy.ts", import.meta.url).pathname)};
		const reserved = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
		const port = reserved.port;
		await reserved.stop(true);
		let outcome;
		try { outcome = await startSeveranceProxy({ listenAddress: "127.0.0.1", listenPort: port,
			controlAddress: "127.0.0.1", controlPort: port, upstreamAddress: "127.0.0.1", upstreamPort: 1 }); }
		catch { outcome = { threw: true }; }
		let reusable = false;
		try {
			const probe = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("") });
			reusable = true; await probe.stop(true);
		} catch {}
		console.log(JSON.stringify({ outcome, reusable }));
		process.exit(0);
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(exit).toBe(0);
	expect(stderr).toBe("");
	const result = JSON.parse(stdout);
	expect(result.outcome.reason).toBe("listen-failed");
	expect(result.reusable).toBe(true);
});

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
	let closed = false;
	const close = () => {
		if (closed) return Promise.resolve();
		closed = true;
		return new Promise<void>((resolve, reject) => {
			server.close((error) => (error === undefined ? resolve() : reject(error)));
		});
	};
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
	options: { readonly resolveOnData?: boolean; readonly expectedBytes?: number; readonly onConnected?: (socket: NodeSocket) => void } = {},
): Promise<{ ending: ReadEnding; data: Buffer }> {
	return new Promise((resolve, reject) => {
		const socket: NodeSocket = connect(port, loopback, () => {
			options.onConnected?.(socket);
			socket.write(payload);
		});
		let ending: ReadEnding = "eof";
		let data = Buffer.alloc(0);
		socket.on("data", (chunk: Buffer) => {
			ending = "data";
			data = Buffer.concat([data, chunk]);
			if (options.resolveOnData === true && data.length >= (options.expectedBytes ?? 0)) {
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
	test("target matching survives every request-line split including CRLF", async () => {
		const target = "POST /bin/slingshot/agent/submit HTTP/1.1";
		const request = Buffer.from(`${target}\r\nHost: fixture\r\n\r\n`);
		let continueRequest = () => {};
		const received: Buffer[] = [];
		const server = createServer(socket => {
			let bytes = Buffer.alloc(0);
			socket.on("data", (chunk: Buffer) => {
				bytes = Buffer.concat([bytes, chunk]);
				if (bytes.length < request.length) continueRequest();
				else { received.push(bytes); socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"); }
			});
		});
		await new Promise<void>(resolve => server.listen(0, loopback, resolve));
		openResources.push({ close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) });
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("fixture has no TCP port");
		const proxy = await startProxy(address.port);
		expect((await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?mode=response&request-line=${encodeURIComponent(target)}`, { method: "POST" })).status).toBe(200);
		for (let split = 1; split <= target.length + 1; split++) {
			const answer = await connectAndSend(proxy.port, request.subarray(0, split), { onConnected(socket) {
				let sent = false;
				continueRequest = () => { if (!sent) { sent = true; socket.write(request.subarray(split)); } };
			} });
			expect(answer.ending).toBe("reset");
			expect(answer.data.length).toBe(0);
			expect(received.at(-1)).toEqual(request);
		}
	});

	test("request-targeted severance skips unrelated traffic without counting connections", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const target = "POST /bin/slingshot/agent/submit HTTP/1.1";
		const armed = await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?mode=response&request-line=${encodeURIComponent(target)}`, { method: "POST" });
		expect(armed.status).toBe(200);
		for (const line of ["GET /system/console/status HTTP/1.1", "GET /bin/slingshot/agent/submit HTTP/1.1", "POST /bin/slingshot/agent/submit-extra HTTP/1.1"]) {
			const bytes = Buffer.from(`${line}\r\n\r\n`);
			expect((await connectAndSend(proxy.port, bytes, { resolveOnData: true })).data).toEqual(bytes);
		}
		const cut = await connectAndSend(proxy.port, Buffer.from(`${target}\r\n\r\n`));
		expect(cut.ending).toBe("reset");
		expect(cut.data.length).toBe(0);
		const observed = await fetch(`http://${loopback}:${proxy.controlPort}/observed/client`);
		expect(await observed.json()).toMatchObject({ requestLine: target, severed: 1 });
	});

	test("target bounds fail closed and matching text in a body or oversized line is not a request", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const target = "POST /bin/slingshot/agent/submit HTTP/1.1";
		const arm = (line: string, suffix = "") => fetch(`http://${loopback}:${proxy.controlPort}/arm/client?mode=response&request-line=${encodeURIComponent(line)}${suffix}`, { method: "POST" });
		const atLimit = `POST /${"a".repeat(1024 - "POST / HTTP/1.1".length)} HTTP/1.1`;
		expect((await arm(atLimit)).status).toBe(200);
		for (const line of [atLimit.replace("POST /", "POST /a"), target + "\r\nInjected: yes", "PRI * HTTP/2.0", "", "POST /jobs?secret=value HTTP/1.1"]) {
			expect((await arm(line)).status).toBe(400);
		}
		expect((await arm(target, "&threshold=1")).status).toBe(400);
		expect((await arm(target)).status).toBe(200);
		for (const written of [`GET /other HTTP/1.1\r\n\r\n${target}\r\n`, `${"x".repeat(8192)}${target}\r\n`]) {
			const bytes = Buffer.from(written);
			const answer = await connectAndSend(proxy.port, bytes, { resolveOnData: true, expectedBytes: bytes.length });
			expect(answer.data).toEqual(bytes);
		}
		expect(await (await fetch(`http://${loopback}:${proxy.controlPort}/observed/client`)).json()).toMatchObject({ severed: 0 });
	});

	test("request targeting admits a dotted token route", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const target = "GET /libs/granite/csrf/token.json HTTP/1.1";
		try {
			expect((await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?mode=observe&request-line=${encodeURIComponent(target)}`, { method: "POST" })).status).toBe(200);
		} finally {
			await proxy.stop();
			await echo.close();
		}
	});

	test("invalid control options are refused without arming any relay", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		for (const query of ["mode=typo", "mode=", "threshold=-1", "threshold=NaN", "threshold=Infinity",
			"threshold=1.5", "threshold=9007199254740992", "threshold=", "threshold=0x10",
			"threshold=0&threshold=1", "mode=response&mode=immediate", "typo=1"]) {
			const response = await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?${query}`, { method: "POST" });
			expect(response.status, query).toBe(400);
		}
		for (const threshold of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
			expect(proxy.arm("client", { threshold }).ok).toBe(false);
		}
		expect(proxy.arm("client", { mode: "typo" }).ok).toBe(false);
		const payload = Buffer.from("invalid-options-did-not-arm");
		const result = await connectAndSend(proxy.port, payload, { resolveOnData: true });
		expect(result.data).toEqual(payload);
	});
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
		const armIdentifier = armed.headers.get("x-severance-arm");
		expect(armIdentifier).not.toBeNull();
		const before = await fetch(`http://${loopback}:${proxy.controlPort}/observed/client`);
		expect(await before.json()).toEqual({ arm: armIdentifier, mode: "response", severed: 0, suppressedResponseBytes: 0 });
		const payload = Buffer.from("request-response-severed");
		const result = await connectAndSend(proxy.port, payload);
		const observed = await fetch(`http://${loopback}:${proxy.controlPort}/observed/client`);
		expect(await observed.json()).toEqual({ arm: armIdentifier, mode: "response", severed: 1, suppressedResponseBytes: payload.length });
		const rearmed = await fetch(`http://${loopback}:${proxy.controlPort}/arm/client?mode=response`, { method: "POST" });
		expect(rearmed.headers.get("x-severance-arm")).not.toBe(armIdentifier);
		const fresh = await fetch(`http://${loopback}:${proxy.controlPort}/observed/client`);
		expect((await fresh.json() as { severed: number }).severed).toBe(0);
		expect((await fetch(`http://${loopback}:${proxy.controlPort}/disarm/client`, { method: "POST" })).status).toBe(200);
		expect((await fetch(`http://${loopback}:${proxy.controlPort}/observed/client`)).status).toBe(404);
		// The request reaches the echo server, and the echo server's first byte back triggers the reset.
		expect(result.ending).toBe("reset");
		expect(result.data.byteLength).toBe(0);
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

	test("a later connection cannot make an earlier skipped response eligible for severance", async () => {
		let first: NodeSocket | undefined;
		let receivedFirst!: () => void;
		const firstReady = new Promise<void>(resolve => { receivedFirst = resolve; });
		const upstream = createServer(socket => socket.on("data", (data: Buffer) => {
			if (data.toString() === "first") {
				first = socket;
				receivedFirst();
			} else {
				first!.write("first-response");
				socket.write("second-response");
			}
		}));
		await new Promise<void>(resolve => upstream.listen(0, loopback, resolve));
		openResources.push({ close: () => new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve())) });
		const address = upstream.address();
		if (address === null || typeof address === "string") throw new Error("no upstream port");
		const proxy = await startProxy(address.port);
		proxy.arm("client", { mode: "response", threshold: 1 });
		const earlier = connectAndSend(proxy.port, Buffer.from("first"), { resolveOnData: true });
		await firstReady;
		const later = connectAndSend(proxy.port, Buffer.from("second"));
		const [untouched, severed] = await Promise.all([earlier, later]);
		expect(untouched.ending).toBe("data");
		expect(untouched.data.toString()).toBe("first-response");
		expect(severed.ending).toBe("reset");
		expect(severed.data.byteLength).toBe(0);
	});

	test("the control channel refuses an unknown point", async () => {
		const echo = await startEcho();
		const proxy = await startProxy(echo.port);
		const refused = await fetch(`http://${loopback}:${proxy.controlPort}/arm/mid-body`, { method: "POST" });
		expect(refused.status).toBe(400);
		expect(await refused.text()).toContain("mid-body");
	});
});

describe("forgery protection on agent posts", () => {
	test("a state-changing agent POST without the planted token is refused and never forwarded", async () => {
		let forwarded = 0;
		const upstream = createServer((socket) => {
			socket.on("data", () => {
				forwarded++;
				socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
			});
		});
		await new Promise<void>((resolve) => {
			upstream.listen(0, loopback, resolve);
		});
		const address = upstream.address();
		if (address === null || typeof address === "string") throw new Error("upstream did not bind");
		const started = await startSeveranceProxy({
			listenAddress: loopback,
			listenPort: anyPort,
			upstreamAddress: loopback,
			upstreamPort: address.port,
			controlAddress: loopback,
			controlPort: anyPort,
			forgeryToken: PLANTED_FORGERY_TOKEN,
		});
		if (!started.ok) throw new Error(started.message);
		try {
			const missing = await fetch(`http://${loopback}:${started.port}/bin/slingshot/agent/submit`, {
				method: "POST",
				headers: { connection: "close", referer: "http://severance-proxy/" },
			});
			expect(missing.status).toBe(403);
			expect(forwarded).toBe(0);
			const accepted = await fetch(`http://${loopback}:${started.port}/bin/slingshot/agent/submit`, {
				method: "POST",
				headers: {
					connection: "close",
					"csrf-token": PLANTED_FORGERY_TOKEN,
					referer: "http://severance-proxy/",
				},
			});
			expect(accepted.status).toBe(200);
			expect(forwarded).toBe(1);
		} finally {
			await started.handle.stop();
			await new Promise<void>((resolve, reject) => {
				upstream.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});

	test("a capabilities GET is forwarded without a token", async () => {
		const upstream = Bun.serve({
			hostname: loopback,
			port: 0,
			fetch() {
				return new Response("ok", { status: 200 });
			},
		});
		const started = await startSeveranceProxy({
			listenAddress: loopback,
			listenPort: anyPort,
			upstreamAddress: loopback,
			upstreamPort: upstream.port!,
			controlAddress: loopback,
			controlPort: anyPort,
			forgeryToken: PLANTED_FORGERY_TOKEN,
		});
		if (!started.ok) throw new Error(started.message);
		try {
			const answered = await fetch(`http://${loopback}:${started.port}/bin/slingshot/agent/capabilities`, {
				headers: { connection: "close" },
			});
			expect(answered.status).toBe(200);
			expect(await answered.text()).toBe("ok");
		} finally {
			await started.handle.stop();
			upstream.stop(true);
		}
	});
});
