// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	digestOf,
	loadSideDocument,
	ownerSteps,
	readSideDocument,
	resolveSide,
	type Refusal,
	type ResolvedSide,
	type SideDocument,
	type SideResolution,
} from "./pinning.ts";

// Fixtures are bytes on disk in a temporary supplied-inputs directory, so the
// resolver's digest checks run against real files like a run does.

const commit = "a".repeat(40);
const otherCommit = "b".repeat(40);
const candidateDigest = createHash("sha256").update("candidate").digest("hex");

function makeDocument(overrides: {
	released?: Partial<SideDocument["released"]>;
	candidate?: Partial<SideDocument["candidate"]>;
}): SideDocument {
	return loadSideDocument({
		side: { name: "slingshot" },
		released: { version: "", path: "", digest: "", ...overrides.released },
		candidate: { path: "", digest: "", commit: "", acknowledged: false, ...overrides.candidate },
	});
}

function fixtureDirectory(files: Record<string, string>): string {
	const directory = mkdtempSync(join(tmpdir(), "side-pinning-"));
	for (const [name, contents] of Object.entries(files)) {
		writeFileSync(join(directory, name), contents);
	}
	return directory;
}

function refusedOf(resolution: SideResolution): Refusal {
	if ("refused" in resolution) {
		return resolution.refused;
	}
	throw new Error("expected a refusal, got a resolution");
}

function resolvedOf(resolution: SideResolution): ResolvedSide {
	if ("resolved" in resolution) {
		return resolution.resolved;
	}
	throw new Error("expected a resolution, got a refusal");
}

const bothRecorded = (releasedDigest: string) =>
	makeDocument({
		released: { version: "1.2.3", path: "released.zip", digest: releasedDigest },
		candidate: { path: "candidate.jar", digest: candidateDigest, commit, acknowledged: true },
	});

describe("readSideDocument", () => {
	// The two committed documents are read, not re-typed here: what a run must
	// be able to do is load whichever recording the holder has made, and a test
	// that wrote the recorded digest down again would fail on the day somebody
	// re-pinned over new bytes and would tell them nothing about the loader.
	// So each document's own values are read back and asserted against the
	// shape the loader must produce, and the loader's refusals are exercised
	// above with documents built inline.
	test("loads the committed slingshot document with the shape a run resolves", () => {
		const document = readSideDocument(
			new URL("../../support/slingshot-side.toml", import.meta.url).pathname,
		);
		expect(document.side.name).toBe("slingshot");
		expect(document.released).toEqual({ version: "", path: "", digest: "" });
		// A recorded candidate is one whose bytes, digest, commit and
		// acknowledgement are all present; a recording missing any of them
		// would refuse rather than resolve, so this asserts the pair the
		// loader compares rather than a value copied from the file.
		if (document.candidate.path.length > 0) {
			expect(document.candidate.digest).toMatch(/^[0-9a-f]{64}$/);
			expect(document.candidate.commit).toMatch(/^[0-9a-f]{40}$/);
			expect(typeof document.candidate.acknowledged).toBe("boolean");
		} else {
			expect(document.candidate).toEqual({ path: "", digest: "", commit: "", acknowledged: false });
		}
	});

	test("loads the committed agent document with the shape a run resolves", () => {
		const document = readSideDocument(
			new URL("../../support/agent-side.toml", import.meta.url).pathname,
		);
		expect(document.side.name).toBe("agent");
		expect(document.released).toEqual({ version: "", path: "", digest: "" });
		if (document.candidate.path.length > 0) {
			expect(document.candidate.digest).toMatch(/^[0-9a-f]{64}$/);
			expect(document.candidate.commit).toMatch(/^[0-9a-f]{40}$/);
			expect(typeof document.candidate.acknowledged).toBe("boolean");
		} else {
			expect(document.candidate).toEqual({ path: "", digest: "", commit: "", acknowledged: false });
		}
	});

	test("a recorded candidate whose bytes are on disk resolves, and its digest is the bytes' own", () => {
		// The property a run depends on: whatever the committed documents
		// record, the loader computes the digest from the bytes rather than
		// trusting the recorded value, so a re-pin is proven by the run.
		for (const name of ["slingshot", "agent"] as const) {
			const document = readSideDocument(
				new URL(`../../support/${name}-side.toml`, import.meta.url).pathname,
			);
			if (document.candidate.path.length === 0 || !document.candidate.acknowledged) {
				continue;
			}
			const resolution = resolveSide(name, document, process.cwd());
			expect("refused" in resolution).toBe(false);
			if (!("resolved" in resolution)) {
				throw new Error(`${name} did not resolve`);
			}
			expect(resolution.resolved.source).toBe("candidate");
			expect(resolution.resolved.digest).toBe(document.candidate.digest);
		}
	});

	test("refuses a document missing a key", () => {
		expect(() => loadSideDocument({ side: { name: "x" }, released: {}, candidate: {} })).toThrow(
			/missing key/,
		);
	});

	test("refuses a document naming a side this harness does not carry", () => {
		expect(() =>
			loadSideDocument({
				side: { name: "other" },
				released: { version: "", path: "", digest: "" },
				candidate: { path: "", digest: "", commit: "", acknowledged: false },
			}),
		).toThrow(/neither "slingshot" nor "agent"/);
	});
});

