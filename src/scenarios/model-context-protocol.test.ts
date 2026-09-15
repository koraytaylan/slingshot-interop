// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The protocol scenario's pure half, unit-tested with no container and no
// engine: the request framing and the reading of the server's answers are the
// parts a defect would live in, and they take strings and return documents,
// so they can be held to what they promise without a run.

import { describe, expect, test } from "bun:test";
import {
	answerFor,
	answeredDocuments,
	calledToolName,
	catalogOf,
	protocolRevision,
	requestLine,
	requestLines,
	resultOf,
} from "./model-context-protocol.scenario.ts";

describe("the protocol request framing", () => {
	test("one request line is one JSON object carrying the revision it speaks", () => {
		const line = requestLine({ identifier: "one", method: "ping", parameters: {} });
		const parsed = JSON.parse(line) as Record<string, unknown>;
		expect(parsed["jsonrpc"]).toBe("2.0");
		expect(parsed["id"]).toBe("one");
		expect(parsed["method"]).toBe("ping");
		expect((parsed["params"] as Record<string, unknown>)["protocolVersion"]).toBe(protocolRevision);
		// One line, because the transport reads a message per line: a framing
		// that emitted a newline would be read as two unreadable messages.
		expect(line.includes("\n")).toBe(false);
	});

	test("the parameters a caller states travel beside the revision", () => {
		const line = requestLine({
			identifier: "call",
			method: "tools/call",
			parameters: { name: "operation-list", arguments: {} },
		});
		const params = (JSON.parse(line) as Record<string, unknown>)["params"] as Record<string, unknown>;
		expect(params["name"]).toBe("operation-list");
		expect(params["arguments"]).toEqual({});
		expect(params["protocolVersion"]).toBe(protocolRevision);
	});

	test("a whole exchange is one line per request, each terminated", () => {
		const lines = requestLines([
			{ identifier: "one", method: "ping", parameters: {} },
			{ identifier: "two", method: "tools/list", parameters: {} },
		]);
		expect(lines.split("\n").filter((line) => line.length > 0)).toHaveLength(2);
		expect(lines.endsWith("\n")).toBe(true);
		// Every line parses on its own: the server reads them independently,
		// and a stream that only parses whole would hide a framing defect.
		for (const line of lines.split("\n")) {
			if (line.length === 0) {
				continue;
			}
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});

describe("reading the server's answers", () => {
	test("every non-empty line becomes one document and blank lines are nothing", () => {
		const documents = answeredDocuments(
			'{"jsonrpc":"2.0","id":"one","result":{}}\n\n{"jsonrpc":"2.0","id":"two","result":{}}\n',
		);
		expect(documents).toHaveLength(2);
		expect(documents[0]?.id).toBe("one");
		expect(documents[1]?.id).toBe("two");
	});

	test("a line that is not a JSON document is refused rather than skipped", () => {
		// A parse that ignored an unreadable line would read the answers it
		// understood and report success about a stream the server corrupted.
		expect(() => answeredDocuments("not a message\n")).toThrow(/not a JSON document/);
		expect(() => answeredDocuments('{"jsonrpc":"2.0"}\ntrailing\n')).toThrow(/not a JSON document/);
	});

	test("a line that is JSON but not an object is refused", () => {
		expect(() => answeredDocuments("[1,2,3]\n")).toThrow(/not a JSON object/);
		expect(() => answeredDocuments('"a string"\n')).toThrow(/not a JSON object/);
	});

	test("one request is answered exactly once", () => {
		const once = answeredDocuments('{"id":"one","result":{}}');
		expect(answerFor(once, "one").id).toBe("one");
		// No answer at all, and two answers: both are protocol violations, and
		// the second is the one a lenient reader would silently accept.
		expect(() => answerFor(once, "absent")).toThrow(/no answer carried the identifier/);
		const twice = answeredDocuments('{"id":"one","result":{}}\n{"id":"one","result":{}}');
		expect(() => answerFor(twice, "one")).toThrow(/answered 2 times/);
	});

	test("a result is returned and an error is refused by name", () => {
		const result = resultOf({ id: "one", result: { tools: [] } });
		expect(result).toEqual({ tools: [] });
		expect(() => resultOf({ id: "one", error: { code: -32_602, message: "no such tool" } })).toThrow(
			/refused with \{"code":-32602/,
		);
		expect(() => resultOf({ id: "one" })).toThrow(/neither a result nor an error/);
	});
});

describe("the tool catalog a consumer reads", () => {
	test("a catalog of named tools each carrying an input schema is read whole", () => {
		const tools = catalogOf({
			tools: [
				{ name: "operation-list", inputSchema: { type: "object", properties: {} } },
				{ name: "create_page", inputSchema: { type: "object", required: ["page_name"] } },
			],
		});
		expect(tools.map((tool) => tool.name)).toEqual(["operation-list", "create_page"]);
		expect(tools[1]?.inputSchema["required"]).toEqual(["page_name"]);
	});

	test("an empty catalog is refused, because a consumer can do nothing with one", () => {
		expect(() => catalogOf({ tools: [] })).toThrow(/empty catalog/);
	});

	test("a catalog that is not a list of tools is refused", () => {
		expect(() => catalogOf({})).toThrow(/no tools array/);
		expect(() => catalogOf({ tools: "operation-list" })).toThrow(/no tools array/);
	});

	test("a tool without a name or without a schema is refused, naming which", () => {
		expect(() => catalogOf({ tools: [{ inputSchema: {} }] })).toThrow(/carries no name/);
		expect(() => catalogOf({ tools: [{ name: "", inputSchema: {} }] })).toThrow(/carries no name/);
		expect(() => catalogOf({ tools: [{ name: "operation-list" }] })).toThrow(/carries no input schema/);
		expect(() => catalogOf({ tools: [{ name: "operation-list", inputSchema: null }] })).toThrow(
			/carries no input schema/,
		);
		expect(() => catalogOf({ tools: [{ name: "operation-list", inputSchema: [] }] })).toThrow(
			/carries no input schema/,
		);
	});

	test("the tool the scenario calls is a read-only control this build advertises", () => {
		// The name is written down once: a scenario calling a tool no catalog
		// offers would be answered with an error, and the scenario's own
		// assertion would then pass for the wrong reason.
		expect(calledToolName).toBe("operation-list");
	});
});
