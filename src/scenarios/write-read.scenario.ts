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

		const path = `/test-page/${options.labelValue}`;
		const content = `Content for ${options.labelValue}`;

		// 1. Write
		const writeRes = await execInContainer(handle.id, [runner, "write", ...machine, path, content], options);
		if (!writeRes.ok || writeRes.exitCode !== 0) {
			return { ok: false, message: `Write failed: ${writeRes.message || writeRes.stderr}` };
		}
		const writeEnv = parseMachineEnvelope(writeRes.stdout);
		if (!writeEnv) {
			return { ok: false, message: `Write did not return a machine envelope: ${writeRes.stdout}` };
		}

		// 2. Wait for operation to its terminal disposition
		let disposition = writeEnv.state;
		const opKey = (writeEnv as any).operation_key;
		if (opKey && (!disposition || disposition !== "completed")) {
			const waitRes = await execInContainer(handle.id, [runner, "operation", "wait", ...machine, opKey], options);
			if (!waitRes.ok || waitRes.exitCode !== 0) {
				return { ok: false, message: `Operation wait failed: ${waitRes.message || waitRes.stderr}` };
			}
			const waitEnv = parseMachineEnvelope(waitRes.stdout);
			if (!waitEnv) {
				return { ok: false, message: `Operation wait did not return a machine envelope: ${waitRes.stdout}` };
			}
			disposition = waitEnv.state;
		}

		if (disposition !== "completed") {
			return { ok: false, message: `Operation did not complete: ${disposition}` };
		}

		// 3. Read back content
		const readRes = await execInContainer(handle.id, [runner, "read", ...machine, path], options);
		if (!readRes.ok || readRes.exitCode !== 0) {
			return { ok: false, message: `Read failed: ${readRes.message || readRes.stderr}` };
		}
		const readEnv = parseMachineEnvelope(readRes.stdout);
		if (!readEnv) {
			return { ok: false, message: `Read did not return a machine envelope: ${readRes.stdout}` };
		}

		const readContent = (readEnv as any).content;
		if (readContent !== content) {
			return { ok: false, message: `Read content mismatch: expected ${content}, got ${readContent}` };
		}

		return { ok: true, message: "Write-then-read scenario passed" };
	},
};
