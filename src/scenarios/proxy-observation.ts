// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { runCleanup } from "../run/cleanup.ts";

export const submissionRequestLine = "POST /bin/slingshot/agent/submit HTTP/1.1";
type ScenarioAnswer = { readonly ok: boolean; readonly message: string };

export async function withProxyDisarmed(run: () => Promise<ScenarioAnswer>, disarm: () => Promise<ScenarioAnswer>): Promise<ScenarioAnswer> {
	let answer: ScenarioAnswer;
	try { answer = await run(); }
	catch (failure) { answer = { ok: false, message: `scenario threw: ${failure instanceof Error ? failure.message : String(failure)}` }; }
	const failures = await runCleanup([{ name: "proxy disarm", run: disarm }]);
	return failures.length === 0 ? answer : { ok: false, message: `${answer.message}; cleanup: ${failures.join("; ")}` };
}

export function observedSubmissionRefusal(value: unknown, arm: string): boolean {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const counts = record["statusCounts"];
	if (counts === null || typeof counts !== "object" || Array.isArray(counts)) return false;
	const statuses = counts as Record<string, unknown>;
	return arm.length > 0 && record["arm"] === arm && record["mode"] === "observe"
		&& record["requestLine"] === submissionRequestLine && record["severed"] === 0 && record["suppressedResponseBytes"] === 0
		&& typeof record["matchedRequests"] === "number" && Number.isSafeInteger(record["matchedRequests"]) && record["matchedRequests"] > 0
		&& Object.keys(statuses).length === 1 && statuses["401"] === record["matchedRequests"];
}
