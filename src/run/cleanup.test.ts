// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana
import { expect, test } from "bun:test";
import { runCleanup } from "./cleanup.ts";

test("cleanup attempts every step and retains refusals and exceptions", async () => {
	const attempted: string[] = [];
	const failures = await runCleanup([
		{ name: "stop", run: async () => { attempted.push("stop"); throw new Error("cannot stop"); } },
		{ name: "remove", run: async () => { attempted.push("remove"); return { ok: false, message: "still present" }; } },
		{ name: "network", run: async () => { attempted.push("network"); return { ok: true }; } },
	]);
	expect(attempted).toEqual(["stop", "remove", "network"]);
	expect(failures).toEqual(["stop: cannot stop", "remove: still present"]);
});
