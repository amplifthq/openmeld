---
id: preserve-codex-activity-hook-trust-state
title: Keep Codex Agent Activity observers repairable
kind: fixed
areas: ["agent-activity", "cli"]
audiences: ["members"]
---

OpenMeld now preserves Codex-generated hook trust state when installing or
updating Agent Activity observers, while continuing to reject edits to the
OpenMeld-owned hooks themselves.
