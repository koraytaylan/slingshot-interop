// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { open } from "node:fs/promises";

// Read through one handle, with room for one excess byte to detect growth.
export async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) throw new Error("invalid file bound");
	const file = await open(path, "r");
	try {
		const metadata = await file.stat();
		if (!metadata.isFile() || metadata.size > maximumBytes) throw new Error("input is not a bounded regular file");
		const bytes = Buffer.alloc(metadata.size + 1);
		let position = 0;
		while (position < bytes.length) {
			const part = await file.read(bytes, position, bytes.length - position, position);
			if (part.bytesRead === 0) break;
			position += part.bytesRead;
		}
		if (position !== metadata.size) throw new Error("input size changed while reading");
		return bytes.subarray(0, position);
	} finally { await file.close(); }
}
