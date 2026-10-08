// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// This first scenario compares actual candidate output before any command mutation.
import { readBoundedJson } from "../harness/bounded-json.ts";
import type { ContainerHandle } from "../harness/container.ts";
import { authorHostPort } from "../sides/author-host-port.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { agentAuthorization, invoke, runner } from "./support.ts";
import { answerFor, answeredDocuments, requestLines, resultOf } from "./model-context-protocol.scenario.ts";
import { builtAgentCatalogue } from "../sides/built-agent-catalogue.ts";
import { compareActiveCatalogue, compareCatalogues } from "./contract-catalogue.ts";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		try {
			const client = await invoke(handle, [runner(), "protocol-serve"], options,
				new TextEncoder().encode(requestLines([{ identifier: "catalogue", method: "tools/list", parameters: {} }])));
			if (!client.ok) return client;
			if (client.exitCode !== 0) return { ok: false, message: "candidate client could not publish its installed catalogue" };
			const response = await fetch(`http://127.0.0.1:${authorHostPort(options)}/bin/slingshot/agent/capabilities`, {
				headers: { authorization: agentAuthorization("admin", "admin") }, redirect: "error",
				signal: AbortSignal.timeout(options.values.readiness.harnessSeconds * 1000),
			});
			const agent = await readBoundedJson(response, options.values.capture.maximumBytes);
			if (!agent.ok) return agent;
			if (options.agentBundlePath === undefined || options.agentBundleDigest === undefined) throw new Error("catalogue comparison requires the resolved agent candidate path");
			const shipped = await builtAgentCatalogue(options.agentBundlePath, options.agentBundleDigest);
			const evidence = compareActiveCatalogue(compareCatalogues(resultOf(answerFor(answeredDocuments(client.stdout), "catalogue")), shipped), agent.value);
			return { ok: true, message: `Both built candidates publish the same ${evidence.client_contracts.length} five-field command identities; ${evidence.active_contracts.length} live handlers match those identities (${evidence.inactive_commands.length} inactive). Transport and canonical-JSON digests agree.`, evidence };
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : "built catalogue comparison failed" };
		}
	},
};
