// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { HttpResponseStatus } from "./http-response-status.ts";

test("HTTP status evidence survives every first-line byte split", () => {
	const line = Buffer.from("HTTP/1.1 401 Unauthorized\r\n");
	for (let split = 0; split < line.length; split++) {
		const observer = new HttpResponseStatus();
		expect(observer.read(line.subarray(0, split))).toBeUndefined();
		expect(observer.read(line.subarray(split))).toBe(401);
		expect(observer.read(Buffer.from("HTTP/1.1 200 OK\r\n"))).toBe(401);
	}
});

test("only a valid first response line is status evidence", () => {
	for (const line of ["HTTP/1.0 401 Unauthorized\r\n", "HTTP/2 401 Unauthorized\r\n", "HTTP/1.1 401\r\n",
		"HTTP/1.1 4010 Unauthorized\r\n", "HTTP/1.1 099 Invalid\r\n", "HTTP/1.1 600 Invalid\r\n",
		"HTTP/1.1 401 Unauthorizéd\r\n", "HTTP/1.1 100 Continue\r\n", "garbage\r\n"]) {
		const observer = new HttpResponseStatus();
		expect(observer.read(Buffer.from(line + "HTTP/1.1 401 Unauthorized\r\n"))).toBeUndefined();
		expect(observer.read(Buffer.from("HTTP/1.1 401 Unauthorized\r\n"))).toBeUndefined();
	}
	const observer = new HttpResponseStatus();
	expect(observer.read(Buffer.from("HTTP/1.1 403 Forbidden\r\nX-Secret: do-not-record\r\n\r\nHTTP/1.1 401 Unauthorized\r\n"))).toBe(403);
	expect(JSON.stringify(observer)).not.toContain("do-not-record");
	for (const status of [200, 299, 301, 401, 500, 599]) {
		expect(new HttpResponseStatus().read(Buffer.from(`HTTP/1.1 ${status} \r\n`))).toBe(status);
	}
});

test("status-line length is bounded and later bytes cannot rescue overflow", () => {
	const prefix = "HTTP/1.1 401 ";
	const exact = prefix + "x".repeat(HttpResponseStatus.maximumLineBytes - prefix.length - 2) + "\r\n";
	expect(new HttpResponseStatus().read(Buffer.from(exact))).toBe(401);
	const observer = new HttpResponseStatus();
	expect(observer.read(Buffer.from(prefix + "x".repeat(HttpResponseStatus.maximumLineBytes)))).toBeUndefined();
	expect(observer.read(Buffer.from("\r\nHTTP/1.1 401 Unauthorized\r\n"))).toBeUndefined();
	expect(JSON.stringify(observer)).not.toContain("xxx");
});
