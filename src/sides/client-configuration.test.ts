// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { describe, it, expect } from "bun:test";
import {
	writeScratchHome,
	serializeProfile,
	serializeSelection,
	serializeSnapshot,
	sixPointFiveDeployment,
	authorAddressScheme,
	type ProfileDocument,
	type SelectionDocument,
	type SnapshotSource,
} from "./client-configuration.ts";
import { rm } from "node:fs/promises";

describe("Client Configuration", () => {
	describe("serializeProfile", () => {
		it("serializes a profile with the exact shape the client expects", () => {
			const profile: ProfileDocument = {
				name: "test-profile",
				environment: "test-env",
				deployment: sixPointFiveDeployment,
				authorAddress: `${authorAddressScheme}author.example.com`,
				publisherAddress: `${authorAddressScheme}publisher.example.com`,
				username: "user",
				password: "pass",
			};
			const result = serializeProfile(profile);
			expect(result).toContain("format_version = 1");
			expect(result).toContain('name = "test-profile"');
			expect(result).toContain("[environments.test-env]");
			expect(result).toContain(`deployment = "${sixPointFiveDeployment}"`);
			expect(result).toContain("allow_insecure_author_transport = true");
			expect(result).toContain("[environments.test-env.author]");
			expect(result).toContain(`base_address = "${profile.authorAddress}"`);
			expect(result).toContain("[environments.test-env.publisher]");
			expect(result).toContain(`base_address = "${profile.publisherAddress}"`);
			expect(result).toContain("[environments.test-env.authentication]");
			expect(result).toContain('method = "basic"');
			expect(result).toContain('user_name = "user"');
			expect(result).toContain('password = "pass"');
		});
	});

	describe("serializeSelection", () => {
		it("serializes a selection with the exact shape the client expects", () => {
			const selection: SelectionDocument = {
				profile: "test-profile",
				environment: "test-env",
			};
			const result = serializeSelection(selection);
			expect(result).toContain("format_version = 1");
			expect(result).toContain('profile = "test-profile"');
			expect(result).toContain('environment = "test-env"');
		});
	});

	describe("serializeSnapshot", () => {
		it("serializes snapshot sources in ascending reference order", () => {
			const sources: SnapshotSource[] = [
				{ reference: "z", sha256: "hash-z" },
				{ reference: "a", sha256: "hash-a" },
				{ reference: "m", sha256: "hash-m" },
			];
			const result = serializeSnapshot(sources);
			expect(result).toContain("format_version = 1");
			const aIndex = result.indexOf('reference = "a"');
			const mIndex = result.indexOf('reference = "m"');
			const zIndex = result.indexOf('reference = "z"');
			expect(aIndex).toBeLessThan(mIndex);
			expect(mIndex).toBeLessThan(zIndex);
			expect(result).toContain('sha256 = "hash-a"');
			expect(result).toContain('sha256 = "hash-m"');
			expect(result).toContain('sha256 = "hash-z"');
		});
	});

	describe("writeScratchHome", () => {
		it("authors the documents with the exact paths and permissions the client expects", async () => {
			const options = {
				profileName: "main",
				environment: "dev",
				deployment: sixPointFiveDeployment,
				authorAddress: `${authorAddressScheme}author.local`,
				publisherAddress: `${authorAddressScheme}pub.local`,
				username: "admin",
				password: "secret",
			};
			const home = await writeScratchHome(options);
			try {
				// Check structure
				expect(home.rootPath).toContain(".config/slingshot");
				
				// Check permissions on root (should be 0o700)
				const rootStat = await Bun.file(home.rootPath).stat();
				expect(rootStat.mode & 0o777).toBe(0o700);

				// Check profile exists and has 0o600
				const profilePath = `${home.rootPath}/profiles/main.toml`;
				const profileStat = await Bun.file(profilePath).stat();
				expect(profileStat.mode & 0o777).toBe(0o600);

				// Check selection exists and has 0o600
				const selectionPath = `${home.rootPath}/selection.toml`;
				const selectionStat = await Bun.file(selectionPath).stat();
				expect(selectionStat.mode & 0o777).toBe(0o600);

				// Check snapshot exists and has 0o600
				const snapshotPath = `${home.rootPath}/configuration-snapshot.toml`;
				const snapshotStat = await Bun.file(snapshotPath).stat();
				expect(snapshotStat.mode & 0o777).toBe(0o600);
			} finally {
				await rm(home.homePath, { recursive: true, force: true });
			}
		});

		it("handles a second parameterized profile correctly", async () => {
			const options = {
				profileName: "main",
				environment: "dev",
				deployment: sixPointFiveDeployment,
				authorAddress: `${authorAddressScheme}author.local`,
				publisherAddress: `${authorAddressScheme}pub.local`,
				username: "admin",
				password: "secret",
				secondProfile: {
					name: "alt",
					deployment: "other_deployment",
					authorAddress: `${authorAddressScheme}alt.local`,
					publisherAddress: `${authorAddressScheme}alt-pub.local`,
					username: "alt-user",
					password: "alt-password",
				},
			};
			const home = await writeScratchHome(options);
			try {
				const profileMain = await Bun.file(`${home.rootPath}/profiles/main.toml`).text();
				const profileAlt = await Bun.file(`${home.rootPath}/profiles/alt.toml`).text();
				
				expect(profileMain).toContain(`deployment = "${sixPointFiveDeployment}"`);
				expect(profileAlt).toContain('deployment = "other_deployment"');
				expect(profileAlt).toContain('user_name = "alt-user"');
			} finally {
				await rm(home.homePath, { recursive: true, force: true });
			}
		});
	});
});
