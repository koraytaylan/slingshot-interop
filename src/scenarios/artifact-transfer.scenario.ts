// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The artifact-transfer scenario: a result too large to answer inline is
// answered by reference, and the reader verifies the bytes itself. The
// content is planted through the platform's own default POST servlet — the
// runtime's own way of making content — and read back deeply enough that the
// serialized result exceeds the inline bound.

import { agentAuthorization, envelope, invoke, machineArguments, resolveLocalArtifactIdentifier, runner, waitTerminal } from "./support.ts";
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

		// 1. Plant content comfortably larger than the protocol's inline
		// result bound, through the platform's own default POST servlet. The
		// parameter is the property's own name: the platform writes a parameter
		// as a property of that name, while a leading-colon spelling is
		// reserved for the servlet's own directives and plants nothing — a node
		// planted with `:text` carries no content, and the load that follows
		// answers inline, which is the opposite of what this scenario proves.
		//
		// The bulk travels as many properties rather than one, because the
		// command contract bounds a single string property at
		// `maximum_property_string_bytes`: one larger string is a document the
		// client's own loaded-document reader refuses however correct its
		// framing is, so a single huge property would prove the refusal path
		// instead of the artifact path.
		const size = options.values.plantedResult.bytes;
		const propertyBytes = options.values.plantedResult.propertyBytes;
		const propertyCount = Math.ceil(size / propertyBytes);
		const body = new URLSearchParams();
		for (let index = 0; index < propertyCount; index += 1) {
			body.set(`text${String(index).padStart(4, "0")}`, "A".repeat(propertyBytes));
		}
		const path = `/content/interop-artifact/${options.labelValue}`;
		const planting = await fetch(`http://127.0.0.1:${options.values.ports.author}${path}`, {
			method: "POST",
			headers: { authorization: agentAuthorization("admin", "admin") },
			body,
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
		if ((receipt as Record<string, unknown>)['outcome'] !== "operation_receipt") {
			return { ok: false, message: `the oversized load answered ${String((receipt as Record<string, unknown>)['outcome'])} instead of a receipt: ${submitted.stdout}` };
		}
		const operationIdentifier = (receipt as Record<string, unknown>)['operation_identifier'];
		if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
			return { ok: false, message: `the oversized load named no operation: ${submitted.stdout}` };
		}

		// 3. Wait for the operation to end, and assert the answer names an
		// artifact carrying a byte count and digest rather than an inline
		// result. The command declares this artifact itself — the load's own
		// contract answers an over-bound document with an `artifact`
		// descriptor — so the answer is the command's typed result carrying
		// that reference, not the daemon's own `structured_result_artifact_access`
		// entry, which is the slot the daemon creates for a logical result too
		// large to answer inline.
		const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
		if (!ended.ok) {
			return ended;
		}
		if (ended.envelope.outcome !== "operation_result") {
			return { ok: false, message: `the oversized load ended as ${JSON.stringify(ended.envelope.outcome)} instead of its result` };
		}
		const result = ended.envelope.result as Record<string, unknown> | undefined;
		if (result === undefined) {
			return { ok: false, message: `the oversized load answered no result document: ${JSON.stringify(ended.envelope)}` };
		}
		if (result["disposition"] !== "artifact") {
			return { ok: false, message: `the oversized load answered disposition ${JSON.stringify(result["disposition"])} where its document was over the inline bound: ${JSON.stringify(result).slice(0, 800)}` };
		}
		const artifact = result["artifact"] as Record<string, unknown> | undefined;
		const declaredIdentifier = typeof artifact?.["identifier"] === "string" ? String(artifact["identifier"]) : undefined;
		const declaredSlot = typeof artifact?.["slot"] === "string" ? String(artifact["slot"]) : undefined;
		const byteLength = typeof artifact?.["byte_length"] === "number" ? Number(artifact["byte_length"]) : undefined;
		const contentDigest = typeof artifact?.["digest"] === "string" ? String(artifact["digest"]).replace(/^sha256-/, "") : undefined;
		if (declaredIdentifier === undefined || declaredSlot === undefined || byteLength === undefined || contentDigest === undefined) {
			return { ok: false, message: `the artifact reference carries no identifier, slot, byte count, or digest: ${JSON.stringify(result).slice(0, 800)}` };
		}

		// 4. Fetch the artifact through the client to a destination, and
		// verify the destination's byte count and digest against what the
		// result declared. The identifier the fetch leaf addresses is the one
		// the daemon bound the slot to, not the opaque name the agent chose:
		// the descriptor's `identifier` is the agent's own and the daemon
		// records its own derivation beside the operation, so the local name is
		// read from the daemon's association row the same way the agent's
		// operation identifier already is.
		const local = await resolveLocalArtifactIdentifier(options, options.scratchHome.profileName, operationIdentifier, declaredSlot);
		if (!local.ok) {
			return local;
		}
		// The staging file and the lock sit beside the destination, so the
		// directory has to exist: a destination inside a directory that is not
		// there is not a destination this can stage next to. Created here
		// rather than by the client because where a caller keeps fetched files
		// is the caller's business.
		const artifactsDirectory = join3(options.scratchHome.homePath, "artifacts");
		const prepared = await invoke(handle, ["mkdir", "-p", artifactsDirectory], options);
		if (!prepared.ok || prepared.exitCode !== 0) {
			return { ok: false, message: `the destination directory could not be made: ${prepared.ok ? prepared.stderr : prepared.message}` };
		}
		const destination = join3(artifactsDirectory, `${options.labelValue}.bin`);
		const fetched = await invoke(handle, [
			runner(), ...machine, "operation-artifact",
			"--operation", operationIdentifier,
			"--artifact", local.artifactIdentifier,
			"--expected-digest", contentDigest,
			"--destination", destination,
		], options);
		if (!fetched.ok) {
			return { ok: false, message: `operation-artifact could not run: ${fetched.message}` };
		}
		if (fetched.exitCode !== 0) {
			return { ok: false, message: `operation-artifact exited ${fetched.exitCode}: ${fetched.stderr}` };
		}
		// The leaf answers one machine envelope, and it is the daemon's own
		// access entry for the artifact: the slot this result filled is the
		// operation's logical result, so what the daemon hands back is
		// `structured_result_artifact_access` carrying the address of the bytes
		// it published. Its own identifier and digest are what the fetch is
		// then judged against, so a disagreement between that entry and the
		// result's descriptor fails here rather than at the destination.
		const fetchAnswer = envelope(fetched.stdout, "operation-artifact");
		if (fetchAnswer.ok === false) {
			return fetchAnswer;
		}
		if (fetchAnswer.outcome !== "structured_result_artifact_access") {
			return { ok: false, message: `operation-artifact answered ${JSON.stringify(fetchAnswer.outcome)} instead of the daemon's access entry: ${fetched.stdout.slice(0, 800)}` };
		}
		const entry = (fetchAnswer as Record<string, unknown>)["artifact"] as Record<string, unknown> | undefined;
		if (entry === undefined || typeof entry["artifact_identifier"] !== "string" || Number(entry["byte_length"]) !== byteLength) {
			return { ok: false, message: `the daemon's access entry does not name the artifact the result described: entry ${JSON.stringify(entry).slice(0, 400)} against result ${JSON.stringify(result).slice(0, 400)}` };
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
		// planted content must be readable inside it: the document is the
		// load's answer, and the plant is the content the answer carries. It is
		// read through the runner, because the destination is where the caller
		// asked for it to land and that is inside the client's own runtime
		// rather than on the host running the harness.
		const readBack = await invoke(handle, ["cat", destination], options);
		if (!readBack.ok) {
			return { ok: false, message: `the fetched result could not be read: ${readBack.message}` };
		}
		const destinationText = readBack.stdout;
		let carried: Record<string, unknown> | undefined;
		try {
			const parsed = JSON.parse(destinationText) as Record<string, unknown>;
			const properties = parsed["properties"];
			carried = properties !== null && typeof properties === "object" && !Array.isArray(properties)
				? properties as Record<string, unknown>
				: undefined;
		} catch {
			return { ok: false, message: `the fetched result is not a JSON document: ${destinationText.slice(0, 400)}` };
		}
		if (carried === undefined) {
			return { ok: false, message: `the fetched result carries no properties table: ${destinationText.slice(0, 400)}` };
		}
		const plantedRun = "A".repeat(propertyBytes);
		for (let index = 0; index < propertyCount; index += 1) {
			const name = `text${String(index).padStart(4, "0")}`;
			const entry = carried[name];
			const value = entry !== null && typeof entry === "object" && !Array.isArray(entry)
				? (entry as Record<string, unknown>)["value"]
				: undefined;
			if (value !== plantedRun) {
				return { ok: false, message: `the fetched result does not carry the planted run at property ${name}: it carries ${String(value).slice(0, 80)}` };
			}
		}
		return { ok: true, message: `artifact transfer: ${byteLength} bytes answered by reference and verified at the destination, carrying all ${propertyCount} planted properties of ${propertyBytes} bytes` };
	},
};

function shellQuote(value: string): string {
	return `'${value.split("'").join(`'\\''`)}'`;
}

function join3(...parts: readonly string[]): string {
	return parts.join("/");
}