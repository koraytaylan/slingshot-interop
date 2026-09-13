# scripts

The commands. Preparation commands say when they reach the network and are
never run by the gate; verification commands fetch nothing and refuse a
missing input by naming the preparation command. `quality` proves the harness
and `interop` proves the pair; each takes no argument and runs every stage
every time.

- `prepare_tooling` fetches and installs the pinned Bun; `verify_tooling`
  proves the installed binary offline.
- `prepare_locked_dependency_cache` builds the locked dependency cache;
  `verify_locked_dependency_cache` proves it offline.
- `prepare_interop_images` pulls the digest-pinned container images and never
  a tag; `verify_interop_images` proves them offline at their exact digests.
