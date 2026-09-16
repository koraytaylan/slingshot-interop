// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { isIPv6 } from "node:net";

// Independent normalization for the pinned profile-authentication contract in
// target-identity.ts. Do not use WHATWG URL: it rewrites numeric hosts, dot
// segments and default ports that this contract preserves or refuses.
const bounds = { address: 4096, host: 253, path: 2048, segment: 255, segments: 128 };
const unreserved = /^[A-Za-z0-9._~-]$/;
const literalSegment = /^[A-Za-z0-9._~!$&'()*+,;=:@-]$/;

function refuse(): never {
	throw new Error("author address does not match the pinned target identity contract");
}

function canonicalSegment(segment: string): string {
	if (!segment || segment === "." || segment === ".." || segment.length > bounds.segment) return refuse();
	let canonical = "";
	for (let index = 0; index < segment.length; index += 1) {
		const character = segment[index]!;
		if (character !== "%") {
			if (!literalSegment.test(character)) return refuse();
			canonical += character;
			continue;
		}
		const escape = segment.slice(index + 1, index + 3);
		if (!/^[0-9a-fA-F]{2}$/.test(escape)) return refuse();
		const byte = Number.parseInt(escape, 16);
		if (byte < 32 || byte === 127 || byte === 47 || byte === 92 || unreserved.test(String.fromCharCode(byte))) return refuse();
		canonical += `%${escape.toUpperCase()}`;
		index += 2;
	}
	return canonical;
}

export function canonicalTargetAddress(address: string): string {
	if (!address || address.length > bounds.address || /[^\x21-\x7e]/.test(address)) return refuse();
	const parts = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(address);
	if (!parts) return refuse();
	const scheme = parts[1]!.toLowerCase();
	const authority = parts[2]!;
	const hostAndPort = authority.startsWith("[")
		? /^(\[[0-9a-fA-F:]+\])(?::([0-9]+))?$/.exec(authority)
		: /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::([0-9]+))?$/.exec(authority);
	if (!hostAndPort || hostAndPort[1]!.length > bounds.host) return refuse();
	const host = hostAndPort[1]!.toLowerCase();
	if (host.startsWith("[") && !isIPv6(host.slice(1, -1))) return refuse();
	const portText = hostAndPort[2];
	let port = "";
	if (portText !== undefined) {
		const numericPort = Number(portText);
		if (portText.startsWith("0") || !Number.isInteger(numericPort) || numericPort > 65535
			|| numericPort === (scheme === "http" ? 80 : 443)) return refuse();
		port = `:${numericPort}`;
	}
	const path = parts[3] ?? "";
	if (!path || path === "/") return `${scheme}://${host}${port}`;
	if (path.length > bounds.path) return refuse();
	const segments = path.slice(1).split("/");
	if (segments.length > bounds.segments) return refuse();
	return `${scheme}://${host}${port}/${segments.map(canonicalSegment).join("/")}`;
}
