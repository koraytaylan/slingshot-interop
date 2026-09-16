// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUniqueJson } from "./bounded-json.ts";
import { runPodman } from "./podman.ts";

type RecoveryOptions = {
	readonly labelKey: string;
	readonly labelValue: string;
	readonly captureLimitBytes: number;
	readonly captureDirectory?: string;
	readonly executable?: string;
	readonly deadline: number;
};

// A lost startup acknowledgement can leave no handle. Recover only resources
// with this run's UUID label, and independently recheck each exact resource ID.
export async function recoverRunContainers(options: RecoveryOptions): Promise<{ readonly ok: boolean; readonly message: string }> {
	return recoverOwnedResources(options, "container");
}

// Network removal is deliberately not forced: an attached container must not
// be deleted merely because the network carries this run's label.
export async function recoverRunNetworks(options: RecoveryOptions): Promise<{ readonly ok: boolean; readonly message: string }> {
	return recoverOwnedResources(options, "network");
}

async function recoverOwnedResources(options: RecoveryOptions, kind: "container" | "network"): Promise<{ readonly ok: boolean; readonly message: string }> {
	if (!options.labelKey || !/^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(options.labelValue)) {
		return { ok: false, message: "Resource recovery requires this run's nonempty label key and UUID identity." };
	}
	const run = async (command: string[]): Promise<string> => {
		const outcome = await runPodman(command, {
			captureLimitBytes: options.captureLimitBytes, requireCompleteCapture: true,
			deadline: options.deadline,
			captureDirectory: await mkdtemp(join(options.captureDirectory ?? tmpdir(), `recover-${kind}-`)),
			...(options.executable === undefined ? {} : { executable: options.executable }),
		});
		if (!outcome.ok) throw new Error(outcome.message);
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(outcome.stdoutPath));
	};
	try {
		const listing = await run([...(kind === "network" ? ["network", "ls"] : ["ps", "-a"]), "--no-trunc", "--filter", `label=${options.labelKey}=${options.labelValue}`, "--format", "{{.ID}}"]);
		const identifiers = listing.trim() === "" ? [] : listing.trim().split("\n");
		if (new Set(identifiers).size !== identifiers.length || identifiers.some(identifier => !/^[0-9a-f]{64}$/.test(identifier))) {
			return { ok: false, message: `${kind} recovery listing did not contain distinct canonical resource IDs.` };
		}
		const failures: string[] = [];
		for (const identifier of identifiers) {
			try {
				const inspect = kind === "network" ? ["network", "inspect", "--format", "{{json .Labels}}", identifier]
					: ["inspect", "--format", "{{json .Config.Labels}}", identifier];
				const labels: unknown = parseUniqueJson(await run(inspect));
				if (labels === null || typeof labels !== "object" || Array.isArray(labels)
					|| (labels as Record<string, unknown>)[options.labelKey] !== options.labelValue) {
					throw new Error("resource ownership label changed or was not established");
				}
				await run(kind === "network" ? ["network", "rm", identifier] : ["rm", "-f", "-t", "0", identifier]);
			} catch (failure) {
				failures.push(`${identifier}: ${failure instanceof Error ? failure.message : "recovery refused"}`);
			}
		}
		return failures.length ? { ok: false, message: failures.join("; ") }
			: { ok: true, message: `Recovered ${identifiers.length} remaining ${kind} resources owned by this run.` };
	} catch (failure) {
		return { ok: false, message: `${kind} recovery failed: ${failure instanceof Error ? failure.message : "evidence unavailable"}` };
	}
}
