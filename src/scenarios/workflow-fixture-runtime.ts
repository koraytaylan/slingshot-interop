// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { readBoundedJson } from "../harness/bounded-json.ts";
import { authorHostPort } from "../sides/author-host-port.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { agentAuthorization } from "./support.ts";
import { fixtureBundle } from "./counting-workflow.ts";

export class WorkflowFixtureRuntime {
	readonly base: string;
	private readonly headers = { authorization: agentAuthorization("admin", "admin") };
	constructor(private readonly options: StartClientRunnerOptions) {
		this.base = `http://127.0.0.1:${authorHostPort(options)}`;
	}
	async read(path: string): Promise<unknown> {
		const response = await fetch(`${this.base}${path}`, { headers: this.headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
		const result = await readBoundedJson(response, this.options.values.capture.maximumBytes);
		if (!result.ok) throw new Error(result.message);
		return result.value;
	}
	async post(path: string, body: FormData | URLSearchParams): Promise<void> {
		const response = await fetch(`${this.base}${path}`, { method: "POST", body, headers: this.headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
		await response.body?.cancel();
		if (![200, 201, 202, 302].includes(response.status)) throw new Error(`fixture POST failed with status ${response.status}`);
	}
	async hasWorkflow(): Promise<boolean> {
		const document = await this.read("/bin/slingshot/agent/capabilities") as { command_contracts?: unknown };
		if (!Array.isArray(document.command_contracts) || document.command_contracts.length === 0) throw new Error("capabilities have no command contracts");
		const names = new Set<string>();
		for (const row of document.command_contracts) {
			if (row === null || typeof row !== "object" || typeof row.command_wire_name !== "string" || names.has(row.command_wire_name)) throw new Error("invalid active command inventory");
			names.add(row.command_wire_name);
		}
		return names.has("start_workflow");
	}
	async bundle(): Promise<{ id: number; state: string } | undefined> {
		const document = await this.read("/system/console/bundles.json") as { data?: unknown };
		if (!Array.isArray(document.data)) throw new Error("console has no bundle inventory");
		const matches = document.data.filter(row => row !== null && typeof row === "object" && row.symbolicName === fixtureBundle);
		if (matches.length > 1) throw new Error("duplicate fixture bundles");
		if (matches.length === 0) return undefined;
		const row = matches[0];
		if (!Number.isSafeInteger(row.id) || row.id < 0 || typeof row.state !== "string") throw new Error("invalid fixture bundle identity");
		return { id: row.id, state: row.state };
	}
	async settle(present: boolean): Promise<void> {
		const end = performance.now() + this.options.values.readiness.harnessSeconds * 1000;
		while (performance.now() < end) {
			const bundle = await this.bundle();
			if ((present ? bundle?.state === "Active" : bundle === undefined) && await this.hasWorkflow() === present) return;
			await Bun.sleep(Math.min(this.options.values.readiness.pollIntervalSeconds * 1000, Math.max(1, end - performance.now())));
		}
		throw new Error(`workflow fixture did not become ${present ? "active and bound" : "absent and unbound"}`);
	}
	async install(bytes: Buffer): Promise<void> {
		const form = new FormData();
		for (const [name, value] of Object.entries({ action: "install", bundlestartlevel: "20", bundlestart: "true", refreshPackages: "true" })) form.set(name, value);
		form.set("bundlefile", new Blob([new Uint8Array(bytes)]), "counting-workflow.jar");
		await this.post("/system/console/bundles", form);
		await this.settle(true);
	}
	async remove(): Promise<void> {
		const bundle = await this.bundle();
		if (bundle !== undefined) await this.post(`/system/console/bundles/${bundle.id}`, new URLSearchParams({ action: "uninstall" }));
		await this.settle(false);
	}
}
