// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// The client's own configuration documents, written into a scratch home the
// runner mounts as the client account's account-database home. The harness
// configures the client through its own profile mechanism and nothing else —
// a profile document, the optional selection document, and the required
// configuration-snapshot generation manifest, under the root the contract
// spells (.config/slingshot) — because a tier that configured the client
// some other way would prove a path no user takes. The spellings come from
// the client's own contract (policy/profile-authentication-contract-1.json):
// the deployment is one of the two the closed deployments inventory allows,
// and every file is written owner-only, because the client refuses a file
// readable or writable by anybody else and a root writable by them.

import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Values } from "../harness/values.ts";

// The root components, the profile directory name, and the document names:
// read out of the contract's literals, not restated from memory. The values
// are fixed by the client's own gate, so naming them here as the shapes the
// documents take is the spelling the contract itself publishes.
export const configurationRootComponents = [".config", "slingshot"] as const;
export const profileDirectoryName = "profiles";
export const profileFileNameSuffix = ".toml";
export const selectionFileName = "selection.toml";
export const configurationSnapshotFileName = "configuration-snapshot.toml";

// The one deployment the 6.5 row declares, spelled as the closed deployments
// inventory allows: a free-text "6.5" is not one of the two spellings.
export const sixPointFiveDeployment = "adobe_experience_manager_6_5";

// The address spelling the 6.5 cleartext rule allows off loopback: a scheme
// of https is not what a proxy on the run's network speaks.
export const authorAddressScheme = "http://";

export type ProfileCredentials = {
	readonly username: string;
	readonly password: string;
};

// The profile document: the format version the contract's limit names, one
// name, and one environment carrying the deployment, the author and
// publisher addresses, and the basic authentication table.
export type ProfileDocument = {
	readonly name: string;
	readonly environment: string;
	readonly deployment: string;
	readonly authorAddress: string;
	readonly publisherAddress: string;
	readonly username: string;
	readonly password: string;
};

// The selection document: the format version and both names, because naming
// only one is a shape failure the client refuses.
export type SelectionDocument = {
	readonly profile: string;
	readonly environment: string;
};

// The generation manifest: every source the root carries with the digest of
// its bytes, strictly ascending by reference.
export type SnapshotSource = {
	readonly reference: string;
	readonly sha256: string;
};

// Serializes a profile into the client's own document shape: one-line basic
// strings, a dotted table per environment, and nothing the client's parser
// would refuse or ride along.
export function serializeProfile(profile: ProfileDocument): string {
	const environment = profile.environment;
	const lines = [
		"format_version = 1",
		`name = "${profile.name}"`,
		"",
		`[environments.${environment}]`,
		`deployment = "${profile.deployment}"`,
		// The cleartext author here points off loopback at the severance
		// proxy, and the upstream contract refuses exactly that shape unless
		// the environment carries the opt-in (docs/CONFIGURATION.md:
		// allow_insecure_author_transport = true), spelled in the environment
		// table — not inside the author table, which the client's
		// TierDocument denies as an unknown field.
		"allow_insecure_author_transport = true",
		"",
		`[environments.${environment}.author]`,
		`base_address = "${profile.authorAddress}"`,
		"",
		`[environments.${environment}.publisher]`,
		`base_address = "${profile.publisherAddress}"`,
		"",
		`[environments.${environment}.authentication]`,
		'method = "basic"',
		`user_name = "${profile.username}"`,
		`password = "${profile.password}"`,
		"",
	];
	return lines.join("\n");
}

// Serializes the selection document: the format version and both names, the
// pair the contract's members inventory declares.
export function serializeSelection(selection: SelectionDocument): string {
	const lines = [
		"format_version = 1",
		`profile = "${selection.profile}"`,
		`environment = "${selection.environment}"`,
	];
	return lines.join("\n") + "\n";
}

// Serializes the generation manifest: every source listed with the digest of
// its bytes, in ascending reference order.
export function serializeSnapshot(sources: readonly SnapshotSource[]): string {
	const sorted = [...sources].sort((first, second) =>
		first.reference < second.reference ? -1 : first.reference > second.reference ? 1 : 0,
	);
	const lines = ["format_version = 1"];
	for (const source of sorted) {
		lines.push("", "[[sources]]");
		lines.push(`reference = "${source.reference}"`);
		lines.push(`sha256 = "${source.sha256}"`);
	}
	return lines.join("\n") + "\n";
}

// The digest the manifest records for one source: the exact digest of its
// bytes, the same bytes the client reads back and compares.
export function sha256OfBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export type ScratchHome = {
	readonly homePath: string;
	// The root the contract spells: homePath plus its own components.
	readonly rootPath: string;
	// The profile the selection names: the one the client's own resolution
	// reads.
	readonly profileName: string;
	readonly environmentName: string;
};

