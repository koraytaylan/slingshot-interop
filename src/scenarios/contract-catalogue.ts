// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Compare observed built catalogues without consulting either source checkout.
export const manifestKey = "rs.slingshot/command-schema-manifest";
export const transportKey = "rs.slingshot/transport-contract-sha256";
const fields = ["argument_schema_digest", "command_contract_limits_digest", "command_semantic_contract_version", "command_wire_name", "result_schema_digest"] as const;
type Identity = Record<typeof fields[number], string>;

function object(value: unknown, context: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} is not an object`);
	return value as Record<string, unknown>;
}
function text(value: unknown, context: string): string {
	if (typeof value !== "string" || value.length === 0) throw new Error(`${context} is not a nonempty string`);
	return value;
}
function digest(value: unknown, context: string): string {
	const held = text(value, context);
	if (!/^[a-f0-9]{64}$/.test(held)) throw new Error(`${context} is not a canonical SHA-256 digest`);
	return held;
}
function sameNames(left: readonly string[], right: readonly string[], context: string): void {
	if (JSON.stringify([...left].sort()) !== JSON.stringify([...right].sort())) throw new Error(`${context} command-name sets differ`);
}
function clientContracts(manifest: Record<string, unknown>): Identity[] {
	if (manifest["format"] !== "slingshot.command-schema/2") throw new Error("client schema manifest format is unsupported");
	const schemas = object(manifest["schemas"], "client schemas");
	const versions = object(manifest["command_semantic_contract_versions"], "client versions");
	const names = Object.keys(schemas).sort();
	if (names.length === 0) throw new Error("client command catalogue is empty");
	sameNames(names, Object.keys(versions), "client schemas and versions");
	const limits = digest(manifest["command_contract_limits_sha256"], "client limits");
	return names.map(name => {
		const roles = object(schemas[name], `client ${name} schemas`);
		sameNames(Object.keys(roles), ["arguments", "result"], `client ${name} schema roles`);
		return {
			argument_schema_digest: digest(roles["arguments"], `client ${name} arguments`),
			command_contract_limits_digest: limits,
			command_semantic_contract_version: text(versions[name], `client ${name} version`),
			command_wire_name: name,
			result_schema_digest: digest(roles["result"], `client ${name} result`),
		};
	});
}
function agentContracts(value: unknown): Identity[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error("agent command catalogue is absent or empty");
	const names = new Set<string>();
	const identities = value.map(row => {
		const held = object(row, "agent command identity");
		if (JSON.stringify(Object.keys(held).sort()) !== JSON.stringify([...fields].sort())) throw new Error("agent command identity does not have exactly five fields");
		const identity = Object.fromEntries(fields.map(field => [field, field.endsWith("_digest") ? digest(held[field], field) : text(held[field], field)])) as Identity;
		if (names.has(identity.command_wire_name)) throw new Error("agent catalogue has a duplicate command name");
		names.add(identity.command_wire_name);
		return identity;
	});
	return identities.sort((left, right) => left.command_wire_name < right.command_wire_name ? -1 : 1);
}

export function compareCatalogues(clientResult: unknown, agentDocument: unknown) {
	const client = object(clientResult, "client tools/list result");
	const metadata = object(client["_meta"], "client catalogue metadata");
	const manifest = object(metadata[manifestKey], "client schema manifest");
	const agent = object(agentDocument, "agent capabilities");
	if (agent["format"] !== "slingshot.agent/1") throw new Error("agent capabilities format is unsupported");
	const clientTransport = digest(metadata[transportKey], "client transport");
	const agentTransport = digest(agent["transport_contract_digest"], "agent transport");
	const clientCanonical = digest(manifest["canonical_json_contract_sha256"], "client canonical JSON");
	const agentCanonical = digest(agent["canonical_json_contract_digest"], "agent canonical JSON");
	if (clientTransport !== agentTransport || clientCanonical !== agentCanonical) throw new Error("built transport or canonical-JSON contracts differ");
	const fromClient = clientContracts(manifest);
	const fromAgent = agentContracts(agent["command_contracts"]);
	sameNames(fromClient.map(row => row.command_wire_name), fromAgent.map(row => row.command_wire_name), "built catalogues");
	for (const [index, identity] of fromClient.entries()) {
		for (const field of fields) {
			if (identity[field] !== fromAgent[index]![field]) throw new Error(`built ${identity.command_wire_name} ${field} differs`);
		}
	}
	return { transport_contract_digest: clientTransport, canonical_json_contract_digest: clientCanonical, client_contracts: fromClient, agent_contracts: fromAgent };
}


export function compareActiveCatalogue(built: ReturnType<typeof compareCatalogues>, liveValue: unknown) {
    const live = object(liveValue, "live capabilities");
    if (live["format"] !== "slingshot.agent/1" || live["transport_contract_digest"] !== built.transport_contract_digest || live["canonical_json_contract_digest"] !== built.canonical_json_contract_digest) throw new Error("live capabilities provenance differs from the built agent");
    const active = agentContracts(live["command_contracts"]);
    const shipped = new Map(built.agent_contracts.map(row => [row.command_wire_name, row]));
    for (const row of active) {
        const expected = shipped.get(row.command_wire_name);
        if (expected === undefined || fields.some(field => row[field] !== expected[field])) throw new Error(`live ${row.command_wire_name} differs from the shipped registry`);
    }
    return { ...built, active_contracts: active, inactive_commands: built.agent_contracts.map(row => row.command_wire_name).filter(name => !active.some(row => row.command_wire_name === name)) };
}
