---
id: isolated-task-git-config
title: Keep normal Git setup available in isolated tasks
kind: fixed
areas: ["local-agents", "openmeld-service"]
audiences: ["users"]
---

Isolated Codex project tasks can save branch tracking and user settings and run
repository hook installers. Git hooks and repository routing pointers remain
protected. OpenMeld checks executable Git setting changes when the task finishes
and reports restored settings and preserved hook paths in task progress.
