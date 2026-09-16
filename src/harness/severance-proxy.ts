// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The severance proxy: a forwarding TCP proxy with a control listener. It
// forwards bytes untouched in both directions until it is armed at a named
// severance point; when armed, it abruptly terminates the matched side.
// Real-socket tests require a reset (RST), not an orderly end of stream.
// The severance points are enumerated in the values the caller passes before
// any injector is written, and the control channel refuses an unknown point.

import type { Server, Socket, TCPSocketListener } from "bun";
import { HttpResponseStatus } from "./http-response-status.ts";
import { forgeryRefusalHead, inspectAgentPostForgery } from "./forgery-protection.ts";

// The points at which the proxy can sever, enumerated before the injector is
// written: "client" severs the client-facing half of a relayed connection,
// "agent" the server-facing half. Anything else is refused by name, and the
// enumeration here is the whole world of points — a caller cannot arm a
// point this file never declared.
export const severancePoints = ["client", "agent"] as const;
export type SeverancePoint = (typeof severancePoints)[number];

export function isSeverancePoint(value: string): value is SeverancePoint {
	return (severancePoints as readonly string[]).includes(value);
}

export type SeveranceProxyOptions = {
	// The address and port the forwarding listener binds: clients connect
	// here, and every byte is relayed to the declared upstream.
	readonly listenAddress: string;
	readonly listenPort: number;
	// The address and port of the upstream the proxy forwards to.
	readonly upstreamAddress: string;
	readonly upstreamPort: number;
	// The address and port the control listener binds: arming a point is a
	// single request over this listener, never a filesystem signal.
	readonly controlAddress: string;
	readonly controlPort: number;
	// When set, state-changing POSTs under /bin/slingshot/agent must carry
	// this CSRF-Token and a Referer. The Sling starter does not validate
	// either; leaving this unset restores byte-for-byte forwarding.
	readonly forgeryToken?: string;
};

export type SeveranceMode = "immediate" | "response" | "observe";

export type SeveranceProxyHandle = {
	// Arms the named point directly, the programmatic route the control
	// channel itself goes through. Refuses an unknown point by name.
	arm(point: string, options?: { readonly threshold?: number; readonly mode?: SeveranceMode }): { ok: true; armed: SeverancePoint } | { ok: false; reason: "unknown-point" | "invalid-options"; point: string };
	// Disarms the named point, so connections opened afterwards are relayed
	// untouched again. Arming is a state the proxy holds rather than a one-shot
	// act, and every scenario's profile points at this proxy, so a point left
	// armed severs the exchanges of every scenario that runs after the one that
	// armed it.
	disarm(point: string): { ok: true; disarmed: SeverancePoint } | { ok: false; reason: "unknown-point"; point: string };
	stop(): Promise<void>;
};

export type SeveranceProxyStart =
	| {
			readonly ok: true;
			readonly handle: SeveranceProxyHandle;
			// The ports actually bound, discovered after a caller binds port 0.
			readonly port: number;
			readonly controlPort: number;
	  }
	| { readonly ok: false; readonly reason: "listen-failed"; readonly message: string };

// A relay is one client connection and its one upstream socket, kept together
// so an armed point severs exactly the matched half and never touches the
// other direction's relayed bytes.
type Relay = {
	readonly client: Socket;
	readonly agent: Socket;
	readonly selected: Map<SeverancePoint, ArmedConfig>;
	requestPrefix: Buffer;
	requestLine: string | undefined;
	forgeryBuffer: Buffer;
	forgeryDecided: boolean;
	readonly responseStatus: HttpResponseStatus;
	statusCounted: boolean;
	readonly observations: ReadonlySet<ArmedConfig>;
};

type ArmedConfig = { readonly arm: string; readonly mode: SeveranceMode; readonly threshold: number; readonly requestLine?: string; count: number; severed: number; suppressedResponseBytes: number; readonly statusCounts: Record<string, number> };

function armConfiguration(mode: SeveranceMode, threshold: number): ArmedConfig {
	return { arm: crypto.randomUUID(), mode, threshold, count: 0, severed: 0, suppressedResponseBytes: 0, statusCounts: {} };
}

