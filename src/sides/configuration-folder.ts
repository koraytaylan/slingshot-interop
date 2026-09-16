// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// Sling's console can answer before its repository POST servlet is registered.
// Retry only startup-unavailable statuses for this idempotent folder setup.
export async function createConfigurationFolder(url: string, authorization: string, deadline: Date, pollMilliseconds: number):
	Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "INSTALL_FAILED"; readonly message: string }> {
	return postConfiguration(url, authorization, deadline, pollMilliseconds,
		() => new URLSearchParams({ "jcr:primaryType": "sling:Folder" }), [200, 201, 409]);
}

export async function uploadConfiguration(url: string, authorization: string, name: string, bytes: Uint8Array, deadline: Date, pollMilliseconds: number):
	Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "INSTALL_FAILED"; readonly message: string }> {
	return postConfiguration(url, authorization, deadline, pollMilliseconds, () => {
		const form = new FormData();
		form.append("*", new Blob([new Uint8Array(bytes)]), name);
		return form;
	}, [200, 201]);
}

async function postConfiguration(url: string, authorization: string, deadline: Date, pollMilliseconds: number,
	body: () => FormData | URLSearchParams, acceptedStatuses: readonly number[]):
	Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "INSTALL_FAILED"; readonly message: string }> {
	let last = "no request attempted";
	while (Date.now() < deadline.getTime()) {
		try {
			const response = await fetch(url, { method: "POST", redirect: "error",
				headers: { authorization }, body: body(),
				signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline.getTime() - Date.now()))) });
			await response.body?.cancel();
			last = `HTTP ${response.status}`;
			if (Date.now() >= deadline.getTime()) break;
			if (acceptedStatuses.includes(response.status)) return { ok: true };
			if (![404, 503].includes(response.status)) return { ok: false, reason: "INSTALL_FAILED", message: `configuration setup ${url} refused: ${last}` };
		} catch (failure) {
			return { ok: false, reason: "INSTALL_FAILED", message: `configuration setup ${url} failed: ${failure instanceof Error ? failure.message : String(failure)}` };
		}
		const remaining = deadline.getTime() - Date.now();
		if (remaining > 0) await Bun.sleep(Math.min(pollMilliseconds, remaining));
	}
	return { ok: false, reason: "INSTALL_FAILED", message: `configuration setup ${url} was unavailable by ${deadline.toISOString()}: ${last}` };
}
