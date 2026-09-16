// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Error bodies are neither bounded evidence nor safe report diagnostics.
export async function refuseHttpResponse(response: Response, context: string): Promise<{
	readonly ok: false; readonly message: string;
}> {
	try { await response.body?.cancel(); }
	catch { /* A cancellation failure cannot turn an HTTP refusal into success. */ }
	return { ok: false, message: `${context}: HTTP ${response.status}` };
}
