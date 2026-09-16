// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDaemonDatabase } from "./daemon-database.ts";

test("the live WAL reader sees committed rows, never pending writes, and cannot mutate", async () => {
	const directory = await mkdtemp(join(tmpdir(), "interop-wal-test-"));
	const path = join(directory, "operations.sqlite3");
	const writer = new Database(path);
	try {
		writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence (value TEXT); INSERT INTO evidence VALUES ('committed');");
		const read = () => readDaemonDatabase(path, database => database.query("SELECT value FROM evidence").all());
		expect(read()).toEqual([{ value: "committed" }]);
		writer.exec("BEGIN IMMEDIATE; UPDATE evidence SET value = 'pending';");
		expect(read()).toEqual([{ value: "committed" }]);
		writer.exec("COMMIT;");
		expect(read()).toEqual([{ value: "pending" }]);
		expect(() => readDaemonDatabase(path, database => database.exec("DELETE FROM evidence"))).toThrow();
		expect(read()).toEqual([{ value: "pending" }]);
		writer.exec("PRAGMA wal_checkpoint(TRUNCATE);");
		expect(read()).toEqual([{ value: "pending" }]);
	} finally {
		writer.close();
		await rm(directory, { recursive: true, force: true });
	}
});
