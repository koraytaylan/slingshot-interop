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

import { agentAuthorization, invoke, machineArguments, runner, waitTerminal } from "./support.ts";
import { verifyCreatedFolder } from "./created-folder.ts";
import { refuseHttpResponse } from "../harness/http-refusal.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import type { ContainerHandle } from "../harness/container.ts";

// The revision every request in this scenario names. The client publishes two
// and prefers this one, which is the revision a current consumer speaks:
// nothing is established between requests and each request says what it is.
export const protocolRevision = "2026-07-28";

// The initialized era a standard MCP host speaks: Grok, Claude, and Cursor
// send `initialize` first and then `tools/call` with no per-request revision.
// A suite that only spoke `protocolRevision` would not notice the older era
// answering tools/call with empty content.
export const legacyProtocolRevision = "2025-06-18";

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

// One initialized-era session: handshake, then one tools/call with no
// protocolVersion on the call, which is what a host that already initialized
// actually sends.
export function legacySessionLines(call: {
	readonly identifier: string;
	readonly name: string;
	readonly arguments: Record<string, unknown>;
}): string {
	const initialize = JSON.stringify({
		jsonrpc: "2.0",
		id: "init",
		method: "initialize",
		params: {
			protocolVersion: legacyProtocolRevision,
			capabilities: {},
			clientInfo: { name: "slingshot-interop", version: "0" },
		},
	});
	const initialized = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
	const toolsCall = JSON.stringify({
		jsonrpc: "2.0",
		id: call.identifier,
		method: "tools/call",
		params: { name: call.name, arguments: call.arguments },
	});
	return `${initialize}\n${initialized}\n${toolsCall}\n`;
}

export type AnsweredDocument = {
	readonly id: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
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
		if ((parsed as Record<string, unknown>)["jsonrpc"] !== "2.0") {
			throw new Error(`the protocol server did not declare JSON-RPC revision 2.0: ${trimmed.slice(0, 400)}`);
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
	if (document.result === null || typeof document.result !== "object" || Array.isArray(document.result)) {
		throw new Error(`the answer's result is not an object: ${JSON.stringify(document).slice(0, 800)}`);
	}
	return document.result as Record<string, unknown>;
}

// The catalog's tools, as a consumer reads them: every entry must carry both a
// name and an input schema, because a tool without one cannot be called.
export type CataloguedTool = {
	readonly name: string;
	readonly inputSchema: Record<string, unknown>;
	readonly readOnly?: boolean;
};

export function catalogOf(result: Record<string, unknown>): readonly CataloguedTool[] {
	const tools = result["tools"];
	if (!Array.isArray(tools)) {
		throw new Error(`tools/list answered no tools array: ${JSON.stringify(result).slice(0, 800)}`);
	}
	if (tools.length === 0) {
		throw new Error("tools/list answered an empty catalog, which a consumer can do nothing with");
	}
	const names = new Set<string>();
	return tools.map((entry, position) => {
		if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
			throw new Error(`tool ${position} is not an object: ${JSON.stringify(entry).slice(0, 400)}`);
		}
		const held = entry as Record<string, unknown>;
		const name = held["name"];
		if (typeof name !== "string" || name.length === 0) {
			throw new Error(`tool ${position} carries no name: ${JSON.stringify(entry).slice(0, 400)}`);
		}
		if (names.has(name)) {
			throw new Error(`tools/list answered duplicate tool ${JSON.stringify(name)}`);
		}
		names.add(name);
		const schema = held["inputSchema"];
		if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
			throw new Error(`tool ${JSON.stringify(name)} carries no input schema: ${JSON.stringify(entry).slice(0, 400)}`);
		}
		const annotations = held["annotations"];
		const readOnly =
			annotations !== null
			&& typeof annotations === "object"
			&& !Array.isArray(annotations)
			&& (annotations as Record<string, unknown>)["readOnlyHint"] === true;
		return { name, inputSchema: schema as Record<string, unknown>, readOnly };
	});
}

// The one tool this scenario calls. A read-only control: it changes nothing
// on the author, so the scenario proves the whole route — protocol request,
// tool projection, daemon operation, terminal answer — without depending on
// a mutation's outcome. The catalog is consulted for it rather than this name
// being trusted, so a call is only made for a tool the server advertises.
export const calledToolName = "operation-list";

