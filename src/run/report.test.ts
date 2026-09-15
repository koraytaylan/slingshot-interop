// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { writeReport, type ReportData } from "./report.ts";
import { type ResolvedSide } from "../sides/pinning.ts";
import { describe, test, expect, mock, spyOn, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";

const mockSide = (name: string, version: string): ResolvedSide => ({
	source: "released",
	name: name as any,
	path: `/tmp/${name}.jar`,
	digest: "abc123digest",
	version,
});

const validData: ReportData = {
	label: "run-123",
	sides: {
		slingshot: mockSide("slingshot", "1.0.0"),
		agent: mockSide("agent", "1.0.0"),
	},
	images: {
		"tier-sling": { identifier: "sling:latest", digest: "sling-digest" },
		"client-runner": { identifier: "runner:latest", digest: "runner-digest" },
	},
	scenarios: [
		{ scenario: "auth-refusal.ts", ok: true },
		{ scenario: "unknown-outcome.ts", ok: false, message: "failed" },
	],
};

describe("writeReport", () => {
	beforeEach(() => {
		spyOn(fs, "writeFile").mockImplementation(async () => {});
	});

	afterEach(() => {
		mock.restore();
	});

	test("writes a full report when all fields are present", async () => {
		await writeReport("/tmp/work", validData);
		expect(fs.writeFile).toHaveBeenCalled();
	});

	test("refuses when label is missing", async () => {
		const invalidData = { ...validData, label: "" } as any;
		await expect(writeReport("/tmp/work", invalidData)).rejects.toThrow("missing required field: label");
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	test("refuses when slingshot side is missing", async () => {
		const invalidData = { ...validData, sides: { agent: validData.sides.agent } } as any;
		await expect(writeReport("/tmp/work", invalidData)).rejects.toThrow("missing required field: sides.slingshot");
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	test("refuses when agent side is missing", async () => {
		const invalidData = { ...validData, sides: { slingshot: validData.sides.slingshot } } as any;
		await expect(writeReport("/tmp/work", invalidData)).rejects.toThrow("missing required field: sides.agent");
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	test("refuses when images are missing", async () => {
		const invalidData = { ...validData, images: undefined } as any;
		await expect(writeReport("/tmp/work", invalidData)).rejects.toThrow("missing required field: images");
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	test("refuses when scenarios are missing", async () => {
		const invalidData = { ...validData, scenarios: undefined } as any;
		await expect(writeReport("/tmp/work", invalidData)).rejects.toThrow("missing required field: scenarios");
		expect(fs.writeFile).not.toHaveBeenCalled();
	});
});
