// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type SourceEntry = { readonly path: string; readonly digest: string; readonly executable: boolean };
export type SourceSnapshot = {
	readonly originalHead: string;
	readonly commit: string;
	readonly tree: string;
	readonly inventoryDigest: string;
	readonly files: readonly SourceEntry[];
};

export function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

// No shell evaluation, inherited Git redirection, signing, or hooks. Original
// repositories are read only; every object written belongs to the new snapshot.
export async function git(directory: string, arguments_: readonly string[]): Promise<string> {
	const environment = { ...process.env };
	for (const key of Object.keys(environment)) if (key.startsWith("GIT_")) delete environment[key];
	const child = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", "-C", directory, ...arguments_], {
		env: { ...environment, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" },
		stdout: "pipe", stderr: "pipe",
	});
	const [output, errors, status] = await Promise.all([
		new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
	]);
	if (status !== 0) throw new Error(`git ${arguments_[0]} failed (${status}): ${errors}`);
	return output;
}

function contained(root: string, path: string): boolean {
	const suffix = relative(root, path);
	return suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix);
}

async function inventory(source: string, destination?: string): Promise<SourceEntry[]> {
	const names = [...new Set((await git(source, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
		.split("\0").filter(Boolean))].sort();
	const entries: SourceEntry[] = [];
	for (const name of names) {
		const input = resolve(source, name);
		if (!contained(source, input) || name.split(/[\\/]/).includes(".git")) throw new Error(`unsafe source path: ${name}`);
		let metadata;
		try { metadata = await lstat(input); }
		catch (failure) {
			if ((failure as NodeJS.ErrnoException).code === "ENOENT") continue; // tracked deletion
			throw failure;
		}
		if (!metadata.isFile() || !contained(source, await realpath(input))) throw new Error(`source is not a contained regular file: ${name}`);
		const bytes = await readFile(input);
		const executable = (metadata.mode & 0o111) !== 0;
		entries.push({ path: name, digest: sha256(bytes), executable });
		if (destination !== undefined) {
			const output = join(destination, name);
			await mkdir(dirname(output), { recursive: true });
			await writeFile(output, bytes, { flag: "wx" });
			await chmod(output, executable ? 0o755 : 0o644);
		}
	}
	return entries;
}

// The fixed author timestamp identifies a synthetic snapshot, not a historical
// commit date. Original HEAD is recorded explicitly; the snapshot never claims
// that dirty bytes were built from that unchanged HEAD.
export async function snapshotSource(sourcePath: string, destination: string): Promise<SourceSnapshot> {
	const source = await realpath(sourcePath);
	if (contained(source, resolve(destination))) throw new Error("snapshot destination must be outside the source repository");
	if (await realpath((await git(source, ["rev-parse", "--show-toplevel"])).trim()) !== source) throw new Error("source must be a repository root");
	const originalHead = (await git(source, ["rev-parse", "HEAD"])).trim();
	await mkdir(destination); // refuses an existing destination
	const files = await inventory(source, destination);
	const inventoryDigest = sha256(JSON.stringify(files));
	if (inventoryDigest !== sha256(JSON.stringify(await inventory(source))) || originalHead !== (await git(source, ["rev-parse", "HEAD"])).trim()) {
		throw new Error("source changed while its snapshot was captured; retry preparation");
	}
	await git(destination, ["init", "--quiet"]);
	await git(destination, ["add", "--force", "--all"]);
	await git(destination, ["-c", "user.name=Slingshot candidate preparation", "-c", "user.email=candidate@slingshot.invalid",
		"commit", "--quiet", "--no-gpg-sign", "-m", `Candidate source snapshot\n\nOriginal HEAD: ${originalHead}\nInventory SHA-256: ${inventoryDigest}`]);
	return { originalHead, commit: (await git(destination, ["rev-parse", "HEAD"])).trim(),
		tree: (await git(destination, ["rev-parse", "HEAD^{tree}"])).trim(), inventoryDigest, files };
}

export async function requireUnchangedSnapshot(directory: string, snapshot: SourceSnapshot): Promise<void> {
	if (sha256(JSON.stringify(await inventory(directory))) !== snapshot.inventoryDigest) {
		throw new Error("candidate build changed captured source files");
	}
}
