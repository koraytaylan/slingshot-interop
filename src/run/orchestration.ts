// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The orchestration of one interop run: resolving both sides, verifying the
// prepared inputs, starting the run's network and runtimes, discovering and
// running scenarios in deterministic order, and tearing everything down.
//
// A run refuses if either side is unresolved, naming the owner's steps for the
// fix, and starts nothing.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readValues, type Values } from "../harness/values.ts";
import {
	readSideDocument,
	resolveSide,
	type SideName,
} from "../sides/pinning.ts";
import {
	startSlingRuntime,
} from "../sides/agent-runtime.ts";
import {
	verifyReleaseArchive,
	extractExecutable,
	startClientRunner,
} from "../sides/client-runtime.ts";
import {
AUTHOR_RUNTIME_NAME,
SEVERANCE_PROXY_NAME,
authorAddress,
writeScratchHome,
} from "../sides/client-configuration.ts";
import {
	createNetwork,
	removeNetwork,
	startContainer,
	checkForLeaks,
	type ContainerHandle,
} from "../harness/container.ts";
import { runPodman } from "../harness/podman.ts";
import { refuseHttpResponse } from "../harness/http-refusal.ts";
import { PLANTED_FORGERY_TOKEN } from "../harness/forgery-protection.ts";
import { severancePoints } from "../harness/severance-proxy.ts";
import { readdir } from "node:fs/promises";
import { type ReportData, type ScenarioOutcome } from "./report.ts";
import { runCleanup } from "./cleanup.ts";
import { recoverRunContainers, recoverRunNetworks } from "../harness/recover-containers.ts";
import {
	elapsedSeconds,
	silentProgress,
	whileWaiting,
	type ProgressSink,
} from "./progress.ts";

// The proxy's control listener sits one port above its forwarding listener:
// the forwarding port is the one profiles point at, the control port is the
// one the harness arms through, and the pair is fixed by the values so no
// caller picks its own.
export function severanceControlPort(values: Values): number {
	return values.ports.proxy + 1;
}

// Disarms every severance point the proxy can hold, so the relay a scenario
// shared is handed back the way it was lent: a point left armed would sever
// the exchanges of every scenario that ran after the one that armed it.
export async function disarmSeveranceProxy(values: Values): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
	for (const point of severancePoints) {
		let response: Response;
		try {
			response = await fetch(`http://127.0.0.1:${severanceControlPort(values)}/disarm/${point}`, { method: "POST", signal: AbortSignal.timeout(10_000), redirect: "error" });
		} catch (failure) {
			return { ok: false, message: `the control listener did not answer: ${failure instanceof Error ? failure.message : String(failure)}` };
		}
		if (response.status !== 200 || response.redirected) {
			return refuseHttpResponse(response, `disarming ${point} failed`);
		}
		try { await response.body?.cancel(); }
		catch { return { ok: false, message: `disarming ${point} could not release its response body` }; }
	}
	return { ok: true };
}


export type OrchestrationOutcome =
	| {
			readonly ok: true;
			readonly report: string;
			readonly data: ReportData;
	  }
	| {
			readonly ok: false;
			readonly reason: "SIDE_UNRESOLVED";
			readonly refusals: {
				readonly side: SideName;
				readonly ownerStep: string;
			}[];
	  }
	| {
			readonly ok: false;
			readonly reason: "SETUP_FAILED";
			readonly message: string;
			readonly data?: ReportData;
	  };

