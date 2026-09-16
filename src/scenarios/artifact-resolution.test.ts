// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { resolveLocalArtifactIdentifier } from "./support.ts";

// The client's length-framed namespace derivation for (fixture, fixture).
const namespace = "fixture-fixture-a4c259bfec6a3d2b2561f5bdb903d09e47ad9ae770d9290e4fdd8316d705276e";
const validIdentifier = "a".repeat(64);
const targetTwo = "f".repeat(64);

test.each([
	"valid", "missing", "ambiguous", "empty", "null", "numeric", "uppercase", "short", "long", "newline",
	"orphan", "wrong-target", "ambiguous-operation",
	"empty-target", "uppercase-target", "newline-target",
	"unexpected-target", "missing-expectation",
])("artifact resolution requires one canonical association: %s", async (mode) => {
	const targetOne = mode === "empty-target" ? "" : mode === "uppercase-target" ? "E".repeat(64) : "e".repeat(64) + (mode === "newline-target" ? "\n" : "");
	const homePath = await mkdtemp(join(tmpdir(), "interop-artifact-resolution-"));
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
			CREATE TABLE artifact_association (
				author_target_identity_digest TEXT NOT NULL,
				operation_identifier TEXT NOT NULL,
				artifact_slot TEXT NOT NULL,
				artifact_identifier,
				PRIMARY KEY (author_target_identity_digest, operation_identifier, artifact_slot)
			);`);
		const insertOperation = writer.query("INSERT INTO operation VALUES (?, ?)");
		if (mode !== "orphan") insertOperation.run(mode === "wrong-target" ? targetTwo : targetOne, "operation");
		if (mode === "ambiguous-operation") insertOperation.run(targetTwo, "operation");
		insertOperation.run(targetOne, "other-operation");
		const malformed: Record<string, string | number | null> = {
			empty: "", null: null, numeric: 42, uppercase: "A".repeat(64),
			short: "a".repeat(63), long: "a".repeat(65), newline: validIdentifier + "\n",
		};
		const insert = writer.query("INSERT INTO artifact_association VALUES (?, ?, ?, ?)");
		if (mode !== "missing") insert.run(targetOne, "operation", "loaded_content_json", mode in malformed ? malformed[mode]! : validIdentifier);
		if (mode === "ambiguous") insert.run(targetTwo, "operation", "loaded_content_json", "b".repeat(64));
		// Unrelated rows must not make an otherwise unique association ambiguous.
		insert.run(targetOne, "other-operation", "loaded_content_json", "c".repeat(64));
		insert.run(targetOne, "operation", "other-slot", "d".repeat(64));
		const options = { scratchHome: { homePath, profileName: "fixture", environmentName: "fixture",
			expectedTargetDigests: mode === "missing-expectation" ? {} : { fixture: mode === "unexpected-target" ? targetTwo : "e".repeat(64) },
		} } as StartClientRunnerOptions;
		const answer = await resolveLocalArtifactIdentifier(options, "fixture", "operation", "loaded_content_json");
		expect(answer.ok).toBe(mode === "valid");
		if (answer.ok) expect(answer).toEqual({ ok: true, artifactIdentifier: validIdentifier, targetDigest: targetOne });
		expect(writer.query("SELECT count(*) AS total FROM artifact_association").get()).toEqual({
			total: mode === "missing" ? 2 : mode === "ambiguous" ? 4 : 3,
		});
	} finally {
		writer.close();
		await rm(homePath, { recursive: true, force: true });
	}
});
