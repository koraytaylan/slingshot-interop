// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// A value every bound this harness holds is read through, so one file says what
// the defaults are and no code carries one.

export type Values = {
	readonly maximumCapturedBytes: number;
	readonly harnessLabel: string;
};

export function loadValues(document: unknown): Values {
	const record = document as Record<string, unknown> | null;
	if (record === null || typeof record !== "object" || Array.isArray(document)) {
		throw new Error("values document is not a table");
	}
	const known = new Set(["maximumCapturedBytes", "harnessLabel"]);
	for (const key of Object.keys(record)) {
		if (!known.has(key)) {
			throw new Error(`unknown key: ${key}`);
		}
	}
	const maximumCapturedBytes = record["maximumCapturedBytes"];
	if (typeof maximumCapturedBytes !== "number" || !Number.isInteger(maximumCapturedBytes)) {
		throw new Error("maximumCapturedBytes is not an integer");
	}
	const harnessLabel = record["harnessLabel"];
	if (typeof harnessLabel !== "string" || harnessLabel.length === 0) {
		throw new Error("harnessLabel is not a non-empty string");
	}
	return { maximumCapturedBytes, harnessLabel };
}