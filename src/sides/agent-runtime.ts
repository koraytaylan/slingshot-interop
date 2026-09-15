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
import { phases, type PhaseReporter } from "../run/progress.ts";
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
	// Where each step of bringing the author up is reported.
	//
	// This is the run's longest single step and it is not one wait but seven:
	// the container, four console writes, the bundle install, and three
	// readiness routes that settle in a fixed order. Naming which one is
	// pending is the difference between a reader who can see the author
	// starting and a reader watching a number climb.
	readonly progress?: (line: string) => void;
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

// The three OSGi configurations the agent's own interop tier installs before
// the bundle: the repoinit initializer creating the slingshot-agent-state
// system user and its /var/slingshot-agent tree with its ACLs, the service-user
// mapping binding the bundle's subservices to that user, and the authorization
// gate naming the group permitted to submit. All three are read from the agent
// repository's own ui.config content, so the harness carries no second copy of
// their bytes. Without the first two every state-backed route answers 500: the
// service login the bundle asks for maps to no system user. Without the third
// the gate's own default is not applied by the platform, the permitted set is
// empty, and every submission is refused with a 403 — the gate's own rule being
// that an empty set permits nobody rather than everybody.
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
		"rs.slingshot.agent.http.AuthorizationGate.cfg.json",
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

// The token route an Adobe author serves and a plain Sling starter does not.
// Adobe documents that an authenticated author POST carries a short-lived
// token fetched immediately beforehand from this route, and the client fetches
// and sends one before every submission — it refuses to send a state-changing
// request without it. The pinned starter carries neither the filter that issues
// the token nor the filter that would validate it (docs/DEPLOYMENT.md in the
// agent repository records both absences), so the harness supplies the route
// the way it supplies the state configuration: the platform prerequisite the
// pinned bytes do not carry, planted through the platform's own POST servlet
// and named here rather than discovered as an unexplained refusal.
const tokenRoute = "/libs/granite/csrf/token.json";

// The token the planted route answers with. Nothing validates it here, because
// the filter that would is the one the starter does not carry; the client's own
// check is that the document names a non-empty value that is a usable header,
// which is what the route is for.
const plantedToken = "slingshot-interop-token";