// The value one declared schema member is given, from the member's own
// declaration rather than from its name: an enum gets its first spelling, an
// array as many items as it requires, an object its own required members, and a
// string the smallest spelling its pattern admits. A consumer that knows nothing
// about this product can still build a legal call from what the tool declares.
export function minimalValueFor(member: string, schema: Record<string, unknown>): unknown {
	const spellings = schema["enum"];
	if (Array.isArray(spellings) && spellings.length > 0) {
		return spellings[0];
	}
	if (schema["const"] !== undefined) {
		return schema["const"];
	}
	for (const key of ["oneOf", "anyOf"]) {
		const alternatives = schema[key];
		if (Array.isArray(alternatives) && alternatives.length > 0) {
			return minimalValueFor(member, alternatives[0] as Record<string, unknown>);
		}
	}
	switch (schema["type"]) {
		case "boolean":
			return false;
		case "integer":
		case "number":
			return 1;
		case "array": {
			const least = Math.max(1, Number(schema["minItems"] ?? 0));
			const item = (schema["items"] as Record<string, unknown>) ?? { type: "string" };
			return Array.from({ length: least }, () => minimalValueFor(member, item));
		}
		case "object": {
			const required = (schema["required"] as string[] | undefined) ?? [];
			const properties = (schema["properties"] as Record<string, Record<string, unknown>> | undefined) ?? {};
			const built: Record<string, unknown> = {};
			for (const held of required) {
				built[held] = minimalValueFor(held, properties[held] ?? { type: "string" });
			}
			return built;
		}
		default: {
			if (String(schema["pattern"] ?? "").startsWith("^/")) {
				return "/content";
			}
			switch (member) {
				case "media_type":
					return "text/plain";
				case "encoded_content":
				case "payload":
					return "";
				case "property_path":
					return "property";
				default:
					return "a-usable-value";
			}
		}
	}
}

// The arguments one call for `tool` would send, from the schema the tool
// declares. Only the members it marks required are filled, so what this builds
// is the smallest legal call — the one a consumer doing the least would send.
export function minimalArgumentsFor(tool: CataloguedTool, key: string): Record<string, unknown> {
	const required = (tool.inputSchema["required"] as string[] | undefined) ?? [];
	const properties = (tool.inputSchema["properties"] as Record<string, Record<string, unknown>> | undefined) ?? {};
	const built: Record<string, unknown> = {};
	for (const member of required) {
		built[member] = member === "operation_key" ? key : minimalValueFor(member, properties[member] ?? { type: "string" });
	}
	return built;
}

// Whether one tool is a control rather than a registry command. The two are
// told apart by what the provider names them with: every control is hyphenated
// and every registry command is underscored, which is the provider's own
// spelling and not a rule invented here.
export function isControlTool(tool: CataloguedTool): boolean {
	return tool.name.includes("-");
}

export function isReadOnlyRegistryTool(tool: CataloguedTool): boolean {
	return !isControlTool(tool) && tool.readOnly === true;
}

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
			// A registry command is the stronger claim, and it is asked for
			// after the control: a command tool call has to run the same
			// command, on the same daemon, against the same agent a command
			// line reaches, and leave the effect that command declares. The
			// control above proves the route; this proves the route carries
			// real work.
			const handshake = await legacyHandshake(handle, options);
			if (!handshake.ok) {
				return handshake;
			}
			const commanded = await commandCall(handle, options, machine);
			if (!commanded.ok) {
				return commanded;
			}
			// Every advertised read-only tool, not only the two called above.
			// The catalog is a promise about all of its entries, and the
			// failure this catches is the one where a tool is advertised and
			// can never be reached: a call answered with a local failure
			// rather than with anything the daemon was asked.
			const swept = await sweepCatalog(handle, options, commanded.operationIdentifier);
			if (!swept.ok) {
				return { ok: false, message: swept.message };
			}

			return {
				ok: true,
				message: `the protocol server answered a ${catalog.length}-tool catalog, every tool with an input schema, an initialized-era ${calledToolName} call carrying ${JSON.stringify(handshake.outcome)}, ${swept.answered.length} read-only tools each answered through a call built from that tool's own declared schema (${swept.notDriven.length} needing prior work not driven here: ${swept.notDriven.join(", ")}), a real ${calledToolName} call carrying its own ${JSON.stringify(outcome)} document, and a real ${commandedToolName} call whose command ran on the agent and left ${commanded.effect}`,
			};
		} catch (error) {
			return { ok: false, message: error instanceof Error ? error.message : String(error) };
		}
	},
};

// The registry command this scenario calls through the protocol. A write,
// because a write is what proves the call reached the agent rather than only
// the daemon: the effect is asked for on the agent's own route afterwards, and
// a call that never arrived could not have left one. It is made against a
// parent this scenario plants first, so nothing depends on another scenario
// having run.
export const commandedToolName = "create_asset_folder";