export async function runInterop(
	baseDirectory: string,
	options: {
		// The three prepared images the run assembles itself from, each named
		// by the identifier its verification reads. Declared as a closed set
		// rather than an open record: a run that reached for an image it was
		// never given would be a run assembling something the preparation
		// command never verified, and an index signature would let a missing
		// image read as `undefined` at the moment it is used.
		readonly images: {
			readonly "tier-sling": { readonly identifier: string };
			readonly "client-runner": { readonly identifier: string };
			readonly "severance-proxy": { readonly identifier: string };
		};
		readonly executable?: string;
		// Where the run says what it is doing while it does it. A caller that
		// supplies nothing gets silence, so a run under test prints nothing of
		// its own and a run in a terminal says each step as it happens.
		readonly progress?: ProgressSink;
	},
): Promise<OrchestrationOutcome> {
	const values = readValues(join(baseDirectory, "support/harness-values.toml"));
	const labelValue = `run-${crypto.randomUUID()}`;
	const networkName = `net-${labelValue}`;
	const report = options.progress ?? silentProgress;
	report(`run ${labelValue}: resolving both sides`);

	// 1. Resolve both sides
	const slingshotDoc = readSideDocument(join(baseDirectory, "support/slingshot-side.toml"));
	const agentDoc = readSideDocument(join(baseDirectory, "support/agent-side.toml"));

	const slingshotRes = resolveSide("slingshot", slingshotDoc, baseDirectory);
	const agentRes = resolveSide("agent", agentDoc, baseDirectory);

	if ('refused' in slingshotRes || 'refused' in agentRes) {
		const refusals: { side: SideName; ownerStep: string }[] = [];
		if ('refused' in slingshotRes) {
			refusals.push({ side: "slingshot", ownerStep: slingshotRes.refused.ownerStep });
		}
		if ('refused' in agentRes) {
			refusals.push({ side: "agent", ownerStep: agentRes.refused.ownerStep });
		}
		return {
			ok: false,
			reason: "SIDE_UNRESOLVED",
			refusals,
		};
	}

	const slingshot = slingshotRes.resolved;
	const agent = agentRes.resolved;
	const scenariosDir = join(baseDirectory, "src/scenarios");
	let scenarioFiles: string[] = [];
	const scenarioOutcomes: ScenarioOutcome[] = [];
	const failures: string[] = [];
	let agentConfiguration: ReportData["agentConfiguration"];
	const data = (): ReportData => ({
		label: labelValue, sides: { slingshot, agent },
		images: Object.fromEntries(Object.entries(options.images).map(([name, image]) => [name, {
			identifier: image.identifier, digest: image.identifier.split("@").at(-1)!,
		}])),
		scenarios: scenarioFiles.map((file) => scenarioOutcomes.find((outcome) => outcome.scenario === file)
			?? { scenario: file, ok: false, reason: "NOT_RUN", message: "run stopped before this scenario: " + failures.join("; ") }),
		...(failures.length ? { failures } : {}),
		...(agentConfiguration ? { agentConfiguration } : {}),
	});
	report(
		`slingshot ${slingshot.source === "released" ? `v${slingshot.version}` : "candidate"} from ${slingshot.path}`,
	);
	report(`agent ${agent.source === "released" ? `v${agent.version}` : "candidate"} from ${agent.path}`);

	const handles: ContainerHandle[] = [];
	let finalOutcome: OrchestrationOutcome;
	let currentScenario: string | undefined;
	let ownedWorkDirectory: string | undefined;
	let networkCreated = false;
	try {
	// Discovery is setup too: preserve authenticated side identities and a
	// run-level failure if the scenario inventory cannot be read.
	scenarioFiles = (await readdir(scenariosDir)).filter((file) => file.endsWith(".scenario.ts")).sort();
	// 2. Verify prepared images
	report(`checking ${Object.keys(options.images).length} prepared images`);
	for (const [name, { identifier }] of Object.entries(options.images)) {
	const check = await runPodman(["image", "inspect", identifier], {
		deadline: Date.now() + values.readiness.harnessSeconds * 1000,
		captureLimitBytes: values.capture.maximumBytes,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});
		if (!check.ok) {
			throw new Error(`Prepared image ${name} (${identifier}) inspection failed: ${check.message}`);
		}
	}

	// 3. Setup resources
	report("creating the run's network");
	const workDirectory = await mkdtemp(join(tmpdir(), "interop-work-"));
	ownedWorkDirectory = workDirectory;
	const network = await createNetwork(networkName, {
		deadline: Date.now() + values.readiness.harnessSeconds * 1000,
		labelKey: values.label.key,
		labelValue,
		captureLimitBytes: values.capture.maximumBytes,
		...(options.executable !== undefined ? { executable: options.executable } : {}),
	});

	if (!network.ok) {
		throw new Error(`Failed to create network: ${network.message}`);
	}
	networkCreated = true;
		// 4. Start author runtime
		report(`starting the author runtime (${options.images["tier-sling"].identifier})`);
		const authorStartedAt = Date.now();
		const authorRuntime = await startSlingRuntime({
			configurationObserved: inputs => { agentConfiguration = inputs; },
			image: options.images["tier-sling"].identifier,
			values,
			network: network.name,
			labelValue,
			consoleDeadline: new Date(Date.now() + values.readiness.harnessSeconds * 1000),
			activeDeadline: new Date(Date.now() + values.readiness.publishedRuntimeSeconds * 1000),
			bundleJarPath: agent.path,
			consoleUsername: "admin",
			consolePassword: "admin",
			captureDirectory: workDirectory,
			// The author runtime is not one wait but a sequence of them, and it
			// is the run's longest step: it reports each phase itself, so a
			// reader sees which part of bringing the author up is pending
			// rather than one line repeating while a number climbs.
			progress: report,
			...(options.executable !== undefined ? { executable: options.executable } : {}),
		});

		if (!authorRuntime.ok) {
			throw new Error(`Author runtime failed to start: ${authorRuntime.message}`);
		}
		handles.push(authorRuntime.handle!);
		report(`author runtime ready after ${elapsedSeconds(authorStartedAt)}s`);

		// 4b. Start the severance proxy: the forwarding listener points at
		// the author runtime, and its control listener is how a scenario
		// arms a severance point. Its readiness is its own entrypoint having
		// printed its listening line.
		report("starting the severance proxy");
		const severanceProxy = await whileWaiting(
			"the severance proxy to print its listening line",
			report,
			() =>
				startContainer({
			image: options.images["severance-proxy"].identifier,
			labelKey: values.label.key,
			labelValue,
			network: network.name,
			name: SEVERANCE_PROXY_NAME,
			publish: [values.ports.proxy, severanceControlPort(values)],
			env: [
				`SEVERANCE_LISTEN_PORT=${values.ports.proxy}`,
				`SEVERANCE_CONTROL_PORT=${severanceControlPort(values)}`,
				`SEVERANCE_UPSTREAM_HOST=${AUTHOR_RUNTIME_NAME}`,
				`SEVERANCE_UPSTREAM_PORT=${values.ports.author}`,
				`SEVERANCE_FORGERY_TOKEN=${PLANTED_FORGERY_TOKEN}`,
			],
			command: [],
			probe: async (id, deadline) => {
				const logged = await runPodman(["logs", id], {
					deadline,
					captureLimitBytes: values.capture.maximumBytes,
					captureDirectory: workDirectory,
					...(options.executable !== undefined ? { executable: options.executable } : {}),
				});
				if (!logged.ok) {
					return false;
				}
				const printed = await readFile(logged.stdoutPath, "utf8");
				return printed.includes(`listening on ${values.ports.proxy}`);
			},
			probeIntervalSeconds: values.readiness.pollIntervalSeconds,
			deadline: new Date(Date.now() + values.readiness.harnessSeconds * 1000),
			stopGraceSeconds: values.stop.graceSeconds,
			cleanupTimeoutSeconds: values.readiness.harnessSeconds,
			captureLimitBytes: values.capture.maximumBytes,
			captureDirectory: workDirectory,
			...(options.executable !== undefined ? { executable: options.executable } : {}),
				}),
		);
		if (!severanceProxy.ok) {
			throw new Error(`Severance proxy failed to start: ${severanceProxy.message}`);
		}
		handles.push(severanceProxy);
		report("severance proxy ready");

		// 5. Start client runner
		report("verifying and extracting the client archive");
		const archiveVerified = await verifyReleaseArchive(
			slingshot.path,
			slingshot.digest,
		);
		if (!archiveVerified.ok) {
			throw new Error(`Client archive verification failed: ${archiveVerified.message}`);
		}

		const extracted = await extractExecutable(archiveVerified, workDirectory);
		if (!extracted.ok) {
			throw new Error(`Client executable extraction failed: ${extracted.message}`);
		}

		const scratchHome = await writeScratchHome({
			profileName: "default",
			environment: "default",
			deployment: "adobe_experience_manager_6_5",
			authorAddress: authorAddress(values),
			publisherAddress: authorAddress(values),
			username: "admin",
			password: "admin",
			parent: workDirectory,
		});

		report("starting the client runner");
		const clientRunner = await whileWaiting(
			"the client runner to come up",
			report,
			() =>
				startClientRunner({
					image: options.images["client-runner"].identifier,
					values,
					network: network.name,
					labelValue,
					executablePath: extracted.path,
					scratchHome,
					runtimeRoot: join(workDirectory, "runtime"),
					captureDirectory: workDirectory,
					deadline: new Date(Date.now() + values.readiness.harnessSeconds * 1000),
					...(options.executable !== undefined ? { executable: options.executable } : {}),
				}),
		);

		if (!clientRunner.ok) {
			throw new Error(`Client runner failed to start: ${clientRunner.message}`);
		}
		handles.push(clientRunner.handle!);
		report("client runner ready");

		// 6. Discover and run scenarios
		if (scenarioFiles.length === 0) {
			throw new Error("No integration scenarios were discovered");
		}
		report(`running ${scenarioFiles.length} scenarios, in this order: ${scenarioFiles.join(", ")}`);

		for (const [position, file] of scenarioFiles.entries()) {
			currentScenario = file;
			const scenarioModule = await import(join(scenariosDir, file));
			const scenario = scenarioModule.scenario;
			if (!scenario) {
				throw new Error(`Scenario ${file} does not export a 'scenario' object`);
			}
			report(`[${position + 1}/${scenarioFiles.length}] ${file}`);
			const scenarioStartedAt = Date.now();

			const outcome = await scenario.run(
				clientRunner.handle,
				{
					image: options.images["client-runner"].identifier,
					values,
					network: network.name,
					labelValue,
					executablePath: extracted.path,
					scratchHome,
					runtimeRoot: join(workDirectory, "runtime"),
					captureDirectory: workDirectory,
					deadline: new Date(Date.now() + values.readiness.harnessSeconds * 1000),
					// The scenario's own long wait is an operation reaching its
					// terminal disposition, so the run's sink travels with it:
					// a step that blocks for a minute says so at the same
					// cadence as every other step.
					progress: report,
					...(options.executable !== undefined ? { executable: options.executable } : {}),
				},
			);

			scenarioOutcomes.push({ scenario: file, ok: outcome.ok, ...(outcome.message !== undefined ? { message: outcome.message } : {}) });
			currentScenario = undefined;
			report(
				`[${position + 1}/${scenarioFiles.length}] ${file}: ${outcome.ok ? "ok" : "failed"} after ${elapsedSeconds(scenarioStartedAt)}s`,
			);
			if (!outcome.ok) {
				report(`    ${outcome.message}`);
			}

			// The proxy's armed set is state rather than a one-shot act, and
			// every scenario's profile points at this proxy, so a point a
			// scenario armed would sever the exchanges of every scenario after
			// it. The orchestration restores the unarmed relay between
			// scenarios, where the shared state it lent out is handed back.
			const disarmed = await disarmSeveranceProxy(values);
			if (!disarmed.ok) {
				throw new Error(`Severance proxy could not be disarmed after ${file}: ${disarmed.message}`);
			}
		}

		const reportLines = [
			`Run label: ${labelValue}`,
			`Author runtime image: ${options.images["tier-sling"].identifier}`,
			`Client runner image: ${options.images["client-runner"].identifier}`,
			`Slingshot side: ${slingshot.name} v${slingshot.source === "released" ? slingshot.version : "candidate"} (${slingshot.path}) digest:${slingshot.digest}`,
			`Agent side: ${agent.name} v${agent.source === "released" ? agent.version : "candidate"} (${agent.path}) digest:${agent.digest}`,
			`Scenarios:`,
			...scenarioOutcomes.map((s) => `  - ${s.scenario}: ${s.ok ? "ok" : `failed (${s.message})`}`),
		];

		finalOutcome = {
			ok: true,
			report: reportLines.join("\n"),
			data: data(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		failures.push(message);
		if (currentScenario !== undefined) scenarioOutcomes.push({ scenario: currentScenario, ok: false, reason: "SCENARIO_EXCEPTION", message });
		finalOutcome = {
			ok: false,
			reason: "SETUP_FAILED",
			message,
		};
		report(`the run stopped: ${finalOutcome.message}`);
	}

	// 7. Teardown
	report(`stopping ${handles.length} containers and removing the run's network`);
	const teardownStartedAt = Date.now();
	failures.push(...await runCleanup([
		...handles.flatMap((handle, position) => [
			{ name: `stop ${handle.id}`, run: async () => {
				report(`[${position + 1}/${handles.length}] stopping ${handle.id.slice(0, 12)}`);
				return handle.stop(values.stop.graceSeconds, Date.now() + values.readiness.harnessSeconds * 1000);
			} },
			{ name: `remove ${handle.id}`, run: () => handle.remove(Date.now() + values.readiness.harnessSeconds * 1000) },
		]),
		{ name: "recover unacknowledged containers", run: () => recoverRunContainers({
			labelKey: values.label.key, labelValue,
			captureLimitBytes: values.capture.maximumBytes,
			// Recovery gets its own bounded harness-operation window after the
			// ordinary handle cleanup; expired startup deadlines are not reused.
			deadline: Date.now() + values.readiness.harnessSeconds * 1000,
			...(ownedWorkDirectory === undefined ? {} : { captureDirectory: ownedWorkDirectory }),
			...(options.executable === undefined ? {} : { executable: options.executable }),
		}) },
		...(networkCreated ? [{ name: "remove network", run: () => removeNetwork(networkName, {
		deadline: Date.now() + values.readiness.harnessSeconds * 1000,
		captureLimitBytes: values.capture.maximumBytes,
		...(ownedWorkDirectory === undefined ? {} : { captureDirectory: ownedWorkDirectory }),
		...(options.executable !== undefined ? { executable: options.executable } : {}),
		}) }] : []),
		{ name: "recover unacknowledged networks", run: () => recoverRunNetworks({
			labelKey: values.label.key, labelValue,
			captureLimitBytes: values.capture.maximumBytes,
			deadline: Date.now() + values.readiness.harnessSeconds * 1000,
			...(ownedWorkDirectory === undefined ? {} : { captureDirectory: ownedWorkDirectory }),
			...(options.executable === undefined ? {} : { executable: options.executable }),
		}) },
		{ name: "leak check", run: () => checkForLeaks({
		deadline: Date.now() + values.readiness.harnessSeconds * 1000,
		labelKey: values.label.key,
		labelValue,
		captureLimitBytes: values.capture.maximumBytes,
		captureDirectory: tmpdir(),
		...(options.executable !== undefined ? { executable: options.executable } : {}),
		}) },
		{ name: "remove scratch directory", run: async () => {
			if (ownedWorkDirectory !== undefined) await rm(ownedWorkDirectory, { recursive: true, force: true });
		} },
	]));
	report(`teardown finished after ${elapsedSeconds(teardownStartedAt)}s`);
	if (failures.length) return { ok: false, reason: "SETUP_FAILED", message: failures.join("; "), data: data() };
	return { ...finalOutcome, data: data() };
}
