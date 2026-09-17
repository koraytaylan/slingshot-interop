// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";

const modes: string[] = [
	"fixed",
	"shared-root-accepted",
	"shared-root-silent-timeout",
	"shared-root-without-remedy",
	"shared-root-left-files",
	"exit-silent-timeout",
	"exit-without-quote",
	"exit-without-log",
	"exit-log-readable",
	"exit-quote-differs",
];

test.each(modes)("unstartable-daemon scenario accepts only a prompt, explained refusal: %s", async (mode) => {
	// Isolated module mocks exercise the actual scenario without contaminating other tests.
	const source = `
		import { mock } from "bun:test";
		const mode = ${JSON.stringify(mode)};
		const observed = [];
		const root = "/work/runtime";
		const logged = "slingshot: the runtime profile selection could not be resolved";
		const log = root + "-unconfigured/" + "a".repeat(64) + ".startup.log";
		const answer = (exitCode, stdout, stderr) => ({ ok: true, exitCode, stdout, stderr });
		const startShared = () => {
			if (mode === "shared-root-accepted") return answer(0, JSON.stringify({ outcome: "daemon_control", state: "created" }), "");
			if (mode === "shared-root-silent-timeout") return answer(6, "", "slingshot: no daemon became responsive within 30s");
			if (mode === "shared-root-without-remedy") return answer(6, "", "slingshot: the runtime root cannot be used");
			return answer(6, "", "slingshot: the runtime root cannot be used: " + root + "-shared is not a directory this user alone owns; restrict it to its owner with mode 0700, or choose another root");
		};
		const startUnconfigured = () => {
			if (mode === "exit-silent-timeout") return answer(6, "", "slingshot: no daemon became responsive within 30s");
			const quote = mode === "exit-without-quote" ? "" : "; it wrote: " + logged;
			const named = mode === "exit-without-log" ? "" : " (the whole startup log is " + log + ")";
			return answer(6, "", "slingshot: the daemon exited before it became responsive (exit status: 7)" + quote + named);
		};
		mock.module(${JSON.stringify(new URL("./support.ts", import.meta.url).pathname)}, () => ({
			runner: () => "runner",
			envelope: stdout => ({ ...JSON.parse(stdout), ok: true }),
			invoke: async (_handle, command) => {
				observed.push(command);
				const joined = command.join(" ");
				if (command[0] === "sh") {
					if (command[3] === "listing the shared runtime root") return answer(0, mode === "shared-root-left-files" ? "stray.owner.lock\\n" : "", "");
					if (command[3] === "inspecting the startup log") {
						const mode_ = mode === "exit-log-readable" ? "644" : "600";
						const contents = mode === "exit-quote-differs" ? "something else entirely" : logged;
						return answer(0, mode_ + "\\n" + contents + "\\n", "");
					}
					return answer(0, "", "");
				}
				if (joined.endsWith("daemon ping")) return answer(0, JSON.stringify({ outcome: "daemon_control", action: "daemon-ping", state: "absent" }), "");
				if (joined.includes(root + "-shared")) return startShared();
				return startUnconfigured();
			},
		}));
		const { scenario, unconfiguredProfileName } = await import(${JSON.stringify(new URL("./unstartable-daemon.scenario.ts", import.meta.url).pathname)});
		const outcome = await scenario.run({}, { runtimeRoot: root, labelValue: "fixture",
			scratchHome: { profileName: "fixture", environmentName: "author" },
			values: { readiness: { harnessSeconds: 1 } } });
		console.log(JSON.stringify({ outcome, observed, unconfiguredProfileName }));
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
	const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(exit).toBe(0);
	const { outcome, observed, unconfiguredProfileName } = JSON.parse(stdout);
	expect({ mode, ok: outcome.ok, message: outcome.message }).toMatchObject({ mode, ok: mode === "fixed" });
	const starts = observed.filter((command: string[]) => command.at(-1) === "start");
	expect(starts[0]).toContain("/work/runtime-shared");
	expect(starts[0]).toContain("fixture");
	if (mode === "fixed" || mode.startsWith("exit-")) {
		expect(starts[1]).toContain("/work/runtime-unconfigured");
		expect(starts[1]).toContain(unconfiguredProfileName);
	}
});
