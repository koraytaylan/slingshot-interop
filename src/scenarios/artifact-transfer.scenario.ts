// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The artifact-transfer scenario: a result too large to answer inline is
// answered by reference, and the reader verifies the bytes itself. The
// content is planted through the platform's own default POST servlet — the
// runtime's own way of making content — and read back deeply enough that the
// serialized result exceeds the inline bound.

import { agentAuthorization, envelope, invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		const machine = machineArguments(options, options.scratchHome.profileName);

		// 0. The daemon: the oversized load reads through it, exactly as every
		// catalog submission does. An explicit start converges regardless of
		// which scenario ran first.
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		// 1. Plant a text node comfortably larger than the protocol's inline
		// result bound, through the platform's own default POST servlet.
		const size = options.values.plantedResult.bytes;
		const planted = "A".repeat(size);
		const path = `/content/interop-artifact/${options.labelValue}`;
		const planting = await fetch(`http://127.0.0.1:${options.values.ports.author}${path}`, {
			method: "POST",
			headers: { authorization: agentAuthorization("admin", "admin") },
			body: new URLSearchParams({ ":text": planted }),
			signal: AbortSignal.timeout(30_000),
		});
		if (!planting.ok) {
			return { ok: false, message: `planting the oversized node failed: ${planting.status} ${await planting.text()}` };
		}

		// 2. Load it back through the client: the serialized result exceeds
		// the inline bound, so the operation is answered by artifact
		// reference rather than inline.
		const submitted = await invoke(handle, [
			runner(), ...machine, "load_content_as_json",
			"--operation-key", `${options.labelValue}-artifact`,
			"--path", path,
			"--depth", "1",
		], options);
		if (!submitted.ok) {
			return { ok: false, message: `the oversized load could not run: ${submitted.message}` };
		}
		if (submitted.exitCode !== 0) {
			return { ok: false, message: `the oversized load exited ${submitted.exitCode}: ${submitted.stderr}` };
		}
		const receipt = envelope(submitted.stdout, "load_content_as_json");
		if (receipt.ok === false) {
			return receipt;
		}
		if (receipt.outcome !== "operation_receipt") {
			return { ok: false, message: `the oversized load answered ${String(receipt.outcome)} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = receipt.operation_identifier;
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the oversized load named no operation: ${submitted.stdout}` };
		}

		// 3. Wait for the operation to end, and assert the answer names an
		// artifact carrying a byte count and digest rather than an inline
		// result.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!ended.ok) {
			return ended;
		}
		if (ended.envelope.outcome !== "structured_result_artifact_access") {
			return { ok: false, message: `the oversized load ended as ${JSON.stringify(ended.envelope.outcome)} instead of an artifact reference` };
		}
		const artifact = ended.envelope.artifact as Record<string, unknown> | undefined;
		const artifactIdentifier = typeof artifact?.["artifact_identifier"] === "string" ? String(artifact["artifact_identifier"]) : undefined;
		const byteLength = typeof artifact?.["byte_length"] === "number" ? Number(artifact["byte_length"]) : undefined;
		const contentDigest = typeof artifact?.["content_digest"] === "string" ? String(artifact["content_digest"]).replace(/^sha256-/, "") : undefined;
		if (artifactIdentifier === undefined || byteLength === undefined || contentDigest === undefined) {
			return { ok: false, message: `the artifact reference carries no identifier, byte count, or digest: ${JSON.stringify(ended.envelope)}` };
		}

		// 4. Fetch the artifact through the client to a destination, and
		// verify the destination's byte count and digest against what the
		// result declared.
		const destination = join3(options.scratchHome.homePath, "artifacts", `${options.labelValue}.bin`);
		const fetched = await invoke(handle, [
			runner(), ...machine, "operation-artifact",
			"--operation", operationIdentifier,
			"--artifact", artifactIdentifier,
			"--expected-digest", contentDigest,
			"--destination", destination,
		], options);
		if (!fetched.ok) {
			return { ok: false, message: `operation-artifact could not run: ${fetched.message}` };
		}
		if (fetched.exitCode !== 0) {
			return { ok: false, message: `operation-artifact exited ${fetched.exitCode}: ${fetched.stderr}` };
		}
		const measured = await invoke(handle, ["sh", "-c", `wc -c < ${shellQuote(destination)}; sha256sum ${shellQuote(destination)}`], options);
		if (!measured.ok) {
			return { ok: false, message: `reading the fetched artifact failed: ${measured.message}` };
		}
		const [byteCountText, digestLine] = measured.stdout.split("\n");
		const actualBytes = Number.parseInt(byteCountText?.trim() ?? "", 10);
		if (Number.isNaN(actualBytes) || actualBytes !== byteLength) {
			return { ok: false, message: `byte count mismatch: the result declared ${byteLength}, the destination holds ${byteCountText?.trim()}` };
		}
		const actualDigest = digestLine?.split(" ")[0]?.trim().replace(/^sha256-/, "");
		if (actualDigest === undefined || actualDigest !== contentDigest) {
			return { ok: false, message: `digest mismatch: the result declared ${contentDigest}, the destination digests to ${actualDigest}` };
		}
		// The fetched bytes are the canonical result document itself, so the
		// planted text must be readable inside it: the document is the load's
		// answer, and the plant is the content the answer carries.
		const destinationText = await Bun.file(destination).text();
		if (!destinationText.includes(planted)) {
			return { ok: false, message: `the fetched result does not carry the planted ${size} bytes of text` };
		}
		return { ok: true, message: `artifact transfer: ${byteLength} bytes answered by reference and verified at the destination` };
	},
};

function shellQuote(value: string): string {
	return `'${value.split("'").join(`'\\''`)}'`;
}

function join3(...parts: readonly string[]): string {
	return parts.join("/");
}