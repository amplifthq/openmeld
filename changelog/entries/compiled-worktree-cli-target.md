---
id: compiled-worktree-cli-target
title: Keep compiled test builds on their own CLI environment
kind: fixed
areas: ["setup", "development"]
audiences: ["developers", "agents"]
evidence: ["pr:1156"]
---

Compiled worktree builds now keep installation and follow-up commands on the
same isolated CLI environment, including its Home, service endpoints, and
artifact manifest. Incomplete or conflicting test configuration reports an
error instead of silently offering a production installation command.