function validArmOptions(mode: unknown, threshold: number): mode is SeveranceMode {
	return (mode === "immediate" || mode === "response" || mode === "observe") && Number.isSafeInteger(threshold) && threshold >= 0;
}

export async function startSeveranceProxy(options: SeveranceProxyOptions): Promise<SeveranceProxyStart> {
	const armed = new Map<SeverancePoint, ArmedConfig>();
	const relays = new Set<Relay>();
	const pending = new Map<Socket, Buffer[]>();

	// Never inject synthetic bytes or forward the answer before terminating.
	function severRelay(relay: Relay, point: SeverancePoint, suppressedResponseBytes = 0): void {
		const config = relay.selected.get(point);
		if (config === undefined) return;
		relay.selected.delete(point);
		config.severed++;
		config.suppressedResponseBytes += suppressedResponseBytes;
		const target = point === "client" ? relay.client : relay.agent;
		target.terminate();
	}

	function selectRelay(relay: Relay, point: SeverancePoint, config: ArmedConfig): void {
		if (config.requestLine !== undefined && relay.requestLine !== config.requestLine) return;
		config.count++;
		if (config.count <= config.threshold) return;
		relay.selected.set(point, config);
		if (config.mode === "immediate") severRelay(relay, point);
	}

	// The cleartext client opens one HTTP/1.1 request per connection with
	// Connection: close. Inspect only its bounded first line; never scan bodies
	// for a matching string, reinterpret HTTP/2, or retain credential headers.
	function observeRequest(relay: Relay, chunk: Buffer): void {
		if (relay.requestLine !== undefined) return;
		const maximumRequestLineBytes = 8192;
		relay.requestPrefix = Buffer.concat([relay.requestPrefix, chunk.subarray(0, maximumRequestLineBytes - relay.requestPrefix.length)]);
		const end = relay.requestPrefix.indexOf("\r\n");
		if (end < 0 && relay.requestPrefix.length < maximumRequestLineBytes) return;
		relay.requestLine = end < 0 ? "" : relay.requestPrefix.subarray(0, end).toString("utf8");
		relay.requestPrefix = Buffer.alloc(0);
		for (const [point, config] of armed) {
			if (config.mode === "observe" && !relay.observations.has(config)) continue;
			if (config.requestLine !== undefined) selectRelay(relay, point, config);
		}
	}

	const forgeryToken = options.forgeryToken;
	function refuseForgery(relay: Relay): void {
		relay.client.write(forgeryRefusalHead);
		relay.client.end();
		relay.agent.terminate();
	}

	function handleClientBytes(relay: Relay, chunk: Buffer): void {
		observeRequest(relay, chunk);
		if (forgeryToken === undefined || relay.forgeryDecided) {
			relay.agent.write(chunk);
			return;
		}
		relay.forgeryBuffer = Buffer.concat([relay.forgeryBuffer, chunk]);
		const inspection = inspectAgentPostForgery(relay.forgeryBuffer, forgeryToken);
		if (inspection.kind === "incomplete") {
			return;
		}
		relay.forgeryDecided = true;
		if (inspection.kind === "refused") {
			refuseForgery(relay);
			return;
		}
		relay.agent.write(relay.forgeryBuffer);
		relay.forgeryBuffer = Buffer.alloc(0);
	}

	let control: Server<undefined>;
	try {
	control = Bun.serve({
		hostname: options.controlAddress,
		port: options.controlPort,
		fetch: async (request) => {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname.startsWith("/observed/")) {
				const point = url.pathname.slice("/observed/".length);
				const config = isSeverancePoint(point) ? armed.get(point) : undefined;
				if (config === undefined) return new Response("no active arming\n", { status: 404 });
				return Response.json({ arm: config.arm, mode: config.mode, requestLine: config.requestLine, severed: config.severed,
					suppressedResponseBytes: config.suppressedResponseBytes,
					...(config.mode === "observe" ? { matchedRequests: config.count, statusCounts: config.statusCounts } : {}) });
			}
			if (request.method !== "POST") {
				return new Response("control: POST /arm/<point> or /disarm/<point>\n", { status: 404 });
			}
			const arming = url.pathname.startsWith("/arm/");
			const disarming = url.pathname.startsWith("/disarm/");
			if (!arming && !disarming) {
				return new Response("control: POST /arm/<point> or /disarm/<point>\n", { status: 404 });
			}
			const point = decodeURIComponent(url.pathname.slice((arming ? "/arm/" : "/disarm/").length));
			if (!isSeverancePoint(point)) {
				// An unknown point is a refusal naming what was asked for, never a
				// quiet no-op.
				return new Response(`unknown severance point: ${point}\n`, { status: 400 });
			}
			if (disarming) {
				armed.delete(point);
				return new Response(`disarmed: ${point}\n`, { status: 200 });
			}

			// Parse options from query string for the control channel
			const params = url.searchParams;
			const writtenThreshold = params.get("threshold") ?? "0";
			const threshold = Number(writtenThreshold);
			const mode = params.get("mode") ?? "immediate";
			const requestLine = params.get("request-line");
			if ([...params.keys()].some(key => !["mode", "threshold", "request-line"].includes(key) || params.getAll(key).length !== 1)
				|| (requestLine !== null && (!["response", "observe"].includes(mode) || threshold !== 0 || !/^(GET|POST) \/[A-Za-z0-9._/-]+ HTTP\/1\.1$/.test(requestLine) || requestLine.length > 1024))
				|| (mode === "observe" && requestLine === null)
				|| !/^(0|[1-9][0-9]*)$/.test(writtenThreshold) || !validArmOptions(mode, threshold)) {
				return new Response("invalid severance options: require a declared mode and nonnegative safe-integer threshold\n", { status: 400 });
			}

			armed.set(point, { ...armConfiguration(mode, threshold), ...(requestLine === null ? {} : { requestLine }) });
			for (const relay of relays) {
				// Observation belongs only to requests starting after this arming.
				if (mode !== "observe") selectRelay(relay, point, armed.get(point)!);
			}
			return new Response(`armed: ${point} (mode=${mode}, threshold=${threshold})\n`, { status: 200,
				headers: { "x-severance-arm": armed.get(point)!.arm } });
		},
	});

	} catch (failure) {
		return { ok: false, reason: "listen-failed", message: `control listener: ${failure instanceof Error ? failure.message : String(failure)}` };
	}
	let forwarding: TCPSocketListener<undefined>;
	try {
	forwarding = Bun.listen({
		hostname: options.listenAddress,
		port: options.listenPort,
		socket: {
			open(client: Socket<undefined>): void {
				const observations = new Set([...armed.values()].filter(config => config.mode === "observe"));
				// The client may send before the upstream connect resolves; those
				// bytes are held per client and flushed to the agent when the
				// relay is ready, so nothing between the client and the proxy is
				// ever lost or reordered.
				pending.set(client, []);
				Bun.connect({
					hostname: options.upstreamAddress,
					port: options.upstreamPort,
					socket: {
						data(agent: Socket<undefined>, chunk: Buffer): void {
							for (const relay of relays) {
								if (relay.agent !== agent || relay.statusCounted) continue;
								const status = relay.responseStatus.read(chunk);
								if (status === undefined) continue;
								relay.statusCounted = true;
								for (const [point, config] of relay.selected) {
									if (config.mode === "observe" && armed.get(point) === config) {
										config.statusCounts[String(status)] = (config.statusCounts[String(status)] ?? 0) + 1;
									}
								}
							}
							// If armed in response mode, sever the relay now that the
							// agent has started answering, before any answer bytes escape.
							for (const [point, config] of armed) {
								if (config.mode === "response") {
									// We need the relay object to sever. We'll find it in relays.
									for (const relay of relays) {
										if (relay.agent === agent && relay.selected.get(point) === config) {
											severRelay(relay, point, chunk.byteLength);
											return;
										}
									}
								}
							}
							client.write(chunk);
						},
						close(): void {
							client.end();
						},
						error(): void {
							client.terminate();
						},
					},
				})
					.then((agent) => {
						const relay: Relay = { client, agent, selected: new Map(), requestPrefix: Buffer.alloc(0), requestLine: undefined,
							forgeryBuffer: Buffer.alloc(0), forgeryDecided: forgeryToken === undefined,
							responseStatus: new HttpResponseStatus(), statusCounted: false, observations };
						relays.add(relay);
						for (const [point, config] of armed) selectRelay(relay, point, config);
						const held = pending.get(client);
						pending.delete(client);
						if (held !== undefined) {
							for (const chunk of held) {
								handleClientBytes(relay, chunk);
							}
						}
					})
					.catch(() => {
						pending.delete(client);
						client.terminate();
					});
			},
			data(client: Socket<undefined>, chunk: Buffer): void {
				for (const relay of relays) {
					if (relay.client === client) {
						handleClientBytes(relay, chunk);
						return;
					}
				}
				const held = pending.get(client);
				if (held !== undefined) {
					held.push(chunk);
				}
			},
			close(client: Socket<undefined>): void {
				pending.delete(client);
				for (const relay of relays) {
					if (relay.client === client) {
						relay.agent.end();
						relays.delete(relay);
						return;
					}
				}
			},
			error(client: Socket<undefined>): void {
				pending.delete(client);
				for (const relay of relays) {
					if (relay.client === client) {
						relay.agent.terminate();
						relays.delete(relay);
						return;
					}
				}
			},
		},
	});

	} catch (failure) {
		await control.stop(true);
		return { ok: false, reason: "listen-failed", message: `forwarding listener: ${failure instanceof Error ? failure.message : String(failure)}` };
	}
	const handle: SeveranceProxyHandle = {
		arm(point, options) {
			if (!isSeverancePoint(point)) {
				return { ok: false as const, reason: "unknown-point" as const, point };
			}
			const mode = options?.mode ?? "immediate";
			const threshold = options?.threshold ?? 0;
			// Observation requires an explicit HTTP request target via control.
			if (!validArmOptions(mode, threshold) || mode === "observe") return { ok: false, reason: "invalid-options", point };
			armed.set(point, armConfiguration(mode, threshold));
			for (const relay of relays) {
				selectRelay(relay, point, armed.get(point)!);
			}
			return { ok: true as const, armed: point };
		},
		disarm(point) {
			if (!isSeverancePoint(point)) {
				return { ok: false as const, reason: "unknown-point" as const, point };
			}
			armed.delete(point);
			return { ok: true as const, disarmed: point };
		},
		stop: async () => {
			for (const relay of relays) {
				relay.agent.terminate();
				relay.client.terminate();
			}
			relays.clear();
			await Promise.all([forwarding.stop(true), control.stop(true)]);
		},
	};

	return {
		ok: true,
		handle,
		port: forwarding.port,
		controlPort: control.port ?? (() => { throw new Error("the control listener reported no port"); })(),
	};
}

