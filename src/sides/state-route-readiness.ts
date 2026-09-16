// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// OperationLookupServlet.notYet writes Retry-After, then AgentServlet.refuse
// writes an explicitly empty body. This rejects platform error pages; it is
// not an operation-identity proof (the route intentionally conceals existence).
export async function isStateRouteRefusal(response: Response): Promise<boolean> {
	try {
		const retry = response.headers.get("retry-after") ?? "";
		if (response.status !== 404 || response.redirected || response.headers.get("content-length") !== "0"
			|| !/^[1-9][0-9]*$/.test(retry) || !Number.isSafeInteger(Number(retry))) {
			await response.body?.cancel();
			return false;
		}
		if (response.body === null) return true;
		const reader = response.body.getReader();
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) return true;
				if (chunk.value.byteLength !== 0) return false;
			}
		} finally {
			try { await reader.cancel(); } finally { reader.releaseLock(); }
		}
	} catch {
		return false;
	}
}
