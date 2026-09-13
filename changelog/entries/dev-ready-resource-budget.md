---
id: dev-ready-resource-budget
title: Release excess Worker startup reservations after readiness
kind: improved
areas: ["engineering"]
audiences: ["contributors"]
---

Ready local Worker stacks now reserve measured growth room instead of keeping
their entire unused startup budget. Concurrent worktrees can start when that
memory is available, while machine headroom and memory-pressure checks remain.
Waiting messages explain the memory calculation. Older environments need a
restart through the updated launcher to use this behavior.
