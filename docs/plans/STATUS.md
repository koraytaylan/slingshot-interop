# Plans — roll-up board

One row per plan, no per-task detail; new-format task status lives in task frontmatter and is summarized by the plan's STATUS.md.

| Plan | Title | Status | Tasks | Outcome | Status doc |
|---|---|---|---|---|---|
| 0001 | Standalone release interop harness for the Slingshot pair | 🚧 In progress | 19/22 | Not yet achieved; this plan has not been implemented. When it is, this repository holds the standalone gate: one command runs the real client executable against the real Sling-only bundle in rootless Podman with each side resolved from digest-verified released or owner-supplied candidate bytes, the seven exchange-level scenarios prove the pair through the client's own CLI and profile mechanism, the severed-submission scenario proves unknown-outcome reconciliation with exactly one admission and one effect, both siblings' release checklists have one command and one report to rely on, and every prepared input is prepared once by a named network-reaching command and verified offline by a gate that fetches nothing. | [status](0001-standalone-release-interop-harness/STATUS.md) |
