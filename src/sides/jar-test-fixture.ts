// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { crc32, deflateRawSync } from "node:zlib";

// Independent small ZIP writer used only by archive-inspection tests.
export function fixtureJar(rows: readonly { name: string; value: string; deflated?: boolean }[]): Buffer {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const row of rows) {
		const name = Buffer.from(row.name);
		const value = Buffer.from(row.value);
		const compressed = row.deflated ? deflateRawSync(value) : value;
		const method = row.deflated ? 8 : 0;
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8);
		header.writeUInt32LE(crc32(value), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(value.length, 22); header.writeUInt16LE(name.length, 26);
		const record = Buffer.alloc(46);
		record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(method, 10);
		record.writeUInt32LE(crc32(value), 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(value.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(offset, 42);
		const local = Buffer.concat([header, name, compressed]); locals.push(local); central.push(Buffer.concat([record, name])); offset += local.length;
	}
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50); end.writeUInt16LE(rows.length, 8); end.writeUInt16LE(rows.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
