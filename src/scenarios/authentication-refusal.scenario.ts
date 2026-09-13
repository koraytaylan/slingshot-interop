// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { execInContainer, parseMachineEnvelope, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { type ContainerHandle } from "../harness/container.ts";
import { serializeProfile, sha256OfBytes, serializeSnapshot, profileDirectoryName, profileFileNameSuffix, configurationSnapshotFileName, selectionFileName } from "../sides/client-configuration.ts";
import { join } from "node:path";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const profileName = "refusal-profile";
		const profile = {
			name: profileName,
			environment: options.scratchHome.environmentName,
			deployment: "adobe_experience_manager_6_5",
			authorAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			publisherAddress: `http://severance-proxy:${options.values.ports.proxy}`,
			username: "admin",
			password: "wrong-password",
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

		const refusalProfileBytes = new TextEncoder().encode(profileContent);
		sources.push({ reference: `${profileDirectoryName}/${profileName}${profileFileNameSuffix}`, sha256: sha256OfBytes(refusalProfileBytes) });

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

		// 1. Submit a read through the profile with wrong credentials
		const path = `/test-page/${options.labelValue}`;
		const readRes = await execInContainer(handle.id, [runner, "read", "--detached", ...machine, path], options);

		const readEnv = parseMachineEnvelope(readRes.stdout);
		if (!readEnv) {
			return { ok: false, message: `Read did not return a machine envelope: ${readRes.stdout}` };
		}

		const opKey = (readEnv as any).operation_key;
		if (!opKey) {
			return { ok: false, message: `Read did not return an operation key: ${readRes.stdout}` };
		}

		// 2. Assert the client reports its declared authentication-failure category
		const category = (readEnv as any).category;
		if (!category) {
			return { ok: false, message: `Read envelope missing category: ${JSON.stringify(readEnv)}` };
		}
		if (category === "transport_error" || category === "unknown_outcome") {
			return { ok: false, message: `Client reported ${category} instead of authentication failure category` };
		}

		// 3. Assert the operation key never reached the agent's store
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
		if (opSnapshot) {
			return { ok: false, message: `Operation ${opKey} was admitted to the agent's store, but should have been refused` };
		}

		return { ok: true, message: "Authentication refusal scenario passed" };
	},
};
