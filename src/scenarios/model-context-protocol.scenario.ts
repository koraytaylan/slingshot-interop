// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taydan Davgana

// The model-context-protocol scenario: the client's own `protocol-serve`
// server, driven over the standard-input/standard-output interface it is
// shipped to answer, must answer the protocol a real consumer sends it.
//
// Two things are proved, and both are about the shipped bytes rather than a
// re-implementation. The catalog surface: `tools/list` answers a non-empty
// catalog in which every tool carries a name and an input schema, which is
// what a consumer needs before it can call anything. And a real call: a
// `tools/call` reaches the same daemon and the same registry command a
// command line reaches, and answers a well-formed result rather than a
// JSON-RPC error.
//
// The request lines and the answer documents are built and read by pure
// helpers below, so the framing is unit-testable with no container. What this
// file owns is thin: it writes those lines to the server's input and reads
// what the server wrote back.

import { invoke, machineArguments, runner } from "./support.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

// The revision every request in this scenario names. The client publishes two
// and prefers this one, which is the revision a current consumer speaks:
// nothing is established between requests and each request says what it is.
export const protocolRevision = "2026-07-28";

// The two JSON-RPC codes a request this build understands can receive, and
// the shape of an error: `-32700` is a line that is not a message at all and
// `-32602` is a request whose arguments are unusable. A `tools/call` answered
// with either would be the client refusing a call the surface advertises.
export const parseError = -32_700;
export const invalidParametersError = -32_602;

export type ProtocolRequest = {
	readonly identifier: string;
	readonly method: string;
	readonly parameters: Record<string, unknown>;
};

// One request line, framed as the transport reads it: one JSON object per
// line, with the revision carried in the parameters the way every request of
// this revision carries it.
export function requestLine(request: ProtocolRequest): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id: request.identifier,
		method: request.method,
		params: { protocolVersion: protocolRevision, ...request.parameters },
	});
}

// The whole input one exchange sends, each request on its own line and the
// stream closed at the end — which is how the server learns to finish.
export function requestLines(requests: readonly ProtocolRequest[]): string {
	return requests.map((request) => `${requestLine(request)}\n`).join("");
}

export type AnsweredDocument = {
	readonly id: unknown;
	readonly result?: Record<string, unknown>;
	readonly error?: { readonly code?: number; readonly message?: string };
};

// Reads the answer documents out of what the server wrote. A line the server
// wrote that is not a JSON object is a protocol violation, so it is reported
// rather than skipped: a parse that ignored one would read the answers it
// understood and call the rest silence.
export function answeredDocuments(stdout: string): readonly AnsweredDocument[] {
	const documents: AnsweredDocument[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error(`the protocol server wrote a line that is not a JSON document: ${trimmed.slice(0, 400)}`);
		}
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`the protocol server wrote a line that is not a JSON object: ${trimmed.slice(0, 400)}`);
		}
		documents.push(parsed as AnsweredDocument);
	}
	return documents;
}

// The one document answering an identifier, or a refusal naming what arrived
// instead. Exactly one answer per request is part of the protocol, so a
// second one is a defect and not a document to choose between.
export function answerFor(documents: readonly AnsweredDocument[], identifier: string): AnsweredDocument {
	const matching = documents.filter((document) => document.id === identifier);
	if (matching.length === 0) {
		throw new Error(`no answer carried the identifier ${JSON.stringify(identifier)}; the server wrote ${JSON.stringify(documents).slice(0, 800)}`);
	}
	if (matching.length > 1) {
		throw new Error(`the identifier ${JSON.stringify(identifier)} was answered ${matching.length} times`);
	}
	return matching[0]!;
}

// What a successful answer's result carries, or a refusal naming the error the
// server sent instead. A `tools/call` is the one that must never be an error.
export function resultOf(document: AnsweredDocument): Record<string, unknown> {
	if (document.error !== undefined) {
		throw new Error(`the request was refused with ${JSON.stringify(document.error)}`);
	}
	if (document.result === undefined) {
		throw new Error(`the answer carried neither a result nor an error: ${JSON.stringify(document).slice(0, 800)}`);
	}
	return document.result;
}

// The catalog's tools, as a consumer reads them: every entry must carry both a
// name and an input schema, because a tool without one cannot be called.
export type CataloguedTool = {
	readonly name: string;
	readonly inputSchema: Record<string, unknown>;
};

export function catalogOf(result: Record<string, unknown>): readonly CataloguedTool[] {
	const tools = result["tools"];
	if (!Array.isArray(tools)) {
		throw new Error(`tools/list answered no tools array: ${JSON.stringify(result).slice(0, 800)}`);
	}
	if (tools.length === 0) {
		throw new Error("tools/list answered an empty catalog, which a consumer can do nothing with");
	}
	return tools.map((entry, position) => {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`tool ${position} is not an object: ${JSON.stringify(entry).slice(0, 400)}`);
		}
		const held = entry as Record<string, unknown>;
		const name = held["name"];
		if (typeof name !== "string" || name.length === 0) {
			throw new Error(`tool ${position} carries no name: ${JSON.stringify(entry).slice(0, 400)}`);
		}
		const schema = held["inputSchema"];
		if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
			throw new Error(`tool ${JSON.stringify(name)} carries no input schema: ${JSON.stringify(entry).slice(0, 400)}`);
		}
		return { name, inputSchema: schema as Record<string, unknown> };
	});
}

