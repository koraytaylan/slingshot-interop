// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The forgery token the harness plants at Adobe's CSRF route, and the check
// the severance proxy applies to state-changing agent POSTs. The Sling starter
// carries neither Granite's token filter nor Sling's referrer filter, so a
// planted JSON file without this check is a token nobody validates.

export const PLANTED_FORGERY_TOKEN = "slingshot-interop-token";

export const TOKEN_HEADER = "CSRF-Token";

export const REFERER_HEADER = "Referer";

export const TOKEN_ROUTE = "/libs/granite/csrf/token.json";

const protectedPost = /^POST \/bin\/slingshot\/agent\/[A-Za-z0-9._/-]+ HTTP\/1\.1$/;

const headDelimiter = Buffer.from("\r\n\r\n");

const lineDelimiter = Buffer.from("\r\n");

export const maximumForgeryHeadBytes = 16384;

export type ForgeryInspection =
	| { readonly kind: "incomplete" }
	| { readonly kind: "not-protected" }
	| { readonly kind: "ok" }
	| { readonly kind: "refused"; readonly reason: "head-too-long" | "forgery-headers" };

export function isProtectedAgentPost(requestLine: string): boolean {
	return protectedPost.test(requestLine);
}

export function inspectAgentPostForgery(bytes: Buffer, token: string): ForgeryInspection {
	const lineEnd = bytes.indexOf(lineDelimiter);
	if (lineEnd >= 0) {
		const line = bytes.subarray(0, lineEnd).toString("utf8");
		if (!isProtectedAgentPost(line)) {
			return { kind: "not-protected" };
		}
	}
	const headEnd = bytes.indexOf(headDelimiter);
	if (headEnd < 0) {
		return bytes.length >= maximumForgeryHeadBytes ? { kind: "refused", reason: "head-too-long" } : { kind: "incomplete" };
	}
	const head = bytes.subarray(0, headEnd).toString("utf8");
	return forgeryHeadersSatisfied(head, token) ? { kind: "ok" } : { kind: "refused", reason: "forgery-headers" };
}

export function forgeryHeadersSatisfied(head: string, token: string): boolean {
	const headers = new Map<string, string>();
	for (const line of head.split("\r\n").slice(1)) {
		const separator = line.indexOf(":");
		if (separator < 0) {
			continue;
		}
		headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
	}
	return headers.get(TOKEN_HEADER.toLowerCase()) === token && (headers.get(REFERER_HEADER.toLowerCase()) ?? "").length > 0;
}

export const forgeryRefusalHead = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
