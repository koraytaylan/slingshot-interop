// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, requireUnchangedSnapshot, snapshotSource } from "./source-snapshot.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture(): Promise<{ root: string; source: string }> {
	const root = await mkdtemp(join(tmpdir(), "slingshot-source-snapshot-"));
	roots.push(root);
	const source = join(root, "source");
	await mkdir(source);
	await git(source, ["init", "--quiet"]);
	await writeFile(join(source, "tracked"), "original\n");
	await writeFile(join(source, "deleted"), "removed later\n");
	await writeFile(join(source, ".gitignore"), "build/\n");
	await git(source, ["add", "."]);
	await git(source, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--no-gpg-sign", "-m", "original"]);
	return { root, source };
}

test("dirty bytes, new files, deletions and executable modes have a reproducible separate commit", async () => {
	const { root, source } = await fixture();
	const head = (await git(source, ["rev-parse", "HEAD"])).trim();
	await writeFile(join(source, "tracked"), "changed\n");
	await writeFile(join(source, "new file"), "new\n");
	await chmod(join(source, "new file"), 0o755);
	await rm(join(source, "deleted"));
	await mkdir(join(source, "build"));
	await writeFile(join(source, "build", "ignored"), "not source");
	const status = await git(source, ["status", "--porcelain=v1"]);
	const first = await snapshotSource(source, join(root, "first"));
	const second = await snapshotSource(source, join(root, "second"));
	expect(first).toEqual(second);
	expect(first.originalHead).toBe(head);
	expect(first.commit).not.toBe(head);
	expect(first.files.map(entry => entry.path)).toEqual([".gitignore", "new file", "tracked"]);
	expect(first.files.find(entry => entry.path === "new file")?.executable).toBe(true);
	expect(await readFile(join(root, "first", "tracked"), "utf8")).toBe("changed\n");
	expect(await git(source, ["status", "--porcelain=v1"])).toBe(status);
	expect((await git(source, ["rev-parse", "HEAD"])).trim()).toBe(head);
	await requireUnchangedSnapshot(join(root, "first"), first);
	await writeFile(join(root, "first", "tracked"), "build modified source");
	await expect(requireUnchangedSnapshot(join(root, "first"), first)).rejects.toThrow("changed captured source");
});

test("refuses source symlinks and nesting the snapshot in the source", async () => {
	const { root, source } = await fixture();
	await expect(snapshotSource(source, join(source, "nested"))).rejects.toThrow("outside");
	await symlink("tracked", join(source, "link"));
	await expect(snapshotSource(source, join(root, "snapshot"))).rejects.toThrow("regular file");
});

test("never overwrites an existing destination", async () => {
	const { root, source } = await fixture();
	const destination = join(root, "snapshot");
	await mkdir(destination);
	await writeFile(join(destination, "held"), "preserve");
	await expect(snapshotSource(source, destination)).rejects.toThrow();
	expect(await readFile(join(destination, "held"), "utf8")).toBe("preserve");
});