export async function legacyHandshake(
	handle: ContainerHandle,
	options: StartClientRunnerOptions,
): Promise<{ readonly ok: true; readonly outcome: string } | { readonly ok: false; readonly message: string }> {
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
		new TextEncoder().encode(legacySessionLines({ identifier: "legacy-call", name: calledToolName, arguments: {} })),
	);
	if (!answered.ok) {
		return { ok: false, message: `the initialized-era protocol-serve could not run: ${answered.message}` };
	}
	if (answered.exitCode !== 0) {
		return { ok: false, message: `the initialized-era protocol-serve exited ${answered.exitCode}: ${answered.stderr}` };
	}
	let documents: readonly AnsweredDocument[];
	try {
		documents = answeredDocuments(answered.stdout);
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
	let initialize: Record<string, unknown>;
	let call: Record<string, unknown>;
	try {
		initialize = resultOf(answerFor(documents, "init"));
		call = resultOf(answerFor(documents, "legacy-call"));
	} catch (error) {
		return { ok: false, message: `the initialized-era exchange was refused: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (initialize["protocolVersion"] !== legacyProtocolRevision) {
		return { ok: false, message: `initialize offered ${JSON.stringify(initialize["protocolVersion"])} rather than ${legacyProtocolRevision}` };
	}
	const content = call["content"];
	if (!Array.isArray(content) || content.length === 0) {
		return {
			ok: false,
			message: `the initialized-era ${calledToolName} call answered empty content: ${JSON.stringify(call).slice(0, 800)}`,
		};
	}
	const carried = contentOf(content);
	if (carried === undefined || typeof carried["outcome"] !== "string" || !answerableTags.includes(carried["outcome"])) {
		return {
			ok: false,
			message: `the initialized-era ${calledToolName} call did not carry ${JSON.stringify(answerableTags)}: ${JSON.stringify(call).slice(0, 800)}`,
		};
	}
	if (call["resultType"] !== undefined) {
		return { ok: false, message: `the initialized era carried a modern result member: ${JSON.stringify(call).slice(0, 800)}` };
	}
	return { ok: true, outcome: carried["outcome"] };
}

// Runs the registry-command tool call and proves its command reached the agent.
//
// The three things a consumer needs and a re-implementation would not: the
// call is answered with a receipt rather than a JSON-RPC error, the operation
// it names reaches a terminal disposition through the client's own leaf, and
// the folder the call declared exists on the agent with the title it declared.
export async function commandCall(
	handle: ContainerHandle,
	options: StartClientRunnerOptions,
	machine: readonly string[],
): Promise<{ readonly ok: true; readonly effect: string; readonly operationIdentifier: string } | { readonly ok: false; readonly message: string }> {
	const parent = `/content/interop/${options.labelValue}/protocol`;
	const folderName = "from-protocol";
	const title = `Made over the protocol by ${options.labelValue}`;
	const planted = await fetch(`http://127.0.0.1:${options.values.ports.author}${parent}`, {
		method: "POST",
		headers: { authorization: agentAuthorization("admin", "admin") },
		body: new URLSearchParams({ "sling:resourceType": "nt:unstructured" }),
		signal: AbortSignal.timeout(30_000),
	});
	if (!planted.ok) {
		return refuseHttpResponse(planted, "the call's parent could not be planted");
	}
	// The catalog is read again in the same exchange, so the call is only made
	// for a tool this server advertises: a call for one it does not would be
	// answered with `-32602` and the assertion below would pass for the wrong
	// reason.
	const requests: readonly ProtocolRequest[] = [
		{ identifier: "catalog", method: "tools/list", parameters: {} },
		{
			identifier: "command",
			method: "tools/call",
			parameters: {
				name: commandedToolName,
				arguments: { operation_key: `${options.labelValue}-protocol`, parent_path: parent, name: folderName, title },
			},
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
		return { ok: false, message: `the ${commandedToolName} protocol-serve could not run: ${answered.message}` };
	}
	if (answered.exitCode !== 0) {
		return { ok: false, message: `the ${commandedToolName} protocol-serve exited ${answered.exitCode}: ${answered.stderr}` };
	}
	let documents: readonly AnsweredDocument[];
	try {
		documents = answeredDocuments(answered.stdout);
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
	const catalog = catalogOf(resultOf(answerFor(documents, "catalog")));
	if (!catalog.some((tool) => tool.name === commandedToolName)) {
		return { ok: false, message: `the catalog of ${catalog.length} tools does not offer ${JSON.stringify(commandedToolName)}` };
	}
	let call: Record<string, unknown>;
	try {
		call = resultOf(answerFor(documents, "command"));
	} catch (error) {
		return { ok: false, message: `the ${commandedToolName} call was refused: ${error instanceof Error ? error.message : String(error)}` };
	}
	const content = call["content"];
	const carried = Array.isArray(content) ? contentOf(content) : undefined;
	if (carried === undefined) {
		return { ok: false, message: `the ${commandedToolName} call answered no structured result: ${JSON.stringify(call).slice(0, 800)}` };
	}
	if (carried["outcome"] !== "operation_receipt") {
		return { ok: false, message: `the ${commandedToolName} call answered ${JSON.stringify(carried["outcome"])} instead of a receipt: ${JSON.stringify(carried).slice(0, 800)}` };
	}
	const operationIdentifier = carried["operation_identifier"];
	if (typeof operationIdentifier !== "string" || operationIdentifier.length === 0) {
		return { ok: false, message: `the ${commandedToolName} call named no operation: ${JSON.stringify(carried).slice(0, 800)}` };
	}
	// The command has to run: the operation the call named reaches a terminal
	// disposition through the client's own leaf, which is the same wait a
	// command line does.
	const ended = await waitTerminal(handle, machine, operationIdentifier, options, options.values.readiness.harnessSeconds * 1000);
	if (!ended.ok) {
		return { ok: false, message: `the ${commandedToolName} operation the call produced: ${ended.message}` };
	}
	if (ended.envelope.outcome !== "operation_result") {
		return { ok: false, message: `the ${commandedToolName} call the protocol server made ended as ${JSON.stringify(ended.envelope)}` };
	}
	const result = ended.envelope.result;
	if (result === null || typeof result !== "object" || Array.isArray(result)
		|| (result as Record<string, unknown>)["repository_path"] !== `${parent}/${folderName}`) {
		return { ok: false, message: `the ${commandedToolName} result does not name the requested folder` };
	}
	// And it reached the agent: the folder the call declared answers on the
	// agent's own route with the title the call declared. A call that never
	// left the daemon could not have made one.
	const made = await fetch(`http://127.0.0.1:${options.values.ports.author}${parent}/${folderName}.json`, {
		headers: { authorization: agentAuthorization("admin", "admin") },
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
	});
	const verified = await verifyCreatedFolder(made, title, options.values.capture.maximumBytes);
	if (!verified.ok) return { ok: false, message: verified.message };
	return { ok: true, effect: `${parent}/${folderName}`, operationIdentifier };
}

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

// What one sweep of the whole catalog found.
export type SweepOutcome =
	| { readonly ok: true; readonly answered: readonly string[]; readonly notDriven: readonly string[] }
	| { readonly ok: false; readonly message: string };

// The controls whose arguments name something a run has to have made first: an
// operation waiting in a recovery, an artifact an operation produced, and a
// maintenance preview whose digest has been reviewed. A sweep of the catalog
// cannot invent those, and calling one anyway would make the sweep's result
// about what the sweep happened to have rather than about the tool. They are
// named rather than skipped silently, so what this sweep does not prove is as
// visible as what it does.
export const controlsNeedingPriorWork = [
	"operation-restart",
	"operation-artifact",
	"maintenance-apply",
] as const;

// Independently expected control vocabulary, from the client's schema_projection.rs.
// New controls must receive an explicit expectation before they count as exercised.
const controlAnswerTags: Readonly<Record<string, readonly string[]>> = {
	"operation-list": ["operation_list_page"],
	"operation-status": ["operation_status", "operation_recovery_required"],
	"operation-wait": ["operation_status", "operation_result", "operation_terminal_error"],
	"operation-result": ["operation_result", "structured_result_artifact_access"],
	"maintenance-preview": ["maintenance_preview"],
};

export function assertControlAnswer(toolName: string, result: Record<string, unknown>): void {
	const content = result["content"];
	const carried = Array.isArray(content) ? contentOf(content) : undefined;
	const outcome = carried?.["outcome"];
	const expected = Object.hasOwn(controlAnswerTags, toolName) ? controlAnswerTags[toolName] : undefined;
	if (typeof outcome !== "string" || expected === undefined || !expected.includes(outcome)) {
		throw new Error(`expected a declared control outcome, received ${JSON.stringify(outcome)}`);
	}
}

export function assertReachedDaemon(tool: CataloguedTool, result: Record<string, unknown>): void {
	if (isControlTool(tool)) {
		assertControlAnswer(tool.name, result);
		return;
	}
	const content = result["content"];
	const carried = Array.isArray(content) ? contentOf(content) : undefined;
	const outcome = carried?.["outcome"];
	if (outcome === "local_application_error") {
		throw new Error("expected a daemon answer, received local_application_error");
	}
	if (typeof outcome !== "string" || outcome.length === 0) {
		throw new Error(`expected a daemon answer, received ${JSON.stringify(outcome)}`);
	}
}

// Every read-only tool the catalog advertises, called with the arguments its own
// schema declares, against the run's live daemon.
//
// The specific defect this catches is a tool advertised in a catalog and
// unreachable through it: a call answered from this process, with a local
// failure, because the translation from a call's arguments to the thing that
// runs them only ever worked for the handful somebody tried by hand. A tool that
// reaches the daemon is answered by the daemon, even when what it is answered
// with is a refusal about something that does not exist.
//
// The controls that need prior work are excluded by name and reported, so the
// reader knows exactly which part of the surface this does not cover.
export async function sweepCatalog(
	handle: ContainerHandle,
	options: StartClientRunnerOptions,
	operationIdentifier: string,
): Promise<SweepOutcome> {
	const catalogRequest: ProtocolRequest = { identifier: "catalog", method: "tools/list", parameters: {} };
	const catalogAnswered = await invoke(
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
		new TextEncoder().encode(requestLines([catalogRequest])),
	);
	if (!catalogAnswered.ok) {
		return { ok: false, message: `the catalog exchange could not run: ${catalogAnswered.message}` };
	}
	if (catalogAnswered.exitCode !== 0) {
		return { ok: false, message: `the catalog exchange exited ${catalogAnswered.exitCode}: ${catalogAnswered.stderr}` };
	}
	let discovered: readonly CataloguedTool[];
	try {
		discovered = catalogOf(resultOf(answerFor(answeredDocuments(catalogAnswered.stdout), "catalog")));
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}

	const swept = discovered.filter(
		(tool) =>
			!controlsNeedingPriorWork.some((held) => held === tool.name)
			&& (isControlTool(tool) || isReadOnlyRegistryTool(tool)),
	);
	const requests: readonly ProtocolRequest[] = swept.map((tool, position) => {
		// A control that names an operation is given the one this scenario's own
		// command call produced, so the daemon answers about a real operation
		// rather than about an invented name. Everything else the schema
		// requires comes from the schema itself.
		const carried = minimalArgumentsFor(tool, `${options.labelValue}-sweep-${position}`);
		for (const member of Object.keys(carried)) {
			if (member === "operation_identifier") {
				carried[member] = operationIdentifier;
			}
		}
		return {
			identifier: `sweep-${position}`,
			method: "tools/call",
			parameters: { name: tool.name, arguments: carried },
		};
	});
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
		return { ok: false, message: `the sweep exchange could not run: ${answered.message}` };
	}
	if (answered.exitCode !== 0) {
		return { ok: false, message: `the sweep exchange exited ${answered.exitCode}: ${answered.stderr}` };
	}
	let answers: readonly AnsweredDocument[];
	try {
		answers = answeredDocuments(answered.stdout);
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}

	// A call that reached the daemon is answered by it: what comes back names
	// something about an operation rather than a local failure, which is what
	// this process writes when its own checks stopped the call before anything
	// was sent. That distinction is the whole assertion, so it is read off the
	// answer's own tag rather than inferred from anything else.
	const invalidAnswers: string[] = [];
	const answeredNames: string[] = [];
	for (const [position, tool] of swept.entries()) {
		let result: Record<string, unknown>;
		try {
			result = resultOf(answerFor(answers, `sweep-${position}`));
		} catch (error) {
			return { ok: false, message: `${tool.name} was refused by the protocol: ${error instanceof Error ? error.message : String(error)}` };
		}
		try {
			assertReachedDaemon(tool, result);
		} catch (error) {
			invalidAnswers.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		answeredNames.push(tool.name);
	}
	if (invalidAnswers.length > 0) {
		return {
			ok: false,
			message: `${invalidAnswers.length} of the ${swept.length} read-only controls returned missing, malformed or unexpected outcomes: ${invalidAnswers.join(", ")}; stderr: ${answered.stderr.trim().slice(0, 1200)}`,
		};
	}
	return { ok: true, answered: answeredNames, notDriven: [...controlsNeedingPriorWork] };
}
