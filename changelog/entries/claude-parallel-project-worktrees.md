---
id: claude-parallel-project-worktrees
title: Give parallel Claude tasks independent project worktrees
kind: improved
areas: ["agent-profiles", "projects", "local-agents"]
audiences: ["members", "agents"]
---

Ordinary Claude Code Wakes in parallel mode can work in separate copies of the
connected Project, with file tools and a project shell. Project commands run in
a task-only Docker or Podman container after the Service verifies isolation.
Explicit Space-only tasks still have no local checkout.
