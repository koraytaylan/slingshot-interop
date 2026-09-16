// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { parseUniqueJson, readBoundedJson } from "../harness/bounded-json.ts";

// create_asset_folder's result is a closed, one-member object. Compare each
// side to the authored destination so agreement alone cannot bless a wrong path.
export function verifyCreatedFolderResult(clientResult: unknown, terminalResult: unknown, folderPath: string): { readonly ok: boolean; readonly message: string } {
	const matches = (value: unknown): boolean => value !== null && typeof value === "object" && !Array.isArray(value)
		&& Object.keys(value).length === 1 && (value as Record<string, unknown>)["repository_path"] === folderPath;
	if (!matches(clientResult)) return { ok: false, message: "client folder result is not the closed result for the requested path" };
	if (terminalResult === null || typeof terminalResult !== "object" || Array.isArray(terminalResult)) {
		return { ok: false, message: "agent snapshot has no retained folder result" };
	}
	const canonical = (terminalResult as Record<string, unknown>)["canonical_result"];
	try {
		if (typeof canonical === "string" && matches(parseUniqueJson(canonical))) {
			return { ok: true, message: "client and retained agent folder results match the requested path" };
		}
	} catch {
		// Do not expose malformed response text in diagnostics.
	}
	return { ok: false, message: "retained agent folder result is not the closed result for the requested path" };
}

export async function verifyCreatedFolder(response: Response, title: string, maximumBytes: number): Promise<{ readonly ok: boolean; readonly message: string }> {
	const captured = await readBoundedJson(response, maximumBytes);
	if (!captured.ok) return { ok: false, message: `created folder: ${captured.message}` };
	const document = captured.value;
	if (document === null || typeof document !== "object" || Array.isArray(document)) {
		return { ok: false, message: "created folder document is not an object" };
	}
	const properties = document as Record<string, unknown>;
	if (properties["jcr:title"] !== title || properties["jcr:primaryType"] !== "sling:OrderedFolder") {
		return { ok: false, message: "created folder does not have the requested title and sling:OrderedFolder type" };
	}
	return { ok: true, message: "created folder has the requested title and type" };
}
