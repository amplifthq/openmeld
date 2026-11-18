---
id: local-service-repair-evidence
title: Keep Service repair moving when cloud status is unavailable
kind: fixed
areas: ["cli", "local-agents"]
audiences: ["users", "operators"]
---

`openmeld service repair` now saves local logs and diagnostics before cleanup
and after a failure without waiting for cloud status. You can still request a
full status snapshot with `openmeld service snapshot`.
