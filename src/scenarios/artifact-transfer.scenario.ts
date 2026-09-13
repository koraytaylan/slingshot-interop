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

		// 1. Plant a text node comfortably larger than the protocol's inline result bound
		// through the platform's own default POST servlet.
		const size = options.values.plantedResult.bytes;
		const content = "A".repeat(size);
		const path = `/content/artifact-transfer/${options.labelValue}`;

		const auth = Buffer.from("admin:admin").toString("base64");
		const formData = new FormData();
		formData.append(":text", content);

		const postRes = await fetch(`http://localhost:${options.values.ports.author}${path}`, {
			method: "POST",
			headers: { Authorization: `Basic ${auth}` },
			body: formData,
		});

		if (!postRes.ok) {
			return { ok: false, message: `Planting failed: ${postRes.status} ${await postRes.text()}` };
		}

		// 2. Load it back through the client deeply enough that the serialized result exceeds
		// the inline bound, and assert the operation's result is an artifact reference.
		const readRes = await execInContainer(handle.id, [runner, "read", ...machine, path], options);
		if (!readRes.ok || readRes.exitCode !== 0) {
			return { ok: false, message: `Read failed: ${readRes.message || readRes.stderr}` };
		}

		const readEnv = parseMachineEnvelope(readRes.stdout);
		if (!readEnv) {
			return { ok: false, message: `Read did not return a machine envelope: ${readRes.stdout}` };
		}

		const result = readEnv as any;
		if (!result.artifact) {
			return { ok: false, message: `Expected artifact reference, got inline answer: ${JSON.stringify(result)}` };
		}

		const { reference, byteCount, digest } = result.artifact;
		if (!reference || !byteCount || !digest) {
			return { ok: false, message: `Artifact reference missing details: ${JSON.stringify(result.artifact)}` };
		}

		// 3. Fetch the artifact through the client to a destination, and verify the destination's
		// byte count and digest against what the result declared.
		const destPath = `/tmp/artifact-result-${options.labelValue}.bin`;
		const fetchRes = await execInContainer(handle.id, [runner, "artifact", "fetch", ...machine, reference, destPath], options);
		if (!fetchRes.ok || fetchRes.exitCode !== 0) {
			return { ok: false, message: `Fetch failed: ${fetchRes.message || fetchRes.stderr}` };
		}

		// Verify byte count via stat
		const statRes = await execInContainer(handle.id, ["stat", "-c", "%s", destPath], options);
		if (!statRes.ok) {
			return { ok: false, message: `stat failed: ${statRes.message}` };
		}
		const actualSize = parseInt(statRes.stdout.trim(), 10);
		if (actualSize !== byteCount) {
			return { ok: false, message: `Byte count mismatch: expected ${byteCount}, got ${actualSize}` };
		}

		// Verify digest via sha256sum
		const shaRes = await execInContainer(handle.id, ["sha256sum", destPath], options);
		if (!shaRes.ok) {
			return { ok: false, message: `sha256sum failed: ${shaRes.message}` };
		}
		const actualDigest = shaRes.stdout.split(" ")[0].trim();
		if (actualDigest !== digest) {
			return { ok: false, message: `Digest mismatch: expected ${digest}, got ${actualDigest}` };
		}

		return { ok: true, message: "Artifact transfer scenario passed" };
	},
};