export type WriteScratchHomeOptions = {
	// The profile the harness authors: the 6.5 deployment with basic
	// credentials at the author address.
	readonly profileName: string;
	readonly environment: string;
	readonly deployment: string;
	readonly authorAddress: string;
	readonly publisherAddress: string;
	readonly username: string;
	readonly password: string;
	// A second profile may be written parameterized, pointing elsewhere, for
	// a scenario that needs the selection to choose between two; the
	// selection still names exactly one pair.
	readonly secondProfile?: {
		readonly name: string;
		readonly deployment: string;
		readonly authorAddress: string;
		readonly publisherAddress: string;
		readonly username: string;
		readonly password: string;
	};
	// The parent directory the scratch home is created under; defaults to
	// the system temporary directory.
	readonly parent?: string;
};

// A file the client must find readable only by its owner: 0o600, because the
// client refuses every file below the root readable by nobody-else bits.
async function writeOwnedOnly(path: string, contents: string): Promise<void> {
	await writeFile(path, contents, { mode: 0o600 });
	await chmod(path, 0o600);
}

// A directory the client must find writable only by its owner: 0o700.
async function ensureOwnedOnly(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmod(path, 0o700);
}

// Authors the client's own documents into a fresh scratch home: the root the
// contract spells under the home, one profile, the optional selection, and
// the required generation manifest that lists every source it carries with
// the digest of its bytes. Nothing but the client's own shapes is written,
// and nothing reads them back but the client.
export async function writeScratchHome(
	options: WriteScratchHomeOptions,
): Promise<ScratchHome> {
	const homePath = await mkdtemp(join(options.parent ?? tmpdir(), "client-home-"));
	await chmod(homePath, 0o700);
	let rootPath = homePath;
	for (const component of configurationRootComponents) {
		rootPath = join(rootPath, component);
	}
	await ensureOwnedOnly(rootPath);
	const profilesDirectory = join(rootPath, profileDirectoryName);
	await ensureOwnedOnly(profilesDirectory);

	const profiles: readonly ProfileDocument[] = [
		{
			name: options.profileName,
			environment: options.environment,
			deployment: options.deployment,
			authorAddress: options.authorAddress,
			publisherAddress: options.publisherAddress,
			username: options.username,
			password: options.password,
		},
		...(options.secondProfile !== undefined
			? [
					{
						name: options.secondProfile.name,
						environment: options.environment,
						deployment: options.secondProfile.deployment,
						authorAddress: options.secondProfile.authorAddress,
						publisherAddress: options.secondProfile.publisherAddress,
						username: options.secondProfile.username,
						password: options.secondProfile.password,
					},
				]
			: []),
	];
	const sources: SnapshotSource[] = [];
	for (const profile of profiles) {
		const reference = `${profileDirectoryName}/${profile.name}${profileFileNameSuffix}`;
		const document = serializeProfile(profile);
		sources.push({
			reference,
			sha256: sha256OfBytes(new TextEncoder().encode(document)),
		});
		await writeOwnedOnly(join(profilesDirectory, `${profile.name}${profileFileNameSuffix}`), document);
	}

	// The selection is optional by the contract; the harness writes it so the
	// run selects exactly one pair without naming either on the command line.
	const selection: SelectionDocument = {
		profile: options.profileName,
		environment: options.environment,
	};
	const selectionDocument = serializeSelection(selection);
	sources.push({
		reference: selectionFileName,
		sha256: sha256OfBytes(new TextEncoder().encode(selectionDocument)),
	});
	await writeOwnedOnly(join(rootPath, selectionFileName), selectionDocument);

	// The generation manifest is required: it lists every source above, and
	// the client refuses a root whose set on disk is not exactly the set it
	// lists with the exact digest of each.
	await writeOwnedOnly(join(rootPath, configurationSnapshotFileName), serializeSnapshot(sources));

	return { homePath, rootPath, profileName: options.profileName, environmentName: options.environment };
}

// The name the author runtime answers to on the run's network. The severance
// proxy forwards to it, and the client's profiles address it directly in the
// scenario that proves a refusal, so the container carries this name: without
// one it is reachable only by the identifier Podman generated, which no
// profile names and no upstream resolves.
export const AUTHOR_RUNTIME_NAME = "tier-sling";

// The name the severance proxy answers to on the run's network, which is what
// every profile's author address names.
export const SEVERANCE_PROXY_NAME = "severance-proxy";

// The address the profile points at in a real run: the severance proxy's
// port on the run's network, because every byte the client sends can be
// severed on command. A cleartext author off loopback is exactly what the
// client's own allow_insecure_author_transport field, which the serialized
// environment always declares, is what permits.
export function authorAddress(values: Values): string {
	return `${authorAddressScheme}${SEVERANCE_PROXY_NAME}:${values.ports.proxy}`;
}