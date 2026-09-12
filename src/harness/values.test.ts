// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, expect, test } from "bun:test";
import { loadValues } from "./values.ts";

describe("loadValues", () => {
	test("loads every declared value typed", () => {
		const values = loadValues({ maximumCapturedBytes: 4194304, harnessLabel: "rs.slingshot.interop" });
		expect(values.maximumCapturedBytes).toBe(4194304);
		expect(values.harnessLabel).toBe("rs.slingshot.interop");
	});

	test("refuses a document missing a key", () => {
		expect(() => loadValues({ maximumCapturedBytes: 4194304 })).toThrow(/harnessLabel/);
	});

	test("refuses a document carrying an extra key", () => {
		expect(() =>
			loadValues({ maximumCapturedBytes: 4194304, harnessLabel: "x", extra: 1 }),
		).toThrow(/unknown key/);
	});

	test("refuses a document that is not a table", () => {
		expect(() => loadValues(null)).toThrow();
		expect(() => loadValues([1])).toThrow();
	});
});