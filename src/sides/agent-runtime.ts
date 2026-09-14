// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The author half's runtime: the built tier-sling image, started with the
// harness label on the run's network and one published port, the resolved
// Sling-only bundle installed through the platform's own console route, and
// the active state awaited against absolute deadlines. Every number comes
// from the values loader — nothing here sleeps for a fixed span or picks its
// own bound.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
	startContainer,
	type ContainerHandle,
	type ContainerRefusal,
} from "../harness/container.ts";
import type { Values } from "../harness/values.ts";
import { AUTHOR_RUNTIME_NAME } from "./client-configuration.ts";

// The image the preparation command built and recorded, verified offline by
// support/interop-images.toml. The caller passes the verified identifier.
export type StartSlingRuntimeOptions = {
	readonly image: string;
	readonly values: Values;
	readonly network: string;
	readonly labelValue: string;
	// The absolute instant by which the console must answer.
	readonly consoleDeadline: Date;
	// The absolute instant by which the installed bundle must be active.
	readonly activeDeadline: Date;
	// The resolved Sling-only bundle jar, read and installed as its own bytes.
	readonly bundleJarPath: string;
	// The basic-auth credentials the console route accepts, spelled by the
	// caller that owns them.
	readonly consoleUsername: string;
	readonly consolePassword: string;
	// The console's base URL. It defaults to the published author port on the
	// host, which is the only base a real run uses; the stub-server test names
	// its own server instead of a port.
	readonly consoleBase?: string;
	readonly captureDirectory?: string;
	readonly executable?: string;
};

export type SlingRuntimeHandle = {
	readonly ok: true;
	readonly handle: ContainerHandle;
	readonly port: number;
};

export type SlingRuntimeRefusal =
	| {
			readonly ok: false;
			readonly reason: "START_FAILED";
			readonly message: string;
			readonly stdoutTail: string;
			readonly stderrTail: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "NEVER_BECAME_READY";
			readonly message: string;
			readonly logPath: string;
			readonly logTail: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "NEVER_BECAME_READY";
			readonly message: string;
	  }
	| {
			readonly ok: false;
			readonly reason: "INSTALL_FAILED";
			readonly message: string;
	  };

export type StartSlingRuntimeOutcome = SlingRuntimeHandle | SlingRuntimeRefusal;

export function isSlingRuntimeRefusal(outcome: StartSlingRuntimeOutcome): outcome is SlingRuntimeRefusal {
	return outcome.ok === false;
}

export type InstallOutcome = { readonly ok: true } | {
	readonly ok: false;
	readonly reason: "INSTALL_FAILED";
	readonly message: string;
};

export type AwaitActiveOutcome = { readonly ok: true } | {
	readonly ok: false;
	readonly reason: "NEVER_BECAME_READY";
	readonly message: string;
};

// The two OSGi configurations the agent's own interop tier installs before the
// bundle: the repoinit initializer creating the slingshot-agent-state system
// user and its /var/slingshot-agent tree with its ACLs, and the service-user
// mapping binding the bundle's subservices to that user. Both are read from
// the agent repository's own ui.config content, so the harness carries no
// second copy of their bytes. Without them every state-backed route answers
// 500: the service login the bundle asks for maps to no system user.
export type ConfigureStateOutcome = { readonly ok: true } | {
	readonly ok: false;
	readonly reason: "INSTALL_FAILED";
	readonly message: string;
};

