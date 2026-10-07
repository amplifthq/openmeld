---
id: codex-mcp-startup-check
title: Keep unrelated MCP discovery out of Codex task startup
kind: fixed
areas: ["agents", "local-service"]
audiences: ["users"]
---

With Codex 0.160.0 or later, OpenMeld checks its own tool connection without
opening extra connections to unrelated tool services. A stalled extra connection
no longer blocks an ordinary task before it starts. Your configured tools and
file access settings stay in place. Tasks with explicit isolation still receive
the full isolation check.
