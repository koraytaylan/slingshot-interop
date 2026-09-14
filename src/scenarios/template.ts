// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The template the scenarios' create_page submissions name. The agent
// refuses a page whose template does not resolve (template_not_found) and
// one whose template is there but is not a cq:Template
// (template_invalid); the runtime carries no template of its own, so the
// harness plants one through the platform's own POST servlet — the same
// shape the agent's own tests plant: a node whose jcr:primaryType is
// cq:Template under the site's template settings. Planting is convergent:
// a template a sibling scenario already planted in the same run is the
// outcome this helper needs, so an existing node is verified, not replanted.

import { agentAuthorization } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

export const templatePath = "/conf/site/settings/wcm/templates/interop";

export async function plantTemplate(_handle: ContainerHandle, options: StartClientRunnerOptions): Promise<{ readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string }> {
	const headers = { authorization: agentAuthorization("admin", "admin") };

	// Already there? A sibling scenario may have planted it earlier in the
	// same run: the runtime is one Sling repository shared by every
	// scenario.
	const existing = await fetch(`http://127.0.0.1:${options.values.ports.author}${templatePath}`, {
		headers,
		signal: AbortSignal.timeout(30_000),
	});
	if (existing.ok) {
		return { ok: true, value: templatePath };
	}
	if (existing.status !== 404) {
		return { ok: false, message: `reading the scenario template answered ${existing.status} ${existing.statusText}` };
	}

	const planting = await fetch(`http://127.0.0.1:${options.values.ports.author}${templatePath}`, {
		method: "POST",
		headers,
		body: new URLSearchParams({ "jcr:primaryType": "cq:Template" }),
		signal: AbortSignal.timeout(30_000),
	});
	if (!planting.ok) {
		return { ok: false, message: `planting the scenario template failed: ${planting.status} ${await planting.text()}` };
	}
	return { ok: true, value: templatePath };
}