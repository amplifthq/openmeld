---
id: isolated-development-service-cleanup
title: Isolate and clean up development environments
kind: fixed
areas: ["development", "local-service"]
audiences: ["contributors"]
---

Parallel development environments use separate background Services and
maintenance tasks. Stopping one environment releases its running resources
without stopping another. Contributors can clean disposable environment data
and safely retire a completed temporary worktree from one command.