// The container entrypoint: the same proxy, configured entirely through the
// environment the harness's container assembly passes, listening on the
// declared forwarding and control ports and forwarding to the declared
// upstream. It starts and stays up; readiness is observed by the caller.
if (import.meta.main) {
	const required = [
		"SEVERANCE_LISTEN_PORT",
		"SEVERANCE_CONTROL_PORT",
		"SEVERANCE_UPSTREAM_HOST",
		"SEVERANCE_UPSTREAM_PORT",
	] as const;
	const forgeryToken = process.env["SEVERANCE_FORGERY_TOKEN"];
	const values = new Map<string, string>();
	for (const name of required) {
		const value = process.env[name];
		if (value === undefined || value === "") {
			console.error(`severance-proxy: ${name} is not set; the container cannot start without it`);
			process.exit(1);
		}
		values.set(name, value);
	}
	const start = await startSeveranceProxy({
		listenAddress: "0.0.0.0",
		listenPort: Number(values.get("SEVERANCE_LISTEN_PORT")),
		upstreamAddress: values.get("SEVERANCE_UPSTREAM_HOST") as string,
		upstreamPort: Number(values.get("SEVERANCE_UPSTREAM_PORT")),
		controlAddress: "0.0.0.0",
		controlPort: Number(values.get("SEVERANCE_CONTROL_PORT")),
		...(forgeryToken !== undefined && forgeryToken !== "" ? { forgeryToken } : {}),
	});
	if (!start.ok) {
		console.error(`severance-proxy: ${start.message}`);
		process.exit(1);
	}
	console.log(`severance-proxy listening on ${start.port}, control on ${start.controlPort}`);
}