// The one tool this scenario calls. A read-only control: it changes nothing
// on the author, so the scenario proves the whole route — protocol request,
// tool projection, daemon operation, terminal answer — without depending on
// a mutation's outcome. The catalog is consulted for it rather than this name
// being trusted, so a call is only made for a tool the server advertises.
export const calledToolName = "operation-list";

export const scenario = {
	async run(handle: ContainerHandle, options: StartClientRunnerOptions) {
		// 0. The daemon: a tool call reaches the same operation machinery a
		// command line reaches, so the daemon is started exactly as every
		// other scenario starts it.
		const machine = machineArguments(options, options.scratchHome.profileName);
		const started = await invoke(handle, [runner(), ...machine, "daemon", "start"], options);
		if (!started.ok) {
			return { ok: false, message: `daemon start could not run: ${started.message}` };
		}
		if (started.exitCode !== 0) {
			return { ok: false, message: `daemon start exited ${started.exitCode}: ${started.stderr}` };
		}

		// 1. The three requests one exchange carries: what this build serves,
		// what it offers as tools, and one real call. The leaf takes the
		// target and the runtime root, so the pair the daemon was started
		// under travels on it and the call reaches that same daemon: the
		// runtime root is where the daemon's endpoint lives, and a server
		// resolving a different one would find no daemon to run the tool on.
		const requests: readonly ProtocolRequest[] = [
			{ identifier: "discover", method: "server/discover", parameters: {} },
			{ identifier: "catalog", method: "tools/list", parameters: {} },
			{
				identifier: "call",
				method: "tools/call",
				parameters: { name: calledToolName, arguments: {} },
			},
		];
		const answered = await invoke(
			handle,
			[
				runner(),
				"--runtime-root",
				options.runtimeRoot,
				"--profile",
				options.scratchHome.profileName,
				"--environment",
				options.scratchHome.environmentName,
				"protocol-serve",
			],
			options,
			new TextEncoder().encode(requestLines(requests)),
		);
		if (!answered.ok) {
			return { ok: false, message: `protocol-serve could not run: ${answered.message}` };
		}
		if (answered.exitCode !== 0) {
			return { ok: false, message: `protocol-serve exited ${answered.exitCode}: ${answered.stderr}` };
		}

		// 2. Read the answers back, and assert the two documents a consumer
		// needs. Everything below is the pure helpers' judgement over the
		// server's actual output.
		let documents: readonly AnsweredDocument[];
		try {
			documents = answeredDocuments(answered.stdout);
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
		try {
			answerFor(documents, "discover");
			const catalog = catalogOf(resultOf(answerFor(documents, "catalog")));
			const call = resultOf(answerFor(documents, "call"));

			// The catalog must offer the tool that was called: a call for a
			// tool the server does not advertise would be answered with
			// `-32602`, and the assertion below would pass for the wrong
			// reason.
			if (!catalog.some((tool) => tool.name === calledToolName)) {
				return {
					ok: false,
					message: `the catalog of ${catalog.length} tools does not offer ${JSON.stringify(calledToolName)}`,
				};
			}

			// The call's own answer carries the content a result carries, and
			// the content is the tool's answer rather than an empty list: the
			// call reached the daemon the run started, so the document is the
			// `operation-list` envelope and nothing the server could not reach.
			// A JSON-RPC error is the failure this scenario exists to exclude,
			// and `resultOf` has already refused one.
			const content = call["content"];
			if (!Array.isArray(content) || content.length === 0) {
				return {
					ok: false,
					message: `the ${calledToolName} call answered a result carrying no content: ${JSON.stringify(call).slice(0, 800)}`,
				};
			}
			const carried = contentOf(content);
			if (carried === undefined) {
				return {
					ok: false,
					message: `the ${calledToolName} call answered content carrying no structured result: ${JSON.stringify(call).slice(0, 800)}`,
				};
			}
			// The tool answered something this build's own vocabulary holds: a
			// tag it declares, and no JSON-RPC error. That is the same document
			// the command line writes for the same outcome, which is what makes
			// the two surfaces one.
			const outcome = carried["outcome"];
			if (typeof outcome !== "string" || !answerableTags.includes(outcome)) {
				return {
					ok: false,
					message: `the ${calledToolName} call answered ${JSON.stringify(outcome)}, which is not one of the tags this tool declares: ${JSON.stringify(carried).slice(0, 800)}`,
				};
			}
			return {
				ok: true,
				message: `the protocol server answered a ${catalog.length}-tool catalog, every tool with an input schema, and a real ${calledToolName} call carrying its own ${JSON.stringify(outcome)} document`,
			};
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
	},
};

// The tags `operation-list` may answer with, which
// `crates/slingshot-command-line/src/model_context_protocol/schema_projection.rs`
// declares for that control. A call answering anything else has answered
// something this server does not offer through that tool.
export const answerableTags = ["operation_list_page"];

// The structured result the content of one tool result carries, or a refusal
// naming what arrived instead. The document is the one the command line writes
// for the same outcome, so the content's own member is where it lives.
export function contentOf(content: readonly unknown[]): Record<string, unknown> | undefined {
	for (const entry of content) {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			continue;
		}
		const held = entry as Record<string, unknown>;
		if (held["type"] !== "text" || typeof held["text"] !== "string") {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(held["text"]);
		} catch {
			continue;
		}
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	}
	return undefined;
}
