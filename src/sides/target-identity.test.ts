// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { basicPrincipalDigest, targetDigestForPrincipal } from "./target-identity.ts";

// Committed independent vectors in the client's configuration tests at
// 79397e8aa8e28bdeb65603ca7b68ae92d36c3584, not computed by this implementation.
const basicPrincipal = "7f1a2d38b172052f2f772566d5621a3ffc7bd27576e123052c06aa89a358b739";
const cloudPrincipal = "382ce7f5c8c73b327530bdc68a98d46f59cd694293d742ca001d0e7fe106ab42";

test("independent identity framing matches the committed principal and target vectors", () => {
	expect(basicPrincipalDigest("admin")).toBe(basicPrincipal);
	expect(targetDigestForPrincipal("adobe_experience_manager_cloud_service", "https://author.example.com", cloudPrincipal))
		.toBe("5e58c9a0f31c5e8e225e34d54847639ae56d3238d001fdd0f651e5658e6a72ce");
});

test("target identity separates deployment, address and principal without concatenation ambiguity", () => {
	const target = targetDigestForPrincipal("deployment", "http://author", basicPrincipal);
	expect(targetDigestForPrincipal("other", "http://author", basicPrincipal)).not.toBe(target);
	expect(targetDigestForPrincipal("deployment", "http://other", basicPrincipal)).not.toBe(target);
	expect(targetDigestForPrincipal("deployment", "http://author", cloudPrincipal)).not.toBe(target);
	expect(targetDigestForPrincipal("a", "bc", basicPrincipal)).not.toBe(targetDigestForPrincipal("ab", "c", basicPrincipal));
	expect(basicPrincipalDigest("é")).not.toBe(basicPrincipalDigest("e\u0301"));
});

test("identity framing refuses empty fields, malformed UTF-16 and noncanonical digest input", () => {
	for (const username of ["", "\ud800"]) expect(() => basicPrincipalDigest(username)).toThrow();
	for (const digest of ["", "a".repeat(63), "A".repeat(64), "g".repeat(64), basicPrincipal + "\n"]) {
		expect(() => targetDigestForPrincipal("deployment", "http://author", digest)).toThrow();
	}
	expect(() => targetDigestForPrincipal("", "http://author", basicPrincipal)).toThrow();
	expect(() => targetDigestForPrincipal("deployment", "", basicPrincipal)).toThrow();
});
