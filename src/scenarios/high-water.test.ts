// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { verifyHighWater } from "./high-water.scenario.ts";

const expected = { subscription: "following-daemon", generation: 1, digest: "a".repeat(64) };
const valid = {
	format: "slingshot.agent/1",
	transport_contract_digest: expected.digest,
	daemon_subscription_identifier: expected.subscription,
	agent_event_store_generation: expected.generation,
	high_water_cursor: "cursor-one",
};

test("high-water requires the client's closed response and exact request binding", () => {
	expect(verifyHighWater(valid, expected).ok).toBe(true);
	for (const member of Object.keys(valid)) {
		const missing: Record<string, unknown> = { ...valid };
		delete missing[member];
		expect(verifyHighWater(missing, expected).ok).toBe(false);
	}
	for (const changed of [
		{ format: "other" }, { transport_contract_digest: "b".repeat(64) },
		{ daemon_subscription_identifier: "other" }, { agent_event_store_generation: 2 },
		{ high_water_cursor: "" }, { high_water_cursor: "x".repeat(97) }, { surplus: true },
	]) {
		expect(verifyHighWater({ ...valid, ...changed }, expected).ok).toBe(false);
	}
	expect(verifyHighWater({ ...valid, high_water_cursor: "x".repeat(96) }, expected).ok).toBe(true);
	for (const cursor of [" cursor", "cursor\t", "cursor\n", "é".repeat(49)]) {
		expect(verifyHighWater({ ...valid, high_water_cursor: cursor }, expected).ok).toBe(false);
	}
});

test("the agent's current events_shown response cannot be called client-compatible", () => {
	const response = verifyHighWater({
		agent_event_store_generation: 1,
		daemon_subscription_identifier: expected.subscription,
		events_shown: 2,
	}, expected);
	expect(response.ok).toBe(false);
	if (!response.ok) expect(response.message).toContain("high_water_cursor");
	for (const malformed of [null, [], "cursor", 1]) {
		expect(verifyHighWater(malformed, expected).ok).toBe(false);
	}
});
