// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { envelope, type Invocation } from "./support.ts";

// The CLI can settle during submission, including its detached status read.
// A caller-supplied key remains the local operation identifier in that case.
// Subsequent observation and agent lookup independently verify that binding.
export function submittedOperation(answer: Invocation, key: string) {
    const parsed = envelope(answer.stdout, "submission");
    if (!parsed.ok) return { ok: false as const, message: `${parsed.message}; exit ${answer.exitCode}; stderr: ${answer.stderr.slice(0, 1200)}` };
    const accepted = parsed.outcome === "operation_receipt" || parsed.outcome === "operation_result" || parsed.outcome === "structured_result_artifact_access";
    const failed = parsed.outcome === "operation_terminal_error";
    const recovery = parsed.outcome === "operation_recovery_required";
    if (!(accepted && answer.exitCode === 0 || failed && [3, 4, 5, 6].includes(answer.exitCode) || recovery && answer.exitCode === 5)) {
        return { ok: false as const, message: `submission exited ${answer.exitCode}: ${answer.stdout}` };
    }
    if (parsed.operation_identifier !== undefined && parsed.operation_identifier !== key) {
        return { ok: false as const, message: "submission returned a different operation identifier" };
    }
    if (parsed.outcome === "operation_receipt" && parsed.operation_identifier !== key) {
        return { ok: false as const, message: "submission receipt has no operation identifier" };
    }
    return { ok: true as const, operation_identifier: key };
}
