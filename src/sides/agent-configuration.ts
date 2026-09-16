// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const names = [
	"org.apache.sling.jcr.repoinit.RepositoryInitializer~slingshot-agent.cfg.json",
	"org.apache.sling.serviceusermapping.impl.ServiceUserMapperImpl.amended~slingshot-agent.cfg.json",
	"rs.slingshot.agent.http.AuthorizationGate.cfg.json",
] as const;

export type AgentConfiguration = { readonly name: string; readonly digest: string; readonly bytes: Uint8Array };

export async function readAgentConfigurations(support = new URL("../../support", import.meta.url).pathname): Promise<readonly AgentConfiguration[]> {
	const manifest = Bun.TOML.parse(await readFile(join(support, "agent-configuration.toml"), "utf8")) as { files?: Record<string, unknown> };
	const files = manifest.files;
	if (!files || Object.keys(files).sort().join("\n") !== [...names].sort().join("\n")) throw new Error("agent configuration inventory must name exactly the three setup fixtures");
	return Promise.all(names.map(async name => {
		const expected = files[name];
		if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`invalid agent configuration digest: ${name}`);
		const bytes = await readFile(join(support, "agent-configuration", name));
		const digest = createHash("sha256").update(bytes).digest("hex");
		if (digest !== expected) throw new Error(`agent configuration digest mismatch: ${name}`);
		return { name, digest, bytes };
	}));
}
