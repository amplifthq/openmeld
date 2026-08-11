# OpenMeld Local Skills

This directory stores OpenMeld-compatible Skills for local installation.

Current layout:

- `skills/openmeld-cli/SKILL.md` — OpenMeld CLI skill for local setup and skills workflow.

By design, OpenMeld CLI installs bundled skills from the packaged `skills/` directory.

## Maintenance Rule

When OpenMeld CLI adds or changes command behavior, update `skills/openmeld-cli/SKILL.md` in the same PR:

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
