// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fixtureDependencies, fixtureSources } from "./workflow-fixture.ts";
import { sha256 } from "./source-snapshot.ts";

const row = { name: "sling-api.jar", path: "org/example/api/1/api-1.jar", digest: "a".repeat(64) };
const second = { name: "osgi-framework.jar", path: "org/example/osgi/1/osgi-1.jar", digest: "b".repeat(64) };

test("fixture compiler inputs are exactly two unique bounded-path digest pins", () => {
	expect(fixtureDependencies({ dependency: [row, second] })).toEqual([row, second]);
	for (const mutation of [
		{ dependency: [row] }, { dependency: [row, row] }, { dependency: [row, { ...second, path: "../escape.jar" }] },
		{ dependency: [row, { ...second, path: "/absolute.jar" }] }, { dependency: [row, { ...second, path: "a//b.jar" }] },
		{ dependency: [row, { ...second, digest: "B".repeat(64) }] }, { dependency: [row, { ...second, extra: true }] },
		null, [], { dependency: [row, null] },
	]) expect(() => fixtureDependencies(mutation)).toThrow();
});

test("source provenance includes the Java implementation, bundle manifest and synthetic page types", async () => {
	const source = await fixtureSources();
	expect(source.digest).toBe(sha256(JSON.stringify({ java: sha256(source.java), manifest: sha256(source.manifest), nodetypes: sha256(source.nodetypes) })));
	expect(source.java.toString()).toContain("UUID.randomUUID()");
	expect(source.java.toString()).toContain("session.commit()");
	expect(source.manifest.toString()).toContain("Bundle-Activator: rs.slingshot.interop.fixture.CountingWorkflow");
	const pins = fixtureDependencies(Bun.TOML.parse(await readFile("support/workflow-fixture-dependencies.toml", "utf8")));
	expect(pins.map(pin => pin.name)).toEqual(["sling-api.jar", "osgi-framework.jar"]);
});
