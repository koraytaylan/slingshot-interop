// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { Database } from "bun:sqlite";

// SQLite coordinates this reader with the daemon's WAL writer. Copying the
// database and sidecars independently cannot preserve a committed snapshot.
// Keep reads synchronous and short; never hold a read transaction over awaits.
export function readDaemonDatabase<T>(path: string, read: (database: Database) => T): T {
	const database = new Database(path, { readonly: true });
	try {
		return read(database);
	} finally {
		database.close();
	}
}
