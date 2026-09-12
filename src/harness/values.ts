// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The typed loader over support/harness-values.toml, the only place any of
// its values is read. The schema is closed in both directions: a missing key
// is refused and an unknown one is refused, so the document and the loader
// cannot drift apart quietly.

import { readFileSync } from "node:fs";

export type Values = {
	readonly readiness: {
		readonly publishedRuntimeSeconds: number;
		readonly harnessSeconds: number;
		readonly pollIntervalSeconds: number;
	};
	readonly stop: {
		readonly graceSeconds: number;
	};
	readonly capture: {
		readonly maximumBytes: number;
	};
	readonly label: {
		readonly key: string;
	};
	readonly ports: {
		readonly author: number;
		readonly client: number;
		readonly proxy: number;
	};
	readonly severance: {
		readonly chunkBytes: number;
	};
	readonly plantedResult: {
		readonly bytes: number;
	};
};

type Schema = {
	readonly [K in keyof Values]: readonly (keyof Values[K] & string)[];
};

const schema: Schema = {
	readiness: ["publishedRuntimeSeconds", "harnessSeconds", "pollIntervalSeconds"],
	stop: ["graceSeconds"],
	capture: ["maximumBytes"],
	label: ["key"],
	ports: ["author", "client", "proxy"],
	severance: ["chunkBytes"],
	plantedResult: ["bytes"],
};

const tomlSection: Record<keyof Values, string> = {
	readiness: "readiness",
	stop: "stop",
	capture: "capture",
	label: "label",
	ports: "ports",
	severance: "severance",
	plantedResult: "planted_result",
};

const tomlKey: Record<keyof Values, Record<string, string>> = {
	readiness: {
		publishedRuntimeSeconds: "published_runtime_seconds",
		harnessSeconds: "harness_seconds",
		pollIntervalSeconds: "poll_interval_seconds",
	},
	stop: { graceSeconds: "grace_seconds" },
	capture: { maximumBytes: "maximum_bytes" },
	label: { key: "key" },
	ports: { author: "author", client: "client", proxy: "proxy" },
	severance: { chunkBytes: "chunk_bytes" },
	plantedResult: { bytes: "bytes" },
};

function requireTable(document: unknown, name: string): Record<string, unknown> {
	if (document === null || typeof document !== "object" || Array.isArray(document)) {
		throw new Error(`${name} is not a table`);
	}
	return document as Record<string, unknown>;
}

function requireInteger(table: Record<string, unknown>, key: string, name: string): number {
	const value = table[key];
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`${name}.${key} is not an integer`);
	}
	return value;
}

function requireNonEmptyString(table: Record<string, unknown>, key: string, name: string): string {
	const value = table[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name}.${key} is not a non-empty string`);
	}
	return value;
}

function loadSection(
	document: Record<string, unknown>,
	section: keyof Values,
): Record<string, unknown> {
	const raw = requireTable(document[tomlSection[section]], section);
	const tomlKeys = Object.values(tomlKey[section]);
	const loaderKeys = new Set(schema[section] as readonly string[]);
	const present = new Set<string>();
	for (const key of Object.keys(raw)) {
		if (!tomlKeys.includes(key)) {
			throw new Error(`unknown key: ${section}.${key}`);
		}
		const loader = (Object.entries(tomlKey[section]) as [string, string][]).find(
			([, toml]) => toml === key,
		)![0];
		present.add(loader);
	}
	for (const key of loaderKeys) {
		if (!present.has(key)) {
			throw new Error(`missing key: ${section}.${key}`);
		}
	}
	return raw;
}

export function loadValues(document: unknown): Values {
	const root = requireTable(document, "values document");
	const knownSections = new Set(Object.values(tomlSection));
	const loaderSection = new Map(
		(Object.entries(tomlSection) as [keyof Values, string][]).map(([loader, toml]) => [toml, loader]),
	);
	const present = new Set<keyof Values>();
	for (const key of Object.keys(root)) {
		if (!knownSections.has(key)) {
			throw new Error(`unknown key: ${key}`);
		}
		present.add(loaderSection.get(key) as keyof Values);
	}
	for (const section of Object.keys(schema) as (keyof Values)[]) {
		if (!present.has(section)) {
			throw new Error(`missing key: ${section}`);
		}
	}
	const readiness = loadSection(root, "readiness");
	const stop = loadSection(root, "stop");
	const capture = loadSection(root, "capture");
	const label = loadSection(root, "label");
	const ports = loadSection(root, "ports");
	const severance = loadSection(root, "severance");
	const plantedResult = loadSection(root, "plantedResult");
	return {
		readiness: {
			publishedRuntimeSeconds: requireInteger(
				readiness,
				"published_runtime_seconds",
				"readiness",
			),
			harnessSeconds: requireInteger(readiness, "harness_seconds", "readiness"),
			pollIntervalSeconds: requireInteger(readiness, "poll_interval_seconds", "readiness"),
		},
		stop: { graceSeconds: requireInteger(stop, "grace_seconds", "stop") },
		capture: { maximumBytes: requireInteger(capture, "maximum_bytes", "capture") },
		label: { key: requireNonEmptyString(label, "key", "label") },
		ports: {
			author: requireInteger(ports, "author", "ports"),
			client: requireInteger(ports, "client", "ports"),
			proxy: requireInteger(ports, "proxy", "ports"),
		},
		severance: { chunkBytes: requireInteger(severance, "chunk_bytes", "severance") },
		plantedResult: { bytes: requireInteger(plantedResult, "bytes", "plantedResult") },
	};
}

export function readValues(path: string): Values {
	return loadValues(Bun.TOML.parse(readFileSync(path, "utf8")));
}