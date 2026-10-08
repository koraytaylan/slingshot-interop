// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { DiscoveryLifecycleRuntime } from "./discovery-lifecycle-runtime.ts";
import { mapping, page, refused, samePage } from "./discovery-lifecycle.ts";
import { requireReviewedDiscoveryBudget } from "./incremental-discovery.ts";

type Outcome = { ok: boolean; message: string; evidence: Record<string, unknown> };

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions): Promise<Outcome> {
		const runtime = new DiscoveryLifecycleRuntime(handle, options);
		const evidence: Record<string, unknown> = {};
		let bundle: number | undefined;
		let restore = false;
		let outcome: Outcome;
		try {
			requireReviewedDiscoveryBudget(await runtime.read("/bin/slingshot/agent/capabilities"));
			const root = `/content/interop-lifecycle/${options.labelValue}`;
			const form = new URLSearchParams({ "jcr:primaryType": "nt:unstructured" });
			for (const name of ["one", "two", "three", "four"]) {
				form.set(`${name}/jcr:primaryType`, "nt:unstructured");
				form.set(`${name}/sling:resourceType`, "interop/lifecycle");
			}
			await runtime.post(root, form);
			const planted = mapping(await runtime.read(`${root}.1.json`));
			const children = Object.entries(planted).filter(([, value]) => value !== null && typeof value === "object");
			if (children.length !== 4) throw new Error("discovery lifecycle plant has the wrong child count");
			for (const name of ["one", "two", "three", "four"]) {
				const row = mapping(planted[name]);
				if (row["jcr:primaryType"] !== "nt:unstructured" || row["sling:resourceType"] !== "interop/lifecycle") throw new Error("discovery lifecycle plant differs from its fixture");
			}
			await runtime.start();
			const first = page(await runtime.discover(root), root);
			evidence["wrong_root"] = refused(await runtime.discover(`${root}/absent`, first.token), "continuation_token_wrong_query");
			const second = page(await runtime.discover(root, first.token), root);
			if (first.path === second.path || first.token === second.token) throw new Error("discovery did not advance after refused token misuse");
			samePage(second.document, page(await runtime.discover(root, first.token), root).document);
			evidence["replay"] = { first_path: first.path, second_path: second.path, identical_page: true };
			await runtime.post(second.path, new URLSearchParams({ "jcr:title": "lifecycle-change" }));
			if (mapping(await runtime.read(`${second.path}.json`))["jcr:title"] !== "lifecycle-change") throw new Error("independent read did not observe the content change");
			evidence["changed_replay"] = refused(await runtime.discover(root, first.token), "continuation_token_expired");
			const beforeRestart = page(await runtime.discover(root), root);
			bundle = await runtime.agentBundle();
			evidence["bundle_identifier"] = bundle;
			// A lost stop response may still have stopped the bundle.
			restore = true;
			await runtime.action(bundle, "stop");
			evidence["observed_stopped"] = true;
			await runtime.action(bundle, "start");
			evidence["observed_started"] = true;
			restore = false;
			const afterRestart = page(await runtime.discover(root), root);
			if (beforeRestart.token === afterRestart.token) throw new Error("restart reused the discovery namespace");
			evidence["old_runtime_token"] = refused(await runtime.discover(root, beforeRestart.token), "continuation_token_wrong_query");
			const resumed = page(await runtime.discover(root, afterRestart.token), root);
			if (resumed.path === afterRestart.path) throw new Error("fresh post-restart cursor repeated its first row");
			evidence["fresh_cursor_advances"] = true;
			outcome = { ok: true, message: "Discovery: wrong-root refusal preserves the valid cursor; replay is identical until an independently observed content change invalidates it; a real agent-bundle restart rejects old tokens while new cursors advance.", evidence };
		} catch (error) {
			outcome = { ok: false, message: error instanceof Error ? error.message : "discovery lifecycle failed", evidence };
		} finally {
			if (restore && bundle !== undefined) {
				try { await runtime.action(bundle, "start"); evidence["bundle_restoration"] = "active"; }
				catch (error) { evidence["bundle_restoration"] = error instanceof Error ? error.message : "failed"; }
			}
		}
		return outcome;
	},
};
