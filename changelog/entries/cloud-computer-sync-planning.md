---
id: cloud-computer-sync-planning
title: Reduce Cloud Computer file synchronization work
kind: fixed
areas: ["center-agent", "computer"]
audiences: ["users", "agents"]
---

Cloud Computer file synchronization does less repeated work when it prepares
changes in a large directory tree. File aliases, renamed paths, deletions and
progress across an interrupted synchronization retain their existing behavior.
