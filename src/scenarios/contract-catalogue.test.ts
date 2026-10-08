// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { compareActiveCatalogue, compareCatalogues, manifestKey, transportKey } from "./contract-catalogue.ts";
const hash = "a".repeat(64);
function fixture() {
	const identity = { command_wire_name: "query_paths", command_semantic_contract_version: "0.0.0", command_contract_limits_digest: hash, argument_schema_digest: hash, result_schema_digest: hash };
	const manifest = { format: "slingshot.command-schema/2", canonical_json_contract_sha256: hash, command_contract_limits_sha256: hash, command_semantic_contract_versions: { query_paths: "0.0.0" }, schemas: { query_paths: { arguments: hash, result: hash } } };
	return { client: { _meta: { [manifestKey]: manifest, [transportKey]: hash } }, agent: { format: "slingshot.agent/1", canonical_json_contract_digest: hash, transport_contract_digest: hash, command_contracts: [identity] } };
}
test("comparison retains both observed catalogues", () => {
	const { client, agent } = fixture();
	const evidence = compareCatalogues(client, agent);
	expect(evidence.client_contracts).toEqual(agent.command_contracts);
	expect(evidence.agent_contracts).toEqual(agent.command_contracts);
	expect(evidence.transport_contract_digest).toBe(hash);
});
test.each(["command_wire_name", "command_semantic_contract_version", "command_contract_limits_digest", "argument_schema_digest", "result_schema_digest"])("every identity field must agree: %s", field => {
	const { client, agent } = fixture();
	(agent.command_contracts[0] as Record<string, string>)[field] = field.endsWith("digest") ? "b".repeat(64) : "different";
	expect(() => compareCatalogues(client, agent)).toThrow();
});
test.each(["transport_contract_digest", "canonical_json_contract_digest"])("provenance must agree: %s", field => {
	const { client, agent } = fixture();
	(agent as Record<string, unknown>)[field] = "b".repeat(64);
	expect(() => compareCatalogues(client, agent)).toThrow();
});
test("duplicates, absent/extra commands and incomplete identity cannot pass", () => {
	for (const change of [
		(agent: Record<string, unknown>) => { agent["command_contracts"] = []; },
		(agent: Record<string, unknown>) => { const rows = agent["command_contracts"] as unknown[]; rows.push(rows[0]); },
		(agent: Record<string, unknown>) => { const rows = agent["command_contracts"] as Record<string, unknown>[]; delete rows[0]!["result_schema_digest"]; },
		(agent: Record<string, unknown>) => { const rows = agent["command_contracts"] as Record<string, unknown>[]; rows[0]!["sixth_field"] = hash; },
		(agent: Record<string, unknown>) => { const rows = agent["command_contracts"] as Record<string, unknown>[]; rows.push({ ...rows[0], command_wire_name: "extra" }); },
	]) {
		const { client, agent } = fixture(); change(agent);
		expect(() => compareCatalogues(client, agent)).toThrow();
	}
});
test("absent metadata, unsupported formats and malformed hashes fail closed", () => {
	for (const invalid of [{}, { _meta: {} }, { _meta: { [manifestKey]: [] } }]) expect(() => compareCatalogues(invalid, fixture().agent)).toThrow();
	for (const spelling of ["", "A".repeat(64), "g".repeat(64), "a".repeat(63)]) {
		const { client, agent } = fixture(); client._meta[transportKey] = spelling;
		expect(() => compareCatalogues(client, agent)).toThrow();
	}
	const { client, agent } = fixture(); agent.format = "unknown";
	expect(() => compareCatalogues(client, agent)).toThrow();
});
test("schema and version inventories must name the same commands", () => {
	const { client, agent } = fixture();
	(client._meta[manifestKey].command_semantic_contract_versions as Record<string, string>)["extra"] = "0.0.0";
	expect(() => compareCatalogues(client, agent)).toThrow();
});


test("catalogue comparison does not depend on agent entry order", () => {
    const { client, agent } = fixture();
    const manifest = client._meta[manifestKey];
    (manifest.schemas as Record<string, unknown>)["another"] = { arguments: hash, result: hash };
    (manifest.command_semantic_contract_versions as Record<string, string>)["another"] = "0.0.0";
    agent.command_contracts.push({ ...agent.command_contracts[0]!, command_wire_name: "another", command_semantic_contract_version: "0.0.0" });
    expect(compareCatalogues(client, agent).client_contracts.map(row => row.command_wire_name)).toEqual(["another", "query_paths"]);
});


test("active handlers must match the shipped catalogue without claiming inactive handlers are available", () => {
    const { client, agent } = fixture();
    const built = compareCatalogues(client, agent);
    const extra = { ...built.agent_contracts[0]!, command_wire_name: "platform_only" };
    const full = { ...built, agent_contracts: [...built.agent_contracts, extra], client_contracts: [...built.client_contracts, extra] };
    expect(compareActiveCatalogue(full, agent).inactive_commands).toEqual(["platform_only"]);
    const foreign = { ...agent, command_contracts: [{ ...agent.command_contracts[0]!, result_schema_digest: "b".repeat(64) }] };
    expect(() => compareActiveCatalogue(full, foreign)).toThrow();
});
