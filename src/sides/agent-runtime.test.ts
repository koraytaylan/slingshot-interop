// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { createNetwork, checkForLeaks, removeNetwork } from "../harness/container.ts";
import { readValues } from "../harness/values.ts";
import {
	bundleSymbolicName,
	installBundle,
	startSlingRuntime,
	type StartSlingRuntimeOptions,
} from "./agent-runtime.ts";

// Two kinds of proof. The stub-server test proves the install request's own
// shape — authenticated, the jar's bytes as the body, the console's install
// route — with nothing but a local HTTP server on the other end. The
// integration test runs against the built tier-sling image and proves a
// planted jar that installs but can never resolve: installed it is, active it
// never becomes, and the wait refuses at the values-declared deadline naming
// the state the bundle actually ended in.

const values = readValues(new URL("../../support/harness-values.toml", import.meta.url).pathname);

// The built image's identifier, read from the one place it is recorded —
// support/interop-images.toml — never restated here.
function builtImage(): string {
	const document = Bun.TOML.parse(
		readFileSync(new URL("../../support/interop-images.toml", import.meta.url).pathname, "utf8"),
	) as { "tier-sling": { name: string; tag: string; identifier: string } };
	return `${document["tier-sling"].name}@${document["tier-sling"].identifier}`;
}

describe("the install request against a stub server", () => {
	test(
		"is authenticated and carries the jar's bytes as the body",
		async () => {
			let seenAuthorization = "";
			let seenMethod = "";
			let seenPath = "";
			let seenContentType = "";
			let seenBody = new Uint8Array();
			const server = Bun.serve({
				port: 0,
				async fetch(request) {
					seenAuthorization = request.headers.get("authorization") ?? "";
					seenMethod = request.method;
					seenPath = new URL(request.url).pathname;
					seenContentType = request.headers.get("content-type") ?? "";
					seenBody = new Uint8Array(await request.arrayBuffer());
					return new Response(null, { status: 302 });
				},
			});
			try {
				const jarPath = join(await mkdtemp(join(tmpdir(), "agent-runtime-")), "bundle.jar");
				const jarBytes = crypto.getRandomValues(new Uint8Array(1024));
				await writeFile(jarPath, jarBytes);
				const options = stubOptions(jarPath, `http://127.0.0.1:${server.port}`);
				const outcome = await installBundle(0, options);
				expect(outcome.ok).toBe(true);
				// The route is the platform's own console route, the credentials
				// are basic authentication, and the body is the jar's exact bytes
				// in a multipart form the console accepts.
				expect(seenMethod).toBe("POST");
				expect(seenPath).toBe("/system/console/bundles");
				const expected = `Basic ${Buffer.from("admin:console-password", "utf8").toString("base64")}`;
				expect(seenAuthorization).toBe(expected);
				expect(seenContentType).toContain("multipart/form-data");
				expect(seenBody.length).toBeGreaterThan(jarBytes.length);
				// The jar's bytes travel inside the multipart body untouched:
				// search the body for the exact random payload.
				const found = findSubsequence(seenBody, jarBytes);
				expect(found).toBe(true);
			} finally {
				server.stop(true);
			}
		},
	);
});

function stubOptions(jarPath: string, root: string): StartSlingRuntimeOptions {
	return {
		image: builtImage(),
		values,
		network: "unused",
		labelValue: "unused",
		consoleDeadline: new Date(Date.now() + values.readiness.publishedRuntimeSeconds * 1000),
		activeDeadline: new Date(Date.now() + values.readiness.publishedRuntimeSeconds * 1000),
		bundleJarPath: jarPath,
		consoleUsername: "admin",
		consolePassword: "console-password",
		consoleBase: root,
	};
}

function findSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
	outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) {
				continue outer;
			}
		}
		return true;
	}
	return false;
}

// A syntactically valid OSGi bundle whose one import can never be satisfied:
// it installs cleanly and never resolves, which is exactly the case the
// active-state wait exists to catch. The jar is a real zip: the manifest
// entry is deflated with zlib's own compressor, so the reader's parse is
// exercised on genuine deflate bytes, not a stream written in a shape chosen
// to please it.
function unresolvableJar(symbolicName: string): Uint8Array {
	const manifest = `Manifest-Version: 1.0\r\nBundle-Name: Planted Unresolvable Bundle\r\nBundle-SymbolicName: ${symbolicName}\r\nBundle-Version: 1.0.0\r\nImport-Package: org.entropy.does.not.exist.anywhere.at.all\r\n\r\n`;
	return realZipJar(Buffer.from(manifest, "utf8"));
}

