// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { createHash, randomUUID } from "node:crypto";
import { parseUniqueJson } from "../harness/bounded-json.ts";
import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { invoke, runner, type EnvelopeRead } from "./support.ts";

// Logical results may be published as artifacts even when their current page
// is small. Fetch through the real client and independently bind exact bytes.
export async function structuredResult(handle: ContainerHandle, machine: readonly string[], answer: EnvelopeRead, options: StartClientRunnerOptions): Promise<EnvelopeRead> {
	if (answer.outcome !== "structured_result_artifact_access") return answer;
	const artifact = (answer as Record<string, unknown>)["artifact"] as Record<string, unknown> | undefined;
	if (artifact === undefined || typeof artifact["artifact_identifier"] !== "string" || typeof artifact["operation_identifier"] !== "string"
		|| typeof artifact["content_digest"] !== "string" || !/^[0-9a-f]{64}$/.test(artifact["content_digest"])
		|| artifact["media_type"] !== "application/json" || typeof artifact["byte_length"] !== "number"
		|| !Number.isSafeInteger(artifact["byte_length"]) || artifact["byte_length"] < 1 || artifact["byte_length"] > options.values.capture.maximumBytes) throw new Error("structured result has no bounded JSON artifact identity");
	const path = `/tmp/interop-result-${randomUUID()}.json`;
	try {
		const fetched = await invoke(handle, [runner(), ...machine, "operation-artifact", "--operation", artifact["operation_identifier"], "--artifact", artifact["artifact_identifier"], "--expected-digest", artifact["content_digest"], "--destination", path], options);
		if (!fetched.ok || fetched.exitCode !== 0) throw new Error(`structured result fetch failed: ${fetched.ok ? fetched.stdout : fetched.message}`);
		const read = await invoke(handle, ["cat", "--", path], options);
		if (!read.ok || read.exitCode !== 0) throw new Error("structured result could not be read");
		const bytes = Buffer.from(read.stdout);
		if (bytes.length !== artifact["byte_length"] || createHash("sha256").update(bytes).digest("hex") !== artifact["content_digest"]) throw new Error("structured result bytes differ from the published identity");
		const result = parseUniqueJson(read.stdout);
		if (result === null || typeof result !== "object" || Array.isArray(result)) throw new Error("structured result is not an object");
		return { ok: true, outcome: "operation_result", result: result as Record<string, unknown> };
	} finally {
		const removed = await invoke(handle, ["rm", "-f", "--", path], options);
		if (!removed.ok || removed.exitCode !== 0) throw new Error("structured result scratch cleanup failed");
	}
}
