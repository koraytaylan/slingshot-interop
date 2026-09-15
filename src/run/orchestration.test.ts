// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test, describe } from "bun:test";
import { runInterop } from "./orchestration.ts";
import { mock } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("runInterop", () => {
	test("refuses distinctly when sides are unresolved", async () => {
		const baseDir = await mkdtemp(join(tmpdir(), "interop-test-"));
		try {
			const supportDir = join(baseDir, "support");
			mkdirSync(supportDir, { recursive: true });
			
			// Create harness-values.toml
			writeFileSync(join(supportDir, "harness-values.toml"), `
[readiness]
published_runtime_seconds = 900
harness_seconds = 120
poll_interval_seconds = 2
[stop]
grace_seconds = 10
[capture]
maximum_bytes = 4194304
[label]
key = "rs.slingshot.interop"
[ports]
author = 8080
client = 8081
proxy = 8082
[severance]
chunk_bytes = 65536
[planted_result]
bytes = 10485760
property_bytes = 65536
			`);

			// Create side documents with nothing recorded (unresolved)
			writeFileSync(join(supportDir, "slingshot-side.toml"), `
side = { name = "slingshot" }
released = { version = "", path = "", digest = "" }
candidate = { path = "", digest = "", commit = "", acknowledged = false }
			`);
			writeFileSync(join(supportDir, "agent-side.toml"), `
side = { name = "agent" }
released = { version = "", path = "", digest = "" }
candidate = { path = "", digest = "", commit = "", acknowledged = false }
			`);

		// Mock container module to prove nothing is started.
		mock.module("../harness/container.ts", () => ({
			createNetwork: () => { throw new Error("Network should not be created"); },
			removeNetwork: () => Promise.resolve({ ok: true }),
			checkForLeaks: () => Promise.resolve({ ok: true }),
		}));

			const outcome = await runInterop(baseDir, {
				images: {
					"tier-sling": { identifier: "sling" },
					"client-runner": { identifier: "runner" },
				"severance-proxy": { identifier: "proxy" },
				},
			});

			expect(outcome.ok).toBe(false);
			if (outcome.ok) {
				throw new Error("Expected outcome to be a failure");
			}

			expect(outcome.reason).toBe("SIDE_UNRESOLVED");
			if (outcome.reason !== "SIDE_UNRESOLVED") {
				throw new Error("Expected reason to be SIDE_UNRESOLVED");
			}

			expect(outcome.refusals).toHaveLength(2);
			if (outcome.refusals.length !== 2) {
				throw new Error("Expected 2 refusals");
			}
			
			const slingshotRefusal = outcome.refusals.find(r => r.side === "slingshot");
			const agentRefusal = outcome.refusals.find(r => r.side === "agent");
			
			expect(slingshotRefusal).toBeDefined();
			if (!slingshotRefusal) {
				throw new Error("Slingshot refusal missing");
			}
			expect(agentRefusal).toBeDefined();
			if (!agentRefusal) {
				throw new Error("Agent refusal missing");
			}
			
			// Verify ownerSteps are named (these depend on resolveSide implementation)
			expect(typeof slingshotRefusal.ownerStep).toBe("string");
			expect(typeof agentRefusal.ownerStep).toBe("string");
		} finally {
			rmSync(baseDir, { recursive: true, force: true });
		}
	});
});

async function mkdtemp(prefix: string): Promise<string> {
	const id = Math.random().toString(36).substring(2, 15);
	const path = join(tmpdir(), `${prefix}${id}`);
	mkdirSync(path, { recursive: true });
	return path;
}
