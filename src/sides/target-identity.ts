// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { createHash } from "node:crypto";

// Independent oracle for the profile-authentication contract at client commit
// 79397e8aa8e28bdeb65603ca7b68ae92d36c3584. Its exact manifest bytes hash to this
// value. These literals pin the supported identity contract; they are not read
// from the candidate, its database, or an ambient sibling checkout at runtime.
// A different contract requires an explicit oracle review, not auto-discovery.
const contractDigest = "c6f35b255b37d6898b13c7a25e6e8de424bcf3b730e18bbb5cbc9dff3ef9eff8";

function textBytes(value: string): Buffer {
	const bytes = Buffer.from(value, "utf8");
	if (bytes.length === 0 || bytes.toString("utf8") !== value) throw new Error("identity field must be nonempty UTF-8 text");
	return bytes;
}

function rawDigest(value: string): Buffer {
	if (value.length !== 64 || /[^0-9a-f]/.test(value)) throw new Error("identity digest must be canonical lowercase SHA-256");
	return Buffer.from(value, "hex");
}

function identityDigest(domain: string, fields: readonly (readonly [string, Buffer])[]): string {
	const hash = createHash("sha256");
	hash.update(domain, "utf8");
	const frameLength = (length: number): Buffer => {
		const encoded = Buffer.alloc(8);
		encoded.writeBigUInt64BE(BigInt(length));
		return encoded;
	};
	for (const [name, value] of fields) {
		const nameBytes = textBytes(name);
		hash.update(frameLength(nameBytes.length));
		hash.update(nameBytes);
		hash.update(Buffer.from([1])); // Present field, followed by its byte length.
		hash.update(frameLength(value.length));
		hash.update(value);
	}
	return hash.digest("hex");
}

export function basicPrincipalDigest(username: string): string {
	return identityDigest("slingshot.authentication-principal/1", [
		["authentication_method", textBytes("basic")],
		["user_name", textBytes(username)],
	]);
}

// Address canonicalization belongs to the caller. This hashes the exact
// canonical address, not a URL library's potentially different normalization.
export function targetDigestForPrincipal(deployment: string, canonicalAuthorAddress: string, principalDigest: string): string {
	return identityDigest("slingshot.author-target/1", [
		["profile_authentication_contract_digest", rawDigest(contractDigest)],
		["deployment", textBytes(deployment)],
		["author_base_address", textBytes(canonicalAuthorAddress)],
		["authentication_principal_identity", rawDigest(principalDigest)],
	]);
}
