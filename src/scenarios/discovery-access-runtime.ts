// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { structuredResult } from "./structured-result.ts";
import { TOKEN_ROUTE } from "../harness/forgery-protection.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedJson } from "../harness/bounded-json.ts";
import { checkForLeaks, type ContainerHandle } from "../harness/container.ts";
import { recoverRunContainers } from "../harness/recover-containers.ts";
import { authorHostPort } from "../sides/author-host-port.ts";
import { authorAddress, sixPointFiveDeployment, writeScratchHome } from "../sides/client-configuration.ts";
import { startClientRunner, type StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { agentAuthorization, envelope, invoke, machineArguments, runner, waitTerminal } from "./support.ts";

export class DiscoveryAccessRuntime {
	readonly username = `discovery-${randomUUID()}`;
	readonly runnerLabel = `run-${randomUUID()}`;
	private readonly password = randomUUID();
	private readonly base: string;
	private readonly admin = agentAuthorization("admin", "admin");
	private readonly caller: string;
	private homeParent: string | undefined;
	private ownedRunner: ContainerHandle | undefined;
	private ownedOptions: StartClientRunnerOptions | undefined;
	constructor(private readonly main: ContainerHandle, private readonly options: StartClientRunnerOptions) {
		this.base = `http://127.0.0.1:${authorHostPort(options)}`;
		this.caller = agentAuthorization(this.username, this.password);
	}
	async read(path: string, identity: "admin" | "caller" = "admin"): Promise<unknown> {
		const response = await this.request(path, identity);
		const result = await readBoundedJson(response, this.options.values.capture.maximumBytes);
		if (!result.ok) throw new Error(result.message);
		return result.value;
	}
	async status(path: string, identity: "admin" | "caller" = "admin"): Promise<number> {
		const response = await this.request(path, identity);
		await response.body?.cancel();
		return response.status;
	}
	private request(path: string, identity: "admin" | "caller"): Promise<Response> {
		return fetch(`${this.base}${path}`, { headers: { authorization: identity === "admin" ? this.admin : this.caller }, redirect: "error", signal: AbortSignal.timeout(10_000) });
	}
	async post(path: string, body: URLSearchParams): Promise<void> {
		const response = await fetch(`${this.base}${path}`, { method: "POST", headers: { authorization: this.admin }, body, redirect: "manual", signal: AbortSignal.timeout(30_000) });
		await response.body?.cancel();
		if (![200, 201, 202, 302].includes(response.status)) throw new Error(`permission fixture POST failed with status ${response.status}`);
	}
	async createUser(): Promise<void> {
		await this.post("/system/userManager/user.create.json", new URLSearchParams({ ":name": this.username, pwd: this.password, pwdConfirm: this.password }));
		await this.post("/system/userManager/group/administrators.update.json", new URLSearchParams({ ":member": `/system/userManager/user/${this.username}` }));
		// The public Sling token file is fixture-owned and not readable by a new user.
		await this.permission(TOKEN_ROUTE, "allow");
	}
	async permission(path: string, access: "allow" | "deny"): Promise<void> {
		await this.post(`${path}.modifyAce.json`, new URLSearchParams({ principalId: this.username, "privilege@jcr:read": access }));
	}
	async start(): Promise<void> {
		this.homeParent = await mkdtemp(join(this.options.captureDirectory, "permission-home-"));
		const scratchHome = await writeScratchHome({ parent: this.homeParent, profileName: "permission-caller", environment: "default", deployment: sixPointFiveDeployment, authorAddress: authorAddress(this.options.values), publisherAddress: authorAddress(this.options.values), username: this.username, password: this.password });
		this.ownedOptions = { ...this.options, scratchHome, labelValue: this.runnerLabel, deadline: new Date(Date.now() + this.options.values.readiness.harnessSeconds * 1000) };
		const started = await startClientRunner(this.ownedOptions);
		if (!started.ok) throw new Error(started.message);
		this.ownedRunner = started.handle;
		for (const [handle, options] of [[this.main, this.options], [this.ownedRunner, this.ownedOptions]] as const) {
			const answer = await invoke(handle, [runner(), ...machineArguments(options, options.scratchHome.profileName), "daemon", "start"], options);
			if (!answer.ok || answer.exitCode !== 0) throw new Error("permission scenario daemon did not start");
		}
	}
	async discover(root: string, identity: "admin" | "caller", token?: string, limit = 1): Promise<Record<string, unknown>> {
		const handle = identity === "admin" ? this.main : this.ownedRunner;
		const options = identity === "admin" ? this.options : this.ownedOptions;
		if (handle === undefined || options === undefined) throw new Error("permission caller runner has not started");
		const machine = machineArguments(options, options.scratchHome.profileName);
		const window = token === undefined ? ["--offset", "0", "--limit", String(limit)] : ["--continuation-token", token];
		const answer = await invoke(handle, [runner(), ...machine, "list_components", "--path", root, ...window], options);
		if (!answer.ok) throw new Error(answer.message);
        const receipt = envelope(answer.stdout, "discovery submission");
        if (!receipt.ok) throw new Error(receipt.message);
        if ((receipt.outcome === "operation_result" || receipt.outcome === "structured_result_artifact_access") && answer.exitCode === 0 || receipt.outcome === "operation_terminal_error" && [3, 4, 5, 6].includes(answer.exitCode)) return structuredResult(handle, machine, receipt, options);
        if (answer.exitCode !== 0 || receipt.outcome !== "operation_receipt" || typeof receipt.operation_identifier !== "string") throw new Error(`discovery submission exited ${answer.exitCode}: ${answer.stdout}`);
        const terminal = await waitTerminal(handle, machine, receipt.operation_identifier, options, options.values.readiness.harnessSeconds * 1000);
        if (!terminal.ok) throw new Error(terminal.message);
        return structuredResult(handle, machine, terminal.envelope, options);
	}
	async removeUser(): Promise<void> {
		const path = `/system/userManager/user/${this.username}`;
		const before = await this.status(`${path}.json`);
		if (before !== 404) {
			if (before !== 200) throw new Error("cannot establish temporary user cleanup state");
			await this.post(`${path}.delete.json`, new URLSearchParams());
		}
		if (await this.status(`${path}.json`) !== 404) throw new Error("temporary user remains after cleanup");
	}
	async cleanupRunner(): Promise<void> {
		const options = { labelKey: this.options.values.label.key, labelValue: this.runnerLabel, captureDirectory: this.options.captureDirectory, captureLimitBytes: this.options.values.capture.maximumBytes, deadline: Date.now() + this.options.values.readiness.harnessSeconds * 1000, ...(this.options.executable === undefined ? {} : { executable: this.options.executable }) };
		const recovered = await recoverRunContainers(options);
		if (!recovered.ok) throw new Error(recovered.message);
		const checked = await checkForLeaks(options);
		if (!checked.ok) throw new Error("permission runner cleanup left labeled resources or could not verify absence");
		if (this.homeParent !== undefined) await rm(this.homeParent, { recursive: true, force: true });
	}
}
