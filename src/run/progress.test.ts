// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// What a run says while it is running.
//
// The property worth holding is that a wait which has not finished says so, and
// that a wait which has says nothing further - the step that owns it reports
// its own outcome. Both are about lines a reader sees, so both are asserted on
// the lines rather than on timing.

import { describe, expect, test } from "bun:test";
import { WAIT_NOTICE_SECONDS, elapsedSeconds, phases, silentProgress, whileWaiting } from "./progress.ts";

describe("a run's progress", () => {
	test("a sink nobody supplies records nothing and costs nothing", async () => {
		// The sink a test or an embedding caller gets. If it threw or returned
		// something, every caller that passed no sink would have to handle it.
		expect(silentProgress("anything")).toBeUndefined();
		const value = await whileWaiting("nothing at all", silentProgress, () => Promise.resolve(7));
		expect(value).toBe(7);
	});

	test("a wait that finishes says nothing beyond what it was asked to do", async () => {
		const said: string[] = [];
		const value = await whileWaiting("a quick answer", (line) => said.push(line), () =>
			Promise.resolve("answered"),
		);
		expect(value).toBe("answered");
		// The wait owns no outcome line: the step that started it reports how it
		// went, and a second voice on the same event is a reader's confusion.
		expect(said).toEqual([]);
	});

	test("a wait that fails still stops saying it is waiting", async () => {
		// A heartbeat left running after its wait is a process that never
		// exits, which is worse than a silent run.
		const said: string[] = [];
		await expect(
			whileWaiting("something that fails", (line) => said.push(line), () =>
				Promise.reject(new Error("it failed")),
			),
		).rejects.toThrow("it failed");
		expect(said).toEqual([]);
	});

	test("a wait longer than the notice interval says it is still waiting, naming what for", async () => {
		// The one case the interval exists for: a wait a watching reader cannot
		// tell from a hang. The cadence is passed in rather than slept through,
		// so the test costs milliseconds instead of the run's own fifteen
		// seconds while asserting the same line.
		const said: string[] = [];
		const value = await whileWaiting(
			"the author runtime to answer",
			(line) => said.push(line),
			async () => {
				await Bun.sleep(120);
				return "ready";
			},
			0.05,
		);
		expect(value).toBe("ready");
		expect(said.length).toBeGreaterThanOrEqual(1);
		expect(said[0]).toContain("still waiting for the author runtime to answer");
	});

	test("the cadence a run actually waits on is the one it declares", () => {
		// A heartbeat far shorter than this would bury the steps around a
		// normal startup; far longer would let a stall look like a hang.
		expect(WAIT_NOTICE_SECONDS).toBe(15);
	});

	test("how long something has been running is a whole number of seconds and never negative", () => {
		expect(elapsedSeconds(Date.now() - 400)).toBe(0);
		expect(elapsedSeconds(Date.now() - 1500)).toBe(2);
		// A clock that moved backwards is not a negative duration; a reader
		// seeing "-3s" would be reading a defect rather than a fact.
		expect(elapsedSeconds(Date.now() + 60_000)).toBe(0);
	});
});

describe("a sequence of named steps", () => {
	test("each step says what it is as it begins", () => {
		const said: string[] = [];
		const reporter = phases((line) => said.push(line), 60);
		try {
			reporter.begin("waiting for the container");
			reporter.begin("writing the state configuration");
		} finally {
			reporter.done();
		}
		expect(said).toEqual([
			"  waiting for the container",
			"  writing the state configuration",
		]);
	});

	test("the heartbeat repeats whichever step is current, not the first one", async () => {
		// The defect this catches: reporting the first name for the whole
		// sequence, so a reader who joins during step six is told about step one.
		const said: string[] = [];
		const reporter = phases((line) => said.push(line), 0.05);
		try {
			reporter.begin("starting the container");
			await Bun.sleep(80);
			reporter.begin("installing the bundle");
			await Bun.sleep(80);
		} finally {
			reporter.done();
		}
		const notices = said.filter((line) => line.startsWith("still waiting"));
		expect(notices.length).toBeGreaterThanOrEqual(1);
		expect(notices.some((line) => line.includes("starting the container"))).toBe(true);
		expect(notices.some((line) => line.includes("installing the bundle"))).toBe(true);
	});

	test("stopping is safe to do more than once, because a failure path and a finish both reach it", async () => {
		const said: string[] = [];
		const reporter = phases((line) => said.push(line), 0.05);
		reporter.begin("something");
		reporter.done();
		reporter.done();
		const before = said.length;
		await Bun.sleep(80);
		expect(said.length).toBe(before);
	});
});
