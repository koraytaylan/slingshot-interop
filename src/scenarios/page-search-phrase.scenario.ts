// SPDX-License-Identifier: MIT OR Apache-2.0
// Copyright 2026 Koray Taylan Davgana

import type { ContainerHandle } from "../harness/container.ts";
import type { StartClientRunnerOptions } from "../sides/client-runtime.ts";
import { runPageSearch } from "./page-search-runtime.ts";

export const scenario = {
	run: (handle: ContainerHandle, options: StartClientRunnerOptions) => runPageSearch(handle, options, "phrase"),
};