// A single-entry zip with the given manifest bytes deflated by zlib's own
// compressor.
function realZipJar(manifestBytes: Buffer): Uint8Array {
	const compressed = deflateRawSync(manifestBytes);
	const crc32 = (data: Uint8Array): number => {
		let crc = 0xffffffff;
		for (const byte of data) {
			crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
		}
		return (crc ^ 0xffffffff) >>> 0;
	};
	const nameBytes = Buffer.from("META-INF/MANIFEST.MF", "utf8");
	const crc = crc32(manifestBytes);
	const parts: Uint8Array[] = [];
	const local: number[] = [
		0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 8, 0, 0, 0, 0, 0, 0,
	];
	const push16 = (array: number[], v: number) => array.push(v & 0xff, (v >> 8) & 0xff);
	const push32 = (array: number[], v: number) =>
		array.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
	push32(local, crc);
	push32(local, compressed.length);
	push32(local, manifestBytes.length);
	push16(local, nameBytes.length);
	push16(local, 0);
	const localHeader = new Uint8Array([...local, ...nameBytes]);
	parts.push(localHeader, compressed);
	const centralArray: number[] = [
		0x50, 0x4b, 0x01, 0x02, 0x14, 0, 0x14, 0, 0, 0, 8, 0, 0, 0, 0, 0,
	];
	push32(centralArray, crc);
	push32(centralArray, compressed.length);
	push32(centralArray, manifestBytes.length);
	push16(centralArray, nameBytes.length);
	push16(centralArray, 0);
	push16(centralArray, 0);
	push16(centralArray, 0);
	push16(centralArray, 0);
	push32(centralArray, 0);
	push32(centralArray, 0);
	const centralHeader = new Uint8Array([...centralArray, ...nameBytes]);
	const centralOffset = localHeader.length + compressed.length;
	const endArray: number[] = [
		0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0,
	];
	push16(endArray, 1);
	push16(endArray, 1);
	push32(endArray, centralHeader.length);
	push32(endArray, centralOffset);
	push16(endArray, 0);
	parts.push(centralHeader, new Uint8Array(endArray));
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}
	const zip = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		zip.set(part, offset);
		offset += part.length;
	}
	return zip;
}

// CRC-32 per the zip format, table computed once.
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

// A jar whose Bundle-SymbolicName is folded across manifest continuation
// lines: the OSGi/JAR rule unfolds by removing the line break and the single
// leading space, so the symbolic name reads back whole — as the live console
// lists it — not with a space inserted at every fold.
test(
	"the manifest's folded Bundle-SymbolicName unfolds without inserted spaces",
	async () => {
		const manifest = [
			"Manifest-Version: 1.0",
			"Bundle-SymbolicName: com.fasterxml.jackson.dataformat.jackson-dataform",
			" at-xml",
			"Bundle-Version: 2.21.1",
			"",
			"",
		].join("\r\n");
		const jar = realZipJar(Buffer.from(manifest, "utf8"));
		const directory = await mkdtemp(join(tmpdir(), "agent-runtime-fold-"));
		const jarPath = join(directory, "folded.jar");
		await writeFile(jarPath, jar);
		try {
			expect(await bundleSymbolicName(jarPath)).toBe(
				"com.fasterxml.jackson.dataformat.jackson-dataformat-xml",
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	10_000,
);

describe("the planted jar against the built tier-sling image", () => {
	const labelValue = `agent-runtime-test-${process.pid}-${Date.now()}`;
	const captureLimit = values.capture.maximumBytes;
	let directory: string | null = null;
	let jarPath = "";

	beforeAll(async () => {
		directory = await mkdtemp(join(tmpdir(), "agent-runtime-integration-"));
		jarPath = join(directory, "unresolvable.jar");
		await writeFile(jarPath, unresolvableJar("org.example.planted.unresolvable"));
	});

	afterAll(async () => {
		if (directory !== null) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test(
		"the jar installs, never becomes active, and the wait refuses at the declared deadline naming the captured state",
		async () => {
			expect(await bundleSymbolicName(jarPath)).toBe("org.example.planted.unresolvable");
			const network = `agent-runtime-test-net-${process.pid}`;
			const networkOutcome = await createNetwork(network, {
				labelKey: values.label.key,
				labelValue,
				captureLimitBytes: captureLimit,
				captureDirectory: directory!,
			});
			expect(networkOutcome.ok).toBe(true);
			try {
				// A short absolute deadline is itself declared by the values the
				// test reads: the poll interval, and a wait bound a small multiple
				// of it — the machinery must honor the declared instant, not a
				// hidden fixed timeout.
				const activeDeadline = new Date(Date.now() + 6 * values.readiness.pollIntervalSeconds * 1000);
				const options: StartSlingRuntimeOptions = {
					image: builtImage(),
					values,
					network,
					labelValue,
					consoleDeadline: new Date(Date.now() + values.readiness.publishedRuntimeSeconds * 1000),
					activeDeadline,
					bundleJarPath: jarPath,
					consoleUsername: "admin",
					consolePassword: "admin",
					captureDirectory: directory!,
				};
				const before = Date.now();
				const outcome = await startSlingRuntime(options);
				const elapsed = Date.now() - before;
				expect(outcome.ok).toBe(false);
				if (outcome.ok) {
					throw new Error("the unresolvable bundle unexpectedly became active");
				}
				expect(outcome.reason).toBe("NEVER_BECAME_READY");
				// The refusal lands at the declared deadline, not before and not
				// on some hidden bound of its own.
				expect(elapsed).toBeGreaterThanOrEqual(6 * values.readiness.pollIntervalSeconds * 1000);
				expect(elapsed).toBeLessThan(120_000);
				// It names what the bundle actually became: installed, stuck in
				// the Installed state, never Active.
				expect(outcome.message).toContain("Installed");
				expect(outcome.message).toContain("org.example.planted.unresolvable");
				expect(outcome.message).toContain("did not become active");
				if (!("message" in outcome) || !("reason" in outcome)) {
					throw new Error("unexpected refusal shape");
				}
			} finally {
				const leaks = await checkForLeaks({
					labelKey: values.label.key,
					labelValue,
					captureLimitBytes: captureLimit,
					captureDirectory: directory!,
				});
				if (!leaks.ok) {
					for (const id of leaks.containers) {
						await Bun.spawn(["podman", "rm", "-f", "-t", "0", id]).exited;
					}
				}
				await removeNetwork(network, {
					captureLimitBytes: captureLimit,
					captureDirectory: directory!,
				});
			}
		},
		240_000,
	);
});