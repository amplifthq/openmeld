---
id: worktree-local-auth-isolation
title: Keep local worktree sign-ins separate
kind: fixed
areas: ["developer-workflow"]
audiences: ["contributors"]
---

Worktree development commands automatically assign each worktree its own
`.localhost` address. Use the printed URLs to test multiple worktrees in the
same browser without one sign-in or sign-out replacing another worktree's
session. No per-worktree domain configuration is needed. Sign in again when
moving from a plain `localhost` URL to the new address. Local CLI commands and
setup links continue to use the development lane on these addresses.
