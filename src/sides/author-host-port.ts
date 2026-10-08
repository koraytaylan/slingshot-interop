// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import type { StartClientRunnerOptions } from "./client-runtime.ts";

// Host observations can use a different publication without changing the
// author's address inside the run network.
export function authorHostPort(options: Pick<StartClientRunnerOptions, "authorHostPort" | "values">): number {
	return options.authorHostPort ?? options.values.ports.author;
}
