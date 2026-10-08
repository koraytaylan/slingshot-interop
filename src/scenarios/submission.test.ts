// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { submittedOperation } from "./submission.ts";

function submit(outcome: string, exitCode: number, fields = {}) {
	return submittedOperation({ ok: true, exitCode, stdout: JSON.stringify({ outcome, ...fields }), stderr: "" }, "owned");
}

test("an empty submission preserves its process-start diagnostic", () => {
	const result = submittedOperation({ ok: true, stdout: "", stderr: "container process could not start", exitCode: 126 }, "owned");
	expect(result.ok).toBe(false);
	if (!result.ok) {
		expect(result.message).toContain("exit 126");
		expect(result.message).toContain("container process could not start");
	}
});

test("submission preserves the supplied operation key for receipts and settled answers", () => {
	for (const [outcome, exit] of [["operation_result", 0], ["structured_result_artifact_access", 0], ["operation_terminal_error", 3], ["operation_terminal_error", 4], ["operation_terminal_error", 5], ["operation_terminal_error", 6], ["operation_recovery_required", 5]] as const) {
		expect(submit(outcome, exit)).toEqual({ ok: true, operation_identifier: "owned" });
	}
	expect(submit("operation_receipt", 0, { operation_identifier: "owned" })).toEqual({ ok: true, operation_identifier: "owned" });
});

test("submission refuses wrong identifiers, missing receipts, usage and inconsistent exits", () => {
	for (const outcome of ["operation_receipt", "operation_result", "operation_terminal_error", "operation_recovery_required"]) {
		expect(submit(outcome, 0, { operation_identifier: "foreign" }).ok).toBe(false);
		expect(submit(outcome, 2).ok).toBe(false);
	}
	expect(submit("operation_receipt", 0).ok).toBe(false);
	expect(submit("operation_result", 3).ok).toBe(false);
	expect(submit("operation_terminal_error", 0).ok).toBe(false);
	expect(submit("operation_recovery_required", 0).ok).toBe(false);
	expect(submit("usage_error", 0).ok).toBe(false);
	expect(submittedOperation({ ok: true, stdout: "{}", stderr: "", exitCode: 0 }, "owned").ok).toBe(false);
});
