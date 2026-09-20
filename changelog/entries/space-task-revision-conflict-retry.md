---
id: space-task-revision-conflict-retry
title: Recover Space Task updates after a concurrent revision
kind: fixed
areas: ["spaces", "agents", "web"]
audiences: ["members", "agents"]
---

Updating a Space Task no longer fails as an untyped concurrent conflict when
the write itself succeeded. If the Task really changed since it was last read,
OpenMeld returns a typed revision conflict and retries once after refreshing
the current revision, so an Agent or person can finish a brief or status change
instead of seeing a dead-end conflict.
