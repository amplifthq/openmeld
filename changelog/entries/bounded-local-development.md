---
id: bounded-local-development
title: Coordinate local development across worktrees
kind: improved
areas: ["developer-workflow"]
audiences: ["contributors"]
---

Isolated development servers and broad validation commands now coordinate local
resource capacity across worktrees. Startup waits when memory is constrained,
status includes descendant processes and memory usage, and shutdown verifies
that owned processes exit without stopping another worktree.

The development toolchain includes updated Turbo and Cloudflare plugins, and
the startup path keeps fewer launcher processes. Install dependencies explicitly
after a lockfile change; `pnpm check` no longer runs an installation first.

Gateway tests reuse one Workers runtime and module cache while keeping test
storage isolated. Four sequential test groups bound local connections and
release cached modules between groups.
