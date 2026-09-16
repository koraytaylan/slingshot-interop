// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { parseMachineEnvelope } from "./client-runtime.ts";

const receipt = { outcome: "operation_receipt", operation_identifier: "retained-one" };
const encoded = JSON.stringify(receipt);

test("one complete machine envelope is read without discarding evidence", () => {
	expect(parseMachineEnvelope(`${encoded}\n`)).toEqual(receipt);
	expect(parseMachineEnvelope(`\n ${JSON.stringify(receipt, null, 2)} \n`)).toEqual(receipt);
});

test("multiple answers and stdout contamination cannot be reduced to the first success", () => {
	for (const stdout of [
		`${encoded}\n${encoded}`, `${encoded}\n{"outcome":"local_application_error"}`,
		`unexpected output\n${encoded}`, `${encoded}\nunexpected output`,
	]) expect(parseMachineEnvelope(stdout)).toBeNull();
});

test("a machine envelope is an object with a nonempty outcome tag", () => {
	for (const stdout of ["", "null", "[]", "7", '"text"', "{}", '{"outcome":null}',
		'{"outcome":7}', '{"outcome":""}', '{"outcome":[]}', '{"outcome":']) {
		expect(parseMachineEnvelope(stdout)).toBeNull();
	}
});

test.each([
		'{"outcome":"local_application_error","outcome":"operation_result"}',
		'{"outcome":"operation_receipt","operation_identifier":"other","operation_identifier":"retained-one"}',
		'{"outcome":"operation_result","result":{"path":"/wrong","pa\\u0074h":"/expected"}}',
		'{"outcome":"operation_result","result":{"properties":{"title":{"value":"wrong","value":"expected"}}}}',
	])("duplicate members cannot overwrite contradictory machine evidence: %s", (stdout) => {
	expect(parseMachineEnvelope(stdout)).toBeNull();
});

test("repeated names in distinct machine-result objects remain valid", () => {
	const answer = { outcome: "operation_result", result: { items: [{ path: "/one" }, { path: "/two" }] } };
	expect(parseMachineEnvelope(JSON.stringify(answer))).toEqual(answer);
});
