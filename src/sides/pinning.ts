// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The typed loader and resolver over the per-side pinning documents. The
// schema is closed in both directions, like src/harness/values.ts: a missing
// key is refused and an unknown one is refused, so the documents and this
// loader cannot drift apart quietly.
//
// Resolution is total: a side resolves to its candidate when the bytes are
// present, the digest matches, the pin names an exact commit, and the holder
// acknowledged; otherwise to the released recording when one exists; otherwise
// it refuses with one of six distinct refusals, each naming what the owner
// must do. Nothing here builds, fetches, or caches a sibling.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type SideName = "slingshot" | "agent";

export type SideDocument = {
	readonly side: {
		readonly name: string;
	};
	readonly released: {
		readonly version: string;
		readonly path: string;
		readonly digest: string;
	};
	readonly candidate: {
		readonly path: string;
		readonly digest: string;
		readonly commit: string;
		readonly acknowledged: boolean;
	};
};

type Schema = {
	readonly [K in keyof Omit<SideDocument, "side">]: readonly string[];
};

const schema: Schema = {
	released: ["version", "path", "digest"],
	candidate: ["path", "digest", "commit", "acknowledged"],
};

// The commit pin must name a commit, not a branch, a tag, or a range: a
// 40-hex object name is the only form this harness accepts, because a result
// is about exactly the bytes a report names.
const commitPattern = /^[0-9a-f]{40}$/;

export type ResolvedSide =
	| { readonly source: "candidate"; readonly name: SideName; readonly path: string; readonly digest: string; readonly commit: string }
	| { readonly source: "released"; readonly name: SideName; readonly path: string; readonly digest: string; readonly version: string };

export type RefusalKind =
	| "bytes-absent"
	| "candidate-digest-differing"
	| "commit-not-a-commit"
	| "not-acknowledged"
	| "no-released-recording"
	| "released-digest-differing";

// Each refusal is a distinct type carrying what the owner must do, so a run
// report can name the fix rather than a generic failure.
export type Refusal =
	| { readonly kind: "bytes-absent"; readonly side: SideName; readonly path: string; readonly ownerStep: string }
	| { readonly kind: "candidate-digest-differing"; readonly side: SideName; readonly path: string; readonly pinnedDigest: string; readonly actualDigest: string; readonly ownerStep: string }
	| { readonly kind: "commit-not-a-commit"; readonly side: SideName; readonly commit: string; readonly ownerStep: string }
	| { readonly kind: "not-acknowledged"; readonly side: SideName; readonly path: string; readonly ownerStep: string }
	| { readonly kind: "no-released-recording"; readonly side: SideName; readonly ownerStep: string }
	| { readonly kind: "released-digest-differing"; readonly side: SideName; readonly path: string; readonly pinnedDigest: string; readonly actualDigest: string; readonly ownerStep: string };

export type SideResolution = { readonly resolved: ResolvedSide } | { readonly refused: Refusal };

export const ownerSteps: Record<RefusalKind, string> = {
	"bytes-absent":
		"place the missing bytes at the recorded path, or clear the slot recording them, or record the other slot",
	"candidate-digest-differing":
		"re-record the candidate digest over the bytes now on disk, or replace the bytes with the ones the digest names",
	"commit-not-a-commit":
		"record the exact 40-hex commit the candidate was built from",
	"not-acknowledged":
		"acknowledge the candidate, as only the holder can, or remove the candidate slot",
	"no-released-recording":
		"acknowledge the candidate or record a release in the released slot; the harness builds, fetches, and caches nothing",
	"released-digest-differing":
		"replace the released bytes with the ones the recorded digest names, or re-record the digest over the bytes now on disk",
};

function requireTable(document: unknown, name: string): Record<string, unknown> {
	if (document === null || typeof document !== "object" || Array.isArray(document)) {
		throw new Error(`${name} is not a table`);
	}
	return document as Record<string, unknown>;
}

