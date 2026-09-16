// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { resolveAgentOperationIdentifier, resolveLocalArtifactIdentifier } from "./support.ts";

const namespace = "fixture-fixture-a4c259bfec6a3d2b2561f5bdb903d09e47ad9ae770d9290e4fdd8316d705276e";

for (const kind of ["agent", "artifact"] as const) {
	test.each(["missing", "corrupt", "wrong-schema"])(`${kind} database errors are typed read-only refusals: %s`, async mode => {
		const homePath = await mkdtemp(join(tmpdir(), "interop-database-refusal-"));
		const directory = join(homePath, ".local/share/slingshot/state/targets", namespace);
		await mkdir(directory, { recursive: true });
		const path = join(directory, "operations.sqlite3");
		try {
			if (mode === "corrupt") await writeFile(path, "private fixture bytes, not a SQLite database");
			if (mode === "wrong-schema") {
				const writer = new Database(path);
				writer.exec("CREATE TABLE unrelated (value TEXT)");
				writer.close();
			}
			const before = mode === "missing" ? null : await readFile(path);
			const options: Pick<StartClientRunnerOptions, "scratchHome"> = { scratchHome: { homePath, rootPath: join(homePath, ".config/slingshot"), profileName: "fixture", environmentName: "fixture", expectedTargetDigests: { fixture: "e".repeat(64) } } };
			const answer = kind === "agent"
				? await resolveAgentOperationIdentifier(options, "fixture", "operation")
				: await resolveLocalArtifactIdentifier(options, "fixture", "operation", "loaded_content_json");
			expect(answer.ok).toBe(false);
			if (!answer.ok) expect(answer.message).not.toContain("private fixture bytes");
			if (before === null) expect(await Bun.file(path).exists()).toBe(false);
			else expect(await readFile(path)).toEqual(before);
		} finally {
			await rm(homePath, { recursive: true, force: true });
		}
	});
}
