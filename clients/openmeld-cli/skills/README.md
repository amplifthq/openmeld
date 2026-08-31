# OpenMeld Local Skills

This directory stores OpenMeld-compatible Skills for local installation.

Current layout:

- `skills/openmeld-cli/SKILL.md` — short OpenMeld CLI router with topic playbooks
  and command references beside it.

By design, OpenMeld CLI installs bundled skills from the packaged `skills/` directory.

## Maintenance Rule

When OpenMeld CLI adds or changes command behavior, update the owning topic file
under `skills/openmeld-cli/` in the same PR. Keep `SKILL.md` short and update it
only when the first-layer routing or common path changes:

1. Command list (added/removed/renamed commands).
2. Option list (new flags, defaults, and constraints).
3. Runtime behavior that impacts agents (replay semantics, interactive behavior, output mode differences).

Verification checklist before merging:

- `openmeld --help`
- `openmeld agents --help`
- `openmeld agents custom --help`
- `openmeld space --help`
- `openmeld space join --help`
- `openmeld space watch --help`
- `openmeld skills --help`
