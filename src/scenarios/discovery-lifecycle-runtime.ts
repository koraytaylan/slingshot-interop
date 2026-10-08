// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { structuredResult } from "./structured-result.ts";
import { readBoundedJson } from "../harness/bounded-json.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { authorHostPort } from "../sides/author-host-port.ts";
import { bundleSymbolicName } from "../sides/agent-runtime.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { agentAuthorization, envelope, invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import { mapping } from "./discovery-lifecycle.ts";

export class DiscoveryLifecycleRuntime {
	private readonly base: string;
	private readonly machine: readonly string[];
	private readonly headers = { authorization: agentAuthorization("admin", "admin") };
	constructor(private readonly handle: ContainerHandle, private readonly options: StartClientRunnerOptions) {
		this.base = `http://127.0.0.1:${authorHostPort(options)}`;
		this.machine = machineArguments(options, options.scratchHome.profileName);
	}
	async read(path: string): Promise<unknown> {
		const response = await fetch(`${this.base}${path}`, { headers: this.headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
		const result = await readBoundedJson(response, this.options.values.capture.maximumBytes);
		if (!result.ok) throw new Error(result.message);
		return result.value;
	}
	async post(path: string, body: URLSearchParams): Promise<void> {
		const response = await fetch(`${this.base}${path}`, { method: "POST", headers: this.headers, body, redirect: "manual", signal: AbortSignal.timeout(30_000) });
		await response.body?.cancel();
		if (![200, 201, 202, 302].includes(response.status)) throw new Error(`discovery fixture POST failed with status ${response.status}`);
	}
	async start(): Promise<void> {
		const answer = await invoke(this.handle, [runner(), ...this.machine, "daemon", "start"], this.options);
		if (!answer.ok || answer.exitCode !== 0) throw new Error("discovery lifecycle daemon did not start");
	}
	async discover(root: string, token?: string): Promise<Record<string, unknown>> {
		const window = token === undefined ? ["--offset", "0", "--limit", "1"] : ["--continuation-token", token];
		const answer = await invoke(this.handle, [runner(), ...this.machine, "list_components", "--path", root, ...window], this.options);
		if (!answer.ok) throw new Error(answer.message);
        const receipt = envelope(answer.stdout, "discovery submission");
        if (!receipt.ok) throw new Error(receipt.message);
        if ((receipt.outcome === "operation_result" || receipt.outcome === "structured_result_artifact_access") && answer.exitCode === 0 || receipt.outcome === "operation_terminal_error" && [3, 4, 5, 6].includes(answer.exitCode)) return structuredResult(this.handle, this.machine, receipt, this.options);
        if (answer.exitCode !== 0 || receipt.outcome !== "operation_receipt" || typeof receipt.operation_identifier !== "string") throw new Error(`discovery submission exited ${answer.exitCode}: ${answer.stdout}`);
        const terminal = await waitTerminal(this.handle, this.machine, receipt.operation_identifier, this.options, this.options.values.readiness.harnessSeconds * 1000);
        if (!terminal.ok) throw new Error(terminal.message);
        return structuredResult(this.handle, this.machine, terminal.envelope, this.options);
	}
	async agentBundle(): Promise<number> {
		if (this.options.agentBundlePath === undefined) throw new Error("discovery lifecycle requires the exact agent candidate");
		const name = await bundleSymbolicName(this.options.agentBundlePath);
		const rows = mapping(await this.read("/system/console/bundles.json"))["data"];
		if (!Array.isArray(rows)) throw new Error("bundle inventory is missing");
		const matches = rows.map(mapping).filter(row => row["symbolicName"] === name);
		const row = matches[0];
		if (matches.length !== 1 || row === undefined || row["state"] !== "Active" || typeof row["id"] !== "number" || !Number.isSafeInteger(row["id"]) || row["id"] < 0) throw new Error("exact agent bundle is not uniquely active");
		return row["id"];
	}
	async action(identifier: number, action: "start" | "stop"): Promise<void> {
		await this.post(`/system/console/bundles/${identifier}`, new URLSearchParams({ action }));
		const end = performance.now() + this.options.values.readiness.harnessSeconds * 1000;
		while (performance.now() < end) {
			const rows = mapping(await this.read("/system/console/bundles.json"))["data"];
			if (!Array.isArray(rows)) throw new Error("bundle inventory is missing");
			const matches = rows.map(mapping).filter(row => row["id"] === identifier);
			if (matches.length !== 1) throw new Error("agent bundle disappeared during restart");
			const state = matches[0]!["state"];
			if (action === "stop" ? state === "Resolved" : state === "Active") {
				if (action === "stop") return;
				const response = await fetch(`${this.base}/bin/slingshot/agent/capabilities`, { headers: this.headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
				const status = response.status;
				await response.body?.cancel();
				if (status === 200) return;
			}
			await Bun.sleep(Math.min(this.options.values.readiness.pollIntervalSeconds * 1000, Math.max(1, end - performance.now())));
		}
		throw new Error(`agent bundle did not ${action} within the readiness deadline`);
	}
}
