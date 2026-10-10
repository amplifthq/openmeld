---
id: development-worker-web-lifecycle
title: Keep worktree Workers running when Web restarts
kind: fixed
areas: ["desktop", "developer-tools"]
audiences: ["contributors"]
---

Worktree development starts the Worker stack separately from Web. Restarting
Web or switching to the compiled Desktop pilot preserves the running Workers
and local database. Use `pnpm desktop:web` after starting the worktree stack
to run the matching compiled pages for Desktop.
