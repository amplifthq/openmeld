---
id: codex-mcp-startup-check
title: Keep unrelated MCP discovery out of Codex task startup
kind: fixed
areas: ["agents", "local-service"]
audiences: ["users"]
---

Codex tasks that use native OpenMeld tools no longer wait for unrelated MCP
resource lists before they can start. With Codex 0.160.0 or later, OpenMeld
checks its own tool connection directly. Your configured tools and file access
settings stay in place. Tasks with explicit isolation still receive the full
isolation check.
