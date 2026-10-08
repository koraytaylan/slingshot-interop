// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retainArtifact } from "./candidates.ts";
import { sha256 } from "./source-snapshot.ts";

test("retained artifacts are immutable by convention, addressed by bytes and never silently replaced", async () => {
	const root = await mkdtemp(join(tmpdir(), "slingshot-candidate-artifact-"));
	try {
		const input = join(root, "input");
		await writeFile(input, "candidate bytes");
		const first = await retainArtifact(root, input, "candidate.jar");
		expect(first.digest).toBe(sha256("candidate bytes"));
		expect(await readFile(first.path, "utf8")).toBe("candidate bytes");
		expect((await stat(first.path)).mode & 0o222).toBe(0);
		expect(await retainArtifact(root, input, "candidate.jar")).toEqual(first);
		await chmod(first.path, 0o644);
		await writeFile(first.path, "tampered");
		await expect(retainArtifact(root, input, "candidate.jar")).rejects.toThrow();
		expect(await readFile(first.path, "utf8")).toBe("tampered");
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("preparation command refuses incomplete arguments before building", async () => {
	const child = Bun.spawn([process.execPath, new URL("../../scripts/prepare_candidates", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
	const [status, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
	expect(status).toBe(2);
	expect(errors).toContain("CLIENT_SOURCE AGENT_SOURCE DURABLE_DESTINATION");
});
