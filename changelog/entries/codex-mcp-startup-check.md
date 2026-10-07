---
id: codex-mcp-startup-check
publishedAt: 2026-10-07
release: v0.3.247
evidence: ["pr:1557", "pr:1568", "workflow:37607115073"]
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
