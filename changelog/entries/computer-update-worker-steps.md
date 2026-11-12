---
id: computer-update-worker-steps
title: Trace a stalled Computer update to its last observed worker step
kind: improved
areas: ["computers", "core", "openmeld-service"]
audiences: ["operators"]
---

Production update logs show the CLI and Service bundle versions reported by
the Computer. Updated maintenance workers also identify the last step they
entered, from binary download or npm installation through the Service handoff,
replacement and startup verification.
