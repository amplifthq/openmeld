---
id: development-worker-web-lifecycle
title: Keep worktree Workers running when Web restarts
kind: fixed
areas: ["desktop", "developer-tools"]
audiences: ["contributors"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:00c8b31d0962e8eb8d170aee8178e40236efc861", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800"]
---

Worktree development starts the Worker stack separately from Web. Restarting
Web or switching to the compiled Desktop pilot preserves the running Workers
and local database. Use `pnpm desktop:web` after starting the worktree stack
to run the matching compiled pages for Desktop.
