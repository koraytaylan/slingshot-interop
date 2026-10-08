// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { accessNames, accessType, excludesUnreadable, singleAccessPage } from "./discovery-access.ts";

const root = "/content/interop-access/run";
const result = (names: readonly string[], token?: string) => ({ outcome: "operation_result", result: { matches: names.map(name => ({ repository_path: `${root}/${name}`, resource_type: accessType })), complete: token === undefined, examined_nodes: 6, ...(token === undefined ? {} : { next_continuation_token: token }) } });

test("permission oracle rejects disclosures, omissions, duplicate rows and partial final pages", () => {
	expect(singleAccessPage(result(["one"], "next"), root)).toEqual({ path: `${root}/one`, token: "next" });
	expect(excludesUnreadable(result(["one", "three", "four"]), root, `${root}/two`)).toHaveLength(3);
	for (const answer of [result(accessNames), result(["one", "four"]), result(["one", "three", "three"]), result(["one", "three", "four"], "still-more"), result(["unexpected"])]) expect(() => excludesUnreadable(answer, root, `${root}/two`)).toThrow();
	expect(() => singleAccessPage(result(["one"]), root)).toThrow();
});

const modulePath = (name: string) => JSON.stringify(new URL(name, import.meta.url).pathname);

test.each(["success", "foreign-accepted", "leaked-replay", "deny-ineffective", "deleted-row", "omitted-visible", "hidden-visible", "lost-create", "lost-start", "cleanup-failed", "existing-user"])("permission scenario requires independent evidence and cleanup: %s", async mode => {
	const script = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const root = "/content/interop-access/run"; const calls = []; let planted = false; let denied = false; let sequence = 0;
		const page = (names, token) => ({ outcome: "operation_result", result: { matches: names.map(name => ({ repository_path: root + "/" + name, resource_type: "interop/access-component" })), complete: token === undefined, examined_nodes: 6, ...(token === undefined ? {} : { next_continuation_token: token }) } });
		const failure = metadata => ({ outcome: "operation_terminal_error", failure: { metadata } });
		mock.module(${modulePath("./discovery-access-runtime.ts")}, () => ({ DiscoveryAccessRuntime: class {
			username = "fixture-user"; runnerLabel = "run-fixture";
			async read(path, identity) {
				if (path.endsWith("capabilities")) return { command_contracts: [{ command_wire_name: "list_components", command_semantic_contract_version: "0.0.0", command_contract_limits_digest: "66be041fb0623ea682a53b61d20e19c458e25d2a2df209c9ca9edcc2a405278e" }] };
				if (denied && identity === "admin" && mode === "deleted-row") throw new Error("row was deleted");
				calls.push("read-" + identity); return { "sling:resourceType": "interop/access-component" };
			}
			async status(path, identity) {
				if (identity === "caller") return mode === "deny-ineffective" ? 200 : 404;
				if (path.includes("userManager")) return mode === "existing-user" ? 200 : 404;
				return planted ? 200 : 404;
			}
			async createUser() { calls.push("create-user"); if (mode === "lost-create") throw new Error("user create response lost"); }
			async post(_path, form) { if (form.get(":operation") === "delete") { calls.push("delete-root"); planted = false; } else planted = true; }
			async permission(path, access) { calls.push(access); if (access === "deny") { if (path !== root + "/two") throw new Error("wrong denied row"); denied = true; } }
			async start() { calls.push("start"); if (mode === "lost-start") throw new Error("runner start response lost"); }
			async discover(path, identity, token, limit) {
				sequence++; if (path !== root) throw new Error("wrong root");
				if (sequence === 1) { if (identity !== "caller" || token !== undefined) throw new Error("wrong initial caller"); return page(["one"], "first"); }
				if (sequence === 2) { if (identity !== "admin" || token !== "first") throw new Error("missing foreign caller probe"); return mode === "foreign-accepted" ? page(["two"], "next") : failure("continuation_token_wrong_target"); }
				if (sequence === 3) { if (identity !== "caller" || token !== "first") throw new Error("wrong legitimate continuation"); return page(["two"], "second"); }
				if (sequence === 4) { if (!denied || token !== "first") throw new Error("missing cached replay after denial"); return mode === "leaked-replay" ? page(["two"], "second") : failure("continuation_token_expired"); }
				if (sequence === 5) { if (identity !== "caller" || token !== undefined || limit !== 4) throw new Error("wrong fresh enumeration"); return page(mode === "omitted-visible" ? ["one", "four"] : mode === "hidden-visible" ? ["one", "two", "three", "four"] : ["one", "three", "four"]); }
				throw new Error("unexpected discovery");
			}
			async cleanupRunner() { calls.push("cleanup-runner"); if (mode === "cleanup-failed") throw new Error("runner remains"); }
			async removeUser() { calls.push("remove-user"); }
		} }));
		const { scenario } = await import(${modulePath("./discovery-access.scenario.ts")});
		const outcome = await scenario.run({}, { labelValue: "run" });
		console.log(JSON.stringify({ outcome, calls, sequence }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(status, stderr).toBe(0);
	const { outcome, calls, sequence } = JSON.parse(stdout) as { outcome: { ok: boolean; message: string }; calls: string[]; sequence: number };
	expect(outcome.ok, outcome.message).toBe(mode === "success");
	expect(calls).toContain("cleanup-runner");
	if (mode === "existing-user") { expect(calls).not.toContain("create-user"); expect(calls).not.toContain("remove-user"); }
	else expect(calls).toContain("remove-user");
	if (mode === "success") { expect(sequence).toBe(5); expect(calls.filter(call => call === "read-caller")).toHaveLength(4); expect(calls).toContain("read-admin"); }
	if (["success", "cleanup-failed", "lost-start"].includes(mode)) expect(calls).toContain("delete-root");
});

test.each(["success", "lost-runner", "recovery-failed", "leak"])("permission runtime owns its scratch home and recovers a lost handle: %s", async mode => {
	const script = `
		import { mock } from "bun:test";
		import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
		import { tmpdir } from "node:os";
		import { join } from "node:path";
		const mode = ${JSON.stringify(mode)}; const directory = await mkdtemp(join(tmpdir(), "permission-runtime-test-"));
		let mounted; let created = false; const labels = []; const commands = []; const requests = [];
		mock.module(${modulePath("../sides/client-runtime.ts")}, () => ({ startClientRunner: async options => {
			mounted = options;
			return mode === "lost-runner" ? { ok: false, message: "startup response lost" } : { ok: true, handle: { id: "owned" } };
		} }));
		mock.module(${modulePath("../harness/recover-containers.ts")}, () => ({ recoverRunContainers: async options => { labels.push(options.labelValue); return { ok: mode !== "recovery-failed", message: "recovery failed" }; } }));
		mock.module(${modulePath("../harness/container.ts")}, () => ({ checkForLeaks: async options => { labels.push(options.labelValue); return { ok: mode !== "leak" }; } }));
		mock.module(${modulePath("./support.ts")}, () => ({
			agentAuthorization: name => name === "admin" ? "admin" : "caller", runner: () => "runner", machineArguments: (_options, name) => ["--profile", name],
			envelope: text => ({ ok: true, ...JSON.parse(text) }),
			invoke: async (handle, command) => { commands.push([handle.id, command]); return { ok: true, exitCode: 0, stdout: JSON.stringify({ outcome: "operation_receipt", operation_identifier: "owned-operation" }) }; },
			waitTerminal: async () => ({ ok: true, envelope: { outcome: "operation_result", result: {} } }),
		}));
		globalThis.fetch = async (url, options) => {
			if (!url.startsWith("http://127.0.0.1:12345/") || !options.signal) throw new Error("wrong authority or no bound");
			requests.push([options.method || "GET", options.headers.authorization]);
			if (options.method === "POST") {
				if (options.headers.authorization !== "admin" || options.redirect !== "manual") throw new Error("setup did not use admin");
				if (url.endsWith("user.create.json")) { if (!options.body.get("pwd") || options.body.get("pwd") !== options.body.get("pwdConfirm")) throw new Error("bad fixture credentials"); created = true; }
				else if (url.endsWith("administrators.update.json")) { if (!options.body.get(":member").startsWith("/system/userManager/user/discovery-")) throw new Error("wrong member"); }
				else if (url.endsWith(".modifyAce.json")) { if (options.body.get("privilege@jcr:read") !== (url.endsWith("/libs/granite/csrf/token.json.modifyAce.json") ? "allow" : "deny")) throw new Error("wrong permission"); }
				else if (url.endsWith(".delete.json")) created = false;
				else throw new Error("unexpected mutation");
				return new Response("", { status: 200 });
			}
			if (options.redirect !== "error") throw new Error("reads follow redirects");
			if (url.includes("userManager")) return new Response("", { status: created ? 200 : 404 });
			return Response.json({ observed: true });
		};
		try {
			const { DiscoveryAccessRuntime } = await import(${modulePath("./discovery-access-runtime.ts")});
			const options = { image: "pinned-image", executablePath: "/verified/client", network: "shared-network", runtimeRoot: "/runtime", labelValue: "parent-run", authorHostPort: 12345, scratchHome: { profileName: "admin" }, captureDirectory: directory, values: { label: { key: "test.owner" }, capture: { maximumBytes: 10000 }, ports: { proxy: 18081 }, readiness: { harnessSeconds: 1, pollIntervalSeconds: 0.001 } } };
			const runtime = new DiscoveryAccessRuntime({ id: "main" }, options);
			await runtime.createUser(); await runtime.permission("/content/test", "deny"); await runtime.read("/content/test.json", "caller");
			let startFailed = false; try { await runtime.start(); } catch { startFailed = true; }
			if (!startFailed) { await runtime.discover("/content/test", "caller"); await runtime.discover("/content/test", "admin", "opaque"); }
			const profile = await readFile(join(mounted.scratchHome.rootPath, "profiles", "permission-caller.toml"), "utf8");
			if (!profile.includes(runtime.username) || mounted.labelValue !== runtime.runnerLabel || mounted.network !== options.network || mounted.executablePath !== options.executablePath) throw new Error("runner inputs were not isolated and pinned");
			if ((await stat(join(mounted.scratchHome.rootPath, "profiles", "permission-caller.toml"))).mode % 512 !== 384) throw new Error("credentials are not owner-only");
			let cleanupFailed = false; try { await runtime.cleanupRunner(); } catch { cleanupFailed = true; }
			let homeRemains = true; try { await stat(mounted.scratchHome.homePath); } catch { homeRemains = false; }
			await runtime.removeUser();
			console.log(JSON.stringify({ startFailed, cleanupFailed, homeRemains, labelsMatch: labels.every(label => label === runtime.runnerLabel && label !== options.labelValue), labels: labels.length, calls: commands.map(([id]) => id), created, callerObserved: requests.some(([method, identity]) => method === "GET" && identity === "caller") }));
		} finally { await rm(directory, { recursive: true, force: true }); }
	`;
	const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(status, stderr).toBe(0);
	const result = JSON.parse(stdout) as { startFailed: boolean; cleanupFailed: boolean; homeRemains: boolean; labelsMatch: boolean; labels: number; calls: string[]; created: boolean; callerObserved: boolean };
	expect(result.startFailed).toBe(mode === "lost-runner");
	expect(result.cleanupFailed).toBe(mode === "recovery-failed" || mode === "leak");
	expect(result.homeRemains).toBe(result.cleanupFailed);
	expect(result.labelsMatch).toBe(true);
	expect(result.labels).toBe(mode === "recovery-failed" ? 1 : 2);
	expect(result.created).toBe(false);
	expect(result.callerObserved).toBe(true);
	if (mode !== "lost-runner") expect(result.calls).toEqual(["main", "owned", "owned", "main"]);
});