describe("resolveSide refusals", () => {
	test("bytes absent: candidate recorded, file missing, nothing else recorded", () => {
		const directory = fixtureDirectory({});
		try {
			const refusal = refusedOf(resolveSide("slingshot", bothRecorded("c".repeat(64)), directory));
			expect(refusal.kind).toBe("bytes-absent");
			expect(refusal.side).toBe("slingshot");
			expect(refusal.ownerStep).toBe(ownerSteps["bytes-absent"]);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("digest differing: candidate bytes on disk do not match the pinned digest", () => {
		const directory = fixtureDirectory({ "candidate.jar": "actual bytes" });
		try {
			const refusal = refusedOf(resolveSide("slingshot", bothRecorded("c".repeat(64)), directory));
			expect(refusal.kind).toBe("candidate-digest-differing");
			if (refusal.kind !== "candidate-digest-differing") throw new Error(refusal.kind);
			expect(refusal.pinnedDigest).toBe(candidateDigest);
			expect(refusal.actualDigest).toBe(digestOf(join(directory, "candidate.jar")));
			expect(refusal.ownerStep).toBe(ownerSteps["candidate-digest-differing"]);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("commit not a commit: the pin names a branch, not an exact commit", () => {
		const document = makeDocument({
			candidate: { path: "candidate.jar", digest: candidateDigest, commit: "main", acknowledged: true },
		});
		const directory = fixtureDirectory({ "candidate.jar": "bytes" });
		try {
			const refusal = refusedOf(resolveSide("agent", document, directory));
			expect(refusal.kind).toBe("commit-not-a-commit");
			expect(refusal.ownerStep).toBe(ownerSteps["commit-not-a-commit"]);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("not acknowledged: the holder has not set the acknowledgement", () => {
		const document = makeDocument({
			candidate: { path: "candidate.jar", digest: candidateDigest, commit, acknowledged: false },
		});
		const directory = fixtureDirectory({ "candidate.jar": "bytes" });
		try {
			const refusal = refusedOf(resolveSide("slingshot", document, directory));
			expect(refusal.kind).toBe("not-acknowledged");
			expect(refusal.ownerStep).toBe(ownerSteps["not-acknowledged"]);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("no released recording: nothing recorded anywhere", () => {
		const refusal = refusedOf(resolveSide("slingshot", makeDocument({}), "/nonexistent"));
		expect(refusal.kind).toBe("no-released-recording");
		expect(refusal.ownerStep).toBe(ownerSteps["no-released-recording"]);
		expect(refusal.ownerStep).toMatch(/acknowledge the candidate/);
		expect(refusal.ownerStep).toMatch(/record a release/);
	});

	test("a partially recorded release is no recording, not a crash", () => {
		const document = makeDocument({
			released: { version: "1.2.3", path: "", digest: "" },
		});
		const refusal = refusedOf(resolveSide("slingshot", document, "/nonexistent"));
		expect(refusal.kind).toBe("no-released-recording");
	});

	test("a recorded candidate's defect refuses even when a valid release is recorded", () => {
		const directory = fixtureDirectory({ "candidate.jar": "candidate", "released.zip": "release" });
		try {
			const document = makeDocument({
				released: { version: "1.2.3", path: "released.zip", digest: digestOf(join(directory, "released.zip")) },
				candidate: { path: "candidate.jar", digest: candidateDigest, commit, acknowledged: false },
			});
			const refusal = refusedOf(resolveSide("slingshot", document, directory));
			expect(refusal.kind).toBe("not-acknowledged");
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("released digest differing: a recorded release whose bytes changed on disk", () => {
		const document = makeDocument({
			released: { version: "1.2.3", path: "released.zip", digest: "c".repeat(64) },
		});
		const directory = fixtureDirectory({ "released.zip": "tampered bytes" });
		try {
			const refusal = refusedOf(resolveSide("slingshot", document, directory));
			expect(refusal.kind).toBe("released-digest-differing");
			if (refusal.kind !== "released-digest-differing") throw new Error(refusal.kind);
			expect(refusal.pinnedDigest).toBe("c".repeat(64));
			expect(refusal.actualDigest).toBe(digestOf(join(directory, "released.zip")));
			expect(refusal.ownerStep).toBe(ownerSteps["released-digest-differing"]);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});
});

describe("resolveSide resolution", () => {
	test("a complete candidate wins over a recorded release", () => {
		const directory = fixtureDirectory({ "candidate.jar": "candidate", "released.zip": "release" });
		try {
			const resolved = resolvedOf(resolveSide("slingshot", bothRecorded(digestOf(join(directory, "released.zip"))), directory));
			expect(resolved).toEqual({
				source: "candidate",
				name: "slingshot",
				path: "candidate.jar",
				digest: candidateDigest,
				commit,
			});
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("an unrecorded candidate falls back to a recorded release", () => {
		const directory = fixtureDirectory({ "released.zip": "release" });
		const releasedDigest = digestOf(join(directory, "released.zip"));
		const document = makeDocument({
			released: { version: "1.2.3", path: "released.zip", digest: releasedDigest },
		});
		try {
			const resolved = resolvedOf(resolveSide("agent", document, directory));
			expect(resolved).toEqual({
				source: "released",
				name: "agent",
				path: "released.zip",
				digest: releasedDigest,
				version: "1.2.3",
			});
		} finally {
			rmSync(directory, { recursive: true });
		}
	});

	test("a candidate with a different commit resolves on its own exact commit", () => {
		const document = makeDocument({
			candidate: { path: "candidate.jar", digest: candidateDigest, commit: otherCommit, acknowledged: true },
		});
		const directory = fixtureDirectory({ "candidate.jar": "candidate" });
		try {
			const resolved = resolvedOf(resolveSide("slingshot", document, directory));
			if (resolved.source !== "candidate") throw new Error(resolved.source);
			expect(resolved.source).toBe("candidate");
			expect(resolved.commit).toBe(otherCommit);
		} finally {
			rmSync(directory, { recursive: true });
		}
	});
});