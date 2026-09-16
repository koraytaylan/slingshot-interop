// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { resolveAgentOperationIdentifier } from "./support.ts";

const namespace = "fixture-fixture-a4c259bfec6a3d2b2561f5bdb903d09e47ad9ae770d9290e4fdd8316d705276e";
const validIdentifier = "a".repeat(64);

test.each(["valid", "missing", "ambiguous", "newline", "null", "numeric", "uppercase", "short", "long", "orphan", "wrong-target", "ambiguous-operation", "unexpected-target", "missing-expectation"])(
	"agent operation resolution requires unique canonical evidence: %s", async (mode) => {
	const homePath = await mkdtemp(join(tmpdir(), "interop-agent-resolution-"));
	const directory = join(homePath, ".local/share/slingshot/state/targets", namespace);
	await mkdir(directory, { recursive: true });
	const writer = new Database(join(directory, "operations.sqlite3"));
	try {
		writer.exec(`PRAGMA journal_mode=WAL;
			CREATE TABLE operation (
				author_target_identity_digest TEXT NOT NULL,
				operation_identifier TEXT NOT NULL,
				PRIMARY KEY (author_target_identity_digest, operation_identifier)
			);
			CREATE TABLE agent_operation (
				author_target_identity_digest TEXT NOT NULL,
				operation_identifier TEXT NOT NULL,
				agent_operation_identifier,
				PRIMARY KEY (author_target_identity_digest, operation_identifier)
			);`);
		const insertOperation = writer.query("INSERT INTO operation VALUES (?, ?)");
		if (mode !== "orphan") insertOperation.run(mode === "wrong-target" ? "f".repeat(64) : "e".repeat(64), "operation");
		if (mode === "ambiguous-operation") insertOperation.run("f".repeat(64), "operation");
		insertOperation.run("e".repeat(64), "other-operation");
		const malformed: Record<string, string | number | null> = {
			newline: validIdentifier + "\n", null: null, numeric: 42,
			uppercase: "A".repeat(64), short: "a".repeat(63), long: "a".repeat(65),
		};
		const insert = writer.query("INSERT INTO agent_operation VALUES (?, ?, ?)");
		if (mode !== "missing") insert.run("e".repeat(64), "operation", mode in malformed ? malformed[mode]! : validIdentifier);
		if (mode === "ambiguous") insert.run("f".repeat(64), "operation", "b".repeat(64));
		insert.run("e".repeat(64), "other-operation", "c".repeat(64));
		const options = { scratchHome: { homePath, profileName: "fixture", environmentName: "fixture",
			expectedTargetDigests: mode === "missing-expectation" ? {} : { fixture: mode === "unexpected-target" ? "f".repeat(64) : "e".repeat(64) },
		} } as StartClientRunnerOptions;
		const answer = await resolveAgentOperationIdentifier(options, "fixture", "operation");
		expect(answer.ok).toBe(mode === "valid");
		if (answer.ok) {
			expect(answer.agentOperationIdentifier).toBe(validIdentifier);
			expect(answer.targetDigest).toBe("e".repeat(64));
		}
		expect(writer.query("SELECT count(*) AS total FROM agent_operation").get()).toEqual({
			total: mode === "missing" ? 1 : mode === "ambiguous" ? 3 : 2,
		});
	} finally {
		writer.close();
		await rm(homePath, { recursive: true, force: true });
	}
});
