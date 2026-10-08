// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { readBoundedFile } from "../harness/bounded-file.ts";
import { runPodman } from "../harness/podman.ts";
import { retainArtifact } from "./candidates.ts";
import { sha256 } from "./source-snapshot.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = join(root, "fixtures/counting-workflow");
const maximumInputBytes = 64 * 1024 * 1024;
const captureLimitBytes = 1024 * 1024;
const commandMilliseconds = 60_000;

export type FixtureDependency = { readonly name: string; readonly path: string; readonly digest: string };

export function fixtureDependencies(value: unknown): FixtureDependency[] {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid fixture dependency table");
	const rows = (value as Record<string, unknown>)["dependency"];
	if (!Array.isArray(rows) || rows.length !== 2) throw new Error("expected the two compile-only fixture APIs");
	const names = new Set<string>();
	return rows.map((row: unknown) => {
		if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("invalid fixture dependency");
		const fields = row as Record<string, unknown>;
		const { name, path, digest } = fields;
		if (Object.keys(fields).length !== 3 || typeof name !== "string" || !/^[a-z-]+\.jar$/.test(name)
			|| typeof path !== "string" || !/^[A-Za-z0-9._/-]+\.jar$/.test(path) || path.startsWith("/")
			|| path.split("/").some(part => part === ".." || part === "." || part === "")
			|| typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest) || names.has(name)) throw new Error("unsafe or duplicate fixture dependency");
		names.add(name);
		return { name, path, digest };
	});
}

export async function fixtureSources(): Promise<{ java: Buffer; manifest: Buffer; nodetypes: Buffer; digest: string }> {
	const java = await readFile(join(fixtureRoot, "CountingWorkflow.java"));
	const manifest = await readFile(join(fixtureRoot, "MANIFEST.MF"));
	const nodetypes = await readFile(join(fixtureRoot, "interop-pages.cnd"));
	return { java, manifest, nodetypes, digest: sha256(JSON.stringify({ java: sha256(java), manifest: sha256(manifest), nodetypes: sha256(nodetypes) })) };
}

async function verifiedBytes(path: string, digest: string): Promise<Buffer> {
	if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("expected a canonical input digest");
	const bytes = await readBoundedFile(path, maximumInputBytes);
	if (sha256(bytes) !== digest) throw new Error(`fixture input digest mismatch: ${path}`);
	return bytes;
}

// Builds only a test platform seam. The candidate jar is an immutable compile
// input; no live author is contacted and no holder acknowledgement is granted.
export async function prepareWorkflowFixture(agentPath: string, agentDigest: string, cachePath: string, destinationPath: string): Promise<string> {
	const destination = resolve(destinationPath);
	await mkdir(join(destination, "preparations"), { recursive: true });
	const work = await mkdtemp(join(destination, "preparations", "workflow-"));
	if (work.includes(":")) throw new Error("fixture build destination cannot contain a volume separator");
	const sources = await fixtureSources();
	const dependencies = await fixtureDependencyPins();
	const compilerImage = await fixtureCompilerImage();
	await writeFile(join(work, "CountingWorkflow.java"), sources.java);
	await mkdir(join(work, "resources/SLING-INF"), { recursive: true });
	await writeFile(join(work, "resources/SLING-INF/interop-pages.cnd"), sources.nodetypes);
	await writeFile(join(work, "agent.jar"), await verifiedBytes(resolve(agentPath), agentDigest));
	for (const dependency of dependencies) await writeFile(join(work, dependency.name), await verifiedBytes(join(resolve(cachePath), dependency.path), dependency.digest));
	const manifest = `${sources.manifest.toString("utf8").trimEnd()}\nSlingshot-Agent-SHA256: ${agentDigest}\nSlingshot-Fixture-Source-SHA256: ${sources.digest}\n\n`;
	await writeFile(join(work, "MANIFEST.MF"), manifest);
	await mkdir(join(work, "classes"));
	const commands = [
		["/opt/java/openjdk/bin/javac", "--release", "21", "-Xlint:all", "-Werror", "-classpath", ["agent.jar", ...dependencies.map(row => row.name)].join(":"), "-d", "classes", "CountingWorkflow.java"],
		["/opt/java/openjdk/bin/jar", "--create", "--file", "counting-workflow.jar", "--manifest", "MANIFEST.MF", "--date=2000-01-01T00:00:00Z", "-C", "classes", ".", "-C", "resources", "."],
	];
	for (const [index, command] of commands.entries()) {
		const name = `slingshot-fixture-${randomUUID()}`;
		const captureDirectory = join(work, `command-${index}`);
		await mkdir(captureDirectory);
		let failure: string | undefined;
		try {
			const result = await runPodman(["run", "--name", name, "--rm", "--network", "none", "--pull", "never", "--volume", `${work}:/fixture:rw`, "--workdir", "/fixture", compilerImage, ...command], {
				captureDirectory, captureLimitBytes, requireCompleteCapture: true, deadline: Date.now() + commandMilliseconds,
			});
			if (!result.ok) failure = result.message;
		} finally {
			const cleanupDirectory = join(work, `cleanup-${index}`);
			await mkdir(cleanupDirectory);
			const removed = await runPodman(["rm", "--force", "--ignore", name], { captureDirectory: cleanupDirectory, captureLimitBytes, deadline: Date.now() + commandMilliseconds });
			if (!removed.ok) failure = [failure, `fixture container cleanup: ${removed.message}`].filter(Boolean).join("; ");
		}
		if (failure !== undefined) throw new Error(failure);
	}
	if ((await fixtureSources()).digest !== sources.digest) throw new Error("fixture source changed during compilation");
	const artifact = await retainArtifact(destination, join(work, "counting-workflow.jar"), "counting-workflow.jar");
	const receipt = { format: "slingshot.workflow-fixture/1", ...artifact, agentDigest, sourceDigest: sources.digest, compilerImage, dependencies, commands, scope: "Test-only non-idempotent platform seam and minimal synthetic page node types; no platform page API or workflow engine; no integration run or holder acknowledgement." };
	const path = join(work, "workflow-fixture.json");
	await writeFile(path, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
	return path;
}

export async function fixtureDependencyPins(): Promise<FixtureDependency[]> {
	return fixtureDependencies(Bun.TOML.parse(await readFile(join(root, "support/workflow-fixture-dependencies.toml"), "utf8")));
}

export async function fixtureCompilerImage(): Promise<string> {
	const images = Bun.TOML.parse(await readFile(join(root, "support/interop-images.toml"), "utf8")) as Record<string, Record<string, unknown>>;
	const image = images["java-runtime"]?.["reference"];
	if (typeof image !== "string" || !/^[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/.test(image)) throw new Error("fixture compiler image is not digest pinned");
	return image;
}
