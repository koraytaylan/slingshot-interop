// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { DiscoveryAccessRuntime } from "./discovery-access-runtime.ts";
import { accessNames, accessType, excludesUnreadable, singleAccessPage } from "./discovery-access.ts";
import { mapping, refused } from "./discovery-lifecycle.ts";
import { requireReviewedDiscoveryBudget } from "./incremental-discovery.ts";

type Outcome = { ok: boolean; message: string; evidence: Record<string, unknown> };

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
		const runtime = new DiscoveryAccessRuntime(handle, options);
		const root = `/content/interop-access/${options.labelValue}`;
		const evidence: Record<string, unknown> = { caller: runtime.username, runner_label: runtime.runnerLabel };
		let ownedUser = false;
		let ownedRoot = false;
		let outcome: Outcome;
		try {
			requireReviewedDiscoveryBudget(await runtime.read("/bin/slingshot/agent/capabilities"));
			if (await runtime.status(`/system/userManager/user/${runtime.username}.json`) !== 404 || await runtime.status(`${root}.json`) !== 404) throw new Error("permission fixture refuses an existing user or root");
			ownedUser = true;
			await runtime.createUser();
			const form = new URLSearchParams({ "jcr:primaryType": "nt:unstructured" });
			for (const name of accessNames) {
				form.set(`${name}/jcr:primaryType`, "nt:unstructured");
				form.set(`${name}/sling:resourceType`, accessType);
			}
			ownedRoot = true;
			await runtime.post(root, form);
			await runtime.permission(root, "allow");
			for (const name of accessNames) {
				const node = mapping(await runtime.read(`${root}/${name}.json`, "caller"));
				if (node["sling:resourceType"] !== accessType) throw new Error("caller cannot independently read every planted component");
			}
			evidence["readable_before"] = accessNames.map(name => `${root}/${name}`);
			await runtime.start();
			const first = singleAccessPage(await runtime.discover(root, "caller"), root);
			// The CLI target identity includes its authentication principal.
			evidence["foreign_caller_token"] = refused(await runtime.discover(root, "admin", first.token), "continuation_token_wrong_target");
			const second = singleAccessPage(await runtime.discover(root, "caller", first.token), root);
			if (first.path === second.path || first.token === second.token) throw new Error("foreign-token refusal consumed or stalled the caller's cursor");
			await runtime.permission(second.path, "deny");
			const denied = await runtime.status(`${second.path}.json`, "caller");
			if (denied !== 403 && denied !== 404) throw new Error("permission deny did not remove the caller's independent read access");
			if (mapping(await runtime.read(`${second.path}.json`, "admin"))["sling:resourceType"] !== accessType) throw new Error("the denied resource disappeared instead of becoming unreadable");
			evidence["denied_path"] = second.path;
			evidence["independent_denial_status"] = denied;
			evidence["cached_replay"] = refused(await runtime.discover(root, "caller", first.token), "continuation_token_expired");
			evidence["readable_after"] = excludesUnreadable(await runtime.discover(root, "caller", undefined, accessNames.length), root, second.path);
			outcome = { ok: true, message: "A separately authenticated caller reads four components, cannot transfer its token to the admin target, loses access to one independently verified existing row, cannot replay that cached row, and enumerates exactly the three still-readable rows.", evidence };
		} catch (error) {
			outcome = { ok: false, message: error instanceof Error ? error.message : "discovery permission scenario failed", evidence };
		}
		const failures: string[] = [];
		for (const [name, cleanup] of [
			["runner", () => runtime.cleanupRunner()],
			["root", async () => {
				if (!ownedRoot) return;
				const status = await runtime.status(`${root}.json`);
				if (status !== 404) {
					if (status !== 200) throw new Error("cannot establish permission fixture cleanup state");
					await runtime.post(root, new URLSearchParams({ ":operation": "delete" }));
				}
				if (await runtime.status(`${root}.json`) !== 404) throw new Error("permission fixture remains after cleanup");
			}],
			["user", async () => { if (ownedUser) await runtime.removeUser(); }],
		] as const) {
			try { await cleanup(); evidence[`${name}_cleanup`] = (name === "root" && !ownedRoot) || (name === "user" && !ownedUser) ? "not-created" : "verified"; }
			catch (error) { const message = error instanceof Error ? error.message : "cleanup failed"; evidence[`${name}_cleanup`] = message; failures.push(`${name}: ${message}`); }
		}
		return failures.length === 0 ? outcome : { ok: false, message: `${outcome.message}; cleanup failed: ${failures.join("; ")}`, evidence };
	},
};
