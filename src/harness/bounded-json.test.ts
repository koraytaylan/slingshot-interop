// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { characterVisits, parseUniqueJson } from "./bounded-json.ts";

test("a long string is accepted in one pass and keeps its characters", () => {
	const body = "b".repeat(20_000);
	const text = `{"body":"${body}"}`;
	expect(parseUniqueJson(text)).toEqual({ body });
	expect(characterVisits()).toBe(text.length);
});

test("duplicate members are refused and escaped keys stay distinct", () => {
	expect(() => parseUniqueJson(`{"a":1,"a":2}`)).toThrow("duplicate JSON member");
	expect(() => parseUniqueJson(`{"a":{"b":1,"b":2}}`)).toThrow("duplicate JSON member");
	expect(parseUniqueJson(`{"say \\"hi\\"":1,"msg":"caf\\u00e9"}`)).toEqual({
		"say \"hi\"": 1,
		msg: "café",
	});
	expect(parseUniqueJson(`{"tags":["a","a"],"n":true}`)).toEqual({ tags: ["a", "a"], n: true });
});
