// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { canonicalTargetAddress } from "./target-address.ts";

test("independent target address normalization follows pinned acceptance and refusal vectors", async () => {
	const vectors = Bun.TOML.parse(await Bun.file(new URL("../../support/target-address-vectors.toml", import.meta.url)).text()) as {
		accepted: { input: string; canonical: string }[]; refused: { input: string }[];
	};
	for (const vector of vectors.accepted) {
		expect(canonicalTargetAddress(vector.input)).toBe(vector.canonical);
		expect(canonicalTargetAddress(vector.canonical)).toBe(vector.canonical);
	}
	for (const vector of vectors.refused) expect(() => canonicalTargetAddress(vector.input)).toThrow();
});

test("independent address bounds accept their boundary and reject one byte or segment beyond", () => {
	const host = "a".repeat(253);
	expect(canonicalTargetAddress(`http://${host}`)).toBe(`http://${host}`);
	expect(() => canonicalTargetAddress(`http://${host}a`)).toThrow();
	const segment = "a".repeat(255);
	expect(canonicalTargetAddress(`http://host/${segment}`)).toBe(`http://host/${segment}`);
	expect(() => canonicalTargetAddress(`http://host/${segment}a`)).toThrow();
	const segments = Array(128).fill("a").join("/");
	expect(canonicalTargetAddress(`http://host/${segments}`)).toBe(`http://host/${segments}`);
	expect(() => canonicalTargetAddress(`http://host/${segments}/a`)).toThrow();
	const path = Array(8).fill(segment).join("/");
	expect(canonicalTargetAddress(`http://host/${path}`)).toBe(`http://host/${path}`);
	expect(() => canonicalTargetAddress(`http://host/${path}/a`)).toThrow();
});

test("normalization does not apply browser URL rewriting or discard malformed bytes", () => {
	for (const input of [" http://host", "http://host\n", "http://host/%00", "http://host/%7f", "http://host/%", "http://host/%zz", "http://host/\\path", "http://host/\ud800"]) {
		expect(() => canonicalTargetAddress(input)).toThrow();
	}
	expect(canonicalTargetAddress("HTTP://127.000.000.001/a%2bb")).toBe("http://127.000.000.001/a%2Bb");
});