export function loadSideDocument(document: unknown): SideDocument {
	const root = requireTable(document, "side document");
	const knownSections = new Set(["side", "released", "candidate"]);
	for (const key of Object.keys(root)) {
		if (!knownSections.has(key)) {
			throw new Error(`unknown key: ${key}`);
		}
	}
	const side = requireTable(root["side"], "side");
	const released = requireTable(root["released"], "released");
	const candidate = requireTable(root["candidate"], "candidate");
	for (const [section, table] of [["side", side], ["released", released], ["candidate", candidate]] as const) {
		const expected = section === "side" ? ["name"] : schema[section];
		for (const key of Object.keys(table)) {
			if (!expected.includes(key)) {
				throw new Error(`unknown key: ${section}.${key}`);
			}
		}
		for (const key of expected) {
			if (!(key in table)) {
				throw new Error(`missing key: ${section}.${key}`);
			}
		}
	}
	const name = side["name"];
	if (typeof name !== "string" || name.length === 0) {
		throw new Error("side.name is not a non-empty string");
	}
	// The two sides are the whole world of this harness, so a document naming
	// anything else cannot resolve under a name it does not carry.
	if (name !== "slingshot" && name !== "agent") {
		throw new Error(`side.name is neither "slingshot" nor "agent": ${name}`);
	}
	const stringKeys = [
		["released", "version"],
		["released", "path"],
		["released", "digest"],
		["candidate", "path"],
		["candidate", "digest"],
		["candidate", "commit"],
	] as const;
	for (const [section, key] of stringKeys) {
		const value = requireTable(root[section], section)[key];
		if (typeof value !== "string") {
			throw new Error(`${section}.${key} is not a string`);
		}
	}
	if (typeof candidate["acknowledged"] !== "boolean") {
		throw new Error("candidate.acknowledged is not a boolean");
	}
	return {
		side: { name: name as SideName },
		released: {
			version: released["version"] as string,
			path: released["path"] as string,
			digest: released["digest"] as string,
		},
		candidate: {
			path: candidate["path"] as string,
			digest: candidate["digest"] as string,
			commit: candidate["commit"] as string,
			acknowledged: candidate["acknowledged"] as boolean,
		},
	};
}

export function readSideDocument(path: string): SideDocument {
	return loadSideDocument(Bun.TOML.parse(readFileSync(path, "utf8")));
}

// Digests are compared over the bytes themselves, never over metadata, so a
// run proves the bytes on disk are the bytes a pin names.
export function digestOf(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// The candidate wins over a recorded release exactly when everything is in
// place. A recorded candidate's defect (missing bytes, a commit pin that is
// not a commit, a missing acknowledgement, a digest that differs) refuses the
// run even when a valid release is recorded; only an absent candidate (an
// empty candidate path) falls back to the released recording, and when no
// release is recorded either, the run refuses.
export function resolveSide(
	side: SideName,
	document: SideDocument,
	baseDirectory: string,
): SideResolution {
	const candidate = document.candidate;
	if (candidate.path.length > 0) {
		const path = resolve(baseDirectory, candidate.path);
		if (!existsSync(path)) {
			return {
				refused: {
					kind: "bytes-absent",
					side,
					path: candidate.path,
					ownerStep: ownerSteps["bytes-absent"],
				},
			};
		}
		if (candidate.commit.length === 0 || !commitPattern.test(candidate.commit)) {
			return {
				refused: {
					kind: "commit-not-a-commit",
					side,
					commit: candidate.commit,
					ownerStep: ownerSteps["commit-not-a-commit"],
				},
			};
		}
		if (!candidate.acknowledged) {
			return {
				refused: {
					kind: "not-acknowledged",
					side,
					path: candidate.path,
					ownerStep: ownerSteps["not-acknowledged"],
				},
			};
		}
		const actual = digestOf(path);
		if (actual !== candidate.digest) {
			return {
				refused: {
					kind: "candidate-digest-differing",
					side,
					path: candidate.path,
					pinnedDigest: candidate.digest,
					actualDigest: actual,
					ownerStep: ownerSteps["candidate-digest-differing"],
				},
			};
		}
		return {
			resolved: {
				source: "candidate",
				name: side,
				path: candidate.path,
				digest: candidate.digest,
				commit: candidate.commit,
			},
		};
	}
	const released = document.released;
	// An incomplete recording (any slot empty) is no recording at all: the
	// committed documents carry explicit absent values, and a partially filled
	// slot is an owner's unfinished edit, not a resolvable release.
	if (released.version.length === 0 || released.path.length === 0 || released.digest.length === 0) {
		return {
			refused: {
				kind: "no-released-recording",
				side,
				ownerStep: ownerSteps["no-released-recording"],
			},
		};
	}
	const path = resolve(baseDirectory, released.path);
	if (!existsSync(path)) {
		return {
			refused: {
				kind: "bytes-absent",
				side,
				path: released.path,
				ownerStep: ownerSteps["bytes-absent"],
			},
		};
	}
	const actual = digestOf(path);
	if (actual !== released.digest) {
		return {
			refused: {
				kind: "released-digest-differing",
				side,
				path: released.path,
				pinnedDigest: released.digest,
				actualDigest: actual,
				ownerStep: ownerSteps["released-digest-differing"],
			},
		};
	}
	return {
		resolved: {
			source: "released",
			name: side,
			path: released.path,
			digest: released.digest,
			version: released.version,
		},
	};
}