async function installForgeryToken(
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<ConfigureStateOutcome> {
	const base = options.consoleBase ?? `http://127.0.0.1:${port}`;
	const auth = Buffer.from(
		`${options.consoleUsername}:${options.consolePassword}`,
		"utf8",
	).toString("base64");
	const headers = { authorization: `Basic ${auth}` };
	// The route's parents first: the platform's install route refuses an
	// absent parent. A parent a sibling run already made is the outcome this
	// needs, so a conflict is accepted and not replanted.
	for (const folder of ["/libs/granite", "/libs/granite/csrf"]) {
		const made = await fetch(`${base}${folder}`, {
			method: "POST",
			headers,
			body: new URLSearchParams({ "jcr:primaryType": "sling:Folder" }),
		});
		if (made.status >= 400 && made.status !== 409) {
			return {
				ok: false,
				reason: "INSTALL_FAILED",
				message: `The author runtime refused the token route's folder ${folder} with ${made.status}.`,
			};
		}
	}
	// The token as an nt:file: the platform's own default GET servlet answers a
	// file's bytes, so the client reads the document it expects without this
	// harness writing a servlet of its own.
	const planted = await fetch(`${base}${tokenRoute}`, {
		method: "POST",
		headers,
		body: new URLSearchParams({
			"jcr:primaryType": "nt:file",
			"jcr:content/jcr:primaryType": "nt:resource",
			"jcr:content/jcr:mimeType": "application/json",
			"jcr:content/jcr:data": JSON.stringify({ token: plantedToken }),
		}),
	});
	if (planted.status >= 400 && planted.status !== 409) {
		return {
			ok: false,
			reason: "INSTALL_FAILED",
			message: `The author runtime refused the forgery-token route with ${planted.status}.`,
		};
	}
	return { ok: true };
}

// The group the agent permits, which an Adobe author has and a plain Sling
// starter does not. The gate's own rule is that an empty permitted set permits
// nobody rather than everybody, and the group it names by default is one an
// AEM instance carries and the pinned starter does not — so without this the
// caller is in none of the permitted groups and every submission is refused
// before a body is read. The agent's own tier plants the same group through the
// platform's user manager and puts the caller in it, which is what this does:
// no second copy of a policy, only the platform state the pinned bytes lack.
const permittedGroup = "administrators";

// Where the platform's own user manager makes the group, changes its
// membership, and answers for it.
const groupCreatePath = "/system/userManager/group.create.html";
const groupPath = `/system/userManager/group/${permittedGroup}.json`;
const groupMembershipPath = `/system/userManager/group/${permittedGroup}.update.html`;
const authenticatedCallerPath = "/system/userManager/user/admin";

async function installPermittedGroup(
	base: string,
	headers: { readonly authorization: string },
): Promise<ConfigureStateOutcome> {
	// Asked for first, because a run against storage a sibling run already
	// configured would otherwise be refused for making a group that is already
	// there — a failure about the second start rather than about the product.
	const existing = await fetch(`${base}${groupPath}`, {
		headers,
		signal: AbortSignal.timeout(30_000),
	});
	if (existing.status >= 400) {
		const made = await fetch(`${base}${groupCreatePath}`, {
			method: "POST",
			headers,
			body: new URLSearchParams({ ":name": permittedGroup }),
			signal: AbortSignal.timeout(30_000),
		});
		if (made.status >= 400) {
			return {
				ok: false,
				reason: "INSTALL_FAILED",
				message: `The author runtime refused to make the permitted group ${permittedGroup} with ${made.status}; every submission is refused until it exists.`,
			};
		}
	}
	const joined = await fetch(`${base}${groupMembershipPath}`, {
		method: "POST",
		headers,
		body: new URLSearchParams({ ":member": authenticatedCallerPath }),
		signal: AbortSignal.timeout(30_000),
	});
	if (joined.status >= 400) {
		return {
			ok: false,
			reason: "INSTALL_FAILED",
			message: `The author runtime refused to put the caller into ${permittedGroup} with ${joined.status}; a caller in none of the permitted groups is refused before a body is read.`,
		};
	}
	return { ok: true };
}

// The content root every scenario writes under, and the run's own folder
// beneath it. A command that creates something refuses when its parent is not
// there — the agent's own `parent_not_found` row — and a run whose scenarios
// each wrote under a parent nothing had made would report that refusal rather
// than the behavior it came to prove. So the run plants its own root once,
// through the platform's own POST servlet, exactly as the reference runtime
// has its content tree already.
const scenarioContentRoot = "/content/interop";

async function installScenarioContentRoot(
	base: string,
	labelValue: string,
	headers: { readonly authorization: string },
): Promise<ConfigureStateOutcome> {
	// The root, then the run's folder: `create_asset_folder` refuses an absent
	// parent, so the deepest path a scenario names is made before any scenario
	// runs. A path a sibling run already made is the outcome this needs.
	for (const folder of [scenarioContentRoot, `${scenarioContentRoot}/${labelValue}`]) {
		const made = await fetch(`${base}${folder}`, {
			method: "POST",
			headers,
			body: new URLSearchParams({ "jcr:primaryType": "sling:OrderedFolder" }),
			signal: AbortSignal.timeout(30_000),
		});
		if (made.status >= 400 && made.status !== 409) {
			return {
				ok: false,
				reason: "INSTALL_FAILED",
				message: `The author runtime refused the scenario content root ${folder} with ${made.status}.`,
			};
		}
	}
	return { ok: true };
}

// The agent repository this run's bundle jar was built from. The agent side's
// pinning names that repository, so the configuration bytes are read from it
// rather than restated here.
function agentRepositoryRoot(): string {
	return process.env['SLINGSHOT_AGENT_ROOT'] ?? "/home/koraytaylan/Workspace/slingshot/slingshot-agent";
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
	// One reporter for the whole sequence, so the heartbeat always repeats
	// whichever step is current rather than the first one. Every exit from this
	// function is inside the `finally`, because a heartbeat left running after a
	// failed start is worse than a silent one: it keeps the process alive and
	// keeps printing about a container somebody is tearing down.
	const phase = phases(options.progress ?? (() => {}));
	try {
		return await startSlingRuntimePhases(options, port, phase);
	} finally {
		phase.done();
	}
}

// The sequence `startSlingRuntime` runs, with the reporter already begun.
async function startSlingRuntimePhases(
	options: StartSlingRuntimeOptions,
	port: number,
	phase: PhaseReporter,
): Promise<StartSlingRuntimeOutcome> {
	phase.begin("waiting for the author container's console route");
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
	phase.begin("writing the author's state configuration");
	const configured = await installStateConfiguration(port, options);
	if (!configured.ok) {
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return configured;
	}
	phase.begin("writing the forgery-token route");
	const tokenised = await installForgeryToken(port, options);
	if (!tokenised.ok) {
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return tokenised;
	}
	phase.begin("installing the administrators group and the caller's membership");
	const permitted = await installPermittedGroup(
		options.consoleBase ?? `http://127.0.0.1:${port}`,
		{
			authorization: `Basic ${Buffer.from(
				`${options.consoleUsername}:${options.consolePassword}`,
				"utf8",
			).toString("base64")}`,
		},
	);
	if (!permitted.ok) {
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return permitted;
	}
	phase.begin("planting the run's content root");
	const contentRoot = await installScenarioContentRoot(
		options.consoleBase ?? `http://127.0.0.1:${port}`,
		options.labelValue,
		{
			authorization: `Basic ${Buffer.from(
				`${options.consoleUsername}:${options.consolePassword}`,
				"utf8",
			).toString("base64")}`,
		},
	);
	if (!contentRoot.ok) {
		await handle.stop(options.values.stop.graceSeconds);
		await handle.remove();
		return contentRoot;
	}
	phase.begin("installing the bundle and waiting for it to become active");
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
	phase.begin("the bundle's state route to answer");
	// Active is the bundle's state, not its servlets'. The state route is the
	// first thing every scenario and every reconciliation lookup reads, and a
	// lookup nobody can read yet answers 500 rather than the nothing-there
	// 404, so the run waits until the route answers the way the agent's own
	// tier requires before any scenario runs.
	const stateReady = await awaitStateRoute(port, options);
	if (!stateReady.ok) {
		return stateReady;
	}
	phase.begin("the continuation-key authority to become ready");
	// The continuation-key authority is the last thing to become ready, and
	// the client refuses an agent that advertises it as not ready — its own
	// rule being that an agent whose tokens would not validate cannot be asked
	// a paged question. The authority is established by the bundle's own
	// lifecycle pass, which runs on activation and then on its interval, so a
	// run that submitted before it settled would be refused for a reason that
	// has nothing to do with the behavior it came to prove.
	const authorityReady = await awaitContinuationAuthority(port, options);
	if (!authorityReady.ok) {
		return authorityReady;
	}
	return { ok: true, handle, port };
}

// Waits until the agent advertises its continuation-key authority as ready,
// read from the agent's own capability document rather than a probe's
// absence: the document is what the client reads, so a run waits on exactly
// the signal the client would refuse on.
export async function awaitContinuationAuthority(
	port: number,
	options: StartSlingRuntimeOptions,
): Promise<AwaitActiveOutcome> {
	const base = options.consoleBase ?? `http://127.0.0.1:${port}`;
	const auth = Buffer.from(
		`${options.consoleUsername}:${options.consolePassword}`,
		"utf8",
	).toString("base64");
	const intervalMs = options.values.readiness.pollIntervalSeconds * 1000;
	while (true) {
		try {
			const response = await fetch(`${base}/bin/slingshot/agent/capabilities`, {
				headers: { authorization: `Basic ${auth}` },
				signal: AbortSignal.timeout(10_000),
			});
			if (response.ok) {
				const document = (await response.json()) as { readonly continuation_authority_ready?: unknown };
				if (document.continuation_authority_ready === true) {
					return { ok: true };
				}
			}
		} catch {
			// A document not yet answerable is a wait, not a failure.
		}
		if (options.activeDeadline.getTime() - Date.now() <= 0) {
			return {
				ok: false,
				reason: "NEVER_BECAME_READY",
				message: `The agent never advertised its continuation-key authority as ready by the deadline ${options.activeDeadline.toISOString()}; the client refuses an agent whose tokens it cannot use, so every submission would be refused for that reason rather than for the behavior under proof.`,
			};
		}
		await Bun.sleep(Math.min(intervalMs, Math.max(1, options.activeDeadline.getTime() - Date.now())));
	}
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
