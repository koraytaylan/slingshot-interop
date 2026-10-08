// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { createHash } from "node:crypto";
import { readJarResources } from "./jar-resources.ts";

export async function builtAgentCatalogue(path: string, expectedDigest: string) {
	const jar = await readJarResources(path);
	if (jar.sha256 !== expectedDigest) throw new Error("candidate agent bytes differ from the resolved artifact digest");
	const directory = "rs/slingshot/agent/commands/";
	const files = jar.read(`${directory}index.txt`).split(/\r?\n/).filter(line => line.trim().length > 0);
	if (files.length === 0 || files.length > 1024 || new Set(files).size !== files.length || files.some(file => !/^[a-z][a-z0-9_]*\.toml$/.test(file))) throw new Error("candidate agent registry index is absent, duplicated, or invalid");
	const contract = "rs/slingshot/agent/contract/";
	const limits = jar.read(`${contract}command-contract.sha256`).trim();
	const canonical = jar.read(`${contract}command-canonical-json-1.json`);
	const canonicalDigest = createHash("sha256").update(canonical).digest("hex");
	if (canonicalDigest !== jar.read(`${contract}command-canonical-json-1.sha256`).trim()) throw new Error("candidate agent canonical contract and its sidecar disagree");
	const command_contracts = files.map(file => {
		const document = Bun.TOML.parse(jar.read(directory + file)) as Record<string, unknown>;
		const row = document["command"];
		if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("candidate agent registry row has no command table");
		const held = row as Record<string, unknown>;
		if (`${String(held["wire_name"])}.toml` !== file || held["contract_limits_digest"] !== limits) throw new Error("candidate agent registry row differs from its index or limits sidecar");
		return { command_wire_name: held["wire_name"], command_semantic_contract_version: held["contract_version"], command_contract_limits_digest: held["contract_limits_digest"], argument_schema_digest: held["argument_schema_digest"], result_schema_digest: held["result_schema_digest"] };
	});
	return { format: "slingshot.agent/1", canonical_json_contract_digest: canonicalDigest, transport_contract_digest: jar.read(`${contract}transport-contract.sha256`).trim(), command_contracts };
}
