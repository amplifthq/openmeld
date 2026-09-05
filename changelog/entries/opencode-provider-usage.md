---
id: opencode-provider-usage
title: See OpenCode provider capacity before starting work
kind: improved
areas: ["computers", "local-agents", "wake"]
audiences: ["members"]
publishedAt: 2026-09-02
release: v0.3.146
evidence: ["pr:561", "pr:564", "commit:25012c9838c9fc0330592b1d6e34f98936bff6b9", "workflow:33619512990", "workflow:33620166576", "workflow:33621045896"]
---

OpenCode now shows provider-by-provider capacity on Computers. OpenCode Go
reports its 5-hour, weekly, and monthly limits, and OpenMeld checks the selected
provider's supported limits before starting new work without letting another
provider's capacity block the Agent Profile.
