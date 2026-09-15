// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadValues, readValues } from "./values.ts";

const documentPath = new URL("../../support/harness-values.toml", import.meta.url);

function parseFixture(text: string): unknown {
	return Bun.TOML.parse(text);
}

describe("readValues", () => {
	test("loads every declared value typed from the committed document", () => {
		const values = readValues(documentPath.pathname);
		expect(values.readiness.publishedRuntimeSeconds).toBe(900);
		expect(values.readiness.harnessSeconds).toBe(120);
		expect(values.readiness.pollIntervalSeconds).toBe(2);
		expect(values.stop.graceSeconds).toBe(10);
		expect(values.capture.maximumBytes).toBe(4194304);
		expect(values.label.key).toBe("rs.slingshot.interop");
		expect(values.ports.author).toBe(8080);
		expect(values.ports.client).toBe(8081);
		expect(values.ports.proxy).toBe(8082);
		expect(values.severance.chunkBytes).toBe(65536);
		expect(values.plantedResult.bytes).toBe(524288);
		expect(values.plantedResult.propertyBytes).toBe(65536);
	});
});

describe("loadValues", () => {
	const complete = parseFixture(readFileSync(documentPath, "utf8"));

	test("accepts the document and returns only declared keys", () => {
		const values = loadValues(complete);
		expect(Object.keys(values).sort()).toEqual([
			"capture",
			"label",
			"plantedResult",
			"ports",
			"readiness",
			"severance",
			"stop",
		]);
	});

	test("refuses a document missing a key", () => {
		const missing = parseFixture(
			`
[capture]
maximum_bytes = 4194304
`,
		);
		expect(() => loadValues(missing)).toThrow(/missing key: readiness/);
	});

	test("refuses a document carrying an extra key", () => {
		const extra = parseFixture(
			`
[capture]
maximum_bytes = 4194304
[stop]
grace_seconds = 10
[label]
key = "rs.slingshot.interop"
[readiness]
published_runtime_seconds = 900
harness_seconds = 120
poll_interval_seconds = 2
[ports]
author = 8080
client = 8081
proxy = 8082
[severance]
chunk_bytes = 65536
[planted_result]
bytes = 10485760
property_bytes = 65536
[extra]
bytes = 1
`,
		);
		expect(() => loadValues(extra)).toThrow(/unknown key: extra/);
	});

	test("refuses a section carrying an extra key", () => {
		const extraInner = parseFixture(
			`
[capture]
maximum_bytes = 4194304
surprise = 1
[label]
key = "rs.slingshot.interop"
[readiness]
published_runtime_seconds = 900
harness_seconds = 120
poll_interval_seconds = 2
[ports]
author = 8080
client = 8081
proxy = 8082
[stop]
grace_seconds = 10
[severance]
chunk_bytes = 65536
[planted_result]
bytes = 10485760
property_bytes = 65536
`,
		);
		expect(() => loadValues(extraInner)).toThrow(/unknown key: capture.surprise/);
	});

	test("refuses a section missing a key", () => {
		const missingInner = parseFixture(
			`
[capture]
maximum_bytes = 4194304
[label]
key = "rs.slingshot.interop"
[readiness]
published_runtime_seconds = 900
harness_seconds = 120
[ports]
author = 8080
client = 8081
proxy = 8082
[stop]
grace_seconds = 10
[severance]
chunk_bytes = 65536
[planted_result]
bytes = 10485760
property_bytes = 65536
`,
		);
		expect(() => loadValues(missingInner)).toThrow(
			/missing key: readiness.pollIntervalSeconds/,
		);
	});

	test("refuses a value of the wrong type", () => {
		const wrong = parseFixture(
			`
[capture]
maximum_bytes = "4194304"
[readiness]
published_runtime_seconds = 900
harness_seconds = 120
poll_interval_seconds = 2
[label]
key = "rs.slingshot.interop"
[stop]
grace_seconds = 10
[ports]
author = 8080
client = 8081
proxy = 8082
[severance]
chunk_bytes = 65536
[planted_result]
bytes = 10485760
property_bytes = 65536
`,
		);
		expect(() => loadValues(wrong)).toThrow(/capture.maximum_bytes is not an integer/);
	});

	test("refuses a document that is not a table", () => {
		expect(() => loadValues(null)).toThrow();
		expect(() => loadValues([1])).toThrow();
	});
});