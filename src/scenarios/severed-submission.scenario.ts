// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { execInContainer, parseMachineEnvelope, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { type ContainerHandle } from "../harness/container.ts";
import { serializeProfile, sha256OfBytes, serializeSnapshot, profileDirectoryName, profileFileNameSuffix, configurationSnapshotFileName, selectionFileName } from "../sides/client-configuration.ts";
import { join } from "node:path";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const profileName = "severed-profile";
		const profile = {
			name: profileName,
			environment: options.scratchHome.environmentName,
			deployment: "adobe_experience_manager_6_5",
			authorAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			publisherAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			username: "admin",
			password: "admin",
		};
		const profileContent = serializeProfile(profile);
		const profilePath = join(options.scratchHome.rootPath, profileDirectoryName, `${profileName}${profileFileNameSuffix}`);
		await Bun.write(profilePath, profileContent);

		// Update configuration snapshot to include the new profile
		const sources = [];
		const defaultProfilePath = join(options.scratchHome.rootPath, profileDirectoryName, `${options.scratchHome.profileName}${profileFileNameSuffix}`);
		const defaultProfileBytes = await Bun.file(defaultProfilePath).bytes();
		sources.push({ reference: `${profileDirectoryName}/${options.scratchHome.profileName}${profileFileNameSuffix}`, sha256: sha256OfBytes(defaultProfileBytes) });

		const selectionPath = join(options.scratchHome.rootPath, selectionFileName);
		const selectionBytes = await Bun.file(selectionPath).bytes();
		sources.push({ reference: selectionFileName, sha256: sha256OfBytes(selectionBytes) });

		const severedProfileBytes = new TextEncoder().encode(profileContent);
		sources.push({ reference: `${profileDirectoryName}/${profileName}${profileFileNameSuffix}`, sha256: sha256OfBytes(severedProfileBytes) });

		const snapshotContent = serializeSnapshot(sources);
		await Bun.write(join(options.scratchHome.rootPath, configurationSnapshotFileName), snapshotContent);

		const machine = [
			"--machine",
			"--runtime-root",
			options.runtimeRoot,
			"--profile",
			profileName,
			"--environment",
			options.scratchHome.environmentName,
		];
		const runner = "/opt/slingshot/bin/slingshot";

		// 0. Ensure daemon is running
		const startRes = await execInContainer(handle.id, [runner, "daemon", "start", ...machine], options);
		if (!startRes.ok || startRes.exitCode !== 0) {
			return { ok: false, message: `Daemon start failed: ${startRes.message || startRes.stderr}` };
		}

		const path = `/severed-test/${options.labelValue}`;
		const content = `Content for ${options.labelValue}`;
		const proxyControlPort = 8083;

		// 1. Submit a write and arm the proxy concurrently to sever the response
		// The "after the request body has left" requirement is met by delaying the arming.
		const [writeRes] = await Promise.all([
			execInContainer(handle.id, [runner, "write", ...machine, path, content], options),
			(async () => {
				await Bun.sleep(100); // Delay to allow the request body to leave the client
				await fetch(`http://severance-proxy:${proxyControlPort}/arm/client`, { method: "POST" });
			})(),
		]);
		
		const writeEnv = parseMachineEnvelope(writeRes.stdout);
		if (!writeEnv) {
			return { ok: false, message: `Write did not return a machine envelope: ${writeRes.stdout}` };
		}

		// Assert the client reports unknown_outcome with cause
		if (writeEnv.outcome !== "unknown_outcome") {
			return { ok: false, message: `Expected outcome unknown_outcome, got ${writeEnv.outcome}` };
		}

		const cause = (writeEnv as any).cause;
		if (!cause) {
			return { ok: false, message: `Unknown outcome did not report its cause: ${writeRes.stdout}` };
		}

		const opKey = (writeEnv as any).operation_key;
		if (!opKey) {
			return { ok: false, message: `Write did not return an operation key: ${writeRes.stdout}` };
		}

		// 3. Reconcile through lookup: the operation should be completed
		const waitRes = await execInContainer(handle.id, [runner, "operation", "wait", ...machine, opKey], options);
		const waitEnv = parseMachineEnvelope(waitRes.stdout);
		if (!waitEnv || waitEnv.state !== "completed") {
			return { ok: false, message: `Reconciliation failed: operation ${opKey} state is ${waitEnv?.state || "unknown"}` };
		}

		// 4. Assert exactly one admission and one effect on the agent
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
		const opSnapshots = (snapshotData.operations ?? []).filter((op: any) => op.key === opKey);
		if (opSnapshots.length !== 1) {
			return { ok: false, message: `Expected exactly one admitted operation for ${opKey}, found ${opSnapshots.length}` };
		}

		// Check for the created content
		const contentRes = await fetch(`http://127.0.0.1:${authorPort}/content${path}`, {
			headers: { authorization: `Basic ${auth}` },
			signal: AbortSignal.timeout(10_000),
		});

		if (!contentRes.ok) {
			return { ok: false, message: `Content should exist: ${contentRes.status} ${contentRes.statusText}` };
		}

		const actualContent = await contentRes.text();
		if (actualContent !== content) {
			return { ok: false, message: `Content mismatch: expected ${content}, got ${actualContent}` };
		}

		return { ok: true, message: "Severed submission scenario passed" };
	},
};
