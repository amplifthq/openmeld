---
id: dev-registry-lock-recovery
title: Recover development locks after an interrupted cleanup
kind: fixed
areas: ["development"]
audiences: ["contributors"]
---

Local development commands can recover when a registry cleanup process exits
unexpectedly, without removing another worktree's active lock. Waiting remains
cancellable. Older anonymous recovery directories are preserved and identified
in the timeout message so they can be inspected safely.
