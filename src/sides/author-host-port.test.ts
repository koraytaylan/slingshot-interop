// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { authorHostPort } from "./author-host-port.ts";
import { readValues } from "../harness/values.ts";
import { authorAddress } from "./client-configuration.ts";

test("host observations use their override while the container address remains unchanged", () => {
	const values = readValues(new URL("../../support/harness-values.toml", import.meta.url).pathname);
	const address = authorAddress(values);
	expect(authorHostPort({ values })).toBe(values.ports.author);
	expect(authorHostPort({ values, authorHostPort: 18080 })).toBe(18080);
	expect(authorAddress(values)).toBe(address);
	expect(values.ports.author).not.toBe(18080);
});
