# Agent setup fixtures

These three OSGi configuration files are explicit harness inputs. Their exact
bytes are verified against `../agent-configuration.toml` before installation,
and their names and SHA-256 hashes are included in run reports once loaded.
No ambient agent checkout or `SLINGSHOT_AGENT_ROOT` override is consulted.

They were copied unchanged from `slingshot-agent` commit
`993dd6550b7f5f67b27719026009c67b4b24e1e9`, under
`ui.config/src/main/content/jcr_root/apps/slingshot-agent/osgiconfig/config`.
They establish the state service user, service mappings and administrator
submission permission required by this isolated Sling test environment.

These are harness setup fixtures, not proof that a supplied candidate package
contains matching configuration. Verifying packaged deployment configuration
is a separate requirement. Updates must review the permissions, change the
fixture and digest together, and rerun the real runtime tests.
