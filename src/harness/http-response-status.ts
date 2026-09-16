// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

// A bounded first-line witness for the harness's cleartext, one-request-per-
// connection HTTP/1.1 exchanges. This is not a response/body framing validator.
// Informational responses and other protocol versions fail closed: they are
// not final status evidence. Headers and bodies are never retained.
export class HttpResponseStatus {
	private prefix = Buffer.alloc(0);
	private complete = false;
	private observed: number | undefined;
	static readonly maximumLineBytes = 1024;

	read(chunk: Uint8Array): number | undefined {
		if (this.complete) return this.observed;
		const remaining = HttpResponseStatus.maximumLineBytes - this.prefix.length;
		this.prefix = Buffer.concat([this.prefix, chunk.subarray(0, remaining)]);
		const end = this.prefix.indexOf("\r\n");
		if (end < 0 && this.prefix.length < HttpResponseStatus.maximumLineBytes) return undefined;
		this.complete = true;
		if (end >= 0) {
			// Latin-1 preserves non-ASCII bytes so the grammar can reject them.
			const line = this.prefix.subarray(0, end).toString("latin1");
			const match = /^HTTP\/1\.1 ([2-5][0-9]{2}) [\x20-\x7e]*$/.exec(line);
			if (match !== null) this.observed = Number(match[1]);
		}
		this.prefix = Buffer.alloc(0);
		return this.observed;
	}
}