async function installStateConfiguration(
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<ConfigureStateOutcome> {
	const base = options.consoleBase ?? `http://127.0.0.1:${port}`;
	const auth = Buffer.from(
		`${options.consoleUsername}:${options.consolePassword}`,
		"utf8",
	).toString("base64");
	const headers = { authorization: `Basic ${auth}` };
	const configsRoot = join(
		agentRepositoryRoot(),
		"ui.config/src/main/content/jcr_root/apps/slingshot-agent/osgiconfig/config",
	);
	const names = [
		"org.apache.sling.jcr.repoinit.RepositoryInitializer~slingshot-agent.cfg.json",
		"org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~slingshot-agent.cfg.json",
	];
	// The configuration tree must exist before the configs are handed over:
	// the console's own install route refuses an absent parent.
	for (const folder of [
		"/apps/slingshot-agent",
		"/apps/slingshot-agent/osgiconfig",
		"/apps/slingshot-agent/osgiconfig/config",
	]) {
		const made = await fetch(`${base}${folder}`, {
			method: "POST",
			headers,
			body: new URLSearchParams({ "jcr:primaryType": "sling:Folder" }),
		});
		if (made.status >= 400 && made.status !== 409 && made.status !== 201) {
			return {
				ok: false,
				reason: "INSTALL_FAILED",
				message: `The author runtime refused the configuration folder ${folder} with ${made.status}.`,
			};
		}
	}
	for (const name of names) {
		const bytes = await readFile(join(configsRoot, name));
		const form = new FormData();
		form.append("*", new Blob([new Uint8Array(bytes)]), name);
		const handed = await fetch(`${base}/apps/slingshot-agent/osgiconfig/config/`, {
			method: "POST",
			headers,
			body: form,
		});
		if (handed.status >= 400) {
			return {
				ok: false,
				reason: "INSTALL_FAILED",
				message: `The author runtime refused service configuration ${name} with ${handed.status}.`,
			};
		}
	}
	return { ok: true };
}

// The agent repository this run's bundle jar was built from. The agent side's
// pinning names that repository, so the configuration bytes are read from it
// rather than restated here.
function agentRepositoryRoot(): string {
	return process.env.SLINGSHOT_AGENT_ROOT ?? "/home/koraytaylan/Workspace/slingshot/slingshot-agent";
}

// The console's bundle listing: every bundle must report Active. The listing
// names each bundle's state, so a refusal can say what the bundle actually
// became instead of a bare timeout.
async function listBundleStates(
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<Map<string, string> | null> {
	const base = options.consoleBase ?? `http://127.0.0.1:${port}`;
	const auth = Buffer.from(
		`${options.consoleUsername}:${options.consolePassword}`,
		"utf8",
	).toString("base64");
	try {
		const response = await fetch(`${base}/system/console/bundles.json`, {
			headers: { authorization: `Basic ${auth}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			return null;
		}
		const listing = (await response.json()) as {
			data: { name: string; symbolicName: string | null; state: string }[];
		};
		const states = new Map<string, string>();
		for (const bundle of listing.data) {
			// The wait looks a bundle up by the symbolic name its manifest
			// carries, so the map is keyed by symbolicName — the console's
			// 'name' field is the Bundle-Name header, a different string.
			states.set(bundle.symbolicName ?? bundle.name, bundle.state);
		}
		return states;
	} catch {
		return null;
	}
}

// The console itself: the root answering is the platform's own readiness
// signal for the runtime the scenarios talk to.
async function consoleAnswers(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/`, {
			signal: AbortSignal.timeout(5_000),
		});
		return response.status < 500;
	} catch {
		return false;
	}
}

// Installs the resolved bundle jar through the platform's own console route:
// authenticated multipart POST of the jar's bytes to the bundles console.
// There is no other route and no other credential.
export async function installBundle(
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<InstallOutcome> {
	const base = options.consoleBase ?? `http://127.0.0.1:${port}`;
	const auth = Buffer.from(
		`${options.consoleUsername}:${options.consolePassword}`,
		"utf8",
	).toString("base64");
	const jarBytes = await readFile(options.bundleJarPath);
	const form = new FormData();
	form.append("action", "install");
	form.append("bundlestartlevel", "20");
	form.append("bundlestart", "true");
	form.append("refreshPackages", "true");
	form.append("bundlefile", new Blob([new Uint8Array(jarBytes)]), "bundle.jar");
	const response = await fetch(`${base}/system/console/bundles`, {
		method: "POST",
		headers: { authorization: `Basic ${auth}` },
		body: form,
	});
	if (response.status === 401 || response.status === 403) {
		return {
			ok: false,
			reason: "INSTALL_FAILED",
			message: `The console refused the install of ${options.bundleJarPath} with ${response.status}; the credentials are the thing to check.`,
		};
	}
	// The console answers a completed install with a redirect, whatever the
	// bundle then does: installation and resolution are separate acts, and a
	// bundle that cannot resolve still installed.
	if (response.status !== 200 && response.status !== 302) {
		return {
			ok: false,
			reason: "INSTALL_FAILED",
			message: `The console answered the install of ${options.bundleJarPath} with ${response.status} instead of an accepted install.`,
		};
	}
	return { ok: true };
}

// Waits, polled at the values' interval against the absolute deadline, for
// the installed bundle to reach the active state. A refusal names what the
// bundle actually became, read from the same listing the wait polls.
export async function awaitActive(
	bundleName: string,
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<AwaitActiveOutcome> {
	const intervalMs = options.values.readiness.pollIntervalSeconds * 1000;
	while (true) {
		const states = await listBundleStates(port, options);
		if (states !== null) {
			const state = states.get(bundleName);
			if (state === "Active") {
				return { ok: true };
			}
			const remainingMs = options.activeDeadline.getTime() - Date.now();
			if (remainingMs <= 0) {
				const known = state === undefined
					? `the console lists no bundle named "${bundleName}"`
					: `the bundle "${bundleName}" is in the "${state}" state, never "Active"`;
				return {
					ok: false,
					reason: "NEVER_BECAME_READY",
					message: `The bundle did not become active by the deadline ${options.activeDeadline.toISOString()}: ${known}.`,
				};
			}
		} else if (options.activeDeadline.getTime() - Date.now() <= 0) {
			return {
				ok: false,
				reason: "NEVER_BECAME_READY",
				message: `The bundle did not become active by the deadline ${options.activeDeadline.toISOString()}: the console's bundle listing could not be read at all.`,
			};
		}
		await Bun.sleep(Math.min(intervalMs, Math.max(1, options.activeDeadline.getTime() - Date.now())));
	}
}

export async function startSlingRuntime(
	options: StartSlingRuntimeOptions,
): Promise<StartSlingRuntimeOutcome> {
	const port = options.values.ports.author;
	// Exactly one port for the harness: the author's, mapped as-is.
	const started = await startContainer({
		image: options.image,
		labelKey: options.values.label.key,
		labelValue: options.labelValue,
		network: options.network,
		name: AUTHOR_RUNTIME_NAME,
		publish: [port],
		command: [],
		probe: () => consoleAnswers(port),
		probeIntervalSeconds: options.values.readiness.pollIntervalSeconds,
		deadline: options.consoleDeadline,
		stopGraceSeconds: options.values.stop.graceSeconds,
		captureLimitBytes: options.values.capture.maximumBytes,
		...(options.captureDirectory !== undefined
			? { captureDirectory: options.captureDirectory }
			: {}),
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});
	if (!started.ok) {
		return started as ContainerRefusal;
	}
	const handle: ContainerHandle = started;
	const configured = await installStateConfiguration(port, options);
	if (!configured.ok) {
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return configured;
	}
	const installed = await installBundle(port, options);
	if (!installed.ok) {
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return installed;
	}
	let symbolicName: string;
	try {
		symbolicName = await bundleSymbolicName(options.bundleJarPath);
	} catch (error) {
		// A jar the reader cannot parse is a failed install, not an escape
		// from the typed refusal union.
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return {
			ok: false,
			reason: "INSTALL_FAILED",
			message: `The resolved bundle jar ${options.bundleJarPath} could not be read for its Bundle-SymbolicName: ${
				error instanceof Error ? error.message : String(error)
			}.`,
		};
	}
	const active = await awaitActive(symbolicName, port, options);
	if (!active.ok) {
		// The refusal is returned as-is: it names the captured state and the
		// deadline. The container is left to the caller's teardown, so the log
		// remains capturable for the run report.
		return active;
	}
	// Active is the bundle's state, not its servlets'. The state route is the
	// first thing every scenario and every reconciliation lookup reads, and a
	// lookup nobody can read yet answers 500 rather than the nothing-there
	// 404, so the run waits until the route answers the way the agent's own
	// tier requires before any scenario runs.
	const stateReady = await awaitStateRoute(port, options);
	if (!stateReady.ok) {
		return stateReady;
	}
	return { ok: true, handle, port };
}

// Waits until the agent's lookup route answers its nothing-there status for
// an operation the store has never held, which proves the service-user
// configuration and the bundle's state access are both live.
export async function awaitStateRoute(
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<AwaitActiveOutcome> {
	const base = options.consoleBase ?? `http://127.0.0.1:${port}`;
	const auth = Buffer.from(
		`${options.consoleUsername}:${options.consolePassword}`,
		"utf8",
	).toString("base64");
	const absent = "0".repeat(64);
	const intervalMs = options.values.readiness.pollIntervalSeconds * 1000;
	while (true) {
		try {
			const response = await fetch(
				`${base}/bin/slingshot/agent/snapshot?agent_operation_identifier=${absent}`,
				{
					headers: { authorization: `Basic ${auth}` },
					signal: AbortSignal.timeout(10_000),
				},
			);
			if (response.status === 404) {
				return { ok: true };
			}
		} catch {
			// A route not yet registered is a wait, not a failure.
		}
		if (options.activeDeadline.getTime() - Date.now() <= 0) {
			return {
				ok: false,
				reason: "NEVER_BECAME_READY",
				message: `The agent's lookup route never answered its nothing-there status by the deadline ${options.activeDeadline.toISOString()}; the state configuration is the thing to check.`,
			};
		}
		await Bun.sleep(Math.min(intervalMs, Math.max(1, options.activeDeadline.getTime() - Date.now())));
	}
}

// Reads META-INF/MANIFEST.MF out of the jar through a proper zip parse: a
// jar is a zip, and real OSGi builds deflate the manifest entry, so a plain
// text scan of the raw bytes finds nothing. The central directory names the
// entry's offset and compressed size; the local header carries any extra
// bytes between it and the entry data; the deflated bytes are inflated.
export async function bundleSymbolicName(jarPath: string): Promise<string> {
	const bytes = await readFile(jarPath);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const decoder = new TextDecoder();
	// Find the end-of-central-directory record by scanning backwards for its
	// signature, allowing for a trailing comment after it.
	let end = -1;
	for (let i = bytes.length - 22; i >= 0; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) {
		throw new Error(`${jarPath} is not a zip; it is not a bundle jar`);
	}
	const entryCount = view.getUint16(end + 10, true);
	const centralOffset = view.getUint32(end + 16, true);
	let offset = centralOffset;
	for (let index = 0; index < entryCount; index++) {
		if (view.getUint32(offset, true) !== 0x02014b50) {
			throw new Error(`${jarPath} has a corrupt central directory; it is not a bundle jar`);
		}
		const method = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		const name = decoder.decode(
			bytes.subarray(offset + 46, offset + 46 + nameLength),
		);
		if (name === "META-INF/MANIFEST.MF") {
			const localNameLength = view.getUint16(localOffset + 26, true);
			const localExtraLength = view.getUint16(localOffset + 28, true);
			const dataAt = localOffset + 30 + localNameLength + localExtraLength;
			const compressed = bytes.subarray(dataAt, dataAt + compressedSize);
			let manifestBytes: Uint8Array;
			if (method === 0) {
				manifestBytes = compressed;
			} else if (method === 8) {
				manifestBytes = inflateRawSync(compressed);
			} else {
				throw new Error(
					`${jarPath} stores its manifest with an unsupported compression method ${method}`,
				);
			}
			// Manifest continuation lines are folded: the line break and the
			// single leading space of the next line are removed, joining the
			// pieces directly (the rule Java's own manifest parser applies).
			const unfolded = decoder.decode(manifestBytes).replace(/\r?\n /g, "");
			const match = unfolded.match(/^Bundle-SymbolicName:\s*([^;\r\n]+)/m);
			if (!match || match[1] === undefined) {
				throw new Error(`${jarPath} carries no Bundle-SymbolicName; it is not a bundle jar`);
			}
			return match[1].trim();
		}
		offset += 46 + nameLength + extraLength + commentLength;
	}
	throw new Error(`${jarPath} carries no manifest; it is not a bundle jar`);
}
