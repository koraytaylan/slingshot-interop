# src/harness

The container machinery: the Podman process wrapper, the container lifecycle
with its leak check, the severance proxy, and the typed loader over
`support/harness-values.toml`. Nothing here knows which product it is proving:
the roles the containers play are named by the callers above this layer.
