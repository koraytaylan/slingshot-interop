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

		const path = `/detached-test/${options.labelValue}`;
		const content = `Content for ${options.labelValue}`;

		// 1. Submit a detached write
		const writeRes = await execInContainer(handle.id, [runner, "write", "--detached", ...machine, path, content], options);
		if (!writeRes.ok || writeRes.exitCode !== 0) {
			return { ok: false, message: `Detached write failed: ${writeRes.message || writeRes.stderr}` };
		}
		const writeEnv = parseMachineEnvelope(writeRes.stdout);
		if (!writeEnv) {
			return { ok: false, message: `Write did not return a machine envelope: ${writeRes.stdout}` };
		}

		// Assert acknowledgement is for work accepted but not finished
		if (writeEnv.state === "completed") {
			return { ok: false, message: `Detached write completed immediately: ${writeEnv.state}` };
		}
		if (!writeEnv.state) {
			return { ok: false, message: `Detached write returned no state: ${writeRes.stdout}` };
		}

		// 2. Wait on the operation through the client to its terminal disposition
		const opKey = (writeEnv as any).operation_key;
		if (!opKey) {
			return { ok: false, message: `Detached write did not return an operation key: ${writeRes.stdout}` };
		}

		const waitRes = await execInContainer(handle.id, [runner, "operation", "wait", ...machine, opKey], options);
		if (!waitRes.ok || waitRes.exitCode !== 0) {
			return { ok: false, message: `Operation wait failed: ${waitRes.message || waitRes.stderr}` };
		}
		const waitEnv = parseMachineEnvelope(waitRes.stdout);
		if (!waitEnv) {
			return { ok: false, message: `Operation wait did not return a machine envelope: ${waitRes.stdout}` };
		}

		const finalDisposition = waitEnv.state;
		if (finalDisposition !== "completed") {
			return { ok: false, message: `Operation did not reach completed state: ${finalDisposition}` };
		}

		// 3. Cross-check with the harness's authenticated read of the agent's own snapshot route
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

		if (opSnapshot.state !== finalDisposition) {
			return { ok: false, message: `Disposition mismatch: client says ${finalDisposition}, agent says ${opSnapshot.state}` };
		}

		return { ok: true, message: "Detached operation scenario passed" };
	},
};
