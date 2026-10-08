// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import { expect, test } from "bun:test";
import { fixtureSources } from "./workflow-fixture.ts";
import { sha256 } from "./source-snapshot.ts";

test("synthetic page types are part of the complete fixture source identity", async () => {
	const source = await fixtureSources();
	expect(source.digest).toBe(sha256(JSON.stringify({ java: sha256(source.java), manifest: sha256(source.manifest), nodetypes: sha256(source.nodetypes) })));
});

test("the public fixture declares only the two synthetic page types and one asset type", async () => {
	const source = await fixtureSources();
	const definitions = source.nodetypes.toString("utf8");
    expect(definitions).toContain("urn:slingshot:interop:synthetic-page-types");
    expect(definitions).toContain("urn:slingshot:interop:synthetic-asset-types");
    expect([...definitions.matchAll(/^\[([^\]]+)\] > nt:unstructured$/gm)].map(match => match[1])).toEqual(["cq:Page", "cq:PageContent", "dam:Asset"]);
	expect(source.manifest.toString("utf8")).toContain("Sling-Nodetypes: SLING-INF/interop-pages.cnd;reregister:=false");
});
