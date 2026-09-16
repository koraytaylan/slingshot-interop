// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Shared admission boundary for runtime and scenario JSON evidence.

export async function readBoundedJson(response: Response, maximumBytes: number): Promise<
	{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string }
> {
	try {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
			await response.body?.cancel();
			return { ok: false, message: "JSON capture requires a positive safe byte bound" };
		}
		if (response.status !== 200 || response.redirected
			|| response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
			await response.body?.cancel();
			return { ok: false, message: `JSON capture requires a direct JSON response (status ${response.status})` };
		}
		if (response.body === null) return { ok: false, message: "JSON capture returned no body" };
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		try {
			while (true) {
				const chunk = await reader.read();
				if (chunk.done) break;
				bytes += chunk.value.byteLength;
				if (bytes > maximumBytes) return { ok: false, message: "JSON response exceeds the capture byte bound" };
				chunks.push(chunk.value);
			}
		} finally {
			try { await reader.cancel(); } finally { reader.releaseLock(); }
		}
		return { ok: true, value: parseUniqueJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) };
	} catch {
		// Do not include parser excerpts: callers may be reading credential material.
		return { ok: false, message: "JSON response could not be read or decoded" };
	}
}

export function parseUniqueJson(text: string): unknown {
	// Let the native parser establish valid JSON syntax first. Then inspect
	// complete string tokens, so escaped punctuation cannot affect object scope.
	const value: unknown = JSON.parse(text);
	const scopes: ({ keys: Set<string>; expectsKey: boolean } | null)[] = [];
	for (const match of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]/g)) {
		const token = match[0];
		if (token === "{") { scopes.push({ keys: new Set(), expectsKey: true }); continue; }
		if (token === "[") { scopes.push(null); continue; }
		if (token === "}" || token === "]") { scopes.pop(); continue; }
		const scope = scopes.at(-1);
		if (!scope) continue;
		if (token === ",") { scope.expectsKey = true; continue; }
		if (scope.expectsKey && token.startsWith('"')) {
			const key: string = JSON.parse(token);
			if (scope.keys.has(key)) throw new Error("duplicate JSON member");
			scope.keys.add(key);
			scope.expectsKey = false;
		}
	}
	return value;
}
