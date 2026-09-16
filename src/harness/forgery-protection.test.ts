// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, expect, test } from "bun:test";
import {
	PLANTED_FORGERY_TOKEN,
	TOKEN_HEADER,
	TOKEN_ROUTE,
	forgeryHeadersSatisfied,
	forgeryRefusalHead,
	inspectAgentPostForgery,
	isProtectedAgentPost,
} from "./forgery-protection.ts";

describe("protected agent posts", () => {
	test("only state-changing agent routes are protected", () => {
		expect(isProtectedAgentPost("POST /bin/slingshot/agent/submit HTTP/1.1")).toBe(true);
		expect(isProtectedAgentPost("POST /bin/slingshot/agent/subscriptions/high-water HTTP/1.1")).toBe(true);
		expect(isProtectedAgentPost("GET /bin/slingshot/agent/capabilities HTTP/1.1")).toBe(false);
		expect(isProtectedAgentPost("POST /submit HTTP/1.1")).toBe(false);
		expect(isProtectedAgentPost("GET /libs/granite/csrf/token.json HTTP/1.1")).toBe(false);
	});
});

describe("forgery header inspection", () => {
	test("a planted token and a referrer satisfy the check", () => {
		const head = [
			"POST /bin/slingshot/agent/submit HTTP/1.1",
			`${TOKEN_HEADER}: ${PLANTED_FORGERY_TOKEN}`,
			"Referer: http://severance-proxy:8082/",
			"Host: severance-proxy",
		].join("\r\n");
		expect(forgeryHeadersSatisfied(head, PLANTED_FORGERY_TOKEN)).toBe(true);
	});

	test("an absent token, a foreign token, or an absent referrer is refused", () => {
		const base = ["POST /bin/slingshot/agent/submit HTTP/1.1", "Host: severance-proxy"];
		expect(forgeryHeadersSatisfied(base.join("\r\n"), PLANTED_FORGERY_TOKEN)).toBe(false);
		expect(forgeryHeadersSatisfied([...base, "Referer: http://severance-proxy:8082/"].join("\r\n"), PLANTED_FORGERY_TOKEN)).toBe(false);
		expect(
			forgeryHeadersSatisfied(
				[...base, `${TOKEN_HEADER}: other-token`, "Referer: http://severance-proxy:8082/"].join("\r\n"),
				PLANTED_FORGERY_TOKEN,
			),
		).toBe(false);
		expect(forgeryHeadersSatisfied([...base, `${TOKEN_HEADER}: ${PLANTED_FORGERY_TOKEN}`].join("\r\n"), PLANTED_FORGERY_TOKEN)).toBe(false);
	});

	test("a capabilities GET is not held for headers", () => {
		const bytes = Buffer.from("GET /bin/slingshot/agent/capabilities HTTP/1.1\r\nHost: author\r\n");
		expect(inspectAgentPostForgery(bytes, PLANTED_FORGERY_TOKEN)).toEqual({ kind: "not-protected" });
	});

	test("a protected POST without a complete head is incomplete, then refused or accepted", () => {
		const prefix = Buffer.from("POST /bin/slingshot/agent/submit HTTP/1.1\r\nHost: author\r\n");
		expect(inspectAgentPostForgery(prefix, PLANTED_FORGERY_TOKEN)).toEqual({ kind: "incomplete" });
		const refused = Buffer.from(`${prefix.toString("utf8")}\r\n`);
		expect(inspectAgentPostForgery(refused, PLANTED_FORGERY_TOKEN)).toEqual({ kind: "refused", reason: "forgery-headers" });
		const accepted = Buffer.from(
			`POST /bin/slingshot/agent/submit HTTP/1.1\r\n${TOKEN_HEADER}: ${PLANTED_FORGERY_TOKEN}\r\nReferer: http://author/\r\n\r\n`,
		);
		expect(inspectAgentPostForgery(accepted, PLANTED_FORGERY_TOKEN)).toEqual({ kind: "ok" });
	});

	test("the planted route spelling is the Adobe one the client fetches", () => {
		expect(TOKEN_ROUTE).toBe("/libs/granite/csrf/token.json");
	});

	test("the shipped proxy Containerfile copies the CSRF check into the image", () => {
		const containerfile = Bun.file(new URL("../../interop/severance-proxy/Containerfile", import.meta.url));
		return containerfile.text().then((text) => {
			expect(text).toContain("COPY src/harness/forgery-protection.ts /opt/severance-proxy/forgery-protection.ts");
			expect(text).toContain("COPY src/harness/severance-proxy.ts /opt/severance-proxy/severance-proxy.ts");
		});
	});

	test("a refused forgery is a 403, never a successful admission", () => {
		expect(forgeryRefusalHead.startsWith("HTTP/1.1 403 ")).toBe(true);
		expect(/^HTTP\/1\.1 2\d\d /.test(forgeryRefusalHead)).toBe(false);
	});
});
