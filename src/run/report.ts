// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ResolvedSide } from "../sides/pinning.ts";

export type ScenarioOutcome = {
	readonly scenario: string;
	readonly ok: boolean;
	readonly message?: string;
	readonly reason?: string;
};

export type ReportData = {
	readonly label: string;
	readonly sides: {
		readonly slingshot: ResolvedSide;
		readonly agent: ResolvedSide;
	};
	readonly images: Record<string, {
		readonly identifier: string;
		readonly digest: string;
	}>;
	readonly scenarios: readonly ScenarioOutcome[];
};

export async function writeReport(
	workDirectory: string,
	data: ReportData,
): Promise<void> {
	// Validate all required fields
	validateReportData(data);

	const reportPath = join(workDirectory, `${data.label}.toml`);
	const toml = Bun.TOML.stringify(data);
	await writeFile(reportPath, toml);
}

function validateReportData(data: ReportData): void {
	if (!data.label) {
		throw new Error("missing required field: label");
	}
	if (!data.sides?.slingshot) {
		throw new Error("missing required field: sides.slingshot");
	}
	if (!data.sides?.agent) {
		throw new Error("missing required field: sides.agent");
	}
	if (!data.images) {
		throw new Error("missing required field: images");
	}
	if (!Array.isArray(data.scenarios)) {
		throw new Error("missing required field: scenarios");
	}
}
