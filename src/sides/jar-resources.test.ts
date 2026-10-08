// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { JarResources } from "./jar-resources.ts";
import { fixtureJar } from "./jar-test-fixture.ts";

test("stored and deflated resources have exact content and checksums", () => {
	for (const deflated of [false, true]) {
		const jar = new JarResources(fixtureJar([{ name: "index.txt", value: "hello é", deflated }]));
		expect(jar.read("index.txt")).toBe("hello é");
		expect(() => jar.read("absent")).toThrow();
	}
});
test("duplicate resources and incomplete directory records fail", () => {
	expect(() => new JarResources(fixtureJar([{ name: "same", value: "one" }, { name: "same", value: "two" }]))).toThrow();
	const original = fixtureJar([{ name: "entry", value: "content" }]);
	for (const length of [0, 1, 21, original.length - 1]) expect(() => new JarResources(original.subarray(0, length))).toThrow();
	const multipart = Buffer.from(original); multipart.writeUInt16LE(1, multipart.length - 18);
	expect(() => new JarResources(multipart)).toThrow();
});
test("local names, sizes, encryption flags, compression methods and CRC are checked", () => {
	for (const mutate of [
		(bytes: Buffer, central: number) => bytes.writeUInt32LE(0, central + 16),
		(bytes: Buffer, central: number) => bytes.writeUInt32LE(9_000_000, central + 24),
		(bytes: Buffer, central: number) => bytes.writeUInt16LE(1, central + 8),
		(bytes: Buffer, central: number) => bytes.writeUInt16LE(99, central + 10),
		(bytes: Buffer, _central: number) => bytes.writeUInt8(120, 30),
		(bytes: Buffer, central: number) => bytes.writeUInt32LE(0xfffffff0, central + 42),
	]) {
		const bytes = fixtureJar([{ name: "entry", value: "content" }]);
		mutate(bytes, bytes.readUInt32LE(bytes.length - 6));
		expect(() => new JarResources(bytes).read("entry")).toThrow();
	}
});
