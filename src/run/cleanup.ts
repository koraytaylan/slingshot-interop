// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// One failed cleanup action must not prevent the remaining resources from
// being released, nor erase the failure from the run's evidence.
export async function runCleanup(steps: readonly {
	readonly name: string;
	readonly run: () => Promise<{ readonly ok: boolean; readonly message?: string } | void>;
}[]): Promise<string[]> {
	const failures: string[] = [];
	for (const step of steps) {
		try {
			const result = await step.run();
			if (result && !result.ok) failures.push(`${step.name}: ${result.message ?? "refused"}`);
		} catch (failure) {
			failures.push(`${step.name}: ${failure instanceof Error ? failure.message : String(failure)}`);
		}
	}
	return failures;
}
