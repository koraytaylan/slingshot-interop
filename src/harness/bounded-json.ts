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

// UTF-16 code units copied into a string token by the last parseUniqueJson call.
// The native parse builds the value either way. This counts the extra token
// copy: a matcher that materializes every string, including a long value.
let recordedStringBytes = 0;

export function stringBytesCopied(): number {
	return recordedStringBytes;
}

function copiedToken(token: string): string {
	recordedStringBytes += token.length;
	return token;
}

export function parseUniqueJson(text: string): unknown {
	// Let the native parser establish valid JSON syntax first. Then inspect
	// complete string tokens, so escaped punctuation cannot affect object scope.
	const value: unknown = JSON.parse(text);
	recordedStringBytes = 0;
	const scopes: ({ keys: Set<string>; expectsKey: boolean } | null)[] = [];
	let index = 0;
	while (index < text.length) {
		const character = text[index];
		if (character === '"') {
			const start = index;
			index += 1;
			while (index < text.length) {
				if (text[index] === "\\") {
					index += index + 1 < text.length ? 2 : 1;
					continue;
				}
				if (text[index] === '"') {
					index += 1;
					break;
				}
				index += 1;
			}
			const scope = scopes.at(-1);
			if (scope?.expectsKey) {
				const key = JSON.parse(copiedToken(text.slice(start, index))) as string;
				if (scope.keys.has(key)) throw new Error("duplicate JSON member");
				scope.keys.add(key);
				scope.expectsKey = false;
			}
			continue;
		}
		index += 1;
		if (character === "{") {
			scopes.push({ keys: new Set(), expectsKey: true });
			continue;
		}
		if (character === "[") {
			scopes.push(null);
			continue;
		}
		if (character === "}" || character === "]") {
			scopes.pop();
			continue;
		}
		if (character === ",") {
			const scope = scopes.at(-1);
			if (scope) scope.expectsKey = true;
		}
	}
	return value;
}
