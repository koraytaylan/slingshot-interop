// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { requireUnchangedSnapshot, sha256, snapshotSource } from "./source-snapshot.ts";
import { verifyReleaseArchive } from "../sides/client-runtime.ts";

async function run(directory: string, command: readonly string[], log: string, environment: NodeJS.ProcessEnv = process.env): Promise<void> {
	console.error(`prepare: ${command[0]} ${command.slice(1).join(" ")} (log: ${log})`);
	const child = Bun.spawn([...command], { cwd: directory, env: environment,
		stdin: "ignore", stdout: Bun.file(log), stderr: Bun.file(`${log}.stderr`) });
	const status = await child.exited;
	if (status !== 0) throw new Error(`candidate preparation failed (${status}); inspect ${log}`);
}

async function archive(directory: string, output: string, members: readonly string[], log: string): Promise<void> {
	await run(directory, ["tar", "--format=ustar", "--sort=name", "--mtime=@0", "--owner=0", "--group=0",
		"--numeric-owner", "-czf", output, "--", ...members], log);
}

export async function retainArtifact(destination: string, source: string, name: string): Promise<{ path: string; digest: string }> {
	const bytes = await readFile(source);
	const digest = sha256(bytes);
	const directory = join(destination, "artifacts", digest);
	await mkdir(directory, { recursive: true });
	const path = join(directory, name);
	try { await writeFile(path, bytes, { flag: "wx", mode: 0o444 }); }
	catch (failure) {
		if ((failure as NodeJS.ErrnoException).code !== "EEXIST" || sha256(await readFile(path)) !== digest) throw failure;
	}
	return { path, digest };
}

// Preparation builds candidates; it grants no holder acknowledgement and edits
// no live pin. The manifest distinguishes source snapshots from original HEADs.
async function preparedMaven(agent: string): Promise<string> {
	const properties = await readFile(join(agent, ".mvn/wrapper/maven-wrapper.properties"), "utf8");
	const url = properties.split("\n").find(line => line.startsWith("distributionUrl="))?.slice("distributionUrl=".length).trim();
	if (url === undefined || !url.endsWith("-bin.zip")) throw new Error("unsupported Maven distribution pin");
	// Match the checked-in wrapper's cache key, then call the prepared Maven
	// directly. A missing wrapper distribution must never trigger a download.
	let hash = 0;
	for (const character of url) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
	const name = url.slice(url.lastIndexOf("/") + 1).replace(/-bin\.zip$/, "");
	const executable = join(process.env["MAVEN_USER_HOME"] ?? join(homedir(), ".m2"), "wrapper", "dists", name, hash.toString(16), "bin", "mvn");
	try { await access(executable); }
	catch { throw new Error(`prepare the pinned Maven distribution before building candidates: ${executable}`); }
	return executable;
}

export async function prepareCandidates(clientPath: string, agentPath: string, destinationPath: string): Promise<string> {
	const destination = resolve(destinationPath);
	await mkdir(join(destination, "preparations"), { recursive: true });
	const work = await mkdtemp(join(destination, "preparations", "pair-"));
	const sources = join(work, "sources");
	await mkdir(sources);
	const client = join(sources, "slingshot");
	const agent = join(sources, "slingshot-agent");
	const clientSource = await snapshotSource(resolve(clientPath), client);
	const agentSource = await snapshotSource(resolve(agentPath), agent);
	await writeFile(join(work, "source-provenance.json"), JSON.stringify({ client: clientSource, agent: agentSource }, null, 2) + "\n");
	for (const [name, directory] of [["client", client], ["agent", agent]] as const) {
		// The complete Git snapshot is durable and contains its commit object.
		await archive(directory, join(work, `${name}-source.tar.gz`), ["."], join(work, `${name}-source-archive.log`));
	}
	const maven = await preparedMaven(agent);
	await run(client, ["cargo", "--version"], join(work, "cargo-version.log"));
	await run(client, ["rustc", "--version", "--verbose"], join(work, "rustc-version.log"));
	await run(agent, [maven, "--version"], join(work, "maven-version.log"));
	const clientBuild = ["cargo", "build", "--locked", "--offline", "--release", "-p", "slingshot-command-line", "--bin", "slingshot"];
	const target = join(work, "client-target");
	await run(client, clientBuild, join(work, "client-build.log"), { ...process.env, CARGO_NET_OFFLINE: "true", CARGO_TARGET_DIR: target });
	const agentBuild = [maven, "--offline", "--batch-mode", "--no-transfer-progress",
		`-Dmaven.repo.local=${resolve(agentPath, ".dependency-cache")}`, "-pl", "core", "-am", "-DskipTests", "package"];
	await run(agent, agentBuild, join(work, "agent-build.log"));
	await requireUnchangedSnapshot(client, clientSource);
	await requireUnchangedSnapshot(agent, agentSource);
	const packageDirectory = join(work, "client-package");
	await mkdir(packageDirectory);
	const executable = join(packageDirectory, "slingshot");
	await copyFile(join(target, "release", "slingshot"), executable);
	await chmod(executable, 0o755);
	await writeFile(join(packageDirectory, "SHA256SUMS"), `${sha256(await readFile(executable))}  slingshot\n`);
	const clientArchive = join(work, "slingshot-linux-x64.tar.gz");
	await archive(packageDirectory, clientArchive, ["SHA256SUMS", "slingshot"], join(work, "client-package.log"));
	const clientArtifact = await retainArtifact(destination, clientArchive, "slingshot-linux-x64.tar.gz");
	const verified = await verifyReleaseArchive(clientArtifact.path, clientArtifact.digest);
	if (!verified.ok) throw new Error(verified.message);
	const jars = (await readdir(join(agent, "core", "target"))).filter(name => /^slingshot-agent-core-[0-9].*\.jar$/.test(name) && !name.endsWith("-sources.jar") && !name.endsWith("-javadoc.jar"));
	if (jars.length !== 1) throw new Error(`expected one built core bundle, found ${jars.length}`);
	const agentArtifact = await retainArtifact(destination, join(agent, "core", "target", jars[0]!), "slingshot-agent-core.jar");
	const artifacts = { slingshot: clientArtifact, agent: agentArtifact };
	for (const [name, source] of [["slingshot", clientSource], ["agent", agentSource]] as const) {
		const pin = Bun.TOML.stringify({ side: { name }, released: { version: "", path: "", digest: "" },
			candidate: { ...artifacts[name], commit: source.commit, acknowledged: false } });
		if (pin === undefined) throw new Error("candidate pin could not be rendered");
		await writeFile(join(work, `${name}-side.proposed.toml`), pin);
	}
	const sourceArchives = {
		client: await retainArtifact(destination, join(work, "client-source.tar.gz"), "client-source.tar.gz"),
		agent: await retainArtifact(destination, join(work, "agent-source.tar.gz"), "agent-source.tar.gz"),
	};
	const manifest = { sourceArchives, format: "slingshot.candidate-preparation/1", clientSource, agentSource, artifacts,
		builds: { client: clientBuild, agent: agentBuild },
		tooling: { cargo: await readFile(join(work, "cargo-version.log"), "utf8"),
			rustc: await readFile(join(work, "rustc-version.log"), "utf8"), maven: await readFile(join(work, "maven-version.log"), "utf8") },
		verification: { archive: "passed", qualityGates: "not run by preparation", integration: "pending", holderAcknowledgements: "pending" } };
	const report = join(work, "candidates.json");
	await writeFile(report, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
	return report;
}
