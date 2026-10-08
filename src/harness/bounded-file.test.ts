// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoundedFile } from "./bounded-file.ts";

test("bounded regular file reader accepts an exact limit and refuses excess, directories and invalid bounds", async () => {
	const root = await mkdtemp(join(tmpdir(), "bounded-file-"));
	try {
		const path = join(root, "input");
		await writeFile(path, "abc");
		expect((await readBoundedFile(path, 3)).toString()).toBe("abc");
		for (const bound of [2, -1, Number.NaN, 1.5]) await expect(readBoundedFile(path, bound)).rejects.toThrow();
		await expect(readBoundedFile(root, 10)).rejects.toThrow();
		await writeFile(path, "");
		expect((await readBoundedFile(path, 0)).length).toBe(0);
	} finally { await rm(root, { recursive: true, force: true }); }
});
