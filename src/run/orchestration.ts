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
	type ResolvedSide,
	type SideResolution,
} from "../sides/pinning.ts";
import {
	startSlingRuntime,
	type SlingRuntimeHandle,
} from "../sides/agent-runtime.ts";
import {
	verifyReleaseArchive,
	extractExecutable,
	startClientRunner,
	type ClientRunnerHandle,
	type VerifiedArchiveOutcome,
	type StartClientRunnerOptions,
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
import { readdir } from "node:fs/promises";

// The proxy's control listener sits one port above its forwarding listener:
// the forwarding port is the one profiles point at, the control port is the
// one the harness arms through, and the pair is fixed by the values so no
// caller picks its own.
export function severanceControlPort(values: Values): number {
	return values.ports.proxy + 1;
}


export type OrchestrationOutcome =
	| {
			readonly ok: true;
			readonly report: string;
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
	  };

export async function runInterop(
	baseDirectory: string,
	options: {
		readonly images: Record<string, { readonly identifier: string }>;
		readonly executable?: string;
	},
): Promise<OrchestrationOutcome> {
	const values = readValues(join(baseDirectory, "support/harness-values.toml"));
	const labelValue = `run-${Date.now()}`;
	const networkName = `net-${labelValue}`;

	// 1. Resolve both sides
	const slingshotDoc = readSideDocument(join(baseDirectory, "support/slingshot-side.toml"));
	const agentDoc = readSideDocument(join(baseDirectory, "support/agent-side.toml"));

	const slingshotRes = resolveSide("slingshot", slingshotDoc, baseDirectory);
	const agentRes = resolveSide("agent", agentDoc, baseDirectory);

	if (slingshotRes.refused || agentRes.refused) {
		const refusals: { side: SideName; ownerStep: string }[] = [];
		if (slingshotRes.refused) {
			refusals.push({ side: "slingshot", ownerStep: slingshotRes.refused.ownerStep });
		}
		if (agentRes.refused) {
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

	// 2. Verify prepared images
	for (const [name, { identifier }] of Object.entries(options.images)) {
		const check = await runPodman(["image", "inspect", identifier], {
			captureLimitBytes: values.capture.maximumBytes,
			executable: options.executable,
		});
		if (!check.ok) {
			return {
				ok: false,
				reason: "SETUP_FAILED",
				message: `Prepared image ${name} (${identifier}) is missing; run scripts/prepare_interop_images first.`,
			};
		}
	}

	// 3. Setup resources
	const workDirectory = await mkdtemp(join(tmpdir(), "interop-work-"));
	const network = await createNetwork(networkName, {
		labelKey: values.label.key,
		labelValue,
		captureLimitBytes: values.capture.maximumBytes,
		executable: options.executable,
	});

	if (!network.ok) {
		await rm(workDirectory, { recursive: true, force: true });
		return {
			ok: false,
			reason: "SETUP_FAILED",
			message: `Failed to create network: ${network.message}`,
		};
	}

	const handles: ContainerHandle[] = [];
	const scenarioOutcomes: { file: string; ok: boolean; message?: string }[] = [];
	let finalOutcome: OrchestrationOutcome;

	try {
		// 4. Start author runtime
		const authorRuntime = await startSlingRuntime({
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
			executable: options.executable,
		});

		if (!authorRuntime.ok) {
			throw new Error(`Author runtime failed to start: ${authorRuntime.message}`);
		}
		handles.push(authorRuntime.handle);

		// 4b. Start the severance proxy: the forwarding listener points at
		// the author runtime, and its control listener is how a scenario
		// arms a severance point. Its readiness is its own entrypoint having
		// printed its listening line.
		const severanceProxy = await startContainer({
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
			],
			command: [],
			probe: async (id) => {
				const logged = await runPodman(["logs", id], {
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
			captureLimitBytes: values.capture.maximumBytes,
			captureDirectory: workDirectory,
			executable: options.executable,
		});
		if (!severanceProxy.ok) {
			throw new Error(`Severance proxy failed to start: ${severanceProxy.message}`);
		}
		handles.push(severanceProxy);

		// 5. Start client runner
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

		const clientRunner = await startClientRunner({
			image: options.images["client-runner"].identifier,
			values,
			network: network.name,
			labelValue,
			executablePath: extracted.path,
			scratchHome,
			runtimeRoot: join(workDirectory, "runtime"),
			captureDirectory: workDirectory,
			deadline: new Date(Date.now() + values.readiness.harnessSeconds * 1000),
			executable: options.executable,
		});

		if (!clientRunner.ok) {
			throw new Error(`Client runner failed to start: ${clientRunner.message}`);
		}
		handles.push(clientRunner.handle);

		// 6. Discover and run scenarios
		const scenariosDir = join(baseDirectory, "src/scenarios");
		const files = await readdir(scenariosDir);
		const scenarioFiles = files
			.filter((f) => f !== "README.md" && f.endsWith(".scenario.ts"))
			.sort();

		for (const file of scenarioFiles) {
			const scenarioModule = await import(join(scenariosDir, file));
			const scenario = scenarioModule.scenario;
			if (!scenario) {
				throw new Error(`Scenario ${file} does not export a 'scenario' object`);
			}

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
					executable: options.executable,
				},
			);

			scenarioOutcomes.push({ file, ok: outcome.ok, message: outcome.message });
		}

		const reportLines = [
			`Run label: ${labelValue}`,
			`Author runtime image: ${options.images["tier-sling"].identifier}`,
			`Client runner image: ${options.images["client-runner"].identifier}`,
			`Slingshot side: ${slingshot.name} v${slingshot.version} (${slingshot.path}) digest:${slingshot.digest}`,
			`Agent side: ${agent.name} v${agent.version} (${agent.path}) digest:${agent.digest}`,
			`Scenarios:`,
			...scenarioOutcomes.map((s) => `  - ${s.file}: ${s.ok ? "ok" : `failed (${s.message})`}`),
		];

		finalOutcome = {
			ok: true,
			report: reportLines.join("\n"),
		};
	} catch (error) {
		finalOutcome = {
			ok: false,
			reason: "SETUP_FAILED",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	// 7. Teardown
	for (const handle of handles) {
		await handle.stop(values.stop.graceSeconds);
		await handle.remove();
	}
	await removeNetwork(network.name, {
		captureLimitBytes: values.capture.maximumBytes,
		captureDirectory: workDirectory,
		executable: options.executable,
	});
	await rm(workDirectory, { recursive: true, force: true });

	// 8. Leak check
	const leakCheck = await checkForLeaks({
		labelKey: values.label.key,
		labelValue,
		captureLimitBytes: values.capture.maximumBytes,
		captureDirectory: tmpdir(),
		executable: options.executable,
	});

	if (!leakCheck.ok) {
		return {
			ok: false,
			reason: "SETUP_FAILED",
			message: `Leak check failed: ${leakCheck.message}`,
		};
	}

	return finalOutcome;
}
