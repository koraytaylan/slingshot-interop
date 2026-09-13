// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { execInContainer, parseMachineEnvelope, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { type ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const namespace = [
			"--profile",
			options.scratchHome.profileName,
			"--environment",
			options.scratchHome.environmentName,
		];
		const machine = ["--machine", "--runtime-root", options.runtimeRoot, ...namespace];
		const runner = "/opt/slingshot/bin/slingshot";

		// 0. Ensure daemon is running
		const startRes = await execInContainer(handle.id, [runner, "daemon", "start", ...machine], options);
		if (!startRes.ok || startRes.exitCode !== 0) {
			return { ok: false, message: `Daemon start failed: ${startRes.message || startRes.stderr}` };
		}

		// 1. Read a path that was never created
		const path = `/missing-root/${options.labelValue}`;
		const readRes = await execInContainer(handle.id, [runner, "read", "--detached", ...machine, path], options);
		if (!readRes.ok || readRes.exitCode !== 0) {
			return { ok: false, message: `Read failed: ${readRes.message || readRes.stderr}` };
		}

		const readEnv = parseMachineEnvelope(readRes.stdout);
		if (!readEnv) {
			return { ok: false, message: `Read did not return a machine envelope: ${readRes.stdout}` };
		}

		const opKey = (readEnv as any).operation_key;
		if (!opKey) {
			return { ok: false, message: `Read did not return an operation key: ${readRes.stdout}` };
		}

		// 2. Wait for the operation to reach a terminal disposition
		const waitRes = await execInContainer(handle.id, [runner, "operation", "wait", ...machine, opKey], options);
		if (!waitRes.ok || waitRes.exitCode !== 0) {
			return { ok: false, message: `Operation wait failed: ${waitRes.message || waitRes.stderr}` };
		}

		const finalEnv = parseMachineEnvelope(waitRes.stdout);
		if (!finalEnv) {
			return { ok: false, message: `Operation wait did not return a machine envelope: ${waitRes.stdout}` };
		}

		if (finalEnv.state === "completed") {
			return { ok: false, message: `Operation should have failed, but completed: ${finalEnv.state}` };
		}

		// 3. Cross-check with the agent's internal record via the snapshot route
		const authorPort = options.values.ports.author;
		const auth = Buffer.from("admin:admin", "utf8").toString("base64");
		const snapshotUrl = `http://127.0.0.1:${authorPort}/system/snapshot`;

		const snapshotRes = await fetch(snapshotUrl, {
			headers: { authorization: `Basic ${auth}` },
			signal: AbortSignal.timeout(10_000),
		});

		if (!snapshotRes.ok) {
			return { ok: false, message: `Agent snapshot route failed: ${snapshotRes.status} ${snapshotRes.statusText}` };
		}

		const snapshotData = await snapshotRes.json();
		const opSnapshot = (snapshotData.operations ?? []).find((op: any) => op.key === opKey);
		if (!opSnapshot) {
			return { ok: false, message: `Operation ${opKey} not found in agent snapshot: ${JSON.stringify(snapshotData)}` };
		}

		const clientFailure = {
			category: (finalEnv as any).category,
			status: (finalEnv as any).status,
			retryability: (finalEnv as any).retryability,
		};
		const agentFailure = {
			category: opSnapshot.category,
			status: opSnapshot.status,
			retryability: opSnapshot.retryability,
		};

		if (
			clientFailure.category !== agentFailure.category ||
			clientFailure.status !== agentFailure.status ||
			clientFailure.retryability !== agentFailure.retryability
		) {
			return {
				ok: false,
				message: `Failure details mismatch: client says ${JSON.stringify(clientFailure)}, agent says ${JSON.stringify(agentFailure)}`,
			};
		}

		return { ok: true, message: "Failure category scenario passed" };
	},
};
