// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

const modulePath = (name: string) => JSON.stringify(new URL(name, import.meta.url).pathname);

test.each(["automatic", "guarded", "duplicate-effect", "no-cut", "install-lost", "arm-lost", "uninstall-failed", "control-idempotent"])("non-idempotent scenario checks effects and cleanup: %s", async mode => {
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const counting = await import(${modulePath("./counting-workflow.ts")});
		mock.module(${modulePath("./counting-workflow.ts")}, () => ({ ...counting,
			loadWorkflowFixture: async () => ({ bytes: Buffer.from("fixture"), evidence: { digest: "fixture-digest" } }),
		}));
		const payload = "/content/interop/run-fixture/counting-effects";
		const effects = [];
		const operations = new Map();
		const calls = [];
		let subject;
		let recovered = false;
		const effectName = index => "effect-00000000-0000-4000-a000-" + String(index).padStart(12, "0");
		const result = name => ({ instance_identifier: payload + "/" + name, model_identifier: counting.fixtureModel, state: "running" });
		mock.module(${modulePath("./workflow-fixture-runtime.ts")}, () => ({ WorkflowFixtureRuntime: class {
			async bundle() { return undefined; }
			async hasWorkflow() { return false; }
			async install() { calls.push("install"); if (mode === "install-lost") throw new Error("fixture install response lost"); }
			async remove() { calls.push("remove"); if (mode === "uninstall-failed") throw new Error("fixture uninstall failed"); }
			async post() {}
			async read() {
				return Object.fromEntries([["jcr:primaryType", "nt:unstructured"], ...effects.map(name => [name, {
					"jcr:primaryType": "nt:unstructured", fixtureModel: counting.fixtureModel, payloadPath: payload, startedBy: "admin", startedAt: "2026-09-29T12:00:00Z",
				}])]);
			}
		} }));
		mock.module(${modulePath("./agent-operation-inventory.ts")}, () => ({ agentOperationInventory: async () => ({
			ok: true, operations: subject === undefined ? [] : ["g1/aa/aa/" + "a".repeat(64)],
		}) }));
		mock.module(${modulePath("./support.ts")}, () => ({
			runner: () => "runner", machineArguments: () => [], agentAuthorization: () => "",
			envelope: stdout => ({ ok: true, ...JSON.parse(stdout) }),
			invoke: async (_handle, command) => {
				const answer = document => ({ ok: true, exitCode: 0, stdout: JSON.stringify(document), stderr: "" });
				if (command.includes("daemon")) return answer({});
				if (command.includes("operation-restart")) {
					calls.push("restart"); recovered = true;
					return answer({ outcome: "operation_resume_receipt", category: "ambiguous_submission", replayed: false });
				}
				if (!command.includes("--payload-path")) throw new Error("wrong workflow CLI option");
				const key = command[command.indexOf("--operation-key") + 1];
				if (!operations.has(key)) {
					const name = mode === "control-idempotent" && effects.length > 0 ? effects[0] : effectName(effects.length + 1);
					if (!effects.includes(name)) effects.push(name);
					operations.set(key, name);
					if (key.endsWith("non-idempotent-cut")) {
						subject = key;
						if (mode === "duplicate-effect") effects.push(effectName(effects.length + 1));
					}
				}
				return answer({ outcome: "operation_receipt", operation_identifier: key });
			},
			waitTerminal: async (_handle, _machine, identifier) => ({ ok: true, envelope:
				mode === "guarded" && identifier === subject && !recovered
					? { ok: true, outcome: "operation_recovery_required", category: "ambiguous_submission", revision: 1 }
					: { ok: true, outcome: "operation_result", result: result(operations.get(identifier)) },
			}),
			resolveAgentOperationIdentifier: async () => ({ ok: true, agentOperationIdentifier: "a".repeat(64), targetDigest: "target" }),
			agentSnapshot: async () => ({ ok: true, snapshot: { kind: "succeeded", terminal_result: { canonical_result: JSON.stringify(result(operations.get(subject))) } } }),
		}));
		globalThis.fetch = async url => {
			const path = new URL(url).pathname;
			calls.push(path);
			if (path === "/arm/client" && mode === "arm-lost") throw new Error("fixture arm response lost");
			if (path === "/observed/client") return Response.json({ arm: "fixture-arm", mode: "response", requestLine: "POST /bin/slingshot/agent/submit HTTP/1.1", severed: mode === "no-cut" ? 0 : 1, suppressedResponseBytes: 100 });
			return new Response("", { headers: { "x-severance-arm": "fixture-arm" } });
		};
		const { scenario } = await import(${modulePath("./non-idempotent-recovery.scenario.ts")});
		const answer = await scenario.run({}, { labelValue: "run-fixture", workflowFixtureReceipt: "fixture.json", agentBundleDigest: "a".repeat(64),
			scratchHome: { profileName: "fixture" }, values: { ports: { author: 12345, proxy: 12346 }, capture: { maximumBytes: 65536 }, readiness: { harnessSeconds: 1, pollIntervalSeconds: 0.001 } },
		});
		console.log(JSON.stringify({ answer, calls }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const { answer, calls } = JSON.parse(stdout);
	expect(answer.ok).toBe(mode === "automatic" || mode === "guarded");
	expect(calls.at(-1)).toBe("remove");
	if (!["install-lost", "control-idempotent"].includes(mode)) expect(calls).toContain("/disarm/client");
	if (mode === "guarded") expect(calls).toContain("restart");
	if (mode === "duplicate-effect") {
		expect(answer.message).toContain("exactly one");
		expect(answer.evidence.after_effects).toHaveLength(4);
	}
	if (mode === "uninstall-failed") expect(answer.message).toContain("cleanup");
	if (answer.ok) {
		expect(answer.evidence.control_effects).toHaveLength(2);
		expect(answer.evidence.after_effects).toHaveLength(3);
		expect(answer.evidence.fixture_cleanup).toBe("passed");
	}
});
