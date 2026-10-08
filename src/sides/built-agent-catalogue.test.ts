// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtAgentCatalogue } from "./built-agent-catalogue.ts";
import { fixtureJar } from "./jar-test-fixture.ts";
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function resources() {
	const base = "rs/slingshot/agent/";
	const hash = "a".repeat(64);
	return [
		{ name: `${base}commands/index.txt`, value: "query_paths.toml\n" },
		{ name: `${base}commands/query_paths.toml`, value: `[command]\nwire_name="query_paths"\ncontract_version="0.0.0"\ncontract_limits_digest="${hash}"\nargument_schema_digest="${hash}"\nresult_schema_digest="${hash}"\n` },
		{ name: `${base}contract/command-contract.sha256`, value: hash },
		{ name: `${base}contract/transport-contract.sha256`, value: hash },
		{ name: `${base}contract/command-canonical-json-1.json`, value: "{}\n" },
		{ name: `${base}contract/command-canonical-json-1.sha256`, value: digest("{}\n") },
	];
}
test("full agent catalogue is read from exact candidate bytes, not a source checkout", async () => {
	const root = await mkdtemp(join(tmpdir(), "built-catalogue-"));
	try {
		const bytes = fixtureJar(resources()); const path = join(root, "candidate.jar"); await writeFile(path, bytes);
		const catalogue = await builtAgentCatalogue(path, digest(bytes));
		expect(catalogue.command_contracts).toHaveLength(1);
		expect(catalogue.command_contracts[0]!.command_wire_name).toBe("query_paths");
		await expect(builtAgentCatalogue(path, "0".repeat(64))).rejects.toThrow("resolved artifact digest");
	} finally { await rm(root, { recursive: true, force: true }); }
});
test("index duplication, traversal, row mismatch and corrupted provenance refuse", async () => {
	const root = await mkdtemp(join(tmpdir(), "built-catalogue-refusals-"));
	try {
		for (const change of [
			(rows: ReturnType<typeof resources>) => { rows[0]!.value += "query_paths.toml\n"; },
			(rows: ReturnType<typeof resources>) => { rows[0]!.value = "../outside.toml\n"; },
			(rows: ReturnType<typeof resources>) => { rows[1]!.value = rows[1]!.value.replace('wire_name="query_paths"', 'wire_name="other"'); },
			(rows: ReturnType<typeof resources>) => { rows[2]!.value = "b".repeat(64); },
			(rows: ReturnType<typeof resources>) => { rows[5]!.value = "b".repeat(64); },
		]) {
			const rows = resources(); change(rows); const bytes = fixtureJar(rows); const path = join(root, "candidate.jar"); await writeFile(path, bytes);
			await expect(builtAgentCatalogue(path, digest(bytes))).rejects.toThrow();
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});
