// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { crc32, inflateRawSync } from "node:zlib";

const maximumJarBytes = 64 * 1024 * 1024;
const maximumResourceBytes = 4 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });
type Entry = { flags: number; method: number; crc: number; compressed: number; expanded: number; offset: number };

// Read only bounded registry resources. ZIP64, multipart, encryption, duplicates,
// inconsistent local headers and corrupt requested content are refused.
export class JarResources {
	readonly sha256: string;
	private readonly entries = new Map<string, Entry>();
	private readonly central: number;
	constructor(private readonly bytes: Buffer) {
		this.sha256 = createHash("sha256").update(bytes).digest("hex");
		if (bytes.length > maximumJarBytes) throw new Error("candidate JAR exceeds its inspection bound");
		let end = -1;
		for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 65535); index--) {
			if (bytes.readUInt32LE(index) === 0x06054b50 && index + 22 + bytes.readUInt16LE(index + 20) === bytes.length) { end = index; break; }
		}
		if (end < 0) throw new Error("candidate JAR has no complete ZIP directory");
		const count = bytes.readUInt16LE(end + 10);
		if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || count === 65535 || bytes.readUInt16LE(end + 8) !== count) throw new Error("candidate JAR uses unsupported multipart/ZIP64 framing");
		this.central = bytes.readUInt32LE(end + 16);
		if (this.central + bytes.readUInt32LE(end + 12) !== end) throw new Error("candidate JAR directory extent is inconsistent");
		let offset = this.central;
		for (let index = 0; index < count; index++) {
			if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("candidate JAR directory is truncated");
			const size = bytes.readUInt16LE(offset + 28);
			const next = offset + 46 + size + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
			if (next > end || bytes.readUInt16LE(offset + 34) !== 0) throw new Error("candidate JAR entry extent is inconsistent");
			const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + size));
			if (this.entries.has(name)) throw new Error("candidate JAR contains duplicate resource names");
			this.entries.set(name, { flags: bytes.readUInt16LE(offset + 8), method: bytes.readUInt16LE(offset + 10), crc: bytes.readUInt32LE(offset + 16), compressed: bytes.readUInt32LE(offset + 20), expanded: bytes.readUInt32LE(offset + 24), offset: bytes.readUInt32LE(offset + 42) });
			offset = next;
		}
		if (offset !== end) throw new Error("candidate JAR directory count is inconsistent");
	}
	read(name: string): string {
		const entry = this.entries.get(name);
		if (entry === undefined) throw new Error(`candidate JAR lacks ${name}`);
		const { bytes, central } = this;
		const at = entry.offset;
		if ((entry.flags & ~0x0808) !== 0 || ![0, 8].includes(entry.method) || entry.expanded > maximumResourceBytes) throw new Error("candidate JAR resource has unsupported flags, compression, or expansion size");
		if (at + 30 > central || bytes.readUInt32LE(at) !== 0x04034b50 || bytes.readUInt16LE(at + 6) !== entry.flags || bytes.readUInt16LE(at + 8) !== entry.method) throw new Error("candidate JAR local header disagrees with its directory");
		const nameLength = bytes.readUInt16LE(at + 26);
		const start = at + 30 + nameLength + bytes.readUInt16LE(at + 28);
		if (start + entry.compressed > central || decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength)) !== name) throw new Error("candidate JAR resource extent or name is inconsistent");
		const compressed = bytes.subarray(start, start + entry.compressed);
		const expanded = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: maximumResourceBytes });
		if (expanded.length !== entry.expanded || crc32(expanded) !== entry.crc) throw new Error("candidate JAR resource length or checksum is invalid");
		return decoder.decode(expanded);
	}
}

export async function readJarResources(path: string): Promise<JarResources> {
	const file = await open(path, "r");
	try {
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > maximumJarBytes) throw new Error("candidate JAR is not a bounded regular file");
		const bytes = Buffer.alloc(stat.size + 1);
		let read = 0;
		while (read < bytes.length) {
			const part = await file.read(bytes, read, bytes.length - read, read);
			if (part.bytesRead === 0) break;
			read += part.bytesRead;
		}
		if (read !== stat.size) throw new Error("candidate JAR changed size during inspection");
		return new JarResources(bytes.subarray(0, read));
	} finally { await file.close(); }
}
