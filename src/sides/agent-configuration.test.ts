// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAgentConfigurations } from "./agent-configuration.ts";

test("all three explicit setup fixtures authenticate without an agent checkout", async () => {
	const inputs = await readAgentConfigurations();
	expect(inputs).toHaveLength(3);
	for (const input of inputs) {
		expect(input.digest).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.parse(new TextDecoder().decode(input.bytes))).toBeObject();
	}
});

test("modified, absent and unlisted setup inputs fail closed", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent-configurations-"));
	try {
		const support = new URL("../../support/", import.meta.url).pathname;
		await cp(join(support, "agent-configuration"), join(root, "agent-configuration"), { recursive: true });
		const manifest = await readFile(join(support, "agent-configuration.toml"), "utf8");
		await writeFile(join(root, "agent-configuration.toml"), manifest);
		const [first] = await readAgentConfigurations(root);
		await writeFile(join(root, "agent-configuration", first!.name), "{}");
		await expect(readAgentConfigurations(root)).rejects.toThrow("digest mismatch");
		await rm(join(root, "agent-configuration", first!.name));
		await expect(readAgentConfigurations(root)).rejects.toThrow();
		await writeFile(join(root, "agent-configuration.toml"), manifest + '"../foreign" = "bad"\n');
		await expect(readAgentConfigurations(root)).rejects.toThrow("exactly the three");
	} finally { await rm(root, { recursive: true, force: true }); }
});
