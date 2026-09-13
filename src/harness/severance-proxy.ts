// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The severance proxy: a forwarding TCP proxy with a control listener. It
// forwards bytes untouched in both directions until it is armed at a named
// severance point; when armed, it severs the matched side with a reset — a
// close with unread pending data, so the peer observes a reset (RST) rather
// than the orderly close that would let it read to the end of the stream.
// The severance points are enumerated in the values the caller passes before
// any injector is written, and the control channel refuses an unknown point.

import type { Server, Socket } from "bun";

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
};

export type SeveranceProxyHandle = {
	// Arms the named point directly, the programmatic route the control
	// channel itself goes through. Refuses an unknown point by name.
	arm(point: string): { ok: true; armed: SeverancePoint } | { ok: false; reason: "unknown-point"; point: string };
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
};

export async function startSeveranceProxy(options: SeveranceProxyOptions): Promise<SeveranceProxyStart> {
	const armed = new Set<SeverancePoint>();
	const relays = new Set<Relay>();
	const pending = new Map<Socket, Buffer[]>();

	// The severance itself: leave data unread pending on the socket and close
	// it abruptly, so the kernel answers the peer with a reset rather than a
	// FIN. A graceful shutdown would let the peer read to the end of the
	// stream — exactly the case this proxy exists to exclude.
	function severRelay(relay: Relay, point: SeverancePoint): void {
		const target = point === "client" ? relay.client : relay.agent;
		try {
			// The unread pending byte is what distinguishes this close from an
			// orderly one: the peer's read ends in a reset, not an EOF.
			target.write("\x00");
			target.flush();
		} catch {
			// The half already went away: there is nothing left to reset.
		}
		target.terminate();
	}

	const control: Server<undefined> = Bun.serve({
		hostname: options.controlAddress,
		port: options.controlPort,
		fetch: async (request) => {
			const url = new URL(request.url);
			if (request.method !== "POST" || !url.pathname.startsWith("/arm/")) {
				return new Response("control: POST /arm/<point>\n", { status: 404 });
			}
			const point = decodeURIComponent(url.pathname.slice("/arm/".length));
			if (!isSeverancePoint(point)) {
				// An unknown point is a refusal naming what was asked for, never a
				// quiet no-op.
				return new Response(`unknown severance point: ${point}\n`, { status: 400 });
			}
			armed.add(point);
			for (const relay of relays) {
				severRelay(relay, point);
			}
			return new Response(`armed: ${point}\n`, { status: 200 });
		},
	});

	const forwarding = Bun.listen({
		hostname: options.listenAddress,
		port: options.listenPort,
		socket: {
			open(client: Socket<undefined>): void {
				// The client may send before the upstream connect resolves; those
				// bytes are held per client and flushed to the agent when the
				// relay is ready, so nothing between the client and the proxy is
				// ever lost or reordered.
				pending.set(client, []);
				Bun.connect({
					hostname: options.upstreamAddress,
					port: options.upstreamPort,
					socket: {
						data(_: Socket<undefined>, chunk: Buffer): void {
							// Forwarded untouched: no inspection, no rewriting.
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
						const relay: Relay = { client, agent };
						relays.add(relay);
						const held = pending.get(client);
						pending.delete(client);
						if (held !== undefined) {
							for (const chunk of held) {
								agent.write(chunk);
							}
						}
						for (const point of armed) {
							severRelay(relay, point);
						}
					})
					.catch(() => {
						pending.delete(client);
						client.terminate();
					});
			},
			data(client: Socket<undefined>, chunk: Buffer): void {
				// Forwarded untouched in the request direction.
				for (const relay of relays) {
					if (relay.client === client) {
						relay.agent.write(chunk);
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

	const handle: SeveranceProxyHandle = {
		arm(point: string) {
			if (!isSeverancePoint(point)) {
				return { ok: false as const, reason: "unknown-point" as const, point };
			}
			armed.add(point);
			for (const relay of relays) {
				severRelay(relay, point);
			}
			return { ok: true as const, armed: point };
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
		// The control server's port is undefined only for a Unix-socket server;
		// a TCP control listener always reports the port it bound.
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
	});
	if (!start.ok) {
		console.error(`severance-proxy: ${start.message}`);
		process.exit(1);
	}
	console.log(`severance-proxy listening on ${start.port}, control on ${start.controlPort}`);
}