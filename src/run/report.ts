// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ResolvedSide } from "../sides/pinning.ts";

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
	// A report that cannot be rendered is a run whose result nobody can read,
	// so it refuses rather than writing an absent document: the TOML writer
	// answers nothing for a value it cannot render, and silently skipping the
	// write would leave a run that reported success with no report on disk.
	const toml = Bun.TOML.stringify(data);
	if (toml === undefined) {
		throw new Error(`the run report ${reportPath} could not be rendered as TOML`);
	}
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
